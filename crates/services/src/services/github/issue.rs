use anyhow::{Result, anyhow};
use db::models::{
    github_operation_audit::{
        CreateGitHubOperationAudit, GitHubOperationResult, GitHubOperationSource, GitHubTargetType,
    },
    github_pending_operation::{
        CreateGitHubPendingOperation, GitHubPendingOperation, GitHubPendingOperationKind,
    },
    project_work_item_external_link::{ProjectExternalType, ProjectWorkItemExternalLink},
    repo_integration::RepoIntegration,
};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::{
    audit::GitHubAuditService,
    operation_approval::GitHubOperationApprovalService,
    rest_client::{GitHubIssueDetail, GitHubIssueSummary, GitHubRestClient},
};
use crate::services::repo_integration::RepoIntegrationService;

#[derive(Clone, Default)]
pub struct GitHubIssueService;

impl GitHubIssueService {
    pub fn new() -> Self {
        Self
    }

    pub async fn list_or_search(
        &self,
        pool: &SqlitePool,
        client: &GitHubRestClient,
        repo_integration_id: Uuid,
        query: Option<String>,
    ) -> Result<Vec<GitHubIssueSummary>> {
        let integration = RepoIntegrationService::new()
            .ensure_connected(pool, repo_integration_id)
            .await?;
        let (owner, repo) = owner_repo(&integration)?;
        match client.list_issues(&owner, &repo, query.as_deref()).await {
            Ok(issues) => {
                let mut refreshed = Vec::with_capacity(issues.len());
                for issue in issues {
                    refreshed.push(
                        self.update_cached_issue(pool, integration.repo_id, issue)
                            .await?,
                    );
                }
                Ok(refreshed)
            }
            Err(err) => {
                ProjectWorkItemExternalLink::mark_repo_external_type_stale(
                    pool,
                    "github",
                    integration.repo_id,
                    ProjectExternalType::GithubIssue,
                    true,
                )
                .await?;
                let cached = self.cached_issues(pool, integration.repo_id).await?;
                if cached.is_empty() {
                    Err(err.into())
                } else {
                    Ok(cached)
                }
            }
        }
    }

    pub async fn detail(
        &self,
        pool: &SqlitePool,
        client: &GitHubRestClient,
        repo_integration_id: Uuid,
        number: i64,
    ) -> Result<GitHubIssueDetail> {
        let integration = RepoIntegrationService::new()
            .ensure_connected(pool, repo_integration_id)
            .await?;
        let (owner, repo) = owner_repo(&integration)?;
        match client.issue(&owner, &repo, number).await {
            Ok(mut detail) => {
                detail.summary = self
                    .update_cached_issue(pool, integration.repo_id, detail.summary)
                    .await?;
                self.cache_issue_detail(pool, integration.repo_id, &detail)
                    .await?;
                Ok(detail)
            }
            Err(err) => {
                let cached = ProjectWorkItemExternalLink::find_by_external(
                    pool,
                    "github",
                    Some(integration.repo_id),
                    ProjectExternalType::GithubIssue,
                    &number.to_string(),
                )
                .await?;
                if let Some(link) = cached {
                    let link =
                        ProjectWorkItemExternalLink::mark_stale(pool, link.id, true, None, None)
                            .await?;
                    let summary = GitHubIssueSummary {
                        number,
                        node_id: link.external_id,
                        title: cached_issue_title(link.metadata_json.as_deref(), number),
                        state: link.state.unwrap_or_else(|| "unknown".to_string()),
                        url: link.url.unwrap_or_default(),
                        author: None,
                        author_avatar_url: None,
                        labels: Vec::new(),
                        assignees: Vec::new(),
                        created_at: link.created_at,
                        updated_at: chrono::Utc::now(),
                        last_synced_at: link.last_synced_at,
                        stale: true,
                        work_item_id: Some(link.project_work_item_id),
                    };
                    Ok(GitHubIssueDetail {
                        summary,
                        body: None,
                        comments: Vec::new(),
                    })
                } else {
                    Err(err.into())
                }
            }
        }
    }

    pub async fn refresh(
        &self,
        pool: &SqlitePool,
        client: &GitHubRestClient,
        repo_integration_id: Uuid,
        number: i64,
    ) -> Result<GitHubIssueDetail> {
        self.detail(pool, client, repo_integration_id, number).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_comment(
        &self,
        pool: &SqlitePool,
        client: &GitHubRestClient,
        project_id: Uuid,
        repo_integration_id: Uuid,
        number: i64,
        body: String,
        source: GitHubOperationSource,
        actor: Option<String>,
    ) -> Result<GitHubOperationResult> {
        let integration = RepoIntegrationService::new()
            .ensure_connected(pool, repo_integration_id)
            .await?;
        if !GitHubOperationApprovalService::can_execute_write(source.clone()) {
            let audit = self
                .audit(
                    pool,
                    &integration,
                    number,
                    "issue_comment",
                    GitHubOperationResult::PendingApproval,
                    source,
                    actor,
                    None,
                )
                .await?;
            GitHubPendingOperation::create(
                pool,
                CreateGitHubPendingOperation {
                    project_id,
                    repo_integration_id,
                    audit_id: audit.id,
                    operation_kind: GitHubPendingOperationKind::IssueComment,
                    target_type: GitHubTargetType::Issue,
                    target_id: Some(number.to_string()),
                    payload_json: serde_json::json!({ "body": body }).to_string(),
                },
            )
            .await?;
            return Ok(GitHubOperationResult::PendingApproval);
        }
        let (owner, repo) = owner_repo(&integration)?;
        let result = client
            .create_issue_comment(&owner, &repo, number, &body)
            .await;
        self.audit(
            pool,
            &integration,
            number,
            "issue_comment",
            if result.is_ok() {
                GitHubOperationResult::Success
            } else {
                GitHubOperationResult::Failed
            },
            source,
            actor,
            result.as_ref().err().map(ToString::to_string),
        )
        .await?;
        result?;
        Ok(GitHubOperationResult::Success)
    }

    async fn cached_issues(
        &self,
        pool: &SqlitePool,
        repo_id: Uuid,
    ) -> Result<Vec<GitHubIssueSummary>> {
        let rows = sqlx::query_as::<_, ProjectWorkItemExternalLink>(
            r#"
            SELECT id, project_work_item_id, provider, repo_id, external_type, external_id,
                   number, url, state, metadata_json, last_synced_at, 1 AS stale,
                   created_at, updated_at
            FROM project_work_item_external_links
            WHERE provider = 'github'
              AND repo_id = ?1
              AND external_type = 'github_issue'
            ORDER BY updated_at DESC
            "#,
        )
        .bind(repo_id)
        .fetch_all(pool)
        .await?;
        Ok(rows
            .into_iter()
            .filter_map(|link| {
                let number = link.number?;
                Some(GitHubIssueSummary {
                    number,
                    node_id: link.external_id,
                    title: cached_issue_title(link.metadata_json.as_deref(), number),
                    state: link.state.unwrap_or_else(|| "unknown".to_string()),
                    url: link.url.unwrap_or_default(),
                    author: None,
                    author_avatar_url: None,
                    labels: Vec::new(),
                    assignees: Vec::new(),
                    created_at: link.created_at,
                    updated_at: chrono::Utc::now(),
                    last_synced_at: link.last_synced_at,
                    stale: true,
                    work_item_id: Some(link.project_work_item_id),
                })
            })
            .collect())
    }

    async fn update_cached_issue(
        &self,
        pool: &SqlitePool,
        repo_id: Uuid,
        mut issue: GitHubIssueSummary,
    ) -> Result<GitHubIssueSummary> {
        let updated = ProjectWorkItemExternalLink::update_cache_by_external(
            pool,
            "github",
            Some(repo_id),
            ProjectExternalType::GithubIssue,
            &issue.number.to_string(),
            Some(issue.number),
            Some(issue.url.clone()),
            Some(issue.state.clone()),
            None,
            issue.last_synced_at,
            false,
        )
        .await?;
        if let Some(link) = updated {
            issue.work_item_id = Some(link.project_work_item_id);
            issue.last_synced_at = link.last_synced_at;
            issue.stale = false;
        }
        Ok(issue)
    }

    async fn cache_issue_detail(
        &self,
        pool: &SqlitePool,
        repo_id: Uuid,
        detail: &GitHubIssueDetail,
    ) -> Result<()> {
        ProjectWorkItemExternalLink::update_cache_by_external(
            pool,
            "github",
            Some(repo_id),
            ProjectExternalType::GithubIssue,
            &detail.summary.number.to_string(),
            Some(detail.summary.number),
            Some(detail.summary.url.clone()),
            Some(detail.summary.state.clone()),
            Some(serde_json::to_string(detail)?),
            detail.summary.last_synced_at,
            detail.summary.stale,
        )
        .await?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn audit(
        &self,
        pool: &SqlitePool,
        integration: &RepoIntegration,
        number: i64,
        action: &str,
        result: GitHubOperationResult,
        source: GitHubOperationSource,
        actor: Option<String>,
        error: Option<String>,
    ) -> Result<db::models::github_operation_audit::GitHubOperationAudit> {
        let audit = GitHubAuditService::new()
            .record(
                pool,
                CreateGitHubOperationAudit {
                    actor,
                    operation_source: source,
                    session_id: None,
                    workflow_execution_id: None,
                    repo_id: Some(integration.repo_id),
                    target_type: GitHubTargetType::Issue,
                    target_id: Some(number.to_string()),
                    action: action.to_string(),
                    result,
                    error,
                },
            )
            .await?;
        Ok(audit)
    }
}

fn owner_repo(integration: &RepoIntegration) -> Result<(String, String)> {
    Ok((
        integration
            .owner
            .clone()
            .ok_or_else(|| anyhow!("GitHub repo owner is missing"))?,
        integration
            .name
            .clone()
            .ok_or_else(|| anyhow!("GitHub repo name is missing"))?,
    ))
}

fn cached_issue_title(metadata_json: Option<&str>, number: i64) -> String {
    let fallback = || format!("GitHub issue #{number}");
    let Some(metadata_json) = metadata_json else {
        return fallback();
    };
    if let Ok(detail) = serde_json::from_str::<GitHubIssueDetail>(metadata_json) {
        return detail.summary.title;
    }
    metadata_json.trim().to_string()
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::{
        project_work_item_external_link::{ProjectExternalType, ProjectWorkItemExternalLink},
        repo_integration::RepoIntegration,
    };
    use secrecy::SecretString;
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::{GitHubIssueService, GitHubRestClient};

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        for statement in [
            r#"
            CREATE TABLE repo_integrations (
                id TEXT PRIMARY KEY,
                repo_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                owner TEXT,
                name TEXT,
                remote_url TEXT,
                default_branch TEXT,
                external_id TEXT,
                installation_id TEXT,
                github_account_id TEXT,
                repo_grant_json TEXT,
                role TEXT NOT NULL DEFAULT 'primary',
                sync_status TEXT NOT NULL DEFAULT 'connected',
                last_synced_at TEXT,
                last_error TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE project_work_item_external_links (
                id TEXT PRIMARY KEY,
                project_work_item_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                repo_id TEXT,
                external_type TEXT NOT NULL,
                external_id TEXT NOT NULL,
                number INTEGER,
                url TEXT,
                state TEXT,
                metadata_json TEXT,
                last_synced_at TEXT,
                stale BOOLEAN NOT NULL DEFAULT false,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        pool
    }

    #[tokio::test]
    async fn github_issue_read_failure_persists_stale_cache_marker() {
        let pool = setup_pool().await;
        let repo_id = Uuid::new_v4();
        let work_item_id = Uuid::new_v4();
        let integration = RepoIntegration::create(
            &pool,
            repo_id,
            "github".to_string(),
            Some("owner".to_string()),
            Some("repo".to_string()),
            None,
            Some("main".to_string()),
            None,
            None,
            Some("connected".to_string()),
            Some(Utc::now()),
        )
        .await
        .expect("create repo integration");
        sqlx::query(
            r#"
            INSERT INTO project_work_item_external_links (
                id, project_work_item_id, provider, repo_id, external_type,
                external_id, number, url, state, metadata_json, last_synced_at, stale
            ) VALUES (?1, ?2, 'github', ?3, 'github_issue', '42', 42, ?4, 'open', 'Cached title', ?5, false)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(work_item_id)
        .bind(repo_id)
        .bind("https://github.test/owner/repo/issues/42")
        .bind(Utc::now())
        .execute(&pool)
        .await
        .expect("insert cached issue");
        let client = GitHubRestClient::new_with_base_url(
            SecretString::from("unused".to_string()),
            "http://127.0.0.1:1",
        );

        let issues = GitHubIssueService::new()
            .list_or_search(&pool, &client, integration.id, None)
            .await
            .expect("fall back to cached issues");

        assert_eq!(issues.len(), 1);
        assert!(issues[0].stale);
        let link = ProjectWorkItemExternalLink::find_by_external(
            &pool,
            "github",
            Some(repo_id),
            ProjectExternalType::GithubIssue,
            "42",
        )
        .await
        .expect("load link")
        .expect("cached link exists");
        assert!(link.stale);
    }
}
