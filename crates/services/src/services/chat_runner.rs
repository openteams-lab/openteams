use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::{Component, Path, PathBuf},
    str::FromStr,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
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
        NormalizedEntryType, TokenUsageInfo, utils::patch::extract_normalized_entry_from_patch,
    },
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
    utf8::Utf8LossyDecoder,
};
use uuid::Uuid;

use crate::services::{
    chat::{self, ChatServiceError},
    config::{self, UiLanguage, preset_loader::PresetLoader},
    native_skills::{NativeSkillError, list_native_skills_for_runner},
};

const UNTRACKED_FILE_LIMIT: u64 = 1024 * 1024;
const MAX_AGENT_CHAIN_DEPTH: u32 = 5;
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
const MARKDOWN_PROTOCOL_OUTPUT_EXAMPLE_JSON: &str = r#"[
  {"type": "send", "to": "you", "intent": "request", "content": "I have finished the front implementation"},
  {"type": "send", "to": "architect", "intent": "confirm", "content": "The UI is ready. Please confirm the API contract before I continue."},
  {"type": "record", "content": "The experiment metrics are `latency_p95_ms`, `success_rate`, and `token_cost_usd`."},
  {"type": "artifact", "content": "Saved the experiment plan to `docs/experiments/chat-metrics-plan.md`."},
  {"type": "conclusion", "content": "This round finished the metric definition. Next step is wiring collection into the runner."}
]"#;

struct DiffInfo {
    truncated: bool,
}

struct ContextSnapshot {
    workspace_path: PathBuf,
    run_path: PathBuf,
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

struct MessageAttachmentContext {
    message_id: Uuid,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ChatStreamDeltaType {
    Assistant,
    Thinking,
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
pub struct ChatRunner {
    db: DBService,
    streams: Arc<DashMap<Uuid, broadcast::Sender<ChatStreamEvent>>>,
    // Store cancellation tokens for graceful shutdown, key = session_agent_id
    cancellation_tokens: Arc<DashMap<Uuid, CancellationToken>>,
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
            cancellation_tokens: Arc::new(DashMap::new()),
            pending_messages: Arc::new(DashMap::new()),
            background_compaction_inflight: Arc::new(DashMap::new()),
        }
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
            compact_reason
        };

        self.set_mention_status(
            session_id,
            message_id,
            agent_name,
            agent_id,
            MentionStatus::Failed,
        )
        .await;

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
        if chain_depth >= MAX_AGENT_CHAIN_DEPTH {
            tracing::warn!(
                session_id = %session.id,
                chain_depth = chain_depth,
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
            let workspace_path = self.build_workspace_path(session_id, agent.id);
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

        if session_agent.state == ChatSessionAgentState::Running {
            // Queue the message for later processing instead of skipping
            tracing::debug!(
                session_agent_id = %session_agent.id,
                agent_id = %agent.id,
                message_id = %source_message.id,
                "chat session agent already running; queueing message for later"
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

        self.emit(
            session_id,
            ChatStreamEvent::AgentState {
                session_agent_id: session_agent.id,
                agent_id: agent.id,
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

        let session_agent_id = session_agent.id;
        let agent_id = agent.id;

        let chain_depth = self.extract_chain_depth(&source_message.meta);

        let result = async {
            let workspace_path = session_agent
                .workspace_path
                .clone()
                .unwrap_or_else(|| self.build_workspace_path(session_id, agent_id));
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

            let input_path = run_dir.join("input.md");
            let output_path = run_dir.join("output.md");
            let raw_log_path = run_dir.join("raw.log");
            let meta_path = run_dir.join("meta.json");

            let context_snapshot = self
                .build_context_snapshot(session_id, &workspace_path, &run_dir)
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
            env.insert(
                "VK_CHAT_CONTEXT_RUN_PATH",
                context_snapshot.run_path.to_string_lossy().to_string(),
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

            let failed_flag = Arc::new(AtomicBool::new(false));

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
                failed_flag.clone(),
                chain_depth,
                context_snapshot.context_compacted,
                context_snapshot.compression_warning.clone(),
                self.clone(),
                source_message.id,
                agent.name.clone(),
                prompt_language,
            );

            self.spawn_exit_watcher(
                spawned.child,
                spawned.cancel,
                spawned.exit_signal,
                msg_store,
                failed_flag,
                session_agent_id,
            );

            Ok::<(), ChatRunnerError>(())
        }
        .await;

        if result.is_err() {
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

    fn build_workspace_path(&self, session_id: Uuid, agent_id: Uuid) -> String {
        asset_dir()
            .join("chat")
            .join(format!("session_{session_id}"))
            .join("agents")
            .join(agent_id.to_string())
            .to_string_lossy()
            .to_string()
    }

    fn workspace_runs_dir(workspace_path: &Path, session_id: Uuid) -> PathBuf {
        workspace_path
            .join(OPENTEAMS_WORKSPACE_DIR)
            .join(RUNS_DIR_NAME)
            .join(session_id.to_string())
    }

    fn workspace_run_records_dir(workspace_path: &Path, session_id: Uuid) -> PathBuf {
        Self::workspace_runs_dir(workspace_path, session_id).join(RUN_RECORDS_DIR_NAME)
    }

    fn run_records_prefix(session_agent_id: Uuid, run_index: i64) -> String {
        format!("session_agent_{session_agent_id}_run_{run_index:04}")
    }

    fn session_protocol_dir(session_id: Uuid) -> PathBuf {
        asset_dir()
            .join("chat")
            .join(format!("session_{session_id}"))
            .join(SHARED_PROTOCOL_DIR_NAME)
    }

    fn session_shared_blackboard_path(session_id: Uuid) -> PathBuf {
        Self::session_protocol_dir(session_id).join(SHARED_BLACKBOARD_FILE_NAME)
    }

    fn session_work_records_path(session_id: Uuid) -> PathBuf {
        Self::session_protocol_dir(session_id).join(WORK_RECORDS_FILE_NAME)
    }

    async fn sync_protocol_context_files(
        session_id: Uuid,
        context_dir: &Path,
    ) -> Result<(), ChatRunnerError> {
        let protocol_dir = Self::session_protocol_dir(session_id);
        fs::create_dir_all(&protocol_dir).await?;

        for (canonical, dest_name) in [
            (
                Self::session_shared_blackboard_path(session_id),
                SHARED_BLACKBOARD_FILE_NAME,
            ),
            (
                Self::session_work_records_path(session_id),
                WORK_RECORDS_FILE_NAME,
            ),
        ] {
            if fs::metadata(&canonical).await.is_err() {
                fs::write(&canonical, "").await?;
            }
            let contents = fs::read(&canonical).await.unwrap_or_default();
            fs::write(context_dir.join(dest_name), contents).await?;
        }

        Ok(())
    }

    async fn append_jsonl_line<T: Serialize>(
        path: &Path,
        value: &T,
    ) -> Result<(), ChatRunnerError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .await?;
        let line = serde_json::to_string(value)?;
        file.write_all(line.as_bytes()).await?;
        file.write_all(b"\n").await?;
        Ok(())
    }

    fn parse_runner_type(&self, agent: &ChatAgent) -> Result<BaseCodingAgent, ChatRunnerError> {
        let raw = agent.runner_type.trim();
        let normalized = raw.replace(['-', ' '], "_").to_ascii_uppercase();
        BaseCodingAgent::from_str(&normalized)
            .map_err(|_| ChatRunnerError::UnknownRunnerType(raw.to_string()))
    }

    async fn resolve_session_agent_skills(
        &self,
        session_agent: &ChatSessionAgent,
        agent: &ChatAgent,
    ) -> Result<Vec<ChatSkill>, ChatRunnerError> {
        let runner_type = self.parse_runner_type(agent)?;
        let allowed_skill_ids = session_agent
            .allowed_skill_ids
            .0
            .iter()
            .map(|skill_id| skill_id.trim().to_string())
            .filter(|skill_id| !skill_id.is_empty())
            .collect::<HashSet<_>>();

        if allowed_skill_ids.is_empty() {
            return Ok(Vec::new());
        }

        let skills = list_native_skills_for_runner(&self.db.pool, runner_type)
            .await?
            .into_iter()
            .filter(|item| item.enabled)
            .filter(|item| allowed_skill_ids.contains(&item.skill.id.to_string()))
            .map(|item| item.skill)
            .collect();

        Ok(skills)
    }

    fn parse_executor_profile_id(
        &self,
        agent: &ChatAgent,
    ) -> Result<ExecutorProfileId, ChatRunnerError> {
        let executor = self.parse_runner_type(agent)?;
        let variant = Self::extract_executor_profile_variant(&agent.tools_enabled.0);
        Ok(match variant {
            Some(variant) => ExecutorProfileId::with_variant(executor, variant),
            None => ExecutorProfileId::new(executor),
        })
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

    fn sanitize_sender_token(value: &str, fallback: &str) -> String {
        let sanitized = value
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
            .collect::<String>();
        if sanitized.is_empty() {
            fallback.to_string()
        } else {
            sanitized
        }
    }

    fn resolve_message_sender_identity(message: &ChatMessage) -> MessageSenderIdentity {
        let sender_meta = message.meta.0.get("sender");
        let structured_meta = message.meta.0.get("structured");

        let user_handle = message
            .meta
            .0
            .get("sender_handle")
            .and_then(|value| value.as_str())
            .or_else(|| {
                sender_meta
                    .and_then(|value| value.get("handle"))
                    .and_then(|value| value.as_str())
            })
            .or_else(|| {
                structured_meta
                    .and_then(|value| value.get("sender_handle"))
                    .and_then(|value| value.as_str())
            });

        let agent_label = sender_meta
            .and_then(|value| value.get("name").and_then(|name| name.as_str()))
            .or_else(|| {
                sender_meta.and_then(|value| value.get("label").and_then(|label| label.as_str()))
            })
            .or_else(|| {
                structured_meta
                    .and_then(|value| value.get("sender_label").and_then(|label| label.as_str()))
            });

        match message.sender_type {
            ChatSenderType::User => {
                let label = Self::sanitize_sender_token(user_handle.unwrap_or("you"), "you");
                MessageSenderIdentity {
                    address: format!("user:{label}"),
                    label,
                }
            }
            ChatSenderType::Agent => {
                let label = Self::sanitize_sender_token(agent_label.unwrap_or("agent"), "agent");
                MessageSenderIdentity {
                    address: format!("agent:{label}"),
                    label,
                }
            }
            ChatSenderType::System => MessageSenderIdentity {
                address: "system".to_string(),
                label: "system".to_string(),
            },
        }
    }

    async fn capture_git_diff(workspace_path: &Path, run_dir: &Path) -> Option<DiffInfo> {
        let check = Command::new("git")
            .arg("-C")
            .arg(workspace_path)
            .args(["rev-parse", "--is-inside-work-tree"])
            .output()
            .await
            .ok()?;

        if !check.status.success() {
            return None;
        }

        let status = Command::new("git")
            .arg("-C")
            .arg(workspace_path)
            .args(["status", "--porcelain"])
            .output()
            .await
            .ok()?;

        if !status.status.success() {
            return None;
        }

        let status_text = String::from_utf8_lossy(&status.stdout);
        let has_tracked_changes = status_text.lines().any(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty() && !trimmed.starts_with("??")
        });

        if !has_tracked_changes {
            return None;
        }

        let output = Command::new("git")
            .arg("-C")
            .arg(workspace_path)
            .args(["diff", "--no-color"])
            .output()
            .await
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let diff = String::from_utf8_lossy(&output.stdout).to_string();
        if diff.trim().is_empty() {
            return None;
        }

        let diff_path = run_dir.join("diff.patch");
        if let Err(err) = fs::write(&diff_path, &diff).await {
            tracing::warn!("Failed to write diff patch: {}", err);
            return None;
        }

        // Consider diff truncated if it's over 4KB (for UI display purposes)
        let truncated = diff.len() > 4000;

        Some(DiffInfo { truncated })
    }

    async fn capture_untracked_files(workspace_path: &Path, run_dir: &Path) -> Vec<String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(workspace_path)
            .args([
                "-c",
                "core.quotePath=false",
                "ls-files",
                "--others",
                "--exclude-standard",
                "-z",
            ])
            .output()
            .await;

        let output = match output {
            Ok(output) if output.status.success() => output,
            _ => return Vec::new(),
        };

        let mut files = Vec::new();
        let untracked_dir = run_dir.join("untracked");

        for raw in output.stdout.split(|b| *b == b'\0') {
            if raw.is_empty() {
                continue;
            }
            let rel = String::from_utf8_lossy(raw).to_string();
            let rel_path = PathBuf::from(&rel);
            if rel_path.is_absolute()
                || rel_path
                    .components()
                    .any(|component| matches!(component, std::path::Component::ParentDir))
            {
                continue;
            }
            let first_component =
                rel_path
                    .components()
                    .next()
                    .and_then(|component| match component {
                        Component::Normal(part) => Some(part.to_string_lossy()),
                        _ => None,
                    });
            if let Some(first) = first_component
                && (first == OPENTEAMS_HOME_DIR || first == OPENTEAMS_WORKSPACE_DIR)
            {
                // Skip internal runtime artifacts generated by chat context snapshots.
                continue;
            }

            let src = workspace_path.join(&rel_path);
            let dest = untracked_dir.join(&rel_path);

            if let Some(parent) = dest.parent()
                && let Err(err) = fs::create_dir_all(parent).await
            {
                tracing::warn!("Failed to create untracked dir: {}", err);
                continue;
            }

            match fs::metadata(&src).await {
                Ok(metadata) => {
                    if metadata.len() > UNTRACKED_FILE_LIMIT {
                        let placeholder =
                            format!("File too large to display ({} bytes).", metadata.len());
                        let _ = fs::write(&dest, placeholder).await;
                    } else if let Ok(bytes) = fs::read(&src).await {
                        let content = String::from_utf8_lossy(&bytes).to_string();
                        let _ = fs::write(&dest, content).await;
                    }
                }
                Err(err) => {
                    tracing::warn!("Failed to read untracked file {}: {}", rel, err);
                }
            }

            files.push(rel_path.to_string_lossy().to_string());
        }

        files
    }

    async fn build_context_snapshot(
        &self,
        session_id: Uuid,
        workspace_path: &str,
        run_dir: &Path,
    ) -> Result<ContextSnapshot, ChatRunnerError> {
        // Create context directory first (needed for cutoff files)
        let context_dir = PathBuf::from(workspace_path)
            .join(OPENTEAMS_WORKSPACE_DIR)
            .join(CONTEXT_DIR_NAME)
            .join(session_id.to_string());
        fs::create_dir_all(&context_dir).await?;
        let legacy_compacted_context_path = context_dir.join(LEGACY_COMPACTED_CONTEXT_FILE_NAME);
        if let Err(err) = fs::remove_file(&legacy_compacted_context_path).await
            && err.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(
                session_id = %session_id,
                error = %err,
                path = %legacy_compacted_context_path.display(),
                "Failed to remove legacy background compacted context file"
            );
        }

        // Main path must never block on summarization: always build full context synchronously.
        let full_context =
            crate::services::chat::build_full_context(&self.db.pool, session_id).await?;
        let jsonl = full_context.jsonl;
        let context_path = context_dir.join("messages.jsonl");
        fs::write(&context_path, jsonl.as_bytes()).await?;
        Self::sync_protocol_context_files(session_id, &context_dir).await?;
        tracing::info!(
            session_id = %session_id,
            workspace_path = %workspace_path,
            context_path = %context_path.display(),
            "Using workspace context (full, non-blocking)"
        );

        // Kick off background compaction for future runs, without blocking current run.
        self.spawn_background_context_compaction(
            session_id,
            workspace_path.to_string(),
            context_dir.clone(),
        );

        fs::create_dir_all(run_dir).await?;
        let run_context_path = run_dir.join("context.jsonl");
        fs::write(&run_context_path, jsonl.as_bytes()).await?;

        Ok(ContextSnapshot {
            workspace_path: context_path,
            run_path: run_context_path,
            context_compacted: false,
            compression_warning: None,
        })
    }

    fn spawn_background_context_compaction(
        &self,
        session_id: Uuid,
        workspace_path: String,
        context_dir: PathBuf,
    ) {
        if self
            .background_compaction_inflight
            .contains_key(&session_id)
        {
            return;
        }
        self.background_compaction_inflight.insert(session_id, ());

        let runner = self.clone();
        tokio::spawn(async move {
            let workspace_path_buf = PathBuf::from(&workspace_path);
            let result = crate::services::chat::build_compacted_context(
                &runner.db.pool,
                session_id,
                None,
                Some(workspace_path_buf.as_path()),
                Some(context_dir.as_path()),
            )
            .await;

            match result {
                Ok(compacted) => {
                    if compacted.context_compacted {
                        let workspace_context_path = context_dir.join("messages.jsonl");
                        if let Err(err) =
                            fs::write(&workspace_context_path, compacted.jsonl.as_bytes()).await
                        {
                            tracing::warn!(
                                session_id = %session_id,
                                error = %err,
                                path = %workspace_context_path.display(),
                                "Failed to update workspace context with compacted history"
                            );
                        } else {
                            tracing::info!(
                                session_id = %session_id,
                                path = %workspace_context_path.display(),
                                compacted_message_count = compacted.messages.len(),
                                "Background context compaction completed and updated workspace context"
                            );
                        }
                    }

                    if let Some(warning) = compacted.compression_warning {
                        runner.emit(
                            session_id,
                            ChatStreamEvent::CompressionWarning {
                                session_id,
                                warning: warning.into(),
                            },
                        );
                    }
                }
                Err(err) => {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %err,
                        "Background context compaction failed"
                    );
                }
            }

            runner.background_compaction_inflight.remove(&session_id);
        });
    }

    async fn build_reference_context(
        &self,
        session_id: Uuid,
        source_message: &ChatMessage,
        context_dir: &Path,
    ) -> Result<Option<ReferenceContext>, ChatRunnerError> {
        let Some(reference_id) = chat::extract_reference_message_id(&source_message.meta.0) else {
            return Ok(None);
        };

        let Some(reference) = ChatMessage::find_by_id(&self.db.pool, reference_id).await? else {
            return Ok(None);
        };

        if reference.session_id != session_id {
            return Ok(None);
        }

        let sender_label = reference
            .meta
            .0
            .get("sender")
            .and_then(|value| value.get("label"))
            .and_then(|value| value.as_str())
            .unwrap_or("unknown")
            .to_string();

        let attachments = chat::extract_attachments(&reference.meta.0);
        let mut reference_attachments = Vec::new();

        if !attachments.is_empty() {
            let reference_dir = context_dir
                .join("references")
                .join(reference_id.to_string());
            fs::create_dir_all(&reference_dir).await?;

            for attachment in attachments {
                let relative = PathBuf::from(&attachment.relative_path);
                if relative.is_absolute()
                    || relative
                        .components()
                        .any(|component| matches!(component, Component::ParentDir))
                {
                    continue;
                }

                let source_path = asset_dir().join(&relative);
                let file_name = source_path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| attachment.name.clone());
                let dest_path = reference_dir.join(&file_name);
                let local_path = if fs::copy(&source_path, &dest_path).await.is_ok() {
                    dest_path.to_string_lossy().to_string()
                } else {
                    source_path.to_string_lossy().to_string()
                };

                reference_attachments.push(ReferenceAttachment {
                    name: attachment.name,
                    mime_type: attachment.mime_type,
                    size_bytes: attachment.size_bytes,
                    kind: attachment.kind,
                    local_path,
                });
            }
        }

        Ok(Some(ReferenceContext {
            message_id: reference.id,
            sender_label,
            sender_type: reference.sender_type,
            created_at: reference.created_at.to_rfc3339(),
            content: reference.content,
            attachments: reference_attachments,
        }))
    }

    async fn build_message_attachment_context(
        &self,
        source_message: &ChatMessage,
        context_dir: &Path,
    ) -> Result<Option<MessageAttachmentContext>, ChatRunnerError> {
        let attachments = chat::extract_attachments(&source_message.meta.0);
        if attachments.is_empty() {
            return Ok(None);
        }

        let message_dir = context_dir
            .join("attachments")
            .join(source_message.id.to_string());
        fs::create_dir_all(&message_dir).await?;

        let mut message_attachments = Vec::new();
        for attachment in attachments {
            let relative = PathBuf::from(&attachment.relative_path);
            if relative.is_absolute()
                || relative
                    .components()
                    .any(|component| matches!(component, Component::ParentDir))
            {
                continue;
            }

            let source_path = asset_dir().join(&relative);
            let file_name = source_path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| attachment.name.clone());
            let dest_path = message_dir.join(&file_name);
            let local_path = if fs::copy(&source_path, &dest_path).await.is_ok() {
                dest_path.to_string_lossy().to_string()
            } else {
                source_path.to_string_lossy().to_string()
            };

            message_attachments.push(ReferenceAttachment {
                name: attachment.name,
                mime_type: attachment.mime_type,
                size_bytes: attachment.size_bytes,
                kind: attachment.kind,
                local_path,
            });
        }

        Ok(Some(MessageAttachmentContext {
            message_id: source_message.id,
            attachments: message_attachments,
        }))
    }

    async fn build_session_agent_summaries(
        &self,
        session_id: Uuid,
    ) -> Result<Vec<SessionAgentSummary>, ChatRunnerError> {
        let session_agents =
            ChatSessionAgent::find_all_for_session(&self.db.pool, session_id).await?;
        if session_agents.is_empty() {
            return Ok(Vec::new());
        }

        let agents = ChatAgent::find_all(&self.db.pool).await?;
        let agent_map: HashMap<Uuid, ChatAgent> =
            agents.into_iter().map(|agent| (agent.id, agent)).collect();

        let mut summaries = Vec::with_capacity(session_agents.len());
        for session_agent in session_agents {
            let Some(agent) = agent_map.get(&session_agent.agent_id) else {
                tracing::warn!(
                    session_agent_id = %session_agent.id,
                    agent_id = %session_agent.agent_id,
                    "chat session agent missing backing agent"
                );
                continue;
            };
            let system_prompt = agent.system_prompt.trim();
            // Extract description from first line of system prompt or use agent name
            let description = if !system_prompt.is_empty() {
                system_prompt
                    .lines()
                    .next()
                    .map(|line| line.trim().to_string())
                    .filter(|s| !s.is_empty())
            } else {
                None
            };
            let agent_skills = self
                .resolve_session_agent_skills(&session_agent, agent)
                .await
                .unwrap_or_default();
            let skills_used: Vec<String> = agent_skills
                .iter()
                .map(|skill| skill.name.clone())
                .collect();

            summaries.push(SessionAgentSummary {
                session_agent_id: session_agent.id,
                agent_id: agent.id,
                name: agent.name.clone(),
                runner_type: agent.runner_type.clone(),
                state: session_agent.state,
                description,
                system_prompt: if system_prompt.is_empty() {
                    None
                } else {
                    Some(system_prompt.to_string())
                },
                tools_enabled: agent.tools_enabled.0.clone(),
                skills_used,
            });
        }

        Ok(summaries)
    }

    /// Escape special characters for TOML string values
    fn escape_toml_string(s: &str) -> String {
        s.replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
            .replace('\t', "\\t")
    }
    #[cfg_attr(not(test), allow(dead_code))]
    /// Build the system prompt using Markdown sections while preserving all protocol fields.
    fn build_system_prompt_markdown(
        agent: &ChatAgent,
        session_agents: &[SessionAgentSummary],
        context_dir: &Path,
        skills: &[ChatSkill],
        user_message_content: Option<&str>,
        prompt_language: ResolvedPromptLanguage,
        team_protocol: Option<&str>,
    ) -> String {
        let mut markdown = String::new();
        let messages_path = context_dir.join("messages.jsonl");
        let shared_blackboard_path = context_dir.join(SHARED_BLACKBOARD_FILE_NAME);
        let work_records_path = context_dir.join(WORK_RECORDS_FILE_NAME);
        let visible_members = session_agents
            .iter()
            .filter(|member| member.agent_id != agent.id)
            .collect::<Vec<_>>();

        Self::push_markdown_section(&mut markdown, 1, "ChatGroup Protocol");
        Self::push_markdown_field(&mut markdown, "PROTOCOL_VERSION", "chatgroup_markdown_v1");

        Self::push_markdown_section(&mut markdown, 2, "agent.role");
        Self::push_markdown_field(&mut markdown, "name", &agent.name);
        let normalized_system_prompt =
            Self::strip_embedded_team_protocol_from_system_prompt(&agent.system_prompt);
        if !normalized_system_prompt.is_empty() {
            Self::push_markdown_block_field(
                &mut markdown,
                "role",
                &normalized_system_prompt,
                "text",
            );
        }

        let active_skills = Self::filter_active_skills(skills, user_message_content);
        Self::push_markdown_section(&mut markdown, 2, "agent.skills");
        if active_skills.is_empty() {
            Self::push_markdown_field(
                &mut markdown,
                "restriction",
                "You have no skills enabled. Do not attempt to use any skill.",
            );
        } else {
            Self::push_markdown_block_field(
                &mut markdown,
                "restriction",
                concat!(
                    "Skills are available as local files in ~/.agents/skills and companion directories.\n",
                    "You can ONLY use the skills listed below. Do not invent or use unlisted skills.\n",
                ),
                "text",
            );
            for (index, skill) in active_skills.iter().enumerate() {
                Self::push_markdown_section(
                    &mut markdown,
                    3,
                    &format!("agent.skills.allowed item {}", index + 1),
                );
                Self::push_markdown_field(&mut markdown, "name", &skill.name);
                Self::push_markdown_field(&mut markdown, "description", &skill.description);
            }
        }

        Self::push_markdown_section(&mut markdown, 2, "group");
        Self::push_markdown_field(
            &mut markdown,
            "members_description",
            "Other AI members currently in this group",
        );
        if visible_members.is_empty() {
            markdown.push_str("_No other AI members._\n\n");
        } else {
            for (index, member) in visible_members.iter().enumerate() {
                Self::push_markdown_section(
                    &mut markdown,
                    3,
                    &format!("group.members item {}", index + 1),
                );
                Self::push_markdown_field(&mut markdown, "name", &member.name);
                let responsibility = member.description.as_deref().unwrap_or("AI assistant");
                Self::push_markdown_field(&mut markdown, "responsibility", responsibility);
                Self::push_markdown_field(&mut markdown, "state", &format!("{:?}", member.state));
                Self::push_markdown_json_field(&mut markdown, "skills_used", &member.skills_used);
            }
        }

        Self::push_markdown_section(&mut markdown, 2, "history.group_messages");
        Self::push_markdown_field(&mut markdown, "path", &messages_path.to_string_lossy());
        Self::push_markdown_field(&mut markdown, "format", "jsonl");
        Self::push_markdown_field(
            &mut markdown,
            "description",
            "Group chat history. Each line is a JSON message record containing sender and content, consistent with messages.jsonl history.",
        );
        Self::push_markdown_bool_field(&mut markdown, "optional", true);
        Self::push_markdown_block_field(
            &mut markdown,
            "instruction",
            HISTORY_GROUP_MESSAGES_INSTRUCTION,
            "text",
        );

        Self::push_markdown_section(&mut markdown, 2, "history.shared_blackboard");
        Self::push_markdown_field(
            &mut markdown,
            "path",
            &shared_blackboard_path.to_string_lossy(),
        );
        Self::push_markdown_field(&mut markdown, "format", "jsonl");
        Self::push_markdown_field(
            &mut markdown,
            "description",
            "Persisted shared messages generated from record items.",
        );
        Self::push_markdown_field(
            &mut markdown,
            "instruction",
            HISTORY_SHARED_BLACKBOARD_INSTRUCTION,
        );

        Self::push_markdown_section(&mut markdown, 2, "history.work_records");
        Self::push_markdown_field(&mut markdown, "path", &work_records_path.to_string_lossy());
        Self::push_markdown_field(&mut markdown, "format", "jsonl");
        Self::push_markdown_field(
            &mut markdown,
            "description",
            "Persisted work outputs and summaries generated from artifact/conclusion items.",
        );
        Self::push_markdown_field(
            &mut markdown,
            "instruction",
            HISTORY_WORK_RECORDS_INSTRUCTION,
        );

        Self::push_markdown_section(&mut markdown, 2, "output");
        Self::push_markdown_bool_field(&mut markdown, "required", true);
        Self::push_markdown_field(&mut markdown, "format", "json");
        Self::push_markdown_field(&mut markdown, "container", "list");
        Self::push_markdown_bool_field(&mut markdown, "only_send_items_enter_group_history", true);
        Self::push_markdown_block_field(
            &mut markdown,
            "instruction",
            concat!(
                "Return ONLY a valid JSON array.\n",
                "Do not wrap the JSON array in prose or markdown unless your runner forces code fences.\n",
                "Your final reply MUST be parseable by a standard JSON parser.\n",
                "Escape all double quotes, backslashes, and newlines inside JSON string values.\n",
                "Before sending, verify that every `content` value is still a valid JSON string after escaping.\n",
                "Only send items will be turned into visible group chat messages and written into group history.\n",
                "The current agent is always recorded as the sender automatically. Do not impersonate other senders.\n",
                "Do not discuss anything unrelated to the assigned work. Keep every reply concise, precise, and free of filler.\n",
                "Use `to = \\\"you\\\"` when sending a message to the user. Here `you` refers to the human user.\n",
                "For send items, `intent` is optional but recommended when the routing semantics matter.\n",
            ),
            "text",
        );
        let mut allowed_targets: Vec<&str> = visible_members
            .iter()
            .map(|member| member.name.as_str())
            .collect();
        allowed_targets.push(RESERVED_USER_HANDLE);
        Self::push_markdown_json_field(&mut markdown, "allowed_targets", &allowed_targets);

        Self::push_markdown_section(&mut markdown, 3, "output.message_types item 1");
        Self::push_markdown_field(&mut markdown, "type", "send");
        Self::push_markdown_json_field(
            &mut markdown,
            "required_fields",
            &["type", "to", "content"],
        );
        Self::push_markdown_json_field(&mut markdown, "optional_fields", &["intent"]);
        Self::push_markdown_block_field(
            &mut markdown,
            "rules",
            concat!(
                "- A send item targets exactly one receiver.\n",
                "- Use concise language with a clear goal.\n",
                "- Content may be empty.\n",
                "- Prefer setting `intent` for machine-readable routing semantics.\n",
                "- Optional `intent` values for send items: `request` = ask for work or information; `reply` = the receiver should reply; `notify` = informational only, no reply required; `blocker` = report a blocking issue; `confirm` = explicit confirmation is required.\n",
                "- The system will render the final group message as `@receiver content` and route it to that receiver.\n",
            ),
            "text",
        );

        Self::push_markdown_section(&mut markdown, 3, "output.message_types item 2");
        Self::push_markdown_field(&mut markdown, "type", "record");
        Self::push_markdown_bool_field(&mut markdown, "required", false);
        Self::push_markdown_json_field(&mut markdown, "required_fields", &["type", "content"]);
        Self::push_markdown_field(&mut markdown, "rules", MARKDOWN_PROTOCOL_RECORD_RULE);

        Self::push_markdown_section(&mut markdown, 3, "output.message_types item 3");
        Self::push_markdown_field(&mut markdown, "type", "artifact");
        Self::push_markdown_bool_field(&mut markdown, "required", false);
        Self::push_markdown_json_field(&mut markdown, "required_fields", &["type", "content"]);
        Self::push_markdown_field(&mut markdown, "rules", MARKDOWN_PROTOCOL_ARTIFACT_RULE);

        Self::push_markdown_section(&mut markdown, 3, "output.message_types item 4");
        Self::push_markdown_field(&mut markdown, "type", "conclusion");
        Self::push_markdown_bool_field(&mut markdown, "required", false);
        Self::push_markdown_json_field(&mut markdown, "required_fields", &["type", "content"]);
        Self::push_markdown_field(&mut markdown, "rules", MARKDOWN_PROTOCOL_CONCLUSION_RULE);

        Self::push_markdown_section(&mut markdown, 2, "output.example");
        Self::push_markdown_block_field(
            &mut markdown,
            "json",
            MARKDOWN_PROTOCOL_OUTPUT_EXAMPLE_JSON,
            "json",
        );

        Self::push_markdown_section(&mut markdown, 2, "language");
        Self::push_markdown_field(&mut markdown, "setting", prompt_language.setting);
        Self::push_markdown_field(&mut markdown, "instruction", prompt_language.instruction);

        Self::set_trailing_newlines(&mut markdown, 3);
        Self::push_markdown_section(&mut markdown, 2, "team.protocol");
        Self::push_markdown_bool_field(
            &mut markdown,
            "configured",
            team_protocol.is_some_and(|content| !content.trim().is_empty()),
        );
        Self::push_markdown_block_field(
            &mut markdown,
            "guidelines",
            &Self::resolve_team_protocol_guidelines(team_protocol),
            "text",
        );

        markdown
    }

    /// Build the user message prompt using Markdown sections while preserving all protocol fields.
    #[allow(dead_code)]
    #[allow(clippy::too_many_arguments)]
    fn build_user_prompt_markdown(
        agent: &ChatAgent,
        message: &ChatMessage,
        message_attachments: Option<&MessageAttachmentContext>,
        reference: Option<&ReferenceContext>,
    ) -> String {
        let mut markdown = String::new();
        let sender = Self::resolve_message_sender_identity(message);

        Self::push_markdown_section(&mut markdown, 2, "envelope");
        Self::push_markdown_field(&mut markdown, "session_id", &message.session_id.to_string());
        Self::push_markdown_field(&mut markdown, "from", &sender.address);
        Self::push_markdown_field(&mut markdown, "to", &format!("agent:{}", agent.name));
        Self::push_markdown_field(&mut markdown, "message_id", &message.id.to_string());
        Self::push_markdown_field(&mut markdown, "timestamp", &message.created_at.to_string());

        Self::push_markdown_section(&mut markdown, 2, "message");
        Self::push_markdown_field(&mut markdown, "sender", &sender.label);
        Self::push_markdown_block_field(&mut markdown, "content", message.content.trim(), "text");

        if let Some(reference) = reference {
            Self::push_markdown_section(&mut markdown, 3, "message.reference");
            Self::push_markdown_field(
                &mut markdown,
                "note",
                "User referenced the following historical message. Prioritize it.",
            );
            Self::push_markdown_field(
                &mut markdown,
                "message_id",
                &reference.message_id.to_string(),
            );
            Self::push_markdown_field(&mut markdown, "sender", &reference.sender_label);
            Self::push_markdown_field(
                &mut markdown,
                "sender_type",
                &format!("{:?}", reference.sender_type),
            );
            Self::push_markdown_field(&mut markdown, "created_at", &reference.created_at);
            Self::push_markdown_block_field(
                &mut markdown,
                "content",
                reference.content.trim(),
                "text",
            );

            for (index, attachment) in reference.attachments.iter().enumerate() {
                Self::push_markdown_section(
                    &mut markdown,
                    4,
                    &format!("message.reference.attachments item {}", index + 1),
                );
                Self::push_markdown_field(&mut markdown, "name", &attachment.name);
                Self::push_markdown_field(&mut markdown, "kind", &attachment.kind);
                Self::push_markdown_number_field(
                    &mut markdown,
                    "size_bytes",
                    attachment.size_bytes,
                );
                Self::push_markdown_field(
                    &mut markdown,
                    "mime_type",
                    attachment.mime_type.as_deref().unwrap_or("unknown"),
                );
                Self::push_markdown_field(&mut markdown, "local_path", &attachment.local_path);
            }
        }

        if let Some(attachments_ctx) = message_attachments {
            for (index, attachment) in attachments_ctx.attachments.iter().enumerate() {
                Self::push_markdown_section(
                    &mut markdown,
                    3,
                    &format!("message.attachments item {}", index + 1),
                );
                Self::push_markdown_field(&mut markdown, "name", &attachment.name);
                Self::push_markdown_field(&mut markdown, "kind", &attachment.kind);
                Self::push_markdown_number_field(
                    &mut markdown,
                    "size_bytes",
                    attachment.size_bytes,
                );
                Self::push_markdown_field(
                    &mut markdown,
                    "mime_type",
                    attachment.mime_type.as_deref().unwrap_or("unknown"),
                );
                Self::push_markdown_field(&mut markdown, "local_path", &attachment.local_path);
            }
        }

        markdown
    }

    #[allow(clippy::too_many_arguments)]
    fn build_exact_markdown_prompt(
        agent: &ChatAgent,
        message: &ChatMessage,
        context_dir: &Path,
        session_agents: &[SessionAgentSummary],
        message_attachments: Option<&MessageAttachmentContext>,
        reference: Option<&ReferenceContext>,
        skills: &[ChatSkill],
        prompt_language: ResolvedPromptLanguage,
        team_protocol: Option<&str>,
    ) -> String {
        let mut markdown = String::new();
        let sender = Self::resolve_message_sender_identity(message);
        let messages_path = context_dir.join("messages.jsonl");
        let shared_blackboard_path = context_dir.join(SHARED_BLACKBOARD_FILE_NAME);
        let work_records_path = context_dir.join(WORK_RECORDS_FILE_NAME);
        let visible_members = session_agents
            .iter()
            .filter(|member| member.agent_id != agent.id)
            .collect::<Vec<_>>();
        let active_skills = Self::filter_active_skills(skills, Some(message.content.as_str()));

        Self::push_markdown_section(&mut markdown, 1, "ChatGroup Message");
        Self::push_markdown_section(&mut markdown, 2, "message");
        Self::push_markdown_field(&mut markdown, "sender", &sender.label);
        Self::push_markdown_content_block_field(&mut markdown, "content", &message.content, "text");
        if let Some((intent, meaning)) = Self::routed_message_intent_context(message, &agent.name) {
            Self::push_markdown_field(&mut markdown, "intent", &intent);
            Self::push_markdown_field(&mut markdown, "intent_meaning", &meaning);
        }

        if let Some(reference) = reference {
            Self::push_markdown_section(&mut markdown, 3, "message.reference");
            Self::push_markdown_field(
                &mut markdown,
                "note",
                "User referenced the following historical message. Prioritize it.",
            );
            Self::push_markdown_field(
                &mut markdown,
                "message_id",
                &reference.message_id.to_string(),
            );
            Self::push_markdown_field(&mut markdown, "sender", &reference.sender_label);
            Self::push_markdown_field(
                &mut markdown,
                "sender_type",
                &format!("{:?}", reference.sender_type),
            );
            Self::push_markdown_field(&mut markdown, "created_at", &reference.created_at);
            Self::push_markdown_content_block_field(
                &mut markdown,
                "content",
                &reference.content,
                "text",
            );

            for (index, attachment) in reference.attachments.iter().enumerate() {
                Self::push_markdown_section(
                    &mut markdown,
                    4,
                    &format!("message.reference.attachments item {}", index + 1),
                );
                Self::push_markdown_field(&mut markdown, "name", &attachment.name);
                Self::push_markdown_field(&mut markdown, "kind", &attachment.kind);
                Self::push_markdown_number_field(
                    &mut markdown,
                    "size_bytes",
                    attachment.size_bytes,
                );
                Self::push_markdown_field(
                    &mut markdown,
                    "mime_type",
                    attachment.mime_type.as_deref().unwrap_or("unknown"),
                );
                Self::push_markdown_field(&mut markdown, "local_path", &attachment.local_path);
            }
        }

        if let Some(attachments_ctx) = message_attachments {
            for (index, attachment) in attachments_ctx.attachments.iter().enumerate() {
                Self::push_markdown_section(
                    &mut markdown,
                    3,
                    &format!("message.attachments item {}", index + 1),
                );
                Self::push_markdown_field(&mut markdown, "name", &attachment.name);
                Self::push_markdown_field(&mut markdown, "kind", &attachment.kind);
                Self::push_markdown_number_field(
                    &mut markdown,
                    "size_bytes",
                    attachment.size_bytes,
                );
                Self::push_markdown_field(
                    &mut markdown,
                    "mime_type",
                    attachment.mime_type.as_deref().unwrap_or("unknown"),
                );
                Self::push_markdown_field(&mut markdown, "local_path", &attachment.local_path);
            }
        }

        Self::set_trailing_newlines(&mut markdown, 2);
        Self::push_markdown_section(&mut markdown, 1, "Must be obeyed");
        Self::push_markdown_section(&mut markdown, 2, "output format (important)");
        Self::push_markdown_bool_field(&mut markdown, "required", true);
        Self::push_markdown_field(&mut markdown, "format", "json");
        Self::push_markdown_field(&mut markdown, "container", "list");
        Self::push_markdown_bool_field(&mut markdown, "only_send_items_enter_group_history", true);
        Self::push_markdown_block_field(
            &mut markdown,
            "instruction",
            concat!(
                "- Return ONLY a valid JSON array. Long messages must also be returned in JSON array.\n",
                "- Your final reply MUST be parseable by a standard JSON parser.\n",
                "- Escape all double quotes, backslashes, and newlines inside JSON string values.\n",
                "- Before sending, verify that every `content` value is still a valid JSON string after escaping.\n",
                "- Only send items will be turned into visible group chat messages and written into group history.\n",
                "- The current agent is always recorded as the sender automatically. Do not impersonate other senders.\n",
                "- Do not discuss anything unrelated to the assigned work. Keep every reply concise, precise, and free of filler.\n",
                "- Use `to = \\\"you\\\"` when sending a message to the user. Here `you` refers to the human user.\n",
                "- For send items, `intent` is optional but recommended when the routing semantics matter.\n",
            ),
            "text",
        );

        Self::push_markdown_section(&mut markdown, 3, "output.message_types item 1");
        Self::push_markdown_field(&mut markdown, "type", "send");
        Self::push_markdown_json_field(
            &mut markdown,
            "required_fields",
            &["type", "to", "content"],
        );
        Self::push_markdown_json_field(&mut markdown, "optional_fields", &["intent"]);
        Self::push_markdown_block_field(
            &mut markdown,
            "rules",
            concat!(
                "- A send item targets exactly one receiver.\n",
                "- The recipient must be one of the member names listed in group members.\n",
                "- Use concise language with a clear goal.\n",
                "- Content may be empty.\n",
                "- Prefer setting `intent` for machine-readable routing semantics.\n",
                "- Optional `intent` values for send items: `request` = ask for work or information; `reply` = the receiver should reply; `notify` = informational only, no reply required; `blocker` = report a blocking issue; `confirm` = explicit confirmation is required.\n",
                "- The system will render the final group message as `@receiver content` and route it to that receiver.\n",
            ),
            "text",
        );

        Self::push_markdown_section(&mut markdown, 3, "output.message_types item 2");
        Self::push_markdown_field(&mut markdown, "type", "record");
        Self::push_markdown_bool_field(&mut markdown, "required", false);
        Self::push_markdown_json_field(&mut markdown, "required_fields", &["type", "content"]);
        Self::push_markdown_field(&mut markdown, "rules", MARKDOWN_PROTOCOL_RECORD_RULE);

        Self::push_markdown_section(&mut markdown, 3, "output.message_types item 3");
        Self::push_markdown_field(&mut markdown, "type", "artifact");
        Self::push_markdown_bool_field(&mut markdown, "required", false);
        Self::push_markdown_json_field(&mut markdown, "required_fields", &["type", "content"]);
        Self::push_markdown_field(&mut markdown, "rules", MARKDOWN_PROTOCOL_ARTIFACT_RULE);

        Self::push_markdown_section(&mut markdown, 3, "output.message_types item 4");
        Self::push_markdown_field(&mut markdown, "type", "conclusion");
        Self::push_markdown_bool_field(&mut markdown, "required", false);
        Self::push_markdown_json_field(&mut markdown, "required_fields", &["type", "content"]);
        Self::push_markdown_field(&mut markdown, "rules", MARKDOWN_PROTOCOL_CONCLUSION_RULE);

        Self::set_trailing_newlines(&mut markdown, 2);
        Self::push_markdown_section(&mut markdown, 2, "output.example");
        Self::push_markdown_block_field(
            &mut markdown,
            "json",
            MARKDOWN_PROTOCOL_OUTPUT_EXAMPLE_JSON,
            "json",
        );

        Self::push_markdown_section(&mut markdown, 2, "agent");
        Self::push_markdown_section(&mut markdown, 3, "role");
        Self::push_markdown_field(&mut markdown, "name", &agent.name);
        let normalized_system_prompt =
            Self::strip_embedded_team_protocol_from_system_prompt(&agent.system_prompt);
        Self::push_markdown_block_field(&mut markdown, "role", &normalized_system_prompt, "text");

        Self::push_markdown_section(&mut markdown, 3, "skills");
        if active_skills.is_empty() {
            Self::push_markdown_field(
                &mut markdown,
                "restriction",
                "You have no skills enabled. Do not attempt to use any skill.",
            );
        } else {
            Self::push_markdown_block_field(
                &mut markdown,
                "restriction",
                concat!(
                    "Skills are available as local files in ~/.agents/skills and companion directories.\n",
                    "You can ONLY use the skills listed below. Do not invent or use unlisted skills.\n",
                ),
                "text",
            );
            for (index, skill) in active_skills.iter().enumerate() {
                Self::push_markdown_section(
                    &mut markdown,
                    4,
                    &format!("agent.skills.allowed item {}", index + 1),
                );
                Self::push_markdown_field(&mut markdown, "name", &skill.name);
                Self::push_markdown_field(&mut markdown, "description", &skill.description);
            }
        }

        Self::set_trailing_newlines(&mut markdown, 3);
        Self::push_markdown_section(&mut markdown, 2, "language");
        Self::push_markdown_field(&mut markdown, "setting", prompt_language.setting);
        Self::push_markdown_field(&mut markdown, "instruction", prompt_language.instruction);

        Self::set_trailing_newlines(&mut markdown, 3);
        Self::push_markdown_section(&mut markdown, 2, "team.protocol");
        Self::push_markdown_bool_field(
            &mut markdown,
            "configured",
            team_protocol.is_some_and(|content| !content.trim().is_empty()),
        );
        Self::push_markdown_block_field(
            &mut markdown,
            "guidelines",
            &Self::resolve_team_protocol_guidelines(team_protocol),
            "text",
        );

        Self::set_trailing_newlines(&mut markdown, 3);
        Self::push_markdown_section(&mut markdown, 1, "Group Members");
        Self::push_markdown_field(
            &mut markdown,
            "members_description",
            "Other AI members currently in this group",
        );
        if visible_members.is_empty() {
            markdown.push_str("_No other AI members._\n");
        } else {
            markdown.push('\n');
            for (index, member) in visible_members.iter().enumerate() {
                Self::push_markdown_section(
                    &mut markdown,
                    2,
                    &format!("group.members item {}", index + 1),
                );
                Self::push_markdown_field(&mut markdown, "name", &member.name);
                Self::push_markdown_field(
                    &mut markdown,
                    "responsibility",
                    member.description.as_deref().unwrap_or("AI assistant"),
                );
                Self::push_markdown_field(&mut markdown, "state", &format!("{:?}", member.state));
                Self::push_markdown_json_field(&mut markdown, "skills_used", &member.skills_used);
            }
        }

        Self::set_trailing_newlines(&mut markdown, 2);
        Self::push_markdown_section(&mut markdown, 1, "History");
        Self::push_markdown_section(&mut markdown, 2, "history.group_messages");
        Self::push_markdown_field(&mut markdown, "path", &messages_path.to_string_lossy());
        Self::push_markdown_field(&mut markdown, "format", "jsonl");
        Self::push_markdown_field(
            &mut markdown,
            "description",
            "Group chat history. Each line is a JSON message record containing sender and content, consistent with messages.jsonl history.",
        );
        Self::push_markdown_bool_field(&mut markdown, "optional", true);
        Self::push_markdown_block_field(
            &mut markdown,
            "instruction",
            HISTORY_GROUP_MESSAGES_INSTRUCTION,
            "text",
        );

        Self::push_markdown_section(&mut markdown, 2, "history.shared_blackboard");
        Self::push_markdown_field(
            &mut markdown,
            "path",
            &shared_blackboard_path.to_string_lossy(),
        );
        Self::push_markdown_field(&mut markdown, "format", "jsonl");
        Self::push_markdown_field(
            &mut markdown,
            "description",
            "Persisted shared messages generated from record items.",
        );
        Self::push_markdown_field(
            &mut markdown,
            "instruction",
            HISTORY_SHARED_BLACKBOARD_INSTRUCTION,
        );

        Self::push_markdown_section(&mut markdown, 2, "history.work_records");
        Self::push_markdown_field(&mut markdown, "path", &work_records_path.to_string_lossy());
        Self::push_markdown_field(&mut markdown, "format", "jsonl");
        Self::push_markdown_field(
            &mut markdown,
            "description",
            "Persisted work outputs and summaries generated from artifact/conclusion items.",
        );
        Self::push_markdown_field(
            &mut markdown,
            "instruction",
            HISTORY_WORK_RECORDS_INSTRUCTION,
        );

        Self::set_trailing_newlines(&mut markdown, 2);
        Self::push_markdown_section(&mut markdown, 1, "envelope");
        Self::push_markdown_field(&mut markdown, "session_id", &message.session_id.to_string());
        Self::push_markdown_field(&mut markdown, "from", &sender.address);
        Self::push_markdown_field(&mut markdown, "to", &format!("agent:{}", agent.name));
        Self::push_markdown_field(&mut markdown, "message_id", &message.id.to_string());
        Self::push_markdown_field(&mut markdown, "timestamp", &message.created_at.to_string());
        Self::set_trailing_newlines(&mut markdown, 2);

        markdown
    }

    fn push_markdown_section(markdown: &mut String, level: usize, title: &str) {
        let heading_level = level.clamp(1, 6);
        markdown.push_str(&"#".repeat(heading_level));
        markdown.push(' ');
        markdown.push_str(title);
        markdown.push_str("\n\n");
    }

    fn push_markdown_field(markdown: &mut String, label: &str, value: &str) {
        if value.contains('\n') {
            Self::push_markdown_block_field(markdown, label, value, "text");
            return;
        }
        markdown.push_str("- **");
        markdown.push_str(label);
        markdown.push_str("**: ");
        markdown.push_str(value);
        markdown.push('\n');
    }

    fn push_markdown_bool_field(markdown: &mut String, label: &str, value: bool) {
        markdown.push_str("- **");
        markdown.push_str(label);
        markdown.push_str("**: ");
        markdown.push_str(if value { "true" } else { "false" });
        markdown.push('\n');
    }

    fn push_markdown_number_field(markdown: &mut String, label: &str, value: i64) {
        markdown.push_str("- **");
        markdown.push_str(label);
        markdown.push_str("**: ");
        markdown.push_str(&value.to_string());
        markdown.push('\n');
    }

    fn push_markdown_json_field<T>(markdown: &mut String, label: &str, value: &T)
    where
        T: Serialize + ?Sized,
    {
        let json = serde_json::to_string(value).expect("markdown JSON field should serialize");
        markdown.push_str("- **");
        markdown.push_str(label);
        markdown.push_str("**: ");
        markdown.push_str(&json);
        markdown.push('\n');
    }

    fn push_markdown_block_field(markdown: &mut String, label: &str, value: &str, language: &str) {
        markdown.push_str("- **");
        markdown.push_str(label);
        markdown.push_str("**:\n\n");

        let fence = Self::markdown_fence_for_content(value);
        markdown.push_str(&fence);
        if !language.is_empty() {
            markdown.push_str(language);
        }
        markdown.push('\n');
        markdown.push_str(value);
        if !value.ends_with('\n') {
            markdown.push('\n');
        }
        markdown.push_str(&fence);
        markdown.push_str("\n\n");
    }

    fn push_markdown_content_block_field(
        markdown: &mut String,
        label: &str,
        value: &str,
        language: &str,
    ) {
        markdown.push_str("- **");
        markdown.push_str(label);
        markdown.push_str("**:\n\n");

        let fence = Self::markdown_fence_for_content(value);
        markdown.push_str(&fence);
        if !language.is_empty() {
            markdown.push_str(language);
        }
        markdown.push('\n');
        markdown.push_str(value);
        if value.contains('\n') || value.ends_with('\n') {
            if !value.ends_with('\n') {
                markdown.push('\n');
            }
            markdown.push_str(&fence);
            markdown.push_str("\n\n");
            return;
        }
        markdown.push_str(&fence);
        markdown.push_str("\n\n");
    }

    fn set_trailing_newlines(markdown: &mut String, newline_count: usize) {
        while markdown.ends_with('\n') {
            markdown.pop();
        }
        markdown.push_str(&"\n".repeat(newline_count));
    }

    fn markdown_fence_for_content(content: &str) -> String {
        let mut longest_run = 0usize;
        let mut current_run = 0usize;
        for ch in content.chars() {
            if ch == '~' {
                current_run += 1;
                longest_run = longest_run.max(current_run);
            } else {
                current_run = 0;
            }
        }
        "~".repeat(longest_run.max(2) + 1)
    }

    fn resolve_prompt_language(
        message: &ChatMessage,
        configured_language: &UiLanguage,
    ) -> ResolvedPromptLanguage {
        let system_locale = sys_locale::get_locale();
        Self::resolve_prompt_language_with_system_locale(
            message,
            configured_language,
            system_locale.as_deref(),
        )
    }

    fn resolve_prompt_language_with_system_locale(
        message: &ChatMessage,
        configured_language: &UiLanguage,
        system_locale: Option<&str>,
    ) -> ResolvedPromptLanguage {
        Self::resolve_prompt_language_from_meta(&message.meta)
            .or_else(|| match configured_language {
                UiLanguage::Browser => system_locale
                    .and_then(Self::resolve_prompt_language_from_value)
                    .or_else(|| Self::infer_prompt_language_from_text(&message.content)),
                _ => None,
            })
            .unwrap_or_else(|| Self::resolve_prompt_language_from_ui_language(configured_language))
    }

    fn resolve_prompt_language_from_meta(
        meta: &sqlx::types::Json<serde_json::Value>,
    ) -> Option<ResolvedPromptLanguage> {
        meta.get("app_language")
            .and_then(|value| value.as_str())
            .and_then(Self::resolve_prompt_language_from_value)
    }

    fn resolve_prompt_language_from_ui_language(language: &UiLanguage) -> ResolvedPromptLanguage {
        match language {
            UiLanguage::Browser | UiLanguage::En => ResolvedPromptLanguage {
                setting: "english",
                code: "en",
                instruction: "You MUST respond in English.",
            },
            UiLanguage::ZhHans => ResolvedPromptLanguage {
                setting: "simplified_chinese",
                code: "zh-Hans",
                instruction: "You MUST respond in Simplified Chinese.",
            },
            UiLanguage::ZhHant => ResolvedPromptLanguage {
                setting: "traditional_chinese",
                code: "zh-Hant",
                instruction: "You MUST respond in Traditional Chinese.",
            },
            UiLanguage::Ja => ResolvedPromptLanguage {
                setting: "japanese",
                code: "ja",
                instruction: "You MUST respond in Japanese.",
            },
            UiLanguage::Ko => ResolvedPromptLanguage {
                setting: "korean",
                code: "ko",
                instruction: "You MUST respond in Korean.",
            },
            UiLanguage::Fr => ResolvedPromptLanguage {
                setting: "french",
                code: "fr",
                instruction: "You MUST respond in French.",
            },
            UiLanguage::Es => ResolvedPromptLanguage {
                setting: "spanish",
                code: "es",
                instruction: "You MUST respond in Spanish.",
            },
        }
    }

    fn resolve_prompt_language_from_value(value: &str) -> Option<ResolvedPromptLanguage> {
        let normalized = value.trim().replace('_', "-").to_ascii_lowercase();
        if normalized.is_empty() || normalized == "browser" {
            return None;
        }

        if normalized == "zh-hant"
            || normalized.starts_with("zh-hant-")
            || normalized.starts_with("zh-tw")
            || normalized.starts_with("zh-hk")
            || normalized.starts_with("zh-mo")
            || normalized == "traditional-chinese"
        {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::ZhHant,
            ));
        }

        if normalized == "zh"
            || normalized == "zh-hans"
            || normalized.starts_with("zh-hans-")
            || normalized.starts_with("zh-cn")
            || normalized.starts_with("zh-sg")
            || normalized == "simplified-chinese"
        {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::ZhHans,
            ));
        }

        if normalized == "en" || normalized.starts_with("en-") || normalized == "english" {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::En,
            ));
        }

        if normalized == "fr" || normalized.starts_with("fr-") || normalized == "french" {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Fr,
            ));
        }

        if normalized == "ja" || normalized.starts_with("ja-") || normalized == "japanese" {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Ja,
            ));
        }

        if normalized == "es" || normalized.starts_with("es-") || normalized == "spanish" {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Es,
            ));
        }

        if normalized == "ko" || normalized.starts_with("ko-") || normalized == "korean" {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Ko,
            ));
        }

        None
    }

    fn infer_prompt_language_from_text(text: &str) -> Option<ResolvedPromptLanguage> {
        const TRADITIONAL_CHINESE_HINT_CHARS: &str = "\u{81fa}\u{7063}\u{7e41}\u{9ad4}\u{9019}\u{500b}\u{55ce}\u{70ba}\u{65bc}\u{8207}\u{5f8c}\u{6703}\u{767c}\u{73fe}\u{9801}";
        const SPANISH_HINT_CHARS: &str =
            "\u{00bf}\u{00a1}\u{00f1}\u{00e1}\u{00e9}\u{00ed}\u{00f3}\u{00fa}";
        const FRENCH_HINT_CHARS: &str = "\u{00e0}\u{00e2}\u{00e7}\u{00e9}\u{00e8}\u{00ea}\u{00eb}\u{00ee}\u{00ef}\u{00f4}\u{00f9}\u{00fb}\u{00fc}\u{00ff}\u{0153}\u{00e6}";

        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }

        if trimmed
            .chars()
            .any(|ch| ('\u{3040}'..='\u{30ff}').contains(&ch))
        {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Ja,
            ));
        }

        if trimmed
            .chars()
            .any(|ch| ('\u{ac00}'..='\u{d7af}').contains(&ch))
        {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Ko,
            ));
        }

        if trimmed
            .chars()
            .any(|ch| TRADITIONAL_CHINESE_HINT_CHARS.contains(ch))
        {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::ZhHant,
            ));
        }

        if trimmed
            .chars()
            .any(|ch| ('\u{4e00}'..='\u{9fff}').contains(&ch))
        {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::ZhHans,
            ));
        }

        if trimmed.chars().any(|ch| FRENCH_HINT_CHARS.contains(ch)) {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Fr,
            ));
        }

        if trimmed.chars().any(|ch| SPANISH_HINT_CHARS.contains(ch)) {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Es,
            ));
        }

        Some(Self::resolve_prompt_language_from_ui_language(
            &UiLanguage::En,
        ))
    }

    #[allow(dead_code)]
    /// Get language code and instruction based on UiLanguage setting
    fn get_language_instruction(language: &UiLanguage) -> (&'static str, &'static str) {
        match language {
            UiLanguage::Browser => ("en", "You MUST respond in English."),
            UiLanguage::En => ("en", "You MUST respond in English."),
            UiLanguage::ZhHans => ("zh-Hans", "You MUST respond in Simplified Chinese."),
            UiLanguage::ZhHant => ("zh-Hant", "You MUST respond in Traditional Chinese."),
            UiLanguage::Ja => ("ja", "You MUST respond in Japanese."),
            UiLanguage::Ko => ("ko", "You MUST respond in Korean."),
            UiLanguage::Fr => ("fr", "You MUST respond in French."),
            UiLanguage::Es => ("es", "You MUST respond in Spanish."),
        }
    }

    fn parse_agent_protocol_messages(
        content: &str,
    ) -> Result<Vec<AgentProtocolMessage>, AgentProtocolError> {
        let json_str = Self::extract_json_from_content(content)?;
        let raw: serde_json::Value =
            serde_json::from_str(&json_str).map_err(Self::invalid_json_error)?;

        let messages = match &raw {
            serde_json::Value::Array(_) => {
                serde_json::from_str::<Vec<AgentProtocolMessage>>(&json_str)
                    .map_err(Self::invalid_json_error)?
            }
            _ => {
                return Err(AgentProtocolError {
                    code: ChatProtocolNoticeCode::NotJsonArray,
                    target: None,
                    detail: Some(format!(
                        "Parsed JSON value was {}. Expected a JSON array.",
                        Self::json_value_kind(&raw)
                    )),
                });
            }
        };

        Self::validate_agent_protocol_messages(messages)
    }

    fn validate_agent_protocol_messages(
        messages: Vec<AgentProtocolMessage>,
    ) -> Result<Vec<AgentProtocolMessage>, AgentProtocolError> {
        if messages.is_empty() {
            return Err(AgentProtocolError {
                code: ChatProtocolNoticeCode::EmptyMessage,
                target: None,
                detail: None,
            });
        }

        let mut validated = Vec::with_capacity(messages.len());
        for message in messages {
            match message.message_type {
                AgentProtocolMessageType::Send => {
                    let Some(target) = message.to.as_deref() else {
                        return Err(AgentProtocolError {
                            code: ChatProtocolNoticeCode::MissingSendTarget,
                            target: None,
                            detail: None,
                        });
                    };
                    let Some(target) = Self::normalize_protocol_target(target) else {
                        return Err(AgentProtocolError {
                            code: ChatProtocolNoticeCode::InvalidSendTarget,
                            target: Some(target.to_string()),
                            detail: None,
                        });
                    };
                    let intent = match message.intent.as_deref() {
                        Some(raw_intent) if !raw_intent.trim().is_empty() => {
                            let Some(intent) = Self::normalize_protocol_send_intent(raw_intent)
                            else {
                                return Err(AgentProtocolError {
                                    code: ChatProtocolNoticeCode::InvalidSendIntent,
                                    target: Some(raw_intent.trim().to_string()),
                                    detail: Some(format!(
                                        "Allowed values: {}.",
                                        PROTOCOL_SEND_INTENT_VALUES.join(", ")
                                    )),
                                });
                            };
                            Some(intent)
                        }
                        _ => None,
                    };
                    validated.push(AgentProtocolMessage {
                        message_type: AgentProtocolMessageType::Send,
                        to: Some(target),
                        intent,
                        content: message.content.trim().to_string(),
                    });
                }
                AgentProtocolMessageType::Record
                | AgentProtocolMessageType::Artifact
                | AgentProtocolMessageType::Conclusion => {
                    let content = message.content.trim().to_string();
                    if content.is_empty() {
                        return Err(AgentProtocolError {
                            code: ChatProtocolNoticeCode::EmptyMessage,
                            target: None,
                            detail: None,
                        });
                    }
                    validated.push(AgentProtocolMessage {
                        message_type: message.message_type,
                        to: None,
                        intent: None,
                        content,
                    });
                }
            }
        }

        Ok(validated)
    }

    fn normalize_protocol_target(target: &str) -> Option<String> {
        let normalized = target.trim().trim_start_matches('@').trim();
        if normalized.is_empty() {
            return None;
        }

        let normalized = if normalized.eq_ignore_ascii_case("user") {
            RESERVED_USER_HANDLE
        } else {
            normalized
        };

        if normalized
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
        {
            Some(normalized.to_string())
        } else {
            None
        }
    }

    fn normalize_protocol_send_intent(intent: &str) -> Option<String> {
        let normalized = intent.trim().to_ascii_lowercase();
        if PROTOCOL_SEND_INTENT_VALUES.contains(&normalized.as_str()) {
            Some(normalized)
        } else {
            None
        }
    }

    fn protocol_send_intent_meaning(intent: &str) -> Option<&'static str> {
        match intent {
            "request" => Some("Ask for work or information."),
            "reply" => Some("The receiver should reply."),
            "notify" => Some("Informational only. No reply is required."),
            "blocker" => Some("Report a blocking issue."),
            "confirm" => Some("Explicit confirmation is required."),
            _ => None,
        }
    }

    fn routed_message_intent_context(
        message: &ChatMessage,
        recipient_agent_name: &str,
    ) -> Option<(String, String)> {
        let protocol = message.meta.0.get("protocol")?.as_object()?;
        if protocol.get("type").and_then(serde_json::Value::as_str) != Some("send") {
            return None;
        }

        let target = Self::normalize_protocol_target(
            protocol.get("to").and_then(serde_json::Value::as_str)?,
        )?;
        let recipient = Self::normalize_protocol_target(recipient_agent_name)?;
        if target != recipient {
            return None;
        }

        let intent = Self::normalize_protocol_send_intent(
            protocol.get("intent").and_then(serde_json::Value::as_str)?,
        )?;
        let meaning = protocol
            .get("intent_meaning")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| Self::protocol_send_intent_meaning(&intent).map(str::to_string))?;

        Some((intent, meaning))
    }

    fn build_send_message_content(target: &str, content: &str) -> String {
        let content = content.trim();
        if content.is_empty() {
            format!("@{target}")
        } else {
            format!("@{target} {content}")
        }
    }

    /// Extract JSON from content, handling various formats
    fn extract_json_from_content(content: &str) -> Result<String, AgentProtocolError> {
        let content = content.trim();

        match Self::extract_json_candidate(content) {
            Ok(Some(candidate)) => return Ok(candidate),
            Ok(None) => {}
            Err(err) => return Err(Self::invalid_json_error(err)),
        }

        Err(AgentProtocolError {
            code: ChatProtocolNoticeCode::InvalidJson,
            target: None,
            detail: Some("Could not locate a JSON object or array in the response.".to_string()),
        })
    }

    fn extract_json_candidate(content: &str) -> Result<Option<String>, serde_json::Error> {
        let trimmed = content.trim();
        if matches!(trimmed.chars().next(), Some('[' | '{')) {
            return Self::extract_json_prefix(trimmed);
        }

        if let Some(start) = trimmed.find("```json") {
            let json_start = start + 7;
            if let Some(end) = trimmed[json_start..].find("```") {
                let block = &trimmed[json_start..json_start + end];
                match Self::extract_json_candidate(block)? {
                    Some(candidate) => return Ok(Some(candidate)),
                    None => {}
                }
            }
        }

        if let Some(start) = trimmed.find("```") {
            let block_start = start + 3;
            if let Some(end) = trimmed[block_start..].find("```") {
                let block = &trimmed[block_start..block_start + end];
                if let Some(candidate) = Self::extract_json_candidate(block)? {
                    return Ok(Some(candidate));
                }
            }
        }

        for (index, ch) in trimmed.char_indices() {
            if matches!(ch, '[' | '{')
                && let Ok(Some(candidate)) = Self::extract_json_prefix(&trimmed[index..])
            {
                return Ok(Some(candidate));
            }
        }

        Ok(None)
    }

    fn extract_json_prefix(content: &str) -> Result<Option<String>, serde_json::Error> {
        let trimmed = content.trim_start();
        if !matches!(trimmed.chars().next(), Some('[' | '{')) {
            return Ok(None);
        }

        let mut stream =
            serde_json::Deserializer::from_str(trimmed).into_iter::<serde_json::Value>();
        let value = match stream.next() {
            Some(Ok(value)) => value,
            Some(Err(err)) => return Err(err),
            None => return Ok(None),
        };

        if !matches!(
            value,
            serde_json::Value::Array(_) | serde_json::Value::Object(_)
        ) {
            return Ok(None);
        }

        let offset = stream.byte_offset();
        Ok(Some(trimmed[..offset].trim_end().to_string()))
    }

    fn invalid_json_error(err: serde_json::Error) -> AgentProtocolError {
        AgentProtocolError {
            code: ChatProtocolNoticeCode::InvalidJson,
            target: None,
            detail: Some(err.to_string()),
        }
    }

    fn json_value_kind(value: &serde_json::Value) -> &'static str {
        match value {
            serde_json::Value::Null => "null",
            serde_json::Value::Bool(_) => "a boolean",
            serde_json::Value::Number(_) => "a number",
            serde_json::Value::String(_) => "a string",
            serde_json::Value::Array(_) => "an array",
            serde_json::Value::Object(_) => "an object",
        }
    }

    /// Filter skills based on trigger type and message content.
    /// - 'always' skills are always included
    /// - 'keyword' skills are included if any keyword matches the message
    /// - 'manual' skills are included if the message contains /skill_name
    fn filter_active_skills<'a>(
        skills: &'a [ChatSkill],
        user_message: Option<&str>,
    ) -> Vec<&'a ChatSkill> {
        let message_lower = user_message.map(|m| m.to_lowercase()).unwrap_or_default();

        skills
            .iter()
            .filter(|skill| {
                match skill.trigger_type.as_str() {
                    "always" => true,
                    "keyword" => {
                        if message_lower.is_empty() {
                            return false;
                        }
                        skill
                            .trigger_keywords
                            .0
                            .iter()
                            .any(|kw| message_lower.contains(&kw.to_lowercase()))
                    }
                    "manual" => {
                        if message_lower.is_empty() {
                            return false;
                        }
                        // Check for /skill_name pattern
                        let slash_cmd = format!("/{}", skill.name.to_lowercase().replace(' ', "-"));
                        message_lower.contains(&slash_cmd)
                    }
                    _ => false,
                }
            })
            .collect()
    }

    /// Legacy TOML-based user prompt builder kept for transition safety.
    #[allow(dead_code)]
    #[allow(clippy::too_many_arguments)]
    fn build_user_prompt(
        &self,
        agent: &ChatAgent,
        message: &ChatMessage,
        message_attachments: Option<&MessageAttachmentContext>,
        reference: Option<&ReferenceContext>,
    ) -> String {
        let mut toml = String::new();

        // 1. Envelope section
        toml.push_str("[envelope]\n");
        toml.push_str(&format!("session_id = \"{}\"\n", message.session_id));
        let sender = Self::resolve_message_sender_identity(message);
        toml.push_str(&format!(
            "from = \"{}\"\n",
            Self::escape_toml_string(&sender.address)
        ));
        toml.push_str(&format!(
            "to = \"agent:{}\"\n",
            Self::escape_toml_string(&agent.name)
        ));
        toml.push_str(&format!("message_id = \"{}\"\n", message.id));
        toml.push_str(&format!("timestamp = \"{}\"\n\n", message.created_at));

        // 2. Message section
        toml.push_str("[message]\n");
        toml.push_str(&format!(
            "sender = \"{}\"\n",
            Self::escape_toml_string(&sender.label)
        ));
        toml.push_str(&format!(
            "content = \"\"\"\n{}\n\"\"\"\n",
            message.content.trim()
        ));

        if let Some(reference) = reference {
            toml.push_str("\n[message.reference]\n");
            toml.push_str(
                "note = \"User referenced the following historical message. Prioritize it.\"\n",
            );
            toml.push_str(&format!("message_id = \"{}\"\n", reference.message_id));
            toml.push_str(&format!(
                "sender = \"{}\"\n",
                Self::escape_toml_string(&reference.sender_label)
            ));
            toml.push_str(&format!("sender_type = \"{:?}\"\n", reference.sender_type));
            toml.push_str(&format!(
                "created_at = \"{}\"\n",
                Self::escape_toml_string(&reference.created_at)
            ));
            toml.push_str(&format!(
                "content = \"\"\"\n{}\n\"\"\"\n",
                reference.content.trim()
            ));

            if !reference.attachments.is_empty() {
                for attachment in &reference.attachments {
                    toml.push_str("\n[[message.reference.attachments]]\n");
                    toml.push_str(&format!(
                        "name = \"{}\"\n",
                        Self::escape_toml_string(&attachment.name)
                    ));
                    toml.push_str(&format!(
                        "kind = \"{}\"\n",
                        Self::escape_toml_string(&attachment.kind)
                    ));
                    toml.push_str(&format!("size_bytes = {}\n", attachment.size_bytes));
                    toml.push_str(&format!(
                        "mime_type = \"{}\"\n",
                        attachment.mime_type.as_deref().unwrap_or("unknown")
                    ));
                    toml.push_str(&format!(
                        "local_path = \"{}\"\n",
                        Self::escape_toml_string(&attachment.local_path)
                    ));
                }
            }
        }

        // 3. Message attachments (optional)
        if let Some(attachments_ctx) = message_attachments
            && !attachments_ctx.attachments.is_empty()
        {
            for attachment in &attachments_ctx.attachments {
                toml.push_str("\n[[message.attachments]]\n");
                toml.push_str(&format!(
                    "name = \"{}\"\n",
                    Self::escape_toml_string(&attachment.name)
                ));
                toml.push_str(&format!(
                    "kind = \"{}\"\n",
                    Self::escape_toml_string(&attachment.kind)
                ));
                toml.push_str(&format!("size_bytes = {}\n", attachment.size_bytes));
                toml.push_str(&format!(
                    "mime_type = \"{}\"\n",
                    attachment.mime_type.as_deref().unwrap_or("unknown")
                ));
                toml.push_str(&format!(
                    "local_path = \"{}\"\n",
                    Self::escape_toml_string(&attachment.local_path)
                ));
            }
        }

        toml
    }

    fn resolve_team_protocol_guidelines(team_protocol: Option<&str>) -> String {
        let normalized_protocol = team_protocol.map(str::trim).unwrap_or_default();
        if normalized_protocol.is_empty() {
            return PresetLoader::load_team_protocol();
        }
        normalized_protocol.to_string()
    }

    fn strip_embedded_team_protocol_from_system_prompt(system_prompt: &str) -> String {
        let normalized = system_prompt.replace("\r\n", "\n");

        let without_injected_prefix = if normalized.starts_with("(Team Protocol)\n") {
            normalized
                .split_once("\n\n")
                .map(|(_, rest)| rest.to_string())
                .unwrap_or_default()
        } else {
            normalized
        };

        if let Some((before_protocol, after_marker)) =
            without_injected_prefix.split_once("\n(Embedded: Team Collaboration Protocol)\n")
            && let Some((_, after_protocol)) = after_marker.split_once("\n\nInputs:\n")
        {
            return format!(
                "{}\n\nInputs:\n{after_protocol}",
                before_protocol.trim_end()
            )
            .trim()
            .to_string();
        }

        without_injected_prefix.trim().to_string()
    }

    #[allow(clippy::too_many_arguments)]
    fn build_prompt(
        &self,
        agent: &ChatAgent,
        message: &ChatMessage,
        context_path: &Path,
        session_agents: &[SessionAgentSummary],
        message_attachments: Option<&MessageAttachmentContext>,
        reference: Option<&ReferenceContext>,
        skills: &[ChatSkill],
        prompt_language: ResolvedPromptLanguage,
        team_protocol: Option<&str>,
    ) -> String {
        let context_dir = context_path.parent().unwrap_or(context_path);

        Self::build_exact_markdown_prompt(
            agent,
            message,
            context_dir,
            session_agents,
            message_attachments,
            reference,
            skills,
            prompt_language,
            team_protocol,
        )
    }

    fn emit_protocol_notice(
        &self,
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        agent_name: &str,
        error: &AgentProtocolError,
        output_is_empty: bool,
    ) {
        self.emit(
            session_id,
            ChatStreamEvent::ProtocolNotice {
                session_id,
                session_agent_id,
                agent_id,
                run_id,
                agent_name: agent_name.to_string(),
                code: error.code.clone(),
                target: error.target.clone(),
                detail: error.detail.clone(),
                output_is_empty,
            },
        );
    }

    fn protocol_notice_log_message(code: &ChatProtocolNoticeCode) -> &'static str {
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

    fn protocol_notice_reason(error: &AgentProtocolError) -> String {
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

    fn should_handle_protocol_error_as_raw_output(error: &AgentProtocolError) -> bool {
        matches!(
            error.code,
            ChatProtocolNoticeCode::InvalidJson | ChatProtocolNoticeCode::NotJsonArray
        )
    }

    #[allow(clippy::too_many_arguments)]
    async fn persist_raw_agent_message_and_work_record(
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
    ) -> Result<(), ChatRunnerError> {
        let output_is_empty = raw_output.trim().is_empty();
        let message = chat::create_message(
            &self.db.pool,
            session_id,
            ChatSenderType::Agent,
            Some(agent_id),
            raw_output.to_string(),
            Some(serde_json::json!({
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
            })),
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

    fn protocol_work_item_type(
        message_type: &AgentProtocolMessageType,
    ) -> Option<ChatWorkItemType> {
        match message_type {
            AgentProtocolMessageType::Artifact => Some(ChatWorkItemType::Artifact),
            AgentProtocolMessageType::Conclusion => Some(ChatWorkItemType::Conclusion),
            AgentProtocolMessageType::Send | AgentProtocolMessageType::Record => None,
        }
    }

    fn work_item_type_label(item_type: &ChatWorkItemType) -> &'static str {
        match item_type {
            ChatWorkItemType::Artifact => "artifact",
            ChatWorkItemType::Conclusion => "conclusion",
        }
    }

    async fn persist_work_item(
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

    async fn emit_protocol_error_message(
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
            "{}",
            Self::protocol_notice_log_message(&error.code)
        );

        self.emit_protocol_notice(
            session_id,
            session_agent_id,
            agent_id,
            run_id,
            agent_name,
            error,
            output_is_empty,
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
    async fn persist_protocol_error_message(
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
    async fn process_agent_protocol_output(
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
    ) -> Result<usize, ChatRunnerError> {
        let output_is_empty = latest_assistant.trim().is_empty();
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
            let mut protocol_meta = serde_json::json!({
                "type": "send",
                "to": target,
                "index": index,
            });
            if let Some(intent) = message.intent.as_deref() {
                protocol_meta["intent"] = serde_json::json!(intent);
                if let Some(meaning) = Self::protocol_send_intent_meaning(intent) {
                    protocol_meta["intent_meaning"] = serde_json::json!(meaning);
                }
            }
            let meta = serde_json::json!({
                "app_language": prompt_language.code,
                "run_id": run_id,
                "session_agent_id": session_agent_id,
                "source_message_id": source_message_id,
                "chain_depth": chain_depth + 1,
                "protocol": protocol_meta
            });

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

    fn spawn_log_forwarders(
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
        });

        let stderr_store = msg_store.clone();
        let stderr_log = raw_log_file.clone();
        tokio::spawn(async move {
            let mut stream = ReaderStream::new(stderr);
            let mut decoder = Utf8LossyDecoder::new();
            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(bytes) => {
                        let text = decoder.decode_chunk(&bytes);
                        if !text.is_empty() {
                            stderr_store.push(LogMsg::Stderr(text.clone()));
                            let mut file = stderr_log.lock().await;
                            let _ = file.write_all(text.as_bytes()).await;
                        }
                    }
                    Err(err) => {
                        stderr_store.push(LogMsg::Stderr(format!("stderr error: {err}")));
                    }
                }
            }

            let tail = decoder.finish();
            if !tail.is_empty() {
                stderr_store.push(LogMsg::Stderr(tail.clone()));
                let mut file = stderr_log.lock().await;
                let _ = file.write_all(tail.as_bytes()).await;
            }
        });
    }

    fn parse_token_usage_from_stdout_line(line: &str) -> Option<TokenUsageInfo> {
        let value: serde_json::Value = serde_json::from_str(line).ok()?;
        let value_obj = value.as_object()?;

        if value_obj.get("type").and_then(|v| v.as_str()) == Some("token_usage") {
            let total_tokens = value_obj
                .get("total_tokens")
                .and_then(|v| v.as_u64())
                .and_then(|v| u32::try_from(v).ok())?;
            let model_context_window = value_obj
                .get("model_context_window")
                .and_then(|v| v.as_u64())
                .and_then(|v| u32::try_from(v).ok())?;
            return Some(TokenUsageInfo {
                total_tokens,
                model_context_window,
                input_tokens: None,
                output_tokens: None,
                cache_read_tokens: None,
                is_estimated: false,
            });
        }

        if value_obj.get("method").and_then(|v| v.as_str()) != Some("codex/event/token_count") {
            return None;
        }

        let info = value_obj
            .get("params")
            .and_then(|v| v.get("msg"))
            .and_then(|v| v.get("info"))?;

        let total_tokens = info
            .get("last_token_usage")
            .and_then(|v| v.get("total_tokens"))
            .and_then(|v| v.as_u64())
            .and_then(|v| u32::try_from(v).ok())?;
        let model_context_window = info
            .get("model_context_window")
            .and_then(|v| v.as_u64())
            .and_then(|v| u32::try_from(v).ok())
            .unwrap_or(0);

        Some(TokenUsageInfo {
            total_tokens,
            model_context_window,
            input_tokens: None,
            output_tokens: None,
            cache_read_tokens: None,
            is_estimated: false,
        })
    }

    fn update_token_usage_from_stdout_chunk(
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

    fn flush_token_usage_buffer(
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
    fn estimate_tokens_with_tiktoken(text: &str) -> u32 {
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
    fn process_stream_patch(
        patch: json_patch::Patch,
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        sender: &broadcast::Sender<ChatStreamEvent>,
        last_content: &mut HashMap<usize, String>,
        latest_assistant: &mut String,
        last_token_usage: &mut Option<TokenUsageInfo>,
    ) {
        if let Some((index, entry)) = extract_normalized_entry_from_patch(&patch) {
            let stream_type = match &entry.entry_type {
                NormalizedEntryType::AssistantMessage => Some(ChatStreamDeltaType::Assistant),
                NormalizedEntryType::Thinking => Some(ChatStreamDeltaType::Thinking),
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
    fn spawn_stream_bridge(
        &self,
        msg_store: Arc<MsgStore>,
        session_id: Uuid,
        agent_id: Uuid,
        session_agent_id: Uuid,
        run_id: Uuid,
        output_path: PathBuf,
        meta_path: PathBuf,
        workspace_path: PathBuf,
        run_dir: PathBuf,
        failed_flag: Arc<AtomicBool>,
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

        tokio::spawn(async move {
            let mut stream = msg_store.history_plus_stream();
            let mut last_content: HashMap<usize, String> = HashMap::new();
            let mut latest_assistant = String::new();
            let mut agent_session_id: Option<String> = None;
            let mut agent_message_id: Option<String> = None;
            let mut last_token_usage: Option<TokenUsageInfo> = None;
            let mut stdout_line_buffer = String::new();

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
                        );
                    }
                    Ok(LogMsg::Finished) => {
                        Self::flush_token_usage_buffer(
                            &mut stdout_line_buffer,
                            &mut last_token_usage,
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

                        let diff_info =
                            ChatRunner::capture_git_diff(&workspace_path, &run_dir).await;
                        let untracked_files =
                            ChatRunner::capture_untracked_files(&workspace_path, &run_dir).await;
                        let failed = failed_flag.load(Ordering::Relaxed);

                        if failed {
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
                                is_estimated: true,
                            }
                        };

                        meta["token_usage"] = serde_json::json!({
                            "total_tokens": token_usage.total_tokens,
                            "model_context_window": token_usage.model_context_window,
                            "input_tokens": token_usage.input_tokens,
                            "output_tokens": token_usage.output_tokens,
                            "is_estimated": token_usage.is_estimated,
                        });

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

                        if let Some(diff) = diff_info.as_ref() {
                            meta["diff_available"] = true.into();
                            meta["diff_truncated"] = diff.truncated.into();
                        }

                        if !untracked_files.is_empty() {
                            meta["untracked_files"] =
                                serde_json::to_value(&untracked_files).unwrap_or_default();
                        }

                        let _ = fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap())
                            .await;

                        if let Err(err) = runner
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
                            )
                            .await
                        {
                            tracing::warn!(
                                session_id = %session_id,
                                run_id = %run_id,
                                agent_id = %agent_id,
                                error = %err,
                                "failed to process agent protocol output"
                            );
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

                        let final_state = if failed {
                            ChatSessionAgentState::Dead
                        } else {
                            ChatSessionAgentState::Idle
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
                        let mention_status = if final_state == ChatSessionAgentState::Dead {
                            MentionStatus::Failed
                        } else {
                            MentionStatus::Completed
                        };
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

    fn spawn_exit_watcher(
        &self,
        mut child: command_group::AsyncGroupChild,
        cancel_token: Option<CancellationToken>,
        exit_signal: Option<ExecutorExitSignal>,
        msg_store: Arc<MsgStore>,
        failed_flag: Arc<AtomicBool>,
        session_agent_id: Uuid,
    ) {
        // Store the cancellation token for graceful shutdown
        if let Some(ref token) = cancel_token {
            self.cancellation_tokens
                .insert(session_agent_id, token.clone());
        }

        let finished_sent = Arc::new(AtomicBool::new(false));
        let finished_from_exit_signal = Arc::new(AtomicBool::new(false));
        let cancellation_tokens = self.cancellation_tokens.clone();
        let process_finished = finished_sent.clone();
        let process_finished_from_signal = finished_from_exit_signal.clone();
        let process_msg_store = msg_store.clone();
        let process_failed_flag = failed_flag.clone();
        tokio::spawn(async move {
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        if !status.success() {
                            process_failed_flag.store(true, Ordering::Relaxed);
                        }
                        if !process_finished.swap(true, Ordering::Relaxed) {
                            process_msg_store.push_finished();
                        }
                        // If completion already came from exit_signal, token was cleaned there.
                        if !process_finished_from_signal.load(Ordering::Relaxed) {
                            cancellation_tokens.remove(&session_agent_id);
                        }
                        break;
                    }
                    Ok(None) => {
                        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                    }
                    Err(err) => {
                        process_msg_store
                            .push(LogMsg::Stderr(format!("process wait error: {err}")));
                        process_failed_flag.store(true, Ordering::Relaxed);
                        if !process_finished.swap(true, Ordering::Relaxed) {
                            process_msg_store.push_finished();
                        }
                        if !process_finished_from_signal.load(Ordering::Relaxed) {
                            cancellation_tokens.remove(&session_agent_id);
                        }
                        break;
                    }
                }
            }
        });

        if let Some(exit_signal_rx) = exit_signal {
            let signal_msg_store = msg_store;
            let signal_failed_flag = failed_flag;
            let signal_finished = finished_sent;
            let signal_finished_from_signal = finished_from_exit_signal;
            let signal_cancel_token = cancel_token;
            let signal_cancellation_tokens = self.cancellation_tokens.clone();
            tokio::spawn(async move {
                match exit_signal_rx.await {
                    Ok(exit_result) => {
                        if matches!(
                            exit_result,
                            executors::executors::ExecutorExitResult::Failure
                        ) {
                            signal_failed_flag.store(true, Ordering::Relaxed);
                        }

                        // Ignore completion emitted after manual cancellation (e.g. stop_agent).
                        let manually_cancelled = signal_cancel_token
                            .as_ref()
                            .map(CancellationToken::is_cancelled)
                            .unwrap_or(false);

                        if !manually_cancelled {
                            signal_finished_from_signal.store(true, Ordering::Relaxed);
                            if !signal_finished.swap(true, Ordering::Relaxed) {
                                signal_msg_store.push_finished();
                            }
                            signal_cancellation_tokens.remove(&session_agent_id);
                        }
                    }
                    Err(err) => {
                        signal_msg_store
                            .push(LogMsg::Stderr(format!("exit signal receive error: {err}")));
                    }
                }
            });
        }
    }

    /// Stop a running agent by triggering graceful cancellation via CancellationToken
    pub async fn stop_agent(
        &self,
        session_id: Uuid,
        session_agent_id: Uuid,
    ) -> Result<(), ChatRunnerError> {
        tracing::info!(
            "stop_agent called for session_agent_id: {}",
            session_agent_id
        );

        // Try to cancel the agent via CancellationToken (graceful shutdown)
        let token_found = self.cancellation_tokens.contains_key(&session_agent_id);
        tracing::info!("CancellationToken found: {}", token_found);

        if let Some(token) = self.cancellation_tokens.get(&session_agent_id) {
            tracing::info!(
                "Cancelling agent for session_agent_id: {}",
                session_agent_id
            );
            token.cancel();
        } else {
            tracing::warn!(
                "No CancellationToken found for session_agent_id: {}",
                session_agent_id
            );
        }

        // Update state to Dead
        let session_agent = ChatSessionAgent::update_state(
            &self.db.pool,
            session_agent_id,
            ChatSessionAgentState::Dead,
        )
        .await?;

        // Emit state change event
        self.emit(
            session_id,
            ChatStreamEvent::AgentState {
                session_agent_id,
                agent_id: session_agent.agent_id,
                state: ChatSessionAgentState::Dead,
                started_at: None,
            },
        );

        // Clean up the cancellation token
        self.cancellation_tokens.remove(&session_agent_id);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use chrono::Utc;
    use db::models::{
        chat_agent::ChatAgent,
        chat_message::{ChatMessage, ChatSenderType},
        chat_session_agent::ChatSessionAgentState,
        chat_skill::ChatSkill,
    };
    use serde_json::json;
    use uuid::Uuid;

    use super::{
        AgentProtocolError, AgentProtocolMessageType, ChatProtocolNoticeCode, ChatRunner,
        MARKDOWN_PROTOCOL_OUTPUT_EXAMPLE_JSON, MessageAttachmentContext, ReferenceAttachment,
        ReferenceContext, ResolvedPromptLanguage, SessionAgentSummary,
    };
    use crate::services::config::UiLanguage;

    fn test_message_with_sender(
        sender_type: ChatSenderType,
        sender_id: Option<Uuid>,
        content: &str,
        meta: serde_json::Value,
    ) -> ChatMessage {
        ChatMessage {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            sender_type,
            sender_id,
            content: content.to_string(),
            mentions: sqlx::types::Json(Vec::new()),
            meta: sqlx::types::Json(meta),
            created_at: Utc::now(),
        }
    }

    fn test_message(content: &str, meta: serde_json::Value) -> ChatMessage {
        test_message_with_sender(ChatSenderType::User, None, content, meta)
    }

    fn test_agent(name: &str, system_prompt: &str) -> ChatAgent {
        ChatAgent {
            id: Uuid::new_v4(),
            name: name.to_string(),
            runner_type: "codex".to_string(),
            system_prompt: system_prompt.to_string(),
            tools_enabled: sqlx::types::Json(json!({})),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn test_skill(name: &str, description: &str, trigger_type: &str) -> ChatSkill {
        ChatSkill {
            id: Uuid::new_v4(),
            name: name.to_string(),
            description: description.to_string(),
            content: String::new(),
            trigger_type: trigger_type.to_string(),
            trigger_keywords: sqlx::types::Json(Vec::new()),
            enabled: true,
            source: "local".to_string(),
            source_url: None,
            version: "1.0.0".to_string(),
            author: None,
            tags: sqlx::types::Json(Vec::new()),
            category: None,
            compatible_agents: sqlx::types::Json(Vec::new()),
            download_count: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn parse_token_usage_from_codex_token_count_line() {
        let line = r#"{"method":"codex/event/token_count","params":{"msg":{"info":{"last_token_usage":{"total_tokens":53002},"model_context_window":258400}}}}"#;
        let usage = ChatRunner::parse_token_usage_from_stdout_line(line).expect("usage");
        assert_eq!(usage.total_tokens, 53002);
        assert_eq!(usage.model_context_window, 258400);
    }

    #[test]
    fn parse_token_usage_from_plain_token_usage_line() {
        let line = r#"{"type":"token_usage","total_tokens":14596,"model_context_window":258400}"#;
        let usage = ChatRunner::parse_token_usage_from_stdout_line(line).expect("usage");
        assert_eq!(usage.total_tokens, 14596);
        assert_eq!(usage.model_context_window, 258400);
    }

    #[test]
    fn parse_agent_protocol_messages_supports_json_list() {
        let content = r#"
```json
[
  {"type":"send","to":"backend","intent":"REQUEST","content":"redo api"},
  {"type":"record","content":"route=/chat"},
  {"type":"artifact","content":"frontend/src/app.tsx"},
  {"type":"conclusion","content":"waiting for backend confirmation"}
]
```
"#;

        let messages = ChatRunner::parse_agent_protocol_messages(content).expect("messages");
        assert_eq!(messages.len(), 4);
        assert!(matches!(
            messages[0].message_type,
            AgentProtocolMessageType::Send
        ));
        assert_eq!(messages[0].to.as_deref(), Some("backend"));
        assert_eq!(messages[0].intent.as_deref(), Some("request"));
        assert!(matches!(
            messages[3].message_type,
            AgentProtocolMessageType::Conclusion
        ));
    }

    #[test]
    fn parse_agent_protocol_messages_supports_json_array_with_tool_call_tail() {
        let content = r#"[{"type":"send","to":"you","content":"done"}]</parameter>
</invoke>
</minimax:tool_call>"#;

        let messages = ChatRunner::parse_agent_protocol_messages(content).expect("messages");
        assert_eq!(messages.len(), 1);
        assert!(matches!(
            messages[0].message_type,
            AgentProtocolMessageType::Send
        ));
        assert_eq!(messages[0].to.as_deref(), Some("you"));
        assert_eq!(messages[0].content, "done");
    }

    #[test]
    fn parse_agent_protocol_messages_rejects_legacy_object() {
        let content = r#"{
  "send_to_member": { "target": "@architect", "content": "sync API changes" },
  "send_to_user_important": "frontend done",
  "record": "route=/chat",
  "result": "backend API still pending"
}"#;

        let err = ChatRunner::parse_agent_protocol_messages(content).expect_err("error");
        assert_eq!(err.code, ChatProtocolNoticeCode::NotJsonArray);
    }

    #[test]
    fn parse_agent_protocol_messages_rejects_missing_send_target() {
        let content = r#"[{"type":"send","content":"hello"}]"#;
        let err = ChatRunner::parse_agent_protocol_messages(content).expect_err("error");
        assert_eq!(err.code, ChatProtocolNoticeCode::MissingSendTarget);
    }

    #[test]
    fn parse_agent_protocol_messages_rejects_invalid_send_intent() {
        let content = r#"[{"type":"send","to":"backend","intent":"delegate","content":"hello"}]"#;
        let err = ChatRunner::parse_agent_protocol_messages(content).expect_err("error");
        assert_eq!(err.code, ChatProtocolNoticeCode::InvalidSendIntent);
    }

    #[test]
    fn parse_agent_protocol_messages_rejects_empty_content() {
        let content = r#"[{"type":"conclusion","content":"   "}]"#;
        let err = ChatRunner::parse_agent_protocol_messages(content).expect_err("error");
        assert_eq!(err.code, ChatProtocolNoticeCode::EmptyMessage);
    }

    #[test]
    fn parse_agent_protocol_messages_reports_json_error_detail() {
        let content = r#"
```json
[
  {"type":"send","to":"backend","content":"bad "quote""}
]
```
"#;

        let err = ChatRunner::parse_agent_protocol_messages(content).expect_err("error");
        assert_eq!(err.code, ChatProtocolNoticeCode::InvalidJson);
        let detail = err.detail.expect("detail");
        assert!(detail.contains("line"));
        assert!(detail.contains("column"));
    }

    #[test]
    fn should_handle_protocol_error_as_raw_output_only_for_json_shape_errors() {
        let invalid_json = AgentProtocolError {
            code: ChatProtocolNoticeCode::InvalidJson,
            target: None,
            detail: None,
        };
        let not_json_array = AgentProtocolError {
            code: ChatProtocolNoticeCode::NotJsonArray,
            target: None,
            detail: None,
        };
        let missing_target = AgentProtocolError {
            code: ChatProtocolNoticeCode::MissingSendTarget,
            target: None,
            detail: None,
        };
        let empty_message = AgentProtocolError {
            code: ChatProtocolNoticeCode::EmptyMessage,
            target: None,
            detail: None,
        };

        assert!(ChatRunner::should_handle_protocol_error_as_raw_output(
            &invalid_json
        ));
        assert!(ChatRunner::should_handle_protocol_error_as_raw_output(
            &not_json_array
        ));
        assert!(!ChatRunner::should_handle_protocol_error_as_raw_output(
            &empty_message
        ));
        assert!(!ChatRunner::should_handle_protocol_error_as_raw_output(
            &missing_target
        ));
    }

    #[test]
    fn markdown_protocol_output_example_json_is_valid() {
        let messages =
            ChatRunner::parse_agent_protocol_messages(MARKDOWN_PROTOCOL_OUTPUT_EXAMPLE_JSON)
                .expect("json");
        assert_eq!(messages.len(), 5);
        assert!(matches!(
            messages.first().map(|message| &message.message_type),
            Some(AgentProtocolMessageType::Send)
        ));
        assert_eq!(messages[0].intent.as_deref(), Some("request"));
        assert_eq!(messages[1].intent.as_deref(), Some("confirm"));
    }

    #[test]
    fn resolve_prompt_language_from_value_returns_concrete_language_setting() {
        let language = ChatRunner::resolve_prompt_language_from_value("zh-Hans").expect("language");
        assert_eq!(language.setting, "simplified_chinese");
        assert_eq!(language.code, "zh-Hans");
        assert_eq!(
            language.instruction,
            "You MUST respond in Simplified Chinese."
        );
    }

    #[test]
    fn resolve_prompt_language_from_ui_language_never_returns_browser_setting() {
        let language = ChatRunner::resolve_prompt_language_from_ui_language(&UiLanguage::Browser);
        assert_eq!(language.setting, "english");
        assert_eq!(language.code, "en");
        assert_eq!(language.instruction, "You MUST respond in English.");
    }

    #[test]
    fn resolve_prompt_language_uses_system_locale_when_browser_is_configured() {
        let message = test_message("Please answer this in English.", serde_json::json!({}));
        let language = ChatRunner::resolve_prompt_language_with_system_locale(
            &message,
            &UiLanguage::Browser,
            Some("fr-CA"),
        );
        assert_eq!(language.setting, "french");
        assert_eq!(language.code, "fr");
        assert_eq!(language.instruction, "You MUST respond in French.");
    }

    #[test]
    fn resolve_prompt_language_prefers_message_meta_over_system_locale() {
        let message = test_message(
            "Please answer this in English.",
            serde_json::json!({ "app_language": "zh-Hant" }),
        );
        let language = ChatRunner::resolve_prompt_language_with_system_locale(
            &message,
            &UiLanguage::Browser,
            Some("fr-CA"),
        );
        assert_eq!(language.setting, "traditional_chinese");
        assert_eq!(language.code, "zh-Hant");
        assert_eq!(
            language.instruction,
            "You MUST respond in Traditional Chinese."
        );
    }

    #[test]
    fn infer_prompt_language_prefers_traditional_chinese_hint_chars() {
        let language =
            ChatRunner::infer_prompt_language_from_text("\u{81fa}\u{7063}").expect("language");
        assert_eq!(language.setting, "traditional_chinese");
        assert_eq!(language.code, "zh-Hant");
        assert_eq!(
            language.instruction,
            "You MUST respond in Traditional Chinese."
        );
    }

    #[test]
    fn infer_prompt_language_detects_spanish_accented_punctuation() {
        let language =
            ChatRunner::infer_prompt_language_from_text("\u{00bf}Como estas?").expect("language");
        assert_eq!(language.setting, "spanish");
        assert_eq!(language.code, "es");
        assert_eq!(language.instruction, "You MUST respond in Spanish.");
    }

    #[test]
    fn infer_prompt_language_detects_french_accented_letters() {
        let language =
            ChatRunner::infer_prompt_language_from_text("\u{00e9}l\u{00e8}ve").expect("language");
        assert_eq!(language.setting, "french");
        assert_eq!(language.code, "fr");
        assert_eq!(language.instruction, "You MUST respond in French.");
    }

    #[test]
    fn resolve_message_sender_identity_uses_agent_sender_label() {
        let agent_id = Uuid::new_v4();
        let message = test_message_with_sender(
            ChatSenderType::Agent,
            Some(agent_id),
            "@product hello",
            json!({
                "sender": {
                    "label": "architect",
                    "name": "architect"
                },
                "structured": {
                    "sender_label": "architect"
                }
            }),
        );

        let sender = ChatRunner::resolve_message_sender_identity(&message);
        assert_eq!(sender.label, "architect");
        assert_eq!(sender.address, "agent:architect");
    }

    #[test]
    fn build_system_prompt_markdown_preserves_protocol_content() {
        let current_agent = test_agent(
            "product",
            "You are the Product Manager.\nKeep scope testable.",
        );
        let other_agent_id = Uuid::new_v4();
        let session_agents = vec![SessionAgentSummary {
            session_agent_id: Uuid::new_v4(),
            agent_id: other_agent_id,
            name: "architect".to_string(),
            runner_type: "codex".to_string(),
            state: ChatSessionAgentState::Idle,
            description: Some("You are the System Architect.".to_string()),
            system_prompt: None,
            tools_enabled: json!({}),
            skills_used: vec!["agent-browser".to_string()],
        }];
        let skills = vec![test_skill(
            "agent-browser",
            "Browser automation CLI for AI agents.",
            "always",
        )];

        let prompt = ChatRunner::build_system_prompt_markdown(
            &current_agent,
            &session_agents,
            Path::new(r"E:\workspace\projectSS\MainPage2\.openteams\context\demo"),
            &skills,
            Some("Please analyze the page issue"),
            ResolvedPromptLanguage {
                setting: "simplified_chinese",
                code: "zh-Hans",
                instruction: "You MUST respond in Simplified Chinese.",
            },
            Some("Work through explicit handoffs."),
        );

        assert!(prompt.contains("# ChatGroup Protocol"));
        assert!(prompt.contains("## agent.role"));
        assert!(prompt.contains("### agent.skills.allowed item 1"));
        assert!(prompt.contains("### group.members item 1"));
        assert!(prompt.contains("## history.group_messages"));
        assert!(prompt.contains("## output"));
        assert!(prompt.contains("### output.message_types item 1"));
        assert!(prompt.contains("## output.example"));
        assert!(prompt.contains("## language"));
        assert!(prompt.contains("## team.protocol"));
        assert!(prompt.contains("Work through explicit handoffs."));
        assert!(prompt.contains("- **PROTOCOL_VERSION**: chatgroup_markdown_v1"));
        assert!(prompt.contains("- **allowed_targets**: [\"architect\",\"you\"]"));
        assert!(prompt.contains("Return ONLY a valid JSON array."));
        assert!(prompt.contains(
            "Prioritize reading history when the new message implies continuation or refinement"
        ));
        assert!(prompt.contains(
            "Before writing a record item, if you are unsure whether the fact was already captured, check this file first."
        ));
        assert!(prompt.contains(
            "Use this file when you need to review what members have already completed."
        ));
        assert!(
            prompt.contains(
                r"E:\workspace\projectSS\MainPage2\.openteams\context\demo\messages.jsonl"
            )
        );
        assert!(!prompt.contains("[agent.role]"));
        assert!(!prompt.contains("PROTOCOL_VERSION ="));
    }

    #[test]
    fn build_user_prompt_markdown_preserves_reference_and_attachments() {
        let agent = test_agent("product", "");
        let message = test_message_with_sender(
            ChatSenderType::Agent,
            Some(Uuid::new_v4()),
            "@product Please confirm the delivery scope",
            json!({
                "sender": {
                    "label": "architect",
                    "name": "architect"
                }
            }),
        );
        let reference = ReferenceContext {
            message_id: Uuid::new_v4(),
            sender_label: "user".to_string(),
            sender_type: ChatSenderType::User,
            created_at: "2026-03-10 08:00:00 UTC".to_string(),
            content: "Referenced message".to_string(),
            attachments: vec![ReferenceAttachment {
                name: "spec.md".to_string(),
                mime_type: Some("text/markdown".to_string()),
                size_bytes: 128,
                kind: "file".to_string(),
                local_path: r"E:\workspace\projectSS\MainPage2\spec.md".to_string(),
            }],
        };
        let message_attachments = MessageAttachmentContext {
            message_id: message.id,
            attachments: vec![ReferenceAttachment {
                name: "ui.png".to_string(),
                mime_type: Some("image/png".to_string()),
                size_bytes: 256,
                kind: "image".to_string(),
                local_path: r"E:\workspace\projectSS\MainPage2\ui.png".to_string(),
            }],
        };

        let prompt = ChatRunner::build_user_prompt_markdown(
            &agent,
            &message,
            Some(&message_attachments),
            Some(&reference),
        );

        assert!(prompt.contains("## envelope"));
        assert!(prompt.contains("## message"));
        assert!(prompt.contains("### message.reference"));
        assert!(prompt.contains("#### message.reference.attachments item 1"));
        assert!(prompt.contains("### message.attachments item 1"));
        assert!(prompt.contains("- **from**: agent:architect"));
        assert!(prompt.contains("- **to**: agent:product"));
        assert!(prompt.contains("~~~text\n@product Please confirm the delivery scope\n~~~"));
        assert!(prompt.contains("~~~text\nReferenced message\n~~~"));
        assert!(prompt.contains(r"- **local_path**: E:\workspace\projectSS\MainPage2\spec.md"));
        assert!(prompt.contains(r"- **local_path**: E:\workspace\projectSS\MainPage2\ui.png"));
        assert!(!prompt.contains("[message]"));
        assert!(!prompt.contains("[message.reference]"));
    }

    #[test]
    fn build_exact_markdown_prompt_includes_routed_message_intent_meaning() {
        let agent = test_agent("product", "");
        let message = test_message_with_sender(
            ChatSenderType::Agent,
            Some(Uuid::new_v4()),
            "@product Please confirm the delivery scope",
            json!({
                "sender": {
                    "label": "architect",
                    "name": "architect"
                },
                "protocol": {
                    "type": "send",
                    "to": "product",
                    "intent": "confirm"
                }
            }),
        );

        let prompt = ChatRunner::build_exact_markdown_prompt(
            &agent,
            &message,
            Path::new(r"E:\workspace\projectSS\MainPage2\.openteams\context\demo"),
            &[],
            None,
            None,
            &[],
            ResolvedPromptLanguage {
                setting: "english",
                code: "en",
                instruction: "You MUST respond in English.",
            },
            Some("Follow the team protocol."),
        );

        assert!(prompt.contains("- **intent**: confirm"));
        assert!(prompt.contains("- **intent_meaning**: Explicit confirmation is required."));
        assert!(prompt.contains("## team.protocol"));
        assert!(prompt.contains("Follow the team protocol."));
    }

    #[test]
    fn build_exact_markdown_prompt_includes_team_protocol_section_when_empty() {
        let agent = test_agent("product", "You are the Product Manager.");
        let message =
            test_message_with_sender(ChatSenderType::User, None, "@product hello", json!({}));

        let prompt = ChatRunner::build_exact_markdown_prompt(
            &agent,
            &message,
            Path::new(r"E:\workspace\projectSS\MainPage2\.openteams\context\demo"),
            &[],
            None,
            None,
            &[],
            ResolvedPromptLanguage {
                setting: "english",
                code: "en",
                instruction: "You MUST respond in English.",
            },
            Some(" "),
        );

        assert!(prompt.contains("## team.protocol"));
        assert!(prompt.contains("- **configured**: false"));
        assert!(prompt.contains("no team collaboration protocol"));
    }

    #[test]
    fn build_exact_markdown_prompt_matches_expected_input_template() {
        let session_id = Uuid::parse_str("1475cda0-6f11-464e-a61a-7dc81217810e").expect("uuid");
        let message_id = Uuid::parse_str("88bd7b05-1ba3-407c-8ca3-a52f14c8aced").expect("uuid");
        let created_at = chrono::DateTime::parse_from_rfc3339("2026-03-10T06:22:12.973Z")
            .expect("timestamp")
            .with_timezone(&Utc);
        let agent = ChatAgent {
            id: Uuid::new_v4(),
            name: "fullstack".to_string(),
            runner_type: "codex".to_string(),
            system_prompt: "You are the team \"Full-stack Engineer\". Your goal is to ship complete user-facing capabilities by aligning backend contracts, frontend behavior, and operational reliability.\n\n\n".to_string(),
            tools_enabled: sqlx::types::Json(json!({})),
            created_at,
            updated_at: created_at,
        };
        let message = ChatMessage {
            id: message_id,
            session_id,
            sender_type: ChatSenderType::User,
            sender_id: None,
            content: "@fullstack ".to_string(),
            mentions: sqlx::types::Json(vec!["fullstack".to_string()]),
            meta: sqlx::types::Json(json!({})),
            created_at,
        };

        let prompt = ChatRunner::build_exact_markdown_prompt(
            &agent,
            &message,
            Path::new(
                r"E:\workspace\projectSS\MainPage2\.openteams\context\1475cda0-6f11-464e-a61a-7dc81217810e",
            ),
            &[],
            None,
            None,
            &[],
            ResolvedPromptLanguage {
                setting: "simplified_chinese",
                code: "zh-Hans",
                instruction: "You MUST respond in Simplified Chinese.",
            },
            Some("Follow the team protocol."),
        );

        let expected = r#"# ChatGroup Message

## message

- **sender**: you
- **content**:

~~~text
@fullstack ~~~

# Must be obeyed

## output format (important)

- **required**: true
- **format**: json
- **container**: list
- **only_send_items_enter_group_history**: true
- **instruction**:

~~~text
- Return ONLY a valid JSON array. Long messages must also be returned in JSON array.
- Your final reply MUST be parseable by a standard JSON parser.
- Escape all double quotes, backslashes, and newlines inside JSON string values.
- Before sending, verify that every `content` value is still a valid JSON string after escaping.
- Only send items will be turned into visible group chat messages and written into group history.
- The current agent is always recorded as the sender automatically. Do not impersonate other senders.
- Do not discuss anything unrelated to the assigned work. Keep every reply concise, precise, and free of filler.
- Use `to = \"you\"` when sending a message to the user. Here `you` refers to the human user.
- For send items, `intent` is optional but recommended when the routing semantics matter.
~~~

### output.message_types item 1

- **type**: send
- **required_fields**: ["type","to","content"]
- **optional_fields**: ["intent"]
- **rules**:

~~~text
- A send item targets exactly one receiver.
- The recipient must be one of the member names listed in group members.
- Use concise language with a clear goal.
- Content may be empty.
- Prefer setting `intent` for machine-readable routing semantics.
- Optional `intent` values for send items: `request` = ask for work or information; `reply` = the receiver should reply; `notify` = informational only, no reply required; `blocker` = report a blocking issue; `confirm` = explicit confirmation is required.
- The system will render the final group message as `@receiver content` and route it to that receiver.
~~~

### output.message_types item 2

- **type**: record
- **required**: false
- **required_fields**: ["type","content"]
- **rules**: Write only long-lived shared facts to shared_blackboard.jsonl. Do not write process descriptions, temporary status, or blockers.
### output.message_types item 3

- **type**: artifact
- **required**: false
- **required_fields**: ["type","content"]
- **rules**: Write only deliverable outputs or their concrete paths to work_records.jsonl.
### output.message_types item 4

- **type**: conclusion
- **required**: false
- **required_fields**: ["type","content"]
- **rules**: Write only the current-turn work status to work_records.jsonl. Include completed work, blockers, or next steps. Do not write long-lived facts.

## output.example

- **json**:

~~~json
[
  {"type": "send", "to": "you", "intent": "request", "content": "I have finished the front implementation"},
  {"type": "send", "to": "architect", "intent": "confirm", "content": "The UI is ready. Please confirm the API contract before I continue."},
  {"type": "record", "content": "The experiment metrics are `latency_p95_ms`, `success_rate`, and `token_cost_usd`."},
  {"type": "artifact", "content": "Saved the experiment plan to `docs/experiments/chat-metrics-plan.md`."},
  {"type": "conclusion", "content": "This round finished the metric definition. Next step is wiring collection into the runner."}
]
~~~

## agent

### role

- **name**: fullstack
- **role**:

~~~text
You are the team "Full-stack Engineer". Your goal is to ship complete user-facing capabilities by aligning backend contracts, frontend behavior, and operational reliability.
~~~

### skills

- **restriction**: You have no skills enabled. Do not attempt to use any skill.


## language

- **setting**: simplified_chinese
- **instruction**: You MUST respond in Simplified Chinese.


## team.protocol

- **configured**: true
- **guidelines**:

~~~text
Follow the team protocol.
~~~


# Group Members

- **members_description**: Other AI members currently in this group
_No other AI members._

# History

## history.group_messages

- **path**: E:\workspace\projectSS\MainPage2\.openteams\context\1475cda0-6f11-464e-a61a-7dc81217810e\messages.jsonl
- **format**: jsonl
- **description**: Group chat history. Each line is a JSON message record containing sender and content, consistent with messages.jsonl history.
- **optional**: true
- **instruction**:

~~~text
If you need to understand the current group chat state, you MAY inspect this file yourself.
Reading history is optional. Do not assume you must read history before acting.
Prioritize reading history when the new message implies continuation or refinement, such as "continue", "继续", "接着", "基于前文", "refine", or "update".
If the current task can be completed independently, you do not need to read history.
~~~

## history.shared_blackboard

- **path**: E:\workspace\projectSS\MainPage2\.openteams\context\1475cda0-6f11-464e-a61a-7dc81217810e\shared_blackboard.jsonl
- **format**: jsonl
- **description**: Persisted shared messages generated from record items.
- **instruction**:

~~~text
You can search by member name to find shared messages published by a specific member.
Before writing a record item, if you are unsure whether the fact was already captured, check this file first.
~~~

## history.work_records

- **path**: E:\workspace\projectSS\MainPage2\.openteams\context\1475cda0-6f11-464e-a61a-7dc81217810e\work_records.jsonl
- **format**: jsonl
- **description**: Persisted work outputs and summaries generated from artifact/conclusion items.
- **instruction**:

~~~text
You can search by member name to find a specific member's work outputs and status summaries.
Use this file when you need to review what members have already completed.
Before writing an artifact or conclusion item, if you are unsure whether similar work or status was already recorded, check this file first.
~~~

# envelope

- **session_id**: 1475cda0-6f11-464e-a61a-7dc81217810e
- **from**: user:you
- **to**: agent:fullstack
- **message_id**: 88bd7b05-1ba3-407c-8ca3-a52f14c8aced
- **timestamp**: 2026-03-10 06:22:12.973 UTC

"#;

        assert_eq!(prompt, expected);
    }

    #[test]
    fn strip_embedded_team_protocol_from_system_prompt_removes_legacy_embedded_block() {
        let prompt = ChatRunner::strip_embedded_team_protocol_from_system_prompt(
            "You are the team \"Backend Engineer\".\n\n(Embedded: Team Collaboration Protocol)\nFollow the team protocol.\n\nInputs:\n- input\n\nOutput format:\n- output",
        );

        assert_eq!(
            prompt,
            "You are the team \"Backend Engineer\".\n\nInputs:\n- input\n\nOutput format:\n- output"
        );
    }

    #[test]
    fn resolve_team_protocol_guidelines_falls_back_when_empty() {
        let prompt = ChatRunner::resolve_team_protocol_guidelines(Some(" "));

        assert_eq!(prompt, "no team collaboration protocol");
    }
}
