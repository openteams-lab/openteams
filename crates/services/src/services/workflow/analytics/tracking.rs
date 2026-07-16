use uuid::Uuid;

use crate::services::{
    analytics::AnalyticsService,
    analytics_events::{AnalyticsEvent, AnalyticsEventPayload, duration_bucket},
};

fn emit(analytics: Option<&AnalyticsService>, event: AnalyticsEvent) {
    if let Some(analytics) = analytics {
        analytics.record_event(event);
    }
}

pub fn track_execution_state_changed(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    plan_id: Uuid,
    from_status: &str,
    to_status: &str,
    duration_ms: Option<i64>,
) {
    let duration = duration_ms.map(duration_bucket).map(str::to_string);
    emit(
        analytics,
        AnalyticsEvent::new(AnalyticsEventPayload::ExecutionStateChanged {
            from_status: from_status.to_string(),
            to_status: to_status.to_string(),
            duration_bucket: duration.clone(),
        })
        .with_session(session_id)
        .with_workflow(execution_id, None)
        .with_plan(plan_id),
    );
    let terminal_payload = match to_status {
        "completed" => Some(AnalyticsEventPayload::WorkflowCompleted {
            from_status: from_status.to_string(),
            duration_bucket: duration,
        }),
        "failed" => Some(AnalyticsEventPayload::WorkflowFailed {
            from_status: from_status.to_string(),
            duration_bucket: duration,
        }),
        _ => None,
    };
    if let Some(payload) = terminal_payload {
        emit(
            analytics,
            AnalyticsEvent::new(payload)
                .with_session(session_id)
                .with_workflow(execution_id, None)
                .with_plan(plan_id),
        );
    }
}

#[allow(clippy::too_many_arguments)]
pub fn track_step_state_changed(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    plan_id: Uuid,
    step_id: Uuid,
    retry_count: i32,
    from_status: &str,
    to_status: &str,
    agent_role: Option<&str>,
    duration_ms: Option<i64>,
) {
    let duration_bucket = duration_ms.map(duration_bucket).map(str::to_string);
    let retry_count = retry_count.max(0) as u32;
    let payload = match to_status {
        "running" => AnalyticsEventPayload::StepStarted {
            retry_count,
            from_status: from_status.to_string(),
            agent_role: agent_role.map(str::to_string),
            duration_bucket,
        },
        "completed" | "failed" | "skipped" => AnalyticsEventPayload::StepCompleted {
            retry_count,
            from_status: from_status.to_string(),
            outcome: to_status.to_string(),
            agent_role: agent_role.map(str::to_string),
            duration_bucket,
        },
        _ => return,
    };
    emit(
        analytics,
        AnalyticsEvent::new(payload)
            .with_session(session_id)
            .with_workflow(execution_id, Some(step_id))
            .with_plan(plan_id),
    );
}

pub fn track_plan_generated(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    plan_id: Option<Uuid>,
    succeeded: bool,
) {
    let mut event = AnalyticsEvent::new(AnalyticsEventPayload::PlanGenerated { succeeded })
        .with_session(session_id);
    if let Some(plan_id) = plan_id {
        event = event.with_plan(plan_id);
    }
    emit(analytics, event);
}

pub fn track_plan_executed(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    plan_id: Uuid,
    execution_id: Uuid,
) {
    emit(
        analytics,
        AnalyticsEvent::new(AnalyticsEventPayload::PlanExecuted)
            .with_session(session_id)
            .with_workflow(execution_id, None)
            .with_plan(plan_id),
    );
}

pub fn track_session_created(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    _user_id: Option<&str>,
) {
    emit(
        analytics,
        AnalyticsEvent::new(AnalyticsEventPayload::SessionCreated).with_session(session_id),
    );
}

pub fn track_agent_added(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    _user_id: Option<&str>,
    runner_type: Option<&str>,
    has_workspace: bool,
) {
    emit(
        analytics,
        AnalyticsEvent::new(AnalyticsEventPayload::AgentAdded {
            runner_type: runner_type.map(str::to_string),
            has_workspace,
        })
        .with_session(session_id),
    );
}

pub fn track_approval_timeout(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    step_id: Uuid,
    request_type: &str,
) {
    emit(
        analytics,
        AnalyticsEvent::new(AnalyticsEventPayload::ApprovalTimeout {
            request_type: request_type.to_string(),
        })
        .with_session(session_id)
        .with_workflow(execution_id, Some(step_id)),
    );
}

pub fn track_approval_requested(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    step_id: Uuid,
    request_type: &str,
) {
    emit(
        analytics,
        AnalyticsEvent::new(AnalyticsEventPayload::ApprovalRequested {
            request_type: request_type.to_string(),
        })
        .with_session(session_id)
        .with_workflow(execution_id, Some(step_id)),
    );
}

pub fn track_approval_resolved(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    step_id: Uuid,
    resolution: &str,
) {
    emit(
        analytics,
        AnalyticsEvent::new(AnalyticsEventPayload::ApprovalResolved {
            resolution: resolution.to_string(),
        })
        .with_session(session_id)
        .with_workflow(execution_id, Some(step_id)),
    );
}

pub fn track_review_decision_recorded(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    step_id: Uuid,
    verdict: &str,
    reviewer_type: &str,
) {
    emit(
        analytics,
        AnalyticsEvent::new(AnalyticsEventPayload::ReviewDecisionRecorded {
            verdict: verdict.to_string(),
            reviewer_type: reviewer_type.to_string(),
            resolution: None,
        })
        .with_session(session_id)
        .with_workflow(execution_id, Some(step_id)),
    );
}

pub fn track_final_review_decision(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    plan_id: Uuid,
    accepted: bool,
) {
    let resolution = if accepted { "user_accepted" } else { "user_rejected" };
    emit(
        analytics,
        AnalyticsEvent::new(AnalyticsEventPayload::ReviewDecisionRecorded {
            verdict: if accepted { "accepted" } else { "rejected" }.to_string(),
            reviewer_type: "user".to_string(),
            resolution: Some(resolution.to_string()),
        })
        .with_session(session_id)
        .with_workflow(execution_id, None)
        .with_plan(plan_id),
    );
}

pub fn review_node_rejected_event(
    session_id: Uuid,
    execution_id: Uuid,
    plan_id: Uuid,
    step_id: Uuid,
    reviewer_type: &str,
) -> AnalyticsEvent {
    AnalyticsEvent::new(AnalyticsEventPayload::ReviewDecisionRecorded {
        verdict: "rejected".to_string(),
        reviewer_type: reviewer_type.to_string(),
        resolution: Some("review_node_rejected".to_string()),
    })
    .with_session(session_id)
    .with_workflow(execution_id, Some(step_id))
    .with_plan(plan_id)
}

pub fn track_review_node_rejected(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    plan_id: Uuid,
    step_id: Uuid,
    reviewer_type: &str,
) {
    emit(
        analytics,
        review_node_rejected_event(session_id, execution_id, plan_id, step_id, reviewer_type),
    );
}

pub fn track_retry_triggered(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    step_id: Uuid,
    retry_count: i32,
) {
    emit(
        analytics,
        AnalyticsEvent::new(AnalyticsEventPayload::RetryTriggered {
            retry_count: retry_count.max(0) as u32,
        })
        .with_session(session_id)
        .with_workflow(execution_id, Some(step_id)),
    );
}

pub fn track_agent_error(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Option<Uuid>,
    step_id: Option<Uuid>,
    error_code: &str,
    agent_role: Option<&str>,
) {
    let mut event = AnalyticsEvent::new(AnalyticsEventPayload::AgentError {
        run_kind: None,
        phase: None,
        error_code: error_code.to_string(),
        agent_id: None,
        agent_role: agent_role.map(str::to_string),
    })
    .with_session(session_id);
    if let Some(execution_id) = execution_id {
        event = event.with_workflow(execution_id, step_id);
    }
    emit(analytics, event);
}

pub fn track_runner_interrupted(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    execution_id: Uuid,
    step_id: Uuid,
    interruption_source: &str,
) {
    emit(
        analytics,
        AnalyticsEvent::new(AnalyticsEventPayload::RunnerInterrupted {
            interruption_source: interruption_source.to_string(),
        })
        .with_session(session_id)
        .with_workflow(execution_id, Some(step_id)),
    );
}

pub fn track_message_sent(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    _user_id: Option<&str>,
    message_length: usize,
    mention_count: usize,
    attachment_count: usize,
) {
    emit(
        analytics,
        AnalyticsEvent::new(AnalyticsEventPayload::MessageSent {
            message_length_bucket: message_length_bucket(message_length).to_string(),
            mention_count: mention_count.min(u32::MAX as usize) as u32,
            attachment_count: attachment_count.min(u32::MAX as usize) as u32,
        })
        .with_session(session_id),
    );
}

pub fn track_session_archived(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    _user_id: Option<&str>,
    is_restore: bool,
) {
    emit(
        analytics,
        AnalyticsEvent::new(AnalyticsEventPayload::SessionArchived {
            restored: is_restore,
        })
        .with_session(session_id),
    );
}

pub fn track_permission_denied(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    error_code: &str,
) {
    emit(
        analytics,
        AnalyticsEvent::new(AnalyticsEventPayload::PermissionDenied {
            error_code: error_code.to_string(),
        })
        .with_session(session_id),
    );
}
