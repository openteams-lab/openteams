pub fn router() -> axum::Router<DeploymentImpl> {
    axum::Router::new()
        .route("/analytics/events", axum::routing::post(track_event))
        .route(
            "/analytics/events/batch",
            axum::routing::post(track_events_batch),
        )
        .route("/analytics/metrics", axum::routing::get(get_metrics))
        .route("/analytics/dashboard", axum::routing::get(get_dashboard))
        .route("/analytics/funnel", axum::routing::get(get_funnel))
        .route(
            "/analytics/agents/usage",
            axum::routing::get(get_agent_usage),
        )
        .route(
            "/analytics/skills/usage",
            axum::routing::get(get_skill_usage),
        )
        .route(
            "/analytics/user-profile",
            axum::routing::get(get_user_profile),
        )
}
