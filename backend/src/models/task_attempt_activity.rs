use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
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
    pub async fn find_by_attempt_id(
        pool: &SqlitePool,
        attempt_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            TaskAttemptActivity,
            r#"SELECT id as "id!: Uuid", task_attempt_id as "task_attempt_id!: Uuid", status as "status!: TaskAttemptStatus", note, created_at as "created_at!: DateTime<Utc>"
               FROM task_attempt_activities 
               WHERE task_attempt_id = $1 
               ORDER BY created_at DESC"#,
            attempt_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateTaskAttemptActivity,
        activity_id: Uuid,
        status: TaskAttemptStatus,
    ) -> Result<Self, sqlx::Error> {
        let status_value = status as TaskAttemptStatus;
        sqlx::query_as!(
            TaskAttemptActivity,
            r#"INSERT INTO task_attempt_activities (id, task_attempt_id, status, note) 
               VALUES ($1, $2, $3, $4) 
               RETURNING id as "id!: Uuid", task_attempt_id as "task_attempt_id!: Uuid", status as "status!: TaskAttemptStatus", note, created_at as "created_at!: DateTime<Utc>""#,
            activity_id,
            data.task_attempt_id,
            status_value,
            data.note
        )
        .fetch_one(pool)
        .await
    }

    pub async fn create_initial(
        pool: &SqlitePool,
        attempt_id: Uuid,
        activity_id: Uuid,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"INSERT INTO task_attempt_activities (id, task_attempt_id, status, note) 
               VALUES ($1, $2, $3, $4)"#,
            activity_id,
            attempt_id,
            TaskAttemptStatus::Init as TaskAttemptStatus,
            Option::<String>::None
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn find_attempts_with_latest_init_status(
        pool: &SqlitePool,
    ) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
        let records = sqlx::query!(
            r#"SELECT DISTINCT ta.id as "id!: Uuid"
               FROM task_attempts ta
               INNER JOIN (
                   SELECT task_attempt_id, MAX(created_at) as latest_created_at
                   FROM task_attempt_activities
                   GROUP BY task_attempt_id
               ) latest_activity ON ta.id = latest_activity.task_attempt_id
               INNER JOIN task_attempt_activities taa ON ta.id = taa.task_attempt_id 
                   AND taa.created_at = latest_activity.latest_created_at
               WHERE taa.status = $1"#,
            TaskAttemptStatus::Init as TaskAttemptStatus
        )
        .fetch_all(pool)
        .await?;

        Ok(records.into_iter().map(|r| r.id).collect())
    }

    pub async fn find_attempts_with_latest_inprogress_status(
        pool: &SqlitePool,
    ) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
        let records = sqlx::query!(
            r#"SELECT DISTINCT ta.id as "id!: Uuid"
               FROM task_attempts ta
               INNER JOIN (
                   SELECT task_attempt_id, MAX(created_at) as latest_created_at
                   FROM task_attempt_activities
                   GROUP BY task_attempt_id
               ) latest_activity ON ta.id = latest_activity.task_attempt_id
               INNER JOIN task_attempt_activities taa ON ta.id = taa.task_attempt_id 
                   AND taa.created_at = latest_activity.latest_created_at
               WHERE taa.status IN ($1, $2, $3)"#,
            TaskAttemptStatus::SetupRunning as TaskAttemptStatus,
            TaskAttemptStatus::ExecutorRunning as TaskAttemptStatus,
            TaskAttemptStatus::Paused as TaskAttemptStatus
        )
        .fetch_all(pool)
        .await?;

        Ok(records.into_iter().map(|r| r.id).collect())
    }

    pub async fn find_attempts_with_latest_executor_running_status(
        pool: &SqlitePool,
    ) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
        let records = sqlx::query!(
            r#"SELECT DISTINCT ta.id as "id!: Uuid"
               FROM task_attempts ta
               INNER JOIN (
                   SELECT task_attempt_id, MAX(created_at) as latest_created_at
                   FROM task_attempt_activities
                   GROUP BY task_attempt_id
               ) latest_activity ON ta.id = latest_activity.task_attempt_id
               INNER JOIN task_attempt_activities taa ON ta.id = taa.task_attempt_id 
                   AND taa.created_at = latest_activity.latest_created_at
               WHERE taa.status = $1"#,
            TaskAttemptStatus::ExecutorRunning as TaskAttemptStatus
        )
        .fetch_all(pool)
        .await?;

        Ok(records.into_iter().map(|r| r.id).collect())
    }
}
