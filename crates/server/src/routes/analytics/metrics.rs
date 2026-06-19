pub async fn get_metrics(
    State(deployment): State<DeploymentImpl>,
) -> Result<Json<ApiResponse<AnalyticsMetricsResponse>>, (StatusCode, Json<ApiResponse<String>>)> {
    let pool = &deployment.db().pool;

    // Calculate DAU (users active in last 24 hours)
    let yesterday = chrono::Utc::now() - chrono::Duration::hours(24);
    let dau = AnalyticsEvent::count_distinct_users(pool, yesterday)
        .await
        .unwrap_or(0);

    // Count sessions created in last 24 hours
    let total_sessions = AnalyticsEvent::count_by_type(pool, "session_create", yesterday)
        .await
        .unwrap_or(0);

    // Count messages sent in last 24 hours
    let total_messages = AnalyticsEvent::count_by_type(pool, "message_send", yesterday)
        .await
        .unwrap_or(0);

    // Count all events in last 24 hours
    let total_events =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM analytics_events WHERE timestamp >= ?")
            .bind(yesterday)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    Ok(Json(ApiResponse::success(AnalyticsMetricsResponse {
        dau,
        total_sessions,
        total_messages,
        total_events,
    })))
}
