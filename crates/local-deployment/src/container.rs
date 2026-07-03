use std::{path::PathBuf, sync::Arc};

use async_trait::async_trait;
use db::{
    DBService,
    models::{
        project_path::ProjectPath,
        repo::Repo,
        workflow_agent_session::WorkflowAgentSession,
        workflow_execution::WorkflowExecution,
        workflow_step::WorkflowStep,
        workflow_types::{WorkflowAgentSessionState, WorkflowExecutionStatus, WorkflowStepStatus},
    },
};
use executors::{
    executors::StandardCodingAgentExecutor,
    profile::{ExecutorConfigs, ExecutorProfileId},
};
use futures::stream::BoxStream;
use git::GitService;
use json_patch::Patch;
use services::services::{
    analytics::AnalyticsContext,
    approvals::Approvals,
    config::Config,
    container::{ContainerError, ContainerService},
    image::ImageService,
    queued_message::QueuedMessageService,
    workflow_orchestrator::reducer,
};
use tokio::sync::RwLock;
use utils::msg_store::MsgStore;
use uuid::Uuid;

#[derive(Clone)]
pub struct LocalContainerService {
    db: DBService,
    git: GitService,
}

impl LocalContainerService {
    #[allow(clippy::too_many_arguments)]
    pub async fn new(
        db: DBService,
        _msg_stores: Arc<RwLock<std::collections::HashMap<Uuid, Arc<MsgStore>>>>,
        _config: Arc<RwLock<Config>>,
        git: GitService,
        _image: ImageService,
        _analytics_ctx: Option<AnalyticsContext>,
        _approvals: Approvals,
        _queued_message_service: QueuedMessageService,
    ) -> Self {
        Self { db, git }
    }

    async fn slash_command_workdir(
        &self,
        workspace_id: Option<Uuid>,
        repo_id: Option<Uuid>,
    ) -> Result<PathBuf, ContainerError> {
        if let Some(workspace_id) = workspace_id
            && let Some(project_path) =
                find_project_workspace_path(&self.db.pool, workspace_id).await?
        {
            return Ok(PathBuf::from(project_path.path));
        }

        if let Some(repo_id) = repo_id
            && let Some(repo) = Repo::find_by_id(&self.db.pool, repo_id).await?
        {
            return Ok(repo.path);
        }

        Ok(std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
    }
}

async fn find_project_workspace_path(
    pool: &sqlx::SqlitePool,
    path_id: Uuid,
) -> Result<Option<ProjectPath>, sqlx::Error> {
    sqlx::query_as::<_, ProjectPath>(
        r#"SELECT id,
                  project_id,
                  path,
                  label,
                  kind,
                  is_default,
                  created_at,
                  updated_at
           FROM project_paths
           WHERE id = $1 AND kind = 'workspace'"#,
    )
    .bind(path_id)
    .fetch_optional(pool)
    .await
}

#[derive(Debug, Default, PartialEq, Eq)]
struct OrphanWorkflowRecoverySummary {
    running_executions_found: usize,
    steps_recovered: usize,
    agent_sessions_recovered: usize,
    executions_paused: usize,
}

async fn recover_orphaned_workflow_executions(
    pool: &sqlx::SqlitePool,
) -> Result<OrphanWorkflowRecoverySummary, ContainerError> {
    let running_executions = WorkflowExecution::find_running(pool).await?;
    let mut summary = OrphanWorkflowRecoverySummary {
        running_executions_found: running_executions.len(),
        ..Default::default()
    };

    for execution in running_executions {
        let steps = WorkflowStep::find_by_execution(pool, execution.id).await?;
        for step in steps
            .iter()
            .filter(|step| step.status == WorkflowStepStatus::Running)
        {
            let recovered = reducer::recover_orphaned_running_step(pool, &execution, step)
                .await
                .map_err(|err| ContainerError::Other(anyhow::Error::new(err)))?;
            if recovered.is_some() {
                summary.steps_recovered += 1;
            }
        }

        let recovered_steps = WorkflowStep::find_by_execution(pool, execution.id).await?;
        let workflow_sessions = WorkflowAgentSession::find_by_execution(pool, execution.id).await?;
        for workflow_session in workflow_sessions
            .iter()
            .filter(|session| session.state != WorkflowAgentSessionState::Expired)
        {
            let assigned_statuses = recovered_steps
                .iter()
                .filter(|step| step.assigned_workflow_agent_session_id == Some(workflow_session.id))
                .map(|step| step.status.clone())
                .collect::<Vec<_>>();
            let derived_state =
                reducer::derive_agent_session_state(&workflow_session.state, &assigned_statuses);
            if derived_state != workflow_session.state {
                reducer::transition_agent_session(
                    pool,
                    &execution,
                    workflow_session,
                    derived_state,
                )
                .await
                .map_err(|err| ContainerError::Other(anyhow::Error::new(err)))?;
                summary.agent_sessions_recovered += 1;
            }
        }

        let current_execution = WorkflowExecution::find_by_id(pool, execution.id)
            .await?
            .unwrap_or(execution);
        if current_execution.status == WorkflowExecutionStatus::Running {
            reducer::transition_execution_with_context(
                pool,
                &current_execution,
                WorkflowExecutionStatus::Paused,
                current_execution.active_round_id,
                Some("Recovered persisted running workflow after startup; no scheduler task survives process restart."),
            )
            .await
            .map_err(|err| ContainerError::Other(anyhow::Error::new(err)))?;
            summary.executions_paused += 1;
        }
    }

    Ok(summary)
}

#[async_trait]
impl ContainerService for LocalContainerService {
    async fn available_agent_slash_commands(
        &self,
        executor_profile_id: ExecutorProfileId,
        workspace_id: Option<Uuid>,
        repo_id: Option<Uuid>,
    ) -> Result<Option<BoxStream<'static, Patch>>, ContainerError> {
        let agent_workdir = self.slash_command_workdir(workspace_id, repo_id).await?;

        let executor =
            ExecutorConfigs::get_cached().get_coding_agent_or_default(&executor_profile_id);
        let stream = executor.available_slash_commands(&agent_workdir).await?;
        Ok(Some(stream))
    }

    async fn cleanup_orphan_executions(&self) -> Result<(), ContainerError> {
        let summary = recover_orphaned_workflow_executions(&self.db.pool).await?;
        if summary.running_executions_found > 0 {
            tracing::info!(
                running_executions_found = summary.running_executions_found,
                steps_recovered = summary.steps_recovered,
                agent_sessions_recovered = summary.agent_sessions_recovered,
                executions_paused = summary.executions_paused,
                "Recovered orphaned workflow executions during startup"
            );
        }
        Ok(())
    }

    async fn backfill_repo_names(&self) -> Result<(), ContainerError> {
        let repos = Repo::list_needing_name_fix(&self.db.pool).await?;
        for repo in repos {
            let name = repo
                .path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&repo.id.to_string())
                .to_string();
            Repo::update_name(&self.db.pool, repo.id, &name, &name).await?;
        }
        Ok(())
    }

    async fn kill_all_running_processes(&self) -> Result<(), ContainerError> {
        let _ = &self.git;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use db::models::{
        workflow_agent_session::{CreateWorkflowAgentSession, WorkflowAgentSession},
        workflow_event::WorkflowEvent,
        workflow_execution::{CreateWorkflowExecution, WorkflowExecution},
        workflow_plan::{CreateWorkflowPlan, WorkflowPlan},
        workflow_round::{CreateWorkflowRound, WorkflowRound},
        workflow_step::{CreateWorkflowStep, WorkflowStep},
        workflow_types::{
            WorkflowAgentSessionRole, WorkflowAgentSessionState, WorkflowEventType,
            WorkflowExecutionStatus, WorkflowStepStatus, WorkflowStepType,
            WorkflowValidationStatus,
        },
    };
    use sqlx::SqlitePool;

    use super::*;

    async fn create_workflow_with_running_step(
        pool: &SqlitePool,
    ) -> (WorkflowExecution, WorkflowStep, WorkflowAgentSession) {
        let session_id = Uuid::new_v4();
        let plan_id = Uuid::new_v4();
        let plan = WorkflowPlan::create(
            pool,
            &CreateWorkflowPlan {
                session_id,
                source_message_id: None,
                created_by_session_agent_id: None,
                title: "Startup recovery plan".to_string(),
                summary_text: None,
                plan_json: "{}".to_string(),
                plan_schema_version: 1,
                plan_hash: plan_id.to_string(),
                validation_status: WorkflowValidationStatus::Valid,
                validation_errors_json: None,
            },
            plan_id,
        )
        .await
        .expect("create workflow plan");

        let execution = WorkflowExecution::create(
            pool,
            &CreateWorkflowExecution {
                session_id,
                plan_id: plan.id,
                active_revision_id: None,
                lead_session_agent_id: None,
                title: "Startup recovery execution".to_string(),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow execution");
        let execution =
            WorkflowExecution::update_status(pool, execution.id, WorkflowExecutionStatus::Running)
                .await
                .expect("mark execution running");

        let round = WorkflowRound::create(
            pool,
            &CreateWorkflowRound {
                execution_id: execution.id,
                round_index: 1,
                source_revision_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow round");

        let workflow_session = WorkflowAgentSession::create(
            pool,
            &CreateWorkflowAgentSession {
                workflow_execution_id: execution.id,
                session_agent_id: Uuid::new_v4(),
                role: WorkflowAgentSessionRole::Worker,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow agent session");
        let workflow_session = WorkflowAgentSession::update_state(
            pool,
            workflow_session.id,
            WorkflowAgentSessionState::Running,
        )
        .await
        .expect("mark workflow agent session running");

        let step = WorkflowStep::create(
            pool,
            &CreateWorkflowStep {
                execution_id: execution.id,
                round_id: round.id,
                compiled_revision_id: None,
                step_key: "task-1".to_string(),
                step_type: WorkflowStepType::Task,
                title: "Run task".to_string(),
                instructions: "Do the work".to_string(),
                assigned_workflow_agent_session_id: Some(workflow_session.id),
                max_retry: 1,
                round_index: 1,
                display_order: 1,
                loop_id: None,
                lead_review_required: None,
                user_review_required: None,
                revision_context: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow step");
        let step = WorkflowStep::update_status(pool, step.id, WorkflowStepStatus::Running)
            .await
            .expect("mark step running");
        let step = WorkflowStep::record_execution_result(
            pool,
            step.id,
            Uuid::new_v4(),
            Some("partial summary".to_string()),
            Some("partial content".to_string()),
        )
        .await
        .expect("seed partial running output");

        (execution, step, workflow_session)
    }

    #[tokio::test]
    async fn startup_cleanup_recovers_orphaned_running_workflow_steps() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::migrate!("../db/migrations")
            .run(&pool)
            .await
            .expect("run migrations");

        let (execution, step, workflow_session) = create_workflow_with_running_step(&pool).await;

        let summary = recover_orphaned_workflow_executions(&pool)
            .await
            .expect("recover orphaned workflows");

        assert_eq!(
            summary,
            OrphanWorkflowRecoverySummary {
                running_executions_found: 1,
                steps_recovered: 1,
                agent_sessions_recovered: 1,
                executions_paused: 1,
            }
        );

        let recovered_execution = WorkflowExecution::find_by_id(&pool, execution.id)
            .await
            .expect("load execution")
            .expect("execution exists");
        assert_eq!(recovered_execution.status, WorkflowExecutionStatus::Paused);

        let recovered_step = WorkflowStep::find_by_id(&pool, step.id)
            .await
            .expect("load step")
            .expect("step exists");
        assert_eq!(recovered_step.status, WorkflowStepStatus::Ready);
        assert!(recovered_step.latest_run_id.is_none());
        assert!(recovered_step.summary_text.is_none());
        assert!(recovered_step.content.is_none());
        assert!(recovered_step.started_at.is_none());
        assert!(recovered_step.completed_at.is_none());

        let recovered_workflow_session =
            WorkflowAgentSession::find_by_id(&pool, workflow_session.id)
                .await
                .expect("load workflow agent session")
                .expect("workflow agent session exists");
        assert_eq!(
            recovered_workflow_session.state,
            WorkflowAgentSessionState::Idle
        );

        let events = WorkflowEvent::find_by_execution(&pool, execution.id)
            .await
            .expect("load workflow events");
        assert!(events.iter().any(|event| {
            event.event_type == WorkflowEventType::StepStatusChanged
                && event.step_id == Some(step.id)
                && event.status_before.as_deref() == Some("running")
                && event.status_after.as_deref() == Some("ready")
                && event
                    .detail_json
                    .as_deref()
                    .is_some_and(|detail| detail.contains("startup_orphan_recovery"))
        }));
        assert!(events.iter().any(|event| {
            event.event_type == WorkflowEventType::AgentSessionStateChanged
                && event.agent_session_id == Some(workflow_session.id)
                && event.status_before.as_deref() == Some("running")
                && event.status_after.as_deref() == Some("idle")
        }));
        assert!(events.iter().any(|event| {
            event.event_type == WorkflowEventType::ExecutionPaused
                && event.status_before.as_deref() == Some("running")
                && event.status_after.as_deref() == Some("paused")
        }));
    }
}
