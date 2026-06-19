pub fn summarize_round_results(
    round: &WorkflowRound,
    steps: &[WorkflowStep],
) -> IterationRoundSummary {
    let mut outputs = Vec::new();
    let mut step_summaries = Vec::new();
    let mut result_summary = None;

    for step in steps.iter().filter(|step| step.round_id == round.id) {
        let payload =
            parse_summary_payload(step.summary_text.as_deref()).unwrap_or(SummaryPayload {
                summary: step
                    .summary_text
                    .clone()
                    .unwrap_or_else(|| step.title.clone()),
                content: step.content.clone(),
                outputs: Vec::new(),
            });
        outputs.extend(payload.outputs.clone());
        if step.step_type == db::models::workflow_types::WorkflowStepType::Result {
            result_summary = Some(payload.summary.clone());
        }
        step_summaries.push(format!(
            "- [{}] {}: {:?} - {}",
            step.step_key, step.title, step.status, payload.summary
        ));
    }

    IterationRoundSummary {
        round_index: round.round_index,
        status: format!("{:?}", round.status).to_lowercase(),
        result_summary,
        outputs,
        step_summaries,
    }
}

fn summary_text(summary: &IterationRoundSummary) -> String {
    format!(
        "Round {} status: {}\nResult: {}\nSteps:\n{}\nOutputs: {}",
        summary.round_index,
        summary.status,
        summary
            .result_summary
            .clone()
            .unwrap_or_else(|| "None".to_string()),
        summary.step_summaries.join("\n"),
        if summary.outputs.is_empty() {
            "None".to_string()
        } else {
            summary.outputs.join(", ")
        }
    )
}

fn plan_diff_summary(previous: &WorkflowPlanRevision, next: &WorkflowPlanRevision) -> String {
    format!(
        "revision {} -> {}; hash {} -> {}",
        previous.revision_no, next.revision_no, previous.plan_hash, next.plan_hash
    )
}
