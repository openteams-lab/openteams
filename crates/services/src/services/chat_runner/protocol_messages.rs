#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AgentProtocolMessageType {
    Send,
    Record,
    #[serde(alias = "artiface", alias = "artefact")]
    Artifact,
    Conclusion,
    WorkflowGenerate,
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
    plan_check: Option<bool>,
    #[serde(default)]
    content: String,
    #[serde(default)]
    design_doc_path: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AgentProtocolError {
    code: ChatProtocolNoticeCode,
    target: Option<String>,
    detail: Option<String>,
}

/// Result of processing agent protocol output.
/// Distinguishes between successful parse, retryable parse failures, and
/// protocol failures that were reported to the chat.
#[derive(Debug)]
pub(super) enum ProtocolProcessResult {
    /// Messages were parsed and dispatched successfully. Contains the number of
    /// visible chat messages created.
    Success(usize),
    /// The agent output could not be converted into protocol messages and the
    /// failure was reported to the chat as a protocol error.
    ProtocolFailure,
    /// The output could not be parsed as a valid JSON array. The caller should
    /// decide whether to retry based on the current retry attempt count.
    RetryableParseFailure {
        code: ChatProtocolNoticeCode,
        detail: Option<String>,
    },
    /// A `workflow_generate` control signal was detected in the agent output.
    /// The caller should trigger the plan generation pipeline after processing
    /// any co-occurring `send`/`artifact`/`record`/`conclusion` messages.
    WorkflowGenerateDetected {
        /// Number of visible chat messages created alongside the workflow_generate.
        send_count: usize,
        /// Whether a finalized plan exists and plan generation should proceed.
        plan_check: bool,
        /// The content field from the workflow_generate message (may be empty).
        workflow_content: String,
        /// Optional paths to design documents referenced in the workflow_generate message.
        design_doc_paths: Option<Vec<String>>,
    },
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredWorkRecordEntry {
    run_id: Uuid,
    message_type: String,
    content: String,
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
