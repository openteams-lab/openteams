use axum::{
    routing::get,
    Router,
    Json,
    response::Json as ResponseJson,
    extract::{Path, Extension},
    http::StatusCode,
};
use sqlx::PgPool;
use uuid::Uuid;
use chrono::Utc;

use crate::models::{ApiResponse, task::{Task, CreateTask, UpdateTask, TaskStatus}};
use crate::auth::AuthUser;

pub async fn get_project_tasks(
    Path(project_id): Path<Uuid>,
    Extension(pool): Extension<PgPool>
) -> Result<ResponseJson<ApiResponse<Vec<Task>>>, StatusCode> {
    match sqlx::query_as!(
        Task,
        r#"SELECT id, project_id, title, description, status as "status!: TaskStatus", created_at, updated_at 
           FROM tasks 
           WHERE project_id = $1 
           ORDER BY created_at DESC"#,
        project_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(tasks) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(tasks),
            message: None,
        })),
        Err(e) => {
            tracing::error!("Failed to fetch tasks for project {}: {}", project_id, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn get_task(
    Path((project_id, task_id)): Path<(Uuid, Uuid)>,
    Extension(pool): Extension<PgPool>
) -> Result<ResponseJson<ApiResponse<Task>>, StatusCode> {
    match sqlx::query_as!(
        Task,
        r#"SELECT id, project_id, title, description, status as "status!: TaskStatus", created_at, updated_at 
           FROM tasks 
           WHERE id = $1 AND project_id = $2"#,
        task_id,
        project_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(task)) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(task),
            message: None,
        })),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to fetch task {} in project {}: {}", task_id, project_id, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn create_task(
    Path(project_id): Path<Uuid>,
    auth: AuthUser,
    Extension(pool): Extension<PgPool>,
    Json(mut payload): Json<CreateTask>
) -> Result<ResponseJson<ApiResponse<Task>>, StatusCode> {
    let id = Uuid::new_v4();
    let now = Utc::now();
    
    // Ensure the project_id in the payload matches the path parameter
    payload.project_id = project_id;
    
    // Verify project exists first
    let project_exists = sqlx::query!("SELECT id FROM projects WHERE id = $1", project_id)
        .fetch_optional(&pool)
        .await;
        
    match project_exists {
        Ok(None) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check project existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(Some(_)) => {}
    }

    tracing::debug!("Creating task '{}' in project {} for user {}", payload.title, project_id, auth.user_id);

    match sqlx::query_as!(
        Task,
        r#"INSERT INTO tasks (id, project_id, title, description, status, created_at, updated_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) 
           RETURNING id, project_id, title, description, status as "status!: TaskStatus", created_at, updated_at"#,
        id,
        payload.project_id,
        payload.title,
        payload.description,
        TaskStatus::Todo as TaskStatus,
        now,
        now
    )
    .fetch_one(&pool)
    .await
    {
        Ok(task) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(task),
            message: Some("Task created successfully".to_string()),
        })),
        Err(e) => {
            tracing::error!("Failed to create task: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn update_task(
    Path((project_id, task_id)): Path<(Uuid, Uuid)>,
    Extension(pool): Extension<PgPool>,
    Json(payload): Json<UpdateTask>
) -> Result<ResponseJson<ApiResponse<Task>>, StatusCode> {
    let now = Utc::now();

    // Check if task exists in the specified project
    let existing_task = sqlx::query_as!(
        Task,
        r#"SELECT id, project_id, title, description, status as "status!: TaskStatus", created_at, updated_at 
           FROM tasks 
           WHERE id = $1 AND project_id = $2"#,
        task_id,
        project_id
    )
    .fetch_optional(&pool)
    .await;

    let existing_task = match existing_task {
        Ok(Some(task)) => task,
        Ok(None) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check task existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Use existing values if not provided in update
    let title = payload.title.unwrap_or(existing_task.title);
    let description = payload.description.or(existing_task.description);
    let status = payload.status.unwrap_or(existing_task.status);

    match sqlx::query_as!(
        Task,
        r#"UPDATE tasks 
           SET title = $3, description = $4, status = $5, updated_at = $6 
           WHERE id = $1 AND project_id = $2 
           RETURNING id, project_id, title, description, status as "status!: TaskStatus", created_at, updated_at"#,
        task_id,
        project_id,
        title,
        description,
        status as TaskStatus,
        now
    )
    .fetch_one(&pool)
    .await
    {
        Ok(task) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(task),
            message: Some("Task updated successfully".to_string()),
        })),
        Err(e) => {
            tracing::error!("Failed to update task: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn delete_task(
    Path((project_id, task_id)): Path<(Uuid, Uuid)>,
    Extension(pool): Extension<PgPool>
) -> Result<ResponseJson<ApiResponse<()>>, StatusCode> {
    match sqlx::query!(
        "DELETE FROM tasks WHERE id = $1 AND project_id = $2", 
        task_id, 
        project_id
    )
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
                    message: Some("Task deleted successfully".to_string()),
                }))
            }
        }
        Err(e) => {
            tracing::error!("Failed to delete task: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub fn tasks_router() -> Router {
    use axum::routing::{post, put, delete};
    
    Router::new()
        .route("/projects/:project_id/tasks", get(get_project_tasks).post(create_task))
        .route("/projects/:project_id/tasks/:task_id", get(get_task).put(update_task).delete(delete_task))
}
