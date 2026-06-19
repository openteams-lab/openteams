#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UserIterationFeedbackDetail {
    pub what_wrong: String,
    pub expected: String,
    pub priority: Option<String>,
    pub additional_notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UserIterationFeedback {
    pub execution_id: String,
    pub round_id: String,
    pub action: String,
    pub feedback: Option<UserIterationFeedbackDetail>,
}

#[derive(Debug, Clone)]
pub struct IterationRoundSummary {
    pub round_index: i32,
    pub status: String,
    pub result_summary: Option<String>,
    pub outputs: Vec<String>,
    pub step_summaries: Vec<String>,
}

pub struct IterationManager<'a> {
    pub db: &'a DBService,
    pub pool: &'a SqlitePool,
    pub chat_runner: &'a ChatRunner,
    pub session: &'a ChatSession,
    pub session_agents: &'a [ChatSessionAgent],
    pub agents: &'a [ChatAgent],
}

#[derive(Debug, Clone)]
pub struct IterationRoundCreation {
    pub execution: WorkflowExecution,
    pub revision: WorkflowPlanRevision,
    pub round: WorkflowRound,
    pub steps: Vec<WorkflowStep>,
    pub edges: Vec<WorkflowStepEdge>,
    pub loops: Vec<WorkflowLoop>,
    pub feedback: WorkflowIterationFeedback,
}
