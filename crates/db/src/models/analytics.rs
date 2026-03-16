use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

/// Event category for analytics events
#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "analytics_event_category", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum AnalyticsEventCategory {
    UserAction,
    System,
    Conversion,
}

/// Analytics event record
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct AnalyticsEvent {
    pub id: Uuid,
    pub event_type: String,
    pub event_category: AnalyticsEventCategory,
    pub user_id: Option<String>,
    pub session_id: Option<Uuid>,
    pub properties: sqlx::types::Json<serde_json::Value>,
    pub timestamp: DateTime<Utc>,
    pub platform: Option<String>,
    pub app_version: Option<String>,
    pub os: Option<String>,
    pub device_id: Option<String>,
}

/// Input for creating an analytics event
#[derive(Debug, Deserialize)]
pub struct CreateAnalyticsEvent {
    pub event_type: String,
    pub event_category: AnalyticsEventCategory,
    pub user_id: Option<String>,
    pub session_id: Option<Uuid>,
    pub properties: serde_json::Value,
    pub platform: Option<String>,
    pub app_version: Option<String>,
    pub os: Option<String>,
    pub device_id: Option<String>,
}

/// Batch input for creating multiple analytics events
#[derive(Debug, Deserialize)]
pub struct CreateAnalyticsEventsBatch {
    pub events: Vec<CreateAnalyticsEvent>,
}

impl AnalyticsEvent {
    /// Create a single analytics event
    pub async fn create(
        pool: &SqlitePool,
        data: &CreateAnalyticsEvent,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, AnalyticsEvent>(
            r#"INSERT INTO analytics_events
               (id, event_type, event_category, user_id, session_id, properties, platform, app_version, os, device_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id, event_type, event_category, user_id, session_id, properties, timestamp, platform, app_version, os, device_id"#,
        )
        .bind(id)
        .bind(&data.event_type)
        .bind(&data.event_category)
        .bind(data.user_id.as_deref())
        .bind(data.session_id)
        .bind(sqlx::types::Json(data.properties.clone()))
        .bind(data.platform.as_deref())
        .bind(data.app_version.as_deref())
        .bind(data.os.as_deref())
        .bind(data.device_id.as_deref())
        .fetch_one(pool)
        .await
    }

    /// Create multiple analytics events in a batch
    pub async fn create_batch(
        pool: &SqlitePool,
        events: &[(Uuid, CreateAnalyticsEvent)],
    ) -> Result<Vec<Self>, sqlx::Error> {
        let mut results = Vec::with_capacity(events.len());
        for (id, data) in events {
            let event = Self::create(pool, data, *id).await?;
            results.push(event);
        }
        Ok(results)
    }

    /// Find events by session ID
    pub async fn find_by_session(
        pool: &SqlitePool,
        session_id: Uuid,
        limit: i64,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, AnalyticsEvent>(
            r#"SELECT id, event_type, event_category, user_id, session_id, properties, timestamp, platform, app_version, os, device_id
               FROM analytics_events
               WHERE session_id = ?
               ORDER BY timestamp DESC
               LIMIT ?"#,
        )
        .bind(session_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    }

    /// Find events by user ID
    pub async fn find_by_user(
        pool: &SqlitePool,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, AnalyticsEvent>(
            r#"SELECT id, event_type, event_category, user_id, session_id, properties, timestamp, platform, app_version, os, device_id
               FROM analytics_events
               WHERE user_id = ?
               ORDER BY timestamp DESC
               LIMIT ?"#,
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    }

    /// Count events by type within a time range
    pub async fn count_by_type(
        pool: &SqlitePool,
        event_type: &str,
        since: DateTime<Utc>,
    ) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*)
               FROM analytics_events
               WHERE event_type = ? AND timestamp >= ?"#,
        )
        .bind(event_type)
        .bind(since)
        .fetch_one(pool)
        .await
    }

    /// Get distinct user count (DAU) within a time range
    pub async fn count_distinct_users(
        pool: &SqlitePool,
        since: DateTime<Utc>,
    ) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(DISTINCT user_id)
               FROM analytics_events
               WHERE user_id IS NOT NULL AND timestamp >= ?"#,
        )
        .bind(since)
        .fetch_one(pool)
        .await
    }

    /// Delete old events (data retention)
    pub async fn delete_old_events(
        pool: &SqlitePool,
        before: DateTime<Utc>,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM analytics_events WHERE timestamp < ?")
            .bind(before)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}

/// User profile for analytics aggregation
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct AnalyticsUserProfile {
    pub user_id: String,
    pub first_seen_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub total_sessions: i64,
    pub total_messages: i64,
    pub total_agents_used: i64,
    pub preferred_runner_type: Option<String>,
    pub onboarding_completed: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl AnalyticsUserProfile {
    /// Find or create a user profile
    pub async fn find_or_create(pool: &SqlitePool, user_id: &str) -> Result<Self, sqlx::Error> {
        // Try to find existing profile
        if let Some(profile) = Self::find_by_id(pool, user_id).await? {
            return Ok(profile);
        }

        // Create new profile
        let now = Utc::now();
        sqlx::query_as::<_, AnalyticsUserProfile>(
            r#"INSERT INTO analytics_user_profiles (user_id, first_seen_at, last_seen_at)
               VALUES (?, ?, ?)
               RETURNING user_id, first_seen_at, last_seen_at, total_sessions, total_messages, total_agents_used, preferred_runner_type, onboarding_completed, created_at, updated_at"#,
        )
        .bind(user_id)
        .bind(now)
        .bind(now)
        .fetch_one(pool)
        .await
    }

    /// Find a user profile by ID
    pub async fn find_by_id(pool: &SqlitePool, user_id: &str) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, AnalyticsUserProfile>(
            r#"SELECT user_id, first_seen_at, last_seen_at, total_sessions, total_messages, total_agents_used, preferred_runner_type, onboarding_completed, created_at, updated_at
               FROM analytics_user_profiles
               WHERE user_id = ?"#,
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await
    }

    /// Update last seen timestamp
    pub async fn touch(pool: &SqlitePool, user_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"UPDATE analytics_user_profiles
               SET last_seen_at = datetime('now', 'subsec'),
                   updated_at = datetime('now', 'subsec')
               WHERE user_id = ?"#,
        )
        .bind(user_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Increment session count
    pub async fn increment_sessions(pool: &SqlitePool, user_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"UPDATE analytics_user_profiles
               SET total_sessions = total_sessions + 1,
                   updated_at = datetime('now', 'subsec')
               WHERE user_id = ?"#,
        )
        .bind(user_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Increment message count
    pub async fn increment_messages(pool: &SqlitePool, user_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"UPDATE analytics_user_profiles
               SET total_messages = total_messages + 1,
                   updated_at = datetime('now', 'subsec')
               WHERE user_id = ?"#,
        )
        .bind(user_id)
        .execute(pool)
        .await?;
        Ok(())
    }
}

/// Session stats for analytics aggregation
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct AnalyticsSessionStats {
    pub session_id: Uuid,
    pub user_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub archived_at: Option<DateTime<Utc>>,
    pub duration_seconds: Option<i64>,
    pub message_count: i64,
    pub agent_count: i64,
    pub unique_agents_used: i64,
    pub mention_count: i64,
    pub skill_count: i64,
    pub has_attachments: bool,
}

impl AnalyticsSessionStats {
    /// Create or update session stats
    pub async fn upsert(
        pool: &SqlitePool,
        session_id: Uuid,
        user_id: Option<&str>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, AnalyticsSessionStats>(
            r#"INSERT INTO analytics_session_stats (session_id, user_id)
               VALUES (?, ?)
               ON CONFLICT(session_id) DO UPDATE SET
                   user_id = excluded.user_id
               RETURNING session_id, user_id, created_at, archived_at, duration_seconds, message_count, agent_count, unique_agents_used, mention_count, skill_count, has_attachments"#,
        )
        .bind(session_id)
        .bind(user_id)
        .fetch_one(pool)
        .await
    }

    /// Find session stats by ID
    pub async fn find_by_id(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, AnalyticsSessionStats>(
            r#"SELECT session_id, user_id, created_at, archived_at, duration_seconds, message_count, agent_count, unique_agents_used, mention_count, skill_count, has_attachments
               FROM analytics_session_stats
               WHERE session_id = ?"#,
        )
        .bind(session_id)
        .fetch_optional(pool)
        .await
    }

    /// Mark session as archived
    pub async fn archive(pool: &SqlitePool, session_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"UPDATE analytics_session_stats
               SET archived_at = datetime('now', 'subsec'),
                   duration_seconds = CAST((julianday('now', 'subsec') - julianday(created_at)) * 86400 AS INTEGER)
               WHERE session_id = ?"#,
        )
        .bind(session_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Increment message count
    pub async fn increment_messages(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE analytics_session_stats SET message_count = message_count + 1 WHERE session_id = ?",
        )
        .bind(session_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Increment mention count
    pub async fn increment_mentions(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE analytics_session_stats SET mention_count = mention_count + 1 WHERE session_id = ?",
        )
        .bind(session_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Increment agent count
    pub async fn increment_agents(pool: &SqlitePool, session_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE analytics_session_stats SET agent_count = agent_count + 1, unique_agents_used = unique_agents_used + 1 WHERE session_id = ?",
        )
        .bind(session_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Mark session as having attachments
    pub async fn set_has_attachments(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE analytics_session_stats SET has_attachments = TRUE WHERE session_id = ?",
        )
        .bind(session_id)
        .execute(pool)
        .await?;
        Ok(())
    }
}

// Helper functions for common analytics events

/// Create a session_create event
pub async fn track_session_create(
    pool: &SqlitePool,
    session_id: Uuid,
    user_id: Option<&str>,
    title_length: usize,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "title_length": title_length
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "session_create".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: user_id.map(String::from),
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create a message_send event
pub async fn track_message_send(
    pool: &SqlitePool,
    session_id: Uuid,
    user_id: Option<&str>,
    message_length: usize,
    mentions: &[String],
    has_attachment: bool,
    attachment_count: usize,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "message_length": message_length,
        "mentions": mentions,
        "has_attachment": has_attachment,
        "attachment_count": attachment_count
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "message_send".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: user_id.map(String::from),
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create an agent_run_complete event
pub async fn track_agent_run_complete(
    pool: &SqlitePool,
    session_id: Uuid,
    agent_id: Uuid,
    run_id: Uuid,
    duration_ms: i64,
    success: bool,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "agent_id": agent_id.to_string(),
        "run_id": run_id.to_string(),
        "duration_ms": duration_ms,
        "success": success
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "agent_run_complete".to_string(),
            event_category: AnalyticsEventCategory::System,
            user_id: None,
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

// =============================================================================
// Session Tracking Functions
// =============================================================================

/// Create a session_archive event
pub async fn track_session_archive(
    pool: &SqlitePool,
    session_id: Uuid,
    user_id: Option<&str>,
    duration_seconds: i64,
    message_count: i64,
    agent_count: i64,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "duration_seconds": duration_seconds,
        "message_count": message_count,
        "agent_count": agent_count
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "session_archive".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: user_id.map(String::from),
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create a session_restore event
pub async fn track_session_restore(
    pool: &SqlitePool,
    session_id: Uuid,
    user_id: Option<&str>,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({});
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "session_restore".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: user_id.map(String::from),
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create a session_delete event
pub async fn track_session_delete(
    pool: &SqlitePool,
    session_id: Uuid,
    user_id: Option<&str>,
    had_messages: bool,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "had_messages": had_messages
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "session_delete".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: user_id.map(String::from),
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

// =============================================================================
// Agent Tracking Functions
// =============================================================================

/// Create an agent_add event
pub async fn track_agent_add(
    pool: &SqlitePool,
    session_id: Uuid,
    user_id: Option<&str>,
    agent_id: Uuid,
    agent_name: &str,
    runner_type: &str,
    has_workspace: bool,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "agent_id": agent_id.to_string(),
        "agent_name": agent_name,
        "runner_type": runner_type,
        "has_workspace": has_workspace
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "agent_add".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: user_id.map(String::from),
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create an agent_remove event
pub async fn track_agent_remove(
    pool: &SqlitePool,
    session_id: Uuid,
    user_id: Option<&str>,
    agent_id: Uuid,
    session_duration_seconds: i64,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "agent_id": agent_id.to_string(),
        "session_duration_seconds": session_duration_seconds
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "agent_remove".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: user_id.map(String::from),
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create an agent_run_start event
pub async fn track_agent_run_start(
    pool: &SqlitePool,
    session_id: Uuid,
    agent_id: Uuid,
    run_id: Uuid,
    executor_profile: Option<&str>,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "agent_id": agent_id.to_string(),
        "run_id": run_id.to_string(),
        "executor_profile": executor_profile
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "agent_run_start".to_string(),
            event_category: AnalyticsEventCategory::System,
            user_id: None,
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create an agent_run_error event
pub async fn track_agent_run_error(
    pool: &SqlitePool,
    session_id: Uuid,
    agent_id: Uuid,
    run_id: Uuid,
    error_type: &str,
    error_message: &str,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "agent_id": agent_id.to_string(),
        "run_id": run_id.to_string(),
        "error_type": error_type,
        "error_message": error_message
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "agent_run_error".to_string(),
            event_category: AnalyticsEventCategory::System,
            user_id: None,
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create an agent_stop event
pub async fn track_agent_stop(
    pool: &SqlitePool,
    session_id: Uuid,
    agent_id: Uuid,
    run_id: Uuid,
    duration_ms: i64,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "agent_id": agent_id.to_string(),
        "run_id": run_id.to_string(),
        "duration_ms": duration_ms
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "agent_stop".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: None,
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

// =============================================================================
// Skill Tracking Functions
// =============================================================================

/// Create a skill_install event
pub async fn track_skill_install(
    pool: &SqlitePool,
    user_id: Option<&str>,
    skill_id: Uuid,
    skill_name: &str,
    source: &str,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "skill_id": skill_id.to_string(),
        "skill_name": skill_name,
        "source": source
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "skill_install".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: user_id.map(String::from),
            session_id: None,
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create a skill_assign event
pub async fn track_skill_assign(
    pool: &SqlitePool,
    user_id: Option<&str>,
    skill_id: Uuid,
    agent_id: Uuid,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "skill_id": skill_id.to_string(),
        "agent_id": agent_id.to_string()
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "skill_assign".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: user_id.map(String::from),
            session_id: None,
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create a skill_enable event
pub async fn track_skill_enable(
    pool: &SqlitePool,
    user_id: Option<&str>,
    skill_id: Uuid,
    agent_id: Uuid,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "skill_id": skill_id.to_string(),
        "agent_id": agent_id.to_string()
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "skill_enable".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: user_id.map(String::from),
            session_id: None,
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create a skill_disable event
pub async fn track_skill_disable(
    pool: &SqlitePool,
    user_id: Option<&str>,
    skill_id: Uuid,
    agent_id: Uuid,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "skill_id": skill_id.to_string(),
        "agent_id": agent_id.to_string()
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "skill_disable".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: user_id.map(String::from),
            session_id: None,
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create a skill_invoke event
pub async fn track_skill_invoke(
    pool: &SqlitePool,
    session_id: Uuid,
    skill_id: Uuid,
    agent_id: Uuid,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "skill_id": skill_id.to_string(),
        "agent_id": agent_id.to_string()
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "skill_invoke".to_string(),
            event_category: AnalyticsEventCategory::System,
            user_id: None,
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

// =============================================================================
// Token Tracking Functions
// =============================================================================

/// Create a token_usage event
pub async fn track_token_usage(
    pool: &SqlitePool,
    session_id: Uuid,
    run_id: Option<Uuid>,
    model: Option<&str>,
    input_tokens: i64,
    output_tokens: i64,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let total_tokens = input_tokens + output_tokens;
    let properties = serde_json::json!({
        "run_id": run_id.map(|id| id.to_string()),
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "token_usage".to_string(),
            event_category: AnalyticsEventCategory::System,
            user_id: None,
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create a context_compression event
pub async fn track_context_compression(
    pool: &SqlitePool,
    session_id: Uuid,
    compression_ratio: f64,
    warning_code: Option<&str>,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "compression_ratio": compression_ratio,
        "warning_code": warning_code
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "context_compression".to_string(),
            event_category: AnalyticsEventCategory::System,
            user_id: None,
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

// =============================================================================
// Conversion Tracking Functions
// =============================================================================

/// Create a first_session event
pub async fn track_first_session(
    pool: &SqlitePool,
    user_id: &str,
    session_id: Uuid,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "session_id": session_id.to_string()
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "first_session".to_string(),
            event_category: AnalyticsEventCategory::Conversion,
            user_id: Some(user_id.to_string()),
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create a returning_user event
pub async fn track_returning_user(
    pool: &SqlitePool,
    user_id: &str,
    days_since_last_visit: i64,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "days_since_last_visit": days_since_last_visit
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "returning_user".to_string(),
            event_category: AnalyticsEventCategory::Conversion,
            user_id: Some(user_id.to_string()),
            session_id: None,
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create a first_agent_added event
pub async fn track_first_agent_added(
    pool: &SqlitePool,
    session_id: Uuid,
    agent_id: Uuid,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "agent_id": agent_id.to_string()
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "first_agent_added".to_string(),
            event_category: AnalyticsEventCategory::Conversion,
            user_id: None,
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create a first_message_sent event
pub async fn track_first_message_sent(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({});
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "first_message_sent".to_string(),
            event_category: AnalyticsEventCategory::Conversion,
            user_id: None,
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}

/// Create a first_skill_used event
pub async fn track_first_skill_used(
    pool: &SqlitePool,
    session_id: Uuid,
    skill_id: Uuid,
    agent_id: Uuid,
) -> Result<AnalyticsEvent, sqlx::Error> {
    let properties = serde_json::json!({
        "skill_id": skill_id.to_string(),
        "agent_id": agent_id.to_string()
    });
    AnalyticsEvent::create(
        pool,
        &CreateAnalyticsEvent {
            event_type: "first_skill_used".to_string(),
            event_category: AnalyticsEventCategory::Conversion,
            user_id: None,
            session_id: Some(session_id),
            properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        },
        Uuid::new_v4(),
    )
    .await
}
