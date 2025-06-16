use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Type, PgPool};
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
    pub async fn find_by_project_id(pool: &PgPool, project_id: Uuid) -> Result<Vec<Self>, sqlx::Error> {
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

    pub async fn find_by_id_and_project_id(pool: &PgPool, id: Uuid, project_id: Uuid) -> Result<Option<Self>, sqlx::Error> {
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

    pub async fn create(pool: &PgPool, data: &CreateTask, task_id: Uuid) -> Result<Self, sqlx::Error> {
        let now = Utc::now();

        sqlx::query_as!(
            Task,
            r#"INSERT INTO tasks (id, project_id, title, description, status, created_at, updated_at) 
               VALUES ($1, $2, $3, $4, $5, $6, $7) 
               RETURNING id, project_id, title, description, status as "status!: TaskStatus", created_at, updated_at"#,
            task_id,
            data.project_id,
            data.title,
            data.description,
            TaskStatus::Todo as TaskStatus,
            now,
            now
        )
        .fetch_one(pool)
        .await
    }

    pub async fn update(pool: &PgPool, id: Uuid, project_id: Uuid, title: String, description: Option<String>, status: TaskStatus) -> Result<Self, sqlx::Error> {
        let now = Utc::now();

        sqlx::query_as!(
            Task,
            r#"UPDATE tasks 
               SET title = $3, description = $4, status = $5, updated_at = $6 
               WHERE id = $1 AND project_id = $2 
               RETURNING id, project_id, title, description, status as "status!: TaskStatus", created_at, updated_at"#,
            id,
            project_id,
            title,
            description,
            status as TaskStatus,
            now
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
