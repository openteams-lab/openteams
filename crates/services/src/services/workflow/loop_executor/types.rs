#[derive(Debug)]
pub(crate) enum LoopOutcome {
    Progressed,
    Completed,
    Parked,
    Failed(String),
}

pub(crate) struct LoopExecutor<'a> {
    pub db: &'a DBService,
    pub pool: &'a SqlitePool,
    pub chat_runner: &'a ChatRunner,
    pub execution: &'a WorkflowExecution,
    pub workflow_agent_sessions: &'a [WorkflowAgentSession],
    pub session: &'a ChatSession,
    pub session_agents: &'a [ChatSessionAgent],
    pub agents: &'a [ChatAgent],
    pub plan: &'a WorkflowPlan,
}

enum LoopReviewDecision {
    Passed,
    Rejected {
        feedback: String,
        step_feedbacks: HashMap<String, String>,
    },
    LimitReached {
        feedback: String,
        review_attempt: i32,
    },
}
