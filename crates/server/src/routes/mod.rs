use axum::{
    Router,
    routing::{IntoMakeService, get},
};
use tower_http::validate_request::ValidateRequestHeaderLayer;

use crate::{DeploymentImpl, middleware};

pub mod admin;
pub mod agents;
pub mod analytics;
pub mod approvals;
pub mod browser_lifecycle;
pub mod build_stats;
pub mod chat;
pub mod config;
pub mod events;
pub mod filesystem;
pub mod frontend;
pub mod github;
pub mod health;
pub mod images;
pub mod project_github;
pub mod project_source_control;
pub mod projects;
pub mod scratch;
pub mod tags;
pub mod version;
pub mod workflow;

pub fn router(deployment: DeploymentImpl) -> IntoMakeService<Router> {
    // Create routers with different middleware layers
    let base_routes = Router::new()
        .route("/health", get(health::health_check))
        .merge(browser_lifecycle::router())
        .merge(config::router())
        .merge(chat::router(&deployment))
        .merge(tags::router(&deployment))
        .merge(filesystem::router())
        .merge(events::router(&deployment))
        .merge(agents::router())
        .merge(approvals::router())
        .merge(projects::router())
        .merge(github::router())
        .merge(project_github::router())
        .merge(project_source_control::router())
        .merge(scratch::router(&deployment))
        .merge(workflow::router())
        .merge(version::router())
        .merge(analytics::router())
        .merge(build_stats::router())
        .merge(admin::router())
        .nest("/images", images::routes())
        .layer(ValidateRequestHeaderLayer::custom(
            middleware::validate_origin,
        ))
        .with_state(deployment);

    Router::new()
        .route("/", get(frontend::serve_frontend_root))
        .route("/{*path}", get(frontend::serve_frontend))
        .nest("/api", base_routes)
        .into_make_service()
}
