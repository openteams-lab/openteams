//! Plan / card creation, plan execution, pause / interrupt control.

use std::collections::{HashMap, HashSet};

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
        workflow_analytics,
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

        workflow_analytics::track_plan_generated(
            chat_runner.analytics_service(),
            session.id,
            Some(plan.id),
            true,
        );

        let message = chat::create_message(
            pool,
            session.id,
            ChatSenderType::System,
            None,
            "Workflow".to_string(),
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

        workflow_analytics::track_plan_generated(
            chat_runner.analytics_service(),
            session.id,
            Some(plan.id),
            true,
        );

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
                let (lead_review_required, user_review_required) = if step_type_str == "review" {
                    (false, false)
                } else {
                    (true, true)
                };
                WorkflowCardStep {
                    id: n.id.clone(),
                    step_key: n.id.clone(),
                    title: n.data.title.clone(),
                    step_type: step_type_str,
                    status: "pending".to_string(),
                    review_phase: None,
                    lead_review_required,
                    user_review_required,
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
            pending_reviews: Vec::new(),
            pending_input: None,
            iteration_history: Vec::new(),
            round_graphs: Vec::new(),
            plan: parsed_plan,
            started_at: None,
            completed_at: None,
            validation_errors: None,
            is_terminal: false,
            has_transcripts: None,
        };

        let card_meta = serde_json::json!({
            "card_type": "workflow_plan",
            "workflow_plan_id": plan.id,
            "active_revision_id": revision.id,
            "display_state": "preview_ready",
            "workflow_card": serde_json::to_value(&preview)?,
        });

        // Reuse the current draft/active workflow card, but keep completed
        // workflow cards immutable so a session can show multiple plans over time.
        let existing_card_id = if let Some(message_id) = preferred_card_message_id {
            Some(message_id)
        } else {
            Self::find_session_workflow_card_message_id(pool, session.id).await
        };
        let replaces_existing_plan =
            Self::should_track_plan_revision_created_for_card(pool, session.id, existing_card_id)
                .await?;
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
        if replaces_existing_plan {
            workflow_analytics::track_plan_revision_created(
                chat_runner.analytics_service(),
                session.id,
                plan.id,
            );
        }

        Ok((plan, revision, message))
    }

    fn workflow_card_meta_has_existing_plan_reference(meta: &serde_json::Value) -> bool {
        fn value_has_uuid(value: Option<&serde_json::Value>) -> bool {
            value
                .and_then(serde_json::Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .is_some()
        }

        let generation_meta = meta.get("workflow_plan_generation");
        let workflow_card = meta.get("workflow_card");

        value_has_uuid(generation_meta.and_then(|value| value.get("previous_plan_id")))
            || value_has_uuid(generation_meta.and_then(|value| value.get("previous_revision_id")))
            || value_has_uuid(meta.get("workflow_plan_id"))
            || value_has_uuid(meta.get("active_revision_id"))
            || value_has_uuid(workflow_card.and_then(|value| value.get("plan_id")))
            || value_has_uuid(workflow_card.and_then(|value| value.get("revision_id")))
    }

    async fn should_track_plan_revision_created_for_card(
        pool: &SqlitePool,
        session_id: Uuid,
        existing_card_id: Option<Uuid>,
    ) -> Result<bool, OrchestratorError> {
        let Some(existing_id) = existing_card_id else {
            return Ok(false);
        };
        let existing_message = ChatMessage::find_by_id(pool, existing_id).await?;
        Ok(existing_message.is_some_and(|message| {
            message.session_id == session_id
                && Self::workflow_card_meta_has_existing_plan_reference(&message.meta.0)
        }))
    }

    /// Find the reusable workflow card message in this session by looking at
    /// plans that already have a `workflow_card_message_id`.
    ///
    /// A preview plan without execution can be replaced during regeneration, and
    /// an active execution keeps its card. Terminal executions are skipped so a
    /// completed workflow remains visible when the session creates a later plan.
    pub async fn find_session_workflow_card_message_id(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Option<Uuid> {
        let plans = WorkflowPlan::find_by_session(pool, session_id)
            .await
            .unwrap_or_default();
        let executions = WorkflowExecution::find_by_session(pool, session_id)
            .await
            .unwrap_or_default();
        let terminal_card_message_ids = executions
            .iter()
            .filter(|execution| {
                matches!(
                    execution.status,
                    WorkflowExecutionStatus::Completed | WorkflowExecutionStatus::Failed
                )
            })
            .filter_map(|execution| execution.workflow_card_message_id)
            .collect::<HashSet<_>>();

        for plan in &plans {
            let Some(card_msg_id) = plan.workflow_card_message_id else {
                continue;
            };
            if terminal_card_message_ids.contains(&card_msg_id) {
                continue;
            }
            let plan_executions = executions
                .iter()
                .filter(|execution| execution.plan_id == plan.id)
                .collect::<Vec<_>>();

            if plan_executions.is_empty()
                || plan_executions.iter().any(|execution| {
                    matches!(
                        execution.status,
                        WorkflowExecutionStatus::Pending
                            | WorkflowExecutionStatus::Running
                            | WorkflowExecutionStatus::Waiting
                            | WorkflowExecutionStatus::Paused
                            | WorkflowExecutionStatus::Recompiling
                    )
                })
            {
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
        let mut recovered_incomplete_execution_ids = HashSet::new();
        for existing in &active_executions {
            tracing::debug!(
                "checking existing execution {} with plan_id {:?} new plan_id {}",
                existing.id,
                existing.plan_id,
                plan_id
            );

            if existing.plan_id == plan_id {
                let steps = WorkflowStep::find_by_execution(pool, existing.id).await?;
                if existing.active_round_id.is_none() || steps.is_empty() {
                    tracing::warn!(
                        execution_id = %existing.id,
                        plan_id = %plan_id,
                        active_round_id = ?existing.active_round_id,
                        step_count = steps.len(),
                        "found incomplete workflow execution during idempotent execute_plan; marking failed and bootstrapping a new execution"
                    );
                    let _ = Self::transition_execution_and_sync(
                        pool,
                        chat_runner,
                        existing,
                        WorkflowExecutionStatus::Failed,
                        "execution_bootstrap_recovered",
                        Some(
                            "Previous execution bootstrap did not materialize workflow steps; retrying plan execution."
                                .to_string(),
                        ),
                    )
                    .await?;
                    recovered_incomplete_execution_ids.insert(existing.id);
                    continue;
                }

                tracing::info!(
                    "found existing active execution {} for plan {}, returning existing execution",
                    existing.id,
                    plan_id
                );

                let mut existing_execution = existing.clone();
                if existing_execution.workflow_card_message_id.is_none()
                    && let Some(card_msg_id) = plan.workflow_card_message_id
                {
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
                            ChatSessionAgent::find_all_for_session(pool, plan.session_id).await?;
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

                let edges = WorkflowStepEdge::find_by_execution(pool, existing.id).await?;
                let agent_sessions =
                    WorkflowAgentSession::find_by_execution(pool, existing.id).await?;
                let round = existing.active_round_id.and(None::<WorkflowRound>);
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
        if active_executions
            .iter()
            .any(|execution| !recovered_incomplete_execution_ids.contains(&execution.id))
        {
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

        workflow_analytics::track_plan_executed(
            chat_runner.analytics_service(),
            plan.session_id,
            plan.id,
            bootstrap.execution.id,
        );

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
                if step.status == WorkflowStepStatus::Running {
                    cancel_running_step(step.id);
                }
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

        workflow_analytics::track_runner_interrupted(
            chat_runner.analytics_service(),
            execution.session_id,
            execution.id,
            step_id,
            "user",
        );

        Ok(interrupted_step)
    }
}

#[cfg(test)]
mod tests {
    use db::models::workflow_execution::CreateWorkflowExecution;
    use sqlx::SqlitePool;

    use super::*;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::query(
            r#"
            CREATE TABLE chat_workflow_plans (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                source_message_id TEXT,
                created_by_session_agent_id TEXT,
                status TEXT NOT NULL DEFAULT 'draft',
                title TEXT NOT NULL,
                summary_text TEXT,
                plan_json TEXT NOT NULL,
                plan_schema_version INTEGER NOT NULL,
                plan_hash TEXT NOT NULL,
                validation_status TEXT NOT NULL,
                validation_errors_json TEXT,
                workflow_card_message_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create plans table");
        sqlx::query(
            r#"
            CREATE TABLE chat_workflow_executions (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                plan_id TEXT NOT NULL,
                active_revision_id TEXT,
                active_round_id TEXT,
                workflow_card_message_id TEXT,
                lead_session_agent_id TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                current_round INTEGER NOT NULL DEFAULT 0,
                title TEXT NOT NULL,
                compiled_graph_hash TEXT,
                started_at TEXT,
                completed_at TEXT,
                cleaned_at TEXT,
                cleaned_reason TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create executions table");
        sqlx::query(
            r#"
            CREATE TABLE chat_messages (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                sender_type TEXT NOT NULL CHECK (sender_type IN ('user','agent','system')),
                sender_id BLOB,
                content TEXT NOT NULL,
                mentions TEXT NOT NULL DEFAULT '[]',
                meta TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create chat messages table");
        pool
    }

    async fn create_ready_plan(
        pool: &SqlitePool,
        session_id: Uuid,
        card_message_id: Uuid,
        title: &str,
    ) -> WorkflowPlan {
        let plan = WorkflowPlan::create(
            pool,
            &CreateWorkflowPlan {
                session_id,
                source_message_id: None,
                created_by_session_agent_id: None,
                title: title.to_string(),
                summary_text: None,
                plan_json: "{}".to_string(),
                plan_schema_version: 1,
                plan_hash: Uuid::new_v4().to_string(),
                validation_status: WorkflowValidationStatus::Valid,
                validation_errors_json: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create plan");
        let plan = WorkflowPlan::update_status(pool, plan.id, WorkflowPlanStatus::Ready)
            .await
            .expect("mark plan ready");
        WorkflowPlan::update_workflow_card_message_id(pool, plan.id, card_message_id)
            .await
            .expect("attach card message")
    }

    async fn create_execution_with_card(
        pool: &SqlitePool,
        session_id: Uuid,
        plan_id: Uuid,
        card_message_id: Uuid,
        status: WorkflowExecutionStatus,
    ) -> WorkflowExecution {
        let execution = WorkflowExecution::create(
            pool,
            &CreateWorkflowExecution {
                session_id,
                plan_id,
                active_revision_id: None,
                lead_session_agent_id: None,
                title: "Execution".to_string(),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create execution");
        let execution =
            WorkflowExecution::update_workflow_card_message_id(pool, execution.id, card_message_id)
                .await
                .expect("attach execution card");
        let execution = WorkflowExecution::update_status(pool, execution.id, status.clone())
            .await
            .expect("update execution status");
        if matches!(
            status,
            WorkflowExecutionStatus::Completed | WorkflowExecutionStatus::Failed
        ) {
            WorkflowExecution::set_completed(pool, execution.id)
                .await
                .expect("set completed at")
        } else {
            execution
        }
    }

    async fn create_workflow_card_message(
        pool: &SqlitePool,
        session_id: Uuid,
        meta: serde_json::Value,
    ) -> ChatMessage {
        ChatMessage::create(
            pool,
            &db::models::chat_message::CreateChatMessage {
                session_id,
                sender_type: ChatSenderType::System,
                sender_id: None,
                content: "Workflow Plan".to_string(),
                mentions: Vec::new(),
                meta,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow card message")
    }

    #[tokio::test]
    async fn reusable_workflow_card_returns_preview_card() {
        let pool = setup_pool().await;

        let session_id = Uuid::new_v4();
        let card_message_id = Uuid::new_v4();
        create_ready_plan(&pool, session_id, card_message_id, "Preview").await;

        let found =
            WorkflowOrchestrator::find_session_workflow_card_message_id(&pool, session_id).await;

        assert_eq!(found, Some(card_message_id));
    }

    #[tokio::test]
    async fn reusable_workflow_card_skips_completed_execution_card() {
        let pool = setup_pool().await;

        let session_id = Uuid::new_v4();
        let card_message_id = Uuid::new_v4();
        create_ready_plan(&pool, session_id, card_message_id, "Old preview").await;
        let completed_plan =
            create_ready_plan(&pool, session_id, card_message_id, "Completed").await;
        create_execution_with_card(
            &pool,
            session_id,
            completed_plan.id,
            card_message_id,
            WorkflowExecutionStatus::Completed,
        )
        .await;

        let found =
            WorkflowOrchestrator::find_session_workflow_card_message_id(&pool, session_id).await;

        assert_eq!(found, None);
    }

    #[tokio::test]
    async fn reusable_workflow_card_returns_active_execution_card() {
        let pool = setup_pool().await;

        let session_id = Uuid::new_v4();
        let card_message_id = Uuid::new_v4();
        let plan = create_ready_plan(&pool, session_id, card_message_id, "Active").await;
        create_execution_with_card(
            &pool,
            session_id,
            plan.id,
            card_message_id,
            WorkflowExecutionStatus::Running,
        )
        .await;

        let found =
            WorkflowOrchestrator::find_session_workflow_card_message_id(&pool, session_id).await;

        assert_eq!(found, Some(card_message_id));
    }

    #[test]
    fn first_plan_generation_placeholder_does_not_trigger_plan_revision_created() {
        let meta = serde_json::json!({
            "card_type": "workflow_plan_generation",
            "display_state": "pending",
            "workflow_card": {
                "plan_id": "",
                "revision_id": "",
                "execution_id": null
            },
            "workflow_plan_generation": {
                "status": "pending",
                "plan_goal": "first plan"
            }
        });

        assert!(!WorkflowOrchestrator::workflow_card_meta_has_existing_plan_reference(&meta));
    }

    #[test]
    fn replacement_plan_generation_placeholder_triggers_plan_revision_created() {
        let previous_plan_id = Uuid::new_v4();
        let previous_revision_id = Uuid::new_v4();
        let meta = serde_json::json!({
            "card_type": "workflow_plan_generation",
            "display_state": "pending",
            "workflow_card": {
                "plan_id": "",
                "revision_id": "",
                "execution_id": null
            },
            "workflow_plan_generation": {
                "status": "pending",
                "plan_goal": "replace plan",
                "previous_plan_id": previous_plan_id,
                "previous_revision_id": previous_revision_id
            }
        });

        assert!(WorkflowOrchestrator::workflow_card_meta_has_existing_plan_reference(&meta));
    }

    #[test]
    fn existing_plan_card_triggers_plan_revision_created() {
        let plan_id = Uuid::new_v4();
        let revision_id = Uuid::new_v4();
        let meta = serde_json::json!({
            "card_type": "workflow_plan",
            "workflow_plan_id": plan_id,
            "active_revision_id": revision_id,
            "workflow_card": {
                "plan_id": plan_id.to_string(),
                "revision_id": revision_id.to_string()
            }
        });

        assert!(WorkflowOrchestrator::workflow_card_meta_has_existing_plan_reference(&meta));
    }

    #[tokio::test]
    async fn real_first_generation_card_path_does_not_track_plan_revision_created() {
        let pool = setup_pool().await;
        let session_id = Uuid::new_v4();
        let message = create_workflow_card_message(
            &pool,
            session_id,
            serde_json::json!({
                "card_type": "workflow_plan_generation",
                "display_state": "pending",
                "workflow_card": {
                    "plan_id": "",
                    "revision_id": "",
                    "execution_id": null
                },
                "workflow_plan_generation": {
                    "status": "pending",
                    "plan_goal": "first plan"
                }
            }),
        )
        .await;

        let should_track = WorkflowOrchestrator::should_track_plan_revision_created_for_card(
            &pool,
            session_id,
            Some(message.id),
        )
        .await
        .expect("evaluate first generation trigger");

        assert!(!should_track);
    }

    #[tokio::test]
    async fn real_replacement_card_path_tracks_plan_revision_created() {
        let pool = setup_pool().await;
        let session_id = Uuid::new_v4();
        let previous_plan_id = Uuid::new_v4();
        let previous_revision_id = Uuid::new_v4();
        let message = create_workflow_card_message(
            &pool,
            session_id,
            serde_json::json!({
                "card_type": "workflow_plan_generation",
                "display_state": "pending",
                "workflow_card": {
                    "plan_id": "",
                    "revision_id": "",
                    "execution_id": null
                },
                "workflow_plan_generation": {
                    "status": "pending",
                    "plan_goal": "replace plan",
                    "previous_plan_id": previous_plan_id,
                    "previous_revision_id": previous_revision_id
                }
            }),
        )
        .await;

        let should_track = WorkflowOrchestrator::should_track_plan_revision_created_for_card(
            &pool,
            session_id,
            Some(message.id),
        )
        .await
        .expect("evaluate replacement trigger");

        assert!(should_track);
    }
}
