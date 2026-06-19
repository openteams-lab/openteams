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
    pub period: Option<String>, // 24h, 7d, 30d
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
