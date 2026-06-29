use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    response::Json as ResponseJson,
    routing::{get, post},
};
use db::models::onboarding_state::{
    MarkUpgradeReadRequest, OnboardingState, OnboardingStateError, UpdateOnboardingStateRequest,
};
use deployment::Deployment;
use services::services::onboarding::{OnboardingService, OnboardingServiceError};
use utils::response::ApiResponse;

use crate::{
    DeploymentImpl, error::ApiError, routes::chat::sessions::validate_workspace_path_status,
};

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/onboarding/state", get(get_state).put(update_state))
        .route("/onboarding/complete", post(complete))
        .route("/onboarding/reset", post(reset))
        .route("/onboarding/upgrade/read", post(mark_upgrade_read))
        .route("/onboarding/upgrade/reset", post(reset_upgrade_read))
}

pub async fn get_state(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<OnboardingState>>, ApiError> {
    let state = OnboardingService::new()
        .get_state(&deployment.db().pool)
        .await
        .map_err(onboarding_error_to_api)?;
    Ok(ResponseJson(ApiResponse::success(state)))
}

pub async fn update_state(
    State(deployment): State<DeploymentImpl>,
    Json(mut payload): Json<UpdateOnboardingStateRequest>,
) -> Result<ResponseJson<ApiResponse<OnboardingState>>, ApiError> {
    let project_path_is_git = validate_project_path_update(&mut payload).await?;
    let state = OnboardingService::new()
        .update_state(&deployment.db().pool, payload, project_path_is_git)
        .await
        .map_err(onboarding_error_to_api)?;
    Ok(ResponseJson(ApiResponse::success(state)))
}

pub async fn complete(
    State(deployment): State<DeploymentImpl>,
    body: Bytes,
) -> Result<ResponseJson<ApiResponse<OnboardingState>>, ApiError> {
    let mut payload = parse_optional_update_payload(body)?;
    let project_path_is_git = validate_project_path_update(&mut payload).await?;
    let state = OnboardingService::new()
        .complete(&deployment.db().pool, payload, project_path_is_git)
        .await
        .map_err(onboarding_error_to_api)?;
    Ok(ResponseJson(ApiResponse::success(state)))
}

pub async fn reset(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<OnboardingState>>, ApiError> {
    let state = OnboardingService::new()
        .reset(&deployment.db().pool)
        .await
        .map_err(onboarding_error_to_api)?;
    Ok(ResponseJson(ApiResponse::success(state)))
}

pub async fn mark_upgrade_read(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<MarkUpgradeReadRequest>,
) -> Result<ResponseJson<ApiResponse<OnboardingState>>, ApiError> {
    let state = OnboardingService::new()
        .mark_upgrade_read(&deployment.db().pool, payload)
        .await
        .map_err(onboarding_error_to_api)?;
    Ok(ResponseJson(ApiResponse::success(state)))
}

pub async fn reset_upgrade_read(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<OnboardingState>>, ApiError> {
    let state = OnboardingService::new()
        .reset_upgrade_read(&deployment.db().pool)
        .await
        .map_err(onboarding_error_to_api)?;
    Ok(ResponseJson(ApiResponse::success(state)))
}

fn parse_optional_update_payload(body: Bytes) -> Result<UpdateOnboardingStateRequest, ApiError> {
    if body.is_empty() {
        return Ok(UpdateOnboardingStateRequest::default());
    }

    serde_json::from_slice(&body)
        .map_err(|err| ApiError::BadRequest(format!("Invalid onboarding state payload: {err}")))
}

async fn validate_project_path_update(
    payload: &mut UpdateOnboardingStateRequest,
) -> Result<Option<bool>, ApiError> {
    let Some(project_path) = payload.project_path.as_mut() else {
        return Ok(None);
    };

    let trimmed = project_path.trim().to_string();
    let result = validate_workspace_path_status(&trimmed).await;
    if !result.valid {
        return Err(ApiError::BadRequest(
            result
                .error
                .unwrap_or_else(|| "Workspace path is invalid.".to_string()),
        ));
    }

    *project_path = trimmed;
    Ok(Some(result.is_git_repo))
}

fn onboarding_error_to_api(err: OnboardingServiceError) -> ApiError {
    match err {
        OnboardingServiceError::State(OnboardingStateError::Database(err)) => {
            ApiError::Database(err)
        }
        OnboardingServiceError::State(OnboardingStateError::Serde(_)) => {
            ApiError::BadRequest("Invalid onboarding state data.".to_string())
        }
        OnboardingServiceError::Validation(message) => ApiError::BadRequest(message),
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Method, Request, StatusCode},
    };
    use db::DBService;
    use serde_json::{Value, json};
    use sqlx::SqlitePool;
    use tower::ServiceExt;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::migrate!("../db/migrations")
            .run(&pool)
            .await
            .expect("run migrations for onboarding HTTP tests");
        pool
    }

    async fn setup_app() -> Router {
        let pool = setup_pool().await;
        let deployment =
            local_deployment::LocalDeployment::new_for_test_pool(DBService { pool: pool.clone() })
                .await
                .expect("create test deployment");
        Router::new()
            .nest("/api", super::router())
            .with_state(deployment)
    }

    async fn request_json(
        app: &Router,
        method: Method,
        uri: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder().method(method).uri(uri);
        let request_body = if let Some(body) = body {
            builder = builder.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&body).expect("serialize request body"))
        } else {
            Body::empty()
        };
        let response = app
            .clone()
            .oneshot(builder.body(request_body).expect("build request"))
            .await
            .expect("execute request");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response body");
        let value = serde_json::from_slice(&bytes).unwrap_or_else(|_| json!({}));
        (status, value)
    }

    fn response_data(body: &Value) -> &Value {
        assert_eq!(body["success"], true, "response body: {body}");
        body.get("data").expect("response data")
    }

    #[tokio::test]
    async fn state_route_saves_validated_project_path_git_status() {
        let app = setup_app().await;
        let git_dir = tempfile::tempdir().expect("create git temp dir");
        git2::Repository::init(git_dir.path()).expect("init git repo");

        let (status, body) = request_json(
            &app,
            Method::PUT,
            "/api/onboarding/state",
            Some(json!({
                "current_step": "project_path",
                "project_path": format!(" {} ", git_dir.path().to_string_lossy()),
                "project_name": " Onboarding Project ",
                "created_project_id": " project-123 "
            })),
        )
        .await;

        assert_eq!(status, StatusCode::OK, "response body: {body}");
        let data = response_data(&body);
        assert_eq!(
            data["project_path"],
            git_dir.path().to_string_lossy().to_string()
        );
        assert_eq!(data["project_path_is_git"], true);
        assert_eq!(data["current_step"], "project_path");
        assert_eq!(data["project_name"], "Onboarding Project");
        assert_eq!(data["created_project_id"], "project-123");
    }

    #[tokio::test]
    async fn state_route_rejects_relative_project_path_without_cwd_fallback() {
        let app = setup_app().await;

        let (status, body) = request_json(
            &app,
            Method::PUT,
            "/api/onboarding/state",
            Some(json!({
                "current_step": "project_path",
                "project_path": "relative/project"
            })),
        )
        .await;

        assert_eq!(status, StatusCode::BAD_REQUEST, "response body: {body}");
        assert_eq!(body["success"], false);
        assert!(
            body["message"]
                .as_str()
                .is_some_and(|message| message.contains("absolute path")),
            "response body: {body}"
        );
    }

    #[tokio::test]
    async fn complete_route_accepts_empty_body() {
        let app = setup_app().await;

        let (status, body) =
            request_json(&app, Method::POST, "/api/onboarding/complete", None).await;

        assert_eq!(status, StatusCode::OK, "response body: {body}");
        let data = response_data(&body);
        assert!(data["onboarding_completed_at"].is_string());
        assert_eq!(data["current_step"], "appearance");
    }
}
