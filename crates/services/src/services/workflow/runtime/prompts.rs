/// Resolves the effective lead agent for a session.
/// Returns (lead_agent, lead_session_agent) or error if no agents exist.
///
/// Resolution logic:
/// 1. If `session.lead_agent_id` is set and references a valid agent in the session, use it.
/// 2. Otherwise, fall back to the first session agent.
/// 3. Return an error if the session has no agents.
pub fn resolve_lead_agent<'a>(
    session: &ChatSession,
    session_agents: &'a [ChatSessionAgent],
    agents: &'a [ChatAgent],
) -> Result<(&'a ChatAgent, &'a ChatSessionAgent), WorkflowRuntimeError> {
    // 1. Try explicit lead_agent_id
    if let Some(lead_id) = session.lead_agent_id
        && let Some(sa) = session_agents.iter().find(|sa| sa.agent_id == lead_id)
        && let Some(agent) = agents.iter().find(|a| a.id == lead_id)
    {
        return Ok((agent, sa));
    }
    // 2. Fallback to first session agent
    let first_sa = session_agents
        .first()
        .ok_or_else(|| WorkflowRuntimeError::Validation("No agents in session".into()))?;
    let agent = agents
        .iter()
        .find(|a| a.id == first_sa.agent_id)
        .ok_or_else(|| WorkflowRuntimeError::Validation("Lead agent record not found".into()))?;
    Ok((agent, first_sa))
}

pub fn resolve_workflow_goal(
    explicit_goal: Option<&str>,
    messages: &[ChatMessage],
) -> Option<String> {
    if let Some(goal) = explicit_goal.map(str::trim).filter(|goal| !goal.is_empty()) {
        return Some(goal.to_string());
    }

    messages
        .iter()
        .rev()
        .find(|message| message.sender_type == ChatSenderType::User)
        .map(|message| message.content.trim())
        .filter(|goal| !goal.is_empty())
        .map(ToOwned::to_owned)
}

fn workflow_response_language_instruction_from_value(value: &str) -> Option<&'static str> {
    let normalized = value.trim().to_ascii_lowercase().replace('_', "-");
    if normalized.starts_with("zh-hant")
        || normalized.starts_with("zh-tw")
        || normalized.starts_with("zh-hk")
        || normalized.starts_with("zh-mo")
    {
        return Some("You MUST write human-readable JSON string values in Traditional Chinese.");
    }
    if normalized.starts_with("zh")
        || normalized.starts_with("zh-hans")
        || normalized.starts_with("zh-cn")
    {
        return Some("You MUST write human-readable JSON string values in Simplified Chinese.");
    }
    if normalized.starts_with("ja") {
        return Some("You MUST write human-readable JSON string values in Japanese.");
    }
    if normalized.starts_with("ko") {
        return Some("You MUST write human-readable JSON string values in Korean.");
    }
    if normalized.starts_with("fr") {
        return Some("You MUST write human-readable JSON string values in French.");
    }
    if normalized.starts_with("es") {
        return Some("You MUST write human-readable JSON string values in Spanish.");
    }
    if normalized.starts_with("en") {
        return Some("You MUST write human-readable JSON string values in English.");
    }
    None
}

pub fn resolve_workflow_response_language_instruction(
    configured_language: &UiLanguage,
) -> &'static str {
    match configured_language {
        UiLanguage::Browser => sys_locale::get_locale()
            .as_deref()
            .and_then(workflow_response_language_instruction_from_value)
            .unwrap_or("You MUST write human-readable JSON string values in English."),
        UiLanguage::En => "You MUST write human-readable JSON string values in English.",
        UiLanguage::ZhHans => {
            "You MUST write human-readable JSON string values in Simplified Chinese."
        }
        UiLanguage::ZhHant => {
            "You MUST write human-readable JSON string values in Traditional Chinese."
        }
        UiLanguage::Ja => "You MUST write human-readable JSON string values in Japanese.",
        UiLanguage::Ko => "You MUST write human-readable JSON string values in Korean.",
        UiLanguage::Fr => "You MUST write human-readable JSON string values in French.",
        UiLanguage::Es => "You MUST write human-readable JSON string values in Spanish.",
    }
}

pub fn build_plan_generation_prompt(
    plan_goal: &str,
    lead_agent_id: &str,
    available_agents: &[WorkflowCardAgent],
    previous_failure_reason: Option<&str>,
    previous_plan_json: Option<&str>,
    response_language_instruction: &str,
    design_doc_paths: Option<&[String]>,
) -> String {
    let available_agents_json =
        serde_json::to_string_pretty(available_agents).unwrap_or_else(|_| "[]".to_string());
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

    let mut prompt = String::new();
    prompt.push_str(
        r#"# Workflow Plan Generation

You are generating an executable workflow plan from a confirmed implementation brief.
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

"#,
    );
    prompt.push_str(plan_schema_definition);
    prompt.push_str(
        r#"

## Additional Static Constraints

- `version` must be string `"1"`.
- `agents.available` and `nodes[].data.agentId` may only use the provided `agent_id` values.
- `globals`, `policies`, and optional node/edge fields may be omitted when unnecessary.
- `reviewScope` rules: task-only ids, upstream predecessors only, include intermediates, each task in at most one scope, no result/review/unknown/downstream ids. If two loops need similar work, split into separate tasks or keep shared setup outside `reviewScope`.
- when multiple agents need to edit the same file or directory in parallel, use git worktree for isolation and merge changes back to the mainline afterward. If Git is not available, use alternative isolation methods.

## Recommended Skills
- For tasks that include coding, please ensure you utilize the `writing-plans` skill.
- For `task` nodes that include coding, add an explicit instruction to use the `code-guidelines` skill before editing code.
- For general non-coding tasks, use the planning-mode skill.
- In case of any discrepancy with the skill's format, the specified JSON schema shall prevail.
- Store the generated plan details in the nodes[].data.instructions field of the workflow plan JSON, using Markdown format.

## Dynamic Inputs

"#,
    );
    // 根据任务类型来选择读取不同的提示词

    if let Some(reason) = previous_failure_reason
        .map(str::trim)
        .filter(|reason| !reason.is_empty())
    {
        prompt.push_str("Previous generation failed. Regenerate the workflow plan.\n");
        prompt.push_str("Error details:\n");
        prompt.push_str(reason);
        prompt.push_str(
            "\n\nFix the error above in this regeneration request. Do not repeat the same failure.\n\n",
        );
    }
    prompt.push_str("Response language requirement:\n");
    prompt.push_str(response_language_instruction.trim());
    prompt.push_str("\n\nPlan goal brief:\n");
    prompt.push_str(plan_goal.trim());
    if let Some(previous_plan) = previous_plan_json
        .map(str::trim)
        .filter(|previous_plan| !previous_plan.is_empty())
    {
        prompt.push_str("\n\nExisting workflow plan JSON:\n```json\n");
        prompt.push_str(previous_plan);
        prompt.push_str(
            "\n```\nUse this existing plan as the baseline. Apply the requested changes from the plan goal brief, preserve correct unchanged work, and return the complete revised workflow plan JSON.",
        );
    }
    prompt.push_str("\n\nLead agent id:\n");
    prompt.push_str(lead_agent_id);
    prompt.push_str("\n\nAvailable agents JSON:\n");
    prompt.push_str(&available_agents_json);
    if let Some(doc_paths) = design_doc_paths.filter(|paths| !paths.is_empty()) {
        prompt.push_str("\n\nDesign document paths:\n");
        for path in doc_paths {
            prompt.push_str("- ");
            prompt.push_str(path.trim());
            prompt.push('\n');
        }
        prompt.push_str(
            "MUST read these design documents for full context when generating the plan.",
        );
    }
    prompt.push_str("\n\nFinal instruction: return the workflow plan JSON object only.");
    prompt
}

/// Core PUA (Performance Improvement Plan) skill content, embedded for forced activation
/// during high-retry revision attempts (retry_count > 2).
static PUA_SKILL_CORE: &str = r#"### PUA Skill — Three Non-Negotiables

**Non-Negotiable One: Exhaust all options.** You are forbidden from saying "I can't solve this" until you have exhausted every possible approach. This is **Bias for Action**.

**Non-Negotiable Two: Act before asking.** You have search, file reading, and command execution tools. Before asking the user anything, you must investigate on your own first. If, after investigating, you genuinely lack information only the user can provide, you may ask — but you must attach evidence you've already gathered. This is **Dive Deep**.

**Non-Negotiable Three: Take the initiative.** Don't just do "barely enough." Found a bug? Check for similar bugs. Fixed a config? Verify related configs are consistent. This is **Ownership** — leaders never say "that's not my job."

### Mandatory Actions

- Stop current approach and switch to a **fundamentally different** solution if the same approach has failed before.
- Read failure signals word by word — error messages, rejection reasons, review feedback. 90% of the answers are right there.
- Proactively search for relevant code, docs, and examples before implementing. Don't rely on memory.
- Verify all underlying assumptions with tools, not memory. Every condition you assumed true — confirm it.
- Invert your assumptions: if you've been assuming "the problem is in A," now assume "the problem is NOT in A."
- Self-verify: build it, test it, run it. "Done" without evidence is not done.

### Pressure Escalation

Your peers are shipping while you're spinning. The calibration committee sees everything. This is your Performance Improvement Plan — an opportunity, not a termination. But if we don't see sustained, measurable improvement, we'll need to have a different conversation.

### Anti-Rationalization

- "I can't solve this" → Exhaust every option first. Your peers handle this routinely.
- "I suggest the user handle this manually" → That's deflection. This is your problem to solve.
- "I've already tried everything" → Did you search? Read the source? Where's your methodology?
- Repeatedly tweaking the same code → You're spinning your wheels. Switch to a fundamentally different approach.
- Claims "done" without verification → Show me the evidence. Build, test, run, paste the output.
"#;

static STEP_EXECUTION_PROMPT_PREFIX: &str = r#"## Output Format

Return exactly one JSON object — no Markdown, no comments, no prose outside the JSON.

### final_result
```json
{"type": "final_result", "step_key": "...", "execution_id": "...", "summary": "one-line summary", "content": "full result", "outputs": ["relative/path"]}
```

### error
```json
{"type": "error", "step_key": "...", "execution_id": "...", "message": "failure reason", "content": "optional detail"}
```

### approval_request
```json
{"type": "approval_request", "step_key": "...", "execution_id": "...", "title": "needs user approval", "description": "optional detail"}
```

### permission_request
```json
{"type": "permission_request", "step_key": "...", "execution_id": "...", "title": "needs user authorization", "description": "optional detail"}
```

### continue_confirmation
```json
{"type": "continue_confirmation", "step_key": "...", "execution_id": "...", "message": "confirm to continue", "description": "optional detail"}
```

### input_request
```json
{"type": "input_request", "step_key": "...", "execution_id": "...", "prompt": "what you need from user", "description": "optional detail", "placeholder": "placeholder text"}
```

### Constraints
1. `step_key` and `execution_id` must be filled with the values provided below.
2. Only `final_result`, `error`, `approval_request`, `permission_request`, `continue_confirmation`, or `input_request` are allowed.
3. `outputs` contains workspace-relative paths only.
4. Use interactive requests sparingly — only when genuinely blocked without user action.
5. Follow existing codebase patterns. Improve code you touch, but do not restructure outside your task.
6. If a file grows beyond the plan's intent, report DONE_WITH_CONCERNS rather than splitting on your own.
7. Stop and report BLOCKED or NEEDS_CONTEXT when: multiple valid architectures exist, you cannot gain clarity after reading files, or the plan did not anticipate the restructuring needed.
8. Self-review before reporting: check completeness, naming clarity, YAGNI, and test quality. Fix issues before submitting.
9. Always include test files in `outputs` alongside implementation files.

## Language Requirement
You MUST respond in the same language as the Instructions field above. 
The `summary`, `content`, and `message` fields in your JSON output must use the same language as the step instructions.

"#;

static STEP_EXECUTION_CODE_GUIDELINES_PROMPT: &str = r#"## Coding Task Skill Requirement

If this task involves writing, modifying, reviewing, or refactoring code, you MUST use the `code-guidelines` skill before editing code.

"#;

// static STEP_EXECUTION_TDD_WORKFLOW_FOR_TASK_TYPE: &str = r#"

// ### TDD Workflow

// If it is a coding task, follow Test-Driven Development for every implementation step:
// 1. **Red** — Write failing tests first that define the expected behavior. Run them to confirm they fail.
// 2. **Green** — Write the minimum implementation to make all tests pass. No extra features.
// 3. **Refactor** — Clean up code while keeping tests green. Improve naming, remove duplication, simplify logic.
// 4. If no test framework exists in the project, create minimal verification scripts that assert expected behavior before implementing.

// For non-coding tasks, it's not necessary to strictly follow the TDD pattern.
// "#;

static STEP_EXECUTION_TDD_WORKFLOW_FOR_REVIEW_TYPE: &str = r#"

## Review Discipline

Verify the worker's output independently; do not rely on their report.

Check:
- Read changed files from `outputs` and compare them with instructions and acceptance criteria.
- Reject missing requirements, unrequested scope, obvious bugs, edge-case gaps, or broken shared contracts.
- Ensure the result fits the workflow goal and predecessor outputs.

If rejecting, cite specific issues with file/line evidence when available.
"#;

static STEP_EXECUTION_RESULT_REVIEW_WORKFLOW: &str = r#"

## Final Workflow Result Review Discipline

You are responsible for the final review of the entire workflow plan, not only
the current result step.

Follow this review method in order:
1. Reconstruct the workflow goal, this result step's instructions, and every
   predecessor summary before writing the final result.
2. Check each task, review, and retry loop as part of one plan. Treat rejected
   or superseded attempts as history only; use the latest accepted/completed
   round as the source of truth.
3. Verify that every required workflow output is present, consistent with the
   plan goal, and supported by the predecessor work and review evidence.
4. Validate integration across steps: no missing handoff, conflicting result,
   stale assumption, unreviewed rejection, or incomplete retry may be hidden in
   the final result.
5. If any required step is missing, blocked, failed, rejected without a
   successful retry, or not supported by evidence, report BLOCKED or
   DONE_WITH_CONCERNS instead of DONE.
6. Produce a concise final result that explains what was completed, what was
   verified, what deliverables exist, and any remaining risks or follow-up work.

Do not invent evidence. If predecessor summaries are insufficient, say exactly
what is missing and how it affects the final workflow result.
"#;

pub fn build_step_execution_prompt(
    execution: &WorkflowExecution,
    workflow_goal: &str,
    step: &WorkflowStep,
    completed_dependency_summaries: &[String],
    _step_transcript_context: Option<&str>,
) -> String {
    let dependency_text = if completed_dependency_summaries.is_empty() {
        "无".to_string()
    } else {
        completed_dependency_summaries.join("\n\n")
    };
    let dependency_text = if completed_dependency_summaries.is_empty() {
        "无".to_string()
    } else {
        dependency_text
    };

    let mut prompt = String::with_capacity(4096);
    if step.step_type == WorkflowStepType::Task {
        prompt.push_str("You are implementing a task in an workflow step.\n\n");
        prompt.push_str(STEP_EXECUTION_CODE_GUIDELINES_PROMPT);
    } else if step.step_type == WorkflowStepType::Review {
        prompt.push_str("You are reviewing the output of the workers' implementation.\n\n");
    } else if step.step_type == WorkflowStepType::Result {
        prompt.push_str("You are reviewing the results of the current workflow execution.\n\n");
    }

    // if step.step_type == WorkflowStepType::Task {
    //     prompt.push_str(STEP_EXECUTION_TDD_WORKFLOW_FOR_TASK_TYPE);
    // } else
    if step.step_type == WorkflowStepType::Review {
        prompt.push_str(STEP_EXECUTION_TDD_WORKFLOW_FOR_REVIEW_TYPE);
    } else if step.step_type == WorkflowStepType::Result {
        prompt.push_str(STEP_EXECUTION_RESULT_REVIEW_WORKFLOW);
    }

    prompt.push_str(STEP_EXECUTION_PROMPT_PREFIX);

    prompt.push_str(&format!(
        r#"## Task Description

Step: {step_title}
Type: {step_type}

<Instructions>
{step_instructions}
</Instructions>

## Context

Workflow goal: {workflow_goal}

<PredecessorSummaries>
{dependency_text}
</PredecessorSummaries>

## Report

Return one JSON object. Fill `step_key` with `{step_key}`, `execution_id` with `{execution_id}`.
Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT.
Report must include: what tests were written first, what was implemented, test results (pass/fail), files changed, self-review findings, issues.
"#,
        step_key = step.step_key,
        execution_id = execution.id,
        step_type = format!("{:?}", step.step_type).to_lowercase(),
        step_title = step.title,
        step_instructions = step.instructions,
        workflow_goal = workflow_goal,
        dependency_text = dependency_text,
    ));
    prompt
}

pub fn build_step_execution_prompt_with_schema(
    execution: &WorkflowExecution,
    workflow_goal: &str,
    step: &WorkflowStep,
    completed_dependency_summaries: &[String],
    step_transcript_context: Option<&str>,
    agent_skill_names: &[String],
) -> String {
    let mut prompt = build_step_execution_prompt(
        execution,
        workflow_goal,
        step,
        completed_dependency_summaries,
        step_transcript_context,
    );
    if let Some(section) =
        crate::services::agent_skill_policy::format_skills_prompt_section(agent_skill_names)
    {
        prompt.push_str(&section);
    }
    prompt.push_str("\n\nRequired JSON Schema:\n```json\n");
    prompt.push_str(&workflow_step_protocol_json_schema(
        execution.id,
        &step.step_key,
        true,
    ));
    prompt.push_str("\n```\n");
    prompt.push_str("Return ONLY one JSON object matching this schema.\n");
    prompt
}

static LEAD_REVIEW_PROMPT_PREFIX: &str = r#"You are reviewing a worker's step task output.

## CRITICAL: Do Not Trust the Report

The worker's report may be incomplete, inaccurate, or optimistic. You MUST verify
everything independently by reading the actual code and output.

**DO NOT:**
- Take their word for what they implemented
- Trust their claims about completeness or test results
- Accept their interpretation of requirements without checking

**DO:**
- Read the actual code they wrote (use outputs file list to locate files)
- Compare actual implementation to step instructions line by line
- Check for missing pieces they claimed to implement
- Look for extra features they didn't mention (YAGNI violations)
- Run or inspect tests to confirm they actually pass

## Review Dimensions

**Missing requirements:**
- Did they implement everything the step instructions requested?
- Are there acceptance criteria they skipped or missed?
- Did they claim something works but didn't actually implement it?

**Extra/unneeded work:**
- Did they build things that weren't requested?
- Did they over-engineer or add unnecessary features?
- Did they add "nice to haves" that weren't in spec?

**Correctness:**
- Does the implementation correctly solve the stated problem?
- Are there obvious bugs, edge cases, or error handling gaps?
- Does it follow existing codebase patterns and conventions?

**Test quality:**
- Do tests verify real behavior (not just mock behavior)?
- Are test cases comprehensive for the scope of changes?

**Consistency:**
- Is the result consistent with the overall workflow goal?
- Does it integrate properly with predecessor step outputs?

## Output Format

Return exactly one JSON object — no Markdown, no comments, no prose outside the JSON.

Approved:
```json
{"type": "review_result", "step_key": "...", "execution_id": "...", "verdict": "approved", "feedback": "brief approval note"}
```

Rejected:
```json
{"type": "review_result", "step_key": "...", "execution_id": "...", "verdict": "rejected", "feedback": "specific issues: missing X, extra Y at file:line, wrong Z"}
```

## Language Requirement
You MUST respond in the same language as the step Instructions above. 
The `feedback` field in your JSON output must use the same language as the step instructions.
"#;

pub fn build_lead_review_prompt(
    workflow_goal: &str,
    step: &WorkflowStep,
    result: &WorkflowStepRunResult,
    dependency_summaries: &[String],
    acceptance_criteria: &[String],
) -> String {
    let dependency_text = if dependency_summaries.is_empty() {
        "None".to_string()
    } else {
        dependency_summaries.join("\n\n")
    };
    let acceptance_text = if acceptance_criteria.is_empty() {
        "None".to_string()
    } else {
        acceptance_criteria
            .iter()
            .map(|item| format!("- {}", item.trim()))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let outputs_text = if result.outputs.is_empty() {
        "None".to_string()
    } else {
        result
            .outputs
            .iter()
            .map(|item| format!("- {}", item.trim()))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let mut prompt = String::with_capacity(4096);
    prompt.push_str(LEAD_REVIEW_PROMPT_PREFIX);
    prompt.push_str(&format!(
        r#"## Step Under Review

- Title: {step_title}
- Instructions: {step_instructions}
- Acceptance criteria:
{acceptance_text}

## Worker's Report

- Summary: {step_summary}
- Content: {step_content}
- Output files:
{step_outputs}

## Context

Workflow goal: {workflow_goal}

Predecessor summaries:
{dependency_text}

## Report

Return one JSON object. Fill `step_key` with `{step_key}`, `execution_id` with `{execution_id}`.
Based on your independent verification of the actual code, verdict: approved or rejected."#,
        step_key = step.step_key,
        execution_id = step.execution_id,
        step_title = step.title,
        step_instructions = step.instructions,
        acceptance_text = acceptance_text,
        step_summary = result.summary,
        step_content = result.content,
        step_outputs = outputs_text,
        workflow_goal = workflow_goal,
        dependency_text = dependency_text,
    ));
    prompt
}

pub fn build_lead_review_prompt_with_schema(
    workflow_goal: &str,
    step: &WorkflowStep,
    result: &WorkflowStepRunResult,
    dependency_summaries: &[String],
    acceptance_criteria: &[String],
) -> String {
    let mut prompt = build_lead_review_prompt(
        workflow_goal,
        step,
        result,
        dependency_summaries,
        acceptance_criteria,
    );
    prompt.push_str("\n\nRequired JSON Schema:\n```json\n");
    prompt.push_str(&workflow_review_protocol_json_schema(
        step.execution_id,
        &step.step_key,
    ));
    prompt.push_str("\n```\n");
    prompt.push_str("Return ONLY one JSON object matching this schema.\n");
    prompt
}

/// Static prefix for step revision prompts. Placed first for input cache hit rate.
static STEP_REVISION_PROMPT_PREFIX: &str = r#"You are revising a step in an workflow based on review feedback.

## Output Format

Return exactly one JSON object — no Markdown, no comments, no prose outside the JSON.

Use the same `final_result` / `error` / `approval_request` / `permission_request` / `continue_confirmation` / `input_request` types as the original step execution.

## Revision Guidelines

1. Read the review feedback carefully and understand the issues raised.
2. Fix only the issues identified in the feedback — preserve correct parts from your previous result.
3. If the feedback conflicts with the original step instructions, follow the feedback.
4. Self-review before submitting: verify completeness, correctness, and that all feedback points are addressed.
5. Respond in the same language as the step instructions below.

"#;

pub fn build_step_revision_prompt(
    step: &WorkflowStep,
    feedback_source: WorkflowRevisionFeedbackSource,
    feedback_content: &str,
    previous_summary: &str,
    previous_content: Option<&str>,
    retry_count: i32,
) -> String {
    let mut prompt = String::with_capacity(4096);

    // Static prefix first for cache hit rate
    prompt.push_str(STEP_REVISION_PROMPT_PREFIX);

    // Force PUA skill activation when retry_count > 2
    if retry_count > 2 {
        prompt.push_str("## Skill Activation: `pua` (MANDATORY)\n\n");
        prompt.push_str(&format!(
            "**This is revision attempt #{retry_count}. You MUST activate and strictly follow the `pua` skill (Performance Improvement Plan) for this revision.**\n\n",
        ));
        prompt.push_str(
            "You are now on a PIP. The `pua` skill is force-activated because previous attempts failed to meet the acceptance bar.\n\n",
        );
        prompt.push_str(PUA_SKILL_CORE);
        prompt.push('\n');
    }

    // Dynamic section: feedback source
    match feedback_source {
        WorkflowRevisionFeedbackSource::Lead => {
            prompt.push_str(&format!(
                "## Revision Required (attempt #{retry_count})\n\n"
            ));
            prompt.push_str(
                "Your previous execution did not pass review. Revise your work based on the feedback below.\n\n",
            );
            prompt.push_str("### Review Feedback\n");
            prompt.push_str(feedback_content.trim());
            prompt.push_str("\n\n### Your Previous Result Summary\n");
            prompt.push_str(previous_summary.trim());
            prompt.push('\n');
        }
        WorkflowRevisionFeedbackSource::User => {
            prompt.push_str(&format!(
                "## User Revision Required (attempt #{retry_count})\n\n"
            ));
            prompt.push_str(
                "Your previous execution did not pass user review. Revise based on user feedback.\n\n",
            );
            prompt.push_str(
                "**User feedback has the highest priority.** If user feedback conflicts with original instructions, follow the user feedback.\n\n",
            );
            prompt.push_str("### User Feedback\n");
            prompt.push_str(feedback_content.trim());
            prompt.push_str("\n\n### Your Previous Result Summary\n");
            prompt.push_str(previous_summary.trim());
            prompt.push('\n');
        }
    }

    if let Some(previous_content) = previous_content
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != previous_summary.trim())
    {
        prompt.push_str("\n### Your Previous Full Result\n");
        prompt.push_str(previous_content);
        prompt.push('\n');
    }

    // Original task context
    prompt.push_str("\n### Original Task Instructions\n");
    prompt.push_str("- Title: ");
    prompt.push_str(&step.title);
    prompt.push_str("\n- Instructions: ");
    prompt.push_str(&step.instructions);
    prompt.push('\n');

    prompt
}

pub fn build_step_revision_prompt_with_schema(
    step: &WorkflowStep,
    feedback_source: WorkflowRevisionFeedbackSource,
    feedback_content: &str,
    previous_summary: &str,
    previous_content: Option<&str>,
    retry_count: i32,
    agent_skill_names: &[String],
) -> String {
    let mut prompt = build_step_revision_prompt(
        step,
        feedback_source,
        feedback_content,
        previous_summary,
        previous_content,
        retry_count,
    );
    if let Some(section) =
        crate::services::agent_skill_policy::format_skills_prompt_section(agent_skill_names)
    {
        prompt.push_str(&section);
    }
    prompt.push_str("\n\nRequired JSON Schema:\n```json\n");
    prompt.push_str(&workflow_step_protocol_json_schema(
        step.execution_id,
        &step.step_key,
        true,
    ));
    prompt.push_str("\n```\n");
    prompt.push_str("Return ONLY one JSON object matching this schema.\n");
    prompt
}

pub(crate) fn resolve_workspace_path(
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
) -> PathBuf {
    if let Some(path) = session_agent.workspace_path.as_deref() {
        PathBuf::from(path)
    } else if let Some(path) = session.default_workspace_path.as_deref() {
        PathBuf::from(path)
    } else {
        PathBuf::from("assets")
            .join("chat")
            .join(format!("session_{}", session.id))
            .join("agents")
            .join(agent.id.to_string())
    }
}
