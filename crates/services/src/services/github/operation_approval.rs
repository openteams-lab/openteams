use anyhow::Result;
use db::models::github_operation_audit::{
    CreateGitHubOperationAudit, GitHubOperationAudit, GitHubOperationResult, GitHubOperationSource,
};
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Clone, Default)]
pub struct GitHubOperationApprovalService;

impl GitHubOperationApprovalService {
    pub fn new() -> Self {
        Self
    }

    pub async fn record_or_request_approval(
        &self,
        pool: &SqlitePool,
        mut input: CreateGitHubOperationAudit,
    ) -> Result<GitHubOperationAudit> {
        input.result = match input.operation_source {
            GitHubOperationSource::Agent => GitHubOperationResult::PendingApproval,
            GitHubOperationSource::UserUi => input.result,
        };
        Ok(GitHubOperationAudit::create(pool, input).await?)
    }

    pub fn can_execute_write(source: GitHubOperationSource) -> bool {
        matches!(source, GitHubOperationSource::UserUi)
    }

    pub async fn approve(&self, pool: &SqlitePool, audit_id: Uuid) -> Result<GitHubOperationAudit> {
        Ok(GitHubOperationAudit::update_result(
            pool,
            audit_id,
            GitHubOperationResult::Approved,
            None,
        )
        .await?)
    }

    pub async fn deny(
        &self,
        pool: &SqlitePool,
        audit_id: Uuid,
        reason: Option<String>,
    ) -> Result<GitHubOperationAudit> {
        Ok(GitHubOperationAudit::update_result(
            pool,
            audit_id,
            GitHubOperationResult::Denied,
            reason,
        )
        .await?)
    }
}

#[cfg(test)]
mod tests {
    use db::models::github_operation_audit::GitHubOperationSource;

    use super::GitHubOperationApprovalService;

    #[test]
    fn agent_write_operations_require_user_approval() {
        assert!(!GitHubOperationApprovalService::can_execute_write(
            GitHubOperationSource::Agent
        ));
        assert!(GitHubOperationApprovalService::can_execute_write(
            GitHubOperationSource::UserUi
        ));
    }
}
