//! State reducer for workflow execution, step, and agent-session transitions.
//!
//! All workflow state writes should go through this module so that transition
//! validation and audit-event emission stay consistent.

use db::models::{
    workflow_agent_session::WorkflowAgentSession,
    workflow_event::{CreateWorkflowEvent, WorkflowEvent},
    workflow_execution::WorkflowExecution,
    workflow_step::WorkflowStep,
    workflow_types::*,
};
use serde::Serialize;
use sqlx::SqlitePool;
use uuid::Uuid;

fn to_wire_format<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| format!("{:?}", value as *const T))
}

#[derive(Debug, thiserror::Error)]
pub enum TransitionError {
    #[error("非法 execution 状态迁移: {from} -> {to}")]
    IllegalExecutionTransition { from: String, to: String },
    #[error("非法 step 状态迁移: {from} -> {to}")]
    IllegalStepTransition { from: String, to: String },
    #[error("非法 agent session 状态迁移: {from} -> {to}")]
    IllegalAgentSessionTransition { from: String, to: String },
    #[error("数据库错误: {0}")]
    Database(String),
}

impl From<sqlx::Error> for TransitionError {
    fn from(e: sqlx::Error) -> Self {
        TransitionError::Database(e.to_string())
    }
}

#[derive(Debug)]
pub struct TransitionResult<T> {
    pub entity: T,
    pub event: WorkflowEvent,
}

fn is_step_waiting(status: &WorkflowStepStatus) -> bool {
    matches!(
        status,
        WorkflowStepStatus::WaitingInput | WorkflowStepStatus::WaitingReview
    )
}

fn is_step_completed_like(status: &WorkflowStepStatus) -> bool {
    matches!(
        status,
        WorkflowStepStatus::Completed | WorkflowStepStatus::Skipped | WorkflowStepStatus::Cancelled
    )
}

fn is_step_ready_like(status: &WorkflowStepStatus) -> bool {
    matches!(
        status,
        WorkflowStepStatus::Pending | WorkflowStepStatus::Ready | WorkflowStepStatus::Blocked
    )
}

fn is_step_failed_like(status: &WorkflowStepStatus) -> bool {
    matches!(
        status,
        WorkflowStepStatus::Failed
            | WorkflowStepStatus::InterruptRequested
            | WorkflowStepStatus::Interrupted
    )
}

pub fn derive_execution_status(
    current: &WorkflowExecutionStatus,
    step_statuses: &[WorkflowStepStatus],
) -> WorkflowExecutionStatus {
    use WorkflowExecutionStatus as E;

    if *current == E::Recompiling {
        return E::Recompiling;
    }

    if step_statuses.is_empty() {
        return E::Pending;
    }

    if step_statuses
        .iter()
        .all(|status| matches!(status, WorkflowStepStatus::Pending))
    {
        return E::Pending;
    }

    if step_statuses.iter().all(is_step_completed_like) {
        return E::Completed;
    }

    if step_statuses
        .iter()
        .any(|status| matches!(status, WorkflowStepStatus::Running))
    {
        return E::Running;
    }

    if step_statuses.iter().any(is_step_failed_like) {
        return E::Failed;
    }

    if step_statuses.iter().any(is_step_waiting)
        && step_statuses
            .iter()
            .all(|status| is_step_waiting(status) || is_step_completed_like(status))
    {
        return E::Waiting;
    }

    if step_statuses
        .iter()
        .all(|status| is_step_ready_like(status) || is_step_completed_like(status))
    {
        return E::Paused;
    }

    E::Paused
}

pub fn derive_agent_session_state(
    current: &WorkflowAgentSessionState,
    step_statuses: &[WorkflowStepStatus],
) -> WorkflowAgentSessionState {
    use WorkflowAgentSessionState as A;

    if *current == A::Expired {
        return A::Expired;
    }

    if step_statuses.is_empty() {
        return A::Idle;
    }

    if step_statuses
        .iter()
        .any(|status| matches!(status, WorkflowStepStatus::Running))
    {
        return A::Running;
    }

    if step_statuses
        .iter()
        .any(|status| matches!(status, WorkflowStepStatus::WaitingInput))
    {
        return A::WaitingInput;
    }

    if step_statuses
        .iter()
        .any(|status| matches!(status, WorkflowStepStatus::WaitingReview))
    {
        return A::WaitingApproval;
    }

    if step_statuses.iter().any(is_step_failed_like) {
        return A::Failed;
    }

    if step_statuses.iter().all(is_step_completed_like) {
        return A::Completed;
    }

    A::Idle
}

fn is_agent_session_derived_state(state: &WorkflowAgentSessionState) -> bool {
    matches!(
        state,
        WorkflowAgentSessionState::Idle
            | WorkflowAgentSessionState::Running
            | WorkflowAgentSessionState::WaitingInput
            | WorkflowAgentSessionState::WaitingApproval
            | WorkflowAgentSessionState::Failed
            | WorkflowAgentSessionState::Completed
    )
}

// ---------------------------------------------------------------------------
// Execution transitions
// ---------------------------------------------------------------------------

pub fn validate_execution_transition(
    from: &WorkflowExecutionStatus,
    to: &WorkflowExecutionStatus,
) -> Result<(), TransitionError> {
    use WorkflowExecutionStatus::*;

    let allowed = match from {
        Pending => matches!(to, Running | Failed | Paused | Recompiling | Completed | Waiting),
        Running => matches!(to, Failed | Paused | Recompiling | Completed | Waiting),
        Failed => matches!(to, Running | Paused | Recompiling | Waiting),
        Paused => matches!(to, Running | Failed | Recompiling | Completed | Waiting),
        Recompiling => matches!(to, Running | Failed | Paused | Completed | Waiting),
        Waiting => matches!(to, Running | Failed | Paused | Recompiling | Completed),
        Completed => false,
    };

    if allowed {
        Ok(())
    } else {
        tracing::warn!(from = ?from, to = ?to, "非法 execution 状态迁移被拒绝");
        Err(TransitionError::IllegalExecutionTransition {
            from: format!("{:?}", from),
            to: format!("{:?}", to),
        })
    }
}

// ---------------------------------------------------------------------------
// Step transitions
// ---------------------------------------------------------------------------

pub fn validate_step_transition(
    from: &WorkflowStepStatus,
    to: &WorkflowStepStatus,
) -> Result<(), TransitionError> {
    use WorkflowStepStatus::*;

    let allowed = match from {
        Pending => matches!(to, Ready | Blocked | Cancelled),
        Ready => matches!(to, Running),
        Running => matches!(
            to,
            WaitingInput | WaitingReview | InterruptRequested | Completed | Failed
        ),
        WaitingInput => matches!(to, Ready | Failed),
        WaitingReview => matches!(to, Ready | Failed),
        InterruptRequested => matches!(to, Interrupted | Failed),
        Interrupted => matches!(to, Failed | Cancelled),
        Blocked => matches!(to, Ready | Cancelled),
        Failed => matches!(to, Ready),
        Completed | Skipped | Cancelled => false,
    };

    if allowed {
        Ok(())
    } else {
        tracing::warn!(from = ?from, to = ?to, "非法 step 状态迁移被拒绝");
        Err(TransitionError::IllegalStepTransition {
            from: format!("{:?}", from),
            to: format!("{:?}", to),
        })
    }
}

// ---------------------------------------------------------------------------
// Agent session transitions
// ---------------------------------------------------------------------------

pub fn validate_agent_session_transition(
    from: &WorkflowAgentSessionState,
    to: &WorkflowAgentSessionState,
) -> Result<(), TransitionError> {
    let allowed = match from {
        WorkflowAgentSessionState::Expired => false,
        _ => is_agent_session_derived_state(to) && from != to,
    };

    if allowed {
        Ok(())
    } else {
        tracing::warn!(from = ?from, to = ?to, "非法 agent session 状态迁移被拒绝");
        Err(TransitionError::IllegalAgentSessionTransition {
            from: format!("{:?}", from),
            to: format!("{:?}", to),
        })
    }
}

// ---------------------------------------------------------------------------
// Cross-layer compatibility
// ---------------------------------------------------------------------------

pub fn validate_step_in_execution(
    execution_status: &WorkflowExecutionStatus,
    step_status: &WorkflowStepStatus,
) -> bool {
    use WorkflowExecutionStatus as E;
    use WorkflowStepStatus as S;

    match execution_status {
        E::Pending => matches!(step_status, S::Pending | S::Ready | S::Blocked),
        E::Running => true,
        E::Failed => !matches!(step_status, S::Running),
        E::Paused => matches!(step_status, S::Pending | S::Ready | S::Blocked | S::Completed),
        E::Recompiling => !matches!(step_status, S::Running),
        E::Completed => matches!(step_status, S::Completed | S::Skipped | S::Cancelled),
        E::Waiting => matches!(step_status, S::WaitingInput | S::WaitingReview | S::Completed),
    }
}

pub fn validate_agent_session_in_execution(
    execution_status: &WorkflowExecutionStatus,
    session_state: &WorkflowAgentSessionState,
) -> bool {
    use WorkflowAgentSessionState as A;
    use WorkflowExecutionStatus as E;

    match execution_status {
        E::Pending => matches!(session_state, A::Idle),
        E::Running => matches!(
            session_state,
            A::Idle
                | A::Running
                | A::WaitingInput
                | A::WaitingApproval
                | A::Completed
                | A::Failed
        ),
        E::Failed => matches!(
            session_state,
            A::Idle | A::WaitingInput | A::WaitingApproval | A::Completed | A::Failed
        ),
        E::Paused => matches!(session_state, A::Idle | A::Completed),
        E::Recompiling => matches!(
            session_state,
            A::Idle | A::WaitingInput | A::WaitingApproval | A::Completed | A::Failed
        ),
        E::Completed => matches!(session_state, A::Idle | A::Completed | A::Expired),
        E::Waiting => matches!(
            session_state,
            A::Idle | A::WaitingInput | A::WaitingApproval | A::Completed
        ),
    }
}

fn execution_event_type(to: &WorkflowExecutionStatus) -> WorkflowEventType {
    use WorkflowExecutionStatus::*;

    match to {
        Pending => WorkflowEventType::ExecutionCreated,
        Running => WorkflowEventType::ExecutionRunning,
        Failed => WorkflowEventType::ExecutionFailed,
        Paused => WorkflowEventType::ExecutionPaused,
        Recompiling => WorkflowEventType::PlanRecompiled,
        Completed => WorkflowEventType::ExecutionCompleted,
        Waiting => WorkflowEventType::ExecutionWaiting,
    }
}

pub async fn transition_execution(
    pool: &SqlitePool,
    execution: &WorkflowExecution,
    to: WorkflowExecutionStatus,
) -> Result<TransitionResult<WorkflowExecution>, TransitionError> {
    let from = &execution.status;
    validate_execution_transition(from, &to)?;

    let from_str = to_wire_format(from);
    let to_str = to_wire_format(&to);
    let event_type = execution_event_type(&to);

    let updated = WorkflowExecution::update_status(pool, execution.id, to).await?;

    let event = WorkflowEvent::create(
        pool,
        &CreateWorkflowEvent {
            execution_id: execution.id,
            round_id: None,
            step_id: None,
            agent_session_id: None,
            event_type,
            status_before: Some(from_str.clone()),
            status_after: Some(to_str.clone()),
            detail_json: None,
        },
        Uuid::new_v4(),
    )
    .await?;

    tracing::info!(
        execution_id = %execution.id,
        from = %from_str,
        to = %to_str,
        "execution 状态迁移完成"
    );

    Ok(TransitionResult {
        entity: updated,
        event,
    })
}

pub async fn transition_execution_with_context(
    pool: &SqlitePool,
    execution: &WorkflowExecution,
    to: WorkflowExecutionStatus,
    round_id: Option<Uuid>,
    detail: Option<&str>,
) -> Result<TransitionResult<WorkflowExecution>, TransitionError> {
    let from = &execution.status;
    validate_execution_transition(from, &to)?;

    let from_str = to_wire_format(from);
    let to_str = to_wire_format(&to);
    let event_type = execution_event_type(&to);

    let updated = WorkflowExecution::update_status(pool, execution.id, to).await?;

    let detail_json = detail.map(|message| {
        serde_json::json!({
            "message": message,
            "execution_id": execution.id.to_string(),
            "compiled_graph_hash": execution.compiled_graph_hash,
        })
        .to_string()
    });

    let event = WorkflowEvent::create(
        pool,
        &CreateWorkflowEvent {
            execution_id: execution.id,
            round_id,
            step_id: None,
            agent_session_id: None,
            event_type,
            status_before: Some(from_str.clone()),
            status_after: Some(to_str.clone()),
            detail_json,
        },
        Uuid::new_v4(),
    )
    .await?;

    tracing::info!(
        execution_id = %execution.id,
        from = %from_str,
        to = %to_str,
        "execution 状态迁移完成"
    );

    Ok(TransitionResult {
        entity: updated,
        event,
    })
}

pub async fn transition_step(
    pool: &SqlitePool,
    execution: &WorkflowExecution,
    step: &WorkflowStep,
    to: WorkflowStepStatus,
) -> Result<TransitionResult<WorkflowStep>, TransitionError> {
    validate_step_transition(&step.status, &to)?;

    if !validate_step_in_execution(&execution.status, &to) {
        tracing::warn!(
            execution_status = ?execution.status,
            step_status = ?to,
            step_id = %step.id,
            "step 状态与 execution 状态组合约束冲突"
        );
        return Err(TransitionError::IllegalStepTransition {
            from: format!("{:?}", step.status),
            to: format!("{:?} (execution 状态 {:?} 下不允许)", to, execution.status),
        });
    }

    let from_str = to_wire_format(&step.status);
    let to_str = to_wire_format(&to);

    let updated = WorkflowStep::update_status(pool, step.id, to).await?;

    let event = WorkflowEvent::create(
        pool,
        &CreateWorkflowEvent {
            execution_id: execution.id,
            round_id: Some(step.round_id),
            step_id: Some(step.id),
            agent_session_id: step.assigned_workflow_agent_session_id,
            event_type: WorkflowEventType::StepStatusChanged,
            status_before: Some(from_str.clone()),
            status_after: Some(to_str.clone()),
            detail_json: Some(
                serde_json::json!({
                    "step_key": step.step_key,
                    "step_title": step.title,
                })
                .to_string(),
            ),
        },
        Uuid::new_v4(),
    )
    .await?;

    tracing::info!(
        execution_id = %execution.id,
        step_id = %step.id,
        step_key = %step.step_key,
        from = %from_str,
        to = %to_str,
        "step 状态迁移完成"
    );

    Ok(TransitionResult {
        entity: updated,
        event,
    })
}

pub async fn transition_agent_session(
    pool: &SqlitePool,
    execution: &WorkflowExecution,
    session: &WorkflowAgentSession,
    to: WorkflowAgentSessionState,
) -> Result<TransitionResult<WorkflowAgentSession>, TransitionError> {
    validate_agent_session_transition(&session.state, &to)?;

    if !validate_agent_session_in_execution(&execution.status, &to) {
        tracing::warn!(
            execution_status = ?execution.status,
            session_state = ?to,
            session_id = %session.id,
            "agent session 状态与 execution 状态组合约束冲突"
        );
        return Err(TransitionError::IllegalAgentSessionTransition {
            from: format!("{:?}", session.state),
            to: format!("{:?} (execution 状态 {:?} 下不允许)", to, execution.status),
        });
    }

    let from_str = to_wire_format(&session.state);
    let to_str = to_wire_format(&to);

    let updated = WorkflowAgentSession::update_state(pool, session.id, to).await?;

    let event = WorkflowEvent::create(
        pool,
        &CreateWorkflowEvent {
            execution_id: execution.id,
            round_id: None,
            step_id: None,
            agent_session_id: Some(session.id),
            event_type: WorkflowEventType::AgentSessionStateChanged,
            status_before: Some(from_str.clone()),
            status_after: Some(to_str.clone()),
            detail_json: None,
        },
        Uuid::new_v4(),
    )
    .await?;

    tracing::info!(
        execution_id = %execution.id,
        session_id = %session.id,
        from = %from_str,
        to = %to_str,
        "agent session 状态迁移完成"
    );

    Ok(TransitionResult {
        entity: updated,
        event,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execution_transition_matrix_matches_simplified_states() {
        assert!(
            validate_execution_transition(
                &WorkflowExecutionStatus::Pending,
                &WorkflowExecutionStatus::Paused,
            )
            .is_ok()
        );
        assert!(
            validate_execution_transition(
                &WorkflowExecutionStatus::Paused,
                &WorkflowExecutionStatus::Running,
            )
            .is_ok()
        );
        assert!(
            validate_execution_transition(
                &WorkflowExecutionStatus::Running,
                &WorkflowExecutionStatus::Waiting,
            )
            .is_ok()
        );
        assert!(
            validate_execution_transition(
                &WorkflowExecutionStatus::Failed,
                &WorkflowExecutionStatus::Running,
            )
            .is_ok()
        );
        assert!(
            validate_execution_transition(
                &WorkflowExecutionStatus::Completed,
                &WorkflowExecutionStatus::Running,
            )
            .is_err()
        );
    }

    #[test]
    fn derive_execution_status_prioritizes_running_then_failed() {
        assert_eq!(
            derive_execution_status(
                &WorkflowExecutionStatus::Paused,
                &[
                    WorkflowStepStatus::Completed,
                    WorkflowStepStatus::Running,
                    WorkflowStepStatus::Failed,
                ],
            ),
            WorkflowExecutionStatus::Running
        );

        assert_eq!(
            derive_execution_status(
                &WorkflowExecutionStatus::Paused,
                &[WorkflowStepStatus::Completed, WorkflowStepStatus::Failed],
            ),
            WorkflowExecutionStatus::Failed
        );
    }

    #[test]
    fn derive_execution_status_maps_waiting_and_paused_rules() {
        assert_eq!(
            derive_execution_status(
                &WorkflowExecutionStatus::Running,
                &[
                    WorkflowStepStatus::WaitingInput,
                    WorkflowStepStatus::WaitingReview,
                    WorkflowStepStatus::Completed,
                ],
            ),
            WorkflowExecutionStatus::Waiting
        );

        assert_eq!(
            derive_execution_status(
                &WorkflowExecutionStatus::Running,
                &[
                    WorkflowStepStatus::Pending,
                    WorkflowStepStatus::Ready,
                    WorkflowStepStatus::Completed,
                ],
            ),
            WorkflowExecutionStatus::Paused
        );
    }

    #[test]
    fn derive_execution_status_keeps_recompiling_override() {
        assert_eq!(
            derive_execution_status(
                &WorkflowExecutionStatus::Recompiling,
                &[WorkflowStepStatus::Ready],
            ),
            WorkflowExecutionStatus::Recompiling
        );
    }

    #[test]
    fn derive_agent_session_state_follows_step_state() {
        assert_eq!(
            derive_agent_session_state(
                &WorkflowAgentSessionState::Idle,
                &[WorkflowStepStatus::Running],
            ),
            WorkflowAgentSessionState::Running
        );
        assert_eq!(
            derive_agent_session_state(
                &WorkflowAgentSessionState::Idle,
                &[WorkflowStepStatus::WaitingInput],
            ),
            WorkflowAgentSessionState::WaitingInput
        );
        assert_eq!(
            derive_agent_session_state(
                &WorkflowAgentSessionState::Idle,
                &[WorkflowStepStatus::WaitingReview],
            ),
            WorkflowAgentSessionState::WaitingApproval
        );
        assert_eq!(
            derive_agent_session_state(
                &WorkflowAgentSessionState::Idle,
                &[WorkflowStepStatus::Failed],
            ),
            WorkflowAgentSessionState::Failed
        );
        assert_eq!(
            derive_agent_session_state(
                &WorkflowAgentSessionState::Idle,
                &[WorkflowStepStatus::Completed],
            ),
            WorkflowAgentSessionState::Completed
        );
        assert_eq!(
            derive_agent_session_state(
                &WorkflowAgentSessionState::Expired,
                &[WorkflowStepStatus::Running],
            ),
            WorkflowAgentSessionState::Expired
        );
    }

    #[test]
    fn agent_session_transition_matrix_follows_derived_states() {
        assert!(validate_agent_session_transition(
            &WorkflowAgentSessionState::Idle,
            &WorkflowAgentSessionState::WaitingApproval,
        )
        .is_ok());
        assert!(validate_agent_session_transition(
            &WorkflowAgentSessionState::Failed,
            &WorkflowAgentSessionState::WaitingInput,
        )
        .is_ok());
        assert!(validate_agent_session_transition(
            &WorkflowAgentSessionState::Interrupted,
            &WorkflowAgentSessionState::Completed,
        )
        .is_ok());
        assert!(validate_agent_session_transition(
            &WorkflowAgentSessionState::Running,
            &WorkflowAgentSessionState::Paused,
        )
        .is_err());
        assert!(validate_agent_session_transition(
            &WorkflowAgentSessionState::Completed,
            &WorkflowAgentSessionState::Completed,
        )
        .is_err());
        assert!(validate_agent_session_transition(
            &WorkflowAgentSessionState::Expired,
            &WorkflowAgentSessionState::Idle,
        )
        .is_err());
    }

    #[test]
    fn execution_step_compatibility_matches_new_rules() {
        assert!(validate_step_in_execution(
            &WorkflowExecutionStatus::Running,
            &WorkflowStepStatus::Running,
        ));
        assert!(validate_step_in_execution(
            &WorkflowExecutionStatus::Waiting,
            &WorkflowStepStatus::WaitingReview,
        ));
        assert!(!validate_step_in_execution(
            &WorkflowExecutionStatus::Paused,
            &WorkflowStepStatus::Running,
        ));
        assert!(!validate_step_in_execution(
            &WorkflowExecutionStatus::Failed,
            &WorkflowStepStatus::Running,
        ));
    }

    #[test]
    fn execution_agent_compatibility_matches_new_rules() {
        assert!(validate_agent_session_in_execution(
            &WorkflowExecutionStatus::Waiting,
            &WorkflowAgentSessionState::WaitingApproval,
        ));
        assert!(validate_agent_session_in_execution(
            &WorkflowExecutionStatus::Paused,
            &WorkflowAgentSessionState::Idle,
        ));
        assert!(!validate_agent_session_in_execution(
            &WorkflowExecutionStatus::Paused,
            &WorkflowAgentSessionState::Running,
        ));
        assert!(validate_agent_session_in_execution(
            &WorkflowExecutionStatus::Recompiling,
            &WorkflowAgentSessionState::WaitingInput,
        ));
        assert!(!validate_agent_session_in_execution(
            &WorkflowExecutionStatus::Completed,
            &WorkflowAgentSessionState::Failed,
        ));
    }

    #[test]
    fn execution_event_type_matches_new_states() {
        assert_eq!(
            execution_event_type(&WorkflowExecutionStatus::Pending),
            WorkflowEventType::ExecutionCreated
        );
        assert_eq!(
            execution_event_type(&WorkflowExecutionStatus::Waiting),
            WorkflowEventType::ExecutionWaiting
        );
        assert_eq!(
            execution_event_type(&WorkflowExecutionStatus::Recompiling),
            WorkflowEventType::PlanRecompiled
        );
    }

    #[test]
    fn wire_format_produces_expected_values() {
        assert_eq!(to_wire_format(&WorkflowExecutionStatus::Waiting), "waiting");
        assert_eq!(to_wire_format(&WorkflowExecutionStatus::Recompiling), "recompiling");
        assert_eq!(
            to_wire_format(&WorkflowStepStatus::WaitingInput),
            "waiting_input"
        );
        assert_eq!(
            to_wire_format(&WorkflowAgentSessionState::WaitingApproval),
            "waiting_approval"
        );
    }
}
