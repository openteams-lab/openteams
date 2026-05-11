//! Plan / card creation, plan execution, pause / interrupt control.

use std::collections::HashMap;

use db::models::{
    chat_message::{ChatMessage, ChatSenderType},
    chat_session::ChatSession,
    chat_session_agent::ChatSessionAgent,
    workflow_agent_session::WorkflowAgentSession,
    workflow_event::WorkflowEvent,
    workflow_execution::WorkflowExecution,
    workflow_plan::{CreateWorkflowPlan, WorkflowPlan},
    workflow_plan_revision::{CreateWorkflowPlanRevision, WorkflowPlanRevision},
    workflow_round::WorkflowRound,
    workflow_step::WorkflowStep,
    workflow_step_edge::WorkflowStepEdge,
    workflow_types::*,
};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::{
    super::{
        chat,
        chat_runner::ChatRunner,
        workflow_compiler::WorkflowCompiler,
        workflow_runtime::{
            WorkflowCardAgent, WorkflowCardProjection, WorkflowCardState, WorkflowCardStep,
            WorkflowRuntimeError, cancel_running_step,
        },
    },
    BootstrapResult, OrchestratorError, WorkflowOrchestrator, load_agents_for_session,
};

impl WorkflowOrchestrator {
    pub async fn create_workflow_plan_and_card(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        session: &ChatSession,
        source_message_id: Option<Uuid>,
        lead_session_agent: &ChatSessionAgent,
        plan_json: &str,
    ) -> Result<(WorkflowPlan, WorkflowPlanRevision, ChatMessage), OrchestratorError> {
        let parsed_plan: WorkflowPlanJson = serde_json::from_str(plan_json)?;
        let plan_hash = WorkflowCompiler::compute_hash(&parsed_plan);
        let plan_schema_version = parsed_plan
            .plan_schema_version()
            .map_err(|err| OrchestratorError::Runtime(WorkflowRuntimeError::Validation(err)))?;
        let plan = WorkflowPlan::create(
            pool,
            &CreateWorkflowPlan {
                session_id: session.id,
                source_message_id,
                created_by_session_agent_id: Some(lead_session_agent.id),
                title: parsed_plan.title.clone(),
                summary_text: Some(parsed_plan.goal.clone()),
                plan_json: plan_json.to_string(),
                plan_schema_version,
                plan_hash: plan_hash.clone(),
                validation_status: WorkflowValidationStatus::Valid,
                validation_errors_json: None,
            },
            Uuid::new_v4(),
        )
        .await?;
        let plan = WorkflowPlan::update_status(pool, plan.id, WorkflowPlanStatus::Ready).await?;
        let revision = WorkflowPlanRevision::create(
            pool,
            &CreateWorkflowPlanRevision {
                plan_id: plan.id,
                revision_no: 1,
                edited_by: WorkflowRevisionEditor::Lead,
                editor_session_agent_id: Some(lead_session_agent.id),
                reason: Some("generate-plan-and-run".to_string()),
                plan_json: plan_json.to_string(),
                plan_hash,
                validation_status: WorkflowValidationStatus::Valid,
                validation_errors_json: None,
            },
            Uuid::new_v4(),
        )
        .await?;
        let message = chat::create_message(
            pool,
            session.id,
            ChatSenderType::System,
            None,
            "Workflow execution".to_string(),
            Some(serde_json::json!({
                "card_type": "workflow_execution"
            })),
        )
        .await?;
        chat_runner.emit_message_new(message.session_id, message.clone());
        Ok((plan, revision, message))
    }

    /// Create a plan in `ready` state and a preview card (no execution created).
    /// Used by the `workflow_generate` -> plan_generation pipeline.
    pub async fn create_workflow_plan_preview_card(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        session: &ChatSession,
        source_message_id: Option<Uuid>,
        lead_session_agent: &ChatSessionAgent,
        plan_json: &str,
        preferred_card_message_id: Option<Uuid>,
    ) -> Result<(WorkflowPlan, WorkflowPlanRevision, ChatMessage), OrchestratorError> {
        let mut parsed_plan: WorkflowPlanJson = serde_json::from_str(plan_json)?;
        let plan_hash = WorkflowCompiler::compute_hash(&parsed_plan);
        let plan_schema_version = parsed_plan
            .plan_schema_version()
            .map_err(|err| OrchestratorError::Runtime(WorkflowRuntimeError::Validation(err)))?;
        let plan = WorkflowPlan::create(
            pool,
            &CreateWorkflowPlan {
                session_id: session.id,
                source_message_id,
                created_by_session_agent_id: Some(lead_session_agent.id),
                title: parsed_plan.title.clone(),
                summary_text: Some(parsed_plan.goal.clone()),
                plan_json: plan_json.to_string(),
                plan_schema_version,
                plan_hash: plan_hash.clone(),
                validation_status: WorkflowValidationStatus::Valid,
                validation_errors_json: None,
            },
            Uuid::new_v4(),
        )
        .await?;
        let plan = WorkflowPlan::update_status(pool, plan.id, WorkflowPlanStatus::Ready).await?;
        let revision = WorkflowPlanRevision::create(
            pool,
            &CreateWorkflowPlanRevision {
                plan_id: plan.id,
                revision_no: 1,
                edited_by: WorkflowRevisionEditor::Lead,
                editor_session_agent_id: Some(lead_session_agent.id),
                reason: Some("workflow_generate".to_string()),
                plan_json: plan_json.to_string(),
                plan_hash,
                validation_status: WorkflowValidationStatus::Valid,
                validation_errors_json: None,
            },
            Uuid::new_v4(),
        )
        .await?;

        // Build preview projection
        let session_agents = ChatSessionAgent::find_all_for_session(pool, session.id).await?;
        let agents = load_agents_for_session(pool, &session_agents).await?;
        let agent_views: Vec<WorkflowCardAgent> = session_agents
            .iter()
            .filter_map(|sa| {
                let agent = agents.iter().find(|a| a.id == sa.agent_id)?;
                Some(WorkflowCardAgent {
                    session_agent_id: sa.id.to_string(),
                    workflow_agent_session_id: None,
                    agent_id: agent.id.to_string(),
                    name: agent.name.clone(),
                })
            })
            .collect();
        let agent_name_by_id: HashMap<String, String> = agent_views
            .iter()
            .map(|agent| (agent.agent_id.clone(), agent.name.clone()))
            .collect();
        let valid_agent_ids = agents
            .iter()
            .map(|agent| agent.id.to_string())
            .collect::<Vec<_>>();
        let compiled_preview = WorkflowCompiler::compile_from_json(plan_json, &valid_agent_ids)?;
        let loop_key_by_step_key = compiled_preview
            .steps
            .iter()
            .filter_map(|step| {
                step.loop_key
                    .clone()
                    .map(|loop_key| (step.step_key.clone(), loop_key))
            })
            .collect::<HashMap<_, _>>();
        for node in &mut parsed_plan.nodes {
            if let Some(loop_key) = loop_key_by_step_key.get(&node.id) {
                node.data.loop_key = Some(loop_key.clone());
            }
        }

        let step_views: Vec<WorkflowCardStep> = parsed_plan
            .nodes
            .iter()
            .map(|n| {
                let step_type_str = if n.data.step_type.is_empty() {
                    "task".to_string()
                } else {
                    n.data.step_type.to_lowercase()
                };
                WorkflowCardStep {
                    id: n.id.clone(),
                    step_key: n.id.clone(),
                    title: n.data.title.clone(),
                    step_type: step_type_str,
                    status: "pending".to_string(),
                    review_phase: None,
                    retry_count: 0,
                    max_retry: n.data.max_retry.unwrap_or(1) as i32,
                    loop_key: loop_key_by_step_key
                        .get(&n.id)
                        .cloned()
                        .or_else(|| n.data.loop_key.clone()),
                    latest_review: None,
                    agent_name: n
                        .data
                        .agent_id
                        .as_ref()
                        .and_then(|agent_id| agent_name_by_id.get(agent_id).cloned())
                        .or_else(|| n.data.agent_id.clone()),
                    summary_text: None,
                    content: None,
                }
            })
            .collect();

        let preview = WorkflowCardProjection {
            execution_id: None,
            plan_id: plan.id.to_string(),
            revision_id: revision.id.to_string(),
            title: plan.title.clone(),
            goal: plan
                .summary_text
                .clone()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| plan.title.clone()),
            state: WorkflowCardState::PreviewReady,
            execution_status: "preview".to_string(),
            error_message: None,
            completed_step_count: 0,
            total_step_count: parsed_plan.nodes.len(),
            result_summary: None,
            outputs: Vec::new(),
            agents: agent_views,
            steps: step_views,
            current_round: 0,
            loops: Vec::new(),
            pending_review: None,
            iteration_history: Vec::new(),
            plan: parsed_plan,
            started_at: None,
            completed_at: None,
            validation_errors: None,
        };

        let card_meta = serde_json::json!({
            "card_type": "workflow_plan",
            "workflow_plan_id": plan.id,
            "active_revision_id": revision.id,
            "display_state": "preview_ready",
            "workflow_card": serde_json::to_value(&preview)?,
        });

        // Single-card contract: reuse existing workflow card if present
        let existing_card_id = if let Some(message_id) = preferred_card_message_id {
            Some(message_id)
        } else {
            Self::find_session_workflow_card_message_id(pool, session.id).await
        };
        let message = if let Some(existing_id) = existing_card_id {
            let updated = ChatMessage::update_content_and_meta(
                pool,
                existing_id,
                "Workflow Plan",
                card_meta.clone(),
            )
            .await?;
            chat_runner.emit_message_updated(updated.session_id, updated.clone());
            updated
        } else {
            let msg = chat::create_message(
                pool,
                session.id,
                ChatSenderType::System,
                None,
                "Workflow Plan".to_string(),
                Some(card_meta),
            )
            .await?;
            chat_runner.emit_message_new(msg.session_id, msg.clone());
            msg
        };

        // Update plan with the card message id for later reference (e.g. execute_plan)
        let plan = WorkflowPlan::update_workflow_card_message_id(pool, plan.id, message.id).await?;

        Ok((plan, revision, message))
    }

    /// Find the existing workflow card message in this session by looking at
    /// plans that already have a `workflow_card_message_id`.
    pub async fn find_session_workflow_card_message_id(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Option<Uuid> {
        let plans = WorkflowPlan::find_by_session(pool, session_id)
            .await
            .unwrap_or_default();
        for plan in &plans {
            if let Some(card_msg_id) = plan.workflow_card_message_id {
                return Some(card_msg_id);
            }
        }
        None
    }

    /// Execute a plan that is in `ready` status.
    /// Idempotent: if an active execution already exists for this plan, returns it.
    pub async fn execute_plan(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        plan_id: Uuid,
    ) -> Result<BootstrapResult, OrchestratorError> {
        let plan = WorkflowPlan::find_by_id(pool, plan_id)
            .await?
            .ok_or_else(|| OrchestratorError::NotFound(format!("plan {} 未找到", plan_id)))?;

        if plan.status != WorkflowPlanStatus::Ready {
            return Err(OrchestratorError::IllegalTransition(format!(
                "plan {} status is {:?}, expected Ready",
                plan_id, plan.status
            )));
        }

        // Idempotent check: if active execution exists for this plan, return early
        let active_executions =
            WorkflowExecution::find_non_terminal_by_session(pool, plan.session_id).await?;
        for existing in &active_executions {
            tracing::debug!(
                "checking existing execution {} with plan_id {:?} new plan_id {}",
                existing.id,
                existing.plan_id,
                plan_id
            );

            if existing.plan_id == plan_id {
                tracing::info!(
                    "found existing active execution {} for plan {}, returning existing execution",
                    existing.id,
                    plan_id
                );

                let mut existing_execution = existing.clone();
                if existing_execution.workflow_card_message_id.is_none() {
                    if let Some(card_msg_id) = plan.workflow_card_message_id {
                        existing_execution = WorkflowExecution::update_workflow_card_message_id(
                            pool,
                            existing_execution.id,
                            card_msg_id,
                        )
                        .await?;

                        if let Some(revision_id) = existing_execution.active_revision_id
                            && let Some(revision) =
                                WorkflowPlanRevision::find_by_id(pool, revision_id).await?
                        {
                            let session_agents =
                                ChatSessionAgent::find_all_for_session(pool, plan.session_id)
                                    .await?;
                            let agents = load_agents_for_session(pool, &session_agents).await?;
                            Self::refresh_workflow_card(
                                pool,
                                chat_runner,
                                &existing_execution,
                                &plan,
                                &revision,
                                &session_agents,
                                &agents,
                                None,
                            )
                            .await?;
                        }
                    }
                }

                let steps = WorkflowStep::find_by_execution(pool, existing.id).await?;
                let edges = WorkflowStepEdge::find_by_execution(pool, existing.id).await?;
                let agent_sessions =
                    WorkflowAgentSession::find_by_execution(pool, existing.id).await?;
                let round = existing.active_round_id.and_then(|_| None::<WorkflowRound>);
                let events = WorkflowEvent::find_by_execution(pool, existing.id).await?;
                return Ok(BootstrapResult {
                    execution: existing_execution,
                    round,
                    steps,
                    edges,
                    agent_sessions,
                    events,
                    failed: false,
                    failure_reason: None,
                });
            }
        }
        if !active_executions.is_empty() {
            return Err(OrchestratorError::IllegalTransition(
                "another workflow execution is already active in this session".to_string(),
            ));
        }

        let revision = WorkflowPlanRevision::find_latest_by_plan(pool, plan_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("plan {} 缺少 revision", plan_id))
            })?;

        let session = ChatSession::find_by_id(pool, plan.session_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("session {} 未找到", plan.session_id))
            })?;
        let session_agents = ChatSessionAgent::find_all_for_session(pool, session.id).await?;
        let agents = load_agents_for_session(pool, &session_agents).await?;

        let lead_session_agent_id = plan
            .created_by_session_agent_id
            .or_else(|| session_agents.first().map(|sa| sa.id));

        let valid_agent_ids: Vec<String> = agents.iter().map(|a| a.id.to_string()).collect();
        let agent_id_map: HashMap<String, Uuid> = session_agents
            .iter()
            .map(|sa| (sa.agent_id.to_string(), sa.id))
            .collect();

        let bootstrap = Self::bootstrap_execution(
            pool,
            &plan,
            &revision,
            lead_session_agent_id,
            &valid_agent_ids,
            &agent_id_map,
        )
        .await?;

        if let Some(card_msg_id) = plan.workflow_card_message_id {
            let execution = WorkflowExecution::update_workflow_card_message_id(
                pool,
                bootstrap.execution.id,
                card_msg_id,
            )
            .await?;

            Self::refresh_workflow_card(
                pool,
                chat_runner,
                &execution,
                &plan,
                &revision,
                &session_agents,
                &agents,
                bootstrap.failure_reason.clone(),
            )
            .await?;
        }

        Ok(bootstrap)
    }

    /// Pause all running steps in the execution.
    pub async fn pause_all(
        chat_runner: &ChatRunner,
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<WorkflowExecution, OrchestratorError> {
        let execution = WorkflowExecution::find_by_id(pool, execution_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("execution {} 未找到", execution_id))
            })?;

        if !matches!(
            execution.status,
            WorkflowExecutionStatus::Running | WorkflowExecutionStatus::Paused
        ) {
            return Err(OrchestratorError::IllegalTransition(format!(
                "cannot pause: execution is {:?}, expected running or paused",
                execution.status
            )));
        }

        let steps = WorkflowStep::find_by_execution(pool, execution.id).await?;
        for step in &steps {
            if matches!(
                step.status,
                WorkflowStepStatus::Running
                    | WorkflowStepStatus::WaitingReview
                    | WorkflowStepStatus::WaitingInput
            ) {
                cancel_running_step(step.id);
                let interrupt_requested = Self::transition_step_and_sync(
                    pool,
                    chat_runner,
                    &execution,
                    step,
                    WorkflowStepStatus::InterruptRequested,
                    "step_interrupt_requested",
                )
                .await?;
                let _ = Self::transition_step_and_sync(
                    pool,
                    chat_runner,
                    &execution,
                    &interrupt_requested,
                    WorkflowStepStatus::Interrupted,
                    "step_interrupted",
                )
                .await?;
            }
        }

        let execution = Self::synchronize_runtime_state(pool, execution.id, false).await?;

        let execution = if execution.status != WorkflowExecutionStatus::Paused {
            Self::transition_execution_and_sync(
                pool,
                chat_runner,
                &execution,
                WorkflowExecutionStatus::Paused,
                "execution_paused",
                None,
            )
            .await?
        } else {
            execution
        };

        Self::refresh_execution_projection_with_reason(
            pool,
            chat_runner,
            execution.id,
            None,
            "execution_paused",
            Vec::new(),
        )
        .await
    }

    /// Interrupt a specific step.
    pub async fn interrupt_step(
        chat_runner: &ChatRunner,
        pool: &SqlitePool,
        execution_id: Uuid,
        step_id: Uuid,
    ) -> Result<WorkflowStep, OrchestratorError> {
        let execution = WorkflowExecution::find_by_id(pool, execution_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("execution {} 未找到", execution_id))
            })?;

        let step = WorkflowStep::find_by_id(pool, step_id)
            .await?
            .ok_or_else(|| OrchestratorError::NotFound(format!("step {} 未找到", step_id)))?;

        if !matches!(
            step.status,
            WorkflowStepStatus::Running
                | WorkflowStepStatus::WaitingReview
                | WorkflowStepStatus::WaitingInput
        ) {
            return Err(OrchestratorError::IllegalTransition(format!(
                "cannot interrupt: step is {:?}",
                step.status
            )));
        }

        cancel_running_step(step_id);

        let interrupt_requested = Self::transition_step_and_sync(
            pool,
            chat_runner,
            &execution,
            &step,
            WorkflowStepStatus::InterruptRequested,
            "step_interrupt_requested",
        )
        .await?;

        let interrupted_step = Self::transition_step_and_sync(
            pool,
            chat_runner,
            &execution,
            &interrupt_requested,
            WorkflowStepStatus::Interrupted,
            "step_interrupted",
        )
        .await?;

        let _ = Self::synchronize_runtime_state(pool, execution_id, false).await?;

        Ok(interrupted_step)
    }
}
