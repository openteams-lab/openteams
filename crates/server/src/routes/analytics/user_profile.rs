pub async fn get_user_profile(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Query(params): axum::extract::Query<UserProfileQueryParams>,
) -> Result<Json<ApiResponse<UserProfileResponse>>, (StatusCode, Json<ApiResponse<String>>)> {
    let pool = &deployment.db().pool;
    let user_id = &params.user_id;

    // Get first and last seen
    let first_seen: Option<String> =
        sqlx::query_scalar("SELECT MIN(timestamp) FROM analytics_events WHERE user_id = ?")
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
            .map(|dt: chrono::DateTime<chrono::Utc>| dt.to_rfc3339());

    let last_seen: Option<String> =
        sqlx::query_scalar("SELECT MAX(timestamp) FROM analytics_events WHERE user_id = ?")
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
            .map(|dt: chrono::DateTime<chrono::Utc>| dt.to_rfc3339());

    // Behavior flags
    let has_created_session: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM analytics_events WHERE user_id = ? AND event_type = 'session_create')"
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    let has_created_agent: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM analytics_events WHERE user_id = ? AND event_type = 'agent_add')"
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    let has_sent_message: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM analytics_events WHERE user_id = ? AND event_type = 'message_send')"
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    let has_used_skill: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM analytics_events WHERE user_id = ? AND event_type = 'skill_invoke')"
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    // Check for preset agent usage (simplified)
    let has_used_preset_agent = has_created_agent;

    // Stats
    let total_sessions: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM analytics_events WHERE user_id = ? AND event_type = 'session_create'",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let total_messages: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM analytics_events WHERE user_id = ? AND event_type = 'message_send'",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let total_agents_used: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT json_extract(properties, '$.agent_id')) FROM analytics_events WHERE user_id = ? AND event_type = 'agent_add'"
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let total_skills_used: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT json_extract(properties, '$.skill_id')) FROM analytics_events WHERE user_id = ? AND event_type = 'skill_invoke'"
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // Top agents
    let top_agents: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT json_extract(properties, '$.agent_name')
        FROM analytics_events
        WHERE user_id = ? AND event_type = 'agent_add'
        GROUP BY json_extract(properties, '$.agent_id')
        ORDER BY COUNT(*) DESC
        LIMIT 5
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    // Top skills
    let top_skills: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT json_extract(properties, '$.skill_name')
        FROM analytics_events
        WHERE user_id = ? AND event_type = 'skill_invoke'
        GROUP BY json_extract(properties, '$.skill_id')
        ORDER BY COUNT(*) DESC
        LIMIT 5
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    Ok(Json(ApiResponse::success(UserProfileResponse {
        user_id: user_id.clone(),
        first_seen,
        last_seen,
        behavior_flags: UserBehaviorFlags {
            has_created_session,
            has_created_agent,
            has_used_preset_agent,
            has_sent_message,
            has_used_skill,
        },
        stats: UserStats {
            total_sessions,
            total_messages,
            total_agents_used,
            total_skills_used,
        },
        top_agents,
        top_skills,
    })))
}
