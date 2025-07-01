use std::process::Stdio;

use async_trait::async_trait;
use command_group::{AsyncCommandGroup, AsyncGroupChild};
use tokio::{io::AsyncWriteExt, process::Command};
use uuid::Uuid;

use crate::{
    executor::{Executor, ExecutorError},
    models::task::Task,
    utils::shell::get_shell_command,
};

/// An executor that uses Gemini CLI to process tasks
pub struct GeminiExecutor;

/// An executor that resumes a Gemini session
pub struct GeminiFollowupExecutor {
    pub session_id: String,
    pub prompt: String,
}

#[async_trait]
impl Executor for GeminiExecutor {
    async fn spawn(
        &self,
        pool: &sqlx::SqlitePool,
        task_id: Uuid,
        worktree_path: &str,
    ) -> Result<AsyncGroupChild, ExecutorError> {
        // Get the task to fetch its description
        let task = Task::find_by_id(pool, task_id)
            .await?
            .ok_or(ExecutorError::TaskNotFound)?;

        let prompt = format!(
            "Task title: {}\nTask description: {}",
            task.title,
            task.description
                .as_deref()
                .unwrap_or("No description provided")
        );

        // Use shell command for cross-platform compatibility
        let (shell_cmd, shell_arg) = get_shell_command();
        let gemini_command = "npx @google/gemini-cli --yolo";

        let mut command = Command::new(shell_cmd);
        command
            .kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(worktree_path)
            .arg(shell_arg)
            .arg(gemini_command)
            .env("NODE_NO_WARNINGS", "1");

        let mut child = command
            .group_spawn() // Create new process group so we can kill entire tree
            .map_err(|e| {
                crate::executor::SpawnContext::from_command(&command, "Gemini")
                    .with_task(task_id, Some(task.title.clone()))
                    .with_context("Gemini CLI execution for new task")
                    .spawn_error(e)
            })?;

        // Send the prompt via stdin instead of command line arguments
        // This avoids Windows command line parsing issues
        if let Some(mut stdin) = child.inner().stdin.take() {
            stdin.write_all(prompt.as_bytes()).await.map_err(|e| {
                let context = crate::executor::SpawnContext::from_command(&command, "Gemini")
                    .with_task(task_id, Some(task.title.clone()))
                    .with_context("Failed to write prompt to Gemini CLI stdin");
                ExecutorError::spawn_failed(e, context)
            })?;
            stdin.shutdown().await.map_err(|e| {
                let context = crate::executor::SpawnContext::from_command(&command, "Gemini")
                    .with_task(task_id, Some(task.title.clone()))
                    .with_context("Failed to close Gemini CLI stdin");
                ExecutorError::spawn_failed(e, context)
            })?;
        }

        Ok(child)
    }
}

#[async_trait]
impl Executor for GeminiFollowupExecutor {
    async fn spawn(
        &self,
        _pool: &sqlx::SqlitePool,
        _task_id: Uuid,
        worktree_path: &str,
    ) -> Result<AsyncGroupChild, ExecutorError> {
        // --resume is currently not supported by the gemini-cli. This will error!
        // TODO: Check again when this issue has been addressed: https://github.com/google-gemini/gemini-cli/issues/2222

        // Use shell command for cross-platform compatibility
        let (shell_cmd, shell_arg) = get_shell_command();
        let gemini_command = format!("npx @google/gemini-cli --yolo --resume={}", self.session_id);

        let mut command = Command::new(shell_cmd);
        command
            .kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(worktree_path)
            .arg(shell_arg)
            .arg(&gemini_command)
            .env("NODE_NO_WARNINGS", "1");

        let mut child = command
            .group_spawn() // Create new process group so we can kill entire tree
            .map_err(|e| {
                crate::executor::SpawnContext::from_command(&command, "Gemini")
                    .with_context(format!(
                        "Gemini CLI followup execution for session {}",
                        self.session_id
                    ))
                    .spawn_error(e)
            })?;

        // Send the prompt via stdin instead of command line arguments
        // This avoids Windows command line parsing issues
        if let Some(mut stdin) = child.inner().stdin.take() {
            stdin.write_all(self.prompt.as_bytes()).await.map_err(|e| {
                let context = crate::executor::SpawnContext::from_command(&command, "Gemini")
                    .with_context(format!(
                        "Failed to write prompt to Gemini CLI stdin for session {}",
                        self.session_id
                    ));
                ExecutorError::spawn_failed(e, context)
            })?;
            stdin.shutdown().await.map_err(|e| {
                let context = crate::executor::SpawnContext::from_command(&command, "Gemini")
                    .with_context(format!(
                        "Failed to close Gemini CLI stdin for session {}",
                        self.session_id
                    ));
                ExecutorError::spawn_failed(e, context)
            })?;
        }

        Ok(child)
    }
}
