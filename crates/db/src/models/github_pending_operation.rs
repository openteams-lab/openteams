use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

use super::github_operation_audit::GitHubTargetType;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "github_pending_operation_kind", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum GitHubPendingOperationKind {
    IssueComment,
    IssueState,
    IssueLabels,
    IssueAssignees,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(
    type_name = "github_pending_operation_status",
    rename_all = "snake_case"
)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum GitHubPendingOperationStatus {
    PendingApproval,
    Completed,
    Failed,
    Denied,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct GitHubPendingOperation {
    pub id: Uuid,
    pub project_id: Uuid,
    pub repo_integration_id: Uuid,
    pub audit_id: Uuid,
    pub operation_kind: GitHubPendingOperationKind,
    pub target_type: GitHubTargetType,
    pub target_id: Option<String>,
    pub payload_json: String,
    pub status: GitHubPendingOperationStatus,
    pub last_error: Option<String>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateGitHubPendingOperation {
    pub project_id: Uuid,
    pub repo_integration_id: Uuid,
    pub audit_id: Uuid,
    pub operation_kind: GitHubPendingOperationKind,
    pub target_type: GitHubTargetType,
    pub target_id: Option<String>,
    pub payload_json: String,
}

impl GitHubPendingOperation {
    pub async fn create(
        pool: &SqlitePool,
        input: CreateGitHubPendingOperation,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO github_pending_operations (
                id, project_id, repo_integration_id, audit_id, operation_kind,
                target_type, target_id, payload_json, status
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending_approval')
            RETURNING id, project_id, repo_integration_id, audit_id, operation_kind,
                      target_type, target_id, payload_json, status, last_error,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(input.project_id)
        .bind(input.repo_integration_id)
        .bind(input.audit_id)
        .bind(input.operation_kind)
        .bind(input.target_type)
        .bind(input.target_id)
        .bind(input.payload_json)
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_audit_id(
        pool: &SqlitePool,
        audit_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT id, project_id, repo_integration_id, audit_id, operation_kind,
                   target_type, target_id, payload_json, status, last_error,
                   created_at, updated_at
            FROM github_pending_operations
            WHERE audit_id = ?1
            "#,
        )
        .bind(audit_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn update_status(
        pool: &SqlitePool,
        id: Uuid,
        status: GitHubPendingOperationStatus,
        last_error: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE github_pending_operations
            SET status = ?2,
                last_error = ?3,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, project_id, repo_integration_id, audit_id, operation_kind,
                      target_type, target_id, payload_json, status, last_error,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(status)
        .bind(last_error)
        .fetch_one(pool)
        .await
    }
}
