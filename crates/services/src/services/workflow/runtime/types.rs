#[derive(Debug, thiserror::Error)]
pub enum WorkflowRuntimeError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Executor(#[from] ExecutorError),
    #[error(transparent)]
    SessionWorktree(#[from] crate::services::session_worktree::SessionWorktreeError),
    #[error("workflow validation error: {0}")]
    Validation(String),
    #[error("workflow step interrupted: {0}")]
    Interrupted(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowCardAgent {
    pub session_agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_agent_session_id: Option<String>,
    pub agent_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowCardState {
    PreviewReady,
    PreviewInvalid,
    Pending,
    Running,
    Waiting,
    Paused,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowCardStep {
    pub id: String,
    pub step_key: String,
    pub title: String,
    pub step_type: String,
    pub status: String,
    pub review_phase: Option<String>,
    pub lead_review_required: bool,
    pub user_review_required: bool,
    pub retry_count: i32,
    pub max_retry: i32,
    pub loop_key: Option<String>,
    pub latest_review: Option<WorkflowCardReview>,
    pub agent_name: Option<String>,
    pub summary_text: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowCardReview {
    pub reviewer_type: String,
    pub verdict: String,
    pub feedback: String,
    pub review_round: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowCardLoop {
    pub id: String,
    pub loop_key: String,
    pub status: String,
    pub retry_count: i32,
    pub max_retry: i32,
    pub user_review_required: bool,
    pub rejection_reason: Option<String>,
    pub member_step_ids: Vec<String>,
    pub review_step_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowPendingReview {
    pub review_id: String,
    pub review_type: String,
    pub target_id: String,
    pub target_title: String,
    pub context_summary: String,
    pub prompt_template: WorkflowReviewPromptTemplate,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowPendingInput {
    pub input_id: String,
    pub step_id: String,
    pub step_key: String,
    pub target_title: String,
    pub prompt: String,
    pub description: Option<String>,
    pub placeholder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowIterationSummary {
    pub round_index: i32,
    pub status: String,
    pub user_feedback: Option<String>,
    pub result_summary: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowRoundGraph {
    pub round_id: String,
    pub round_index: i32,
    pub revision_id: String,
    pub status: String,
    pub plan: WorkflowPlanJson,
    pub steps: Vec<WorkflowCardStep>,
    pub loops: Vec<WorkflowCardLoop>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowReviewPromptTemplate {
    pub message: String,
    pub fields: Vec<WorkflowReviewField>,
    pub actions: Vec<WorkflowReviewAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowReviewField {
    pub key: String,
    pub label: String,
    pub field_type: String,
    pub required: bool,
    pub placeholder: Option<String>,
    pub options: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowReviewAction {
    pub action: String,
    pub label: String,
    pub style: String,
    pub requires_feedback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowCardProjection {
    pub execution_id: Option<String>,
    pub plan_id: String,
    pub revision_id: String,
    pub title: String,
    pub goal: String,
    pub state: WorkflowCardState,
    pub execution_status: String,
    #[serde(default)]
    pub stopped_by_user: bool,
    pub error_message: Option<String>,
    pub completed_step_count: usize,
    pub total_step_count: usize,
    pub result_summary: Option<String>,
    pub outputs: Vec<String>,
    pub agents: Vec<WorkflowCardAgent>,
    pub steps: Vec<WorkflowCardStep>,
    pub current_round: i32,
    pub loops: Vec<WorkflowCardLoop>,
    pub pending_review: Option<WorkflowPendingReview>,
    #[serde(default)]
    pub pending_reviews: Vec<WorkflowPendingReview>,
    pub pending_input: Option<WorkflowPendingInput>,
    pub iteration_history: Vec<WorkflowIterationSummary>,
    pub round_graphs: Vec<WorkflowRoundGraph>,
    pub plan: WorkflowPlanJson,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub validation_errors: Option<String>,
    #[serde(default)]
    pub is_terminal: bool,
    #[serde(default)]
    pub has_transcripts: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct WorkflowStepRunResult {
    pub run_id: Uuid,
    pub summary: String,
    pub content: String,
    pub outputs: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct WorkflowAgentRunOutput {
    pub output: String,
    pub run_id: Option<Uuid>,
    pub token_usage: Option<TokenUsageInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryPayload {
    pub summary: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub outputs: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowRevisionFeedbackSource {
    Lead,
    User,
}
