use async_trait::async_trait;
use tokio::process::{Child, Command};
use uuid::Uuid;

use crate::executor::{Executor, ExecutorError};
use crate::models::task::Task;

/// An executor that uses Claude CLI to process tasks
pub struct ClaudeExecutor;

#[async_trait]
impl Executor for ClaudeExecutor {
    fn executor_type(&self) -> &'static str {
        "claude"
    }

    async fn spawn(
        &self,
        pool: &sqlx::PgPool,
        task_id: Uuid,
        worktree_path: &str,
    ) -> Result<Child, ExecutorError> {
        // Get the task to fetch its description
        let task = Task::find_by_id(pool, task_id)
            .await?
            .ok_or(ExecutorError::TaskNotFound)?;

        let prompt = format!(
            "Task title: {}
            Task description:{}",
            task.title,
            task.description
                .as_deref()
                .unwrap_or("No description provided")
        );

        // Use Claude CLI to process the task
        let child = Command::new("claude")
            .kill_on_drop(true)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .current_dir(worktree_path)
            .arg(&prompt)
            .arg("-p")
            .arg("--dangerously-skip-permissions")
            .arg("--verbose")
            .arg("--output-format=stream-json")
            .spawn()
            .map_err(ExecutorError::SpawnFailed)?;

        Ok(child)
    }

    fn description(&self) -> &'static str {
        "Executes tasks using Claude CLI for AI-powered code assistance"
    }
}
