use axum::{
    extract::{Extension, Path, Query},
    http::StatusCode,
    response::Json as ResponseJson,
    routing::get,
    Json, Router,
};
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::models::{
    project::Project,
    task::{CreateTask, Task, TaskStatus, TaskWithAttemptStatus, UpdateTask},
    task_attempt::{BranchStatus, CreateTaskAttempt, TaskAttempt, TaskAttemptStatus, WorktreeDiff},
    task_attempt_activity::{CreateTaskAttemptActivity, TaskAttemptActivity},
    ApiResponse,
};

pub async fn get_project_tasks(
    Path(project_id): Path<Uuid>,
    Extension(pool): Extension<SqlitePool>,
) -> Result<ResponseJson<ApiResponse<Vec<TaskWithAttemptStatus>>>, StatusCode> {
    match Task::find_by_project_id_with_attempt_status(&pool, project_id).await {
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
    Extension(pool): Extension<SqlitePool>,
) -> Result<ResponseJson<ApiResponse<Task>>, StatusCode> {
    match Task::find_by_id_and_project_id(&pool, task_id, project_id).await {
        Ok(Some(task)) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(task),
            message: None,
        })),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!(
                "Failed to fetch task {} in project {}: {}",
                task_id,
                project_id,
                e
            );
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn create_task(
    Path(project_id): Path<Uuid>,
    Extension(pool): Extension<SqlitePool>,
    Json(mut payload): Json<CreateTask>,
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

    tracing::debug!(
        "Creating task '{}' in project {}",
        payload.title,
        project_id
    );

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

pub async fn create_task_and_start(
    Path(project_id): Path<Uuid>,
    Extension(pool): Extension<SqlitePool>,
    Extension(app_state): Extension<crate::execution_monitor::AppState>,
    Json(mut payload): Json<CreateTask>,
) -> Result<ResponseJson<ApiResponse<Task>>, StatusCode> {
    let task_id = Uuid::new_v4();

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

    tracing::debug!(
        "Creating and starting task '{}' in project {}",
        payload.title,
        project_id
    );

    // Create the task first
    let task = match Task::create(&pool, &payload, task_id).await {
        Ok(task) => task,
        Err(e) => {
            tracing::error!("Failed to create task: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Create task attempt
    let attempt_id = Uuid::new_v4();
    let worktree_path = format!(
        "/tmp/task-{}-attempt-{}",
        task_id,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    let attempt_payload = CreateTaskAttempt {
        task_id,
        worktree_path,
        merge_commit: None,
        executor: Some("claude".to_string()), // Default executor
    };

    match TaskAttempt::create(&pool, &attempt_payload, attempt_id).await {
        Ok(attempt) => {
            // Create initial activity record
            let activity_id = Uuid::new_v4();
            let _ = TaskAttemptActivity::create_initial(&pool, attempt.id, activity_id).await;

            // Start execution asynchronously (don't block the response)
            let pool_clone = pool.clone();
            let app_state_clone = app_state.clone();
            let attempt_id = attempt.id;
            tokio::spawn(async move {
                if let Err(e) = TaskAttempt::start_execution(
                    &pool_clone,
                    &app_state_clone,
                    attempt_id,
                    task_id,
                    project_id,
                )
                .await
                {
                    tracing::error!(
                        "Failed to start execution for task attempt {}: {}",
                        attempt_id,
                        e
                    );
                }
            });

            Ok(ResponseJson(ApiResponse {
                success: true,
                data: Some(task),
                message: Some("Task created and started successfully".to_string()),
            }))
        }
        Err(e) => {
            tracing::error!("Failed to create task attempt: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn update_task(
    Path((project_id, task_id)): Path<(Uuid, Uuid)>,
    Extension(pool): Extension<SqlitePool>,
    Json(payload): Json<UpdateTask>,
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
    Extension(pool): Extension<SqlitePool>,
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
    Path((project_id, task_id)): Path<(Uuid, Uuid)>,
    Extension(pool): Extension<SqlitePool>,
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
    Path((project_id, task_id, attempt_id)): Path<(Uuid, Uuid, Uuid)>,
    Extension(pool): Extension<SqlitePool>,
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
            tracing::error!(
                "Failed to fetch task attempt activities for attempt {}: {}",
                attempt_id,
                e
            );
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn create_task_attempt(
    Path((project_id, task_id)): Path<(Uuid, Uuid)>,
    Extension(pool): Extension<SqlitePool>,
    Extension(app_state): Extension<crate::execution_monitor::AppState>,
    Json(mut payload): Json<CreateTaskAttempt>,
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

            // Start execution asynchronously (don't block the response)
            let pool_clone = pool.clone();
            let app_state_clone = app_state.clone();
            let attempt_id = attempt.id;
            tokio::spawn(async move {
                if let Err(e) = TaskAttempt::start_execution(
                    &pool_clone,
                    &app_state_clone,
                    attempt_id,
                    task_id,
                    project_id,
                )
                .await
                {
                    tracing::error!(
                        "Failed to start execution for task attempt {}: {}",
                        attempt_id,
                        e
                    );
                }
            });

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
    Path((project_id, task_id, attempt_id)): Path<(Uuid, Uuid, Uuid)>,
    Extension(pool): Extension<SqlitePool>,
    Json(mut payload): Json<CreateTaskAttemptActivity>,
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

pub async fn stop_task_attempt(
    Path((project_id, task_id, attempt_id)): Path<(Uuid, Uuid, Uuid)>,
    Extension(pool): Extension<SqlitePool>,
    Extension(app_state): Extension<crate::execution_monitor::AppState>,
) -> Result<ResponseJson<ApiResponse<()>>, StatusCode> {
    // Verify task attempt exists and belongs to the correct task
    match TaskAttempt::exists_for_task(&pool, attempt_id, task_id, project_id).await {
        Ok(false) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check task attempt existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(true) => {}
    }

    // Find and stop the running execution
    let mut stopped = false;
    {
        let mut executions = app_state.running_executions.lock().await;
        let mut execution_id_to_remove = None;

        // Find the execution for this attempt
        for (exec_id, execution) in executions.iter_mut() {
            if execution.task_attempt_id == attempt_id {
                // Kill the process
                match execution.child.kill().await {
                    Ok(_) => {
                        stopped = true;
                        execution_id_to_remove = Some(*exec_id);
                        tracing::info!("Stopped execution for task attempt {}", attempt_id);
                        break;
                    }
                    Err(e) => {
                        tracing::error!("Failed to kill process for attempt {}: {}", attempt_id, e);
                        return Err(StatusCode::INTERNAL_SERVER_ERROR);
                    }
                }
            }
        }

        // Remove the stopped execution from the map
        if let Some(exec_id) = execution_id_to_remove {
            executions.remove(&exec_id);
        }
    }

    if !stopped {
        return Ok(ResponseJson(ApiResponse {
            success: true,
            data: None,
            message: Some("No running execution found for this attempt".to_string()),
        }));
    }

    // Create a new activity record to mark as stopped
    let activity_id = Uuid::new_v4();
    let create_activity = CreateTaskAttemptActivity {
        task_attempt_id: attempt_id,
        status: Some(TaskAttemptStatus::Paused),
        note: Some("Execution stopped by user".to_string()),
    };

    if let Err(e) = TaskAttemptActivity::create(
        &pool,
        &create_activity,
        activity_id,
        TaskAttemptStatus::Paused,
    )
    .await
    {
        tracing::error!("Failed to create stopped activity: {}", e);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    // Update task status to InReview
    if let Err(e) = Task::update_status(&pool, task_id, project_id, TaskStatus::InReview).await {
        tracing::error!("Failed to update task status to InReview: {}", e);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    Ok(ResponseJson(ApiResponse {
        success: true,
        data: None,
        message: Some("Task attempt stopped successfully".to_string()),
    }))
}

pub async fn get_task_attempt_diff(
    Path((project_id, task_id, attempt_id)): Path<(Uuid, Uuid, Uuid)>,
    Extension(pool): Extension<SqlitePool>,
) -> Result<ResponseJson<ApiResponse<WorktreeDiff>>, StatusCode> {
    match TaskAttempt::get_diff(&pool, attempt_id, task_id, project_id).await {
        Ok(diff) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(diff),
            message: None,
        })),
        Err(e) => {
            tracing::error!("Failed to get diff for task attempt {}: {}", attempt_id, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[axum::debug_handler]
pub async fn merge_task_attempt(
    Path((project_id, task_id, attempt_id)): Path<(Uuid, Uuid, Uuid)>,
    Extension(pool): Extension<SqlitePool>,
) -> Result<ResponseJson<ApiResponse<()>>, StatusCode> {
    // Verify task attempt exists and belongs to the correct task
    match TaskAttempt::exists_for_task(&pool, attempt_id, task_id, project_id).await {
        Ok(false) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check task attempt existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(true) => {}
    }

    match TaskAttempt::merge_changes(&pool, attempt_id, task_id, project_id).await {
        Ok(_merge_commit_id) => {
            // Update task status to Done
            if let Err(e) = Task::update_status(&pool, task_id, project_id, TaskStatus::Done).await
            {
                tracing::error!("Failed to update task status to Done after merge: {}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }

            Ok(ResponseJson(ApiResponse {
                success: true,
                data: None,
                message: Some("Changes merged successfully".to_string()),
            }))
        }
        Err(e) => {
            tracing::error!("Failed to merge task attempt {}: {}", attempt_id, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn open_task_attempt_in_editor(
    Path((project_id, task_id, attempt_id)): Path<(Uuid, Uuid, Uuid)>,
    Extension(pool): Extension<SqlitePool>,
    Extension(config): Extension<Arc<RwLock<crate::models::config::Config>>>,
) -> Result<ResponseJson<ApiResponse<()>>, StatusCode> {
    // Verify task attempt exists and belongs to the correct task
    match TaskAttempt::exists_for_task(&pool, attempt_id, task_id, project_id).await {
        Ok(false) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check task attempt existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(true) => {}
    }

    // Get the task attempt to access the worktree path
    let attempt = match TaskAttempt::find_by_id(&pool, attempt_id).await {
        Ok(Some(attempt)) => attempt,
        Ok(None) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to fetch task attempt {}: {}", attempt_id, e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Get editor command from config
    let editor_command = {
        let config_guard = config.read().await;
        config_guard.editor.get_command()
    };

    // Open editor in the worktree directory
    let mut cmd = std::process::Command::new(&editor_command[0]);
    for arg in &editor_command[1..] {
        cmd.arg(arg);
    }
    cmd.arg(&attempt.worktree_path);

    match cmd.spawn() {
        Ok(_) => {
            tracing::info!(
                "Opened editor ({}) for task attempt {} at path: {}",
                editor_command.join(" "),
                attempt_id,
                attempt.worktree_path
            );
            Ok(ResponseJson(ApiResponse {
                success: true,
                data: None,
                message: Some("Editor opened successfully".to_string()),
            }))
        }
        Err(e) => {
            tracing::error!(
                "Failed to open editor ({}) for attempt {}: {}",
                editor_command.join(" "),
                attempt_id,
                e
            );
            Ok(ResponseJson(ApiResponse {
                success: false,
                data: None,
                message: Some(format!("Failed to open editor: {}", e)),
            }))
        }
    }
}

pub async fn get_task_attempt_branch_status(
    Path((project_id, task_id, attempt_id)): Path<(Uuid, Uuid, Uuid)>,
    Extension(pool): Extension<SqlitePool>,
) -> Result<ResponseJson<ApiResponse<BranchStatus>>, StatusCode> {
    match TaskAttempt::get_branch_status(&pool, attempt_id, task_id, project_id).await {
        Ok(status) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(status),
            message: None,
        })),
        Err(e) => {
            tracing::error!(
                "Failed to get branch status for task attempt {}: {}",
                attempt_id,
                e
            );
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[axum::debug_handler]
pub async fn rebase_task_attempt(
    Path((project_id, task_id, attempt_id)): Path<(Uuid, Uuid, Uuid)>,
    Extension(pool): Extension<SqlitePool>,
) -> Result<ResponseJson<ApiResponse<()>>, StatusCode> {
    // Verify task attempt exists and belongs to the correct task
    match TaskAttempt::exists_for_task(&pool, attempt_id, task_id, project_id).await {
        Ok(false) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check task attempt existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(true) => {}
    }

    match TaskAttempt::rebase_onto_main(&pool, attempt_id, task_id, project_id).await {
        Ok(_new_base_commit) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: None,
            message: Some("Branch rebased successfully".to_string()),
        })),
        Err(e) => {
            tracing::error!("Failed to rebase task attempt {}: {}", attempt_id, e);
            Ok(ResponseJson(ApiResponse {
                success: false,
                data: None,
                message: Some(e.to_string()),
            }))
        }
    }
}

#[derive(serde::Deserialize)]
pub struct DeleteFileQuery {
    file_path: String,
}

#[axum::debug_handler]
pub async fn delete_task_attempt_file(
    Path((project_id, task_id, attempt_id)): Path<(Uuid, Uuid, Uuid)>,
    Query(query): Query<DeleteFileQuery>,
    Extension(pool): Extension<SqlitePool>,
) -> Result<ResponseJson<ApiResponse<()>>, StatusCode> {
    // Verify task attempt exists and belongs to the correct task
    match TaskAttempt::exists_for_task(&pool, attempt_id, task_id, project_id).await {
        Ok(false) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check task attempt existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(true) => {}
    }

    match TaskAttempt::delete_file(&pool, attempt_id, task_id, project_id, &query.file_path).await {
        Ok(_commit_id) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: None,
            message: Some(format!("File '{}' deleted successfully", query.file_path)),
        })),
        Err(e) => {
            tracing::error!(
                "Failed to delete file '{}' from task attempt {}: {}",
                query.file_path,
                attempt_id,
                e
            );
            Ok(ResponseJson(ApiResponse {
                success: false,
                data: None,
                message: Some(e.to_string()),
            }))
        }
    }
}

pub fn tasks_router() -> Router {
    use axum::routing::post;

    Router::new()
        .route(
            "/projects/:project_id/tasks",
            get(get_project_tasks).post(create_task),
        )
        .route(
            "/projects/:project_id/tasks/create-and-start",
            post(create_task_and_start),
        )
        .route(
            "/projects/:project_id/tasks/:task_id",
            get(get_task).put(update_task).delete(delete_task),
        )
        .route(
            "/projects/:project_id/tasks/:task_id/attempts",
            get(get_task_attempts).post(create_task_attempt),
        )
        .route(
            "/projects/:project_id/tasks/:task_id/attempts/:attempt_id/activities",
            get(get_task_attempt_activities).post(create_task_attempt_activity),
        )
        .route(
            "/projects/:project_id/tasks/:task_id/attempts/:attempt_id/stop",
            post(stop_task_attempt),
        )
        .route(
            "/projects/:project_id/tasks/:task_id/attempts/:attempt_id/diff",
            get(get_task_attempt_diff),
        )
        .route(
            "/projects/:project_id/tasks/:task_id/attempts/:attempt_id/merge",
            post(merge_task_attempt),
        )
        .route(
            "/projects/:project_id/tasks/:task_id/attempts/:attempt_id/branch-status",
            get(get_task_attempt_branch_status),
        )
        .route(
            "/projects/:project_id/tasks/:task_id/attempts/:attempt_id/rebase",
            post(rebase_task_attempt),
        )
        .route(
            "/projects/:project_id/tasks/:task_id/attempts/:attempt_id/open-editor",
            post(open_task_attempt_in_editor),
        )
        .route(
            "/projects/:project_id/tasks/:task_id/attempts/:attempt_id/delete-file",
            post(delete_task_attempt_file),
        )
}
