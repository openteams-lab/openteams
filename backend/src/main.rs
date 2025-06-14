use axum::{
    extract::Extension,
    response::Json as ResponseJson,
    routing::{get, post},
    Json, Router,
};
use sqlx::postgres::PgPoolOptions;
use std::env;
use tower_http::cors::CorsLayer;
use tracing_subscriber;

mod auth;
mod models;
mod routes;

use auth::hash_password;
use models::ApiResponse;
use routes::{health, projects, users};



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
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive("bloop_backend=debug".parse()?))
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

    let app = Router::new()
        .route("/", get(|| async { "Bloop API" }))
        .route("/health", get(health::health_check))
        .route("/echo", post(echo_handler))
        .merge(projects::projects_router())
        .merge(users::users_router())
        .layer(Extension(pool))
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await?;

    tracing::info!("Server running on http://0.0.0.0:3001");

    axum::serve(listener, app).await?;

    Ok(())
}

async fn create_admin_account(pool: &sqlx::PgPool) -> anyhow::Result<()> {
    use chrono::Utc;
    use uuid::Uuid;

    let admin_email = "admin@example.com";
    let admin_password = env::var("ADMIN_PASSWORD")
        .unwrap_or_else(|_| "admin123".to_string());

    // Check if admin already exists
    let existing_admin = sqlx::query!(
        "SELECT id, password_hash FROM users WHERE email = $1",
        admin_email
    )
    .fetch_optional(pool)
    .await?;

    let password_hash = hash_password(&admin_password)?;

    if let Some(admin) = existing_admin {
        // Update existing admin password
        let now = Utc::now();
        sqlx::query!(
            "UPDATE users SET password_hash = $2, is_admin = $3, updated_at = $4 WHERE id = $1",
            admin.id,
            password_hash,
            true,
            now
        )
        .execute(pool)
        .await?;
        
        tracing::info!("Updated admin account");
    } else {
        // Create new admin account
        let id = Uuid::new_v4();
        let now = Utc::now();
        sqlx::query!(
            "INSERT INTO users (id, email, password_hash, is_admin, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
            id,
            admin_email,
            password_hash,
            true,
            now,
            now
        )
        .execute(pool)
        .await?;

        tracing::info!("Created admin account: {}", admin_email);
    }

    Ok(())
}
