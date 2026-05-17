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
) -> String {
    let review_scope_step_titles = review_steps
        .iter()
        .map(|step| step.title.clone())
        .collect::<Vec<_>>()
        .join("、");
    let step_sections = review_steps
        .iter()
        .enumerate()
        .map(|(index, step)| {
            let acceptance = if step.acceptance.is_empty() {
                "无".to_string()
            } else {
                step.acceptance.join("；")
            };
            let outputs = if step.outputs.is_empty() {
                "无".to_string()
            } else {
                step.outputs.join("、")
            };
            format!(
                "#### [{}] {}\n- 指令：{}\n- 验收标准：{}\n- 执行摘要：{}\n- 详细内容：{}\n- 产出：{}",
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
                r#"    {{ "step_key": "{}", "feedback": "针对该节点的具体修改意见" }}"#,
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
        r#"## 回路审核任务

你是本次 workflow 的 Lead Agent，请对以下回路（阶段）的所有执行结果进行综合审核。

### workflow 目标
{workflow_goal}

### 回路信息
- 回路标识：{loop_key}
- 当前返工次数：{loop_retry_count}
- 审核范围：{review_scope_step_titles}

### 各执行节点结果

{step_sections}

### 审核要求
请从整体角度评估本回路的执行质量：
1. 各节点的结果是否相互一致、逻辑连贯
2. 整体是否达成了本阶段的目标
3. 各节点之间的产出是否正确衔接
4. 是否存在需要整体返工的系统性问题

### 返回格式
通过时返回：
{{
  "type": "loop_review_result",
  "loop_key": "{loop_key}",
  "execution_id": "{execution_id}",
  "verdict": "approved",
  "feedback": "回路审核通过的综合评价"
}}

不通过时返回（会导致回路内所有节点重新执行）：
{{
  "type": "loop_review_result",
  "loop_key": "{loop_key}",
  "execution_id": "{execution_id}",
  "verdict": "rejected",
  "feedback": "详细说明整体问题，以及对每个需要修改的节点的具体修改建议",
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

pub fn build_loop_rejection_prompt(
    loop_retry_count: i32,
    loop_rejection_reason: &str,
    step_specific_feedback: &str,
    other_steps_feedback_summary: &[String],
    your_previous_summary: &str,
    step: &WorkflowStep,
    external_dependency_text: &[String],
) -> String {
    let other_steps_feedback_summary = if other_steps_feedback_summary.is_empty() {
        "无".to_string()
    } else {
        other_steps_feedback_summary.join("\n")
    };
    let external_dependency_text = if external_dependency_text.is_empty() {
        "无".to_string()
    } else {
        external_dependency_text.join("\n")
    };

    format!(
        r#"## 回路返工要求 (第 {loop_retry_count} 次回路重试)

本回路的整体审核未通过，你需要根据以下反馈重新执行你的任务。

### 回路审核结论
{loop_rejection_reason}

### 针对你的节点的修改意见
{step_specific_feedback}

### 其他节点的修改方向 (供参考)
{other_steps_feedback_summary}

### 你上次的执行结果
摘要：{your_previous_summary}

### 要求
1. 重点关注「针对你的节点的修改意见」进行修改
2. 注意与其他节点修改方向保持一致
3. 保留上次正确的工作成果，针对性修改
4. 修改完成后按照标准格式返回结果

### 原始任务指令
step 标题：{step_title}
step 指令：{step_instructions}

### 已完成前置步骤摘要（回路外）
{external_dependency_text}"#,
        loop_retry_count = loop_retry_count,
        loop_rejection_reason = loop_rejection_reason,
        step_specific_feedback = step_specific_feedback,
        other_steps_feedback_summary = other_steps_feedback_summary,
        your_previous_summary = your_previous_summary,
        step_title = step.title,
        step_instructions = step.instructions,
        external_dependency_text = external_dependency_text,
    )
}

pub fn build_loop_user_rejection_prompt(
    loop_retry_count: i32,
    user_feedback: &str,
    loop_current_state_summary: &str,
    your_previous_summary: &str,
    step: &WorkflowStep,
) -> String {
    format!(
        r#"## 用户回路返工要求 (第 {loop_retry_count} 次回路重试)

本回路的整体结果未通过用户审核，请根据用户反馈重新执行。

### 用户反馈
{user_feedback}

### 回路执行现状摘要
{loop_current_state_summary}

### 你上次的执行结果
摘要：{your_previous_summary}

### 要求
1. 用户反馈具有最高优先级
2. 理解用户反馈对整体回路的影响，调整你的工作
3. 修改完成后按照标准格式返回结果

### 原始任务指令
step 标题：{step_title}
step 指令：{step_instructions}"#,
        loop_retry_count = loop_retry_count,
        user_feedback = user_feedback,
        loop_current_state_summary = loop_current_state_summary,
        your_previous_summary = your_previous_summary,
        step_title = step.title,
        step_instructions = step.instructions,
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
        );

        assert!(prompt.contains("## 回路审核任务"));
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
        let prompt = build_loop_rejection_prompt(
            2,
            "整体结构不一致",
            "请统一术语",
            &["其他节点需要同步命名".to_string()],
            "Old summary",
            &step,
            &["外部依赖 A 已完成".to_string()],
        );

        assert!(prompt.contains("第 2 次回路重试"));
        assert!(prompt.contains("整体结构不一致"));
        assert!(prompt.contains("请统一术语"));
        assert!(prompt.contains("其他节点需要同步命名"));
        assert!(prompt.contains("外部依赖 A 已完成"));
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
        );

        assert!(prompt.contains("用户回路返工要求"));
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
