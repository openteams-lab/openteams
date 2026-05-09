use std::{collections::HashMap, path::PathBuf, str::FromStr, sync::Arc, time::Duration};

use chrono::Utc;
use dashmap::DashMap;
use db::{
    DBService,
    models::{
        chat_agent::ChatAgent,
        chat_message::{ChatMessage, ChatSenderType},
        chat_session::ChatSession,
        chat_session_agent::ChatSessionAgent,
        workflow_agent_session::WorkflowAgentSession,
        workflow_execution::WorkflowExecution,
        workflow_iteration_feedback::WorkflowIterationFeedback,
        workflow_loop::WorkflowLoop,
        workflow_plan::WorkflowPlan,
        workflow_plan_revision::WorkflowPlanRevision,
        workflow_round::WorkflowRound,
        workflow_step::WorkflowStep,
        workflow_step_edge::WorkflowStepEdge,
        workflow_step_review::WorkflowStepReview,
        workflow_transcript::{CreateWorkflowTranscript, WorkflowTranscript},
        workflow_types::{
            ReviewVerdict, WorkflowExecutionStatus, WorkflowPlanJson, WorkflowPlanNode,
            WorkflowStepStatus, WorkflowStepType, to_workflow_wire_value,
        },
    },
};
use executors::{
    approvals::NoopExecutorApprovalService,
    env::{ExecutionEnv, RepoContext},
    executors::{
        BaseCodingAgent, ExecutorError, ExecutorExitResult, SpawnedChild,
        StandardCodingAgentExecutor,
    },
    logs::{
        ActionType, FileChange, NormalizedEntry, NormalizedEntryType, ToolResult, ToolStatus,
        utils::patch::extract_normalized_entry_from_patch,
    },
    model_sync::with_model,
    profile::{ExecutorConfigs, ExecutorProfileId, canonical_variant_key},
};
use futures::StreamExt;
use json_patch::Patch;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tokio::{fs, time};
use tokio_util::io::ReaderStream;
use ts_rs::TS;
use utils::{log_msg::LogMsg, msg_store::MsgStore, utf8::Utf8LossyDecoder};
use uuid::Uuid;

use super::chat_runner::{ChatRunner, ChatStreamDeltaType};

const WORKFLOW_EXECUTION_TIMEOUT: Duration = Duration::from_secs(4800);
const WORKFLOW_DRAIN_TIMEOUT: Duration = Duration::from_millis(35);
const WORKFLOW_REAP_TIMEOUT: Duration = Duration::from_secs(3);
const WORKFLOW_KILL_WAIT_TIMEOUT: Duration = Duration::from_secs(2);
const EXECUTOR_PROFILE_VARIANT_KEY: &str = "executor_profile_variant";
pub const WORKFLOW_PROTOCOL_PARSE_MAX_RETRIES: u32 = 1;

/// Global registry: step_id → (CancellationToken, child_pid).
/// Used to cancel a running agent process when a step is interrupted.
static RUNNING_STEPS: Lazy<DashMap<Uuid, executors::executors::CancellationToken>> =
    Lazy::new(DashMap::new);

/// Cancel the running agent process for the given step, if any.
/// Called from the orchestrator's `interrupt_step` to truly stop execution.
pub fn cancel_running_step(step_id: Uuid) {
    if let Some((_, token)) = RUNNING_STEPS.remove(&step_id) {
        token.cancel();
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WorkflowRuntimeError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Executor(#[from] ExecutorError),
    #[error("workflow validation error: {0}")]
    Validation(String),
    #[error("workflow step interrupted: {0}")]
    Interrupted(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowCardAgent {
    pub session_agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_agent_session_id: Option<String>,
    pub agent_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowCardState {
    PreviewReady,
    PreviewInvalid,
    Pending,
    Running,
    Waiting,
    Paused,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowCardStep {
    pub id: String,
    pub step_key: String,
    pub title: String,
    pub step_type: String,
    pub status: String,
    pub review_phase: Option<String>,
    pub retry_count: i32,
    pub max_retry: i32,
    pub loop_key: Option<String>,
    pub latest_review: Option<WorkflowCardReview>,
    pub agent_name: Option<String>,
    pub summary_text: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowCardReview {
    pub reviewer_type: String,
    pub verdict: String,
    pub feedback: String,
    pub review_round: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowCardLoop {
    pub id: String,
    pub loop_key: String,
    pub status: String,
    pub retry_count: i32,
    pub max_retry: i32,
    pub user_review_required: bool,
    pub rejection_reason: Option<String>,
    pub member_step_ids: Vec<String>,
    pub review_step_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowPendingReview {
    pub review_id: String,
    pub review_type: String,
    pub target_id: String,
    pub target_title: String,
    pub context_summary: String,
    pub prompt_template: WorkflowReviewPromptTemplate,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowIterationSummary {
    pub round_index: i32,
    pub status: String,
    pub user_feedback: Option<String>,
    pub result_summary: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowReviewPromptTemplate {
    pub message: String,
    pub fields: Vec<WorkflowReviewField>,
    pub actions: Vec<WorkflowReviewAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowReviewField {
    pub key: String,
    pub label: String,
    pub field_type: String,
    pub required: bool,
    pub placeholder: Option<String>,
    pub options: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowReviewAction {
    pub action: String,
    pub label: String,
    pub style: String,
    pub requires_feedback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowCardProjection {
    pub execution_id: Option<String>,
    pub plan_id: String,
    pub revision_id: String,
    pub title: String,
    pub goal: String,
    pub state: WorkflowCardState,
    pub execution_status: String,
    pub error_message: Option<String>,
    pub completed_step_count: usize,
    pub total_step_count: usize,
    pub result_summary: Option<String>,
    pub outputs: Vec<String>,
    pub agents: Vec<WorkflowCardAgent>,
    pub steps: Vec<WorkflowCardStep>,
    pub current_round: i32,
    pub loops: Vec<WorkflowCardLoop>,
    pub pending_review: Option<WorkflowPendingReview>,
    pub iteration_history: Vec<WorkflowIterationSummary>,
    pub plan: WorkflowPlanJson,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub validation_errors: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkflowStepProtocolMessage {
    FinalResult {
        step_key: String,
        execution_id: String,
        summary: String,
        content: String,
        #[serde(default)]
        outputs: Vec<String>,
    },
    Error {
        step_key: String,
        execution_id: String,
        message: String,
        #[serde(default)]
        content: Option<String>,
    },
    ApprovalRequest {
        step_key: String,
        execution_id: String,
        title: String,
        #[serde(default)]
        description: Option<String>,
    },
    PermissionRequest {
        step_key: String,
        execution_id: String,
        title: String,
        #[serde(default)]
        description: Option<String>,
    },
    ContinueConfirmation {
        step_key: String,
        execution_id: String,
        message: String,
        #[serde(default)]
        description: Option<String>,
    },
    InputRequest {
        step_key: String,
        execution_id: String,
        prompt: String,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        placeholder: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct WorkflowStepRunResult {
    pub run_id: Uuid,
    pub summary: String,
    pub content: String,
    pub outputs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryPayload {
    pub summary: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub outputs: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowRevisionFeedbackSource {
    Lead,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkflowReviewProtocolMessage {
    ReviewResult {
        step_key: String,
        execution_id: String,
        verdict: ReviewVerdict,
        feedback: String,
    },
}

#[derive(Default)]
struct WorkflowRuntimeStreamState {
    last_content_by_index: HashMap<usize, String>,
    assistant_buffer: String,
    thinking_buffer: String,
    error_buffer: String,
}

struct WorkflowRuntimeEntryLine {
    stream_type: ChatStreamDeltaType,
    content: String,
    immediate: bool,
}

impl WorkflowRuntimeStreamState {
    fn drain_patch_lines(&mut self, patch: &Patch) -> Vec<(ChatStreamDeltaType, String)> {
        let Some((index, entry)) = extract_normalized_entry_from_patch(patch) else {
            return Vec::new();
        };

        let Some(line) = workflow_runtime_line_for_entry(&entry) else {
            return Vec::new();
        };

        let previous = self
            .last_content_by_index
            .insert(index, line.content.clone())
            .unwrap_or_default();
        if previous == line.content {
            return Vec::new();
        }

        if line.immediate {
            return vec![(line.stream_type, line.content)];
        }

        let chunk = if line.content.starts_with(&previous) {
            line.content[previous.len()..].to_string()
        } else if previous == line.content {
            String::new()
        } else {
            line.content
        };

        self.drain_chunk_lines(line.stream_type, &chunk)
    }

    fn drain_chunk_lines(
        &mut self,
        stream_type: ChatStreamDeltaType,
        chunk: &str,
    ) -> Vec<(ChatStreamDeltaType, String)> {
        if chunk.is_empty() {
            return Vec::new();
        }

        let normalized = chunk.replace("\r\n", "\n").replace('\r', "\n");
        let buffer = match stream_type {
            ChatStreamDeltaType::Assistant => &mut self.assistant_buffer,
            ChatStreamDeltaType::Thinking => &mut self.thinking_buffer,
            ChatStreamDeltaType::Error => &mut self.error_buffer,
        };
        buffer.push_str(&normalized);

        let mut emitted = Vec::new();
        while let Some(newline_index) = buffer.find('\n') {
            let line = buffer[..newline_index].trim();
            if !line.is_empty() {
                emitted.push((stream_type.clone(), line.to_string()));
            }
            buffer.drain(..=newline_index);
        }

        emitted
    }

    fn flush_pending_lines(&mut self) -> Vec<(ChatStreamDeltaType, String)> {
        let mut emitted = Vec::new();

        for (stream_type, buffer) in [
            (ChatStreamDeltaType::Assistant, &mut self.assistant_buffer),
            (ChatStreamDeltaType::Thinking, &mut self.thinking_buffer),
            (ChatStreamDeltaType::Error, &mut self.error_buffer),
        ] {
            let line = buffer.trim();
            if !line.is_empty() {
                emitted.push((stream_type, line.to_string()));
            }
            buffer.clear();
        }

        emitted
    }
}

fn workflow_runtime_line_for_entry(entry: &NormalizedEntry) -> Option<WorkflowRuntimeEntryLine> {
    match &entry.entry_type {
        NormalizedEntryType::Thinking => Some(WorkflowRuntimeEntryLine {
            stream_type: ChatStreamDeltaType::Thinking,
            content: entry.content.clone(),
            immediate: false,
        }),
        NormalizedEntryType::ToolUse {
            tool_name,
            action_type,
            status,
        } => workflow_tool_activity_content(tool_name, action_type, status, &entry.content).map(
            |content| WorkflowRuntimeEntryLine {
                stream_type: ChatStreamDeltaType::Thinking,
                content,
                immediate: true,
            },
        ),
        // AssistantMessage remains reserved for the final workflow protocol
        // payload, so streaming it into transcript would duplicate or expose
        // the final_result JSON before the orchestrator handles it.
        _ => None,
    }
}

fn workflow_tool_activity_content(
    tool_name: &str,
    action_type: &ActionType,
    status: &ToolStatus,
    fallback_content: &str,
) -> Option<String> {
    let status_label = workflow_tool_status_label(status);

    let content = match action_type {
        ActionType::FileEdit { path, changes } => {
            let change_summary = workflow_file_change_summary(changes);
            format!("{status_label} file edit: {path}{change_summary}")
        }
        ActionType::CommandRun { command, .. } => {
            format!(
                "{status_label} command: {}",
                truncate_workflow_runtime_line(command)
            )
        }
        ActionType::Tool {
            tool_name: inner_tool_name,
            result,
            ..
        } => {
            let display_tool_name = if inner_tool_name.trim().is_empty() {
                tool_name
            } else {
                inner_tool_name
            };
            let prefix = if tool_name.starts_with("mcp:") || display_tool_name.starts_with("mcp:") {
                "MCP tool"
            } else {
                "Tool"
            };
            let mut line = format!("{status_label} {prefix}: {display_tool_name}");
            if let Some(preview) = workflow_tool_result_preview(result) {
                line.push_str(": ");
                line.push_str(&preview);
            }
            line
        }
        ActionType::TaskCreate {
            description,
            subagent_type,
            result,
        } => {
            let mut line = format!(
                "{status_label} task: {}",
                truncate_workflow_runtime_line(description)
            );
            if let Some(subagent_type) = subagent_type
                && !subagent_type.trim().is_empty()
            {
                line.push_str(" (");
                line.push_str(subagent_type.trim());
                line.push(')');
            }
            if let Some(preview) = workflow_tool_result_preview(result) {
                line.push_str(": ");
                line.push_str(&preview);
            }
            line
        }
        ActionType::FileRead { path } => format!("{status_label} file read: {path}"),
        ActionType::Search { query } => {
            format!(
                "{status_label} search: {}",
                truncate_workflow_runtime_line(query)
            )
        }
        ActionType::WebFetch { url } => format!("{status_label} web fetch: {url}"),
        ActionType::TodoManagement { todos, operation } => {
            format!("{status_label} plan {operation}: {} item(s)", todos.len())
        }
        ActionType::PlanPresentation { plan } => {
            format!(
                "{status_label} plan: {}",
                truncate_workflow_runtime_line(plan)
            )
        }
        ActionType::Other { description } => {
            format!(
                "{status_label} activity: {}",
                truncate_workflow_runtime_line(description)
            )
        }
    };

    let content = content.trim();
    if !content.is_empty() {
        return Some(content.to_string());
    }

    let fallback = fallback_content.trim();
    (!fallback.is_empty()).then(|| {
        format!(
            "{status_label} activity: {}",
            truncate_workflow_runtime_line(fallback)
        )
    })
}

fn workflow_tool_status_label(status: &ToolStatus) -> &'static str {
    match status {
        ToolStatus::Created => "Started",
        ToolStatus::Success => "Completed",
        ToolStatus::Failed => "Failed",
        ToolStatus::Denied { .. } => "Denied",
        ToolStatus::PendingApproval { .. } => "Waiting approval for",
        ToolStatus::TimedOut => "Timed out",
    }
}

fn workflow_file_change_summary(changes: &[FileChange]) -> String {
    if changes.is_empty() {
        return String::new();
    }

    let mut write_count = 0;
    let mut edit_count = 0;
    let mut delete_count = 0;
    let mut rename_count = 0;

    for change in changes {
        match change {
            FileChange::Write { .. } => write_count += 1,
            FileChange::Edit { .. } => edit_count += 1,
            FileChange::Delete => delete_count += 1,
            FileChange::Rename { .. } => rename_count += 1,
        }
    }

    let mut parts = Vec::new();
    if write_count > 0 {
        parts.push(format!("{write_count} write"));
    }
    if edit_count > 0 {
        parts.push(format!("{edit_count} edit"));
    }
    if delete_count > 0 {
        parts.push(format!("{delete_count} delete"));
    }
    if rename_count > 0 {
        parts.push(format!("{rename_count} rename"));
    }

    if parts.is_empty() {
        String::new()
    } else {
        format!(" ({})", parts.join(", "))
    }
}

fn workflow_tool_result_preview(result: &Option<ToolResult>) -> Option<String> {
    let result = result.as_ref()?;
    let preview = match &result.value {
        serde_json::Value::String(value) => value.clone(),
        value => value.to_string(),
    };
    let preview = preview
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    Some(truncate_workflow_runtime_line(preview))
}

fn truncate_workflow_runtime_line(value: &str) -> String {
    const MAX_LEN: usize = 220;

    let trimmed = value.trim();
    let mut chars = trimmed.chars();
    let truncated = chars.by_ref().take(MAX_LEN).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

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

pub fn extract_json_payload(raw_output: &str) -> Option<String> {
    let trimmed = raw_output.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed.to_string());
    }

    for pattern in ["```json", "```"] {
        if let Some(start) = trimmed.find(pattern) {
            let remainder = &trimmed[start + pattern.len()..];
            if let Some(end) = remainder.find("```") {
                let candidate = remainder[..end].trim();
                if candidate.starts_with('{') && candidate.ends_with('}') {
                    return Some(candidate.to_string());
                }
            }
        }
    }

    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    (start < end).then(|| trimmed[start..=end].to_string())
}

pub fn workflow_step_protocol_json_schema(
    execution_id: Uuid,
    step_key: &str,
    allow_interaction_requests: bool,
) -> String {
    let mut variants = vec![
        serde_json::json!({
            "type": "object",
            "required": ["type", "step_key", "execution_id", "summary", "content"],
            "additionalProperties": false,
            "properties": {
                "type": { "const": "final_result" },
                "step_key": { "const": step_key },
                "execution_id": { "const": execution_id.to_string() },
                "summary": { "type": "string", "minLength": 1 },
                "content": { "type": "string" },
                "outputs": {
                    "type": "array",
                    "items": { "type": "string" },
                    "default": []
                }
            }
        }),
        serde_json::json!({
            "type": "object",
            "required": ["type", "step_key", "execution_id", "message"],
            "additionalProperties": false,
            "properties": {
                "type": { "const": "error" },
                "step_key": { "const": step_key },
                "execution_id": { "const": execution_id.to_string() },
                "message": { "type": "string", "minLength": 1 },
                "content": { "type": ["string", "null"] }
            }
        }),
    ];

    if allow_interaction_requests {
        variants.extend([
            serde_json::json!({
                "type": "object",
                "required": ["type", "step_key", "execution_id", "title"],
                "additionalProperties": false,
                "properties": {
                    "type": { "enum": ["approval_request", "permission_request"] },
                    "step_key": { "const": step_key },
                    "execution_id": { "const": execution_id.to_string() },
                    "title": { "type": "string", "minLength": 1 },
                    "description": { "type": ["string", "null"] }
                }
            }),
            serde_json::json!({
                "type": "object",
                "required": ["type", "step_key", "execution_id", "message"],
                "additionalProperties": false,
                "properties": {
                    "type": { "const": "continue_confirmation" },
                    "step_key": { "const": step_key },
                    "execution_id": { "const": execution_id.to_string() },
                    "message": { "type": "string", "minLength": 1 },
                    "description": { "type": ["string", "null"] }
                }
            }),
            serde_json::json!({
                "type": "object",
                "required": ["type", "step_key", "execution_id", "prompt"],
                "additionalProperties": false,
                "properties": {
                    "type": { "const": "input_request" },
                    "step_key": { "const": step_key },
                    "execution_id": { "const": execution_id.to_string() },
                    "prompt": { "type": "string", "minLength": 1 },
                    "description": { "type": ["string", "null"] },
                    "placeholder": { "type": ["string", "null"] }
                }
            }),
        ]);
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "oneOf": variants
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

pub fn workflow_review_protocol_json_schema(execution_id: Uuid, step_key: &str) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": ["type", "step_key", "execution_id", "verdict", "feedback"],
        "additionalProperties": false,
        "properties": {
            "type": { "const": "review_result" },
            "step_key": { "const": step_key },
            "execution_id": { "const": execution_id.to_string() },
            "verdict": { "enum": ["approved", "rejected"] },
            "feedback": { "type": "string", "minLength": 1 }
        }
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

pub fn build_workflow_protocol_retry_prompt(
    protocol_name: &str,
    schema: &str,
    error: &str,
    previous_input: &str,
    previous_output: &str,
) -> String {
    format!(
        r#"Your previous workflow {protocol_name} response did not match the required JSON protocol.
Error: {error}

Retry the same workflow request. Respond with ONLY one JSON object. Do not include Markdown fences, prose, explanations, or extra text.

Required JSON Schema:
```json
{schema}
```

Previous workflow request:
<BEGIN_WORKFLOW_REQUEST>
{previous_input}
<END_WORKFLOW_REQUEST>

Previous invalid response:
<BEGIN_INVALID_RESPONSE>
{previous_output}
<END_INVALID_RESPONSE>"#
    )
}

pub fn should_retry_workflow_protocol_parse_failure(raw_output: &str) -> bool {
    !raw_output.trim().is_empty()
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

pub fn build_plan_generation_prompt(
    plan_goal: &str,
    lead_agent_id: &str,
    available_agents: &[WorkflowCardAgent],
    previous_failure_reason: Option<&str>,
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
  "viewport": {
    "x": 0,
    "y": 0,
    "zoom": 1
  },
  "nodes": [
    {
      "id": "unique_step_key",
      "type": "workflowStep",
      "position": {
        "x": 0,
        "y": 0
      },
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

    let base_prompt = format!(
        r#"你现在需要把当前拟定的方案计划解成一个可执行的 workflow plan。
方案摘要：{plan_goal}

你必须输出符合系统 schema 的 workflow JSON，用于后续编译和执行。计划真相源是 React Flow 兼容 JSON，而不是自然语言、YAML 或 Markdown。

硬性要求：
1. 只输出 workflow plan JSON，不要输出解释性文字。
2. 顶层结构必须符合系统定义的 schema，至少包含 `version`、`title`、`goal`、`agents`、`nodes`、`edges`。
3. `nodes[].type` 必须为 `workflowStep`。
4. `nodes[].data.stepType` 只能使用 `task`、`review`、`result`。
5. 必须且只能有一个 `result` 节点，且该节点不能有出边。
6. 所有 node id / edge id / step_key 都必须唯一。
7. 图必须是无环 DAG；依赖关系只通过 `edges` 表达。
8. 只能引用当前 session 中可用的 agent；如果某一步不需要明确指派 agent，可以留空，但不能虚构 agent 标识。
9. `agents.available` 和 `nodes[].data.agentId` 只能复用下方提供的 `agent_id`。
10. 节点 `title` 和 `instructions` 必须具体、可执行，避免空泛描述。
11. 计划应优先追求最小可执行闭环，避免不必要的步骤膨胀。
12. 当需要"执行-审核-修订"迭代时，使用 `stepType: "review"` 节点，并通过 `data.reviewScope` 显式声明该 review 拒绝时需要重跑的前置 task 节点 id 列表。
13. `reviewScope` 非空才会创建 retry loop；未指定或空数组表示普通 review，不会自动反向推导 loop。`reviewScope` 只能包含 task 节点，且每个 task 必须能沿有向边到达该 review。
14. `leadReview` 和 `userReview` 由用户在前端卡片中勾选后由系统写入，你不要输出或推断这两个字段；返工次数不再由 plan JSON 限制。

你的输出会被系统直接校验、编译并启动执行；任何 schema 错误、循环依赖、非法 agent 引用、非法 agents.available 或缺失 result 节点都会导致本次“立即执行”失败。

当前可用团队成员：
{available_agents_json}

lead agent 标识：
{lead_agent_id}

请直接返回 workflow JSON。"#
    );

    let mut prompt = String::new();
    if let Some(reason) = previous_failure_reason
        .map(str::trim)
        .filter(|reason| !reason.is_empty())
    {
        prompt.push_str(
            "The previous generated workflow plan contained errors. Regenerate the workflow plan.\n",
        );
        prompt.push_str("Error details:\n");
        prompt.push_str(reason);
        prompt.push_str(
            "\n\nFix the error above in this regeneration request. Do not repeat the same failure.\n\n",
        );
    }
    prompt.push_str(&base_prompt);
    prompt.push_str("\n\nWorkflowPlanJson schema reference:\n");
    prompt.push_str(plan_schema_definition);
    prompt.push_str("\n\nAdditional constraints:\n");
    prompt.push_str("- version must be string \"1\"\n");
    prompt.push_str("- agents.lead must equal ");
    prompt.push_str(lead_agent_id);
    prompt.push_str("\n");
    prompt.push_str(
        "- agents.available and nodes[].data.agentId may only use the provided agent_id values\n",
    );
    prompt.push_str(
        "- globals, viewport, policies, and node/edge optional fields may be omitted when unnecessary\n",
    );
    prompt.push_str(
        "- Review loop rules: a review node creates a retry loop only when nodes[].data.reviewScope is a non-empty array.\n",
    );
    prompt.push_str(
        "- reviewScope is the exact list of task node ids that should be re-run if that review rejects the work; reviewScope may contain task nodes only.\n",
    );
    prompt.push_str(
        "- Every reviewScope task must be an upstream predecessor of that review node: there must be a directed path from the task to the review node.\n",
    );
    prompt.push_str(
        "- If a scoped task reaches the review through intermediate task nodes, include those intermediate task nodes in the same reviewScope so retry state stays consistent.\n",
    );
    prompt.push_str(
        "- Do not put the same task node in multiple reviewScope arrays; if two loops need similar work, split it into separate task nodes or keep shared setup outside reviewScope.\n",
    );
    prompt.push_str(
        "- Do not include result nodes, review nodes, nonexistent ids, duplicate ids, or downstream nodes in reviewScope.\n",
    );
    prompt
}

#[allow(unreachable_code)]
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

    return format!(
        r#"你正在执行 OpenTeams workflow mode 中的一个 step。
你必须只返回一个 JSON 对象，不要输出 Markdown、解释或额外文本。
成功时返回：
{{
  "type": "final_result",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "summary": "一句话总结本 step 的完成结果",
  "content": "完整结果内容",
  "outputs": ["如有产出文件，请返回工作区内相对路径"]
}}

失败时返回：
{{
  "type": "error",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "message": "失败原因",
  "content": "可选的详细错误上下文"
}}

需要用户决策时返回以下结构之一：
{{
  "type": "approval_request",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "title": "需要用户审批的事项",
  "description": "可选的审批说明"
}}

{{
  "type": "permission_request",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "title": "需要用户授权的操作",
  "description": "可选的权限说明"
}}

{{
  "type": "continue_confirmation",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "message": "请确认是否继续",
  "description": "可选的补充说明"
}}

{{
  "type": "input_request",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "prompt": "请用户补充需要的输入内容",
  "description": "可选的补充说明",
  "placeholder": "输入你需要用户填写的内容"
}}

约束：
1. `step_key` 必须保持为 `{step_key}`。
2. `execution_id` 必须保持为 `{execution_id}`。
3. 只允许返回 `final_result`、`error`、`approval_request`、`permission_request`、`continue_confirmation` 或 `input_request`。
4. `outputs` 仅填写工作区内相对路径。
5. 只有在确实需要用户审批、授权或继续确认时才返回 request 类消息。

workflow 目标：{workflow_goal}
step 类型：{step_type}
step 标题：{step_title}
step 指令：{step_instructions}

已完成前置步骤摘要：
{dependency_text}

"#,
        step_key = step.step_key,
        execution_id = execution.id,
        step_type = format!("{:?}", step.step_type).to_lowercase(),
        step_title = step.title,
        step_instructions = step.instructions,
    );

    format!(
        r#"你正在执行 OpenTeams workflow mode 中的一个 step。

你必须只返回一个 JSON 对象，不要输出 Markdown、解释或额外文本。

成功时返回：
{{
  "type": "final_result",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "summary": "一句话总结本 step 的完成结果",
  "content": "完整结果内容",
  "outputs": ["如有产出文件，请返回相对路径"]
}}

失败时返回：
{{
  "type": "error",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "message": "失败原因",
  "content": "可选的详细错误上下文"
}}

约束：
1. `step_key` 必须保持为 `{step_key}`。
2. `execution_id` 必须保持为 `{execution_id}`。
3. 只允许返回 `final_result` 或 `error`。
4. `outputs` 仅填写工作区内相对路径。

workflow 目标：{workflow_goal}
step 类型：{step_type}
step 标题：{step_title}
step 指令：
{step_instructions}

已完成前置步骤摘要：
{dependency_text}
"#,
        step_key = step.step_key,
        execution_id = execution.id,
        step_type = format!("{:?}", step.step_type).to_lowercase(),
        step_title = step.title,
        step_instructions = step.instructions,
    )
}

pub fn build_step_execution_prompt_with_schema(
    execution: &WorkflowExecution,
    workflow_goal: &str,
    step: &WorkflowStep,
    completed_dependency_summaries: &[String],
    step_transcript_context: Option<&str>,
) -> String {
    let mut prompt = build_step_execution_prompt(
        execution,
        workflow_goal,
        step,
        completed_dependency_summaries,
        step_transcript_context,
    );
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

pub fn build_lead_review_prompt(
    workflow_goal: &str,
    step: &WorkflowStep,
    result: &WorkflowStepRunResult,
    dependency_summaries: &[String],
    acceptance_criteria: &[String],
) -> String {
    let dependency_text = if dependency_summaries.is_empty() {
        "无".to_string()
    } else {
        dependency_summaries.join("\n\n")
    };
    let acceptance_text = if acceptance_criteria.is_empty() {
        "无".to_string()
    } else {
        acceptance_criteria
            .iter()
            .map(|item| format!("- {}", item.trim()))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let outputs_text = if result.outputs.is_empty() {
        "无".to_string()
    } else {
        result
            .outputs
            .iter()
            .map(|item| format!("- {}", item.trim()))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        r#"## 审核任务

你是本次 workflow 的 Lead Agent，请审核以下执行节点的结果。

### workflow 目标
{workflow_goal}

### 被审核节点信息
- step 标题：{step_title}
- step 指令：{step_instructions}
- 验收标准：
{acceptance_text}

### 执行结果
摘要：{step_summary}
详细内容：{step_content}
产出文件：
{step_outputs}

### 前置依赖结果摘要
{dependency_text}

### 审核要求
请从以下维度评估执行结果：
1. 是否完成了 step 指令要求的所有内容
2. 结果质量是否满足验收标准
3. 是否与 workflow 整体目标一致
4. 是否有明显的错误或遗漏

### 返回格式
通过时返回：
{{
  "type": "review_result",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "verdict": "approved",
  "feedback": "审核通过的简要说明"
}}

不通过时返回：
{{
  "type": "review_result",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "verdict": "rejected",
  "feedback": "详细说明不通过的原因和需要修改的具体内容"
}}"#,
        workflow_goal = workflow_goal,
        step_title = step.title,
        step_instructions = step.instructions,
        acceptance_text = acceptance_text,
        step_summary = result.summary,
        step_content = result.content,
        step_outputs = outputs_text,
        dependency_text = dependency_text,
        step_key = step.step_key,
        execution_id = step.execution_id,
    )
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

pub fn build_step_revision_prompt(
    step: &WorkflowStep,
    feedback_source: WorkflowRevisionFeedbackSource,
    feedback_content: &str,
    previous_summary: &str,
    retry_count: i32,
) -> String {
    let source_section = match feedback_source {
        WorkflowRevisionFeedbackSource::Lead => format!(
            r#"## 修改要求 (第 {retry_count} 次修改)

你之前的执行结果未通过 Lead Agent 审核。请根据以下审核意见修改你的工作。

### 审核意见
{feedback_content}

### 你上次的执行结果摘要
{previous_summary}

### 要求
1. 仔细阅读审核意见，理解问题所在
2. 针对审核意见中指出的问题进行修改
3. 保留上次执行中正确的部分，只修改有问题的部分
4. 修改完成后按照标准格式返回结果"#,
            retry_count = retry_count,
            feedback_content = feedback_content.trim(),
            previous_summary = previous_summary.trim(),
        ),
        WorkflowRevisionFeedbackSource::User => format!(
            r#"## 用户修改要求 (第 {retry_count} 次修改)

你之前的执行结果未通过用户审核。请根据用户的修改意见重新执行。

### 用户反馈
{feedback_content}

### 你上次的执行结果摘要
{previous_summary}

### 要求
1. 用户的反馈具有最高优先级，必须严格按照用户意见修改
2. 如果用户反馈与原始指令有冲突，以用户反馈为准
3. 保留上次执行中用户未提出异议的部分
4. 修改完成后按照标准格式返回结果"#,
            retry_count = retry_count,
            feedback_content = feedback_content.trim(),
            previous_summary = previous_summary.trim(),
        ),
    };

    format!(
        r#"{source_section}

### 原始任务指令
step 标题：{step_title}
step 指令：{step_instructions}"#,
        source_section = source_section,
        step_title = step.title,
        step_instructions = step.instructions,
    )
}

pub fn build_step_revision_prompt_with_schema(
    step: &WorkflowStep,
    feedback_source: WorkflowRevisionFeedbackSource,
    feedback_content: &str,
    previous_summary: &str,
    retry_count: i32,
) -> String {
    let mut prompt = build_step_revision_prompt(
        step,
        feedback_source,
        feedback_content,
        previous_summary,
        retry_count,
    );
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

pub fn parse_step_protocol_output(
    execution_id: Uuid,
    step_key: &str,
    raw_output: &str,
) -> Result<WorkflowStepProtocolMessage, WorkflowRuntimeError> {
    let payload = extract_json_payload(raw_output).ok_or_else(|| {
        WorkflowRuntimeError::Validation("step 输出中未找到 JSON 对象".to_string())
    })?;

    let message: WorkflowStepProtocolMessage = serde_json::from_str(&payload)?;
    match &message {
        WorkflowStepProtocolMessage::FinalResult {
            step_key: actual_step_key,
            execution_id: actual_execution_id,
            ..
        }
        | WorkflowStepProtocolMessage::Error {
            step_key: actual_step_key,
            execution_id: actual_execution_id,
            ..
        }
        | WorkflowStepProtocolMessage::ApprovalRequest {
            step_key: actual_step_key,
            execution_id: actual_execution_id,
            ..
        }
        | WorkflowStepProtocolMessage::PermissionRequest {
            step_key: actual_step_key,
            execution_id: actual_execution_id,
            ..
        }
        | WorkflowStepProtocolMessage::ContinueConfirmation {
            step_key: actual_step_key,
            execution_id: actual_execution_id,
            ..
        }
        | WorkflowStepProtocolMessage::InputRequest {
            step_key: actual_step_key,
            execution_id: actual_execution_id,
            ..
        } => {
            if actual_step_key != step_key {
                return Err(WorkflowRuntimeError::Validation(format!(
                    "step protocol 的 step_key 非法，期望 '{}'，实际 '{}'",
                    step_key, actual_step_key
                )));
            }
            if actual_execution_id != &execution_id.to_string() {
                return Err(WorkflowRuntimeError::Validation(format!(
                    "step protocol 的 execution_id 非法，期望 '{}'，实际 '{}'",
                    execution_id, actual_execution_id
                )));
            }
        }
    }

    Ok(message)
}

pub fn parse_review_protocol_output(
    execution_id: Uuid,
    step_key: &str,
    raw_output: &str,
) -> Result<WorkflowReviewProtocolMessage, WorkflowRuntimeError> {
    tracing::debug!(
        "解析 review protocol 输出，execution_id: {}, step_key: {}, raw_output: {}",
        execution_id,
        step_key,
        raw_output
    );

    let payload = extract_json_payload(raw_output).ok_or_else(|| {
        WorkflowRuntimeError::Validation("review 输出中未找到 JSON 对象".to_string())
    })?;

    let message: WorkflowReviewProtocolMessage = serde_json::from_str(&payload)?;
    match &message {
        WorkflowReviewProtocolMessage::ReviewResult {
            step_key: actual_step_key,
            execution_id: actual_execution_id,
            feedback,
            ..
        } => {
            if actual_step_key != step_key {
                return Err(WorkflowRuntimeError::Validation(format!(
                    "review protocol 的 step_key 非法，期望 '{}'，实际 '{}'",
                    step_key, actual_step_key
                )));
            }
            if actual_execution_id != &execution_id.to_string() {
                return Err(WorkflowRuntimeError::Validation(format!(
                    "review protocol 的 execution_id 非法，期望 '{}'，实际 '{}'",
                    execution_id, actual_execution_id
                )));
            }
            if feedback.trim().is_empty() {
                return Err(WorkflowRuntimeError::Validation(
                    "review protocol 的 feedback 不能为空".to_string(),
                ));
            }
        }
    }

    Ok(message)
}

pub fn build_workflow_card_projection(
    execution: &WorkflowExecution,
    plan: &WorkflowPlan,
    revision: &WorkflowPlanRevision,
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
    let loop_key_by_step_key = steps
        .iter()
        .filter_map(|step| {
            step.loop_id
                .and_then(|loop_id| loop_key_by_loop_id.get(&loop_id).cloned())
                .or_else(|| plan_loop_key_by_step_key.get(&step.step_key).cloned())
                .map(|loop_key| (step.step_key.clone(), loop_key))
        })
        .collect::<HashMap<_, _>>();
    for node in &mut plan_json.nodes {
        if let Some(loop_key) = loop_key_by_step_key.get(&node.id) {
            node.data.loop_key = Some(loop_key.clone());
        }
    }

    let pending_review = build_pending_review(steps, loops, transcripts);

    let step_views = steps
        .iter()
        .map(|step| WorkflowCardStep {
            id: step.id.to_string(),
            step_key: step.step_key.clone(),
            title: step.title.clone(),
            step_type: to_workflow_wire_value(&step.step_type),
            status: to_workflow_wire_value(&step.status),
            review_phase: derive_step_review_phase(step, transcripts),
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
        .collect::<Vec<_>>();

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

    let loop_views = loops
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
        .collect::<Vec<_>>();

    let iteration_history = build_iteration_history(rounds, steps, iteration_feedbacks);

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
        iteration_history,
        plan: plan_json,
        started_at: execution.started_at.map(|value| value.to_rfc3339()),
        completed_at: execution.completed_at.map(|value| value.to_rfc3339()),
        validation_errors: None,
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
                        .last()
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

async fn finish_workflow_runtime_stream(
    msg_store: &Arc<MsgStore>,
    stream_task: &mut Option<tokio::task::JoinHandle<()>>,
) {
    msg_store.push_finished();
    if let Some(task) = stream_task.take() {
        let _ = time::timeout(WORKFLOW_DRAIN_TIMEOUT, task).await;
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_workflow_runtime_stream(
    pool: SqlitePool,
    chat_runner: ChatRunner,
    session_id: Uuid,
    execution_id: Uuid,
    workflow_agent_session_id: Option<Uuid>,
    step_id: Uuid,
    step_key: String,
    agent_id: Uuid,
    agent_name: String,
    msg_store: Arc<MsgStore>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut state = WorkflowRuntimeStreamState::default();
        let mut stream = msg_store.history_plus_stream();

        while let Some(item) = stream.next().await {
            let Ok(LogMsg::JsonPatch(patch)) = item else {
                continue;
            };

            for (stream_type, line) in state.drain_patch_lines(&patch) {
                let created_at = Utc::now().to_rfc3339();
                match persist_workflow_runtime_transcript_line(
                    &pool,
                    execution_id,
                    workflow_agent_session_id,
                    step_id,
                    &line,
                )
                .await
                {
                    Ok(_) => chat_runner.emit_workflow_runtime_line(
                        session_id,
                        execution_id,
                        workflow_agent_session_id,
                        step_id,
                        step_key.clone(),
                        agent_id,
                        agent_name.clone(),
                        stream_type,
                        line,
                        created_at,
                    ),
                    Err(error) => tracing::warn!(
                        execution_id = %execution_id,
                        step_id = %step_id,
                        workflow_agent_session_id = ?workflow_agent_session_id,
                        %error,
                        "failed to persist workflow runtime thinking line"
                    ),
                }
            }
        }

        for (stream_type, line) in state.flush_pending_lines() {
            let created_at = Utc::now().to_rfc3339();
            match persist_workflow_runtime_transcript_line(
                &pool,
                execution_id,
                workflow_agent_session_id,
                step_id,
                &line,
            )
            .await
            {
                Ok(_) => chat_runner.emit_workflow_runtime_line(
                    session_id,
                    execution_id,
                    workflow_agent_session_id,
                    step_id,
                    step_key.clone(),
                    agent_id,
                    agent_name.clone(),
                    stream_type,
                    line,
                    created_at,
                ),
                Err(error) => tracing::warn!(
                    execution_id = %execution_id,
                    step_id = %step_id,
                    workflow_agent_session_id = ?workflow_agent_session_id,
                    %error,
                    "failed to persist buffered workflow runtime thinking line"
                ),
            }
        }
    })
}

#[derive(Clone)]
struct WorkflowRuntimeStreamContext {
    pool: SqlitePool,
    chat_runner: ChatRunner,
    session_id: Uuid,
    execution_id: Uuid,
    workflow_agent_session_id: Option<Uuid>,
    step_id: Uuid,
    step_key: String,
    agent_id: Uuid,
    agent_name: String,
}

pub async fn run_workflow_agent_prompt(
    db: &DBService,
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    workflow_session: Option<&WorkflowAgentSession>,
    prompt: &str,
    step_id: Uuid,
) -> Result<String, WorkflowRuntimeError> {
    run_workflow_agent_prompt_inner(
        db,
        session,
        agent,
        session_agent,
        workflow_session,
        prompt,
        step_id,
        None,
        None,
        None,
    )
    .await
}

pub async fn run_workflow_step_agent_prompt(
    db: &DBService,
    chat_runner: &ChatRunner,
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    workflow_session: Option<&WorkflowAgentSession>,
    prompt: &str,
    step: &WorkflowStep,
) -> Result<String, WorkflowRuntimeError> {
    run_workflow_agent_prompt_inner(
        db,
        session,
        agent,
        session_agent,
        workflow_session,
        prompt,
        step.id,
        None,
        None,
        Some(WorkflowRuntimeStreamContext {
            pool: db.pool.clone(),
            chat_runner: chat_runner.clone(),
            session_id: session.id,
            execution_id: step.execution_id,
            workflow_agent_session_id: workflow_session.map(|item| item.id),
            step_id: step.id,
            step_key: step.step_key.clone(),
            agent_id: agent.id,
            agent_name: agent.name.clone(),
        }),
    )
    .await
}

pub async fn run_workflow_agent_follow_up(
    db: &DBService,
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    workflow_session: &WorkflowAgentSession,
    prompt: &str,
    step_id: Uuid,
) -> Result<String, WorkflowRuntimeError> {
    let resume_session_id = workflow_session
        .agent_session_id
        .as_deref()
        .or(session_agent.agent_session_id.as_deref())
        .ok_or_else(|| {
            WorkflowRuntimeError::Validation(format!(
                "workflow session {} missing persisted agent session id",
                workflow_session.id
            ))
        })?;

    run_workflow_agent_prompt_inner(
        db,
        session,
        agent,
        session_agent,
        Some(workflow_session),
        prompt,
        step_id,
        Some(resume_session_id),
        workflow_session.agent_message_id.as_deref(),
        None,
    )
    .await
}

pub async fn run_workflow_step_agent_follow_up(
    db: &DBService,
    chat_runner: &ChatRunner,
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    workflow_session: &WorkflowAgentSession,
    prompt: &str,
    step: &WorkflowStep,
) -> Result<String, WorkflowRuntimeError> {
    let resume_session_id = workflow_session
        .agent_session_id
        .as_deref()
        .or(session_agent.agent_session_id.as_deref())
        .ok_or_else(|| {
            WorkflowRuntimeError::Validation(format!(
                "workflow session {} missing persisted agent session id",
                workflow_session.id
            ))
        })?;

    run_workflow_agent_prompt_inner(
        db,
        session,
        agent,
        session_agent,
        Some(workflow_session),
        prompt,
        step.id,
        Some(resume_session_id),
        workflow_session.agent_message_id.as_deref(),
        Some(WorkflowRuntimeStreamContext {
            pool: db.pool.clone(),
            chat_runner: chat_runner.clone(),
            session_id: session.id,
            execution_id: step.execution_id,
            workflow_agent_session_id: Some(workflow_session.id),
            step_id: step.id,
            step_key: step.step_key.clone(),
            agent_id: agent.id,
            agent_name: agent.name.clone(),
        }),
    )
    .await
}

async fn run_workflow_agent_prompt_inner(
    db: &DBService,
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    workflow_session: Option<&WorkflowAgentSession>,
    prompt: &str,
    step_id: Uuid,
    resume_session_id: Option<&str>,
    reset_to_message_id: Option<&str>,
    stream_context: Option<WorkflowRuntimeStreamContext>,
) -> Result<String, WorkflowRuntimeError> {
    let workspace_path = resolve_workspace_path(session, agent, session_agent);
    fs::create_dir_all(&workspace_path).await?;

    let executor_profile_id = parse_executor_profile_id(agent)?;
    let mut executor =
        ExecutorConfigs::get_cached().get_coding_agent_or_default(&executor_profile_id);
    executor.use_approvals(Arc::new(NoopExecutorApprovalService));

    if let Some(model_name) = &agent.model_name
        && let Some(executor_with_model) = with_model(&executor, model_name)
    {
        executor = executor_with_model;
    }

    let repo_context = RepoContext::new(workspace_path.clone(), Vec::new());
    let mut env = ExecutionEnv::new(repo_context, false, String::new());
    env.insert("VK_WORKFLOW_SESSION_ID", session.id.to_string());
    env.insert("VK_WORKFLOW_AGENT_ID", agent.id.to_string());
    env.insert("VK_WORKFLOW_SESSION_AGENT_ID", session_agent.id.to_string());

    let mut spawned = match resume_session_id {
        Some(session_id) => {
            executor
                .spawn_follow_up(
                    workspace_path.as_path(),
                    prompt,
                    session_id,
                    reset_to_message_id,
                    &env,
                )
                .await?
        }
        None => {
            executor
                .spawn(workspace_path.as_path(), prompt, &env)
                .await?
        }
    };

    // Register the cancel token so interrupt_step can terminate this process.
    if let Some(cancel) = spawned.cancel.clone() {
        RUNNING_STEPS.insert(step_id, cancel);
    }

    let msg_store = Arc::new(MsgStore::new());
    spawn_log_forwarders(&mut spawned.child, msg_store.clone())?;
    executor.normalize_logs(msg_store.clone(), workspace_path.as_path());
    let mut workflow_stream_task = stream_context.as_ref().map(|context| {
        spawn_workflow_runtime_stream(
            context.pool.clone(),
            context.chat_runner.clone(),
            context.session_id,
            context.execution_id,
            context.workflow_agent_session_id,
            context.step_id,
            context.step_key.clone(),
            context.agent_id,
            context.agent_name.clone(),
            msg_store.clone(),
        )
    });

    let mut failed_by_signal = false;
    let mut interrupted = false;
    let mut status = None;

    if let Some(exit_signal) = spawned.exit_signal.take() {
        match time::timeout(WORKFLOW_EXECUTION_TIMEOUT, exit_signal).await {
            Ok(Ok(ExecutorExitResult::Success)) => {}
            Ok(Ok(ExecutorExitResult::Failure)) => {
                // Check if this failure was caused by an interrupt cancellation.
                if !RUNNING_STEPS.contains_key(&step_id) {
                    interrupted = true;
                } else {
                    failed_by_signal = true;
                }
            }
            Ok(Ok(ExecutorExitResult::FailureWithError(_))) => failed_by_signal = true,
            Ok(Err(_)) => {
                status = Some(wait_for_process_exit(&mut spawned, &agent.name).await?);
            }
            Err(_) => {
                terminate_child(&mut spawned).await;
                RUNNING_STEPS.remove(&step_id);
                finish_workflow_runtime_stream(&msg_store, &mut workflow_stream_task).await;
                return Err(WorkflowRuntimeError::Validation(format!(
                    "workflow 执行超时：{}",
                    agent.name
                )));
            }
        }

        if status.is_none() && !interrupted {
            match time::timeout(WORKFLOW_REAP_TIMEOUT, spawned.child.wait()).await {
                Ok(Ok(exit_status)) => status = Some(exit_status),
                Ok(Err(err)) => {
                    RUNNING_STEPS.remove(&step_id);
                    finish_workflow_runtime_stream(&msg_store, &mut workflow_stream_task).await;
                    return Err(WorkflowRuntimeError::Io(err));
                }
                Err(_) => terminate_child(&mut spawned).await,
            }
        }
    } else {
        status = Some(wait_for_process_exit(&mut spawned, &agent.name).await?);
    }

    // Unregister from the running steps map.
    RUNNING_STEPS.remove(&step_id);
    finish_workflow_runtime_stream(&msg_store, &mut workflow_stream_task).await;

    if interrupted {
        // Ensure the child is cleaned up.
        terminate_child(&mut spawned).await;
        return Err(WorkflowRuntimeError::Interrupted(format!(
            "workflow step 被中断：{}",
            agent.name
        )));
    }

    if failed_by_signal {
        return Err(WorkflowRuntimeError::Validation(format!(
            "workflow 执行失败：{}",
            agent.name
        )));
    }

    if let Some(exit_status) = status
        && !exit_status.success()
    {
        // Check if the non-zero exit was caused by interrupt.
        if spawned.cancel.as_ref().is_some_and(|c| c.is_cancelled()) {
            return Err(WorkflowRuntimeError::Interrupted(format!(
                "workflow step 被中断：{}",
                agent.name
            )));
        }
        return Err(WorkflowRuntimeError::Validation(format!(
            "workflow 执行失败：{}",
            agent.name
        )));
    }

    let history = msg_store.get_history();
    persist_workflow_runtime_session_ids(&db.pool, session_agent.id, workflow_session, &history)
        .await?;
    if let Some(context) = stream_context.as_ref() {
        persist_missing_workflow_runtime_thinking_transcripts(
            &context.pool,
            context.execution_id,
            context.workflow_agent_session_id,
            context.step_id,
            &history,
        )
        .await?;
    }
    extract_latest_assistant_from_history(&history).ok_or_else(|| {
        WorkflowRuntimeError::Validation(format!(
            "workflow agent '{}' 没有返回 assistant 输出",
            agent.name
        ))
    })
}

fn latest_agent_runtime_ids(history: &[LogMsg]) -> (Option<String>, Option<String>) {
    let mut agent_session_id = None;
    let mut agent_message_id = None;

    for entry in history {
        match entry {
            LogMsg::SessionId(value) => agent_session_id = Some(value.clone()),
            LogMsg::MessageId(value) => agent_message_id = Some(value.clone()),
            _ => {}
        }
    }

    (agent_session_id, agent_message_id)
}

async fn persist_workflow_runtime_session_ids(
    pool: &SqlitePool,
    session_agent_id: Uuid,
    workflow_session: Option<&WorkflowAgentSession>,
    history: &[LogMsg],
) -> Result<(), WorkflowRuntimeError> {
    let (agent_session_id, agent_message_id) = latest_agent_runtime_ids(history);

    if let Some(agent_session_id) = agent_session_id {
        ChatSessionAgent::update_agent_session_id(
            pool,
            session_agent_id,
            Some(agent_session_id.clone()),
        )
        .await?;
        if let Some(workflow_session) = workflow_session {
            WorkflowAgentSession::update_agent_session_id(
                pool,
                workflow_session.id,
                Some(agent_session_id),
            )
            .await?;
        }
    }

    if let Some(agent_message_id) = agent_message_id {
        ChatSessionAgent::update_agent_message_id(
            pool,
            session_agent_id,
            Some(agent_message_id.clone()),
        )
        .await?;
        if let Some(workflow_session) = workflow_session {
            WorkflowAgentSession::update_agent_message_id(
                pool,
                workflow_session.id,
                Some(agent_message_id),
            )
            .await?;
        }
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
) -> Vec<String> {
    let step_by_id: HashMap<Uuid, &WorkflowStep> = steps
        .iter()
        .map(|candidate| (candidate.id, candidate))
        .collect();

    edges
        .iter()
        .filter(|edge| edge.to_step_id == step.id)
        .filter_map(|edge| step_by_id.get(&edge.from_step_id).copied())
        .filter_map(|source_step| parse_summary_payload(source_step.summary_text.as_deref()))
        .map(|payload| payload.content.unwrap_or(payload.summary))
        .collect()
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

fn build_pending_review(
    steps: &[WorkflowStep],
    loops: &[WorkflowLoop],
    transcripts: &[WorkflowTranscript],
) -> Option<WorkflowPendingReview> {
    let transcript = transcripts.iter().find(|transcript| {
        matches!(
            transcript.entry_type.as_str(),
            "step_review" | "loop_review"
        ) && !matches!(
            transcript_meta_value(transcript).get("resolved"),
            Some(serde_json::Value::Bool(true))
        )
    })?;

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

fn resolve_workspace_path(
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

fn parse_runner_type(agent: &ChatAgent) -> Result<BaseCodingAgent, WorkflowRuntimeError> {
    let raw = agent.runner_type.trim();
    let normalized = raw.replace(['-', ' '], "_").to_ascii_uppercase();
    BaseCodingAgent::from_str(&normalized)
        .map_err(|_| WorkflowRuntimeError::Validation(format!("unknown runner type: {raw}")))
}

fn parse_executor_profile_id(agent: &ChatAgent) -> Result<ExecutorProfileId, WorkflowRuntimeError> {
    let executor = parse_runner_type(agent)?;
    let variant = agent
        .tools_enabled
        .0
        .as_object()
        .and_then(|value| value.get(EXECUTOR_PROFILE_VARIANT_KEY))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("DEFAULT"))
        .map(canonical_variant_key);

    Ok(match variant {
        Some(variant) => ExecutorProfileId::with_variant(executor, variant),
        None => ExecutorProfileId::new(executor),
    })
}

fn spawn_log_forwarders(
    child: &mut command_group::AsyncGroupChild,
    msg_store: Arc<MsgStore>,
) -> Result<(), WorkflowRuntimeError> {
    let stdout = child.inner().stdout.take().ok_or_else(|| {
        WorkflowRuntimeError::Validation("workflow child 缺少 stdout".to_string())
    })?;
    let stderr = child.inner().stderr.take().ok_or_else(|| {
        WorkflowRuntimeError::Validation("workflow child 缺少 stderr".to_string())
    })?;

    let stdout_store = msg_store.clone();
    tokio::spawn(async move {
        let mut stream = ReaderStream::new(stdout);
        let mut decoder = Utf8LossyDecoder::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    let text = decoder.decode_chunk(&bytes);
                    if !text.is_empty() {
                        stdout_store.push(LogMsg::Stdout(text));
                    }
                }
                Err(err) => stdout_store.push(LogMsg::Stderr(format!("stdout error: {err}"))),
            }
        }

        let tail = decoder.finish();
        if !tail.is_empty() {
            stdout_store.push(LogMsg::Stdout(tail));
        }
    });

    let stderr_store = msg_store;
    tokio::spawn(async move {
        let mut stream = ReaderStream::new(stderr);
        let mut decoder = Utf8LossyDecoder::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    let text = decoder.decode_chunk(&bytes);
                    if !text.is_empty() {
                        stderr_store.push(LogMsg::Stderr(text));
                    }
                }
                Err(err) => stderr_store.push(LogMsg::Stderr(format!("stderr error: {err}"))),
            }
        }

        let tail = decoder.finish();
        if !tail.is_empty() {
            stderr_store.push(LogMsg::Stderr(tail));
        }
    });

    Ok(())
}

async fn wait_for_process_exit(
    spawned: &mut SpawnedChild,
    agent_name: &str,
) -> Result<std::process::ExitStatus, WorkflowRuntimeError> {
    match time::timeout(WORKFLOW_EXECUTION_TIMEOUT, spawned.child.wait()).await {
        Ok(Ok(status)) => Ok(status),
        Ok(Err(err)) => Err(WorkflowRuntimeError::Io(err)),
        Err(_) => {
            terminate_child(spawned).await;
            Err(WorkflowRuntimeError::Validation(format!(
                "workflow agent '{}' 执行超时",
                agent_name
            )))
        }
    }
}

async fn terminate_child(spawned: &mut SpawnedChild) {
    if let Some(cancel) = spawned.cancel.take() {
        cancel.cancel();
    }
    let _ = spawned.child.kill().await;
    let _ = time::timeout(WORKFLOW_KILL_WAIT_TIMEOUT, spawned.child.wait()).await;
}

fn extract_latest_assistant_from_history(history: &[LogMsg]) -> Option<String> {
    let mut assistant_entries: HashMap<usize, String> = HashMap::new();

    for message in history {
        let LogMsg::JsonPatch(patch) = message else {
            continue;
        };

        let Some((index, entry)) = extract_normalized_entry_from_patch(patch) else {
            continue;
        };

        if matches!(entry.entry_type, NormalizedEntryType::AssistantMessage) {
            assistant_entries.insert(index, entry.content);
        }
    }

    assistant_entries
        .into_iter()
        .max_by_key(|(index, _)| *index)
        .map(|(_, content)| content.trim().to_string())
        .filter(|content| !content.is_empty())
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::{
        chat_agent::ChatAgent,
        chat_session_agent::{ChatSessionAgent, ChatSessionAgentState},
        workflow_plan::WorkflowPlan,
        workflow_plan_revision::WorkflowPlanRevision,
        workflow_types::{
            WorkflowPlanStatus, WorkflowRevisionEditor, WorkflowValidationStatus,
            to_workflow_wire_value,
        },
    };
    use sqlx::types::Json;

    use super::*;

    fn sample_plan_json() -> String {
        serde_json::json!({
            "version": "1",
            "title": "Projection Contract",
            "goal": "Verify projection statuses",
            "agents": {
                "lead": "agent-1",
                "available": ["agent-1"]
            },
            "nodes": [
                {
                    "id": "step-1",
                    "type": "workflowStep",
                    "position": { "x": 0.0, "y": 0.0 },
                    "data": {
                        "stepType": "task",
                        "agentId": "agent-1",
                        "title": "Step 1",
                        "instructions": "Run step 1"
                    }
                }
            ],
            "edges": []
        })
        .to_string()
    }

    fn sample_execution(status: WorkflowExecutionStatus) -> WorkflowExecution {
        let now = Utc::now();
        WorkflowExecution {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            plan_id: Uuid::new_v4(),
            active_revision_id: Some(Uuid::new_v4()),
            active_round_id: Some(Uuid::new_v4()),
            workflow_card_message_id: None,
            lead_session_agent_id: None,
            status,
            current_round: 1,
            title: "Projection Contract".to_string(),
            compiled_graph_hash: Some("hash".to_string()),
            started_at: None,
            completed_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn sample_plan(plan_id: Uuid) -> WorkflowPlan {
        let now = Utc::now();
        WorkflowPlan {
            id: plan_id,
            session_id: Uuid::new_v4(),
            source_message_id: None,
            created_by_session_agent_id: None,
            status: WorkflowPlanStatus::Ready,
            title: "Projection Contract".to_string(),
            summary_text: Some("Verify projection statuses".to_string()),
            plan_json: sample_plan_json(),
            plan_schema_version: 1,
            plan_hash: "hash".to_string(),
            validation_status: WorkflowValidationStatus::Valid,
            validation_errors_json: None,
            workflow_card_message_id: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn sample_revision(plan_id: Uuid, plan_json: String) -> WorkflowPlanRevision {
        WorkflowPlanRevision {
            id: Uuid::new_v4(),
            plan_id,
            revision_no: 1,
            edited_by: WorkflowRevisionEditor::Lead,
            editor_session_agent_id: None,
            reason: None,
            plan_json,
            plan_hash: "hash".to_string(),
            validation_status: WorkflowValidationStatus::Valid,
            validation_errors_json: None,
            created_at: Utc::now(),
        }
    }

    fn sample_step(status: WorkflowStepStatus) -> WorkflowStep {
        let now = Utc::now();
        WorkflowStep {
            id: Uuid::new_v4(),
            execution_id: Uuid::new_v4(),
            round_id: Uuid::new_v4(),
            compiled_revision_id: None,
            step_key: "step-1".to_string(),
            step_type: WorkflowStepType::Task,
            title: "Step 1".to_string(),
            instructions: "Run step 1".to_string(),
            assigned_workflow_agent_session_id: None,
            status,
            retry_count: 0,
            max_retry: 1,
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

    fn sample_agent_views() -> (Vec<ChatSessionAgent>, Vec<ChatAgent>) {
        let now = Utc::now();
        let agent_id = Uuid::new_v4();
        let session_agent = ChatSessionAgent {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            agent_id,
            state: ChatSessionAgentState::Idle,
            workspace_path: None,
            pty_session_key: None,
            agent_session_id: None,
            agent_message_id: None,
            allowed_skill_ids: Json(Vec::new()),
            created_at: now,
            updated_at: now,
        };
        let agent = ChatAgent {
            id: agent_id,
            name: "Agent 1".to_string(),
            runner_type: "codex".to_string(),
            system_prompt: String::new(),
            tools_enabled: Json(serde_json::json!({})),
            model_name: None,
            created_at: now,
            updated_at: now,
        };

        (vec![session_agent], vec![agent])
    }

    fn sample_step_review(step: &WorkflowStep) -> WorkflowStepReview {
        WorkflowStepReview {
            id: Uuid::new_v4(),
            step_id: step.id,
            execution_id: step.execution_id,
            reviewer_type: db::models::workflow_types::ReviewerType::Lead,
            reviewer_id: Some(Uuid::new_v4().to_string()),
            verdict: ReviewVerdict::Approved,
            feedback: "Looks good".to_string(),
            review_round: 1,
            created_at: Utc::now(),
        }
    }

    fn sample_step_review_transcript(step: &WorkflowStep) -> WorkflowTranscript {
        WorkflowTranscript {
            id: Uuid::new_v4(),
            execution_id: step.execution_id,
            round_id: Some(step.round_id),
            workflow_agent_session_id: Some(Uuid::new_v4()),
            step_id: Some(step.id),
            sender_type: "control".to_string(),
            entry_type: "step_review".to_string(),
            content: format!("请审核步骤「{}」的执行结果", step.title),
            meta_json: Some(
                serde_json::json!({
                    "summary": "Need user confirmation",
                    "resolved": false,
                })
                .to_string(),
            ),
            created_at: Utc::now().to_rfc3339(),
        }
    }

    fn sample_step_run_result() -> WorkflowStepRunResult {
        WorkflowStepRunResult {
            run_id: Uuid::new_v4(),
            summary: "Implemented the requested fix".to_string(),
            content: "Updated the handler and added validation.".to_string(),
            outputs: vec!["src/handler.rs".to_string(), "tests/handler.rs".to_string()],
        }
    }

    #[test]
    fn build_plan_generation_prompt_includes_previous_failure_reason() {
        let prompt = build_plan_generation_prompt(
            "Ship the confirmed implementation plan.",
            "lead-agent-id",
            &[],
            Some("Missing result node in the previous workflow JSON."),
        );

        assert!(prompt.starts_with(
            "The previous generated workflow plan contained errors. Regenerate the workflow plan.\nError details:\nMissing result node in the previous workflow JSON."
        ));
        assert!(prompt.contains("Missing result node in the previous workflow JSON."));
        assert!(prompt.contains("Do not repeat the same failure."));
        assert!(prompt.contains("Ship the confirmed implementation plan."));
        assert!(!prompt.contains("\"userReview\": \"optional boolean"));
        assert!(!prompt.contains("\"leadReview\": \"optional boolean"));
        assert!(prompt.contains("不要输出或推断这两个字段"));
    }

    #[test]
    fn build_lead_review_prompt_includes_required_sections() {
        let step = sample_step(WorkflowStepStatus::Running);
        let result = sample_step_run_result();

        let prompt = build_lead_review_prompt(
            "Ship a stable workflow review loop.",
            &step,
            &result,
            &[
                "Dependency A done".to_string(),
                "Dependency B done".to_string(),
            ],
            &[
                "Must pass tests".to_string(),
                "Must preserve API contract".to_string(),
            ],
        );

        assert!(prompt.contains("## 审核任务"));
        assert!(prompt.contains("Ship a stable workflow review loop."));
        assert!(prompt.contains(&step.title));
        assert!(prompt.contains(&step.instructions));
        assert!(prompt.contains("Must pass tests"));
        assert!(prompt.contains("Must preserve API contract"));
        assert!(prompt.contains(&result.summary));
        assert!(prompt.contains(&result.content));
        assert!(prompt.contains("src/handler.rs"));
        assert!(prompt.contains("Dependency A done"));
        assert!(prompt.contains("\"type\": \"review_result\""));
        assert!(prompt.contains(&step.step_key));
        assert!(prompt.contains(&step.execution_id.to_string()));
    }

    #[test]
    fn build_step_revision_prompt_supports_lead_feedback_template() {
        let step = sample_step(WorkflowStepStatus::Revising);
        let prompt = build_step_revision_prompt(
            &step,
            WorkflowRevisionFeedbackSource::Lead,
            "补充错误处理和日志记录。",
            "已经完成主流程，但漏掉异常分支。",
            2,
        );

        assert!(prompt.contains("## 修改要求 (第 2 次修改)"));
        assert!(prompt.contains("未通过 Lead Agent 审核"));
        assert!(prompt.contains("补充错误处理和日志记录。"));
        assert!(prompt.contains("已经完成主流程，但漏掉异常分支。"));
        assert!(prompt.contains(&step.title));
        assert!(prompt.contains(&step.instructions));
    }

    #[test]
    fn build_step_revision_prompt_supports_user_feedback_template() {
        let step = sample_step(WorkflowStepStatus::Revising);
        let prompt = build_step_revision_prompt(
            &step,
            WorkflowRevisionFeedbackSource::User,
            "请把输出改成中文，并补一份测试说明。",
            "上次结果结构正确，但文案不符合预期。",
            1,
        );

        assert!(prompt.contains("## 用户修改要求 (第 1 次修改)"));
        assert!(prompt.contains("未通过用户审核"));
        assert!(prompt.contains("请把输出改成中文，并补一份测试说明。"));
        assert!(prompt.contains("上次结果结构正确，但文案不符合预期。"));
        assert!(prompt.contains("用户的反馈具有最高优先级"));
        assert!(prompt.contains(&step.title));
    }

    #[test]
    fn parse_review_protocol_output_accepts_approved_review() {
        let step = sample_step(WorkflowStepStatus::WaitingReview);
        let raw_output = format!(
            r#"{{
  "type": "review_result",
  "step_key": "{}",
  "execution_id": "{}",
  "verdict": "approved",
  "feedback": "结果满足验收标准。"
}}"#,
            step.step_key, step.execution_id
        );

        let message = parse_review_protocol_output(step.execution_id, &step.step_key, &raw_output)
            .expect("parse");

        assert_eq!(
            message,
            WorkflowReviewProtocolMessage::ReviewResult {
                step_key: step.step_key,
                execution_id: step.execution_id.to_string(),
                verdict: ReviewVerdict::Approved,
                feedback: "结果满足验收标准。".to_string(),
            }
        );
    }

    #[test]
    fn parse_review_protocol_output_accepts_rejected_review() {
        let step = sample_step(WorkflowStepStatus::WaitingReview);
        let raw_output = format!(
            r#"{{
  "type": "review_result",
  "step_key": "{}",
  "execution_id": "{}",
  "verdict": "rejected",
  "feedback": "还缺少回归测试。"
}}"#,
            step.step_key, step.execution_id
        );

        let message = parse_review_protocol_output(step.execution_id, &step.step_key, &raw_output)
            .expect("parse");

        assert_eq!(
            message,
            WorkflowReviewProtocolMessage::ReviewResult {
                step_key: step.step_key,
                execution_id: step.execution_id.to_string(),
                verdict: ReviewVerdict::Rejected,
                feedback: "还缺少回归测试。".to_string(),
            }
        );
    }

    #[test]
    fn parse_review_protocol_output_rejects_invalid_review_payload() {
        let step = sample_step(WorkflowStepStatus::WaitingReview);
        let raw_output = format!(
            r#"{{
  "type": "review_result",
  "step_key": "{}",
  "execution_id": "{}",
  "verdict": "approved",
  "feedback": "   "
}}"#,
            step.step_key, step.execution_id
        );

        let err = parse_review_protocol_output(step.execution_id, &step.step_key, &raw_output)
            .expect_err("invalid");

        assert!(matches!(err, WorkflowRuntimeError::Validation(_)));
    }

    #[test]
    fn parse_step_protocol_output_accepts_approval_request() {
        let execution_id = Uuid::new_v4();
        let step_key = "review";
        let raw_output = format!(
            r#"{{
  "type": "approval_request",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "title": "Need approval",
  "description": "Please confirm the patch."
}}"#
        );

        let message =
            parse_step_protocol_output(execution_id, step_key, &raw_output).expect("parse");

        match message {
            WorkflowStepProtocolMessage::ApprovalRequest {
                title, description, ..
            } => {
                assert_eq!(title, "Need approval");
                assert_eq!(description.as_deref(), Some("Please confirm the patch."));
            }
            other => panic!("unexpected message: {other:?}"),
        }
    }

    #[test]
    fn parse_step_protocol_output_accepts_continue_confirmation() {
        let execution_id = Uuid::new_v4();
        let step_key = "review";
        let raw_output = format!(
            r#"{{
  "type": "continue_confirmation",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "message": "Continue with deployment?"
}}"#
        );

        let message =
            parse_step_protocol_output(execution_id, step_key, &raw_output).expect("parse");

        match message {
            WorkflowStepProtocolMessage::ContinueConfirmation { message, .. } => {
                assert_eq!(message, "Continue with deployment?");
            }
            other => panic!("unexpected message: {other:?}"),
        }
    }

    #[test]
    fn parse_step_protocol_output_accepts_input_request() {
        let execution_id = Uuid::new_v4();
        let step_key = "clarify";
        let raw_output = format!(
            r#"{{
  "type": "input_request",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "prompt": "Please provide the release tag",
  "placeholder": "v1.2.3"
}}"#
        );

        let message =
            parse_step_protocol_output(execution_id, step_key, &raw_output).expect("parse");

        match message {
            WorkflowStepProtocolMessage::InputRequest {
                prompt,
                placeholder,
                ..
            } => {
                assert_eq!(prompt, "Please provide the release tag");
                assert_eq!(placeholder.as_deref(), Some("v1.2.3"));
            }
            other => panic!("unexpected message: {other:?}"),
        }
    }

    #[test]
    fn parse_step_protocol_output_rejects_wrong_execution_id() {
        let execution_id = Uuid::new_v4();
        let raw_output = format!(
            r#"{{
  "type": "permission_request",
  "step_key": "review",
  "execution_id": "{}",
  "title": "Need permission"
}}"#,
            Uuid::new_v4()
        );

        let err =
            parse_step_protocol_output(execution_id, "review", &raw_output).expect_err("invalid");

        assert!(matches!(err, WorkflowRuntimeError::Validation(_)));
    }

    #[test]
    fn workflow_runtime_line_keeps_assistant_for_final_protocol_only() {
        let entry = NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::AssistantMessage,
            content: r#"{"type":"final_result","summary":"done"}"#.to_string(),
            metadata: None,
        };

        assert!(workflow_runtime_line_for_entry(&entry).is_none());
    }

    #[test]
    fn workflow_runtime_line_maps_reasoning_to_thinking() {
        let entry = NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::Thinking,
            content: "Checking the workflow state machine".to_string(),
            metadata: None,
        };

        let line = workflow_runtime_line_for_entry(&entry).expect("thinking line");

        assert!(matches!(line.stream_type, ChatStreamDeltaType::Thinking));
        assert_eq!(line.content, "Checking the workflow state machine");
        assert!(!line.immediate);
    }

    #[test]
    fn workflow_runtime_line_maps_file_edit_activity_to_thinking() {
        let entry = NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: "edit".to_string(),
                action_type: ActionType::FileEdit {
                    path: "frontend/src/pages/ui-new/chat/components/WorkflowWindow.tsx"
                        .to_string(),
                    changes: vec![FileChange::Edit {
                        unified_diff: "@@ -1 +1 @@\n-old\n+new\n".to_string(),
                        has_line_numbers: true,
                    }],
                },
                status: ToolStatus::Created,
            },
            content: "WorkflowWindow.tsx".to_string(),
            metadata: None,
        };

        let line = workflow_runtime_line_for_entry(&entry).expect("file edit line");

        assert!(matches!(line.stream_type, ChatStreamDeltaType::Thinking));
        assert!(line.immediate);
        assert!(line.content.contains("Started file edit"));
        assert!(line.content.contains("WorkflowWindow.tsx"));
        assert!(line.content.contains("1 edit"));
    }

    #[test]
    fn workflow_runtime_line_maps_mcp_progress_to_thinking_preview() {
        let entry = NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: "mcp:github:search_issues".to_string(),
                action_type: ActionType::Tool {
                    tool_name: "github.search_issues".to_string(),
                    arguments: None,
                    result: Some(ToolResult::markdown(
                        "Fetched 3 matching issues\nmore detail",
                    )),
                },
                status: ToolStatus::Created,
            },
            content: "search_issues".to_string(),
            metadata: None,
        };

        let line = workflow_runtime_line_for_entry(&entry).expect("mcp progress line");

        assert!(matches!(line.stream_type, ChatStreamDeltaType::Thinking));
        assert!(line.immediate);
        assert_eq!(
            line.content,
            "Started MCP tool: github.search_issues: Fetched 3 matching issues"
        );
    }

    #[test]
    fn workflow_projection_uses_canonical_wire_statuses() {
        let plan_json = sample_plan_json();
        let mut expected_step_statuses = [
            WorkflowStepStatus::Pending,
            WorkflowStepStatus::Ready,
            WorkflowStepStatus::Running,
            WorkflowStepStatus::InterruptRequested,
            WorkflowStepStatus::Interrupted,
            WorkflowStepStatus::WaitingInput,
            WorkflowStepStatus::WaitingReview,
            WorkflowStepStatus::Blocked,
            WorkflowStepStatus::Completed,
            WorkflowStepStatus::Failed,
            WorkflowStepStatus::Skipped,
            WorkflowStepStatus::Cancelled,
        ]
        .into_iter()
        .map(|status| {
            let execution = sample_execution(WorkflowExecutionStatus::Running);
            let plan = sample_plan(execution.plan_id);
            let revision = sample_revision(plan.id, plan_json.clone());
            let (session_agents, agents) = sample_agent_views();
            let projection = build_workflow_card_projection(
                &execution,
                &plan,
                &revision,
                &[sample_step(status.clone())],
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                &session_agents,
                &agents,
                None,
            )
            .expect("build projection");

            let expected_status = to_workflow_wire_value(&status);
            assert_eq!(projection.steps[0].status, expected_status);
            assert_eq!(
                projection.plan.nodes[0].data.status.as_deref(),
                Some(expected_status.as_str())
            );

            projection.steps[0].status.clone()
        })
        .collect::<Vec<_>>();
        expected_step_statuses.sort();

        assert!(expected_step_statuses.contains(&"waiting_input".to_string()));
        assert!(expected_step_statuses.contains(&"waiting_review".to_string()));
        assert!(expected_step_statuses.contains(&"interrupt_requested".to_string()));

        for status in [
            WorkflowExecutionStatus::Pending,
            WorkflowExecutionStatus::Running,
            WorkflowExecutionStatus::Failed,
            WorkflowExecutionStatus::Paused,
            WorkflowExecutionStatus::Recompiling,
            WorkflowExecutionStatus::Completed,
            WorkflowExecutionStatus::Waiting,
        ] {
            let execution = sample_execution(status.clone());
            let plan = sample_plan(execution.plan_id);
            let revision = sample_revision(plan.id, plan_json.clone());
            let (session_agents, agents) = sample_agent_views();
            let projection = build_workflow_card_projection(
                &execution,
                &plan,
                &revision,
                &[sample_step(WorkflowStepStatus::Completed)],
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                &session_agents,
                &agents,
                None,
            )
            .expect("build projection");

            assert_eq!(projection.execution_status, to_workflow_wire_value(&status));
            if matches!(status, WorkflowExecutionStatus::Recompiling) {
                assert!(matches!(projection.state, WorkflowCardState::Running));
            }
        }
    }

    #[test]
    fn workflow_projection_includes_pending_review_and_latest_review_fields() {
        let execution = sample_execution(WorkflowExecutionStatus::Waiting);
        let plan_json = sample_plan_json();
        let plan = sample_plan(execution.plan_id);
        let revision = sample_revision(plan.id, plan_json);
        let (session_agents, agents) = sample_agent_views();
        let mut step = sample_step(WorkflowStepStatus::WaitingInput);
        step.execution_id = execution.id;
        step.user_review_required = true;
        step.retry_count = 1;
        step.max_retry = 3;
        step.summary_text = Some(
            serde_json::json!({
                "summary": "Need user confirmation",
                "content": "Draft ready",
                "outputs": ["src/handler.rs"]
            })
            .to_string(),
        );
        let review = sample_step_review(&step);
        let transcript = sample_step_review_transcript(&step);

        let projection = build_workflow_card_projection(
            &execution,
            &plan,
            &revision,
            &[step.clone()],
            &[],
            &[],
            &[],
            &[],
            &[review],
            &[transcript],
            &[],
            &session_agents,
            &agents,
            None,
        )
        .expect("build projection");

        assert_eq!(
            projection.steps[0].review_phase.as_deref(),
            Some("user_review")
        );
        assert_eq!(projection.steps[0].retry_count, 1);
        assert_eq!(projection.steps[0].max_retry, 3);
        assert_eq!(
            projection.steps[0]
                .latest_review
                .as_ref()
                .map(|item| item.verdict.as_str()),
            Some("approved")
        );
        assert_eq!(
            projection
                .pending_review
                .as_ref()
                .map(|item| item.review_type.as_str()),
            Some("step_user_review")
        );
        assert_eq!(
            projection
                .pending_review
                .as_ref()
                .map(|item| item.target_id.as_str()),
            Some(projection.steps[0].id.as_str())
        );
    }
}
