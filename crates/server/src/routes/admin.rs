use axum::{Json, Router, extract::State, routing::post};
use deployment::Deployment;
use services::services::project::migration::{ProjectMigrationReport, ProjectMigrationService};
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError};

pub fn router() -> Router<DeploymentImpl> {
    Router::new().route("/admin/migrate-projects", post(migrate_projects))
}

async fn migrate_projects(
    State(deployment): State<DeploymentImpl>,
) -> Result<Json<ApiResponse<ProjectMigrationReport>>, ApiError> {
    let report = ProjectMigrationService::new()
        .migrate_legacy_sessions(&deployment.db().pool, deployment.user_id())
        .await
        .map_err(|err| ApiError::BadRequest(format!("Project migration failed: {err}")))?;

    Ok(Json(ApiResponse::success(report)))
}
