async fn persist_workflow_runtime_transcript_line(
    pool: &SqlitePool,
    execution_id: Uuid,
    workflow_agent_session_id: Option<Uuid>,
    step_id: Uuid,
    content: &str,
) -> Result<WorkflowTranscript, sqlx::Error> {
    WorkflowTranscript::create(
        pool,
        &CreateWorkflowTranscript {
            execution_id,
            round_id: None,
            workflow_agent_session_id,
            step_id: Some(step_id),
            sender_type: "agent".to_string(),
            entry_type: "thinking".to_string(),
            content: content.to_string(),
            meta_json: Some(
                serde_json::json!({
                    "source": "workflow_runtime_stream",
                })
                .to_string(),
            ),
        },
        Uuid::new_v4(),
    )
    .await
}

fn extract_workflow_thinking_lines_from_history(history: &[LogMsg]) -> Vec<String> {
    let mut state = WorkflowRuntimeStreamState::default();
    let mut thinking_lines = Vec::new();

    for message in history {
        let LogMsg::JsonPatch(patch) = message else {
            continue;
        };

        for (stream_type, line) in state.drain_patch_lines(patch) {
            if matches!(stream_type, ChatStreamDeltaType::Thinking) {
                thinking_lines.push(line);
            }
        }
    }

    for (stream_type, line) in state.flush_pending_lines() {
        if matches!(stream_type, ChatStreamDeltaType::Thinking) {
            thinking_lines.push(line);
        }
    }

    thinking_lines
}

async fn persist_missing_workflow_runtime_thinking_transcripts(
    pool: &SqlitePool,
    execution_id: Uuid,
    workflow_agent_session_id: Option<Uuid>,
    step_id: Uuid,
    history: &[LogMsg],
) -> Result<(), WorkflowRuntimeError> {
    let thinking_lines = extract_workflow_thinking_lines_from_history(history);
    if thinking_lines.is_empty() {
        return Ok(());
    }

    let has_persisted_thinking = WorkflowTranscript::find_by_step(pool, step_id)
        .await?
        .into_iter()
        .any(|entry| {
            entry.workflow_agent_session_id == workflow_agent_session_id
                && entry.sender_type == "agent"
                && entry.entry_type == "thinking"
        });
    if has_persisted_thinking {
        return Ok(());
    }

    for line in thinking_lines {
        persist_workflow_runtime_transcript_line(
            pool,
            execution_id,
            workflow_agent_session_id,
            step_id,
            &line,
        )
        .await?;
    }

    Ok(())
}

pub fn overlay_step_statuses(
    plan: &WorkflowPlanJson,
    steps: &[WorkflowStep],
) -> Vec<WorkflowPlanNode> {
    let step_by_key: HashMap<&str, &WorkflowStep> = steps
        .iter()
        .map(|step| (step.step_key.as_str(), step))
        .collect();

    plan.nodes
        .iter()
        .cloned()
        .map(|mut node| {
            if let Some(step) = step_by_key.get(node.id.as_str()) {
                node.data.status = Some(to_workflow_wire_value(&step.status));
            }
            node
        })
        .collect()
}

pub fn predecessor_summaries(
    step: &WorkflowStep,
    steps: &[WorkflowStep],
    edges: &[WorkflowStepEdge],
    plan: Option<&WorkflowPlan>,
) -> Vec<String> {
    match step.step_type {
        WorkflowStepType::Task => direct_predecessor_contexts(step, steps, edges),
        WorkflowStepType::Review => review_dependency_contexts(step, steps, edges),
        WorkflowStepType::Result => result_dependency_contexts(step, steps, edges, plan),
    }
}

fn direct_predecessor_contexts(
    step: &WorkflowStep,
    steps: &[WorkflowStep],
    edges: &[WorkflowStepEdge],
) -> Vec<String> {
    direct_predecessor_steps(step, steps, edges)
        .into_iter()
        .map(|source_step| format_step_dependency_context("Dependency Node", source_step))
        .collect()
}

fn review_dependency_contexts(
    step: &WorkflowStep,
    steps: &[WorkflowStep],
    edges: &[WorkflowStepEdge],
) -> Vec<String> {
    let mut reviewed_steps = step
        .loop_id
        .map(|loop_id| {
            let mut members = steps
                .iter()
                .filter(|candidate| {
                    candidate.id != step.id
                        && candidate.loop_id == Some(loop_id)
                        && candidate.step_type == WorkflowStepType::Task
                })
                .collect::<Vec<_>>();
            members.sort_by_key(|candidate| candidate.display_order);
            members
        })
        .unwrap_or_default();

    if reviewed_steps.is_empty() {
        reviewed_steps = direct_predecessor_steps(step, steps, edges);
    }

    reviewed_steps
        .into_iter()
        .map(|source_step| format_step_dependency_context("Reviewed Loop Node", source_step))
        .collect()
}

fn result_dependency_contexts(
    step: &WorkflowStep,
    steps: &[WorkflowStep],
    edges: &[WorkflowStepEdge],
    plan: Option<&WorkflowPlan>,
) -> Vec<String> {
    let mut contexts = Vec::new();
    let predecessor_steps = transitive_predecessor_steps(step, steps, edges);

    if !predecessor_steps.is_empty() {
        contexts.push(format!(
            "## Result Dependency: Formal Predecessor Results\n\n{}",
            predecessor_steps
                .iter()
                .map(|source_step| {
                    format_step_dependency_context("Formal Predecessor Result", source_step)
                })
                .collect::<Vec<_>>()
                .join("\n\n")
        ));
    }

    if let Some(plan) = plan {
        contexts.push(format!(
            "## Result Dependency: Full Workflow Plan JSON\n\n```json\n{}\n```",
            pretty_workflow_plan_json(&plan.plan_json)
        ));
    }

    contexts
}

pub fn predecessor_summaries_with_reviews(
    step: &WorkflowStep,
    steps: &[WorkflowStep],
    edges: &[WorkflowStepEdge],
    plan: Option<&WorkflowPlan>,
    reviews: &[WorkflowStepReview],
) -> Vec<String> {
    let mut contexts = predecessor_summaries(step, steps, edges, plan);
    if step.step_type == WorkflowStepType::Result {
        let predecessor_steps = transitive_predecessor_steps(step, steps, edges);
        let reviewer_context = format_result_reviewer_conclusions(&predecessor_steps, reviews);
        if !reviewer_context.is_empty() {
            contexts.insert(1.min(contexts.len()), reviewer_context);
        }
    }
    contexts
}

fn transitive_predecessor_steps<'a>(
    step: &WorkflowStep,
    steps: &'a [WorkflowStep],
    edges: &[WorkflowStepEdge],
) -> Vec<&'a WorkflowStep> {
    let step_by_id: HashMap<Uuid, &WorkflowStep> = steps
        .iter()
        .map(|candidate| (candidate.id, candidate))
        .collect();
    let mut predecessor_ids_by_target: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for edge in edges {
        predecessor_ids_by_target
            .entry(edge.to_step_id)
            .or_default()
            .push(edge.from_step_id);
    }

    let mut seen = HashSet::new();
    let mut stack = predecessor_ids_by_target
        .get(&step.id)
        .cloned()
        .unwrap_or_default();
    while let Some(step_id) = stack.pop() {
        if !seen.insert(step_id) {
            continue;
        }
        if let Some(parents) = predecessor_ids_by_target.get(&step_id) {
            stack.extend(parents.iter().copied());
        }
    }

    let mut predecessor_steps = seen
        .into_iter()
        .filter_map(|step_id| step_by_id.get(&step_id).copied())
        .filter(|candidate| candidate.id != step.id)
        .collect::<Vec<_>>();
    predecessor_steps.sort_by_key(|candidate| candidate.display_order);
    predecessor_steps
}

fn format_result_reviewer_conclusions(
    predecessor_steps: &[&WorkflowStep],
    reviews: &[WorkflowStepReview],
) -> String {
    if predecessor_steps.is_empty() {
        return String::new();
    }

    let predecessor_ids = predecessor_steps
        .iter()
        .map(|step| step.id)
        .collect::<HashSet<_>>();
    let step_title_by_id = predecessor_steps
        .iter()
        .map(|step| (step.id, step.title.as_str()))
        .collect::<HashMap<_, _>>();
    let mut matching_reviews = reviews
        .iter()
        .filter(|review| predecessor_ids.contains(&review.step_id))
        .collect::<Vec<_>>();
    matching_reviews.sort_by_key(|review| {
        (
            step_title_by_id.get(&review.step_id).copied().unwrap_or(""),
            review.review_round,
            review.created_at,
        )
    });

    if matching_reviews.is_empty() {
        return "## Result Dependency: Reviewer Conclusions\n\nNo explicit reviewer approval or rejection was recorded for predecessor nodes.".to_string();
    }

    let lines = matching_reviews
        .into_iter()
        .map(|review| {
            let step_title = step_title_by_id
                .get(&review.step_id)
                .copied()
                .unwrap_or("Unknown step");
            let verdict = match review.verdict {
                ReviewVerdict::Approved => "approved",
                ReviewVerdict::Rejected => "rejected",
            };
            let reviewer = to_workflow_wire_value(&review.reviewer_type);
            let feedback = review.feedback.trim();
            if feedback.is_empty() {
                format!(
                    "- {step_title}: {reviewer} reviewer {verdict} in review round {}.",
                    review.review_round
                )
            } else {
                format!(
                    "- {step_title}: {reviewer} reviewer {verdict} in review round {}. Feedback: {feedback}",
                    review.review_round
                )
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!("## Result Dependency: Reviewer Conclusions\n\n{lines}")
}

fn direct_predecessor_steps<'a>(
    step: &WorkflowStep,
    steps: &'a [WorkflowStep],
    edges: &[WorkflowStepEdge],
) -> Vec<&'a WorkflowStep> {
    let step_by_id: HashMap<Uuid, &WorkflowStep> = steps
        .iter()
        .map(|candidate| (candidate.id, candidate))
        .collect();
    let mut seen = HashSet::new();

    edges
        .iter()
        .filter(|edge| edge.to_step_id == step.id)
        .filter_map(|edge| {
            if seen.insert(edge.from_step_id) {
                step_by_id.get(&edge.from_step_id).copied()
            } else {
                None
            }
        })
        .collect()
}

fn format_step_dependency_context(label: &str, step: &WorkflowStep) -> String {
    let payload = parse_summary_payload(step.summary_text.as_deref());
    let summary = payload
        .as_ref()
        .map(|payload| payload.summary.trim())
        .filter(|summary| !summary.is_empty())
        .unwrap_or("None");
    let content = payload
        .as_ref()
        .and_then(|payload| {
            let content = payload.content.as_deref()?.trim();
            (!content.is_empty()).then_some(content)
        })
        .unwrap_or("None");
    let outputs = payload
        .as_ref()
        .map(|payload| {
            if payload.outputs.is_empty() {
                "None".to_string()
            } else {
                payload
                    .outputs
                    .iter()
                    .map(|output| format!("- {output}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        })
        .unwrap_or_else(|| "None".to_string());

    format!(
        r#"## {label}: {title}

- Step key: {step_key}
- Type: {step_type}
<Instructions>
{instructions}
</Instructions>

<Summary>
{summary}
</Summary>

<Content>
{content}
</Content>

<Outputs>
{outputs}
</Outputs>
"#,
        label = label,
        title = step.title,
        step_key = step.step_key,
        step_type = to_workflow_wire_value(&step.step_type),
        instructions = step.instructions,
        summary = summary,
        content = content,
        outputs = outputs,
    )
}

fn pretty_workflow_plan_json(plan_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(plan_json)
        .and_then(|value| serde_json::to_string_pretty(&value))
        .unwrap_or_else(|_| plan_json.to_string())
}

pub fn parse_summary_payload(summary_text: Option<&str>) -> Option<SummaryPayload> {
    let summary_text = summary_text?.trim();
    if summary_text.is_empty() {
        return None;
    }

    serde_json::from_str::<SummaryPayload>(summary_text)
        .ok()
        .or_else(|| {
            Some(SummaryPayload {
                summary: summary_text.to_string(),
                content: None,
                outputs: Vec::new(),
            })
        })
}

fn transcript_meta_value(transcript: &WorkflowTranscript) -> serde_json::Value {
    transcript
        .meta_json
        .as_deref()
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}
