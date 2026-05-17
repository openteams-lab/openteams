//! Iteration feedback + step/loop review action handlers.

use chrono::Utc;
use db::{
    DBService,
    models::{
        chat_session::ChatSession,
        chat_session_agent::ChatSessionAgent,
        workflow_agent_session::WorkflowAgentSession,
        workflow_event::{CreateWorkflowEvent, WorkflowEvent},
        workflow_execution::WorkflowExecution,
        workflow_loop::WorkflowLoop,
        workflow_plan::WorkflowPlan,
        workflow_plan_revision::WorkflowPlanRevision,
        workflow_round::WorkflowRound,
        workflow_step::WorkflowStep,
        workflow_transcript::WorkflowTranscript,
        workflow_types::*,
    },
};
use sqlx::SqlitePool;
use utils::assets::config_path;
use uuid::Uuid;

use super::{
    super::{
        chat_runner::ChatRunner,
        config::{self, UiLanguage},
        workflow_analytics,
        workflow_iteration::IterationManager,
        workflow_loop_executor::LoopExecutor,
        workflow_runtime::{SummaryPayload, WorkflowRevisionFeedbackSource, parse_summary_payload},
    },
    IterationFeedbackOutcome, OrchestratorError, ResolvedTranscriptAction, WorkflowOrchestrator,
    load_agents_for_session,
};

impl WorkflowOrchestrator {
    pub async fn handle_iteration_feedback(
        db: &DBService,
        chat_runner: &ChatRunner,
        execution_id: Uuid,
        action: &str,
        feedback: Option<super::super::workflow_iteration::UserIterationFeedbackDetail>,
    ) -> Result<IterationFeedbackOutcome, OrchestratorError> {
        let pool = &db.pool;
        let execution = WorkflowExecution::find_by_id(pool, execution_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("execution {execution_id} not found"))
            })?;
        let normalized_action = action.trim().to_ascii_lowercase();

        match normalized_action.as_str() {
            "accept" | "accepted" => {
                let execution =
                    Self::accept_iteration_result(pool, chat_runner, &execution).await?;
                Ok(IterationFeedbackOutcome {
                    execution,
                    should_wake_scheduler: false,
                })
            }
            "reject" | "rejected" => {
                let feedback = feedback.ok_or_else(|| {
                    OrchestratorError::IllegalTransition(
                        "feedback is required when rejecting an iteration result".to_string(),
                    )
                })?;
                let execution =
                    Self::reject_iteration_result(db, chat_runner, &execution, feedback).await?;
                Ok(IterationFeedbackOutcome {
                    execution,
                    should_wake_scheduler: false,
                })
            }
            _ => Err(OrchestratorError::IllegalTransition(format!(
                "unsupported iteration feedback action '{}'",
                action
            ))),
        }
    }

    async fn accept_iteration_result(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
    ) -> Result<WorkflowExecution, OrchestratorError> {
        if execution.status == WorkflowExecutionStatus::Completed {
            Self::refresh_execution_projection_with_reason(
                pool,
                chat_runner,
                execution.id,
                None,
                "iteration_accept_completed",
                Vec::new(),
            )
            .await?;
            return WorkflowExecution::find_by_id(pool, execution.id)
                .await?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("execution {} not found", execution.id))
                });
        }
        if execution.status != WorkflowExecutionStatus::Waiting {
            return Err(OrchestratorError::IllegalTransition(format!(
                "execution {} is {:?}, expected waiting",
                execution.id, execution.status
            )));
        }

        if let Some(transcript) =
            WorkflowTranscript::find_unresolved_final_review_by_execution(pool, execution.id)
                .await?
        {
            let updated_meta_json = Self::merge_transcript_meta(
                transcript.meta_json.as_deref(),
                serde_json::json!({
                    "resolved": true,
                    "resolved_action": "accepted",
                    "resolved_at": Utc::now().to_rfc3339(),
                }),
            );
            WorkflowTranscript::update_meta_json(pool, transcript.id, &updated_meta_json).await?;
        }

        if let Some(round_id) = execution.active_round_id {
            WorkflowRound::update_status(pool, round_id, WorkflowRoundStatus::Accepted).await?;
        }
        Self::emit_final_review_decision_event(
            pool,
            execution,
            WorkflowEventType::UserAccepted,
            "user_accepted",
        )
        .await?;
        workflow_analytics::track_final_review_decision(
            chat_runner.analytics_service(),
            execution.session_id,
            execution.id,
            execution.plan_id,
            true,
        );
        let completed_execution = Self::transition_execution_and_sync(
            pool,
            chat_runner,
            execution,
            WorkflowExecutionStatus::Completed,
            "iteration_accepted",
            None,
        )
        .await?;

        let workflow_agent_sessions =
            WorkflowAgentSession::find_by_execution(pool, completed_execution.id).await?;
        let session_agents =
            ChatSessionAgent::find_all_for_session(pool, completed_execution.session_id).await?;
        let agents = load_agents_for_session(pool, &session_agents).await?;
        Self::persist_completion_work_items(
            pool,
            chat_runner,
            &completed_execution,
            &WorkflowStep::find_by_execution(pool, completed_execution.id).await?,
            &workflow_agent_sessions,
            &session_agents,
            &agents,
        )
        .await?;

        Ok(completed_execution)
    }

    async fn reject_iteration_result(
        db: &DBService,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        feedback: super::super::workflow_iteration::UserIterationFeedbackDetail,
    ) -> Result<WorkflowExecution, OrchestratorError> {
        let pool = &db.pool;
        if execution.status != WorkflowExecutionStatus::Waiting {
            return Err(OrchestratorError::IllegalTransition(format!(
                "execution {} is {:?}, expected waiting",
                execution.id, execution.status
            )));
        }

        if let Some(transcript) =
            WorkflowTranscript::find_unresolved_final_review_by_execution(pool, execution.id)
                .await?
        {
            let updated_meta_json = Self::merge_transcript_meta(
                transcript.meta_json.as_deref(),
                serde_json::json!({
                    "resolved": true,
                    "resolved_action": "rejected",
                    "resolved_at": Utc::now().to_rfc3339(),
                    "input_text": feedback.what_wrong.trim(),
                    "feedback": feedback.clone(),
                }),
            );
            WorkflowTranscript::update_meta_json(pool, transcript.id, &updated_meta_json).await?;
        }

        Self::emit_final_review_decision_event(
            pool,
            execution,
            WorkflowEventType::UserRejected,
            "user_rejected",
        )
        .await?;
        workflow_analytics::track_final_review_decision(
            chat_runner.analytics_service(),
            execution.session_id,
            execution.id,
            execution.plan_id,
            false,
        );

        let recompiling_execution = Self::transition_execution_and_sync(
            pool,
            chat_runner,
            execution,
            WorkflowExecutionStatus::Recompiling,
            "iteration_recompiling",
            None,
        )
        .await?;
        let recompile_result = async {
            let plan = WorkflowPlan::find_by_id(pool, recompiling_execution.plan_id)
                .await?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!(
                        "plan {} not found",
                        recompiling_execution.plan_id
                    ))
                })?;
            let revision_id = recompiling_execution.active_revision_id.ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "execution {} missing active revision",
                    recompiling_execution.id
                ))
            })?;
            let active_revision = WorkflowPlanRevision::find_by_id(pool, revision_id)
                .await?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("revision {revision_id} not found"))
                })?;
            let round_id = recompiling_execution.active_round_id.ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "execution {} missing active round",
                    recompiling_execution.id
                ))
            })?;
            let from_round = WorkflowRound::find_by_id(pool, round_id)
                .await?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("round {round_id} not found"))
                })?;
            let session = ChatSession::find_by_id(pool, recompiling_execution.session_id)
                .await?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!(
                        "session {} not found",
                        recompiling_execution.session_id
                    ))
                })?;
            let session_agents =
                ChatSessionAgent::find_all_for_session(pool, recompiling_execution.session_id)
                    .await?;
            let agents = load_agents_for_session(pool, &session_agents).await?;
            let iteration_manager = IterationManager {
                db,
                pool,
                chat_runner,
                session: &session,
                session_agents: &session_agents,
                agents: &agents,
            };
            let user_feedback = super::super::workflow_iteration::UserIterationFeedback {
                execution_id: recompiling_execution.id.to_string(),
                round_id: from_round.id.to_string(),
                action: "reject".to_string(),
                feedback: Some(feedback),
            };
            let iteration_feedback = iteration_manager
                .collect_user_feedback(&recompiling_execution, &from_round, &user_feedback)
                .await?;
            let new_plan_json = iteration_manager
                .generate_new_plan(
                    &recompiling_execution,
                    &plan,
                    &active_revision,
                    &from_round,
                    &iteration_feedback,
                )
                .await?;
            let result = iteration_manager
                .create_new_round(
                    &recompiling_execution,
                    &plan,
                    &active_revision,
                    &from_round,
                    &iteration_feedback,
                    &new_plan_json,
                )
                .await?;

            Ok::<WorkflowExecution, OrchestratorError>(result.execution)
        }
        .await;

        match recompile_result {
            Ok(execution) => Ok(execution),
            Err(err) => {
                let error_message = err.to_string();
                tracing::error!(
                    execution_id = %recompiling_execution.id,
                    error = %error_message,
                    "workflow iteration recompilation failed; restoring execution to waiting"
                );
                if let Err(compensation_err) = Self::transition_execution_and_sync(
                    pool,
                    chat_runner,
                    &recompiling_execution,
                    WorkflowExecutionStatus::Waiting,
                    "iteration_recompile_failed",
                    Some(error_message.clone()),
                )
                .await
                {
                    tracing::error!(
                        execution_id = %recompiling_execution.id,
                        error = %compensation_err,
                        original_error = %error_message,
                        "failed to restore workflow iteration recompilation to waiting"
                    );
                }
                Err(err)
            }
        }
    }

    async fn emit_final_review_decision_event(
        pool: &SqlitePool,
        execution: &WorkflowExecution,
        event_type: WorkflowEventType,
        resolution: &str,
    ) -> Result<WorkflowEvent, OrchestratorError> {
        WorkflowEvent::create(
            pool,
            &CreateWorkflowEvent {
                execution_id: execution.id,
                round_id: execution.active_round_id,
                step_id: None,
                agent_session_id: None,
                event_type,
                status_before: Some(to_workflow_wire_value(&execution.status)),
                status_after: Some(resolution.to_string()),
                detail_json: Some(
                    serde_json::json!({
                        "resolution": resolution,
                    })
                    .to_string(),
                ),
            },
            Uuid::new_v4(),
        )
        .await
        .map_err(OrchestratorError::Database)
    }

    pub(super) async fn resolve_step_review_action(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        transcript: &WorkflowTranscript,
        execution: &WorkflowExecution,
        step: &WorkflowStep,
        workflow_session: &WorkflowAgentSession,
        resolved_action: &str,
        input_text: Option<&str>,
    ) -> Result<ResolvedTranscriptAction, OrchestratorError> {
        let existing_meta: serde_json::Value = transcript
            .meta_json
            .as_deref()
            .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        if matches!(
            existing_meta.get("resolved"),
            Some(serde_json::Value::Bool(true))
        ) {
            return Err(OrchestratorError::IllegalTransition(format!(
                "transcript {} already resolved",
                transcript.id
            )));
        }

        let feedback = input_text
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        let updated_meta_json = Self::merge_transcript_meta(
            transcript.meta_json.as_deref(),
            serde_json::json!({
                "resolved": true,
                "resolved_action": resolved_action,
                "resolved_at": Utc::now().to_rfc3339(),
                "input_text": feedback,
            }),
        );
        let updated_transcript =
            WorkflowTranscript::update_meta_json(pool, transcript.id, &updated_meta_json).await?;

        workflow_analytics::track_approval_resolved(
            chat_runner.analytics_service(),
            execution.session_id,
            execution.id,
            step.id,
            resolved_action,
        );

        match resolved_action {
            "approved" | "approve" => {
                let approved_feedback =
                    feedback.unwrap_or_else(|| "User approved the step result.".to_string());
                Self::save_step_review(
                    pool,
                    step,
                    ReviewerType::User,
                    None,
                    ReviewVerdict::Approved,
                    &approved_feedback,
                )
                .await?;
                workflow_analytics::track_step_reviewed(
                    chat_runner.analytics_service(),
                    execution.session_id,
                    execution.id,
                    step.id,
                    "approved",
                    "user",
                );
                workflow_analytics::track_review_decision_recorded(
                    chat_runner.analytics_service(),
                    execution.session_id,
                    execution.id,
                    step.id,
                    "approved",
                    "user",
                );
                Self::emit_step_domain_event(
                    pool,
                    execution,
                    step,
                    WorkflowEventType::StepUserReviewPassed,
                    Some(serde_json::json!({ "feedback": approved_feedback })),
                )
                .await?;

                let precompleted_step = Self::transition_step_and_sync(
                    pool,
                    chat_runner,
                    execution,
                    step,
                    WorkflowStepStatus::PreCompleted,
                    "step_precompleted",
                )
                .await?;
                let completed_step = Self::transition_step_and_sync(
                    pool,
                    chat_runner,
                    execution,
                    &precompleted_step,
                    WorkflowStepStatus::Completed,
                    "step_completed",
                )
                .await?;
                Self::write_transcript(
                    pool,
                    execution.id,
                    Some(completed_step.round_id),
                    Some(workflow_session.id),
                    Some(completed_step.id),
                    "user",
                    "message",
                    &approved_feedback,
                    Some(
                        &serde_json::json!({
                            "source_transcript_id": updated_transcript.id,
                            "action": resolved_action,
                        })
                        .to_string(),
                    ),
                )
                .await?;

                let refreshed_execution =
                    Self::synchronize_runtime_state(pool, execution.id, false).await?;
                Self::refresh_execution_projection(pool, chat_runner, refreshed_execution.id, None)
                    .await?;

                Ok(ResolvedTranscriptAction {
                    transcript: updated_transcript,
                    execution: refreshed_execution,
                    should_wake_scheduler: true,
                })
            }
            "rejected" | "reject" => {
                let rejected_feedback = feedback.ok_or_else(|| {
                    OrchestratorError::IllegalTransition(
                        "step review rejection requires feedback".to_string(),
                    )
                })?;
                Self::save_step_review(
                    pool,
                    step,
                    ReviewerType::User,
                    None,
                    ReviewVerdict::Rejected,
                    &rejected_feedback,
                )
                .await?;
                workflow_analytics::track_step_reviewed(
                    chat_runner.analytics_service(),
                    execution.session_id,
                    execution.id,
                    step.id,
                    "rejected",
                    "user",
                );
                workflow_analytics::track_review_decision_recorded(
                    chat_runner.analytics_service(),
                    execution.session_id,
                    execution.id,
                    step.id,
                    "rejected",
                    "user",
                );
                Self::emit_step_domain_event(
                    pool,
                    execution,
                    step,
                    WorkflowEventType::StepUserReviewRejected,
                    Some(serde_json::json!({ "feedback": rejected_feedback })),
                )
                .await?;

                let revising_step = Self::transition_step_and_sync(
                    pool,
                    chat_runner,
                    execution,
                    step,
                    WorkflowStepStatus::Revising,
                    "step_revising",
                )
                .await?;
                let previous_payload = parse_summary_payload(revising_step.summary_text.as_deref())
                    .unwrap_or(SummaryPayload {
                        summary: revising_step.title.clone(),
                        content: None,
                        outputs: Vec::new(),
                    });
                let previous_content = previous_payload
                    .content
                    .as_deref()
                    .or(revising_step.content.as_deref());
                let merged_context = Self::merge_revision_context(
                    revising_step.revision_context.as_deref(),
                    WorkflowRevisionFeedbackSource::User,
                    &rejected_feedback,
                    &previous_payload.summary,
                    previous_content,
                    &previous_payload.outputs,
                    revising_step.retry_count + 1,
                );
                let revising_step = WorkflowStep::update_revision_context(
                    pool,
                    revising_step.id,
                    Some(merged_context),
                )
                .await?;

                let retried_step = WorkflowStep::prepare_retry(pool, revising_step.id).await?;
                let ready_step = Self::transition_step_and_sync(
                    pool,
                    chat_runner,
                    execution,
                    &retried_step,
                    WorkflowStepStatus::Ready,
                    "step_resumed",
                )
                .await?;
                Self::write_transcript(
                    pool,
                    execution.id,
                    Some(ready_step.round_id),
                    Some(workflow_session.id),
                    Some(ready_step.id),
                    "user",
                    "message",
                    &rejected_feedback,
                    Some(
                        &serde_json::json!({
                            "source_transcript_id": updated_transcript.id,
                            "action": resolved_action,
                        })
                        .to_string(),
                    ),
                )
                .await?;

                let resumed_execution =
                    Self::synchronize_runtime_state(pool, execution.id, false).await?;
                Self::refresh_execution_projection(pool, chat_runner, resumed_execution.id, None)
                    .await?;

                Ok(ResolvedTranscriptAction {
                    transcript: updated_transcript,
                    execution: resumed_execution,
                    should_wake_scheduler: true,
                })
            }
            action => Err(OrchestratorError::IllegalTransition(format!(
                "unsupported action '{}' for step_review",
                action
            ))),
        }
    }

    pub(super) async fn resolve_loop_review_action(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        transcript: &WorkflowTranscript,
        execution: &WorkflowExecution,
        step: &WorkflowStep,
        workflow_session: &WorkflowAgentSession,
        resolved_action: &str,
        input_text: Option<&str>,
    ) -> Result<ResolvedTranscriptAction, OrchestratorError> {
        let existing_meta: serde_json::Value = transcript
            .meta_json
            .as_deref()
            .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        if matches!(
            existing_meta.get("resolved"),
            Some(serde_json::Value::Bool(true))
        ) {
            return Err(OrchestratorError::IllegalTransition(format!(
                "transcript {} already resolved",
                transcript.id
            )));
        }

        let loop_id = existing_meta
            .get("loop_id")
            .and_then(|value| value.as_str())
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("transcript {} missing loop_id", transcript.id))
            })?;
        let workflow_loop = WorkflowLoop::find_by_id(pool, loop_id)
            .await?
            .ok_or_else(|| OrchestratorError::NotFound(format!("loop {} not found", loop_id)))?;
        let feedback = input_text
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        let updated_meta_json = Self::merge_transcript_meta(
            transcript.meta_json.as_deref(),
            serde_json::json!({
                "resolved": true,
                "resolved_action": resolved_action,
                "resolved_at": Utc::now().to_rfc3339(),
                "input_text": feedback,
            }),
        );
        let updated_transcript =
            WorkflowTranscript::update_meta_json(pool, transcript.id, &updated_meta_json).await?;

        workflow_analytics::track_approval_resolved(
            chat_runner.analytics_service(),
            execution.session_id,
            execution.id,
            step.id,
            resolved_action,
        );

        match resolved_action {
            "approved" | "approve" => {
                let default_approved_feedback =
                    Self::localized_user_approved_loop_result_message().await;
                let approved_feedback = feedback.unwrap_or(default_approved_feedback);
                Self::save_step_review(
                    pool,
                    step,
                    ReviewerType::User,
                    None,
                    ReviewVerdict::Approved,
                    &approved_feedback,
                )
                .await?;
                workflow_analytics::track_step_reviewed(
                    chat_runner.analytics_service(),
                    execution.session_id,
                    execution.id,
                    step.id,
                    "approved",
                    "user",
                );
                workflow_analytics::track_review_decision_recorded(
                    chat_runner.analytics_service(),
                    execution.session_id,
                    execution.id,
                    step.id,
                    "approved",
                    "user",
                );

                let precompleted_step = Self::transition_step_and_sync(
                    pool,
                    chat_runner,
                    execution,
                    step,
                    WorkflowStepStatus::PreCompleted,
                    "loop_user_review_precompleted",
                )
                .await?;
                let completed_step = Self::transition_step_and_sync(
                    pool,
                    chat_runner,
                    execution,
                    &precompleted_step,
                    WorkflowStepStatus::Completed,
                    "loop_user_review_passed",
                )
                .await?;
                let completed_loop = WorkflowLoop::update_status(
                    pool,
                    workflow_loop.id,
                    WorkflowLoopStatus::Completed,
                    None,
                )
                .await?;
                LoopExecutor::emit_loop_event(
                    pool,
                    execution,
                    &completed_loop,
                    WorkflowEventType::LoopPassed,
                    Some(serde_json::json!({ "feedback": approved_feedback })),
                )
                .await?;
                Self::write_transcript(
                    pool,
                    execution.id,
                    Some(completed_step.round_id),
                    Some(workflow_session.id),
                    Some(completed_step.id),
                    "user",
                    "message",
                    &approved_feedback,
                    Some(
                        &serde_json::json!({
                            "source_transcript_id": updated_transcript.id,
                            "action": resolved_action,
                            "loop_id": completed_loop.id,
                        })
                        .to_string(),
                    ),
                )
                .await?;

                let refreshed_execution =
                    Self::synchronize_runtime_state(pool, execution.id, false).await?;
                Self::refresh_execution_projection(pool, chat_runner, refreshed_execution.id, None)
                    .await?;
                Ok(ResolvedTranscriptAction {
                    transcript: updated_transcript,
                    execution: refreshed_execution,
                    should_wake_scheduler: true,
                })
            }
            "rejected" | "reject" => {
                let rejected_feedback = feedback.ok_or_else(|| {
                    OrchestratorError::IllegalTransition(
                        "loop review rejection requires feedback".to_string(),
                    )
                })?;
                Self::save_step_review(
                    pool,
                    step,
                    ReviewerType::User,
                    None,
                    ReviewVerdict::Rejected,
                    &rejected_feedback,
                )
                .await?;
                workflow_analytics::track_step_reviewed(
                    chat_runner.analytics_service(),
                    execution.session_id,
                    execution.id,
                    step.id,
                    "rejected",
                    "user",
                );
                workflow_analytics::track_review_decision_recorded(
                    chat_runner.analytics_service(),
                    execution.session_id,
                    execution.id,
                    step.id,
                    "rejected",
                    "user",
                );

                LoopExecutor::inject_user_feedback_to_steps(
                    pool,
                    &workflow_loop,
                    &rejected_feedback,
                )
                .await?;
                let retry_loop = WorkflowLoop::increment_retry(
                    pool,
                    workflow_loop.id,
                    WorkflowLoopStatus::Running,
                    Some(rejected_feedback.clone()),
                )
                .await?;
                LoopExecutor::emit_loop_event(
                    pool,
                    execution,
                    &retry_loop,
                    WorkflowEventType::LoopRetrying,
                    Some(serde_json::json!({
                        "feedback": rejected_feedback,
                        "retry_count": retry_loop.retry_count,
                    })),
                )
                .await?;
                let resumed_execution =
                    Self::synchronize_runtime_state(pool, execution.id, false).await?;
                Self::refresh_execution_projection(pool, chat_runner, resumed_execution.id, None)
                    .await?;
                Ok(ResolvedTranscriptAction {
                    transcript: updated_transcript,
                    execution: resumed_execution,
                    should_wake_scheduler: true,
                })
            }
            action => Err(OrchestratorError::IllegalTransition(format!(
                "unsupported action '{}' for loop_review",
                action
            ))),
        }
    }

    async fn localized_user_approved_loop_result_message() -> String {
        let ui_config = config::load_config_from_file(&config_path()).await;
        Self::localized_user_approved_loop_result_message_for_language(&ui_config.language)
            .to_string()
    }

    fn localized_user_approved_loop_result_message_for_language(
        language: &UiLanguage,
    ) -> &'static str {
        match language {
            UiLanguage::Browser => sys_locale::get_locale()
                .as_deref()
                .and_then(Self::localized_user_approved_loop_result_message_for_locale)
                .unwrap_or("User approved the loop result."),
            UiLanguage::En => "User approved the loop result.",
            UiLanguage::Fr => "L'utilisateur a approuvé le résultat de la boucle.",
            UiLanguage::Ja => "ユーザーがループ結果を承認しました。",
            UiLanguage::Es => "El usuario aprobó el resultado del bucle.",
            UiLanguage::Ko => "사용자가 루프 결과를 승인했습니다.",
            UiLanguage::ZhHans => "用户已批准循环结果。",
            UiLanguage::ZhHant => "用戶已批准循環結果。",
        }
    }

    fn localized_user_approved_loop_result_message_for_locale(
        locale: &str,
    ) -> Option<&'static str> {
        let normalized = locale.trim().to_ascii_lowercase().replace('_', "-");
        if normalized.is_empty() {
            return None;
        }
        if normalized.starts_with("zh-hant")
            || normalized.starts_with("zh-tw")
            || normalized.starts_with("zh-hk")
            || normalized.starts_with("zh-mo")
        {
            return Some("用戶已批准循環結果。");
        }
        if normalized.starts_with("zh") {
            return Some("用户已批准循环结果。");
        }
        if normalized.starts_with("ja") {
            return Some("ユーザーがループ結果を承認しました。");
        }
        if normalized.starts_with("ko") {
            return Some("사용자가 루프 결과를 승인했습니다.");
        }
        if normalized.starts_with("fr") {
            return Some("L'utilisateur a approuvé le résultat de la boucle.");
        }
        if normalized.starts_with("es") {
            return Some("El usuario aprobó el resultado del bucle.");
        }
        if normalized.starts_with("en") {
            return Some("User approved the loop result.");
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use sqlx::SqlitePool;

    use super::*;

    async fn setup_workflow_events_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::query(
            r#"
            CREATE TABLE chat_workflow_events (
                id TEXT PRIMARY KEY,
                execution_id TEXT NOT NULL,
                round_id TEXT,
                step_id TEXT,
                agent_session_id TEXT,
                event_type TEXT NOT NULL,
                status_before TEXT,
                status_after TEXT,
                detail_json TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create workflow events table");
        pool
    }

    fn sample_waiting_execution(round_id: Uuid) -> WorkflowExecution {
        let now = Utc::now();
        WorkflowExecution {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            plan_id: Uuid::new_v4(),
            active_revision_id: Some(Uuid::new_v4()),
            active_round_id: Some(round_id),
            workflow_card_message_id: None,
            lead_session_agent_id: None,
            status: WorkflowExecutionStatus::Waiting,
            current_round: 1,
            title: "Review execution".to_string(),
            compiled_graph_hash: None,
            started_at: Some(now),
            completed_at: None,
            cleaned_at: None,
            cleaned_reason: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn final_review_decision_domain_events_are_persisted_with_consumable_status() {
        let pool = setup_workflow_events_pool().await;
        let round_id = Uuid::new_v4();
        let execution = sample_waiting_execution(round_id);

        let accepted = WorkflowOrchestrator::emit_final_review_decision_event(
            &pool,
            &execution,
            WorkflowEventType::UserAccepted,
            "user_accepted",
        )
        .await
        .expect("persist accepted event");
        let rejected = WorkflowOrchestrator::emit_final_review_decision_event(
            &pool,
            &execution,
            WorkflowEventType::UserRejected,
            "user_rejected",
        )
        .await
        .expect("persist rejected event");

        assert_eq!(accepted.event_type, WorkflowEventType::UserAccepted);
        assert_eq!(accepted.round_id, Some(round_id));
        assert_eq!(accepted.status_before.as_deref(), Some("waiting"));
        assert_eq!(accepted.status_after.as_deref(), Some("user_accepted"));
        assert_eq!(rejected.event_type, WorkflowEventType::UserRejected);
        assert_eq!(rejected.status_after.as_deref(), Some("user_rejected"));
        assert_eq!(
            accepted.detail_json.as_deref(),
            Some(r#"{"resolution":"user_accepted"}"#)
        );
        assert_eq!(
            rejected.detail_json.as_deref(),
            Some(r#"{"resolution":"user_rejected"}"#)
        );
    }

    #[test]
    fn user_approved_loop_result_message_is_localized_by_language() {
        assert_eq!(
            WorkflowOrchestrator::localized_user_approved_loop_result_message_for_language(
                &UiLanguage::En
            ),
            "User approved the loop result."
        );
        assert_eq!(
            WorkflowOrchestrator::localized_user_approved_loop_result_message_for_language(
                &UiLanguage::ZhHans
            ),
            "用户已批准循环结果。"
        );
        assert_eq!(
            WorkflowOrchestrator::localized_user_approved_loop_result_message_for_language(
                &UiLanguage::Ja
            ),
            "ユーザーがループ結果を承認しました。"
        );
    }

    #[test]
    fn browser_locale_maps_loop_approval_message() {
        assert_eq!(
            WorkflowOrchestrator::localized_user_approved_loop_result_message_for_locale("zh-TW"),
            Some("用戶已批准循環結果。")
        );
        assert_eq!(
            WorkflowOrchestrator::localized_user_approved_loop_result_message_for_locale("fr-FR"),
            Some("L'utilisateur a approuvé le résultat de la boucle.")
        );
        assert_eq!(
            WorkflowOrchestrator::localized_user_approved_loop_result_message_for_locale("de-DE"),
            None
        );
    }
}
