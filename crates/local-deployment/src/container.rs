use std::{path::PathBuf, sync::Arc};

use async_trait::async_trait;
use db::{
    DBService,
    models::{project_path::ProjectPath, repo::Repo},
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
