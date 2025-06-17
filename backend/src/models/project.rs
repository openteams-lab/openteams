use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub git_repo_path: String,
    pub owner_id: Uuid, // Foreign key to User
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateProject {
    pub name: String,
    pub git_repo_path: String,
    pub use_existing_repo: bool,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateProject {
    pub name: Option<String>,
    pub git_repo_path: Option<String>,
}

impl Project {
    pub async fn find_all(pool: &PgPool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            Project,
            "SELECT id, name, git_repo_path, owner_id, created_at, updated_at FROM projects ORDER BY created_at DESC"
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            Project,
            "SELECT id, name, git_repo_path, owner_id, created_at, updated_at FROM projects WHERE id = $1",
            id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_git_repo_path(
        pool: &PgPool,
        git_repo_path: &str,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            Project,
            "SELECT id, name, git_repo_path, owner_id, created_at, updated_at FROM projects WHERE git_repo_path = $1",
            git_repo_path
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_git_repo_path_excluding_id(
        pool: &PgPool,
        git_repo_path: &str,
        exclude_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            Project,
            "SELECT id, name, git_repo_path, owner_id, created_at, updated_at FROM projects WHERE git_repo_path = $1 AND id != $2",
            git_repo_path,
            exclude_id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn create(
        pool: &PgPool,
        data: &CreateProject,
        owner_id: Uuid,
        project_id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as!(
            Project,
            "INSERT INTO projects (id, name, git_repo_path, owner_id) VALUES ($1, $2, $3, $4) RETURNING id, name, git_repo_path, owner_id, created_at, updated_at",
            project_id,
            data.name,
            data.git_repo_path,
            owner_id
        )
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &PgPool,
        id: Uuid,
        name: String,
        git_repo_path: String,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as!(
            Project,
            "UPDATE projects SET name = $2, git_repo_path = $3 WHERE id = $1 RETURNING id, name, git_repo_path, owner_id, created_at, updated_at",
            id,
            name,
            git_repo_path
        )
        .fetch_one(pool)
        .await
    }

    pub async fn delete(pool: &PgPool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM projects WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn exists(pool: &PgPool, id: Uuid) -> Result<bool, sqlx::Error> {
        let result = sqlx::query!("SELECT id FROM projects WHERE id = $1", id)
            .fetch_optional(pool)
            .await?;
        Ok(result.is_some())
    }
}
