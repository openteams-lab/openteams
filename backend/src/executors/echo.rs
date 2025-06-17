use async_trait::async_trait;
use tokio::process::{Child, Command};
use uuid::Uuid;

use crate::executor::{Executor, ExecutorError};
use crate::models::task::Task;

/// A dummy executor that echoes the task title and description
pub struct EchoExecutor;

#[async_trait]
impl Executor for EchoExecutor {
    fn executor_type(&self) -> &'static str {
        "echo"
    }

    async fn spawn(
        &self,
        pool: &sqlx::SqlitePool,
        task_id: Uuid,
        _worktree_path: &str,
    ) -> Result<Child, ExecutorError> {
        // Get the task to fetch its description
        let task = Task::find_by_id(pool, task_id)
            .await?
            .ok_or(ExecutorError::TaskNotFound)?;

        let message = format!(
            "Executing task: {} - {}",
            task.title,
            task.description.as_deref().unwrap_or("No description")
        );

        // For demonstration of streaming, we can use a shell command that outputs multiple lines
        let script = format!(
            r#"echo "Starting task: {}"
for i in {{1..50}}; do
    echo "Progress line $i"
    sleep 1
done
echo "Task completed: {}""#,
            task.title, task.title
        );

        let child = Command::new("sh")
            .kill_on_drop(true)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .arg("-c")
            .arg(&script)
            .spawn()
            .map_err(ExecutorError::SpawnFailed)?;

        Ok(child)
    }

    fn description(&self) -> &'static str {
        "Demonstrates streaming output with a multi-line shell script"
    }
}
