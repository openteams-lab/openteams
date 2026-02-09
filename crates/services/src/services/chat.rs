use std::{collections::HashMap, collections::HashSet, path::Path};

use db::models::{
    chat_agent::ChatAgent,
    chat_message::{ChatMessage, ChatSenderType, CreateChatMessage},
    chat_session::{ChatSession, ChatSessionStatus},
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use thiserror::Error;
use tokio::{fs, io::AsyncWriteExt};
use uuid::Uuid;

/// Maximum number of messages to include in context
const MAX_CONTEXT_MESSAGES: usize = 30;
/// Number of recent messages to keep in full (uncompressed)
const RECENT_MESSAGES_FULL: usize = 5;
/// Target compression ratio for older messages (keep ~40% of content)
const COMPRESSION_TARGET_RATIO: f64 = 0.4;

#[derive(Debug, Error)]
pub enum ChatServiceError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("Chat session not found")]
    SessionNotFound,
    #[error("Chat session is archived")]
    SessionArchived,
    #[error("Validation error: {0}")]
    Validation(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatAttachmentMeta {
    pub id: Uuid,
    pub name: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub kind: String,
    pub relative_path: String,
}

pub fn extract_attachments(meta: &Value) -> Vec<ChatAttachmentMeta> {
    meta.get("attachments")
        .and_then(|value| serde_json::from_value::<Vec<ChatAttachmentMeta>>(value.clone()).ok())
        .unwrap_or_default()
}

pub fn has_attachments(meta: &Value) -> bool {
    !extract_attachments(meta).is_empty()
}

pub fn extract_reference_message_id(meta: &Value) -> Option<Uuid> {
    let id = meta
        .get("reference")
        .and_then(|value| value.get("message_id"))
        .and_then(|value| value.as_str())
        .or_else(|| meta.get("reference_message_id").and_then(|value| value.as_str()));
    id.and_then(|value| Uuid::parse_str(value).ok())
}

/// Compress message content to reduce token usage
/// Keeps the first part of content and truncates with "..." if too long
fn compress_content(content: &str, max_chars: usize) -> String {
    let content = content.trim();
    if content.chars().count() <= max_chars {
        return content.to_string();
    }

    // Find a good break point (end of sentence or word)
    let chars: Vec<char> = content.chars().collect();
    let mut break_point = max_chars;

    // Try to find sentence end (. ! ?) within the range
    for i in (max_chars / 2..max_chars).rev() {
        if i < chars.len() && matches!(chars[i], '.' | '!' | '?' | '。' | '！' | '？') {
            break_point = i + 1;
            break;
        }
    }

    // If no sentence end, find word boundary
    if break_point == max_chars {
        for i in (max_chars / 2..max_chars).rev() {
            if i < chars.len() && (chars[i].is_whitespace() || chars[i] == ',') {
                break_point = i;
                break;
            }
        }
    }

    let truncated: String = chars[..break_point.min(chars.len())].iter().collect();
    format!("{}...[truncated]", truncated.trim())
}

/// Build structured messages with compression for older messages
/// - Keeps the most recent RECENT_MESSAGES_FULL messages in full
/// - Compresses older messages (from index 6 to the oldest)
/// - Limits total messages to MAX_CONTEXT_MESSAGES
pub async fn build_structured_messages_with_compression(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<Vec<Value>, ChatServiceError> {
    let messages = ChatMessage::find_by_session_id(pool, session_id, None).await?;
    let agents = ChatAgent::find_all(pool).await?;
    let agent_map: HashMap<Uuid, String> =
        agents.into_iter().map(|agent| (agent.id, agent.name)).collect();

    let total_messages = messages.len();
    // Apply message limit - take the most recent MAX_CONTEXT_MESSAGES
    let messages: Vec<_> = if total_messages > MAX_CONTEXT_MESSAGES {
        messages.into_iter().skip(total_messages - MAX_CONTEXT_MESSAGES).collect()
    } else {
        messages
    };

    let message_count = messages.len();
    let mut result = Vec::with_capacity(message_count);

    for (idx, message) in messages.into_iter().enumerate() {
        let sender_handle = message
            .meta
            .0
            .get("sender_handle")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());
        let sender_name = message
            .sender_id
            .and_then(|id| agent_map.get(&id).cloned());
        let sender_label = match message.sender_type {
            ChatSenderType::User => sender_handle
                .clone()
                .unwrap_or_else(|| "user".to_string()),
            ChatSenderType::Agent => sender_name
                .clone()
                .or_else(|| message.sender_id.map(|id| id.to_string()))
                .unwrap_or_else(|| "agent".to_string()),
            ChatSenderType::System => "system".to_string(),
        };

        let sender = serde_json::json!({
            "type": message.sender_type,
            "id": message.sender_id,
            "handle": sender_handle,
            "name": sender_name,
            "label": sender_label,
        });

        // Determine if this message should be compressed
        // Recent messages (last RECENT_MESSAGES_FULL) are kept in full
        let is_recent = idx >= message_count.saturating_sub(RECENT_MESSAGES_FULL);

        let content = if is_recent {
            message.content.clone()
        } else {
            // Compress older messages - target ~40% of original length
            let original_len = message.content.chars().count();
            let target_len = (original_len as f64 * COMPRESSION_TARGET_RATIO) as usize;
            let max_chars = target_len.max(100).min(500); // At least 100 chars, max 500
            compress_content(&message.content, max_chars)
        };

        // For compressed messages, strip meta to save tokens
        let meta = if is_recent {
            message.meta.0.clone()
        } else {
            // Keep only essential meta for compressed messages
            let mut minimal_meta = serde_json::json!({});
            if let Some(sender_info) = message.meta.0.get("sender") {
                minimal_meta["sender"] = sender_info.clone();
            }
            minimal_meta
        };

        result.push(serde_json::json!({
            "id": message.id,
            "session_id": message.session_id,
            "created_at": message.created_at,
            "sender": sender,
            "content": content,
            "mentions": message.mentions.0,
            "meta": meta,
            "compressed": !is_recent,
        }));
    }

    Ok(result)
}

pub fn parse_mentions(content: &str) -> Vec<String> {
    let chars: Vec<char> = content.chars().collect();
    let mut mentions = Vec::new();
    let mut seen = HashSet::new();

    for i in 0..chars.len() {
        if chars[i] != '@' {
            continue;
        }

        if i > 0 {
            let prev = chars[i - 1];
            if prev.is_ascii_alphanumeric() || prev == '_' || prev == '-' || prev == '.' {
                continue;
            }
        }

        let mut name = String::new();
        let mut j = i + 1;
        while j < chars.len() {
            let c = chars[j];
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                name.push(c);
                j += 1;
            } else {
                break;
            }
        }

        if !name.is_empty() && seen.insert(name.clone()) {
            mentions.push(name);
        }
    }

    mentions
}

pub async fn create_message(
    pool: &SqlitePool,
    session_id: Uuid,
    sender_type: ChatSenderType,
    sender_id: Option<Uuid>,
    content: String,
    meta: Option<Value>,
) -> Result<ChatMessage, ChatServiceError> {
    create_message_with_id(
        pool,
        session_id,
        sender_type,
        sender_id,
        content,
        meta,
        Uuid::new_v4(),
    )
    .await
}

pub async fn create_message_with_id(
    pool: &SqlitePool,
    session_id: Uuid,
    sender_type: ChatSenderType,
    sender_id: Option<Uuid>,
    content: String,
    meta: Option<Value>,
    message_id: Uuid,
) -> Result<ChatMessage, ChatServiceError> {
    if matches!(sender_type, ChatSenderType::Agent) && sender_id.is_none() {
        return Err(ChatServiceError::Validation(
            "sender_id is required for agent messages".to_string(),
        ));
    }

    let session = ChatSession::find_by_id(pool, session_id)
        .await?
        .ok_or(ChatServiceError::SessionNotFound)?;

    if session.status != ChatSessionStatus::Active {
        return Err(ChatServiceError::SessionArchived);
    }

    let mentions = parse_mentions(&content);
    let mut meta = meta.unwrap_or_else(|| serde_json::json!({}));
    if !meta.is_object() {
        meta = serde_json::json!({ "raw_meta": meta });
    }
    if content.trim().is_empty() && !has_attachments(&meta) {
        return Err(ChatServiceError::Validation(
            "content cannot be empty".to_string(),
        ));
    }

    let sender_handle = meta
        .get("sender_handle")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let sender_name = if matches!(sender_type, ChatSenderType::Agent) {
        if let Some(agent_id) = sender_id {
            ChatAgent::find_by_id(pool, agent_id)
                .await?
                .map(|agent| agent.name)
        } else {
            None
        }
    } else {
        None
    };

    let sender_label = match sender_type {
        ChatSenderType::User => sender_handle.clone().unwrap_or_else(|| "user".to_string()),
        ChatSenderType::Agent => sender_name
            .clone()
            .or_else(|| sender_id.map(|id| id.to_string()))
            .unwrap_or_else(|| "agent".to_string()),
        ChatSenderType::System => "system".to_string(),
    };

    if meta.get("sender").is_none() {
        meta["sender"] = serde_json::json!({
            "type": sender_type,
            "id": sender_id,
            "handle": sender_handle,
            "name": sender_name,
            "label": sender_label,
        });
    }

    meta["structured"] = serde_json::json!({
        "sender_type": sender_type,
        "sender_id": sender_id,
        "sender_handle": sender_handle,
        "sender_label": sender_label,
        "content": content.clone(),
        "mentions": mentions.clone(),
        "created_at": Utc::now().to_rfc3339(),
    });

    let message = ChatMessage::create(
        pool,
        &CreateChatMessage {
            session_id,
            sender_type,
            sender_id,
            content,
            mentions,
            meta,
        },
        message_id,
    )
    .await?;

    ChatSession::touch(pool, session_id).await?;

    Ok(message)
}

pub async fn build_structured_messages(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<Vec<Value>, ChatServiceError> {
    let messages = ChatMessage::find_by_session_id(pool, session_id, None).await?;
    let agents = ChatAgent::find_all(pool).await?;
    let agent_map: HashMap<Uuid, String> =
        agents.into_iter().map(|agent| (agent.id, agent.name)).collect();

    let mut result = Vec::with_capacity(messages.len());

    for message in messages {
        let sender_handle = message
            .meta
            .0
            .get("sender_handle")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());
        let sender_name = message
            .sender_id
            .and_then(|id| agent_map.get(&id).cloned());
        let sender_label = match message.sender_type {
            ChatSenderType::User => sender_handle
                .clone()
                .unwrap_or_else(|| "user".to_string()),
            ChatSenderType::Agent => sender_name
                .clone()
                .or_else(|| message.sender_id.map(|id| id.to_string()))
                .unwrap_or_else(|| "agent".to_string()),
            ChatSenderType::System => "system".to_string(),
        };

        let sender = serde_json::json!({
            "type": message.sender_type,
            "id": message.sender_id,
            "handle": sender_handle,
            "name": sender_name,
            "label": sender_label,
        });

        result.push(serde_json::json!({
            "id": message.id,
            "session_id": message.session_id,
            "created_at": message.created_at,
            "sender": sender,
            "content": message.content,
            "mentions": message.mentions.0,
            "meta": message.meta.0,
        }));
    }

    Ok(result)
}

pub async fn export_session_archive(
    pool: &SqlitePool,
    session: &ChatSession,
    archive_dir: &Path,
) -> Result<String, ChatServiceError> {
    fs::create_dir_all(archive_dir).await?;

    let messages = build_structured_messages(pool, session.id).await?;
    let export_path = archive_dir.join("messages_export.jsonl");
    let mut file = fs::File::create(&export_path).await?;
    for message in messages {
        let line = serde_json::to_string(&message).unwrap_or_default();
        file.write_all(line.as_bytes()).await?;
        file.write_all(b"\n").await?;
    }

    let summary_path = archive_dir.join("session_summary.md");
    let summary = session
        .summary_text
        .clone()
        .unwrap_or_else(|| "No summary available.".to_string());
    fs::write(&summary_path, summary).await?;

    Ok(archive_dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::parse_mentions;

    #[test]
    fn parses_mentions_with_basic_tokens() {
        let mentions = parse_mentions("@coder please check @planner");
        assert_eq!(mentions, vec!["coder", "planner"]);
    }

    #[test]
    fn ignores_email_addresses() {
        let mentions = parse_mentions("email me at test@example.com");
        assert!(mentions.is_empty());
    }

    #[test]
    fn de_dupes_mentions_in_order() {
        let mentions = parse_mentions("@a @a @b");
        assert_eq!(mentions, vec!["a", "b"]);
    }
}
