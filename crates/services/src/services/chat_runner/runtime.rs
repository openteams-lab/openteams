use super::*;

pub(super) struct ExitWatcherArgs {
    pub(super) child: command_group::AsyncGroupChild,
    pub(super) stop: CancellationToken,
    pub(super) executor_cancel: Option<CancellationToken>,
    pub(super) exit_signal: Option<ExecutorExitSignal>,
    pub(super) msg_store: Arc<MsgStore>,
    pub(super) completion_status: Arc<AtomicU8>,
}

impl ChatRunner {
    pub(super) fn register_run_control(&self, session_agent_id: Uuid) -> CancellationToken {
        let stop = CancellationToken::new();
        self.run_controls
            .insert(session_agent_id, RunLifecycleControl { stop: stop.clone() });
        stop
    }

    pub(super) fn spawn_log_forwarders(
        &self,
        child: &mut command_group::AsyncGroupChild,
        msg_store: Arc<MsgStore>,
        raw_log_file: Arc<Mutex<fs::File>>,
    ) {
        let stdout = child
            .inner()
            .stdout
            .take()
            .expect("chat runner missing stdout");
        let stderr = child
            .inner()
            .stderr
            .take()
            .expect("chat runner missing stderr");

        let stdout_store = msg_store.clone();
        let stdout_log = raw_log_file.clone();
        tokio::spawn(async move {
            tracing::debug!("[chat_runner] Starting stdout forwarder");
            let mut stream = ReaderStream::new(stdout);
            let mut decoder = Utf8LossyDecoder::new();
            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(bytes) => {
                        let text = decoder.decode_chunk(&bytes);
                        if !text.is_empty() {
                            stdout_store.push(LogMsg::Stdout(text.clone()));
                            let mut file = stdout_log.lock().await;
                            let _ = file.write_all(text.as_bytes()).await;
                        }
                    }
                    Err(err) => {
                        tracing::warn!("[chat_runner] stdout stream error: {}", err);
                        stdout_store.push(LogMsg::Stderr(format!("stdout error: {err}")));
                    }
                }
            }

            let tail = decoder.finish();
            if !tail.is_empty() {
                stdout_store.push(LogMsg::Stdout(tail.clone()));
                let mut file = stdout_log.lock().await;
                let _ = file.write_all(tail.as_bytes()).await;
            }
            tracing::debug!("[chat_runner] stdout forwarder ended");
        });

        let stderr_store = msg_store.clone();
        let stderr_log = raw_log_file.clone();
        tokio::spawn(async move {
            tracing::debug!("[chat_runner] Starting stderr forwarder");
            let mut stream = ReaderStream::new(stderr);
            let mut decoder = Utf8LossyDecoder::new();
            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(bytes) => {
                        let text = decoder.decode_chunk(&bytes);
                        if !text.is_empty() {
                            tracing::debug!(
                                stderr_len = text.len(),
                                "[chat_runner] Received stderr chunk"
                            );
                            stderr_store.push(LogMsg::Stderr(text.clone()));
                            let mut file = stderr_log.lock().await;
                            let _ = file.write_all(text.as_bytes()).await;
                        }
                    }
                    Err(err) => {
                        tracing::warn!("[chat_runner] stderr stream error: {}", err);
                        stderr_store.push(LogMsg::Stderr(format!("stderr error: {err}")));
                    }
                }
            }

            let tail = decoder.finish();
            if !tail.is_empty() {
                tracing::debug!(
                    tail_len = tail.len(),
                    "[chat_runner] stderr forwarder ending with tail"
                );
                stderr_store.push(LogMsg::Stderr(tail.clone()));
                let mut file = stderr_log.lock().await;
                let _ = file.write_all(tail.as_bytes()).await;
            }
            tracing::debug!("[chat_runner] stderr forwarder ended");
        });
    }

    pub(super) fn parse_token_usage_from_stdout_line(line: &str) -> Option<TokenUsageInfo> {
        let value: serde_json::Value = serde_json::from_str(line).ok()?;
        let value_obj = value.as_object()?;

        // Format: {"type":"token_usage","total_tokens":N,"model_context_window":N,...}
        // Used by: Gemini CLI, QWen Coder (may include input/output breakdown)
        if value_obj.get("type").and_then(|v| v.as_str()) == Some("token_usage") {
            let total_tokens = value_obj
                .get("total_tokens")
                .and_then(|v| v.as_u64())
                .and_then(|v| u32::try_from(v).ok())?;
            let model_context_window = value_obj
                .get("model_context_window")
                .and_then(|v| v.as_u64())
                .and_then(|v| u32::try_from(v).ok())?;
            let input_tokens = value_obj
                .get("input_tokens")
                .and_then(|v| v.as_u64())
                .and_then(|v| u32::try_from(v).ok());
            let output_tokens = value_obj
                .get("output_tokens")
                .and_then(|v| v.as_u64())
                .and_then(|v| u32::try_from(v).ok());
            let cache_read_tokens = value_obj
                .get("cache_read_tokens")
                .and_then(|v| v.as_u64())
                .and_then(|v| u32::try_from(v).ok());
            let cache_write_tokens = value_obj
                .get("cache_write_tokens")
                .and_then(|v| v.as_u64())
                .and_then(|v| u32::try_from(v).ok());
            return Some(TokenUsageInfo {
                total_tokens,
                model_context_window,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_write_tokens,
                is_estimated: false,
            });
        }

        // Format: {"method":"codex/event/token_count","params":{"msg":{"info":{...}}}}
        // Used by: Codex stdout JSON-RPC events
        if value_obj.get("method").and_then(|v| v.as_str()) != Some("codex/event/token_count") {
            return None;
        }

        let info = value_obj
            .get("params")
            .and_then(|v| v.get("msg"))
            .and_then(|v| v.get("info"))?;

        let last = info.get("last_token_usage")?;
        let total_tokens = last
            .get("total_tokens")
            .and_then(|v| v.as_u64())
            .and_then(|v| u32::try_from(v).ok())?;
        let model_context_window = info
            .get("model_context_window")
            .and_then(|v| v.as_u64())
            .and_then(|v| u32::try_from(v).ok())
            .unwrap_or(0);
        let input_tokens = last
            .get("input_tokens")
            .and_then(|v| v.as_u64())
            .and_then(|v| u32::try_from(v).ok());
        let output_tokens = last
            .get("output_tokens")
            .and_then(|v| v.as_u64())
            .and_then(|v| u32::try_from(v).ok());
        // Codex calls it cached_input_tokens
        let cache_read_tokens = last
            .get("cached_input_tokens")
            .and_then(|v| v.as_u64())
            .and_then(|v| u32::try_from(v).ok());

        Some(TokenUsageInfo {
            total_tokens,
            model_context_window,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_write_tokens: None,
            is_estimated: false,
        })
    }

    pub(super) fn update_token_usage_from_stdout_chunk(
        stdout_line_buffer: &mut String,
        last_token_usage: &mut Option<TokenUsageInfo>,
        chunk: &str,
    ) {
        stdout_line_buffer.push_str(chunk);

        while let Some(newline_index) = stdout_line_buffer.find('\n') {
            let mut line: String = stdout_line_buffer.drain(..=newline_index).collect();
            if line.ends_with('\n') {
                line.pop();
            }
            if line.ends_with('\r') {
                line.pop();
            }
            if line.is_empty() {
                continue;
            }
            if let Some(usage) = Self::parse_token_usage_from_stdout_line(&line) {
                *last_token_usage = Some(usage);
            }
        }
    }

    pub(super) fn flush_token_usage_buffer(
        stdout_line_buffer: &mut String,
        last_token_usage: &mut Option<TokenUsageInfo>,
    ) {
        if stdout_line_buffer.is_empty() {
            return;
        }
        let line = stdout_line_buffer.trim_end_matches(['\n', '\r']);
        if !line.is_empty()
            && let Some(usage) = Self::parse_token_usage_from_stdout_line(line)
        {
            *last_token_usage = Some(usage);
        }
        stdout_line_buffer.clear();
    }

    /// Estimate token count using tiktoken when available.
    pub(super) fn estimate_tokens_with_tiktoken(text: &str) -> u32 {
        use tiktoken_rs::cl100k_base;
        match cl100k_base() {
            Ok(bpe) => bpe.encode_with_special_tokens(text).len() as u32,
            Err(_) => {
                // Fallback heuristic: roughly 4 characters per token.
                (text.len() / 4) as u32
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn process_stream_patch(
        patch: json_patch::Patch,
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        sender: &broadcast::Sender<ChatStreamEvent>,
        last_content: &mut HashMap<usize, String>,
        latest_assistant: &mut String,
        last_token_usage: &mut Option<TokenUsageInfo>,
        error_content: &mut String,
        error_type: &mut Option<NormalizedEntryError>,
    ) {
        if let Some((index, entry)) = extract_normalized_entry_from_patch(&patch) {
            let stream_type = match &entry.entry_type {
                NormalizedEntryType::AssistantMessage => Some(ChatStreamDeltaType::Assistant),
                NormalizedEntryType::Thinking => Some(ChatStreamDeltaType::Thinking),
                NormalizedEntryType::ErrorMessage { error_type: et } => {
                    // Keep the first non-Other error type, or use Other if none found
                    if error_type.is_none()
                        || !matches!(et, NormalizedEntryError::Other)
                            && matches!(error_type, Some(NormalizedEntryError::Other))
                    {
                        tracing::debug!(
                            session_id = %session_id,
                            session_agent_id = %session_agent_id,
                            agent_id = %agent_id,
                            run_id = %run_id,
                            new_error_type = ?et,
                            old_error_type = ?error_type,
                            "[chat_runner] ErrorMessage detected from executor, updating error_type"
                        );
                        *error_type = Some(et.clone());
                    }
                    Some(ChatStreamDeltaType::Error)
                }
                NormalizedEntryType::TokenUsageInfo(usage) => {
                    *last_token_usage = Some(usage.clone());
                    None
                }
                _ => None,
            };

            if let Some(stream_type) = stream_type {
                let current = entry.content;
                let previous = last_content.get(&index).cloned().unwrap_or_default();
                let (delta, is_delta) = if current.starts_with(&previous) {
                    (current[previous.len()..].to_string(), true)
                } else {
                    (current.clone(), false)
                };

                last_content.insert(index, current.clone());
                if matches!(stream_type, ChatStreamDeltaType::Assistant) {
                    *latest_assistant = current.clone();
                }
                if matches!(stream_type, ChatStreamDeltaType::Error) {
                    if !error_content.is_empty() {
                        error_content.push('\n');
                    }
                    error_content.push_str(&current);
                    tracing::debug!(
                        session_id = %session_id,
                        session_agent_id = %session_agent_id,
                        agent_id = %agent_id,
                        run_id = %run_id,
                        error_content_len = error_content.len(),
                        new_chunk_len = current.len(),
                        "[chat_runner] Accumulating error content from stream"
                    );
                }

                if !delta.is_empty() {
                    let _ = sender.send(ChatStreamEvent::AgentDelta {
                        session_id,
                        session_agent_id,
                        agent_id,
                        run_id,
                        stream_type,
                        content: delta,
                        delta: is_delta,
                        is_final: false,
                    });
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn spawn_stream_bridge(
        &self,
        msg_store: Arc<MsgStore>,
        session_id: Uuid,
        agent_id: Uuid,
        session_agent_id: Uuid,
        run_id: Uuid,
        output_path: PathBuf,
        meta_path: PathBuf,
        _workspace_path: PathBuf,
        run_dir: PathBuf,
        completion_status: Arc<AtomicU8>,
        chain_depth: u32,
        context_compacted: bool,
        compression_warning: Option<chat::CompressionWarning>,
        runner: ChatRunner,
        source_message_id: Uuid,
        agent_name: String,
        prompt_language: ResolvedPromptLanguage,
    ) {
        let db = self.db.clone();
        let sender = self.sender_for(session_id);

        tracing::debug!(
            session_id = %session_id,
            run_id = %run_id,
            agent_id = %agent_id,
            session_agent_id = %session_agent_id,
            agent_name = %agent_name,
            output_path = %output_path.display(),
            meta_path = %meta_path.display(),
            "[chat_runner] Starting spawn_stream_bridge for agent execution"
        );

        tokio::spawn(async move {
            let mut stream = msg_store.history_plus_stream();
            let mut last_content: HashMap<usize, String> = HashMap::new();
            let mut latest_assistant = String::new();
            let mut agent_session_id: Option<String> = None;
            let mut agent_message_id: Option<String> = None;
            let mut last_token_usage: Option<TokenUsageInfo> = None;
            let mut stdout_line_buffer = String::new();
            let mut error_content = String::new();
            let mut error_type: Option<NormalizedEntryError> = None;

            while let Some(item) = stream.next().await {
                match item {
                    Ok(LogMsg::SessionId(session_id_value)) => {
                        if agent_session_id.as_deref() != Some(&session_id_value) {
                            agent_session_id = Some(session_id_value.clone());
                            let _ = ChatSessionAgent::update_agent_session_id(
                                &db.pool,
                                session_agent_id,
                                Some(session_id_value),
                            )
                            .await;
                        }
                    }
                    Ok(LogMsg::MessageId(message_id_value)) => {
                        if agent_message_id.as_deref() != Some(&message_id_value) {
                            agent_message_id = Some(message_id_value.clone());
                            let _ = ChatSessionAgent::update_agent_message_id(
                                &db.pool,
                                session_agent_id,
                                Some(message_id_value),
                            )
                            .await;
                        }
                    }
                    Ok(LogMsg::Stdout(chunk)) => {
                        Self::update_token_usage_from_stdout_chunk(
                            &mut stdout_line_buffer,
                            &mut last_token_usage,
                            &chunk,
                        );
                    }
                    Ok(LogMsg::JsonPatch(patch)) => {
                        Self::process_stream_patch(
                            patch,
                            session_id,
                            session_agent_id,
                            agent_id,
                            run_id,
                            &sender,
                            &mut last_content,
                            &mut latest_assistant,
                            &mut last_token_usage,
                            &mut error_content,
                            &mut error_type,
                        );
                    }
                    Ok(LogMsg::Finished) => {
                        Self::flush_token_usage_buffer(
                            &mut stdout_line_buffer,
                            &mut last_token_usage,
                        );

                        tracing::debug!(
                            session_id = %session_id,
                            run_id = %run_id,
                            agent_id = %agent_id,
                            agent_name = %agent_name,
                            has_error_content = !error_content.is_empty(),
                            error_type = ?error_type,
                            assistant_content_len = latest_assistant.len(),
                            "[chat_runner] Executor finished, processing final output"
                        );

                        // Drain tail messages briefly to handle out-of-order `Finished` vs stdout/json patches.
                        let drain_deadline =
                            tokio::time::Instant::now() + std::time::Duration::from_millis(350);
                        loop {
                            let now = tokio::time::Instant::now();
                            if now >= drain_deadline {
                                break;
                            }
                            let remaining = drain_deadline.duration_since(now);
                            let Ok(next_item) =
                                tokio::time::timeout(remaining, stream.next()).await
                            else {
                                break;
                            };
                            let Some(next_item) = next_item else {
                                break;
                            };
                            match next_item {
                                Ok(LogMsg::SessionId(session_id_value)) => {
                                    if agent_session_id.as_deref() != Some(&session_id_value) {
                                        agent_session_id = Some(session_id_value.clone());
                                        let _ = ChatSessionAgent::update_agent_session_id(
                                            &db.pool,
                                            session_agent_id,
                                            Some(session_id_value),
                                        )
                                        .await;
                                    }
                                }
                                Ok(LogMsg::MessageId(message_id_value)) => {
                                    if agent_message_id.as_deref() != Some(&message_id_value) {
                                        agent_message_id = Some(message_id_value.clone());
                                        let _ = ChatSessionAgent::update_agent_message_id(
                                            &db.pool,
                                            session_agent_id,
                                            Some(message_id_value),
                                        )
                                        .await;
                                    }
                                }
                                Ok(LogMsg::Stdout(chunk)) => {
                                    Self::update_token_usage_from_stdout_chunk(
                                        &mut stdout_line_buffer,
                                        &mut last_token_usage,
                                        &chunk,
                                    );
                                }
                                Ok(LogMsg::JsonPatch(patch)) => {
                                    Self::process_stream_patch(
                                        patch,
                                        session_id,
                                        session_agent_id,
                                        agent_id,
                                        run_id,
                                        &sender,
                                        &mut last_content,
                                        &mut latest_assistant,
                                        &mut last_token_usage,
                                        &mut error_content,
                                        &mut error_type,
                                    );
                                }
                                _ => {}
                            }
                        }

                        Self::flush_token_usage_buffer(
                            &mut stdout_line_buffer,
                            &mut last_token_usage,
                        );

                        let _ = fs::write(&output_path, &latest_assistant).await;

                        // TODO: Temporarily disabled diff and untracked file capture
                        // let diff_info =
                        //     ChatRunner::capture_git_diff(&workspace_path, &run_dir).await;
                        // let untracked_files =
                        //     ChatRunner::capture_untracked_files(&workspace_path, &run_dir).await;
                        let completion_status =
                            RunCompletionStatus::from_atomic(&completion_status);
                        let should_clear_agent_session = matches!(
                            completion_status,
                            RunCompletionStatus::Failed | RunCompletionStatus::Stopped
                        );

                        if should_clear_agent_session {
                            agent_session_id = None;
                            agent_message_id = None;
                            let _ = ChatSessionAgent::update_agent_session_id(
                                &db.pool,
                                session_agent_id,
                                None,
                            )
                            .await;
                            let _ = ChatSessionAgent::update_agent_message_id(
                                &db.pool,
                                session_agent_id,
                                None,
                            )
                            .await;
                        }

                        let mut meta = serde_json::json!({
                            "run_id": run_id,
                            "session_id": session_id,
                            "session_agent_id": session_agent_id,
                            "agent_id": agent_id,
                            "agent_session_id": agent_session_id,
                            "agent_message_id": agent_message_id,
                            "finished_at": Utc::now().to_rfc3339(),
                            "chain_depth": chain_depth + 1,
                        });

                        // If the runner did not emit token usage, estimate it from the prompt and final output.
                        let token_usage = if let Some(ref usage) = last_token_usage {
                            usage.clone()
                        } else {
                            // Read the prompt from input.md to estimate input tokens.
                            let input_path = run_dir.join("input.md");
                            let prompt_content =
                                fs::read_to_string(&input_path).await.unwrap_or_default();
                            let estimated_input =
                                Self::estimate_tokens_with_tiktoken(&prompt_content);
                            let estimated_output =
                                Self::estimate_tokens_with_tiktoken(&latest_assistant);
                            TokenUsageInfo {
                                total_tokens: estimated_input + estimated_output,
                                model_context_window: 0,
                                input_tokens: Some(estimated_input),
                                output_tokens: Some(estimated_output),
                                cache_read_tokens: None,
                                cache_write_tokens: None,
                                is_estimated: true,
                            }
                        };

                        meta["token_usage"] = serde_json::json!({
                            "total_tokens": token_usage.total_tokens,
                            "model_context_window": token_usage.model_context_window,
                            "input_tokens": token_usage.input_tokens,
                            "output_tokens": token_usage.output_tokens,
                            "cache_read_tokens": token_usage.cache_read_tokens,
                            "cache_write_tokens": token_usage.cache_write_tokens,
                            "is_estimated": token_usage.is_estimated,
                        });

                        if !error_content.is_empty() {
                            let summary: String = error_content.chars().take(200).collect();
                            let mut error_meta = serde_json::json!({
                                "content": error_content,
                                "summary": summary,
                            });
                            if let Some(ref et) = error_type {
                                error_meta["error_type"] =
                                    serde_json::to_value(et).unwrap_or(serde_json::Value::Null);
                            }
                            meta["error"] = error_meta;

                            tracing::debug!(
                                session_id = %session_id,
                                run_id = %run_id,
                                agent_id = %agent_id,
                                error_type = ?error_type,
                                error_content_len = error_content.len(),
                                summary = %summary,
                                "[chat_runner] Persisting error info to meta.json"
                            );
                        }

                        if context_compacted {
                            meta["context_compacted"] = true.into();
                        }
                        if let Some(warning) = compression_warning.as_ref() {
                            meta["compression_warning"] = serde_json::json!({
                                "code": warning.code,
                                "message": warning.message,
                                "split_file_path": warning.split_file_path,
                            });
                        }

                        let _ = fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap())
                            .await;

                        let error_content_opt = if error_content.is_empty() {
                            None
                        } else {
                            Some(error_content.as_str())
                        };

                        let process_result = runner
                            .process_agent_protocol_output(
                                session_id,
                                session_agent_id,
                                agent_id,
                                &agent_name,
                                run_id,
                                source_message_id,
                                chain_depth,
                                prompt_language,
                                &latest_assistant,
                                error_content_opt,
                                error_type.as_ref(),
                                Some(&token_usage),
                            )
                            .await;

                        let messages_created = match process_result {
                            Ok(count) => count,
                            Err(err) => {
                                tracing::warn!(
                                    session_id = %session_id,
                                    run_id = %run_id,
                                    agent_id = %agent_id,
                                    error = %err,
                                    "failed to process agent protocol output"
                                );
                                0
                            }
                        };

                        // If there's an error but no messages were created, ensure we persist an error message
                        if messages_created == 0 && !error_content.is_empty() {
                            tracing::info!(
                                session_id = %session_id,
                                run_id = %run_id,
                                agent_id = %agent_id,
                                agent_name = %agent_name,
                                error_content_len = error_content.len(),
                                "persisting error message for failed agent run with no output"
                            );
                            if let Err(err) = runner
                                .persist_agent_error_message(
                                    session_id,
                                    session_agent_id,
                                    agent_id,
                                    run_id,
                                    &agent_name,
                                    source_message_id,
                                    &error_content,
                                    error_type.as_ref(),
                                )
                                .await
                            {
                                tracing::warn!(
                                    session_id = %session_id,
                                    run_id = %run_id,
                                    error = %err,
                                    "failed to persist agent error message"
                                );
                            }
                        }

                        let _ = sender.send(ChatStreamEvent::AgentDelta {
                            session_id,
                            session_agent_id,
                            agent_id,
                            run_id,
                            stream_type: ChatStreamDeltaType::Assistant,
                            content: latest_assistant.clone(),
                            delta: false,
                            is_final: true,
                        });

                        let final_state = match completion_status {
                            RunCompletionStatus::Failed => ChatSessionAgentState::Dead,
                            RunCompletionStatus::Succeeded | RunCompletionStatus::Stopped => {
                                ChatSessionAgentState::Idle
                            }
                        };

                        let _ = ChatSessionAgent::update_state(
                            &db.pool,
                            session_agent_id,
                            final_state.clone(),
                        )
                        .await;

                        let _ = sender.send(ChatStreamEvent::AgentState {
                            session_agent_id,
                            agent_id,
                            state: final_state.clone(),
                            started_at: None,
                        });

                        // Emit MentionAcknowledged completed/failed event
                        let mention_status = match completion_status {
                            RunCompletionStatus::Failed => MentionStatus::Failed,
                            RunCompletionStatus::Succeeded | RunCompletionStatus::Stopped => {
                                MentionStatus::Completed
                            }
                        };
                        tracing::debug!(
                            mention_status = ?mention_status,
                            "mention status: "
                        );
                        let _ = sender.send(ChatStreamEvent::MentionAcknowledged {
                            session_id,
                            message_id: source_message_id,
                            mentioned_agent: agent_name.clone(),
                            agent_id,
                            status: mention_status.clone(),
                        });

                        // Persist completed/failed status to message meta
                        let status_str = match mention_status {
                            MentionStatus::Completed => "completed",
                            MentionStatus::Failed => "failed",
                            MentionStatus::Running => "running",
                            MentionStatus::Received => "received",
                        };
                        if let Ok(Some(msg)) =
                            ChatMessage::find_by_id(&db.pool, source_message_id).await
                        {
                            let mut meta = msg.meta.0.clone();
                            let mention_statuses = meta
                                .get_mut("mention_statuses")
                                .and_then(|v| v.as_object_mut());

                            if let Some(statuses) = mention_statuses {
                                statuses.insert(agent_name.clone(), serde_json::json!(status_str));
                            } else {
                                let mut new_statuses = serde_json::Map::new();
                                new_statuses
                                    .insert(agent_name.clone(), serde_json::json!(status_str));
                                meta["mention_statuses"] = serde_json::Value::Object(new_statuses);
                            }

                            let _ =
                                ChatMessage::update_meta(&db.pool, source_message_id, meta).await;
                        }

                        // Process any pending messages in the queue for this agent
                        // Only process if the agent completed successfully (not failed/dead)
                        if final_state == ChatSessionAgentState::Idle {
                            runner
                                .process_pending_queue(session_id, session_agent_id)
                                .await;
                        } else {
                            // Agent failed/died - clear pending queue and mark all as failed
                            runner
                                .clear_pending_queue_on_failure(session_id, session_agent_id)
                                .await;
                        }

                        break;
                    }
                    _ => {}
                }
            }
        });
    }

    pub(super) fn spawn_exit_watcher(&self, args: ExitWatcherArgs, session_agent_id: Uuid) {
        let run_controls = self.run_controls.clone();
        tokio::spawn(async move {
            Self::watch_executor_lifecycle(
                args.child,
                args.stop,
                args.executor_cancel,
                args.exit_signal,
                args.msg_store,
                args.completion_status,
                session_agent_id,
            )
            .await;
            run_controls.remove(&session_agent_id);
        });
    }

    pub(super) async fn watch_executor_lifecycle(
        child: command_group::AsyncGroupChild,
        stop: CancellationToken,
        executor_cancel: Option<CancellationToken>,
        exit_signal: Option<ExecutorExitSignal>,
        msg_store: Arc<MsgStore>,
        completion_status: Arc<AtomicU8>,
        session_agent_id: Uuid,
    ) {
        Self::watch_executor_lifecycle_with_timeout(
            child,
            stop,
            executor_cancel,
            exit_signal,
            msg_store,
            completion_status,
            session_agent_id,
            EXECUTOR_GRACEFUL_STOP_TIMEOUT,
        )
        .await;
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn watch_executor_lifecycle_with_timeout(
        mut child: command_group::AsyncGroupChild,
        stop: CancellationToken,
        executor_cancel: Option<CancellationToken>,
        mut exit_signal: Option<ExecutorExitSignal>,
        msg_store: Arc<MsgStore>,
        completion_status: Arc<AtomicU8>,
        session_agent_id: Uuid,
        graceful_timeout: std::time::Duration,
    ) {
        let event = Self::wait_for_lifecycle_event(
            &mut child,
            &stop,
            &mut exit_signal,
            &msg_store,
            session_agent_id,
        )
        .await;

        let mut completion = RunCompletionStatus::Succeeded;
        match event {
            LifecycleEvent::ProcessExited(Ok(status)) => {
                tracing::debug!(
                    session_agent_id = %session_agent_id,
                    exit_success = status.success(),
                    "[chat_runner] Executor process exited"
                );
                if !status.success() {
                    completion = RunCompletionStatus::Failed;
                }
            }
            LifecycleEvent::ProcessExited(Err(err)) => {
                msg_store.push(LogMsg::Stderr(format!("process wait error: {err}")));
                completion = RunCompletionStatus::Failed;
            }
            LifecycleEvent::ExitSignal(exit_result) => {
                let signaled_failure = matches!(
                    exit_result,
                    executors::executors::ExecutorExitResult::Failure
                );
                if signaled_failure {
                    completion = RunCompletionStatus::Failed;
                }

                match process::terminate_process_group(&mut child, graceful_timeout).await {
                    Ok(cleanup) => {
                        tracing::debug!(
                            session_agent_id = %session_agent_id,
                            forced_kill = cleanup.forced_kill,
                            exit_success = cleanup.exit_status.success(),
                            "[chat_runner] Executor exit signal cleanup finished"
                        );
                        // Only treat process exit status as failure when the executor did NOT
                        // explicitly signal success.  On Windows, a terminated process always
                        // returns a non-zero exit code, which would incorrectly override a
                        // successful exit signal.
                        if !signaled_failure
                            && !cleanup.exit_status.success()
                            && !cleanup.forced_kill
                        {
                            completion = RunCompletionStatus::Failed;
                        }
                    }
                    Err(err) => {
                        msg_store.push(LogMsg::Stderr(format!("process cleanup error: {err}")));
                        if signaled_failure {
                            completion = RunCompletionStatus::Failed;
                        }
                    }
                }
            }
            LifecycleEvent::StopRequested => {
                if let Some(token) = executor_cancel.as_ref() {
                    token.cancel();
                }

                match process::terminate_process_group(&mut child, graceful_timeout).await {
                    Ok(cleanup) => {
                        tracing::debug!(
                            session_agent_id = %session_agent_id,
                            forced_kill = cleanup.forced_kill,
                            exit_success = cleanup.exit_status.success(),
                            "[chat_runner] Executor stop cleanup finished"
                        );
                    }
                    Err(err) => {
                        msg_store.push(LogMsg::Stderr(format!("process cleanup error: {err}")));
                    }
                }

                Self::wait_for_executor_exit_signal_after_stop(
                    &mut exit_signal,
                    &msg_store,
                    session_agent_id,
                )
                .await;

                completion = RunCompletionStatus::Stopped;
            }
        }

        completion.store(&completion_status);
        msg_store.push_finished();
    }

    pub(super) async fn wait_for_executor_exit_signal_after_stop(
        exit_signal: &mut Option<ExecutorExitSignal>,
        msg_store: &MsgStore,
        session_agent_id: Uuid,
    ) {
        let Some(signal) = exit_signal.as_mut() else {
            return;
        };

        match signal.await {
            Ok(exit_result) => {
                tracing::debug!(
                    session_agent_id = %session_agent_id,
                    exit_result = ?exit_result,
                    "[chat_runner] Executor task acknowledged stop"
                );
            }
            Err(err) => {
                msg_store.push(LogMsg::Stderr(format!(
                    "exit signal receive error after stop: {err}"
                )));
                tracing::warn!(
                    session_agent_id = %session_agent_id,
                    error = %err,
                    "[chat_runner] Exit signal closed while waiting for stop acknowledgement"
                );
            }
        }

        *exit_signal = None;
    }

    pub(super) async fn wait_for_lifecycle_event(
        child: &mut command_group::AsyncGroupChild,
        stop: &CancellationToken,
        exit_signal: &mut Option<ExecutorExitSignal>,
        msg_store: &MsgStore,
        session_agent_id: Uuid,
    ) -> LifecycleEvent {
        loop {
            tokio::select! {
                status = child.wait() => {
                    return LifecycleEvent::ProcessExited(status);
                }
                _ = stop.cancelled() => {
                    return LifecycleEvent::StopRequested;
                }
                signal_result = async {
                    let signal = exit_signal.as_mut().expect("exit signal checked");
                    signal.await
                }, if exit_signal.is_some() => {
                    match signal_result {
                        Ok(exit_result) => return LifecycleEvent::ExitSignal(exit_result),
                        Err(err) => {
                            msg_store.push(LogMsg::Stderr(format!("exit signal receive error: {err}")));
                            tracing::warn!(
                                session_agent_id = %session_agent_id,
                                error = %err,
                                "[chat_runner] Exit signal closed before process exit"
                            );
                            *exit_signal = None;
                        }
                    }
                }
            }
        }
    }

    pub(super) async fn recover_missing_run_control(
        &self,
        session_agent: &ChatSessionAgent,
    ) -> Result<(), ChatRunnerError> {
        let recovered = ChatSessionAgent::reset_runtime_state(
            &self.db.pool,
            session_agent.id,
            ChatSessionAgentState::Idle,
        )
        .await?;

        self.run_controls.remove(&session_agent.id);
        self.clear_pending_queue_on_failure(session_agent.session_id, session_agent.id)
            .await;
        self.emit(
            session_agent.session_id,
            ChatStreamEvent::AgentState {
                session_agent_id: recovered.id,
                agent_id: recovered.agent_id,
                state: recovered.state,
                started_at: None,
            },
        );

        tracing::warn!(
            session_id = %recovered.session_id,
            session_agent_id = %recovered.id,
            agent_id = %recovered.agent_id,
            previous_state = ?session_agent.state,
            "Recovered active chat session agent without an in-memory run control"
        );

        Ok(())
    }

    /// Stop a running agent by requesting centralized lifecycle cleanup.
    pub async fn stop_agent(
        &self,
        session_id: Uuid,
        session_agent_id: Uuid,
    ) -> Result<(), ChatRunnerError> {
        tracing::info!(
            "stop_agent called for session_agent_id: {}",
            session_agent_id
        );

        let Some(session_agent) =
            ChatSessionAgent::find_by_id(&self.db.pool, session_agent_id).await?
        else {
            tracing::warn!(
                session_id = %session_id,
                session_agent_id = %session_agent_id,
                "stop_agent requested for missing session agent"
            );
            return Ok(());
        };

        if !matches!(
            session_agent.state,
            ChatSessionAgentState::Running | ChatSessionAgentState::Stopping
        ) {
            tracing::info!(
                session_id = %session_id,
                session_agent_id = %session_agent_id,
                state = ?session_agent.state,
                "stop_agent ignored because agent is not active"
            );
            return Ok(());
        }

        let control_found = self.run_controls.contains_key(&session_agent_id);
        tracing::info!("Run control found: {}", control_found);

        if !control_found {
            self.recover_missing_run_control(&session_agent).await?;
            return Ok(());
        }

        if control_found && session_agent.state != ChatSessionAgentState::Stopping {
            let running_started_at = session_agent.updated_at;
            let updated = ChatSessionAgent::update_state(
                &self.db.pool,
                session_agent_id,
                ChatSessionAgentState::Stopping,
            )
            .await?;

            self.emit(
                session_id,
                ChatStreamEvent::AgentState {
                    session_agent_id,
                    agent_id: updated.agent_id,
                    state: ChatSessionAgentState::Stopping,
                    started_at: Some(running_started_at),
                },
            );
        }

        if let Some(control) = self.run_controls.get(&session_agent_id) {
            tracing::info!("Requesting stop for session_agent_id: {}", session_agent_id);
            control.stop.cancel();
        } else {
            tracing::warn!(
                "No run control found for session_agent_id: {}",
                session_agent_id
            );
        }

        Ok(())
    }
}
