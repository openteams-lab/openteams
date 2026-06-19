#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowEventContext {
    pub session_id: Option<String>,
    pub workflow_id: Option<String>,
    pub workspace_id: Option<String>,
    pub user_id_hash: Option<String>,
    pub agent_role: Option<String>,
    pub timestamp: String,
    pub event_source: String,
    pub plan_id: Option<String>,
    pub task_id: Option<String>,
    pub status: Option<String>,
    pub duration_ms: Option<i64>,
    pub error_code: Option<String>,
    pub metadata_version: i64,
}

impl WorkflowEventContext {
    pub fn new(event_source: &str) -> Self {
        Self {
            session_id: None,
            workflow_id: None,
            workspace_id: None,
            user_id_hash: None,
            agent_role: None,
            timestamp: Utc::now().to_rfc3339(),
            event_source: event_source.to_string(),
            plan_id: None,
            task_id: None,
            status: None,
            duration_ms: None,
            error_code: None,
            metadata_version: 1,
        }
    }

    pub fn with_session(mut self, id: Uuid) -> Self {
        self.session_id = Some(id.to_string());
        self
    }

    pub fn with_workflow(mut self, id: Uuid) -> Self {
        self.workflow_id = Some(id.to_string());
        self
    }

    pub fn with_workspace(mut self, id: &str) -> Self {
        self.workspace_id = Some(id.to_string());
        self
    }

    pub fn with_user_id_hash(mut self, hash: &str) -> Self {
        self.user_id_hash = Some(hash.to_string());
        self
    }

    pub fn with_agent_role(mut self, role: &str) -> Self {
        self.agent_role = Some(role.to_string());
        self
    }

    pub fn with_plan(mut self, id: Uuid) -> Self {
        self.plan_id = Some(id.to_string());
        self
    }

    pub fn with_task(mut self, id: Uuid) -> Self {
        self.task_id = Some(id.to_string());
        self
    }

    pub fn with_status(mut self, status: &str) -> Self {
        self.status = Some(status.to_string());
        self
    }

    pub fn with_duration_ms(mut self, ms: i64) -> Self {
        self.duration_ms = Some(ms);
        self
    }

    pub fn with_error_code(mut self, code: &str) -> Self {
        self.error_code = Some(code.to_string());
        self
    }

    pub fn to_properties(&self) -> Value {
        serde_json::to_value(self).unwrap_or_else(|_| json!({}))
    }
}

// ---------------------------------------------------------------------------
// Event source validation
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub enum PrivacyViolation {
    ForbiddenField(String),
    UnallowedField(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum WorkflowAnalyticsEvent {
    // 1. Process funnel
    SessionCreated,
    AgentAdded,
    PlanGenerated,
    PlanExecuted,
    StepStarted,
    StepCompleted,
    ExecutionStateChanged,

    // 2. Collaboration efficiency
    AgentMentioned,
    AgentStateChanged,
    ApprovalRequested,
    ApprovalResolved,
    HandoffCompleted,

    // 3. User engagement
    MessageSent,
    AttachmentAdded,
    DiffViewed,
    SessionArchived,

    // 4. Quality outcomes
    WorkflowCompleted,
    WorkflowFailed,
    StepReviewed,
    DiffGenerated,
    RetryTriggered,
    ReviewDecisionRecorded,

    // 5. Risk/anomaly
    AgentError,
    PermissionDenied,
    ApprovalTimeout,
    ApiFailure,
    WebsocketDisconnected,
    RunnerInterrupted,
}

impl WorkflowAnalyticsEvent {
    pub fn event_name(&self) -> &'static str {
        match self {
            Self::SessionCreated => "workflow.session_created",
            Self::AgentAdded => "workflow.agent_added",
            Self::PlanGenerated => "workflow.plan_generated",
            Self::PlanExecuted => "workflow.plan_executed",
            Self::StepStarted => "workflow.step_started",
            Self::StepCompleted => "workflow.step_completed",
            Self::ExecutionStateChanged => "workflow.execution_state_changed",

            Self::AgentMentioned => "collaboration.agent_mentioned",
            Self::AgentStateChanged => "collaboration.agent_state_changed",
            Self::ApprovalRequested => "collaboration.approval_requested",
            Self::ApprovalResolved => "collaboration.approval_resolved",
            Self::HandoffCompleted => "collaboration.handoff_completed",

            Self::MessageSent => "engagement.message_sent",
            Self::AttachmentAdded => "engagement.attachment_added",
            Self::DiffViewed => "engagement.diff_viewed",
            Self::SessionArchived => "engagement.session_archived",

            Self::WorkflowCompleted => "quality.workflow_completed",
            Self::WorkflowFailed => "quality.workflow_failed",
            Self::StepReviewed => "quality.step_reviewed",
            Self::DiffGenerated => "quality.diff_generated",
            Self::RetryTriggered => "quality.retry_triggered",
            Self::ReviewDecisionRecorded => "quality.review_decision_recorded",

            Self::AgentError => "risk.agent_error",
            Self::PermissionDenied => "risk.permission_denied",
            Self::ApprovalTimeout => "risk.approval_timeout",
            Self::ApiFailure => "risk.api_failure",
            Self::WebsocketDisconnected => "risk.websocket_disconnected",
            Self::RunnerInterrupted => "risk.runner_interrupted",
        }
    }

    pub fn category(&self) -> &'static str {
        match self {
            Self::SessionCreated
            | Self::AgentAdded
            | Self::PlanGenerated
            | Self::PlanExecuted
            | Self::StepStarted
            | Self::StepCompleted
            | Self::ExecutionStateChanged => "process_funnel",

            Self::AgentMentioned
            | Self::AgentStateChanged
            | Self::ApprovalRequested
            | Self::ApprovalResolved
            | Self::HandoffCompleted => "collaboration",

            Self::MessageSent
            | Self::AttachmentAdded
            | Self::DiffViewed
            | Self::SessionArchived => "engagement",

            Self::WorkflowCompleted
            | Self::WorkflowFailed
            | Self::StepReviewed
            | Self::DiffGenerated
            | Self::RetryTriggered
            | Self::ReviewDecisionRecorded => "quality",

            Self::AgentError
            | Self::PermissionDenied
            | Self::ApprovalTimeout
            | Self::ApiFailure
            | Self::WebsocketDisconnected
            | Self::RunnerInterrupted => "risk",
        }
    }
}

// ---------------------------------------------------------------------------
// Record function: build and send analytics event
// ---------------------------------------------------------------------------
