use axum::{
    routing::{get, post, put, delete},
    Router,
    Json,
    response::Json as ResponseJson,
    extract::{Path, Extension},
    http::StatusCode,
};
use sqlx::PgPool;
use uuid::Uuid;
use chrono::Utc;

use crate::models::{ApiResponse, project::{Project, CreateProject, UpdateProject}};
use crate::auth::AuthUser;

pub async fn get_projects(Extension(pool): Extension<PgPool>) -> Result<ResponseJson<ApiResponse<Vec<Project>>>, StatusCode> {
    match sqlx::query_as!(
        Project,
        "SELECT id, name, owner_id, created_at, updated_at FROM projects ORDER BY created_at DESC"
    )
    .fetch_all(&pool)
    .await
    {
        Ok(projects) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(projects),
            message: None,
        })),
        Err(e) => {
            tracing::error!("Failed to fetch projects: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn get_project(
    Path(id): Path<Uuid>,
    Extension(pool): Extension<PgPool>
) -> Result<ResponseJson<ApiResponse<Project>>, StatusCode> {
    match sqlx::query_as!(
        Project,
        "SELECT id, name, owner_id, created_at, updated_at FROM projects WHERE id = $1",
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(project)) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(project),
            message: None,
        })),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to fetch project: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn create_project(
    auth: AuthUser,
    Extension(pool): Extension<PgPool>,
    Json(payload): Json<CreateProject>
) -> Result<ResponseJson<ApiResponse<Project>>, StatusCode> {
    let id = Uuid::new_v4();
    let now = Utc::now();

    tracing::debug!("Creating project '{}' for user {}", payload.name, auth.user_id);

    match sqlx::query_as!(
        Project,
        "INSERT INTO projects (id, name, owner_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, owner_id, created_at, updated_at",
        id,
        payload.name,
        auth.user_id,
        now,
        now
    )
    .fetch_one(&pool)
    .await
    {
        Ok(project) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(project),
            message: Some("Project created successfully".to_string()),
        })),
        Err(e) => {
            tracing::error!("Failed to create project: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn update_project(
    Path(id): Path<Uuid>,
    Extension(pool): Extension<PgPool>,
    Json(payload): Json<UpdateProject>
) -> Result<ResponseJson<ApiResponse<Project>>, StatusCode> {
    let now = Utc::now();

    // Check if project exists first
    let existing_project = sqlx::query_as!(
        Project,
        "SELECT id, name, owner_id, created_at, updated_at FROM projects WHERE id = $1",
        id
    )
    .fetch_optional(&pool)
    .await;

    let existing_project = match existing_project {
        Ok(Some(project)) => project,
        Ok(None) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check project existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Use existing name if not provided in update
    let name = payload.name.unwrap_or(existing_project.name);

    match sqlx::query_as!(
        Project,
        "UPDATE projects SET name = $2, updated_at = $3 WHERE id = $1 RETURNING id, name, owner_id, created_at, updated_at",
        id,
        name,
        now
    )
    .fetch_one(&pool)
    .await
    {
        Ok(project) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(project),
            message: Some("Project updated successfully".to_string()),
        })),
        Err(e) => {
            tracing::error!("Failed to update project: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn delete_project(
    Path(id): Path<Uuid>,
    Extension(pool): Extension<PgPool>
) -> Result<ResponseJson<ApiResponse<()>>, StatusCode> {
    match sqlx::query!("DELETE FROM projects WHERE id = $1", id)
        .execute(&pool)
        .await
    {
        Ok(result) => {
            if result.rows_affected() == 0 {
                Err(StatusCode::NOT_FOUND)
            } else {
                Ok(ResponseJson(ApiResponse {
                    success: true,
                    data: None,
                    message: Some("Project deleted successfully".to_string()),
                }))
            }
        }
        Err(e) => {
            tracing::error!("Failed to delete project: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub fn projects_router() -> Router {
    Router::new()
        .route("/projects", get(get_projects).post(create_project))
        .route("/projects/:id", get(get_project).put(update_project).delete(delete_project))
}
