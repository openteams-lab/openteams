//! Workflow execution / card projection refresh.

use db::models::{
    chat_agent::ChatAgent, chat_message::ChatMessage, chat_session_agent::ChatSessionAgent,
    workflow_agent_session::WorkflowAgentSession, workflow_execution::WorkflowExecution,
    workflow_iteration_feedback::WorkflowIterationFeedback, workflow_loop::WorkflowLoop,
    workflow_plan::WorkflowPlan, workflow_plan_revision::WorkflowPlanRevision,
    workflow_round::WorkflowRound, workflow_step::WorkflowStep,
    workflow_step_review::WorkflowStepReview, workflow_transcript::WorkflowTranscript,
};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::{
    super::{
        chat_runner::ChatRunner, workflow_runtime::build_workflow_card_projection_lightweight,
    },
    OrchestratorError, WorkflowOrchestrator, load_agents_for_session,
};
use crate::services::inbox::InboxService;

impl WorkflowOrchestrator {
    pub async fn refresh_workflow_card(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        plan: &WorkflowPlan,
        revision: &WorkflowPlanRevision,
        session_agents: &[ChatSessionAgent],
        agents: &[ChatAgent],
        error_message: Option<String>,
    ) -> Result<(), OrchestratorError> {
        if matches!(
            execution.status,
            db::models::workflow_types::WorkflowExecutionStatus::Failed
        ) {
            InboxService::new()
                .notify_workflow_execution_terminal(
                    pool,
                    execution,
                    error_message.as_deref(),
                    "execution_failed",
                )
                .await;
        }

        Self::refresh_workflow_card_with_reason(
            pool,
            chat_runner,
            execution,
            plan,
            revision,
            session_agents,
            agents,
            error_message,
            "projection_refreshed",
            Vec::new(),
        )
        .await
    }

    pub(super) async fn refresh_workflow_card_with_reason(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        plan: &WorkflowPlan,
        revision: &WorkflowPlanRevision,
        session_agents: &[ChatSessionAgent],
        agents: &[ChatAgent],
        error_message: Option<String>,
        reason: &str,
        changed_step_ids: Vec<String>,
    ) -> Result<(), OrchestratorError> {
        let Some(message_id) = execution.workflow_card_message_id else {
            return Ok(());
        };

        let message = ChatMessage::find_by_id(pool, message_id)
            .await?
            .ok_or_else(|| OrchestratorError::NotFound(format!("message {} 未找到", message_id)))?;
        let workflow_sessions = WorkflowAgentSession::find_by_execution(pool, execution.id).await?;
        let revisions = WorkflowPlanRevision::find_by_plan(pool, plan.id).await?;
        let steps = WorkflowStep::find_summary_by_execution(pool, execution.id).await?;
        let rounds = WorkflowRound::find_by_execution(pool, execution.id).await?;
        let loops = WorkflowLoop::find_by_execution(pool, execution.id).await?;
        let iteration_feedbacks =
            WorkflowIterationFeedback::find_by_execution(pool, execution.id).await?;
        let step_reviews = WorkflowStepReview::find_by_execution(pool, execution.id).await?;
        let transcripts =
            WorkflowTranscript::find_unresolved_reviews_by_execution(pool, execution.id).await?;
        let transcript_count = WorkflowTranscript::count_by_execution(pool, execution.id)
            .await
            .ok();
        let stopped_by_user = Self::execution_was_stopped_by_user(pool, execution.id).await?;

        let projection = build_workflow_card_projection_lightweight(
            execution,
            plan,
            revision,
            &revisions,
            &steps,
            &[],
            &rounds,
            &loops,
            &iteration_feedbacks,
            &step_reviews,
            &transcripts,
            &workflow_sessions,
            session_agents,
            agents,
            transcript_count,
            stopped_by_user,
            error_message,
        )?;
        let mut meta = message.meta.0.clone();
        meta["card_type"] = serde_json::json!("workflow_execution");
        meta["workflow_card"] = serde_json::to_value(&projection)?;

        let updated =
            ChatMessage::update_content_and_meta(pool, message.id, "Workflow", meta).await?;
        chat_runner.emit_message_updated(updated.session_id, updated);
        chat_runner.emit_workflow_execution_updated(execution.session_id, execution.id);
        chat_runner.emit_workflow_graph_updated(
            execution.session_id,
            execution.id,
            execution.updated_at.to_rfc3339(),
            reason.to_string(),
            projection.plan.nodes.clone(),
            projection.plan.edges.clone(),
            changed_step_ids,
        );
        Ok(())
    }

    pub async fn refresh_execution_projection(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution_id: Uuid,
        error_message: Option<String>,
    ) -> Result<WorkflowExecution, OrchestratorError> {
        Self::refresh_execution_projection_with_reason(
            pool,
            chat_runner,
            execution_id,
            error_message,
            "projection_refreshed",
            Vec::new(),
        )
        .await
    }

    pub async fn refresh_execution_projection_with_reason(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution_id: Uuid,
        error_message: Option<String>,
        reason: &str,
        changed_step_ids: Vec<String>,
    ) -> Result<WorkflowExecution, OrchestratorError> {
        let execution = WorkflowExecution::find_by_id(pool, execution_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("execution {} 未找到", execution_id))
            })?;
        let ensured_final_review =
            Self::ensure_waiting_final_review_invariant(pool, &execution).await?;
        let plan = WorkflowPlan::find_by_id(pool, execution.plan_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("plan {} 未找到", execution.plan_id))
            })?;
        let revision_id = execution.active_revision_id.ok_or_else(|| {
            OrchestratorError::NotFound(format!("execution {} 缺少 active revision", execution.id))
        })?;
        let revision = WorkflowPlanRevision::find_by_id(pool, revision_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("revision {} 未找到", revision_id))
            })?;
        let session_agents =
            ChatSessionAgent::find_all_for_session(pool, execution.session_id).await?;
        let agents = load_agents_for_session(pool, &session_agents).await?;

        if let Some(transcript) = ensured_final_review.as_ref() {
            InboxService::new()
                .notify_workflow_user_action(
                    pool,
                    &execution,
                    transcript,
                    Some(&transcript.content),
                )
                .await;
        }

        if workflow_terminal_reason_should_notify(&execution, reason) {
            InboxService::new()
                .notify_workflow_execution_terminal(
                    pool,
                    &execution,
                    error_message.as_deref(),
                    reason,
                )
                .await;
        }

        Self::refresh_workflow_card_with_reason(
            pool,
            chat_runner,
            &execution,
            &plan,
            &revision,
            &session_agents,
            &agents,
            error_message,
            reason,
            changed_step_ids,
        )
        .await?;

        Ok(execution)
    }
}

fn workflow_terminal_reason_should_notify(execution: &WorkflowExecution, reason: &str) -> bool {
    match execution.status {
        db::models::workflow_types::WorkflowExecutionStatus::Completed => {
            reason.contains("completed") || reason == "iteration_accepted"
        }
        db::models::workflow_types::WorkflowExecutionStatus::Failed
        | db::models::workflow_types::WorkflowExecutionStatus::Paused => {
            workflow_failed_reason_should_notify(reason)
        }
        _ => false,
    }
}

fn workflow_failed_reason_should_notify(reason: &str) -> bool {
    reason.contains("failed") || reason == "execution_bootstrap_recovered"
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::{
        DBService,
        models::{
            chat_message::{ChatMessage, ChatSenderType, CreateChatMessage},
            chat_session::{ChatSession, CreateChatSession},
            inbox_item::{InboxItem, InboxItemListFilter},
            workflow_execution::{CreateWorkflowExecution, WorkflowExecution},
            workflow_plan::{CreateWorkflowPlan, WorkflowPlan},
            workflow_plan_revision::{CreateWorkflowPlanRevision, WorkflowPlanRevision},
            workflow_round::{CreateWorkflowRound, WorkflowRound},
            workflow_step::{CreateWorkflowStep, WorkflowStep},
            workflow_types::{
                WorkflowExecutionStatus, WorkflowRevisionEditor, WorkflowStepStatus,
                WorkflowStepType, WorkflowValidationStatus,
            },
        },
    };
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::{super::reducer, WorkflowOrchestrator, workflow_terminal_reason_should_notify};
    use crate::services::chat_runner::ChatRunner;

    fn execution_with_status(status: WorkflowExecutionStatus) -> WorkflowExecution {
        WorkflowExecution {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            plan_id: Uuid::new_v4(),
            active_revision_id: Some(Uuid::new_v4()),
            active_round_id: None,
            workflow_card_message_id: None,
            lead_session_agent_id: None,
            status,
            current_round: 1,
            title: "Workflow".to_string(),
            compiled_graph_hash: None,
            started_at: None,
            completed_at: None,
            cleaned_at: None,
            cleaned_reason: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::migrate!("../db/migrations")
            .run(&pool)
            .await
            .expect("run migrations");
        pool
    }

    fn test_plan_json() -> String {
        serde_json::json!({
            "version": "1",
            "title": "Workflow",
            "goal": "Verify notifications",
            "agents": {
                "lead": "lead",
                "available": []
            },
            "nodes": [],
            "edges": []
        })
        .to_string()
    }

    async fn create_projection_context(
        pool: &SqlitePool,
    ) -> (
        ChatRunner,
        Uuid,
        WorkflowPlan,
        WorkflowPlanRevision,
        ChatMessage,
    ) {
        let session = ChatSession::create(
            pool,
            &CreateChatSession {
                title: Some("Workflow session".to_string()),
                workspace_path: None,
                project_id: None,
                worktree_mode: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat session");
        let message = ChatMessage::create(
            pool,
            &CreateChatMessage {
                session_id: session.id,
                sender_type: ChatSenderType::System,
                sender_id: None,
                content: "Workflow".to_string(),
                mentions: Vec::new(),
                meta: serde_json::json!({}),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow card message");
        let plan_json = test_plan_json();
        let plan = WorkflowPlan::create(
            pool,
            &CreateWorkflowPlan {
                session_id: session.id,
                source_message_id: None,
                created_by_session_agent_id: None,
                title: "Workflow".to_string(),
                summary_text: Some("Verify notifications".to_string()),
                plan_json: plan_json.clone(),
                plan_schema_version: 1,
                plan_hash: "plan-hash".to_string(),
                validation_status: WorkflowValidationStatus::Valid,
                validation_errors_json: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow plan");
        let plan = WorkflowPlan::update_workflow_card_message_id(pool, plan.id, message.id)
            .await
            .expect("attach workflow card to plan");
        let revision = WorkflowPlanRevision::create(
            pool,
            &CreateWorkflowPlanRevision {
                plan_id: plan.id,
                revision_no: 1,
                edited_by: WorkflowRevisionEditor::System,
                editor_session_agent_id: None,
                reason: None,
                plan_json,
                plan_hash: "plan-hash".to_string(),
                validation_status: WorkflowValidationStatus::Valid,
                validation_errors_json: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow revision");
        let runner = ChatRunner::new(DBService { pool: pool.clone() });

        (runner, session.id, plan, revision, message)
    }

    async fn create_execution_with_card(
        pool: &SqlitePool,
        session_id: Uuid,
        plan_id: Uuid,
        revision_id: Uuid,
        card_message_id: Uuid,
    ) -> WorkflowExecution {
        let execution = WorkflowExecution::create(
            pool,
            &CreateWorkflowExecution {
                session_id,
                plan_id,
                active_revision_id: Some(revision_id),
                lead_session_agent_id: None,
                title: "Workflow".to_string(),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow execution");
        WorkflowExecution::update_workflow_card_message_id(pool, execution.id, card_message_id)
            .await
            .expect("attach workflow card to execution")
    }

    async fn list_inbox_items(pool: &SqlitePool, session_id: Uuid) -> Vec<InboxItem> {
        InboxItem::list(
            pool,
            &InboxItemListFilter {
                session_id: Some(session_id),
                ..InboxItemListFilter::default()
            },
        )
        .await
        .expect("list inbox items")
    }

    #[test]
    fn terminal_notification_reasons_include_final_review_acceptance() {
        let completed = execution_with_status(WorkflowExecutionStatus::Completed);
        assert!(workflow_terminal_reason_should_notify(
            &completed,
            "iteration_accepted"
        ));
        assert!(workflow_terminal_reason_should_notify(
            &completed,
            "execution_completed"
        ));
        assert!(!workflow_terminal_reason_should_notify(
            &completed,
            "projection_refreshed"
        ));
        assert!(!workflow_terminal_reason_should_notify(
            &completed,
            "step_status_updated"
        ));

        let failed = execution_with_status(WorkflowExecutionStatus::Failed);
        assert!(workflow_terminal_reason_should_notify(
            &failed,
            "step_retry_failed"
        ));
        assert!(!workflow_terminal_reason_should_notify(
            &failed,
            "step_status_updated"
        ));

        let paused = execution_with_status(WorkflowExecutionStatus::Paused);
        assert!(workflow_terminal_reason_should_notify(
            &paused,
            "execution_failed"
        ));

        let running = execution_with_status(WorkflowExecutionStatus::Running);
        assert!(!workflow_terminal_reason_should_notify(
            &running,
            "execution_completed"
        ));
        assert!(!workflow_terminal_reason_should_notify(
            &running,
            "step_running"
        ));
    }

    #[tokio::test]
    async fn workflow_card_refresh_notifies_bootstrap_failed_execution() {
        let pool = setup_pool().await;
        let (runner, session_id, plan, revision, message) = create_projection_context(&pool).await;
        let execution =
            create_execution_with_card(&pool, session_id, plan.id, revision.id, message.id).await;
        let failed = reducer::transition_execution_with_context(
            &pool,
            &execution,
            WorkflowExecutionStatus::Failed,
            None,
            Some("编译失败: missing node"),
        )
        .await
        .expect("mark bootstrap failed")
        .entity;
        let failed =
            WorkflowExecution::update_workflow_card_message_id(&pool, failed.id, message.id)
                .await
                .expect("reattach workflow card");

        WorkflowOrchestrator::refresh_workflow_card(
            &pool,
            &runner,
            &failed,
            &plan,
            &revision,
            &[],
            &[],
            Some("missing node".to_string()),
        )
        .await
        .expect("refresh workflow card");

        let items = list_inbox_items(&pool, session_id).await;
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, "workflow_execution_failed");
        assert_eq!(
            items[0].dedupe_key,
            format!("workflow_execution_failed:{}", failed.id)
        );
        assert!(items[0].read_at.is_none());
    }

    #[tokio::test]
    async fn execution_failed_reason_notifies_paused_failed_step_execution() {
        let pool = setup_pool().await;
        let (runner, session_id, plan, revision, message) = create_projection_context(&pool).await;
        let execution =
            create_execution_with_card(&pool, session_id, plan.id, revision.id, message.id).await;
        let round = WorkflowRound::create(
            &pool,
            &CreateWorkflowRound {
                execution_id: execution.id,
                round_index: 1,
                source_revision_id: Some(revision.id),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow round");
        let execution = WorkflowExecution::update_active_round(&pool, execution.id, round.id, 1)
            .await
            .expect("activate round");
        let step = WorkflowStep::create(
            &pool,
            &CreateWorkflowStep {
                execution_id: execution.id,
                round_id: round.id,
                compiled_revision_id: Some(revision.id),
                step_key: "step-1".to_string(),
                step_type: WorkflowStepType::Task,
                title: "Do work".to_string(),
                instructions: "Run the task".to_string(),
                assigned_workflow_agent_session_id: None,
                max_retry: 1,
                round_index: 1,
                display_order: 0,
                loop_id: None,
                lead_review_required: Some(false),
                user_review_required: Some(false),
                revision_context: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow step");
        WorkflowStep::update_status(&pool, step.id, WorkflowStepStatus::Failed)
            .await
            .expect("mark step failed");
        let execution =
            WorkflowExecution::update_status(&pool, execution.id, WorkflowExecutionStatus::Paused)
                .await
                .expect("derive paused execution");

        WorkflowOrchestrator::refresh_execution_projection_with_reason(
            &pool,
            &runner,
            execution.id,
            Some("Step failed".to_string()),
            "execution_failed",
            Vec::new(),
        )
        .await
        .expect("refresh failed execution projection");

        let items = list_inbox_items(&pool, session_id).await;
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, "workflow_execution_failed");
        assert_eq!(
            items[0].dedupe_key,
            format!("workflow_execution_failed:{}", execution.id)
        );
        assert!(items[0].read_at.is_none());
    }

    #[tokio::test]
    async fn execution_completed_reason_notifies_completed_execution_once() {
        let pool = setup_pool().await;
        let (runner, session_id, plan, revision, message) = create_projection_context(&pool).await;
        let execution =
            create_execution_with_card(&pool, session_id, plan.id, revision.id, message.id).await;
        let execution = WorkflowExecution::update_status(
            &pool,
            execution.id,
            WorkflowExecutionStatus::Completed,
        )
        .await
        .expect("complete execution");

        WorkflowOrchestrator::refresh_execution_projection_with_reason(
            &pool,
            &runner,
            execution.id,
            None,
            "execution_completed",
            Vec::new(),
        )
        .await
        .expect("refresh completed execution projection");
        WorkflowOrchestrator::refresh_execution_projection_with_reason(
            &pool,
            &runner,
            execution.id,
            None,
            "execution_completed",
            Vec::new(),
        )
        .await
        .expect("refresh completed execution projection again");

        let items = list_inbox_items(&pool, session_id).await;
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, "workflow_execution_completed");
        assert_eq!(
            items[0].dedupe_key,
            format!("workflow_execution_completed:{}", execution.id)
        );
        assert!(items[0].read_at.is_none());
    }

    #[tokio::test]
    async fn running_projection_and_step_status_updates_do_not_notify() {
        let pool = setup_pool().await;
        let (runner, session_id, plan, revision, message) = create_projection_context(&pool).await;
        let execution =
            create_execution_with_card(&pool, session_id, plan.id, revision.id, message.id).await;
        let round = WorkflowRound::create(
            &pool,
            &CreateWorkflowRound {
                execution_id: execution.id,
                round_index: 1,
                source_revision_id: Some(revision.id),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow round");
        let execution = WorkflowExecution::update_active_round(&pool, execution.id, round.id, 1)
            .await
            .expect("activate round");
        let step = WorkflowStep::create(
            &pool,
            &CreateWorkflowStep {
                execution_id: execution.id,
                round_id: round.id,
                compiled_revision_id: Some(revision.id),
                step_key: "step-1".to_string(),
                step_type: WorkflowStepType::Task,
                title: "Do work".to_string(),
                instructions: "Run the task".to_string(),
                assigned_workflow_agent_session_id: None,
                max_retry: 1,
                round_index: 1,
                display_order: 0,
                loop_id: None,
                lead_review_required: Some(false),
                user_review_required: Some(false),
                revision_context: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow step");

        for status in [
            WorkflowStepStatus::Ready,
            WorkflowStepStatus::Running,
            WorkflowStepStatus::PreCompleted,
        ] {
            WorkflowStep::update_status(&pool, step.id, status)
                .await
                .expect("update step status");
            WorkflowOrchestrator::refresh_execution_projection_with_reason(
                &pool,
                &runner,
                execution.id,
                None,
                "step_status_updated",
                vec![step.id.to_string()],
            )
            .await
            .expect("refresh running projection");
        }

        let items = list_inbox_items(&pool, session_id).await;
        assert!(items.is_empty(), "running step updates should not notify");
    }

    #[tokio::test]
    async fn waiting_projection_notifies_final_review_created_by_invariant() {
        let pool = setup_pool().await;
        let (runner, session_id, plan, revision, message) = create_projection_context(&pool).await;
        let execution =
            create_execution_with_card(&pool, session_id, plan.id, revision.id, message.id).await;
        let round = WorkflowRound::create(
            &pool,
            &CreateWorkflowRound {
                execution_id: execution.id,
                round_index: 1,
                source_revision_id: Some(revision.id),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow round");
        let execution = WorkflowExecution::update_active_round(&pool, execution.id, round.id, 1)
            .await
            .expect("activate round");
        let step = WorkflowStep::create(
            &pool,
            &CreateWorkflowStep {
                execution_id: execution.id,
                round_id: round.id,
                compiled_revision_id: Some(revision.id),
                step_key: "step-1".to_string(),
                step_type: WorkflowStepType::Task,
                title: "Do work".to_string(),
                instructions: "Run the task".to_string(),
                assigned_workflow_agent_session_id: None,
                max_retry: 1,
                round_index: 1,
                display_order: 0,
                loop_id: None,
                lead_review_required: Some(false),
                user_review_required: Some(false),
                revision_context: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow step");
        WorkflowStep::update_status(&pool, step.id, WorkflowStepStatus::Completed)
            .await
            .expect("complete step");
        let execution =
            WorkflowExecution::update_status(&pool, execution.id, WorkflowExecutionStatus::Waiting)
                .await
                .expect("derive waiting execution");

        WorkflowOrchestrator::refresh_execution_projection_with_reason(
            &pool,
            &runner,
            execution.id,
            None,
            "step_retry_completed",
            Vec::new(),
        )
        .await
        .expect("refresh waiting projection");

        let items = list_inbox_items(&pool, session_id).await;
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, "workflow_final_review");
        assert_eq!(items[0].source_type, "workflow_final_review");
        assert!(items[0].dedupe_key.starts_with("workflow_final_review:"));
        assert!(items[0].read_at.is_none());
    }
}
