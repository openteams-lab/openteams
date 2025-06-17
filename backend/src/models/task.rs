use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "task_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum TaskStatus {
    Todo,
    InProgress,
    InReview,
    Done,
    Cancelled,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Task {
    pub id: Uuid,
    pub project_id: Uuid, // Foreign key to Project
    pub title: String,
    pub description: Option<String>,
    pub status: TaskStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskWithAttemptStatus {
    pub id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub status: TaskStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub has_in_progress_attempt: bool,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateTask {
    pub project_id: Uuid,
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateTask {
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<TaskStatus>,
}

impl Task {
    pub async fn find_by_project_id(
        pool: &PgPool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            Task,
            r#"SELECT id, project_id, title, description, status as "status!: TaskStatus", created_at, updated_at 
               FROM tasks 
               WHERE project_id = $1 
               ORDER BY created_at DESC"#,
            project_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_project_id_with_attempt_status(
        pool: &PgPool,
        project_id: Uuid,
    ) -> Result<Vec<TaskWithAttemptStatus>, sqlx::Error> {
        let records = sqlx::query!(
            r#"SELECT 
                t.id, 
                t.project_id, 
                t.title, 
                t.description, 
                t.status as "status!: TaskStatus", 
                t.created_at, 
                t.updated_at,
                CASE WHEN in_progress_attempts.task_id IS NOT NULL THEN true ELSE false END as "has_in_progress_attempt!"
               FROM tasks t
               LEFT JOIN (
                   SELECT DISTINCT ta.task_id 
                   FROM task_attempts ta
                   INNER JOIN (
                       SELECT task_attempt_id, MAX(created_at) as latest_created_at
                       FROM task_attempt_activities
                       GROUP BY task_attempt_id
                   ) latest_activity ON ta.id = latest_activity.task_attempt_id
                   INNER JOIN task_attempt_activities taa ON ta.id = taa.task_attempt_id 
                       AND taa.created_at = latest_activity.latest_created_at
                   WHERE taa.status = 'inprogress'
               ) in_progress_attempts ON t.id = in_progress_attempts.task_id
               WHERE t.project_id = $1 
               ORDER BY t.created_at DESC"#,
            project_id
        )
        .fetch_all(pool)
        .await?;

        let tasks = records
            .into_iter()
            .map(|record| TaskWithAttemptStatus {
                id: record.id,
                project_id: record.project_id,
                title: record.title,
                description: record.description,
                status: record.status,
                created_at: record.created_at,
                updated_at: record.updated_at,
                has_in_progress_attempt: record.has_in_progress_attempt,
            })
            .collect();

        Ok(tasks)
    }

    pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            Task,
            r#"SELECT id, project_id, title, description, status as "status!: TaskStatus", created_at, updated_at 
               FROM tasks 
               WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_id_and_project_id(
        pool: &PgPool,
        id: Uuid,
        project_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            Task,
            r#"SELECT id, project_id, title, description, status as "status!: TaskStatus", created_at, updated_at 
               FROM tasks 
               WHERE id = $1 AND project_id = $2"#,
            id,
            project_id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn create(
        pool: &PgPool,
        data: &CreateTask,
        task_id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as!(
            Task,
            r#"INSERT INTO tasks (id, project_id, title, description, status) 
               VALUES ($1, $2, $3, $4, $5) 
               RETURNING id, project_id, title, description, status as "status!: TaskStatus", created_at, updated_at"#,
            task_id,
            data.project_id,
            data.title,
            data.description,
            TaskStatus::Todo as TaskStatus
        )
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &PgPool,
        id: Uuid,
        project_id: Uuid,
        title: String,
        description: Option<String>,
        status: TaskStatus,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as!(
            Task,
            r#"UPDATE tasks 
               SET title = $3, description = $4, status = $5 
               WHERE id = $1 AND project_id = $2 
               RETURNING id, project_id, title, description, status as "status!: TaskStatus", created_at, updated_at"#,
            id,
            project_id,
            title,
            description,
            status as TaskStatus
        )
        .fetch_one(pool)
        .await
    }

    pub async fn delete(pool: &PgPool, id: Uuid, project_id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!(
            "DELETE FROM tasks WHERE id = $1 AND project_id = $2",
            id,
            project_id
        )
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn exists(pool: &PgPool, id: Uuid, project_id: Uuid) -> Result<bool, sqlx::Error> {
        let result = sqlx::query!(
            "SELECT id FROM tasks WHERE id = $1 AND project_id = $2",
            id,
            project_id
        )
        .fetch_optional(pool)
        .await?;
        Ok(result.is_some())
    }
}
