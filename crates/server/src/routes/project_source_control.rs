use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::Json as ResponseJson,
    routing::{get, post},
};
use deployment::Deployment;
use services::services::project::source_control::{
    SourceControlCommitError, SourceControlCommitRequest, SourceControlCommitResponse,
    SourceControlDiffRequest, SourceControlDiffResponse, SourceControlDiscardRequest,
    SourceControlError, SourceControlOperationResponse, SourceControlService,
    SourceControlStageRequest, SourceControlUnstageRequest,
};
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

type CommitApiResponse = ApiResponse<SourceControlCommitResponse, SourceControlCommitError>;

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route(
            "/projects/{project_id}/source-control/session-status",
            get(get_session_source_control_status),
        )
        .route(
            "/projects/{project_id}/source-control/diff",
            get(get_source_control_diff),
        )
        .route(
            "/projects/{project_id}/source-control/stage",
            post(stage_source_control_files),
        )
        .route(
            "/projects/{project_id}/source-control/unstage",
            post(unstage_source_control_files),
        )
        .route(
            "/projects/{project_id}/source-control/discard",
            post(discard_source_control_files),
        )
        .route(
            "/projects/{project_id}/source-control/commit",
            post(commit_source_control_files),
        )
}

#[derive(Debug, serde::Deserialize, ts_rs::TS)]
pub struct SessionSourceControlStatusQuery {
    pub session_id: Uuid,
    #[serde(default)]
    #[ts(optional, type = "string | null")]
    pub workspace_id: Option<Uuid>,
}

#[derive(Debug, Default, serde::Deserialize, ts_rs::TS)]
pub struct SourceControlWriteQuery {
    #[serde(default)]
    #[ts(optional, type = "string | null")]
    pub response: Option<String>,
}

impl SourceControlWriteQuery {
    fn fast_response(&self) -> bool {
        self.response.as_deref() == Some("fast")
    }
}

pub async fn get_session_source_control_status(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<SessionSourceControlStatusQuery>,
) -> Result<
    ResponseJson<
        ApiResponse<services::services::project::source_control::SessionSourceControlStatus>,
    >,
    ApiError,
> {
    let status = SourceControlService::new()
        .session_status(
            &deployment.db().pool,
            project_id,
            query.session_id,
            query.workspace_id,
        )
        .await
        .map_err(source_control_api_error)?;
    Ok(ResponseJson(ApiResponse::success(status)))
}

pub async fn get_source_control_diff(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<SourceControlDiffRequest>,
) -> Result<ResponseJson<ApiResponse<SourceControlDiffResponse>>, ApiError> {
    let diff = SourceControlService::new()
        .diff(&deployment.db().pool, project_id, query)
        .await
        .map_err(source_control_api_error)?;
    Ok(ResponseJson(ApiResponse::success(diff)))
}

pub async fn stage_source_control_files(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<SourceControlWriteQuery>,
    Json(request): Json<SourceControlStageRequest>,
) -> Result<ResponseJson<ApiResponse<SourceControlOperationResponse>>, ApiError> {
    let service = SourceControlService::new();
    let response = if query.fast_response() {
        service
            .stage_fast(&deployment.db().pool, project_id, request)
            .await
    } else {
        service
            .stage(&deployment.db().pool, project_id, request)
            .await
    }
    .map_err(source_control_api_error)?;
    Ok(ResponseJson(ApiResponse::success(response)))
}

pub async fn unstage_source_control_files(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<SourceControlWriteQuery>,
    Json(request): Json<SourceControlUnstageRequest>,
) -> Result<ResponseJson<ApiResponse<SourceControlOperationResponse>>, ApiError> {
    let service = SourceControlService::new();
    let response = if query.fast_response() {
        service
            .unstage_fast(&deployment.db().pool, project_id, request)
            .await
    } else {
        service
            .unstage(&deployment.db().pool, project_id, request)
            .await
    }
    .map_err(source_control_api_error)?;
    Ok(ResponseJson(ApiResponse::success(response)))
}

pub async fn discard_source_control_files(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<SourceControlWriteQuery>,
    Json(request): Json<SourceControlDiscardRequest>,
) -> Result<ResponseJson<ApiResponse<SourceControlOperationResponse>>, ApiError> {
    let service = SourceControlService::new();
    let response = if query.fast_response() {
        service
            .discard_fast(&deployment.db().pool, project_id, request)
            .await
    } else {
        service
            .discard(&deployment.db().pool, project_id, request)
            .await
    }
    .map_err(source_control_api_error)?;
    Ok(ResponseJson(ApiResponse::success(response)))
}

pub async fn commit_source_control_files(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(request): Json<SourceControlCommitRequest>,
) -> Result<ResponseJson<CommitApiResponse>, ApiError> {
    match SourceControlService::new()
        .commit(&deployment.db().pool, project_id, request)
        .await
    {
        Ok(response) => Ok(ResponseJson(ApiResponse::success(response))),
        Err(SourceControlError::Commit(error)) => {
            Ok(ResponseJson(ApiResponse::error_with_data(*error)))
        }
        Err(err) => Err(source_control_api_error(err)),
    }
}

fn source_control_api_error(err: SourceControlError) -> ApiError {
    match err {
        SourceControlError::Database(err) => ApiError::Database(err),
        SourceControlError::Io(err) => ApiError::Io(err),
        SourceControlError::ProjectNotFound => {
            ApiError::Project(db::models::project::ProjectError::ProjectNotFound)
        }
        SourceControlError::SessionNotFound => {
            ApiError::BadRequest("Session not found".to_string())
        }
        SourceControlError::SessionProjectMismatch => {
            ApiError::BadRequest("Session does not belong to this project.".to_string())
        }
        SourceControlError::WorkspaceNotConfigured => {
            ApiError::BadRequest("Project default workspace is not configured.".to_string())
        }
        SourceControlError::WorkspaceNotFound => {
            ApiError::BadRequest("Workspace is not part of this project.".to_string())
        }
        SourceControlError::WorkspaceNotAccessible(message) => {
            ApiError::BadRequest(format!("Workspace path is not accessible: {message}"))
        }
        SourceControlError::InvalidPath(message) => ApiError::BadRequest(message),
        SourceControlError::Serde(err) => ApiError::BadRequest(err.to_string()),
        SourceControlError::Git(err) => ApiError::BadRequest(err.to_string()),
        SourceControlError::Commit(error) => ApiError::BadRequest(error.message),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::SessionSourceControlStatusQuery;
    use crate::routes::project_source_control::router;

    #[test]
    fn status_query_requires_only_session_id() {
        let query: SessionSourceControlStatusQuery = serde_json::from_value(json!({
            "session_id": "018f6c7a-2bde-7c51-9876-111111111111"
        }))
        .expect("deserialize query");

        assert!(query.workspace_id.is_none());
    }

    #[test]
    fn source_control_router_builds() {
        let _router = router();
    }
}
