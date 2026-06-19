#[cfg(test)]
mod tests {
    use serde_json::json;
    use services::services::analytics::{
        analytics_distinct_id_for_record, analytics_posthog_properties_for_record,
    };

    use super::*;

    #[test]
    fn test_analytics_distinct_id_prefers_user_id() {
        let event = AnalyticsEvent {
            id: Uuid::nil(),
            event_type: "message_send".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: Some("u-1".to_string()),
            session_id: Some(Uuid::nil()),
            properties: sqlx::types::Json(json!({})),
            timestamp: chrono::Utc::now(),
            platform: Some("web".to_string()),
            app_version: Some("1.0.0".to_string()),
            os: Some("macOS".to_string()),
            device_id: Some("d-1".to_string()),
        };

        assert_eq!(analytics_distinct_id_for_record(&event), "user:u-1");
    }

    #[test]
    fn test_analytics_posthog_properties_merge_metadata() {
        let session_id = Uuid::nil();
        let event = AnalyticsEvent {
            id: Uuid::nil(),
            event_type: "message_send".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: Some("u-1".to_string()),
            session_id: Some(session_id),
            properties: sqlx::types::Json(json!({"message_length": 12})),
            timestamp: chrono::Utc::now(),
            platform: Some("web".to_string()),
            app_version: Some("1.0.0".to_string()),
            os: Some("macOS".to_string()),
            device_id: Some("d-1".to_string()),
        };

        let properties = analytics_posthog_properties_for_record(&event, "/analytics/events");

        assert_eq!(properties["message_length"], json!(12));
        assert_eq!(properties["event_category"], json!("user_action"));
        assert_eq!(properties["user_id"], json!("u-1"));
        assert_eq!(properties["session_id"], json!(session_id.to_string()));
        assert_eq!(properties["device_id"], json!("d-1"));
        assert_eq!(properties["ingest_path"], json!("/analytics/events"));
    }

    #[test]
    fn test_resolve_analytics_user_id_uses_message_event_fallback() {
        assert_eq!(
            resolve_analytics_user_id(None, "user-fallback", "message_send"),
            Some("user-fallback".to_string())
        );
        assert_eq!(
            resolve_analytics_user_id(None, "user-fallback", "first_message_sent"),
            Some("user-fallback".to_string())
        );
    }

    #[test]
    fn test_resolve_analytics_user_id_keeps_explicit_value() {
        assert_eq!(
            resolve_analytics_user_id(
                Some("user-explicit".to_string()),
                "user-fallback",
                "message_send",
            ),
            Some("user-explicit".to_string())
        );
    }

    #[test]
    fn test_resolve_analytics_user_id_does_not_fill_non_message_events() {
        assert_eq!(
            resolve_analytics_user_id(None, "user-fallback", "agent_run_start"),
            None
        );
    }
}
