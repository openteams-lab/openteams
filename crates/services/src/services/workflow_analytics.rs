//! Workflow analytics instrumentation module.
//!
//! Covers 5 event categories per `.openteams/plan.md`:
//! 1. Process funnel (workflow.*)
//! 2. Collaboration efficiency (collaboration.*)
//! 3. User engagement (engagement.*)
//! 4. Quality outcomes (quality.*)
//! 5. Risk/anomaly (risk.*)
//!
//! All events carry a unified context (`WorkflowEventContext`) and pass through
//! privacy filtering (forbidden blacklist + allowed whitelist) before being recorded.
#![allow(clippy::too_many_arguments)]

use std::collections::HashSet;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use super::analytics::{AnalyticsService, track_workflow_event};

// ---------------------------------------------------------------------------
// Unified event context (per plan.md)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowEventContext {
    pub session_id: Option<String>,
    pub workflow_id: Option<String>,
    pub workspace_id: Option<String>,
    pub user_id_hash: Option<String>,
    pub agent_role: Option<String>,
    pub timestamp: String,
    pub event_source: String,
    pub plan_id: Option<String>,
    pub task_id: Option<String>,
    pub status: Option<String>,
    pub duration_ms: Option<i64>,
    pub error_code: Option<String>,
    pub metadata_version: i64,
}

impl WorkflowEventContext {
    pub fn new(event_source: &str) -> Self {
        Self {
            session_id: None,
            workflow_id: None,
            workspace_id: None,
            user_id_hash: None,
            agent_role: None,
            timestamp: Utc::now().to_rfc3339(),
            event_source: event_source.to_string(),
            plan_id: None,
            task_id: None,
            status: None,
            duration_ms: None,
            error_code: None,
            metadata_version: 1,
        }
    }

    pub fn with_session(mut self, id: Uuid) -> Self {
        self.session_id = Some(id.to_string());
        self
    }

    pub fn with_workflow(mut self, id: Uuid) -> Self {
        self.workflow_id = Some(id.to_string());
        self
    }

    pub fn with_workspace(mut self, id: &str) -> Self {
        self.workspace_id = Some(id.to_string());
        self
    }

    pub fn with_user_id_hash(mut self, hash: &str) -> Self {
        self.user_id_hash = Some(hash.to_string());
        self
    }

    pub fn with_agent_role(mut self, role: &str) -> Self {
        self.agent_role = Some(role.to_string());
        self
    }

    pub fn with_plan(mut self, id: Uuid) -> Self {
        self.plan_id = Some(id.to_string());
        self
    }

    pub fn with_task(mut self, id: Uuid) -> Self {
        self.task_id = Some(id.to_string());
        self
    }

    pub fn with_status(mut self, status: &str) -> Self {
        self.status = Some(status.to_string());
        self
    }

    pub fn with_duration_ms(mut self, ms: i64) -> Self {
        self.duration_ms = Some(ms);
        self
    }

    pub fn with_error_code(mut self, code: &str) -> Self {
        self.error_code = Some(code.to_string());
        self
    }

    pub fn to_properties(&self) -> Value {
        serde_json::to_value(self).unwrap_or_else(|_| json!({}))
    }
}

// ---------------------------------------------------------------------------
// Event source validation
// ---------------------------------------------------------------------------

const VALID_EVENT_SOURCES: &[&str] = &[
    "backend",
    "frontend",
    "workflow_runner",
    "chat_runner",
    "reviewer",
];

const VALID_AGENT_ROLES: &[&str] = &["planner", "executor", "reviewer", "assistant", "unknown"];

pub fn validate_event_source(source: &str) -> bool {
    VALID_EVENT_SOURCES.contains(&source)
}

pub fn validate_agent_role(role: &str) -> bool {
    VALID_AGENT_ROLES.contains(&role)
}

// ---------------------------------------------------------------------------
// Privacy filtering
// ---------------------------------------------------------------------------

/// Fields that must NEVER appear in event metadata.
const FORBIDDEN_METADATA_KEYS: &[&str] = &[
    "message_content",
    "file_content",
    "full_path",
    "secret_value",
    "prompt_text",
    "raw_stdout",
    "raw_stderr",
    "stack_trace",
];

/// Allowed metadata keys (beyond the unified context).
/// Any key not in this whitelist AND not in the unified context will be stripped.
const ALLOWED_METADATA_KEYS: &[&str] = &[
    "message_length_bucket",
    "attachment_count",
    "mention_count",
    "diff_file_count",
    "retry_count",
    "runner_type",
    "api_route_key",
    "http_status",
    "attachment_type",
    "size_bucket",
    "step_key",
    "step_type",
    "review_verdict",
    "reviewer_type",
    "interruption_source",
    "request_type",
    "from_status",
    "event_category",
    "resolution",
    "agent_session_state",
    "detail_level",
    "has_workspace",
    "transcript_count",
    "transcript_scope",
];

/// Unified context field names that are set directly on the context struct.
const CONTEXT_FIELD_NAMES: &[&str] = &[
    "session_id",
    "workflow_id",
    "workspace_id",
    "user_id_hash",
    "agent_role",
    "timestamp",
    "event_source",
    "plan_id",
    "task_id",
    "status",
    "duration_ms",
    "error_code",
    "metadata_version",
];

#[derive(Debug, Clone, PartialEq)]
pub enum PrivacyViolation {
    ForbiddenField(String),
    UnallowedField(String),
}

/// Strip forbidden fields AND unallowed fields from metadata. Returns violations found.
pub fn sanitize_metadata(metadata: &mut serde_json::Map<String, Value>) -> Vec<PrivacyViolation> {
    let mut violations = Vec::new();
    let forbidden: HashSet<&str> = FORBIDDEN_METADATA_KEYS.iter().copied().collect();
    let allowed: HashSet<&str> = ALLOWED_METADATA_KEYS.iter().copied().collect();
    let context_fields: HashSet<&str> = CONTEXT_FIELD_NAMES.iter().copied().collect();

    let keys_to_remove: Vec<String> = metadata
        .keys()
        .filter(|k| {
            let key = k.as_str();
            if forbidden.contains(key) {
                return true;
            }
            // Allow context fields and whitelisted metadata
            if allowed.contains(key) || context_fields.contains(key) {
                return false;
            }
            // Reject anything not in the whitelist
            true
        })
        .cloned()
        .collect();

    for key in keys_to_remove {
        metadata.remove(&key);
        if forbidden.contains(key.as_str()) {
            violations.push(PrivacyViolation::ForbiddenField(key));
        } else {
            violations.push(PrivacyViolation::UnallowedField(key));
        }
    }

    violations
}

/// Validate that a context has all required fields populated correctly.
pub fn validate_context(ctx: &WorkflowEventContext) -> Vec<String> {
    let mut errors = Vec::new();

    if ctx.timestamp.is_empty() {
        errors.push("timestamp is required".to_string());
    }

    if ctx.event_source.is_empty() {
        errors.push("event_source is required".to_string());
    } else if !validate_event_source(&ctx.event_source) {
        errors.push(format!("invalid event_source: {}", ctx.event_source));
    }

    if ctx.metadata_version < 1 {
        errors.push("metadata_version must be >= 1".to_string());
    }

    if let Some(ref role) = ctx.agent_role
        && !validate_agent_role(role)
    {
        errors.push(format!("invalid agent_role: {}", role));
    }

    errors
}

// ---------------------------------------------------------------------------
// Workflow event names (all 5 categories)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub enum WorkflowAnalyticsEvent {
    // 1. Process funnel
    SessionCreated,
    AgentAdded,
    PlanGenerated,
    PlanExecuted,
    StepStarted,
    StepCompleted,
    ExecutionStateChanged,

    // 2. Collaboration efficiency
    AgentMentioned,
    AgentStateChanged,
    ApprovalRequested,
    ApprovalResolved,
    HandoffCompleted,

    // 3. User engagement
    MessageSent,
    AttachmentAdded,
    WorkflowCardOpened,
    TranscriptOpened,
    DiffViewed,
    SessionArchived,

    // 4. Quality outcomes
    WorkflowCompleted,
    WorkflowFailed,
    StepReviewed,
    DiffGenerated,
    RetryTriggered,
    ReviewDecisionRecorded,

    // 5. Risk/anomaly
    AgentError,
    PermissionDenied,
    ApprovalTimeout,
    ApiFailure,
    WebsocketDisconnected,
    RunnerInterrupted,
}

impl WorkflowAnalyticsEvent {
    pub fn event_name(&self) -> &'static str {
        match self {
            Self::SessionCreated => "workflow.session_created",
            Self::AgentAdded => "workflow.agent_added",
            Self::PlanGenerated => "workflow.plan_generated",
            Self::PlanExecuted => "workflow.plan_executed",
            Self::StepStarted => "workflow.step_started",
            Self::StepCompleted => "workflow.step_completed",
            Self::ExecutionStateChanged => "workflow.execution_state_changed",

            Self::AgentMentioned => "collaboration.agent_mentioned",
            Self::AgentStateChanged => "collaboration.agent_state_changed",
            Self::ApprovalRequested => "collaboration.approval_requested",
            Self::ApprovalResolved => "collaboration.approval_resolved",
            Self::HandoffCompleted => "collaboration.handoff_completed",

            Self::MessageSent => "engagement.message_sent",
            Self::AttachmentAdded => "engagement.attachment_added",
            Self::WorkflowCardOpened => "engagement.workflow_card_opened",
            Self::TranscriptOpened => "engagement.transcript_opened",
            Self::DiffViewed => "engagement.diff_viewed",
            Self::SessionArchived => "engagement.session_archived",

            Self::WorkflowCompleted => "quality.workflow_completed",
            Self::WorkflowFailed => "quality.workflow_failed",
            Self::StepReviewed => "quality.step_reviewed",
            Self::DiffGenerated => "quality.diff_generated",
            Self::RetryTriggered => "quality.retry_triggered",
            Self::ReviewDecisionRecorded => "quality.review_decision_recorded",

            Self::AgentError => "risk.agent_error",
            Self::PermissionDenied => "risk.permission_denied",
            Self::ApprovalTimeout => "risk.approval_timeout",
            Self::ApiFailure => "risk.api_failure",
            Self::WebsocketDisconnected => "risk.websocket_disconnected",
            Self::RunnerInterrupted => "risk.runner_interrupted",
        }
    }

    pub fn category(&self) -> &'static str {
        match self {
            Self::SessionCreated
            | Self::AgentAdded
            | Self::PlanGenerated
            | Self::PlanExecuted
            | Self::StepStarted
            | Self::StepCompleted
            | Self::ExecutionStateChanged => "process_funnel",

            Self::AgentMentioned
            | Self::AgentStateChanged
            | Self::ApprovalRequested
            | Self::ApprovalResolved
            | Self::HandoffCompleted => "collaboration",

            Self::MessageSent
            | Self::AttachmentAdded
            | Self::WorkflowCardOpened
            | Self::TranscriptOpened
            | Self::DiffViewed
            | Self::SessionArchived => "engagement",

            Self::WorkflowCompleted
            | Self::WorkflowFailed
            | Self::StepReviewed
            | Self::DiffGenerated
            | Self::RetryTriggered
            | Self::ReviewDecisionRecorded => "quality",

            Self::AgentError
            | Self::PermissionDenied
            | Self::ApprovalTimeout
            | Self::ApiFailure
            | Self::WebsocketDisconnected
            | Self::RunnerInterrupted => "risk",
        }
    }
}

// ---------------------------------------------------------------------------
// Record function: build and send analytics event
// ---------------------------------------------------------------------------

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
        "failed" | "cancelled" => Some(WorkflowAnalyticsEvent::WorkflowFailed),
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
        "completed" | "failed" | "cancelled" | "skipped" => WorkflowAnalyticsEvent::StepCompleted,
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

/// Emit workflow card opened event (engagement).
pub fn track_workflow_card_opened(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    workflow_id: Option<Uuid>,
    user_id_hash: Option<&str>,
    detail_level: &str,
) {
    let mut ctx = WorkflowEventContext::new("backend")
        .with_session(session_id)
        .with_status("opened");
    if let Some(hash) = user_id_hash {
        ctx = ctx.with_user_id_hash(hash);
    }
    if let Some(workflow_id) = workflow_id {
        ctx = ctx.with_workflow(workflow_id);
    }

    let mut meta = serde_json::Map::new();
    meta.insert("detail_level".to_string(), json!(detail_level));

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::WorkflowCardOpened,
        &ctx,
        meta,
    );
}

/// Emit transcript opened event (engagement).
pub fn track_transcript_opened(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    user_id_hash: Option<&str>,
    step_id: Option<Uuid>,
    transcript_count: usize,
    transcript_scope: &str,
) {
    let mut ctx = WorkflowEventContext::new("backend")
        .with_session(session_id)
        .with_workflow(execution_id)
        .with_status("opened");
    if let Some(hash) = user_id_hash {
        ctx = ctx.with_user_id_hash(hash);
    }
    if let Some(step_id) = step_id {
        ctx = ctx.with_task(step_id);
    }

    let mut meta = serde_json::Map::new();
    meta.insert("transcript_count".to_string(), json!(transcript_count));
    meta.insert("transcript_scope".to_string(), json!(transcript_scope));

    record_workflow_analytics_event(
        analytics,
        WorkflowAnalyticsEvent::TranscriptOpened,
        &ctx,
        meta,
    );
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

/// Hash a user ID for privacy-safe analytics distinct_id.
pub fn hash_user_id(user_id: &str) -> String {
    use std::{
        collections::hash_map::DefaultHasher,
        hash::{Hash, Hasher},
    };

    let mut hasher = DefaultHasher::new();
    user_id.hash(&mut hasher);
    format!("wf_user_{:016x}", hasher.finish())
}

pub fn analytics_if_enabled(
    analytics: Option<&AnalyticsService>,
    capture_enabled: bool,
) -> Option<&AnalyticsService> {
    if capture_enabled { analytics } else { None }
}

/// Classify message length into a privacy-safe bucket.
pub fn message_length_bucket(len: usize) -> &'static str {
    match len {
        0 => "empty",
        1..=50 => "short",
        51..=200 => "medium",
        201..=1000 => "long",
        _ => "very_long",
    }
}

/// Classify file size into a privacy-safe bucket.
pub fn size_bucket(bytes: u64) -> &'static str {
    match bytes {
        0 => "empty",
        1..=1024 => "tiny",
        1025..=102400 => "small",
        102401..=1048576 => "medium",
        1048577..=10485760 => "large",
        _ => "very_large",
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
    fn execution_cancelled_keeps_funnel_event_and_adds_quality_failed_event() {
        let (funnel, terminal) = execution_events_for_to_status("cancelled");
        assert_eq!(funnel, WorkflowAnalyticsEvent::ExecutionStateChanged);
        assert_eq!(
            terminal,
            Some(WorkflowAnalyticsEvent::WorkflowFailed),
            "cancelled should emit both execution_state_changed and quality.workflow_failed"
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
            "completed" | "failed" | "cancelled" | "skipped" => {
                Some(WorkflowAnalyticsEvent::StepCompleted)
            }
            _ => None,
        };
        assert_eq!(event, Some(WorkflowAnalyticsEvent::StepStarted));
        assert_eq!(event.unwrap().event_name(), "workflow.step_started");
    }

    #[test]
    fn track_step_to_completed_produces_step_completed() {
        let event = match "completed" {
            "running" => Some(WorkflowAnalyticsEvent::StepStarted),
            "completed" | "failed" | "cancelled" | "skipped" => {
                Some(WorkflowAnalyticsEvent::StepCompleted)
            }
            _ => None,
        };
        assert_eq!(event, Some(WorkflowAnalyticsEvent::StepCompleted));
    }

    #[test]
    fn track_step_to_waiting_produces_no_event() {
        let event = match "waiting_input" {
            "running" => Some(WorkflowAnalyticsEvent::StepStarted),
            "completed" | "failed" | "cancelled" | "skipped" => {
                Some(WorkflowAnalyticsEvent::StepCompleted)
            }
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
        track_workflow_card_opened(None, nil, Some(nil), None, "full");
        track_transcript_opened(None, nil, nil, None, Some(nil), 3, "step");
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
