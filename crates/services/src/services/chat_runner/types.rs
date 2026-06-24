struct DiffInfo {
    _truncated: bool,
    observed_paths: Vec<String>,
}

struct ContextSnapshot {
    workspace_path: PathBuf,
    context_compacted: bool,
    compression_warning: Option<chat::CompressionWarning>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ChatRunActivityLineType {
    Thinking,
    Tool,
    Assistant,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatRunActivityLine {
    pub line_id: Uuid,
    pub run_id: Uuid,
    pub session_id: Uuid,
    pub session_agent_id: Uuid,
    pub agent_id: Uuid,
    pub agent_name: String,
    pub sequence: u64,
    pub line_type: ChatRunActivityLineType,
    pub stream_type: ChatStreamDeltaType,
    pub content: String,
    pub created_at: String,
}

/// How a workspace file changed during an agent run.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum FileChangeType {
    Created,
    Modified,
    Deleted,
}

/// A single workspace file changed by an agent run, sent with `FileChangeRefresh`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FileChangeEntry {
    /// Workspace-relative path (forward slashes).
    pub path: String,
    pub change_type: FileChangeType,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum ChatStreamEvent {
    MessageNew {
        message: ChatMessage,
    },
    MessageUpdated {
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
    AgentRunStarted {
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        agent_name: String,
        run_id: Uuid,
        /// User (or upstream) message whose processing triggered this run.
        source_message_id: Uuid,
        /// Frontend-supplied id from the source message meta (`client_message_id`).
        /// Lets the frontend correlate this run with its pending placeholder.
        client_message_id: Option<String>,
        started_at: Option<chrono::DateTime<Utc>>,
    },
    AgentActivityLine {
        line: ChatRunActivityLine,
    },
    AgentState {
        session_agent_id: Uuid,
        agent_id: Uuid,
        state: ChatSessionAgentState,
        /// Run that triggered this state change. Run-scoped transitions
        /// (running/idle/dead/stopping driven by a concrete run) carry the
        /// active run id; states with no associated run (e.g. orphan
        /// recovery) leave this `None`.
        run_id: Option<Uuid>,
        started_at: Option<chrono::DateTime<Utc>>,
    },
    MentionAcknowledged {
        session_id: Uuid,
        message_id: Uuid,
        mentioned_agent: String,
        agent_id: Uuid,
        status: MentionStatus,
    },
    QueueUpdated {
        session_id: Uuid,
        session_agent_id: Uuid,
        queue: MemberQueueSnapshot,
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
    WorkflowGenerateDetected {
        session_id: Uuid,
        session_agent_id: Uuid,
        run_id: Uuid,
    },
    WorkflowPlanPreviewReady {
        session_id: Uuid,
        plan_id: Uuid,
        workflow_card_message: ChatMessage,
    },
    WorkflowExecutionUpdated {
        session_id: Uuid,
        execution_id: Uuid,
    },
    WorkflowGraphUpdated {
        session_id: Uuid,
        execution_id: Uuid,
        graph_version: String,
        reason: String,
        nodes: Vec<WorkflowPlanNode>,
        edges: Vec<WorkflowPlanEdge>,
        changed_step_ids: Vec<String>,
    },
    WorkflowRuntimeLine {
        line_id: Uuid,
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
    },
    /// Emitted once after an agent finishes processing a message (all run
    /// records persisted), signalling the frontend to refresh its view of
    /// workspace file changes. `changed_files` lists the files the run touched.
    FileChangeRefresh {
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        /// Source message whose processing triggered this run.
        message_id: Uuid,
        changed_files: Vec<FileChangeEntry>,
        ts: chrono::DateTime<Utc>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
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
    #[error("session not found: {0}")]
    SessionNotFound(Uuid),
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
    #[error(transparent)]
    SessionWorktree(#[from] SessionWorktreeError),
    #[error("invalid workflow plan: {0}")]
    InvalidWorkflowPlan(String),
}
