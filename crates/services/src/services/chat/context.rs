async fn load_chat_compression_settings() -> (u32, u8) {
    let config = super::config::load_config_from_file(&config_path()).await;
    let threshold = config.chat_compression.token_threshold.max(1);
    let percentage = config.chat_compression.compression_percentage.clamp(1, 100);
    (threshold, percentage)
}

fn simplified_to_context_value(message: &SimplifiedMessage) -> Value {
    let time = chrono::DateTime::parse_from_rfc3339(&message.timestamp)
        .map(|dt| {
            dt.with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_else(|_| message.timestamp.clone());

    serde_json::json!({
        "sender": message.sender,
        "content": message.content,
        "time": time,
    })
}

fn simplified_messages_to_jsonl(messages: &[SimplifiedMessage]) -> (Vec<Value>, String) {
    let context_messages: Vec<Value> = messages.iter().map(simplified_to_context_value).collect();
    let jsonl = context_messages
        .iter()
        .filter_map(|msg| serde_json::to_string(msg).ok())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    (context_messages, jsonl)
}

/// Build full (uncompressed) context with a hard token limit.
///
/// This is used by the non-blocking main execution path so agent runs are never
/// delayed by summarization/compression. If the context exceeds MAX_CONTEXT_TOKENS,
/// it will be truncated to the most recent messages to fit within the limit.
pub async fn build_full_context(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<CompactedContext, ChatServiceError> {
    let all_messages = ChatMessage::find_by_session_id(pool, session_id, None)
        .await?
        .into_iter()
        .filter(should_include_message_in_history)
        .collect::<Vec<_>>();
    let session_member_names = ChatSessionAgent::find_all_for_session(pool, session_id)
        .await?
        .into_iter()
        .map(|member| (member.id, member.member_name))
        .collect::<HashMap<_, _>>();
    let member_names = unambiguous_member_names_by_agent_for_session(pool, session_id).await?;
    let agents = ChatAgent::find_all(pool).await?;
    let agent_map: HashMap<Uuid, String> = agents
        .into_iter()
        .map(|agent| {
            (
                agent.id,
                effective_agent_name(&agent, member_names.get(&agent.id).map(String::as_str)),
            )
        })
        .collect();

    let simplified_messages: Vec<SimplifiedMessage> = all_messages
        .iter()
        .map(|message| to_simplified_message(message, &session_member_names, &agent_map))
        .collect();

    // Enforce hard token limit to prevent model input errors
    let total_tokens = estimate_token_count(&simplified_messages);
    let (messages, warning) = if total_tokens > MAX_CONTEXT_TOKENS {
        tracing::warn!(
            session_id = %session_id,
            total_tokens = total_tokens,
            max_tokens = MAX_CONTEXT_TOKENS,
            "Context exceeds token limit; truncating to most recent messages"
        );
        let truncated = truncate_messages_to_token_limit(&simplified_messages, MAX_CONTEXT_TOKENS);
        let warning = CompressionWarning {
            code: "context_truncated".to_string(),
            message: format!(
                "Context was truncated from {} to {} tokens to fit within model limits",
                total_tokens,
                estimate_token_count(&truncated)
            ),
            split_file_path: String::new(),
        };
        (truncated, Some(warning))
    } else {
        (simplified_messages, None)
    };

    let (messages, jsonl) = simplified_messages_to_jsonl(&messages);
    Ok(CompactedContext {
        messages,
        jsonl,
        context_compacted: false,
        compression_warning: warning,
    })
}

/// Truncate messages to fit within a token limit, keeping the most recent messages.
fn truncate_messages_to_token_limit(
    messages: &[SimplifiedMessage],
    max_tokens: u32,
) -> Vec<SimplifiedMessage> {
    if messages.is_empty() {
        return Vec::new();
    }

    let total_tokens = estimate_token_count(messages);
    if total_tokens <= max_tokens {
        return messages.to_vec();
    }

    // Keep the most recent messages that fit within the token budget
    let mut selected_rev: Vec<SimplifiedMessage> = Vec::new();
    let mut selected_tokens = 0u32;

    for message in messages.iter().rev() {
        let message_tokens = estimate_token_count(std::slice::from_ref(message)).max(1);
        if !selected_rev.is_empty() && selected_tokens.saturating_add(message_tokens) > max_tokens {
            break;
        }
        selected_rev.push(message.clone());
        selected_tokens = selected_tokens.saturating_add(message_tokens);
        if selected_tokens >= max_tokens {
            break;
        }
    }

    if selected_rev.is_empty() {
        // Always keep at least the most recent message
        selected_rev.push(messages.last().unwrap().clone());
    }

    selected_rev.reverse();
    selected_rev
}

/// Build compacted context with token-threshold based compression only.
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `session_id` - Chat session ID
/// * `runner_type` - Runner type string for the agent (e.g., "CLAUDE_CODE", "CODEX")
/// * `workspace_path` - Path to workspace for running LLM
/// * `context_dir` - Path to context directory for storing cutoff files
///
/// # Returns
/// CompactedContext with messages and JSONL string
pub async fn build_compacted_context(
    pool: &SqlitePool,
    session_id: Uuid,
    _runner_type: Option<&str>,
    workspace_path: Option<&std::path::Path>,
    context_dir: Option<&std::path::Path>,
) -> Result<CompactedContext, ChatServiceError> {
    // Fetch all messages for the session
    let all_messages = ChatMessage::find_by_session_id(pool, session_id, None)
        .await?
        .into_iter()
        .filter(should_include_message_in_history)
        .collect::<Vec<_>>();
    let session_member_names = ChatSessionAgent::find_all_for_session(pool, session_id)
        .await?
        .into_iter()
        .map(|member| (member.id, member.member_name))
        .collect::<HashMap<_, _>>();
    let member_names = unambiguous_member_names_by_agent_for_session(pool, session_id).await?;
    let agents = ChatAgent::find_all(pool).await?;
    let agent_map: HashMap<Uuid, String> = agents
        .into_iter()
        .map(|agent| {
            (
                agent.id,
                effective_agent_name(&agent, member_names.get(&agent.id).map(String::as_str)),
            )
        })
        .collect();

    let simplified_messages: Vec<SimplifiedMessage> = all_messages
        .iter()
        .map(|message| to_simplified_message(message, &session_member_names, &agent_map))
        .collect();
    let session_agents = ChatSessionAgent::find_all_for_session(pool, session_id).await?;
    let (token_threshold, compression_percentage) = load_chat_compression_settings().await;
    let workspace_path = workspace_path.unwrap_or(std::path::Path::new("."));

    let compression_result = compress_messages_if_needed(
        pool,
        session_id,
        simplified_messages,
        token_threshold,
        compression_percentage,
        &session_agents,
        workspace_path,
        context_dir,
    )
    .await?;

    let (messages, jsonl) = simplified_messages_to_jsonl(&compression_result.messages);

    Ok(CompactedContext {
        messages,
        jsonl,
        context_compacted: compression_result.compression_type != CompressionType::None,
        compression_warning: compression_result.warning,
    })
}

/// Convert ChatMessage to SimplifiedMessage format (sender + content only)
pub fn to_simplified_message(
    message: &ChatMessage,
    session_member_names: &HashMap<Uuid, String>,
    legacy_agent_names: &HashMap<Uuid, String>,
) -> SimplifiedMessage {
    let sender_handle = message
        .meta
        .0
        .get("sender_handle")
        .and_then(|value| value.as_str());
    let sender_name = message
        .sender_session_agent_id
        .and_then(|id| session_member_names.get(&id).cloned())
        .or_else(|| {
            message
                .sender_id
                .and_then(|id| legacy_agent_names.get(&id).cloned())
        });

    let sender = match message.sender_type {
        ChatSenderType::User => format!("user:{}", sender_handle.unwrap_or("user")),
        ChatSenderType::Agent => format!(
            "agent:{}",
            sender_name.unwrap_or_else(|| "agent".to_string())
        ),
        ChatSenderType::System => "system".to_string(),
    };

    SimplifiedMessage {
        sender,
        content: message.content.clone(),
        timestamp: message.created_at.to_rfc3339(),
    }
}

/// Convert all messages in a session to SimplifiedMessage format
pub async fn build_simplified_messages(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<Vec<SimplifiedMessage>, ChatServiceError> {
    let messages = ChatMessage::find_by_session_id(pool, session_id, None)
        .await?
        .into_iter()
        .filter(should_include_message_in_history)
        .collect::<Vec<_>>();
    let session_member_names = ChatSessionAgent::find_all_for_session(pool, session_id)
        .await?
        .into_iter()
        .map(|member| (member.id, member.member_name))
        .collect::<HashMap<_, _>>();
    let member_names = unambiguous_member_names_by_agent_for_session(pool, session_id).await?;
    let agents = ChatAgent::find_all(pool).await?;
    let agent_map: HashMap<Uuid, String> = agents
        .into_iter()
        .map(|agent| {
            (
                agent.id,
                effective_agent_name(&agent, member_names.get(&agent.id).map(String::as_str)),
            )
        })
        .collect();

    Ok(messages
        .iter()
        .map(|msg| to_simplified_message(msg, &session_member_names, &agent_map))
        .collect())
}
