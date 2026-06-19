pub async fn get_funnel(
    State(deployment): State<DeploymentImpl>,
) -> Result<Json<ApiResponse<FunnelMetricsResponse>>, (StatusCode, Json<ApiResponse<String>>)> {
    let pool = &deployment.db().pool;

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

    let base = total_users.max(1) as f64;

    let stages = vec![
        FunnelStage {
            name: "用户进入".to_string(),
            count: total_users,
            percentage: 100.0,
        },
        FunnelStage {
            name: "创建会话".to_string(),
            count: users_with_session,
            percentage: (users_with_session as f64 / base) * 100.0,
        },
        FunnelStage {
            name: "添加AI成员".to_string(),
            count: users_with_agent,
            percentage: (users_with_agent as f64 / base) * 100.0,
        },
        FunnelStage {
            name: "发送消息".to_string(),
            count: users_with_message,
            percentage: (users_with_message as f64 / base) * 100.0,
        },
        FunnelStage {
            name: "使用Skill".to_string(),
            count: users_with_skill,
            percentage: (users_with_skill as f64 / base) * 100.0,
        },
    ];

    let conversion_rates = vec![
        FunnelConversionRate {
            from_stage: "用户进入".to_string(),
            to_stage: "创建会话".to_string(),
            rate: if total_users > 0 {
                users_with_session as f64 / total_users as f64
            } else {
                0.0
            },
        },
        FunnelConversionRate {
            from_stage: "创建会话".to_string(),
            to_stage: "添加AI成员".to_string(),
            rate: if users_with_session > 0 {
                users_with_agent as f64 / users_with_session as f64
            } else {
                0.0
            },
        },
        FunnelConversionRate {
            from_stage: "添加AI成员".to_string(),
            to_stage: "发送消息".to_string(),
            rate: if users_with_agent > 0 {
                users_with_message as f64 / users_with_agent as f64
            } else {
                0.0
            },
        },
        FunnelConversionRate {
            from_stage: "发送消息".to_string(),
            to_stage: "使用Skill".to_string(),
            rate: if users_with_message > 0 {
                users_with_skill as f64 / users_with_message as f64
            } else {
                0.0
            },
        },
    ];

    Ok(Json(ApiResponse::success(FunnelMetricsResponse {
        stages,
        conversion_rates,
    })))
}
