use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    sync::Arc,
    time::Duration,
};

use db::models::analytics::{AnalyticsEvent, AnalyticsEventCategory};
use os_info;
use serde_json::{Value, json};
use tokio::sync::mpsc;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const POSTHOG_UPLOAD_QUEUE_CAPACITY: usize = 1024;

#[derive(Debug, Clone)]
pub struct AnalyticsContext {
    pub user_id: String,
    pub analytics_service: AnalyticsService,
}

#[derive(Debug, Clone)]
pub struct AnalyticsConfig {
    pub posthog_api_key: String,
    pub posthog_api_endpoint: String,
}

impl AnalyticsConfig {
    pub fn new() -> Option<Self> {
        let api_key = option_env!("POSTHOG_API_KEY")
            .map(|s| s.to_string())
            .or_else(|| std::env::var("POSTHOG_API_KEY").ok())?;
        let api_endpoint = option_env!("POSTHOG_API_ENDPOINT")
            .map(|s| s.to_string())
            .or_else(|| std::env::var("POSTHOG_API_ENDPOINT").ok())?;

        Some(Self {
            posthog_api_key: api_key,
            posthog_api_endpoint: api_endpoint,
        })
    }
}

#[derive(Clone, Debug)]
pub struct AnalyticsService {
    api_key: Arc<str>,
    sender: mpsc::Sender<PosthogCaptureRequest>,
}

#[derive(Debug)]
struct PosthogCaptureRequest {
    event_name: String,
    payload: Value,
}

impl AnalyticsService {
    pub fn new(config: AnalyticsConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap();
        let endpoint = format!(
            "{}/capture/",
            config.posthog_api_endpoint.trim_end_matches('/')
        );
        let (sender, receiver) = mpsc::channel(POSTHOG_UPLOAD_QUEUE_CAPACITY);

        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(run_posthog_worker(client, endpoint, receiver));
        } else {
            tracing::warn!(
                "AnalyticsService initialized without tokio runtime; PostHog uploads disabled"
            );
        }

        Self {
            api_key: Arc::<str>::from(config.posthog_api_key),
            sender,
        }
    }

    pub fn track_event(&self, user_id: &str, event_name: &str, properties: Option<Value>) {
        self.track_distinct_event(user_id, event_name, properties);
    }

    pub fn track_distinct_event(
        &self,
        distinct_id: &str,
        event_name: &str,
        properties: Option<Value>,
    ) {
        let event_name = event_name.to_string();
        let payload =
            build_capture_payload(self.api_key.as_ref(), distinct_id, &event_name, properties);

        if let Err(error) = self.sender.try_send(PosthogCaptureRequest {
            event_name: event_name.clone(),
            payload,
        }) {
            tracing::warn!(
                %error,
                event_name,
                "Dropping analytics event before PostHog upload"
            );
        }
    }
}

async fn run_posthog_worker(
    client: reqwest::Client,
    endpoint: String,
    mut receiver: mpsc::Receiver<PosthogCaptureRequest>,
) {
    while let Some(request) = receiver.recv().await {
        match client
            .post(&endpoint)
            .header("Content-Type", "application/json")
            .json(&request.payload)
            .send()
            .await
        {
            Ok(response) => {
                if response.status().is_success() {
                    tracing::debug!("Event '{}' sent successfully", request.event_name);
                } else {
                    let status = response.status();
                    let response_text = response.text().await.unwrap_or_default();
                    tracing::error!(
                        event_name = request.event_name,
                        %status,
                        response_text,
                        "Failed to send event to PostHog"
                    );
                }
            }
            Err(error) => {
                tracing::warn!(
                    event_name = request.event_name,
                    %error,
                    "Error sending event to PostHog"
                );
            }
        }
    }
}

pub fn analytics_category_name(category: &AnalyticsEventCategory) -> &'static str {
    match category {
        AnalyticsEventCategory::UserAction => "user_action",
        AnalyticsEventCategory::System => "system",
        AnalyticsEventCategory::Conversion => "conversion",
    }
}

pub fn analytics_distinct_id_for_user(user_id: &str) -> String {
    format!("user:{}", user_id.trim())
}

pub fn analytics_distinct_id_for_record(event: &AnalyticsEvent) -> String {
    if let Some(user_id) = event
        .user_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return analytics_distinct_id_for_user(user_id);
    }

    if let Some(device_id) = event
        .device_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return format!("device:{}", device_id);
    }

    if let Some(session_id) = event.session_id {
        return format!("session:{}", session_id);
    }

    "anonymous".to_string()
}

pub fn analytics_posthog_properties_for_record(event: &AnalyticsEvent, ingest_path: &str) -> Value {
    let mut properties = match event.properties.0.clone() {
        Value::Object(map) => map,
        other => {
            let mut map = serde_json::Map::new();
            map.insert("payload".to_string(), other);
            map
        }
    };

    properties.insert(
        "event_category".to_string(),
        json!(analytics_category_name(&event.event_category)),
    );

    if let Some(user_id) = event
        .user_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        properties.insert("user_id".to_string(), json!(user_id));
    }

    if let Some(session_id) = event.session_id {
        properties.insert("session_id".to_string(), json!(session_id.to_string()));
    }

    if let Some(platform) = event
        .platform
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        properties.insert("platform".to_string(), json!(platform));
    }

    if let Some(app_version) = event
        .app_version
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        properties.insert("app_version".to_string(), json!(app_version));
    }

    if let Some(os) = event.os.as_deref().filter(|value| !value.trim().is_empty()) {
        properties.insert("os".to_string(), json!(os));
    }

    if let Some(device_id) = event
        .device_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        properties.insert("device_id".to_string(), json!(device_id));
    }

    properties.insert("ingest_path".to_string(), json!(ingest_path));
    Value::Object(properties)
}

pub fn forward_analytics_record_to_posthog(
    analytics: Option<&AnalyticsService>,
    event: &AnalyticsEvent,
    ingest_path: &str,
) {
    if let Some(analytics) = analytics {
        analytics.track_distinct_event(
            &analytics_distinct_id_for_record(event),
            &event.event_type,
            Some(analytics_posthog_properties_for_record(event, ingest_path)),
        );
    }
}

fn build_capture_payload(
    api_key: &str,
    distinct_id: &str,
    event_name: &str,
    properties: Option<Value>,
) -> Value {
    let mut payload = json!({
        "api_key": api_key,
        "event": event_name,
        "distinct_id": distinct_id,
    });

    if event_name == "$identify" {
        if let Some(props) = properties {
            payload["$set"] = props;
        }
        return payload;
    }

    payload["properties"] = normalize_event_properties(properties);
    payload
}

fn normalize_event_properties(properties: Option<Value>) -> Value {
    let mut event_properties = properties.unwrap_or_else(|| json!({}));
    if let Some(props) = event_properties.as_object_mut() {
        props.insert(
            "timestamp".to_string(),
            json!(chrono::Utc::now().to_rfc3339()),
        );
        props.insert("version".to_string(), json!(env!("CARGO_PKG_VERSION")));
        props.insert("device".to_string(), get_device_info());
        if !props.contains_key("source") {
            props.insert("source".to_string(), json!("backend"));
        }
    }

    event_properties
}

/// Generates a consistent, anonymous user ID for npm package telemetry.
/// Returns a hex string prefixed with "npm_user_"
pub fn generate_user_id() -> String {
    let mut hasher = DefaultHasher::new();

    #[cfg(target_os = "macos")]
    {
        // Use ioreg to get hardware UUID
        if let Ok(output) = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = stdout.lines().find(|l| l.contains("IOPlatformUUID")) {
                line.hash(&mut hasher);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(machine_id) = std::fs::read_to_string("/etc/machine-id") {
            machine_id.trim().hash(&mut hasher);
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        // Use PowerShell to get machine GUID from registry
        let mut command = std::process::Command::new("powershell");
        command.creation_flags(CREATE_NO_WINDOW);

        if let Ok(output) = command
            .args([
                "-NoProfile",
                "-Command",
                "(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid",
            ])
            .output()
            && output.status.success()
        {
            output.stdout.hash(&mut hasher);
        }
    }

    // Add username for per-user differentiation
    if let Ok(user) = std::env::var("USER").or_else(|_| std::env::var("USERNAME")) {
        user.hash(&mut hasher);
    }

    // Add home directory for additional entropy
    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        home.hash(&mut hasher);
    }

    format!("npm_user_{:016x}", hasher.finish())
}

fn get_device_info() -> Value {
    let info = os_info::get();

    json!({
        "os_type": info.os_type().to_string(),
        "os_version": info.version().to_string(),
        "architecture": info.architecture().unwrap_or("unknown").to_string(),
        "bitness": info.bitness().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_user_id_format() {
        let id = generate_user_id();
        assert!(id.starts_with("npm_user_"));
        assert_eq!(id.len(), 25);
    }

    #[test]
    fn test_consistency() {
        let id1 = generate_user_id();
        let id2 = generate_user_id();
        assert_eq!(id1, id2, "ID should be consistent across calls");
    }

    #[test]
    fn test_build_capture_payload_sets_properties() {
        let payload = build_capture_payload(
            "api-key",
            "device:123",
            "message_send",
            Some(json!({"message_length": 42})),
        );

        assert_eq!(payload["api_key"], json!("api-key"));
        assert_eq!(payload["event"], json!("message_send"));
        assert_eq!(payload["distinct_id"], json!("device:123"));
        assert_eq!(payload["properties"]["message_length"], json!(42));
        assert_eq!(payload["properties"]["source"], json!("backend"));
        assert_eq!(
            payload["properties"]["version"],
            json!(env!("CARGO_PKG_VERSION"))
        );
    }

    #[test]
    fn test_build_capture_payload_for_identify_uses_set() {
        let payload = build_capture_payload(
            "api-key",
            "user:abc",
            "$identify",
            Some(json!({"plan": "pro"})),
        );

        assert_eq!(payload["$set"]["plan"], json!("pro"));
        assert!(payload.get("properties").is_none());
    }

    #[test]
    fn test_analytics_distinct_id_for_record_prefers_user() {
        let event = AnalyticsEvent {
            id: uuid::Uuid::nil(),
            event_type: "session_create".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: Some("user-1".to_string()),
            session_id: Some(uuid::Uuid::nil()),
            properties: sqlx::types::Json(json!({})),
            timestamp: chrono::Utc::now(),
            platform: Some("web".to_string()),
            app_version: Some("1.0.0".to_string()),
            os: Some("macOS".to_string()),
            device_id: Some("device-1".to_string()),
        };

        assert_eq!(analytics_distinct_id_for_record(&event), "user:user-1");
    }

    #[test]
    fn test_analytics_posthog_properties_for_record_merges_metadata() {
        let session_id = uuid::Uuid::nil();
        let event = AnalyticsEvent {
            id: uuid::Uuid::nil(),
            event_type: "session_create".to_string(),
            event_category: AnalyticsEventCategory::UserAction,
            user_id: Some("user-1".to_string()),
            session_id: Some(session_id),
            properties: sqlx::types::Json(json!({"title_length": 3})),
            timestamp: chrono::Utc::now(),
            platform: Some("web".to_string()),
            app_version: Some("1.0.0".to_string()),
            os: Some("macOS".to_string()),
            device_id: Some("device-1".to_string()),
        };

        let properties = analytics_posthog_properties_for_record(&event, "/chat/sessions");

        assert_eq!(properties["title_length"], json!(3));
        assert_eq!(properties["event_category"], json!("user_action"));
        assert_eq!(properties["user_id"], json!("user-1"));
        assert_eq!(properties["session_id"], json!(session_id.to_string()));
        assert_eq!(properties["ingest_path"], json!("/chat/sessions"));
    }

    #[test]
    fn test_build_capture_payload_preserves_existing_source_property() {
        let payload = build_capture_payload(
            "api-key",
            "user:abc",
            "skill_install",
            Some(json!({"source": "builtin"})),
        );

        assert_eq!(payload["properties"]["source"], json!("builtin"));
    }
}
