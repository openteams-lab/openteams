pub async fn get_agent_usage(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Query(params): axum::extract::Query<UsageQueryParams>,
) -> Result<Json<ApiResponse<AgentUsageStatsResponse>>, (StatusCode, Json<ApiResponse<String>>)> {
    let pool = &deployment.db().pool;
    let limit = params.limit.unwrap_or(20).min(100);

    // Calculate time range based on period
    let since = match params.period.as_deref() {
        Some("24h") => chrono::Utc::now() - chrono::Duration::hours(24),
        Some("7d") => chrono::Utc::now() - chrono::Duration::days(7),
        Some("30d") => chrono::Utc::now() - chrono::Duration::days(30),
        _ => chrono::Utc::now() - chrono::Duration::days(30),
    };

    // Query agent usage from analytics_events
    let rows = sqlx::query_as::<_, (String, i64, i64)>(
        r#"
        SELECT
            json_extract(properties, '$.agent_id') as agent_id,
            COUNT(*) as usage_count,
            COUNT(DISTINCT user_id) as active_users
        FROM analytics_events
        WHERE event_type IN ('agent_add', 'agent_run_start')
            AND timestamp >= ?
            AND json_extract(properties, '$.agent_id') IS NOT NULL
        GROUP BY json_extract(properties, '$.agent_id')
        ORDER BY usage_count DESC
        LIMIT ?
        "#,
    )
    .bind(since)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error(&format!(
                "Failed to query agent usage: {}",
                e
            ))),
        )
    })?;

    let mut agents = Vec::new();
    let mut total_usage = 0i64;

    for (agent_id, usage_count, active_users) in rows {
        total_usage += usage_count;

        // Try to get agent name from properties
        let agent_name = sqlx::query_scalar::<_, Option<String>>(
            "SELECT json_extract(properties, '$.agent_name') FROM analytics_events WHERE event_type = 'agent_add' AND json_extract(properties, '$.agent_id') = ? LIMIT 1"
        )
        .bind(&agent_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .flatten()
        .unwrap_or_else(|| agent_id.clone());

        // Try to get runner_type
        let runner_type = sqlx::query_scalar::<_, Option<String>>(
            "SELECT json_extract(properties, '$.runner_type') FROM analytics_events WHERE event_type = 'agent_add' AND json_extract(properties, '$.agent_id') = ? LIMIT 1"
        )
        .bind(&agent_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .flatten()
        .unwrap_or_else(|| "unknown".to_string());

        agents.push(AgentUsageItem {
            agent_id,
            agent_name,
            runner_type,
            is_preset: true, // Simplified - would need to join with chat_agent table
            usage_count,
            active_users,
        });
    }

    Ok(Json(ApiResponse::success(AgentUsageStatsResponse {
        agents,
        total_usage,
    })))
}

/// Get skill usage statistics
pub async fn get_skill_usage(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Query(params): axum::extract::Query<UsageQueryParams>,
) -> Result<Json<ApiResponse<SkillUsageStatsResponse>>, (StatusCode, Json<ApiResponse<String>>)> {
    let pool = &deployment.db().pool;
    let limit = params.limit.unwrap_or(20).min(100);

    // Calculate time range based on period
    let since = match params.period.as_deref() {
        Some("24h") => chrono::Utc::now() - chrono::Duration::hours(24),
        Some("7d") => chrono::Utc::now() - chrono::Duration::days(7),
        Some("30d") => chrono::Utc::now() - chrono::Duration::days(30),
        _ => chrono::Utc::now() - chrono::Duration::days(30),
    };

    // Query skill invoke counts
    let invoke_rows = sqlx::query_as::<_, (String, i64, i64)>(
        r#"
        SELECT
            json_extract(properties, '$.skill_id') as skill_id,
            COUNT(*) as usage_count,
            COUNT(DISTINCT user_id) as active_users
        FROM analytics_events
        WHERE event_type = 'skill_invoke'
            AND timestamp >= ?
            AND json_extract(properties, '$.skill_id') IS NOT NULL
        GROUP BY json_extract(properties, '$.skill_id')
        "#,
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error(&format!(
                "Failed to query skill usage: {}",
                e
            ))),
        )
    })?;

    // Query skill install counts
    let install_rows: std::collections::HashMap<String, i64> = sqlx::query_as::<_, (String, i64)>(
        r#"
        SELECT
            json_extract(properties, '$.skill_id') as skill_id,
            COUNT(*) as install_count
        FROM analytics_events
        WHERE event_type = 'skill_install'
            AND json_extract(properties, '$.skill_id') IS NOT NULL
        GROUP BY json_extract(properties, '$.skill_id')
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error(&format!(
                "Failed to query skill installs: {}",
                e
            ))),
        )
    })?
    .into_iter()
    .collect();

    let mut skills = Vec::new();
    let mut total_usage = 0i64;

    for (skill_id, usage_count, active_users) in invoke_rows {
        total_usage += usage_count;
        let install_count = install_rows.get(&skill_id).copied().unwrap_or(0);

        // Get skill name and source
        let skill_name = sqlx::query_scalar::<_, Option<String>>(
            "SELECT json_extract(properties, '$.skill_name') FROM analytics_events WHERE event_type = 'skill_install' AND json_extract(properties, '$.skill_id') = ? LIMIT 1"
        )
        .bind(&skill_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .flatten()
        .unwrap_or_else(|| skill_id.clone());

        let source = sqlx::query_scalar::<_, Option<String>>(
            "SELECT json_extract(properties, '$.source') FROM analytics_events WHERE event_type = 'skill_install' AND json_extract(properties, '$.skill_id') = ? LIMIT 1"
        )
        .bind(&skill_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .flatten()
        .unwrap_or_else(|| "unknown".to_string());

        skills.push(SkillUsageItem {
            skill_id,
            skill_name,
            source,
            install_count,
            usage_count,
            active_users,
        });
    }

    // Sort by usage count
    skills.sort_by(|a, b| b.usage_count.cmp(&a.usage_count));
    skills.truncate(limit as usize);

    Ok(Json(ApiResponse::success(SkillUsageStatsResponse {
        skills,
        total_usage,
    })))
}
