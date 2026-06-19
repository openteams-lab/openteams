use anyhow::Result;
use db::models::github_operation_audit::{
    CreateGitHubOperationAudit, GitHubOperationAudit, GitHubOperationResult,
};
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Clone, Default)]
pub struct GitHubAuditService;

impl GitHubAuditService {
    pub fn new() -> Self {
        Self
    }

    pub async fn record(
        &self,
        pool: &SqlitePool,
        input: CreateGitHubOperationAudit,
    ) -> Result<GitHubOperationAudit> {
        Ok(GitHubOperationAudit::create(pool, input).await?)
    }

    pub async fn list_by_project(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        repo_id: Option<Uuid>,
        work_item_id: Option<Uuid>,
    ) -> Result<Vec<GitHubOperationAudit>> {
        Ok(GitHubOperationAudit::find_by_project(pool, project_id, repo_id, work_item_id).await?)
    }

    pub async fn update_result(
        &self,
        pool: &SqlitePool,
        audit_id: Uuid,
        result: GitHubOperationResult,
        error: Option<String>,
    ) -> Result<GitHubOperationAudit> {
        Ok(GitHubOperationAudit::update_result(pool, audit_id, result, error).await?)
    }
}
