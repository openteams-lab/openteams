#[derive(Clone)]
struct RunLifecycleControl {
    run_id: Uuid,
    stop: CancellationToken,
}

enum LifecycleEvent {
    ProcessExited(std::io::Result<std::process::ExitStatus>),
    ExitSignal(executors::executors::ExecutorExitResult),
    StopRequested,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RunCompletionStatus {
    Succeeded,
    Failed,
    Stopped,
}

impl RunCompletionStatus {
    fn as_u8(self) -> u8 {
        match self {
            Self::Succeeded => 0,
            Self::Failed => 1,
            Self::Stopped => 2,
        }
    }

    fn from_atomic(value: &AtomicU8) -> Self {
        match value.load(Ordering::Relaxed) {
            1 => Self::Failed,
            2 => Self::Stopped,
            _ => Self::Succeeded,
        }
    }

    fn store(self, value: &AtomicU8) {
        value.store(self.as_u8(), Ordering::Relaxed);
    }
}

#[derive(Clone)]
pub struct ChatRunner {
    db: DBService,
    analytics: Option<AnalyticsService>,
    analytics_enabled: Arc<AtomicBool>,
    streams: Arc<DashMap<Uuid, broadcast::Sender<ChatStreamEvent>>>,
    // Store per-run lifecycle controls, key = session_agent_id
    run_controls: Arc<DashMap<Uuid, RunLifecycleControl>>,
    // Session-level background context compaction dedupe.
    // At most one compaction task per session is allowed at a time.
    background_compaction_inflight: Arc<DashMap<Uuid, ()>>,
    workspace_live_log_bytes: Arc<DashMap<String, u64>>,
    workspace_janitor_locks: Arc<DashMap<String, Arc<Mutex<()>>>>,
}

impl ChatRunner {
    pub fn new(db: DBService) -> Self {
        Self::with_analytics(db, None, Arc::new(AtomicBool::new(true)))
    }

    pub fn with_analytics(
        db: DBService,
        analytics: Option<AnalyticsService>,
        analytics_enabled: Arc<AtomicBool>,
    ) -> Self {
        Self {
            db,
            analytics,
            analytics_enabled,
            streams: Arc::new(DashMap::new()),
            run_controls: Arc::new(DashMap::new()),
            background_compaction_inflight: Arc::new(DashMap::new()),
            workspace_live_log_bytes: Arc::new(DashMap::new()),
            workspace_janitor_locks: Arc::new(DashMap::new()),
        }
    }

    pub fn analytics_service(&self) -> Option<&AnalyticsService> {
        workflow_analytics::analytics_if_enabled(
            self.analytics.as_ref(),
            self.analytics_enabled.load(Ordering::Relaxed),
        )
    }

    fn analytics_projector(&self) -> AnalyticsProjector<'_> {
        AnalyticsProjector::new(
            &self.db.pool,
            self.analytics.as_ref(),
            self.analytics_enabled.load(Ordering::Relaxed),
        )
    }

    async fn ensure_openteams_ignored_for_git_workspace(
        workspace_path: &Path,
    ) -> Result<(), ChatRunnerError> {
        let output = Command::new("git")
            .arg("-C")
            .arg(workspace_path)
            .args(["rev-parse", "--show-toplevel"])
            .output()
            .await?;

        if !output.status.success() {
            return Ok(());
        }

        let repo_root = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if repo_root.is_empty() {
            return Ok(());
        }

        let gitignore_path = PathBuf::from(repo_root).join(".gitignore");
        let existing = match fs::read_to_string(&gitignore_path).await {
            Ok(content) => content,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(err) => return Err(err.into()),
        };

        let already_present = existing.lines().map(str::trim).any(|line| {
            matches!(
                line,
                ".openteams/" | "/.openteams/" | ".openteams" | "/.openteams"
            )
        });

        if already_present {
            return Ok(());
        }

        let mut updated = existing;
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push('\n');
        }
        updated.push_str(OPENTEAMS_GITIGNORE_ENTRY);
        updated.push('\n');

        fs::write(&gitignore_path, updated).await?;
        Ok(())
    }

    pub async fn recover_orphaned_session_agents(&self) -> Result<usize, ChatRunnerError> {
        let active_agents = ChatSessionAgent::find_all_active(&self.db.pool).await?;

        for session_agent in &active_agents {
            let recovered = ChatSessionAgent::reset_runtime_state(
                &self.db.pool,
                session_agent.id,
                ChatSessionAgentState::Idle,
            )
            .await?;
            self.run_controls.remove(&session_agent.id);

            // A run that was in flight when the backend died left its queue row stranded in
            // `processing`/`running`; reset it to `queued` so the persisted queue can resume.
            match QueuedMessageService::new()
                .requeue_stale_inflight(&self.db.pool, recovered.id)
                .await
            {
                Ok(rows) if rows > 0 => {
                    self.emit_member_queue_update(recovered.session_id, recovered.id)
                        .await;
                }
                Ok(_) => {}
                Err(err) => {
                    tracing::warn!(
                        session_agent_id = %recovered.id,
                        error = %err,
                        "failed to requeue stale in-flight queue rows during recovery"
                    );
                }
            }

            tracing::warn!(
                session_id = %recovered.session_id,
                session_agent_id = %recovered.id,
                agent_id = %recovered.agent_id,
                previous_state = ?session_agent.state,
                "Recovered orphaned chat session agent left active after backend interruption"
            );

            // Resume the persisted member queue from the database.
            let runner = self.clone();
            let session_id = recovered.session_id;
            let session_agent_id = recovered.id;
            tokio::spawn(async move {
                runner
                    .dispatch_next_queued_message(session_id, session_agent_id)
                    .await;
            });
        }

        Ok(active_agents.len())
    }

    pub fn subscribe(&self, session_id: Uuid) -> broadcast::Receiver<ChatStreamEvent> {
        self.sender_for(session_id).subscribe()
    }

    pub fn emit_message_new(&self, session_id: Uuid, message: ChatMessage) {
        self.emit(session_id, ChatStreamEvent::MessageNew { message });
    }

    pub fn emit_message_updated(&self, session_id: Uuid, message: ChatMessage) {
        self.emit(session_id, ChatStreamEvent::MessageUpdated { message });
    }

    pub fn emit_work_item_new(&self, session_id: Uuid, work_item: ChatWorkItem) {
        self.emit(session_id, ChatStreamEvent::WorkItemNew { work_item });
    }

    pub fn emit_queue_update(&self, session_id: Uuid, queue: MemberQueueSnapshot) {
        self.emit(
            session_id,
            ChatStreamEvent::QueueUpdated {
                session_id,
                session_agent_id: queue.session_agent_id,
                queue,
            },
        );
    }

    async fn emit_member_queue_update(&self, session_id: Uuid, session_agent_id: Uuid) {
        let Some(session_agent) =
            (match ChatSessionAgent::find_by_id(&self.db.pool, session_agent_id).await {
                Ok(agent) => agent,
                Err(err) => {
                    tracing::warn!(
                        session_id = %session_id,
                        session_agent_id = %session_agent_id,
                        error = %err,
                        "failed to load member before queue update event"
                    );
                    return;
                }
            })
        else {
            return;
        };

        match QueuedMessageService::new()
            .snapshot_for_member(
                &self.db.pool,
                session_id,
                session_agent.id,
                session_agent.agent_id,
            )
            .await
        {
            Ok(snapshot) => self.emit_queue_update(session_id, snapshot),
            Err(err) => {
                tracing::warn!(
                    session_id = %session_id,
                    session_agent_id = %session_agent_id,
                    error = %err,
                    "failed to build queue update event"
                );
            }
        }
    }

    /// Emit a one-shot file-change refresh signal after an agent message
    /// completes. Fired exactly once per run (at the terminal completion point),
    /// so a single agent message triggers a single refresh.
    pub fn emit_file_change_refresh(
        &self,
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        message_id: Uuid,
        changed_files: Vec<FileChangeEntry>,
    ) {
        self.emit(
            session_id,
            ChatStreamEvent::FileChangeRefresh {
                session_id,
                session_agent_id,
                agent_id,
                run_id,
                message_id,
                changed_files,
                ts: Utc::now(),
            },
        );
    }

    pub fn emit_workflow_execution_updated(&self, session_id: Uuid, execution_id: Uuid) {
        self.emit(
            session_id,
            ChatStreamEvent::WorkflowExecutionUpdated {
                session_id,
                execution_id,
            },
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub fn emit_workflow_graph_updated(
        &self,
        session_id: Uuid,
        execution_id: Uuid,
        graph_version: String,
        reason: String,
        nodes: Vec<WorkflowPlanNode>,
        edges: Vec<WorkflowPlanEdge>,
        changed_step_ids: Vec<String>,
    ) {
        self.emit(
            session_id,
            ChatStreamEvent::WorkflowGraphUpdated {
                session_id,
                execution_id,
                graph_version,
                reason,
                nodes,
                edges,
                changed_step_ids,
            },
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub fn emit_workflow_runtime_line(
        &self,
        session_id: Uuid,
        execution_id: Uuid,
        workflow_agent_session_id: Option<Uuid>,
        step_id: Uuid,
        step_key: String,
        agent_id: Uuid,
        agent_name: String,
        stream_type: ChatStreamDeltaType,
        content: String,
        created_at: String,
    ) {
        self.emit(
            session_id,
            ChatStreamEvent::WorkflowRuntimeLine {
                line_id: Uuid::new_v4(),
                session_id,
                execution_id,
                workflow_agent_session_id,
                step_id,
                step_key,
                agent_id,
                agent_name,
                stream_type,
                content,
                created_at,
            },
        );
    }

    /// Update the mention_statuses field in a message's meta
    async fn update_mention_status(&self, message_id: Uuid, agent_name: &str, status: &str) {
        // Fetch the current message
        let Ok(Some(message)) = ChatMessage::find_by_id(&self.db.pool, message_id).await else {
            tracing::warn!(
                message_id = %message_id,
                "failed to fetch message for mention status update"
            );
            return;
        };

        // Update the meta with new mention status
        let mut meta = message.meta.0.clone();
        let mention_statuses = meta
            .get_mut("mention_statuses")
            .and_then(|v| v.as_object_mut());

        if let Some(statuses) = mention_statuses {
            statuses.insert(agent_name.to_string(), serde_json::json!(status));
        } else {
            let mut new_statuses = serde_json::Map::new();
            new_statuses.insert(agent_name.to_string(), serde_json::json!(status));
            meta["mention_statuses"] = serde_json::Value::Object(new_statuses);
        }

        // Persist the updated meta
        if let Err(err) = ChatMessage::update_meta(&self.db.pool, message_id, meta).await {
            tracing::warn!(
                message_id = %message_id,
                error = %err,
                "failed to update message mention status"
            );
        }
    }

    fn mention_status_as_str(status: &MentionStatus) -> &'static str {
        match status {
            MentionStatus::Received => "received",
            MentionStatus::Running => "running",
            MentionStatus::Completed => "completed",
            MentionStatus::Failed => "failed",
        }
    }

    async fn set_mention_status(
        &self,
        session_id: Uuid,
        message_id: Uuid,
        agent_name: &str,
        agent_id: Option<Uuid>,
        status: MentionStatus,
    ) {
        self.update_mention_status(message_id, agent_name, Self::mention_status_as_str(&status))
            .await;

        if let Some(agent_id) = agent_id {
            self.emit(
                session_id,
                ChatStreamEvent::MentionAcknowledged {
                    session_id,
                    message_id,
                    mentioned_agent: agent_name.to_string(),
                    agent_id,
                    status,
                },
            );
        }
    }

    async fn report_mention_failure(
        &self,
        session_id: Uuid,
        message_id: Uuid,
        agent_name: &str,
        agent_id: Option<Uuid>,
        reason: impl Into<String>,
    ) {
        let reason = reason.into();
        let compact_reason = reason
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        let compact_reason = if compact_reason.is_empty() {
            "Unknown error".to_string()
        } else {
            compact_reason.clone()
        };

        tracing::debug!(
            session_id = %session_id,
            message_id = %message_id,
            agent_name = %agent_name,
            agent_id = ?agent_id,
            compact_reason = %compact_reason,
            full_reason_len = reason.len(),
            "[chat_runner] Reporting mention failure"
        );

        self.set_mention_status(
            session_id,
            message_id,
            agent_name,
            agent_id,
            MentionStatus::Failed,
        )
        .await;

        if let Ok(Some(msg)) = ChatMessage::find_by_id(&self.db.pool, message_id).await {
            let mut meta = msg.meta.0.clone();
            if let Some(meta_obj) = meta.as_object_mut() {
                let mention_errors = meta_obj
                    .entry("mention_errors")
                    .or_insert_with(|| serde_json::json!({}));
                if let Some(errors) = mention_errors.as_object_mut() {
                    let mut error_info = serde_json::json!({
                        "reason": compact_reason.clone(),
                    });
                    if let Some(aid) = agent_id {
                        error_info["agent_id"] = serde_json::json!(aid);
                    }
                    errors.insert(agent_name.to_string(), error_info);
                }
            }
            let _ = ChatMessage::update_meta(&self.db.pool, message_id, meta).await;
        }

        self.emit(
            session_id,
            ChatStreamEvent::MentionError {
                session_id,
                message_id,
                agent_name: agent_name.to_string(),
                agent_id,
                reason: compact_reason.clone(),
            },
        );

        let mut failure_meta = serde_json::json!({
            "mention_failure": {
                "source_message_id": message_id,
                "mentioned_agent": agent_name,
                "reason": compact_reason.clone(),
            }
        });

        if let Some(value) = agent_id {
            failure_meta["mention_failure"]["agent_id"] = serde_json::json!(value);
        }

        let system_content = format!(
            "Agent \"{}\" failed to execute this mention: {}",
            agent_name, compact_reason
        );

        match chat::create_message(
            &self.db.pool,
            session_id,
            ChatSenderType::System,
            None,
            system_content,
            Some(failure_meta),
        )
        .await
        {
            Ok(message) => self.emit_message_new(session_id, message),
            Err(err) => {
                tracing::warn!(
                    session_id = %session_id,
                    message_id = %message_id,
                    agent_name = %agent_name,
                    error = %err,
                    "failed to emit mention failure system message"
                );
            }
        }
    }

    pub async fn handle_message(&self, session: &ChatSession, message: &ChatMessage) {
        self.emit_message_new(session.id, message.clone());

        // Check chain depth to prevent infinite loops
        let chain_depth = self.extract_chain_depth(&message.meta);
        let max_agent_chain_depth = config::load_config_from_file(&config_path())
            .await
            .max_agent_chain_depth
            .max(1);
        if chain_depth >= max_agent_chain_depth {
            tracing::warn!(
                session_id = %session.id,
                chain_depth = chain_depth,
                max_agent_chain_depth = max_agent_chain_depth,
                "agent chain depth limit reached; not triggering further agents"
            );
            return;
        }

        let session_id = session.id;
        let mut mentions = message.mentions.0.clone();
        if mentions.is_empty() {
            match self
                .resolve_default_mention_for_unmentioned_user_message(session, message)
                .await
            {
                Ok(Some(default_mention)) => {
                    tracing::debug!(
                        session_id = %session_id,
                        message_id = %message.id,
                        mention = %default_mention,
                        "routing unmentioned user message to first session agent"
                    );
                    mentions.push(default_mention);
                }
                Ok(None) => {}
                Err(err) => {
                    tracing::warn!(
                        session_id = %session_id,
                        message_id = %message.id,
                        error = %err,
                        "failed to resolve default session agent for unmentioned user message"
                    );
                }
            }
        }

        for mention in mentions {
            if message.sender_type == ChatSenderType::Agent
                && mention.eq_ignore_ascii_case(RESERVED_USER_HANDLE)
            {
                tracing::debug!(
                    session_id = %session_id,
                    message_id = %message.id,
                    mention = mention,
                    "skipping reserved user mention in agent message"
                );
                continue;
            }

            if let Err(err) = self.run_agent_for_mention(session_id, &mention, message).await {
                tracing::warn!(
                    error = %err,
                    mention = mention,
                    session_id = %session_id,
                    "chat runner failed for mention"
                );
            }
        }
    }

    async fn resolve_default_mention_for_unmentioned_user_message(
        &self,
        session: &ChatSession,
        message: &ChatMessage,
    ) -> Result<Option<String>, ChatRunnerError> {
        if message.sender_type != ChatSenderType::User || !message.mentions.0.is_empty() {
            return Ok(None);
        }

        let is_workflow_mode = message
            .meta
            .get("chat_input_mode")
            .and_then(|v| v.as_str())
            .map(|v| v == "workflow")
            .unwrap_or(false);
        if !is_workflow_mode {
            return Ok(None);
        }

        let session_agents =
            ChatSessionAgent::find_all_for_session(&self.db.pool, session.id).await?;
        if session_agents.is_empty() {
            return Ok(None);
        }

        let agents = ChatAgent::find_all(&self.db.pool).await?;
        let member_names =
            chat::member_name_overrides_for_session(&self.db.pool, session.id).await?;

        tracing::debug!(
            session_id = %session.id,
            message_id = %message.id,
            "attempting to resolve lead agent for workflow mode message"
        );
        match resolve_lead_agent(session, &session_agents, &agents) {
            Ok((lead_agent, _)) => {
                return Ok(Some(chat::effective_agent_name(
                    lead_agent,
                    member_names.get(&lead_agent.id).map(String::as_str),
                )));
            }
            Err(_) => Ok(None),
        }
    }

    fn extract_chain_depth(&self, meta: &sqlx::types::Json<serde_json::Value>) -> u32 {
        meta.get("chain_depth")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or(0)
    }

    /// Extract the frontend-supplied `client_message_id` from a source message's
    /// metadata. Used to correlate an agent run and its final message back to the
    /// pending placeholder the frontend optimistically rendered.
    pub(super) fn extract_client_message_id(
        meta: &sqlx::types::Json<serde_json::Value>,
    ) -> Option<String> {
        meta.get("client_message_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }

    /// Extract the protocol retry attempt count from a source message's metadata.
    /// Returns 0 if the message is not a retry (normal first attempt).
    fn extract_protocol_retry_attempt(meta: &sqlx::types::Json<serde_json::Value>) -> u32 {
        meta.get("protocol_retry")
            .and_then(|v| v.get("attempt"))
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or(0)
    }

    fn emit(&self, session_id: Uuid, event: ChatStreamEvent) {
        let sender = self.sender_for(session_id);
        let _ = sender.send(event);
    }

    fn sender_for(&self, session_id: Uuid) -> broadcast::Sender<ChatStreamEvent> {
        if let Some(entry) = self.streams.get(&session_id) {
            return entry.clone();
        }

        let (sender, _) = broadcast::channel(1024);
        self.streams.insert(session_id, sender.clone());
        sender
    }

    /// Claim and dispatch the next queued message for a member after it becomes idle.
    ///
    /// The queue is the persistent `chat_message_queue` table, so this resumes correctly after a
    /// restart. `QueuedMessageService::claim_next` atomically picks the oldest `queued` entry and
    /// is a no-op when the member is busy or blocked by a failed entry (stop-on-failure).
    pub async fn dispatch_next_queued_message(&self, session_id: Uuid, session_agent_id: Uuid) {
        let entry = match QueuedMessageService::new()
            .claim_next(&self.db.pool, session_agent_id)
            .await
        {
            Ok(Some(entry)) => entry,
            Ok(None) => return,
            Err(err) => {
                tracing::warn!(
                    session_agent_id = %session_agent_id,
                    error = %err,
                    "failed to claim next queued message"
                );
                return;
            }
        };
        self.emit_member_queue_update(session_id, session_agent_id)
            .await;

        self.dispatch_queued_entry(session_id, session_agent_id, entry)
            .await;
    }

    async fn dispatch_queued_entry(
        &self,
        session_id: Uuid,
        session_agent_id: Uuid,
        entry: QueuedMessage,
    ) {
        // Resolve the persisted references back into the data the runner needs.
        let message = match ChatMessage::find_by_id(&self.db.pool, entry.chat_message_id).await {
            Ok(Some(message)) => message,
            other => {
                if let Err(err) = other {
                    tracing::warn!(error = %err, "failed to load queued chat message");
                }
                self.fail_or_skip_queue_entry(
                    &entry,
                    Some("queued chat message no longer exists".to_string()),
                )
                .await;
                return;
            }
        };
        let agent_name = match ChatAgent::find_by_id(&self.db.pool, entry.agent_id).await {
            Ok(Some(agent)) => agent.name,
            other => {
                if let Err(err) = other {
                    tracing::warn!(error = %err, "failed to load agent for queued message");
                }
                self.fail_or_skip_queue_entry(
                    &entry,
                    Some("queued message agent no longer exists".to_string()),
                )
                .await;
                return;
            }
        };

        tracing::info!(
            session_agent_id = %session_agent_id,
            message_id = %message.id,
            agent_name = %agent_name,
            "processing queued message for agent"
        );

        // `run_agent_for_mention_internal` binds this entry to its run (advancing it to
        // `running`); the completion handler then finalizes it via `find_by_run_id`.
        if let Err(err) = self
            .run_agent_for_mention_internal(session_id, &agent_name, &message, true)
            .await
        {
            tracing::warn!(
                error = %err,
                agent_name = %agent_name,
                session_agent_id = %session_agent_id,
                "failed to dispatch queued message"
            );
            // The run never started (or failed before binding), so finalize the claimed entry.
            // `fail_or_skip_queue_entry` blocks when queued messages remain or auto-skips
            // when nothing is waiting, keeping the queue clean.
            self.fail_or_skip_queue_entry(
                &entry,
                Some(format!("failed to dispatch queued message: {err}")),
            )
            .await;
        }
    }

    /// Mark the queue entry bound to a run as `completed` (success / normal stop).
    async fn mark_run_queue_completed(&self, run_id: Uuid) {
        match QueuedMessageService::new()
            .find_by_run_id(&self.db.pool, run_id)
            .await
        {
            Ok(Some(entry)) => {
                if let Err(err) = QueuedMessageService::new()
                    .mark_completed(&self.db.pool, entry.id)
                    .await
                {
                    tracing::warn!(run_id = %run_id, error = %err, "failed to complete queue entry");
                } else {
                    self.emit_member_queue_update(entry.session_id, entry.session_agent_id)
                        .await;
                }
            }
            Ok(None) => {}
            Err(err) => {
                tracing::warn!(run_id = %run_id, error = %err, "failed to find queue entry for run");
            }
        }
    }

    /// Complete the run's queue row and claim the next queued item in one transaction.
    async fn complete_run_and_claim_next(
        &self,
        run_id: Uuid,
        session_id: Uuid,
        session_agent_id: Uuid,
    ) -> Option<QueuedMessage> {
        match QueuedMessageService::new()
            .complete_run_and_claim_next(&self.db.pool, run_id, session_agent_id)
            .await
        {
            Ok(claimed) => {
                self.emit_member_queue_update(session_id, session_agent_id)
                    .await;
                claimed
            }
            Err(err) => {
                tracing::warn!(
                    run_id = %run_id,
                    session_agent_id = %session_agent_id,
                    error = %err,
                    "failed to complete queue entry and claim next"
                );
                None
            }
        }
    }

    /// Finalize a failed queue entry, choosing between `failed` (block) and `skipped`
    /// (auto-skip) based on whether queued messages are waiting behind it.
    ///
    /// "Continue execution" is only meaningful when queued messages are waiting. If nothing is
    /// queued, the failed entry is auto-skipped so the queue stays clean and the next message
    /// runs directly instead of being blocked by a stale failure.
    async fn fail_or_skip_queue_entry(
        &self,
        entry: &QueuedMessage,
        failure_reason: Option<String>,
    ) {
        let service = QueuedMessageService::new();
        let has_queued = match service
            .has_queued(&self.db.pool, entry.session_agent_id)
            .await
        {
            Ok(has_queued) => has_queued,
            Err(err) => {
                tracing::warn!(
                    session_agent_id = %entry.session_agent_id,
                    entry_id = %entry.id,
                    error = %err,
                    "failed to check for queued messages; defaulting to fail-and-block"
                );
                true
            }
        };

        let result: Result<Option<QueuedMessage>, sqlx::Error> = if has_queued {
            service
                .mark_failed(&self.db.pool, entry.id, failure_reason)
                .await
        } else {
            service
                .skip_inflight(&self.db.pool, entry.id, failure_reason)
                .await
        };

        if let Err(err) = result {
            tracing::warn!(
                entry_id = %entry.id,
                error = %err,
                "failed to finalize queue entry"
            );
        }
        self.emit_member_queue_update(entry.session_id, entry.session_agent_id)
            .await;
    }

    /// Finalize the queue entry bound to a failed run. When queued messages are waiting, the
    /// entry is marked `failed` so the member queue blocks until the user continues. When
    /// nothing is queued, the entry is auto-skipped so the next message runs directly.
    async fn mark_run_queue_failed(&self, run_id: Uuid, failure_reason: Option<String>) {
        match QueuedMessageService::new()
            .find_by_run_id(&self.db.pool, run_id)
            .await
        {
            Ok(Some(entry)) => {
                self.fail_or_skip_queue_entry(&entry, failure_reason).await;
            }
            Ok(None) => {}
            Err(err) => {
                tracing::warn!(run_id = %run_id, error = %err, "failed to find queue entry for run");
            }
        }
    }

    async fn resolve_session_agent_for_mention(
        &self,
        session_id: Uuid,
        mention: &str,
    ) -> Result<Option<(ChatSessionAgent, ChatAgent)>, ChatRunnerError> {
        let session_agents =
            ChatSessionAgent::find_all_for_session(&self.db.pool, session_id).await?;
        if !session_agents.is_empty() {
            let agents = ChatAgent::find_all(&self.db.pool).await?;
            let member_names =
                chat::member_name_overrides_for_session(&self.db.pool, session_id).await?;
            let agent_map: HashMap<Uuid, ChatAgent> =
                agents.into_iter().map(|agent| (agent.id, agent)).collect();

            let mut exact_member_match: Option<(ChatSessionAgent, ChatAgent)> = None;
            let mut exact_template_match: Option<(ChatSessionAgent, ChatAgent)> = None;
            let mut ci_member_match: Option<(ChatSessionAgent, ChatAgent)> = None;
            let mut ci_template_match: Option<(ChatSessionAgent, ChatAgent)> = None;

            for session_agent in session_agents {
                let Some(agent) = agent_map.get(&session_agent.agent_id) else {
                    tracing::warn!(
                        session_agent_id = %session_agent.id,
                        agent_id = %session_agent.agent_id,
                        "chat session agent missing backing agent"
                    );
                    continue;
                };

                let effective_name = chat::effective_agent_name(
                    agent,
                    member_names.get(&agent.id).map(String::as_str),
                );
                let build_match = |session_agent: &ChatSessionAgent, effective_name: &str| {
                    let mut effective_agent = agent.clone();
                    effective_agent.name = effective_name.to_string();
                    (session_agent.clone(), effective_agent)
                };

                if effective_name == mention {
                    exact_member_match = Some(build_match(&session_agent, &effective_name));
                    break;
                }
                if agent.name == mention && exact_template_match.is_none() {
                    exact_template_match = Some(build_match(&session_agent, &effective_name));
                }

                if effective_name.eq_ignore_ascii_case(mention) {
                    if ci_member_match.is_some() {
                        tracing::warn!(
                            session_id = %session_id,
                            mention = mention,
                            "multiple session agents matched mention; skipping"
                        );
                        return Ok(None);
                    }
                    ci_member_match = Some(build_match(&session_agent, &effective_name));
                }

                if agent.name.eq_ignore_ascii_case(mention) {
                    if ci_template_match.is_some() {
                        tracing::warn!(
                            session_id = %session_id,
                            mention = mention,
                            "multiple session agents matched template name mention; skipping"
                        );
                        return Ok(None);
                    }
                    ci_template_match = Some(build_match(&session_agent, &effective_name));
                }
            }

            let Some((session_agent, agent)) = exact_member_match
                .or(exact_template_match)
                .or(ci_member_match)
                .or(ci_template_match)
            else {
                return Ok(None);
            };

            if session_agent.workspace_path.is_none() {
                // respects "优先保留显式 agent workspace" because a user-set
                // Isolated sessions resolve through the worktree reducer during
                // the run. That path also syncs all session members to the
                // isolated worktree once it exists.
                let session = ChatSession::find_by_id(&self.db.pool, session_id).await?;
                if let Some(ref session) = session
                    && session.worktree_mode == ChatSessionWorktreeMode::Isolated
                {
                    return Ok(Some((session_agent, agent)));
                }

                let workspace_path = self
                    .resolve_workspace_path_for_agent(session_id, agent.id, None)
                    .await?;
                let updated = ChatSessionAgent::update_workspace_path(
                    &self.db.pool,
                    session_agent.id,
                    Some(workspace_path),
                )
                .await?;
                return Ok(Some((updated, agent)));
            }

            return Ok(Some((session_agent, agent)));
        }

        self.materialize_project_member_for_mention(session_id, mention)
            .await
    }

    async fn materialize_project_member_for_mention(
        &self,
        session_id: Uuid,
        mention: &str,
    ) -> Result<Option<(ChatSessionAgent, ChatAgent)>, ChatRunnerError> {
        let Some(session) = ChatSession::find_by_id(&self.db.pool, session_id).await? else {
            return Ok(None);
        };
        let Some(project_id) = session.project_id else {
            return Ok(None);
        };

        let project_members = ProjectMember::find_by_project(&self.db.pool, project_id).await?;
        let agents = ChatAgent::find_all(&self.db.pool).await?;
        let agent_map: HashMap<Uuid, ChatAgent> =
            agents.into_iter().map(|agent| (agent.id, agent)).collect();

        let mut exact_member_match = None;
        let mut exact_template_match = None;
        let mut ci_member_match = None;
        let mut ci_template_match = None;

        for member in project_members {
            if member.member_type != ProjectMemberType::Agent {
                continue;
            }
            let Some(agent_id) = member.agent_id else {
                continue;
            };
            let Some(agent) = agent_map.get(&agent_id) else {
                continue;
            };

            let effective_name = chat::effective_agent_name(agent, member.member_name.as_deref());
            let candidate = (member, agent.clone(), effective_name.clone());

            if effective_name == mention {
                exact_member_match = Some(candidate);
                break;
            }
            if agent.name == mention && exact_template_match.is_none() {
                exact_template_match = Some(candidate.clone());
            }
            if effective_name.eq_ignore_ascii_case(mention) {
                if ci_member_match.is_some() {
                    tracing::warn!(
                        session_id = %session_id,
                        mention = mention,
                        "multiple project members matched mention; skipping auto-configuration"
                    );
                    return Ok(None);
                }
                ci_member_match = Some(candidate.clone());
            }
            if agent.name.eq_ignore_ascii_case(mention) {
                if ci_template_match.is_some() {
                    tracing::warn!(
                        session_id = %session_id,
                        mention = mention,
                        "multiple project members matched template name mention; skipping auto-configuration"
                    );
                    return Ok(None);
                }
                ci_template_match = Some(candidate);
            }
        }

        let Some((member, mut agent, effective_name)) = exact_member_match
            .or(exact_template_match)
            .or(ci_member_match)
            .or(ci_template_match)
        else {
            return Ok(None);
        };

        let Some(agent_id) = member.agent_id else {
            return Ok(None);
        };

        if let Some(existing) =
            ChatSessionAgent::find_by_session_and_agent(&self.db.pool, session_id, agent_id).await?
        {
            agent.name = effective_name;
            return Ok(Some((existing, agent)));
        }

        let workspace_path = self
            .resolve_workspace_path_for_agent(
                session_id,
                agent_id,
                member
                    .default_workspace_path
                    .clone()
                    .or_else(|| session.default_workspace_path.clone()),
            )
            .await?;
        let create = CreateChatSessionAgent {
            session_id,
            agent_id,
            workspace_path: Some(workspace_path),
            allowed_skill_ids: member.allowed_skill_ids.0.clone(),
            project_member_id: Some(member.id),
            execution_config: member.execution_config.0.clone(),
        };
        let session_agent = match ChatSessionAgent::create(&self.db.pool, &create, Uuid::new_v4())
            .await
        {
            Ok(created) => created,
            Err(err) => {
                if let Some(existing) =
                    ChatSessionAgent::find_by_session_and_agent(&self.db.pool, session_id, agent_id)
                        .await?
                {
                    existing
                } else {
                    return Err(err.into());
                }
            }
        };

        tracing::info!(
            session_id = %session_id,
            project_member_id = %member.id,
            agent_id = %agent_id,
            mention = mention,
            "auto-configured project member in chat session for first mention"
        );

        agent.name = effective_name;
        Ok(Some((session_agent, agent)))
    }

    async fn run_agent_for_mention(
        &self,
        session_id: Uuid,
        mention: &str,
        source_message: &ChatMessage,
    ) -> Result<(), ChatRunnerError> {
        self.run_agent_for_mention_internal(session_id, mention, source_message, true)
            .await
    }

    async fn project_member_for_session_agent(
        &self,
        session_id: Uuid,
        session_agent: &ChatSessionAgent,
        agent_id: Uuid,
    ) -> Result<Option<ProjectMember>, ChatRunnerError> {
        if let Some(project_member_id) = session_agent.project_member_id {
            return Ok(ProjectMember::find_by_id(&self.db.pool, project_member_id).await?);
        }

        let Some(session) = ChatSession::find_by_id(&self.db.pool, session_id).await? else {
            return Ok(None);
        };
        let Some(project_id) = session.project_id else {
            return Ok(None);
        };

        Ok(ProjectMember::find_by_project(&self.db.pool, project_id)
            .await?
            .into_iter()
            .find(|member| {
                member.member_type == ProjectMemberType::Agent && member.agent_id == Some(agent_id)
            }))
    }

    async fn sync_session_agent_execution_config_before_run(
        &self,
        session_id: Uuid,
        session_agent: ChatSessionAgent,
        agent_id: Uuid,
    ) -> Result<ChatSessionAgent, ChatRunnerError> {
        let Some(project_member) = self
            .project_member_for_session_agent(session_id, &session_agent, agent_id)
            .await?
        else {
            return Ok(session_agent);
        };

        let current_config = session_agent.execution_config.0.clone().normalized();
        let next_config = project_member.execution_config.0.clone().normalized();
        if current_config == next_config
            && session_agent.project_member_id == Some(project_member.id)
        {
            return Ok(session_agent);
        }

        let updated = ChatSessionAgent::update_execution_config_for_next_run(
            &self.db.pool,
            session_agent.id,
            Some(project_member.id),
            next_config,
        )
        .await?;
        tracing::info!(
            session_id = %session_id,
            session_agent_id = %session_agent.id,
            agent_id = %agent_id,
            project_member_id = %project_member.id,
            "Synced project member execution config immediately before agent run"
        );
        Ok(updated)
    }

    async fn run_agent_for_mention_internal(
        &self,
        session_id: Uuid,
        mention: &str,
        source_message: &ChatMessage,
        track_source_message: bool,
    ) -> Result<(), ChatRunnerError> {
        if source_message.sender_type == ChatSenderType::Agent
            && mention.eq_ignore_ascii_case(RESERVED_USER_HANDLE)
        {
            tracing::debug!(
                session_id = %session_id,
                message_id = %source_message.id,
                mention = mention,
                "skipping reserved user mention in agent message"
            );
            return Ok(());
        }

        let resolved = self
            .resolve_session_agent_for_mention(session_id, mention)
            .await;
        let Some((session_agent, agent)) = (match resolved {
            Ok(value) => value,
            Err(err) => {
                if track_source_message {
                    self.report_mention_failure(
                        session_id,
                        source_message.id,
                        mention,
                        None,
                        format!("Failed to resolve mentioned agent: {err}"),
                    )
                    .await;
                }
                return Err(err);
            }
        }) else {
            if let Some(agent) = ChatAgent::find_by_name(&self.db.pool, mention).await? {
                tracing::debug!(
                    session_id = %session_id,
                    agent_id = %agent.id,
                    mention = mention,
                    "chat session agent not configured; marking mention as failed"
                );
                if track_source_message {
                    self.report_mention_failure(
                        session_id,
                        source_message.id,
                        &agent.name,
                        Some(agent.id),
                        "Agent is not configured in this session.",
                    )
                    .await;
                }
                return Err(ChatRunnerError::AgentNotFound(mention.to_string()));
            }
            if track_source_message {
                self.report_mention_failure(
                    session_id,
                    source_message.id,
                    mention,
                    None,
                    "Mentioned agent was not found.",
                )
                .await;
            }
            return Err(ChatRunnerError::AgentNotFound(mention.to_string()));
        };

        if source_message.sender_type == ChatSenderType::Agent
            && let Some(sender_id) = source_message.sender_id
            && sender_id == agent.id
        {
            tracing::debug!(
                agent_id = %sender_id,
                mention = mention,
                "skipping self-mention by agent"
            );
            return Ok(());
        }

        let member_is_active = matches!(
            session_agent.state,
            ChatSessionAgentState::Running | ChatSessionAgentState::Stopping
        );
        let member_queue_blocked = if member_is_active {
            false
        } else {
            match QueuedMessageService::new()
                .has_blocking_failure(&self.db.pool, session_agent.id)
                .await
            {
                Ok(blocked) => blocked,
                Err(err) => {
                    tracing::warn!(
                        session_agent_id = %session_agent.id,
                        error = %err,
                        "failed to check member queue blocking state"
                    );
                    false
                }
            }
        };

        if member_is_active || member_queue_blocked {
            // Queue the message for later processing instead of skipping or bypassing a failure.
            tracing::debug!(
                session_agent_id = %session_agent.id,
                agent_id = %agent.id,
                message_id = %source_message.id,
                state = ?session_agent.state,
                "chat session agent active or blocked; queueing message for later"
            );

            // Persist the wait as a durable, member-scoped queue row referencing the existing
            // chat message, so the queue survives restarts and frontend refreshes.
            if let Err(err) = QueuedMessageService::new()
                .create_queued(
                    &self.db.pool,
                    &CreateQueuedMessage {
                        session_id,
                        session_agent_id: session_agent.id,
                        agent_id: agent.id,
                        chat_message_id: source_message.id,
                    },
                )
                .await
            {
                tracing::warn!(
                    session_agent_id = %session_agent.id,
                    message_id = %source_message.id,
                    error = %err,
                    "failed to persist queued message"
                );
                self.report_mention_failure(
                    session_id,
                    source_message.id,
                    &agent.name,
                    Some(agent.id),
                    format!("Failed to queue message for agent: {err}"),
                )
                .await;
                return Err(ChatRunnerError::Database(err));
            } else {
                self.emit_member_queue_update(session_id, session_agent.id)
                    .await;
            }

            if track_source_message {
                // Emit a "received" status to indicate the message is queued
                self.emit(
                    session_id,
                    ChatStreamEvent::MentionAcknowledged {
                        session_id,
                        message_id: source_message.id,
                        mentioned_agent: agent.name.clone(),
                        agent_id: agent.id,
                        status: MentionStatus::Received,
                    },
                );

                // Persist received status to message meta
                self.update_mention_status(source_message.id, &agent.name, "received")
                    .await;
            }

            return Ok(());
        }

        let session_agent = self
            .sync_session_agent_execution_config_before_run(session_id, session_agent, agent.id)
            .await?;
        let session_agent_id = session_agent.id;
        let agent_id = agent.id;
        let run_model = resolve_effective_member_execution_config(&agent, &session_agent)
            .map_err(|err| ChatRunnerError::Io(std::io::Error::other(err.to_string())))?
            .model_name;
        let run_id = Uuid::new_v4();
        let startup_timing =
            Arc::new(startup_timing::RunStartupTiming::new(startup_timing::RunStartupIdentity {
                session_id,
                session_agent_id,
                agent_id,
                run_id,
                source_message_id: source_message.id,
                runner_type: agent.runner_type.clone(),
            }));
        startup_timing.mark(startup_timing::StartupMilestoneName::RunScheduled, None);

        let mut session_agent = if session_agent.state != ChatSessionAgentState::Running {
            let updated = ChatSessionAgent::update_state(
                &self.db.pool,
                session_agent.id,
                ChatSessionAgentState::Running,
            )
            .await?;
            startup_timing.mark(
                startup_timing::StartupMilestoneName::AgentStateRunningPersisted,
                None,
            );
            updated
        } else {
            session_agent
        };

        let run_started_at = session_agent.updated_at;
        // Correlation ids that let the frontend stitch "user message -> run ->
        // final agent message" together precisely instead of guessing by
        // `session_agent_id`.
        let client_message_id = Self::extract_client_message_id(&source_message.meta);
        // Register the stop control before broadcasting the running state so an
        // immediate user stop request cannot miss the active run.
        let stop = self.register_run_control(session_agent_id, run_id);

        self.emit(
            session_id,
            ChatStreamEvent::AgentState {
                session_agent_id,
                agent_id,
                state: ChatSessionAgentState::Running,
                run_id: Some(run_id),
                started_at: Some(session_agent.updated_at),
            },
        );
        startup_timing.mark(
            startup_timing::StartupMilestoneName::AgentStateRunningEmitted,
            None,
        );
        self.emit(
            session_id,
            ChatStreamEvent::AgentRunStarted {
                session_id,
                session_agent_id,
                agent_id,
                agent_name: agent.name.clone(),
                model: run_model.clone(),
                run_id,
                source_message_id: source_message.id,
                client_message_id: client_message_id.clone(),
                started_at: Some(session_agent.updated_at),
            },
        );
        startup_timing.mark(
            startup_timing::StartupMilestoneName::AgentRunStartedEmitted,
            client_message_id
                .as_ref()
                .map(|id| format!("client_message_id={id}")),
        );

        workflow_analytics::track_agent_state_changed(
            self.analytics_service(),
            session_id,
            None,
            "running",
        );

        if track_source_message {
            // Emit MentionAcknowledged running event
            self.emit(
                session_id,
                ChatStreamEvent::MentionAcknowledged {
                    session_id,
                    message_id: source_message.id,
                    mentioned_agent: agent.name.clone(),
                    agent_id: agent.id,
                    status: MentionStatus::Running,
                },
            );

            // Persist running status to message meta
            self.update_mention_status(source_message.id, &agent.name, "running")
                .await;
        }

        let chain_depth = self.extract_chain_depth(&source_message.meta);
        let protocol_retry_attempt = Self::extract_protocol_retry_attempt(&source_message.meta);

        let result = async {
            let workspace_path = self
                .resolve_workspace_path_for_agent(
                    session_id,
                    agent_id,
                    session_agent.workspace_path.clone(),
                )
                .await?;
            session_agent.workspace_path = Some(workspace_path.clone());
            startup_timing.mark(
                startup_timing::StartupMilestoneName::WorkspaceResolved,
                Some(workspace_path.clone()),
            );
            fs::create_dir_all(&workspace_path).await?;
            startup_timing.mark(
                startup_timing::StartupMilestoneName::WorkspaceDirectoryReady,
                None,
            );
            if let Err(err) =
                Self::ensure_openteams_ignored_for_git_workspace(Path::new(&workspace_path)).await
            {
                tracing::warn!(
                    workspace_path = %workspace_path,
                    error = %err,
                    "Failed to ensure .openteams is gitignored for workspace"
                );
            }
            startup_timing.mark(
                startup_timing::StartupMilestoneName::GitignorePrepared,
                None,
            );
            let workspace_change_baseline =
                capture_workspace_change_baseline(PathBuf::from(&workspace_path).as_path()).await;
            startup_timing.mark(
                startup_timing::StartupMilestoneName::WorkspaceBaselineCaptured,
                Some(format!(
                    "has_git_tree={},untracked_count={}",
                    workspace_change_baseline.git_tree.is_some(),
                    workspace_change_baseline.untracked_files.len()
                )),
            );
            tracing::debug!(
                session_id = %session_id,
                run_id = %run_id,
                session_agent_id = %session_agent_id,
                agent_id = %agent_id,
                workspace_path = %workspace_path,
                baseline_has_git_tree = workspace_change_baseline.git_tree.is_some(),
                baseline_untracked_count = workspace_change_baseline.untracked_files.len(),
                "[chat_runner] Captured workspace change baseline for agent run"
            );
            let run_records_dir = Self::workspace_run_records_dir(
                PathBuf::from(&workspace_path).as_path(),
                session_id,
            );
            fs::create_dir_all(&run_records_dir).await?;
            startup_timing.mark(
                startup_timing::StartupMilestoneName::RunRecordsDirectoryReady,
                Some(run_records_dir.to_string_lossy().to_string()),
            );
            tracing::info!(
                session_id = %session_id,
                workspace_path = %workspace_path,
                runs_dir = %run_records_dir.display(),
                "Using workspace runs directory"
            );

            let run_index = ChatRun::next_run_index(&self.db.pool, session_agent_id).await?;
            let run_dir =
                run_records_dir.join(Self::run_records_prefix(session_agent_id, run_index));
            fs::create_dir_all(&run_dir).await?;
            startup_timing.set_artifact_path(
                run_dir.join(startup_timing::STARTUP_TIMING_FILE_NAME),
            );
            startup_timing
                .mark_and_persist(
                    startup_timing::StartupMilestoneName::RunDirectoryReady,
                    Some(run_dir.to_string_lossy().to_string()),
                )
                .await;

            tracing::debug!(
                session_id = %session_id,
                run_id = %run_id,
                run_index = run_index,
                run_dir = %run_dir.display(),
                "[chat_runner] Created run directory for agent execution"
            );

            let input_path = run_dir.join("input.md");
            let output_path = run_dir.join("output.md");
            let tail_log_path = run_dir.join("raw.tail.log");
            let meta_path = run_dir.join("meta.json");
            let live_spool_path =
                Self::workspace_live_spool_path(PathBuf::from(&workspace_path).as_path(), run_id);

            let context_snapshot = self
                .build_context_snapshot(session_id, &workspace_path)
                .await?;
            startup_timing.mark(
                startup_timing::StartupMilestoneName::ContextSnapshotBuilt,
                Some(format!(
                    "context_compacted={},path={}",
                    context_snapshot.context_compacted,
                    context_snapshot.workspace_path.to_string_lossy()
                )),
            );
            if let Some(warning) = context_snapshot.compression_warning.clone() {
                self.emit(
                    session_id,
                    ChatStreamEvent::CompressionWarning {
                        session_id,
                        warning: warning.into(),
                    },
                );
            }
            let context_dir = context_snapshot
                .workspace_path
                .parent()
                .map(|path| path.to_path_buf())
                .unwrap_or_else(|| PathBuf::from(&workspace_path));
            let reference_context = self
                .build_reference_context(session_id, source_message, &context_dir)
                .await?;
            startup_timing.mark(
                startup_timing::StartupMilestoneName::ReferenceContextBuilt,
                Some(format!("has_reference={}", reference_context.is_some())),
            );
            let message_attachments = self
                .build_message_attachment_context(source_message, &context_dir)
                .await?;
            startup_timing.mark(
                startup_timing::StartupMilestoneName::AttachmentContextBuilt,
                Some(format!(
                    "attachment_count={}",
                    message_attachments
                        .as_ref()
                        .map(|context| context.attachments.len())
                        .unwrap_or(0)
                )),
            );
            let session_agents = self.build_session_agent_summaries(session_id).await?;
            startup_timing.mark(
                startup_timing::StartupMilestoneName::SessionAgentSummariesBuilt,
                Some(format!("member_count={}", session_agents.len())),
            );
            let session = ChatSession::find_by_id(&self.db.pool, session_id).await?;

            // Resolve builtin + user-configured skills for this agent.
            let prompt_context = if is_workflow_chat_input_mode(&source_message.meta.0) {
                crate::services::agent_skill_policy::AgentPromptContext::WorkflowChat
            } else {
                crate::services::agent_skill_policy::AgentPromptContext::FreeChat
            };
            let agent_skills = self
                .prepare_and_resolve_agent_skills(&mut session_agent, &agent, prompt_context)
                .await?;
            startup_timing.mark(
                startup_timing::StartupMilestoneName::AgentSkillsResolved,
                Some(format!("skill_count={}", agent_skills.len())),
            );

            // Load UI language setting for agent response language
            let ui_config = config::load_config_from_file(&config_path()).await;
            let ui_language = ui_config.language;
            let prompt_language = Self::resolve_prompt_language(source_message, &ui_language);

            let prompt = self.build_prompt(
                &agent,
                source_message,
                &context_snapshot.workspace_path,
                Path::new(&workspace_path),
                &session_agents,
                message_attachments.as_ref(),
                reference_context.as_ref(),
                &agent_skills,
                prompt_language,
                Self::resolve_session_team_protocol(session.as_ref()),
            );
            startup_timing.mark(
                startup_timing::StartupMilestoneName::PromptBuilt,
                Some(format!("prompt_bytes={}", prompt.len())),
            );
            fs::write(&input_path, &prompt).await?;
            startup_timing.mark(
                startup_timing::StartupMilestoneName::PromptInputWritten,
                Some(input_path.to_string_lossy().to_string()),
            );

            let _run = ChatRun::create(
                &self.db.pool,
                &CreateChatRun {
                    session_id,
                    session_agent_id,
                    workspace_path: Some(workspace_path.clone()),
                    run_index,
                    run_dir: run_dir.to_string_lossy().to_string(),
                    input_path: Some(input_path.to_string_lossy().to_string()),
                    output_path: Some(output_path.to_string_lossy().to_string()),
                    raw_log_path: Some(live_spool_path.to_string_lossy().to_string()),
                    meta_path: Some(meta_path.to_string_lossy().to_string()),
                },
                run_id,
            )
            .await?;
            startup_timing.mark(
                startup_timing::StartupMilestoneName::ChatRunCreated,
                None,
            );

            // Track this dispatch only after the chat_run row exists. `chat_message_queue.run_id`
            // has a real FK to `chat_runs(id)`, so binding earlier fails under foreign_keys=ON.
            QueuedMessageService::new()
                .start_or_create_running(
                    &self.db.pool,
                    &CreateQueuedMessage {
                        session_id,
                        session_agent_id,
                        agent_id,
                        chat_message_id: source_message.id,
                    },
                    Uuid::new_v4(),
                    run_id,
                )
                .await?;
            startup_timing.mark(
                startup_timing::StartupMilestoneName::QueueBoundToRun,
                None,
            );
            self.emit_member_queue_update(session_id, session_agent_id)
                .await;

            let repo_context = RepoContext::new(PathBuf::from(&workspace_path), Vec::new());
            let mut env = ExecutionEnv::new(repo_context, false, String::new());
            env.insert("VK_CHAT_SESSION_ID", session_id.to_string());
            env.insert("VK_CHAT_AGENT_ID", agent_id.to_string());
            env.insert("VK_CHAT_SESSION_AGENT_ID", session_agent_id.to_string());
            env.insert("VK_CHAT_RUN_ID", run_id.to_string());
            env.insert(
                "VK_CHAT_CONTEXT_PATH",
                context_snapshot
                    .workspace_path
                    .to_string_lossy()
                    .to_string(),
            );
            let (effective_execution, mut executor) =
                build_effective_member_executor(&agent, &session_agent, &mut env)
                    .map_err(|err| ChatRunnerError::Io(std::io::Error::other(err.to_string())))?;
            executor.use_approvals(Arc::new(NoopExecutorApprovalService));
            startup_timing.mark(
                startup_timing::StartupMilestoneName::ExecutorConfigured,
                Some(effective_execution.analytics_profile_label()),
            );

            let spawn_kind = if session_agent.state != ChatSessionAgentState::Dead
                && session_agent.agent_session_id.is_some()
            {
                "follow_up"
            } else {
                "initial"
            };
            startup_timing
                .mark_and_persist(
                    startup_timing::StartupMilestoneName::ExecutorSpawnStarted,
                    Some(format!("spawn_kind={spawn_kind}")),
                )
                .await;
            let mut spawned = if session_agent.state != ChatSessionAgentState::Dead {
                if let Some(agent_session_id) = session_agent.agent_session_id.as_deref() {
                    executor
                        .spawn_follow_up(
                            PathBuf::from(&workspace_path).as_path(),
                            &prompt,
                            agent_session_id,
                            session_agent.agent_message_id.as_deref(),
                            &env,
                        )
                        .await?
                } else {
                    executor
                        .spawn(PathBuf::from(&workspace_path).as_path(), &prompt, &env)
                        .await?
                }
            } else {
                executor
                    .spawn(PathBuf::from(&workspace_path).as_path(), &prompt, &env)
                    .await?
            };
            startup_timing
                .mark_and_persist(
                    startup_timing::StartupMilestoneName::ExecutorSpawnReturned,
                    Some(format!("spawn_kind={spawn_kind}")),
                )
                .await;

            let msg_store = Arc::new(MsgStore::new());
            let raw_log_spool = Arc::new(Mutex::new(
                runtime::RunLogSpool::new(
                    live_spool_path,
                    run_id,
                    self.db.pool.clone(),
                    workspace_path.clone(),
                    self.workspace_live_log_bytes.clone(),
                )
                .await?,
            ));
            startup_timing.mark(
                startup_timing::StartupMilestoneName::RawLogSpoolReady,
                None,
            );

            self.analytics_projector()
                .project_or_warn(DomainEvent::AgentRunStarted {
                    session_id,
                    agent_id,
                    run_id,
                    executor_profile: Some(effective_execution.analytics_profile_label()),
                })
                .await;

            let log_forwarders = self.spawn_log_forwarders(
                &mut spawned.child,
                msg_store.clone(),
                raw_log_spool.clone(),
            );
            startup_timing.mark(
                startup_timing::StartupMilestoneName::LogForwardersStarted,
                None,
            );
            executor.normalize_logs(msg_store.clone(), PathBuf::from(&workspace_path).as_path());
            startup_timing.mark(
                startup_timing::StartupMilestoneName::LogNormalizationStarted,
                None,
            );

            let completion_status = Arc::new(AtomicU8::new(RunCompletionStatus::Succeeded.as_u8()));

            startup_timing
                .mark_and_persist(
                    startup_timing::StartupMilestoneName::StreamBridgeScheduled,
                    None,
                )
                .await;
            self.spawn_stream_bridge(
                msg_store.clone(),
                session_id,
                agent_id,
                session_agent_id,
                run_index,
                run_id,
                output_path,
                meta_path,
                PathBuf::from(&workspace_path),
                run_dir,
                tail_log_path,
                raw_log_spool,
                completion_status.clone(),
                workspace_change_baseline,
                chain_depth,
                context_snapshot.context_compacted,
                context_snapshot.compression_warning.clone(),
                self.clone(),
                source_message.id,
                client_message_id.clone(),
                run_model,
                source_message.created_at,
                source_message.content.clone(),
                agent.name.clone(),
                prompt_language,
                run_started_at,
                protocol_retry_attempt,
                track_source_message,
                startup_timing.clone(),
                effective_execution.runner_type == BaseCodingAgent::Codex,
            );

            self.spawn_exit_watcher(
                runtime::ExitWatcherArgs {
                    child: spawned.child,
                    stop,
                    executor_cancel: spawned.cancel,
                    exit_signal: spawned.exit_signal,
                    msg_store,
                    completion_status,
                    log_forwarders,
                },
                session_agent_id,
                run_id,
            );
            startup_timing
                .mark_and_persist(
                    startup_timing::StartupMilestoneName::ExitWatcherStarted,
                    None,
                )
                .await;

            Ok::<(), ChatRunnerError>(())
        }
        .await;

        if result.is_err() {
            self.run_controls.remove(&session_agent_id);
            startup_timing
                .mark_and_persist(
                    startup_timing::StartupMilestoneName::StartupFailed,
                    result.as_ref().err().map(|err| err.to_string()),
                )
                .await;
            // The run failed to start; fail its queue row so the member queue blocks instead of
            // leaving the row stranded in `running`.
            self.mark_run_queue_failed(
                run_id,
                result
                    .as_ref()
                    .err()
                    .map(|err| format!("failed to start agent run: {err}")),
            )
            .await;
            if let Err(err) = &result {
                self.analytics_projector()
                    .project_or_warn(DomainEvent::AgentRunErrored {
                        session_id,
                        agent_id,
                        run_id,
                        error_type: "startup_failure".to_string(),
                        error_code: "agent_startup_failed".to_string(),
                    })
                    .await;
                workflow_analytics::track_agent_error(
                    self.analytics_service(),
                    session_id,
                    None,
                    None,
                    "agent_startup_failed",
                    None,
                );
                if track_source_message {
                    self.report_mention_failure(
                        session_id,
                        source_message.id,
                        &agent.name,
                        Some(agent_id),
                        format!("Failed to start agent run: {err}"),
                    )
                    .await;
                }
            }
            let _ = ChatSessionAgent::update_state(
                &self.db.pool,
                session_agent_id,
                ChatSessionAgentState::Dead,
            )
            .await;
            self.emit(
                session_id,
                ChatStreamEvent::AgentState {
                    session_agent_id,
                    agent_id,
                    state: ChatSessionAgentState::Dead,
                    run_id: Some(run_id),
                    started_at: None,
                },
            );
            workflow_analytics::track_agent_state_changed(
                self.analytics_service(),
                session_id,
                None,
                "dead",
            );
        }

        result
    }
}
