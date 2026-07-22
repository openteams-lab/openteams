#![allow(clippy::too_many_arguments)]

use super::*;

pub(super) struct ProtocolNoticeArgs<'a> {
    session_id: Uuid,
    session_agent_id: Uuid,
    agent_id: Uuid,
    run_id: Uuid,
    agent_name: &'a str,
    output_is_empty: bool,
}

#[derive(Debug, Clone)]
struct PlanGenerationPreviousPlanContext {
    plan_id: Uuid,
    revision_id: Uuid,
    plan_json: String,
}

const AGENT_EMPTY_OUTPUT_FALLBACK_MESSAGE: &str = "Agent运行失败";
const AGENT_EMPTY_OUTPUT_FALLBACK_I18N_KEY: &str = "agent.runFailed";
const AGENT_STOPPED_OUTPUT_I18N_KEY: &str = "agent.stopped";

#[derive(Debug, Clone, Copy)]
pub(super) struct AgentEmptyOutputFallback {
    message: &'static str,
    i18n_key: Option<&'static str>,
}

const DEFAULT_AGENT_EMPTY_OUTPUT_FALLBACK: AgentEmptyOutputFallback = AgentEmptyOutputFallback {
    message: AGENT_EMPTY_OUTPUT_FALLBACK_MESSAGE,
    i18n_key: Some(AGENT_EMPTY_OUTPUT_FALLBACK_I18N_KEY),
};

impl ChatRunner {
    fn localized_agent_stopped_message(language_code: &str) -> &'static str {
        match language_code {
            "zh-Hans" | "zh-Hant" => "Agent停止运行",
            "ja" => "エージェントは停止しました",
            "ko" => "에이전트 실행이 중지되었습니다",
            "fr" => "L’agent a été arrêté",
            "es" => "El agente se detuvo",
            _ => "Agent stopped",
        }
    }

    fn stopped_empty_output_fallback(language_code: &str) -> AgentEmptyOutputFallback {
        AgentEmptyOutputFallback {
            message: Self::localized_agent_stopped_message(language_code),
            i18n_key: Some(AGENT_STOPPED_OUTPUT_I18N_KEY),
        }
    }

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
        client_message_id: Option<&str>,
        chain_depth: u32,
        prompt_language: ResolvedPromptLanguage,
        raw_output: &str,
        error_info: Option<(&str, Option<&NormalizedEntryError>)>,
        token_usage: Option<&TokenUsageInfo>,
        run_model: Option<&str>,
        empty_output_fallback: Option<AgentEmptyOutputFallback>,
    ) -> Result<(), ChatRunnerError> {
        let output_is_empty = raw_output.trim().is_empty();
        let empty_output_fallback =
            empty_output_fallback.unwrap_or(DEFAULT_AGENT_EMPTY_OUTPUT_FALLBACK);

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
            "model": run_model,
            "source_message_id": source_message_id,
            "client_message_id": client_message_id,
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
                "reasoning_output_tokens": token_usage.reasoning_output_tokens,
                "cache_read_tokens": token_usage.cache_read_tokens,
                "runtime_agent": token_usage.runtime_agent,
                "runtime_model_id": token_usage.runtime_model_id,
                "provider_id": token_usage.provider_id,
                "runtime_thread_id": token_usage.runtime_thread_id,
                "usage_scope": token_usage.usage_scope,
                "snapshot_total_tokens": token_usage.snapshot_total_tokens,
                "snapshot_input_tokens": token_usage.snapshot_input_tokens,
                "snapshot_output_tokens": token_usage.snapshot_output_tokens,
                "snapshot_reasoning_output_tokens": token_usage.snapshot_reasoning_output_tokens,
                "snapshot_cache_read_tokens": token_usage.snapshot_cache_read_tokens,
                "is_estimated": token_usage.is_estimated,
            });
        }
        let (display_content, used_empty_output_fallback) = if raw_output.trim().is_empty() {
            match error_info.and_then(|(error_content, _)| {
                let trimmed = error_content.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            }) {
                Some(error_content) => (error_content, false),
                None => (empty_output_fallback.message.to_string(), true),
            }
        } else {
            (raw_output.to_string(), false)
        };

        if used_empty_output_fallback
            && let Some(i18n_key) = empty_output_fallback.i18n_key
        {
            meta["i18n"] = serde_json::json!({
                "key": i18n_key,
                "params": {}
            });
        }

        let message = chat::create_message(
            &self.db.pool,
            session_id,
            ChatSenderType::Agent,
            Some(agent_id),
            display_content.clone(),
            Some(meta),
        )
        .await?;

        InboxService::new()
            .notify_chat_agent_message(&self.db.pool, &message, Some(agent_name))
            .await;
        self.emit_message_new(session_id, message.clone());

        let entry = WorkRecordEntry {
            session_id,
            run_id,
            session_agent_id,
            agent_id,
            owner: agent_name.to_string(),
            message_type: "message",
            content: display_content,
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
        client_message_id: Option<&str>,
        error_content: &str,
        error_type: Option<&NormalizedEntryError>,
        run_model: Option<&str>,
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
            "model": run_model,
            "source_message_id": source_message_id,
            "client_message_id": client_message_id,
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

        InboxService::new()
            .notify_chat_agent_failed(
                &self.db.pool,
                session_id,
                run_id,
                agent_name,
                Some(error_content),
            )
            .await;
        self.emit_message_new(session_id, message);

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn persist_protocol_display_fallback_message(
        &self,
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        source_message_id: Uuid,
        client_message_id: Option<&str>,
        chain_depth: u32,
        prompt_language: ResolvedPromptLanguage,
        fallback_type: &str,
        content: String,
        error_content: Option<&str>,
        error_type: Option<&NormalizedEntryError>,
        token_usage: Option<&TokenUsageInfo>,
        run_model: Option<&str>,
    ) -> Result<(), ChatRunnerError> {
        let mut meta = Self::build_protocol_send_message_meta(
            prompt_language.code,
            run_id,
            session_agent_id,
            source_message_id,
            client_message_id,
            chain_depth,
            "you",
            0,
            None,
            None,
            token_usage,
            run_model,
        );
        meta["protocol"] = serde_json::json!({
            "type": fallback_type,
            "mode": "display_fallback",
            "source": "no_send"
        });

        if let Some(error_content) = error_content
            && !error_content.trim().is_empty()
        {
            let summary: String = error_content.chars().take(200).collect();
            let mut error_meta = serde_json::json!({
                "content": error_content,
                "summary": summary,
            });
            if let Some(error_type) = error_type {
                error_meta["error_type"] =
                    serde_json::to_value(error_type).unwrap_or(serde_json::Value::Null);
            }
            meta["error"] = error_meta;
        }

        let message = chat::create_message(
            &self.db.pool,
            session_id,
            ChatSenderType::Agent,
            Some(agent_id),
            content,
            Some(meta),
        )
        .await?;
        InboxService::new()
            .notify_chat_agent_message(&self.db.pool, &message, None)
            .await;
        self.emit_message_new(session_id, message);
        Ok(())
    }

    pub(super) fn protocol_work_item_type(
        message_type: &AgentProtocolMessageType,
    ) -> Option<ChatWorkItemType> {
        match message_type {
            AgentProtocolMessageType::Artifact => Some(ChatWorkItemType::Artifact),
            AgentProtocolMessageType::Conclusion => Some(ChatWorkItemType::Conclusion),
            AgentProtocolMessageType::Send
            | AgentProtocolMessageType::Record
            | AgentProtocolMessageType::WorkflowGenerate => None,
        }
    }

    pub(super) fn should_route_protocol_send(workflow_route_mode: bool, target: &str) -> bool {
        !workflow_route_mode || target.trim().eq_ignore_ascii_case("you")
    }

    pub(super) fn work_item_type_label(item_type: &ChatWorkItemType) -> &'static str {
        match item_type {
            ChatWorkItemType::Artifact => "artifact",
            ChatWorkItemType::Conclusion => "conclusion",
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn persist_work_item(
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
            Ok(message) => {
                InboxService::new()
                    .notify_chat_agent_failed(
                        &self.db.pool,
                        session_id,
                        run_id,
                        agent_name,
                        Some(reason),
                    )
                    .await;
                self.emit_message_new(session_id, message);
            }
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
        client_message_id: Option<&str>,
        chain_depth: u32,
        prompt_language: ResolvedPromptLanguage,
        latest_assistant: &str,
        error_content: Option<&str>,
        error_type: Option<&NormalizedEntryError>,
        completion_was_stopped: bool,
        token_usage: Option<&TokenUsageInfo>,
        run_model: Option<&str>,
        protocol_retry_attempt: u32,
    ) -> Result<ProtocolProcessResult, ChatRunnerError> {
        let output_is_empty = latest_assistant.trim().is_empty();
        let has_error = error_content.is_some_and(|e| !e.is_empty());
        let error_info = error_content.map(|ec| (ec, error_type));
        let empty_output_fallback = if completion_was_stopped {
            Self::stopped_empty_output_fallback(prompt_language.code)
        } else {
            DEFAULT_AGENT_EMPTY_OUTPUT_FALLBACK
        };

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
                    tracing::info!(
                        session_id = %session_id,
                        session_agent_id = %session_agent_id,
                        agent_id = %agent_id,
                        run_id = %run_id,
                        source_message_id = %source_message_id,
                        agent_name,
                        has_error,
                        "persisting fallback message for empty assistant output"
                    );
                    self.persist_raw_agent_message_and_work_record(
                        session_id,
                        session_agent_id,
                        agent_id,
                        run_id,
                        agent_name,
                        source_message_id,
                        client_message_id,
                        chain_depth,
                        prompt_language,
                        latest_assistant,
                        error_info,
                        token_usage,
                        run_model,
                        Some(empty_output_fallback),
                    )
                    .await?;
                    return Ok(ProtocolProcessResult::Success(1));
                }

                if Self::should_handle_protocol_error_as_raw_output(&err) {
                    // Check if we can retry before falling back to raw output
                    if protocol_retry_attempt < MAX_PROTOCOL_PARSE_RETRIES {
                        tracing::info!(
                            session_id = %session_id,
                            session_agent_id = %session_agent_id,
                            agent_id = %agent_id,
                            run_id = %run_id,
                            agent_name,
                            code = ?err.code,
                            protocol_retry_attempt,
                            max_retries = MAX_PROTOCOL_PARSE_RETRIES,
                            "retryable protocol parse failure; signaling retry"
                        );
                        return Ok(ProtocolProcessResult::RetryableParseFailure {
                            code: err.code,
                            detail: err.detail,
                        });
                    }

                    tracing::info!(
                        session_id = %session_id,
                        session_agent_id = %session_agent_id,
                        agent_id = %agent_id,
                        run_id = %run_id,
                        source_message_id = %source_message_id,
                        agent_name,
                        code = ?err.code,
                        output_is_empty = output_is_empty,
                        protocol_retry_attempt,
                        "retries exhausted; reporting protocol parse failure"
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
                        &err,
                    );
                    self.persist_raw_agent_message_and_work_record(
                        session_id,
                        session_agent_id,
                        agent_id,
                        run_id,
                        agent_name,
                        source_message_id,
                        client_message_id,
                        chain_depth,
                        prompt_language,
                        latest_assistant,
                        error_info,
                        token_usage,
                        run_model,
                        Some(empty_output_fallback),
                    )
                    .await?;
                    return Ok(ProtocolProcessResult::Success(1));
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
                return Ok(ProtocolProcessResult::ProtocolFailure);
            }
        };

        let mut workflow_generate_detected = false;
        let mut workflow_generate_plan_check = false;
        let mut workflow_generate_content = String::new();
        let mut workflow_generate_design_doc_paths: Option<Vec<String>> = None;
        let mut conclusion_display_fallback: Option<String> = None;
        let mut record_display_fallback: Option<String> = None;

        for message in &protocol_messages {
            match &message.message_type {
                AgentProtocolMessageType::Record => {
                    if record_display_fallback.is_none() {
                        record_display_fallback = Some(message.content.clone());
                    }
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
                    if matches!(&message.message_type, AgentProtocolMessageType::Conclusion)
                        && conclusion_display_fallback.is_none()
                    {
                        conclusion_display_fallback = Some(message.content.clone());
                    }
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
                AgentProtocolMessageType::WorkflowGenerate => {
                    workflow_generate_detected = true;
                    workflow_generate_plan_check = message.plan_check.unwrap_or(false);
                    workflow_generate_content = message.content.clone();
                    workflow_generate_design_doc_paths = message
                        .design_doc_path
                        .as_ref()
                        .map(|paths| {
                            paths
                                .iter()
                                .map(|p| p.trim().to_string())
                                .filter(|p| !p.is_empty())
                                .collect::<Vec<_>>()
                        })
                        .filter(|paths| !paths.is_empty());
                }
                AgentProtocolMessageType::Send => {}
            }
        }

        let session = ChatSession::find_by_id(&self.db.pool, session_id).await?;
        let source_message = ChatMessage::find_by_id(&self.db.pool, source_message_id).await?;
        let workflow_route_mode = workflow_generate_detected
            || source_message
                .as_ref()
                .is_some_and(|message| chat::is_workflow_chat_input_mode(&message.meta.0));
        let mut send_count = 0usize;

        // handle send type message for agents in the current session
        for (index, message) in protocol_messages.into_iter().enumerate() {
            if !matches!(message.message_type, AgentProtocolMessageType::Send) {
                continue;
            }

            let Some(target) = message.to.as_deref() else {
                continue;
            };
            if !Self::should_route_protocol_send(workflow_route_mode, target) {
                tracing::info!(
                    session_id = %session_id,
                    run_id = %run_id,
                    agent_id = %agent_id,
                    agent_name = %agent_name,
                    target,
                    workflow_generate_detected,
                    "blocked workflow-mode direct agent send"
                );
                continue;
            }
            let content = Self::build_send_message_content(target, &message.content);
            let intent = message.intent.as_deref();
            let intent_meaning = intent.and_then(Self::protocol_send_intent_meaning);
            let mut meta = Self::build_protocol_send_message_meta(
                prompt_language.code,
                run_id,
                session_agent_id,
                source_message_id,
                client_message_id,
                chain_depth,
                target,
                index,
                intent,
                intent_meaning,
                token_usage,
                run_model,
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
            InboxService::new()
                .notify_chat_agent_message(&self.db.pool, &routed_message, Some(agent_name))
                .await;

            if let Some(ref session) = session {
                self.handle_message(session, &routed_message).await;
            } else {
                self.emit_message_new(session_id, routed_message);
            }

            send_count += 1;
        }

        if send_count == 0
            && let Some((fallback_type, fallback_content)) = conclusion_display_fallback
                .map(|content| ("conclusion", content))
                .or_else(|| record_display_fallback.map(|content| ("record", content)))
        {
            self.persist_protocol_display_fallback_message(
                session_id,
                session_agent_id,
                agent_id,
                run_id,
                source_message_id,
                client_message_id,
                chain_depth,
                prompt_language,
                fallback_type,
                fallback_content,
                error_content,
                error_type,
                token_usage,
                run_model,
            )
            .await?;
            send_count = 1;
        }

        if workflow_generate_detected {
            Ok(ProtocolProcessResult::WorkflowGenerateDetected {
                send_count,
                plan_check: workflow_generate_plan_check,
                workflow_content: workflow_generate_content,
                design_doc_paths: workflow_generate_design_doc_paths,
            })
        } else {
            Ok(ProtocolProcessResult::Success(send_count))
        }
    }

    async fn find_session_plan_card_message_id(
        &self,
        session_id: Uuid,
    ) -> Result<Option<Uuid>, ChatRunnerError> {
        use db::models::chat_message::ChatMessage as DbChatMessage;

        use super::super::workflow_orchestrator::WorkflowOrchestrator;

        if let Some(message_id) =
            WorkflowOrchestrator::find_reusable_plan_generation_card_message_id(
                &self.db.pool,
                session_id,
            )
            .await
        {
            return Ok(Some(message_id));
        }

        let messages = DbChatMessage::find_by_session_id(&self.db.pool, session_id, None).await?;
        Ok(messages.into_iter().rev().find_map(|message| {
            let card_type = message.meta.0.get("card_type")?.as_str()?;
            (card_type == "workflow_plan_generation").then_some(message.id)
        }))
    }

    async fn find_plan_generation_previous_plan_context(
        &self,
        session_id: Uuid,
        preferred_message_id: Option<Uuid>,
    ) -> Result<Option<PlanGenerationPreviousPlanContext>, ChatRunnerError> {
        use db::models::{
            chat_message::ChatMessage as DbChatMessage, workflow_plan::WorkflowPlan,
            workflow_plan_revision::WorkflowPlanRevision,
        };

        fn read_uuid(value: Option<&serde_json::Value>) -> Option<Uuid> {
            value
                .and_then(serde_json::Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
        }

        let message_id = match preferred_message_id {
            Some(message_id) => Some(message_id),
            None => self.find_session_plan_card_message_id(session_id).await?,
        };
        let Some(message_id) = message_id else {
            return Ok(None);
        };
        let Some(message) = DbChatMessage::find_by_id(&self.db.pool, message_id).await? else {
            return Ok(None);
        };
        if message.session_id != session_id {
            return Ok(None);
        }

        let meta = &message.meta.0;
        let generation_meta = meta.get("workflow_plan_generation");
        let workflow_card = meta.get("workflow_card");
        let revision_id = read_uuid(
            generation_meta
                .and_then(|value| value.get("previous_revision_id"))
                .or_else(|| meta.get("active_revision_id"))
                .or_else(|| workflow_card.and_then(|value| value.get("revision_id"))),
        );
        let plan_id = read_uuid(
            generation_meta
                .and_then(|value| value.get("previous_plan_id"))
                .or_else(|| meta.get("workflow_plan_id"))
                .or_else(|| workflow_card.and_then(|value| value.get("plan_id"))),
        );

        let revision = if let Some(revision_id) = revision_id {
            WorkflowPlanRevision::find_by_id(&self.db.pool, revision_id).await?
        } else if let Some(plan_id) = plan_id {
            WorkflowPlanRevision::find_latest_by_plan(&self.db.pool, plan_id).await?
        } else {
            None
        };
        let Some(revision) = revision else {
            return Ok(None);
        };
        let plan = WorkflowPlan::find_by_id(&self.db.pool, revision.plan_id).await?;
        if plan
            .as_ref()
            .is_some_and(|plan| plan.session_id != session_id)
        {
            return Ok(None);
        }

        Ok(Some(PlanGenerationPreviousPlanContext {
            plan_id: revision.plan_id,
            revision_id: revision.id,
            plan_json: revision.plan_json,
        }))
    }

    fn build_plan_generation_placeholder_meta(
        session_id: Uuid,
        message_id: Uuid,
        plan_goal: &str,
        lead_agent_id: &str,
        available_agents: &[super::super::workflow_runtime::WorkflowCardAgent],
        state: super::super::workflow_runtime::WorkflowCardState,
        error_message: Option<String>,
        previous_plan_context: Option<&PlanGenerationPreviousPlanContext>,
    ) -> Result<serde_json::Value, ChatRunnerError> {
        use db::models::workflow_types::{WorkflowPlanAgents, WorkflowPlanJson};

        use super::super::workflow_runtime::{WorkflowCardProjection, WorkflowCardState};

        let status = match state {
            WorkflowCardState::Pending => "pending",
            WorkflowCardState::Failed => "failed",
            _ => "pending",
        };
        let plan = WorkflowPlanJson {
            version: "1".to_string(),
            title: "Workflow Plan".to_string(),
            goal: plan_goal.to_string(),
            agents: WorkflowPlanAgents {
                lead: lead_agent_id.to_string(),
                available: available_agents
                    .iter()
                    .map(|agent| agent.agent_id.clone())
                    .collect(),
            },
            globals: None,
            viewport: None,
            nodes: Vec::new(),
            edges: Vec::new(),
            loops: None,
            policies: None,
        };
        let projection = WorkflowCardProjection {
            execution_id: None,
            plan_id: String::new(),
            revision_id: String::new(),
            title: "Workflow Plan".to_string(),
            goal: plan_goal.to_string(),
            state,
            execution_status: "plan_generation".to_string(),
            stopped_by_user: false,
            error_message: error_message.clone(),
            completed_step_count: 0,
            total_step_count: 0,
            result_summary: None,
            outputs: Vec::new(),
            agents: available_agents.to_vec(),
            steps: Vec::new(),
            current_round: 0,
            loops: Vec::new(),
            pending_review: None,
            pending_reviews: Vec::new(),
            pending_input: None,
            iteration_history: Vec::new(),
            round_graphs: Vec::new(),
            plan,
            started_at: None,
            completed_at: None,
            validation_errors: None,
            is_terminal: false,
            has_transcripts: None,
        };

        let mut generation_meta = serde_json::json!({
            "status": status,
            "plan_goal": plan_goal,
            "retryable": status == "failed",
            "retry_endpoint": format!(
                "/api/chat/sessions/{session_id}/workflow/plan-generations/{message_id}/retry"
            ),
            "error_message": error_message,
        });
        if let Some(previous_plan_context) = previous_plan_context
            && let Some(meta) = generation_meta.as_object_mut()
        {
            meta.insert(
                "previous_plan_id".to_string(),
                serde_json::json!(previous_plan_context.plan_id),
            );
            meta.insert(
                "previous_revision_id".to_string(),
                serde_json::json!(previous_plan_context.revision_id),
            );
        }

        Ok(serde_json::json!({
            "card_type": "workflow_plan_generation",
            "display_state": status,
            "workflow_card": serde_json::to_value(&projection)?,
            "workflow_plan_generation": generation_meta
        }))
    }

    async fn upsert_plan_generation_placeholder_card(
        &self,
        session_id: Uuid,
        preferred_message_id: Option<Uuid>,
        plan_goal: &str,
        lead_agent_id: &str,
        available_agents: &[super::super::workflow_runtime::WorkflowCardAgent],
        state: super::super::workflow_runtime::WorkflowCardState,
        error_message: Option<String>,
        previous_plan_context: Option<&PlanGenerationPreviousPlanContext>,
    ) -> Result<db::models::chat_message::ChatMessage, ChatRunnerError> {
        use db::models::chat_message::{ChatMessage as DbChatMessage, ChatSenderType};

        use super::super::workflow_runtime::WorkflowCardState;

        let message_id = match preferred_message_id {
            Some(message_id) => message_id,
            None => self
                .find_session_plan_card_message_id(session_id)
                .await?
                .unwrap_or_else(Uuid::new_v4),
        };
        let content = match state {
            WorkflowCardState::Pending => "Workflow Plan (Generating)",
            WorkflowCardState::Failed => "Workflow Plan Generation Failed",
            _ => "Workflow Plan",
        };
        let meta = Self::build_plan_generation_placeholder_meta(
            session_id,
            message_id,
            plan_goal,
            lead_agent_id,
            available_agents,
            state,
            error_message,
            previous_plan_context,
        )?;

        let existing_message = DbChatMessage::find_by_id(&self.db.pool, message_id).await?;
        let message = if existing_message.is_some() {
            let updated =
                DbChatMessage::update_content_and_meta(&self.db.pool, message_id, content, meta)
                    .await?;
            self.emit_message_updated(session_id, updated.clone());
            updated
        } else {
            let created = chat::create_message_with_id(
                &self.db.pool,
                session_id,
                ChatSenderType::System,
                None,
                content.to_string(),
                Some(meta),
                message_id,
            )
            .await?;
            self.emit_message_new(session_id, created.clone());
            created
        };

        Ok(message)
    }

    async fn persist_active_workflow_plan_generation_notice(
        &self,
        session_id: Uuid,
    ) -> Result<(), ChatRunnerError> {
        use db::models::chat_message::ChatSenderType;

        let message = chat::create_message(
            &self.db.pool,
            session_id,
            ChatSenderType::System,
            None,
            "A workflow execution is already active in this session.".to_string(),
            Some(serde_json::json!({
                "type": "workflow_plan_generation_blocked",
                "reason": "active_execution"
            })),
        )
        .await?;
        self.emit_message_new(session_id, message);
        Ok(())
    }

    async fn mark_plan_generation_failed(
        &self,
        session_id: Uuid,
        message_id: Uuid,
        plan_goal: &str,
        lead_agent_id: &str,
        available_agents: &[super::super::workflow_runtime::WorkflowCardAgent],
        error_message: impl Into<String>,
        previous_plan_context: Option<&PlanGenerationPreviousPlanContext>,
    ) -> Result<(), ChatRunnerError> {
        workflow_analytics::track_plan_generated(self.analytics_service(), session_id, None, false);
        let _ = self
            .upsert_plan_generation_placeholder_card(
                session_id,
                Some(message_id),
                plan_goal,
                lead_agent_id,
                available_agents,
                super::super::workflow_runtime::WorkflowCardState::Failed,
                Some(error_message.into()),
                previous_plan_context,
            )
            .await?;
        Ok(())
    }

    /// Trigger the plan generation pipeline after detecting `workflow_generate`.
    ///
    /// This implements the second stage of the two-stage plan generation:
    /// 1. Session agent returns `workflow_generate` (first stage, already done)
    /// 2. System sends a follow-up prompt with plan JSON schema to the lead agent
    ///    and creates plan preview (this method)
    #[allow(clippy::too_many_arguments)]
    pub async fn trigger_plan_generation(
        &self,
        session_id: Uuid,
        _session_agent_id: Uuid,
        _agent_id: Uuid,
        _agent_name: &str,
        _source_message_id: Uuid,
        workflow_content: &str,
        preferred_card_message_id: Option<Uuid>,
        previous_failure_reason: Option<&str>,
        design_doc_paths: Option<&[String]>,
    ) -> Result<(), ChatRunnerError> {
        use db::models::{
            chat_agent::ChatAgent, chat_message::ChatMessage as DbChatMessage,
            chat_session::ChatSession, chat_session_agent::ChatSessionAgent,
            workflow_execution::WorkflowExecution, workflow_types::WorkflowPlanJson,
        };

        use super::super::{
            workflow_orchestrator::WorkflowOrchestrator,
            workflow_runtime::{
                WorkflowCardAgent, WorkflowCardState, build_plan_generation_prompt,
                extract_json_payload, resolve_lead_agent,
                resolve_workflow_response_language_instruction, run_workflow_agent_prompt,
            },
            workflow_validator,
        };

        let pool = &self.db.pool;
        let session = ChatSession::find_by_id(pool, session_id)
            .await?
            .ok_or_else(|| ChatRunnerError::SessionNotFound(session_id))?;

        if !WorkflowExecution::find_generation_blocking_by_session(pool, session_id)
            .await?
            .is_empty()
        {
            tracing::warn!(
                session_id = %session_id,
                "[plan_generation] skipped before card mutation: active execution already exists"
            );
            workflow_analytics::track_plan_generated(
                self.analytics_service(),
                session_id,
                None,
                false,
            );
            self.persist_active_workflow_plan_generation_notice(session_id)
                .await?;
            return Ok(());
        }

        let session_agents = ChatSessionAgent::find_all_for_session(pool, session_id).await?;
        if session_agents.is_empty() {
            tracing::warn!(session_id = %session_id, "[plan_generation] no session agents");
            return Ok(());
        }

        let mut agents = Vec::with_capacity(session_agents.len());
        for session_agent in &session_agents {
            if let Some(mut agent) = ChatAgent::find_by_id(pool, session_agent.agent_id).await? {
                agent.name = session_agent.member_name.clone();
                agents.push(agent);
            }
        }

        let (lead_agent, lead_session_agent) =
            resolve_lead_agent(&session, &session_agents, &agents).map_err(|err| {
                ChatRunnerError::AgentNotFound(format!("lead agent resolution failed: {err}"))
            })?;
        let lead_agent_id = lead_agent.id.to_string();
        let mut lead_session_agent = lead_session_agent.clone();

        let _plan_skills = self
            .prepare_and_resolve_agent_skills(
                &mut lead_session_agent,
                lead_agent,
                crate::services::agent_skill_policy::AgentPromptContext::PlanGeneration,
            )
            .await?;
        let available_agents: Vec<WorkflowCardAgent> = session_agents
            .iter()
            .map(|session_agent| {
                WorkflowCardAgent {
                    session_agent_id: session_agent.id.to_string(),
                    workflow_agent_session_id: None,
                    agent_id: session_agent.agent_id.to_string(),
                    name: session_agent.member_name.clone(),
                }
            })
            .collect();

        let plan_goal = workflow_content.trim();
        if plan_goal.is_empty() {
            tracing::warn!(
                session_id = %session_id,
                "[plan_generation] skipped because workflow_generate.content is empty"
            );
            if let Some(message_id) = preferred_card_message_id {
                self.mark_plan_generation_failed(
                    session_id,
                    message_id,
                    "",
                    &lead_agent_id,
                    &available_agents,
                    "workflow_generate.content is required to build the execution plan.",
                    None,
                )
                .await?;
            }
            return Ok(());
        }

        let previous_plan_context = self
            .find_plan_generation_previous_plan_context(session_id, preferred_card_message_id)
            .await?;
        let placeholder = self
            .upsert_plan_generation_placeholder_card(
                session_id,
                preferred_card_message_id,
                plan_goal,
                &lead_agent_id,
                &available_agents,
                WorkflowCardState::Pending,
                None,
                previous_plan_context.as_ref(),
            )
            .await?;

        let blocking_executions =
            WorkflowExecution::find_generation_blocking_by_session(pool, session_id).await?;
        if !blocking_executions.is_empty() {
            tracing::warn!(
                session_id = %session_id,
                "[plan_generation] skipping: active execution already exists"
            );

            if blocking_executions
                .iter()
                .any(|execution| execution.workflow_card_message_id == Some(placeholder.id))
            {
                workflow_analytics::track_plan_generated(
                    self.analytics_service(),
                    session_id,
                    None,
                    false,
                );
                self.persist_active_workflow_plan_generation_notice(session_id)
                    .await?;
            } else {
                self.mark_plan_generation_failed(
                    session_id,
                    placeholder.id,
                    plan_goal,
                    &lead_agent_id,
                    &available_agents,
                    "A workflow execution is already active in this session.",
                    previous_plan_context.as_ref(),
                )
                .await?;
            }
            return Ok(());
        }

        let messages = DbChatMessage::find_by_session_id(pool, session_id, None).await?;
        let source_msg_id = messages
            .iter()
            .rev()
            .find(|message| message.sender_type == db::models::chat_message::ChatSenderType::User)
            .map(|message| message.id);
        let ui_config = config::load_config_from_file(&config_path()).await;
        let response_language_instruction =
            resolve_workflow_response_language_instruction(&ui_config.language);
        let prompt = build_plan_generation_prompt(
            plan_goal,
            &lead_agent_id,
            &available_agents,
            previous_failure_reason,
            previous_plan_context
                .as_ref()
                .map(|context| context.plan_json.as_str()),
            response_language_instruction,
            design_doc_paths,
        );

        tracing::debug!(
            prompt = %prompt,
            session_id = %session_id,
            lead_agent_id = %lead_agent_id,
            available_agent_ids = ?available_agents.iter().map(|a| &a.agent_id).collect::<Vec<_>>(),
            previous_failure_reason = ?previous_failure_reason,
            previous_plan_id = ?previous_plan_context.as_ref().map(|context| context.plan_id),
            "[plan_generation] built plan generation prompt",
        );

        let raw_plan_output = match run_workflow_agent_prompt(
            &self.db,
            &session,
            lead_agent,
            &lead_session_agent,
            None,
            &prompt,
            Uuid::nil(),
        )
        .await
        {
            Ok(output) => output,
            Err(err) => {
                tracing::error!(
                    session_id = %session_id,
                    error = %err,
                    "[plan_generation] plan generation run failed"
                );
                self.mark_plan_generation_failed(
                    session_id,
                    placeholder.id,
                    plan_goal,
                    &lead_agent_id,
                    &available_agents,
                    err.to_string(),
                    previous_plan_context.as_ref(),
                )
                .await?;
                return Ok(());
            }
        };

        tracing::debug!(
            session_id = %session_id,
            raw_plan_output = %raw_plan_output,
            "[plan_generation] raw output from lead agent"
        );

        let plan_json = match extract_json_payload(&raw_plan_output) {
            Some(json) => json,
            None => {
                tracing::error!(
                    session_id = %session_id,
                    "[plan_generation] lead agent did not return a JSON object"
                );
                self.mark_plan_generation_failed(
                    session_id,
                    placeholder.id,
                    plan_goal,
                    &lead_agent_id,
                    &available_agents,
                    "Lead agent did not return a workflow JSON object.",
                    previous_plan_context.as_ref(),
                )
                .await?;
                return Ok(());
            }
        };

        let parsed_plan: WorkflowPlanJson = match serde_json::from_str(&plan_json) {
            Ok(plan) => plan,
            Err(err) => {
                tracing::error!(
                    session_id = %session_id,
                    error = %err,
                    "[plan_generation] invalid workflow JSON"
                );
                self.mark_plan_generation_failed(
                    session_id,
                    placeholder.id,
                    plan_goal,
                    &lead_agent_id,
                    &available_agents,
                    format!("Lead agent returned invalid workflow JSON: {err}"),
                    previous_plan_context.as_ref(),
                )
                .await?;
                return Ok(());
            }
        };

        let valid_agent_ids: Vec<String> =
            agents.iter().map(|agent| agent.id.to_string()).collect();
        let validation = workflow_validator::validate_plan(&parsed_plan, &valid_agent_ids);
        if !validation.is_valid {
            let validation_summary = validation
                .errors
                .iter()
                .map(|error| format!("{}: {}", error.field, error.message))
                .collect::<Vec<_>>()
                .join("; ");
            tracing::warn!(
                session_id = %session_id,
                validation_errors = %validation_summary,
                "[plan_generation] generated plan failed validation"
            );
            self.mark_plan_generation_failed(
                session_id,
                placeholder.id,
                plan_goal,
                &lead_agent_id,
                &available_agents,
                validation_summary,
                previous_plan_context.as_ref(),
            )
            .await?;
            return Ok(());
        }

        let (plan, revision, workflow_card_message) =
            match WorkflowOrchestrator::create_workflow_plan_preview_card(
                pool,
                self,
                &session,
                source_msg_id,
                &lead_session_agent,
                &plan_json,
                Some(placeholder.id),
            )
            .await
            {
                Ok(result) => result,
                Err(err) => {
                    tracing::error!(
                        session_id = %session_id,
                        error = %err,
                        "[plan_generation] plan preview creation failed"
                    );
                    self.mark_plan_generation_failed(
                        session_id,
                        placeholder.id,
                        plan_goal,
                        &lead_agent_id,
                        &available_agents,
                        format!("Plan creation failed: {err}"),
                        previous_plan_context.as_ref(),
                    )
                    .await?;
                    return Ok(());
                }
            };

        tracing::info!(
            session_id = %session_id,
            plan_id = %plan.id,
            revision_id = %revision.id,
            "[plan_generation] plan preview created successfully"
        );

        self.emit(
            session_id,
            ChatStreamEvent::WorkflowPlanPreviewReady {
                session_id,
                plan_id: plan.id,
                workflow_card_message,
            },
        );

        Ok(())
    }
}
