use chrono::Utc;
use db::{
    DBService,
    models::{
        chat_session::{ChatSession, CreateChatSession},
        workflow_event::WorkflowEvent,
        workflow_execution::{CreateWorkflowExecution, WorkflowExecution},
        workflow_plan::{CreateWorkflowPlan, WorkflowPlan},
        workflow_plan_revision::{CreateWorkflowPlanRevision, WorkflowPlanRevision},
        workflow_round::{CreateWorkflowRound, WorkflowRound},
        workflow_step::{CreateWorkflowStep, WorkflowStep},
        workflow_step_edge::WorkflowStepEdge,
        workflow_transcript::WorkflowTranscript,
        workflow_types::*,
    },
};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::{
    super::workflow_runtime::WorkflowRevisionFeedbackSource, step_input::StepFollowUpMode, *,
};

struct StopFixture {
    db: DBService,
    execution: WorkflowExecution,
    running_step_id: Uuid,
    review_step_id: Uuid,
    ready_step_id: Uuid,
}

async fn seed_workflow_stop_fixture() -> StopFixture {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("create sqlite memory pool");
    sqlx::migrate!("../db/migrations")
        .run(&pool)
        .await
        .expect("run migrations");
    let db = DBService { pool };
    let session = ChatSession::create(
        &db.pool,
        &CreateChatSession {
            title: Some("stop fixture".to_string()),
            workspace_path: None,
            project_id: None,
            worktree_mode: None,
        },
        Uuid::new_v4(),
    )
    .await
    .expect("create session");
    let plan_json = serde_json::json!({
        "version": "1",
        "title": "Stop fixture",
        "goal": "Test terminal stop",
        "agents": { "lead": "lead", "available": [] },
        "nodes": [],
        "edges": []
    })
    .to_string();
    let plan = WorkflowPlan::create(
        &db.pool,
        &CreateWorkflowPlan {
            session_id: session.id,
            source_message_id: None,
            created_by_session_agent_id: None,
            title: "Stop fixture".to_string(),
            summary_text: None,
            plan_json: plan_json.clone(),
            plan_schema_version: 1,
            plan_hash: "stop-fixture".to_string(),
            validation_status: WorkflowValidationStatus::Valid,
            validation_errors_json: None,
        },
        Uuid::new_v4(),
    )
    .await
    .expect("create plan");
    let revision = WorkflowPlanRevision::create(
        &db.pool,
        &CreateWorkflowPlanRevision {
            plan_id: plan.id,
            revision_no: 1,
            edited_by: WorkflowRevisionEditor::System,
            editor_session_agent_id: None,
            reason: Some("test".to_string()),
            plan_json,
            plan_hash: "stop-fixture".to_string(),
            validation_status: WorkflowValidationStatus::Valid,
            validation_errors_json: None,
        },
        Uuid::new_v4(),
    )
    .await
    .expect("create revision");
    let execution = WorkflowExecution::create(
        &db.pool,
        &CreateWorkflowExecution {
            session_id: session.id,
            plan_id: plan.id,
            active_revision_id: Some(revision.id),
            lead_session_agent_id: None,
            title: "Stop fixture".to_string(),
        },
        Uuid::new_v4(),
    )
    .await
    .expect("create execution");
    let round = WorkflowRound::create(
        &db.pool,
        &CreateWorkflowRound {
            execution_id: execution.id,
            round_index: 1,
            source_revision_id: Some(revision.id),
        },
        Uuid::new_v4(),
    )
    .await
    .expect("create round");
    let execution = WorkflowExecution::update_active_round(&db.pool, execution.id, round.id, 1)
        .await
        .expect("activate round");
    let execution =
        WorkflowExecution::update_status(&db.pool, execution.id, WorkflowExecutionStatus::Running)
            .await
            .expect("mark execution running");

    async fn create_step(
        pool: &SqlitePool,
        execution: &WorkflowExecution,
        round: &WorkflowRound,
        revision_id: Uuid,
        key: &str,
        display_order: i32,
        status: WorkflowStepStatus,
    ) -> WorkflowStep {
        let step = WorkflowStep::create(
            pool,
            &CreateWorkflowStep {
                execution_id: execution.id,
                round_id: round.id,
                compiled_revision_id: Some(revision_id),
                step_key: key.to_string(),
                step_type: WorkflowStepType::Task,
                title: key.to_string(),
                instructions: key.to_string(),
                assigned_workflow_agent_session_id: None,
                max_retry: 1,
                round_index: 1,
                display_order,
                loop_id: None,
                lead_review_required: Some(false),
                user_review_required: Some(false),
                revision_context: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create step");
        WorkflowStep::update_status(pool, step.id, status)
            .await
            .expect("set step status")
    }

    let running = create_step(
        &db.pool,
        &execution,
        &round,
        revision.id,
        "running",
        0,
        WorkflowStepStatus::Running,
    )
    .await;
    let review = create_step(
        &db.pool,
        &execution,
        &round,
        revision.id,
        "review",
        1,
        WorkflowStepStatus::WaitingReview,
    )
    .await;
    let ready = create_step(
        &db.pool,
        &execution,
        &round,
        revision.id,
        "ready",
        2,
        WorkflowStepStatus::Ready,
    )
    .await;
    StopFixture {
        db,
        execution,
        running_step_id: running.id,
        review_step_id: review.id,
        ready_step_id: ready.id,
    }
}

#[tokio::test]
async fn workflow_stop_execution_transitions_to_terminal_failed() {
    let fixture = seed_workflow_stop_fixture().await;
    let runner = ChatRunner::new(fixture.db.clone());
    let stopped =
        WorkflowOrchestrator::stop_execution(&runner, &fixture.db.pool, fixture.execution.id)
            .await
            .expect("stop execution");
    assert_eq!(stopped.status, WorkflowExecutionStatus::Failed);
    assert!(stopped.completed_at.is_some());
    assert_eq!(
        WorkflowStep::find_by_id(&fixture.db.pool, fixture.running_step_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        WorkflowStepStatus::Interrupted,
    );
    assert_eq!(
        WorkflowStep::find_by_id(&fixture.db.pool, fixture.review_step_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        WorkflowStepStatus::Interrupted,
    );
    assert_eq!(
        WorkflowStep::find_by_id(&fixture.db.pool, fixture.ready_step_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        WorkflowStepStatus::Ready,
    );
    let latest_event = WorkflowEvent::find_by_execution(&fixture.db.pool, stopped.id)
        .await
        .expect("list events")
        .into_iter()
        .rev()
        .find(|event| event.step_id.is_none() && event.status_after.as_deref() == Some("failed"))
        .expect("execution failed event");
    assert!(
        latest_event
            .detail_json
            .as_deref()
            .unwrap_or_default()
            .contains("stopped_by_user")
    );
}

#[tokio::test]
async fn workflow_stop_execution_rejects_non_running_execution() {
    let completed = seed_workflow_stop_fixture().await;
    WorkflowExecution::update_status(
        &completed.db.pool,
        completed.execution.id,
        WorkflowExecutionStatus::Completed,
    )
    .await
    .expect("complete execution");
    let before = WorkflowEvent::find_by_execution(&completed.db.pool, completed.execution.id)
        .await
        .unwrap()
        .len();
    let error = WorkflowOrchestrator::stop_execution(
        &ChatRunner::new(completed.db.clone()),
        &completed.db.pool,
        completed.execution.id,
    )
    .await
    .expect_err("completed execution cannot stop");
    assert!(error.to_string().contains("expected running"));
    assert_eq!(
        WorkflowEvent::find_by_execution(&completed.db.pool, completed.execution.id)
            .await
            .unwrap()
            .len(),
        before,
    );

    let failed = seed_workflow_stop_fixture().await;
    WorkflowExecution::update_status(
        &failed.db.pool,
        failed.execution.id,
        WorkflowExecutionStatus::Failed,
    )
    .await
    .expect("fail execution");
    let error = WorkflowOrchestrator::stop_execution(
        &ChatRunner::new(failed.db.clone()),
        &failed.db.pool,
        failed.execution.id,
    )
    .await
    .expect_err("failed execution cannot stop");
    assert!(error.to_string().contains("expected running"));
}

#[tokio::test]
async fn workflow_stop_execution_cannot_resume() {
    let fixture = seed_workflow_stop_fixture().await;
    let runner = ChatRunner::new(fixture.db.clone());
    WorkflowOrchestrator::stop_execution(&runner, &fixture.db.pool, fixture.execution.id)
        .await
        .expect("stop execution");

    let events_before = WorkflowEvent::find_by_execution(&fixture.db.pool, fixture.execution.id)
        .await
        .expect("list events before resume");
    let error =
        WorkflowOrchestrator::resume_execution(&fixture.db.pool, &runner, fixture.execution.id)
            .await
            .expect_err("a user-stopped workflow must not resume");
    assert_eq!(
        error.to_string(),
        "状态迁移非法: workflow stopped by user cannot be resumed",
    );
    assert_eq!(
        WorkflowStep::find_by_id(&fixture.db.pool, fixture.ready_step_id)
            .await
            .expect("load ready step")
            .expect("ready step exists")
            .status,
        WorkflowStepStatus::Ready,
    );
    let events_after = WorkflowEvent::find_by_execution(&fixture.db.pool, fixture.execution.id)
        .await
        .expect("list events after resume");
    assert_eq!(events_after.len(), events_before.len());
    assert!(
        !events_after
            .iter()
            .skip(events_before.len())
            .any(|event| { event.status_after.as_deref() == Some("running") })
    );
}

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

fn sample_execution_for_scheduler(active_round_id: Uuid) -> WorkflowExecution {
    let now = Utc::now();
    WorkflowExecution {
        id: Uuid::new_v4(),
        session_id: Uuid::new_v4(),
        plan_id: Uuid::new_v4(),
        active_revision_id: None,
        active_round_id: Some(active_round_id),
        workflow_card_message_id: None,
        lead_session_agent_id: None,
        status: WorkflowExecutionStatus::Running,
        current_round: 1,
        title: "Execution".to_string(),
        compiled_graph_hash: None,
        started_at: Some(now),
        completed_at: None,
        cleaned_at: None,
        cleaned_reason: None,
        created_at: now,
        updated_at: now,
    }
}

#[test]
fn scheduler_edge_repair_skips_compiled_edges_for_missing_materialized_steps() {
    let round_id = Uuid::new_v4();
    let execution = sample_execution_for_scheduler(round_id);
    let mut materialized_step = sample_step(WorkflowStepStatus::Ready, None);
    materialized_step.execution_id = execution.id;
    materialized_step.round_id = round_id;
    materialized_step.step_key = "data_balance_config".to_string();

    let compiled_graph = CompiledGraph {
        plan_hash: "plan".to_string(),
        compiled_graph_hash: "graph".to_string(),
        steps: Vec::new(),
        edges: vec![CompiledEdge {
            edge_id: "edge-1".to_string(),
            from_step_key: "data_setup".to_string(),
            to_step_key: "data_balance_config".to_string(),
            edge_kind: WorkflowEdgeKind::Hard,
        }],
        ready_step_keys: Vec::new(),
        loops: None,
    };

    let repaired = WorkflowOrchestrator::scheduler_step_edges_from_compiled(
        &execution,
        &[materialized_step],
        &Vec::<WorkflowStepEdge>::new(),
        &compiled_graph,
    )
    .expect("missing materialized compiled edge steps should be skipped");

    assert!(repaired.is_empty());
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
fn pending_revision_feedback_identifies_loop_scope() {
    let loop_context = serde_json::json!({
        "pending_feedback": {
            "source": "lead",
            "scope": "loop",
            "loop_key": "loop-a",
            "feedback": "revise this loop member",
            "previous_summary": "summary",
            "previous_outputs": [],
            "review_round": 1
        }
    })
    .to_string();
    let step_context = WorkflowOrchestrator::merge_revision_context(
        None,
        WorkflowRevisionFeedbackSource::Lead,
        "review feedback",
        "Summary",
        None,
        &[],
        1,
    );

    assert!(WorkflowOrchestrator::pending_revision_feedback_is_loop(
        Some(&loop_context)
    ));
    assert!(!WorkflowOrchestrator::pending_revision_feedback_is_loop(
        Some(&step_context)
    ));
    assert!(!WorkflowOrchestrator::pending_revision_feedback_is_loop(
        None
    ));
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
fn step_transition_duration_uses_updated_at_fallback_for_failed() {
    let mut step = sample_step(WorkflowStepStatus::Running, None);
    step.started_at = Some(Utc::now());
    step.updated_at =
        step.started_at.expect("started_at set") + chrono::Duration::milliseconds(1800);
    step.completed_at = None;

    let duration_ms = step_transition_duration_ms(&step, "failed");
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
