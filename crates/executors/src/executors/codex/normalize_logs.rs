use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock},
};

use codex_app_server_protocol::{
    CommandExecutionStatus, JSONRPCNotification, JSONRPCRequest, JSONRPCResponse,
    McpToolCallResult, McpToolCallStatus, PatchApplyStatus, PatchChangeKind, ServerNotification,
    ServerRequest, ThreadItem, ThreadResumeResponse, ThreadStartResponse, TurnCompletedNotification,
    TurnPlanStepStatus, TurnStatus,
};
use codex_protocol::{
    openai_models::ReasoningEffort,
    plan_tool::{StepStatus, UpdatePlanArgs},
    protocol::{
        AgentMessageDeltaEvent, AgentMessageEvent, AgentReasoningDeltaEvent, AgentReasoningEvent,
        AgentReasoningSectionBreakEvent, ApplyPatchApprovalRequestEvent, BackgroundEventEvent,
        ErrorEvent, EventMsg, ExecApprovalRequestEvent, ExecCommandBeginEvent, ExecCommandEndEvent,
        ExecCommandOutputDeltaEvent, ExecOutputStream, FileChange as CodexProtoFileChange,
        McpInvocation, McpToolCallBeginEvent, McpToolCallEndEvent, PatchApplyBeginEvent,
        PatchApplyEndEvent, StreamErrorEvent, ViewImageToolCallEvent, WarningEvent,
        WebSearchBeginEvent, WebSearchEndEvent,
    },
};
use futures::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use workspace_utils::{
    approvals::ApprovalStatus, diff::normalize_unified_diff, msg_store::MsgStore,
    path::make_path_relative, utf8::Utf8LossyDecoder,
};

use crate::{
    approvals::ToolCallMetadata,
    executors::codex::session::SessionHandler,
    logs::{
        ActionType, CommandExitStatus, CommandRunResult, FileChange, NormalizedEntry,
        NormalizedEntryError, NormalizedEntryType, TodoItem, ToolResult, ToolResultValueType,
        ToolStatus,
        api_errors::detect_api_error,
        stderr_processor::normalize_stderr_logs,
        utils::{
            ConversationPatch, EntryIndexProvider,
            patch::{add_normalized_entry, replace_normalized_entry, upsert_normalized_entry},
        },
    },
};

trait ToNormalizedEntry {
    fn to_normalized_entry(&self) -> NormalizedEntry;
}

trait ToNormalizedEntryOpt {
    fn to_normalized_entry_opt(&self) -> Option<NormalizedEntry>;
}

#[derive(Debug, Deserialize)]
struct CodexNotificationParams {
    #[serde(rename = "msg")]
    msg: EventMsg,
}

#[derive(Default)]
struct StreamingText {
    index: usize,
    content: String,
}

#[derive(Default)]
struct CommandState {
    index: Option<usize>,
    command: String,
    stdout: String,
    stderr: String,
    stdout_decoder: Utf8LossyDecoder,
    stderr_decoder: Utf8LossyDecoder,
    formatted_output: Option<String>,
    status: ToolStatus,
    exit_code: Option<i32>,
    awaiting_approval: bool,
    call_id: String,
}

impl ToNormalizedEntry for CommandState {
    fn to_normalized_entry(&self) -> NormalizedEntry {
        let content = self.command.to_string();

        NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: "bash".to_string(),
                action_type: ActionType::CommandRun {
                    command: self.command.clone(),
                    result: Some(CommandRunResult {
                        exit_status: self
                            .exit_code
                            .map(|code| CommandExitStatus::ExitCode { code }),
                        output: if self.formatted_output.is_some() {
                            self.formatted_output.clone()
                        } else {
                            build_command_output(Some(&self.stdout), Some(&self.stderr))
                        },
                    }),
                },
                status: self.status.clone(),
            },
            content,
            metadata: serde_json::to_value(ToolCallMetadata {
                tool_call_id: self.call_id.clone(),
            })
            .ok(),
        }
    }
}

impl CommandState {
    fn new(command: String, call_id: String) -> Self {
        Self {
            index: None,
            command,
            stdout: String::new(),
            stderr: String::new(),
            stdout_decoder: Utf8LossyDecoder::new(),
            stderr_decoder: Utf8LossyDecoder::new(),
            formatted_output: None,
            status: ToolStatus::Created,
            exit_code: None,
            awaiting_approval: false,
            call_id,
        }
    }

    fn append_output_chunk(&mut self, stream: ExecOutputStream, chunk: &[u8]) {
        let decoded = match stream {
            ExecOutputStream::Stdout => self.stdout_decoder.decode_chunk(chunk),
            ExecOutputStream::Stderr => self.stderr_decoder.decode_chunk(chunk),
        };
        if decoded.is_empty() {
            return;
        }
        match stream {
            ExecOutputStream::Stdout => self.stdout.push_str(&decoded),
            ExecOutputStream::Stderr => self.stderr.push_str(&decoded),
        }
    }

    fn finalize_output_decoding(&mut self) {
        let stdout_tail = self.stdout_decoder.finish();
        if !stdout_tail.is_empty() {
            self.stdout.push_str(&stdout_tail);
        }
        let stderr_tail = self.stderr_decoder.finish();
        if !stderr_tail.is_empty() {
            self.stderr.push_str(&stderr_tail);
        }
    }
}

struct McpToolState {
    index: Option<usize>,
    invocation: McpInvocation,
    result: Option<ToolResult>,
    status: ToolStatus,
}

impl ToNormalizedEntry for McpToolState {
    fn to_normalized_entry(&self) -> NormalizedEntry {
        let tool_name = format!("mcp:{}:{}", self.invocation.server, self.invocation.tool);
        NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: tool_name.clone(),
                action_type: ActionType::Tool {
                    tool_name,
                    arguments: self.invocation.arguments.clone(),
                    result: self.result.clone(),
                },
                status: self.status.clone(),
            },
            content: self.invocation.tool.clone(),
            metadata: None,
        }
    }
}

#[derive(Default)]
struct WebSearchState {
    index: Option<usize>,
    query: Option<String>,
    status: ToolStatus,
}

impl WebSearchState {
    fn new() -> Self {
        Default::default()
    }
}

impl ToNormalizedEntry for WebSearchState {
    fn to_normalized_entry(&self) -> NormalizedEntry {
        NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: "web_search".to_string(),
                action_type: ActionType::WebFetch {
                    url: self.query.clone().unwrap_or_else(|| "...".to_string()),
                },
                status: self.status.clone(),
            },
            content: self
                .query
                .clone()
                .unwrap_or_else(|| "Web search".to_string()),
            metadata: None,
        }
    }
}

#[derive(Default)]
struct PatchState {
    entries: Vec<PatchEntry>,
}

struct PatchEntry {
    index: Option<usize>,
    path: String,
    changes: Vec<FileChange>,
    status: ToolStatus,
    awaiting_approval: bool,
    call_id: String,
}

impl ToNormalizedEntry for PatchEntry {
    fn to_normalized_entry(&self) -> NormalizedEntry {
        let content = self.path.clone();

        NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: "edit".to_string(),
                action_type: ActionType::FileEdit {
                    path: self.path.clone(),
                    changes: self.changes.clone(),
                },
                status: self.status.clone(),
            },
            content,
            metadata: serde_json::to_value(ToolCallMetadata {
                tool_call_id: self.call_id.clone(),
            })
            .ok(),
        }
    }
}

struct LogState {
    entry_index: EntryIndexProvider,
    assistant: Option<StreamingText>,
    thinking: Option<StreamingText>,
    commands: HashMap<String, CommandState>,
    mcp_tools: HashMap<String, McpToolState>,
    patches: HashMap<String, PatchState>,
    web_searches: HashMap<String, WebSearchState>,
}

enum StreamingTextKind {
    Assistant,
    Thinking,
}

impl LogState {
    fn new(entry_index: EntryIndexProvider) -> Self {
        Self {
            entry_index,
            assistant: None,
            thinking: None,
            commands: HashMap::new(),
            mcp_tools: HashMap::new(),
            patches: HashMap::new(),
            web_searches: HashMap::new(),
        }
    }

    fn streaming_text_update(
        &mut self,
        content: String,
        type_: StreamingTextKind,
        mode: UpdateMode,
    ) -> (NormalizedEntry, usize, bool) {
        let index_provider = &self.entry_index;
        let entry = match type_ {
            StreamingTextKind::Assistant => &mut self.assistant,
            StreamingTextKind::Thinking => &mut self.thinking,
        };
        let is_new = entry.is_none();
        let (content, index) = if entry.is_none() {
            let index = index_provider.next();
            *entry = Some(StreamingText { index, content });
            (&entry.as_ref().unwrap().content, index)
        } else {
            let streaming_state = entry.as_mut().unwrap();
            match mode {
                UpdateMode::Append => streaming_state.content.push_str(&content),
                UpdateMode::Set => streaming_state.content = content,
            }
            (&streaming_state.content, streaming_state.index)
        };
        let normalized_entry = NormalizedEntry {
            timestamp: None,
            entry_type: match type_ {
                StreamingTextKind::Assistant => NormalizedEntryType::AssistantMessage,
                StreamingTextKind::Thinking => NormalizedEntryType::Thinking,
            },
            content: content.clone(),
            metadata: None,
        };
        (normalized_entry, index, is_new)
    }

    fn streaming_text_append(
        &mut self,
        content: String,
        type_: StreamingTextKind,
    ) -> (NormalizedEntry, usize, bool) {
        self.streaming_text_update(content, type_, UpdateMode::Append)
    }

    fn streaming_text_set(
        &mut self,
        content: String,
        type_: StreamingTextKind,
    ) -> (NormalizedEntry, usize, bool) {
        self.streaming_text_update(content, type_, UpdateMode::Set)
    }

    fn assistant_message_append(&mut self, content: String) -> (NormalizedEntry, usize, bool) {
        self.streaming_text_append(content, StreamingTextKind::Assistant)
    }

    fn thinking_append(&mut self, content: String) -> (NormalizedEntry, usize, bool) {
        self.streaming_text_append(content, StreamingTextKind::Thinking)
    }

    fn assistant_message(&mut self, content: String) -> (NormalizedEntry, usize, bool) {
        self.streaming_text_set(content, StreamingTextKind::Assistant)
    }

    fn thinking(&mut self, content: String) -> (NormalizedEntry, usize, bool) {
        self.streaming_text_set(content, StreamingTextKind::Thinking)
    }
}

enum UpdateMode {
    Append,
    Set,
}

fn normalize_file_changes(
    worktree_path: &str,
    changes: &HashMap<PathBuf, CodexProtoFileChange>,
) -> Vec<(String, Vec<FileChange>)> {
    changes
        .iter()
        .map(|(path, change)| {
            let path_str = path.to_string_lossy();
            let relative = make_path_relative(path_str.as_ref(), worktree_path);
            let file_changes = match change {
                CodexProtoFileChange::Add { content } => vec![FileChange::Write {
                    content: content.clone(),
                }],
                CodexProtoFileChange::Delete { .. } => vec![FileChange::Delete],
                CodexProtoFileChange::Update {
                    unified_diff,
                    move_path,
                } => {
                    let mut edits = Vec::new();
                    if let Some(dest) = move_path {
                        let dest_rel =
                            make_path_relative(dest.to_string_lossy().as_ref(), worktree_path);
                        edits.push(FileChange::Rename { new_path: dest_rel });
                    }
                    let diff = normalize_unified_diff(&relative, unified_diff);
                    edits.push(FileChange::Edit {
                        unified_diff: diff,
                        has_line_numbers: true,
                    });
                    edits
                }
            };
            (relative, file_changes)
        })
        .collect()
}

fn format_todo_status(status: &StepStatus) -> String {
    match status {
        StepStatus::Pending => "pending",
        StepStatus::InProgress => "in_progress",
        StepStatus::Completed => "completed",
    }
    .to_string()
}

fn format_v2_todo_status(status: TurnPlanStepStatus) -> String {
    match status {
        TurnPlanStepStatus::Pending => "pending",
        TurnPlanStepStatus::InProgress => "in_progress",
        TurnPlanStepStatus::Completed => "completed",
    }
    .to_string()
}

fn normalize_v2_file_changes(
    worktree_path: &str,
    changes: &[codex_app_server_protocol::FileUpdateChange],
) -> Vec<(String, Vec<FileChange>)> {
    changes
        .iter()
        .map(|change| {
            let relative = make_path_relative(&change.path, worktree_path);
            let mut file_changes = Vec::new();

            match &change.kind {
                PatchChangeKind::Delete => file_changes.push(FileChange::Delete),
                PatchChangeKind::Add => file_changes.push(FileChange::Edit {
                    unified_diff: normalize_unified_diff(&relative, &change.diff),
                    has_line_numbers: true,
                }),
                PatchChangeKind::Update { move_path } => {
                    if let Some(dest) = move_path {
                        let dest_rel =
                            make_path_relative(dest.to_string_lossy().as_ref(), worktree_path);
                        file_changes.push(FileChange::Rename { new_path: dest_rel });
                    }
                    file_changes.push(FileChange::Edit {
                        unified_diff: normalize_unified_diff(&relative, &change.diff),
                        has_line_numbers: true,
                    });
                }
            }

            (relative, file_changes)
        })
        .collect()
}

fn sync_patch_entries(
    patch_state: &mut PatchState,
    normalized: Vec<(String, Vec<FileChange>)>,
    status: ToolStatus,
    awaiting_approval: bool,
    call_id: &str,
    msg_store: &Arc<MsgStore>,
    entry_index: &EntryIndexProvider,
) {
    let normalized_len = normalized.len();
    let mut iter = normalized.into_iter();

    for entry in &mut patch_state.entries {
        if let Some((path, file_changes)) = iter.next() {
            entry.path = path;
            entry.changes = file_changes;
            entry.status = status.clone();
            entry.awaiting_approval = awaiting_approval;
            entry.call_id = call_id.to_string();
            if let Some(index) = entry.index {
                replace_normalized_entry(msg_store, index, entry.to_normalized_entry());
            } else {
                let index =
                    add_normalized_entry(msg_store, entry_index, entry.to_normalized_entry());
                entry.index = Some(index);
            }
        }
    }

    if normalized_len < patch_state.entries.len() {
        for entry in patch_state.entries.drain(normalized_len..) {
            if let Some(index) = entry.index {
                msg_store.push_patch(ConversationPatch::remove(index));
            }
        }
    }

    for (path, file_changes) in iter {
        let mut entry = PatchEntry {
            index: None,
            path,
            changes: file_changes,
            status: status.clone(),
            awaiting_approval,
            call_id: call_id.to_string(),
        };
        let index = add_normalized_entry(msg_store, entry_index, entry.to_normalized_entry());
        entry.index = Some(index);
        patch_state.entries.push(entry);
    }
}

fn update_patch_status(
    patch_state: &mut PatchState,
    status: ToolStatus,
    msg_store: &Arc<MsgStore>,
) {
    for entry in &mut patch_state.entries {
        entry.status = status.clone();
        if let Some(index) = entry.index {
            replace_normalized_entry(msg_store, index, entry.to_normalized_entry());
        }
    }
}

pub fn normalize_logs(msg_store: Arc<MsgStore>, worktree_path: &Path) {
    let entry_index = EntryIndexProvider::start_from(&msg_store);
    normalize_stderr_logs(msg_store.clone(), entry_index.clone());

    let worktree_path_str = worktree_path.to_string_lossy().to_string();
    tokio::spawn(async move {
        let mut state = LogState::new(entry_index.clone());
        // Use stdout_lines_stream_until_close to ensure we process all stdout,
        // including error messages that may arrive just before Finished signal.
        let mut stdout_lines = msg_store.stdout_lines_stream_until_close();

        while let Some(Ok(line)) = stdout_lines.next().await {
            if let Ok(error) = serde_json::from_str::<Error>(&line) {
                add_normalized_entry(&msg_store, &entry_index, error.to_normalized_entry());
                continue;
            }

            if let Ok(approval) = serde_json::from_str::<Approval>(&line) {
                if let Some(entry) = approval.to_normalized_entry_opt() {
                    add_normalized_entry(&msg_store, &entry_index, entry);
                }
                continue;
            }

            if let Ok(request) = serde_json::from_str::<JSONRPCRequest>(&line) {
                handle_jsonrpc_request(
                    request,
                    &mut state,
                    &msg_store,
                    &entry_index,
                    &worktree_path_str,
                );
                continue;
            }

            if let Ok(response) = serde_json::from_str::<JSONRPCResponse>(&line) {
                handle_jsonrpc_response(response, &msg_store, &entry_index);
                continue;
            }

            if let Ok(server_notification) = serde_json::from_str::<ServerNotification>(&line) {
                handle_server_notification(
                    server_notification,
                    &mut state,
                    &msg_store,
                    &entry_index,
                    &worktree_path_str,
                );
                continue;
            } else if let Some(session_id) = line
                .strip_prefix(r#"{"method":"sessionConfigured","params":{"sessionId":""#)
                .and_then(|suffix| SESSION_ID.captures(suffix).and_then(|caps| caps.get(1)))
            {
                // Best-effort extraction of session ID from logs in case the JSON parsing fails.
                // This could happen if the line is truncated due to size limits because it includes the full session history.
                msg_store.push_session_id(session_id.as_str().to_string());
                continue;
            }

            let notification: JSONRPCNotification = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(_) => continue,
            };

            if !notification.method.starts_with("codex/event") {
                continue;
            }

            let Some(params) = notification
                .params
                .and_then(|p| serde_json::from_value::<CodexNotificationParams>(p).ok())
            else {
                continue;
            };

            let event = params.msg;
            match event {
                EventMsg::SessionConfigured(payload) => {
                    msg_store.push_session_id(payload.session_id.to_string());
                    handle_model_params(
                        payload.model,
                        payload.reasoning_effort,
                        &msg_store,
                        &entry_index,
                    );
                }
                EventMsg::AgentMessageDelta(AgentMessageDeltaEvent { delta }) => {
                    state.thinking = None;
                    let (entry, index, is_new) = state.assistant_message_append(delta);
                    upsert_normalized_entry(&msg_store, index, entry, is_new);
                }
                EventMsg::AgentMessageContentDelta(event) => {
                    state.thinking = None;
                    let (entry, index, is_new) = state.assistant_message_append(event.delta);
                    upsert_normalized_entry(&msg_store, index, entry, is_new);
                }
                EventMsg::AgentReasoningDelta(AgentReasoningDeltaEvent { delta }) => {
                    state.assistant = None;
                    let (entry, index, is_new) = state.thinking_append(delta);
                    upsert_normalized_entry(&msg_store, index, entry, is_new);
                }
                EventMsg::ReasoningContentDelta(event) => {
                    state.assistant = None;
                    let (entry, index, is_new) = state.thinking_append(event.delta);
                    upsert_normalized_entry(&msg_store, index, entry, is_new);
                }
                EventMsg::AgentMessage(AgentMessageEvent { message, .. }) => {
                    state.thinking = None;
                    let (entry, index, is_new) = state.assistant_message(message);
                    upsert_normalized_entry(&msg_store, index, entry, is_new);
                    state.assistant = None;
                }
                EventMsg::AgentReasoning(AgentReasoningEvent { text }) => {
                    state.assistant = None;
                    let (entry, index, is_new) = state.thinking(text);
                    upsert_normalized_entry(&msg_store, index, entry, is_new);
                    state.thinking = None;
                }
                EventMsg::AgentReasoningSectionBreak(AgentReasoningSectionBreakEvent {
                    item_id: _,
                    summary_index: _,
                }) => {
                    state.assistant = None;
                    state.thinking = None;
                }
                EventMsg::ExecApprovalRequest(ExecApprovalRequestEvent {
                    call_id,
                    turn_id: _,
                    command,
                    cwd: _,
                    reason,
                    parsed_cmd: _,
                    proposed_execpolicy_amendment: _,
                    ..
                }) => {
                    state.assistant = None;
                    state.thinking = None;

                    let command_text = if command.is_empty() {
                        reason
                            .filter(|r| !r.is_empty())
                            .unwrap_or_else(|| "command execution".to_string())
                    } else {
                        command.join(" ")
                    };

                    let command_state = state.commands.entry(call_id.clone()).or_default();

                    if command_state.command.is_empty() {
                        command_state.command = command_text;
                    }
                    command_state.awaiting_approval = true;
                    if let Some(index) = command_state.index {
                        replace_normalized_entry(
                            &msg_store,
                            index,
                            command_state.to_normalized_entry(),
                        );
                    } else {
                        let index = add_normalized_entry(
                            &msg_store,
                            &entry_index,
                            command_state.to_normalized_entry(),
                        );
                        command_state.index = Some(index);
                    }
                }
                EventMsg::ApplyPatchApprovalRequest(ApplyPatchApprovalRequestEvent {
                    call_id,
                    turn_id: _,
                    changes,
                    reason: _,
                    grant_root: _,
                }) => {
                    state.assistant = None;
                    state.thinking = None;

                    let normalized = normalize_file_changes(&worktree_path_str, &changes);
                    let patch_state = state.patches.entry(call_id.clone()).or_default();

                    // Update existing entries in place to keep them in MsgStore
                    let normalized_len = normalized.len();
                    let mut iter = normalized.into_iter();
                    for entry in &mut patch_state.entries {
                        if let Some((path, file_changes)) = iter.next() {
                            entry.path = path;
                            entry.changes = file_changes;
                            entry.awaiting_approval = true;
                            if let Some(index) = entry.index {
                                replace_normalized_entry(
                                    &msg_store,
                                    index,
                                    entry.to_normalized_entry(),
                                );
                            } else {
                                let index = add_normalized_entry(
                                    &msg_store,
                                    &entry_index,
                                    entry.to_normalized_entry(),
                                );
                                entry.index = Some(index);
                            }
                        }
                    }

                    // Remove stale entries if new changes have fewer files
                    if normalized_len < patch_state.entries.len() {
                        for entry in patch_state.entries.drain(normalized_len..) {
                            if let Some(index) = entry.index {
                                msg_store.push_patch(ConversationPatch::remove(index));
                            }
                        }
                    }

                    // Add new entries if changes have more files
                    for (path, file_changes) in iter {
                        let mut entry = PatchEntry {
                            index: None,
                            path,
                            changes: file_changes,
                            status: ToolStatus::Created,
                            awaiting_approval: true,
                            call_id: call_id.clone(),
                        };
                        let index = add_normalized_entry(
                            &msg_store,
                            &entry_index,
                            entry.to_normalized_entry(),
                        );
                        entry.index = Some(index);
                        patch_state.entries.push(entry);
                    }
                }
                EventMsg::ExecCommandBegin(ExecCommandBeginEvent {
                    call_id,
                    turn_id: _,
                    command,
                    cwd: _,
                    parsed_cmd: _,
                    source: _,
                    interaction_input: _,
                    process_id: _,
                }) => {
                    state.assistant = None;
                    state.thinking = None;
                    let command_text = command.join(" ");
                    if command_text.is_empty() {
                        continue;
                    }
                    state.commands.insert(
                        call_id.clone(),
                        CommandState::new(command_text, call_id.clone()),
                    );
                    let command_state = state.commands.get_mut(&call_id).unwrap();
                    let index = add_normalized_entry(
                        &msg_store,
                        &entry_index,
                        command_state.to_normalized_entry(),
                    );
                    command_state.index = Some(index)
                }
                EventMsg::ExecCommandOutputDelta(ExecCommandOutputDeltaEvent {
                    call_id,
                    stream,
                    chunk,
                }) => {
                    if let Some(command_state) = state.commands.get_mut(&call_id) {
                        command_state.append_output_chunk(stream, &chunk);
                        let Some(index) = command_state.index else {
                            tracing::error!("missing entry index for existing command state");
                            continue;
                        };
                        replace_normalized_entry(
                            &msg_store,
                            index,
                            command_state.to_normalized_entry(),
                        );
                    }
                }
                EventMsg::ExecCommandEnd(ExecCommandEndEvent {
                    call_id,
                    turn_id: _,
                    command: _,
                    cwd: _,
                    parsed_cmd: _,
                    source: _,
                    interaction_input: _,
                    stdout: _,
                    stderr: _,
                    aggregated_output: _,
                    exit_code,
                    duration: _,
                    formatted_output,
                    process_id: _,
                    ..
                }) => {
                    if let Some(mut command_state) = state.commands.remove(&call_id) {
                        command_state.finalize_output_decoding();
                        command_state.formatted_output = Some(formatted_output);
                        command_state.exit_code = Some(exit_code);
                        command_state.awaiting_approval = false;
                        command_state.status = if exit_code == 0 {
                            ToolStatus::Success
                        } else {
                            ToolStatus::Failed
                        };
                        let Some(index) = command_state.index else {
                            tracing::error!("missing entry index for existing command state");
                            continue;
                        };
                        replace_normalized_entry(
                            &msg_store,
                            index,
                            command_state.to_normalized_entry(),
                        );
                    }
                }
                EventMsg::BackgroundEvent(BackgroundEventEvent { message }) => {
                    add_normalized_entry(
                        &msg_store,
                        &entry_index,
                        NormalizedEntry {
                            timestamp: None,
                            entry_type: NormalizedEntryType::SystemMessage,
                            content: format!("Background event: {message}"),
                            metadata: None,
                        },
                    );
                }
                EventMsg::StreamError(StreamErrorEvent {
                    message,
                    codex_error_info,
                    ..
                }) => {
                    add_normalized_entry(
                        &msg_store,
                        &entry_index,
                        NormalizedEntry {
                            timestamp: None,
                            entry_type: NormalizedEntryType::ErrorMessage {
                                error_type: NormalizedEntryError::Other,
                            },
                            content: format!("Stream error: {message} {codex_error_info:?}"),
                            metadata: None,
                        },
                    );
                }
                EventMsg::McpToolCallBegin(McpToolCallBeginEvent {
                    call_id,
                    invocation,
                    ..
                }) => {
                    state.assistant = None;
                    state.thinking = None;
                    state.mcp_tools.insert(
                        call_id.clone(),
                        McpToolState {
                            index: None,
                            invocation,
                            result: None,
                            status: ToolStatus::Created,
                        },
                    );
                    let mcp_tool_state = state.mcp_tools.get_mut(&call_id).unwrap();
                    let index = add_normalized_entry(
                        &msg_store,
                        &entry_index,
                        mcp_tool_state.to_normalized_entry(),
                    );
                    mcp_tool_state.index = Some(index);
                }
                EventMsg::McpToolCallEnd(McpToolCallEndEvent {
                    call_id, result, ..
                }) => {
                    if let Some(mut mcp_tool_state) = state.mcp_tools.remove(&call_id) {
                        match result {
                            Ok(value) => {
                                mcp_tool_state.status = if value.is_error.unwrap_or(false) {
                                    ToolStatus::Failed
                                } else {
                                    ToolStatus::Success
                                };
                                if let Some(text) = mcp_text_blocks_joined(&value.content, "\n") {
                                    mcp_tool_state.result = Some(ToolResult {
                                        r#type: ToolResultValueType::Markdown,
                                        value: Value::String(text),
                                    });
                                } else {
                                    mcp_tool_state.result = Some(ToolResult {
                                        r#type: ToolResultValueType::Json,
                                        value: value.structured_content.unwrap_or_else(|| {
                                            serde_json::to_value(value.content).unwrap_or_default()
                                        }),
                                    });
                                }
                            }
                            Err(err) => {
                                mcp_tool_state.status = ToolStatus::Failed;
                                mcp_tool_state.result = Some(ToolResult {
                                    r#type: ToolResultValueType::Markdown,
                                    value: Value::String(err),
                                });
                            }
                        };
                        let Some(index) = mcp_tool_state.index else {
                            tracing::error!("missing entry index for existing mcp tool state");
                            continue;
                        };
                        replace_normalized_entry(
                            &msg_store,
                            index,
                            mcp_tool_state.to_normalized_entry(),
                        );
                    }
                }
                EventMsg::PatchApplyBegin(PatchApplyBeginEvent {
                    call_id, changes, ..
                }) => {
                    state.assistant = None;
                    state.thinking = None;
                    let normalized = normalize_file_changes(&worktree_path_str, &changes);
                    if let Some(patch_state) = state.patches.get_mut(&call_id) {
                        let mut iter = normalized.into_iter();
                        for entry in &mut patch_state.entries {
                            if let Some((path, file_changes)) = iter.next() {
                                entry.path = path;
                                entry.changes = file_changes;
                            }
                            entry.status = ToolStatus::Created;
                            entry.awaiting_approval = false;
                            if let Some(index) = entry.index {
                                replace_normalized_entry(
                                    &msg_store,
                                    index,
                                    entry.to_normalized_entry(),
                                );
                            } else {
                                let index = add_normalized_entry(
                                    &msg_store,
                                    &entry_index,
                                    entry.to_normalized_entry(),
                                );
                                entry.index = Some(index);
                            }
                        }
                        for (path, file_changes) in iter {
                            let mut entry = PatchEntry {
                                index: None,
                                path,
                                changes: file_changes,
                                status: ToolStatus::Created,
                                awaiting_approval: false,
                                call_id: call_id.clone(),
                            };
                            let index = add_normalized_entry(
                                &msg_store,
                                &entry_index,
                                entry.to_normalized_entry(),
                            );
                            entry.index = Some(index);
                            patch_state.entries.push(entry);
                        }
                    } else {
                        let mut patch_state = PatchState::default();
                        for (path, file_changes) in normalized {
                            patch_state.entries.push(PatchEntry {
                                index: None,
                                path,
                                changes: file_changes,
                                status: ToolStatus::Created,
                                awaiting_approval: false,
                                call_id: call_id.clone(),
                            });
                            let patch_entry = patch_state.entries.last_mut().unwrap();
                            let index = add_normalized_entry(
                                &msg_store,
                                &entry_index,
                                patch_entry.to_normalized_entry(),
                            );
                            patch_entry.index = Some(index);
                        }
                        state.patches.insert(call_id, patch_state);
                    }
                }
                EventMsg::PatchApplyEnd(PatchApplyEndEvent {
                    call_id,
                    stdout: _,
                    stderr: _,
                    success,
                    ..
                }) => {
                    if let Some(patch_state) = state.patches.remove(&call_id) {
                        let status = if success {
                            ToolStatus::Success
                        } else {
                            ToolStatus::Failed
                        };
                        for mut entry in patch_state.entries {
                            entry.status = status.clone();
                            let Some(index) = entry.index else {
                                tracing::error!("missing entry index for existing patch entry");
                                continue;
                            };
                            replace_normalized_entry(
                                &msg_store,
                                index,
                                entry.to_normalized_entry(),
                            );
                        }
                    }
                }
                EventMsg::WebSearchBegin(WebSearchBeginEvent { call_id }) => {
                    state.assistant = None;
                    state.thinking = None;
                    state
                        .web_searches
                        .insert(call_id.clone(), WebSearchState::new());
                    let web_search_state = state.web_searches.get_mut(&call_id).unwrap();
                    let normalized_entry = web_search_state.to_normalized_entry();
                    let index = add_normalized_entry(&msg_store, &entry_index, normalized_entry);
                    web_search_state.index = Some(index);
                }
                EventMsg::WebSearchEnd(WebSearchEndEvent { call_id, query, .. }) => {
                    state.assistant = None;
                    state.thinking = None;
                    if let Some(mut entry) = state.web_searches.remove(&call_id) {
                        entry.status = ToolStatus::Success;
                        entry.query = Some(query.clone());
                        let normalized_entry = entry.to_normalized_entry();
                        let Some(index) = entry.index else {
                            tracing::error!("missing entry index for existing websearch entry");
                            continue;
                        };
                        replace_normalized_entry(&msg_store, index, normalized_entry);
                    }
                }
                EventMsg::ViewImageToolCall(ViewImageToolCallEvent { call_id: _, path }) => {
                    state.assistant = None;
                    state.thinking = None;
                    let path_str = path.to_string_lossy().to_string();
                    let relative_path = make_path_relative(&path_str, &worktree_path_str);
                    add_normalized_entry(
                        &msg_store,
                        &entry_index,
                        NormalizedEntry {
                            timestamp: None,
                            entry_type: NormalizedEntryType::ToolUse {
                                tool_name: "view_image".to_string(),
                                action_type: ActionType::FileRead {
                                    path: relative_path.clone(),
                                },
                                status: ToolStatus::Success,
                            },
                            content: relative_path.to_string(),
                            metadata: None,
                        },
                    );
                }
                EventMsg::PlanUpdate(UpdatePlanArgs { plan, explanation }) => {
                    let todos: Vec<TodoItem> = plan
                        .iter()
                        .map(|item| TodoItem {
                            content: item.step.clone(),
                            status: format_todo_status(&item.status),
                            priority: None,
                        })
                        .collect();
                    let explanation = explanation
                        .as_ref()
                        .map(|text| text.trim())
                        .filter(|text| !text.is_empty())
                        .map(|text| text.to_string());
                    let content = explanation.clone().unwrap_or_else(|| {
                        if todos.is_empty() {
                            "Plan updated".to_string()
                        } else {
                            format!("Plan updated ({} steps)", todos.len())
                        }
                    });

                    add_normalized_entry(
                        &msg_store,
                        &entry_index,
                        NormalizedEntry {
                            timestamp: None,
                            entry_type: NormalizedEntryType::ToolUse {
                                tool_name: "plan".to_string(),
                                action_type: ActionType::TodoManagement {
                                    todos,
                                    operation: "update".to_string(),
                                },
                                status: ToolStatus::Success,
                            },
                            content,
                            metadata: None,
                        },
                    );
                }
                EventMsg::Warning(WarningEvent { message }) => {
                    add_normalized_entry(
                        &msg_store,
                        &entry_index,
                        NormalizedEntry {
                            timestamp: None,
                            entry_type: NormalizedEntryType::ErrorMessage {
                                error_type: NormalizedEntryError::Other,
                            },
                            content: message,
                            metadata: None,
                        },
                    );
                }
                EventMsg::Error(ErrorEvent {
                    message,
                    codex_error_info,
                }) => {
                    add_normalized_entry(
                        &msg_store,
                        &entry_index,
                        NormalizedEntry {
                            timestamp: None,
                            entry_type: NormalizedEntryType::ErrorMessage {
                                error_type: NormalizedEntryError::Other,
                            },
                            content: format!("Error: {message} {codex_error_info:?}"),
                            metadata: None,
                        },
                    );
                }
                EventMsg::TokenCount(payload) => {
                    if let Some(info) = payload.info {
                        let last = &info.last_token_usage;
                        // Billable tokens = input + output (excluding cached_input_tokens)
                        let billable_tokens = (last.input_tokens + last.output_tokens) as u32;
                        let input = last.input_tokens as u32;
                        let output = last.output_tokens as u32;
                        let cache_read = last.cached_input_tokens as u32;

                        add_normalized_entry(
                            &msg_store,
                            &entry_index,
                            NormalizedEntry {
                                timestamp: None,
                                entry_type: NormalizedEntryType::TokenUsageInfo(
                                    crate::logs::TokenUsageInfo {
                                        total_tokens: billable_tokens,
                                        model_context_window: info
                                            .model_context_window
                                            .unwrap_or_default()
                                            as u32,
                                        input_tokens: Some(input),
                                        output_tokens: Some(output),
                                        cache_read_tokens: Some(cache_read),
                                        cache_write_tokens: None,
                                        // Now accurate: input + output only
                                        is_estimated: false,
                                    },
                                ),
                                content: format!(
                                    "Tokens used: {} / Context window: {}",
                                    billable_tokens,
                                    info.model_context_window.unwrap_or_default()
                                ),
                                metadata: None,
                            },
                        );
                    }
                }
                EventMsg::ContextCompacted(..) => {
                    add_normalized_entry(
                        &msg_store,
                        &entry_index,
                        NormalizedEntry {
                            timestamp: None,
                            entry_type: NormalizedEntryType::SystemMessage,
                            content: "Context compacted".to_string(),
                            metadata: None,
                        },
                    );
                }
                EventMsg::AgentReasoningRawContent(..)
                | EventMsg::AgentReasoningRawContentDelta(..)
                | EventMsg::ThreadRolledBack(..)
                | EventMsg::TurnStarted(..)
                | EventMsg::UserMessage(..)
                | EventMsg::TurnDiff(..)
                | EventMsg::GetHistoryEntryResponse(..)
                | EventMsg::McpListToolsResponse(..)
                | EventMsg::McpStartupComplete(..)
                | EventMsg::McpStartupUpdate(..)
                | EventMsg::DeprecationNotice(..)
                | EventMsg::UndoCompleted(..)
                | EventMsg::UndoStarted(..)
                | EventMsg::RawResponseItem(..)
                | EventMsg::ItemStarted(..)
                | EventMsg::ItemCompleted(..)
                | EventMsg::ReasoningRawContentDelta(..)
                | EventMsg::ListSkillsResponse(..)
                | EventMsg::SkillsUpdateAvailable
                | EventMsg::TurnAborted(..)
                | EventMsg::ShutdownComplete
                | EventMsg::EnteredReviewMode(..)
                | EventMsg::ExitedReviewMode(..)
                | EventMsg::TerminalInteraction(..)
                | EventMsg::ElicitationRequest(..)
                | EventMsg::TurnComplete(..)
                | EventMsg::CollabAgentSpawnBegin(..)
                | EventMsg::CollabAgentSpawnEnd(..)
                | EventMsg::CollabAgentInteractionBegin(..)
                | EventMsg::CollabAgentInteractionEnd(..)
                | EventMsg::CollabWaitingBegin(..)
                | EventMsg::CollabWaitingEnd(..)
                | EventMsg::CollabCloseBegin(..)
                | EventMsg::CollabCloseEnd(..) => {}
                _ => {
                    // Handle any new or untracked event types silently
                }
            }
        }
    });
}

fn handle_jsonrpc_request(
    request: JSONRPCRequest,
    state: &mut LogState,
    msg_store: &Arc<MsgStore>,
    entry_index: &EntryIndexProvider,
    _worktree_path: &str,
) {
    let Ok(server_request) = ServerRequest::try_from(request) else {
        return;
    };

    match server_request {
        ServerRequest::CommandExecutionRequestApproval { params, .. } => {
            let command_state = state
                .commands
                .entry(params.item_id.clone())
                .or_insert_with(|| {
                    CommandState::new(
                        params
                            .reason
                            .clone()
                            .unwrap_or_else(|| "command execution".to_string()),
                        params.item_id.clone(),
                    )
                });
            command_state.awaiting_approval = true;
            if let Some(index) = command_state.index {
                replace_normalized_entry(msg_store, index, command_state.to_normalized_entry());
            } else {
                let index = add_normalized_entry(
                    msg_store,
                    entry_index,
                    command_state.to_normalized_entry(),
                );
                command_state.index = Some(index);
            }
        }
        ServerRequest::FileChangeRequestApproval { params, .. } => {
            if let Some(patch_state) = state.patches.get_mut(&params.item_id) {
                for entry in &mut patch_state.entries {
                    entry.awaiting_approval = true;
                    if let Some(index) = entry.index {
                        replace_normalized_entry(msg_store, index, entry.to_normalized_entry());
                    }
                }
            }
        }
        ServerRequest::ExecCommandApproval { .. }
        | ServerRequest::ApplyPatchApproval { .. }
        | ServerRequest::ToolRequestUserInput { .. }
        | ServerRequest::McpServerElicitationRequest { .. }
        | ServerRequest::PermissionsRequestApproval { .. }
        | ServerRequest::DynamicToolCall { .. }
        | ServerRequest::ChatgptAuthTokensRefresh { .. } => {}
    }
}

fn handle_server_notification(
    server_notification: ServerNotification,
    state: &mut LogState,
    msg_store: &Arc<MsgStore>,
    entry_index: &EntryIndexProvider,
    worktree_path: &str,
) {
    match server_notification {
        ServerNotification::ThreadStarted(payload) => {
            if let Some(path) = payload.thread.path.clone()
                && let Ok(session_id) = SessionHandler::extract_session_id_from_rollout_path(path)
            {
                msg_store.push_session_id(session_id);
                return;
            }

            msg_store.push_session_id(payload.thread.id);
        }
        ServerNotification::ItemStarted(payload) => {
            handle_v2_item_started(payload.item, state, msg_store, entry_index, worktree_path);
        }
        ServerNotification::ItemCompleted(payload) => {
            handle_v2_item_completed(payload.item, state, msg_store, entry_index, worktree_path);
        }
        ServerNotification::AgentMessageDelta(payload) => {
            state.thinking = None;
            let (entry, index, is_new) = state.assistant_message_append(payload.delta);
            upsert_normalized_entry(msg_store, index, entry, is_new);
        }
        ServerNotification::ReasoningSummaryTextDelta(payload) => {
            state.assistant = None;
            let (entry, index, is_new) = state.thinking_append(payload.delta);
            upsert_normalized_entry(msg_store, index, entry, is_new);
        }
        ServerNotification::ReasoningTextDelta(payload) => {
            state.assistant = None;
            let (entry, index, is_new) = state.thinking_append(payload.delta);
            upsert_normalized_entry(msg_store, index, entry, is_new);
        }
        ServerNotification::ReasoningSummaryPartAdded(_) => {
            state.assistant = None;
            state.thinking = None;
        }
        ServerNotification::CommandExecutionOutputDelta(payload) => {
            if let Some(command_state) = state.commands.get_mut(&payload.item_id)
                && !payload.delta.is_empty()
            {
                command_state.stdout.push_str(&payload.delta);
                if let Some(index) = command_state.index {
                    replace_normalized_entry(msg_store, index, command_state.to_normalized_entry());
                }
            }
        }
        ServerNotification::FileChangeOutputDelta(payload) => {
            state.assistant = None;
            state.thinking = None;

            if payload.delta.trim_start().starts_with("Success.")
                && let Some(patch_state) = state.patches.get_mut(&payload.item_id)
            {
                update_patch_status(patch_state, ToolStatus::Success, msg_store);
            }
        }
        ServerNotification::FileChangePatchUpdated(payload) => {
            state.assistant = None;
            state.thinking = None;
            let normalized = normalize_v2_file_changes(worktree_path, &payload.changes);
            let patch_state = state.patches.entry(payload.item_id.clone()).or_default();
            sync_patch_entries(
                patch_state,
                normalized,
                ToolStatus::Created,
                false,
                &payload.item_id,
                msg_store,
                entry_index,
            );
        }
        ServerNotification::McpToolCallProgress(payload) => {
            if let Some(tool_state) = state.mcp_tools.get_mut(&payload.item_id)
                && !payload.message.is_empty()
            {
                tool_state.result = Some(ToolResult::markdown(payload.message));
                if let Some(index) = tool_state.index {
                    replace_normalized_entry(msg_store, index, tool_state.to_normalized_entry());
                }
            }
        }
        ServerNotification::TurnPlanUpdated(payload) => {
            let todos: Vec<TodoItem> = payload
                .plan
                .into_iter()
                .map(|item| TodoItem {
                    content: item.step,
                    status: format_v2_todo_status(item.status),
                    priority: None,
                })
                .collect();
            let explanation = payload
                .explanation
                .as_deref()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_string);
            let content = explanation.clone().unwrap_or_else(|| {
                if todos.is_empty() {
                    "Plan updated".to_string()
                } else {
                    format!("Plan updated ({} steps)", todos.len())
                }
            });

            add_normalized_entry(
                msg_store,
                entry_index,
                NormalizedEntry {
                    timestamp: None,
                    entry_type: NormalizedEntryType::ToolUse {
                        tool_name: "plan".to_string(),
                        action_type: ActionType::TodoManagement {
                            todos,
                            operation: "update".to_string(),
                        },
                        status: ToolStatus::Success,
                    },
                    content,
                    metadata: None,
                },
            );
        }
        ServerNotification::ThreadTokenUsageUpdated(payload) => {
            let last = payload.token_usage.last;
            let billable_tokens = (last.input_tokens + last.output_tokens) as u32;
            add_normalized_entry(
                msg_store,
                entry_index,
                NormalizedEntry {
                    timestamp: None,
                    entry_type: NormalizedEntryType::TokenUsageInfo(crate::logs::TokenUsageInfo {
                        total_tokens: billable_tokens,
                        model_context_window: payload
                            .token_usage
                            .model_context_window
                            .unwrap_or_default()
                            as u32,
                        input_tokens: Some(last.input_tokens as u32),
                        output_tokens: Some(last.output_tokens as u32),
                        cache_read_tokens: Some(last.cached_input_tokens as u32),
                        cache_write_tokens: None,
                        is_estimated: false,
                    }),
                    content: format!(
                        "Tokens used: {} / Context window: {}",
                        billable_tokens,
                        payload.token_usage.model_context_window.unwrap_or_default()
                    ),
                    metadata: None,
                },
            );
        }
        ServerNotification::ContextCompacted(_) => {
            add_normalized_entry(
                msg_store,
                entry_index,
                NormalizedEntry {
                    timestamp: None,
                    entry_type: NormalizedEntryType::SystemMessage,
                    content: "Context compacted".to_string(),
                    metadata: None,
                },
            );
        }
        ServerNotification::ModelRerouted(payload) => {
            add_normalized_entry(
                msg_store,
                entry_index,
                NormalizedEntry {
                    timestamp: None,
                    entry_type: NormalizedEntryType::SystemMessage,
                    content: format!(
                        "Model rerouted from {} to {}: {:?}",
                        payload.from_model, payload.to_model, payload.reason
                    ),
                    metadata: None,
                },
            );
        }
        ServerNotification::Warning(payload) => {
            add_normalized_entry(
                msg_store,
                entry_index,
                NormalizedEntry {
                    timestamp: None,
                    entry_type: NormalizedEntryType::ErrorMessage {
                        error_type: NormalizedEntryError::Other,
                    },
                    content: payload.message,
                    metadata: None,
                },
            );
        }
        ServerNotification::GuardianWarning(payload) => {
            add_normalized_entry(
                msg_store,
                entry_index,
                NormalizedEntry {
                    timestamp: None,
                    entry_type: NormalizedEntryType::ErrorMessage {
                        error_type: NormalizedEntryError::Other,
                    },
                    content: payload.message,
                    metadata: None,
                },
            );
        }
        ServerNotification::DeprecationNotice(payload) => {
            let content = match payload.details {
                Some(details) if !details.trim().is_empty() => {
                    format!("Deprecation notice: {}\n{}", payload.summary, details)
                }
                _ => format!("Deprecation notice: {}", payload.summary),
            };
            add_normalized_entry(
                msg_store,
                entry_index,
                NormalizedEntry {
                    timestamp: None,
                    entry_type: NormalizedEntryType::SystemMessage,
                    content,
                    metadata: None,
                },
            );
        }
        ServerNotification::ConfigWarning(payload) => {
            let mut parts = vec![format!("Config warning: {}", payload.summary)];
            if let Some(path) = payload.path {
                parts.push(format!("path: {path}"));
            }
            if let Some(details) = payload.details
                && !details.trim().is_empty()
            {
                parts.push(details);
            }
            add_normalized_entry(
                msg_store,
                entry_index,
                NormalizedEntry {
                    timestamp: None,
                    entry_type: NormalizedEntryType::ErrorMessage {
                        error_type: NormalizedEntryError::Other,
                    },
                    content: parts.join("\n"),
                    metadata: None,
                },
            );
        }
        ServerNotification::Error(payload) => {
            add_normalized_entry(
                msg_store,
                entry_index,
                NormalizedEntry {
                    timestamp: None,
                    entry_type: NormalizedEntryType::ErrorMessage {
                        error_type: NormalizedEntryError::Other,
                    },
                    content: format!("Error: {}", payload.error.message),
                    metadata: None,
                },
            );
        }
        ServerNotification::TurnCompleted(TurnCompletedNotification { turn, .. }) => {
            if matches!(turn.status, TurnStatus::Failed) {
                let error_message = turn
                    .error
                    .as_ref()
                    .map(|e| e.message.as_str())
                    .unwrap_or("Agent turn failed with no error message");
                add_normalized_entry(
                    msg_store,
                    entry_index,
                    NormalizedEntry {
                        timestamp: None,
                        entry_type: NormalizedEntryType::ErrorMessage {
                            error_type: NormalizedEntryError::Other,
                        },
                        content: error_message.to_string(),
                        metadata: None,
                    },
                );
            }
        }
        _ => {}
    }
}

fn handle_v2_item_started(
    item: ThreadItem,
    state: &mut LogState,
    msg_store: &Arc<MsgStore>,
    entry_index: &EntryIndexProvider,
    worktree_path: &str,
) {
    match item {
        ThreadItem::CommandExecution {
            id,
            command,
            aggregated_output,
            exit_code,
            ..
        } => {
            state.assistant = None;
            state.thinking = None;
            let command_state = state
                .commands
                .entry(id.clone())
                .or_insert_with(|| CommandState::new(command.clone(), id.clone()));
            command_state.command = command;
            command_state.formatted_output = aggregated_output;
            command_state.exit_code = exit_code;
            if let Some(index) = command_state.index {
                replace_normalized_entry(msg_store, index, command_state.to_normalized_entry());
            } else {
                let index = add_normalized_entry(
                    msg_store,
                    entry_index,
                    command_state.to_normalized_entry(),
                );
                command_state.index = Some(index);
            }
        }
        ThreadItem::FileChange { id, changes, .. } => {
            state.assistant = None;
            state.thinking = None;
            let normalized = normalize_v2_file_changes(worktree_path, &changes);
            let patch_state = state.patches.entry(id.clone()).or_default();
            sync_patch_entries(
                patch_state,
                normalized,
                ToolStatus::Created,
                false,
                &id,
                msg_store,
                entry_index,
            );
        }
        ThreadItem::McpToolCall {
            id,
            server,
            tool,
            arguments,
            ..
        } => {
            state.assistant = None;
            state.thinking = None;
            let invocation = McpInvocation {
                server,
                tool,
                arguments: Some(arguments),
            };
            let tool_state = state.mcp_tools.entry(id.clone()).or_insert(McpToolState {
                index: None,
                invocation,
                result: None,
                status: ToolStatus::Created,
            });
            if let Some(index) = tool_state.index {
                replace_normalized_entry(msg_store, index, tool_state.to_normalized_entry());
            } else {
                let index =
                    add_normalized_entry(msg_store, entry_index, tool_state.to_normalized_entry());
                tool_state.index = Some(index);
            }
        }
        ThreadItem::WebSearch { id, query, .. } => {
            state.assistant = None;
            state.thinking = None;
            let web_search_state = state.web_searches.entry(id).or_default();
            web_search_state.query = Some(query);
            if let Some(index) = web_search_state.index {
                replace_normalized_entry(msg_store, index, web_search_state.to_normalized_entry());
            } else {
                let index = add_normalized_entry(
                    msg_store,
                    entry_index,
                    web_search_state.to_normalized_entry(),
                );
                web_search_state.index = Some(index);
            }
        }
        ThreadItem::ImageView { path, .. } => {
            state.assistant = None;
            state.thinking = None;
            let path = path.as_path().to_string_lossy();
            let relative_path = make_path_relative(&path, worktree_path);
            add_normalized_entry(
                msg_store,
                entry_index,
                NormalizedEntry {
                    timestamp: None,
                    entry_type: NormalizedEntryType::ToolUse {
                        tool_name: "view_image".to_string(),
                        action_type: ActionType::FileRead {
                            path: relative_path.clone(),
                        },
                        status: ToolStatus::Success,
                    },
                    content: relative_path,
                    metadata: None,
                },
            );
        }
        ThreadItem::AgentMessage { text, .. } if !text.is_empty() => {
            state.thinking = None;
            let (entry, index, is_new) = state.assistant_message(text);
            upsert_normalized_entry(msg_store, index, entry, is_new);
            state.assistant = None;
        }
        ThreadItem::Reasoning {
            summary, content, ..
        } => {
            let text = if summary.is_empty() {
                content.join("")
            } else {
                summary.join("")
            };
            if !text.is_empty() {
                state.assistant = None;
                let (entry, index, is_new) = state.thinking(text);
                upsert_normalized_entry(msg_store, index, entry, is_new);
            }
        }
        ThreadItem::ContextCompaction { .. } => {
            add_normalized_entry(
                msg_store,
                entry_index,
                NormalizedEntry {
                    timestamp: None,
                    entry_type: NormalizedEntryType::SystemMessage,
                    content: "Context compacted".to_string(),
                    metadata: None,
                },
            );
        }
        _ => {}
    }
}

fn handle_v2_item_completed(
    item: ThreadItem,
    state: &mut LogState,
    msg_store: &Arc<MsgStore>,
    entry_index: &EntryIndexProvider,
    worktree_path: &str,
) {
    match item {
        ThreadItem::AgentMessage { text, .. } => {
            state.thinking = None;
            let (entry, index, is_new) = state.assistant_message(text);
            upsert_normalized_entry(msg_store, index, entry, is_new);
            state.assistant = None;
        }
        ThreadItem::Reasoning {
            summary, content, ..
        } => {
            let text = if summary.is_empty() {
                content.join("")
            } else {
                summary.join("")
            };
            if !text.is_empty() {
                state.assistant = None;
                let (entry, index, is_new) = state.thinking(text);
                upsert_normalized_entry(msg_store, index, entry, is_new);
                state.thinking = None;
            }
        }
        ThreadItem::CommandExecution {
            id,
            aggregated_output,
            exit_code,
            status,
            ..
        } => {
            if let Some(mut command_state) = state.commands.remove(&id) {
                command_state.formatted_output = aggregated_output;
                command_state.exit_code = exit_code;
                command_state.awaiting_approval = false;
                command_state.status = match status {
                    CommandExecutionStatus::Completed => ToolStatus::Success,
                    CommandExecutionStatus::Failed => ToolStatus::Failed,
                    CommandExecutionStatus::Declined => ToolStatus::Denied { reason: None },
                    CommandExecutionStatus::InProgress => ToolStatus::Created,
                };
                if let Some(index) = command_state.index {
                    replace_normalized_entry(msg_store, index, command_state.to_normalized_entry());
                }
            }
        }
        ThreadItem::FileChange {
            id,
            changes,
            status,
        } => {
            let status = match status {
                PatchApplyStatus::Completed => ToolStatus::Success,
                PatchApplyStatus::Failed => ToolStatus::Failed,
                PatchApplyStatus::Declined => ToolStatus::Denied { reason: None },
                PatchApplyStatus::InProgress => ToolStatus::Created,
            };

            let normalized = normalize_v2_file_changes(worktree_path, &changes);
            let mut patch_state = state.patches.remove(&id).unwrap_or_default();
            sync_patch_entries(
                &mut patch_state,
                normalized,
                status,
                false,
                &id,
                msg_store,
                entry_index,
            );
        }
        ThreadItem::McpToolCall {
            id,
            status,
            result,
            error,
            ..
        } => {
            if let Some(mut mcp_tool_state) = state.mcp_tools.remove(&id) {
                mcp_tool_state.status = match status {
                    McpToolCallStatus::Completed => ToolStatus::Success,
                    McpToolCallStatus::Failed => ToolStatus::Failed,
                    McpToolCallStatus::InProgress => ToolStatus::Created,
                };
                if let Some(result) = result {
                    mcp_tool_state.result = Some(tool_result_from_v2_mcp_result(*result));
                } else if let Some(error) = error {
                    mcp_tool_state.result = Some(ToolResult {
                        r#type: ToolResultValueType::Markdown,
                        value: Value::String(error.message),
                    });
                }
                if let Some(index) = mcp_tool_state.index {
                    replace_normalized_entry(
                        msg_store,
                        index,
                        mcp_tool_state.to_normalized_entry(),
                    );
                }
            }
        }
        ThreadItem::WebSearch { id, query, .. } => {
            if let Some(mut entry) = state.web_searches.remove(&id) {
                entry.status = ToolStatus::Success;
                entry.query = Some(query);
                if let Some(index) = entry.index {
                    replace_normalized_entry(msg_store, index, entry.to_normalized_entry());
                }
            }
        }
        other => handle_v2_item_started(other, state, msg_store, entry_index, worktree_path),
    }
}

fn tool_result_from_v2_mcp_result(result: McpToolCallResult) -> ToolResult {
    if let Some(text) = mcp_text_blocks_joined(&result.content, "") {
        ToolResult {
            r#type: ToolResultValueType::Markdown,
            value: Value::String(text),
        }
    } else if let Some(structured_content) = result.structured_content {
        ToolResult {
            r#type: ToolResultValueType::Json,
            value: structured_content,
        }
    } else {
        ToolResult {
            r#type: ToolResultValueType::Json,
            value: serde_json::to_value(result).unwrap_or(Value::Null),
        }
    }
}

fn mcp_text_blocks_joined(blocks: &[Value], separator: &str) -> Option<String> {
    let texts = blocks
        .iter()
        .map(mcp_text_block_text)
        .collect::<Option<Vec<_>>>()?;
    Some(texts.join(separator))
}

fn mcp_text_block_text(block: &Value) -> Option<String> {
    let Value::Object(content) = block else {
        return None;
    };

    if content.get("type").and_then(Value::as_str) != Some("text") {
        return None;
    }

    content
        .get("text")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn handle_jsonrpc_response(
    response: JSONRPCResponse,
    msg_store: &Arc<MsgStore>,
    entry_index: &EntryIndexProvider,
) {
    let result = response.result;

    if let Ok(response) = serde_json::from_value::<ThreadStartResponse>(result.clone()) {
        let ThreadStartResponse {
            thread,
            model,
            reasoning_effort,
            ..
        } = response;
        push_session_id_from_thread(thread.id, thread.path, msg_store);

        handle_model_params(model, reasoning_effort, msg_store, entry_index);
        return;
    }

    if let Ok(response) = serde_json::from_value::<ThreadResumeResponse>(result.clone()) {
        let ThreadResumeResponse {
            thread,
            model,
            reasoning_effort,
            ..
        } = response;
        push_session_id_from_thread(thread.id, thread.path, msg_store);

        handle_model_params(model, reasoning_effort, msg_store, entry_index);
        return;
    }

    handle_jsonrpc_thread_response_value(&result, msg_store, entry_index);
}

fn handle_model_params(
    model: String,
    reasoning_effort: Option<ReasoningEffort>,
    msg_store: &Arc<MsgStore>,
    entry_index: &EntryIndexProvider,
) {
    let mut params = vec![];
    params.push(format!("model: {model}"));
    if let Some(reasoning_effort) = reasoning_effort {
        params.push(format!("reasoning effort: {reasoning_effort}"));
    }

    add_normalized_entry(
        msg_store,
        entry_index,
        NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::SystemMessage,
            content: params.join("  ").to_string(),
            metadata: None,
        },
    );
}

fn handle_jsonrpc_thread_response_value(
    result: &Value,
    msg_store: &Arc<MsgStore>,
    entry_index: &EntryIndexProvider,
) {
    let Some(thread) = result.get("thread") else {
        return;
    };

    let thread_id = thread
        .get("id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let path = thread
        .get("path")
        .and_then(Value::as_str)
        .map(PathBuf::from);

    if let Some(thread_id) = thread_id {
        push_session_id_from_thread(thread_id, path, msg_store);
    } else if let Some(path) = path {
        match SessionHandler::extract_session_id_from_rollout_path(path) {
            Ok(session_id) => msg_store.push_session_id(session_id),
            Err(err) => tracing::error!("failed to extract session id: {err}"),
        }
    }

    let Some(model) = result.get("model").and_then(Value::as_str) else {
        return;
    };
    let reasoning_effort = result
        .get("reasoningEffort")
        .cloned()
        .and_then(|value| serde_json::from_value::<ReasoningEffort>(value).ok());

    handle_model_params(model.to_string(), reasoning_effort, msg_store, entry_index);
}

fn push_session_id_from_thread(
    thread_id: String,
    path: Option<PathBuf>,
    msg_store: &Arc<MsgStore>,
) {
    if let Some(path) = path {
        match SessionHandler::extract_session_id_from_rollout_path(path) {
            Ok(session_id) => {
                msg_store.push_session_id(session_id);
                return;
            }
            Err(err) => tracing::error!("failed to extract session id: {err}"),
        }
    }

    msg_store.push_session_id(thread_id);
}

fn build_command_output(stdout: Option<&str>, stderr: Option<&str>) -> Option<String> {
    let mut sections = Vec::new();
    if let Some(out) = stdout {
        let cleaned = out.trim();
        if !cleaned.is_empty() {
            sections.push(format!("stdout:\n{cleaned}"));
        }
    }
    if let Some(err) = stderr {
        let cleaned = err.trim();
        if !cleaned.is_empty() {
            sections.push(format!("stderr:\n{cleaned}"));
        }
    }

    if sections.is_empty() {
        None
    } else {
        Some(sections.join("\n\n"))
    }
}

static SESSION_ID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"#)
        .expect("valid regex")
});

#[derive(Serialize, Deserialize, Debug)]
pub enum Error {
    LaunchError { error: String },
    AuthRequired { error: String },
}

impl Error {
    pub fn launch_error(error: String) -> Self {
        Self::LaunchError { error }
    }
    pub fn auth_required(error: String) -> Self {
        Self::AuthRequired { error }
    }

    pub fn raw(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

impl ToNormalizedEntry for Error {
    fn to_normalized_entry(&self) -> NormalizedEntry {
        match self {
            Error::LaunchError { error } => {
                // Detect specific API error types
                let (error_type, content) = if let Some(detected) = detect_api_error(error) {
                    (detected.error_type, detected.message)
                } else {
                    (NormalizedEntryError::Other, error.clone())
                };
                NormalizedEntry {
                    timestamp: None,
                    entry_type: NormalizedEntryType::ErrorMessage { error_type },
                    content,
                    metadata: None,
                }
            }
            Error::AuthRequired { error } => NormalizedEntry {
                timestamp: None,
                entry_type: NormalizedEntryType::ErrorMessage {
                    error_type: NormalizedEntryError::SetupRequired,
                },
                content: error.clone(),
                metadata: None,
            },
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub enum Approval {
    ApprovalResponse {
        call_id: String,
        tool_name: String,
        approval_status: ApprovalStatus,
    },
}

impl Approval {
    pub fn approval_response(
        call_id: String,
        tool_name: String,
        approval_status: ApprovalStatus,
    ) -> Self {
        Self::ApprovalResponse {
            call_id,
            tool_name,
            approval_status,
        }
    }

    pub fn raw(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    pub fn display_tool_name(&self) -> String {
        let Self::ApprovalResponse { tool_name, .. } = self;
        match tool_name.as_str() {
            "codex.exec_command" => "Exec Command".to_string(),
            "codex.apply_patch" => "Edit".to_string(),
            other => other.to_string(),
        }
    }
}

impl ToNormalizedEntryOpt for Approval {
    fn to_normalized_entry_opt(&self) -> Option<NormalizedEntry> {
        let Self::ApprovalResponse {
            call_id: _,
            tool_name: _,
            approval_status,
        } = self;
        let tool_name = self.display_tool_name();

        match approval_status {
            ApprovalStatus::Pending => None,
            ApprovalStatus::Approved => None,
            ApprovalStatus::Denied { reason } => Some(NormalizedEntry {
                timestamp: None,
                entry_type: NormalizedEntryType::UserFeedback {
                    denied_tool: tool_name.clone(),
                },
                content: reason
                    .clone()
                    .unwrap_or_else(|| "User denied this tool use request".to_string())
                    .trim()
                    .to_string(),
                metadata: None,
            }),
            ApprovalStatus::TimedOut => Some(NormalizedEntry {
                timestamp: None,
                entry_type: NormalizedEntryType::ErrorMessage {
                    error_type: NormalizedEntryError::Other,
                },
                content: format!("Approval timed out for tool {tool_name}"),
                metadata: None,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use codex_app_server_protocol::RequestId;
    use workspace_utils::{log_msg::LogMsg, msg_store::MsgStore};

    use super::handle_jsonrpc_response;
    use crate::logs::{
        NormalizedEntry, NormalizedEntryType,
        utils::{EntryIndexProvider, patch::extract_normalized_entry_from_patch},
    };

    fn session_id_from_history(store: &MsgStore) -> Option<String> {
        store.get_history().into_iter().find_map(|msg| match msg {
            LogMsg::SessionId(id) => Some(id),
            _ => None,
        })
    }

    fn normalized_entries_from_history(store: &MsgStore) -> Vec<NormalizedEntry> {
        store
            .get_history()
            .into_iter()
            .filter_map(|msg| match msg {
                LogMsg::JsonPatch(patch) => {
                    extract_normalized_entry_from_patch(&patch).map(|(_, entry)| entry)
                }
                _ => None,
            })
            .collect()
    }

    async fn eventually_has_normalized_entry(
        store: &MsgStore,
        mut predicate: impl FnMut(&NormalizedEntry) -> bool,
    ) -> bool {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            let entries = normalized_entries_from_history(store);
            if entries.iter().any(&mut predicate) {
                return true;
            }
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }

    #[tokio::test]
    async fn normalize_logs_maps_canonical_reasoning_delta_to_thinking() {
        let msg_store = std::sync::Arc::new(MsgStore::new());
        super::normalize_logs(msg_store.clone(), std::path::Path::new("E:/workspace"));
        tokio::task::yield_now().await;

        let line = serde_json::json!({
            "method": "codex/event",
            "params": {
                "msg": {
                    "type": "reasoning_content_delta",
                    "thread_id": "thread-1",
                    "turn_id": "turn-1",
                    "item_id": "item-1",
                    "delta": "Inspecting the workspace",
                    "summary_index": 0
                }
            }
        })
        .to_string();
        msg_store.push_stdout(format!("{line}\n"));
        msg_store.push_finished();

        assert!(
            eventually_has_normalized_entry(&msg_store, |entry| {
                matches!(entry.entry_type, NormalizedEntryType::Thinking)
                    && entry.content == "Inspecting the workspace"
            })
            .await
        );
    }

    #[tokio::test]
    async fn normalize_logs_maps_canonical_agent_delta_to_assistant() {
        let msg_store = std::sync::Arc::new(MsgStore::new());
        super::normalize_logs(msg_store.clone(), std::path::Path::new("E:/workspace"));
        tokio::task::yield_now().await;

        let line = serde_json::json!({
            "method": "codex/event",
            "params": {
                "msg": {
                    "type": "agent_message_content_delta",
                    "thread_id": "thread-1",
                    "turn_id": "turn-1",
                    "item_id": "item-1",
                    "delta": "Done"
                }
            }
        })
        .to_string();
        msg_store.push_stdout(format!("{line}\n"));
        msg_store.push_finished();

        assert!(
            eventually_has_normalized_entry(&msg_store, |entry| {
                matches!(entry.entry_type, NormalizedEntryType::AssistantMessage)
                    && entry.content == "Done"
            })
            .await
        );
    }

    #[tokio::test]
    async fn normalize_logs_maps_app_server_agent_delta_to_assistant() {
        let msg_store = std::sync::Arc::new(MsgStore::new());
        super::normalize_logs(msg_store.clone(), std::path::Path::new("E:/workspace"));
        tokio::task::yield_now().await;

        let line = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-1",
                "delta": "Hello from app server"
            }
        })
        .to_string();
        msg_store.push_stdout(format!("{line}\n"));
        msg_store.push_finished();

        assert!(
            eventually_has_normalized_entry(&msg_store, |entry| {
                matches!(entry.entry_type, NormalizedEntryType::AssistantMessage)
                    && entry.content == "Hello from app server"
            })
            .await
        );
    }

    #[tokio::test]
    async fn normalize_logs_maps_app_server_reasoning_delta_to_thinking() {
        let msg_store = std::sync::Arc::new(MsgStore::new());
        super::normalize_logs(msg_store.clone(), std::path::Path::new("E:/workspace"));
        tokio::task::yield_now().await;

        let line = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "item/reasoning/summaryTextDelta",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-1",
                "delta": "Reading the new app-server stream",
                "summaryIndex": 0
            }
        })
        .to_string();
        msg_store.push_stdout(format!("{line}\n"));
        msg_store.push_finished();

        assert!(
            eventually_has_normalized_entry(&msg_store, |entry| {
                matches!(entry.entry_type, NormalizedEntryType::Thinking)
                    && entry.content == "Reading the new app-server stream"
            })
            .await
        );
    }

    #[tokio::test]
    async fn normalize_logs_maps_app_server_file_change_patch_updated_to_edit() {
        let msg_store = std::sync::Arc::new(MsgStore::new());
        super::normalize_logs(
            msg_store.clone(),
            std::path::Path::new("/tmp/test-worktree"),
        );
        tokio::task::yield_now().await;

        let line = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "item/fileChange/patchUpdated",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "patch-1",
                "changes": [{
                    "path": "/tmp/test-worktree/src/main.rs",
                    "kind": { "type": "update", "movePath": null },
                    "diff": "@@ -1 +1 @@\n-old\n+new\n"
                }]
            }
        })
        .to_string();
        msg_store.push_stdout(format!("{line}\n"));
        msg_store.push_finished();

        assert!(
            eventually_has_normalized_entry(&msg_store, |entry| {
                matches!(
                    &entry.entry_type,
                    NormalizedEntryType::ToolUse {
                        tool_name,
                        action_type: crate::logs::ActionType::FileEdit { path, .. },
                        ..
                    } if tool_name == "edit" && path == "src/main.rs"
                )
            })
            .await
        );
    }

    #[tokio::test]
    async fn normalize_logs_maps_app_server_file_change_output_delta_to_success() {
        let msg_store = std::sync::Arc::new(MsgStore::new());
        super::normalize_logs(
            msg_store.clone(),
            std::path::Path::new("/tmp/test-worktree"),
        );
        tokio::task::yield_now().await;

        let started = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "item/started",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": {
                    "type": "fileChange",
                    "id": "patch-1",
                    "changes": [{
                        "path": "/tmp/test-worktree/src/main.rs",
                        "kind": { "type": "update", "movePath": null },
                        "diff": "@@ -1 +1 @@\n-old\n+new\n"
                    }],
                    "status": "inProgress"
                }
            }
        })
        .to_string();
        let output_delta = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "item/fileChange/outputDelta",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "patch-1",
                "delta": "Success. Updated the following files:\nM src/main.rs\n"
            }
        })
        .to_string();
        msg_store.push_stdout(format!("{started}\n{output_delta}\n"));
        msg_store.push_finished();

        assert!(
            eventually_has_normalized_entry(&msg_store, |entry| {
                matches!(
                    &entry.entry_type,
                    NormalizedEntryType::ToolUse {
                        tool_name,
                        action_type: crate::logs::ActionType::FileEdit { path, .. },
                        status,
                    } if tool_name == "edit"
                        && path == "src/main.rs"
                        && matches!(status, crate::logs::ToolStatus::Success)
                )
            })
            .await
        );
    }

    #[tokio::test]
    async fn normalize_logs_maps_app_server_warning_to_error_message() {
        let msg_store = std::sync::Arc::new(MsgStore::new());
        super::normalize_logs(msg_store.clone(), std::path::Path::new("E:/workspace"));
        tokio::task::yield_now().await;

        let line = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "warning",
            "params": {
                "threadId": "thread-1",
                "message": "This setting will be ignored"
            }
        })
        .to_string();
        msg_store.push_stdout(format!("{line}\n"));
        msg_store.push_finished();

        assert!(
            eventually_has_normalized_entry(&msg_store, |entry| {
                matches!(entry.entry_type, NormalizedEntryType::ErrorMessage { .. })
                    && entry.content == "This setting will be ignored"
            })
            .await
        );
    }

    #[test]
    fn handle_jsonrpc_response_supports_thread_start_response() {
        let msg_store = std::sync::Arc::new(MsgStore::new());
        let entry_index = EntryIndexProvider::start_from(&msg_store);
        let response = codex_app_server_protocol::JSONRPCResponse {
            id: RequestId::Integer(1),
            result: serde_json::json!({
                "thread": {
                    "id": "88d1d63d-b84e-4f3d-9d87-1fb21839379d",
                    "forkedFromId": null,
                    "preview": "",
                    "ephemeral": false,
                    "modelProvider": "openai",
                    "createdAt": 0,
                    "updatedAt": 0,
                    "status": { "type": "idle" },
                    "path": "C:/Users/Admin/.codex/sessions/2026/03/06/rollout-2026-03-06T10-00-00-88d1d63d-b84e-4f3d-9d87-1fb21839379d.jsonl",
                    "cwd": "E:/workspace/projectSS/openteams-codex-latest-protocol",
                    "cliVersion": "0.0.0",
                    "source": "appServer",
                    "agentNickname": null,
                    "agentRole": null,
                    "gitInfo": null,
                    "name": null,
                    "turns": []
                },
                "model": "gpt-5-codex",
                "modelProvider": "openai",
                "serviceTier": null,
                "cwd": "E:/workspace/projectSS/openteams-codex-latest-protocol",
                "instructionSources": [],
                "approvalPolicy": "on-request",
                "approvalsReviewer": "user",
                "sandbox": {
                    "type": "workspaceWrite",
                    "writableRoots": [],
                    "readOnlyAccess": { "type": "fullAccess" },
                    "networkAccess": false,
                    "excludeTmpdirEnvVar": false,
                    "excludeSlashTmp": false
                },
                "permissionProfile": null,
                "reasoningEffort": "medium"
            }),
        };

        handle_jsonrpc_response(response, &msg_store, &entry_index);

        assert_eq!(
            session_id_from_history(&msg_store).as_deref(),
            Some("88d1d63d-b84e-4f3d-9d87-1fb21839379d")
        );
    }

    #[test]
    fn handle_jsonrpc_response_falls_back_to_thread_json() {
        let msg_store = std::sync::Arc::new(MsgStore::new());
        let entry_index = EntryIndexProvider::start_from(&msg_store);
        let response = codex_app_server_protocol::JSONRPCResponse {
            id: RequestId::Integer(1),
            result: serde_json::json!({
                "thread": {
                    "id": "88d1d63d-b84e-4f3d-9d87-1fb21839379d",
                    "path": null
                },
                "model": 123
            }),
        };

        handle_jsonrpc_response(response, &msg_store, &entry_index);

        assert_eq!(
            session_id_from_history(&msg_store).as_deref(),
            Some("88d1d63d-b84e-4f3d-9d87-1fb21839379d")
        );
    }
}
