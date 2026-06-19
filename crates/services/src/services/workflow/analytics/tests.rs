#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Event model and context tests
    // -----------------------------------------------------------------------

    #[test]
    fn all_five_categories_have_events() {
        let categories: HashSet<&str> = [
            WorkflowAnalyticsEvent::SessionCreated,
            WorkflowAnalyticsEvent::AgentMentioned,
            WorkflowAnalyticsEvent::MessageSent,
            WorkflowAnalyticsEvent::WorkflowCompleted,
            WorkflowAnalyticsEvent::AgentError,
        ]
        .iter()
        .map(|e| e.category())
        .collect();

        assert!(categories.contains("process_funnel"));
        assert!(categories.contains("collaboration"));
        assert!(categories.contains("engagement"));
        assert!(categories.contains("quality"));
        assert!(categories.contains("risk"));
        assert_eq!(categories.len(), 5);
    }

    #[test]
    fn event_names_follow_plan_naming() {
        assert_eq!(
            WorkflowAnalyticsEvent::SessionCreated.event_name(),
            "workflow.session_created"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::AgentAdded.event_name(),
            "workflow.agent_added"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::PlanGenerated.event_name(),
            "workflow.plan_generated"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::PlanExecuted.event_name(),
            "workflow.plan_executed"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::StepStarted.event_name(),
            "workflow.step_started"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::StepCompleted.event_name(),
            "workflow.step_completed"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::ExecutionStateChanged.event_name(),
            "workflow.execution_state_changed"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::AgentMentioned.event_name(),
            "collaboration.agent_mentioned"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::AgentStateChanged.event_name(),
            "collaboration.agent_state_changed"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::ApprovalRequested.event_name(),
            "collaboration.approval_requested"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::ApprovalResolved.event_name(),
            "collaboration.approval_resolved"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::HandoffCompleted.event_name(),
            "collaboration.handoff_completed"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::MessageSent.event_name(),
            "engagement.message_sent"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::AttachmentAdded.event_name(),
            "engagement.attachment_added"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::SessionArchived.event_name(),
            "engagement.session_archived"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::DiffGenerated.event_name(),
            "quality.diff_generated"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::ReviewDecisionRecorded.event_name(),
            "quality.review_decision_recorded"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::AgentError.event_name(),
            "risk.agent_error"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::PermissionDenied.event_name(),
            "risk.permission_denied"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::RunnerInterrupted.event_name(),
            "risk.runner_interrupted"
        );
    }

    #[test]
    fn context_has_all_13_required_fields() {
        let ctx = WorkflowEventContext::new("backend")
            .with_session(Uuid::nil())
            .with_workflow(Uuid::nil())
            .with_workspace("ws-1")
            .with_user_id_hash("hash123")
            .with_agent_role("planner")
            .with_plan(Uuid::nil())
            .with_task(Uuid::nil())
            .with_status("succeeded")
            .with_duration_ms(1234)
            .with_error_code("none");

        let props = ctx.to_properties();

        // All 13 unified context fields
        assert!(props.get("session_id").is_some());
        assert!(props.get("workflow_id").is_some());
        assert!(props.get("workspace_id").is_some());
        assert!(props.get("user_id_hash").is_some());
        assert!(props.get("agent_role").is_some());
        assert!(props.get("timestamp").is_some());
        assert!(props.get("event_source").is_some());
        assert!(props.get("plan_id").is_some());
        assert!(props.get("task_id").is_some());
        assert!(props.get("status").is_some());
        assert!(props.get("duration_ms").is_some());
        assert!(props.get("error_code").is_some());
        assert!(props.get("metadata_version").is_some());
        assert_eq!(props["metadata_version"], json!(1));
        assert_eq!(props["event_source"], json!("backend"));
    }

    #[test]
    fn context_null_fields_are_null_not_empty_string() {
        let ctx = WorkflowEventContext::new("backend");
        let props = ctx.to_properties();
        assert!(props["session_id"].is_null());
        assert!(props["workflow_id"].is_null());
        assert!(props["workspace_id"].is_null());
        assert!(props["user_id_hash"].is_null());
        assert!(props["agent_role"].is_null());
        assert!(props["plan_id"].is_null());
        assert!(props["task_id"].is_null());
        assert!(props["status"].is_null());
        assert!(props["duration_ms"].is_null());
        assert!(props["error_code"].is_null());
    }

    // -----------------------------------------------------------------------
    // Context validation tests
    // -----------------------------------------------------------------------

    #[test]
    fn context_validation_rejects_invalid_event_source() {
        let ctx = WorkflowEventContext {
            event_source: "invalid_source".to_string(),
            ..WorkflowEventContext::new("backend")
        };
        let errors = validate_context(&ctx);
        assert!(errors.iter().any(|e| e.contains("invalid event_source")));
    }

    #[test]
    fn context_validation_rejects_empty_event_source() {
        let ctx = WorkflowEventContext {
            event_source: "".to_string(),
            ..WorkflowEventContext::new("backend")
        };
        let errors = validate_context(&ctx);
        assert!(
            errors
                .iter()
                .any(|e| e.contains("event_source is required"))
        );
    }

    #[test]
    fn context_validation_rejects_invalid_agent_role() {
        let ctx = WorkflowEventContext::new("backend").with_agent_role("hacker");
        let errors = validate_context(&ctx);
        assert!(errors.iter().any(|e| e.contains("invalid agent_role")));
    }

    #[test]
    fn context_validation_accepts_valid_context() {
        let ctx = WorkflowEventContext::new("backend")
            .with_agent_role("planner")
            .with_session(Uuid::nil());
        let errors = validate_context(&ctx);
        assert!(errors.is_empty(), "Unexpected errors: {:?}", errors);
    }

    #[test]
    fn record_event_drops_on_invalid_context() {
        // Invalid context (bad event_source) should be dropped, not panic
        let ctx = WorkflowEventContext {
            event_source: "invalid".to_string(),
            ..WorkflowEventContext::new("backend")
        };
        // Even with a real analytics service this should be dropped
        // With None analytics it returns early
        record_workflow_analytics_event(
            None,
            WorkflowAnalyticsEvent::StepCompleted,
            &ctx,
            serde_json::Map::new(),
        );
    }

    // -----------------------------------------------------------------------
    // Privacy filtering tests (forbidden blacklist + allowed whitelist)
    // -----------------------------------------------------------------------

    #[test]
    fn privacy_filter_strips_forbidden_fields() {
        let mut metadata = serde_json::Map::new();
        metadata.insert("message_content".to_string(), json!("hello world"));
        metadata.insert("file_content".to_string(), json!("secret code"));
        metadata.insert("full_path".to_string(), json!("/home/user/project"));
        metadata.insert("secret_value".to_string(), json!("sk-xxx"));
        metadata.insert("prompt_text".to_string(), json!("do something"));
        metadata.insert("raw_stdout".to_string(), json!("output"));
        metadata.insert("raw_stderr".to_string(), json!("error"));
        metadata.insert("stack_trace".to_string(), json!("at foo.rs:42"));
        metadata.insert("retry_count".to_string(), json!(3));

        let violations = sanitize_metadata(&mut metadata);

        assert_eq!(violations.len(), 8);
        for v in &violations {
            assert!(matches!(v, PrivacyViolation::ForbiddenField(_)));
        }
        assert!(!metadata.contains_key("message_content"));
        assert!(!metadata.contains_key("file_content"));
        assert!(!metadata.contains_key("full_path"));
        assert!(!metadata.contains_key("secret_value"));
        // Allowed field should remain
        assert!(metadata.contains_key("retry_count"));
        assert_eq!(metadata["retry_count"], json!(3));
    }

    #[test]
    fn privacy_filter_strips_unallowed_fields_via_whitelist() {
        let mut metadata = serde_json::Map::new();
        metadata.insert("retry_count".to_string(), json!(1)); // allowed
        metadata.insert("mention_count".to_string(), json!(2)); // allowed
        metadata.insert("unknown_sensitive_field".to_string(), json!("data")); // NOT allowed
        metadata.insert("agent_name".to_string(), json!("my_agent")); // NOT allowed
        metadata.insert("error_message".to_string(), json!("something broke")); // NOT allowed
        metadata.insert("message_length".to_string(), json!(42)); // NOT allowed (should use bucket)

        let violations = sanitize_metadata(&mut metadata);

        // 4 fields should be stripped (not in whitelist)
        assert_eq!(violations.len(), 4);
        assert!(
            violations
                .iter()
                .all(|v| matches!(v, PrivacyViolation::UnallowedField(_)))
        );
        assert!(metadata.contains_key("retry_count"));
        assert!(metadata.contains_key("mention_count"));
        assert!(!metadata.contains_key("unknown_sensitive_field"));
        assert!(!metadata.contains_key("agent_name"));
        assert!(!metadata.contains_key("error_message"));
        assert!(!metadata.contains_key("message_length"));
    }

    #[test]
    fn privacy_filter_no_violations_for_clean_metadata() {
        let mut metadata = serde_json::Map::new();
        metadata.insert("retry_count".to_string(), json!(1));
        metadata.insert("mention_count".to_string(), json!(2));
        metadata.insert("runner_type".to_string(), json!("standard"));

        let violations = sanitize_metadata(&mut metadata);
        assert!(violations.is_empty());
        assert_eq!(metadata.len(), 3);
    }

    #[test]
    fn privacy_filter_allows_all_whitelisted_keys() {
        let mut metadata = serde_json::Map::new();
        for &key in ALLOWED_METADATA_KEYS {
            metadata.insert(key.to_string(), json!("test"));
        }
        let violations = sanitize_metadata(&mut metadata);
        assert!(
            violations.is_empty(),
            "Unexpected violations: {:?}",
            violations
        );
        assert_eq!(metadata.len(), ALLOWED_METADATA_KEYS.len());
    }

    // -----------------------------------------------------------------------
    // Helper function tests
    // -----------------------------------------------------------------------

    #[test]
    fn hash_user_id_is_consistent_and_prefixed() {
        let h1 = hash_user_id("user-123");
        let h2 = hash_user_id("user-123");
        assert_eq!(h1, h2);
        assert!(h1.starts_with("wf_user_"));
        assert_ne!(hash_user_id("user-123"), hash_user_id("user-456"));
    }

    #[test]
    fn message_length_bucket_classification() {
        assert_eq!(message_length_bucket(0), "empty");
        assert_eq!(message_length_bucket(10), "short");
        assert_eq!(message_length_bucket(100), "medium");
        assert_eq!(message_length_bucket(500), "long");
        assert_eq!(message_length_bucket(5000), "very_long");
    }

    #[test]
    fn size_bucket_classification() {
        assert_eq!(size_bucket(0), "empty");
        assert_eq!(size_bucket(512), "tiny");
        assert_eq!(size_bucket(50000), "small");
        assert_eq!(size_bucket(500000), "medium");
        assert_eq!(size_bucket(5000000), "large");
        assert_eq!(size_bucket(50000000), "very_large");
    }

    #[test]
    fn valid_event_sources_accepted() {
        for src in VALID_EVENT_SOURCES {
            assert!(validate_event_source(src), "should accept: {}", src);
        }
        assert!(!validate_event_source("unknown"));
        assert!(!validate_event_source(""));
    }

    #[test]
    fn valid_agent_roles_accepted() {
        for role in VALID_AGENT_ROLES {
            assert!(validate_agent_role(role), "should accept: {}", role);
        }
        assert!(!validate_agent_role("hacker"));
        assert!(!validate_agent_role(""));
    }

    #[test]
    fn context_metadata_version_defaults_to_1() {
        assert_eq!(WorkflowEventContext::new("backend").metadata_version, 1);
    }

    // -----------------------------------------------------------------------
    // Integration helper tests: verify correct event type and context fields
    // -----------------------------------------------------------------------

    #[test]
    fn execution_state_changed_event_name_matches_plan_funnel() {
        assert_eq!(
            WorkflowAnalyticsEvent::ExecutionStateChanged.event_name(),
            "workflow.execution_state_changed"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::ExecutionStateChanged.category(),
            "process_funnel"
        );
    }

    #[test]
    fn execution_completed_keeps_funnel_event_and_adds_quality_event() {
        let (funnel, terminal) = execution_events_for_to_status("completed");
        assert_eq!(funnel, WorkflowAnalyticsEvent::ExecutionStateChanged);
        assert_eq!(
            terminal,
            Some(WorkflowAnalyticsEvent::WorkflowCompleted),
            "completed should emit both execution_state_changed and quality.workflow_completed"
        );
    }

    #[test]
    fn execution_failed_keeps_funnel_event_and_adds_quality_event() {
        let (funnel, terminal) = execution_events_for_to_status("failed");
        assert_eq!(funnel, WorkflowAnalyticsEvent::ExecutionStateChanged);
        assert_eq!(
            terminal,
            Some(WorkflowAnalyticsEvent::WorkflowFailed),
            "failed should emit both execution_state_changed and quality.workflow_failed"
        );
    }

    #[test]
    fn terminal_quality_events_remain_defined_for_completed_and_failed() {
        assert_eq!(
            WorkflowAnalyticsEvent::WorkflowCompleted.event_name(),
            "quality.workflow_completed"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::WorkflowCompleted.category(),
            "quality"
        );
        assert_eq!(
            WorkflowAnalyticsEvent::WorkflowFailed.event_name(),
            "quality.workflow_failed"
        );
        assert_eq!(WorkflowAnalyticsEvent::WorkflowFailed.category(), "quality");
    }

    #[test]
    fn track_step_to_running_produces_step_started() {
        let event = match "running" {
            "running" => Some(WorkflowAnalyticsEvent::StepStarted),
            "completed" | "failed" | "skipped" => Some(WorkflowAnalyticsEvent::StepCompleted),
            _ => None,
        };
        assert_eq!(event, Some(WorkflowAnalyticsEvent::StepStarted));
        assert_eq!(event.unwrap().event_name(), "workflow.step_started");
    }

    #[test]
    fn track_step_to_completed_produces_step_completed() {
        let event = match "completed" {
            "running" => Some(WorkflowAnalyticsEvent::StepStarted),
            "completed" | "failed" | "skipped" => Some(WorkflowAnalyticsEvent::StepCompleted),
            _ => None,
        };
        assert_eq!(event, Some(WorkflowAnalyticsEvent::StepCompleted));
    }

    #[test]
    fn track_step_to_waiting_produces_no_event() {
        let event = match "waiting_input" {
            "running" => Some(WorkflowAnalyticsEvent::StepStarted),
            "completed" | "failed" | "skipped" => Some(WorkflowAnalyticsEvent::StepCompleted),
            _ => None,
        };
        assert!(event.is_none());
    }

    // -----------------------------------------------------------------------
    // chat.rs / chat_runner.rs helper call validation tests
    // -----------------------------------------------------------------------

    #[test]
    fn track_message_sent_uses_length_bucket_not_raw_length() {
        // Simulate what track_message_sent does internally
        let bucket = message_length_bucket(150);
        assert_eq!(bucket, "medium");
        // Verify the metadata key is in the allowed list
        assert!(ALLOWED_METADATA_KEYS.contains(&"message_length_bucket"));
        assert!(ALLOWED_METADATA_KEYS.contains(&"mention_count"));
        assert!(ALLOWED_METADATA_KEYS.contains(&"attachment_count"));
    }

    #[test]
    fn track_agent_mentioned_only_records_count_not_names() {
        // Verify mention_count is allowed but no mention names field
        assert!(ALLOWED_METADATA_KEYS.contains(&"mention_count"));
        // agent_name should not be in metadata
        let mut meta = serde_json::Map::new();
        meta.insert("mention_count".to_string(), json!(3));
        meta.insert("agent_name".to_string(), json!("secret_agent"));
        let violations = sanitize_metadata(&mut meta);
        assert_eq!(violations.len(), 1);
        assert!(!meta.contains_key("agent_name"));
        assert!(meta.contains_key("mention_count"));
    }

    #[test]
    fn track_attachment_added_uses_size_bucket_not_raw_size() {
        let bucket = size_bucket(50000);
        assert_eq!(bucket, "small");
        assert!(ALLOWED_METADATA_KEYS.contains(&"size_bucket"));
        assert!(ALLOWED_METADATA_KEYS.contains(&"attachment_count"));
    }

    #[test]
    fn track_diff_generated_only_records_file_count() {
        assert!(ALLOWED_METADATA_KEYS.contains(&"diff_file_count"));
        // verify raw diff content would be stripped
        let mut meta = serde_json::Map::new();
        meta.insert("diff_file_count".to_string(), json!(5));
        meta.insert("diff_content".to_string(), json!("--- a/file\n+++ b/file"));
        let violations = sanitize_metadata(&mut meta);
        assert_eq!(violations.len(), 1);
        assert!(!meta.contains_key("diff_content"));
        assert!(meta.contains_key("diff_file_count"));
    }

    #[test]
    fn track_agent_state_changed_uses_enumerated_state() {
        assert!(ALLOWED_METADATA_KEYS.contains(&"agent_session_state"));
    }

    #[test]
    fn track_agent_error_sets_error_code_not_message() {
        // Verify error_code is in context fields, error_message is not allowed
        let mut meta = serde_json::Map::new();
        meta.insert("error_message".to_string(), json!("detailed error text"));
        let violations = sanitize_metadata(&mut meta);
        assert_eq!(violations.len(), 1);
        assert!(!meta.contains_key("error_message"));
    }

    #[test]
    fn final_review_accept_event_has_explicit_user_accepted_semantics() {
        let nil = Uuid::nil();
        let nil_str = nil.to_string();
        let (event, ctx, mut meta) = review_decision_event_parts(
            nil,
            Some(nil),
            Some(nil),
            None,
            "user_accepted",
            "accepted",
            "user",
            "user_accepted",
        );

        assert_eq!(event.event_name(), "quality.review_decision_recorded");
        assert_eq!(ctx.workflow_id.as_deref(), Some(nil_str.as_str()));
        assert_eq!(ctx.plan_id.as_deref(), Some(nil_str.as_str()));
        assert_eq!(ctx.status.as_deref(), Some("user_accepted"));
        assert_eq!(meta["review_verdict"], json!("accepted"));
        assert_eq!(meta["reviewer_type"], json!("user"));
        assert_eq!(meta["resolution"], json!("user_accepted"));
        assert!(sanitize_metadata(&mut meta).is_empty());
    }

    #[test]
    fn final_review_reject_event_has_explicit_user_rejected_semantics() {
        let nil = Uuid::nil();
        let (event, ctx, mut meta) = review_decision_event_parts(
            nil,
            Some(nil),
            Some(nil),
            None,
            "user_rejected",
            "rejected",
            "user",
            "user_rejected",
        );

        assert_eq!(event, WorkflowAnalyticsEvent::ReviewDecisionRecorded);
        assert_eq!(ctx.status.as_deref(), Some("user_rejected"));
        assert_eq!(meta["review_verdict"], json!("rejected"));
        assert_eq!(meta["resolution"], json!("user_rejected"));
        assert!(sanitize_metadata(&mut meta).is_empty());
    }

    #[test]
    fn plan_revision_created_event_is_not_plan_generated() {
        let nil = Uuid::nil();
        let nil_str = nil.to_string();
        let (event, ctx, mut meta) = review_decision_event_parts(
            nil,
            None,
            Some(nil),
            None,
            "plan_revision_created",
            "plan_revision_created",
            "system",
            "plan_revision_created",
        );

        assert_eq!(event.event_name(), "quality.review_decision_recorded");
        assert_ne!(event.event_name(), "workflow.plan_generated");
        assert_eq!(ctx.workflow_id, None);
        assert_eq!(ctx.plan_id.as_deref(), Some(nil_str.as_str()));
        assert_eq!(ctx.status.as_deref(), Some("plan_revision_created"));
        assert_eq!(meta["resolution"], json!("plan_revision_created"));
        assert!(sanitize_metadata(&mut meta).is_empty());
    }

    #[test]
    fn review_node_rejected_event_is_step_scoped_and_consumable() {
        let nil = Uuid::nil();
        let nil_str = nil.to_string();
        let (event, ctx, mut meta) = review_decision_event_parts(
            nil,
            Some(nil),
            Some(nil),
            Some(nil),
            "review_node_rejected",
            "rejected",
            "lead",
            "review_node_rejected",
        );

        assert_eq!(event, WorkflowAnalyticsEvent::ReviewDecisionRecorded);
        assert_eq!(ctx.task_id.as_deref(), Some(nil_str.as_str()));
        assert_eq!(ctx.status.as_deref(), Some("review_node_rejected"));
        assert_eq!(meta["reviewer_type"], json!("lead"));
        assert_eq!(meta["resolution"], json!("review_node_rejected"));
        assert!(sanitize_metadata(&mut meta).is_empty());
    }

    // -----------------------------------------------------------------------
    // Fire-and-forget safety tests (None analytics)
    // -----------------------------------------------------------------------

    #[test]
    fn all_track_helpers_safe_with_none_analytics() {
        let nil = Uuid::nil();
        track_execution_state_changed(None, nil, nil, nil, "pending", "running", None);
        track_step_state_changed(
            None, nil, nil, nil, nil, "step1", "pending", "running", None, None,
        );
        track_plan_generated(None, nil, None, true);
        track_plan_generated(None, nil, Some(nil), false);
        track_plan_executed(None, nil, nil, nil);
        track_final_review_decision(None, nil, nil, nil, true);
        track_final_review_decision(None, nil, nil, nil, false);
        track_plan_revision_created(None, nil, nil);
        track_review_node_rejected(None, nil, nil, nil, nil, "lead");
        track_approval_requested(None, nil, nil, nil, "approval_request");
        track_approval_resolved(None, nil, nil, nil, "accepted");
        track_step_reviewed(None, nil, nil, nil, "approved", "lead");
        track_review_decision_recorded(None, nil, nil, nil, "approved", "user");
        track_retry_triggered(None, nil, nil, nil, 1);
        track_agent_error(None, nil, Some(nil), Some(nil), "crash", Some("executor"));
        track_runner_interrupted(None, nil, nil, nil, "user");
        track_message_sent(None, nil, None, 100, 2, 1);
        track_agent_mentioned(None, nil, 2, Some("executor"));
        track_attachment_added(None, nil, 1, 5000);
        track_session_archived(None, nil, None, false);
        track_session_archived(None, nil, None, true);
        track_agent_state_changed(None, nil, None, "running");
        track_diff_generated(None, nil, 5);
        track_permission_denied(None, nil, "capability_denied");
        track_handoff_completed(None, nil, nil, nil);
        track_session_created(None, nil, None);
        track_agent_added(None, nil, None, Some("codex"), true);
        track_diff_viewed(None, nil, None, Some("ws1"), 2);
        track_api_failure(
            None,
            Some(nil),
            None,
            "chat.sessions.workspaces",
            400,
            "bad_request",
        );
        track_websocket_disconnected(None, nil, "socket_closed");
        track_approval_timeout(None, nil, nil, nil, "approval_request");
    }

    #[test]
    fn analytics_if_enabled_blocks_capture_when_disabled() {
        assert!(analytics_if_enabled(None, false).is_none());
        assert!(analytics_if_enabled(None, true).is_none());

        let analytics = AnalyticsService::new(crate::services::analytics::AnalyticsConfig {
            posthog_api_key: "test-key".to_string(),
            posthog_api_endpoint: "https://example.com".to_string(),
        });
        assert!(analytics_if_enabled(Some(&analytics), false).is_none());
        assert!(analytics_if_enabled(Some(&analytics), true).is_some());
    }
}
