use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Type, PgPool};
use ts_rs::TS;
use uuid::Uuid;

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
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateTaskAttempt {
    pub worktree_path: Option<String>,
    pub base_commit: Option<String>,
    pub merge_commit: Option<String>,
}

impl TaskAttempt {
    pub async fn find_by_task_id(pool: &PgPool, task_id: Uuid) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            TaskAttempt,
            r#"SELECT id, task_id, worktree_path, base_commit, merge_commit, created_at, updated_at 
               FROM task_attempts 
               WHERE task_id = $1 
               ORDER BY created_at DESC"#,
            task_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn create(pool: &PgPool, data: &CreateTaskAttempt, attempt_id: Uuid) -> Result<Self, sqlx::Error> {
        let now = Utc::now();

        sqlx::query_as!(
            TaskAttempt,
            r#"INSERT INTO task_attempts (id, task_id, worktree_path, base_commit, merge_commit, created_at, updated_at) 
               VALUES ($1, $2, $3, $4, $5, $6, $7) 
               RETURNING id, task_id, worktree_path, base_commit, merge_commit, created_at, updated_at"#,
            attempt_id,
            data.task_id,
            data.worktree_path,
            data.base_commit,
            data.merge_commit,
            now,
            now
        )
        .fetch_one(pool)
        .await
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
}
