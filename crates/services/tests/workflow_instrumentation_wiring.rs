use std::path::PathBuf;

use services::services::{
    analytics_events::{AnalyticsEventPayload, event_group_for_event_name},
    config::Config,
};

fn repo_relative(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join(path)
}

fn read_repo_file(path: &str) -> String {
    let full_path = repo_relative(path);
    std::fs::read_to_string(&full_path)
        .unwrap_or_else(|err| panic!("failed to read {}: {}", full_path.display(), err))
}

fn count_occurrences(haystack: &str, needle: &str) -> usize {
    haystack.match_indices(needle).count()
}

#[test]
fn error_reporting_config_defaults_on_existing_v10_and_gates_sentry_startup() {
    let mut raw = serde_json::to_value(Config::default()).expect("serialize config");
    raw.as_object_mut()
        .expect("config object")
        .remove("error_reporting_enabled");
    let loaded = Config::try_from_raw_config(&raw.to_string()).expect("load existing v10 config");
    assert!(loaded.error_reporting_enabled);

    let server_main = read_repo_file("crates/server/src/main.rs");
    assert!(server_main.contains("if startup_config.error_reporting_enabled"));
    assert!(server_main.contains("sentry_utils::init_once(SentrySource::Backend)"));
    assert!(!server_main.contains("update_sentry_scope"));
}

#[test]
fn analytics_and_sentry_avoid_undisclosed_identity_and_device_metadata() {
    let analytics = read_repo_file("crates/services/src/services/analytics.rs");
    assert!(!analytics.contains("get_device_info"));
    assert!(!analytics.contains("os_version"));
    assert!(!analytics.contains("architecture"));

    let deployment = read_repo_file("crates/deployment/src/lib.rs");
    let sentry = read_repo_file("crates/utils/src/sentry.rs");
    assert!(!deployment.contains("update_sentry_scope"));
    assert!(!sentry.contains("set_user"));
    assert!(!sentry.contains("sentry::User"));
}

#[test]
fn posthog_generic_event_names_and_event_group_mapping_are_correct() {
    for (event_name, expected) in [
        ("workflow.plan_executed", Some("process_funnel")),
        ("collaboration.approval_resolved", Some("collaboration")),
        ("engagement.message_sent", Some("engagement")),
        ("quality.review_decision_recorded", Some("quality")),
        ("risk.runner_interrupted", Some("risk")),
        ("session_created", None),
        ("agent_added", None),
        ("agent_run_complete", None),
    ] {
        assert_eq!(event_group_for_event_name(event_name), expected);
    }

    let message = AnalyticsEventPayload::MessageSent {
        message_length_bucket: "short".to_string(),
        mention_count: 0,
        attachment_count: 0,
    };
    assert_eq!(message.event_group(), Some("engagement"));

    assert_eq!(
        AnalyticsEventPayload::SessionCreated.event_name(),
        "session_created"
    );
    let agent_added = AnalyticsEventPayload::AgentAdded {
        runner_type: None,
        has_workspace: false,
    };
    assert_eq!(agent_added.event_name(), "agent_added");
    assert_eq!(agent_added.event_group(), None);
}

#[test]
fn sessions_route_uses_unified_workflow_analytics_events() {
    let content = [
        read_repo_file("crates/server/src/routes/chat/sessions.rs"),
        read_repo_file("crates/server/src/routes/chat/sessions/lifecycle.rs"),
        read_repo_file("crates/server/src/routes/chat/sessions/agents.rs"),
    ]
    .join("\n");

    assert!(!content.contains("DomainEvent::SessionCreated"));
    assert!(!content.contains("DomainEvent::AgentAdded"));
    assert!(!content.contains("DomainEvent::SessionArchived"));
    assert!(!content.contains("DomainEvent::SessionRestored"));

    assert!(content.contains("workflow_analytics::track_session_created("));
    assert!(content.contains("workflow_analytics::track_agent_added("));
    assert!(content.contains("workflow_analytics::track_session_archived("));
    assert!(!content.contains("workflow_analytics::track_diff_viewed("));
    assert!(!content.contains("workflow_analytics::track_api_failure("));
    assert!(!content.contains("workflow_analytics::track_websocket_disconnected("));
    assert!(content.contains("workflow_analytics::analytics_if_enabled("));
    assert!(content.contains("deployment.analytics_enabled()"));
}

#[test]
fn guarded_transition_tracks_step_state_changes_for_running_path() {
    let content = read_repo_file("crates/services/src/services/workflow/orchestrator/mod.rs");
    let guarded_block_start = content
        .find("pub(crate) async fn guarded_transition_step_and_sync")
        .expect("guarded transition helper not found");
    let guarded_block = &content[guarded_block_start..];

    assert!(guarded_block.contains("workflow_analytics::track_step_state_changed("));
    assert!(guarded_block.contains("transitioned.retry_count,"));
}

#[test]
fn workflow_step_properties_fit_storage_limit_without_legacy_dimensions() {
    let tracking = read_repo_file("crates/services/src/services/workflow/analytics/tracking.rs");
    let events = read_repo_file("crates/services/src/services/analytics_events.rs");
    let delivery = read_repo_file("crates/services/src/services/analytics.rs");
    assert!(!tracking.contains("step_key.to_string()"));
    assert!(!tracking.contains("record_workflow_analytics_event"));
    assert!(events.contains("pub fn event_group(&self)"));
    assert!(delivery.contains("properties.insert(\"event_group\""));

    let properties = AnalyticsEventPayload::StepCompleted {
        retry_count: 2,
        from_status: "x".repeat(400),
        outcome: "completed".to_string(),
        agent_role: Some("worker".to_string()),
        duration_bucket: Some("10s_1m".to_string()),
    }
    .properties();
    let payload_size = serde_json::to_vec(&properties).unwrap().len();
    assert!(payload_size <= 512, "step payload was {payload_size} bytes");
    assert!(properties.get("step_key").is_none());
}

#[test]
fn workflow_and_message_routes_wire_engagement_and_risk_events() {
    let workflow_route = read_repo_file("crates/server/src/routes/chat/workflow.rs");
    let message_route = read_repo_file("crates/server/src/routes/chat/messages.rs");
    let plan_control =
        read_repo_file("crates/services/src/services/workflow/orchestrator/plan_control.rs");

    assert!(workflow_route.contains("workflow_analytics::track_approval_timeout("));
    assert!(workflow_route.contains("workflow_analytics::track_plan_generated("));
    assert!(workflow_route.contains("workflow_analytics::track_plan_executed("));
    assert_eq!(
        count_occurrences(&workflow_route, "workflow_analytics::track_plan_executed("),
        1,
        "workflow route should emit plan_executed only once (generate path)"
    );
    assert_eq!(
        count_occurrences(&workflow_route, "workflow_analytics::track_plan_generated("),
        1,
        "workflow route should only contain failure hook for plan_generated"
    );
    assert!(
        count_occurrences(&workflow_route, "track_plan_generation_failure();") >= 4,
        "generate_plan_and_run failure branches should all track plan_generated=false"
    );
    assert!(plan_control.contains("workflow_analytics::track_plan_generated("));
    assert!(plan_control.contains("workflow_analytics::track_plan_executed("));
    assert!(plan_control.contains("workflow_analytics::track_runner_interrupted("));
    assert!(workflow_route.contains("workflow_analytics::analytics_if_enabled("));

    assert!(!message_route.contains("DomainEvent::MessageSent"));
    assert!(message_route.contains("emit_user_message_workflow_analytics("));
    assert!(message_route.contains("workflow_analytics::analytics_if_enabled("));
}

#[test]
fn step_executor_does_not_emit_derived_handoff_events() {
    let content =
        read_repo_file("crates/services/src/services/workflow/orchestrator/step_executor.rs");
    assert!(!content.contains("workflow_analytics::track_handoff_completed("));
}

#[test]
fn workflow_orchestrator_wires_state_review_and_retry_events() {
    let orchestrator_mod =
        read_repo_file("crates/services/src/services/workflow/orchestrator/mod.rs");
    let step_input =
        read_repo_file("crates/services/src/services/workflow/orchestrator/step_input.rs");
    let review = read_repo_file("crates/services/src/services/workflow/orchestrator/review.rs");
    let transcript_actions =
        read_repo_file("crates/services/src/services/workflow/orchestrator/transcript_actions.rs");
    let retry_resume =
        read_repo_file("crates/services/src/services/workflow/orchestrator/retry_resume.rs");

    assert!(orchestrator_mod.contains("workflow_analytics::track_execution_state_changed("));
    assert!(orchestrator_mod.contains("workflow_analytics::track_step_state_changed("));
    assert!(
        orchestrator_mod.contains("let step_duration_ms = step_transition_duration_ms("),
        "step transitions should compute duration for terminal states"
    );
    assert!(
        orchestrator_mod.contains("None,\n            step_duration_ms,"),
        "step transitions should send duration_ms instead of constant None"
    );
    assert!(step_input.contains("workflow_analytics::track_approval_requested("));
    assert!(!review.contains("workflow_analytics::track_approval_resolved("));
    assert!(transcript_actions.contains("workflow_analytics::track_approval_resolved("));
    assert!(!review.contains("workflow_analytics::track_step_reviewed("));
    assert!(review.contains("workflow_analytics::track_review_decision_recorded("));
    assert!(retry_resume.contains("workflow_analytics::track_retry_triggered("));
}

#[test]
fn chat_runner_only_wires_base_run_and_error_events() {
    let runner = read_repo_file("crates/services/src/services/chat_runner/lifecycle.rs");
    let runtime = read_repo_file("crates/services/src/services/chat_runner/runtime.rs");

    assert!(!runner.contains("workflow_analytics::track_agent_state_changed("));
    assert!(runner.contains("AnalyticsEventPayload::AgentError"));
    assert!(runner.contains("workflow_analytics::analytics_if_enabled("));
    assert!(!runtime.contains("workflow_analytics::track_agent_state_changed("));
    assert!(runtime.contains("AnalyticsEventPayload::AgentError"));
    assert!(!runtime.contains("workflow_analytics::track_diff_generated("));

    assert!(runner.contains("error_code: \"agent_startup_failed\""));
    assert!(runtime.contains("error_code: Self::normalized_entry_error_name"));
    assert!(!runner.contains("\"error_message\""));
}

#[test]
fn workflow_runner_records_run_lifecycle_after_persistence_boundaries() {
    let runner = read_repo_file("crates/services/src/services/workflow/runtime/runner.rs");
    assert!(runner.contains("AnalyticsEventPayload::AgentRunStarted"));
    assert!(runner.contains("AnalyticsEventPayload::AgentRunCompleted"));
    assert!(runner.contains("AnalyticsEventPayload::AgentError"));
    assert!(runner.contains("ChatRun::update_after_run_completion("));
    assert!(runner.contains("record.analytics_started"));
    assert!(!runner.contains(
        "io_log.log_output(&latest_assistant, Some(&message));\n                return Err(error);"
    ));
}
