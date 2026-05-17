//! Transcript actions and workflow-completion artifact persistence.

use chrono::Utc;
use db::models::{
    chat_agent::ChatAgent,
    chat_session_agent::ChatSessionAgent,
    chat_work_item::{ChatWorkItem, ChatWorkItemType},
    workflow_agent_session::WorkflowAgentSession,
    workflow_execution::WorkflowExecution,
    workflow_step::WorkflowStep,
    workflow_transcript::{CreateWorkflowTranscript, WorkflowTranscript},
    workflow_types::*,
};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::{
    super::{
        chat_runner::ChatRunner,
        workflow_analytics,
        workflow_runtime::{SummaryPayload, WorkflowRuntimeError, parse_summary_payload},
    },
    OrchestratorError, ResolvedTranscriptAction, WorkflowOrchestrator,
    resolve_step_workflow_session,
};

pub(super) enum TranscriptResolution {
    Resume,
    Fail(String),
}

fn resolve_interactive_transcript_action(
    entry_type: &str,
    resolved_action: &str,
) -> Result<TranscriptResolution, OrchestratorError> {
    match (entry_type, resolved_action) {
        ("approval_request", "approved")
        | ("permission_request", "granted")
        | ("continue_confirmation", "continued")
        | ("input_request", "submitted") => Ok(TranscriptResolution::Resume),
        ("approval_request", "rejected") => Ok(TranscriptResolution::Fail(
            "Approval rejected by user.".to_string(),
        )),
        ("permission_request", "denied") => Ok(TranscriptResolution::Fail(
            "Permission denied by user.".to_string(),
        )),
        ("input_request", action) => Err(OrchestratorError::IllegalTransition(format!(
            "unsupported action '{}' for input request",
            action
        ))),
        ("continue_confirmation", action) => Err(OrchestratorError::IllegalTransition(format!(
            "unsupported action '{}' for continue confirmation",
            action
        ))),
        (entry_type, action) => Err(OrchestratorError::IllegalTransition(format!(
            "unsupported action '{}' for transcript type '{}'",
            action, entry_type
        ))),
    }
}

fn can_resolve_interactive_transcript(execution_status: &WorkflowExecutionStatus) -> bool {
    matches!(
        execution_status,
        WorkflowExecutionStatus::Waiting | WorkflowExecutionStatus::Running
    )
}

impl WorkflowOrchestrator {
    pub(super) fn merge_transcript_meta(
        existing_meta_json: Option<&str>,
        updates: serde_json::Value,
    ) -> String {
        let mut meta = existing_meta_json
            .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        if !meta.is_object() {
            meta = serde_json::json!({});
        }
        let meta_object = meta.as_object_mut().expect("meta object");

        if let Some(update_object) = updates.as_object() {
            for (key, value) in update_object {
                meta_object.insert(key.clone(), value.clone());
            }
        }

        meta.to_string()
    }

    pub async fn resolve_transcript_action(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        transcript_id: Uuid,
        resolved_action: &str,
        input_text: Option<&str>,
    ) -> Result<ResolvedTranscriptAction, OrchestratorError> {
        let transcript = WorkflowTranscript::find_by_id(pool, transcript_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("transcript {} 未找到", transcript_id))
            })?;
        let execution = WorkflowExecution::find_by_id(pool, transcript.execution_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("execution {} 未找到", transcript.execution_id))
            })?;

        if transcript.entry_type == "final_review" {
            return Err(OrchestratorError::IllegalTransition(
                "final_review must be resolved through workflow iteration feedback".to_string(),
            ));
        }

        if !can_resolve_interactive_transcript(&execution.status) {
            return Err(OrchestratorError::IllegalTransition(format!(
                "execution {} is {:?}, expected waiting or running",
                execution.id, execution.status
            )));
        }

        let step_id = transcript.step_id.ok_or_else(|| {
            OrchestratorError::NotFound(format!("transcript {} 缺少 step_id", transcript.id))
        })?;
        let workflow_agent_session_id = transcript.workflow_agent_session_id.ok_or_else(|| {
            OrchestratorError::NotFound(format!(
                "transcript {} 缺少 workflow_agent_session_id",
                transcript.id
            ))
        })?;

        let step = WorkflowStep::find_by_id(pool, step_id)
            .await?
            .ok_or_else(|| OrchestratorError::NotFound(format!("step {} 未找到", step_id)))?;
        let workflow_session = WorkflowAgentSession::find_by_id(pool, workflow_agent_session_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "workflow agent session {} 未找到",
                    workflow_agent_session_id
                ))
            })?;

        if transcript.entry_type == "step_review" {
            return Self::resolve_step_review_action(
                pool,
                chat_runner,
                &transcript,
                &execution,
                &step,
                &workflow_session,
                resolved_action,
                input_text,
            )
            .await;
        }

        if transcript.entry_type == "loop_review" {
            return Self::resolve_loop_review_action(
                pool,
                chat_runner,
                &transcript,
                &execution,
                &step,
                &workflow_session,
                resolved_action,
                input_text,
            )
            .await;
        }

        let existing_meta: serde_json::Value = transcript
            .meta_json
            .as_deref()
            .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        if matches!(
            existing_meta.get("resolved"),
            Some(serde_json::Value::Bool(true))
        ) {
            return Err(OrchestratorError::IllegalTransition(format!(
                "transcript {} already resolved",
                transcript.id
            )));
        }

        let resolution_kind =
            resolve_interactive_transcript_action(&transcript.entry_type, resolved_action)?;

        let input_text = input_text
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if transcript.entry_type == "input_request" && input_text.is_none() {
            return Err(OrchestratorError::IllegalTransition(
                "input request requires non-empty input_text".to_string(),
            ));
        }

        let updated_meta_json = Self::merge_transcript_meta(
            transcript.meta_json.as_deref(),
            serde_json::json!({
                "resolved": true,
                "resolved_action": resolved_action,
                "resolved_at": Utc::now().to_rfc3339(),
                "input_text": input_text,
            }),
        );
        let updated_transcript =
            WorkflowTranscript::update_meta_json(pool, transcript.id, &updated_meta_json).await?;

        workflow_analytics::track_approval_resolved(
            chat_runner.analytics_service(),
            execution.session_id,
            execution.id,
            step.id,
            resolved_action,
        );

        let decision_notice = if let Some(input_text) = input_text.as_deref() {
            input_text.to_string()
        } else {
            format!("User {} {}", resolved_action, transcript.content.trim())
        };

        match resolution_kind {
            TranscriptResolution::Resume => {
                let resumed_step = Self::transition_step_and_sync(
                    pool,
                    chat_runner,
                    &execution,
                    &step,
                    WorkflowStepStatus::Ready,
                    "step_resumed",
                )
                .await?;
                let resumed_execution =
                    Self::synchronize_runtime_state(pool, execution.id, false).await?;
                let resumed_session = WorkflowAgentSession::find_by_id(pool, workflow_session.id)
                    .await?
                    .ok_or_else(|| {
                        OrchestratorError::NotFound(format!(
                            "workflow agent session {} not found",
                            workflow_session.id
                        ))
                    })?;

                let resolution_meta = serde_json::json!({
                    "source_transcript_id": updated_transcript.id,
                    "action": resolved_action,
                })
                .to_string();
                Self::write_transcript(
                    pool,
                    resumed_execution.id,
                    Some(resumed_step.round_id),
                    Some(resumed_session.id),
                    Some(resumed_step.id),
                    "user",
                    "message",
                    &decision_notice,
                    Some(&resolution_meta),
                )
                .await?;

                Self::refresh_execution_projection(pool, chat_runner, resumed_execution.id, None)
                    .await?;

                Ok(ResolvedTranscriptAction {
                    transcript: updated_transcript,
                    execution: resumed_execution,
                    should_wake_scheduler: true,
                })
            }
            TranscriptResolution::Fail(failure_reason) => {
                let recorded_step = WorkflowStep::record_execution_result(
                    pool,
                    step.id,
                    Uuid::new_v4(),
                    Some(
                        serde_json::to_string(&SummaryPayload {
                            summary: failure_reason.clone(),
                            content: Some(transcript.content.clone()),
                            outputs: vec![],
                        })
                        .unwrap_or_else(|_| failure_reason.clone()),
                    ),
                    None,
                )
                .await?;
                let failed_step = Self::transition_step_and_sync(
                    pool,
                    chat_runner,
                    &execution,
                    &recorded_step,
                    WorkflowStepStatus::Failed,
                    "step_failed",
                )
                .await?;
                let failed_execution =
                    Self::synchronize_runtime_state(pool, execution.id, false).await?;
                let failed_session = WorkflowAgentSession::find_by_id(pool, workflow_session.id)
                    .await?
                    .ok_or_else(|| {
                        OrchestratorError::NotFound(format!(
                            "workflow agent session {} not found",
                            workflow_session.id
                        ))
                    })?;

                let resolution_meta = serde_json::json!({
                    "source_transcript_id": updated_transcript.id,
                    "action": resolved_action,
                    "status": "failed",
                })
                .to_string();
                Self::write_transcript(
                    pool,
                    failed_execution.id,
                    Some(failed_step.round_id),
                    Some(failed_session.id),
                    Some(failed_step.id),
                    "user",
                    "message",
                    &decision_notice,
                    Some(&resolution_meta),
                )
                .await?;

                Self::refresh_execution_projection(
                    pool,
                    chat_runner,
                    failed_execution.id,
                    Some(failure_reason),
                )
                .await?;

                Ok(ResolvedTranscriptAction {
                    transcript: updated_transcript,
                    execution: failed_execution,
                    should_wake_scheduler: false,
                })
            }
        }
    }

    pub(super) async fn persist_completion_work_items(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        steps: &[WorkflowStep],
        workflow_sessions: &[WorkflowAgentSession],
        session_agents: &[ChatSessionAgent],
        agents: &[ChatAgent],
    ) -> Result<(), OrchestratorError> {
        if !ChatWorkItem::find_by_run_id(pool, execution.id)
            .await?
            .is_empty()
        {
            return Ok(());
        }

        let result_step = steps
            .iter()
            .find(|step| step.step_type == WorkflowStepType::Result)
            .ok_or_else(|| {
                OrchestratorError::NotFound("workflow result step 未找到".to_string())
            })?;
        let payload =
            parse_summary_payload(result_step.summary_text.as_deref()).ok_or_else(|| {
                OrchestratorError::Runtime(WorkflowRuntimeError::Validation(
                    "workflow result step 缺少可持久化的完成摘要".to_string(),
                ))
            })?;
        let workflow_session =
            resolve_step_workflow_session(execution, workflow_sessions, result_step)?;
        let session_agent = session_agents
            .iter()
            .find(|item| item.id == workflow_session.session_agent_id)
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "session agent {} 未找到",
                    workflow_session.session_agent_id
                ))
            })?;
        let agent = agents
            .iter()
            .find(|item| item.id == session_agent.agent_id)
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("agent {} 未找到", session_agent.agent_id))
            })?;

        let conclusion = match payload.content.as_deref().map(str::trim) {
            Some(content) if !content.is_empty() && content != payload.summary.trim() => {
                format!("{}\n\n{}", payload.summary, content)
            }
            _ => payload.summary.clone(),
        };

        chat_runner
            .persist_work_item(
                execution.session_id,
                session_agent.id,
                agent.id,
                execution.id,
                &agent.name,
                ChatWorkItemType::Conclusion,
                conclusion,
            )
            .await?;

        for output in payload.outputs {
            let output = output.trim();
            if output.is_empty() {
                continue;
            }

            chat_runner
                .persist_work_item(
                    execution.session_id,
                    session_agent.id,
                    agent.id,
                    execution.id,
                    &agent.name,
                    ChatWorkItemType::Artifact,
                    format!("`{output}`"),
                )
                .await?;
        }

        Ok(())
    }

    pub async fn write_transcript(
        pool: &SqlitePool,
        execution_id: Uuid,
        round_id: Option<Uuid>,
        workflow_agent_session_id: Option<Uuid>,
        step_id: Option<Uuid>,
        sender_type: &str,
        entry_type: &str,
        content: &str,
        meta_json: Option<&str>,
    ) -> Result<WorkflowTranscript, OrchestratorError> {
        WorkflowTranscript::create(
            pool,
            &CreateWorkflowTranscript {
                execution_id,
                round_id,
                workflow_agent_session_id,
                step_id,
                sender_type: sender_type.to_string(),
                entry_type: entry_type.to_string(),
                content: content.to_string(),
                meta_json: meta_json.map(String::from),
            },
            Uuid::new_v4(),
        )
        .await
        .map_err(OrchestratorError::Database)
    }

    pub async fn resolve_transcript(
        pool: &SqlitePool,
        transcript_id: Uuid,
        resolved_action: &str,
    ) -> Result<WorkflowTranscript, OrchestratorError> {
        let _transcript = WorkflowTranscript::find_by_id(pool, transcript_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("transcript {} 未找到", transcript_id))
            })?;
        let meta = serde_json::json!({
            "resolved": true,
            "resolved_action": resolved_action,
        });
        WorkflowTranscript::update_meta_json(pool, transcript_id, &meta.to_string())
            .await
            .map_err(OrchestratorError::Database)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interactive_transcripts_can_be_resolved_while_execution_is_waiting_or_running() {
        assert!(can_resolve_interactive_transcript(
            &WorkflowExecutionStatus::Waiting
        ));
        assert!(can_resolve_interactive_transcript(
            &WorkflowExecutionStatus::Running
        ));
        assert!(!can_resolve_interactive_transcript(
            &WorkflowExecutionStatus::Paused
        ));
        assert!(!can_resolve_interactive_transcript(
            &WorkflowExecutionStatus::Completed
        ));
        assert!(!can_resolve_interactive_transcript(
            &WorkflowExecutionStatus::Failed
        ));
    }

    #[test]
    fn resolve_interactive_transcript_action_handles_all_supported_requests() {
        assert!(matches!(
            resolve_interactive_transcript_action("approval_request", "approved"),
            Ok(TranscriptResolution::Resume)
        ));
        assert!(matches!(
            resolve_interactive_transcript_action("approval_request", "rejected"),
            Ok(TranscriptResolution::Fail(_))
        ));
        assert!(matches!(
            resolve_interactive_transcript_action("permission_request", "granted"),
            Ok(TranscriptResolution::Resume)
        ));
        assert!(matches!(
            resolve_interactive_transcript_action("permission_request", "denied"),
            Ok(TranscriptResolution::Fail(_))
        ));
        assert!(matches!(
            resolve_interactive_transcript_action("continue_confirmation", "continued"),
            Ok(TranscriptResolution::Resume)
        ));
        assert!(matches!(
            resolve_interactive_transcript_action("input_request", "submitted"),
            Ok(TranscriptResolution::Resume)
        ));
    }

    #[test]
    fn resolve_interactive_transcript_action_rejects_unsupported_combinations() {
        assert!(matches!(
            resolve_interactive_transcript_action("input_request", "approved"),
            Err(OrchestratorError::IllegalTransition(_))
        ));
        assert!(matches!(
            resolve_interactive_transcript_action("continue_confirmation", "denied"),
            Err(OrchestratorError::IllegalTransition(_))
        ));
        assert!(matches!(
            resolve_interactive_transcript_action("unknown_entry", "approved"),
            Err(OrchestratorError::IllegalTransition(_))
        ));
    }
}
