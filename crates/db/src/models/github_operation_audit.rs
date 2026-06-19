use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "github_operation_source", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum GitHubOperationSource {
    UserUi,
    Agent,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "github_operation_result", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum GitHubOperationResult {
    PendingApproval,
    Approved,
    Denied,
    Success,
    Failed,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "github_target_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum GitHubTargetType {
    Issue,
    PullRequest,
    Repo,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct GitHubOperationAudit {
    pub id: Uuid,
    pub actor: Option<String>,
    pub operation_source: GitHubOperationSource,
    pub session_id: Option<Uuid>,
    pub workflow_execution_id: Option<Uuid>,
    pub repo_id: Option<Uuid>,
    pub target_type: GitHubTargetType,
    pub target_id: Option<String>,
    pub action: String,
    pub result: GitHubOperationResult,
    pub error: Option<String>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateGitHubOperationAudit {
    pub actor: Option<String>,
    pub operation_source: GitHubOperationSource,
    pub session_id: Option<Uuid>,
    pub workflow_execution_id: Option<Uuid>,
    pub repo_id: Option<Uuid>,
    pub target_type: GitHubTargetType,
    pub target_id: Option<String>,
    pub action: String,
    pub result: GitHubOperationResult,
    pub error: Option<String>,
}

impl GitHubOperationAudit {
    pub async fn create(
        pool: &SqlitePool,
        input: CreateGitHubOperationAudit,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO github_operation_audits (
                id, actor, operation_source, session_id, workflow_execution_id, repo_id,
                target_type, target_id, action, result, error
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            RETURNING id, actor, operation_source, session_id, workflow_execution_id, repo_id,
                      target_type, target_id, action, result, error, created_at
            "#,
        )
        .bind(id)
        .bind(input.actor)
        .bind(input.operation_source)
        .bind(input.session_id)
        .bind(input.workflow_execution_id)
        .bind(input.repo_id)
        .bind(input.target_type)
        .bind(input.target_id)
        .bind(input.action)
        .bind(input.result)
        .bind(input.error)
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_project(
        pool: &SqlitePool,
        project_id: Uuid,
        repo_id: Option<Uuid>,
        work_item_id: Option<Uuid>,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT ga.id, ga.actor, ga.operation_source, ga.session_id,
                   ga.workflow_execution_id, ga.repo_id, ga.target_type, ga.target_id,
                   ga.action, ga.result, ga.error, ga.created_at
            FROM github_operation_audits ga
            LEFT JOIN project_repos pr ON pr.repo_id = ga.repo_id
            LEFT JOIN chat_sessions cs ON cs.id = ga.session_id
            WHERE (pr.project_id = ?1 OR cs.project_id = ?1)
              AND (?2 IS NULL OR ga.repo_id = ?2)
              AND (
                    ?3 IS NULL
                    OR EXISTS (
                        SELECT 1
                        FROM project_work_item_external_links ext
                        WHERE ext.project_work_item_id = ?3
                          AND ext.provider = 'github'
                          AND (ga.repo_id IS NULL OR ext.repo_id IS NULL OR ext.repo_id = ga.repo_id)
                          AND (
                                ext.external_id = ga.target_id
                                OR CAST(ext.number AS TEXT) = ga.target_id
                          )
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM project_work_item_execution_links exec
                        WHERE exec.project_work_item_id = ?3
                          AND (
                                (exec.session_id IS NOT NULL AND exec.session_id = ga.session_id)
                                OR (exec.workflow_execution_id IS NOT NULL AND exec.workflow_execution_id = ga.workflow_execution_id)
                          )
                    )
                  )
            ORDER BY ga.created_at DESC
            "#,
        )
        .bind(project_id)
        .bind(repo_id)
        .bind(work_item_id)
        .fetch_all(pool)
        .await
    }

    pub async fn update_result(
        pool: &SqlitePool,
        id: Uuid,
        result: GitHubOperationResult,
        error: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE github_operation_audits
            SET result = ?2,
                error = ?3
            WHERE id = ?1
            RETURNING id, actor, operation_source, session_id, workflow_execution_id, repo_id,
                      target_type, target_id, action, result, error, created_at
            "#,
        )
        .bind(id)
        .bind(result)
        .bind(error)
        .fetch_one(pool)
        .await
    }
}
