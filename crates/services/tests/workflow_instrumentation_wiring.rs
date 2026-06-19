use std::path::PathBuf;

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
fn sessions_route_uses_unified_workflow_analytics_events() {
    let content = read_repo_file("crates/server/src/routes/chat/sessions.rs");

    assert!(!content.contains("DomainEvent::SessionCreated"));
    assert!(!content.contains("DomainEvent::AgentAdded"));
    assert!(!content.contains("DomainEvent::SessionArchived"));
    assert!(!content.contains("DomainEvent::SessionRestored"));

    assert!(content.contains("workflow_analytics::track_session_created("));
    assert!(content.contains("workflow_analytics::track_agent_added("));
    assert!(content.contains("workflow_analytics::track_session_archived("));
    assert!(content.contains("workflow_analytics::track_diff_viewed("));
    assert!(content.contains("workflow_analytics::track_api_failure("));
    assert!(content.contains("workflow_analytics::track_websocket_disconnected("));
    assert!(content.contains("workflow_analytics::analytics_if_enabled("));
    assert!(content.contains("deployment.analytics_enabled()"));
}

#[test]
fn guarded_transition_tracks_step_state_changes_for_running_path() {
    let content = read_repo_file("crates/services/src/services/workflow_orchestrator/mod.rs");
    let guarded_block_start = content
        .find("pub(crate) async fn guarded_transition_step_and_sync")
        .expect("guarded transition helper not found");
    let guarded_block = &content[guarded_block_start..];

    assert!(guarded_block.contains("workflow_analytics::track_step_state_changed("));
}

#[test]
fn workflow_and_message_routes_wire_engagement_and_risk_events() {
    let workflow_route = read_repo_file("crates/server/src/routes/chat/workflow.rs");
    let message_route = read_repo_file("crates/server/src/routes/chat/messages.rs");
    let plan_control =
        read_repo_file("crates/services/src/services/workflow_orchestrator/plan_control.rs");

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
fn step_executor_wires_handoff_completed_on_completion_paths() {
    let content =
        read_repo_file("crates/services/src/services/workflow_orchestrator/step_executor.rs");
    assert!(content.contains("workflow_analytics::track_handoff_completed("));
}

#[test]
fn workflow_orchestrator_wires_state_review_and_retry_events() {
    let orchestrator_mod =
        read_repo_file("crates/services/src/services/workflow_orchestrator/mod.rs");
    let step_input =
        read_repo_file("crates/services/src/services/workflow_orchestrator/step_input.rs");
    let review = read_repo_file("crates/services/src/services/workflow_orchestrator/review.rs");
    let transcript_actions =
        read_repo_file("crates/services/src/services/workflow_orchestrator/transcript_actions.rs");
    let retry_resume =
        read_repo_file("crates/services/src/services/workflow_orchestrator/retry_resume.rs");

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
    assert!(review.contains("workflow_analytics::track_approval_resolved("));
    assert!(transcript_actions.contains("workflow_analytics::track_approval_resolved("));
    assert!(review.contains("workflow_analytics::track_step_reviewed("));
    assert!(review.contains("workflow_analytics::track_review_decision_recorded("));
    assert!(retry_resume.contains("workflow_analytics::track_retry_triggered("));
}

#[test]
fn chat_runner_wires_state_error_and_diff_events() {
    let runner = read_repo_file("crates/services/src/services/chat_runner/lifecycle.rs");
    let runtime = read_repo_file("crates/services/src/services/chat_runner/runtime.rs");

    assert!(runner.contains("workflow_analytics::track_agent_state_changed("));
    assert!(runner.contains("workflow_analytics::track_agent_error("));
    assert!(runner.contains("workflow_analytics::analytics_if_enabled("));
    assert!(runtime.contains("workflow_analytics::track_agent_state_changed("));
    assert!(runtime.contains("workflow_analytics::track_agent_error("));
    assert!(runtime.contains("workflow_analytics::track_diff_generated("));

    let analytics_events = read_repo_file("crates/services/src/services/analytics_events.rs");
    assert!(analytics_events.contains("\"error_code\": error_code"));
    assert!(!analytics_events.contains("\"error_message\": error_message"));
}
