use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use ts_rs::TS;
use uuid::Uuid;

use super::task_attempt::TaskAttemptStatus;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskAttemptActivity {
    pub id: Uuid,
    pub task_attempt_id: Uuid, // Foreign key to TaskAttempt
    pub status: TaskAttemptStatus,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateTaskAttemptActivity {
    pub task_attempt_id: Uuid,
    pub status: Option<TaskAttemptStatus>, // Default to Init if not provided
    pub note: Option<String>,
}

impl TaskAttemptActivity {
    pub async fn find_by_attempt_id(pool: &PgPool, attempt_id: Uuid) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            TaskAttemptActivity,
            r#"SELECT id, task_attempt_id, status as "status!: TaskAttemptStatus", note, created_at 
               FROM task_attempt_activities 
               WHERE task_attempt_id = $1 
               ORDER BY created_at DESC"#,
            attempt_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn create(pool: &PgPool, data: &CreateTaskAttemptActivity, activity_id: Uuid, status: TaskAttemptStatus) -> Result<Self, sqlx::Error> {
        let now = Utc::now();

        sqlx::query_as!(
            TaskAttemptActivity,
            r#"INSERT INTO task_attempt_activities (id, task_attempt_id, status, note, created_at) 
               VALUES ($1, $2, $3, $4, $5) 
               RETURNING id, task_attempt_id, status as "status!: TaskAttemptStatus", note, created_at"#,
            activity_id,
            data.task_attempt_id,
            status as TaskAttemptStatus,
            data.note,
            now
        )
        .fetch_one(pool)
        .await
    }

    pub async fn create_initial(pool: &PgPool, attempt_id: Uuid, activity_id: Uuid) -> Result<(), sqlx::Error> {
        let now = Utc::now();

        sqlx::query!(
            r#"INSERT INTO task_attempt_activities (id, task_attempt_id, status, note, created_at) 
               VALUES ($1, $2, $3, $4, $5)"#,
            activity_id,
            attempt_id,
            TaskAttemptStatus::Init as TaskAttemptStatus,
            Option::<String>::None,
            now
        )
        .execute(pool)
        .await?;
        Ok(())
    }
}
