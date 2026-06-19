pub fn build_workflow_card_projection(
    execution: &WorkflowExecution,
    plan: &WorkflowPlan,
    revision: &WorkflowPlanRevision,
    revisions: &[WorkflowPlanRevision],
    steps: &[WorkflowStep],
    _edges: &[WorkflowStepEdge],
    rounds: &[WorkflowRound],
    loops: &[WorkflowLoop],
    iteration_feedbacks: &[WorkflowIterationFeedback],
    step_reviews: &[WorkflowStepReview],
    transcripts: &[WorkflowTranscript],
    workflow_agent_sessions: &[WorkflowAgentSession],
    session_agents: &[ChatSessionAgent],
    agents: &[ChatAgent],
    error_message: Option<String>,
) -> Result<WorkflowCardProjection, WorkflowRuntimeError> {
    let mut plan_json: WorkflowPlanJson = serde_json::from_str(&revision.plan_json)?;
    plan_json.nodes = overlay_step_statuses(&plan_json, steps);

    let session_agent_name_by_id: HashMap<Uuid, String> = session_agents
        .iter()
        .filter_map(|session_agent| {
            let agent_name = agents
                .iter()
                .find(|agent| agent.id == session_agent.agent_id)
                .map(|agent| agent.name.clone())?;
            Some((session_agent.id, agent_name))
        })
        .collect();

    let workflow_agent_name_by_id: HashMap<Uuid, String> = workflow_agent_sessions
        .iter()
        .filter_map(|workflow_session| {
            let name = session_agent_name_by_id
                .get(&workflow_session.session_agent_id)?
                .clone();
            Some((workflow_session.id, name))
        })
        .collect();

    let completed_step_count = steps
        .iter()
        .filter(|step| step.status == WorkflowStepStatus::Completed)
        .count();
    let total_step_count = steps.len();

    let latest_review_by_step_id: HashMap<Uuid, WorkflowCardReview> = step_reviews
        .iter()
        .map(|review| {
            (
                review.step_id,
                WorkflowCardReview {
                    reviewer_type: to_workflow_wire_value(&review.reviewer_type),
                    verdict: to_workflow_wire_value(&review.verdict),
                    feedback: review.feedback.clone(),
                    review_round: review.review_round,
                    created_at: review.created_at.to_rfc3339(),
                },
            )
        })
        .collect();
    let loop_key_by_step_key = build_loop_key_by_step_key(&plan_json, steps, loops);
    apply_runtime_loop_keys(&mut plan_json, &loop_key_by_step_key);

    let pending_reviews = build_pending_reviews(steps, loops, transcripts);
    let pending_review = pending_reviews.first().cloned();
    let pending_input = build_pending_input(steps, transcripts);

    let step_views = build_workflow_step_views(
        steps,
        &loop_key_by_step_key,
        &latest_review_by_step_id,
        &workflow_agent_name_by_id,
        transcripts,
    );

    let agent_views = session_agents
        .iter()
        .filter_map(|session_agent| {
            let agent = agents
                .iter()
                .find(|agent| agent.id == session_agent.agent_id)?;
            Some(WorkflowCardAgent {
                session_agent_id: session_agent.id.to_string(),
                workflow_agent_session_id: workflow_agent_sessions
                    .iter()
                    .find(|workflow_session| workflow_session.session_agent_id == session_agent.id)
                    .map(|workflow_session| workflow_session.id.to_string()),
                agent_id: agent.id.to_string(),
                name: agent.name.clone(),
            })
        })
        .collect::<Vec<_>>();

    let loop_views = build_workflow_loop_views(loops);

    let iteration_history = build_iteration_history(rounds, steps, iteration_feedbacks);
    let round_graphs = build_round_graphs(
        rounds,
        revision,
        revisions,
        steps,
        loops,
        &latest_review_by_step_id,
        &workflow_agent_name_by_id,
        transcripts,
    )?;

    let result_step = steps
        .iter()
        .find(|step| step.step_type == WorkflowStepType::Result);
    let (result_summary, outputs) = result_step
        .and_then(|step| parse_summary_payload(step.summary_text.as_deref()))
        .map(|payload| (Some(payload.summary), payload.outputs))
        .unwrap_or_else(|| (None, Vec::new()));

    let state = match execution.status {
        WorkflowExecutionStatus::Pending => WorkflowCardState::Pending,
        WorkflowExecutionStatus::Completed => WorkflowCardState::Completed,
        WorkflowExecutionStatus::Failed => WorkflowCardState::Failed,
        WorkflowExecutionStatus::Paused => WorkflowCardState::Paused,
        WorkflowExecutionStatus::Waiting => WorkflowCardState::Waiting,
        WorkflowExecutionStatus::Recompiling => WorkflowCardState::Running,
        _ => WorkflowCardState::Running,
    };

    let is_terminal = matches!(
        execution.status,
        WorkflowExecutionStatus::Completed | WorkflowExecutionStatus::Failed
    );

    Ok(WorkflowCardProjection {
        execution_id: Some(execution.id.to_string()),
        plan_id: plan.id.to_string(),
        revision_id: revision.id.to_string(),
        title: plan.title.clone(),
        goal: plan
            .summary_text
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| plan.title.clone()),
        state,
        execution_status: to_workflow_wire_value(&execution.status),
        error_message,
        completed_step_count,
        total_step_count,
        result_summary,
        outputs,
        agents: agent_views,
        steps: step_views,
        current_round: execution.current_round,
        loops: loop_views,
        pending_review,
        pending_reviews,
        pending_input,
        iteration_history,
        round_graphs,
        plan: plan_json,
        started_at: execution.started_at.map(|value| value.to_rfc3339()),
        completed_at: execution.completed_at.map(|value| value.to_rfc3339()),
        validation_errors: None,
        is_terminal,
        has_transcripts: None,
    })
}

pub fn build_workflow_card_projection_lightweight(
    execution: &WorkflowExecution,
    plan: &WorkflowPlan,
    revision: &WorkflowPlanRevision,
    revisions: &[WorkflowPlanRevision],
    steps: &[WorkflowStep],
    _edges: &[WorkflowStepEdge],
    rounds: &[WorkflowRound],
    loops: &[WorkflowLoop],
    iteration_feedbacks: &[WorkflowIterationFeedback],
    step_reviews: &[WorkflowStepReview],
    transcripts: &[WorkflowTranscript],
    workflow_agent_sessions: &[WorkflowAgentSession],
    session_agents: &[ChatSessionAgent],
    agents: &[ChatAgent],
    transcript_count: Option<i64>,
    error_message: Option<String>,
) -> Result<WorkflowCardProjection, WorkflowRuntimeError> {
    let mut plan_json: WorkflowPlanJson = serde_json::from_str(&revision.plan_json)?;
    plan_json.nodes = overlay_step_statuses(&plan_json, steps);

    let session_agent_name_by_id: HashMap<Uuid, String> = session_agents
        .iter()
        .filter_map(|session_agent| {
            let agent_name = agents
                .iter()
                .find(|agent| agent.id == session_agent.agent_id)
                .map(|agent| agent.name.clone())?;
            Some((session_agent.id, agent_name))
        })
        .collect();

    let workflow_agent_name_by_id: HashMap<Uuid, String> = workflow_agent_sessions
        .iter()
        .filter_map(|workflow_session| {
            let name = session_agent_name_by_id
                .get(&workflow_session.session_agent_id)?
                .clone();
            Some((workflow_session.id, name))
        })
        .collect();

    let completed_step_count = steps
        .iter()
        .filter(|step| step.status == WorkflowStepStatus::Completed)
        .count();
    let total_step_count = steps.len();

    let latest_review_by_step_id: HashMap<Uuid, WorkflowCardReview> = step_reviews
        .iter()
        .map(|review| {
            (
                review.step_id,
                WorkflowCardReview {
                    reviewer_type: to_workflow_wire_value(&review.reviewer_type),
                    verdict: to_workflow_wire_value(&review.verdict),
                    feedback: review.feedback.clone(),
                    review_round: review.review_round,
                    created_at: review.created_at.to_rfc3339(),
                },
            )
        })
        .collect();
    let loop_key_by_step_key = build_loop_key_by_step_key(&plan_json, steps, loops);
    apply_runtime_loop_keys(&mut plan_json, &loop_key_by_step_key);

    let pending_reviews = build_pending_reviews(steps, loops, transcripts);
    let pending_review = pending_reviews.first().cloned();
    let pending_input = build_pending_input(steps, transcripts);

    let step_views = build_workflow_step_summary_views(
        steps,
        &loop_key_by_step_key,
        &latest_review_by_step_id,
        &workflow_agent_name_by_id,
        transcripts,
    );

    let agent_views = session_agents
        .iter()
        .filter_map(|session_agent| {
            let agent = agents
                .iter()
                .find(|agent| agent.id == session_agent.agent_id)?;
            Some(WorkflowCardAgent {
                session_agent_id: session_agent.id.to_string(),
                workflow_agent_session_id: workflow_agent_sessions
                    .iter()
                    .find(|workflow_session| workflow_session.session_agent_id == session_agent.id)
                    .map(|workflow_session| workflow_session.id.to_string()),
                agent_id: agent.id.to_string(),
                name: agent.name.clone(),
            })
        })
        .collect::<Vec<_>>();

    let loop_views = build_workflow_loop_views(loops);
    let iteration_history = build_iteration_history(rounds, steps, iteration_feedbacks);
    let round_graphs = build_round_graphs_summary(
        rounds,
        revision,
        revisions,
        steps,
        loops,
        &latest_review_by_step_id,
        &workflow_agent_name_by_id,
        transcripts,
    )?;

    let result_step = steps
        .iter()
        .find(|step| step.step_type == WorkflowStepType::Result);
    let (result_summary, outputs) = result_step
        .and_then(|step| parse_summary_payload(step.summary_text.as_deref()))
        .map(|payload| (Some(payload.summary), payload.outputs))
        .unwrap_or_else(|| (None, Vec::new()));

    let state = match execution.status {
        WorkflowExecutionStatus::Pending => WorkflowCardState::Pending,
        WorkflowExecutionStatus::Completed => WorkflowCardState::Completed,
        WorkflowExecutionStatus::Failed => WorkflowCardState::Failed,
        WorkflowExecutionStatus::Paused => WorkflowCardState::Paused,
        WorkflowExecutionStatus::Waiting => WorkflowCardState::Waiting,
        WorkflowExecutionStatus::Recompiling => WorkflowCardState::Running,
        _ => WorkflowCardState::Running,
    };

    let is_terminal = matches!(
        execution.status,
        WorkflowExecutionStatus::Completed | WorkflowExecutionStatus::Failed
    );

    let has_transcripts = transcript_count.map(|count| count > 0);

    Ok(WorkflowCardProjection {
        execution_id: Some(execution.id.to_string()),
        plan_id: plan.id.to_string(),
        revision_id: revision.id.to_string(),
        title: plan.title.clone(),
        goal: plan
            .summary_text
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| plan.title.clone()),
        state,
        execution_status: to_workflow_wire_value(&execution.status),
        error_message,
        completed_step_count,
        total_step_count,
        result_summary,
        outputs,
        agents: agent_views,
        steps: step_views,
        current_round: execution.current_round,
        loops: loop_views,
        pending_review,
        pending_reviews,
        pending_input,
        iteration_history,
        round_graphs,
        plan: plan_json,
        started_at: execution.started_at.map(|value| value.to_rfc3339()),
        completed_at: execution.completed_at.map(|value| value.to_rfc3339()),
        validation_errors: None,
        is_terminal,
        has_transcripts,
    })
}

fn build_iteration_history(
    rounds: &[WorkflowRound],
    steps: &[WorkflowStep],
    feedbacks: &[WorkflowIterationFeedback],
) -> Vec<WorkflowIterationSummary> {
    rounds
        .iter()
        .map(|round| {
            let user_feedback = feedbacks
                .iter()
                .find(|feedback| feedback.from_round_id == round.id)
                .and_then(|feedback| {
                    extract_iteration_feedback_summary(&feedback.user_feedback_json)
                });
            let result_summary = steps
                .iter()
                .filter(|step| step.round_id == round.id)
                .find(|step| step.step_type == WorkflowStepType::Result)
                .and_then(|step| parse_summary_payload(step.summary_text.as_deref()))
                .map(|payload| payload.summary)
                .or_else(|| {
                    steps
                        .iter()
                        .filter(|step| step.round_id == round.id)
                        .filter_map(|step| parse_summary_payload(step.summary_text.as_deref()))
                        .next_back()
                        .map(|payload| payload.summary)
                });

            WorkflowIterationSummary {
                round_index: round.round_index,
                status: to_workflow_wire_value(&round.status),
                user_feedback,
                result_summary,
                started_at: round
                    .started_at
                    .map(|value| value.to_rfc3339())
                    .unwrap_or_else(|| round.created_at.to_rfc3339()),
                completed_at: round.completed_at.map(|value| value.to_rfc3339()),
            }
        })
        .collect()
}

fn build_loop_key_by_step_key(
    plan_json: &WorkflowPlanJson,
    steps: &[WorkflowStep],
    loops: &[WorkflowLoop],
) -> HashMap<String, String> {
    let plan_loop_key_by_step_key: HashMap<String, String> = plan_json
        .nodes
        .iter()
        .filter_map(|node| {
            node.data
                .loop_key
                .clone()
                .map(|loop_key| (node.id.clone(), loop_key))
        })
        .collect();
    let loop_key_by_loop_id = loops
        .iter()
        .map(|workflow_loop| (workflow_loop.id, workflow_loop.loop_key.clone()))
        .collect::<HashMap<_, _>>();

    steps
        .iter()
        .filter_map(|step| {
            step.loop_id
                .and_then(|loop_id| loop_key_by_loop_id.get(&loop_id).cloned())
                .or_else(|| plan_loop_key_by_step_key.get(&step.step_key).cloned())
                .map(|loop_key| (step.step_key.clone(), loop_key))
        })
        .collect()
}

fn apply_runtime_loop_keys(
    plan_json: &mut WorkflowPlanJson,
    loop_key_by_step_key: &HashMap<String, String>,
) {
    for node in &mut plan_json.nodes {
        if let Some(loop_key) = loop_key_by_step_key.get(&node.id) {
            node.data.loop_key = Some(loop_key.clone());
        }
    }
}

fn build_workflow_step_views(
    steps: &[WorkflowStep],
    loop_key_by_step_key: &HashMap<String, String>,
    latest_review_by_step_id: &HashMap<Uuid, WorkflowCardReview>,
    workflow_agent_name_by_id: &HashMap<Uuid, String>,
    transcripts: &[WorkflowTranscript],
) -> Vec<WorkflowCardStep> {
    steps
        .iter()
        .map(|step| WorkflowCardStep {
            id: step.id.to_string(),
            step_key: step.step_key.clone(),
            title: step.title.clone(),
            step_type: to_workflow_wire_value(&step.step_type),
            status: to_workflow_wire_value(&step.status),
            review_phase: derive_step_review_phase(step, transcripts),
            lead_review_required: step.lead_review_required,
            user_review_required: step.user_review_required,
            retry_count: step.retry_count,
            max_retry: step.max_retry,
            loop_key: loop_key_by_step_key.get(&step.step_key).cloned(),
            latest_review: latest_review_by_step_id.get(&step.id).cloned(),
            agent_name: step
                .assigned_workflow_agent_session_id
                .and_then(|id| workflow_agent_name_by_id.get(&id))
                .cloned(),
            summary_text: step
                .summary_text
                .clone()
                .and_then(parse_summary_text_preview),
            content: step
                .content
                .clone()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
        })
        .collect()
}

fn build_workflow_step_summary_views(
    steps: &[WorkflowStep],
    loop_key_by_step_key: &HashMap<String, String>,
    latest_review_by_step_id: &HashMap<Uuid, WorkflowCardReview>,
    workflow_agent_name_by_id: &HashMap<Uuid, String>,
    transcripts: &[WorkflowTranscript],
) -> Vec<WorkflowCardStep> {
    steps
        .iter()
        .map(|step| WorkflowCardStep {
            id: step.id.to_string(),
            step_key: step.step_key.clone(),
            title: step.title.clone(),
            step_type: to_workflow_wire_value(&step.step_type),
            status: to_workflow_wire_value(&step.status),
            review_phase: derive_step_review_phase(step, transcripts),
            lead_review_required: step.lead_review_required,
            user_review_required: step.user_review_required,
            retry_count: step.retry_count,
            max_retry: step.max_retry,
            loop_key: loop_key_by_step_key.get(&step.step_key).cloned(),
            latest_review: latest_review_by_step_id.get(&step.id).cloned(),
            agent_name: step
                .assigned_workflow_agent_session_id
                .and_then(|id| workflow_agent_name_by_id.get(&id))
                .cloned(),
            summary_text: step
                .summary_text
                .clone()
                .and_then(parse_summary_text_preview),
            content: None,
        })
        .collect()
}

fn build_workflow_loop_views(loops: &[WorkflowLoop]) -> Vec<WorkflowCardLoop> {
    loops
        .iter()
        .map(|workflow_loop| WorkflowCardLoop {
            id: workflow_loop.id.to_string(),
            loop_key: workflow_loop.loop_key.clone(),
            status: to_workflow_wire_value(&workflow_loop.status),
            retry_count: workflow_loop.retry_count,
            max_retry: workflow_loop.max_retry,
            user_review_required: workflow_loop.user_review_required,
            rejection_reason: workflow_loop.rejection_reason.clone(),
            member_step_ids: serde_json::from_str::<Vec<Uuid>>(&workflow_loop.member_step_ids_json)
                .unwrap_or_default()
                .into_iter()
                .map(|id| id.to_string())
                .collect(),
            review_step_id: workflow_loop.review_step_id.to_string(),
        })
        .collect()
}

fn build_round_graphs(
    rounds: &[WorkflowRound],
    active_revision: &WorkflowPlanRevision,
    revisions: &[WorkflowPlanRevision],
    steps: &[WorkflowStep],
    loops: &[WorkflowLoop],
    latest_review_by_step_id: &HashMap<Uuid, WorkflowCardReview>,
    workflow_agent_name_by_id: &HashMap<Uuid, String>,
    transcripts: &[WorkflowTranscript],
) -> Result<Vec<WorkflowRoundGraph>, WorkflowRuntimeError> {
    let mut revision_by_id = revisions
        .iter()
        .map(|revision| (revision.id, revision))
        .collect::<HashMap<_, _>>();
    revision_by_id.insert(active_revision.id, active_revision);

    if rounds.is_empty() {
        return build_round_graphs_summary_from_steps(
            active_revision,
            &revision_by_id,
            steps,
            loops,
            latest_review_by_step_id,
            workflow_agent_name_by_id,
            transcripts,
        );
    }

    rounds
        .iter()
        .map(|round| {
            let revision = round
                .source_revision_id
                .and_then(|revision_id| revision_by_id.get(&revision_id).copied())
                .unwrap_or(active_revision);
            let round_steps = steps
                .iter()
                .filter(|step| step.round_id == round.id)
                .cloned()
                .collect::<Vec<_>>();
            let round_loops = loops
                .iter()
                .filter(|workflow_loop| workflow_loop.round_id == round.id)
                .cloned()
                .collect::<Vec<_>>();
            let mut round_plan: WorkflowPlanJson = serde_json::from_str(&revision.plan_json)?;
            round_plan.nodes = overlay_step_statuses(&round_plan, &round_steps);
            let loop_key_by_step_key =
                build_loop_key_by_step_key(&round_plan, &round_steps, &round_loops);
            apply_runtime_loop_keys(&mut round_plan, &loop_key_by_step_key);

            Ok(WorkflowRoundGraph {
                round_id: round.id.to_string(),
                round_index: round.round_index,
                revision_id: revision.id.to_string(),
                status: to_workflow_wire_value(&round.status),
                steps: build_workflow_step_views(
                    &round_steps,
                    &loop_key_by_step_key,
                    latest_review_by_step_id,
                    workflow_agent_name_by_id,
                    transcripts,
                ),
                loops: build_workflow_loop_views(&round_loops),
                plan: round_plan,
            })
        })
        .collect()
}

fn build_round_graphs_summary(
    rounds: &[WorkflowRound],
    active_revision: &WorkflowPlanRevision,
    revisions: &[WorkflowPlanRevision],
    steps: &[WorkflowStep],
    loops: &[WorkflowLoop],
    latest_review_by_step_id: &HashMap<Uuid, WorkflowCardReview>,
    workflow_agent_name_by_id: &HashMap<Uuid, String>,
    transcripts: &[WorkflowTranscript],
) -> Result<Vec<WorkflowRoundGraph>, WorkflowRuntimeError> {
    let mut revision_by_id = revisions
        .iter()
        .map(|revision| (revision.id, revision))
        .collect::<HashMap<_, _>>();
    revision_by_id.insert(active_revision.id, active_revision);

    if rounds.is_empty() {
        return build_round_graphs_summary_from_steps(
            active_revision,
            &revision_by_id,
            steps,
            loops,
            latest_review_by_step_id,
            workflow_agent_name_by_id,
            transcripts,
        );
    }

    rounds
        .iter()
        .map(|round| {
            let revision = round
                .source_revision_id
                .and_then(|revision_id| revision_by_id.get(&revision_id).copied())
                .unwrap_or(active_revision);
            let round_steps = steps
                .iter()
                .filter(|step| step.round_id == round.id)
                .cloned()
                .collect::<Vec<_>>();
            let round_loops = loops
                .iter()
                .filter(|workflow_loop| workflow_loop.round_id == round.id)
                .cloned()
                .collect::<Vec<_>>();
            let mut round_plan: WorkflowPlanJson = serde_json::from_str(&revision.plan_json)?;
            round_plan.nodes = overlay_step_statuses(&round_plan, &round_steps);
            let loop_key_by_step_key =
                build_loop_key_by_step_key(&round_plan, &round_steps, &round_loops);
            apply_runtime_loop_keys(&mut round_plan, &loop_key_by_step_key);

            Ok(WorkflowRoundGraph {
                round_id: round.id.to_string(),
                round_index: round.round_index,
                revision_id: revision.id.to_string(),
                status: to_workflow_wire_value(&round.status),
                steps: build_workflow_step_summary_views(
                    &round_steps,
                    &loop_key_by_step_key,
                    latest_review_by_step_id,
                    workflow_agent_name_by_id,
                    transcripts,
                ),
                loops: build_workflow_loop_views(&round_loops),
                plan: round_plan,
            })
        })
        .collect()
}

fn build_round_graphs_summary_from_steps(
    active_revision: &WorkflowPlanRevision,
    revision_by_id: &HashMap<Uuid, &WorkflowPlanRevision>,
    steps: &[WorkflowStep],
    loops: &[WorkflowLoop],
    latest_review_by_step_id: &HashMap<Uuid, WorkflowCardReview>,
    workflow_agent_name_by_id: &HashMap<Uuid, String>,
    transcripts: &[WorkflowTranscript],
) -> Result<Vec<WorkflowRoundGraph>, WorkflowRuntimeError> {
    let mut round_keys = Vec::<(Uuid, i32, Option<Uuid>)>::new();
    for step in steps {
        if round_keys
            .iter()
            .any(|(round_id, _, _)| *round_id == step.round_id)
        {
            continue;
        }
        round_keys.push((step.round_id, step.round_index, step.compiled_revision_id));
    }
    round_keys.sort_by_key(|(_, round_index, _)| *round_index);

    round_keys
        .into_iter()
        .map(|(round_id, round_index, revision_id)| {
            let revision = revision_id
                .and_then(|id| revision_by_id.get(&id).copied())
                .unwrap_or(active_revision);
            let round_steps = steps
                .iter()
                .filter(|step| step.round_id == round_id)
                .cloned()
                .collect::<Vec<_>>();
            let round_loops = loops
                .iter()
                .filter(|workflow_loop| workflow_loop.round_id == round_id)
                .cloned()
                .collect::<Vec<_>>();
            let mut round_plan: WorkflowPlanJson = serde_json::from_str(&revision.plan_json)?;
            round_plan.nodes = overlay_step_statuses(&round_plan, &round_steps);
            let loop_key_by_step_key =
                build_loop_key_by_step_key(&round_plan, &round_steps, &round_loops);
            apply_runtime_loop_keys(&mut round_plan, &loop_key_by_step_key);

            Ok(WorkflowRoundGraph {
                round_id: round_id.to_string(),
                round_index,
                revision_id: revision.id.to_string(),
                status: derive_round_graph_status(&round_steps),
                steps: build_workflow_step_summary_views(
                    &round_steps,
                    &loop_key_by_step_key,
                    latest_review_by_step_id,
                    workflow_agent_name_by_id,
                    transcripts,
                ),
                loops: build_workflow_loop_views(&round_loops),
                plan: round_plan,
            })
        })
        .collect()
}

fn derive_round_graph_status(steps: &[WorkflowStep]) -> String {
    if steps
        .iter()
        .any(|step| step.status == WorkflowStepStatus::Failed)
    {
        return "failed".to_string();
    }
    if steps.iter().any(|step| {
        matches!(
            step.status,
            WorkflowStepStatus::Running | WorkflowStepStatus::Ready
        )
    }) {
        return "running".to_string();
    }
    if !steps.is_empty()
        && steps.iter().all(|step| {
            matches!(
                step.status,
                WorkflowStepStatus::Completed | WorkflowStepStatus::Skipped
            )
        })
    {
        return "completed".to_string();
    }
    "pending".to_string()
}

fn extract_iteration_feedback_summary(user_feedback_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(user_feedback_json).ok()?;
    let feedback = value.get("feedback")?;
    if let Some(text) = feedback.as_str() {
        return Some(text.trim().to_string()).filter(|value| !value.is_empty());
    }
    let what_wrong = feedback
        .get("what_wrong")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim();
    let expected = feedback
        .get("expected")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim();
    let summary = match (what_wrong.is_empty(), expected.is_empty()) {
        (false, false) => format!("{what_wrong}; expected: {expected}"),
        (false, true) => what_wrong.to_string(),
        (true, false) => expected.to_string(),
        (true, true) => String::new(),
    };
    (!summary.is_empty()).then_some(summary)
}

fn derive_step_review_phase(
    step: &WorkflowStep,
    transcripts: &[WorkflowTranscript],
) -> Option<String> {
    match step.status {
        WorkflowStepStatus::Running => Some("worker_running".to_string()),
        WorkflowStepStatus::WaitingReview => Some("lead_review".to_string()),
        WorkflowStepStatus::WaitingInput => transcripts
            .iter()
            .rev()
            .find(|transcript| {
                transcript.step_id == Some(step.id)
                    && transcript.entry_type == "step_review"
                    && !matches!(
                        transcript_meta_value(transcript).get("resolved"),
                        Some(serde_json::Value::Bool(true))
                    )
            })
            .map(|_| "user_review".to_string()),
        WorkflowStepStatus::PreCompleted => Some("pre_completed".to_string()),
        WorkflowStepStatus::Revising => Some("revising".to_string()),
        _ => None,
    }
}

fn build_pending_input(
    steps: &[WorkflowStep],
    transcripts: &[WorkflowTranscript],
) -> Option<WorkflowPendingInput> {
    let transcript = transcripts.iter().rev().find(|transcript| {
        transcript.entry_type == "input_request"
            && !matches!(
                transcript_meta_value(transcript).get("resolved"),
                Some(serde_json::Value::Bool(true))
            )
    })?;
    let step = steps.iter().find(|step| {
        Some(step.id) == transcript.step_id && step.status == WorkflowStepStatus::WaitingInput
    })?;
    let meta = transcript_meta_value(transcript);

    Some(WorkflowPendingInput {
        input_id: transcript.id.to_string(),
        step_id: step.id.to_string(),
        step_key: step.step_key.clone(),
        target_title: step.title.clone(),
        prompt: transcript.content.clone(),
        description: meta
            .get("description")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        placeholder: meta
            .get("placeholder")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    })
}

fn build_pending_reviews(
    steps: &[WorkflowStep],
    loops: &[WorkflowLoop],
    transcripts: &[WorkflowTranscript],
) -> Vec<WorkflowPendingReview> {
    transcripts
        .iter()
        .filter_map(|transcript| build_pending_review_for_transcript(steps, loops, transcript))
        .collect()
}

fn build_pending_review_for_transcript(
    steps: &[WorkflowStep],
    loops: &[WorkflowLoop],
    transcript: &WorkflowTranscript,
) -> Option<WorkflowPendingReview> {
    if !matches!(
        transcript.entry_type.as_str(),
        "step_review" | "loop_review"
    ) || matches!(
        transcript_meta_value(transcript).get("resolved"),
        Some(serde_json::Value::Bool(true))
    ) {
        return None;
    }

    let step = steps
        .iter()
        .find(|step| Some(step.id) == transcript.step_id)?;
    let meta = transcript_meta_value(transcript);
    let context_summary = meta
        .get("summary")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| parse_summary_text_preview(step.summary_text.clone().unwrap_or_default()))
        .unwrap_or_else(|| transcript.content.clone());

    let meta = transcript_meta_value(transcript);
    let loop_target = if transcript.entry_type == "loop_review" {
        meta.get("loop_id")
            .and_then(|value| value.as_str())
            .and_then(|id| Uuid::parse_str(id).ok())
            .and_then(|id| loops.iter().find(|workflow_loop| workflow_loop.id == id))
    } else {
        None
    };
    let review_type = if transcript.entry_type == "loop_review" {
        "loop_user_review"
    } else {
        "step_user_review"
    };
    let target_id = loop_target
        .map(|workflow_loop| workflow_loop.id.to_string())
        .unwrap_or_else(|| step.id.to_string());
    let target_title = loop_target
        .map(|workflow_loop| workflow_loop.loop_key.clone())
        .unwrap_or_else(|| step.title.clone());

    Some(WorkflowPendingReview {
        review_id: transcript.id.to_string(),
        review_type: review_type.to_string(),
        target_id,
        target_title,
        context_summary,
        prompt_template: WorkflowReviewPromptTemplate {
            message: transcript.content.clone(),
            fields: vec![WorkflowReviewField {
                key: "feedback".to_string(),
                label: "修改意见".to_string(),
                field_type: "textarea".to_string(),
                required: false,
                placeholder: Some("如果需要修改，请填写具体意见".to_string()),
                options: None,
            }],
            actions: vec![
                WorkflowReviewAction {
                    action: "approve".to_string(),
                    label: "通过".to_string(),
                    style: "primary".to_string(),
                    requires_feedback: false,
                },
                WorkflowReviewAction {
                    action: "reject".to_string(),
                    label: "打回修改".to_string(),
                    style: "danger".to_string(),
                    requires_feedback: true,
                },
            ],
        },
    })
}

fn parse_summary_text_preview(summary_text: String) -> Option<String> {
    if let Ok(payload) = serde_json::from_str::<SummaryPayload>(&summary_text) {
        return Some(payload.summary);
    }

    let trimmed = summary_text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}
