use axum::{Json, extract::State, http::StatusCode};
use db::models::analytics::{AnalyticsEvent, AnalyticsEventCategory, CreateAnalyticsEvent};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::DeploymentImpl;

/// Request body for creating a single analytics event from frontend
#[derive(Debug, Deserialize, TS)]
pub struct TrackEventRequest {
    pub event_type: String,
    pub event_category: String,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    pub properties: serde_json::Value,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub app_version: Option<String>,
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
}

/// Request body for batch event tracking
#[derive(Debug, Deserialize, TS)]
pub struct TrackEventsBatchRequest {
    pub events: Vec<TrackEventRequest>,
}

/// Response for analytics metrics
#[derive(Debug, Serialize, TS)]
pub struct AnalyticsMetricsResponse {
    pub dau: i64,
    pub total_sessions: i64,
    pub total_messages: i64,
    pub total_events: i64,
}

// =============================================================================
// Dashboard Metrics
// =============================================================================

/// Dashboard metrics response
#[derive(Debug, Serialize, TS)]
pub struct DashboardMetricsResponse {
    // Funnel metrics
    pub total_users: i64,
    pub users_with_session: i64,
    pub users_with_agent: i64,
    pub users_with_message: i64,
    pub users_with_skill: i64,

    // Activity
    pub dau: i64,
    pub mau: i64,
    pub sessions_created_24h: i64,
    pub messages_sent_24h: i64,

    // Performance
    pub avg_agent_response_ms: f64,
    pub agent_success_rate: f64,

    // Adoption
    pub active_agents_count: i64,
    pub skills_installed_count: i64,
}

/// Funnel stage data
#[derive(Debug, Serialize, TS)]
pub struct FunnelStage {
    pub name: String,
    pub count: i64,
    pub percentage: f64,
}

/// Funnel conversion rate
#[derive(Debug, Serialize, TS)]
pub struct FunnelConversionRate {
    pub from_stage: String,
    pub to_stage: String,
    pub rate: f64,
}

/// Funnel metrics response
#[derive(Debug, Serialize, TS)]
pub struct FunnelMetricsResponse {
    pub stages: Vec<FunnelStage>,
    pub conversion_rates: Vec<FunnelConversionRate>,
}

// =============================================================================
// Agent Usage Statistics
// =============================================================================

/// Query parameters for usage statistics
#[derive(Debug, Deserialize, TS)]
pub struct UsageQueryParams {
    pub period: Option<String>,  // 24h, 7d, 30d
    pub limit: Option<i64>,
}

/// Agent usage statistics
#[derive(Debug, Serialize, TS)]
pub struct AgentUsageItem {
    pub agent_id: String,
    pub agent_name: String,
    pub runner_type: String,
    pub is_preset: bool,
    pub usage_count: i64,
    pub active_users: i64,
}

/// Agent usage statistics response
#[derive(Debug, Serialize, TS)]
pub struct AgentUsageStatsResponse {
    pub agents: Vec<AgentUsageItem>,
    pub total_usage: i64,
}

// =============================================================================
// Skill Usage Statistics
// =============================================================================

/// Skill usage statistics
#[derive(Debug, Serialize, TS)]
pub struct SkillUsageItem {
    pub skill_id: String,
    pub skill_name: String,
    pub source: String,
    pub install_count: i64,
    pub usage_count: i64,
    pub active_users: i64,
}

/// Skill usage statistics response
#[derive(Debug, Serialize, TS)]
pub struct SkillUsageStatsResponse {
    pub skills: Vec<SkillUsageItem>,
    pub total_usage: i64,
}

// =============================================================================
// User Profile
// =============================================================================

/// User behavior flags
#[derive(Debug, Serialize, TS)]
pub struct UserBehaviorFlags {
    pub has_created_session: bool,
    pub has_created_agent: bool,
    pub has_used_preset_agent: bool,
    pub has_sent_message: bool,
    pub has_used_skill: bool,
}

/// User statistics
#[derive(Debug, Serialize, TS)]
pub struct UserStats {
    pub total_sessions: i64,
    pub total_messages: i64,
    pub total_agents_used: i64,
    pub total_skills_used: i64,
}

/// User profile response
#[derive(Debug, Serialize, TS)]
pub struct UserProfileResponse {
    pub user_id: String,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
    pub behavior_flags: UserBehaviorFlags,
    pub stats: UserStats,
    pub top_agents: Vec<String>,
    pub top_skills: Vec<String>,
}

/// Query parameters for user profile
#[derive(Debug, Deserialize, TS)]
pub struct UserProfileQueryParams {
    pub user_id: String,
}

/// Track a single analytics event
pub async fn track_event(
    State(deployment): State<DeploymentImpl>,
    Json(req): Json<TrackEventRequest>,
) -> Result<Json<ApiResponse<String>>, (StatusCode, Json<ApiResponse<String>>)> {
    let pool = &deployment.db().pool;

    // Parse event category
    let event_category = match req.event_category.as_str() {
        "user_action" => AnalyticsEventCategory::UserAction,
        "system" => AnalyticsEventCategory::System,
        "conversion" => AnalyticsEventCategory::Conversion,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error(
                    "Invalid event_category. Must be 'user_action', 'system', or 'conversion'",
                )),
            ));
        }
    };

    // Parse session_id if provided
    let session_id = match req.session_id {
        Some(ref s) if !s.is_empty() => match Uuid::parse_str(s) {
            Ok(id) => Some(id),
            Err(_) => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ApiResponse::error("Invalid session_id format")),
                ));
            }
        },
        _ => None,
    };

    let create_event = CreateAnalyticsEvent {
        event_type: req.event_type,
        event_category,
        user_id: req.user_id,
        session_id,
        properties: req.properties,
        platform: req.platform,
        app_version: req.app_version,
        os: req.os,
        device_id: req.device_id,
    };

    match AnalyticsEvent::create(pool, &create_event, Uuid::new_v4()).await {
        Ok(_) => Ok(Json(ApiResponse::success("Event tracked".to_string()))),
        Err(e) => {
            tracing::error!("Failed to track analytics event: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error("Failed to track event")),
            ))
        }
    }
}

/// Track multiple analytics events in a batch
pub async fn track_events_batch(
    State(deployment): State<DeploymentImpl>,
    Json(req): Json<TrackEventsBatchRequest>,
) -> Result<Json<ApiResponse<String>>, (StatusCode, Json<ApiResponse<String>>)> {
    let pool = &deployment.db().pool;

    let mut events_to_create = Vec::with_capacity(req.events.len());

    for event_req in req.events {
        let event_category = match event_req.event_category.as_str() {
            "user_action" => AnalyticsEventCategory::UserAction,
            "system" => AnalyticsEventCategory::System,
            "conversion" => AnalyticsEventCategory::Conversion,
            _ => continue, // Skip invalid events
        };

        let session_id = event_req.session_id.and_then(|s| {
            if s.is_empty() {
                None
            } else {
                Uuid::parse_str(&s).ok()
            }
        });

        events_to_create.push((
            Uuid::new_v4(),
            CreateAnalyticsEvent {
                event_type: event_req.event_type,
                event_category,
                user_id: event_req.user_id,
                session_id,
                properties: event_req.properties,
                platform: event_req.platform,
                app_version: event_req.app_version,
                os: event_req.os,
                device_id: event_req.device_id,
            },
        ));
    }

    match AnalyticsEvent::create_batch(pool, &events_to_create).await {
        Ok(events) => Ok(Json(ApiResponse::success(format!(
            "{} events tracked",
            events.len()
        )))),
        Err(e) => {
            tracing::error!("Failed to track analytics events batch: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error("Failed to track events")),
            ))
        }
    }
}

/// Get analytics metrics (for admin/monitoring)
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

/// Get dashboard metrics (comprehensive overview)
pub async fn get_dashboard(
    State(deployment): State<DeploymentImpl>,
) -> Result<Json<ApiResponse<DashboardMetricsResponse>>, (StatusCode, Json<ApiResponse<String>>)> {
    let pool = &deployment.db().pool;
    let now = chrono::Utc::now();
    let yesterday = now - chrono::Duration::hours(24);
    let month_ago = now - chrono::Duration::days(30);

    // Total distinct users
    let total_users: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT user_id) FROM analytics_events WHERE user_id IS NOT NULL"
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
        "SELECT COUNT(*) FROM analytics_events WHERE event_type = 'skill_install'"
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

/// Get funnel conversion metrics
pub async fn get_funnel(
    State(deployment): State<DeploymentImpl>,
) -> Result<Json<ApiResponse<FunnelMetricsResponse>>, (StatusCode, Json<ApiResponse<String>>)> {
    let pool = &deployment.db().pool;

    // Total distinct users
    let total_users: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT user_id) FROM analytics_events WHERE user_id IS NOT NULL"
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

/// Get agent usage statistics
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
        "#
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
        "#
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
        "#
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

/// Get user profile with behavior flags
pub async fn get_user_profile(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Query(params): axum::extract::Query<UserProfileQueryParams>,
) -> Result<Json<ApiResponse<UserProfileResponse>>, (StatusCode, Json<ApiResponse<String>>)> {
    let pool = &deployment.db().pool;
    let user_id = &params.user_id;

    // Get first and last seen
    let first_seen: Option<String> = sqlx::query_scalar(
        "SELECT MIN(timestamp) FROM analytics_events WHERE user_id = ?"
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .map(|dt: chrono::DateTime<chrono::Utc>| dt.to_rfc3339());

    let last_seen: Option<String> = sqlx::query_scalar(
        "SELECT MAX(timestamp) FROM analytics_events WHERE user_id = ?"
    )
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
        "SELECT COUNT(*) FROM analytics_events WHERE user_id = ? AND event_type = 'session_create'"
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let total_messages: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM analytics_events WHERE user_id = ? AND event_type = 'message_send'"
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
        "#
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
        "#
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
        .route("/analytics/agents/usage", axum::routing::get(get_agent_usage))
        .route("/analytics/skills/usage", axum::routing::get(get_skill_usage))
        .route("/analytics/user-profile", axum::routing::get(get_user_profile))
}
