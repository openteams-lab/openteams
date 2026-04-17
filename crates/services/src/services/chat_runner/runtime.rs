use tokio::{
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom},
    task::JoinHandle,
};

use super::*;

pub(super) struct ExitWatcherArgs {
    pub(super) child: command_group::AsyncGroupChild,
    pub(super) stop: CancellationToken,
    pub(super) executor_cancel: Option<CancellationToken>,
    pub(super) exit_signal: Option<ExecutorExitSignal>,
    pub(super) msg_store: Arc<MsgStore>,
    pub(super) completion_status: Arc<AtomicU8>,
    pub(super) log_forwarders: RunLogForwarders,
}

pub(super) struct RunLogForwarders {
    pub(super) stdout: JoinHandle<()>,
    pub(super) stderr: JoinHandle<()>,
}

#[derive(Debug, Clone)]
pub(super) struct RunLogSpoolSnapshot {
    pub(super) total_bytes: u64,
    pub(super) persisted_bytes: u64,
    pub(super) dropped_bytes: u64,
    pub(super) log_truncated: bool,
    pub(super) log_capture_degraded: bool,
}

#[derive(Debug, Clone)]
pub(super) struct RunLogPersistResult {
    pub(super) snapshot: RunLogSpoolSnapshot,
    pub(super) log_path: PathBuf,
    pub(super) log_state: ChatRunLogState,
    pub(super) persist_error: Option<String>,
}

#[derive(Debug, Default)]
struct RunStreamStateSnapshot {
    agent_session_id: Option<String>,
    agent_message_id: Option<String>,
    latest_assistant: String,
    assistant_update_count: u64,
    last_token_usage: Option<TokenUsageInfo>,
    error_content: String,
    error_update_count: u64,
    error_type: Option<NormalizedEntryError>,
}

#[derive(Debug)]
struct StreamPatchDelta {
    stream_type: ChatStreamDeltaType,
    content: String,
    delta: bool,
}

pub(super) struct RunLogSpool {
    path: PathBuf,
    file: Option<fs::File>,
    run_id: Uuid,
    db_pool: sqlx::SqlitePool,
    workspace_key: String,
    workspace_live_log_bytes: Arc<DashMap<String, u64>>,
    current_bytes: u64,
    total_bytes: u64,
    dropped_bytes: u64,
    log_truncated: bool,
    log_capture_degraded: bool,
    last_synced_log_truncated: bool,
    last_synced_log_capture_degraded: bool,
}

const TAIL_PARTIAL_LINE_NOTICE: &str =
    "[openteams] tail omitted a leading partial log line after truncation.\n";

impl RunLogSpool {
    pub(super) async fn new(
        path: PathBuf,
        run_id: Uuid,
        db_pool: sqlx::SqlitePool,
        workspace_key: String,
        workspace_live_log_bytes: Arc<DashMap<String, u64>>,
    ) -> Result<Self, std::io::Error> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .read(true)
            .write(true)
            .open(&path)
            .await?;
        Ok(Self {
            path,
            file: Some(file),
            run_id,
            db_pool,
            workspace_key,
            workspace_live_log_bytes,
            current_bytes: 0,
            total_bytes: 0,
            dropped_bytes: 0,
            log_truncated: false,
            log_capture_degraded: false,
            last_synced_log_truncated: false,
            last_synced_log_capture_degraded: false,
        })
    }

    fn workspace_total_without_self(&self) -> u64 {
        self.workspace_live_log_bytes
            .get(&self.workspace_key)
            .map(|entry| entry.value().saturating_sub(self.current_bytes))
            .unwrap_or(0)
    }

    fn effective_cap(&self) -> u64 {
        let workspace_available =
            LIVE_LOG_BUDGET_BYTES_PER_WORKSPACE.saturating_sub(self.workspace_total_without_self());
        LIVE_LOG_MAX_BYTES_PER_RUN.min(workspace_available)
    }

    fn update_workspace_bytes(&self, new_current_bytes: u64) {
        let delta_positive = new_current_bytes.saturating_sub(self.current_bytes);
        let delta_negative = self.current_bytes.saturating_sub(new_current_bytes);

        let mut entry = self
            .workspace_live_log_bytes
            .entry(self.workspace_key.clone())
            .or_insert(0);
        *entry = entry
            .saturating_add(delta_positive)
            .saturating_sub(delta_negative);
    }

    async fn read_tail_bytes(
        &mut self,
        bytes_to_keep: u64,
    ) -> Result<(Vec<u8>, bool), std::io::Error> {
        let Some(file) = self.file.as_mut() else {
            return Ok((Vec::new(), false));
        };

        if bytes_to_keep == 0 || self.current_bytes == 0 {
            return Ok((Vec::new(), false));
        }

        let start = self.current_bytes.saturating_sub(bytes_to_keep);
        let mut started_mid_line = false;
        if start > 0 {
            file.seek(SeekFrom::Start(start - 1)).await?;
            let mut previous = [0_u8; 1];
            file.read_exact(&mut previous).await?;
            started_mid_line = !matches!(previous[0], b'\n' | b'\r');
        }
        file.seek(SeekFrom::Start(start)).await?;
        let mut buffer = vec![0; bytes_to_keep as usize];
        file.read_exact(&mut buffer).await?;
        Ok((buffer, started_mid_line))
    }

    async fn rewrite_with_bytes(&mut self, bytes: &[u8]) -> Result<(), std::io::Error> {
        {
            let Some(file) = self.file.as_mut() else {
                return Ok(());
            };

            file.set_len(0).await?;
            file.seek(SeekFrom::Start(0)).await?;
            if !bytes.is_empty() {
                file.write_all(bytes).await?;
            }
            file.flush().await?;
            file.seek(SeekFrom::End(0)).await?;
        }

        self.update_workspace_bytes(bytes.len() as u64);
        self.current_bytes = bytes.len() as u64;
        Ok(())
    }

    fn align_persisted_tail_to_line_boundary(
        mut bytes: Vec<u8>,
        started_mid_line: bool,
    ) -> Vec<u8> {
        if bytes.is_empty() {
            return bytes;
        }

        if !started_mid_line {
            while matches!(bytes.first(), Some(b'\n' | b'\r')) {
                bytes.remove(0);
            }
            return bytes;
        }

        let Some(first_newline) = bytes.iter().position(|byte| *byte == b'\n') else {
            let mut persisted = Vec::with_capacity(TAIL_PARTIAL_LINE_NOTICE.len() + bytes.len());
            persisted.extend_from_slice(TAIL_PARTIAL_LINE_NOTICE.as_bytes());
            persisted.extend_from_slice(&bytes);
            return persisted;
        };

        let remainder = &bytes[(first_newline + 1)..];
        let mut persisted = Vec::with_capacity(TAIL_PARTIAL_LINE_NOTICE.len() + remainder.len());
        persisted.extend_from_slice(TAIL_PARTIAL_LINE_NOTICE.as_bytes());
        persisted.extend_from_slice(remainder);
        persisted
    }

    async fn sync_live_retention_flags_if_needed(&mut self) {
        if self.log_truncated == self.last_synced_log_truncated
            && self.log_capture_degraded == self.last_synced_log_capture_degraded
        {
            return;
        }

        match ChatRun::update_live_retention_flags(
            &self.db_pool,
            self.run_id,
            self.log_truncated,
            self.log_capture_degraded,
        )
        .await
        {
            Ok(()) => {
                self.last_synced_log_truncated = self.log_truncated;
                self.last_synced_log_capture_degraded = self.log_capture_degraded;
            }
            Err(err) => {
                tracing::warn!(
                    run_id = %self.run_id,
                    error = %err,
                    "failed to sync live retention flags"
                );
            }
        }
    }

    pub(super) async fn write_text(&mut self, text: &str) -> Result<(), std::io::Error> {
        let incoming = text.as_bytes();
        if incoming.is_empty() {
            return Ok(());
        }

        self.total_bytes = self.total_bytes.saturating_add(incoming.len() as u64);

        let cap = self.effective_cap();
        if cap == 0 {
            self.dropped_bytes = self.dropped_bytes.saturating_add(incoming.len() as u64);
            self.log_truncated = true;
            self.log_capture_degraded = true;
            self.rewrite_with_bytes(&[]).await?;
            self.sync_live_retention_flags_if_needed().await;
            return Ok(());
        }

        if cap < LIVE_LOG_MAX_BYTES_PER_RUN {
            self.log_capture_degraded = true;
        }

        if (incoming.len() as u64) >= cap {
            self.dropped_bytes = self
                .dropped_bytes
                .saturating_add(self.current_bytes)
                .saturating_add(incoming.len() as u64 - cap);
            self.log_truncated = true;
            let start = incoming.len() - cap as usize;
            self.rewrite_with_bytes(&incoming[start..]).await?;
            self.sync_live_retention_flags_if_needed().await;
            return Ok(());
        }

        let next_size = self.current_bytes.saturating_add(incoming.len() as u64);
        if next_size <= cap {
            if let Some(file) = self.file.as_mut() {
                file.seek(SeekFrom::End(0)).await?;
                file.write_all(incoming).await?;
                file.flush().await?;
                self.update_workspace_bytes(next_size);
                self.current_bytes = next_size;
            }
            self.sync_live_retention_flags_if_needed().await;
            return Ok(());
        }

        let bytes_to_keep = cap.saturating_sub(incoming.len() as u64);
        let (mut retained, _) = self.read_tail_bytes(bytes_to_keep).await?;
        retained.extend_from_slice(incoming);
        self.dropped_bytes = self
            .dropped_bytes
            .saturating_add(self.current_bytes.saturating_sub(bytes_to_keep));
        self.log_truncated = true;
        self.rewrite_with_bytes(&retained).await?;
        self.sync_live_retention_flags_if_needed().await;
        Ok(())
    }

    pub(super) async fn persist_tail_to(
        &mut self,
        tail_path: &Path,
        tail_limit: u64,
    ) -> RunLogPersistResult {
        let persist_error = if let Some(file) = self.file.as_mut() {
            file.flush().await.err().map(|err| err.to_string())
        } else {
            Some("live spool file missing before tail persistence".to_string())
        };

        let persisted = if persist_error.is_some() || tail_limit == 0 {
            Vec::new()
        } else {
            let keep = self.current_bytes.min(tail_limit);
            match self.read_tail_bytes(keep).await {
                Ok((bytes, started_mid_line)) => {
                    Self::align_persisted_tail_to_line_boundary(bytes, started_mid_line)
                }
                Err(err) => {
                    return self.release_to_live_fallback(Some(err.to_string())).await;
                }
            }
        };

        if let Some(err) = persist_error {
            return self.release_to_live_fallback(Some(err)).await;
        }

        let snapshot = RunLogSpoolSnapshot {
            total_bytes: self.total_bytes,
            persisted_bytes: persisted.len() as u64,
            dropped_bytes: self.dropped_bytes,
            log_truncated: self.log_truncated,
            log_capture_degraded: self.log_capture_degraded,
        };

        self.file = None;
        self.update_workspace_bytes(0);
        self.current_bytes = 0;

        let persist_result = async {
            if let Some(parent) = tail_path.parent() {
                fs::create_dir_all(parent).await?;
            }
            fs::write(tail_path, &persisted).await?;
            Ok::<(), std::io::Error>(())
        }
        .await;

        match persist_result {
            Ok(()) => {
                if let Err(err) = fs::remove_file(&self.path).await {
                    tracing::warn!(
                        run_id = %self.run_id,
                        live_spool_path = %self.path.display(),
                        error = %err,
                        "failed to remove live raw log spool after tail persistence"
                    );
                }

                RunLogPersistResult {
                    snapshot,
                    log_path: tail_path.to_path_buf(),
                    log_state: ChatRunLogState::Tail,
                    persist_error: None,
                }
            }
            Err(err) => RunLogPersistResult {
                snapshot,
                log_path: self.path.clone(),
                log_state: ChatRunLogState::Live,
                persist_error: Some(err.to_string()),
            },
        }
    }

    async fn release_to_live_fallback(
        &mut self,
        persist_error: Option<String>,
    ) -> RunLogPersistResult {
        let snapshot = RunLogSpoolSnapshot {
            total_bytes: self.total_bytes,
            persisted_bytes: self.current_bytes,
            dropped_bytes: self.dropped_bytes,
            log_truncated: self.log_truncated,
            log_capture_degraded: self.log_capture_degraded,
        };

        self.file = None;
        self.update_workspace_bytes(0);
        self.current_bytes = 0;

        RunLogPersistResult {
            snapshot,
            log_path: self.path.clone(),
            log_state: ChatRunLogState::Live,
            persist_error,
        }
    }
}

impl ChatRunner {
    fn normalized_entry_error_name(error: Option<&NormalizedEntryError>) -> String {
        match error {
            Some(NormalizedEntryError::SetupRequired) => "setup_required",
            Some(NormalizedEntryError::QuotaExceeded { .. }) => "quota_exceeded",
            Some(NormalizedEntryError::RateLimitExceeded { .. }) => "rate_limit_exceeded",
            Some(NormalizedEntryError::ServerOverloaded { .. }) => "server_overloaded",
            Some(NormalizedEntryError::AuthenticationFailed { .. }) => "authentication_failed",
            Some(NormalizedEntryError::ContextLimitExceeded { .. }) => "context_limit_exceeded",
            Some(NormalizedEntryError::Other) => "other",
            None => "unknown",
        }
        .to_string()
    }

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
        raw_log_spool: Arc<Mutex<RunLogSpool>>,
    ) -> RunLogForwarders {
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
        let stdout_log = raw_log_spool.clone();
        let stdout = tokio::spawn(async move {
            tracing::debug!("[chat_runner] Starting stdout forwarder");
            let mut stream = ReaderStream::new(stdout);
            let mut decoder = Utf8LossyDecoder::new();
            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(bytes) => {
                        let text = decoder.decode_chunk(&bytes);
                        if !text.is_empty() {
                            stdout_store.push(LogMsg::Stdout(text.clone()));
                            let mut spool = stdout_log.lock().await;
                            let _ = spool.write_text(&text).await;
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
                let mut spool = stdout_log.lock().await;
                let _ = spool.write_text(&tail).await;
            }
            tracing::debug!("[chat_runner] stdout forwarder ended");
        });

        let stderr_store = msg_store.clone();
        let stderr_log = raw_log_spool.clone();
        let stderr = tokio::spawn(async move {
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
                            let mut spool = stderr_log.lock().await;
                            let _ = spool.write_text(&text).await;
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
                let mut spool = stderr_log.lock().await;
                let _ = spool.write_text(&tail).await;
            }
            tracing::debug!("[chat_runner] stderr forwarder ended");
        });

        RunLogForwarders { stdout, stderr }
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
        assistant_update_count: &mut u64,
        last_token_usage: &mut Option<TokenUsageInfo>,
        error_content: &mut String,
        error_update_count: &mut u64,
        error_type: &mut Option<NormalizedEntryError>,
    ) {
        if let Some(update) = Self::apply_stream_patch_to_state(
            &patch,
            last_content,
            latest_assistant,
            assistant_update_count,
            last_token_usage,
            error_content,
            error_update_count,
            error_type,
        ) {
            let _ = sender.send(ChatStreamEvent::AgentDelta {
                session_id,
                session_agent_id,
                agent_id,
                run_id,
                stream_type: update.stream_type,
                content: update.content,
                delta: update.delta,
                is_final: false,
            });
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_stream_patch_to_state(
        patch: &json_patch::Patch,
        last_content: &mut HashMap<usize, String>,
        latest_assistant: &mut String,
        assistant_update_count: &mut u64,
        last_token_usage: &mut Option<TokenUsageInfo>,
        error_content: &mut String,
        error_update_count: &mut u64,
        error_type: &mut Option<NormalizedEntryError>,
    ) -> Option<StreamPatchDelta> {
        let (index, entry) = extract_normalized_entry_from_patch(patch)?;
        let stream_type = match &entry.entry_type {
            NormalizedEntryType::AssistantMessage => Some(ChatStreamDeltaType::Assistant),
            NormalizedEntryType::Thinking => Some(ChatStreamDeltaType::Thinking),
            NormalizedEntryType::ErrorMessage { error_type: et } => {
                if error_type.is_none()
                    || !matches!(et, NormalizedEntryError::Other)
                        && matches!(error_type, Some(NormalizedEntryError::Other))
                {
                    *error_type = Some(et.clone());
                }
                Some(ChatStreamDeltaType::Error)
            }
            NormalizedEntryType::TokenUsageInfo(usage) => {
                *last_token_usage = Some(usage.clone());
                None
            }
            _ => None,
        }?;

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
            if current != previous {
                *assistant_update_count = assistant_update_count.saturating_add(1);
            }
        }
        if matches!(stream_type, ChatStreamDeltaType::Error) {
            if !error_content.is_empty() {
                error_content.push('\n');
            }
            error_content.push_str(&current);
            if current != previous {
                *error_update_count = error_update_count.saturating_add(1);
            }
        }

        if delta.is_empty() {
            return None;
        }

        Some(StreamPatchDelta {
            stream_type,
            content: delta,
            delta: is_delta,
        })
    }

    fn rebuild_run_stream_state_from_history(history: &[LogMsg]) -> RunStreamStateSnapshot {
        let mut snapshot = RunStreamStateSnapshot::default();
        let mut last_content = HashMap::new();
        let mut stdout_line_buffer = String::new();

        for item in history {
            match item {
                LogMsg::SessionId(value) => {
                    snapshot.agent_session_id = Some(value.clone());
                }
                LogMsg::MessageId(value) => {
                    snapshot.agent_message_id = Some(value.clone());
                }
                LogMsg::Stdout(chunk) => {
                    Self::update_token_usage_from_stdout_chunk(
                        &mut stdout_line_buffer,
                        &mut snapshot.last_token_usage,
                        chunk,
                    );
                }
                LogMsg::JsonPatch(patch) => {
                    let _ = Self::apply_stream_patch_to_state(
                        patch,
                        &mut last_content,
                        &mut snapshot.latest_assistant,
                        &mut snapshot.assistant_update_count,
                        &mut snapshot.last_token_usage,
                        &mut snapshot.error_content,
                        &mut snapshot.error_update_count,
                        &mut snapshot.error_type,
                    );
                }
                _ => {}
            }
        }

        Self::flush_token_usage_buffer(&mut stdout_line_buffer, &mut snapshot.last_token_usage);
        snapshot
    }

    fn reconcile_run_stream_state_from_history(
        state: &mut RunStreamStateSnapshot,
        history: &[LogMsg],
    ) {
        let rebuilt = Self::rebuild_run_stream_state_from_history(history);

        if rebuilt.agent_session_id.is_some() {
            state.agent_session_id = rebuilt.agent_session_id;
        }
        if rebuilt.agent_message_id.is_some() {
            state.agent_message_id = rebuilt.agent_message_id;
        }
        if rebuilt.assistant_update_count > state.assistant_update_count
            || (state.latest_assistant.is_empty() && !rebuilt.latest_assistant.is_empty())
        {
            state.latest_assistant = rebuilt.latest_assistant;
            state.assistant_update_count = rebuilt.assistant_update_count;
        }
        if rebuilt.last_token_usage.is_some() {
            state.last_token_usage = rebuilt.last_token_usage;
        }
        if rebuilt.error_update_count > state.error_update_count
            || (state.error_content.is_empty() && !rebuilt.error_content.is_empty())
        {
            state.error_content = rebuilt.error_content;
            state.error_update_count = rebuilt.error_update_count;
        }
        if rebuilt.error_type.is_some() {
            state.error_type = rebuilt.error_type;
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn collect_run_artifact_paths(
        session_id: Uuid,
        run_id: Uuid,
        workspace_path: &Path,
    ) -> Vec<String> {
        let content = match fs::read_to_string(Self::session_work_records_path(session_id)).await {
            Ok(content) => content,
            Err(_) => return Vec::new(),
        };

        let mut paths = BTreeMap::<String, ()>::new();
        for line in content.lines() {
            let Ok(entry) = serde_json::from_str::<StoredWorkRecordEntry>(line) else {
                continue;
            };
            if entry.run_id != run_id || !entry.message_type.eq_ignore_ascii_case("artifact") {
                continue;
            }

            for path in extract_workspace_paths_from_text(&entry.content, workspace_path) {
                paths.insert(path, ());
            }
        }

        paths.into_keys().collect()
    }

    fn observed_file_metadata(
        workspace_path: &Path,
        relative_path: &str,
    ) -> (bool, Option<String>) {
        let absolute_path = workspace_path.join(relative_path);
        let Ok(metadata) = std::fs::metadata(&absolute_path) else {
            return (false, None);
        };
        if !metadata.is_file() {
            return (false, None);
        }

        let modified_at = metadata
            .modified()
            .ok()
            .map(chrono::DateTime::<Utc>::from)
            .map(|value| value.to_rfc3339());
        (true, modified_at)
    }

    fn upsert_workspace_observed_path(
        observed: &mut BTreeMap<String, WorkspaceObservedPathEntry>,
        workspace_path: &Path,
        relative_path: String,
        source: &str,
    ) {
        let (existed_after_run, modified_at) =
            Self::observed_file_metadata(workspace_path, &relative_path);

        let entry =
            observed
                .entry(relative_path.clone())
                .or_insert_with(|| WorkspaceObservedPathEntry {
                    path: relative_path.clone(),
                    source: source.to_string(),
                    existed_after_run,
                    modified_at: modified_at.clone(),
                });

        if !entry
            .source
            .split(',')
            .any(|existing| existing.trim() == source)
        {
            entry.source.push(',');
            entry.source.push_str(source);
        }

        entry.existed_after_run |= existed_after_run;
        if entry.modified_at.is_none() {
            entry.modified_at = modified_at;
        }
    }

    async fn collect_workspace_observed_paths(
        session_id: Uuid,
        run_id: Uuid,
        workspace_path: &Path,
        latest_assistant: &str,
        diff_info: Option<&DiffInfo>,
        untracked_paths: &[String],
    ) -> Vec<WorkspaceObservedPathEntry> {
        let artifact_paths =
            Self::collect_run_artifact_paths(session_id, run_id, workspace_path).await;
        let output_paths = extract_workspace_paths_from_text(latest_assistant, workspace_path);
        let mut observed = BTreeMap::<String, WorkspaceObservedPathEntry>::new();

        if let Some(diff_info) = diff_info {
            for path in &diff_info.observed_paths {
                Self::upsert_workspace_observed_path(
                    &mut observed,
                    workspace_path,
                    path.clone(),
                    "git_diff",
                );
            }
        }

        for path in untracked_paths {
            Self::upsert_workspace_observed_path(
                &mut observed,
                workspace_path,
                path.clone(),
                "git_untracked",
            );
        }

        for path in artifact_paths {
            Self::upsert_workspace_observed_path(
                &mut observed,
                workspace_path,
                path,
                "artifact_record",
            );
        }

        for path in output_paths {
            Self::upsert_workspace_observed_path(
                &mut observed,
                workspace_path,
                path,
                "output_text",
            );
        }

        observed.into_values().collect()
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn spawn_stream_bridge(
        &self,
        msg_store: Arc<MsgStore>,
        session_id: Uuid,
        agent_id: Uuid,
        session_agent_id: Uuid,
        run_index: i64,
        run_id: Uuid,
        output_path: PathBuf,
        meta_path: PathBuf,
        workspace_path: PathBuf,
        run_dir: PathBuf,
        tail_log_path: PathBuf,
        raw_log_spool: Arc<Mutex<RunLogSpool>>,
        completion_status: Arc<AtomicU8>,
        tracked_diff_baseline: Option<String>,
        chain_depth: u32,
        context_compacted: bool,
        compression_warning: Option<chat::CompressionWarning>,
        runner: ChatRunner,
        source_message_id: Uuid,
        source_message_created_at: chrono::DateTime<Utc>,
        source_message_content: String,
        agent_name: String,
        prompt_language: ResolvedPromptLanguage,
        run_started_at: chrono::DateTime<Utc>,
        protocol_retry_attempt: u32,
        track_source_message: bool,
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
            let mut assistant_update_count = 0_u64;
            let mut agent_session_id: Option<String> = None;
            let mut agent_message_id: Option<String> = None;
            let mut last_token_usage: Option<TokenUsageInfo> = None;
            let mut stdout_line_buffer = String::new();
            let mut error_content = String::new();
            let mut error_update_count = 0_u64;
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
                            &mut assistant_update_count,
                            &mut last_token_usage,
                            &mut error_content,
                            &mut error_update_count,
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
                                        &mut assistant_update_count,
                                        &mut last_token_usage,
                                        &mut error_content,
                                        &mut error_update_count,
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

                        let mut reconciled_state = RunStreamStateSnapshot {
                            agent_session_id: agent_session_id.clone(),
                            agent_message_id: agent_message_id.clone(),
                            latest_assistant: latest_assistant.clone(),
                            assistant_update_count,
                            last_token_usage: last_token_usage.clone(),
                            error_content: error_content.clone(),
                            error_update_count,
                            error_type: error_type.clone(),
                        };
                        Self::reconcile_run_stream_state_from_history(
                            &mut reconciled_state,
                            &msg_store.get_history(),
                        );
                        agent_session_id = reconciled_state.agent_session_id;
                        agent_message_id = reconciled_state.agent_message_id;
                        latest_assistant = reconciled_state.latest_assistant;
                        last_token_usage = reconciled_state.last_token_usage;
                        error_content = reconciled_state.error_content;
                        error_type = reconciled_state.error_type;

                        let _ = fs::write(&output_path, &latest_assistant).await;

                        let diff_info = ChatRunner::capture_git_diff(
                            &workspace_path,
                            &run_dir,
                            session_agent_id,
                            run_index,
                            tracked_diff_baseline.as_deref(),
                        )
                        .await;
                        let untracked_files = ChatRunner::capture_untracked_files(
                            &workspace_path,
                            &run_dir,
                            session_agent_id,
                            run_index,
                        )
                        .await;
                        let workspace_observed_paths =
                            ChatRunner::collect_workspace_observed_paths(
                                session_id,
                                run_id,
                                &workspace_path,
                                &latest_assistant,
                                diff_info.as_ref(),
                                &untracked_files,
                            )
                            .await;
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

                        let finished_at = Utc::now();
                        let duration_ms = (finished_at - run_started_at).num_milliseconds().max(0);

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

                        let tail_limit = if matches!(completion_status, RunCompletionStatus::Failed)
                        {
                            PERSISTED_LOG_TAIL_BYTES_FAILURE
                        } else {
                            PERSISTED_LOG_TAIL_BYTES_SUCCESS
                        };
                        let spool_persist = {
                            let mut spool = raw_log_spool.lock().await;
                            spool.persist_tail_to(&tail_log_path, tail_limit).await
                        };
                        if let Some(ref err) = spool_persist.persist_error {
                            tracing::warn!(
                                session_id = %session_id,
                                run_id = %run_id,
                                error = %err,
                                fallback_log_path = %spool_persist.log_path.display(),
                                "failed to persist raw tail log; keeping live spool path"
                            );
                        }
                        let spool_snapshot = spool_persist.snapshot.clone();
                        let final_log_state = spool_persist.log_state.clone();
                        let final_log_path = spool_persist.log_path.clone();

                        let mut meta = serde_json::json!({
                            "run_id": run_id,
                            "session_id": session_id,
                            "session_agent_id": session_agent_id,
                            "agent_id": agent_id,
                            "agent_session_id": agent_session_id,
                            "agent_message_id": agent_message_id,
                            "finished_at": finished_at.to_rfc3339(),
                            "chain_depth": chain_depth + 1,
                            "log_state": final_log_state,
                            "log_bytes_total": spool_snapshot.total_bytes,
                            "log_bytes_persisted": spool_snapshot.persisted_bytes,
                            "live_bytes_dropped": spool_snapshot.dropped_bytes,
                            "log_truncated": spool_snapshot.log_truncated,
                            "log_capture_degraded": spool_snapshot.log_capture_degraded,
                        });

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
                        if let Some(ref err) = spool_persist.persist_error {
                            meta["log_persist_error"] = serde_json::json!(err);
                        }
                        meta["workspace_observed_paths"] =
                            serde_json::to_value(&workspace_observed_paths)
                                .unwrap_or(serde_json::Value::Array(Vec::new()));

                        let _ = fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap())
                            .await;

                        let error_summary = if error_content.is_empty() {
                            None
                        } else {
                            Some(error_content.chars().take(200).collect::<String>())
                        };
                        let retention_summary = ChatRunRetentionSummary {
                            kind: Some(if error_summary.is_some() {
                                "failure_stub".to_string()
                            } else {
                                "success_stub".to_string()
                            }),
                            finished_at: Some(finished_at.to_rfc3339()),
                            error_summary,
                            error_type: error_type
                                .as_ref()
                                .map(|entry| Self::normalized_entry_error_name(Some(entry))),
                            assistant_excerpt: if latest_assistant.is_empty() {
                                None
                            } else {
                                Some(latest_assistant.chars().take(2048).collect())
                            },
                            total_tokens: Some(token_usage.total_tokens),
                            log_bytes_total: Some(spool_snapshot.total_bytes),
                            log_bytes_persisted: Some(spool_snapshot.persisted_bytes),
                            live_bytes_dropped: Some(spool_snapshot.dropped_bytes),
                            log_truncated: Some(spool_snapshot.log_truncated),
                            log_capture_degraded: Some(spool_snapshot.log_capture_degraded),
                            pruned_at: None,
                            prune_reason: None,
                        };
                        let retention_summary_json = serde_json::to_string(&retention_summary).ok();
                        let _ = ChatRun::update_after_run_completion(
                            &db.pool,
                            run_id,
                            Some(final_log_path.to_string_lossy().to_string()),
                            final_log_state,
                            spool_snapshot.log_truncated,
                            spool_snapshot.log_capture_degraded,
                            retention_summary_json,
                        )
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
                                protocol_retry_attempt,
                            )
                            .await;

                        let messages_created = match process_result {
                            Ok(ProtocolProcessResult::Success(count)) => count,
                            Ok(ProtocolProcessResult::RetryableParseFailure { code, detail }) => {
                                tracing::warn!(
                                    session_id = %session_id,
                                    run_id = %run_id,
                                    agent_id = %agent_id,
                                    agent_name = %agent_name,
                                    code = ?code,
                                    detail = ?detail,
                                    protocol_retry_attempt,
                                    "protocol parse failure is retryable; retrying without persisting retry feedback"
                                );

                                let error_desc = detail.as_deref().unwrap_or("Invalid JSON output");
                                let retry_content = format!(
                                    "Your previous response was not a valid JSON array.\n\
                                     Error: {error_desc}\n\n\
                                     Retry the same input message below and respond with ONLY a JSON array matching the protocol format.\n\n\
                                     Previous input message:\n\
                                     <BEGIN_INPUT_MESSAGE>\n\
                                     {source_message_content}\n\
                                     <END_INPUT_MESSAGE>"
                                );
                                let retry_meta = sqlx::types::Json(serde_json::json!({
                                    "protocol_retry": {
                                        "attempt": protocol_retry_attempt + 1,
                                        "previous_run_id": run_id,
                                        "error_code": format!("{:?}", code),
                                    },
                                    "chain_depth": chain_depth,
                                    "mentions": [agent_name],
                                }));
                                let retry_message = ChatMessage {
                                    id: Uuid::new_v4(),
                                    session_id,
                                    sender_type: ChatSenderType::System,
                                    sender_id: None,
                                    content: retry_content,
                                    mentions: sqlx::types::Json(vec![agent_name.clone()]),
                                    meta: retry_meta,
                                    created_at: source_message_created_at,
                                };

                                let retry_runner = runner.clone();
                                let retry_agent_name = agent_name.clone();
                                tokio::spawn(async move {
                                    if let Err(err) = retry_runner
                                        .run_agent_for_mention_internal(
                                            session_id,
                                            &retry_agent_name,
                                            &retry_message,
                                            false,
                                        )
                                        .await
                                    {
                                        tracing::warn!(
                                            session_id = %session_id,
                                            agent_name = %retry_agent_name,
                                            error = %err,
                                            "protocol retry run failed to dispatch"
                                        );
                                    }
                                });
                                0
                            }
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

                        runner
                            .analytics_projector()
                            .project_or_warn(DomainEvent::AgentRunCompleted {
                                session_id,
                                agent_id,
                                run_id,
                                duration_ms,
                                success: matches!(
                                    completion_status,
                                    RunCompletionStatus::Succeeded
                                ),
                            })
                            .await;

                        if matches!(completion_status, RunCompletionStatus::Failed) {
                            let error_message = if error_content.trim().is_empty() {
                                "Agent run failed".to_string()
                            } else {
                                error_content.clone()
                            };
                            runner
                                .analytics_projector()
                                .project_or_warn(DomainEvent::AgentRunErrored {
                                    session_id,
                                    agent_id,
                                    run_id,
                                    error_type: Self::normalized_entry_error_name(
                                        error_type.as_ref(),
                                    ),
                                    error_message,
                                })
                                .await;
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

                        if track_source_message {
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
                                    statuses
                                        .insert(agent_name.clone(), serde_json::json!(status_str));
                                } else {
                                    let mut new_statuses = serde_json::Map::new();
                                    new_statuses
                                        .insert(agent_name.clone(), serde_json::json!(status_str));
                                    meta["mention_statuses"] =
                                        serde_json::Value::Object(new_statuses);
                                }

                                let _ = ChatMessage::update_meta(&db.pool, source_message_id, meta)
                                    .await;
                            }
                        }

                        if let Err(err) = runner
                            .run_retention_janitor_for_workspace(&workspace_path)
                            .await
                        {
                            tracing::warn!(
                                session_id = %session_id,
                                run_id = %run_id,
                                workspace_path = %workspace_path.display(),
                                error = %err,
                                "workspace retention janitor failed"
                            );
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
            Self::watch_executor_lifecycle_with_timeout(
                args.child,
                args.stop,
                args.executor_cancel,
                args.exit_signal,
                args.msg_store,
                args.completion_status,
                args.log_forwarders,
                session_agent_id,
                EXECUTOR_GRACEFUL_STOP_TIMEOUT,
            )
            .await;
            run_controls.remove(&session_agent_id);
        });
    }

    async fn wait_for_log_forwarders(log_forwarders: RunLogForwarders, msg_store: &MsgStore) {
        if let Err(err) = log_forwarders.stdout.await {
            msg_store.push(LogMsg::Stderr(format!(
                "stdout forwarder join error: {err}"
            )));
        }

        if let Err(err) = log_forwarders.stderr.await {
            msg_store.push(LogMsg::Stderr(format!(
                "stderr forwarder join error: {err}"
            )));
        }
    }

    fn janitor_lock_for_workspace(&self, workspace_key: &str) -> Arc<Mutex<()>> {
        self.workspace_janitor_locks
            .entry(workspace_key.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    fn run_belongs_to_workspace(run: &ChatRun, workspace_path: &Path) -> bool {
        Path::new(&run.run_dir).starts_with(workspace_path)
    }

    async fn file_size_if_exists(path: &Path) -> u64 {
        match fs::metadata(path).await {
            Ok(metadata) => metadata.len(),
            Err(_) => 0,
        }
    }

    async fn dir_size(path: &Path) -> u64 {
        let mut total = 0_u64;
        let mut stack = vec![path.to_path_buf()];

        while let Some(current) = stack.pop() {
            let Ok(mut entries) = fs::read_dir(&current).await else {
                continue;
            };

            while let Ok(Some(entry)) = entries.next_entry().await {
                let Ok(metadata) = entry.metadata().await else {
                    continue;
                };

                if metadata.is_dir() {
                    stack.push(entry.path());
                } else {
                    total = total.saturating_add(metadata.len());
                }
            }
        }

        total
    }

    fn parse_retention_summary(run: &ChatRun) -> Option<ChatRunRetentionSummary> {
        run.retention_summary_json
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok())
    }

    async fn build_retention_summary_from_run(
        run: &ChatRun,
    ) -> Result<ChatRunRetentionSummary, ChatRunnerError> {
        if let Some(summary) = Self::parse_retention_summary(run) {
            return Ok(summary);
        }

        let meta_value = if let Some(meta_path) = run.meta_path.as_deref() {
            match fs::read_to_string(meta_path).await {
                Ok(content) => serde_json::from_str::<serde_json::Value>(&content).ok(),
                Err(_) => None,
            }
        } else {
            None
        };

        let output_content = if let Some(output_path) = run.output_path.as_deref() {
            fs::read_to_string(output_path).await.ok()
        } else {
            None
        };

        let error_summary = meta_value
            .as_ref()
            .and_then(|meta| meta.get("error"))
            .and_then(|error| error.get("summary"))
            .and_then(|value| value.as_str())
            .map(str::to_string);
        let error_type = meta_value
            .as_ref()
            .and_then(|meta| meta.get("error"))
            .and_then(|error| error.get("error_type"))
            .and_then(|value| {
                value
                    .get("type")
                    .and_then(|inner| inner.as_str())
                    .or_else(|| value.as_str())
            })
            .map(str::to_string);
        let total_tokens = meta_value
            .as_ref()
            .and_then(|meta| meta.get("token_usage"))
            .and_then(|token_usage| token_usage.get("total_tokens"))
            .and_then(|value| value.as_u64())
            .and_then(|value| u32::try_from(value).ok());
        let finished_at = meta_value
            .as_ref()
            .and_then(|meta| meta.get("finished_at"))
            .and_then(|value| value.as_str())
            .map(str::to_string);
        let log_bytes_total = meta_value
            .as_ref()
            .and_then(|meta| meta.get("log_bytes_total"))
            .and_then(|value| value.as_u64());
        let log_bytes_persisted = meta_value
            .as_ref()
            .and_then(|meta| meta.get("log_bytes_persisted"))
            .and_then(|value| value.as_u64());
        let live_bytes_dropped = meta_value
            .as_ref()
            .and_then(|meta| meta.get("live_bytes_dropped"))
            .and_then(|value| value.as_u64());
        let log_truncated = meta_value
            .as_ref()
            .and_then(|meta| meta.get("log_truncated"))
            .and_then(|value| value.as_bool())
            .or(Some(run.log_truncated));
        let log_capture_degraded = meta_value
            .as_ref()
            .and_then(|meta| meta.get("log_capture_degraded"))
            .and_then(|value| value.as_bool())
            .or(Some(run.log_capture_degraded));

        Ok(ChatRunRetentionSummary {
            kind: Some(if error_summary.is_some() {
                "failure_stub".to_string()
            } else {
                "success_stub".to_string()
            }),
            finished_at,
            error_summary,
            error_type,
            assistant_excerpt: output_content.map(|content| content.chars().take(2048).collect()),
            total_tokens,
            log_bytes_total,
            log_bytes_persisted,
            live_bytes_dropped,
            log_truncated,
            log_capture_degraded,
            pruned_at: run.pruned_at.map(|value| value.to_rfc3339()),
            prune_reason: run.prune_reason.clone(),
        })
    }

    fn summary_indicates_failure(summary: &ChatRunRetentionSummary) -> bool {
        matches!(summary.kind.as_deref(), Some("failure_stub")) || summary.error_summary.is_some()
    }

    async fn stub_run_artifacts(
        &self,
        run: &ChatRun,
        prune_reason: &str,
        pruned_at: chrono::DateTime<Utc>,
    ) -> Result<u64, ChatRunnerError> {
        let mut reclaimed = 0_u64;
        let mut summary = Self::build_retention_summary_from_run(run).await?;
        summary.pruned_at = Some(pruned_at.to_rfc3339());
        summary.prune_reason = Some(prune_reason.to_string());
        let retention_summary_json = Some(serde_json::to_string(&summary)?);

        for path in [
            run.input_path.as_deref(),
            run.output_path.as_deref(),
            run.meta_path.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            let file_path = Path::new(path);
            reclaimed = reclaimed.saturating_add(Self::file_size_if_exists(file_path).await);
            let _ = fs::remove_file(file_path).await;
        }

        ChatRun::mark_artifact_stubbed(
            &self.db.pool,
            run.id,
            db::models::chat_run::MarkArtifactStubbedUpdate {
                input_path: None,
                output_path: None,
                meta_path: None,
                pruned_at,
                prune_reason: Some(prune_reason.to_string()),
                retention_summary_json,
            },
        )
        .await?;

        Ok(reclaimed)
    }

    async fn cleanup_workspace_orphan_live_spools(
        &self,
        workspace_path: &Path,
    ) -> Result<(), ChatRunnerError> {
        let spool_dir = Self::workspace_live_spool_dir(workspace_path);
        if fs::metadata(&spool_dir).await.is_err() {
            return Ok(());
        }

        let mut entries = match fs::read_dir(&spool_dir).await {
            Ok(entries) => entries,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(err) => return Err(err.into()),
        };

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let Ok(metadata) = entry.metadata().await else {
                continue;
            };

            if metadata.is_dir() {
                let _ = fs::remove_dir_all(&path).await;
            } else {
                let _ = fs::remove_file(&path).await;
            }
        }

        Ok(())
    }

    pub async fn run_startup_retention_janitor(&self) -> Result<(), ChatRunnerError> {
        let runs = ChatRun::list_all(&self.db.pool).await?;
        let mut workspaces = HashSet::new();
        for run in runs {
            if let Some(path) = Path::new(&run.run_dir).ancestors().nth(5) {
                workspaces.insert(path.to_path_buf());
            }
        }

        tracing::debug!(
            workspace_count = workspaces.len(),
            "Running startup retention janitor for workspaces with existing runs"
        );

        for workspace in workspaces {
            self.cleanup_workspace_orphan_live_spools(&workspace)
                .await?;
            self.run_retention_janitor_for_workspace(&workspace).await?;
        }

        Ok(())
    }

    pub async fn run_retention_janitor_for_workspace(
        &self,
        workspace_path: &Path,
    ) -> Result<(), ChatRunnerError> {
        let workspace_key = workspace_path.to_string_lossy().to_string();
        let lock = self.janitor_lock_for_workspace(&workspace_key);
        let _guard = lock.lock().await;

        let all_runs = ChatRun::list_all(&self.db.pool).await?;
        let mut runs: Vec<ChatRun> = all_runs
            .into_iter()
            .filter(|run| Self::run_belongs_to_workspace(run, workspace_path))
            .collect();

        if runs.is_empty() {
            return Ok(());
        }

        let mut unique_dirs = HashSet::new();
        let mut total_size = 0_u64;
        for run in &runs {
            if unique_dirs.insert(run.run_dir.clone()) {
                total_size =
                    total_size.saturating_add(Self::dir_size(Path::new(&run.run_dir)).await);
            }
        }

        if total_size <= RUNS_MAX_TOTAL_BYTES_PER_WORKSPACE {
            return Ok(());
        }

        tracing::debug!(
            workspace_path = %workspace_path.display(),
            total_size_bytes = total_size,
            "Calculated total size of runs for workspace"
        );

        runs.sort_by_key(|run| run.created_at);
        let pruned_at = Utc::now();
        let prune_reason = "workspace_budget";

        for run in &runs {
            if total_size <= RUNS_PRUNE_TARGET_BYTES_PER_WORKSPACE {
                break;
            }
            if run.log_state == ChatRunLogState::Live {
                continue;
            }
            let Some(raw_log_path) = run.raw_log_path.as_deref() else {
                continue;
            };

            let raw_log_file = Path::new(raw_log_path);
            let reclaimed = Self::file_size_if_exists(raw_log_file).await;
            let _ = fs::remove_file(raw_log_file).await;

            let mut summary = Self::build_retention_summary_from_run(run).await?;
            summary.pruned_at = Some(pruned_at.to_rfc3339());
            summary.prune_reason = Some(prune_reason.to_string());
            ChatRun::mark_log_pruned(
                &self.db.pool,
                run.id,
                pruned_at,
                Some(prune_reason.to_string()),
                Some(serde_json::to_string(&summary)?),
            )
            .await?;
            total_size = total_size.saturating_sub(reclaimed);
        }

        for run in &runs {
            if total_size <= RUNS_PRUNE_TARGET_BYTES_PER_WORKSPACE {
                break;
            }
            if run.log_state == ChatRunLogState::Live {
                continue;
            }
            if run.artifact_state != ChatRunArtifactState::Full {
                continue;
            }

            let summary = Self::build_retention_summary_from_run(run).await?;
            if Self::summary_indicates_failure(&summary) {
                continue;
            }

            total_size = total_size.saturating_sub(
                self.stub_run_artifacts(run, prune_reason, pruned_at)
                    .await?,
            );
        }

        for run in &runs {
            if total_size <= RUNS_PRUNE_TARGET_BYTES_PER_WORKSPACE {
                break;
            }
            if run.log_state == ChatRunLogState::Live {
                continue;
            }
            if run.artifact_state != ChatRunArtifactState::Full {
                continue;
            }

            let summary = Self::build_retention_summary_from_run(run).await?;
            if !Self::summary_indicates_failure(&summary) {
                continue;
            }

            total_size = total_size.saturating_sub(
                self.stub_run_artifacts(run, prune_reason, pruned_at)
                    .await?,
            );
        }

        for run in &runs {
            if total_size <= RUNS_PRUNE_TARGET_BYTES_PER_WORKSPACE {
                break;
            }
            if run.log_state == ChatRunLogState::Live {
                continue;
            }

            let run_dir = Path::new(&run.run_dir);
            let reclaimed = Self::dir_size(run_dir).await;
            if reclaimed == 0 {
                continue;
            }

            let _ = fs::remove_dir_all(run_dir).await;
            let mut summary = Self::build_retention_summary_from_run(run).await?;
            summary.pruned_at = Some(pruned_at.to_rfc3339());
            summary.prune_reason = Some(prune_reason.to_string());
            ChatRun::mark_run_dir_pruned(
                &self.db.pool,
                run.id,
                pruned_at,
                Some(prune_reason.to_string()),
                Some(serde_json::to_string(&summary)?),
            )
            .await?;
            total_size = total_size.saturating_sub(reclaimed);
        }

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn watch_executor_lifecycle_with_timeout(
        mut child: command_group::AsyncGroupChild,
        stop: CancellationToken,
        executor_cancel: Option<CancellationToken>,
        mut exit_signal: Option<ExecutorExitSignal>,
        msg_store: Arc<MsgStore>,
        completion_status: Arc<AtomicU8>,
        log_forwarders: RunLogForwarders,
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
        Self::wait_for_log_forwarders(log_forwarders, &msg_store).await;
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

#[cfg(test)]
mod tests {
    use dashmap::DashMap;
    use executors::logs::{
        NormalizedEntry, NormalizedEntryError, NormalizedEntryType, utils::patch::ConversationPatch,
    };
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn persist_tail_keeps_tail_result_when_cleanup_fails() {
        let temp = tempdir().expect("tempdir");
        let live_path = temp.path().join("live.log");
        let tail_path = temp.path().join("run").join("raw.tail.log");
        let db_pool = sqlx::SqlitePool::connect("sqlite::memory:")
            .await
            .expect("sqlite pool");
        let mut spool = RunLogSpool::new(
            live_path,
            Uuid::new_v4(),
            db_pool,
            "workspace".to_string(),
            Arc::new(DashMap::new()),
        )
        .await
        .expect("spool");

        spool.write_text("hello tail").await.expect("write");

        let cleanup_failure_path = temp.path().join("cleanup-blocker");
        fs::create_dir_all(&cleanup_failure_path)
            .await
            .expect("cleanup blocker dir");
        spool.path = cleanup_failure_path;

        let persisted = spool.persist_tail_to(&tail_path, 1024).await;

        assert_eq!(persisted.log_state, ChatRunLogState::Tail);
        assert_eq!(persisted.log_path, tail_path);
        assert!(persisted.persist_error.is_none());
        assert_eq!(
            fs::read_to_string(&persisted.log_path)
                .await
                .expect("tail file"),
            "hello tail"
        );
    }

    #[tokio::test]
    async fn persist_tail_drops_partial_leading_line_and_adds_notice() {
        let temp = tempdir().expect("tempdir");
        let live_path = temp.path().join("live.log");
        let tail_path = temp.path().join("run").join("raw.tail.log");
        let db_pool = sqlx::SqlitePool::connect("sqlite::memory:")
            .await
            .expect("sqlite pool");
        let mut spool = RunLogSpool::new(
            live_path,
            Uuid::new_v4(),
            db_pool,
            "workspace".to_string(),
            Arc::new(DashMap::new()),
        )
        .await
        .expect("spool");

        spool
            .write_text("very-long-leading-line-without-boundary\nkept line 1\nkept line 2\n")
            .await
            .expect("write");

        let persisted = spool.persist_tail_to(&tail_path, 20).await;
        let content = fs::read_to_string(&persisted.log_path)
            .await
            .expect("tail file");

        assert_eq!(persisted.log_state, ChatRunLogState::Tail);
        assert_eq!(content, format!("{TAIL_PARTIAL_LINE_NOTICE}kept line 2\n"));
    }

    #[test]
    fn reconcile_run_stream_state_from_history_recovers_shorter_final_output() {
        let history = vec![
            LogMsg::JsonPatch(ConversationPatch::add_normalized_entry(
                0,
                NormalizedEntry {
                    timestamp: None,
                    entry_type: NormalizedEntryType::AssistantMessage,
                    content: "this is a long intermediate assistant output".to_string(),
                    metadata: None,
                },
            )),
            LogMsg::JsonPatch(ConversationPatch::replace(
                0,
                NormalizedEntry {
                    timestamp: None,
                    entry_type: NormalizedEntryType::AssistantMessage,
                    content: r#"[{"type":"send","to":"user","content":"done"}]"#.to_string(),
                    metadata: None,
                },
            )),
        ];

        let mut state = RunStreamStateSnapshot {
            latest_assistant: "this is a long intermediate assistant output".to_string(),
            assistant_update_count: 1,
            ..RunStreamStateSnapshot::default()
        };

        ChatRunner::reconcile_run_stream_state_from_history(&mut state, &history);

        assert_eq!(
            state.latest_assistant,
            r#"[{"type":"send","to":"user","content":"done"}]"#
        );
        assert_eq!(state.assistant_update_count, 2);
    }

    #[test]
    fn reconcile_run_stream_state_from_history_keeps_live_output_when_history_is_stale() {
        let history = vec![LogMsg::JsonPatch(ConversationPatch::add_normalized_entry(
            0,
            NormalizedEntry {
                timestamp: None,
                entry_type: NormalizedEntryType::AssistantMessage,
                content: "older output".to_string(),
                metadata: None,
            },
        ))];

        let mut state = RunStreamStateSnapshot {
            latest_assistant: "newer output".to_string(),
            assistant_update_count: 2,
            error_content: "newer error".to_string(),
            error_update_count: 2,
            error_type: Some(NormalizedEntryError::Other),
            ..RunStreamStateSnapshot::default()
        };

        ChatRunner::reconcile_run_stream_state_from_history(&mut state, &history);

        assert_eq!(state.latest_assistant, "newer output");
        assert_eq!(state.assistant_update_count, 2);
        assert_eq!(state.error_content, "newer error");
        assert_eq!(state.error_update_count, 2);
    }
}
