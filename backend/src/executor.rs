use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use ts_rs::TS;
use uuid::Uuid;

use crate::executors::{AmpExecutor, ClaudeExecutor, EchoExecutor};

#[derive(Debug)]
pub enum ExecutorError {
    SpawnFailed(std::io::Error),
    TaskNotFound,
    DatabaseError(sqlx::Error),
}

impl std::fmt::Display for ExecutorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExecutorError::SpawnFailed(e) => write!(f, "Failed to spawn process: {}", e),
            ExecutorError::TaskNotFound => write!(f, "Task not found"),
            ExecutorError::DatabaseError(e) => write!(f, "Database error: {}", e),
        }
    }
}

impl std::error::Error for ExecutorError {}

impl From<sqlx::Error> for ExecutorError {
    fn from(err: sqlx::Error) -> Self {
        ExecutorError::DatabaseError(err)
    }
}

/// Trait for defining CLI commands that can be executed for task attempts
#[async_trait]
pub trait Executor: Send + Sync {
    /// Spawn the command for a given task attempt
    async fn spawn(
        &self,
        pool: &sqlx::SqlitePool,
        task_id: Uuid,
        worktree_path: &str,
    ) -> Result<Child, ExecutorError>;

    /// Execute the command and stream output to database in real-time
    async fn execute_streaming(
        &self,
        pool: &sqlx::SqlitePool,
        task_id: Uuid,
        attempt_id: Uuid,
        execution_process_id: Uuid,
        worktree_path: &str,
    ) -> Result<Child, ExecutorError> {
        let mut child = self.spawn(pool, task_id, worktree_path).await?;

        // Take stdout and stderr pipes for streaming
        let stdout = child
            .stdout
            .take()
            .expect("Failed to take stdout from child process");
        let stderr = child
            .stderr
            .take()
            .expect("Failed to take stderr from child process");

        // Start streaming tasks
        let pool_clone1 = pool.clone();
        let pool_clone2 = pool.clone();

        tokio::spawn(stream_output_to_db(
            stdout,
            pool_clone1,
            attempt_id,
            execution_process_id,
            true,
        ));
        tokio::spawn(stream_output_to_db(
            stderr,
            pool_clone2,
            attempt_id,
            execution_process_id,
            false,
        ));

        Ok(child)
    }
}

/// Configuration for different executor types
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "lowercase")]
#[ts(export)]
pub enum ExecutorConfig {
    Echo,
    Claude,
    Amp,
    // Future executors can be added here
    // Shell { command: String },
    // Docker { image: String, command: String },
}

impl ExecutorConfig {
    pub fn create_executor(&self) -> Box<dyn Executor> {
        match self {
            ExecutorConfig::Echo => Box::new(EchoExecutor),
            ExecutorConfig::Claude => Box::new(ClaudeExecutor),
            ExecutorConfig::Amp => Box::new(AmpExecutor),
        }
    }
}

/// Stream output from a child process to the database
async fn stream_output_to_db(
    output: impl tokio::io::AsyncRead + Unpin,
    pool: sqlx::SqlitePool,
    attempt_id: Uuid,
    execution_process_id: Uuid,
    is_stdout: bool,
) {
    use crate::models::execution_process::ExecutionProcess;

    let mut reader = BufReader::new(output);
    let mut line = String::new();
    let mut accumulated_output = String::new();
    let mut update_counter = 0;

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break, // EOF
            Ok(_) => {
                accumulated_output.push_str(&line);
                update_counter += 1;

                // Update database every 1 lines or when we have a significant amount of data
                if update_counter >= 1 || accumulated_output.len() > 1024 {
                    if let Err(e) = ExecutionProcess::append_output(
                        &pool,
                        execution_process_id,
                        if is_stdout {
                            Some(&accumulated_output)
                        } else {
                            None
                        },
                        if !is_stdout {
                            Some(&accumulated_output)
                        } else {
                            None
                        },
                    )
                    .await
                    {
                        tracing::error!(
                            "Failed to update {} for attempt {}: {}",
                            if is_stdout { "stdout" } else { "stderr" },
                            attempt_id,
                            e
                        );
                    }
                    accumulated_output.clear();
                    update_counter = 0;
                }
            }
            Err(e) => {
                tracing::error!(
                    "Error reading {} for attempt {}: {}",
                    if is_stdout { "stdout" } else { "stderr" },
                    attempt_id,
                    e
                );
                break;
            }
        }
    }

    // Flush any remaining output
    if !accumulated_output.is_empty() {
        if let Err(e) = ExecutionProcess::append_output(
            &pool,
            execution_process_id,
            if is_stdout {
                Some(&accumulated_output)
            } else {
                None
            },
            if !is_stdout {
                Some(&accumulated_output)
            } else {
                None
            },
        )
        .await
        {
            tracing::error!(
                "Failed to flush {} for attempt {}: {}",
                if is_stdout { "stdout" } else { "stderr" },
                attempt_id,
                e
            );
        }
    }
}
