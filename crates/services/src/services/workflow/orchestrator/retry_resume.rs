//! Retry / resume / final-review invariant handling.

use db::{
    DBService,
    models::{
        chat_session::ChatSession, chat_session_agent::ChatSessionAgent,
        workflow_agent_session::WorkflowAgentSession, workflow_event::WorkflowEvent,
        workflow_execution::WorkflowExecution, workflow_loop::WorkflowLoop,
        workflow_plan::WorkflowPlan, workflow_plan_revision::WorkflowPlanRevision,
        workflow_step::WorkflowStep, workflow_step_edge::WorkflowStepEdge,
        workflow_transcript::WorkflowTranscript, workflow_types::*,
    },
};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::{
    super::{
        chat_runner::ChatRunner,
        workflow_analytics,
        workflow_loop_executor::LoopExecutor,
        workflow_runtime::{WorkflowStepRunResult, parse_summary_payload},
    },
    OrchestratorError, StepOutcome, WorkflowOrchestrator, load_agents_for_session,
};

impl WorkflowOrchestrator {
    pub(super) const FINAL_REVIEW_CONTENT: &'static str = "任务已完成，是否接受结果？";
    pub(super) const FINAL_REVIEW_DESCRIPTION: &'static str =
        "所有任务步骤已执行完毕，等待用户确认最终结果。";

    pub async fn execution_was_stopped_by_user(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<bool, OrchestratorError> {
        let events = WorkflowEvent::find_by_execution(pool, execution_id).await?;
        Ok(events.iter().any(|event| {
            event.step_id.is_none()
                && event.status_after.as_deref() == Some("failed")
                && event
                    .detail_json
                    .as_deref()
                    .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
                    .and_then(|detail| {
                        detail
                            .get("message")
                            .and_then(|value| value.as_str())
                            .map(str::to_owned)
                    })
                    .as_deref()
                    == Some("stopped_by_user")
        }))
    }

    pub async fn retry_step(
        db: &DBService,
        chat_runner: &ChatRunner,
        step_id: Uuid,
    ) -> Result<(WorkflowExecution, WorkflowStep), OrchestratorError> {
        let pool = &db.pool;
        let (execution, ready_step) = Self::prepare_step_retry(pool, chat_runner, step_id).await?;

        workflow_analytics::track_retry_triggered(
            chat_runner.analytics_service(),
            execution.session_id,
            execution.id,
            step_id,
            ready_step.retry_count + 1,
        );

        let execution =
            Self::activate_execution_for_step_retry(pool, chat_runner, &execution).await?;
        let execution =
            Self::retry_single_step_only(db, chat_runner, &execution, &ready_step).await?;

        let latest_execution = WorkflowExecution::find_by_id(pool, execution.id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("execution {} 未找到", execution.id))
            })?;
        let latest_step = WorkflowStep::find_by_id(pool, ready_step.id)
            .await?
            .ok_or_else(|| OrchestratorError::NotFound(format!("step {} 未找到", ready_step.id)))?;

        Ok((latest_execution, latest_step))
    }

    /// Retry only the review phase of a step, keeping the existing task output.
    pub async fn retry_step_review(
        db: &DBService,
        chat_runner: &ChatRunner,
        step_id: Uuid,
    ) -> Result<(WorkflowExecution, WorkflowStep), OrchestratorError> {
        let pool = &db.pool;
        let step = WorkflowStep::find_by_id(pool, step_id)
            .await?
            .ok_or_else(|| OrchestratorError::NotFound(format!("step {} 未找到", step_id)))?;
        let execution = WorkflowExecution::find_by_id(pool, step.execution_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("execution {} 未找到", step.execution_id))
            })?;

        Self::validate_step_retry_candidate(&step)?;

        if !step.lead_review_required {
            return Err(OrchestratorError::IllegalTransition(
                "step does not have lead review enabled, cannot retry review".to_string(),
            ));
        }

        // Reconstruct the task result from persisted data
        let summary_payload =
            parse_summary_payload(step.summary_text.as_deref()).ok_or_else(|| {
                OrchestratorError::IllegalTransition(
                    "step has no persisted task output, cannot retry review only".to_string(),
                )
            })?;
        let run_id = step.latest_run_id.ok_or_else(|| {
            OrchestratorError::IllegalTransition(
                "step has no run_id, cannot retry review only".to_string(),
            )
        })?;
        let result = WorkflowStepRunResult {
            run_id,
            summary: summary_payload.summary,
            content: summary_payload
                .content
                .or_else(|| step.content.clone())
                .unwrap_or_default(),
            outputs: summary_payload.outputs,
        };

        // Prepare retry keeping task outputs
        let prepared_step = WorkflowStep::prepare_retry_review(pool, step.id).await?;
        let ready_step = Self::transition_step_and_sync(
            pool,
            chat_runner,
            &execution,
            &prepared_step,
            WorkflowStepStatus::Ready,
            "step_retry_review_prepared",
        )
        .await?;

        let execution =
            Self::activate_execution_for_step_retry(pool, chat_runner, &execution).await?;

        // Run only the review phase
        let execution =
            Self::retry_review_only(db, chat_runner, &execution, &ready_step, result).await?;

        let latest_execution = WorkflowExecution::find_by_id(pool, execution.id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("execution {} 未找到", execution.id))
            })?;
        let latest_step = WorkflowStep::find_by_id(pool, ready_step.id)
            .await?
            .ok_or_else(|| OrchestratorError::NotFound(format!("step {} 未找到", ready_step.id)))?;

        Ok((latest_execution, latest_step))
    }

    async fn retry_review_only(
        db: &DBService,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        step: &WorkflowStep,
        result: WorkflowStepRunResult,
    ) -> Result<WorkflowExecution, OrchestratorError> {
        let pool = &db.pool;
        let plan = WorkflowPlan::find_by_id(pool, execution.plan_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("plan {} 未找到", execution.plan_id))
            })?;
        let session = ChatSession::find_by_id(pool, execution.session_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("session {} 未找到", execution.session_id))
            })?;
        let session_agents = ChatSessionAgent::find_all_for_session(pool, session.id).await?;
        let workflow_agent_sessions =
            WorkflowAgentSession::find_by_execution(pool, execution.id).await?;
        let current_steps = WorkflowStep::find_by_execution(pool, execution.id).await?;
        let edges = WorkflowStepEdge::find_by_execution(pool, execution.id).await?;
        let agents = load_agents_for_session(pool, &session_agents).await?;

        let workflow_session =
            super::resolve_step_workflow_session(execution, &workflow_agent_sessions, step)?;
        let session_agent = session_agents
            .iter()
            .find(|sa| sa.id == workflow_session.session_agent_id)
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "session agent {} 未找到",
                    workflow_session.session_agent_id
                ))
            })?;
        let agent = agents
            .iter()
            .find(|a| a.id == session_agent.agent_id)
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("agent {} 未找到", session_agent.agent_id))
            })?;

        // Transition step to Running, then call execute_step_with_feedback for review
        let running_step = Self::transition_step_and_sync(
            pool,
            chat_runner,
            execution,
            step,
            WorkflowStepStatus::Running,
            "step_review_retry_started",
        )
        .await?;

        let outcome = Self::execute_step_with_feedback(
            db,
            pool,
            chat_runner,
            execution,
            &running_step,
            workflow_session,
            &session,
            session_agent,
            agent,
            &workflow_agent_sessions,
            &session_agents,
            &agents,
            &plan,
            &current_steps,
            &edges,
            result,
            false,
        )
        .await?;

        match outcome {
            StepOutcome::Completed => {
                Self::finalize_single_step_retry_completion(pool, chat_runner, execution, step.id)
                    .await
            }
            StepOutcome::Parked | StepOutcome::Interrupted => {
                let waiting_execution =
                    Self::synchronize_runtime_state(pool, execution.id, false).await?;
                Self::refresh_execution_projection_with_reason(
                    pool,
                    chat_runner,
                    waiting_execution.id,
                    None,
                    "step_retry_review_waiting",
                    vec![step.id.to_string()],
                )
                .await
            }
            StepOutcome::Failed(reason) => {
                let failed_execution =
                    Self::synchronize_runtime_state(pool, execution.id, false).await?;
                Self::refresh_execution_projection_with_reason(
                    pool,
                    chat_runner,
                    failed_execution.id,
                    Some(reason),
                    "step_retry_review_failed",
                    vec![step.id.to_string()],
                )
                .await
            }
        }
    }

    pub(super) async fn activate_execution_for_step_retry(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
    ) -> Result<WorkflowExecution, OrchestratorError> {
        if execution.status == WorkflowExecutionStatus::Running {
            Ok(execution.clone())
        } else {
            Self::transition_execution_and_sync(
                pool,
                chat_runner,
                execution,
                WorkflowExecutionStatus::Running,
                "execution_running",
                None,
            )
            .await
        }
    }

    pub(super) async fn prepare_step_retry(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        step_id: Uuid,
    ) -> Result<(WorkflowExecution, WorkflowStep), OrchestratorError> {
        let step = WorkflowStep::find_by_id(pool, step_id)
            .await?
            .ok_or_else(|| OrchestratorError::NotFound(format!("step {} 未找到", step_id)))?;
        let execution = WorkflowExecution::find_by_id(pool, step.execution_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("execution {} 未找到", step.execution_id))
            })?;

        Self::validate_step_retry_candidate(&step)?;

        let prepared_step = WorkflowStep::prepare_retry(pool, step.id).await?;
        let ready_step = Self::transition_step_and_sync(
            pool,
            chat_runner,
            &execution,
            &prepared_step,
            WorkflowStepStatus::Ready,
            "step_retry_prepared",
        )
        .await?;

        Ok((execution, ready_step))
    }

    pub(super) fn validate_step_retry_candidate(
        step: &WorkflowStep,
    ) -> Result<(), OrchestratorError> {
        if !matches!(
            step.status,
            WorkflowStepStatus::Failed | WorkflowStepStatus::Interrupted
        ) {
            return Err(OrchestratorError::IllegalTransition(format!(
                "step {} is {:?}, expected failed or interrupted",
                step.id, step.status
            )));
        }
        Ok(())
    }

    pub(super) fn all_steps_completed_like(steps: &[WorkflowStep]) -> bool {
        !steps.is_empty()
            && steps.iter().all(|step| {
                matches!(
                    step.status,
                    WorkflowStepStatus::Completed | WorkflowStepStatus::Skipped
                )
            })
    }

    pub(super) async fn ensure_waiting_final_review_invariant(
        pool: &SqlitePool,
        execution: &WorkflowExecution,
    ) -> Result<Option<WorkflowTranscript>, OrchestratorError> {
        if execution.status != WorkflowExecutionStatus::Waiting {
            return Ok(None);
        }

        let steps = WorkflowStep::find_by_execution(pool, execution.id).await?;
        if !Self::all_steps_completed_like(&steps) {
            return Ok(None);
        }

        Self::ensure_unresolved_final_review(pool, execution.id)
            .await
            .map(Some)
    }

    pub(super) async fn ensure_unresolved_final_review(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<WorkflowTranscript, OrchestratorError> {
        WorkflowTranscript::create_unresolved_final_review_if_missing(
            pool,
            execution_id,
            Self::FINAL_REVIEW_CONTENT,
            Self::FINAL_REVIEW_DESCRIPTION,
            Uuid::new_v4(),
        )
        .await
        .map_err(OrchestratorError::Database)
    }

    async fn retry_single_step_only(
        db: &DBService,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        step: &WorkflowStep,
    ) -> Result<WorkflowExecution, OrchestratorError> {
        let pool = &db.pool;
        let plan = WorkflowPlan::find_by_id(pool, execution.plan_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("plan {} 未找到", execution.plan_id))
            })?;
        let session = ChatSession::find_by_id(pool, execution.session_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("session {} 未找到", execution.session_id))
            })?;
        let session_agents = ChatSessionAgent::find_all_for_session(pool, session.id).await?;
        let workflow_agent_sessions =
            WorkflowAgentSession::find_by_execution(pool, execution.id).await?;
        let current_steps = WorkflowStep::find_by_execution(pool, execution.id).await?;
        let edges = WorkflowStepEdge::find_by_execution(pool, execution.id).await?;
        let agents = load_agents_for_session(pool, &session_agents).await?;

        let outcome = Self::prepare_and_run_step(
            db,
            pool,
            chat_runner,
            execution,
            step,
            &workflow_agent_sessions,
            &session,
            &session_agents,
            &agents,
            &plan,
            &current_steps,
            &edges,
        )
        .await?;

        match outcome {
            StepOutcome::Completed => {
                Self::finalize_single_step_retry_completion(pool, chat_runner, execution, step.id)
                    .await
            }
            StepOutcome::Parked | StepOutcome::Interrupted => {
                let waiting_execution =
                    Self::synchronize_runtime_state(pool, execution.id, false).await?;
                Self::refresh_execution_projection_with_reason(
                    pool,
                    chat_runner,
                    waiting_execution.id,
                    None,
                    "step_retry_waiting",
                    vec![step.id.to_string()],
                )
                .await
            }
            StepOutcome::Failed(reason) => {
                let failed_execution =
                    Self::synchronize_runtime_state(pool, execution.id, false).await?;
                Self::refresh_execution_projection_with_reason(
                    pool,
                    chat_runner,
                    failed_execution.id,
                    Some(reason),
                    "step_retry_failed",
                    vec![step.id.to_string()],
                )
                .await
            }
        }
    }

    pub(super) async fn finalize_single_step_retry_completion(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        step_id: Uuid,
    ) -> Result<WorkflowExecution, OrchestratorError> {
        let refreshed_execution =
            Self::synchronize_runtime_state(pool, execution.id, false).await?;
        let steps = WorkflowStep::find_by_execution(pool, refreshed_execution.id).await?;
        let workflow_agent_sessions =
            WorkflowAgentSession::find_by_execution(pool, refreshed_execution.id).await?;
        let retried_step = steps
            .iter()
            .find(|step| step.id == step_id)
            .cloned()
            .ok_or_else(|| OrchestratorError::NotFound(format!("step {} not found", step_id)))?;
        let restored_loop = Self::restore_loop_running_if_retry_recovered(
            pool,
            &refreshed_execution,
            &steps,
            &retried_step,
        )
        .await?;
        let mut changed_step_ids = vec![step_id.to_string()];
        if let Some(workflow_loop) = restored_loop.as_ref() {
            changed_step_ids.push(workflow_loop.review_step_id.to_string());
            LoopExecutor::emit_loop_event(
                pool,
                &refreshed_execution,
                workflow_loop,
                WorkflowEventType::LoopRetrying,
                Some(serde_json::json!({
                    "reason": "loop_recovered_after_step_retry",
                    "step_id": step_id,
                })),
            )
            .await?;
        }

        if refreshed_execution.status == WorkflowExecutionStatus::Completed {
            let plan = WorkflowPlan::find_by_id(pool, refreshed_execution.plan_id)
                .await?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!(
                        "plan {} 未找到",
                        refreshed_execution.plan_id
                    ))
                })?;
            let revision_id = refreshed_execution.active_revision_id.ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "execution {} 缺少 active revision",
                    refreshed_execution.id
                ))
            })?;
            let revision = WorkflowPlanRevision::find_by_id(pool, revision_id)
                .await?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("revision {} 未找到", revision_id))
                })?;
            let session_agents =
                ChatSessionAgent::find_all_for_session(pool, refreshed_execution.session_id)
                    .await?;
            let agents = load_agents_for_session(pool, &session_agents).await?;
            let completed = Self::refresh_execution_projection_with_reason(
                pool,
                chat_runner,
                refreshed_execution.id,
                None,
                "execution_completed",
                Vec::new(),
            )
            .await?;

            Self::persist_completion_work_items(
                pool,
                chat_runner,
                &completed,
                &steps,
                &workflow_agent_sessions,
                &session_agents,
                &agents,
            )
            .await?;
            Self::refresh_workflow_card_with_reason(
                pool,
                chat_runner,
                &completed,
                &plan,
                &revision,
                &session_agents,
                &agents,
                None,
                "step_retry_completed",
                changed_step_ids,
            )
            .await?;

            return Ok(completed);
        }

        Self::refresh_execution_projection_with_reason(
            pool,
            chat_runner,
            refreshed_execution.id,
            None,
            "step_retry_completed",
            changed_step_ids,
        )
        .await
    }

    async fn restore_loop_running_if_retry_recovered(
        pool: &SqlitePool,
        execution: &WorkflowExecution,
        steps: &[WorkflowStep],
        retried_step: &WorkflowStep,
    ) -> Result<Option<WorkflowLoop>, OrchestratorError> {
        let Some(loop_id) = retried_step.loop_id else {
            return Ok(None);
        };

        let Some(workflow_loop) = WorkflowLoop::find_by_id(pool, loop_id).await? else {
            return Ok(None);
        };

        if workflow_loop.execution_id != execution.id
            || workflow_loop.status != WorkflowLoopStatus::Failed
        {
            return Ok(None);
        }

        let loop_has_failed_step = steps
            .iter()
            .any(|step| step.loop_id == Some(loop_id) && step.status == WorkflowStepStatus::Failed);
        if loop_has_failed_step {
            return Ok(None);
        }

        WorkflowLoop::update_status(pool, loop_id, WorkflowLoopStatus::Running, None)
            .await
            .map(Some)
            .map_err(OrchestratorError::Database)
    }

    pub async fn resume_execution(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution_id: Uuid,
    ) -> Result<WorkflowExecution, OrchestratorError> {
        let execution = WorkflowExecution::find_by_id(pool, execution_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("execution {} 未找到", execution_id))
            })?;

        if !matches!(
            execution.status,
            WorkflowExecutionStatus::Paused | WorkflowExecutionStatus::Failed
        ) {
            return Err(OrchestratorError::IllegalTransition(format!(
                "execution {} is {:?}, expected paused or failed",
                execution.id, execution.status
            )));
        }

        if execution.status == WorkflowExecutionStatus::Failed
            && Self::execution_was_stopped_by_user(pool, execution.id).await?
        {
            return Err(OrchestratorError::IllegalTransition(
                "workflow stopped by user cannot be resumed".to_string(),
            ));
        }

        let steps = WorkflowStep::find_by_execution(pool, execution.id).await?;
        let edges = WorkflowStepEdge::find_by_execution(pool, execution.id).await?;
        let has_ready_step = steps
            .iter()
            .any(|step| step.status == WorkflowStepStatus::Ready);
        let failed_steps = steps
            .iter()
            .filter(|step| step.status == WorkflowStepStatus::Failed)
            .cloned()
            .collect::<Vec<_>>();
        let has_failed_step = !failed_steps.is_empty();
        let has_promotable_pending = steps.iter().any(|step| {
            step.status == WorkflowStepStatus::Pending
                && !edges
                    .iter()
                    .filter(|edge| edge.to_step_id == step.id)
                    .any(|edge| {
                        steps
                            .iter()
                            .find(|candidate| candidate.id == edge.from_step_id)
                            .map(|candidate| candidate.status != WorkflowStepStatus::Completed)
                            .unwrap_or(true)
                    })
        });

        if execution.status == WorkflowExecutionStatus::Failed
            && !has_ready_step
            && !has_failed_step
            && !has_promotable_pending
        {
            return Err(OrchestratorError::IllegalTransition(
                "failed workflow has no recoverable steps to resume".to_string(),
            ));
        }

        let resumed = match execution.status {
            WorkflowExecutionStatus::Failed => {
                Self::transition_execution_and_sync(
                    pool,
                    chat_runner,
                    &execution,
                    WorkflowExecutionStatus::Paused,
                    "execution_resumed",
                    None,
                )
                .await?
            }
            _ => execution,
        };

        for failed_step in &failed_steps {
            Self::transition_step_and_sync(
                pool,
                chat_runner,
                &resumed,
                failed_step,
                WorkflowStepStatus::Ready,
                "execution_resumed_failed_step_recovered",
            )
            .await?;
        }

        Self::refresh_execution_projection_with_reason(
            pool,
            chat_runner,
            resumed.id,
            None,
            "execution_resumed",
            Vec::new(),
        )
        .await
    }
}
