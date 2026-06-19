//! GitHub hosting service implementation.

mod cli;

use std::{path::Path, time::Duration};

use async_trait::async_trait;
use backon::{ExponentialBuilder, Retryable};
pub use cli::GhCli;
use cli::GhCliError;
use db::models::merge::{MergeStatus, PullRequestInfo};
use secrecy::{ExposeSecret, SecretString};
use tracing::info;

use super::{
    GitHostProvider,
    types::{CreatePrRequest, GitHostError, OpenPrInfo, ProviderKind, UnifiedPrComment},
};
use crate::services::github::{
    auth::{DeviceFlowGitHubAuthProvider, GitHubAuthProvider},
    rest_client::{CreateGitHubPullRequest, GitHubPullRequestSummary, GitHubRestClient},
};

#[derive(Debug, Clone)]
pub struct GitHubProvider;

impl GitHubProvider {
    pub fn new() -> Result<Self, GitHostError> {
        Ok(Self)
    }

    async fn rest_client(&self) -> Result<GitHubRestClient, GitHostError> {
        let provider = DeviceFlowGitHubAuthProvider::from_env()
            .map_err(|err| GitHostError::AuthFailed(err.to_string()))?;
        let token = provider
            .access_token()
            .await
            .map_err(|err| GitHostError::AuthFailed(err.to_string()))?;
        Ok(GitHubRestClient::new(SecretString::from(
            token.token.expose_secret().to_string(),
        )))
    }
}

impl From<GhCliError> for GitHostError {
    fn from(error: GhCliError) -> Self {
        match &error {
            GhCliError::AuthFailed(msg) => GitHostError::AuthFailed(msg.clone()),
            GhCliError::NotAvailable => GitHostError::CliNotInstalled {
                provider: ProviderKind::GitHub,
            },
            GhCliError::CommandFailed(msg) => {
                let lower = msg.to_ascii_lowercase();
                if lower.contains("403") || lower.contains("forbidden") {
                    GitHostError::InsufficientPermissions(msg.clone())
                } else if lower.contains("404") || lower.contains("not found") {
                    GitHostError::RepoNotFoundOrNoAccess(msg.clone())
                } else {
                    GitHostError::PullRequest(msg.clone())
                }
            }
            GhCliError::UnexpectedOutput(msg) => GitHostError::UnexpectedOutput(msg.clone()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedGitHubRepo {
    owner: String,
    repo_name: String,
}

#[async_trait]
impl GitHostProvider for GitHubProvider {
    async fn create_pr(
        &self,
        _repo_path: &Path,
        remote_url: &str,
        request: &CreatePrRequest,
    ) -> Result<PullRequestInfo, GitHostError> {
        // Get owner/repo from the remote URL (target repo for the PR).
        let target_repo_info = parse_repo_remote_url(remote_url)?;

        // For cross-fork PRs, get the head repo info to format head_branch as "owner:branch".
        let head_branch = if let Some(head_url) = &request.head_repo_url {
            let head_repo_info = parse_repo_remote_url(head_url)?;
            if head_repo_info.owner != target_repo_info.owner {
                format!("{}:{}", head_repo_info.owner, request.head_branch)
            } else {
                request.head_branch.clone()
            }
        } else {
            request.head_branch.clone()
        };

        let mut request_clone = request.clone();
        request_clone.head_branch = head_branch;

        (|| async {
            let request = request_clone.clone();
            let owner = target_repo_info.owner.clone();
            let repo_name = target_repo_info.repo_name.clone();
            let client = self.rest_client().await?;
            let pr = client
                .create_pull_request(
                    &owner,
                    &repo_name,
                    CreateGitHubPullRequest {
                        title: request.title.clone(),
                        body: request.body.clone(),
                        head: request.head_branch.clone(),
                        base: request.base_branch.clone(),
                        draft: request.draft.unwrap_or(false),
                    },
                )
                .await
                .map_err(|err| GitHostError::PullRequest(err.to_string()))?;
            let pr_info = pr_summary_to_info(pr);

            info!(
                "Created GitHub PR #{} for branch {}",
                pr_info.number, request_clone.head_branch
            );

            Ok(pr_info)
        })
        .retry(
            &ExponentialBuilder::default()
                .with_min_delay(Duration::from_secs(1))
                .with_max_delay(Duration::from_secs(30))
                .with_max_times(3)
                .with_jitter(),
        )
        .when(|e: &GitHostError| e.should_retry())
        .notify(|err: &GitHostError, dur: Duration| {
            tracing::warn!(
                "GitHub API call failed, retrying after {:.2}s: {}",
                dur.as_secs_f64(),
                err
            );
        })
        .await
    }

    async fn get_pr_status(&self, pr_url: &str) -> Result<PullRequestInfo, GitHostError> {
        let (owner, repo, number) = parse_pr_url(pr_url)?;

        (|| async {
            let client = self.rest_client().await?;
            let pr = client
                .pull_request(&owner, &repo, number)
                .await
                .map_err(|err| GitHostError::PullRequest(err.to_string()))?;
            Ok(pr_summary_to_info(pr))
        })
        .retry(
            &ExponentialBuilder::default()
                .with_min_delay(Duration::from_secs(1))
                .with_max_delay(Duration::from_secs(30))
                .with_max_times(3)
                .with_jitter(),
        )
        .when(|err: &GitHostError| err.should_retry())
        .notify(|err: &GitHostError, dur: Duration| {
            tracing::warn!(
                "GitHub API call failed, retrying after {:.2}s: {}",
                dur.as_secs_f64(),
                err
            );
        })
        .await
    }

    async fn list_prs_for_branch(
        &self,
        _repo_path: &Path,
        remote_url: &str,
        branch_name: &str,
    ) -> Result<Vec<PullRequestInfo>, GitHostError> {
        let repo_info = parse_repo_remote_url(remote_url)?;

        let branch = format!("{}:{branch_name}", repo_info.owner);

        (|| async {
            let owner = repo_info.owner.clone();
            let repo_name = repo_info.repo_name.clone();
            let branch = branch.clone();
            let client = self.rest_client().await?;
            let prs = client
                .list_pull_requests(&owner, &repo_name, "all", Some(&branch))
                .await
                .map_err(|err| GitHostError::PullRequest(err.to_string()))?;
            Ok(prs.into_iter().map(pr_summary_to_info).collect())
        })
        .retry(
            &ExponentialBuilder::default()
                .with_min_delay(Duration::from_secs(1))
                .with_max_delay(Duration::from_secs(30))
                .with_max_times(3)
                .with_jitter(),
        )
        .when(|e: &GitHostError| e.should_retry())
        .notify(|err: &GitHostError, dur: Duration| {
            tracing::warn!(
                "GitHub API call failed, retrying after {:.2}s: {}",
                dur.as_secs_f64(),
                err
            );
        })
        .await
    }

    async fn get_pr_comments(
        &self,
        _repo_path: &Path,
        remote_url: &str,
        pr_number: i64,
    ) -> Result<Vec<UnifiedPrComment>, GitHostError> {
        let repo_info = parse_repo_remote_url(remote_url)?;

        let (general_comments, review_comments) = (|| async {
            let client = self.rest_client().await?;
            let general_comments = client
                .pull_request_issue_comments(&repo_info.owner, &repo_info.repo_name, pr_number)
                .await
                .map_err(|err| GitHostError::PullRequest(err.to_string()))?;
            let review_comments = client
                .pull_request_review_comments(&repo_info.owner, &repo_info.repo_name, pr_number)
                .await
                .map_err(|err| GitHostError::PullRequest(err.to_string()))?;
            Ok((general_comments, review_comments))
        })
        .retry(
            &ExponentialBuilder::default()
                .with_min_delay(Duration::from_secs(1))
                .with_max_delay(Duration::from_secs(30))
                .with_max_times(3)
                .with_jitter(),
        )
        .when(|e: &GitHostError| e.should_retry())
        .notify(|err: &GitHostError, dur: Duration| {
            tracing::warn!(
                "GitHub API call failed, retrying after {:.2}s: {}",
                dur.as_secs_f64(),
                err
            );
        })
        .await?;

        // Convert and merge into unified timeline
        let mut unified: Vec<UnifiedPrComment> = Vec::new();

        for c in general_comments {
            unified.push(UnifiedPrComment::General {
                id: c.id.to_string(),
                author: c.author.unwrap_or_else(|| "unknown".to_string()),
                author_association: c.author_association,
                body: c.body,
                created_at: c.created_at,
                url: c.url,
            });
        }

        for c in review_comments {
            unified.push(UnifiedPrComment::Review {
                id: c.id,
                author: c.author.unwrap_or_else(|| "unknown".to_string()),
                author_association: c.author_association,
                body: c.body,
                created_at: c.created_at,
                url: c.url,
                path: c.path,
                line: c.line,
                side: c.side,
                diff_hunk: c.diff_hunk,
            });
        }

        // Sort by creation time
        unified.sort_by_key(|c| c.created_at());

        Ok(unified)
    }

    async fn list_open_prs(
        &self,
        _repo_path: &Path,
        remote_url: &str,
    ) -> Result<Vec<OpenPrInfo>, GitHostError> {
        let repo_info = parse_repo_remote_url(remote_url)?;

        (|| async {
            let owner = repo_info.owner.clone();
            let repo_name = repo_info.repo_name.clone();
            let client = self.rest_client().await?;
            let prs = client
                .list_pull_requests(&owner, &repo_name, "open", None)
                .await
                .map_err(|err| GitHostError::PullRequest(err.to_string()))?;
            Ok(prs
                .into_iter()
                .map(|pr| OpenPrInfo {
                    number: pr.number,
                    url: pr.url,
                    title: pr.title,
                    head_branch: pr.head_branch,
                    base_branch: pr.base_branch,
                })
                .collect())
        })
        .retry(
            &ExponentialBuilder::default()
                .with_min_delay(Duration::from_secs(1))
                .with_max_delay(Duration::from_secs(30))
                .with_max_times(3)
                .with_jitter(),
        )
        .when(|e: &GitHostError| e.should_retry())
        .notify(|err: &GitHostError, dur: Duration| {
            tracing::warn!(
                "GitHub API call failed, retrying after {:.2}s: {}",
                dur.as_secs_f64(),
                err
            );
        })
        .await
    }

    fn provider_kind(&self) -> ProviderKind {
        ProviderKind::GitHub
    }
}

fn pr_summary_to_info(pr: GitHubPullRequestSummary) -> PullRequestInfo {
    PullRequestInfo {
        number: pr.number,
        url: pr.url,
        status: match pr.state.as_str() {
            "open" => MergeStatus::Open,
            "closed" => MergeStatus::Closed,
            _ => MergeStatus::Unknown,
        },
        merged_at: None,
        merge_commit_sha: None,
    }
}

fn parse_pr_url(pr_url: &str) -> Result<(String, String, i64), GitHostError> {
    let path = pr_url
        .split("github.com/")
        .nth(1)
        .ok_or_else(|| GitHostError::PullRequest("Invalid GitHub PR URL".to_string()))?;
    let parts = path.split('/').collect::<Vec<_>>();
    if parts.len() < 4 || parts[2] != "pull" {
        return Err(GitHostError::PullRequest(
            "Invalid GitHub PR URL".to_string(),
        ));
    }
    let number = parts[3]
        .parse::<i64>()
        .map_err(|_| GitHostError::PullRequest("Invalid GitHub PR number".to_string()))?;
    Ok((parts[0].to_string(), parts[1].to_string(), number))
}

fn parse_repo_remote_url(remote_url: &str) -> Result<ParsedGitHubRepo, GitHostError> {
    let mut value = remote_url.trim().trim_end_matches('/').to_string();
    if let Some(stripped) = value.strip_suffix(".git") {
        value = stripped.to_string();
    }

    let path = if let Some(path) = value.strip_prefix("git@github.com:") {
        path
    } else if let Some(path) = value.strip_prefix("ssh://git@github.com/") {
        path
    } else if let Some(path) = value.strip_prefix("https://github.com/") {
        path
    } else if let Some(path) = value.strip_prefix("http://github.com/") {
        path
    } else {
        return Err(GitHostError::Repository(
            "Unsupported GitHub remote URL".to_string(),
        ));
    };

    let parts = path.split('/').collect::<Vec<_>>();
    if parts.len() < 2 || parts[0].is_empty() || parts[1].is_empty() {
        return Err(GitHostError::Repository(
            "Invalid GitHub remote URL".to_string(),
        ));
    }

    Ok(ParsedGitHubRepo {
        owner: parts[0].to_string(),
        repo_name: parts[1].to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::{ParsedGitHubRepo, parse_repo_remote_url};

    #[test]
    fn github_provider_parses_https_remote_without_cli() {
        assert_eq!(
            parse_repo_remote_url("https://github.com/openai/codex.git").unwrap(),
            ParsedGitHubRepo {
                owner: "openai".to_string(),
                repo_name: "codex".to_string()
            }
        );
    }

    #[test]
    fn github_provider_parses_ssh_remote_without_cli() {
        assert_eq!(
            parse_repo_remote_url("git@github.com:openai/codex.git").unwrap(),
            ParsedGitHubRepo {
                owner: "openai".to_string(),
                repo_name: "codex".to_string()
            }
        );
    }
}
