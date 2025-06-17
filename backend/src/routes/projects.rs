use axum::{
    extract::{Extension, Path},
    http::StatusCode,
    response::Json as ResponseJson,
    routing::get,
    Json, Router,
};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::models::{
    project::{CreateProject, Project, UpdateProject},
    ApiResponse,
};

pub async fn get_projects(
    Extension(pool): Extension<SqlitePool>,
) -> Result<ResponseJson<ApiResponse<Vec<Project>>>, StatusCode> {
    match Project::find_all(&pool).await {
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
    Extension(pool): Extension<SqlitePool>,
) -> Result<ResponseJson<ApiResponse<Project>>, StatusCode> {
    match Project::find_by_id(&pool, id).await {
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
    Extension(pool): Extension<SqlitePool>,
    Json(payload): Json<CreateProject>,
) -> Result<ResponseJson<ApiResponse<Project>>, StatusCode> {
    let id = Uuid::new_v4();

    tracing::debug!("Creating project '{}'", payload.name);

    // Check if git repo path is already used by another project
    match Project::find_by_git_repo_path(&pool, &payload.git_repo_path).await {
        Ok(Some(_)) => {
            return Ok(ResponseJson(ApiResponse {
                success: false,
                data: None,
                message: Some("A project with this git repository path already exists".to_string()),
            }));
        }
        Ok(None) => {
            // Path is available, continue
        }
        Err(e) => {
            tracing::error!("Failed to check for existing git repo path: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    // Validate and setup git repository
    let path = std::path::Path::new(&payload.git_repo_path);

    if payload.use_existing_repo {
        // For existing repos, validate that the path exists and is a git repository
        if !path.exists() {
            return Ok(ResponseJson(ApiResponse {
                success: false,
                data: None,
                message: Some("The specified path does not exist".to_string()),
            }));
        }

        if !path.is_dir() {
            return Ok(ResponseJson(ApiResponse {
                success: false,
                data: None,
                message: Some("The specified path is not a directory".to_string()),
            }));
        }

        if !path.join(".git").exists() {
            return Ok(ResponseJson(ApiResponse {
                success: false,
                data: None,
                message: Some("The specified directory is not a git repository".to_string()),
            }));
        }
    } else {
        // For new repos, create directory and initialize git

        // Create directory if it doesn't exist
        if !path.exists() {
            if let Err(e) = std::fs::create_dir_all(path) {
                tracing::error!("Failed to create directory: {}", e);
                return Ok(ResponseJson(ApiResponse {
                    success: false,
                    data: None,
                    message: Some(format!("Failed to create directory: {}", e)),
                }));
            }
        }

        // Check if it's already a git repo, if not initialize it
        if !path.join(".git").exists() {
            match std::process::Command::new("git")
                .arg("init")
                .current_dir(path)
                .output()
            {
                Ok(output) => {
                    if !output.status.success() {
                        let error_msg = String::from_utf8_lossy(&output.stderr);
                        tracing::error!("Git init failed: {}", error_msg);
                        return Ok(ResponseJson(ApiResponse {
                            success: false,
                            data: None,
                            message: Some(format!("Git init failed: {}", error_msg)),
                        }));
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to run git init: {}", e);
                    return Ok(ResponseJson(ApiResponse {
                        success: false,
                        data: None,
                        message: Some(format!("Failed to run git init: {}", e)),
                    }));
                }
            }
        }
    }

    match Project::create(&pool, &payload, id).await {
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
    Extension(pool): Extension<SqlitePool>,
    Json(payload): Json<UpdateProject>,
) -> Result<ResponseJson<ApiResponse<Project>>, StatusCode> {
    // Check if project exists first
    let existing_project = match Project::find_by_id(&pool, id).await {
        Ok(Some(project)) => project,
        Ok(None) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check project existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // If git_repo_path is being changed, check if the new path is already used by another project
    if let Some(new_git_repo_path) = &payload.git_repo_path {
        if new_git_repo_path != &existing_project.git_repo_path {
            match Project::find_by_git_repo_path_excluding_id(&pool, new_git_repo_path, id).await {
                Ok(Some(_)) => {
                    return Ok(ResponseJson(ApiResponse {
                        success: false,
                        data: None,
                        message: Some(
                            "A project with this git repository path already exists".to_string(),
                        ),
                    }));
                }
                Ok(None) => {
                    // Path is available, continue
                }
                Err(e) => {
                    tracing::error!("Failed to check for existing git repo path: {}", e);
                    return Err(StatusCode::INTERNAL_SERVER_ERROR);
                }
            }
        }
    }

    // Use existing values if not provided in update
    let name = payload.name.unwrap_or(existing_project.name);
    let git_repo_path = payload
        .git_repo_path
        .unwrap_or(existing_project.git_repo_path.clone());

    match Project::update(&pool, id, name, git_repo_path).await {
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
    Extension(pool): Extension<SqlitePool>,
) -> Result<ResponseJson<ApiResponse<()>>, StatusCode> {
    match Project::delete(&pool, id).await {
        Ok(rows_affected) => {
            if rows_affected == 0 {
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
        .route(
            "/projects/:id",
            get(get_project).put(update_project).delete(delete_project),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{hash_password, AuthUser};
    use crate::models::project::{CreateProject, UpdateProject};
    use axum::extract::Extension;
    use chrono::Utc;
    use sqlx::SqlitePool;
    use uuid::Uuid;

    async fn create_test_user(
        pool: &SqlitePool,
        email: &str,
        password: &str,
        is_admin: bool,
    ) -> User {
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

    async fn create_test_project(
        pool: &SqlitePool,
        name: &str,
        git_repo_path: &str,
        owner_id: Uuid,
    ) -> Project {
        let id = Uuid::new_v4();
        let now = Utc::now();

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

    #[sqlx::test]
    async fn test_get_projects_success(pool: SqlitePool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;

        // Create multiple projects
        create_test_project(&pool, "Project 1", "/tmp/test1", user.id).await;
        create_test_project(&pool, "Project 2", "/tmp/test2", user.id).await;
        create_test_project(&pool, "Project 3", "/tmp/test3", user.id).await;

        let auth = AuthUser {
            user_id: user.id,
            email: user.email,
            is_admin: false,
        };

        let result = get_projects(auth, Extension(pool)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        assert_eq!(response.data.unwrap().len(), 3);
    }

    #[sqlx::test]
    async fn test_get_projects_empty(pool: SqlitePool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;

        let auth = AuthUser {
            user_id: user.id,
            email: user.email,
            is_admin: false,
        };

        let result = get_projects(auth, Extension(pool)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        assert_eq!(response.data.unwrap().len(), 0);
    }

    #[sqlx::test]
    async fn test_get_project_success(pool: SqlitePool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project = create_test_project(&pool, "Test Project", "/tmp/test", user.id).await;

        let auth = AuthUser {
            user_id: user.id,
            email: user.email,
            is_admin: false,
        };

        let result = get_project(auth, Path(project.id), Extension(pool)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        let returned_project = response.data.unwrap();
        assert_eq!(returned_project.id, project.id);
        assert_eq!(returned_project.name, project.name);
        assert_eq!(returned_project.owner_id, project.owner_id);
    }

    #[sqlx::test]
    async fn test_get_project_not_found(pool: SqlitePool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let nonexistent_project_id = Uuid::new_v4();

        let auth = AuthUser {
            user_id: user.id,
            email: user.email,
            is_admin: false,
        };

        let result = get_project(auth, Path(nonexistent_project_id), Extension(pool)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
    }

    #[sqlx::test]
    async fn test_create_project_success(pool: SqlitePool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;

        let auth = AuthUser {
            user_id: user.id,
            email: user.email.clone(),
            is_admin: false,
        };

        let create_request = CreateProject {
            name: "New Project".to_string(),
            git_repo_path: "/tmp/new-project".to_string(),
            use_existing_repo: false,
        };

        let result = create_project(auth.clone(), Extension(pool), Json(create_request)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        let created_project = response.data.unwrap();
        assert_eq!(created_project.name, "New Project");
        assert_eq!(created_project.owner_id, auth.user_id);
        assert_eq!(response.message.unwrap(), "Project created successfully");
    }

    #[sqlx::test]
    async fn test_create_project_as_admin(pool: SqlitePool) {
        let admin_user = create_test_user(&pool, "admin@example.com", "password123", true).await;

        let auth = AuthUser {
            user_id: admin_user.id,
            email: admin_user.email.clone(),
            is_admin: true,
        };

        let create_request = CreateProject {
            name: "Admin Project".to_string(),
            git_repo_path: "/tmp/admin-project".to_string(),
            use_existing_repo: false,
        };

        let result = create_project(auth.clone(), Extension(pool), Json(create_request)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        let created_project = response.data.unwrap();
        assert_eq!(created_project.name, "Admin Project");
        assert_eq!(created_project.owner_id, auth.user_id);
    }

    #[sqlx::test]
    async fn test_update_project_success(pool: SqlitePool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project = create_test_project(&pool, "Original Name", "/tmp/original", user.id).await;

        let update_request = UpdateProject {
            name: Some("Updated Name".to_string()),
            git_repo_path: None,
        };

        let result = update_project(Path(project.id), Extension(pool), Json(update_request)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        let updated_project = response.data.unwrap();
        assert_eq!(updated_project.name, "Updated Name");
        assert_eq!(updated_project.owner_id, project.owner_id);
        assert_eq!(response.message.unwrap(), "Project updated successfully");
    }

    #[sqlx::test]
    async fn test_update_project_partial(pool: SqlitePool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project = create_test_project(&pool, "Original Name", "/tmp/original", user.id).await;

        // Update with no changes (None for name should keep existing name)
        let update_request = UpdateProject {
            name: None,
            git_repo_path: None,
        };

        let result = update_project(Path(project.id), Extension(pool), Json(update_request)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        let updated_project = response.data.unwrap();
        assert_eq!(updated_project.name, "Original Name"); // Should remain unchanged
        assert_eq!(updated_project.owner_id, project.owner_id);
    }

    #[sqlx::test]
    async fn test_update_project_not_found(pool: SqlitePool) {
        let nonexistent_project_id = Uuid::new_v4();

        let update_request = UpdateProject {
            name: Some("Updated Name".to_string()),
            git_repo_path: None,
        };

        let result = update_project(
            Path(nonexistent_project_id),
            Extension(pool),
            Json(update_request),
        )
        .await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
    }

    #[sqlx::test]
    async fn test_delete_project_success(pool: SqlitePool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project =
            create_test_project(&pool, "Project to Delete", "/tmp/to-delete", user.id).await;

        let result = delete_project(Path(project.id), Extension(pool)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert_eq!(response.message.unwrap(), "Project deleted successfully");
    }

    #[sqlx::test]
    async fn test_delete_project_not_found(pool: SqlitePool) {
        let nonexistent_project_id = Uuid::new_v4();

        let result = delete_project(Path(nonexistent_project_id), Extension(pool)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
    }

    #[sqlx::test]
    async fn test_delete_project_cascades_to_tasks(pool: SqlitePool) {
        use crate::models::task::{Task, TaskStatus};

        let user = create_test_user(&pool, "test@example.com", "password123", false).await;
        let project =
            create_test_project(&pool, "Project with Tasks", "/tmp/with-tasks", user.id).await;

        // Create a task in the project
        let task_id = Uuid::new_v4();
        let now = Utc::now();
        sqlx::query!(
            "INSERT INTO tasks (id, project_id, title, description, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            task_id,
            project.id,
            "Test Task",
            Some("Test Description"),
            TaskStatus::Todo as TaskStatus,
            now,
            now
        )
        .execute(&pool)
        .await
        .unwrap();

        // Verify task exists
        let task_count_before = sqlx::query!(
            "SELECT COUNT(*) as count FROM tasks WHERE project_id = $1",
            project.id
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(task_count_before.count.unwrap(), 1);

        // Delete the project
        let result = delete_project(Path(project.id), Extension(pool.clone())).await;
        assert!(result.is_ok());

        // Verify tasks were cascaded (deleted)
        let task_count_after = sqlx::query!(
            "SELECT COUNT(*) as count FROM tasks WHERE project_id = $1",
            project.id
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(task_count_after.count.unwrap(), 0);
    }

    #[sqlx::test]
    async fn test_projects_belong_to_users(pool: SqlitePool) {
        let user1 = create_test_user(&pool, "user1@example.com", "password123", false).await;
        let user2 = create_test_user(&pool, "user2@example.com", "password123", false).await;

        let project1 = create_test_project(&pool, "User 1 Project", "/tmp/user1", user1.id).await;
        let project2 = create_test_project(&pool, "User 2 Project", "/tmp/user2", user2.id).await;

        // Verify project ownership
        assert_eq!(project1.owner_id, user1.id);
        assert_eq!(project2.owner_id, user2.id);
        assert_ne!(project1.owner_id, project2.owner_id);
    }
}
