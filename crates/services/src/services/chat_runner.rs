use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::{Component, Path, PathBuf},
    str::FromStr,
    sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    },
};

use chrono::Utc;
use dashmap::DashMap;
use db::{
    DBService,
    models::{
        chat_agent::ChatAgent,
        chat_message::{ChatMessage, ChatSenderType},
        chat_run::{ChatRun, CreateChatRun},
        chat_session::ChatSession,
        chat_session_agent::{ChatSessionAgent, ChatSessionAgentState},
        chat_skill::ChatSkill,
        chat_work_item::{ChatWorkItem, ChatWorkItemType, CreateChatWorkItem},
    },
};
use executors::{
    approvals::NoopExecutorApprovalService,
    env::{ExecutionEnv, RepoContext},
    executors::{
        BaseCodingAgent, CancellationToken, ExecutorError, ExecutorExitSignal,
        StandardCodingAgentExecutor,
    },
    logs::{
        NormalizedEntryError, NormalizedEntryType, TokenUsageInfo,
        utils::patch::extract_normalized_entry_from_patch,
    },
    model_sync::with_model,
    profile::{ExecutorConfigs, ExecutorProfileId, canonical_variant_key},
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{
    fs,
    io::AsyncWriteExt,
    process::Command,
    sync::{Mutex, broadcast},
};
use tokio_util::io::ReaderStream;
use ts_rs::TS;
use utils::{
    assets::{asset_dir, config_path},
    log_msg::LogMsg,
    msg_store::MsgStore,
    process,
    utf8::Utf8LossyDecoder,
};
use uuid::Uuid;

use crate::services::{
    chat::{self, ChatServiceError},
    config::{self, UiLanguage, preset_loader::PresetLoader},
    native_skills::{NativeSkillError, list_native_skills_for_runner},
};

const UNTRACKED_FILE_LIMIT: u64 = 1024 * 1024;
const OPENTEAMS_HOME_DIR: &str = ".openteams";
const OPENTEAMS_WORKSPACE_DIR: &str = ".openteams";
const RUNS_DIR_NAME: &str = "runs";
const CONTEXT_DIR_NAME: &str = "context";
const LEGACY_COMPACTED_CONTEXT_FILE_NAME: &str = "messages_compacted.background.jsonl";
const RUN_RECORDS_DIR_NAME: &str = "run_records";
const SHARED_PROTOCOL_DIR_NAME: &str = "protocol";
const SHARED_BLACKBOARD_FILE_NAME: &str = "shared_blackboard.jsonl";
const WORK_RECORDS_FILE_NAME: &str = "work_records.jsonl";
const MARKDOWN_PROTOCOL_RECORD_RULE: &str = "Write only long-lived shared facts to shared_blackboard.jsonl. Do not write process descriptions, temporary status, or blockers.";
const MARKDOWN_PROTOCOL_ARTIFACT_RULE: &str =
    "Write only deliverable outputs or their concrete paths to work_records.jsonl.";
const MARKDOWN_PROTOCOL_CONCLUSION_RULE: &str = "Write only the current-turn work status to work_records.jsonl. Include completed work, blockers, or next steps. Do not write long-lived facts.";
const HISTORY_GROUP_MESSAGES_INSTRUCTION: &str = concat!(
    "If you need to understand the current group chat state, you MAY inspect this file yourself.\n",
    "Reading history is optional. Do not assume you must read history before acting.\n",
    "Prioritize reading history when the new message implies continuation or refinement, such as \"continue\", \"继续\", \"接着\", \"基于前文\", \"refine\", or \"update\".\n",
    "If the current task can be completed independently, you do not need to read history.\n",
);
const HISTORY_SHARED_BLACKBOARD_INSTRUCTION: &str = concat!(
    "You can search by member name to find shared messages published by a specific member.\n",
    "Before writing a record item, if you are unsure whether the fact was already captured, check this file first.\n",
);
const HISTORY_WORK_RECORDS_INSTRUCTION: &str = concat!(
    "You can search by member name to find a specific member's work outputs and status summaries.\n",
    "Use this file when you need to review what members have already completed.\n",
    "Before writing an artifact or conclusion item, if you are unsure whether similar work or status was already recorded, check this file first.\n",
);
const RESERVED_USER_HANDLE: &str = "you";
const PROTOCOL_SEND_INTENT_VALUES: &[&str] = &["request", "reply", "notify", "blocker", "confirm"];
const EXECUTOR_PROFILE_VARIANT_KEY: &str = "executor_profile_variant";
const EXECUTOR_GRACEFUL_STOP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const MARKDOWN_PROTOCOL_OUTPUT_EXAMPLE_JSON: &str = r#"[
  {"type": "send", "to": "you", "intent": "request", "content": "I have finished the front implementation"},
  {"type": "send", "to": "architect", "intent": "confirm", "content": "The UI is ready. Please confirm the API contract before I continue."},
  {"type": "record", "content": "The experiment metrics are `latency_p95_ms`, `success_rate`, and `token_cost_usd`."},
  {"type": "artifact", "content": "Saved the experiment plan to `docs/experiments/chat-metrics-plan.md`."},
  {"type": "conclusion", "content": "This round finished the metric definition. Next step is wiring collection into the runner."}
]"#;

struct DiffInfo {
    _truncated: bool,
}

struct ContextSnapshot {
    workspace_path: PathBuf,
    context_compacted: bool,
    compression_warning: Option<chat::CompressionWarning>,
}

struct ReferenceAttachment {
    name: String,
    mime_type: Option<String>,
    size_bytes: i64,
    kind: String,
    local_path: String,
}

struct ReferenceContext {
    message_id: Uuid,
    sender_label: String,
    sender_type: ChatSenderType,
    created_at: String,
    content: String,
    attachments: Vec<ReferenceAttachment>,
}

#[allow(dead_code)]
struct MessageAttachmentContext {
    attachments: Vec<ReferenceAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CompressionWarning {
    pub code: String,
    pub message: String,
    pub split_file_path: String,
}

impl From<chat::CompressionWarning> for CompressionWarning {
    fn from(value: chat::CompressionWarning) -> Self {
        Self {
            code: value.code,
            message: value.message,
            split_file_path: value.split_file_path,
        }
    }
}

#[derive(Debug, Serialize)]
struct SessionAgentSummary {
    session_agent_id: Uuid,
    agent_id: Uuid,
    name: String,
    runner_type: String,
    state: ChatSessionAgentState,
    /// Description of the agent for GROUP_MEMBERS display
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_prompt: Option<String>,
    tools_enabled: serde_json::Value,
    /// Skills that have been used by this agent
    skills_used: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AgentProtocolMessageType {
    Send,
    Record,
    #[serde(alias = "artiface", alias = "artefact")]
    Artifact,
    Conclusion,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentProtocolMessage {
    #[serde(rename = "type")]
    message_type: AgentProtocolMessageType,
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    intent: Option<String>,
    #[serde(default)]
    content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AgentProtocolError {
    code: ChatProtocolNoticeCode,
    target: Option<String>,
    detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct SharedBlackboardEntry {
    session_id: Uuid,
    run_id: Uuid,
    session_agent_id: Uuid,
    agent_id: Uuid,
    owner: String,
    message_type: &'static str,
    content: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize)]
struct WorkRecordEntry {
    session_id: Uuid,
    run_id: Uuid,
    session_agent_id: Uuid,
    agent_id: Uuid,
    owner: String,
    message_type: &'static str,
    content: String,
    created_at: String,
}

struct MessageSenderIdentity {
    label: String,
    address: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ResolvedPromptLanguage {
    setting: &'static str,
    code: &'static str,
    instruction: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MentionStatus {
    Received, // Message queued, waiting for agent to be available
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ChatProtocolNoticeCode {
    InvalidJson,
    NotJsonArray,
    EmptyMessage,
    MissingSendTarget,
    InvalidSendTarget,
    InvalidSendIntent,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum ChatStreamEvent {
    MessageNew {
        message: ChatMessage,
    },
    WorkItemNew {
        work_item: ChatWorkItem,
    },
    AgentDelta {
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        stream_type: ChatStreamDeltaType,
        content: String,
        delta: bool,
        is_final: bool,
    },
    AgentState {
        session_agent_id: Uuid,
        agent_id: Uuid,
        state: ChatSessionAgentState,
        started_at: Option<chrono::DateTime<Utc>>,
    },
    MentionAcknowledged {
        session_id: Uuid,
        message_id: Uuid,
        mentioned_agent: String,
        agent_id: Uuid,
        status: MentionStatus,
    },
    CompressionWarning {
        session_id: Uuid,
        warning: CompressionWarning,
    },
    ProtocolNotice {
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        agent_name: String,
        code: ChatProtocolNoticeCode,
        target: Option<String>,
        detail: Option<String>,
        output_is_empty: bool,
    },
    MentionError {
        session_id: Uuid,
        message_id: Uuid,
        agent_name: String,
        agent_id: Option<Uuid>,
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ChatStreamDeltaType {
    Assistant,
    Thinking,
    Error,
}

#[derive(Debug, Error)]
pub enum ChatRunnerError {
    #[error("chat agent not found: {0}")]
    AgentNotFound(String),
    #[error("unknown runner type: {0}")]
    UnknownRunnerType(String),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Executor(#[from] ExecutorError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    ChatService(#[from] ChatServiceError),
    #[error(transparent)]
    NativeSkills(#[from] NativeSkillError),
}

/// Pending message to be processed by an agent
#[derive(Clone, Debug)]
struct PendingMessage {
    session_id: Uuid,
    agent_id: Uuid,
    agent_name: String,
    message: ChatMessage,
}

#[derive(Clone)]
struct RunLifecycleControl {
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
    streams: Arc<DashMap<Uuid, broadcast::Sender<ChatStreamEvent>>>,
    // Store per-run lifecycle controls, key = session_agent_id
    run_controls: Arc<DashMap<Uuid, RunLifecycleControl>>,
    // Message queue for each session_agent, keyed by session_agent_id
    // When an agent is running, new messages are queued here and processed after completion
    pending_messages: Arc<DashMap<Uuid, VecDeque<PendingMessage>>>,
    // Session-level background context compaction dedupe.
    // At most one compaction task per session is allowed at a time.
    background_compaction_inflight: Arc<DashMap<Uuid, ()>>,
}

impl ChatRunner {
    pub fn new(db: DBService) -> Self {
        Self {
            db,
            streams: Arc::new(DashMap::new()),
            run_controls: Arc::new(DashMap::new()),
            pending_messages: Arc::new(DashMap::new()),
            background_compaction_inflight: Arc::new(DashMap::new()),
        }
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
            tracing::warn!(
                session_id = %recovered.session_id,
                session_agent_id = %recovered.id,
                agent_id = %recovered.agent_id,
                previous_state = ?session_agent.state,
                "Recovered orphaned chat session agent left active after backend interruption"
            );
        }

        Ok(active_agents.len())
    }

    pub fn subscribe(&self, session_id: Uuid) -> broadcast::Receiver<ChatStreamEvent> {
        self.sender_for(session_id).subscribe()
    }

    pub fn emit_message_new(&self, session_id: Uuid, message: ChatMessage) {
        self.emit(session_id, ChatStreamEvent::MessageNew { message });
    }

    pub fn emit_work_item_new(&self, session_id: Uuid, work_item: ChatWorkItem) {
        self.emit(session_id, ChatStreamEvent::WorkItemNew { work_item });
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
        let mentions = message.mentions.0.clone();
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

            let runner = self.clone();
            let message_clone = message.clone();
            tokio::spawn(async move {
                if let Err(err) = runner
                    .run_agent_for_mention(session_id, &mention, &message_clone)
                    .await
                {
                    tracing::warn!(
                        error = %err,
                        mention = mention,
                        session_id = %session_id,
                        "chat runner failed for mention"
                    );
                }
            });
        }
    }

    fn extract_chain_depth(&self, meta: &sqlx::types::Json<serde_json::Value>) -> u32 {
        meta.get("chain_depth")
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

    /// Process the next pending message for a session agent after it becomes idle
    async fn process_pending_queue(&self, session_id: Uuid, session_agent_id: Uuid) {
        // Get the next pending message from the queue
        let pending = self
            .pending_messages
            .get_mut(&session_agent_id)
            .and_then(|mut queue| queue.pop_front());

        if let Some(pending_msg) = pending {
            tracing::info!(
                session_agent_id = %session_agent_id,
                message_id = %pending_msg.message.id,
                agent_name = %pending_msg.agent_name,
                "processing queued message for agent"
            );

            // Process the queued message by calling run_agent_for_mention
            // Use the stored agent_name to find the agent (handles rename gracefully)
            if let Err(err) = self
                .run_agent_for_mention(
                    pending_msg.session_id,
                    &pending_msg.agent_name,
                    &pending_msg.message,
                )
                .await
            {
                tracing::warn!(
                    error = %err,
                    agent_name = %pending_msg.agent_name,
                    session_agent_id = %session_agent_id,
                    "failed to process queued message"
                );
                // Continue processing the rest of the queue
                Box::pin(self.process_pending_queue(session_id, session_agent_id)).await;
            }
        } else {
            // Clean up empty queue entry
            self.pending_messages.remove(&session_agent_id);
        }
    }

    /// Clear all pending messages for a session agent and mark them as failed
    /// Called when an agent fails/dies to prevent messages from being stuck
    async fn clear_pending_queue_on_failure(&self, _session_id: Uuid, session_agent_id: Uuid) {
        // Remove and get all pending messages for this agent
        let pending_messages = self.pending_messages.remove(&session_agent_id);

        if let Some((_, messages)) = pending_messages {
            for pending_msg in messages {
                tracing::info!(
                    session_agent_id = %session_agent_id,
                    message_id = %pending_msg.message.id,
                    agent_name = %pending_msg.agent_name,
                    "marking queued message as failed due to agent failure"
                );

                // Update message meta to show failed status
                self.update_mention_status(
                    pending_msg.message.id,
                    &pending_msg.agent_name,
                    "failed",
                )
                .await;

                // Emit failed event
                self.emit(
                    pending_msg.session_id,
                    ChatStreamEvent::MentionAcknowledged {
                        session_id: pending_msg.session_id,
                        message_id: pending_msg.message.id,
                        mentioned_agent: pending_msg.agent_name.clone(),
                        agent_id: pending_msg.agent_id,
                        status: MentionStatus::Failed,
                    },
                );
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
        if session_agents.is_empty() {
            return Ok(None);
        }

        let agents = ChatAgent::find_all(&self.db.pool).await?;
        let agent_map: HashMap<Uuid, ChatAgent> =
            agents.into_iter().map(|agent| (agent.id, agent)).collect();

        let mut exact_match: Option<(ChatSessionAgent, ChatAgent)> = None;
        let mut ci_match: Option<(ChatSessionAgent, ChatAgent)> = None;

        for session_agent in session_agents {
            let Some(agent) = agent_map.get(&session_agent.agent_id) else {
                tracing::warn!(
                    session_agent_id = %session_agent.id,
                    agent_id = %session_agent.agent_id,
                    "chat session agent missing backing agent"
                );
                continue;
            };

            if agent.name == mention {
                exact_match = Some((session_agent, agent.clone()));
                break;
            }

            if agent.name.eq_ignore_ascii_case(mention) {
                if ci_match.is_some() {
                    tracing::warn!(
                        session_id = %session_id,
                        mention = mention,
                        "multiple session agents matched mention; skipping"
                    );
                    return Ok(None);
                }
                ci_match = Some((session_agent, agent.clone()));
            }
        }

        let Some((session_agent, agent)) = exact_match.or(ci_match) else {
            return Ok(None);
        };

        if session_agent.workspace_path.is_none() {
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

        Ok(Some((session_agent, agent)))
    }

    async fn run_agent_for_mention(
        &self,
        session_id: Uuid,
        mention: &str,
        source_message: &ChatMessage,
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
                self.report_mention_failure(
                    session_id,
                    source_message.id,
                    mention,
                    None,
                    format!("Failed to resolve mentioned agent: {err}"),
                )
                .await;
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
                self.report_mention_failure(
                    session_id,
                    source_message.id,
                    &agent.name,
                    Some(agent.id),
                    "Agent is not configured in this session.",
                )
                .await;
                return Err(ChatRunnerError::AgentNotFound(mention.to_string()));
            }
            self.report_mention_failure(
                session_id,
                source_message.id,
                mention,
                None,
                "Mentioned agent was not found.",
            )
            .await;
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

        if matches!(
            session_agent.state,
            ChatSessionAgentState::Running | ChatSessionAgentState::Stopping
        ) {
            // Queue the message for later processing instead of skipping
            tracing::debug!(
                session_agent_id = %session_agent.id,
                agent_id = %agent.id,
                message_id = %source_message.id,
                state = ?session_agent.state,
                "chat session agent already active; queueing message for later"
            );

            let pending = PendingMessage {
                session_id,
                agent_id: agent.id,
                agent_name: agent.name.clone(),
                message: source_message.clone(),
            };

            self.pending_messages
                .entry(session_agent.id)
                .or_default()
                .push_back(pending);

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

            return Ok(());
        }

        let session_agent = if session_agent.state != ChatSessionAgentState::Running {
            ChatSessionAgent::update_state(
                &self.db.pool,
                session_agent.id,
                ChatSessionAgentState::Running,
            )
            .await?
        } else {
            session_agent
        };

        let session_agent_id = session_agent.id;
        let agent_id = agent.id;
        // Register the stop control before broadcasting the running state so an
        // immediate user stop request cannot miss the active run.
        let stop = self.register_run_control(session_agent_id);

        self.emit(
            session_id,
            ChatStreamEvent::AgentState {
                session_agent_id,
                agent_id,
                state: ChatSessionAgentState::Running,
                started_at: Some(session_agent.updated_at),
            },
        );

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

        let chain_depth = self.extract_chain_depth(&source_message.meta);

        let result = async {
            let workspace_path = self
                .resolve_workspace_path_for_agent(
                    session_id,
                    agent_id,
                    session_agent.workspace_path.clone(),
                )
                .await?;
            fs::create_dir_all(&workspace_path).await?;
            let run_records_dir = Self::workspace_run_records_dir(
                PathBuf::from(&workspace_path).as_path(),
                session_id,
            );
            fs::create_dir_all(&run_records_dir).await?;
            tracing::info!(
                session_id = %session_id,
                workspace_path = %workspace_path,
                runs_dir = %run_records_dir.display(),
                "Using workspace runs directory"
            );

            let run_index = ChatRun::next_run_index(&self.db.pool, session_agent_id).await?;
            let run_id = Uuid::new_v4();
            let run_dir =
                run_records_dir.join(Self::run_records_prefix(session_agent_id, run_index));
            fs::create_dir_all(&run_dir).await?;

            tracing::debug!(
                session_id = %session_id,
                run_id = %run_id,
                run_index = run_index,
                run_dir = %run_dir.display(),
                "[chat_runner] Created run directory for agent execution"
            );

            let input_path = run_dir.join("input.md");
            let output_path = run_dir.join("output.md");
            let raw_log_path = run_dir.join("raw.log");
            let meta_path = run_dir.join("meta.json");

            let context_snapshot = self
                .build_context_snapshot(session_id, &workspace_path)
                .await?;
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
            let message_attachments = self
                .build_message_attachment_context(source_message, &context_dir)
                .await?;
            let session_agents = self.build_session_agent_summaries(session_id).await?;

            // Resolve the enabled native skills allowed for this session member.
            let agent_skills = self
                .resolve_session_agent_skills(&session_agent, &agent)
                .await?;

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
                ui_config.chat_presets.team_protocol.as_deref(),
            );
            fs::write(&input_path, &prompt).await?;

            let _run = ChatRun::create(
                &self.db.pool,
                &CreateChatRun {
                    session_id,
                    session_agent_id,
                    run_index,
                    run_dir: run_dir.to_string_lossy().to_string(),
                    input_path: Some(input_path.to_string_lossy().to_string()),
                    output_path: Some(output_path.to_string_lossy().to_string()),
                    raw_log_path: Some(raw_log_path.to_string_lossy().to_string()),
                    meta_path: Some(meta_path.to_string_lossy().to_string()),
                },
                run_id,
            )
            .await?;

            let executor_profile_id = self.parse_executor_profile_id(&agent)?;
            let mut executor =
                ExecutorConfigs::get_cached().get_coding_agent_or_default(&executor_profile_id);
            executor.use_approvals(Arc::new(NoopExecutorApprovalService));

            if let Some(model_name) = &agent.model_name
                && let Some(executor_with_model) = with_model(&executor, model_name)
            {
                executor = executor_with_model;
            }

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

            let msg_store = Arc::new(MsgStore::new());
            let raw_log_file = Arc::new(Mutex::new(fs::File::create(&raw_log_path).await?));

            self.spawn_log_forwarders(&mut spawned.child, msg_store.clone(), raw_log_file);
            executor.normalize_logs(msg_store.clone(), PathBuf::from(&workspace_path).as_path());

            let completion_status = Arc::new(AtomicU8::new(RunCompletionStatus::Succeeded.as_u8()));

            self.spawn_stream_bridge(
                msg_store.clone(),
                session_id,
                agent_id,
                session_agent_id,
                run_id,
                output_path,
                meta_path,
                PathBuf::from(&workspace_path),
                run_dir,
                completion_status.clone(),
                chain_depth,
                context_snapshot.context_compacted,
                context_snapshot.compression_warning.clone(),
                self.clone(),
                source_message.id,
                agent.name.clone(),
                prompt_language,
            );

            self.spawn_exit_watcher(
                runtime::ExitWatcherArgs {
                    child: spawned.child,
                    stop,
                    executor_cancel: spawned.cancel,
                    exit_signal: spawned.exit_signal,
                    msg_store,
                    completion_status,
                },
                session_agent_id,
            );

            Ok::<(), ChatRunnerError>(())
        }
        .await;

        if result.is_err() {
            self.run_controls.remove(&session_agent_id);
            if let Err(err) = &result {
                self.report_mention_failure(
                    session_id,
                    source_message.id,
                    &agent.name,
                    Some(agent_id),
                    format!("Failed to start agent run: {err}"),
                )
                .await;
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
                    started_at: None,
                },
            );
        }

        result
    }
}

mod prompting;
mod protocol;
mod runtime;

#[cfg(test)]
mod tests;
