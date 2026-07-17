use chrono::{DateTime, Utc};
use db::models::analytics::{AnalyticsEventRecord, CreateAnalyticsEventRecord};
use executors::profile::canonical_variant_key;
use serde_json::{Value, json};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::analytics::{AnalyticsService, forward_analytics_record_to_posthog};

/// The single business-event catalog. Variant fields are the only supported analytics payload;
/// callers cannot attach arbitrary JSON metadata.
#[derive(Debug, Clone, PartialEq)]
pub enum AnalyticsEventPayload {
    SessionCreated,
    AgentAdded {
        runner_type: Option<String>,
        has_workspace: bool,
    },
    PlanGenerated {
        succeeded: bool,
    },
    PlanExecuted,
    ExecutionStateChanged {
        from_status: String,
        to_status: String,
        duration_bucket: Option<String>,
    },
    StepStarted {
        retry_count: u32,
        from_status: String,
        agent_role: Option<String>,
        duration_bucket: Option<String>,
    },
    StepCompleted {
        retry_count: u32,
        from_status: String,
        outcome: String,
        agent_role: Option<String>,
        duration_bucket: Option<String>,
    },
    WorkflowCompleted {
        from_status: String,
        duration_bucket: Option<String>,
    },
    WorkflowFailed {
        from_status: String,
        duration_bucket: Option<String>,
    },
    ApprovalRequested {
        request_type: String,
    },
    ApprovalResolved {
        resolution: String,
    },
    MessageSent {
        message_length_bucket: String,
        mention_count: u32,
        attachment_count: u32,
    },
    SessionArchived {
        restored: bool,
    },
    RetryTriggered {
        retry_count: u32,
    },
    ReviewDecisionRecorded {
        verdict: String,
        reviewer_type: String,
        resolution: Option<String>,
    },
    AgentError {
        run_kind: Option<String>,
        phase: Option<String>,
        error_code: String,
        agent_id: Option<Uuid>,
        agent_role: Option<String>,
    },
    PermissionDenied {
        error_code: String,
    },
    ApprovalTimeout {
        request_type: String,
    },
    RunnerInterrupted {
        interruption_source: String,
    },
    SessionDeleted {
        had_messages: bool,
    },
    SkillAssigned {
        skill_id: Uuid,
        agent_id: Uuid,
    },
    SkillEnabled {
        skill_id: Uuid,
        agent_id: Uuid,
    },
    SkillDisabled {
        skill_id: Uuid,
        agent_id: Uuid,
    },
    SkillInstalled {
        skill_id: Uuid,
        source: String,
    },
    PresetSnapshotCreated {
        member_count: u32,
        overwritten: bool,
        overwrite_strategy: String,
    },
    AgentRunStarted {
        agent_id: Uuid,
        run_kind: String,
        executor_profile: Option<String>,
    },
    AgentRunCompleted {
        agent_id: Option<Uuid>,
        run_kind: String,
        outcome: String,
        duration_bucket: String,
    },
}

impl AnalyticsEventPayload {
    pub const EVENT_NAMES: [&'static str; 27] = [
        "session_created",
        "agent_added",
        "workflow.plan_generated",
        "workflow.plan_executed",
        "workflow.execution_state_changed",
        "workflow.step_started",
        "workflow.step_completed",
        "quality.workflow_completed",
        "quality.workflow_failed",
        "collaboration.approval_requested",
        "collaboration.approval_resolved",
        "engagement.message_sent",
        "engagement.session_archived",
        "quality.retry_triggered",
        "quality.review_decision_recorded",
        "risk.agent_error",
        "risk.permission_denied",
        "risk.approval_timeout",
        "risk.runner_interrupted",
        "session_delete",
        "skill_assign",
        "skill_enable",
        "skill_disable",
        "skill_install",
        "preset_snapshot_create",
        "agent_run_start",
        "agent_run_complete",
    ];

    pub fn event_name(&self) -> &'static str {
        match self {
            Self::SessionCreated => "session_created",
            Self::AgentAdded { .. } => "agent_added",
            Self::PlanGenerated { .. } => "workflow.plan_generated",
            Self::PlanExecuted => "workflow.plan_executed",
            Self::ExecutionStateChanged { .. } => "workflow.execution_state_changed",
            Self::StepStarted { .. } => "workflow.step_started",
            Self::StepCompleted { .. } => "workflow.step_completed",
            Self::WorkflowCompleted { .. } => "quality.workflow_completed",
            Self::WorkflowFailed { .. } => "quality.workflow_failed",
            Self::ApprovalRequested { .. } => "collaboration.approval_requested",
            Self::ApprovalResolved { .. } => "collaboration.approval_resolved",
            Self::MessageSent { .. } => "engagement.message_sent",
            Self::SessionArchived { .. } => "engagement.session_archived",
            Self::RetryTriggered { .. } => "quality.retry_triggered",
            Self::ReviewDecisionRecorded { .. } => "quality.review_decision_recorded",
            Self::AgentError { .. } => "risk.agent_error",
            Self::PermissionDenied { .. } => "risk.permission_denied",
            Self::ApprovalTimeout { .. } => "risk.approval_timeout",
            Self::RunnerInterrupted { .. } => "risk.runner_interrupted",
            Self::SessionDeleted { .. } => "session_delete",
            Self::SkillAssigned { .. } => "skill_assign",
            Self::SkillEnabled { .. } => "skill_enable",
            Self::SkillDisabled { .. } => "skill_disable",
            Self::SkillInstalled { .. } => "skill_install",
            Self::PresetSnapshotCreated { .. } => "preset_snapshot_create",
            Self::AgentRunStarted { .. } => "agent_run_start",
            Self::AgentRunCompleted { .. } => "agent_run_complete",
        }
    }

    pub fn event_group(&self) -> Option<&'static str> {
        event_group_for_event_name(self.event_name())
    }

    pub fn properties(&self) -> Value {
        match self {
            Self::SessionCreated | Self::PlanExecuted => json!({}),
            Self::AgentAdded {
                runner_type,
                has_workspace,
            } => json!({
                "runner_type": compact_optional(runner_type.as_deref()),
                "has_workspace": has_workspace,
            }),
            Self::PlanGenerated { succeeded } => json!({"succeeded": succeeded}),
            Self::ExecutionStateChanged {
                from_status,
                to_status,
                duration_bucket,
            } => json!({
                "from_status": compact(from_status), "to_status": compact(to_status),
                "duration_bucket": duration_bucket,
            }),
            Self::StepStarted {
                retry_count,
                from_status,
                agent_role,
                duration_bucket,
            } => json!({
                "retry_count": retry_count, "from_status": compact(from_status),
                "agent_role": compact_optional(agent_role.as_deref()), "duration_bucket": duration_bucket,
            }),
            Self::StepCompleted {
                retry_count,
                from_status,
                outcome,
                agent_role,
                duration_bucket,
            } => json!({
                "retry_count": retry_count, "from_status": compact(from_status), "outcome": compact(outcome),
                "agent_role": compact_optional(agent_role.as_deref()), "duration_bucket": duration_bucket,
            }),
            Self::WorkflowCompleted {
                from_status,
                duration_bucket,
            }
            | Self::WorkflowFailed {
                from_status,
                duration_bucket,
            } => json!({
                "from_status": compact(from_status), "duration_bucket": duration_bucket,
            }),
            Self::ApprovalRequested { request_type } | Self::ApprovalTimeout { request_type } => {
                json!({"request_type": compact(request_type)})
            }
            Self::ApprovalResolved { resolution } => json!({"resolution": compact(resolution)}),
            Self::MessageSent {
                message_length_bucket,
                mention_count,
                attachment_count,
            } => json!({
                "message_length_bucket": compact(message_length_bucket), "mention_count": mention_count,
                "attachment_count": attachment_count,
            }),
            Self::SessionArchived { restored } => {
                json!({"action": if *restored { "restored" } else { "archived" }})
            }
            Self::RetryTriggered { retry_count } => json!({"retry_count": retry_count}),
            Self::ReviewDecisionRecorded {
                verdict,
                reviewer_type,
                resolution,
            } => json!({
                "review_verdict": compact(verdict), "reviewer_type": compact(reviewer_type),
                "resolution": compact_optional(resolution.as_deref()),
            }),
            Self::AgentError {
                run_kind,
                phase,
                error_code,
                agent_id,
                agent_role,
            } => json!({
                "run_kind": compact_optional(run_kind.as_deref()), "phase": compact_optional(phase.as_deref()),
                "error_code": compact(error_code), "agent_id": agent_id,
                "agent_role": compact_optional(agent_role.as_deref()),
            }),
            Self::PermissionDenied { error_code } => json!({"error_code": compact(error_code)}),
            Self::RunnerInterrupted {
                interruption_source,
            } => json!({"interruption_source": compact(interruption_source)}),
            Self::SessionDeleted { had_messages } => json!({"had_messages": had_messages}),
            Self::SkillAssigned { skill_id, agent_id }
            | Self::SkillEnabled { skill_id, agent_id }
            | Self::SkillDisabled { skill_id, agent_id } => {
                json!({"skill_id": skill_id, "agent_id": agent_id})
            }
            Self::SkillInstalled { skill_id, source } => {
                json!({"skill_id": skill_id, "source": compact(source)})
            }
            Self::PresetSnapshotCreated {
                member_count,
                overwritten,
                overwrite_strategy,
            } => json!({
                "member_count": member_count, "overwritten": overwritten,
                "overwrite_strategy": compact(overwrite_strategy),
            }),
            Self::AgentRunStarted {
                agent_id,
                run_kind,
                executor_profile,
            } => json!({
                "agent_id": agent_id, "run_kind": compact(run_kind),
                "executor_profile": compact_optional(executor_profile.as_deref()),
            }),
            Self::AgentRunCompleted {
                agent_id,
                run_kind,
                outcome,
                duration_bucket,
            } => json!({
                "agent_id": agent_id, "run_kind": compact(run_kind), "outcome": compact(outcome),
                "duration_bucket": compact(duration_bucket),
            }),
        }
    }
}

fn compact(value: &str) -> String {
    value.chars().take(64).collect()
}

fn compact_optional(value: Option<&str>) -> Option<String> {
    value.map(compact)
}

pub fn event_group_for_event_name(event_name: &str) -> Option<&'static str> {
    match event_name.split_once('.').map(|(prefix, _)| prefix) {
        Some("workflow") => Some("process_funnel"),
        Some("collaboration") => Some("collaboration"),
        Some("engagement") => Some("engagement"),
        Some("quality") => Some("quality"),
        Some("risk") => Some("risk"),
        _ => None,
    }
}

#[derive(Debug, Clone, Default)]
pub struct AnalyticsEventContext {
    pub session_id: Option<Uuid>,
    pub run_id: Option<Uuid>,
    pub workflow_execution_id: Option<Uuid>,
    pub plan_id: Option<Uuid>,
    pub step_id: Option<Uuid>,
}

#[derive(Debug, Clone)]
pub struct AnalyticsEvent {
    pub id: Uuid,
    pub occurred_at: DateTime<Utc>,
    pub context: AnalyticsEventContext,
    pub payload: AnalyticsEventPayload,
}

impl AnalyticsEvent {
    pub fn new(payload: AnalyticsEventPayload) -> Self {
        Self {
            id: Uuid::new_v4(),
            occurred_at: Utc::now(),
            context: AnalyticsEventContext::default(),
            payload,
        }
    }

    pub fn with_session(mut self, session_id: Uuid) -> Self {
        self.context.session_id = Some(session_id);
        self
    }
    pub fn with_run(mut self, run_id: Uuid) -> Self {
        self.context.run_id = Some(run_id);
        self
    }
    pub fn with_workflow(mut self, execution_id: Uuid, step_id: Option<Uuid>) -> Self {
        self.context.workflow_execution_id = Some(execution_id);
        self.context.step_id = step_id;
        self
    }
    pub fn with_plan(mut self, plan_id: Uuid) -> Self {
        self.context.plan_id = Some(plan_id);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillInstallSource {
    Builtin,
    Registry,
}

impl SkillInstallSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Builtin => "builtin",
            Self::Registry => "registry",
        }
    }
}

pub fn extract_executor_profile_variant(tools_enabled: &Value) -> Option<String> {
    let variant = tools_enabled
        .as_object()?
        .get("executor_profile_variant")?
        .as_str()?
        .trim();
    if variant.is_empty() || variant.eq_ignore_ascii_case("DEFAULT") {
        return None;
    }
    Some(canonical_variant_key(variant))
}

pub fn duration_bucket(duration_ms: i64) -> &'static str {
    match duration_ms {
        ..=999 => "under_1s",
        1_000..=9_999 => "1s_10s",
        10_000..=59_999 => "10s_1m",
        60_000..=299_999 => "1m_5m",
        _ => "over_5m",
    }
}

pub struct AnalyticsProjector<'a> {
    pool: &'a SqlitePool,
    analytics: Option<&'a AnalyticsService>,
    capture_enabled: bool,
}

impl<'a> AnalyticsProjector<'a> {
    pub fn new(
        pool: &'a SqlitePool,
        analytics: Option<&'a AnalyticsService>,
        capture_enabled: bool,
    ) -> Self {
        Self {
            pool,
            analytics,
            capture_enabled,
        }
    }

    pub async fn record(
        &self,
        event: AnalyticsEvent,
    ) -> Result<Option<AnalyticsEventRecord>, sqlx::Error> {
        if !self.capture_enabled || self.analytics.is_none() {
            return Ok(None);
        }
        let create = CreateAnalyticsEventRecord {
            event_type: event.payload.event_name().to_string(),
            session_id: event.context.session_id,
            run_id: event.context.run_id,
            workflow_execution_id: event.context.workflow_execution_id,
            plan_id: event.context.plan_id,
            step_id: event.context.step_id,
            payload_json: event.payload.properties(),
            occurred_at: event.occurred_at,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
        };
        let record = AnalyticsEventRecord::create(self.pool, &create, event.id).await?;
        forward_analytics_record_to_posthog(self.analytics, &record, "backend");
        Ok(Some(record))
    }

    pub async fn record_or_warn(&self, event: AnalyticsEvent) {
        let event_name = event.payload.event_name();
        if let Err(error) = self.record(event).await {
            tracing::warn!(%error, event_name, "Failed to record analytics event");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_catalog_has_27_unique_event_names() {
        assert_eq!(
            AnalyticsEventPayload::EVENT_NAMES
                .into_iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            27
        );
    }

    #[test]
    fn event_groups_follow_event_name_prefixes() {
        for (event_name, expected) in [
            ("workflow.step_started", Some("process_funnel")),
            ("collaboration.approval_requested", Some("collaboration")),
            ("engagement.message_sent", Some("engagement")),
            ("quality.workflow_completed", Some("quality")),
            ("risk.agent_error", Some("risk")),
            ("skill_install", None),
        ] {
            assert_eq!(event_group_for_event_name(event_name), expected);
        }

        let message = AnalyticsEventPayload::MessageSent {
            message_length_bucket: "short".to_string(),
            mention_count: 0,
            attachment_count: 0,
        };
        assert_eq!(message.event_group(), Some("engagement"));

        assert_eq!(AnalyticsEventPayload::SessionCreated.event_group(), None);
        assert_eq!(
            AnalyticsEventPayload::AgentAdded {
                runner_type: None,
                has_workspace: false,
            }
            .event_group(),
            None
        );
    }

    #[test]
    fn step_payload_is_bounded_and_does_not_include_step_key() {
        let payload = AnalyticsEventPayload::StepCompleted {
            retry_count: u32::MAX,
            from_status: "x".repeat(400),
            outcome: "y".repeat(400),
            agent_role: Some("z".repeat(400)),
            duration_bucket: Some("over_5m".to_string()),
        }
        .properties();
        let encoded = serde_json::to_vec(&payload).unwrap();
        assert!(encoded.len() <= 512, "payload was {} bytes", encoded.len());
        assert!(payload.get("step_key").is_none());
    }

    #[test]
    fn executor_profile_variant_is_normalized() {
        assert_eq!(
            extract_executor_profile_variant(
                &json!({"executor_profile_variant": "auto model gpt 5 2"})
            ),
            Some("AUTO_MODEL_GPT_5_2".to_string())
        );
        assert_eq!(
            extract_executor_profile_variant(&json!({"executor_profile_variant": "DEFAULT"})),
            None
        );
    }
}
