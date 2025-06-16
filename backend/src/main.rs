use axum::{
    extract::Extension,
    middleware,
    response::Json as ResponseJson,
    routing::{get, post},
    Json, Router,
};
use sqlx::postgres::PgPoolOptions;
use std::{collections::HashMap, env, sync::Arc};
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

mod auth;
mod models;
mod routes;

use auth::{auth_middleware, hash_password};
use models::{ApiResponse, user::User};
use routes::{health, projects, tasks, users, filesystem};

#[derive(Debug)]
pub struct RunningExecution {
    pub task_attempt_id: Uuid,
    pub child: tokio::process::Child,
    pub started_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub running_executions: Arc<Mutex<HashMap<Uuid, RunningExecution>>>,
    pub db_pool: sqlx::PgPool,
}

async fn echo_handler(
    Json(payload): Json<serde_json::Value>,
) -> ResponseJson<ApiResponse<serde_json::Value>> {
    ResponseJson(ApiResponse {
        success: true,
        data: Some(payload),
        message: Some("Echo successful".to_string()),
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load environment variables from .env file
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")?;
    dotenvy::from_path(format!("{manifest_dir}/.env")).ok();
    // dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("bloop_backend=debug".parse()?),
        )
        .init();

    // Database connection
    let database_url =
        env::var("DATABASE_URL").expect("DATABASE_URL must be set in environment or .env file");

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    // Create default admin account if it doesn't exist
    if let Err(e) = create_admin_account(&pool).await {
        tracing::warn!("Failed to create admin account: {}", e);
    }

    // Create app state
    let app_state = AppState {
        running_executions: Arc::new(Mutex::new(HashMap::new())),
        db_pool: pool.clone(),
    };

    // Start background task to check for init status and spawn processes
    let state_clone = app_state.clone();
    tokio::spawn(async move {
        execution_monitor(state_clone).await;
    });

    // Public routes (no auth required)
    let public_routes = Router::new()
        .route("/", get(|| async { "Bloop API" }))
        .route("/health", get(health::health_check))
        .route("/echo", post(echo_handler))
        .merge(users::public_users_router());

    // Protected routes (auth required)
    let protected_routes = Router::new()
        .merge(projects::projects_router())
        .merge(tasks::tasks_router())
        .merge(users::protected_users_router())
        .merge(filesystem::filesystem_router())
        .layer(Extension(pool.clone()))
        .layer(middleware::from_fn(auth_middleware));

    let app = Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .layer(Extension(pool))
        .layer(Extension(app_state))
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await?;

    tracing::info!("Server running on http://0.0.0.0:3001");

    axum::serve(listener, app).await?;

    Ok(())
}

async fn create_admin_account(pool: &sqlx::PgPool) -> anyhow::Result<()> {
    let admin_email = "admin@example.com";
    let admin_password = env::var("ADMIN_PASSWORD").unwrap_or_else(|_| "admin123".to_string());

    let password_hash = hash_password(&admin_password)?;

    User::create_or_update_admin(pool, admin_email, &password_hash).await?;

    Ok(())
}

async fn execution_monitor(app_state: AppState) {
    use models::{task_attempt_activity::{CreateTaskAttemptActivity, TaskAttemptActivity}, task_attempt::TaskAttemptStatus};
    use chrono::Utc;
    use tokio::process::Command;

    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(5));
    
    loop {
        interval.tick().await;
        
        // Check for task attempts with latest activity status = Init
        let init_attempt_ids = match TaskAttemptActivity::find_attempts_with_latest_init_status(&app_state.db_pool).await {
            Ok(attempts) => attempts,
            Err(e) => {
                tracing::error!("Failed to query init attempts: {}", e);
                continue;
            }
        };

        for attempt_id in init_attempt_ids {
            
            // Check if we already have a running execution for this attempt
            {
                let executions = app_state.running_executions.lock().await;
                if executions.values().any(|exec| exec.task_attempt_id == attempt_id) {
                    continue;
                }
            }

            // Spawn the process
            let child = match Command::new("echo")
                .arg("hello world")
                .spawn() {
                Ok(child) => child,
                Err(e) => {
                    tracing::error!("Failed to spawn echo command: {}", e);
                    continue;
                }
            };

            // Add to running executions
            let execution_id = Uuid::new_v4();
            {
                let mut executions = app_state.running_executions.lock().await;
                executions.insert(execution_id, RunningExecution {
                    task_attempt_id: attempt_id,
                    child,
                    started_at: Utc::now(),
                });
            }

            // Update task attempt activity to InProgress
            let activity_id = Uuid::new_v4();
            let create_activity = CreateTaskAttemptActivity {
                task_attempt_id: attempt_id,
                status: Some(TaskAttemptStatus::InProgress),
                note: Some("Started execution".to_string()),
            };

            if let Err(e) = TaskAttemptActivity::create(
                &app_state.db_pool,
                &create_activity,
                activity_id,
                TaskAttemptStatus::InProgress,
            ).await {
                tracing::error!("Failed to create in-progress activity: {}", e);
            }

            tracing::info!("Started execution {} for task attempt {}", execution_id, attempt_id);
        }

        // Check for completed processes
        let mut completed_executions = Vec::new();
        {
            let mut executions = app_state.running_executions.lock().await;
            for (execution_id, running_exec) in executions.iter_mut() {
                match running_exec.child.try_wait() {
                    Ok(Some(status)) => {
                        let success = status.success();
                        let exit_code = status.code();
                        completed_executions.push((*execution_id, success, exit_code));
                    }
                    Ok(None) => {
                        // Still running
                    }
                    Err(e) => {
                        tracing::error!("Error checking process status: {}", e);
                        completed_executions.push((*execution_id, false, None));
                    }
                }
            }

            // Remove completed executions from the map
            for (execution_id, _, _) in &completed_executions {
                executions.remove(execution_id);
            }
        }

        // Log completed executions
        for (execution_id, success, exit_code) in completed_executions {
            let status_text = if success { "completed successfully" } else { "failed" };
            let exit_text = if let Some(code) = exit_code {
                format!(" with exit code {}", code)
            } else {
                String::new()
            };
            
            tracing::info!("Execution {} {}{}", execution_id, status_text, exit_text);
        }
    }
}
