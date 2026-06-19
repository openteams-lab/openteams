pub fn build_iteration_plan_prompt(
    original_goal: &str,
    current_state_summary: &str,
    user_feedback_json: &str,
    iteration_round: i32,
    history: &[WorkflowIterationFeedback],
    lead_agent_id: &str,
    available_agents: &[WorkflowCardAgent],
    _previous_plan: &WorkflowPlanJson,
    response_language_instruction: &str,
) -> String {
    let history_text = if history.is_empty() {
        "None".to_string()
    } else {
        history
            .iter()
            .map(|item| {
                format!(
                    "- feedback_id={} from_round={} to_round={:?}: {}",
                    item.id, item.from_round_id, item.to_round_id, item.user_feedback_json
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let available_agents_json =
        serde_json::to_string_pretty(available_agents).unwrap_or_else(|_| "[]".to_string());
    let feedback_text = format_iteration_feedback(user_feedback_json);

    let plan_schema_definition = r#"{
  "version": "1",
  "title": "string",
  "goal": "string",
  "agents": {
    "lead": "string",
    "available": ["string"]
  },
  "globals": {
    "interrupt_mode": "cooperative",
    "default_retry": 1,
    "global_pause_supported": true
  },
  "nodes": [
    {
      "id": "unique_step_key",
      "type": "workflowStep",
      "data": {
        "stepType": "task | review | result",
        "agentId": "optional string",
        "title": "string",
        "instructions": "string",
        "acceptance": ["optional string"],
        "outputs": ["optional string"],
        "interruptible": true,
        "status": "optional string",
        "reviewScope": ["optional node_id list, review nodes only"]
      }
    }
  ],
  "edges": [
    {
      "id": "unique_edge_id",
      "source": "node_id",
      "target": "node_id",
      "type": "optional string",
      "data": {
        "kind": "hard | soft"
      }
    }
  ],
  "policies": {
    "approval_required_on": ["optional string"],
    "permission_required_on": ["optional string"],
    "on_failure": "optional string",
    "allow_plan_revision": true
  }
}"#;

    let next_round = iteration_round + 1;

    let mut prompt = String::new();
    prompt.push_str(&format!(
        r#"# Workflow Plan Generation

You are generating an executable workflow plan from a confirmed implementation brief.
This generation is for workflow iteration round {next_round}: the previous workflow round completed but the user rejected the result.
The output source of truth is React Flow compatible workflow JSON. Do not output Markdown, YAML, comments, explanations, or prose outside the JSON object.

## Stable Output Contract

Return exactly one workflow plan JSON object.

Hard requirements:
1. Top-level structure must match the WorkflowPlanJson schema and include at least `version`, `title`, `goal`, `agents`, `nodes`, and `edges`.
2. `version` must be the string `"1"`.
3. Every `nodes[].type` must be `"workflowStep"`.
4. `nodes[].data.stepType` may only be `"task"`, `"review"`, or `"result"`.
5. There must be exactly one `result` node, and that result node must have no outgoing edges.
6. All node ids, edge ids, and step keys must be unique.
7. The graph must be a directed acyclic graph. Dependencies must be represented only through `edges`.
8. `agents.lead`, `agents.available`, and `nodes[].data.agentId` may only use the provided agent ids.
9. Leave `nodes[].data.agentId` empty or omit it only when a step does not need a specific agent. Never invent agent ids.
10. Node `title` and `instructions` must be concrete, actionable, and specific enough for an agent to execute.
11. Prefer the smallest executable closed loop that can satisfy the goal. Avoid unnecessary step expansion.
12. Use `stepType: "review"` when execution-review-revision iteration is needed.
13. A review node with a non-empty `reviewScope` creates a retry loop. `reviewScope` is the list of **task** node ids to re-run on rejection. All listed tasks must be upstream predecessors; include any intermediate tasks between a scoped task and the review. Each task may appear in at most one `reviewScope`. Never include result/review/unknown ids or downstream nodes.
14. Do not output or infer `leadReview` or `userReview`. The system writes those fields from frontend card selections.
15. Retry counts are not controlled by the plan JSON.
16. Your output is validated, compiled, and may start execution directly. Schema errors, cyclic dependencies, invalid agent references, invalid `agents.available`, or missing result nodes will fail this generation.

## WorkflowPlanJson Schema Reference

"#
    ));
    prompt.push_str(plan_schema_definition);
    prompt.push_str(
        r#"

## Additional Static Constraints

- `version` must be string `"1"`.
- `agents.available` and `nodes[].data.agentId` may only use the provided `agent_id` values.
- `globals`, `policies`, and optional node/edge fields may be omitted when unnecessary.
- `reviewScope` rules: task-only ids, upstream predecessors only, include intermediates, each task in at most one scope, no result/review/unknown/downstream ids. If two loops need similar work, split into separate tasks or keep shared setup outside `reviewScope`.

## Recommended Skills
- For tasks that include coding, please ensure you utilize the `writing-plans` skill.
- For `task` nodes that include coding, add an explicit instruction to use the `code-guidelines` skill before editing code.
- For general non-coding tasks, use the planning-mode skill.
- In case of any discrepancy with the skill's format, the specified JSON schema shall prevail.
- Store the generated plan details in the nodes[].data.instructions field of the workflow plan JSON, using Markdown format.

## Dynamic Inputs

"#,
    );

    prompt.push_str("Response language requirement:\n");
    prompt.push_str(response_language_instruction.trim());
    prompt.push_str("\n\nPlan goal brief:\n");
    prompt.push_str(original_goal.trim());
    prompt.push_str("\n\nLead agent id:\n");
    prompt.push_str(lead_agent_id);
    prompt.push_str("\n\nAvailable agents JSON:\n");
    prompt.push_str(&available_agents_json);

    prompt.push_str("\n\n## Iteration Context\n\n");
    prompt.push_str(&format!(
        "Iteration request: user rejected the previous round and requested a revised plan for round {next_round}. Preserve correct work; change only what the feedback requires.\n"
    ));
    prompt.push_str("\n### Previous Round State\n");
    prompt.push_str(current_state_summary.trim());
    prompt.push_str("\n\n### User Feedback (reason for rejection)\n");
    prompt.push_str(&feedback_text);
    prompt.push_str("\n\n### Iteration History\n");
    prompt.push_str(&history_text);

    prompt.push_str("\n\nFinal instruction: return the workflow plan JSON object only.");
    prompt
}

fn format_iteration_feedback(user_feedback_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(user_feedback_json) else {
        return user_feedback_json.trim().to_string();
    };
    let Some(feedback) = value.get("feedback").and_then(|item| item.as_object()) else {
        return serde_json::to_string_pretty(&value)
            .unwrap_or_else(|_| user_feedback_json.trim().to_string());
    };

    let mut lines = Vec::new();
    for key in ["what_wrong", "expected", "priority", "additional_notes"] {
        if let Some(text) = feedback.get(key).and_then(|item| item.as_str())
            && !text.trim().is_empty()
        {
            lines.push(format!("- {key}: {}", text.trim()));
        }
    }

    if lines.is_empty() {
        serde_json::to_string_pretty(&value)
            .unwrap_or_else(|_| user_feedback_json.trim().to_string())
    } else {
        lines.join("\n")
    }
}
