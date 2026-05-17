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
            error_message,
        )?;
        let mut meta = message.meta.0.clone();
        meta["card_type"] = serde_json::json!("workflow_execution");
        meta["workflow_card"] = serde_json::to_value(&projection)?;

        let updated =
            ChatMessage::update_content_and_meta(pool, message.id, "Workflow execution", meta)
                .await?;
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
