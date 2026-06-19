pub async fn get_dashboard(
    State(deployment): State<DeploymentImpl>,
) -> Result<Json<ApiResponse<DashboardMetricsResponse>>, (StatusCode, Json<ApiResponse<String>>)> {
    let pool = &deployment.db().pool;
    let now = chrono::Utc::now();
    let yesterday = now - chrono::Duration::hours(24);
    let month_ago = now - chrono::Duration::days(30);

    // Total distinct users
    let total_users: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT user_id) FROM analytics_events WHERE user_id IS NOT NULL",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // Users with session created
    let users_with_session: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT user_id) FROM analytics_events WHERE event_type = 'session_create' AND user_id IS NOT NULL"
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // Users with agent added
    let users_with_agent: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT user_id) FROM analytics_events WHERE event_type = 'agent_add' AND user_id IS NOT NULL"
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // Users with message sent
    let users_with_message: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT user_id) FROM analytics_events WHERE event_type = 'message_send' AND user_id IS NOT NULL"
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // Users with skill used
    let users_with_skill: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT user_id) FROM analytics_events WHERE event_type = 'skill_invoke' AND user_id IS NOT NULL"
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // DAU
    let dau = AnalyticsEvent::count_distinct_users(pool, yesterday)
        .await
        .unwrap_or(0);

    // MAU
    let mau: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT user_id) FROM analytics_events WHERE timestamp >= ? AND user_id IS NOT NULL"
    )
    .bind(month_ago)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // Sessions created in 24h
    let sessions_created_24h = AnalyticsEvent::count_by_type(pool, "session_create", yesterday)
        .await
        .unwrap_or(0);

    // Messages sent in 24h
    let messages_sent_24h = AnalyticsEvent::count_by_type(pool, "message_send", yesterday)
        .await
        .unwrap_or(0);

    // Average agent response time
    let avg_agent_response_ms: f64 = sqlx::query_scalar(
        "SELECT AVG(CAST(json_extract(properties, '$.duration_ms') AS REAL)) FROM analytics_events WHERE event_type = 'agent_run_complete' AND timestamp >= ?"
    )
    .bind(yesterday)
    .fetch_one(pool)
    .await
    .unwrap_or(None)
    .unwrap_or(0.0);

    // Agent success rate
    let total_runs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM analytics_events WHERE event_type = 'agent_run_complete' AND timestamp >= ?"
    )
    .bind(yesterday)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let successful_runs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM analytics_events WHERE event_type = 'agent_run_complete' AND json_extract(properties, '$.success') = 1 AND timestamp >= ?"
    )
    .bind(yesterday)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let agent_success_rate = if total_runs > 0 {
        successful_runs as f64 / total_runs as f64
    } else {
        0.0
    };

    // Active agents count
    let active_agents_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT json_extract(properties, '$.agent_id')) FROM analytics_events WHERE event_type = 'agent_run_start' AND timestamp >= ?"
    )
    .bind(yesterday)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // Skills installed count
    let skills_installed_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM analytics_events WHERE event_type = 'skill_install'",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    Ok(Json(ApiResponse::success(DashboardMetricsResponse {
        total_users,
        users_with_session,
        users_with_agent,
        users_with_message,
        users_with_skill,
        dau,
        mau,
        sessions_created_24h,
        messages_sent_24h,
        avg_agent_response_ms,
        agent_success_rate,
        active_agents_count,
        skills_installed_count,
    })))
}
