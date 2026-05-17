use chrono::Utc;
use db::models::{
    workflow_step::WorkflowStep, workflow_transcript::WorkflowTranscript, workflow_types::*,
};
use uuid::Uuid;

use super::{
    super::workflow_runtime::WorkflowRevisionFeedbackSource, step_input::StepFollowUpMode, *,
};

#[derive(Clone, Copy)]
enum SimulatedLeadVerdict {
    Approved,
    Rejected,
}

#[derive(Clone, Copy)]
#[allow(dead_code)]
enum SimulatedUserVerdict {
    Approved,
    Rejected,
    Parked,
}

fn simulate_step_feedback_trace(
    _max_retry: i32,
    lead_verdicts: &[SimulatedLeadVerdict],
    user_verdict: Option<SimulatedUserVerdict>,
) -> Vec<WorkflowStepStatus> {
    let mut trace = vec![WorkflowStepStatus::Running];
    for verdict in lead_verdicts {
        trace.push(WorkflowStepStatus::WaitingReview);
        match verdict {
            SimulatedLeadVerdict::Approved => {
                if let Some(user_verdict) = user_verdict {
                    trace.push(WorkflowStepStatus::WaitingInput);
                    match user_verdict {
                        SimulatedUserVerdict::Approved => {
                            trace.push(WorkflowStepStatus::Completed);
                        }
                        SimulatedUserVerdict::Rejected => {
                            trace.push(WorkflowStepStatus::Revising);
                            trace.push(WorkflowStepStatus::Running);
                            continue;
                        }
                        SimulatedUserVerdict::Parked => {}
                    }
                } else {
                    trace.push(WorkflowStepStatus::Completed);
                }
                return trace;
            }
            SimulatedLeadVerdict::Rejected => {
                trace.push(WorkflowStepStatus::Revising);
                trace.push(WorkflowStepStatus::Running);
            }
        }
    }

    trace
}

fn sample_step(status: WorkflowStepStatus, summary_text: Option<String>) -> WorkflowStep {
    let now = Utc::now();
    WorkflowStep {
        id: Uuid::new_v4(),
        execution_id: Uuid::new_v4(),
        round_id: Uuid::new_v4(),
        compiled_revision_id: None,
        step_key: "step-1".to_string(),
        step_type: WorkflowStepType::Task,
        title: "Implement fix".to_string(),
        instructions: "Apply the requested change".to_string(),
        assigned_workflow_agent_session_id: None,
        status,
        retry_count: 0,
        max_retry: 1,
        round_index: 1,
        display_order: 0,
        latest_run_id: None,
        summary_text,
        content: None,
        loop_id: None,
        lead_review_required: true,
        user_review_required: false,
        revision_context: None,
        created_at: now,
        updated_at: now,
        started_at: None,
        completed_at: None,
    }
}

#[test]
fn derive_failed_step_follow_up_context_prefers_latest_non_user_transcript() {
    let step = sample_step(
        WorkflowStepStatus::Failed,
        Some(
            serde_json::json!({
                "summary": "summary fallback",
                "content": "content fallback"
            })
            .to_string(),
        ),
    );
    let source_id = Uuid::new_v4();
    let transcripts = vec![
        WorkflowTranscript {
            id: Uuid::new_v4(),
            execution_id: step.execution_id,
            round_id: Some(step.round_id),
            workflow_agent_session_id: Some(Uuid::new_v4()),
            step_id: Some(step.id),
            sender_type: "user".to_string(),
            entry_type: "message".to_string(),
            content: "first user reply".to_string(),
            meta_json: None,
            created_at: Utc::now().to_rfc3339(),
        },
        WorkflowTranscript {
            id: source_id,
            execution_id: step.execution_id,
            round_id: Some(step.round_id),
            workflow_agent_session_id: Some(Uuid::new_v4()),
            step_id: Some(step.id),
            sender_type: "system".to_string(),
            entry_type: "message".to_string(),
            content: "Step failed because dependency data was missing.".to_string(),
            meta_json: None,
            created_at: Utc::now().to_rfc3339(),
        },
    ];

    let context = WorkflowOrchestrator::derive_failed_step_follow_up_context(&step, &transcripts);

    assert_eq!(context.source_transcript_id, Some(source_id));
    assert_eq!(
        context.previous_message_content,
        "Step failed because dependency data was missing."
    );
}

#[test]
fn build_step_follow_up_prompt_mentions_failed_restart() {
    let step = sample_step(WorkflowStepStatus::Failed, None);

    let prompt = WorkflowOrchestrator::build_step_follow_up_prompt(
        &step,
        "Previous attempt ended with an error.",
        "I have provided the missing dependency data.",
        StepFollowUpMode::Failed,
    );

    assert!(prompt.contains("previous attempt"));
    assert!(prompt.contains("restart the same agent session"));
    assert!(prompt.contains("Previous attempt ended with an error."));
    assert!(prompt.contains("I have provided the missing dependency data."));
    assert!(prompt.contains("Resume from the failed point"));
}

#[test]
fn retry_candidate_accepts_failed_and_interrupted_without_retry_budget() {
    let failed = sample_step(WorkflowStepStatus::Failed, None);
    assert!(WorkflowOrchestrator::validate_step_retry_candidate(&failed).is_ok());

    let interrupted = sample_step(WorkflowStepStatus::Interrupted, None);
    assert!(WorkflowOrchestrator::validate_step_retry_candidate(&interrupted).is_ok());

    let running = sample_step(WorkflowStepStatus::Running, None);
    assert!(WorkflowOrchestrator::validate_step_retry_candidate(&running).is_err());
}

#[test]
fn retry_candidate_ignores_max_retry_budget() {
    let mut step = sample_step(WorkflowStepStatus::Failed, None);

    step.max_retry = 0;
    step.retry_count = 0;
    assert!(WorkflowOrchestrator::validate_step_retry_candidate(&step).is_ok());

    step.max_retry = 1;
    step.retry_count = 0;
    assert!(WorkflowOrchestrator::validate_step_retry_candidate(&step).is_ok());
    step.retry_count = 1;
    assert!(WorkflowOrchestrator::validate_step_retry_candidate(&step).is_ok());

    step.max_retry = 2;
    step.retry_count = 1;
    assert!(WorkflowOrchestrator::validate_step_retry_candidate(&step).is_ok());
    step.retry_count = 2;
    assert!(WorkflowOrchestrator::validate_step_retry_candidate(&step).is_ok());
}

#[test]
fn completed_like_final_review_invariant_requires_only_completed_terminal_steps() {
    assert!(!WorkflowOrchestrator::all_steps_completed_like(&[]));

    let steps = vec![
        sample_step(WorkflowStepStatus::Completed, None),
        sample_step(WorkflowStepStatus::Skipped, None),
        sample_step(WorkflowStepStatus::Cancelled, None),
    ];
    assert!(WorkflowOrchestrator::all_steps_completed_like(&steps));

    let steps = vec![
        sample_step(WorkflowStepStatus::Completed, None),
        sample_step(WorkflowStepStatus::Failed, None),
    ];
    assert!(!WorkflowOrchestrator::all_steps_completed_like(&steps));
}

#[test]
fn revision_context_round_trips_pending_user_feedback() {
    let context = WorkflowOrchestrator::merge_revision_context(
        None,
        WorkflowRevisionFeedbackSource::User,
        "请把输出改成中文。",
        "Current summary",
        Some("Current full result"),
        &["src/main.rs".to_string()],
        2,
    );

    let pending = WorkflowOrchestrator::parse_pending_revision_feedback(Some(&context))
        .expect("pending feedback");

    assert!(matches!(
        pending.source,
        WorkflowRevisionFeedbackSource::User
    ));
    assert_eq!(pending.feedback, "请把输出改成中文。");
    assert_eq!(pending.previous_summary, "Current summary");
    assert_eq!(
        pending.previous_content.as_deref(),
        Some("Current full result")
    );
    assert_eq!(pending.previous_outputs, vec!["src/main.rs".to_string()]);
    assert_eq!(pending.review_round, 2);
}

#[test]
fn clear_pending_revision_feedback_removes_resume_payload() {
    let context = WorkflowOrchestrator::merge_revision_context(
        None,
        WorkflowRevisionFeedbackSource::Lead,
        "补充测试。",
        "Summary",
        None,
        &[],
        1,
    );

    let cleared = WorkflowOrchestrator::clear_pending_revision_feedback(Some(&context))
        .expect("cleared context");

    assert!(WorkflowOrchestrator::parse_pending_revision_feedback(Some(&cleared)).is_none());
    assert!(cleared.contains("feedback_history"));
}

#[test]
fn step_transition_duration_reports_terminal_elapsed_time() {
    let mut step = sample_step(WorkflowStepStatus::Running, None);
    step.started_at = Some(Utc::now());
    step.updated_at =
        step.started_at.expect("started_at set") + chrono::Duration::milliseconds(2500);
    step.completed_at =
        Some(step.started_at.expect("started_at set") + chrono::Duration::milliseconds(3200));

    let duration_ms = step_transition_duration_ms(&step, "completed");
    assert_eq!(duration_ms, Some(3200));
}

#[test]
fn step_transition_duration_uses_updated_at_fallback_for_cancelled() {
    let mut step = sample_step(WorkflowStepStatus::Running, None);
    step.started_at = Some(Utc::now());
    step.updated_at =
        step.started_at.expect("started_at set") + chrono::Duration::milliseconds(1800);
    step.completed_at = None;

    let duration_ms = step_transition_duration_ms(&step, "cancelled");
    assert_eq!(duration_ms, Some(1800));
}

#[test]
fn step_transition_duration_is_none_for_non_terminal_states() {
    let mut step = sample_step(WorkflowStepStatus::Running, None);
    step.started_at = Some(Utc::now());

    assert_eq!(step_transition_duration_ms(&step, "running"), None);
    assert_eq!(step_transition_duration_ms(&step, "waiting_review"), None);
}

#[test]
fn execute_step_with_feedback_trace_direct_passes() {
    let trace = simulate_step_feedback_trace(1, &[SimulatedLeadVerdict::Approved], None);

    assert_eq!(
        trace,
        vec![
            WorkflowStepStatus::Running,
            WorkflowStepStatus::WaitingReview,
            WorkflowStepStatus::Completed,
        ]
    );
}

#[test]
fn execute_step_with_feedback_trace_retries_after_lead_rejection() {
    let trace = simulate_step_feedback_trace(
        2,
        &[
            SimulatedLeadVerdict::Rejected,
            SimulatedLeadVerdict::Approved,
        ],
        None,
    );

    assert_eq!(
        trace,
        vec![
            WorkflowStepStatus::Running,
            WorkflowStepStatus::WaitingReview,
            WorkflowStepStatus::Revising,
            WorkflowStepStatus::Running,
            WorkflowStepStatus::WaitingReview,
            WorkflowStepStatus::Completed,
        ]
    );
}

#[test]
fn execute_step_with_feedback_trace_user_rejection_retries_after_waiting_input() {
    let trace = simulate_step_feedback_trace(
        1,
        &[SimulatedLeadVerdict::Approved],
        Some(SimulatedUserVerdict::Rejected),
    );

    assert_eq!(
        trace,
        vec![
            WorkflowStepStatus::Running,
            WorkflowStepStatus::WaitingReview,
            WorkflowStepStatus::WaitingInput,
            WorkflowStepStatus::Revising,
            WorkflowStepStatus::Running,
        ]
    );
}

#[test]
fn execute_step_with_feedback_trace_keeps_retrying_without_max_retry_limit() {
    let trace = simulate_step_feedback_trace(
        1,
        &[
            SimulatedLeadVerdict::Rejected,
            SimulatedLeadVerdict::Rejected,
        ],
        None,
    );

    assert_eq!(
        trace,
        vec![
            WorkflowStepStatus::Running,
            WorkflowStepStatus::WaitingReview,
            WorkflowStepStatus::Revising,
            WorkflowStepStatus::Running,
            WorkflowStepStatus::WaitingReview,
            WorkflowStepStatus::Revising,
            WorkflowStepStatus::Running,
        ]
    );
}
