use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use db::models::analytics::{AnalyticsEventRecord, CreateAnalyticsEventRecord};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use tokio::sync::mpsc;

use super::analytics_events::{AnalyticsEvent, event_group_for_event_name};

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
    distinct_id: Arc<str>,
    persistence: Option<AnalyticsPersistence>,
}

#[derive(Clone, Debug)]
struct AnalyticsPersistence {
    pool: SqlitePool,
    capture_enabled: Arc<AtomicBool>,
}

#[derive(Debug)]
struct PosthogCaptureRequest {
    event_id: Option<uuid::Uuid>,
    event_name: String,
    payload: Value,
}

impl AnalyticsService {
    pub fn new(config: AnalyticsConfig) -> Self {
        Self::build(config, generate_user_id(), None)
    }

    fn build(
        config: AnalyticsConfig,
        distinct_id: String,
        persistence: Option<AnalyticsPersistence>,
    ) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap();
        let endpoint = format!(
            "{}/capture/",
            config.posthog_api_endpoint.trim_end_matches('/')
        );
        let (sender, receiver) = mpsc::channel(POSTHOG_UPLOAD_QUEUE_CAPACITY);
        let delivery_pool = persistence
            .as_ref()
            .map(|persistence| persistence.pool.clone());
        let delivery_enabled = persistence
            .as_ref()
            .map(|persistence| persistence.capture_enabled.clone());

        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(run_posthog_worker(
                client,
                endpoint,
                receiver,
                delivery_pool,
                delivery_enabled,
            ));
        } else {
            tracing::warn!(
                "AnalyticsService initialized without tokio runtime; PostHog uploads disabled"
            );
        }

        let service = Self {
            api_key: Arc::<str>::from(config.posthog_api_key),
            sender,
            distinct_id: Arc::<str>::from(distinct_id),
            persistence,
        };
        service.start_recovery_worker();
        service
    }

    /// Create the production analytics service. All business events recorded through this
    /// instance are persisted before they are forwarded to PostHog.
    pub fn with_persistence(
        config: AnalyticsConfig,
        pool: SqlitePool,
        distinct_id: String,
        capture_enabled: Arc<AtomicBool>,
    ) -> Self {
        Self::build(
            config,
            distinct_id,
            Some(AnalyticsPersistence {
                pool,
                capture_enabled,
            }),
        )
    }

    pub fn distinct_id(&self) -> &str {
        self.distinct_id.as_ref()
    }

    /// Persist a backend-owned event and only then enqueue it for delivery. The existing
    /// channel is deliberately kept as a delivery mechanism, not as the source of truth.
    pub fn record_event(&self, event: AnalyticsEvent) {
        let event_name = event.payload.event_name();
        let Some(persistence) = self.persistence.clone() else {
            let properties = analytics_posthog_properties_for_event(&event);
            self.track_distinct_event(self.distinct_id(), event_name, Some(properties));
            return;
        };
        if !persistence.capture_enabled.load(Ordering::Relaxed) {
            return;
        }

        let service = self.clone();
        let event_name = event_name.to_string();
        tokio::spawn(async move {
            let create = CreateAnalyticsEventRecord {
                event_type: event_name.clone(),
                session_id: event.context.session_id,
                run_id: event.context.run_id,
                workflow_execution_id: event.context.workflow_execution_id,
                plan_id: event.context.plan_id,
                step_id: event.context.step_id,
                payload_json: event.payload.properties(),
                occurred_at: event.occurred_at,
                app_version: env!("CARGO_PKG_VERSION").to_string(),
            };
            match AnalyticsEventRecord::create(&persistence.pool, &create, event.id).await {
                Ok(_) => {
                    service.notify_persisted();
                }
                Err(error) => tracing::warn!(
                    %error,
                    event_name,
                    "Failed to persist analytics event; event was not sent"
                ),
            }
        });
    }

    fn start_recovery_worker(&self) {
        let Some(persistence) = self.persistence.clone() else {
            return;
        };
        let service = self.clone();
        tokio::spawn(async move {
            if let Err(error) = AnalyticsEventRecord::recover_sending(&persistence.pool).await {
                tracing::warn!(%error, "Failed to recover analytics delivery state");
            }
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            let mut ticks = 0_u16;
            loop {
                interval.tick().await;
                service.enqueue_due().await;
                ticks = ticks.wrapping_add(1);
                if ticks.is_multiple_of(10) {
                    let now = chrono::Utc::now();
                    if let Err(error) = AnalyticsEventRecord::delete_expired(
                        &persistence.pool,
                        now - chrono::Duration::hours(24),
                        now - chrono::Duration::days(30),
                    )
                    .await
                    {
                        tracing::warn!(%error, "Failed to clean up analytics delivery records");
                    }
                }
            }
        });
    }

    fn notify_persisted(&self) {
        let service = self.clone();
        tokio::spawn(async move { service.enqueue_due().await });
    }

    async fn enqueue_due(&self) {
        let Some(persistence) = &self.persistence else {
            return;
        };
        if !persistence.capture_enabled.load(Ordering::Relaxed) {
            return;
        }
        let events = match AnalyticsEventRecord::claim_due(&persistence.pool, 100).await {
            Ok(events) => events,
            Err(error) => {
                tracing::warn!(%error, "Failed to claim pending analytics events");
                return;
            }
        };
        for event in events {
            let event_name = event.event_type.clone();
            let payload = build_capture_payload(
                self.api_key.as_ref(),
                self.distinct_id(),
                &event_name,
                Some(analytics_posthog_properties_for_record(&event, "backend")),
            );
            if let Err(error) = self.sender.try_send(PosthogCaptureRequest {
                event_id: Some(event.id),
                event_name: event_name.clone(),
                payload,
            }) {
                tracing::warn!(%error, event_name, "Analytics delivery queue is full; retrying later");
                let _ = AnalyticsEventRecord::mark_delivery_failed(
                    &persistence.pool,
                    event.id,
                    "queue_full",
                    true,
                )
                .await;
            }
        }
    }

    fn track_distinct_event(&self, distinct_id: &str, event_name: &str, properties: Option<Value>) {
        let event_name = event_name.to_string();
        let payload =
            build_capture_payload(self.api_key.as_ref(), distinct_id, &event_name, properties);

        if let Err(error) = self.sender.try_send(PosthogCaptureRequest {
            event_id: None,
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
    pool: Option<SqlitePool>,
    capture_enabled: Option<Arc<AtomicBool>>,
) {
    while let Some(request) = receiver.recv().await {
        if capture_enabled
            .as_ref()
            .is_some_and(|enabled| !enabled.load(Ordering::Relaxed))
        {
            if let (Some(pool), Some(event_id)) = (&pool, request.event_id)
                && let Err(error) = AnalyticsEventRecord::release_sending(pool, event_id).await
            {
                tracing::warn!(%error, %event_id, "Failed to release disabled analytics event");
            }
            continue;
        }
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
                    if let (Some(pool), Some(event_id)) = (&pool, request.event_id)
                        && let Err(error) =
                            AnalyticsEventRecord::mark_delivered(pool, event_id).await
                    {
                        tracing::warn!(%error, %event_id, "Failed to mark analytics event delivered");
                    }
                } else {
                    let status = response.status();
                    let retryable = status.as_u16() == 429 || status.is_server_error();
                    let error_code = format!("http_{}", status.as_u16());
                    tracing::warn!(event_name = request.event_name, %status, retryable, "Failed to send event to PostHog");
                    if let (Some(pool), Some(event_id)) = (&pool, request.event_id) {
                        let _ = AnalyticsEventRecord::mark_delivery_failed(
                            pool,
                            event_id,
                            &error_code,
                            retryable,
                        )
                        .await;
                    }
                }
            }
            Err(error) => {
                tracing::warn!(
                    event_name = request.event_name,
                    %error,
                    "Error sending event to PostHog"
                );
                if let (Some(pool), Some(event_id)) = (&pool, request.event_id) {
                    let _ = AnalyticsEventRecord::mark_delivery_failed(
                        pool,
                        event_id,
                        "network_error",
                        true,
                    )
                    .await;
                }
            }
        }
    }
}

pub fn analytics_posthog_properties_for_record(
    event: &AnalyticsEventRecord,
    ingest_path: &str,
) -> Value {
    let mut properties = match event.payload_json.0.clone() {
        Value::Object(map) => map,
        other => {
            let mut map = serde_json::Map::new();
            map.insert("payload".to_string(), other);
            map
        }
    };

    if let Some(group) = event_group_for_event_name(&event.event_type) {
        properties.insert("event_group".to_string(), json!(group));
    }
    properties.insert("$insert_id".to_string(), json!(event.id.to_string()));

    if let Some(session_id) = event.session_id {
        properties.insert("session_id".to_string(), json!(session_id.to_string()));
    }

    insert_record_context(&mut properties, event);
    properties.insert(
        "timestamp".to_string(),
        json!(event.occurred_at.to_rfc3339()),
    );
    properties.insert("version".to_string(), json!(event.app_version));
    properties.insert("source".to_string(), json!("backend"));

    properties.insert("ingest_path".to_string(), json!(ingest_path));
    Value::Object(properties)
}

fn insert_record_context(
    properties: &mut serde_json::Map<String, Value>,
    event: &AnalyticsEventRecord,
) {
    for (key, value) in [
        ("run_id", event.run_id),
        ("workflow_execution_id", event.workflow_execution_id),
        ("plan_id", event.plan_id),
        ("step_id", event.step_id),
    ] {
        if let Some(value) = value {
            properties.insert(key.to_string(), json!(value));
        }
    }
}

fn analytics_posthog_properties_for_event(event: &AnalyticsEvent) -> Value {
    let mut properties = event
        .payload
        .properties()
        .as_object()
        .cloned()
        .unwrap_or_default();
    if let Some(group) = event.payload.event_group() {
        properties.insert("event_group".to_string(), json!(group));
    }
    for (key, value) in [
        ("session_id", event.context.session_id),
        ("run_id", event.context.run_id),
        ("workflow_execution_id", event.context.workflow_execution_id),
        ("plan_id", event.context.plan_id),
        ("step_id", event.context.step_id),
    ] {
        if let Some(value) = value {
            properties.insert(key.to_string(), json!(value));
        }
    }
    properties.insert("$insert_id".to_string(), json!(event.id));
    properties.insert(
        "timestamp".to_string(),
        json!(event.occurred_at.to_rfc3339()),
    );
    Value::Object(properties)
}

pub fn forward_analytics_record_to_posthog(
    analytics: Option<&AnalyticsService>,
    _event: &AnalyticsEventRecord,
    _ingest_path: &str,
) {
    if let Some(analytics) = analytics {
        analytics.notify_persisted();
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
        props
            .entry("timestamp".to_string())
            .or_insert_with(|| json!(chrono::Utc::now().to_rfc3339()));
        props
            .entry("version".to_string())
            .or_insert_with(|| json!(env!("CARGO_PKG_VERSION")));
        if !props.contains_key("source") {
            props.insert("source".to_string(), json!("backend"));
        }
    }

    event_properties
}

/// Generates a stable, anonymous installation ID shared by every analytics path.
/// Returns a 16-digit hexadecimal value prefixed with `user_`.
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

    format!("user_{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_user_id_format() {
        let id = generate_user_id();
        assert!(id.starts_with("user_"));
        assert_eq!(id.len(), 21);
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
        assert!(payload["properties"].get("device").is_none());
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
    fn test_analytics_posthog_properties_for_record_merges_metadata() {
        let session_id = uuid::Uuid::nil();
        let event = AnalyticsEventRecord {
            id: uuid::Uuid::nil(),
            event_type: "session_created".to_string(),
            session_id: Some(session_id),
            run_id: None,
            workflow_execution_id: None,
            plan_id: None,
            step_id: None,
            payload_json: sqlx::types::Json(json!({"succeeded": true})),
            occurred_at: chrono::Utc::now(),
            app_version: "1.0.0".to_string(),
        };

        let properties = analytics_posthog_properties_for_record(&event, "/chat/sessions");

        assert_eq!(properties["succeeded"], json!(true));
        assert!(properties.get("event_group").is_none());
        assert_eq!(properties["$insert_id"], json!(event.id.to_string()));
        assert_eq!(properties["session_id"], json!(session_id.to_string()));
        assert_eq!(properties["ingest_path"], json!("/chat/sessions"));
        assert_eq!(
            properties["timestamp"],
            json!(event.occurred_at.to_rfc3339())
        );
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

    #[test]
    fn test_build_capture_payload_preserves_event_occurrence_time() {
        let occurred_at = "2026-07-16T01:02:03Z";
        let payload = build_capture_payload(
            "api-key",
            "user:abc",
            "workflow.step_completed",
            Some(json!({"timestamp": occurred_at})),
        );

        assert_eq!(payload["properties"]["timestamp"], json!(occurred_at));
    }
}
