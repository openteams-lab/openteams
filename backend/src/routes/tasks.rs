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

use crate::models::{
    ApiResponse, 
    task::{Task, CreateTask, UpdateTask, TaskStatus},
    task_attempt::{TaskAttempt, CreateTaskAttempt, UpdateTaskAttempt, TaskAttemptStatus},
    task_attempt_activity::{TaskAttemptActivity, CreateTaskAttemptActivity}
};
use crate::auth::AuthUser;

pub async fn get_project_tasks(
    auth: AuthUser,
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
    auth: AuthUser,
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

// Task Attempts endpoints
pub async fn get_task_attempts(
    _auth: AuthUser,
    Path((project_id, task_id)): Path<(Uuid, Uuid)>,
    Extension(pool): Extension<PgPool>
) -> Result<ResponseJson<ApiResponse<Vec<TaskAttempt>>>, StatusCode> {
    // Verify task exists in project first
    let task_exists = sqlx::query!(
        "SELECT id FROM tasks WHERE id = $1 AND project_id = $2", 
        task_id, 
        project_id
    )
    .fetch_optional(&pool)
    .await;
    
    match task_exists {
        Ok(None) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check task existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(Some(_)) => {}
    }

    match sqlx::query_as!(
        TaskAttempt,
        r#"SELECT id, task_id, worktree_path, base_commit, merge_commit, created_at, updated_at 
           FROM task_attempts 
           WHERE task_id = $1 
           ORDER BY created_at DESC"#,
        task_id
    )
    .fetch_all(&pool)
    .await
    {
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
    let attempt_exists = sqlx::query!(
        "SELECT ta.id FROM task_attempts ta 
         JOIN tasks t ON ta.task_id = t.id 
         WHERE ta.id = $1 AND t.id = $2 AND t.project_id = $3",
        attempt_id,
        task_id,
        project_id
    )
    .fetch_optional(&pool)
    .await;
    
    match attempt_exists {
        Ok(None) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check task attempt existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(Some(_)) => {}
    }

    match sqlx::query_as!(
        TaskAttemptActivity,
        r#"SELECT id, task_attempt_id, status as "status!: TaskAttemptStatus", note, created_at 
           FROM task_attempt_activities 
           WHERE task_attempt_id = $1 
           ORDER BY created_at DESC"#,
        attempt_id
    )
    .fetch_all(&pool)
    .await
    {
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
    let task_exists = sqlx::query!(
        "SELECT id FROM tasks WHERE id = $1 AND project_id = $2", 
        task_id, 
        project_id
    )
    .fetch_optional(&pool)
    .await;
    
    match task_exists {
        Ok(None) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check task existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(Some(_)) => {}
    }

    let id = Uuid::new_v4();
    let now = Utc::now();
    
    // Ensure the task_id in the payload matches the path parameter
    payload.task_id = task_id;

    match sqlx::query_as!(
        TaskAttempt,
        r#"INSERT INTO task_attempts (id, task_id, worktree_path, base_commit, merge_commit, created_at, updated_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) 
           RETURNING id, task_id, worktree_path, base_commit, merge_commit, created_at, updated_at"#,
        id,
        payload.task_id,
        payload.worktree_path,
        payload.base_commit,
        payload.merge_commit,
        now,
        now
    )
    .fetch_one(&pool)
    .await
    {
        Ok(attempt) => {
            // Create initial activity record
            let activity_id = Uuid::new_v4();
            let _ = sqlx::query!(
                r#"INSERT INTO task_attempt_activities (id, task_attempt_id, status, note, created_at) 
                   VALUES ($1, $2, $3, $4, $5)"#,
                activity_id,
                attempt.id,
                TaskAttemptStatus::Init as TaskAttemptStatus,
                Option::<String>::None,
                now
            )
            .execute(&pool)
            .await;

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
    let attempt_exists = sqlx::query!(
        "SELECT ta.id FROM task_attempts ta 
         JOIN tasks t ON ta.task_id = t.id 
         WHERE ta.id = $1 AND t.id = $2 AND t.project_id = $3",
        attempt_id,
        task_id,
        project_id
    )
    .fetch_optional(&pool)
    .await;
    
    match attempt_exists {
        Ok(None) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check task attempt existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(Some(_)) => {}
    }

    let id = Uuid::new_v4();
    let now = Utc::now();
    
    // Ensure the task_attempt_id in the payload matches the path parameter
    payload.task_attempt_id = attempt_id;
    
    // Default to Init status if not provided
    let status = payload.status.unwrap_or(TaskAttemptStatus::Init);

    match sqlx::query_as!(
        TaskAttemptActivity,
        r#"INSERT INTO task_attempt_activities (id, task_attempt_id, status, note, created_at) 
           VALUES ($1, $2, $3, $4, $5) 
           RETURNING id, task_attempt_id, status as "status!: TaskAttemptStatus", note, created_at"#,
        id,
        payload.task_attempt_id,
        status as TaskAttemptStatus,
        payload.note,
        now
    )
    .fetch_one(&pool)
    .await
    {
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

        sqlx::query_as!(
            Project,
            "INSERT INTO projects (id, name, owner_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, owner_id, created_at, updated_at",
            id,
            name,
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
