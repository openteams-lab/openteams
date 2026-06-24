use async_trait::async_trait;
use executors::{executors::ExecutorError, profile::ExecutorProfileId};
use futures::stream::BoxStream;
use json_patch::Patch;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum ContainerError {
    #[error(transparent)]
    ExecutorError(#[from] ExecutorError),
    #[error("Io error: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error("Failed to kill process: {0}")]
    KillFailed(std::io::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

/// Narrow runtime helper kept for agent slash-command discovery.
///
/// The legacy DB-backed task/workspace container execution stack has been
/// removed; chat/session/workflow execution uses the newer chat runner and
/// session worktree services.
#[async_trait]
pub trait ContainerService {
    async fn available_agent_slash_commands(
        &self,
        executor_profile_id: ExecutorProfileId,
        workspace_id: Option<Uuid>,
        repo_id: Option<Uuid>,
    ) -> Result<Option<BoxStream<'static, Patch>>, ContainerError>;

    async fn cleanup_orphan_executions(&self) -> Result<(), ContainerError> {
        Ok(())
    }

    async fn backfill_before_head_commits(&self) -> Result<(), ContainerError> {
        Ok(())
    }

    async fn backfill_repo_names(&self) -> Result<(), ContainerError> {
        Ok(())
    }

    async fn kill_all_running_processes(&self) -> Result<(), ContainerError> {
        Ok(())
    }
}
