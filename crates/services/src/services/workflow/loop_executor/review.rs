#[derive(Debug, PartialEq)]
struct LoopLeadReviewRejectedEvent {
    session_id: Uuid,
    execution_id: Uuid,
    plan_id: Uuid,
    step_id: Uuid,
    reviewer_type: &'static str,
}

fn loop_lead_review_rejected_event(
    execution: &WorkflowExecution,
    step_id: Uuid,
) -> LoopLeadReviewRejectedEvent {
    LoopLeadReviewRejectedEvent {
        session_id: execution.session_id,
        execution_id: execution.id,
        plan_id: execution.plan_id,
        step_id,
        reviewer_type: "lead",
    }
}

fn loop_lead_review_rejected_analytics_parts(
    execution: &WorkflowExecution,
    step_id: Uuid,
) -> crate::services::analytics_events::AnalyticsEvent {
    let rejected_event = loop_lead_review_rejected_event(execution, step_id);
    workflow_analytics::review_node_rejected_event(
        rejected_event.session_id,
        rejected_event.execution_id,
        rejected_event.plan_id,
        rejected_event.step_id,
        rejected_event.reviewer_type,
    )
}
