use async_trait::async_trait;
use tokio::process::{Child, Command};
use uuid::Uuid;

use crate::executor::{Executor, ExecutorError};
use crate::models::task::Task;

/// An executor that uses Claude CLI to process tasks
pub struct AmpExecutor;

#[async_trait]
impl Executor for AmpExecutor {
    fn executor_type(&self) -> &'static str {
        "amp"
    }

    async fn spawn(
        &self,
        pool: &sqlx::SqlitePool,
        task_id: Uuid,
        worktree_path: &str,
    ) -> Result<Child, ExecutorError> {
        // Get the task to fetch its description
        let task = Task::find_by_id(pool, task_id)
            .await?
            .ok_or(ExecutorError::TaskNotFound)?;

        use std::process::Stdio;
        use tokio::{io::AsyncWriteExt, process::Command};

        let prompt = format!(
            "Task title: {}\nTask description: {}",
            task.title,
            task.description
                .as_deref()
                .unwrap_or("No description provided")
        );

        let mut child = Command::new("npx")
            .kill_on_drop(true)
            .stdin(Stdio::piped()) // <-- open a pipe
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(worktree_path)
            .arg("@sourcegraph/amp")
            .arg("--format=jsonl")
            .spawn()
            .map_err(ExecutorError::SpawnFailed)?;

        // feed the prompt in, then close the pipe so `amp` sees EOF
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(prompt.as_bytes()).await.unwrap();
            stdin.shutdown().await.unwrap(); // or `drop(stdin);`
        }

        Ok(child)
    }

    fn description(&self) -> &'static str {
        "Executes tasks using Claude CLI for AI-powered code assistance"
    }
}
