use async_trait::async_trait;
use tokio::process::{Child, Command};
use uuid::Uuid;

use crate::executor::{Executor, ExecutorError};
use crate::models::project::Project;
use crate::models::task::Task;

/// Executor for running project setup scripts
pub struct SetupScriptExecutor {
    pub script: String,
}

#[async_trait]
impl Executor for SetupScriptExecutor {
    async fn spawn(
        &self,
        pool: &sqlx::SqlitePool,
        task_id: Uuid,
        worktree_path: &str,
    ) -> Result<Child, ExecutorError> {
        // Validate the task and project exist
        let task = Task::find_by_id(pool, task_id)
            .await?
            .ok_or(ExecutorError::TaskNotFound)?;

        let _project = Project::find_by_id(pool, task.project_id)
            .await?
            .ok_or(ExecutorError::TaskNotFound)?; // Reuse TaskNotFound for simplicity

        let child = Command::new("bash")
            .kill_on_drop(true)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .arg("-c")
            .arg(&self.script)
            .current_dir(worktree_path)
            .spawn()
            .map_err(ExecutorError::SpawnFailed)?;

        Ok(child)
    }
}
