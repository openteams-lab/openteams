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

use crate::models::{
    ApiResponse, 
    project::Project,
    task::{Task, CreateTask, UpdateTask},
    task_attempt::{TaskAttempt, CreateTaskAttempt, TaskAttemptStatus},
    task_attempt_activity::{TaskAttemptActivity, CreateTaskAttemptActivity}
};
use crate::auth::AuthUser;

pub async fn get_project_tasks(
    _auth: AuthUser,
    Path(project_id): Path<Uuid>,
    Extension(pool): Extension<PgPool>
) -> Result<ResponseJson<ApiResponse<Vec<Task>>>, StatusCode> {
    match Task::find_by_project_id(&pool, project_id).await {
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
    _auth: AuthUser,
    Path((project_id, task_id)): Path<(Uuid, Uuid)>,
    Extension(pool): Extension<PgPool>
) -> Result<ResponseJson<ApiResponse<Task>>, StatusCode> {
    match Task::find_by_id_and_project_id(&pool, task_id, project_id).await {
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
    
    // Ensure the project_id in the payload matches the path parameter
    payload.project_id = project_id;
    
    // Verify project exists first
    match Project::exists(&pool, project_id).await {
        Ok(false) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check project existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(true) => {}
    }

    tracing::debug!("Creating task '{}' in project {} for user {}", payload.title, project_id, auth.user_id);

    match Task::create(&pool, &payload, id).await {
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
    // Check if task exists in the specified project
    let existing_task = match Task::find_by_id_and_project_id(&pool, task_id, project_id).await {
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

    match Task::update(&pool, task_id, project_id, title, description, status).await {
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
    match Task::delete(&pool, task_id, project_id).await {
        Ok(rows_affected) => {
            if rows_affected == 0 {
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

// Task Attempts endpoints
pub async fn get_task_attempts(
    _auth: AuthUser,
    Path((project_id, task_id)): Path<(Uuid, Uuid)>,
    Extension(pool): Extension<PgPool>
) -> Result<ResponseJson<ApiResponse<Vec<TaskAttempt>>>, StatusCode> {
    // Verify task exists in project first
    match Task::exists(&pool, task_id, project_id).await {
        Ok(false) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check task existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(true) => {}
    }

    match TaskAttempt::find_by_task_id(&pool, task_id).await {
        Ok(attempts) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(attempts),
            message: None,
        })),
        Err(e) => {
            tracing::error!("Failed to fetch task attempts for task {}: {}", task_id, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn get_task_attempt_activities(
    _auth: AuthUser,
    Path((project_id, task_id, attempt_id)): Path<(Uuid, Uuid, Uuid)>,
    Extension(pool): Extension<PgPool>
) -> Result<ResponseJson<ApiResponse<Vec<TaskAttemptActivity>>>, StatusCode> {
    // Verify task attempt exists and belongs to the correct task
    match TaskAttempt::exists_for_task(&pool, attempt_id, task_id, project_id).await {
        Ok(false) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check task attempt existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(true) => {}
    }

    match TaskAttemptActivity::find_by_attempt_id(&pool, attempt_id).await {
        Ok(activities) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(activities),
            message: None,
        })),
        Err(e) => {
            tracing::error!("Failed to fetch task attempt activities for attempt {}: {}", attempt_id, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn create_task_attempt(
    _auth: AuthUser,
    Path((project_id, task_id)): Path<(Uuid, Uuid)>,
    Extension(pool): Extension<PgPool>,
    Json(mut payload): Json<CreateTaskAttempt>
) -> Result<ResponseJson<ApiResponse<TaskAttempt>>, StatusCode> {
    // Verify task exists in project first
    match Task::exists(&pool, task_id, project_id).await {
        Ok(false) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check task existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(true) => {}
    }

    let id = Uuid::new_v4();
    
    // Ensure the task_id in the payload matches the path parameter
    payload.task_id = task_id;

    match TaskAttempt::create(&pool, &payload, id).await {
        Ok(attempt) => {
            // Create initial activity record
            let activity_id = Uuid::new_v4();
            let _ = TaskAttemptActivity::create_initial(&pool, attempt.id, activity_id).await;

            Ok(ResponseJson(ApiResponse {
                success: true,
                data: Some(attempt),
                message: Some("Task attempt created successfully".to_string()),
            }))
        }
        Err(e) => {
            tracing::error!("Failed to create task attempt: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn create_task_attempt_activity(
    _auth: AuthUser,
    Path((project_id, task_id, attempt_id)): Path<(Uuid, Uuid, Uuid)>,
    Extension(pool): Extension<PgPool>,
    Json(mut payload): Json<CreateTaskAttemptActivity>
) -> Result<ResponseJson<ApiResponse<TaskAttemptActivity>>, StatusCode> {
    // Verify task attempt exists and belongs to the correct task
    match TaskAttempt::exists_for_task(&pool, attempt_id, task_id, project_id).await {
        Ok(false) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check task attempt existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(true) => {}
    }

    let id = Uuid::new_v4();
    
    // Ensure the task_attempt_id in the payload matches the path parameter
    payload.task_attempt_id = attempt_id;
    
    // Default to Init status if not provided
    let status = payload.status.clone().unwrap_or(TaskAttemptStatus::Init);

    match TaskAttemptActivity::create(&pool, &payload, id, status).await {
        Ok(activity) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(activity),
            message: Some("Task attempt activity created successfully".to_string()),
        })),
        Err(e) => {
            tracing::error!("Failed to create task attempt activity: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub fn tasks_router() -> Router {
    use axum::routing::{post, put, delete};
    
    Router::new()
        .route("/projects/:project_id/tasks", get(get_project_tasks).post(create_task))
        .route("/projects/:project_id/tasks/:task_id", get(get_task).put(update_task).delete(delete_task))
        .route("/projects/:project_id/tasks/:task_id/attempts", get(get_task_attempts).post(create_task_attempt))
        .route("/projects/:project_id/tasks/:task_id/attempts/:attempt_id/activities", get(get_task_attempt_activities).post(create_task_attempt_activity))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::Extension;
    use sqlx::PgPool;
    use uuid::Uuid;
    use chrono::Utc;
    use crate::models::{user::User, project::Project, task::{CreateTask, UpdateTask, TaskStatus}};
    use crate::auth::{AuthUser, hash_password};

    async fn create_test_user(pool: &PgPool, email: &str, password: &str, is_admin: bool) -> User {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let password_hash = hash_password(password).unwrap();

        sqlx::query_as!(
            User,
            "INSERT INTO users (id, email, password_hash, is_admin, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, password_hash, is_admin, created_at, updated_at",
            id,
            email,
            password_hash,
            is_admin,
            now,
            now
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn create_test_project(pool: &PgPool, name: &str, owner_id: Uuid) -> Project {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let git_repo_path = format!("/tmp/test-repo-{}", id);

        sqlx::query_as!(
            Project,
            "INSERT INTO projects (id, name, git_repo_path, owner_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, git_repo_path, owner_id, created_at, updated_at",
            id,
            name,
            git_repo_path,
            owner_id,
            now,
            now
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn create_test_task(pool: &PgPool, project_id: Uuid, title: &str, description: Option<String>, status: TaskStatus) -> Task {
        let id = Uuid::new_v4();
        let now = Utc::now();

        sqlx::query_as!(
            Task,
            r#"INSERT INTO tasks (id, project_id, title, description, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, project_id, title, description, status as "status!: TaskStatus", created_at, updated_at"#,
            id,
            project_id,
            title,
            description,
            status as TaskStatus,
            now,
            now
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[sqlx::test]
    async fn test_get_project_tasks_success(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project = create_test_project(&pool, "Test Project", user.id).await;
        
        // Create multiple tasks
        create_test_task(&pool, project.id, "Task 1", Some("Description 1".to_string()), TaskStatus::Todo).await;
        create_test_task(&pool, project.id, "Task 2", None, TaskStatus::InProgress).await;
        create_test_task(&pool, project.id, "Task 3", Some("Description 3".to_string()), TaskStatus::Done).await;

        let auth = AuthUser {
            user_id: user.id,
            email: user.email,
            is_admin: false,
        };

        let result = get_project_tasks(auth, Path(project.id), Extension(pool)).await;
        assert!(result.is_ok());
        
        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        assert_eq!(response.data.unwrap().len(), 3);
    }

    #[sqlx::test]
    async fn test_get_project_tasks_empty_project(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project = create_test_project(&pool, "Empty Project", user.id).await;

        let auth = AuthUser {
            user_id: user.id,
            email: user.email,
            is_admin: false,
        };

        let result = get_project_tasks(auth, Path(project.id), Extension(pool)).await;
        assert!(result.is_ok());
        
        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        assert_eq!(response.data.unwrap().len(), 0);
    }

    #[sqlx::test]
    async fn test_get_task_success(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project = create_test_project(&pool, "Test Project", user.id).await;
        let task = create_test_task(&pool, project.id, "Test Task", Some("Test Description".to_string()), TaskStatus::Todo).await;

        let auth = AuthUser {
            user_id: user.id,
            email: user.email,
            is_admin: false,
        };

        let result = get_task(auth, Path((project.id, task.id)), Extension(pool)).await;
        assert!(result.is_ok());
        
        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        let returned_task = response.data.unwrap();
        assert_eq!(returned_task.id, task.id);
        assert_eq!(returned_task.title, task.title);
        assert_eq!(returned_task.description, task.description);
        assert_eq!(returned_task.status, task.status);
    }

    #[sqlx::test]
    async fn test_get_task_not_found(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project = create_test_project(&pool, "Test Project", user.id).await;
        let nonexistent_task_id = Uuid::new_v4();

        let auth = AuthUser {
            user_id: user.id,
            email: user.email,
            is_admin: false,
        };

        let result = get_task(auth, Path((project.id, nonexistent_task_id)), Extension(pool)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
    }

    #[sqlx::test]
    async fn test_get_task_wrong_project(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project1 = create_test_project(&pool, "Project 1", user.id).await;
        let project2 = create_test_project(&pool, "Project 2", user.id).await;
        let task = create_test_task(&pool, project1.id, "Test Task", None, TaskStatus::Todo).await;

        let auth = AuthUser {
            user_id: user.id,
            email: user.email,
            is_admin: false,
        };

        // Try to get task from wrong project
        let result = get_task(auth, Path((project2.id, task.id)), Extension(pool)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
    }

    #[sqlx::test]
    async fn test_create_task_success(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project = create_test_project(&pool, "Test Project", user.id).await;

        let auth = AuthUser {
            user_id: user.id,
            email: user.email,
            is_admin: false,
        };

        let create_request = CreateTask {
            project_id: project.id, // This will be overridden by the path parameter
            title: "New Task".to_string(),
            description: Some("Task description".to_string()),
        };

        let result = create_task(Path(project.id), auth, Extension(pool), Json(create_request)).await;
        assert!(result.is_ok());
        
        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        let created_task = response.data.unwrap();
        assert_eq!(created_task.title, "New Task");
        assert_eq!(created_task.description, Some("Task description".to_string()));
        assert_eq!(created_task.status, TaskStatus::Todo);
        assert_eq!(created_task.project_id, project.id);
    }

    #[sqlx::test]
    async fn test_create_task_project_not_found(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let nonexistent_project_id = Uuid::new_v4();

        let auth = AuthUser {
            user_id: user.id,
            email: user.email,
            is_admin: false,
        };

        let create_request = CreateTask {
            project_id: nonexistent_project_id,
            title: "New Task".to_string(),
            description: None,
        };

        let result = create_task(Path(nonexistent_project_id), auth, Extension(pool), Json(create_request)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
    }

    #[sqlx::test]
    async fn test_update_task_success(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project = create_test_project(&pool, "Test Project", user.id).await;
        let task = create_test_task(&pool, project.id, "Original Title", Some("Original Description".to_string()), TaskStatus::Todo).await;

        let update_request = UpdateTask {
            title: Some("Updated Title".to_string()),
            description: Some("Updated Description".to_string()),
            status: Some(TaskStatus::InProgress),
        };

        let result = update_task(Path((project.id, task.id)), Extension(pool), Json(update_request)).await;
        assert!(result.is_ok());
        
        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        let updated_task = response.data.unwrap();
        assert_eq!(updated_task.title, "Updated Title");
        assert_eq!(updated_task.description, Some("Updated Description".to_string()));
        assert_eq!(updated_task.status, TaskStatus::InProgress);
    }

    #[sqlx::test]
    async fn test_update_task_partial(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project = create_test_project(&pool, "Test Project", user.id).await;
        let task = create_test_task(&pool, project.id, "Original Title", Some("Original Description".to_string()), TaskStatus::Todo).await;

        // Only update status
        let update_request = UpdateTask {
            title: None,
            description: None,
            status: Some(TaskStatus::Done),
        };

        let result = update_task(Path((project.id, task.id)), Extension(pool), Json(update_request)).await;
        assert!(result.is_ok());
        
        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        let updated_task = response.data.unwrap();
        assert_eq!(updated_task.title, "Original Title"); // Should remain unchanged
        assert_eq!(updated_task.description, Some("Original Description".to_string())); // Should remain unchanged
        assert_eq!(updated_task.status, TaskStatus::Done); // Should be updated
    }

    #[sqlx::test]
    async fn test_update_task_not_found(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project = create_test_project(&pool, "Test Project", user.id).await;
        let nonexistent_task_id = Uuid::new_v4();

        let update_request = UpdateTask {
            title: Some("Updated Title".to_string()),
            description: None,
            status: None,
        };

        let result = update_task(Path((project.id, nonexistent_task_id)), Extension(pool), Json(update_request)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
    }

    #[sqlx::test]
    async fn test_update_task_wrong_project(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project1 = create_test_project(&pool, "Project 1", user.id).await;
        let project2 = create_test_project(&pool, "Project 2", user.id).await;
        let task = create_test_task(&pool, project1.id, "Test Task", None, TaskStatus::Todo).await;

        let update_request = UpdateTask {
            title: Some("Updated Title".to_string()),
            description: None,
            status: None,
        };

        // Try to update task in wrong project
        let result = update_task(Path((project2.id, task.id)), Extension(pool), Json(update_request)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
    }

    #[sqlx::test]
    async fn test_delete_task_success(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project = create_test_project(&pool, "Test Project", user.id).await;
        let task = create_test_task(&pool, project.id, "Task to Delete", None, TaskStatus::Todo).await;

        let result = delete_task(Path((project.id, task.id)), Extension(pool)).await;
        assert!(result.is_ok());
        
        let response = result.unwrap().0;
        assert!(response.success);
        assert_eq!(response.message.unwrap(), "Task deleted successfully");
    }

    #[sqlx::test]
    async fn test_delete_task_not_found(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project = create_test_project(&pool, "Test Project", user.id).await;
        let nonexistent_task_id = Uuid::new_v4();

        let result = delete_task(Path((project.id, nonexistent_task_id)), Extension(pool)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
    }

    #[sqlx::test]
    async fn test_delete_task_wrong_project(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project1 = create_test_project(&pool, "Project 1", user.id).await;
        let project2 = create_test_project(&pool, "Project 2", user.id).await;
        let task = create_test_task(&pool, project1.id, "Task to Delete", None, TaskStatus::Todo).await;

        // Try to delete task from wrong project
        let result = delete_task(Path((project2.id, task.id)), Extension(pool)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
    }
}
