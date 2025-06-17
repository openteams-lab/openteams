use axum::{
    body::Body,
    extract::Extension,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Json as ResponseJson, Response},
    routing::{get, post},
    Json, Router,
};
use rust_embed::RustEmbed;
use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::str::FromStr;
use std::{collections::HashMap, env, sync::Arc};
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;

mod auth;
mod execution_monitor;
mod executor;
mod executors;
mod models;
mod routes;

use execution_monitor::{execution_monitor, AppState};
use models::ApiResponse;
use routes::{filesystem, health, projects, tasks};

#[derive(RustEmbed)]
#[folder = "../frontend/dist"]
struct Assets;

async fn echo_handler(
    Json(payload): Json<serde_json::Value>,
) -> ResponseJson<ApiResponse<serde_json::Value>> {
    ResponseJson(ApiResponse {
        success: true,
        data: Some(payload),
        message: Some("Echo successful".to_string()),
    })
}

async fn static_handler(uri: axum::extract::Path<String>) -> impl IntoResponse {
    let path = uri.trim_start_matches('/');
    serve_file(path).await
}

async fn index_handler() -> impl IntoResponse {
    serve_file("index.html").await
}

async fn serve_file(path: &str) -> impl IntoResponse {
    let file = Assets::get(path);

    match file {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();

            Response::builder()
                .status(StatusCode::OK)
                .header(
                    header::CONTENT_TYPE,
                    HeaderValue::from_str(mime.as_ref()).unwrap(),
                )
                .body(Body::from(content.data.into_owned()))
                .unwrap()
        }
        None => {
            // For SPA routing, serve index.html for unknown routes
            if let Some(index) = Assets::get("index.html") {
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, HeaderValue::from_static("text/html"))
                    .body(Body::from(index.data.into_owned()))
                    .unwrap()
            } else {
                Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Body::from("404 Not Found"))
                    .unwrap()
            }
        }
    }
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

    // if !Sqlite::database_exists(database_url).await.unwrap_or(false) {
    //     println!("Creating database {}", DB_URL);
    //     match Sqlite::create_database(DB_URL).await {
    //         Ok(_) => println!("Create db success"),
    //         Err(error) => panic!("error: {}", error),
    //     }
    // } else {
    //     println!("Database already exists");
    // }

    // let pool = SqlitePoolOptions::new()
    //     .max_connections(10)
    //     .connect(&database_url)
    //     .await?;

    let options = SqliteConnectOptions::from_str(&database_url)?.create_if_missing(true);
    let pool = SqlitePool::connect_with(options).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;

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
        .route("/api/health", get(health::health_check))
        .route("/api/echo", post(echo_handler));

    // All routes (no auth required)
    let app_routes = Router::new()
        .nest(
            "/api",
            Router::new()
                .merge(projects::projects_router())
                .merge(tasks::tasks_router())
                .merge(filesystem::filesystem_router()),
        )
        .layer(Extension(pool.clone()));

    let app = Router::new()
        .merge(public_routes)
        .merge(app_routes)
        // Static file serving routes
        .route("/", get(index_handler))
        .route("/*path", get(static_handler))
        .layer(Extension(pool))
        .layer(Extension(app_state))
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await?;

    tracing::info!("Server running on http://0.0.0.0:3001");

    axum::serve(listener, app).await?;

    Ok(())
}
