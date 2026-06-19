use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "github_pending_pr_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum GitHubPendingPrStatus {
    PushFailed,
    Pushed,
    CreateFailed,
    LocalLinkFailed,
    Completed,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct GitHubPendingPrCreation {
    pub id: Uuid,
    pub project_id: Uuid,
    pub repo_integration_id: Uuid,
    pub work_item_id: Option<Uuid>,
    pub audit_id: Option<Uuid>,
    pub base_branch: String,
    pub head_branch: String,
    pub title: String,
    pub body: Option<String>,
    pub status: GitHubPendingPrStatus,
    pub pull_request_number: Option<i64>,
    pub pull_request_url: Option<String>,
    pub last_error: Option<String>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateGitHubPendingPrCreation {
    pub project_id: Uuid,
    pub repo_integration_id: Uuid,
    pub work_item_id: Option<Uuid>,
    pub audit_id: Option<Uuid>,
    pub base_branch: String,
    pub head_branch: String,
    pub title: String,
    pub body: Option<String>,
    pub status: GitHubPendingPrStatus,
    pub pull_request_number: Option<i64>,
    pub pull_request_url: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpdateGitHubPendingPrCreation {
    pub audit_id: Option<Uuid>,
    pub status: GitHubPendingPrStatus,
    pub pull_request_number: Option<i64>,
    pub pull_request_url: Option<String>,
    pub last_error: Option<String>,
}

impl GitHubPendingPrCreation {
    pub async fn create(
        pool: &SqlitePool,
        input: CreateGitHubPendingPrCreation,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO github_pending_pr_creations (
                id, project_id, repo_integration_id, work_item_id, audit_id,
                base_branch, head_branch, title, body, status,
                pull_request_number, pull_request_url, last_error
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            RETURNING id, project_id, repo_integration_id, work_item_id, audit_id,
                      base_branch, head_branch, title, body, status,
                      pull_request_number, pull_request_url, last_error, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(input.project_id)
        .bind(input.repo_integration_id)
        .bind(input.work_item_id)
        .bind(input.audit_id)
        .bind(input.base_branch)
        .bind(input.head_branch)
        .bind(input.title)
        .bind(input.body)
        .bind(input.status)
        .bind(input.pull_request_number)
        .bind(input.pull_request_url)
        .bind(input.last_error)
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        input: UpdateGitHubPendingPrCreation,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE github_pending_pr_creations
            SET audit_id = COALESCE(?2, audit_id),
                status = ?3,
                pull_request_number = ?4,
                pull_request_url = ?5,
                last_error = ?6,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, project_id, repo_integration_id, work_item_id, audit_id,
                      base_branch, head_branch, title, body, status,
                      pull_request_number, pull_request_url, last_error, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(input.audit_id)
        .bind(input.status)
        .bind(input.pull_request_number)
        .bind(input.pull_request_url)
        .bind(input.last_error)
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT id, project_id, repo_integration_id, work_item_id, audit_id,
                   base_branch, head_branch, title, body, status,
                   pull_request_number, pull_request_url, last_error, created_at, updated_at
            FROM github_pending_pr_creations
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_audit_id(
        pool: &SqlitePool,
        audit_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT id, project_id, repo_integration_id, work_item_id, audit_id,
                   base_branch, head_branch, title, body, status,
                   pull_request_number, pull_request_url, last_error, created_at, updated_at
            FROM github_pending_pr_creations
            WHERE audit_id = ?1
            ORDER BY updated_at DESC
            LIMIT 1
            "#,
        )
        .bind(audit_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_retryable_by_project(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT id, project_id, repo_integration_id, work_item_id, audit_id,
                   base_branch, head_branch, title, body, status,
                   pull_request_number, pull_request_url, last_error, created_at, updated_at
            FROM github_pending_pr_creations
            WHERE project_id = ?1
              AND status IN ('push_failed', 'pushed', 'create_failed', 'local_link_failed')
            ORDER BY updated_at DESC
            "#,
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
    }
}
