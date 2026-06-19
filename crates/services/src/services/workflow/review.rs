use db::models::{
    workflow_step::WorkflowStep,
    workflow_types::{CompiledLoopDef, ReviewVerdict},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::workflow_runtime::{WorkflowRuntimeError, extract_json_payload};

#[derive(Debug, Clone)]
pub struct LoopReviewPromptStepInput {
    pub step_key: String,
    pub title: String,
    pub instructions: String,
    pub acceptance: Vec<String>,
    pub summary: String,
    pub content: String,
    pub outputs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoopReviewStepFeedback {
    pub step_key: String,
    pub feedback: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LoopReviewProtocolMessage {
    LoopReviewResult {
        loop_key: String,
        execution_id: String,
        verdict: ReviewVerdict,
        feedback: String,
        #[serde(default)]
        step_feedbacks: Vec<LoopReviewStepFeedback>,
    },
}

pub fn build_loop_review_prompt(
    workflow_goal: &str,
    loop_def: &CompiledLoopDef,
    execution_id: Uuid,
    loop_retry_count: i32,
    review_steps: &[LoopReviewPromptStepInput],
    response_language_instruction: &str,
) -> String {
    let review_scope_step_titles = review_steps
        .iter()
        .map(|step| step.title.clone())
        .collect::<Vec<_>>()
        .join(", ");
    let step_sections = review_steps
        .iter()
        .enumerate()
        .map(|(index, step)| {
            let acceptance = if step.acceptance.is_empty() {
                "None".to_string()
            } else {
                step.acceptance.join("; ")
            };
            let outputs = if step.outputs.is_empty() {
                "None".to_string()
            } else {
                step.outputs.join(", ")
            };
            format!(
                "#### [{}] {}\n- Instructions: {}\n- Acceptance criteria: {}\n- Execution summary: {}\n- Detailed content: {}\n- Outputs: {}",
                index + 1,
                step.title,
                step.instructions,
                acceptance,
                step.summary,
                step.content,
                outputs,
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let rejected_feedback_template = review_steps
        .iter()
        .map(|step| {
            format!(
                r#"    {{ "step_key": "{}", "feedback": "Specific revision feedback for this step" }}"#,
                step.step_key
            )
        })
        .collect::<Vec<_>>()
        .join(",\n");
    let allowed_step_keys = review_steps
        .iter()
        .map(|step| step.step_key.clone())
        .collect::<Vec<_>>();
    let json_schema =
        loop_review_protocol_json_schema(execution_id, &loop_def.loop_key, &allowed_step_keys);

    let mut prompt = format!(
        r#"## Loop Review Task

You are the Lead Agent for this workflow. Review all execution results in the following loop or stage as one coherent unit.

### Workflow Goal
{workflow_goal}

### Loop Information
- Loop key: {loop_key}
- Current retry count: {loop_retry_count}
- Review scope: {review_scope_step_titles}

### Execution Results by Step

{step_sections}

### Review Requirements
Evaluate the loop's execution quality from an overall perspective:
1. Whether the step results are mutually consistent and logically connected.
2. Whether the loop achieved this stage's goal overall.
3. Whether outputs from one step correctly connect to the next step.
4. Whether there are systemic issues that require broader rework.

### Response Language Requirement
{response_language_instruction}

### Return Format
When approved, return:
{{
  "type": "loop_review_result",
  "loop_key": "{loop_key}",
  "execution_id": "{execution_id}",
  "verdict": "approved",
  "feedback": "Overall evaluation explaining why the loop review passed"
}}

When rejected, return:
If only some steps need rework, list only those steps in step_feedbacks; steps not listed will keep their current completed state.
If the entire loop needs rework, omit step_feedbacks or return an empty array.
{{
  "type": "loop_review_result",
  "loop_key": "{loop_key}",
  "execution_id": "{execution_id}",
  "verdict": "rejected",
  "feedback": "Detailed explanation of the overall issues and the concrete revision guidance for each step that needs changes",
  "step_feedbacks": [
{rejected_feedback_template}
  ]
}}"#,
        workflow_goal = workflow_goal,
        loop_key = loop_def.loop_key,
        execution_id = execution_id,
        loop_retry_count = loop_retry_count,
        review_scope_step_titles = review_scope_step_titles,
        step_sections = step_sections,
        rejected_feedback_template = rejected_feedback_template,
        response_language_instruction = response_language_instruction.trim(),
    );
    prompt.push_str("\n\nRequired JSON Schema:\n```json\n");
    prompt.push_str(&json_schema);
    prompt.push_str("\n```\nReturn ONLY one JSON object matching this schema.\n");
    prompt
}

pub fn loop_review_protocol_json_schema(
    execution_id: Uuid,
    loop_key: &str,
    allowed_step_keys: &[String],
) -> String {
    let execution_id_schema = if execution_id.is_nil() {
        serde_json::json!({
            "type": "string",
            "description": "Must be the current workflow execution id"
        })
    } else {
        serde_json::json!({ "const": execution_id.to_string() })
    };

    serde_json::to_string_pretty(&serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": ["type", "loop_key", "execution_id", "verdict", "feedback"],
        "additionalProperties": false,
        "properties": {
            "type": { "const": "loop_review_result" },
            "loop_key": { "const": loop_key },
            "execution_id": execution_id_schema,
            "verdict": { "enum": ["approved", "rejected"] },
            "feedback": { "type": "string", "minLength": 1 },
            "step_feedbacks": {
                "type": "array",
                "default": [],
                "items": {
                    "type": "object",
                    "required": ["step_key", "feedback"],
                    "additionalProperties": false,
                    "properties": {
                        "step_key": { "enum": allowed_step_keys },
                        "feedback": { "type": "string", "minLength": 1 }
                    }
                }
            }
        }
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

pub struct LoopRejectionPromptInput<'a> {
    pub loop_retry_count: i32,
    pub loop_rejection_reason: &'a str,
    pub step_specific_feedback: &'a str,
    pub other_steps_feedback_summary: &'a [String],
    pub your_previous_summary: &'a str,
    pub step: &'a WorkflowStep,
    pub external_dependency_text: &'a [String],
    pub response_language_instruction: &'a str,
}

pub fn build_loop_rejection_prompt(input: LoopRejectionPromptInput<'_>) -> String {
    let other_steps_feedback_summary = if input.other_steps_feedback_summary.is_empty() {
        "None".to_string()
    } else {
        input.other_steps_feedback_summary.join("\n")
    };
    let external_dependency_text = if input.external_dependency_text.is_empty() {
        "None".to_string()
    } else {
        input.external_dependency_text.join("\n")
    };

    format!(
        r#"## Loop Rework Request (loop retry {loop_retry_count})

The overall loop review did not pass. Re-run your task according to the feedback below.

### Loop Review Decision
{loop_rejection_reason}

### Revision Feedback for Your Step
{step_specific_feedback}

### Other Steps' Revision Direction (for reference)
{other_steps_feedback_summary}

### Your Previous Execution Result
Summary: {your_previous_summary}

### Requirements
1. Focus on the "Revision Feedback for Your Step" section.
2. Keep your changes consistent with the revision direction for other steps.
3. Preserve any correct work from your previous result and revise only what needs changes.
4. After completing the revision, return the result in the standard format.

### Response Language Requirement
{response_language_instruction}

### Original Task Instructions
Step title: {step_title}
Step instructions: {step_instructions}

### Completed Upstream Step Summaries (outside the loop)
{external_dependency_text}"#,
        loop_retry_count = input.loop_retry_count,
        loop_rejection_reason = input.loop_rejection_reason,
        step_specific_feedback = input.step_specific_feedback,
        other_steps_feedback_summary = other_steps_feedback_summary,
        your_previous_summary = input.your_previous_summary,
        step_title = input.step.title,
        step_instructions = input.step.instructions,
        external_dependency_text = external_dependency_text,
        response_language_instruction = input.response_language_instruction.trim(),
    )
}

pub fn build_loop_user_rejection_prompt(
    loop_retry_count: i32,
    user_feedback: &str,
    loop_current_state_summary: &str,
    your_previous_summary: &str,
    step: &WorkflowStep,
    response_language_instruction: &str,
) -> String {
    format!(
        r#"## User Loop Rework Request (loop retry {loop_retry_count})

The overall loop result did not pass user review. Re-run your task according to the user feedback.

### User Feedback
{user_feedback}

### Current Loop State Summary
{loop_current_state_summary}

### Your Previous Execution Result
Summary: {your_previous_summary}

### Requirements
1. Treat the user feedback as the highest priority.
2. Understand how the user feedback affects the overall loop and adjust your work accordingly.
3. {response_language_instruction}
4. After completing the revision, return the result in the standard format.

### Original Task Instructions
Step title: {step_title}
Step instructions: {step_instructions}"#,
        loop_retry_count = loop_retry_count,
        user_feedback = user_feedback,
        loop_current_state_summary = loop_current_state_summary,
        your_previous_summary = your_previous_summary,
        step_title = step.title,
        step_instructions = step.instructions,
        response_language_instruction = response_language_instruction.trim(),
    )
}

pub fn parse_loop_review_output(
    execution_id: Uuid,
    loop_key: &str,
    raw_output: &str,
) -> Result<LoopReviewProtocolMessage, WorkflowRuntimeError> {
    let payload = extract_json_payload(raw_output).ok_or_else(|| {
        WorkflowRuntimeError::Validation("loop review 输出中未找到 JSON 对象".to_string())
    })?;
    let message: LoopReviewProtocolMessage = serde_json::from_str(&payload)?;

    match &message {
        LoopReviewProtocolMessage::LoopReviewResult {
            loop_key: actual_loop_key,
            execution_id: actual_execution_id,
            verdict,
            feedback,
            step_feedbacks,
        } => {
            if actual_loop_key != loop_key {
                return Err(WorkflowRuntimeError::Validation(format!(
                    "loop review 的 loop_key 非法，期望 '{}'，实际 '{}'",
                    loop_key, actual_loop_key
                )));
            }
            if actual_execution_id != &execution_id.to_string() {
                return Err(WorkflowRuntimeError::Validation(format!(
                    "loop review 的 execution_id 非法，期望 '{}'，实际 '{}'",
                    execution_id, actual_execution_id
                )));
            }
            if feedback.trim().is_empty() {
                return Err(WorkflowRuntimeError::Validation(
                    "loop review 的 feedback 不能为空".to_string(),
                ));
            }
            if matches!(verdict, ReviewVerdict::Rejected)
                && step_feedbacks
                    .iter()
                    .any(|item| item.feedback.trim().is_empty())
            {
                return Err(WorkflowRuntimeError::Validation(
                    "loop review rejected 时 step_feedbacks.feedback 不能为空".to_string(),
                ));
            }
        }
    }

    Ok(message)
}

#[cfg(test)]
mod tests {
    use db::models::workflow_types::WorkflowStepType;

    use super::*;

    fn sample_loop_def() -> CompiledLoopDef {
        CompiledLoopDef {
            loop_key: "loop-a".to_string(),
            member_step_keys: vec!["draft".to_string(), "revise".to_string()],
            review_step_key: "review".to_string(),
            review_scope_step_keys: vec!["draft".to_string(), "revise".to_string()],
            max_retry: 2,
            user_review_required: true,
        }
    }

    fn sample_worker_step() -> WorkflowStep {
        let now = chrono::Utc::now();
        WorkflowStep {
            id: Uuid::new_v4(),
            execution_id: Uuid::new_v4(),
            round_id: Uuid::new_v4(),
            compiled_revision_id: None,
            step_key: "draft".to_string(),
            step_type: WorkflowStepType::Task,
            title: "Draft".to_string(),
            instructions: "Write the first draft".to_string(),
            assigned_workflow_agent_session_id: None,
            status: db::models::workflow_types::WorkflowStepStatus::Revising,
            retry_count: 1,
            max_retry: 3,
            round_index: 1,
            display_order: 0,
            latest_run_id: None,
            summary_text: None,
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
    fn build_loop_review_prompt_includes_all_required_sections() {
        let prompt = build_loop_review_prompt(
            "Deliver a coherent feature",
            &sample_loop_def(),
            Uuid::nil(),
            1,
            &[
                LoopReviewPromptStepInput {
                    step_key: "draft".to_string(),
                    title: "Draft".to_string(),
                    instructions: "Write the draft".to_string(),
                    acceptance: vec!["Complete the initial scope".to_string()],
                    summary: "Draft ready".to_string(),
                    content: "Produced a draft document".to_string(),
                    outputs: vec!["docs/draft.md".to_string()],
                },
                LoopReviewPromptStepInput {
                    step_key: "revise".to_string(),
                    title: "Revise".to_string(),
                    instructions: "Improve the draft".to_string(),
                    acceptance: vec![],
                    summary: "Revision ready".to_string(),
                    content: "Added missing details".to_string(),
                    outputs: vec![],
                },
            ],
            "You MUST write human-readable JSON string values in Simplified Chinese.",
        );

        assert!(prompt.contains("## Loop Review Task"));
        assert!(prompt.contains("Response Language Requirement"));
        assert!(
            prompt.contains(
                "You MUST write human-readable JSON string values in Simplified Chinese."
            )
        );
        assert!(prompt.contains("Deliver a coherent feature"));
        assert!(prompt.contains("loop-a"));
        assert!(prompt.contains("Draft"));
        assert!(prompt.contains("Revise"));
        assert!(prompt.contains("docs/draft.md"));
        assert!(prompt.contains("\"type\": \"loop_review_result\""));
    }

    #[test]
    fn build_loop_rejection_prompt_contains_feedback_sections() {
        let step = sample_worker_step();
        let prompt = build_loop_rejection_prompt(LoopRejectionPromptInput {
            loop_retry_count: 2,
            loop_rejection_reason: "整体结构不一致",
            step_specific_feedback: "请统一术语",
            other_steps_feedback_summary: &["其他节点需要同步命名".to_string()],
            your_previous_summary: "Old summary",
            step: &step,
            external_dependency_text: &["外部依赖 A 已完成".to_string()],
            response_language_instruction: "You MUST write human-readable JSON string values in Simplified Chinese.",
        });

        assert!(prompt.contains("loop retry 2"));
        assert!(prompt.contains("整体结构不一致"));
        assert!(prompt.contains("请统一术语"));
        assert!(prompt.contains("其他节点需要同步命名"));
        assert!(prompt.contains("外部依赖 A 已完成"));
        assert!(prompt.contains("Response Language Requirement"));
        assert!(
            prompt.contains(
                "You MUST write human-readable JSON string values in Simplified Chinese."
            )
        );
    }

    #[test]
    fn build_loop_user_rejection_prompt_contains_user_feedback() {
        let step = sample_worker_step();
        let prompt = build_loop_user_rejection_prompt(
            1,
            "用户要求改为中文输出",
            "当前回路已生成英文文档",
            "Old summary",
            &step,
            "You MUST write human-readable JSON string values in Simplified Chinese.",
        );

        assert!(prompt.contains("User Loop Rework Request"));
        assert!(
            prompt.contains(
                "You MUST write human-readable JSON string values in Simplified Chinese."
            )
        );
        assert!(prompt.contains("用户要求改为中文输出"));
        assert!(prompt.contains("当前回路已生成英文文档"));
    }

    #[test]
    fn parse_loop_review_output_accepts_approved_result() {
        let execution_id = Uuid::new_v4();
        let raw = format!(
            r#"{{
  "type": "loop_review_result",
  "loop_key": "loop-a",
  "execution_id": "{}",
  "verdict": "approved",
  "feedback": "整体通过"
}}"#,
            execution_id
        );

        let parsed = parse_loop_review_output(execution_id, "loop-a", &raw).expect("parse");
        assert_eq!(
            parsed,
            LoopReviewProtocolMessage::LoopReviewResult {
                loop_key: "loop-a".to_string(),
                execution_id: execution_id.to_string(),
                verdict: ReviewVerdict::Approved,
                feedback: "整体通过".to_string(),
                step_feedbacks: vec![],
            }
        );
    }

    #[test]
    fn parse_loop_review_output_accepts_rejected_result() {
        let execution_id = Uuid::new_v4();
        let raw = format!(
            r#"{{
  "type": "loop_review_result",
  "loop_key": "loop-a",
  "execution_id": "{}",
  "verdict": "rejected",
  "feedback": "需要整体返工",
  "step_feedbacks": [
    {{ "step_key": "draft", "feedback": "请补充背景" }}
  ]
}}"#,
            execution_id
        );

        let parsed = parse_loop_review_output(execution_id, "loop-a", &raw).expect("parse");
        assert!(matches!(
            parsed,
            LoopReviewProtocolMessage::LoopReviewResult {
                verdict: ReviewVerdict::Rejected,
                ..
            }
        ));
    }

    #[test]
    fn parse_loop_review_output_rejects_invalid_payload() {
        let execution_id = Uuid::new_v4();
        let raw = format!(
            r#"{{
  "type": "loop_review_result",
  "loop_key": "other-loop",
  "execution_id": "{}",
  "verdict": "approved",
  "feedback": "ok"
}}"#,
            execution_id
        );

        let err = parse_loop_review_output(execution_id, "loop-a", &raw).expect_err("invalid");
        assert!(matches!(err, WorkflowRuntimeError::Validation(_)));
    }
}
