use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use ts_rs::TS;
use uuid::Uuid;

use crate::executors::{ClaudeExecutor, EchoExecutor};

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

/// Result of executing a command
#[derive(Debug)]
pub struct ExecutionResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

/// Trait for defining CLI commands that can be executed for task attempts
#[async_trait]
pub trait Executor: Send + Sync {
    /// Get the unique identifier for this executor type
    fn executor_type(&self) -> &'static str;

    /// Spawn the command for a given task attempt
    async fn spawn(
        &self,
        pool: &sqlx::PgPool,
        task_id: Uuid,
        worktree_path: &str,
    ) -> Result<Child, ExecutorError>;

    /// Execute the command and stream output to database in real-time
    async fn execute_streaming(
        &self,
        pool: &sqlx::PgPool,
        task_id: Uuid,
        attempt_id: Uuid,
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

        tokio::spawn(stream_output_to_db(stdout, pool_clone1, attempt_id, true));
        tokio::spawn(stream_output_to_db(stderr, pool_clone2, attempt_id, false));

        Ok(child)
    }

    /// Execute the command and capture output, then store in database (for backward compatibility)
    async fn execute(
        &self,
        pool: &sqlx::PgPool,
        task_id: Uuid,
        attempt_id: Uuid,
        worktree_path: &str,
    ) -> Result<ExecutionResult, ExecutorError> {
        use crate::models::task_attempt::TaskAttempt;
        use tokio::io::AsyncReadExt;

        let mut child = self.spawn(pool, task_id, worktree_path).await?;

        // Take stdout and stderr pipes
        let mut stdout = child
            .stdout
            .take()
            .unwrap_or_else(|| panic!("Failed to take stdout from child process"));
        let mut stderr = child
            .stderr
            .take()
            .unwrap_or_else(|| panic!("Failed to take stderr from child process"));

        // Read stdout and stderr concurrently
        let mut stdout_buf = String::new();
        let mut stderr_buf = String::new();

        let (stdout_result, stderr_result, exit_result) = tokio::join!(
            stdout.read_to_string(&mut stdout_buf),
            stderr.read_to_string(&mut stderr_buf),
            child.wait()
        );

        // Handle potential errors
        stdout_result.map_err(ExecutorError::SpawnFailed)?;
        stderr_result.map_err(ExecutorError::SpawnFailed)?;
        let exit_status = exit_result.map_err(ExecutorError::SpawnFailed)?;

        let result = ExecutionResult {
            stdout: stdout_buf,
            stderr: stderr_buf,
            exit_code: exit_status.code(),
        };

        // Store output in database
        TaskAttempt::update_output(pool, attempt_id, Some(&result.stdout), Some(&result.stderr))
            .await?;

        Ok(result)
    }

    /// Get a human-readable description of what this executor does
    fn description(&self) -> &'static str;
}

/// Configuration for different executor types
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "lowercase")]
#[ts(export)]
pub enum ExecutorConfig {
    Echo,
    Claude,
    // Future executors can be added here
    // Shell { command: String },
    // Docker { image: String, command: String },
}

impl ExecutorConfig {
    pub fn create_executor(&self) -> Box<dyn Executor> {
        match self {
            ExecutorConfig::Echo => Box::new(EchoExecutor),
            ExecutorConfig::Claude => Box::new(ClaudeExecutor),
        }
    }

    pub fn executor_type(&self) -> &'static str {
        match self {
            ExecutorConfig::Echo => "echo",
            ExecutorConfig::Claude => "claude",
        }
    }
}

/// Stream output from a child process to the database
async fn stream_output_to_db(
    output: impl tokio::io::AsyncRead + Unpin,
    pool: sqlx::PgPool,
    attempt_id: Uuid,
    is_stdout: bool,
) {
    use crate::models::task_attempt::TaskAttempt;

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
                    if let Err(e) = TaskAttempt::append_output(
                        &pool,
                        attempt_id,
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
        if let Err(e) = TaskAttempt::append_output(
            &pool,
            attempt_id,
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
