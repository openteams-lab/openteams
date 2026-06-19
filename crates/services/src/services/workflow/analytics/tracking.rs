/// Record a workflow analytics event via PostHog.
/// Validates context and sanitizes metadata before sending.
/// This is fire-and-forget; failures are logged but do not propagate.
pub fn record_workflow_analytics_event(
    analytics: Option<&AnalyticsService>,
    event: WorkflowAnalyticsEvent,
    ctx: &WorkflowEventContext,
    mut extra_metadata: serde_json::Map<String, Value>,
) {
    let analytics = match analytics {
        Some(a) => a,
        None => return,
    };

    // Validate context before sending
    let context_errors = validate_context(ctx);
    if !context_errors.is_empty() {
        tracing::warn!(
            event = event.event_name(),
            errors = ?context_errors,
            "Invalid workflow analytics context, dropping event"
        );
        return;
    }

    // Privacy: strip forbidden and unallowed fields
    let violations = sanitize_metadata(&mut extra_metadata);
    if !violations.is_empty() {
        tracing::warn!(
            event = event.event_name(),
            violations = ?violations,
            "Stripped disallowed fields from workflow analytics event"
        );
    }

    // Build properties: unified context + allowed metadata
    let mut properties = match ctx.to_properties() {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };

    // Merge extra metadata
    for (key, value) in extra_metadata {
        properties.insert(key, value);
    }

    properties.insert("event_category".to_string(), json!(event.category()));

    let distinct_id = ctx
        .user_id_hash
        .as_deref()
        .unwrap_or("anonymous")
        .to_string();

    track_workflow_event(
        Some(analytics),
        &distinct_id,
        event.event_name(),
        properties,
    );
}

// ---------------------------------------------------------------------------
// Orchestrator integration helpers
// ---------------------------------------------------------------------------

fn execution_events_for_to_status(
    to_status: &str,
) -> (WorkflowAnalyticsEvent, Option<WorkflowAnalyticsEvent>) {
    let terminal_quality_event = match to_status {
        "completed" => Some(WorkflowAnalyticsEvent::WorkflowCompleted),
        "failed" => Some(WorkflowAnalyticsEvent::WorkflowFailed),
        _ => None,
    };
    (
        WorkflowAnalyticsEvent::ExecutionStateChanged,
        terminal_quality_event,
    )
}

/// Emit a workflow execution state change analytics event.
pub fn track_execution_state_changed(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    plan_id: Uuid,
    from_status: &str,
    to_status: &str,
    duration_ms: Option<i64>,
) {
    let (funnel_event, terminal_quality_event) = execution_events_for_to_status(to_status);
    let mut ctx = WorkflowEventContext::new("workflow_runner")
        .with_session(session_id)
        .with_workflow(execution_id)
        .with_plan(plan_id)
        .with_status(to_status);

    if let Some(ms) = duration_ms {
        ctx = ctx.with_duration_ms(ms);
    }

    let mut meta = serde_json::Map::new();
    meta.insert("from_status".to_string(), json!(from_status));

    record_workflow_analytics_event(analytics, funnel_event, &ctx, meta.clone());

    if let Some(quality_event) = terminal_quality_event {
        record_workflow_analytics_event(analytics, quality_event, &ctx, meta);
    }
}

/// Emit a workflow step state change analytics event.
pub fn track_step_state_changed(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    plan_id: Uuid,
    step_id: Uuid,
    step_key: &str,
    from_status: &str,
    to_status: &str,
    agent_role: Option<&str>,
    duration_ms: Option<i64>,
) {
    let event = match to_status {
        "running" => WorkflowAnalyticsEvent::StepStarted,
        "completed" | "failed" | "skipped" => WorkflowAnalyticsEvent::StepCompleted,
        _ => return, // Only track meaningful transitions
    };

    let mut ctx = WorkflowEventContext::new("workflow_runner")
        .with_session(session_id)
        .with_workflow(execution_id)
        .with_plan(plan_id)
        .with_task(step_id)
        .with_status(to_status);

    if let Some(role) = agent_role {
        ctx = ctx.with_agent_role(role);
    }
    if let Some(ms) = duration_ms {
        ctx = ctx.with_duration_ms(ms);
    }

    let mut meta = serde_json::Map::new();
    meta.insert("step_key".to_string(), json!(step_key));
    meta.insert("from_status".to_string(), json!(from_status));

    record_workflow_analytics_event(analytics, event, &ctx, meta);
}

/// Emit a plan generated analytics event.
pub fn track_plan_generated(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    plan_id: Option<Uuid>,
    succeeded: bool,
) {
    let mut ctx = WorkflowEventContext::new("workflow_runner")
        .with_session(session_id)
        .with_status(if succeeded { "succeeded" } else { "failed" });
    if let Some(plan_id) = plan_id {
        ctx = ctx.with_plan(plan_id);
    }

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::PlanGenerated,
        &ctx,
        serde_json::Map::new(),
    );
}

/// Emit a plan executed analytics event.
pub fn track_plan_executed(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    plan_id: Uuid,
    execution_id: Uuid,
) {
    let ctx = WorkflowEventContext::new("workflow_runner")
        .with_session(session_id)
        .with_plan(plan_id)
        .with_workflow(execution_id)
        .with_status("started");

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::PlanExecuted,
        &ctx,
        serde_json::Map::new(),
    );
}

/// Emit workflow session created event (process funnel).
pub fn track_session_created(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    user_id_hash: Option<&str>,
) {
    let mut ctx = WorkflowEventContext::new("backend")
        .with_session(session_id)
        .with_status("succeeded");
    if let Some(hash) = user_id_hash {
        ctx = ctx.with_user_id_hash(hash);
    }

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::SessionCreated,
        &ctx,
        serde_json::Map::new(),
    );
}

/// Emit workflow agent added event (process funnel).
pub fn track_agent_added(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    user_id_hash: Option<&str>,
    runner_type: Option<&str>,
    has_workspace: bool,
) {
    let mut ctx = WorkflowEventContext::new("backend")
        .with_session(session_id)
        .with_status("succeeded");
    if let Some(hash) = user_id_hash {
        ctx = ctx.with_user_id_hash(hash);
    }

    let mut meta = serde_json::Map::new();
    if let Some(rt) = runner_type {
        meta.insert("runner_type".to_string(), json!(rt));
    }
    meta.insert("has_workspace".to_string(), json!(has_workspace));

    record_workflow_analytics_event(analytics, WorkflowAnalyticsEvent::AgentAdded, &ctx, meta);
}

/// Emit diff viewed event (engagement).
pub fn track_diff_viewed(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    user_id_hash: Option<&str>,
    workspace_id: Option<&str>,
    diff_file_count: usize,
) {
    let mut ctx = WorkflowEventContext::new("backend")
        .with_session(session_id)
        .with_status("viewed");
    if let Some(hash) = user_id_hash {
        ctx = ctx.with_user_id_hash(hash);
    }
    if let Some(workspace_id) = workspace_id {
        ctx = ctx.with_workspace(workspace_id);
    }

    let mut meta = serde_json::Map::new();
    meta.insert("diff_file_count".to_string(), json!(diff_file_count));

    record_workflow_analytics_event(analytics, WorkflowAnalyticsEvent::DiffViewed, &ctx, meta);
}

/// Emit API failure event (risk).
pub fn track_api_failure(
    analytics: Option<&AnalyticsService>,
    session_id: Option<Uuid>,
    user_id_hash: Option<&str>,
    api_route_key: &str,
    http_status: u16,
    error_code: &str,
) {
    let mut ctx = WorkflowEventContext::new("backend")
        .with_status("failed")
        .with_error_code(error_code);
    if let Some(session_id) = session_id {
        ctx = ctx.with_session(session_id);
    }
    if let Some(hash) = user_id_hash {
        ctx = ctx.with_user_id_hash(hash);
    }

    let mut meta = serde_json::Map::new();
    meta.insert("api_route_key".to_string(), json!(api_route_key));
    meta.insert("http_status".to_string(), json!(http_status));

    record_workflow_analytics_event(analytics, WorkflowAnalyticsEvent::ApiFailure, &ctx, meta);
}

/// Emit websocket disconnected event (risk).
pub fn track_websocket_disconnected(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    error_code: &str,
) {
    let ctx = WorkflowEventContext::new("backend")
        .with_session(session_id)
        .with_status("disconnected")
        .with_error_code(error_code);
    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::WebsocketDisconnected,
        &ctx,
        serde_json::Map::new(),
    );
}

/// Emit approval timeout event (risk).
pub fn track_approval_timeout(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    step_id: Uuid,
    request_type: &str,
) {
    let ctx = WorkflowEventContext::new("workflow_runner")
        .with_session(session_id)
        .with_workflow(execution_id)
        .with_task(step_id)
        .with_status("timeout")
        .with_error_code("approval_timeout");

    let mut meta = serde_json::Map::new();
    meta.insert("request_type".to_string(), json!(request_type));

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::ApprovalTimeout,
        &ctx,
        meta,
    );
}

/// Emit an approval/permission/input/continue requested analytics event.
pub fn track_approval_requested(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    step_id: Uuid,
    request_type: &str,
) {
    let ctx = WorkflowEventContext::new("workflow_runner")
        .with_session(session_id)
        .with_workflow(execution_id)
        .with_task(step_id)
        .with_status("waiting_approval");

    let mut meta = serde_json::Map::new();
    meta.insert("request_type".to_string(), json!(request_type));

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::ApprovalRequested,
        &ctx,
        meta,
    );
}

/// Emit an approval/permission/input/continue resolved analytics event.
pub fn track_approval_resolved(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    step_id: Uuid,
    resolution: &str,
) {
    let ctx = WorkflowEventContext::new("workflow_runner")
        .with_session(session_id)
        .with_workflow(execution_id)
        .with_task(step_id)
        .with_status(resolution);

    let mut meta = serde_json::Map::new();
    meta.insert("resolution".to_string(), json!(resolution));

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::ApprovalResolved,
        &ctx,
        meta,
    );
}

/// Emit a step reviewed analytics event.
pub fn track_step_reviewed(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    step_id: Uuid,
    verdict: &str,
    reviewer_type: &str,
) {
    let ctx = WorkflowEventContext::new("workflow_runner")
        .with_session(session_id)
        .with_workflow(execution_id)
        .with_task(step_id)
        .with_status(verdict);

    let mut meta = serde_json::Map::new();
    meta.insert("review_verdict".to_string(), json!(verdict));
    meta.insert("reviewer_type".to_string(), json!(reviewer_type));

    record_workflow_analytics_event(analytics, WorkflowAnalyticsEvent::StepReviewed, &ctx, meta);
}

/// Emit a review decision recorded analytics event.
pub fn track_review_decision_recorded(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    step_id: Uuid,
    verdict: &str,
    reviewer_type: &str,
) {
    let ctx = WorkflowEventContext::new("workflow_runner")
        .with_session(session_id)
        .with_workflow(execution_id)
        .with_task(step_id)
        .with_status(verdict);

    let mut meta = serde_json::Map::new();
    meta.insert("review_verdict".to_string(), json!(verdict));
    meta.insert("reviewer_type".to_string(), json!(reviewer_type));

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::ReviewDecisionRecorded,
        &ctx,
        meta,
    );
}

fn review_decision_event_parts(
    session_id: Uuid,
    execution_id: Option<Uuid>,
    plan_id: Option<Uuid>,
    step_id: Option<Uuid>,
    status: &str,
    verdict: &str,
    reviewer_type: &str,
    resolution: &str,
) -> (
    WorkflowAnalyticsEvent,
    WorkflowEventContext,
    serde_json::Map<String, Value>,
) {
    let mut ctx = WorkflowEventContext::new("workflow_runner")
        .with_session(session_id)
        .with_status(status);

    if let Some(execution_id) = execution_id {
        ctx = ctx.with_workflow(execution_id);
    }
    if let Some(plan_id) = plan_id {
        ctx = ctx.with_plan(plan_id);
    }
    if let Some(step_id) = step_id {
        ctx = ctx.with_task(step_id);
    }

    let mut meta = serde_json::Map::new();
    meta.insert("review_verdict".to_string(), json!(verdict));
    meta.insert("reviewer_type".to_string(), json!(reviewer_type));
    meta.insert("resolution".to_string(), json!(resolution));

    (WorkflowAnalyticsEvent::ReviewDecisionRecorded, ctx, meta)
}

/// Emit a final review user decision event with explicit user_accepted/user_rejected semantics.
pub fn track_final_review_decision(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    plan_id: Uuid,
    accepted: bool,
) {
    let status = if accepted {
        "user_accepted"
    } else {
        "user_rejected"
    };
    let verdict = if accepted { "accepted" } else { "rejected" };
    let (event, ctx, meta) = review_decision_event_parts(
        session_id,
        Some(execution_id),
        Some(plan_id),
        None,
        status,
        verdict,
        "user",
        status,
    );

    record_workflow_analytics_event(analytics, event, &ctx, meta);
}

/// Emit a pre-execution plan replacement/revision event that is distinct from plan_generated.
pub fn track_plan_revision_created(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    plan_id: Uuid,
) {
    let (event, ctx, meta) = review_decision_event_parts(
        session_id,
        None,
        Some(plan_id),
        None,
        "plan_revision_created",
        "plan_revision_created",
        "system",
        "plan_revision_created",
    );

    record_workflow_analytics_event(analytics, event, &ctx, meta);
}

/// Emit an explicit review-node rejection event for loop-review rejection paths.
pub(crate) fn review_node_rejected_event_parts(
    session_id: Uuid,
    execution_id: Uuid,
    plan_id: Uuid,
    step_id: Uuid,
    reviewer_type: &str,
) -> (
    WorkflowAnalyticsEvent,
    WorkflowEventContext,
    serde_json::Map<String, Value>,
) {
    review_decision_event_parts(
        session_id,
        Some(execution_id),
        Some(plan_id),
        Some(step_id),
        "review_node_rejected",
        "rejected",
        reviewer_type,
        "review_node_rejected",
    )
}

/// Emit an explicit review-node rejection event for loop-review rejection paths.
pub fn track_review_node_rejected(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    plan_id: Uuid,
    step_id: Uuid,
    reviewer_type: &str,
) {
    let (event, ctx, meta) =
        review_node_rejected_event_parts(session_id, execution_id, plan_id, step_id, reviewer_type);

    record_workflow_analytics_event(analytics, event, &ctx, meta);
}

/// Emit a retry triggered analytics event.
pub fn track_retry_triggered(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    step_id: Uuid,
    retry_count: i32,
) {
    let ctx = WorkflowEventContext::new("workflow_runner")
        .with_session(session_id)
        .with_workflow(execution_id)
        .with_task(step_id)
        .with_status("retrying");

    let mut meta = serde_json::Map::new();
    meta.insert("retry_count".to_string(), json!(retry_count));

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::RetryTriggered,
        &ctx,
        meta,
    );
}

/// Emit an agent error analytics event.
pub fn track_agent_error(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Option<Uuid>,
    step_id: Option<Uuid>,
    error_code: &str,
    agent_role: Option<&str>,
) {
    let mut ctx = WorkflowEventContext::new("chat_runner")
        .with_session(session_id)
        .with_status("error")
        .with_error_code(error_code);

    if let Some(eid) = execution_id {
        ctx = ctx.with_workflow(eid);
    }
    if let Some(sid) = step_id {
        ctx = ctx.with_task(sid);
    }
    if let Some(role) = agent_role {
        ctx = ctx.with_agent_role(role);
    }

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::AgentError,
        &ctx,
        serde_json::Map::new(),
    );
}

/// Emit a runner interrupted analytics event.
pub fn track_runner_interrupted(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    step_id: Uuid,
    interruption_source: &str,
) {
    let ctx = WorkflowEventContext::new("workflow_runner")
        .with_session(session_id)
        .with_workflow(execution_id)
        .with_task(step_id)
        .with_status("interrupted");

    let mut meta = serde_json::Map::new();
    meta.insert(
        "interruption_source".to_string(),
        json!(interruption_source),
    );

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::RunnerInterrupted,
        &ctx,
        meta,
    );
}

// ---------------------------------------------------------------------------
// Chat service integration helpers
// ---------------------------------------------------------------------------

/// Emit a message sent analytics event (engagement).
/// Only records length bucket, mention count, and attachment count.
pub fn track_message_sent(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    user_id_hash: Option<&str>,
    message_length: usize,
    mention_count: usize,
    attachment_count: usize,
) {
    let mut ctx = WorkflowEventContext::new("backend")
        .with_session(session_id)
        .with_status("sent");

    if let Some(hash) = user_id_hash {
        ctx = ctx.with_user_id_hash(hash);
    }

    let mut meta = serde_json::Map::new();
    meta.insert(
        "message_length_bucket".to_string(),
        json!(message_length_bucket(message_length)),
    );
    meta.insert("mention_count".to_string(), json!(mention_count));
    meta.insert("attachment_count".to_string(), json!(attachment_count));

    record_workflow_analytics_event(analytics, WorkflowAnalyticsEvent::MessageSent, &ctx, meta);
}

/// Emit an agent mentioned analytics event (collaboration).
/// Only records mention count and agent role, not message content.
pub fn track_agent_mentioned(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    mention_count: usize,
    agent_role: Option<&str>,
) {
    let mut ctx = WorkflowEventContext::new("backend")
        .with_session(session_id)
        .with_status("mentioned");

    if let Some(role) = agent_role {
        ctx = ctx.with_agent_role(role);
    }

    let mut meta = serde_json::Map::new();
    meta.insert("mention_count".to_string(), json!(mention_count));

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::AgentMentioned,
        &ctx,
        meta,
    );
}

/// Emit an attachment added analytics event (engagement).
/// Only records count and size bucket, not file names or paths.
pub fn track_attachment_added(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    attachment_count: usize,
    total_size_bytes: u64,
) {
    let ctx = WorkflowEventContext::new("backend")
        .with_session(session_id)
        .with_status("uploaded");

    let mut meta = serde_json::Map::new();
    meta.insert("attachment_count".to_string(), json!(attachment_count));
    meta.insert(
        "size_bucket".to_string(),
        json!(size_bucket(total_size_bytes)),
    );

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::AttachmentAdded,
        &ctx,
        meta,
    );
}

/// Emit a session archived/restored analytics event (engagement).
pub fn track_session_archived(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    user_id_hash: Option<&str>,
    is_restore: bool,
) {
    let mut ctx = WorkflowEventContext::new("backend")
        .with_session(session_id)
        .with_status(if is_restore { "restored" } else { "archived" });

    if let Some(hash) = user_id_hash {
        ctx = ctx.with_user_id_hash(hash);
    }

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::SessionArchived,
        &ctx,
        serde_json::Map::new(),
    );
}

// ---------------------------------------------------------------------------
// Chat runner integration helpers
// ---------------------------------------------------------------------------

/// Emit an agent state changed analytics event (collaboration).
pub fn track_agent_state_changed(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    agent_role: Option<&str>,
    new_state: &str,
) {
    let mut ctx = WorkflowEventContext::new("chat_runner")
        .with_session(session_id)
        .with_status(new_state);

    if let Some(role) = agent_role {
        ctx = ctx.with_agent_role(role);
    }

    let mut meta = serde_json::Map::new();
    meta.insert("agent_session_state".to_string(), json!(new_state));

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::AgentStateChanged,
        &ctx,
        meta,
    );
}

/// Emit a diff generated analytics event (quality).
/// Only records file count, not actual diff content.
pub fn track_diff_generated(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    diff_file_count: usize,
) {
    let ctx = WorkflowEventContext::new("chat_runner")
        .with_session(session_id)
        .with_status("generated");

    let mut meta = serde_json::Map::new();
    meta.insert("diff_file_count".to_string(), json!(diff_file_count));

    record_workflow_analytics_event(analytics, WorkflowAnalyticsEvent::DiffGenerated, &ctx, meta);
}

/// Emit a permission denied analytics event (risk).
pub fn track_permission_denied(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    error_code: &str,
) {
    let ctx = WorkflowEventContext::new("backend")
        .with_session(session_id)
        .with_status("denied")
        .with_error_code(error_code);

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::PermissionDenied,
        &ctx,
        serde_json::Map::new(),
    );
}

/// Emit a handoff completed analytics event (collaboration).
pub fn track_handoff_completed(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    step_id: Uuid,
) {
    let ctx = WorkflowEventContext::new("workflow_runner")
        .with_session(session_id)
        .with_workflow(execution_id)
        .with_task(step_id)
        .with_status("handoff_completed");

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::HandoffCompleted,
        &ctx,
        serde_json::Map::new(),
    );
}
