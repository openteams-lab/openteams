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

    let mut meta = meta.unwrap_or_else(|| serde_json::json!({}));
    if !meta.is_object() {
        meta = serde_json::json!({ "raw_meta": meta });
    }
    let mentions = match sender_type {
        ChatSenderType::Agent => parse_agent_send_mentions(&meta),
        ChatSenderType::User => parse_user_message_mentions(&content, &meta),
        _ => parse_mentions(&content),
    };
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
        let sender_session_agent_id = meta
            .get("session_agent_id")
            .and_then(serde_json::Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        resolve_sender_member_name(pool, session_id, sender_session_agent_id, sender_id).await?
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

pub fn is_protocol_notice_history_message(message: &ChatMessage) -> bool {
    matches!(message.sender_type, ChatSenderType::System)
        && message.meta.0.get("protocol_error").is_some()
}

pub fn should_include_message_in_history(message: &ChatMessage) -> bool {
    !is_protocol_notice_history_message(message)
}

pub async fn build_structured_messages(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<Vec<Value>, ChatServiceError> {
    let messages = ChatMessage::find_by_session_id(pool, session_id, None)
        .await?
        .into_iter()
        .filter(should_include_message_in_history)
        .collect::<Vec<_>>();
    let member_names = member_name_overrides_for_session(pool, session_id).await?;
    let legacy_member_names =
        unambiguous_member_names_by_agent_for_session(pool, session_id).await?;
    let agents = ChatAgent::find_all(pool).await?;
    let agent_map: HashMap<Uuid, String> = agents
        .into_iter()
        .map(|agent| (agent.id, agent.name))
        .collect();

    let mut result = Vec::with_capacity(messages.len());

    for message in messages {
        let sender_handle = message
            .meta
            .0
            .get("sender_handle")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());
        let sender_name = message
            .sender_session_agent_id
            .and_then(|id| member_names.get(&id).cloned())
            .or_else(|| {
                message
                    .sender_id
                    .and_then(|id| legacy_member_names.get(&id).cloned())
            })
            .or_else(|| message.sender_id.and_then(|id| agent_map.get(&id).cloned()));
        let sender_label = match message.sender_type {
            ChatSenderType::User => sender_handle.clone().unwrap_or_else(|| "user".to_string()),
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
