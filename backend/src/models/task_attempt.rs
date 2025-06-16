use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Type, PgPool};
use ts_rs::TS;
use uuid::Uuid;
use git2::{Repository, Error as GitError};
use std::path::Path;

use super::task::Task;
use super::project::Project;
use crate::executor::ExecutorConfig;

#[derive(Debug)]
pub enum TaskAttemptError {
    Database(sqlx::Error),
    Git(GitError),
    TaskNotFound,
    ProjectNotFound,
}

impl std::fmt::Display for TaskAttemptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskAttemptError::Database(e) => write!(f, "Database error: {}", e),
            TaskAttemptError::Git(e) => write!(f, "Git error: {}", e),
            TaskAttemptError::TaskNotFound => write!(f, "Task not found"),
            TaskAttemptError::ProjectNotFound => write!(f, "Project not found"),
        }
    }
}

impl std::error::Error for TaskAttemptError {}

impl From<sqlx::Error> for TaskAttemptError {
    fn from(err: sqlx::Error) -> Self {
        TaskAttemptError::Database(err)
    }
}

impl From<GitError> for TaskAttemptError {
    fn from(err: GitError) -> Self {
        TaskAttemptError::Git(err)
    }
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "task_attempt_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum TaskAttemptStatus {
    Init,
    InProgress,
    Paused,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskAttempt {
    pub id: Uuid,
    pub task_id: Uuid, // Foreign key to Task
    pub worktree_path: String,
    pub base_commit: Option<String>,
    pub merge_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(skip)]
    pub executor_config: Option<serde_json::Value>, // JSON field for ExecutorConfig
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateTaskAttempt {
    pub task_id: Uuid,
    pub worktree_path: String,
    pub base_commit: Option<String>,
    pub merge_commit: Option<String>,
    pub executor_config: Option<ExecutorConfig>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateTaskAttempt {
    pub worktree_path: Option<String>,
    pub base_commit: Option<String>,
    pub merge_commit: Option<String>,
}

impl TaskAttempt {
    pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            TaskAttempt,
            r#"SELECT id, task_id, worktree_path, base_commit, merge_commit, executor_config, stdout, stderr, created_at, updated_at 
               FROM task_attempts 
               WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_task_id(pool: &PgPool, task_id: Uuid) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            TaskAttempt,
            r#"SELECT id, task_id, worktree_path, base_commit, merge_commit, executor_config, stdout, stderr, created_at, updated_at 
               FROM task_attempts 
               WHERE task_id = $1 
               ORDER BY created_at DESC"#,
            task_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn create(pool: &PgPool, data: &CreateTaskAttempt, attempt_id: Uuid) -> Result<Self, TaskAttemptError> {
        // First, get the task to get the project_id
        let task = Task::find_by_id(pool, data.task_id)
            .await?
            .ok_or(TaskAttemptError::TaskNotFound)?;

        // Then get the project using the project_id
        let project = Project::find_by_id(pool, task.project_id)
            .await?
            .ok_or(TaskAttemptError::ProjectNotFound)?;

        // Create the worktree using git2
        let repo = Repository::open(&project.git_repo_path)?;
        let worktree_path = Path::new(&data.worktree_path);
        
        // Create the worktree directory if it doesn't exist
        if let Some(parent) = worktree_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| TaskAttemptError::Git(GitError::from_str(&e.to_string())))?;
        }

        // Create the worktree at the specified path
        let branch_name = format!("attempt-{}", attempt_id);
        repo.worktree(&branch_name, worktree_path, None)?;

        // Serialize executor config to JSON
        let executor_config_json = data.executor_config.as_ref()
            .map(|config| serde_json::to_value(config))
            .transpose()
            .map_err(|e| TaskAttemptError::Database(sqlx::Error::decode(e)))?;

        // Insert the record into the database
        let task_attempt = sqlx::query_as!(
            TaskAttempt,
            r#"INSERT INTO task_attempts (id, task_id, worktree_path, base_commit, merge_commit, executor_config, stdout, stderr) 
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
               RETURNING id, task_id, worktree_path, base_commit, merge_commit, executor_config, stdout, stderr, created_at, updated_at"#,
            attempt_id,
            data.task_id,
            data.worktree_path,
            data.base_commit,
            data.merge_commit,
            executor_config_json,
            None::<String>, // stdout
            None::<String>  // stderr
        )
        .fetch_one(pool)
        .await?;

        Ok(task_attempt)
    }

    pub async fn exists_for_task(pool: &PgPool, attempt_id: Uuid, task_id: Uuid, project_id: Uuid) -> Result<bool, sqlx::Error> {
        let result = sqlx::query!(
            "SELECT ta.id FROM task_attempts ta 
             JOIN tasks t ON ta.task_id = t.id 
             WHERE ta.id = $1 AND t.id = $2 AND t.project_id = $3",
            attempt_id,
            task_id,
            project_id
        )
        .fetch_optional(pool)
        .await?;
        Ok(result.is_some())
    }
    
    /// Get the executor for this task attempt, defaulting to Echo if none is specified
    pub fn get_executor(&self) -> Box<dyn crate::executor::Executor> {
        if let Some(config_json) = &self.executor_config {
            if let Ok(config) = serde_json::from_value::<ExecutorConfig>(config_json.clone()) {
                return config.create_executor();
            }
        }
        // Default to echo executor
        ExecutorConfig::Echo.create_executor()
    }
}
