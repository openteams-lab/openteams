#![allow(clippy::too_many_arguments)]

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    str::FromStr,
    sync::Arc,
    time::Duration,
};

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

use super::{
    chat_runner::{ChatRunner, ChatStreamDeltaType},
    config::UiLanguage,
};

const WORKFLOW_EXECUTION_TIMEOUT: Duration = Duration::from_secs(4800);
const WORKFLOW_DRAIN_TIMEOUT: Duration = Duration::from_millis(35);
const WORKFLOW_SESSION_ID_DRAIN_TIMEOUT: Duration = Duration::from_millis(350);
const WORKFLOW_REAP_TIMEOUT: Duration = Duration::from_secs(3);
const WORKFLOW_KILL_WAIT_TIMEOUT: Duration = Duration::from_secs(2);
const WORKFLOW_EXECUTOR_ERROR_MAX_CHARS: usize = 1600;
const WORKFLOW_EXECUTOR_ERROR_MAX_LINES: usize = 16;
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
    pub lead_review_required: bool,
    pub user_review_required: bool,
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
pub struct WorkflowPendingInput {
    pub input_id: String,
    pub step_id: String,
    pub step_key: String,
    pub target_title: String,
    pub prompt: String,
    pub description: Option<String>,
    pub placeholder: Option<String>,
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
pub struct WorkflowRoundGraph {
    pub round_id: String,
    pub round_index: i32,
    pub revision_id: String,
    pub status: String,
    pub plan: WorkflowPlanJson,
    pub steps: Vec<WorkflowCardStep>,
    pub loops: Vec<WorkflowCardLoop>,
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
    pub pending_input: Option<WorkflowPendingInput>,
    pub iteration_history: Vec<WorkflowIterationSummary>,
    pub round_graphs: Vec<WorkflowRoundGraph>,
    pub plan: WorkflowPlanJson,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub validation_errors: Option<String>,
    #[serde(default)]
    pub is_terminal: bool,
    #[serde(default)]
    pub has_transcripts: Option<bool>,
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
        NormalizedEntryType::ErrorMessage { .. } => Some(WorkflowRuntimeEntryLine {
            stream_type: ChatStreamDeltaType::Error,
            content: entry.content.clone(),
            immediate: true,
        }),
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

static STEP_EXECUTION_TDD_WORKFLOW_FOR_TASK_TYPE: &str = r#"

### TDD Workflow

If it is a coding task, follow Test-Driven Development for every implementation step:
1. **Red** — Write failing tests first that define the expected behavior. Run them to confirm they fail.
2. **Green** — Write the minimum implementation to make all tests pass. No extra features.
3. **Refactor** — Clean up code while keeping tests green. Improve naming, remove duplication, simplify logic.
4. If no test framework exists in the project, create minimal verification scripts that assert expected behavior before implementing.
"#;

static STEP_EXECUTION_TDD_WORKFLOW_FOR_REVIEW_TYPE: &str = r#"

## Review Discipline

Verify the worker's output independently; do not rely on their report.

Check:
- Read changed files from `outputs` and compare them with instructions and acceptance criteria.
- Reject missing requirements, unrequested scope, obvious bugs, edge-case gaps, or broken shared contracts.
- Run or inspect tests; confirm they prove real behavior and TDD was followed when required.
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
    } else if step.step_type == WorkflowStepType::Review {
        prompt.push_str("You are reviewing the output of the workers' implementation.\n\n");
    } else if step.step_type == WorkflowStepType::Result {
        prompt.push_str("You are reviewing the results of the current workflow execution.\n\n");
    }

    if step.step_type == WorkflowStepType::Task {
        prompt.push_str(STEP_EXECUTION_TDD_WORKFLOW_FOR_TASK_TYPE);
    } else if step.step_type == WorkflowStepType::Review {
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
- If TDD was required, was it followed?

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

    let pending_review = build_pending_review(steps, loops, transcripts);
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
        WorkflowExecutionStatus::Failed | WorkflowExecutionStatus::Cancelled => {
            WorkflowCardState::Failed
        }
        WorkflowExecutionStatus::Paused => WorkflowCardState::Paused,
        WorkflowExecutionStatus::Waiting => WorkflowCardState::Waiting,
        WorkflowExecutionStatus::Recompiling => WorkflowCardState::Running,
        _ => WorkflowCardState::Running,
    };

    let is_terminal = matches!(
        execution.status,
        WorkflowExecutionStatus::Completed
            | WorkflowExecutionStatus::Failed
            | WorkflowExecutionStatus::Cancelled
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

    let pending_review = build_pending_review(steps, loops, transcripts);
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
        WorkflowExecutionStatus::Failed | WorkflowExecutionStatus::Cancelled => {
            WorkflowCardState::Failed
        }
        WorkflowExecutionStatus::Paused => WorkflowCardState::Paused,
        WorkflowExecutionStatus::Waiting => WorkflowCardState::Waiting,
        WorkflowExecutionStatus::Recompiling => WorkflowCardState::Running,
        _ => WorkflowCardState::Running,
    };

    let is_terminal = matches!(
        execution.status,
        WorkflowExecutionStatus::Completed
            | WorkflowExecutionStatus::Failed
            | WorkflowExecutionStatus::Cancelled
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
                WorkflowStepStatus::Completed
                    | WorkflowStepStatus::Skipped
                    | WorkflowStepStatus::Cancelled
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

async fn finish_workflow_runtime_stream(
    msg_store: &Arc<MsgStore>,
    stream_task: &mut Option<tokio::task::JoinHandle<()>>,
) {
    msg_store.push_finished();
    if let Some(task) = stream_task.take() {
        let _ = time::timeout(WORKFLOW_DRAIN_TIMEOUT, task).await;
    }
}

async fn finish_workflow_runtime_session_id_persistor(
    session_id_task: &mut Option<tokio::task::JoinHandle<()>>,
) {
    if let Some(task) = session_id_task.take() {
        time::sleep(WORKFLOW_SESSION_ID_DRAIN_TIMEOUT).await;
        task.abort();
        let _ = task.await;
    }
}

fn spawn_workflow_runtime_session_id_persistor(
    pool: SqlitePool,
    session_agent_id: Uuid,
    workflow_agent_session_id: Option<Uuid>,
    msg_store: Arc<MsgStore>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut stream = msg_store.history_plus_stream();
        let mut last_agent_session_id: Option<String> = None;
        let mut last_agent_message_id: Option<String> = None;

        while let Some(item) = stream.next().await {
            match item {
                Ok(LogMsg::SessionId(agent_session_id)) => {
                    if last_agent_session_id.as_deref() == Some(agent_session_id.as_str()) {
                        continue;
                    }
                    last_agent_session_id = Some(agent_session_id.clone());

                    if let Err(error) = ChatSessionAgent::update_agent_session_id(
                        &pool,
                        session_agent_id,
                        Some(agent_session_id.clone()),
                    )
                    .await
                    {
                        tracing::warn!(
                            session_agent_id = %session_agent_id,
                            %error,
                            "failed to persist workflow runtime agent_session_id on session agent"
                        );
                    }

                    if let Some(workflow_agent_session_id) = workflow_agent_session_id
                        && let Err(error) = WorkflowAgentSession::update_agent_session_id(
                            &pool,
                            workflow_agent_session_id,
                            Some(agent_session_id),
                        )
                        .await
                    {
                        tracing::warn!(
                            workflow_agent_session_id = %workflow_agent_session_id,
                            %error,
                            "failed to persist workflow runtime agent_session_id on workflow agent session"
                        );
                    }
                }
                Ok(LogMsg::MessageId(agent_message_id)) => {
                    if last_agent_message_id.as_deref() == Some(agent_message_id.as_str()) {
                        continue;
                    }
                    last_agent_message_id = Some(agent_message_id.clone());

                    if let Err(error) = ChatSessionAgent::update_agent_message_id(
                        &pool,
                        session_agent_id,
                        Some(agent_message_id.clone()),
                    )
                    .await
                    {
                        tracing::warn!(
                            session_agent_id = %session_agent_id,
                            %error,
                            "failed to persist workflow runtime agent_message_id on session agent"
                        );
                    }

                    if let Some(workflow_agent_session_id) = workflow_agent_session_id
                        && let Err(error) = WorkflowAgentSession::update_agent_message_id(
                            &pool,
                            workflow_agent_session_id,
                            Some(agent_message_id),
                        )
                        .await
                    {
                        tracing::warn!(
                            workflow_agent_session_id = %workflow_agent_session_id,
                            %error,
                            "failed to persist workflow runtime agent_message_id on workflow agent session"
                        );
                    }
                }
                _ => {}
            }
        }
    })
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
    save_debug_workflow_prompt(
        &workspace_path,
        session,
        agent,
        session_agent,
        workflow_session,
        prompt,
        step_id,
        resume_session_id.is_some(),
        stream_context.as_ref(),
    )
    .await?;

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
    let mut session_id_task = Some(spawn_workflow_runtime_session_id_persistor(
        db.pool.clone(),
        session_agent.id,
        workflow_session.map(|item| item.id),
        msg_store.clone(),
    ));
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
                finish_workflow_runtime_session_id_persistor(&mut session_id_task).await;
                let history = msg_store.get_history();
                return Err(WorkflowRuntimeError::Validation(
                    workflow_executor_failure_message(&agent.name, "workflow 执行超时", &history),
                ));
            }
        }

        if status.is_none() && !interrupted {
            match time::timeout(WORKFLOW_REAP_TIMEOUT, spawned.child.wait()).await {
                Ok(Ok(exit_status)) => status = Some(exit_status),
                Ok(Err(err)) => {
                    RUNNING_STEPS.remove(&step_id);
                    finish_workflow_runtime_stream(&msg_store, &mut workflow_stream_task).await;
                    finish_workflow_runtime_session_id_persistor(&mut session_id_task).await;
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
    finish_workflow_runtime_session_id_persistor(&mut session_id_task).await;

    if interrupted {
        // Ensure the child is cleaned up.
        terminate_child(&mut spawned).await;
        return Err(WorkflowRuntimeError::Interrupted(format!(
            "workflow step 被中断：{}",
            agent.name
        )));
    }

    if failed_by_signal {
        let history = msg_store.get_history();
        return Err(WorkflowRuntimeError::Validation(
            workflow_executor_failure_message(&agent.name, "workflow 执行失败", &history),
        ));
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
        let history = msg_store.get_history();
        return Err(WorkflowRuntimeError::Validation(
            workflow_executor_failure_message(&agent.name, "workflow 执行失败", &history),
        ));
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
        WorkflowRuntimeError::Validation(
            workflow_executor_failure_message(
                &agent.name,
                "workflow agent 没有返回 assistant 输出",
                &history,
            )
            .to_string(),
        )
    })
}

#[allow(clippy::too_many_arguments)]
async fn save_debug_workflow_prompt(
    workspace_path: &std::path::Path,
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    workflow_session: Option<&WorkflowAgentSession>,
    prompt: &str,
    step_id: Uuid,
    is_follow_up: bool,
    stream_context: Option<&WorkflowRuntimeStreamContext>,
) -> Result<(), WorkflowRuntimeError> {
    if !std::env::var("DEBUG_WORKFLOW_PROMPT")
        .map(|value| value.eq_ignore_ascii_case("TRUE"))
        .unwrap_or(false)
    {
        return Ok(());
    }

    let prompt_dir = workspace_path
        .join(".openteams")
        .join("debug")
        .join("workflow_prompts")
        .join(session.id.to_string());
    fs::create_dir_all(&prompt_dir).await?;

    let run_kind = if is_follow_up { "follow_up" } else { "initial" };
    let prompt_kind = infer_workflow_prompt_debug_kind(prompt, is_follow_up);
    let agent_name = sanitize_debug_prompt_filename_component(&agent.name);
    let step_feature = stream_context
        .map(|context| format!("step_{}", context.step_key.as_str()))
        .or_else(|| extract_workflow_prompt_step_key(prompt).map(|key| format!("step_{key}")))
        .unwrap_or_else(|| {
            if step_id == Uuid::nil() {
                "workflow".to_string()
            } else {
                format!("step_{step_id}")
            }
        });
    let timestamp_ms = Utc::now().timestamp_millis();
    let filename = format!(
        "{}_{}_{}_{}_{}.md",
        timestamp_ms,
        sanitize_debug_prompt_filename_component(&prompt_kind),
        sanitize_debug_prompt_filename_component(&step_feature),
        agent_name,
        Uuid::new_v4()
    );
    let path = prompt_dir.join(filename);
    let workflow_session_id = workflow_session
        .map(|item| item.id.to_string())
        .unwrap_or_else(|| "none".to_string());
    let content = format!(
        "---\nsession_id: {}\nagent_id: {}\nagent_name: {}\nsession_agent_id: {}\nworkflow_agent_session_id: {}\nstep_id: {}\nstep_key: {}\nkind: {}\nprompt_kind: {}\ncreated_at: {}\n---\n\n{}",
        session.id,
        agent.id,
        agent.name,
        session_agent.id,
        workflow_session_id,
        step_id,
        stream_context
            .map(|context| context.step_key.as_str())
            .unwrap_or("none"),
        run_kind,
        prompt_kind,
        Utc::now().to_rfc3339(),
        prompt
    );
    fs::write(path, content).await?;
    Ok(())
}

fn infer_workflow_prompt_debug_kind(prompt: &str, is_follow_up: bool) -> String {
    let trimmed = prompt.trim_start();

    if let Some(rest) = trimmed.strip_prefix("Your previous workflow ") {
        if let Some((protocol_name, _)) = rest.split_once(" response") {
            return format!("protocol_retry_{}", protocol_name.trim().replace(' ', "_"));
        }
        return "protocol_retry".to_string();
    }

    if trimmed.starts_with("# Workflow Plan Generation") {
        if trimmed.contains("## Iteration Context")
            || trimmed.contains("Iteration request: user rejected")
        {
            return "iteration_feedback_plan_generation".to_string();
        }
        if trimmed.contains("Previous generation failed.") {
            return "plan_generation_retry".to_string();
        }
        if trimmed.contains("Existing workflow plan JSON:") {
            return "plan_regeneration".to_string();
        }
        return "plan_generation".to_string();
    }

    if trimmed.starts_with("You are reviewing a worker's step task output.") {
        return "lead_review".to_string();
    }

    if trimmed.contains("loop_review_result") {
        return "loop_review".to_string();
    }

    if trimmed.starts_with("You are revising a step in an workflow") {
        if trimmed.contains("## User Revision Required") {
            return "step_revision_user_feedback".to_string();
        }
        return "step_revision_review_feedback".to_string();
    }

    if trimmed.starts_with("The user has replied while workflow step") {
        return "step_follow_up_user_input".to_string();
    }

    if trimmed.starts_with("The previous attempt for workflow step") {
        return "step_follow_up_failed_restart".to_string();
    }

    if trimmed.starts_with("You are implementing a task in an workflow step.") {
        return "step_execution_task".to_string();
    }

    if trimmed.starts_with("You are reviewing the output of the workers' implementation.") {
        return "step_execution_review".to_string();
    }

    if trimmed.starts_with("You are reviewing the results of the current workflow execution.") {
        return "step_execution_result".to_string();
    }

    if is_follow_up {
        "workflow_follow_up".to_string()
    } else {
        "workflow_prompt".to_string()
    }
}

fn extract_workflow_prompt_step_key(prompt: &str) -> Option<String> {
    for marker in [
        "Fill `step_key` with `",
        "- step_key: ",
        "\"step_key\": \"",
        "step_key must stay exactly \"",
    ] {
        if let Some(value) = extract_after_marker(prompt, marker) {
            return Some(value);
        }
    }
    None
}

fn extract_after_marker(prompt: &str, marker: &str) -> Option<String> {
    let remainder = prompt.split_once(marker)?.1;
    let value = remainder
        .split(['`', '"', '\n', '\r'])
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    Some(value.to_string())
}

fn sanitize_debug_prompt_filename_component(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let trimmed = sanitized.trim_matches('_');
    if trimmed.is_empty() {
        "agent".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}

fn workflow_executor_failure_message(agent_name: &str, reason: &str, history: &[LogMsg]) -> String {
    let base = format!("{reason}：{agent_name}");
    let Some(excerpt) = workflow_executor_log_excerpt(history) else {
        return base;
    };

    format!("{base}\n\nExecutor error:\n{excerpt}")
}

fn workflow_executor_log_excerpt(history: &[LogMsg]) -> Option<String> {
    if let Some(error_excerpt) = workflow_executor_error_excerpt(history) {
        return Some(error_excerpt);
    }

    let stderr = history
        .iter()
        .filter_map(|msg| match msg {
            LogMsg::Stderr(value) => Some(value.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("");
    let stdout = history
        .iter()
        .filter_map(|msg| match msg {
            LogMsg::Stdout(value) => Some(value.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("");
    let output = if !stderr.trim().is_empty() {
        stderr
    } else {
        stdout
    };
    let output = output.trim();
    if output.is_empty() {
        return None;
    }

    Some(tail_chars(output, WORKFLOW_EXECUTOR_ERROR_MAX_CHARS))
}

fn workflow_executor_error_excerpt(history: &[LogMsg]) -> Option<String> {
    let mut lines = Vec::new();
    let mut stream_state = WorkflowRuntimeStreamState::default();

    for msg in history {
        match msg {
            LogMsg::JsonPatch(patch) => {
                if let Some((_index, entry)) = extract_normalized_entry_from_patch(patch) {
                    collect_workflow_error_lines_from_entry(&entry, &mut lines);
                }
                for (stream_type, line) in stream_state.drain_patch_lines(patch) {
                    if matches!(stream_type, ChatStreamDeltaType::Error)
                        || workflow_executor_line_has_error_signal(&line)
                    {
                        push_workflow_error_line(&mut lines, &line);
                    }
                }
            }
            LogMsg::Stderr(value) => collect_workflow_error_lines_from_text(value, &mut lines),
            LogMsg::Stdout(value) => collect_workflow_error_lines_from_text(value, &mut lines),
            _ => {}
        }
    }

    for (stream_type, line) in stream_state.flush_pending_lines() {
        if matches!(stream_type, ChatStreamDeltaType::Error)
            || workflow_executor_line_has_error_signal(&line)
        {
            push_workflow_error_line(&mut lines, &line);
        }
    }

    if lines.is_empty() {
        return None;
    }

    let selected = lines
        .into_iter()
        .rev()
        .take(WORKFLOW_EXECUTOR_ERROR_MAX_LINES)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");

    Some(tail_chars(&selected, WORKFLOW_EXECUTOR_ERROR_MAX_CHARS))
}

fn collect_workflow_error_lines_from_entry(entry: &NormalizedEntry, lines: &mut Vec<String>) {
    match &entry.entry_type {
        NormalizedEntryType::ErrorMessage { .. } => {
            push_workflow_error_line(lines, &entry.content);
        }
        NormalizedEntryType::ToolUse {
            tool_name,
            action_type,
            status,
        } if matches!(
            status,
            ToolStatus::Failed | ToolStatus::TimedOut | ToolStatus::Denied { .. }
        ) =>
        {
            if let Some(content) =
                workflow_tool_activity_content(tool_name, action_type, status, &entry.content)
            {
                push_workflow_error_line(lines, &content);
            }
        }
        _ => {}
    }
}

fn collect_workflow_error_lines_from_text(text: &str, lines: &mut Vec<String>) {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text.trim()) {
        collect_workflow_error_lines_from_json(&value, lines);
        return;
    }

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
            collect_workflow_error_lines_from_json(&value, lines);
            continue;
        }
        if workflow_executor_line_has_error_signal(line) {
            push_workflow_error_line(lines, line);
        }
    }
}

fn collect_workflow_error_lines_from_json(value: &serde_json::Value, lines: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                let key_lower = key.to_ascii_lowercase();
                let is_error_key = key_lower.contains("error")
                    || key_lower == "message"
                    || key_lower == "detail"
                    || key_lower == "details"
                    || key_lower == "stderr";
                match value {
                    serde_json::Value::String(text) if is_error_key => {
                        push_workflow_error_line(lines, text);
                    }
                    serde_json::Value::Object(_) | serde_json::Value::Array(_) => {
                        collect_workflow_error_lines_from_json(value, lines);
                    }
                    _ => {}
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_workflow_error_lines_from_json(item, lines);
            }
        }
        _ => {}
    }
}

fn workflow_executor_line_has_error_signal(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    [
        "error",
        "failed",
        "failure",
        "exception",
        "traceback",
        "panic",
        "fatal",
        "denied",
        "permission",
        "timed out",
        "timeout",
        "rate limit",
        "quota",
        "unauthorized",
        "forbidden",
        "api key",
        "context length",
        "overloaded",
        "unavailable",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn push_workflow_error_line(lines: &mut Vec<String>, line: &str) {
    let normalized = line.trim();
    if normalized.is_empty() {
        return;
    }
    for line in normalized
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let line = truncate_workflow_runtime_line(line);
        if lines.last().is_some_and(|existing| existing == &line) {
            continue;
        }
        lines.push(line);
    }
}

fn tail_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars().rev().take(max_chars).collect::<Vec<_>>();
    chars.reverse();
    let mut tail = chars.into_iter().collect::<String>();
    if value.chars().count() > max_chars {
        tail.insert_str(0, "...");
    }
    tail
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

const WORKFLOW_CLEANUP_RETENTION_DAYS: i64 = 5;

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkflowCleanupResult {
    pub execution_id: Uuid,
    pub transcripts_removed: u64,
    pub events_removed: u64,
    pub steps_cleared: u64,
}

pub async fn run_workflow_retention_janitor(
    pool: &SqlitePool,
) -> Result<Vec<WorkflowCleanupResult>, WorkflowRuntimeError> {
    let cutoff = Utc::now() - chrono::Duration::days(WORKFLOW_CLEANUP_RETENTION_DAYS);
    let executions =
        db::models::workflow_execution::WorkflowExecution::find_completed_before(pool, &cutoff)
            .await?;

    if executions.is_empty() {
        return Ok(Vec::new());
    }

    tracing::info!(
        execution_count = executions.len(),
        "Running workflow retention janitor for completed executions older than {} days",
        WORKFLOW_CLEANUP_RETENTION_DAYS
    );

    let mut results = Vec::new();
    for execution in executions {
        let transcripts_removed =
            db::models::workflow_transcript::WorkflowTranscript::delete_non_essential_by_execution(
                pool,
                execution.id,
            )
            .await?;

        let events_removed =
            db::models::workflow_event::WorkflowEvent::delete_by_execution(pool, execution.id)
                .await?;

        let steps_cleared = db::models::workflow_step::WorkflowStep::clear_content_for_execution(
            pool,
            execution.id,
        )
        .await?;

        db::models::workflow_execution::WorkflowExecution::mark_cleaned(
            pool,
            execution.id,
            "retention_janitor",
        )
        .await?;

        tracing::info!(
            execution_id = %execution.id,
            transcripts_removed,
            events_removed,
            steps_cleared,
            "Cleaned up completed workflow execution"
        );

        results.push(WorkflowCleanupResult {
            execution_id: execution.id,
            transcripts_removed,
            events_removed,
            steps_cleared,
        });
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::{
        chat_agent::ChatAgent,
        chat_session_agent::{ChatSessionAgent, ChatSessionAgentState},
        workflow_plan::WorkflowPlan,
        workflow_plan_revision::WorkflowPlanRevision,
        workflow_step_edge::WorkflowStepEdge,
        workflow_types::{
            WorkflowEdgeKind, WorkflowPlanStatus, WorkflowRevisionEditor, WorkflowValidationStatus,
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

    #[test]
    fn workflow_prompt_debug_kind_covers_iteration_and_reviews() {
        assert_eq!(
            infer_workflow_prompt_debug_kind(
                "# Workflow Plan Generation\n\n## Iteration Context\nfeedback",
                false,
            ),
            "iteration_feedback_plan_generation"
        );
        assert_eq!(
            infer_workflow_prompt_debug_kind(
                "You are reviewing a worker's step task output.\n\n## Step Under Review",
                false,
            ),
            "lead_review"
        );
        assert_eq!(
            infer_workflow_prompt_debug_kind(
                "You are revising a step in an workflow based on review feedback.\n\n## User Revision Required",
                true,
            ),
            "step_revision_user_feedback"
        );
        assert_eq!(
            infer_workflow_prompt_debug_kind(
                "Your previous workflow loop review output response did not match the required JSON protocol.",
                true,
            ),
            "protocol_retry_loop_review_output"
        );
    }

    #[test]
    fn workflow_prompt_debug_step_key_can_be_extracted_from_prompt() {
        assert_eq!(
            extract_workflow_prompt_step_key(
                "Return one JSON object. Fill `step_key` with `build_ui`, `execution_id` with `abc`."
            ),
            Some("build_ui".to_string())
        );
        assert_eq!(
            extract_workflow_prompt_step_key("Rules:\n- step_key: qa_review\n- execution_id: abc"),
            Some("qa_review".to_string())
        );
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
            cleaned_at: None,
            cleaned_reason: None,
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

    fn sample_edge(from_step_id: Uuid, to_step_id: Uuid) -> WorkflowStepEdge {
        WorkflowStepEdge {
            id: Uuid::new_v4(),
            execution_id: Uuid::new_v4(),
            compiled_revision_id: None,
            from_step_id,
            to_step_id,
            edge_kind: WorkflowEdgeKind::Hard,
            created_at: Utc::now(),
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
            None,
            "You MUST write human-readable JSON string values in Simplified Chinese.",
            None,
        );

        assert!(prompt.starts_with("# Workflow Plan Generation"));
        assert!(prompt.contains("## Stable Output Contract"));
        assert!(prompt.contains("## Dynamic Inputs"));
        assert!(prompt.contains("Missing result node in the previous workflow JSON."));
        assert!(prompt.contains("Do not repeat the same failure."));
        assert!(prompt.contains("Ship the confirmed implementation plan."));
        assert!(
            prompt.contains(
                "You MUST write human-readable JSON string values in Simplified Chinese."
            )
        );
        assert!(!prompt.contains("\"userReview\": \"optional boolean"));
        assert!(!prompt.contains("\"leadReview\": \"optional boolean"));
        assert!(prompt.contains("Do not output or infer `leadReview` or `userReview`."));
        assert!(
            prompt
                .find("## WorkflowPlanJson Schema Reference")
                .expect("schema section")
                < prompt
                    .find("## Dynamic Inputs")
                    .expect("dynamic inputs section")
        );
    }

    #[test]
    fn build_plan_generation_prompt_includes_previous_plan_json() {
        let previous_plan_json = r#"{"version":"1","title":"Existing Plan","goal":"Original goal","agents":{"lead":"lead-agent-id","available":["lead-agent-id"]},"nodes":[],"edges":[]}"#;
        let prompt = build_plan_generation_prompt(
            "Add regression coverage to the existing plan.",
            "lead-agent-id",
            &[],
            None,
            Some(previous_plan_json),
            "You MUST write human-readable JSON string values in English.",
            None,
        );

        assert!(prompt.contains("Existing workflow plan JSON"));
        assert!(prompt.contains(previous_plan_json));
        assert!(prompt.contains("Use this existing plan as the baseline."));
        assert!(prompt.contains("return the complete revised workflow plan JSON"));
    }

    #[test]
    fn workflow_response_language_instruction_follows_ui_language() {
        assert_eq!(
            resolve_workflow_response_language_instruction(&UiLanguage::ZhHans),
            "You MUST write human-readable JSON string values in Simplified Chinese."
        );
        assert_eq!(
            resolve_workflow_response_language_instruction(&UiLanguage::En),
            "You MUST write human-readable JSON string values in English."
        );
    }

    #[test]
    fn predecessor_summaries_for_task_include_dependency_node_details() {
        let mut source = sample_step(WorkflowStepStatus::Completed);
        source.step_key = "build-api".to_string();
        source.title = "Build API".to_string();
        source.instructions = "Implement the API".to_string();
        source.summary_text = Some(
            serde_json::json!({
                "summary": "API is implemented",
                "content": "Implemented the endpoint and tests.",
                "outputs": ["crates/server/src/routes/api.rs"]
            })
            .to_string(),
        );
        let mut target = sample_step(WorkflowStepStatus::Ready);
        target.step_key = "wire-ui".to_string();
        let edge = sample_edge(source.id, target.id);

        let contexts = predecessor_summaries(&target, &[source, target.clone()], &[edge], None);

        assert_eq!(contexts.len(), 1);
        assert!(contexts[0].contains("## Dependency Node: Build API"));
        assert!(contexts[0].contains("- Step key: build-api"));
        assert!(contexts[0].contains("- Type: task"));
        assert!(contexts[0].contains("Implement the API"));
        assert!(contexts[0].contains("Implemented the endpoint and tests."));
        assert!(contexts[0].contains("crates/server/src/routes/api.rs"));
    }

    #[test]
    fn predecessor_summaries_for_review_include_reviewed_loop_nodes() {
        let loop_id = Uuid::new_v4();
        let mut reviewed = sample_step(WorkflowStepStatus::Completed);
        reviewed.step_key = "draft".to_string();
        reviewed.title = "Draft Feature".to_string();
        reviewed.instructions = "Draft the feature".to_string();
        reviewed.loop_id = Some(loop_id);
        reviewed.summary_text = Some(
            serde_json::json!({
                "summary": "Draft complete",
                "content": "Feature draft is ready for review.",
                "outputs": ["frontend/src/feature.tsx"]
            })
            .to_string(),
        );
        let mut review = sample_step(WorkflowStepStatus::Ready);
        review.step_key = "review".to_string();
        review.title = "Review Feature".to_string();
        review.step_type = WorkflowStepType::Review;
        review.loop_id = Some(loop_id);

        let contexts = predecessor_summaries(&review, &[review.clone(), reviewed], &[], None);

        assert_eq!(contexts.len(), 1);
        assert!(contexts[0].contains("## Reviewed Loop Node: Draft Feature"));
        assert!(contexts[0].contains("- Step key: draft"));
        assert!(contexts[0].contains("- Type: task"));
        assert!(contexts[0].contains("Feature draft is ready for review."));
    }

    #[test]
    fn predecessor_summaries_for_result_include_formal_results_and_plan_json() {
        let plan = sample_plan(Uuid::new_v4());
        let mut source = sample_step(WorkflowStepStatus::Completed);
        source.step_key = "step-1".to_string();
        source.title = "Workflow Node Result".to_string();
        source.summary_text = Some(
            serde_json::json!({
                "summary": "Step complete",
                "content": "Done.",
                "outputs": []
            })
            .to_string(),
        );
        let mut result = sample_step(WorkflowStepStatus::Ready);
        result.step_key = "result".to_string();
        result.title = "Result".to_string();
        result.step_type = WorkflowStepType::Result;
        let edge = sample_edge(source.id, result.id);

        let contexts =
            predecessor_summaries(&result, &[source, result.clone()], &[edge], Some(&plan));

        assert!(contexts[0].contains("Formal Predecessor Results"));
        assert!(contexts[0].contains("## Formal Predecessor Result: Workflow Node Result"));
        assert!(contexts[0].contains("Step complete"));
        assert!(contexts[0].contains("Done."));
        assert!(
            contexts
                .iter()
                .any(|context| context.contains("Workflow Node Result"))
        );
        assert!(
            contexts
                .iter()
                .any(|context| context.contains("Full Workflow Plan JSON"))
        );
        assert!(
            contexts
                .iter()
                .any(|context| context.contains("\"title\": \"Projection Contract\""))
        );
    }

    #[test]
    fn predecessor_summaries_for_result_include_reviewer_conclusions() {
        let mut source = sample_step(WorkflowStepStatus::Completed);
        source.step_key = "step-1".to_string();
        source.title = "Build Feature".to_string();
        source.summary_text = Some(
            serde_json::json!({
                "summary": "Feature completed",
                "content": "Implemented and tested.",
                "outputs": []
            })
            .to_string(),
        );
        let mut result = sample_step(WorkflowStepStatus::Ready);
        result.step_key = "result".to_string();
        result.step_type = WorkflowStepType::Result;
        let edge = sample_edge(source.id, result.id);
        let review = sample_step_review(&source);

        let contexts = predecessor_summaries_with_reviews(
            &result,
            &[source, result.clone()],
            &[edge],
            None,
            &[review],
        );

        assert!(
            contexts
                .iter()
                .any(|context| context.contains("Reviewer Conclusions"))
        );
        assert!(contexts.iter().any(|context| context.contains("approved")));
        assert!(
            contexts
                .iter()
                .any(|context| context.contains("Looks good"))
        );
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

        assert!(prompt.contains("You are reviewing a worker's step task output."));
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
        assert!(prompt.contains("Language Requirement"));
    }

    #[test]
    fn build_step_revision_prompt_supports_lead_feedback_template() {
        let step = sample_step(WorkflowStepStatus::Revising);
        let prompt = build_step_revision_prompt(
            &step,
            WorkflowRevisionFeedbackSource::Lead,
            "补充错误处理和日志记录。",
            "已经完成主流程，但漏掉异常分支。",
            Some("Full previous lead result"),
            2,
        );

        assert!(prompt.contains("## Revision Required (attempt #2)"));
        assert!(prompt.contains("did not pass review"));
        assert!(prompt.contains("补充错误处理和日志记录。"));
        assert!(prompt.contains("已经完成主流程，但漏掉异常分支。"));
        assert!(prompt.contains(&step.title));
        assert!(prompt.contains(&step.instructions));
        // retry_count == 2, PUA should NOT be active
        assert!(!prompt.contains("Performance Improvement Plan"));
    }

    #[test]
    fn build_step_revision_prompt_supports_user_feedback_template() {
        let step = sample_step(WorkflowStepStatus::Revising);
        let prompt = build_step_revision_prompt(
            &step,
            WorkflowRevisionFeedbackSource::User,
            "请把输出改成中文，并补一份测试说明。",
            "上次结果结构正确，但文案不符合预期。",
            None,
            1,
        );

        assert!(prompt.contains("## User Revision Required (attempt #1)"));
        assert!(prompt.contains("did not pass user review"));
        assert!(prompt.contains("请把输出改成中文，并补一份测试说明。"));
        assert!(prompt.contains("上次结果结构正确，但文案不符合预期。"));
        assert!(prompt.contains("highest priority"));
        assert!(prompt.contains(&step.title));
    }

    #[test]
    fn build_step_revision_prompt_forces_pua_on_high_retry() {
        let step = sample_step(WorkflowStepStatus::Revising);
        let prompt = build_step_revision_prompt(
            &step,
            WorkflowRevisionFeedbackSource::Lead,
            "Still missing error handling.",
            "Previous attempt incomplete.",
            None,
            3,
        );

        assert!(prompt.contains("Skill Activation: `pua` (MANDATORY)"));
        assert!(prompt.contains("Performance Improvement Plan"));
        assert!(prompt.contains("attempt #3"));
        assert!(prompt.contains("Non-Negotiable One"));
        assert!(prompt.contains("Non-Negotiable Two"));
        assert!(prompt.contains("Non-Negotiable Three"));
        assert!(prompt.contains("fundamentally different"));
        assert!(prompt.contains("Bias for Action"));
        assert!(prompt.contains("Dive Deep"));
        assert!(prompt.contains("Ownership"));
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
    fn workflow_executor_failure_prefers_error_lines_from_stderr() {
        let history = vec![
            LogMsg::Stdout("normal progress\nmore normal progress\n".to_string()),
            LogMsg::Stderr(
                "debug detail that should not be surfaced\nERROR: model overloaded\n".to_string(),
            ),
        ];

        let message = workflow_executor_failure_message("codex", "workflow failed", &history);

        assert!(message.contains("Executor error:"));
        assert!(message.contains("ERROR: model overloaded"));
        assert!(!message.contains("debug detail that should not be surfaced"));
    }

    #[test]
    fn workflow_executor_failure_extracts_structured_json_error() {
        let history = vec![LogMsg::Stdout(
            serde_json::json!({
                "type": "error",
                "error": {
                    "message": "Gemini API key is invalid",
                    "debug": "large payload omitted"
                }
            })
            .to_string(),
        )];

        let message = workflow_executor_failure_message("gemini", "workflow failed", &history);

        assert!(message.contains("Gemini API key is invalid"));
        assert!(!message.contains("large payload omitted"));
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
                std::slice::from_ref(&revision),
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
                std::slice::from_ref(&revision),
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
            std::slice::from_ref(&revision),
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

    #[test]
    fn lightweight_projection_excludes_step_content() {
        let execution = sample_execution(WorkflowExecutionStatus::Completed);
        let plan_json = sample_plan_json();
        let plan = sample_plan(execution.plan_id);
        let revision = sample_revision(plan.id, plan_json);
        let (session_agents, agents) = sample_agent_views();
        let mut step = sample_step(WorkflowStepStatus::Completed);
        step.execution_id = execution.id;
        step.content = Some("Detailed implementation content".to_string());
        step.summary_text = Some(r#"{"summary":"Fixed the bug","outputs":[]}"#.to_string());

        let projection = build_workflow_card_projection_lightweight(
            &execution,
            &plan,
            &revision,
            std::slice::from_ref(&revision),
            &[step.clone()],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &session_agents,
            &agents,
            Some(42i64),
            None,
        )
        .expect("build lightweight projection");
        assert_eq!(projection.has_transcripts, Some(true));
        assert_eq!(projection.round_graphs.len(), 1);
        assert!(projection.round_graphs[0].steps[0].content.is_none());
        assert!(projection.steps[0].content.is_none());
        assert_eq!(
            projection.steps[0].summary_text.as_deref(),
            Some("Fixed the bug")
        );
    }

    #[test]
    fn is_terminal_true_for_completed_failed_and_cancelled() {
        for (status, expected_terminal) in [
            (WorkflowExecutionStatus::Completed, true),
            (WorkflowExecutionStatus::Failed, true),
            (WorkflowExecutionStatus::Cancelled, true),
            (WorkflowExecutionStatus::Running, false),
            (WorkflowExecutionStatus::Pending, false),
            (WorkflowExecutionStatus::Paused, false),
            (WorkflowExecutionStatus::Waiting, false),
        ] {
            let execution = sample_execution(status);
            let plan_json = sample_plan_json();
            let plan = sample_plan(execution.plan_id);
            let revision = sample_revision(plan.id, plan_json);
            let (session_agents, agents) = sample_agent_views();
            let projection = build_workflow_card_projection_lightweight(
                &execution,
                &plan,
                &revision,
                std::slice::from_ref(&revision),
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
                None,
            )
            .expect("build lightweight projection");
            assert_eq!(
                projection.is_terminal, expected_terminal,
                "is_terminal mismatch for status {:?}",
                execution.status
            );
        }
    }

    #[test]
    fn cancelled_execution_maps_to_failed_card_state_in_projections() {
        let execution = sample_execution(WorkflowExecutionStatus::Cancelled);
        let plan_json = sample_plan_json();
        let plan = sample_plan(execution.plan_id);
        let revision = sample_revision(plan.id, plan_json);
        let (session_agents, agents) = sample_agent_views();
        let step = sample_step(WorkflowStepStatus::Cancelled);

        let full = build_workflow_card_projection(
            &execution,
            &plan,
            &revision,
            std::slice::from_ref(&revision),
            std::slice::from_ref(&step),
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
        .expect("build full projection");
        assert!(matches!(full.state, WorkflowCardState::Failed));
        assert!(full.is_terminal);

        let lightweight = build_workflow_card_projection_lightweight(
            &execution,
            &plan,
            &revision,
            std::slice::from_ref(&revision),
            &[step],
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
            None,
        )
        .expect("build lightweight projection");
        assert!(matches!(lightweight.state, WorkflowCardState::Failed));
        assert!(lightweight.is_terminal);
    }
}
