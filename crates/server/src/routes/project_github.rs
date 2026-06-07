use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::Json as ResponseJson,
    routing::{get, post, put},
};
use chrono::NaiveDate;
use db::models::{
    github_operation_audit::{
        CreateGitHubOperationAudit, GitHubOperationAudit, GitHubOperationResult,
        GitHubOperationSource, GitHubTargetType,
    },
    github_pending_operation::{
        CreateGitHubPendingOperation, GitHubPendingOperation, GitHubPendingOperationKind,
        GitHubPendingOperationStatus,
    },
    github_pending_pr_creation::{GitHubPendingPrCreation, UpdateGitHubPendingPrCreation},
    project::{Project, ProjectError},
    project_delivery_record::{ProjectDeliveryRecord, ProjectDeliveryStatsSummary},
    project_work_item::{CreateProjectWorkItem, ProjectWorkItem, UpdateProjectWorkItem},
    project_work_item_execution_link::{
        CreateProjectWorkItemExecutionLink, ProjectWorkItemExecutionLink,
    },
    project_work_item_external_link::{
        CreateProjectWorkItemExternalLink, ProjectWorkItemExternalLink,
    },
    repo_integration::{
        RepoIntegration, RepoIntegrationRole, RepoIntegrationSyncStatus, UpdateRepoIntegration,
    },
};
use deployment::Deployment;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use services::services::{
    github::{
        audit::GitHubAuditService,
        auth::{DeviceFlowGitHubAuthProvider, GitHubAuthProvider},
        issue::GitHubIssueService,
        operation_approval::GitHubOperationApprovalService,
        pr::{
            GitHubCreatePrRequest, GitHubCreatePrResponse, GitHubPrPreview, GitHubPrPreviewRequest,
            GitHubPrService, GitHubRetryPrRequest,
        },
        rest_client::{
            GitHubApiErrorData, GitHubIssueDetail, GitHubIssueSummary, GitHubRepositorySummary,
            GitHubRestClient, GitHubRestError,
        },
    },
    project::{
        delivery::ProjectDeliveryService,
        work_item::{ProjectWorkItemDetail, ProjectWorkItemService},
    },
    repo_integration::{CreateProjectGitHubRepoIntegration, RepoIntegrationService},
};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

type GitHubApiResponse<T> = ApiResponse<T, GitHubApiErrorData>;

#[derive(Debug, Clone, Serialize, TS)]
pub struct IssueIntegrationProvider {
    pub id: String,
    pub name: String,
    pub supported: bool,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct ProjectIssueIntegrationsResponse {
    pub providers: Vec<IssueIntegrationProvider>,
    pub github_account: Option<services::services::github::auth::GitHubAccount>,
    pub github_repositories: Vec<GitHubRepositorySummary>,
    pub linked_repositories: Vec<RepoIntegration>,
    pub primary_repository: Option<RepoIntegration>,
}

#[derive(Debug, Deserialize, TS)]
pub struct GitHubIssueQuery {
    pub repo_integration_id: Uuid,
    pub q: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
pub struct DeliveryRecordsQuery {
    pub work_item_id: Option<Uuid>,
    pub repo_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, TS)]
pub struct DeliveryStatsQuery {
    #[ts(type = "string")]
    pub period_start: NaiveDate,
    #[ts(type = "string")]
    pub period_end: NaiveDate,
}

#[derive(Debug, Deserialize, TS)]
pub struct IssueCommentRequest {
    pub body: String,
    #[serde(default = "default_user_ui")]
    pub operation_source: GitHubOperationSource,
}

#[derive(Debug, Deserialize, TS)]
pub struct IssueStateRequest {
    pub state: String,
    #[serde(default = "default_user_ui")]
    pub operation_source: GitHubOperationSource,
}

#[derive(Debug, Deserialize, TS)]
pub struct IssueLabelsRequest {
    pub labels: Vec<String>,
    #[serde(default = "default_user_ui")]
    pub operation_source: GitHubOperationSource,
}

#[derive(Debug, Deserialize, TS)]
pub struct IssueAssigneesRequest {
    pub assignees: Vec<String>,
    #[serde(default = "default_user_ui")]
    pub operation_source: GitHubOperationSource,
}

#[derive(Debug, Deserialize, TS)]
pub struct PushBranchRequest {
    pub repo_integration_id: Uuid,
    pub head_branch: String,
    pub base_branch: Option<String>,
    pub title: Option<String>,
    pub body: Option<String>,
    pub work_item_id: Option<Uuid>,
    #[serde(default = "default_user_ui")]
    pub operation_source: GitHubOperationSource,
}

#[derive(Debug, Deserialize, TS)]
pub struct BranchListQuery {
    pub repo_integration_id: Uuid,
}

#[derive(Debug, Deserialize, TS)]
pub struct DenyGitHubOperationRequest {
    pub reason: Option<String>,
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route(
            "/projects/{project_id}/issue-integrations",
            get(issue_integrations),
        )
        .route(
            "/projects/{project_id}/github/repos",
            get(list_repos).post(create_repo),
        )
        .route(
            "/projects/{project_id}/github/repos/{repo_integration_id}",
            put(update_repo),
        )
        .route(
            "/projects/{project_id}/github/repos/{repo_integration_id}/disconnect",
            post(disconnect_repo),
        )
        .route(
            "/projects/{project_id}/github/repos/{repo_integration_id}/refresh",
            post(refresh_repo),
        )
        .route(
            "/projects/{project_id}/github/repos/{repo_integration_id}/status",
            get(repo_status),
        )
        .route(
            "/projects/{project_id}/work-items",
            get(list_work_items).post(create_work_item),
        )
        .route(
            "/projects/{project_id}/work-items/{work_item_id}",
            get(work_item_detail).put(update_work_item),
        )
        .route(
            "/projects/{project_id}/work-items/{work_item_id}/external-links",
            post(link_external),
        )
        .route(
            "/projects/{project_id}/work-items/{work_item_id}/external-links/{link_id}",
            axum::routing::delete(unlink_external),
        )
        .route(
            "/projects/{project_id}/work-items/{work_item_id}/execution-links",
            post(link_execution),
        )
        .route("/projects/{project_id}/github/issues", get(list_issues))
        .route(
            "/projects/{project_id}/github/issues/{repo_integration_id}/{number}",
            get(issue_detail),
        )
        .route(
            "/projects/{project_id}/github/issues/{repo_integration_id}/{number}/refresh",
            post(issue_refresh),
        )
        .route(
            "/projects/{project_id}/github/issues/{repo_integration_id}/{number}/comments",
            post(comment_issue),
        )
        .route(
            "/projects/{project_id}/github/issues/{repo_integration_id}/{number}/state",
            put(update_issue_state),
        )
        .route(
            "/projects/{project_id}/github/issues/{repo_integration_id}/{number}/labels",
            put(update_issue_labels),
        )
        .route(
            "/projects/{project_id}/github/issues/{repo_integration_id}/{number}/assignees",
            put(update_issue_assignees),
        )
        .route("/projects/{project_id}/github/branches", get(list_branches))
        .route("/projects/{project_id}/github/pr/preview", post(pr_preview))
        .route("/projects/{project_id}/github/pr/push", post(pr_push))
        .route("/projects/{project_id}/github/pr/create", post(pr_create))
        .route("/projects/{project_id}/github/pr/retry", post(pr_retry))
        .route(
            "/projects/{project_id}/delivery-records",
            get(delivery_records),
        )
        .route("/projects/{project_id}/delivery-stats", get(delivery_stats))
        .route("/projects/{project_id}/github/audits", get(github_audits))
        .route(
            "/projects/{project_id}/github/audits/{audit_id}/approve",
            post(approve_github_audit),
        )
        .route(
            "/projects/{project_id}/github/audits/{audit_id}/deny",
            post(deny_github_audit),
        )
}

fn default_user_ui() -> GitHubOperationSource {
    GitHubOperationSource::UserUi
}

async fn ensure_project(deployment: &DeploymentImpl, project_id: Uuid) -> Result<(), ApiError> {
    if Project::find_by_id(&deployment.db().pool, project_id)
        .await?
        .is_none()
    {
        return Err(ApiError::Project(ProjectError::ProjectNotFound));
    }
    Ok(())
}

fn github_auth_provider() -> Result<DeviceFlowGitHubAuthProvider, ApiError> {
    DeviceFlowGitHubAuthProvider::from_env()
        .map_err(|err| ApiError::BadRequest(format!("GitHub auth setup failed: {err}")))
}

async fn github_client() -> Result<GitHubRestClient, ApiError> {
    let provider = github_auth_provider()?;
    let token = provider
        .access_token()
        .await
        .map_err(|err| ApiError::BadRequest(format!("GitHub auth required: {err}")))?;
    Ok(GitHubRestClient::new(SecretString::from(
        token.token.expose_secret().to_string(),
    )))
}

async fn ensure_github_project_connected(
    deployment: &DeploymentImpl,
    project_id: Uuid,
    repo_integration_id: Uuid,
) -> Result<Result<RepoIntegration, GitHubApiErrorData>, ApiError> {
    match RepoIntegrationService::new()
        .ensure_project_connected(&deployment.db().pool, project_id, repo_integration_id)
        .await
    {
        Ok(integration) => Ok(Ok(integration)),
        Err(err) => Ok(Err(github_local_error_data(
            "github_repo_disconnected",
            err.to_string(),
        ))),
    }
}

async fn issue_integrations(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<GitHubApiResponse<ProjectIssueIntegrationsResponse>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let linked_repositories = RepoIntegrationService::new()
        .list_repo_integrations(&deployment.db().pool, project_id)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    let primary_repository = primary_github_repository(&linked_repositories);
    let auth_provider = github_auth_provider()?;
    let github_account = auth_provider
        .current_account()
        .await
        .map_err(|err| ApiError::BadRequest(format!("GitHub account lookup failed: {err}")))?;
    let github_repositories = if github_account.is_some() {
        let token = match auth_provider.access_token().await {
            Ok(token) => token,
            Err(err) => {
                return Ok(ResponseJson(ApiResponse::error_with_data(
                    github_local_error_data("github_auth_required", err.to_string()),
                )));
            }
        };
        let client =
            GitHubRestClient::new(SecretString::from(token.token.expose_secret().to_string()));
        match client.list_authenticated_repositories().await {
            Ok(repos) => repos,
            Err(GitHubRestError::Api(data)) => {
                return Ok(ResponseJson(ApiResponse::error_with_data(data)));
            }
            Err(err) => {
                return Ok(ResponseJson(ApiResponse::error_with_data(
                    github_local_error_data("github_write_failed", err.to_string()),
                )));
            }
        }
    } else {
        Vec::new()
    };
    let providers =
        issue_integration_providers(github_account.is_some(), primary_repository.is_some());
    Ok(ResponseJson(ApiResponse::success(
        ProjectIssueIntegrationsResponse {
            providers,
            github_account,
            github_repositories,
            linked_repositories,
            primary_repository,
        },
    )))
}

async fn list_repos(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<RepoIntegration>>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let rows = RepoIntegrationService::new()
        .list_repo_integrations(&deployment.db().pool, project_id)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(rows)))
}

async fn create_repo(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(mut payload): Json<CreateProjectGitHubRepoIntegration>,
) -> Result<ResponseJson<GitHubApiResponse<RepoIntegration>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let auth_provider = github_auth_provider()?;
    let account = match auth_provider.current_account().await {
        Ok(Some(account)) => account,
        Ok(None) => {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_local_error_data("github_auth_required", "GitHub account is not authorized"),
            )));
        }
        Err(err) => {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_local_error_data("github_auth_required", err.to_string()),
            )));
        }
    };
    if payload.github_account_id.is_none() {
        payload.github_account_id = Some(account.id.to_string());
    }
    if payload.repo_grant_json.is_none() {
        payload.repo_grant_json = Some(serde_json::json!({
            "permissions": ["metadata", "contents", "issues", "pull_requests"]
        }));
    }
    let row = RepoIntegrationService::new()
        .create_project_github_repo_integration(&deployment.db().pool, project_id, payload)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(row)))
}

async fn update_repo(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, repo_integration_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateRepoIntegration>,
) -> Result<ResponseJson<ApiResponse<RepoIntegration>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let row = RepoIntegrationService::new()
        .update_project_repo_integration(
            &deployment.db().pool,
            project_id,
            repo_integration_id,
            payload,
        )
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(row)))
}

async fn disconnect_repo(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, repo_integration_id)): Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<RepoIntegration>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let row = RepoIntegrationService::new()
        .disconnect_project_repo_integration(
            &deployment.db().pool,
            project_id,
            repo_integration_id,
            Some("Disconnected by user".to_string()),
        )
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(row)))
}

async fn refresh_repo(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, repo_integration_id)): Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<RepoIntegration>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let client = github_client().await?;
    let row = RepoIntegrationService::new()
        .refresh_project_repo_integration(
            &deployment.db().pool,
            project_id,
            repo_integration_id,
            &client,
        )
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(row)))
}

async fn repo_status(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, repo_integration_id)): Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<RepoIntegration>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let row = RepoIntegration::find_by_project(&deployment.db().pool, project_id)
        .await?
        .into_iter()
        .find(|row| row.id == repo_integration_id)
        .ok_or_else(|| ApiError::BadRequest("Repo integration not found".to_string()))?;
    Ok(ResponseJson(ApiResponse::success(row)))
}

async fn list_work_items(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<ProjectWorkItem>>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let rows = ProjectWorkItemService::new()
        .list(&deployment.db().pool, project_id)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(rows)))
}

async fn create_work_item(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(payload): Json<CreateProjectWorkItem>,
) -> Result<ResponseJson<ApiResponse<ProjectWorkItem>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let row = ProjectWorkItemService::new()
        .create(&deployment.db().pool, project_id, payload)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(row)))
}

async fn work_item_detail(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, work_item_id)): Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<ProjectWorkItemDetail>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let row = ProjectWorkItemService::new()
        .detail(&deployment.db().pool, project_id, work_item_id)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(row)))
}

async fn update_work_item(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, work_item_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateProjectWorkItem>,
) -> Result<ResponseJson<ApiResponse<ProjectWorkItem>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let row = ProjectWorkItemService::new()
        .update(&deployment.db().pool, project_id, work_item_id, payload)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(row)))
}

async fn link_external(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, work_item_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<CreateProjectWorkItemExternalLink>,
) -> Result<ResponseJson<ApiResponse<ProjectWorkItemExternalLink>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let row = ProjectWorkItemService::new()
        .link_external(&deployment.db().pool, project_id, work_item_id, payload)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(row)))
}

async fn unlink_external(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, work_item_id, link_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    ProjectWorkItemService::new()
        .unlink_external(&deployment.db().pool, project_id, work_item_id, link_id)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(())))
}

async fn link_execution(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, work_item_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<CreateProjectWorkItemExecutionLink>,
) -> Result<ResponseJson<ApiResponse<ProjectWorkItemExecutionLink>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let row = ProjectWorkItemService::new()
        .link_execution(&deployment.db().pool, project_id, work_item_id, payload)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(row)))
}

async fn list_issues(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<GitHubIssueQuery>,
) -> Result<ResponseJson<GitHubApiResponse<Vec<GitHubIssueSummary>>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    if let Err(error_data) =
        ensure_github_project_connected(&deployment, project_id, query.repo_integration_id).await?
    {
        return Ok(ResponseJson(ApiResponse::error_with_data(error_data)));
    }
    let rows = GitHubIssueService::new()
        .list_or_search(
            &deployment.db().pool,
            &match github_client().await {
                Ok(client) => client,
                Err(err) => {
                    return Ok(ResponseJson(ApiResponse::error_with_data(
                        github_local_error_data("github_auth_required", err.to_string()),
                    )));
                }
            },
            query.repo_integration_id,
            query.q,
        )
        .await;
    let rows = match rows {
        Ok(rows) => rows,
        Err(err) => {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_local_error_data("github_stale_cache", err.to_string()),
            )));
        }
    };
    Ok(ResponseJson(ApiResponse::success(rows)))
}

async fn issue_detail(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, repo_integration_id, number)): Path<(Uuid, Uuid, i64)>,
) -> Result<ResponseJson<GitHubApiResponse<GitHubIssueDetail>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    if let Err(error_data) =
        ensure_github_project_connected(&deployment, project_id, repo_integration_id).await?
    {
        return Ok(ResponseJson(ApiResponse::error_with_data(error_data)));
    }
    let row = GitHubIssueService::new()
        .detail(
            &deployment.db().pool,
            &match github_client().await {
                Ok(client) => client,
                Err(err) => {
                    return Ok(ResponseJson(ApiResponse::error_with_data(
                        github_local_error_data("github_auth_required", err.to_string()),
                    )));
                }
            },
            repo_integration_id,
            number,
        )
        .await;
    let row = match row {
        Ok(row) => row,
        Err(err) => {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_local_error_data("github_stale_cache", err.to_string()),
            )));
        }
    };
    Ok(ResponseJson(ApiResponse::success(row)))
}

async fn issue_refresh(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, repo_integration_id, number)): Path<(Uuid, Uuid, i64)>,
) -> Result<ResponseJson<GitHubApiResponse<GitHubIssueDetail>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    if let Err(error_data) =
        ensure_github_project_connected(&deployment, project_id, repo_integration_id).await?
    {
        return Ok(ResponseJson(ApiResponse::error_with_data(error_data)));
    }
    let client = match github_client().await {
        Ok(client) => client,
        Err(err) => {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_local_error_data("github_auth_required", err.to_string()),
            )));
        }
    };
    let row = GitHubIssueService::new()
        .refresh(&deployment.db().pool, &client, repo_integration_id, number)
        .await;
    match row {
        Ok(row) => Ok(ResponseJson(ApiResponse::success(row))),
        Err(err) => Ok(ResponseJson(ApiResponse::error_with_data(
            github_local_error_data("github_stale_cache", err.to_string()),
        ))),
    }
}

async fn comment_issue(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, repo_integration_id, number)): Path<(Uuid, Uuid, i64)>,
    Json(payload): Json<IssueCommentRequest>,
) -> Result<ResponseJson<GitHubApiResponse<GitHubOperationResult>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let integration = match ensure_github_project_connected(
        &deployment,
        project_id,
        repo_integration_id,
    )
    .await?
    {
        Ok(integration) => integration,
        Err(error_data) => {
            return Ok(ResponseJson(ApiResponse::error_with_data(error_data)));
        }
    };
    let client = match client_for_source(payload.operation_source.clone()).await {
        Ok(client) => client,
        Err(err) => {
            GitHubAuditService::new()
                .record(
                    &deployment.db().pool,
                    CreateGitHubOperationAudit {
                        actor: Some(deployment.user_id().to_string()),
                        operation_source: payload.operation_source,
                        session_id: None,
                        workflow_execution_id: None,
                        repo_id: Some(integration.repo_id),
                        target_type: GitHubTargetType::Issue,
                        target_id: Some(number.to_string()),
                        action: "issue_comment".to_string(),
                        result: GitHubOperationResult::Failed,
                        error: Some(err.to_string()),
                    },
                )
                .await
                .map_err(|err| ApiError::BadRequest(err.to_string()))?;
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_local_error_data("github_auth_required", err.to_string()),
            )));
        }
    };
    let result = GitHubIssueService::new()
        .create_comment(
            &deployment.db().pool,
            &client,
            project_id,
            repo_integration_id,
            number,
            payload.body,
            payload.operation_source,
            Some(deployment.user_id().to_string()),
        )
        .await;
    let result = match result {
        Ok(result) => result,
        Err(err) => {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_local_error_data("github_write_failed", err.to_string()),
            )));
        }
    };
    Ok(ResponseJson(ApiResponse::success(result)))
}

async fn update_issue_state(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, repo_integration_id, number)): Path<(Uuid, Uuid, i64)>,
    Json(payload): Json<IssueStateRequest>,
) -> Result<ResponseJson<GitHubApiResponse<GitHubIssueSummary>>, ApiError> {
    issue_write(
        deployment,
        project_id,
        repo_integration_id,
        number,
        payload.operation_source,
        "issue_state",
        GitHubPendingOperationKind::IssueState,
        serde_json::json!({ "state": payload.state.clone() }),
        |client, owner, repo| async move {
            client
                .update_issue_state(&owner, &repo, number, &payload.state)
                .await
        },
    )
    .await
}

async fn update_issue_labels(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, repo_integration_id, number)): Path<(Uuid, Uuid, i64)>,
    Json(payload): Json<IssueLabelsRequest>,
) -> Result<ResponseJson<GitHubApiResponse<Vec<String>>>, ApiError> {
    issue_write(
        deployment,
        project_id,
        repo_integration_id,
        number,
        payload.operation_source,
        "issue_labels",
        GitHubPendingOperationKind::IssueLabels,
        serde_json::json!({ "labels": payload.labels.clone() }),
        |client, owner, repo| async move {
            client
                .replace_labels(&owner, &repo, number, payload.labels)
                .await
        },
    )
    .await
}

async fn update_issue_assignees(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, repo_integration_id, number)): Path<(Uuid, Uuid, i64)>,
    Json(payload): Json<IssueAssigneesRequest>,
) -> Result<ResponseJson<GitHubApiResponse<GitHubIssueSummary>>, ApiError> {
    issue_write(
        deployment,
        project_id,
        repo_integration_id,
        number,
        payload.operation_source,
        "issue_assignees",
        GitHubPendingOperationKind::IssueAssignees,
        serde_json::json!({ "assignees": payload.assignees.clone() }),
        |client, owner, repo| async move {
            client
                .replace_assignees(&owner, &repo, number, payload.assignees)
                .await
        },
    )
    .await
}

async fn issue_write<T, F, Fut>(
    deployment: DeploymentImpl,
    project_id: Uuid,
    repo_integration_id: Uuid,
    number: i64,
    source: GitHubOperationSource,
    action: &str,
    pending_kind: GitHubPendingOperationKind,
    pending_payload: serde_json::Value,
    operation: F,
) -> Result<ResponseJson<GitHubApiResponse<T>>, ApiError>
where
    T: serde::Serialize,
    F: FnOnce(GitHubRestClient, String, String) -> Fut,
    Fut: std::future::Future<
            Output = Result<T, services::services::github::rest_client::GitHubRestError>,
        >,
{
    ensure_project(&deployment, project_id).await?;
    let integration = match ensure_github_project_connected(
        &deployment,
        project_id,
        repo_integration_id,
    )
    .await?
    {
        Ok(integration) => integration,
        Err(error_data) => {
            return Ok(ResponseJson(ApiResponse::error_with_data(error_data)));
        }
    };
    let audit_result = if source == GitHubOperationSource::Agent {
        GitHubOperationResult::PendingApproval
    } else {
        GitHubOperationResult::Approved
    };
    let audit = GitHubAuditService::new()
        .record(
            &deployment.db().pool,
            CreateGitHubOperationAudit {
                actor: Some(deployment.user_id().to_string()),
                operation_source: source.clone(),
                session_id: None,
                workflow_execution_id: None,
                repo_id: Some(integration.repo_id),
                target_type: GitHubTargetType::Issue,
                target_id: Some(number.to_string()),
                action: action.to_string(),
                result: audit_result.clone(),
                error: None,
            },
        )
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    if source == GitHubOperationSource::Agent {
        GitHubPendingOperation::create(
            &deployment.db().pool,
            CreateGitHubPendingOperation {
                project_id,
                repo_integration_id,
                audit_id: audit.id,
                operation_kind: pending_kind,
                target_type: GitHubTargetType::Issue,
                target_id: Some(number.to_string()),
                payload_json: pending_payload.to_string(),
            },
        )
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
        return Ok(ResponseJson(ApiResponse::error_with_data(
            github_local_error_data(
                "github_write_pending_approval",
                "GitHub write operation is pending user approval",
            ),
        )));
    }
    let owner = integration
        .owner
        .ok_or_else(|| ApiError::BadRequest("Repo owner missing".to_string()))?;
    let repo = integration
        .name
        .ok_or_else(|| ApiError::BadRequest("Repo name missing".to_string()))?;
    let client = match github_client().await {
        Ok(client) => client,
        Err(err) => {
            GitHubAuditService::new()
                .update_result(
                    &deployment.db().pool,
                    audit.id,
                    GitHubOperationResult::Failed,
                    Some(err.to_string()),
                )
                .await
                .map_err(|err| ApiError::BadRequest(err.to_string()))?;
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_local_error_data("github_auth_required", err.to_string()),
            )));
        }
    };
    let result = operation(client, owner, repo).await;
    GitHubAuditService::new()
        .update_result(
            &deployment.db().pool,
            audit.id,
            if result.is_ok() {
                GitHubOperationResult::Success
            } else {
                GitHubOperationResult::Failed
            },
            result.as_ref().err().map(ToString::to_string),
        )
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    let result = match result {
        Ok(result) => result,
        Err(err) => {
            return Ok(ResponseJson(ApiResponse::error_with_data(rest_error_data(
                &err,
            ))));
        }
    };
    Ok(ResponseJson(ApiResponse::success(result)))
}

async fn list_branches(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<BranchListQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<String>>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let rows = GitHubPrService::new()
        .list_branches(&deployment.db().pool, project_id, query.repo_integration_id)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(rows)))
}

async fn pr_preview(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(payload): Json<GitHubPrPreviewRequest>,
) -> Result<ResponseJson<GitHubApiResponse<GitHubPrPreview>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let row = GitHubPrService::new()
        .preview(&deployment.db().pool, project_id, payload)
        .await;
    let row = match row {
        Ok(row) => row,
        Err(err) => {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_pr_error_data(&err, "github_write_failed"),
            )));
        }
    };
    Ok(ResponseJson(ApiResponse::success(row)))
}

async fn pr_push(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(payload): Json<PushBranchRequest>,
) -> Result<ResponseJson<GitHubApiResponse<()>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let result = GitHubPrService::new()
        .push_head(
            &deployment.db().pool,
            project_id,
            payload.repo_integration_id,
            payload.head_branch,
            payload.base_branch,
            payload.title,
            payload.body,
            payload.work_item_id,
            payload.operation_source,
            Some(deployment.user_id().to_string()),
        )
        .await;
    match result {
        Ok(GitHubOperationResult::PendingApproval) => Ok(ResponseJson(
            ApiResponse::error_with_data(github_local_error_data(
                "github_write_pending_approval",
                "GitHub write operation is pending user approval",
            )),
        )),
        Ok(_) => Ok(ResponseJson(ApiResponse::success(()))),
        Err(err) => Ok(ResponseJson(ApiResponse::error_with_data(
            github_pr_error_data(&err, "local_git_push_failed"),
        ))),
    }
}

async fn pr_create(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(payload): Json<GitHubCreatePrRequest>,
) -> Result<ResponseJson<GitHubApiResponse<GitHubCreatePrResponse>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let client = match client_for_source(payload.operation_source.clone()).await {
        Ok(client) => client,
        Err(err) => {
            let integration = RepoIntegrationService::new()
                .ensure_project_integration(
                    &deployment.db().pool,
                    project_id,
                    payload.repo_integration_id,
                )
                .await;
            let integration = match integration {
                Ok(integration) => integration,
                Err(gating_err) => {
                    return Ok(ResponseJson(ApiResponse::error_with_data(
                        github_local_error_data("github_repo_disconnected", gating_err.to_string()),
                    )));
                }
            };
            GitHubAuditService::new()
                .record(
                    &deployment.db().pool,
                    CreateGitHubOperationAudit {
                        actor: Some(deployment.user_id().to_string()),
                        operation_source: payload.operation_source,
                        session_id: None,
                        workflow_execution_id: None,
                        repo_id: Some(integration.repo_id),
                        target_type: GitHubTargetType::PullRequest,
                        target_id: Some(payload.head_branch),
                        action: "create_pr".to_string(),
                        result: GitHubOperationResult::Failed,
                        error: Some(err.to_string()),
                    },
                )
                .await
                .map_err(|err| ApiError::BadRequest(err.to_string()))?;
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_local_error_data("github_auth_required", err.to_string()),
            )));
        }
    };
    let response = GitHubPrService::new()
        .create_pr(
            &deployment.db().pool,
            &client,
            project_id,
            payload,
            Some(deployment.user_id().to_string()),
        )
        .await;
    let response = match response {
        Ok(response) => response,
        Err(err) => {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_pr_error_data(&err, "github_write_failed"),
            )));
        }
    };
    Ok(ResponseJson(ApiResponse::success(response)))
}

async fn pr_retry(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(payload): Json<GitHubRetryPrRequest>,
) -> Result<ResponseJson<GitHubApiResponse<GitHubCreatePrResponse>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let client = match client_for_source(payload.operation_source.clone()).await {
        Ok(client) => client,
        Err(err) => {
            if let Some(pending) =
                GitHubPendingPrCreation::find_by_id(&deployment.db().pool, payload.pending_pr_id)
                    .await?
                && pending.project_id == project_id
            {
                let repo_id = RepoIntegrationService::new()
                    .ensure_project_integration(
                        &deployment.db().pool,
                        project_id,
                        pending.repo_integration_id,
                    )
                    .await
                    .ok()
                    .map(|integration| integration.repo_id);
                GitHubAuditService::new()
                    .record(
                        &deployment.db().pool,
                        CreateGitHubOperationAudit {
                            actor: Some(deployment.user_id().to_string()),
                            operation_source: payload.operation_source,
                            session_id: None,
                            workflow_execution_id: None,
                            repo_id,
                            target_type: GitHubTargetType::PullRequest,
                            target_id: pending
                                .pull_request_number
                                .map(|number| number.to_string())
                                .or(Some(pending.head_branch)),
                            action: "pr_retry".to_string(),
                            result: GitHubOperationResult::Failed,
                            error: Some(err.to_string()),
                        },
                    )
                    .await
                    .map_err(|err| ApiError::BadRequest(err.to_string()))?;
            }
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_local_error_data("github_auth_required", err.to_string()),
            )));
        }
    };
    let pending_pr_id = payload.pending_pr_id;
    let response = GitHubPrService::new()
        .retry_pending_pr(
            &deployment.db().pool,
            &client,
            project_id,
            payload,
            Some(deployment.user_id().to_string()),
        )
        .await;
    let response = match response {
        Ok(response) => response,
        Err(err) => {
            if let Some(pending) =
                GitHubPendingPrCreation::find_by_id(&deployment.db().pool, pending_pr_id).await?
                && pending.project_id == project_id
            {
                GitHubPendingPrCreation::update(
                    &deployment.db().pool,
                    pending.id,
                    UpdateGitHubPendingPrCreation {
                        audit_id: pending.audit_id,
                        status: pending.status,
                        pull_request_number: pending.pull_request_number,
                        pull_request_url: pending.pull_request_url,
                        last_error: Some(err.to_string()),
                    },
                )
                .await?;
            }
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_pr_error_data(&err, "github_write_failed"),
            )));
        }
    };
    Ok(ResponseJson(ApiResponse::success(response)))
}

async fn client_for_source(source: GitHubOperationSource) -> Result<GitHubRestClient, ApiError> {
    if source == GitHubOperationSource::Agent {
        return Ok(GitHubRestClient::new(SecretString::from(String::new())));
    }
    github_client().await
}

fn rest_error_data(err: &GitHubRestError) -> GitHubApiErrorData {
    match err {
        GitHubRestError::Api(data) => data.clone(),
        GitHubRestError::Http(http) => GitHubApiErrorData {
            code: "github_write_failed".to_string(),
            message: http.to_string(),
            retry_after: None,
            last_synced_at: None,
            stale: false,
        },
    }
}

fn github_local_error_data(code: &str, message: impl Into<String>) -> GitHubApiErrorData {
    GitHubApiErrorData {
        code: code.to_string(),
        message: message.into(),
        retry_after: None,
        last_synced_at: None,
        stale: false,
    }
}

fn github_pr_error_data(err: &anyhow::Error, fallback_code: &str) -> GitHubApiErrorData {
    let message = err.to_string();
    let code = if message.contains("github_repo_disconnected")
        || message.contains("Repo integration not found")
        || message.contains("Repository does not belong to project")
    {
        "github_repo_disconnected"
    } else if message.contains("local_git_push_failed") {
        "local_git_push_failed"
    } else {
        fallback_code
    };
    github_local_error_data(code, message)
}

fn primary_github_repository(integrations: &[RepoIntegration]) -> Option<RepoIntegration> {
    let is_active_github = |integration: &&RepoIntegration| {
        integration.provider == "github"
            && integration.sync_status == RepoIntegrationSyncStatus::Connected
    };
    integrations
        .iter()
        .find(|integration| {
            is_active_github(integration) && integration.role == RepoIntegrationRole::Primary
        })
        .cloned()
        .or_else(|| integrations.iter().find(is_active_github).cloned())
}

fn issue_integration_providers(
    github_authorized: bool,
    github_linked: bool,
) -> Vec<IssueIntegrationProvider> {
    let github_status = if github_linked {
        "linked"
    } else if github_authorized {
        "authorized"
    } else {
        "auth_required"
    };
    vec![
        IssueIntegrationProvider {
            id: "github".to_string(),
            name: "GitHub".to_string(),
            supported: true,
            status: github_status.to_string(),
        },
        IssueIntegrationProvider {
            id: "linear".to_string(),
            name: "Linear".to_string(),
            supported: false,
            status: "unsupported".to_string(),
        },
        IssueIntegrationProvider {
            id: "jira".to_string(),
            name: "Jira".to_string(),
            supported: false,
            status: "unsupported".to_string(),
        },
    ]
}

async fn delivery_records(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<DeliveryRecordsQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<ProjectDeliveryRecord>>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let rows = ProjectDeliveryService::new()
        .list_records(
            &deployment.db().pool,
            project_id,
            query.work_item_id,
            query.repo_id,
        )
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(rows)))
}

async fn delivery_stats(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<DeliveryStatsQuery>,
) -> Result<ResponseJson<ApiResponse<ProjectDeliveryStatsSummary>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let stats = ProjectDeliveryService::new()
        .stats_summary(
            &deployment.db().pool,
            project_id,
            query.period_start,
            query.period_end,
        )
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(stats)))
}

async fn github_audits(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<DeliveryRecordsQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<GitHubOperationAudit>>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let rows = GitHubAuditService::new()
        .list_by_project(
            &deployment.db().pool,
            project_id,
            query.repo_id,
            query.work_item_id,
        )
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Ok(ResponseJson(ApiResponse::success(rows)))
}

async fn approve_github_audit(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, audit_id)): Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<GitHubApiResponse<GitHubOperationAudit>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let audits = GitHubAuditService::new()
        .list_by_project(&deployment.db().pool, project_id, None, None)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    if !audits.iter().any(|audit| audit.id == audit_id) {
        return Err(ApiError::BadRequest("GitHub audit not found".to_string()));
    }
    if let Some(pending) =
        GitHubPendingOperation::find_by_audit_id(&deployment.db().pool, audit_id).await?
    {
        if pending.status != GitHubPendingOperationStatus::PendingApproval {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_local_error_data(
                    "github_write_not_retryable",
                    "GitHub write operation is not pending approval",
                ),
            )));
        }
        let audit = GitHubOperationApprovalService::new()
            .approve(&deployment.db().pool, audit_id)
            .await
            .map_err(|err| ApiError::BadRequest(err.to_string()))?;
        return execute_pending_github_operation(deployment, project_id, pending, audit).await;
    }
    let mut audit = GitHubOperationApprovalService::new()
        .approve(&deployment.db().pool, audit_id)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    if let Some(pending_pr) =
        GitHubPendingPrCreation::find_by_audit_id(&deployment.db().pool, audit_id).await?
    {
        let client = match github_client().await {
            Ok(client) => client,
            Err(err) => {
                GitHubAuditService::new()
                    .update_result(
                        &deployment.db().pool,
                        audit_id,
                        GitHubOperationResult::Failed,
                        Some(err.to_string()),
                    )
                    .await
                    .map_err(|err| ApiError::BadRequest(err.to_string()))?;
                return Ok(ResponseJson(ApiResponse::error_with_data(
                    github_local_error_data("github_auth_required", err.to_string()),
                )));
            }
        };
        let response = GitHubPrService::new()
            .retry_pending_pr(
                &deployment.db().pool,
                &client,
                project_id,
                GitHubRetryPrRequest {
                    pending_pr_id: pending_pr.id,
                    operation_source: GitHubOperationSource::UserUi,
                },
                Some(deployment.user_id().to_string()),
            )
            .await;
        let response = match response {
            Ok(response) => response,
            Err(err) => {
                GitHubPendingPrCreation::update(
                    &deployment.db().pool,
                    pending_pr.id,
                    UpdateGitHubPendingPrCreation {
                        audit_id: Some(audit_id),
                        status: pending_pr.status,
                        pull_request_number: pending_pr.pull_request_number,
                        pull_request_url: pending_pr.pull_request_url,
                        last_error: Some(err.to_string()),
                    },
                )
                .await?;
                GitHubAuditService::new()
                    .update_result(
                        &deployment.db().pool,
                        audit_id,
                        GitHubOperationResult::Failed,
                        Some(err.to_string()),
                    )
                    .await
                    .map_err(|err| ApiError::BadRequest(err.to_string()))?;
                return Ok(ResponseJson(ApiResponse::error_with_data(
                    github_pr_error_data(&err, "github_write_failed"),
                )));
            }
        };
        audit = GitHubAuditService::new()
            .update_result(
                &deployment.db().pool,
                audit_id,
                response.result,
                response.pending_pr.and_then(|pending| pending.last_error),
            )
            .await
            .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    }
    Ok(ResponseJson(ApiResponse::success(audit)))
}

async fn execute_pending_github_operation(
    deployment: DeploymentImpl,
    project_id: Uuid,
    pending: GitHubPendingOperation,
    audit: GitHubOperationAudit,
) -> Result<ResponseJson<GitHubApiResponse<GitHubOperationAudit>>, ApiError> {
    if pending.project_id != project_id {
        return Err(ApiError::BadRequest("GitHub audit not found".to_string()));
    }
    if pending.status != GitHubPendingOperationStatus::PendingApproval {
        return Ok(ResponseJson(ApiResponse::error_with_data(
            github_local_error_data(
                "github_write_not_retryable",
                "GitHub write operation is not pending approval",
            ),
        )));
    }
    let integration =
        match ensure_github_project_connected(&deployment, project_id, pending.repo_integration_id)
            .await?
        {
            Ok(integration) => integration,
            Err(error_data) => {
                let error = Some(error_data.message.clone());
                GitHubPendingOperation::update_status(
                    &deployment.db().pool,
                    pending.id,
                    GitHubPendingOperationStatus::Failed,
                    error.clone(),
                )
                .await?;
                GitHubAuditService::new()
                    .update_result(
                        &deployment.db().pool,
                        audit.id,
                        GitHubOperationResult::Failed,
                        error,
                    )
                    .await
                    .map_err(|err| ApiError::BadRequest(err.to_string()))?;
                return Ok(ResponseJson(ApiResponse::error_with_data(error_data)));
            }
        };
    let owner = integration
        .owner
        .ok_or_else(|| ApiError::BadRequest("Repo owner missing".to_string()))?;
    let repo = integration
        .name
        .ok_or_else(|| ApiError::BadRequest("Repo name missing".to_string()))?;
    let number = pending
        .target_id
        .as_deref()
        .ok_or_else(|| ApiError::BadRequest("GitHub issue target missing".to_string()))?
        .parse::<i64>()
        .map_err(|_| ApiError::BadRequest("GitHub issue target is invalid".to_string()))?;
    let payload: serde_json::Value = serde_json::from_str(&pending.payload_json)
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    let client = match github_client().await {
        Ok(client) => client,
        Err(err) => {
            let message = err.to_string();
            GitHubPendingOperation::update_status(
                &deployment.db().pool,
                pending.id,
                GitHubPendingOperationStatus::Failed,
                Some(message.clone()),
            )
            .await?;
            GitHubAuditService::new()
                .update_result(
                    &deployment.db().pool,
                    audit.id,
                    GitHubOperationResult::Failed,
                    Some(message.clone()),
                )
                .await
                .map_err(|err| ApiError::BadRequest(err.to_string()))?;
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_local_error_data("github_auth_required", message),
            )));
        }
    };
    let result = match pending.operation_kind {
        GitHubPendingOperationKind::IssueComment => {
            let body = payload
                .get("body")
                .and_then(|value| value.as_str())
                .ok_or_else(|| ApiError::BadRequest("GitHub comment body missing".to_string()))?;
            client
                .create_issue_comment(&owner, &repo, number, body)
                .await
                .map(|_| ())
        }
        GitHubPendingOperationKind::IssueState => {
            let state = payload
                .get("state")
                .and_then(|value| value.as_str())
                .ok_or_else(|| ApiError::BadRequest("GitHub issue state missing".to_string()))?;
            client
                .update_issue_state(&owner, &repo, number, state)
                .await
                .map(|_| ())
        }
        GitHubPendingOperationKind::IssueLabels => {
            let labels = payload
                .get("labels")
                .and_then(|value| value.as_array())
                .ok_or_else(|| ApiError::BadRequest("GitHub labels missing".to_string()))?
                .iter()
                .filter_map(|value| value.as_str().map(ToOwned::to_owned))
                .collect::<Vec<_>>();
            client
                .replace_labels(&owner, &repo, number, labels)
                .await
                .map(|_| ())
        }
        GitHubPendingOperationKind::IssueAssignees => {
            let assignees = payload
                .get("assignees")
                .and_then(|value| value.as_array())
                .ok_or_else(|| ApiError::BadRequest("GitHub assignees missing".to_string()))?
                .iter()
                .filter_map(|value| value.as_str().map(ToOwned::to_owned))
                .collect::<Vec<_>>();
            client
                .replace_assignees(&owner, &repo, number, assignees)
                .await
                .map(|_| ())
        }
    };
    let error_data = result.as_ref().err().map(rest_error_data);
    let (audit_result, pending_status, error) = match result {
        Ok(()) => (
            GitHubOperationResult::Success,
            GitHubPendingOperationStatus::Completed,
            None,
        ),
        Err(err) => (
            GitHubOperationResult::Failed,
            GitHubPendingOperationStatus::Failed,
            Some(err.to_string()),
        ),
    };
    GitHubPendingOperation::update_status(
        &deployment.db().pool,
        pending.id,
        pending_status,
        error.clone(),
    )
    .await?;
    let audit = GitHubAuditService::new()
        .update_result(&deployment.db().pool, audit.id, audit_result.clone(), error)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    if audit_result == GitHubOperationResult::Failed {
        return Ok(ResponseJson(ApiResponse::error_with_data(
            error_data.unwrap_or_else(|| {
                github_local_error_data(
                    "github_write_failed",
                    audit
                        .error
                        .clone()
                        .unwrap_or_else(|| "GitHub write failed".to_string()),
                )
            }),
        )));
    }
    Ok(ResponseJson(ApiResponse::success(audit)))
}

async fn deny_github_audit(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, audit_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<DenyGitHubOperationRequest>,
) -> Result<ResponseJson<ApiResponse<GitHubOperationAudit>>, ApiError> {
    ensure_project(&deployment, project_id).await?;
    let audits = GitHubAuditService::new()
        .list_by_project(&deployment.db().pool, project_id, None, None)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    if !audits.iter().any(|audit| audit.id == audit_id) {
        return Err(ApiError::BadRequest("GitHub audit not found".to_string()));
    }
    let audit = GitHubOperationApprovalService::new()
        .deny(&deployment.db().pool, audit_id, payload.reason)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    if let Some(pending) =
        GitHubPendingOperation::find_by_audit_id(&deployment.db().pool, audit_id).await?
    {
        GitHubPendingOperation::update_status(
            &deployment.db().pool,
            pending.id,
            GitHubPendingOperationStatus::Denied,
            audit.error.clone(),
        )
        .await?;
    }
    Ok(ResponseJson(ApiResponse::success(audit)))
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::{
        github_operation_audit::GitHubOperationSource,
        repo_integration::{RepoIntegration, RepoIntegrationRole, RepoIntegrationSyncStatus},
    };
    use serde_json::json;
    use uuid::Uuid;

    use super::{
        IssueCommentRequest, PushBranchRequest, github_local_error_data, github_pr_error_data,
        issue_integration_providers, primary_github_repository,
    };

    #[test]
    fn project_github_issue_comment_defaults_to_user_ui_source() {
        let payload: IssueCommentRequest =
            serde_json::from_value(json!({ "body": "looks good" })).expect("deserialize");
        assert_eq!(payload.operation_source, GitHubOperationSource::UserUi);
    }

    #[test]
    fn project_github_push_request_preserves_pr_retry_context() {
        let payload: PushBranchRequest = serde_json::from_value(json!({
            "repo_integration_id": "018f6c7a-2bde-7c51-9876-111111111111",
            "head_branch": "feature/github",
            "base_branch": "main",
            "title": "Ship GitHub integration",
            "body": "Ready for review",
            "work_item_id": "018f6c7a-2bde-7c51-9876-222222222222"
        }))
        .expect("deserialize");

        assert_eq!(payload.base_branch.as_deref(), Some("main"));
        assert_eq!(payload.title.as_deref(), Some("Ship GitHub integration"));
        assert_eq!(payload.body.as_deref(), Some("Ready for review"));
        assert!(payload.work_item_id.is_some());
        assert_eq!(payload.operation_source, GitHubOperationSource::UserUi);
    }

    #[test]
    fn project_github_push_request_accepts_agent_source_for_approval_gating() {
        let payload: PushBranchRequest = serde_json::from_value(json!({
            "repo_integration_id": "018f6c7a-2bde-7c51-9876-111111111111",
            "head_branch": "feature/github",
            "operation_source": "agent"
        }))
        .expect("deserialize");

        assert_eq!(payload.operation_source, GitHubOperationSource::Agent);
    }

    #[test]
    fn project_github_error_data_contract_carries_code_and_message() {
        let data = github_local_error_data("github_rate_limited", "rate limit exceeded");

        assert_eq!(data.code, "github_rate_limited");
        assert_eq!(data.message, "rate limit exceeded");
        assert!(!data.stale);
    }

    #[test]
    fn project_github_pr_errors_preserve_repo_disconnected_code() {
        let err = anyhow::anyhow!("github_repo_disconnected");
        let data = github_pr_error_data(&err, "github_write_failed");

        assert_eq!(data.code, "github_repo_disconnected");
    }

    #[test]
    fn issue_integration_provider_statuses_reflect_github_state() {
        let unauthenticated = issue_integration_providers(false, false);
        assert_eq!(unauthenticated[0].id, "github");
        assert_eq!(unauthenticated[0].status, "auth_required");
        assert_eq!(unauthenticated[1].status, "unsupported");

        let authorized = issue_integration_providers(true, false);
        assert_eq!(authorized[0].status, "authorized");

        let linked = issue_integration_providers(true, true);
        assert_eq!(linked[0].status, "linked");
    }

    #[test]
    fn primary_github_repository_ignores_disconnected_integrations() {
        let disconnected = test_repo_integration(RepoIntegrationSyncStatus::Disconnected);
        let connected = test_repo_integration(RepoIntegrationSyncStatus::Connected);

        let selected = primary_github_repository(&[disconnected, connected.clone()])
            .expect("connected repo selected");

        assert_eq!(selected.id, connected.id);
        assert_eq!(selected.sync_status, RepoIntegrationSyncStatus::Connected);
    }

    fn test_repo_integration(sync_status: RepoIntegrationSyncStatus) -> RepoIntegration {
        RepoIntegration {
            id: Uuid::new_v4(),
            repo_id: Uuid::new_v4(),
            provider: "github".to_string(),
            owner: Some("openteams".to_string()),
            name: Some("repo".to_string()),
            remote_url: None,
            default_branch: Some("main".to_string()),
            external_id: None,
            installation_id: None,
            github_account_id: None,
            repo_grant_json: None,
            role: RepoIntegrationRole::Primary,
            sync_status,
            last_synced_at: None,
            last_error: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }
}
