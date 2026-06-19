use std::{path::Path, process::Command};

use anyhow::{Result, anyhow};
use db::models::{
    github_operation_audit::{
        CreateGitHubOperationAudit, GitHubOperationResult, GitHubOperationSource, GitHubTargetType,
    },
    github_pending_pr_creation::{
        CreateGitHubPendingPrCreation, GitHubPendingPrCreation, GitHubPendingPrStatus,
        UpdateGitHubPendingPrCreation,
    },
    project_delivery_record::{
        CreateProjectDeliveryRecord, ProjectDeliveryEventTypeV2, ProjectDeliveryRecord,
    },
    project_work_item_external_link::{
        CreateProjectWorkItemExternalLink, ProjectExternalType, ProjectWorkItemExternalLink,
    },
    repo::Repo,
    repo_integration::RepoIntegration,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;
use uuid::Uuid;

use super::{
    audit::GitHubAuditService,
    operation_approval::GitHubOperationApprovalService,
    rest_client::{CreateGitHubPullRequest, GitHubPullRequestSummary, GitHubRestClient},
};
use crate::services::repo_integration::RepoIntegrationService;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct GitHubPrPreviewCommit {
    pub sha: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct GitHubPrPreview {
    pub repo_id: Uuid,
    pub base_branch: String,
    pub head_branch: String,
    pub head_pushed: bool,
    pub commits: Vec<GitHubPrPreviewCommit>,
    pub diff_summary: String,
    pub diff_text: String,
    pub requires_push: bool,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct GitHubPrPreviewRequest {
    pub repo_integration_id: Uuid,
    pub base_branch: String,
    pub head_branch: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct GitHubCreatePrRequest {
    pub repo_integration_id: Uuid,
    pub base_branch: String,
    pub head_branch: String,
    pub title: String,
    pub body: Option<String>,
    pub work_item_id: Option<Uuid>,
    pub operation_source: GitHubOperationSource,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct GitHubRetryPrRequest {
    pub pending_pr_id: Uuid,
    pub operation_source: GitHubOperationSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct GitHubCreatePrResponse {
    pub pull_request: Option<GitHubPullRequestSummary>,
    pub delivery_record: Option<ProjectDeliveryRecord>,
    pub external_link: Option<ProjectWorkItemExternalLink>,
    pub audit_id: Uuid,
    pub result: GitHubOperationResult,
    pub pending_pr: Option<GitHubPendingPrCreation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PendingPrRetryAction {
    PushThenCreate,
    CreateOnly,
    RestoreLocalOnly,
}

#[derive(Clone, Default)]
pub struct GitHubPrService;

impl GitHubPrService {
    pub fn new() -> Self {
        Self
    }

    pub async fn list_branches(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        repo_integration_id: Uuid,
    ) -> Result<Vec<String>> {
        let integration = RepoIntegrationService::new()
            .ensure_project_connected(pool, project_id, repo_integration_id)
            .await?;
        let repo = Repo::find_by_id(pool, integration.repo_id)
            .await?
            .ok_or_else(|| anyhow!("Repository not found"))?;
        let output = git_output(&repo.path, ["branch", "--format=%(refname:short)"])?;
        Ok(output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect())
    }

    pub async fn preview(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        input: GitHubPrPreviewRequest,
    ) -> Result<GitHubPrPreview> {
        let integration = RepoIntegrationService::new()
            .ensure_project_connected(pool, project_id, input.repo_integration_id)
            .await?;
        let repo = Repo::find_by_id(pool, integration.repo_id)
            .await?
            .ok_or_else(|| anyhow!("Repository not found"))?;
        let range = format!("{}..{}", input.base_branch, input.head_branch);
        let log = git_output(&repo.path, ["log", "--format=%H%x00%s", &range])?;
        let commits = log
            .lines()
            .filter_map(|line| {
                let (sha, subject) = line.split_once('\0')?;
                Some(GitHubPrPreviewCommit {
                    sha: sha.to_string(),
                    subject: subject.to_string(),
                })
            })
            .collect::<Vec<_>>();
        let diff_summary = git_output(&repo.path, ["diff", "--stat", &range])?;
        let diff_text = git_output(&repo.path, ["diff", "--find-renames", &range])?;
        let head_pushed = remote_branch_matches_local_head(&repo.path, &input.head_branch);

        Ok(GitHubPrPreview {
            repo_id: integration.repo_id,
            base_branch: input.base_branch,
            head_branch: input.head_branch,
            head_pushed,
            commits,
            diff_summary,
            diff_text,
            requires_push: !head_pushed,
        })
    }

    pub async fn push_head(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        repo_integration_id: Uuid,
        head_branch: String,
        base_branch: Option<String>,
        title: Option<String>,
        body: Option<String>,
        work_item_id: Option<Uuid>,
        operation_source: GitHubOperationSource,
        actor: Option<String>,
    ) -> Result<GitHubOperationResult> {
        let integration = RepoIntegrationService::new()
            .ensure_project_connected(pool, project_id, repo_integration_id)
            .await?;
        let audit_result =
            if GitHubOperationApprovalService::can_execute_write(operation_source.clone()) {
                GitHubOperationResult::Approved
            } else {
                GitHubOperationResult::PendingApproval
            };
        let audit = GitHubAuditService::new()
            .record(
                pool,
                CreateGitHubOperationAudit {
                    actor,
                    operation_source,
                    session_id: None,
                    workflow_execution_id: None,
                    repo_id: Some(integration.repo_id),
                    target_type: GitHubTargetType::PullRequest,
                    target_id: Some(head_branch.clone()),
                    action: "pr_push".to_string(),
                    result: audit_result.clone(),
                    error: None,
                },
            )
            .await?;
        if audit_result == GitHubOperationResult::PendingApproval {
            GitHubPendingPrCreation::create(
                pool,
                CreateGitHubPendingPrCreation {
                    project_id,
                    repo_integration_id,
                    work_item_id,
                    audit_id: Some(audit.id),
                    base_branch: base_branch
                        .or_else(|| integration.default_branch.clone())
                        .unwrap_or_else(|| "main".to_string()),
                    head_branch: head_branch.clone(),
                    title: title.unwrap_or_else(|| format!("Open PR for {head_branch}")),
                    body,
                    status: GitHubPendingPrStatus::PushFailed,
                    pull_request_number: None,
                    pull_request_url: None,
                    last_error: Some("GitHub write operation is pending user approval".to_string()),
                },
            )
            .await?;
            return Ok(GitHubOperationResult::PendingApproval);
        }
        let repo = Repo::find_by_id(pool, integration.repo_id)
            .await?
            .ok_or_else(|| anyhow!("Repository not found"))?;
        let result = git_output(
            &repo.path,
            ["push", "origin", &format!("HEAD:{head_branch}")],
        );
        let audit_result = if result.is_ok() {
            GitHubOperationResult::Success
        } else {
            GitHubOperationResult::Failed
        };
        GitHubAuditService::new()
            .update_result(
                pool,
                audit.id,
                audit_result,
                result.as_ref().err().map(ToString::to_string),
            )
            .await?;
        if let Err(err) = result {
            let base_branch = base_branch
                .or_else(|| integration.default_branch.clone())
                .unwrap_or_else(|| "main".to_string());
            let title = title.unwrap_or_else(|| format!("Open PR for {head_branch}"));
            GitHubPendingPrCreation::create(
                pool,
                CreateGitHubPendingPrCreation {
                    project_id,
                    repo_integration_id,
                    work_item_id,
                    audit_id: Some(audit.id),
                    base_branch,
                    head_branch,
                    title,
                    body,
                    status: GitHubPendingPrStatus::PushFailed,
                    pull_request_number: None,
                    pull_request_url: None,
                    last_error: Some(err.to_string()),
                },
            )
            .await?;
            return Err(err);
        }
        Ok(GitHubOperationResult::Success)
    }

    pub async fn create_pr(
        &self,
        pool: &SqlitePool,
        client: &GitHubRestClient,
        project_id: Uuid,
        input: GitHubCreatePrRequest,
        actor: Option<String>,
    ) -> Result<GitHubCreatePrResponse> {
        let integration = RepoIntegrationService::new()
            .ensure_project_connected(pool, project_id, input.repo_integration_id)
            .await?;
        let audit_result =
            if GitHubOperationApprovalService::can_execute_write(input.operation_source.clone()) {
                GitHubOperationResult::Approved
            } else {
                GitHubOperationResult::PendingApproval
            };
        let audit = GitHubAuditService::new()
            .record(
                pool,
                CreateGitHubOperationAudit {
                    actor,
                    operation_source: input.operation_source.clone(),
                    session_id: None,
                    workflow_execution_id: None,
                    repo_id: Some(integration.repo_id),
                    target_type: GitHubTargetType::PullRequest,
                    target_id: Some(input.head_branch.clone()),
                    action: "create_pr".to_string(),
                    result: audit_result.clone(),
                    error: None,
                },
            )
            .await?;
        if audit_result == GitHubOperationResult::PendingApproval {
            return Ok(GitHubCreatePrResponse {
                pull_request: None,
                delivery_record: None,
                external_link: None,
                audit_id: audit.id,
                result: audit_result,
                pending_pr: Some(
                    GitHubPendingPrCreation::create(
                        pool,
                        CreateGitHubPendingPrCreation {
                            project_id,
                            repo_integration_id: integration.id,
                            work_item_id: input.work_item_id,
                            audit_id: Some(audit.id),
                            base_branch: input.base_branch,
                            head_branch: input.head_branch,
                            title: input.title,
                            body: input.body,
                            status: GitHubPendingPrStatus::Pushed,
                            pull_request_number: None,
                            pull_request_url: None,
                            last_error: Some(
                                "GitHub write operation is pending user approval".to_string(),
                            ),
                        },
                    )
                    .await?,
                ),
            });
        }

        let (owner, repo_name) = owner_repo(&integration)?;
        let base_branch = input.base_branch.clone();
        let head_branch = input.head_branch.clone();
        let title = input.title.clone();
        let body = input.body.clone();
        let pr = client
            .create_pull_request(
                &owner,
                &repo_name,
                CreateGitHubPullRequest {
                    title: input.title.clone(),
                    body: input.body.clone(),
                    head: input.head_branch.clone(),
                    base: input.base_branch.clone(),
                    draft: false,
                },
            )
            .await;
        let pr = match pr {
            Ok(pr) => pr,
            Err(err) => {
                GitHubAuditService::new()
                    .update_result(
                        pool,
                        audit.id,
                        GitHubOperationResult::Failed,
                        Some(err.to_string()),
                    )
                    .await?;
                let pending_pr = GitHubPendingPrCreation::create(
                    pool,
                    CreateGitHubPendingPrCreation {
                        project_id,
                        repo_integration_id: integration.id,
                        work_item_id: input.work_item_id,
                        audit_id: Some(audit.id),
                        base_branch,
                        head_branch,
                        title,
                        body,
                        status: GitHubPendingPrStatus::CreateFailed,
                        pull_request_number: None,
                        pull_request_url: None,
                        last_error: Some(err.to_string()),
                    },
                )
                .await?;
                return Ok(GitHubCreatePrResponse {
                    pull_request: None,
                    delivery_record: None,
                    external_link: None,
                    audit_id: audit.id,
                    result: GitHubOperationResult::Failed,
                    pending_pr: Some(pending_pr),
                });
            }
        };
        let external_link = if let Some(work_item_id) = input.work_item_id {
            match ProjectWorkItemExternalLink::create(
                pool,
                work_item_id,
                CreateProjectWorkItemExternalLink {
                    provider: "github".to_string(),
                    repo_id: Some(integration.repo_id),
                    external_type: ProjectExternalType::GithubPr,
                    external_id: pr.number.to_string(),
                    number: Some(pr.number),
                    url: Some(pr.url.clone()),
                    state: Some(pr.state.clone()),
                    metadata_json: Some(pr.title.clone()),
                    last_synced_at: Some(chrono::Utc::now()),
                    stale: false,
                },
            )
            .await
            {
                Ok(link) => Some(link),
                Err(err) => {
                    GitHubAuditService::new()
                        .update_result(
                            pool,
                            audit.id,
                            GitHubOperationResult::Failed,
                            Some(err.to_string()),
                        )
                        .await?;
                    let pending_pr = GitHubPendingPrCreation::create(
                        pool,
                        CreateGitHubPendingPrCreation {
                            project_id,
                            repo_integration_id: integration.id,
                            work_item_id: input.work_item_id,
                            audit_id: Some(audit.id),
                            base_branch,
                            head_branch,
                            title,
                            body,
                            status: GitHubPendingPrStatus::LocalLinkFailed,
                            pull_request_number: Some(pr.number),
                            pull_request_url: Some(pr.url.clone()),
                            last_error: Some(err.to_string()),
                        },
                    )
                    .await?;
                    return Ok(GitHubCreatePrResponse {
                        pull_request: Some(pr),
                        delivery_record: None,
                        external_link: None,
                        audit_id: audit.id,
                        result: GitHubOperationResult::Failed,
                        pending_pr: Some(pending_pr),
                    });
                }
            }
        } else {
            None
        };
        let delivery_record = db::models::project_delivery_record::ProjectDeliveryRecord::create(
            pool,
            CreateProjectDeliveryRecord {
                project_work_item_id: input.work_item_id,
                repo_id: Some(integration.repo_id),
                external_link_id: external_link.as_ref().map(|link| link.id),
                event_type: ProjectDeliveryEventTypeV2::PrOpened,
                external_id: Some(pr.number.to_string()),
                url: Some(pr.url.clone()),
                actor: None,
                source_session_id: None,
                source_workflow_execution_id: None,
                metadata_json: Some(pr.title.clone()),
                occurred_at: None,
            },
        )
        .await;
        let delivery_record = match delivery_record {
            Ok(record) => record,
            Err(err) => {
                GitHubAuditService::new()
                    .update_result(
                        pool,
                        audit.id,
                        GitHubOperationResult::Failed,
                        Some(err.to_string()),
                    )
                    .await?;
                let pending_pr = GitHubPendingPrCreation::create(
                    pool,
                    CreateGitHubPendingPrCreation {
                        project_id,
                        repo_integration_id: integration.id,
                        work_item_id: input.work_item_id,
                        audit_id: Some(audit.id),
                        base_branch,
                        head_branch,
                        title,
                        body,
                        status: GitHubPendingPrStatus::LocalLinkFailed,
                        pull_request_number: Some(pr.number),
                        pull_request_url: Some(pr.url.clone()),
                        last_error: Some(err.to_string()),
                    },
                )
                .await?;
                return Ok(GitHubCreatePrResponse {
                    pull_request: Some(pr),
                    delivery_record: None,
                    external_link,
                    audit_id: audit.id,
                    result: GitHubOperationResult::Failed,
                    pending_pr: Some(pending_pr),
                });
            }
        };
        GitHubAuditService::new()
            .update_result(pool, audit.id, GitHubOperationResult::Success, None)
            .await?;
        let completed = GitHubPendingPrCreation::create(
            pool,
            CreateGitHubPendingPrCreation {
                project_id,
                repo_integration_id: integration.id,
                work_item_id: input.work_item_id,
                audit_id: Some(audit.id),
                base_branch,
                head_branch,
                title,
                body,
                status: GitHubPendingPrStatus::Completed,
                pull_request_number: Some(pr.number),
                pull_request_url: Some(pr.url.clone()),
                last_error: None,
            },
        )
        .await?;

        Ok(GitHubCreatePrResponse {
            pull_request: Some(pr),
            delivery_record: Some(delivery_record),
            external_link,
            audit_id: audit.id,
            result: GitHubOperationResult::Success,
            pending_pr: Some(completed),
        })
    }

    pub async fn retry_pending_pr(
        &self,
        pool: &SqlitePool,
        client: &GitHubRestClient,
        project_id: Uuid,
        input: GitHubRetryPrRequest,
        actor: Option<String>,
    ) -> Result<GitHubCreatePrResponse> {
        let pending = GitHubPendingPrCreation::find_by_id(pool, input.pending_pr_id)
            .await?
            .ok_or_else(|| anyhow!("Pending PR creation not found"))?;
        if pending.project_id != project_id {
            return Err(anyhow!("Pending PR creation not found"));
        }
        if pending.status == GitHubPendingPrStatus::Completed {
            return Err(anyhow!("Pending PR creation is already completed"));
        }

        if !GitHubOperationApprovalService::can_execute_write(input.operation_source.clone()) {
            let integration = RepoIntegrationService::new()
                .ensure_project_connected(pool, project_id, pending.repo_integration_id)
                .await?;
            let audit = GitHubAuditService::new()
                .record(
                    pool,
                    CreateGitHubOperationAudit {
                        actor,
                        operation_source: input.operation_source,
                        session_id: None,
                        workflow_execution_id: None,
                        repo_id: Some(integration.repo_id),
                        target_type: GitHubTargetType::PullRequest,
                        target_id: pending
                            .pull_request_number
                            .map(|number| number.to_string())
                            .or(Some(pending.head_branch.clone())),
                        action: "pr_retry".to_string(),
                        result: GitHubOperationResult::PendingApproval,
                        error: None,
                    },
                )
                .await?;
            let updated = GitHubPendingPrCreation::update(
                pool,
                pending.id,
                UpdateGitHubPendingPrCreation {
                    audit_id: Some(audit.id),
                    status: pending.status,
                    pull_request_number: pending.pull_request_number,
                    pull_request_url: pending.pull_request_url,
                    last_error: Some("GitHub write operation is pending user approval".to_string()),
                },
            )
            .await?;
            return Ok(GitHubCreatePrResponse {
                pull_request: None,
                delivery_record: None,
                external_link: None,
                audit_id: audit.id,
                result: GitHubOperationResult::PendingApproval,
                pending_pr: Some(updated),
            });
        }

        let action = retry_action(pending.status.clone());
        if action == PendingPrRetryAction::RestoreLocalOnly {
            return self
                .restore_local_pr_state(pool, project_id, pending, actor)
                .await;
        }

        if action == PendingPrRetryAction::PushThenCreate {
            self.retry_push_pending_pr(pool, project_id, &pending, actor.clone())
                .await?;
        }

        let response = self
            .create_pr(
                pool,
                client,
                project_id,
                GitHubCreatePrRequest {
                    repo_integration_id: pending.repo_integration_id,
                    base_branch: pending.base_branch.clone(),
                    head_branch: pending.head_branch.clone(),
                    title: pending.title.clone(),
                    body: pending.body.clone(),
                    work_item_id: pending.work_item_id,
                    operation_source: input.operation_source,
                },
                actor,
            )
            .await?;

        let updated = GitHubPendingPrCreation::update(
            pool,
            pending.id,
            UpdateGitHubPendingPrCreation {
                audit_id: Some(response.audit_id),
                status: match response.result {
                    GitHubOperationResult::Success => GitHubPendingPrStatus::Completed,
                    GitHubOperationResult::PendingApproval => GitHubPendingPrStatus::Pushed,
                    _ => GitHubPendingPrStatus::CreateFailed,
                },
                pull_request_number: response.pull_request.as_ref().map(|pr| pr.number),
                pull_request_url: response.pull_request.as_ref().map(|pr| pr.url.clone()),
                last_error: if response.result == GitHubOperationResult::Success {
                    None
                } else {
                    Some("Retry did not complete PR creation".to_string())
                },
            },
        )
        .await?;

        Ok(GitHubCreatePrResponse {
            pending_pr: Some(updated),
            ..response
        })
    }

    async fn retry_push_pending_pr(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        pending: &GitHubPendingPrCreation,
        actor: Option<String>,
    ) -> Result<()> {
        let integration = RepoIntegrationService::new()
            .ensure_project_connected(pool, project_id, pending.repo_integration_id)
            .await?;
        let audit = GitHubAuditService::new()
            .record(
                pool,
                CreateGitHubOperationAudit {
                    actor,
                    operation_source: GitHubOperationSource::UserUi,
                    session_id: None,
                    workflow_execution_id: None,
                    repo_id: Some(integration.repo_id),
                    target_type: GitHubTargetType::PullRequest,
                    target_id: Some(pending.head_branch.clone()),
                    action: "pr_push_retry".to_string(),
                    result: GitHubOperationResult::Approved,
                    error: None,
                },
            )
            .await?;
        let repo = Repo::find_by_id(pool, integration.repo_id)
            .await?
            .ok_or_else(|| anyhow!("Repository not found"))?;
        let result = git_output(
            &repo.path,
            ["push", "origin", &format!("HEAD:{}", pending.head_branch)],
        );
        if let Err(err) = result {
            GitHubAuditService::new()
                .update_result(
                    pool,
                    audit.id,
                    GitHubOperationResult::Failed,
                    Some(err.to_string()),
                )
                .await?;
            GitHubPendingPrCreation::update(
                pool,
                pending.id,
                UpdateGitHubPendingPrCreation {
                    audit_id: Some(audit.id),
                    status: GitHubPendingPrStatus::PushFailed,
                    pull_request_number: pending.pull_request_number,
                    pull_request_url: pending.pull_request_url.clone(),
                    last_error: Some(err.to_string()),
                },
            )
            .await?;
            return Err(err);
        }
        GitHubAuditService::new()
            .update_result(pool, audit.id, GitHubOperationResult::Success, None)
            .await?;
        GitHubPendingPrCreation::update(
            pool,
            pending.id,
            UpdateGitHubPendingPrCreation {
                audit_id: Some(audit.id),
                status: GitHubPendingPrStatus::Pushed,
                pull_request_number: pending.pull_request_number,
                pull_request_url: pending.pull_request_url.clone(),
                last_error: None,
            },
        )
        .await?;
        Ok(())
    }

    async fn restore_local_pr_state(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        pending: GitHubPendingPrCreation,
        actor: Option<String>,
    ) -> Result<GitHubCreatePrResponse> {
        let integration = RepoIntegrationService::new()
            .ensure_project_connected(pool, project_id, pending.repo_integration_id)
            .await?;
        let number = pending
            .pull_request_number
            .ok_or_else(|| anyhow!("Pending PR is missing pull request number"))?;
        let url = pending
            .pull_request_url
            .clone()
            .ok_or_else(|| anyhow!("Pending PR is missing pull request URL"))?;
        let audit = GitHubAuditService::new()
            .record(
                pool,
                CreateGitHubOperationAudit {
                    actor: actor.clone(),
                    operation_source: GitHubOperationSource::UserUi,
                    session_id: None,
                    workflow_execution_id: None,
                    repo_id: Some(integration.repo_id),
                    target_type: GitHubTargetType::PullRequest,
                    target_id: Some(number.to_string()),
                    action: "pr_restore_local_link".to_string(),
                    result: GitHubOperationResult::Approved,
                    error: None,
                },
            )
            .await?;
        let external_link = if let Some(work_item_id) = pending.work_item_id {
            match ProjectWorkItemExternalLink::find_by_external(
                pool,
                "github",
                Some(integration.repo_id),
                ProjectExternalType::GithubPr,
                &number.to_string(),
            )
            .await?
            {
                Some(link) => Some(link),
                None => Some(
                    ProjectWorkItemExternalLink::create(
                        pool,
                        work_item_id,
                        CreateProjectWorkItemExternalLink {
                            provider: "github".to_string(),
                            repo_id: Some(integration.repo_id),
                            external_type: ProjectExternalType::GithubPr,
                            external_id: number.to_string(),
                            number: Some(number),
                            url: Some(url.clone()),
                            state: Some("open".to_string()),
                            metadata_json: Some(pending.title.clone()),
                            last_synced_at: Some(chrono::Utc::now()),
                            stale: false,
                        },
                    )
                    .await?,
                ),
            }
        } else {
            None
        };
        let delivery_record = ProjectDeliveryRecord::create(
            pool,
            CreateProjectDeliveryRecord {
                project_work_item_id: pending.work_item_id,
                repo_id: Some(integration.repo_id),
                external_link_id: external_link.as_ref().map(|link| link.id),
                event_type: ProjectDeliveryEventTypeV2::PrOpened,
                external_id: Some(number.to_string()),
                url: Some(url.clone()),
                actor,
                source_session_id: None,
                source_workflow_execution_id: None,
                metadata_json: Some(pending.title.clone()),
                occurred_at: None,
            },
        )
        .await;
        let delivery_record = match delivery_record {
            Ok(record) => Some(record),
            Err(err) => {
                GitHubAuditService::new()
                    .update_result(
                        pool,
                        audit.id,
                        GitHubOperationResult::Failed,
                        Some(err.to_string()),
                    )
                    .await?;
                let updated = GitHubPendingPrCreation::update(
                    pool,
                    pending.id,
                    UpdateGitHubPendingPrCreation {
                        audit_id: Some(audit.id),
                        status: GitHubPendingPrStatus::LocalLinkFailed,
                        pull_request_number: Some(number),
                        pull_request_url: Some(url),
                        last_error: Some(err.to_string()),
                    },
                )
                .await?;
                return Ok(GitHubCreatePrResponse {
                    pull_request: None,
                    delivery_record: None,
                    external_link,
                    audit_id: audit.id,
                    result: GitHubOperationResult::Failed,
                    pending_pr: Some(updated),
                });
            }
        };
        GitHubAuditService::new()
            .update_result(pool, audit.id, GitHubOperationResult::Success, None)
            .await?;
        let updated = GitHubPendingPrCreation::update(
            pool,
            pending.id,
            UpdateGitHubPendingPrCreation {
                audit_id: Some(audit.id),
                status: GitHubPendingPrStatus::Completed,
                pull_request_number: Some(number),
                pull_request_url: Some(url.clone()),
                last_error: None,
            },
        )
        .await?;
        Ok(GitHubCreatePrResponse {
            pull_request: Some(GitHubPullRequestSummary {
                number,
                title: pending.title,
                state: "open".to_string(),
                url,
                head_branch: pending.head_branch,
                base_branch: pending.base_branch,
            }),
            delivery_record,
            external_link,
            audit_id: audit.id,
            result: GitHubOperationResult::Success,
            pending_pr: Some(updated),
        })
    }
}

fn retry_action(status: GitHubPendingPrStatus) -> PendingPrRetryAction {
    match status {
        GitHubPendingPrStatus::PushFailed => PendingPrRetryAction::PushThenCreate,
        GitHubPendingPrStatus::Pushed | GitHubPendingPrStatus::CreateFailed => {
            PendingPrRetryAction::CreateOnly
        }
        GitHubPendingPrStatus::LocalLinkFailed => PendingPrRetryAction::RestoreLocalOnly,
        GitHubPendingPrStatus::Completed => PendingPrRetryAction::RestoreLocalOnly,
    }
}

fn remote_branch_matches_local_head(repo_path: &Path, branch: &str) -> bool {
    let local_head = git_output(repo_path, ["rev-parse", branch])
        .or_else(|_| git_output(repo_path, ["rev-parse", "HEAD"]));
    let remote_head = git_output(
        repo_path,
        ["ls-remote", "--exit-code", "--heads", "origin", branch],
    );
    match (local_head, remote_head) {
        (Ok(local_head), Ok(remote_head)) => {
            remote_head_matches_local_output(&remote_head, &local_head)
        }
        _ => false,
    }
}

fn remote_head_matches_local_output(remote_output: &str, local_output: &str) -> bool {
    let Some(remote_sha) = remote_output.split_whitespace().next() else {
        return false;
    };
    let local_sha = local_output.trim();
    !local_sha.is_empty() && remote_sha == local_sha
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::{
        github_operation_audit::{GitHubOperationResult, GitHubOperationSource},
        github_pending_pr_creation::{
            CreateGitHubPendingPrCreation, GitHubPendingPrCreation, GitHubPendingPrStatus,
        },
        repo_integration::RepoIntegration,
    };
    use secrecy::SecretString;
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::{
        GitHubPrService, GitHubRetryPrRequest, PendingPrRetryAction,
        remote_head_matches_local_output, retry_action,
    };
    use crate::services::github::rest_client::GitHubRestClient;

    #[test]
    fn retry_pending_pr_push_failure_repushes_before_create() {
        assert_eq!(
            retry_action(GitHubPendingPrStatus::PushFailed),
            PendingPrRetryAction::PushThenCreate
        );
    }

    #[test]
    fn retry_pending_pr_local_link_failure_restores_local_only() {
        assert_eq!(
            retry_action(GitHubPendingPrStatus::LocalLinkFailed),
            PendingPrRetryAction::RestoreLocalOnly
        );
    }

    #[test]
    fn retry_pending_pr_create_failure_does_not_push_again() {
        assert_eq!(
            retry_action(GitHubPendingPrStatus::CreateFailed),
            PendingPrRetryAction::CreateOnly
        );
    }

    #[test]
    fn preview_head_pushed_requires_remote_commit_to_match_local_head() {
        assert!(remote_head_matches_local_output(
            "abc123\trefs/heads/feature\n",
            "abc123\n"
        ));
        assert!(!remote_head_matches_local_output(
            "old123\trefs/heads/feature\n",
            "new456\n"
        ));
        assert!(!remote_head_matches_local_output("", "new456\n"));
    }

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        for statement in [
            r#"
            CREATE TABLE project_repos (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                repo_id TEXT NOT NULL
            )
            "#,
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
            CREATE TABLE github_operation_audits (
                id TEXT PRIMARY KEY,
                actor TEXT,
                operation_source TEXT NOT NULL,
                session_id TEXT,
                workflow_execution_id TEXT,
                repo_id TEXT,
                target_type TEXT NOT NULL,
                target_id TEXT,
                action TEXT NOT NULL,
                result TEXT NOT NULL,
                error TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE github_pending_pr_creations (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                repo_integration_id TEXT NOT NULL,
                work_item_id TEXT,
                audit_id TEXT,
                base_branch TEXT NOT NULL,
                head_branch TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT,
                status TEXT NOT NULL,
                pull_request_number INTEGER,
                pull_request_url TEXT,
                last_error TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create test schema");
        }
        pool
    }

    #[tokio::test]
    async fn github_agent_retry_pending_pr_stops_at_pending_approval_before_push() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let repo_id = Uuid::new_v4();
        sqlx::query("INSERT INTO project_repos (id, project_id, repo_id) VALUES (?1, ?2, ?3)")
            .bind(Uuid::new_v4())
            .bind(project_id)
            .bind(repo_id)
            .execute(&pool)
            .await
            .expect("insert project repo");
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
        let pending = GitHubPendingPrCreation::create(
            &pool,
            CreateGitHubPendingPrCreation {
                project_id,
                repo_integration_id: integration.id,
                work_item_id: None,
                audit_id: None,
                base_branch: "main".to_string(),
                head_branch: "feature".to_string(),
                title: "Feature".to_string(),
                body: None,
                status: GitHubPendingPrStatus::PushFailed,
                pull_request_number: None,
                pull_request_url: None,
                last_error: Some("push failed".to_string()),
            },
        )
        .await
        .expect("create pending pr");
        let client = GitHubRestClient::new_with_base_url(
            SecretString::from("unused".to_string()),
            "http://127.0.0.1:1",
        );

        let response = GitHubPrService::new()
            .retry_pending_pr(
                &pool,
                &client,
                project_id,
                GitHubRetryPrRequest {
                    pending_pr_id: pending.id,
                    operation_source: GitHubOperationSource::Agent,
                },
                Some("agent".to_string()),
            )
            .await
            .expect("agent retry is converted to approval");

        assert_eq!(response.result, GitHubOperationResult::PendingApproval);
        assert_eq!(
            response.pending_pr.expect("pending pr").status,
            GitHubPendingPrStatus::PushFailed
        );
        let audit_result: String =
            sqlx::query_scalar("SELECT result FROM github_operation_audits LIMIT 1")
                .fetch_one(&pool)
                .await
                .expect("read audit result");
        assert_eq!(audit_result, "pending_approval");
    }
}

fn git_output<const N: usize>(repo_path: &Path, args: [&str; N]) -> Result<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()?;
    if !output.status.success() {
        return Err(anyhow!(
            "local_git_push_failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
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
