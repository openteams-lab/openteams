use std::{
    fs::{self, OpenOptions},
    io::{self, Result, Write},
    path::PathBuf,
    str::FromStr,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::executors::acp::AcpEvent;

/// Manages session persistence and state for ACP interactions
pub struct SessionManager {
    base_dir: PathBuf,
}

impl SessionManager {
    const RESUME_PROMPT_NOTICE: &str =
        "[Earlier session history truncated to fit the executor input limit]\n";

    /// Create a new session manager with the given namespace
    pub fn new(namespace: impl Into<String>) -> Result<Self> {
        let namespace = namespace.into();
        let mut vk_dir = dirs::home_dir()
            .ok_or_else(|| io::Error::other("Could not determine home directory"))?
            .join(".openteams");

        if cfg!(debug_assertions) {
            vk_dir = vk_dir.join("dev");
        }

        let base_dir = vk_dir.join(&namespace);

        fs::create_dir_all(&base_dir)?;

        Ok(Self { base_dir })
    }

    /// Get the file path for a session
    fn session_file_path(&self, session_id: &str) -> PathBuf {
        self.base_dir.join(format!("{session_id}.jsonl"))
    }

    /// Append a raw JSON line to the session log
    ///
    /// We normalize ACP payloads by:
    /// - Removing top-level `sessionId`
    /// - Unwrapping the `update` envelope (store its object directly)
    /// - Dropping top-level `options` (permission menu). Note: `options` is
    ///   mutually exclusive with `update`, so when `update` is present we do not
    ///   perform any `options` stripping.
    pub fn append_raw_line(&self, session_id: &str, raw_json: &str) -> Result<()> {
        let Some(normalized) = Self::normalize_session_event(raw_json) else {
            return Ok(());
        };

        let path = self.session_file_path(session_id);
        let mut file = OpenOptions::new().create(true).append(true).open(path)?;

        writeln!(file, "{normalized}")?;
        Ok(())
    }

    /// Attempt to normalize a raw ACP JSON event into a cleaner shape.
    /// Rules:
    /// - Remove top-level `sessionId` always.
    /// - If `update` is present with an object that has `sessionUpdate`, emit
    ///   a single-key object where key = camelCase(sessionUpdate) and value =
    ///   the `update` object minus `sessionUpdate`.
    /// - If `update` is absent, remove only top-level `options`.
    ///
    /// Returns None if the input is not a JSON object.
    fn normalize_session_event(raw_json: &str) -> Option<String> {
        let mut event = AcpEvent::from_str(raw_json).ok()?;

        match event {
            AcpEvent::SessionStart(..)
            | AcpEvent::Error(..)
            | AcpEvent::Done(..)
            | AcpEvent::Other(..) => return None,

            AcpEvent::User(..)
            | AcpEvent::Message(..)
            | AcpEvent::Thought(..)
            | AcpEvent::ToolCall(..)
            | AcpEvent::ToolUpdate(..)
            | AcpEvent::Plan(..)
            | AcpEvent::AvailableCommands(..)
            | AcpEvent::ApprovalResponse(..)
            | AcpEvent::CurrentMode(..) => {}

            AcpEvent::RequestPermission(req) => event = AcpEvent::ToolUpdate(req.tool_call),
        }

        match event {
            AcpEvent::User(prompt) => {
                return serde_json::to_string(&serde_json::json!({"user": prompt})).ok();
            }
            AcpEvent::Message(ref content) | AcpEvent::Thought(ref content) => {
                if let agent_client_protocol::ContentBlock::Text(text) = content {
                    // Special simplification for pure text messages
                    let key = if let AcpEvent::Message(_) = event {
                        "assistant"
                    } else {
                        "thinking"
                    };
                    return serde_json::to_string(&serde_json::json!({ key: text.text })).ok();
                }
            }
            _ => {}
        }

        serde_json::to_string(&event).ok()
    }

    /// Read the raw JSONL content of a session
    pub fn read_session_raw(&self, session_id: &str) -> Result<String> {
        let path = self.session_file_path(session_id);
        if !path.exists() {
            return Ok(String::new());
        }

        fs::read_to_string(path)
    }

    /// Fork a session to create a new one with the same history
    pub fn fork_session(&self, old_id: &str, new_id: &str) -> Result<()> {
        let old_path = self.session_file_path(old_id);
        let new_path = self.session_file_path(new_id);

        if old_path.exists() {
            fs::copy(&old_path, &new_path)?;
        } else {
            // Create empty new file if old doesn't exist
            OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&new_path)?;
        }

        Ok(())
    }

    /// Delete a session
    pub fn delete_session(&self, session_id: &str) -> Result<()> {
        let path = self.session_file_path(session_id);
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    /// Generate a resume prompt from session history
    pub fn generate_resume_prompt(&self, session_id: &str, current_prompt: &str) -> Result<String> {
        let session_context = self.read_session_raw(session_id)?;

        Ok(Self::build_resume_prompt(&session_context, current_prompt))
    }

    /// Generate a resume prompt with a maximum UTF-8 byte budget.
    ///
    /// This is used by ACP executors like QWen that reject oversized single
    /// `session/prompt` payloads. We compact streaming history into user and
    /// assistant turns, then keep the newest portion that still fits.
    pub fn generate_resume_prompt_with_limit(
        &self,
        session_id: &str,
        current_prompt: &str,
        max_total_bytes: usize,
    ) -> Result<String> {
        let session_context = self.read_session_raw(session_id)?;
        let compact_context = Self::compact_session_context_for_resume(&session_context);
        Ok(Self::build_bounded_resume_prompt(
            &compact_context,
            current_prompt,
            max_total_bytes,
        ))
    }

    /// Return a compacted JSONL history snapshot for ACP metadata with a fixed
    /// byte budget so `new_session.meta.history_jsonl` cannot grow without bound.
    pub fn compact_history_jsonl_with_limit(
        &self,
        session_id: &str,
        max_total_bytes: usize,
    ) -> Result<String> {
        let session_context = self.read_session_raw(session_id)?;
        Ok(Self::compact_session_context_with_limit(
            &session_context,
            max_total_bytes,
        ))
    }

    fn build_resume_prompt(session_context: &str, current_prompt: &str) -> String {
        format!(
            concat!(
                "RESUME CONTEXT FOR CONTINUING TASK\n\n",
                "=== EXECUTION HISTORY ===\n",
                "The following is the conversation history from this session:\n",
                "{}\n\n",
                "=== CURRENT REQUEST ===\n",
                "{}\n\n",
                "=== INSTRUCTIONS ===\n",
                "You are continuing work on the above task. The execution history shows ",
                "the previous conversation in this session. Please continue from where ",
                "the previous execution left off, taking into account all the context provided above."
            ),
            session_context, current_prompt
        )
    }

    fn build_bounded_resume_prompt(
        session_context: &str,
        current_prompt: &str,
        max_total_bytes: usize,
    ) -> String {
        let prompt_without_history = Self::build_resume_prompt("", current_prompt);
        if prompt_without_history.len() >= max_total_bytes {
            return prompt_without_history;
        }

        let available_history_bytes = max_total_bytes
            .saturating_sub(prompt_without_history.len())
            .saturating_sub(Self::RESUME_PROMPT_NOTICE.len());

        if session_context.len() <= max_total_bytes.saturating_sub(prompt_without_history.len()) {
            return Self::build_resume_prompt(session_context, current_prompt);
        }

        if available_history_bytes == 0 {
            return prompt_without_history;
        }

        let truncated_history = Self::truncate_text_tail(session_context, available_history_bytes);
        let prompt = Self::build_resume_prompt(
            &format!("{}{}", Self::RESUME_PROMPT_NOTICE, truncated_history),
            current_prompt,
        );

        if prompt.len() <= max_total_bytes {
            prompt
        } else {
            prompt_without_history
        }
    }

    fn compact_session_context_for_resume(session_context: &str) -> String {
        fn flush_assistant_segment(compacted: &mut Vec<String>, current_text: &mut String) {
            if current_text.is_empty() {
                return;
            }

            if let Ok(line) = serde_json::to_string(&serde_json::json!({
                "assistant": current_text
            })) {
                compacted.push(line);
            }

            current_text.clear();
        }

        let mut compacted = Vec::new();
        let mut current_assistant_text = String::new();

        for raw_line in session_context.lines() {
            let Ok(value) = serde_json::from_str::<Value>(raw_line) else {
                continue;
            };
            let Some(object) = value.as_object() else {
                continue;
            };

            if let Some(text) = object.get("user").and_then(Value::as_str) {
                flush_assistant_segment(&mut compacted, &mut current_assistant_text);
                if let Ok(line) = serde_json::to_string(&serde_json::json!({ "user": text }))
                    && compacted.last() != Some(&line)
                {
                    compacted.push(line);
                }
                continue;
            }

            if let Some(text) = object.get("assistant").and_then(Value::as_str) {
                current_assistant_text.push_str(text);
            }
        }

        flush_assistant_segment(&mut compacted, &mut current_assistant_text);

        if compacted.is_empty() {
            session_context.to_string()
        } else {
            compacted.join("\n")
        }
    }

    fn compact_session_context_with_limit(session_context: &str, max_total_bytes: usize) -> String {
        let compacted = Self::compact_session_context_for_resume(session_context);
        Self::truncate_text_tail(&compacted, max_total_bytes)
    }

    fn truncate_text_tail(input: &str, max_bytes: usize) -> String {
        if input.len() <= max_bytes {
            return input.to_string();
        }

        let mut start = input.len().saturating_sub(max_bytes);
        while start < input.len() && !input.is_char_boundary(start) {
            start += 1;
        }

        if let Some(relative_newline) = input[start..].find('\n') {
            start += relative_newline + 1;
        }

        input[start..].to_string()
    }
}

/// Session metadata stored separately from events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMetadata {
    pub session_id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub parent_session: Option<String>,
    pub tags: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::SessionManager;

    #[test]
    fn compact_session_context_for_resume_drops_noise_and_merges_chunks() {
        let raw = concat!(
            "{\"user\":\"step 1\"}\n",
            "{\"thinking\":\"hidden\"}\n",
            "{\"assistant\":\"hello \"}\n",
            "{\"assistant\":\"world\"}\n",
            "{\"toolCall\":{\"id\":\"1\"}}\n",
            "{\"user\":\"step 2\"}\n"
        );

        let compacted = SessionManager::compact_session_context_for_resume(raw);

        assert_eq!(
            compacted,
            concat!(
                "{\"user\":\"step 1\"}\n",
                "{\"assistant\":\"hello world\"}\n",
                "{\"user\":\"step 2\"}"
            )
        );
    }

    #[test]
    fn build_bounded_resume_prompt_keeps_recent_history_within_limit() {
        let session_context = [
            "{\"user\":\"old request\"}",
            "{\"assistant\":\"old reply\"}",
            "{\"user\":\"recent request\"}",
            &format!(
                "{{\"assistant\":\"{}\"}}",
                "recent reply ".repeat(64).trim_end()
            ),
        ]
        .join("\n");

        let prompt = SessionManager::build_bounded_resume_prompt(&session_context, "continue", 900);

        assert!(prompt.len() <= 900);
        assert!(prompt.contains("recent request"));
        assert!(prompt.contains(SessionManager::RESUME_PROMPT_NOTICE.trim_end()));
        assert!(!prompt.contains("old request"));
    }

    #[test]
    fn compact_session_context_with_limit_keeps_recent_entries_within_budget() {
        let session_context = [
            "{\"user\":\"old request\"}",
            "{\"assistant\":\"old reply\"}",
            "{\"thinking\":\"hidden\"}",
            "{\"user\":\"recent request\"}",
            "{\"assistant\":\"recent reply\"}",
        ]
        .join("\n");

        let compacted = SessionManager::compact_session_context_with_limit(&session_context, 64);

        assert!(compacted.len() <= 64);
        assert!(compacted.contains("recent request"));
        assert!(compacted.contains("recent reply"));
        assert!(!compacted.contains("old request"));
        assert!(!compacted.contains("hidden"));
    }
}
