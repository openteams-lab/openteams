use std::collections::HashMap;

use executors::logs::{
    ActionType, FileChange, NormalizedEntry, NormalizedEntryType, ToolResult, ToolStatus,
    utils::patch::extract_normalized_entry_from_patch,
};
use json_patch::Patch;

use super::chat_runner::{ChatRunActivityLineType, ChatStreamDeltaType};

#[derive(Debug, Clone)]
pub struct AgentActivityEntryLine {
    pub stream_type: ChatStreamDeltaType,
    pub line_type: ChatRunActivityLineType,
    pub content: String,
    pub immediate: bool,
}

#[derive(Default)]
pub struct AgentActivityStreamState {
    last_content_by_index: HashMap<usize, String>,
    assistant_buffer: String,
    assistant_buffer_index: Option<usize>,
    thinking_buffer: String,
    thinking_buffer_index: Option<usize>,
    error_buffer: String,
    error_buffer_index: Option<usize>,
}

impl AgentActivityStreamState {
    pub fn drain_patch_lines(
        &mut self,
        patch: &Patch,
        include_assistant: bool,
    ) -> Vec<AgentActivityEntryLine> {
        let Some((index, entry)) = extract_normalized_entry_from_patch(patch) else {
            return Vec::new();
        };

        let Some(line) = activity_line_for_entry(&entry, include_assistant) else {
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
            return vec![line];
        }

        self.mark_stream_entry_boundary(&line.stream_type, index);

        let chunk = if line.content.starts_with(&previous) {
            line.content[previous.len()..].to_string()
        } else {
            line.content
        };

        self.drain_chunk_lines(line.stream_type, line.line_type, &chunk)
    }

    fn mark_stream_entry_boundary(&mut self, stream_type: &ChatStreamDeltaType, index: usize) {
        let (buffer, buffer_index) = match stream_type {
            ChatStreamDeltaType::Assistant => {
                (&mut self.assistant_buffer, &mut self.assistant_buffer_index)
            }
            ChatStreamDeltaType::Thinking => {
                (&mut self.thinking_buffer, &mut self.thinking_buffer_index)
            }
            ChatStreamDeltaType::Error => (&mut self.error_buffer, &mut self.error_buffer_index),
        };

        if buffer_index.is_some_and(|current| current != index) && !buffer.is_empty() {
            buffer.push('\n');
        }
        *buffer_index = Some(index);
    }

    fn drain_chunk_lines(
        &mut self,
        stream_type: ChatStreamDeltaType,
        line_type: ChatRunActivityLineType,
        chunk: &str,
    ) -> Vec<AgentActivityEntryLine> {
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
                emitted.push(AgentActivityEntryLine {
                    stream_type: stream_type.clone(),
                    line_type: line_type.clone(),
                    content: line.to_string(),
                    immediate: false,
                });
            }
            buffer.drain(..=newline_index);
        }

        emitted
    }

    pub fn flush_pending_lines(&mut self) -> Vec<AgentActivityEntryLine> {
        let mut emitted = Vec::new();

        for (stream_type, line_type, buffer) in [
            (
                ChatStreamDeltaType::Assistant,
                ChatRunActivityLineType::Assistant,
                &mut self.assistant_buffer,
            ),
            (
                ChatStreamDeltaType::Thinking,
                ChatRunActivityLineType::Thinking,
                &mut self.thinking_buffer,
            ),
            (
                ChatStreamDeltaType::Error,
                ChatRunActivityLineType::Error,
                &mut self.error_buffer,
            ),
        ] {
            let line = buffer.trim();
            if !line.is_empty() {
                emitted.push(AgentActivityEntryLine {
                    stream_type,
                    line_type,
                    content: line.to_string(),
                    immediate: false,
                });
            }
            buffer.clear();
        }
        self.assistant_buffer_index = None;
        self.thinking_buffer_index = None;
        self.error_buffer_index = None;

        emitted
    }
}

pub fn activity_line_for_entry(
    entry: &NormalizedEntry,
    include_assistant: bool,
) -> Option<AgentActivityEntryLine> {
    match &entry.entry_type {
        NormalizedEntryType::AssistantMessage if include_assistant => {
            Some(AgentActivityEntryLine {
                stream_type: ChatStreamDeltaType::Assistant,
                line_type: ChatRunActivityLineType::Assistant,
                content: entry.content.clone(),
                immediate: false,
            })
        }
        NormalizedEntryType::Thinking => Some(AgentActivityEntryLine {
            stream_type: ChatStreamDeltaType::Thinking,
            line_type: ChatRunActivityLineType::Thinking,
            content: entry.content.clone(),
            immediate: false,
        }),
        NormalizedEntryType::ToolUse {
            tool_name,
            action_type,
            status,
        } => tool_activity_content(tool_name, action_type, status, &entry.content).map(|content| {
            AgentActivityEntryLine {
                stream_type: ChatStreamDeltaType::Thinking,
                line_type: ChatRunActivityLineType::Tool,
                content,
                immediate: true,
            }
        }),
        NormalizedEntryType::ErrorMessage { .. } => Some(AgentActivityEntryLine {
            stream_type: ChatStreamDeltaType::Error,
            line_type: ChatRunActivityLineType::Error,
            content: entry.content.clone(),
            immediate: true,
        }),
        _ => None,
    }
}

pub(crate) fn tool_activity_content(
    tool_name: &str,
    action_type: &ActionType,
    status: &ToolStatus,
    fallback_content: &str,
) -> Option<String> {
    let status_label = tool_status_label(status);

    let content = match action_type {
        ActionType::FileEdit { path, changes } => {
            let change_summary = file_change_summary(changes);
            format!("{status_label} file edit: {path}{change_summary}")
        }
        ActionType::CommandRun { command, result } => {
            let mut line = format!(
                "{status_label} command: {}",
                truncate_activity_line(command)
            );
            if let Some(preview) = result
                .as_ref()
                .and_then(|result| result.output.as_deref())
                .and_then(activity_result_preview)
            {
                line.push_str(": ");
                line.push_str(&preview);
            }
            line
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
            if let Some(preview) = tool_result_preview(result) {
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
                truncate_activity_line(description)
            );
            if let Some(subagent_type) = subagent_type
                && !subagent_type.trim().is_empty()
            {
                line.push_str(" (");
                line.push_str(subagent_type.trim());
                line.push(')');
            }
            if let Some(preview) = tool_result_preview(result) {
                line.push_str(": ");
                line.push_str(&preview);
            }
            line
        }
        ActionType::FileRead { path } => format!("{status_label} file read: {path}"),
        ActionType::Search { query } => {
            format!("{status_label} search: {}", truncate_activity_line(query))
        }
        ActionType::WebFetch { url } => format!("{status_label} web fetch: {url}"),
        ActionType::TodoManagement { todos, operation } => {
            format!("{status_label} plan {operation}: {} item(s)", todos.len())
        }
        ActionType::PlanPresentation { plan } => {
            format!("{status_label} plan: {}", truncate_activity_line(plan))
        }
        ActionType::Other { description } => {
            format!(
                "{status_label} activity: {}",
                truncate_activity_line(description)
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
            truncate_activity_line(fallback)
        )
    })
}

fn tool_status_label(status: &ToolStatus) -> &'static str {
    match status {
        ToolStatus::Created => "Started",
        ToolStatus::Success => "Completed",
        ToolStatus::Failed => "Failed",
        ToolStatus::Denied { .. } => "Denied",
        ToolStatus::PendingApproval { .. } => "Waiting approval for",
        ToolStatus::TimedOut => "Timed out",
    }
}

fn file_change_summary(changes: &[FileChange]) -> String {
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

fn tool_result_preview(result: &Option<ToolResult>) -> Option<String> {
    let result = result.as_ref()?;
    let preview = match &result.value {
        serde_json::Value::String(value) => value.clone(),
        value => value.to_string(),
    };
    activity_result_preview(&preview)
}

fn activity_result_preview(result: &str) -> Option<String> {
    let preview = result
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    Some(truncate_activity_line(preview))
}

pub(crate) fn truncate_activity_line(value: &str) -> String {
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

#[cfg(test)]
mod tests {
    use executors::logs::{NormalizedEntry, utils::patch::ConversationPatch};

    use super::*;

    #[test]
    fn chat_runner_line_buffer_emits_only_complete_lines_and_flushes_tail() {
        let mut state = AgentActivityStreamState::default();
        let first = ConversationPatch::add_normalized_entry(
            0,
            NormalizedEntry {
                timestamp: None,
                entry_type: NormalizedEntryType::Thinking,
                content: "first partial".to_string(),
                metadata: None,
            },
        );
        assert!(state.drain_patch_lines(&first, true).is_empty());

        let second = ConversationPatch::replace(
            0,
            NormalizedEntry {
                timestamp: None,
                entry_type: NormalizedEntryType::Thinking,
                content: "first partial\nsecond partial".to_string(),
                metadata: None,
            },
        );
        let lines = state.drain_patch_lines(&second, true);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].content, "first partial");
        assert_eq!(lines[0].line_type, ChatRunActivityLineType::Thinking);

        let flushed = state.flush_pending_lines();
        assert_eq!(flushed.len(), 1);
        assert_eq!(flushed[0].content, "second partial");
    }

    #[test]
    fn chat_runner_line_buffer_separates_reasoning_summary_entries_without_newlines() {
        let mut state = AgentActivityStreamState::default();
        let first = ConversationPatch::add_normalized_entry(
            0,
            NormalizedEntry {
                timestamp: None,
                entry_type: NormalizedEntryType::Thinking,
                content: "**Planning file inspection**".to_string(),
                metadata: None,
            },
        );
        assert!(state.drain_patch_lines(&first, true).is_empty());

        let second = ConversationPatch::add_normalized_entry(
            1,
            NormalizedEntry {
                timestamp: None,
                entry_type: NormalizedEntryType::Thinking,
                content: "**Reading existing package**".to_string(),
                metadata: None,
            },
        );
        let lines = state.drain_patch_lines(&second, true);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].content, "**Planning file inspection**");

        let flushed = state.flush_pending_lines();
        assert_eq!(flushed.len(), 1);
        assert_eq!(flushed[0].content, "**Reading existing package**");
    }

    #[test]
    fn chat_runner_tool_line_is_emitted_as_summary_line() {
        let mut state = AgentActivityStreamState::default();
        let patch = ConversationPatch::add_normalized_entry(
            0,
            NormalizedEntry {
                timestamp: None,
                entry_type: NormalizedEntryType::ToolUse {
                    tool_name: "shell".to_string(),
                    action_type: ActionType::CommandRun {
                        command: "cargo test -p services chat_runner".to_string(),
                        result: None,
                    },
                    status: ToolStatus::Created,
                },
                content: String::new(),
                metadata: None,
            },
        );

        let lines = state.drain_patch_lines(&patch, true);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].line_type, ChatRunActivityLineType::Tool);
        assert_eq!(
            lines[0].content,
            "Started command: cargo test -p services chat_runner"
        );
    }

    #[test]
    fn chat_runner_command_result_includes_a_collapsible_preview() {
        let entry = NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: "shell".to_string(),
                action_type: ActionType::CommandRun {
                    command: "pnpm test".to_string(),
                    result: Some(executors::logs::CommandRunResult {
                        exit_status: None,
                        output: Some("\nAll tests passed\nmore output".to_string()),
                    }),
                },
                status: ToolStatus::Success,
            },
            content: String::new(),
            metadata: None,
        };

        let line = activity_line_for_entry(&entry, true).expect("command result line");

        assert_eq!(
            line.content,
            "Completed command: pnpm test: All tests passed"
        );
    }
}
