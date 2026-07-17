/// Build the prompt for AI summarization
fn build_summarization_prompt(messages_to_compress: &[SimplifiedMessage]) -> String {
    let mut prompt = String::from(
        "Summarize the following chat history while preserving key tasks, decisions, \
constraints, and references. Keep the summary concise (under 500 words).\n\
Return only the summary body. Do not ask follow-up questions. Do not run any tools or shell commands.\n\nMessages:\n",
    );

    for msg in messages_to_compress {
        prompt.push_str(&format!("{}: {}\n", msg.sender, msg.content));
    }

    crate::services::mark_openteams_prompt(&prompt)
}

fn limit_summary_input_messages(
    messages_to_compress: &[SimplifiedMessage],
    token_limit: u32,
) -> (Vec<SimplifiedMessage>, u32, u32) {
    let total_tokens = estimate_token_count(messages_to_compress);
    if messages_to_compress.is_empty() || total_tokens <= token_limit {
        return (messages_to_compress.to_vec(), total_tokens, total_tokens);
    }

    // Keep the most recent part of the compressed segment under token budget.
    let mut selected_rev = Vec::new();
    let mut selected_tokens = 0u32;
    for message in messages_to_compress.iter().rev() {
        let message_tokens = estimate_token_count(std::slice::from_ref(message)).max(1);
        if !selected_rev.is_empty() && selected_tokens.saturating_add(message_tokens) > token_limit
        {
            break;
        }
        selected_rev.push(message.clone());
        selected_tokens = selected_tokens.saturating_add(message_tokens);
        if selected_tokens >= token_limit {
            break;
        }
    }

    if selected_rev.is_empty() {
        selected_rev.push(
            messages_to_compress
                .last()
                .expect("messages_to_compress must be non-empty")
                .clone(),
        );
        selected_tokens = estimate_token_count(&selected_rev);
    }

    selected_rev.reverse();
    (selected_rev, total_tokens, selected_tokens)
}

fn all_agents_running(session_agents: &[ChatSessionAgent]) -> bool {
    !session_agents.is_empty()
        && session_agents
            .iter()
            .all(|agent| agent.state == ChatSessionAgentState::Running)
}

fn summary_agent_priority(state: ChatSessionAgentState) -> u8 {
    match state {
        ChatSessionAgentState::Idle => 0,
        ChatSessionAgentState::WaitingApproval => 1,
        ChatSessionAgentState::Dead => 2,
        ChatSessionAgentState::Stopping => 3,
        ChatSessionAgentState::Running => 4,
    }
}

fn prioritize_summary_agents(session_agents: &[ChatSessionAgent]) -> Vec<ChatSessionAgent> {
    let mut agents = session_agents.to_vec();
    agents.sort_by_key(|agent| summary_agent_priority(agent.state.clone()));
    agents
}

async fn wait_for_idle_agent_if_needed(
    pool: &SqlitePool,
    session_id: Uuid,
    session_agents: &[ChatSessionAgent],
) -> Result<Vec<ChatSessionAgent>, ChatServiceError> {
    if !all_agents_running(session_agents) {
        return Ok(session_agents.to_vec());
    }

    // Avoid waiting forever in single-agent sessions where the current run just marked it running.
    if session_agents.len() == 1 {
        tracing::debug!(
            session_id = %session_id,
            session_agent_id = %session_agents[0].id,
            "Skipping idle-agent wait for summarization in single-agent running session"
        );
        return Ok(session_agents.to_vec());
    }

    // Do not block the active mention execution path.
    // When all agents are currently running, summarization should quickly fall back
    // so normal group chat delivery is not stalled.
    tracing::info!(
        session_id = %session_id,
        "All session agents are running; skipping idle wait to avoid blocking chat flow"
    );
    ChatSessionAgent::find_all_for_session(pool, session_id)
        .await
        .map_err(ChatServiceError::from)
}

/// Try to summarize messages using available AI agents
/// Returns Some(summary) if any agent succeeds, None if all fail
async fn try_summarize_with_agents(
    pool: &SqlitePool,
    session_id: Uuid,
    session_agents: &[ChatSessionAgent],
    messages_to_compress: &[SimplifiedMessage],
    workspace_path: &Path,
) -> Option<String> {
    let (summary_input_messages, input_tokens_before_limit, input_tokens_after_limit) =
        limit_summary_input_messages(messages_to_compress, SUMMARY_INPUT_TOKEN_LIMIT);
    if summary_input_messages.len() < messages_to_compress.len() {
        tracing::warn!(
            session_id = %session_id,
            original_messages = messages_to_compress.len(),
            included_messages = summary_input_messages.len(),
            original_tokens = input_tokens_before_limit,
            included_tokens = input_tokens_after_limit,
            token_limit = SUMMARY_INPUT_TOKEN_LIMIT,
            "Summarization input exceeded token limit; truncating to most recent messages"
        );
    }
    let summarize_prompt = build_summarization_prompt(&summary_input_messages);
    let candidate_agents =
        match wait_for_idle_agent_if_needed(pool, session_id, session_agents).await {
            Ok(agents) => agents,
            Err(err) => {
                tracing::warn!(
                    session_id = %session_id,
                    error = %err,
                    "Failed to refresh session agents before summarization; using initial snapshot"
                );
                session_agents.to_vec()
            }
        };

    if all_agents_running(&candidate_agents) {
        tracing::warn!(
            session_id = %session_id,
            "Skipping AI summarization because all agents are still running"
        );
        return None;
    }

    for session_agent in prioritize_summary_agents(&candidate_agents) {
        // Get the agent details
        let mut agent = match ChatAgent::find_by_id(pool, session_agent.agent_id).await {
            Ok(Some(agent)) => agent,
            _ => continue,
        };
        agent.name = session_agent.member_name.clone();

        tracing::debug!(
            "Attempting to summarize with agent: {} ({})",
            agent.name,
            agent.id
        );

        let workspace_override = session_agent.workspace_path.as_deref().map(Path::new);
        let effective_workspace_path = workspace_override.unwrap_or(workspace_path);

        // Try to call the agent for summarization
        match call_agent_for_summary(&agent, &summarize_prompt, effective_workspace_path).await {
            Ok(summary) => {
                tracing::info!(
                    session_id = %session_id,
                    agent = %agent.name,
                    "AI summarization successful"
                );
                return Some(summary);
            }
            Err(e) => {
                tracing::warn!(
                    session_id = %session_id,
                    agent = %agent.name,
                    error = %e,
                    "Agent failed to summarize, trying next agent"
                );
                continue;
            }
        }
    }

    tracing::warn!(
        session_id = %session_id,
        "All agents failed to summarize messages"
    );
    None
}

/// Call an agent to generate a summary
/// This spawns a temporary agent process to summarize messages
async fn call_agent_for_summary(
    agent: &ChatAgent,
    prompt: &str,
    workspace_path: &Path,
) -> Result<String, ChatServiceError> {
    let executor_profile_id = parse_executor_profile_id(agent)?;
    let mut executor =
        ExecutorConfigs::get_cached().get_coding_agent_or_default(&executor_profile_id);
    executor.use_approvals(Arc::new(NoopExecutorApprovalService));

    let repo_context = RepoContext::new(workspace_path.to_path_buf(), Vec::new());
    let env = ExecutionEnv::new(repo_context, false, String::new());
    let mut spawned = executor
        .spawn(workspace_path, prompt, &env)
        .await
        .map_err(map_executor_error)?;

    let msg_store = Arc::new(MsgStore::new());
    spawn_summary_log_forwarders(&mut spawned.child, msg_store.clone())?;
    executor.normalize_logs(msg_store.clone(), workspace_path);

    let mut failed_by_signal = false;
    let mut status = None;
    if let Some(exit_signal) = spawned.exit_signal.take() {
        // Prefer explicit completion signal from executor, then reap child process.
        match tokio::time::timeout(SUMMARY_EXECUTION_TIMEOUT, exit_signal).await {
            Ok(Ok(ExecutorExitResult::Success)) => {}
            Ok(Ok(ExecutorExitResult::Failure)) => failed_by_signal = true,
            Ok(Ok(ExecutorExitResult::FailureWithError(_))) => failed_by_signal = true,
            Ok(Err(err)) => {
                tracing::warn!(
                    agent_name = %agent.name,
                    error = %err,
                    "Summarization exit signal dropped; falling back to process wait"
                );
                status = Some(wait_for_summary_process_exit(&mut spawned, &agent.name).await?);
            }
            Err(_) => {
                terminate_summary_child(&mut spawned).await;
                return Err(ChatServiceError::Validation(format!(
                    "AI summarization timed out for agent {} after {} seconds",
                    agent.name,
                    SUMMARY_EXECUTION_TIMEOUT.as_secs()
                )));
            }
        }

        if status.is_none() {
            match tokio::time::timeout(SUMMARY_REAP_TIMEOUT, spawned.child.wait()).await {
                Ok(Ok(exit_status)) => status = Some(exit_status),
                Ok(Err(err)) => return Err(ChatServiceError::Io(err)),
                Err(_) => {
                    tracing::debug!(
                        agent_name = %agent.name,
                        timeout_ms = SUMMARY_REAP_TIMEOUT.as_millis(),
                        "Summarization process did not exit after completion signal; forcing shutdown"
                    );
                    terminate_summary_child(&mut spawned).await;
                }
            }
        }
    } else {
        status = Some(wait_for_summary_process_exit(&mut spawned, &agent.name).await?);
    }

    msg_store.push_finished();
    tokio::time::sleep(SUMMARY_DRAIN_TIMEOUT).await;

    if failed_by_signal {
        return Err(ChatServiceError::Validation(format!(
            "AI summarization process failed for agent {}",
            agent.name
        )));
    }

    if let Some(exit_status) = status
        && !exit_status.success()
    {
        return Err(ChatServiceError::Validation(format!(
            "AI summarization process failed for agent {}",
            agent.name
        )));
    }

    extract_latest_assistant_from_history(&msg_store.get_history()).ok_or_else(|| {
        ChatServiceError::Validation(format!(
            "No assistant summary output generated by agent {}",
            agent.name
        ))
    })
}

async fn wait_for_summary_process_exit(
    spawned: &mut SpawnedChild,
    agent_name: &str,
) -> Result<std::process::ExitStatus, ChatServiceError> {
    match tokio::time::timeout(SUMMARY_EXECUTION_TIMEOUT, spawned.child.wait()).await {
        Ok(Ok(status)) => Ok(status),
        Ok(Err(err)) => Err(ChatServiceError::Io(err)),
        Err(_) => {
            terminate_summary_child(spawned).await;
            Err(ChatServiceError::Validation(format!(
                "AI summarization timed out for agent {} after {} seconds",
                agent_name,
                SUMMARY_EXECUTION_TIMEOUT.as_secs()
            )))
        }
    }
}

async fn terminate_summary_child(spawned: &mut SpawnedChild) {
    if let Some(cancel) = spawned.cancel.take() {
        cancel.cancel();
    }
    let _ = spawned.child.kill().await;
    let _ = tokio::time::timeout(SUMMARY_KILL_WAIT_TIMEOUT, spawned.child.wait()).await;
}

fn parse_runner_type(agent: &ChatAgent) -> Result<BaseCodingAgent, ChatServiceError> {
    let raw = agent.runner_type.trim();
    let normalized = raw.replace(['-', ' '], "_").to_ascii_uppercase();
    BaseCodingAgent::from_str(&normalized)
        .map_err(|_| ChatServiceError::Validation(format!("unknown runner type: {raw}")))
}

fn extract_executor_profile_variant(tools_enabled: &serde_json::Value) -> Option<String> {
    let variant = tools_enabled
        .as_object()
        .and_then(|value| value.get(EXECUTOR_PROFILE_VARIANT_KEY))
        .and_then(serde_json::Value::as_str)?
        .trim();
    if variant.is_empty() || variant.eq_ignore_ascii_case("DEFAULT") {
        return None;
    }
    Some(canonical_variant_key(variant))
}

fn parse_executor_profile_id(agent: &ChatAgent) -> Result<ExecutorProfileId, ChatServiceError> {
    let executor = parse_runner_type(agent)?;
    let variant = extract_executor_profile_variant(&agent.tools_enabled.0);
    Ok(match variant {
        Some(variant) => ExecutorProfileId::with_variant(executor, variant),
        None => ExecutorProfileId::new(executor),
    })
}

fn map_executor_error(err: ExecutorError) -> ChatServiceError {
    ChatServiceError::Validation(format!("executor error: {err}"))
}

fn spawn_summary_log_forwarders(
    child: &mut command_group::AsyncGroupChild,
    msg_store: Arc<MsgStore>,
) -> Result<(), ChatServiceError> {
    let stdout = child.inner().stdout.take().ok_or_else(|| {
        ChatServiceError::Validation("summarization child missing stdout".to_string())
    })?;
    let stderr = child.inner().stderr.take().ok_or_else(|| {
        ChatServiceError::Validation("summarization child missing stderr".to_string())
    })?;

    let stdout_store = msg_store.clone();
    tokio::spawn(async move {
        let mut stream = ReaderStream::new(stdout);
        let mut decoder = Utf8LossyDecoder::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    let text = decoder.decode_chunk(&bytes);
                    if !text.is_empty() {
                        stdout_store.push(LogMsg::Stdout(text));
                    }
                }
                Err(err) => {
                    stdout_store.push(LogMsg::Stderr(format!("stdout error: {err}")));
                }
            }
        }

        let tail = decoder.finish();
        if !tail.is_empty() {
            stdout_store.push(LogMsg::Stdout(tail));
        }
    });

    let stderr_store = msg_store;
    tokio::spawn(async move {
        let mut stream = ReaderStream::new(stderr);
        let mut decoder = Utf8LossyDecoder::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    let text = decoder.decode_chunk(&bytes);
                    if !text.is_empty() {
                        stderr_store.push(LogMsg::Stderr(text));
                    }
                }
                Err(err) => {
                    stderr_store.push(LogMsg::Stderr(format!("stderr error: {err}")));
                }
            }
        }

        let tail = decoder.finish();
        if !tail.is_empty() {
            stderr_store.push(LogMsg::Stderr(tail));
        }
    });

    Ok(())
}

fn extract_latest_assistant_from_history(history: &[LogMsg]) -> Option<String> {
    let mut assistant_entries: HashMap<usize, String> = HashMap::new();

    for message in history {
        let LogMsg::JsonPatch(patch) = message else {
            continue;
        };

        let Some((index, entry)) = extract_normalized_entry_from_patch(patch) else {
            continue;
        };

        if matches!(entry.entry_type, NormalizedEntryType::AssistantMessage) {
            assistant_entries.insert(index, entry.content);
        }
    }

    assistant_entries
        .into_iter()
        .max_by_key(|(index, _)| *index)
        .map(|(_, content)| content.trim().to_string())
        .filter(|content| !content.is_empty())
}

fn select_messages_to_compress_by_token(
    messages: &[SimplifiedMessage],
    total_tokens: u32,
    compression_percentage: u8,
) -> (usize, u32, u32) {
    if messages.is_empty() {
        return (0, 0, 0);
    }

    let target_tokens = ((total_tokens as u64) * (compression_percentage as u64)).div_ceil(100);
    let target_tokens = (target_tokens as u32).max(1);

    let mut selected_tokens = 0u32;
    let mut selected_count = 0usize;

    for message in messages {
        // Use per-message token estimates so we can choose a prefix by token budget.
        let message_tokens = estimate_token_count(std::slice::from_ref(message)).max(1);
        selected_tokens = selected_tokens.saturating_add(message_tokens);
        selected_count += 1;
        if selected_tokens >= target_tokens {
            break;
        }
    }

    (
        selected_count.max(1).min(messages.len()),
        target_tokens,
        selected_tokens,
    )
}

fn calculate_messages_fingerprint(messages: &[SimplifiedMessage]) -> u64 {
    let mut hasher = DefaultHasher::new();
    for message in messages {
        hasher.write(message.sender.as_bytes());
        hasher.write_u8(0x1f);
        hasher.write(message.content.as_bytes());
        hasher.write_u8(0x1e);
        hasher.write(message.timestamp.as_bytes());
        hasher.write_u8(0x1d);
    }
    hasher.finish()
}

fn compression_type_to_db_value(value: &CompressionType) -> &'static str {
    match value {
        CompressionType::None => "none",
        CompressionType::AiSummarized => "ai_summarized",
        CompressionType::Truncated => "truncated",
    }
}

fn compression_type_from_db_value(value: &str) -> Option<CompressionType> {
    match value {
        "none" => Some(CompressionType::None),
        "ai_summarized" => Some(CompressionType::AiSummarized),
        "truncated" => Some(CompressionType::Truncated),
        _ => None,
    }
}

fn is_missing_compression_state_table_error(err: &sqlx::Error) -> bool {
    match err {
        sqlx::Error::Database(db_err) => {
            let message = db_err.message();
            message.contains("no such table") && message.contains(COMPRESSION_STATE_TABLE)
        }
        _ => false,
    }
}

fn parse_required_u32(row: &sqlx::sqlite::SqliteRow, field: &str) -> Result<u32, sqlx::Error> {
    let value: i64 = row.try_get(field)?;
    u32::try_from(value).map_err(|_| {
        sqlx::Error::Decode(Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("field {field} is out of range for u32: {value}"),
        )))
    })
}

fn parse_required_usize(row: &sqlx::sqlite::SqliteRow, field: &str) -> Result<usize, sqlx::Error> {
    let value: i64 = row.try_get(field)?;
    usize::try_from(value).map_err(|_| {
        sqlx::Error::Decode(Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("field {field} is out of range for usize: {value}"),
        )))
    })
}

fn cache_compression_result_in_memory(
    session_id: Uuid,
    source_fingerprint: u64,
    source_message_count: usize,
    token_threshold: u32,
    compression_percentage: u8,
    source_token_count: u32,
    result: &CompressionResult,
) -> CompressionCacheEntry {
    let effective_token_count = estimate_token_count(&result.messages);
    let entry = CompressionCacheEntry {
        source_fingerprint,
        source_message_count,
        token_threshold,
        compression_percentage,
        source_token_count,
        effective_token_count,
        result: result.clone(),
    };
    COMPRESSION_RESULT_CACHE.insert(session_id, entry.clone());
    entry
}

async fn persist_compression_result(
    pool: &SqlitePool,
    session_id: Uuid,
    entry: &CompressionCacheEntry,
) -> Result<(), ChatServiceError> {
    let warning_json = entry
        .result
        .warning
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|err| {
            ChatServiceError::Validation(format!("failed to serialize compression warning: {err}"))
        })?;
    let result_messages_json = serde_json::to_string(&entry.result.messages).map_err(|err| {
        ChatServiceError::Validation(format!(
            "failed to serialize compression result messages: {err}"
        ))
    })?;

    let query = format!(
        "INSERT INTO {COMPRESSION_STATE_TABLE} (
            session_id,
            source_fingerprint,
            source_message_count,
            token_threshold,
            compression_percentage,
            source_token_count,
            effective_token_count,
            compression_type,
            warning_json,
            result_messages_json,
            updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now', 'subsec'))
        ON CONFLICT(session_id) DO UPDATE SET
            source_fingerprint = excluded.source_fingerprint,
            source_message_count = excluded.source_message_count,
            token_threshold = excluded.token_threshold,
            compression_percentage = excluded.compression_percentage,
            source_token_count = excluded.source_token_count,
            effective_token_count = excluded.effective_token_count,
            compression_type = excluded.compression_type,
            warning_json = excluded.warning_json,
            result_messages_json = excluded.result_messages_json,
            updated_at = datetime('now', 'subsec')"
    );

    let execute_result = sqlx::query(&query)
        .bind(session_id)
        .bind(entry.source_fingerprint.to_string())
        .bind(entry.source_message_count as i64)
        .bind(entry.token_threshold as i64)
        .bind(entry.compression_percentage as i64)
        .bind(entry.source_token_count as i64)
        .bind(entry.effective_token_count as i64)
        .bind(compression_type_to_db_value(&entry.result.compression_type))
        .bind(warning_json)
        .bind(result_messages_json)
        .execute(pool)
        .await;

    match execute_result {
        Ok(_) => Ok(()),
        Err(err) if is_missing_compression_state_table_error(&err) => {
            tracing::debug!(
                table = COMPRESSION_STATE_TABLE,
                "Compression state table is missing; skip persisting compression cache"
            );
            Ok(())
        }
        Err(err) => Err(ChatServiceError::Database(err)),
    }
}

#[allow(clippy::too_many_arguments)]
async fn cache_compression_result(
    pool: &SqlitePool,
    session_id: Uuid,
    source_fingerprint: u64,
    source_message_count: usize,
    token_threshold: u32,
    compression_percentage: u8,
    source_token_count: u32,
    result: &CompressionResult,
) {
    let entry = cache_compression_result_in_memory(
        session_id,
        source_fingerprint,
        source_message_count,
        token_threshold,
        compression_percentage,
        source_token_count,
        result,
    );

    if let Err(err) = persist_compression_result(pool, session_id, &entry).await {
        tracing::warn!(
            session_id = %session_id,
            error = %err,
            "Failed to persist compression cache entry"
        );
    }
}

async fn load_persisted_compression_result(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<Option<CompressionCacheEntry>, ChatServiceError> {
    let query = format!(
        "SELECT
            source_fingerprint,
            source_message_count,
            token_threshold,
            compression_percentage,
            source_token_count,
            effective_token_count,
            compression_type,
            warning_json,
            result_messages_json
         FROM {COMPRESSION_STATE_TABLE}
         WHERE session_id = ?1"
    );

    let row = match sqlx::query(&query)
        .bind(session_id)
        .fetch_optional(pool)
        .await
    {
        Ok(row) => row,
        Err(err) if is_missing_compression_state_table_error(&err) => {
            tracing::debug!(
                table = COMPRESSION_STATE_TABLE,
                "Compression state table is missing; skip loading persisted compression cache"
            );
            return Ok(None);
        }
        Err(err) => return Err(ChatServiceError::Database(err)),
    };

    let Some(row) = row else {
        return Ok(None);
    };

    let source_fingerprint_raw: String = row.try_get("source_fingerprint")?;
    let source_fingerprint = match source_fingerprint_raw.parse::<u64>() {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                session_id = %session_id,
                source_fingerprint = %source_fingerprint_raw,
                error = %err,
                "Invalid persisted compression fingerprint; ignoring persisted state"
            );
            return Ok(None);
        }
    };

    let source_message_count = parse_required_usize(&row, "source_message_count")?;
    let token_threshold = parse_required_u32(&row, "token_threshold")?;
    let compression_percentage = parse_required_u32(&row, "compression_percentage")?;
    let compression_percentage = match u8::try_from(compression_percentage) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                session_id = %session_id,
                compression_percentage = compression_percentage,
                error = %err,
                "Persisted compression percentage is invalid; ignoring persisted state"
            );
            return Ok(None);
        }
    };
    let source_token_count = parse_required_u32(&row, "source_token_count")?;
    let effective_token_count = parse_required_u32(&row, "effective_token_count")?;

    let compression_type_raw: String = row.try_get("compression_type")?;
    let Some(compression_type) = compression_type_from_db_value(&compression_type_raw) else {
        tracing::warn!(
            session_id = %session_id,
            compression_type = %compression_type_raw,
            "Persisted compression type is invalid; ignoring persisted state"
        );
        return Ok(None);
    };

    let warning = row
        .try_get::<Option<String>, _>("warning_json")?
        .and_then(|raw| serde_json::from_str::<CompressionWarning>(&raw).ok());

    let result_messages_json: String = row.try_get("result_messages_json")?;
    let result_messages =
        match serde_json::from_str::<Vec<SimplifiedMessage>>(&result_messages_json) {
            Ok(messages) => messages,
            Err(err) => {
                tracing::warn!(
                    session_id = %session_id,
                    error = %err,
                    "Persisted compression result messages are invalid; ignoring persisted state"
                );
                return Ok(None);
            }
        };

    Ok(Some(CompressionCacheEntry {
        source_fingerprint,
        source_message_count,
        token_threshold,
        compression_percentage,
        source_token_count,
        effective_token_count,
        result: CompressionResult {
            messages: result_messages,
            compression_type,
            warning,
        },
    }))
}

async fn get_compression_cache_entry(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<Option<CompressionCacheEntry>, ChatServiceError> {
    if let Some(cached) = COMPRESSION_RESULT_CACHE.get(&session_id) {
        return Ok(Some(cached.clone()));
    }

    let persisted = load_persisted_compression_result(pool, session_id).await?;
    if let Some(entry) = persisted.as_ref() {
        COMPRESSION_RESULT_CACHE.insert(session_id, entry.clone());
        tracing::debug!(
            session_id = %session_id,
            source_messages = entry.source_message_count,
            compression_type = ?entry.result.compression_type,
            "Loaded persisted compression cache state from database"
        );
    }

    Ok(persisted)
}

/// Compress messages if they exceed the token threshold
///
/// This function implements the compression strategy:
/// 1. Calculate total token count using tiktoken
/// 2. If under threshold, return messages unchanged
/// 3. If over threshold:
///    - Select a prefix whose tokens are >= configured compression percentage
///    - Try AI summarization with each session agent
///    - If all agents fail, truncate to cutoff file and return warning
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `session_id` - Chat session ID
/// * `messages` - Messages to potentially compress
/// * `token_threshold` - Token count that triggers compression
/// * `compression_percentage` - Percentage of messages to compress (default 25)
/// * `session_agents` - AI agents in the session for summarization
/// * `workspace_path` - Workspace path for running agents
/// * `context_dir` - Path to context directory for storing cutoff files
#[allow(clippy::too_many_arguments)]
pub async fn compress_messages_if_needed(
    pool: &SqlitePool,
    session_id: Uuid,
    messages: Vec<SimplifiedMessage>,
    token_threshold: u32,
    compression_percentage: u8,
    session_agents: &[ChatSessionAgent],
    workspace_path: &Path,
    context_dir: Option<&Path>,
) -> Result<CompressionResult, ChatServiceError> {
    let source_messages = messages;
    let source_fingerprint = calculate_messages_fingerprint(&source_messages);
    let source_token_count = estimate_token_count(&source_messages);
    let mut effective_messages = source_messages.clone();
    let mut inherited_compression_type: Option<CompressionType> = None;
    let mut inherited_warning: Option<CompressionWarning> = None;
    let cached_entry = get_compression_cache_entry(pool, session_id).await?;

    if let Some(cached) = cached_entry.as_ref()
        && cached.source_fingerprint == source_fingerprint
        && cached.token_threshold == token_threshold
        && cached.compression_percentage == compression_percentage
    {
        tracing::debug!(
            session_id = %session_id,
            source_tokens = cached.source_token_count,
            effective_tokens = cached.effective_token_count,
            compression_type = ?cached.result.compression_type,
            "Using cached compression result for unchanged session history"
        );
        return Ok(cached.result.clone());
    }
    if let Some(cached) = cached_entry.as_ref()
        && cached.token_threshold == token_threshold
        && cached.compression_percentage == compression_percentage
        && cached.source_message_count <= source_messages.len()
    {
        let prefix_fingerprint =
            calculate_messages_fingerprint(&source_messages[..cached.source_message_count]);
        if prefix_fingerprint == cached.source_fingerprint {
            let mut merged = cached.result.messages.clone();
            merged.extend_from_slice(&source_messages[cached.source_message_count..]);
            effective_messages = merged;
            if cached.result.compression_type != CompressionType::None {
                inherited_compression_type = Some(cached.result.compression_type.clone());
                inherited_warning = cached.result.warning.clone();
            }
            tracing::debug!(
                session_id = %session_id,
                base_source_messages = cached.source_message_count,
                new_messages = source_messages.len().saturating_sub(cached.source_message_count),
                inherited_compression_type = ?cached.result.compression_type,
                "Using incremental compression base for appended session history"
            );
        }
    }

    let token_count = estimate_token_count(&effective_messages);

    tracing::debug!(
        session_id = %session_id,
        source_token_count = source_token_count,
        effective_token_count = token_count,
        token_count = token_count,
        threshold = token_threshold,
        "Checking if compression is needed"
    );

    // If under threshold, no compression needed
    if token_count <= token_threshold {
        let compression_type = inherited_compression_type.unwrap_or(CompressionType::None);
        let warning = if compression_type == CompressionType::None {
            None
        } else {
            inherited_warning
        };
        let result = CompressionResult {
            messages: effective_messages,
            compression_type,
            warning,
        };
        cache_compression_result(
            pool,
            session_id,
            source_fingerprint,
            source_messages.len(),
            token_threshold,
            compression_percentage,
            source_token_count,
            &result,
        )
        .await;
        return Ok(result);
    }

    let total_messages = effective_messages.len();
    if total_messages == 0 {
        let result = CompressionResult {
            messages: effective_messages,
            compression_type: CompressionType::None,
            warning: None,
        };
        cache_compression_result(
            pool,
            session_id,
            source_fingerprint,
            source_messages.len(),
            token_threshold,
            compression_percentage,
            source_token_count,
            &result,
        )
        .await;
        return Ok(result);
    }

    let (messages_to_compress_count, target_compress_tokens, selected_compress_tokens) =
        select_messages_to_compress_by_token(
            &effective_messages,
            token_count,
            compression_percentage,
        );

    let (messages_to_compress, messages_to_keep) =
        effective_messages.split_at(messages_to_compress_count);

    tracing::info!(
        session_id = %session_id,
        total = total_messages,
        total_tokens = token_count,
        target_compress_tokens = target_compress_tokens,
        selected_compress_tokens = selected_compress_tokens,
        to_compress = messages_to_compress_count,
        to_keep = messages_to_keep.len(),
        "Compressing messages"
    );

    // Try AI summarization with available agents
    if !session_agents.is_empty()
        && let Some(summary) = try_summarize_with_agents(
            pool,
            session_id,
            session_agents,
            messages_to_compress,
            workspace_path,
        )
        .await
    {
        // Create summary message and prepend to kept messages
        let summary_message = SimplifiedMessage {
            sender: "system:summary".to_string(),
            content: format!("[History Summary]\n{}", summary),
            timestamp: Utc::now().to_rfc3339(),
        };

        let mut result_messages = vec![summary_message];
        result_messages.extend(messages_to_keep.to_vec());
        let compressed_token_count = estimate_token_count(&result_messages);

        if compressed_token_count >= token_count {
            tracing::warn!(
                session_id = %session_id,
                before_tokens = token_count,
                after_tokens = compressed_token_count,
                "AI summarization did not reduce token usage, falling back to truncation"
            );
        } else {
            tracing::info!(
                session_id = %session_id,
                before_tokens = token_count,
                after_tokens = compressed_token_count,
                "AI summarization reduced token usage"
            );
            let result = CompressionResult {
                messages: result_messages,
                compression_type: CompressionType::AiSummarized,
                warning: None,
            };
            cache_compression_result(
                pool,
                session_id,
                source_fingerprint,
                source_messages.len(),
                token_threshold,
                compression_percentage,
                source_token_count,
                &result,
            )
            .await;
            return Ok(result);
        }
    }

    // All agents failed - fallback to truncation
    tracing::warn!(
        session_id = %session_id,
        "AI summarization failed, falling back to truncation"
    );

    // Write messages to cutoff file in context directory
    let cutoff_path = if let Some(ctx_dir) = context_dir {
        // Find next available cutoff index
        let mut index = 0;
        loop {
            let candidate = ctx_dir.join(format!("cutoff_message_{}.json", index));
            if !candidate.exists() {
                break candidate;
            }
            index += 1;
        }
    } else {
        // Fallback to legacy split file if no context_dir provided
        append_to_split_file(session_id, messages_to_compress)
            .await
            .map_err(|e| {
                ChatServiceError::Io(std::io::Error::other(format!(
                    "Failed to create split file: {}",
                    e
                )))
            })?
    };

    // Write cutoff messages to file
    if context_dir.is_some() {
        let cutoff_data = serde_json::json!({
            "session_id": session_id,
            "cutoff_at": chrono::Utc::now().to_rfc3339(),
            "message_count": messages_to_compress_count,
            "messages": messages_to_compress,
        });
        let json_str = serde_json::to_string_pretty(&cutoff_data).map_err(|e| {
            ChatServiceError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Failed to serialize cutoff data: {}", e),
            ))
        })?;
        fs::write(&cutoff_path, json_str).await?;
    }

    let cutoff_path_str = cutoff_path.to_string_lossy().to_string();

    // Keep a compact summary marker at the front so history file always contains
    // "compressed context + remaining uncompressed messages".
    let mut result_messages = vec![SimplifiedMessage {
        sender: "system:summary".to_string(),
        content: format!(
            "[History Summary - Fallback]\nAI summarization failed; archived {} messages (~{} tokens) to {}",
            messages_to_compress_count, selected_compress_tokens, cutoff_path_str
        ),
        timestamp: Utc::now().to_rfc3339(),
    }];
    result_messages.extend(messages_to_keep.to_vec());

    // Return summary marker + remaining messages with warning
    let result = CompressionResult {
        messages: result_messages,
        compression_type: CompressionType::Truncated,
        warning: Some(CompressionWarning {
            code: "COMPRESSION_FALLBACK".to_string(),
            message: format!(
                "AI summarization failed or was ineffective; archived {} messages (~{} tokens) to cutoff file",
                messages_to_compress_count, selected_compress_tokens
            ),
            split_file_path: cutoff_path_str,
        }),
    };
    cache_compression_result(
        pool,
        session_id,
        source_fingerprint,
        source_messages.len(),
        token_threshold,
        compression_percentage,
        source_token_count,
        &result,
    )
    .await;
    Ok(result)
}
