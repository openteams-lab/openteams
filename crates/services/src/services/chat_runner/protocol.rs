use super::*;

pub(super) struct ProtocolNoticeArgs<'a> {
    session_id: Uuid,
    session_agent_id: Uuid,
    agent_id: Uuid,
    run_id: Uuid,
    agent_name: &'a str,
    output_is_empty: bool,
}

impl ChatRunner {
    pub(super) fn emit_protocol_notice(
        &self,
        notice: ProtocolNoticeArgs<'_>,
        error: &AgentProtocolError,
    ) {
        self.emit(
            notice.session_id,
            ChatStreamEvent::ProtocolNotice {
                session_id: notice.session_id,
                session_agent_id: notice.session_agent_id,
                agent_id: notice.agent_id,
                run_id: notice.run_id,
                agent_name: notice.agent_name.to_string(),
                code: error.code.clone(),
                target: error.target.clone(),
                detail: error.detail.clone(),
                output_is_empty: notice.output_is_empty,
            },
        );
    }

    pub(super) fn protocol_notice_log_message(code: &ChatProtocolNoticeCode) -> &'static str {
        match code {
            ChatProtocolNoticeCode::InvalidJson => "agent returned invalid message protocol JSON",
            ChatProtocolNoticeCode::NotJsonArray => {
                "agent returned a non-array message protocol payload"
            }
            ChatProtocolNoticeCode::EmptyMessage => "agent returned an empty protocol message",
            ChatProtocolNoticeCode::MissingSendTarget => {
                "agent returned a send message without a target"
            }
            ChatProtocolNoticeCode::InvalidSendTarget => {
                "agent returned a send message with an invalid target"
            }
            ChatProtocolNoticeCode::InvalidSendIntent => {
                "agent returned a send message with an invalid intent"
            }
        }
    }

    pub(super) fn protocol_notice_reason(error: &AgentProtocolError) -> String {
        match error.code {
            ChatProtocolNoticeCode::InvalidJson => match error.detail.as_deref() {
                Some(detail) => format!(
                    "Could not parse JSON in response: {}. Please respond with a JSON array.",
                    detail
                ),
                None => "Could not find valid JSON in response. Please respond with a JSON array."
                    .to_string(),
            },
            ChatProtocolNoticeCode::NotJsonArray => match error.detail.as_deref() {
                Some(detail) => format!(
                    "Protocol error: response must be a JSON array of messages. {}",
                    detail
                ),
                None => "Protocol error: response must be a JSON array of messages.".to_string(),
            },
            ChatProtocolNoticeCode::EmptyMessage => "Protocol error: message is empty.".to_string(),
            ChatProtocolNoticeCode::MissingSendTarget => {
                "Protocol error: send messages must include a 'to' field.".to_string()
            }
            ChatProtocolNoticeCode::InvalidSendTarget => format!(
                "Protocol error: invalid send target '{}'.",
                error.target.as_deref().unwrap_or_default()
            ),
            ChatProtocolNoticeCode::InvalidSendIntent => match error.detail.as_deref() {
                Some(detail) => format!(
                    "Protocol error: invalid send intent '{}'. {}",
                    error.target.as_deref().unwrap_or_default(),
                    detail
                ),
                None => format!(
                    "Protocol error: invalid send intent '{}'.",
                    error.target.as_deref().unwrap_or_default()
                ),
            },
        }
    }

    pub(super) fn should_handle_protocol_error_as_raw_output(error: &AgentProtocolError) -> bool {
        matches!(
            error.code,
            ChatProtocolNoticeCode::InvalidJson | ChatProtocolNoticeCode::NotJsonArray
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn persist_raw_agent_message_and_work_record(
        &self,
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        agent_name: &str,
        source_message_id: Uuid,
        chain_depth: u32,
        prompt_language: ResolvedPromptLanguage,
        raw_output: &str,
        error_info: Option<(&str, Option<&NormalizedEntryError>)>,
        token_usage: Option<&TokenUsageInfo>,
    ) -> Result<(), ChatRunnerError> {
        let output_is_empty = raw_output.trim().is_empty();

        tracing::debug!(
            session_id = %session_id,
            run_id = %run_id,
            agent_id = %agent_id,
            agent_name = %agent_name,
            output_is_empty = output_is_empty,
            has_error_info = error_info.is_some(),
            "[chat_runner] Persisting raw agent message with error info"
        );
        let mut meta = serde_json::json!({
            "app_language": prompt_language.code,
            "run_id": run_id,
            "session_id": session_id,
            "session_agent_id": session_agent_id,
            "source_message_id": source_message_id,
            "chain_depth": chain_depth + 1,
            "protocol": {
                "type": "message",
                "mode": "raw_fallback",
                "output_is_empty": output_is_empty
            }
        });
        // Include error info in meta if provided
        if let Some((error_content, error_type)) = error_info {
            let summary: String = error_content.chars().take(200).collect();
            let mut error_meta = serde_json::json!({
                "content": error_content,
                "summary": summary,
            });
            if let Some(et) = error_type {
                error_meta["error_type"] =
                    serde_json::to_value(et).unwrap_or(serde_json::Value::Null);
            }
            meta["error"] = error_meta;
        }

        if let Some(token_usage) = token_usage {
            meta["token_usage"] = serde_json::json!({
                "total_tokens": token_usage.total_tokens,
                "model_context_window": token_usage.model_context_window,
                "input_tokens": token_usage.input_tokens,
                "output_tokens": token_usage.output_tokens,
                "cache_read_tokens": token_usage.cache_read_tokens,
                "cache_write_tokens": token_usage.cache_write_tokens,
                "is_estimated": token_usage.is_estimated,
            });
        }
        let message = chat::create_message(
            &self.db.pool,
            session_id,
            ChatSenderType::Agent,
            Some(agent_id),
            raw_output.to_string(),
            Some(meta),
        )
        .await?;

        self.emit_message_new(session_id, message.clone());

        let entry = WorkRecordEntry {
            session_id,
            run_id,
            session_agent_id,
            agent_id,
            owner: agent_name.to_string(),
            message_type: "message",
            content: raw_output.to_string(),
            created_at: message.created_at.to_rfc3339(),
        };
        Self::append_jsonl_line(&Self::session_work_records_path(session_id), &entry).await?;

        Ok(())
    }

    /// Persist an error message when the agent fails without producing valid output.
    /// Creates an agent message with error details visible to the user.
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn persist_agent_error_message(
        &self,
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        agent_name: &str,
        source_message_id: Uuid,
        error_content: &str,
        error_type: Option<&NormalizedEntryError>,
    ) -> Result<(), ChatRunnerError> {
        let summary: String = error_content.chars().take(200).collect();
        let mut error_meta = serde_json::json!({
            "content": error_content,
            "summary": summary,
        });
        if let Some(et) = error_type {
            error_meta["error_type"] = serde_json::to_value(et).unwrap_or(serde_json::Value::Null);
        }

        let meta = serde_json::json!({
            "run_id": run_id,
            "session_agent_id": session_agent_id,
            "agent_id": agent_id,
            "source_message_id": source_message_id,
            "error": error_meta,
        });

        tracing::info!(
            session_id = %session_id,
            run_id = %run_id,
            agent_id = %agent_id,
            agent_name = %agent_name,
            error_summary = %summary,
            "[chat_runner] Persisting agent error message"
        );

        let message = chat::create_message(
            &self.db.pool,
            session_id,
            ChatSenderType::Agent,
            Some(agent_id),
            error_content.to_string(),
            Some(meta),
        )
        .await?;

        self.emit_message_new(session_id, message);

        Ok(())
    }

    pub(super) fn protocol_work_item_type(
        message_type: &AgentProtocolMessageType,
    ) -> Option<ChatWorkItemType> {
        match message_type {
            AgentProtocolMessageType::Artifact => Some(ChatWorkItemType::Artifact),
            AgentProtocolMessageType::Conclusion => Some(ChatWorkItemType::Conclusion),
            AgentProtocolMessageType::Send | AgentProtocolMessageType::Record => None,
        }
    }

    pub(super) fn work_item_type_label(item_type: &ChatWorkItemType) -> &'static str {
        match item_type {
            ChatWorkItemType::Artifact => "artifact",
            ChatWorkItemType::Conclusion => "conclusion",
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn persist_work_item(
        &self,
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        agent_name: &str,
        item_type: ChatWorkItemType,
        content: String,
    ) -> Result<ChatWorkItem, ChatRunnerError> {
        let work_item = ChatWorkItem::create(
            &self.db.pool,
            &CreateChatWorkItem {
                session_id,
                run_id,
                session_agent_id,
                agent_id,
                item_type: item_type.clone(),
                content: content.clone(),
            },
            Uuid::new_v4(),
        )
        .await?;

        ChatSession::touch(&self.db.pool, session_id).await?;
        self.emit_work_item_new(session_id, work_item.clone());

        let entry = WorkRecordEntry {
            session_id,
            run_id,
            session_agent_id,
            agent_id,
            owner: agent_name.to_string(),
            message_type: Self::work_item_type_label(&item_type),
            content,
            created_at: work_item.created_at.to_rfc3339(),
        };
        Self::append_jsonl_line(&Self::session_work_records_path(session_id), &entry).await?;

        Ok(work_item)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn emit_protocol_error_message(
        &self,
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        agent_name: &str,
        source_message_id: Uuid,
        error: &AgentProtocolError,
        output_is_empty: bool,
        raw_output: &str,
    ) -> Result<(), ChatRunnerError> {
        let reason = Self::protocol_notice_reason(error);
        tracing::warn!(
            session_id = %session_id,
            session_agent_id = %session_agent_id,
            agent_id = %agent_id,
            run_id = %run_id,
            source_message_id = %source_message_id,
            agent_name,
            code = ?error.code,
            target = error.target.as_deref(),
            detail = error.detail.as_deref(),
            reason = %reason,
            output_is_empty = output_is_empty,
            raw_output_len = raw_output.len(),
            "[chat_runner] Protocol error detected: {}",
            Self::protocol_notice_log_message(&error.code)
        );

        self.emit_protocol_notice(
            ProtocolNoticeArgs {
                session_id,
                session_agent_id,
                agent_id,
                run_id,
                agent_name,
                output_is_empty,
            },
            error,
        );
        self.persist_protocol_error_message(
            session_id,
            session_agent_id,
            agent_id,
            run_id,
            agent_name,
            source_message_id,
            error,
            output_is_empty,
            raw_output,
            &reason,
        )
        .await;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn persist_protocol_error_message(
        &self,
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        agent_name: &str,
        source_message_id: Uuid,
        error: &AgentProtocolError,
        output_is_empty: bool,
        raw_output: &str,
        reason: &str,
    ) {
        let mut meta = serde_json::json!({
            "run_id": run_id,
            "session_id": session_id,
            "session_agent_id": session_agent_id,
            "agent_id": agent_id,
            "protocol_error": {
                "code": error.code.clone(),
                "reason": reason,
                "target": error.target.clone(),
                "detail": error.detail.clone(),
                "agent_name": agent_name,
                "source_message_id": source_message_id,
                "output_is_empty": output_is_empty,
            }
        });

        if !raw_output.trim().is_empty() {
            meta["protocol_error"]["raw_output"] = serde_json::json!(raw_output);
        }

        let content = format!(
            "Agent \"{}\" returned output that could not be processed by the message protocol.",
            agent_name
        );

        match chat::create_message(
            &self.db.pool,
            session_id,
            ChatSenderType::System,
            None,
            content,
            Some(meta),
        )
        .await
        {
            Ok(message) => self.emit_message_new(session_id, message),
            Err(err) => {
                tracing::warn!(
                    session_id = %session_id,
                    run_id = %run_id,
                    session_agent_id = %session_agent_id,
                    agent_id = %agent_id,
                    error = %err,
                    "failed to persist protocol error system message"
                );
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn process_agent_protocol_output(
        &self,
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        agent_name: &str,
        run_id: Uuid,
        source_message_id: Uuid,
        chain_depth: u32,
        prompt_language: ResolvedPromptLanguage,
        latest_assistant: &str,
        error_content: Option<&str>,
        error_type: Option<&NormalizedEntryError>,
        token_usage: Option<&TokenUsageInfo>,
    ) -> Result<usize, ChatRunnerError> {
        let output_is_empty = latest_assistant.trim().is_empty();
        let has_error = error_content.is_some_and(|e| !e.is_empty());
        let error_info = error_content.map(|ec| (ec, error_type));

        tracing::debug!(
            session_id = %session_id,
            run_id = %run_id,
            agent_id = %agent_id,
            agent_name = %agent_name,
            output_is_empty = output_is_empty,
            has_error = has_error,
            error_type = ?error_type,
            error_info = ?error_info,
            "[chat_runner] Processing agent protocol output"
        );
        let protocol_messages = match Self::parse_agent_protocol_messages(latest_assistant) {
            Ok(messages) => messages,
            Err(err) => {
                if err.code == ChatProtocolNoticeCode::EmptyMessage {
                    // If there's an error, persist a message even with empty output
                    if has_error {
                        tracing::info!(
                            session_id = %session_id,
                            session_agent_id = %session_agent_id,
                            agent_id = %agent_id,
                            run_id = %run_id,
                            source_message_id = %source_message_id,
                            agent_name,
                            "persisting error message with empty assistant output"
                        );
                        self.persist_raw_agent_message_and_work_record(
                            session_id,
                            session_agent_id,
                            agent_id,
                            run_id,
                            agent_name,
                            source_message_id,
                            chain_depth,
                            prompt_language,
                            latest_assistant,
                            error_info,
                            token_usage,
                        )
                        .await?;
                        return Ok(1);
                    }
                    tracing::info!(
                        session_id = %session_id,
                        session_agent_id = %session_agent_id,
                        agent_id = %agent_id,
                        run_id = %run_id,
                        source_message_id = %source_message_id,
                        agent_name,
                        "skipping empty assistant output"
                    );
                    return Ok(0);
                }

                if Self::should_handle_protocol_error_as_raw_output(&err) {
                    tracing::info!(
                        session_id = %session_id,
                        session_agent_id = %session_agent_id,
                        agent_id = %agent_id,
                        run_id = %run_id,
                        source_message_id = %source_message_id,
                        agent_name,
                        code = ?err.code,
                        output_is_empty = output_is_empty,
                        "persisting protocol fallback output as a raw assistant message"
                    );
                    self.persist_raw_agent_message_and_work_record(
                        session_id,
                        session_agent_id,
                        agent_id,
                        run_id,
                        agent_name,
                        source_message_id,
                        chain_depth,
                        prompt_language,
                        latest_assistant,
                        error_info,
                        token_usage,
                    )
                    .await?;
                    return Ok(1);
                }

                self.emit_protocol_error_message(
                    session_id,
                    session_agent_id,
                    agent_id,
                    run_id,
                    agent_name,
                    source_message_id,
                    &err,
                    output_is_empty,
                    latest_assistant,
                )
                .await?;
                return Ok(0);
            }
        };

        for message in &protocol_messages {
            match &message.message_type {
                AgentProtocolMessageType::Record => {
                    let created_at = Utc::now().to_rfc3339();
                    let entry = SharedBlackboardEntry {
                        session_id,
                        run_id,
                        session_agent_id,
                        agent_id,
                        owner: agent_name.to_string(),
                        message_type: "record",
                        content: message.content.clone(),
                        created_at,
                    };
                    Self::append_jsonl_line(
                        &Self::session_shared_blackboard_path(session_id),
                        &entry,
                    )
                    .await?;
                }
                AgentProtocolMessageType::Artifact | AgentProtocolMessageType::Conclusion => {
                    let Some(item_type) = Self::protocol_work_item_type(&message.message_type)
                    else {
                        continue;
                    };
                    self.persist_work_item(
                        session_id,
                        session_agent_id,
                        agent_id,
                        run_id,
                        agent_name,
                        item_type,
                        message.content.clone(),
                    )
                    .await?;
                }
                AgentProtocolMessageType::Send => {}
            }
        }

        let session = ChatSession::find_by_id(&self.db.pool, session_id).await?;
        let mut send_count = 0usize;

        for (index, message) in protocol_messages.into_iter().enumerate() {
            if !matches!(message.message_type, AgentProtocolMessageType::Send) {
                continue;
            }

            let Some(target) = message.to.as_deref() else {
                continue;
            };
            let content = Self::build_send_message_content(target, &message.content);
            let intent = message.intent.as_deref();
            let intent_meaning = intent.and_then(Self::protocol_send_intent_meaning);
            let mut meta = Self::build_protocol_send_message_meta(
                prompt_language.code,
                run_id,
                session_agent_id,
                source_message_id,
                chain_depth,
                target,
                index,
                intent,
                intent_meaning,
                token_usage,
            );

            // Sync error info from the run to the message meta so frontend can display it
            if let Some(ref ec) = error_content
                && !ec.is_empty()
            {
                let summary: String = ec.chars().take(200).collect();
                let mut error_meta = serde_json::json!({
                    "content": ec,
                    "summary": summary,
                });
                if let Some(et) = error_type {
                    error_meta["error_type"] =
                        serde_json::to_value(et).unwrap_or(serde_json::Value::Null);
                }
                meta["error"] = error_meta;

                tracing::debug!(
                    session_id = %session_id,
                    run_id = %run_id,
                    agent_id = %agent_id,
                    error_type = ?error_type,
                    error_content_len = ec.len(),
                    "[chat_runner] Syncing error info to message meta"
                );
            }

            let routed_message = chat::create_message(
                &self.db.pool,
                session_id,
                ChatSenderType::Agent,
                Some(agent_id),
                content,
                Some(meta),
            )
            .await?;

            if let Some(ref session) = session {
                self.handle_message(session, &routed_message).await;
            } else {
                self.emit_message_new(session_id, routed_message);
            }

            send_count += 1;
        }

        Ok(send_count)
    }
}
