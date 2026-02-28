//! Chat history file service for persisting chat messages to local files.
//!
//! This module handles:
//! - Writing simplified chat messages to JSON files
//! - Reading chat history from files
//! - Token estimation using tiktoken
//! - Creating split files for archived messages

use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tiktoken_rs::cl100k_base;
use tokio::fs;
use uuid::Uuid;

/// Simplified message format for chat history files.
/// Only contains sender and content to minimize storage and token usage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimplifiedMessage {
    /// Sender identifier in format "user:{handle}" or "agent:{name}" or "system"
    pub sender: String,
    /// Message content
    pub content: String,
    /// ISO 8601 timestamp
    pub timestamp: String,
}

/// Metadata about the chat history file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatHistoryMetadata {
    /// Estimated token count for all messages
    pub token_count: u32,
    /// Whether compression has been applied
    pub compression_applied: bool,
    /// Path to split file if messages were truncated
    pub split_file: Option<String>,
}

/// The full chat history file structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatHistoryFile {
    /// Session ID this history belongs to
    pub session_id: Uuid,
    /// When the history file was created
    pub created_at: String,
    /// When the history file was last updated
    pub updated_at: String,
    /// The messages in this history
    pub messages: Vec<SimplifiedMessage>,
    /// Metadata about this history file
    pub metadata: ChatHistoryMetadata,
}

#[derive(Debug, Error)]
pub enum ChatHistoryFileError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Failed to determine user data directory")]
    NoDataDir,
}

/// Get the chat history directory path.
/// Returns `{UserDir}/.agents-chatgroup/chat_history/`
pub fn chat_history_dir() -> Result<PathBuf, ChatHistoryFileError> {
    let data_dir = dirs::data_dir().ok_or(ChatHistoryFileError::NoDataDir)?;
    Ok(data_dir.join(".agents-chatgroup").join("chat_history"))
}

/// Get the path to the main chat history file for a session.
pub fn chat_history_path(session_id: Uuid) -> Result<PathBuf, ChatHistoryFileError> {
    Ok(chat_history_dir()?.join(format!("{}.json", session_id)))
}

/// Get the path to the split file for archived messages.
pub fn chat_history_split_path(session_id: Uuid) -> Result<PathBuf, ChatHistoryFileError> {
    Ok(chat_history_dir()?.join(format!("{}_split.json", session_id)))
}

/// Estimate the token count for a list of messages using tiktoken (cl100k_base).
pub fn estimate_token_count(messages: &[SimplifiedMessage]) -> u32 {
    let bpe = match cl100k_base() {
        Ok(bpe) => bpe,
        Err(_) => {
            // Fallback to character-based estimation if tiktoken fails
            return estimate_token_count_fallback(messages);
        }
    };

    let mut total_tokens: u32 = 0;
    for msg in messages {
        // Count tokens in sender and content
        let text = format!("{}: {}", msg.sender, msg.content);
        total_tokens += bpe.encode_with_special_tokens(&text).len() as u32;
    }
    total_tokens
}

/// Fallback token estimation using character count.
/// Assumes roughly 4 characters per token for English, 2 for Chinese.
fn estimate_token_count_fallback(messages: &[SimplifiedMessage]) -> u32 {
    let mut total_chars: usize = 0;
    for msg in messages {
        total_chars += msg.sender.len() + msg.content.len() + 2; // +2 for ": " separator
    }
    // Use a conservative estimate of 3 chars per token (accounting for mixed content)
    (total_chars / 3) as u32
}

/// Write chat history to a file.
/// Creates the directory if it doesn't exist.
pub async fn write_chat_history(
    session_id: Uuid,
    messages: &[SimplifiedMessage],
    compression_applied: bool,
    split_file: Option<String>,
) -> Result<PathBuf, ChatHistoryFileError> {
    let dir = chat_history_dir()?;
    fs::create_dir_all(&dir).await?;

    let path = chat_history_path(session_id)?;
    let now = Utc::now().to_rfc3339();

    let token_count = estimate_token_count(messages);

    let history = ChatHistoryFile {
        session_id,
        created_at: now.clone(),
        updated_at: now,
        messages: messages.to_vec(),
        metadata: ChatHistoryMetadata {
            token_count,
            compression_applied,
            split_file,
        },
    };

    let json = serde_json::to_string_pretty(&history)?;
    fs::write(&path, json).await?;

    Ok(path)
}

/// Read chat history from a file.
/// Returns None if the file doesn't exist.
pub async fn read_chat_history(
    session_id: Uuid,
) -> Result<Option<ChatHistoryFile>, ChatHistoryFileError> {
    let path = chat_history_path(session_id)?;

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).await?;
    let history: ChatHistoryFile = serde_json::from_str(&content)?;

    Ok(Some(history))
}

/// Create a split file for archived messages.
/// This is used when compression fails and we need to truncate messages.
pub async fn create_split_file(
    session_id: Uuid,
    messages: &[SimplifiedMessage],
) -> Result<PathBuf, ChatHistoryFileError> {
    let dir = chat_history_dir()?;
    fs::create_dir_all(&dir).await?;

    let path = chat_history_split_path(session_id)?;
    let now = Utc::now().to_rfc3339();

    let token_count = estimate_token_count(messages);

    let split_history = ChatHistoryFile {
        session_id,
        created_at: now.clone(),
        updated_at: now,
        messages: messages.to_vec(),
        metadata: ChatHistoryMetadata {
            token_count,
            compression_applied: false,
            split_file: None,
        },
    };

    let json = serde_json::to_string_pretty(&split_history)?;
    fs::write(&path, json).await?;

    Ok(path)
}

/// Append messages to an existing split file or create a new one.
pub async fn append_to_split_file(
    session_id: Uuid,
    new_messages: &[SimplifiedMessage],
) -> Result<PathBuf, ChatHistoryFileError> {
    let path = chat_history_split_path(session_id)?;

    let mut existing_messages = if path.exists() {
        let content = fs::read_to_string(&path).await?;
        let history: ChatHistoryFile = serde_json::from_str(&content)?;
        history.messages
    } else {
        Vec::new()
    };

    existing_messages.extend(new_messages.iter().cloned());
    create_split_file(session_id, &existing_messages).await
}

/// Delete chat history files for a session.
pub async fn delete_chat_history(session_id: Uuid) -> Result<(), ChatHistoryFileError> {
    let main_path = chat_history_path(session_id)?;
    let split_path = chat_history_split_path(session_id)?;

    if main_path.exists() {
        fs::remove_file(&main_path).await?;
    }

    if split_path.exists() {
        fs::remove_file(&split_path).await?;
    }

    Ok(())
}

/// Convert a DateTime to SimplifiedMessage timestamp format
pub fn datetime_to_timestamp(dt: &DateTime<Utc>) -> String {
    dt.to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_estimate_token_count() {
        let messages = vec![
            SimplifiedMessage {
                sender: "user:alice".to_string(),
                content: "Hello, how are you?".to_string(),
                timestamp: "2026-02-27T10:00:00Z".to_string(),
            },
            SimplifiedMessage {
                sender: "agent:assistant".to_string(),
                content: "I'm doing well, thank you!".to_string(),
                timestamp: "2026-02-27T10:00:01Z".to_string(),
            },
        ];

        let token_count = estimate_token_count(&messages);
        assert!(token_count > 0);
        // These messages should be roughly 15-25 tokens
        assert!(token_count < 50);
    }

    #[test]
    fn test_estimate_token_count_chinese() {
        let messages = vec![SimplifiedMessage {
            sender: "user:alice".to_string(),
            content: "你好，世界！".to_string(),
            timestamp: "2026-02-27T10:00:00Z".to_string(),
        }];

        let token_count = estimate_token_count(&messages);
        assert!(token_count > 0);
    }
}
