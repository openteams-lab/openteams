//! Step input handling: park-for-user-action, follow-up prompts, and final-review parking.

use db::{
    DBService,
    models::{
        chat_session::ChatSession, chat_session_agent::ChatSessionAgent,
        workflow_agent_session::WorkflowAgentSession, workflow_execution::WorkflowExecution,
        workflow_step::WorkflowStep, workflow_transcript::WorkflowTranscript, workflow_types::*,
    },
};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::{
    super::{
        chat_runner::ChatRunner,
        workflow_analytics,
        workflow_runtime::{
            SummaryPayload, WorkflowRuntimeError, parse_summary_payload,
            workflow_step_protocol_json_schema,
        },
    },
    OrchestratorError, ResolvedTranscriptAction, WorkflowOrchestrator, load_agents_for_session,
    resolve_step_workflow_session,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum StepFollowUpMode {
    Paused,
    Failed,
}

#[derive(Debug, Clone)]
pub(super) struct FailedStepFollowUpContext {
    pub(super) source_transcript_id: Option<Uuid>,
    pub(super) previous_message_content: String,
}

impl WorkflowOrchestrator {
    fn is_step_ready_input(status: &WorkflowStepStatus) -> bool {
        matches!(
            status,
            WorkflowStepStatus::WaitingInput
                | WorkflowStepStatus::Failed
                | WorkflowStepStatus::WaitingReview
                | WorkflowStepStatus::Interrupted
        )
    }

    pub(super) fn derive_failed_step_follow_up_context(
        step: &WorkflowStep,
        transcripts: &[WorkflowTranscript],
    ) -> FailedStepFollowUpContext {
        if let Some(entry) = transcripts
            .iter()
            .rev()
            .find(|entry| entry.sender_type != "user" && !entry.content.trim().is_empty())
        {
            return FailedStepFollowUpContext {
                source_transcript_id: Some(entry.id),
                previous_message_content: entry.content.trim().to_string(),
            };
        }

        if let Some(payload) = parse_summary_payload(step.summary_text.as_deref()) {
            if let Some(content) = payload
                .content
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return FailedStepFollowUpContext {
                    source_transcript_id: None,
                    previous_message_content: content.to_string(),
                };
            }
            let summary = payload.summary.trim();
            if !summary.is_empty() {
                return FailedStepFollowUpContext {
                    source_transcript_id: None,
                    previous_message_content: summary.to_string(),
                };
            }
        }

        FailedStepFollowUpContext {
            source_transcript_id: None,
            previous_message_content: format!(
                "Step \"{}\" failed without a persisted agent reply. Continue from the latest user guidance and recover the same task.",
                step.title
            ),
        }
    }

    async fn prepare_failed_step_input_follow_up(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        step: &WorkflowStep,
        input_text: &str,
    ) -> Result<
        (
            WorkflowExecution,
            WorkflowStep,
            WorkflowTranscript,
            FailedStepFollowUpContext,
        ),
        OrchestratorError,
    > {
        let transcripts = WorkflowTranscript::find_by_step(pool, step.id).await?;
        let follow_up_context = Self::derive_failed_step_follow_up_context(step, &transcripts);
        let (execution, ready_step) = Self::prepare_step_retry(pool, chat_runner, step.id).await?;
        let workflow_sessions = WorkflowAgentSession::find_by_execution(pool, execution.id).await?;
        let workflow_session =
            resolve_step_workflow_session(&execution, &workflow_sessions, &ready_step)?;
        let transcript_meta = serde_json::json!({
            "source_step_status": "failed",
            "source_transcript_id": follow_up_context.source_transcript_id,
            "action": "submitted",
            "restart_mode": "follow_up",
        })
        .to_string();
        let input_transcript = Self::write_transcript(
            pool,
            execution.id,
            Some(ready_step.round_id),
            Some(workflow_session.id),
            Some(ready_step.id),
            "user",
            "message",
            input_text,
            Some(&transcript_meta),
        )
        .await?;
        Ok((execution, ready_step, input_transcript, follow_up_context))
    }

    pub async fn submit_step_input(
        db: &DBService,
        chat_runner: &ChatRunner,
        step_id: Uuid,
        input_text: &str,
    ) -> Result<ResolvedTranscriptAction, OrchestratorError> {
        let pool = &db.pool;
        let step = WorkflowStep::find_by_id(pool, step_id)
            .await?
            .ok_or_else(|| OrchestratorError::NotFound(format!("step {} 未找到", step_id)))?;
        let execution = WorkflowExecution::find_by_id(pool, step.execution_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("execution {} 未找到", step.execution_id))
            })?;

        let input_text = input_text.trim();
        if input_text.is_empty() {
            return Err(OrchestratorError::IllegalTransition(
                "step input requires non-empty text".to_string(),
            ));
        }

        if Self::is_step_ready_input(&step.status) {
            let (ready_step, input_transcript, previous_message_content, retry_execution, mode) =
                if step.status == WorkflowStepStatus::Failed {
                    let (prepared_execution, prepared_step, recorded_input, follow_up_context) =
                        Self::prepare_failed_step_input_follow_up(
                            pool,
                            chat_runner,
                            &step,
                            input_text,
                        )
                        .await?;
                    (
                        prepared_step,
                        recorded_input,
                        follow_up_context.previous_message_content,
                        prepared_execution,
                        StepFollowUpMode::Failed,
                    )
                } else {
                    let transcript = WorkflowTranscript::find_by_step(pool, step.id)
                        .await?
                        .into_iter()
                        .rev()
                        .find(|entry| {
                            entry.entry_type == "input_request"
                                && entry.meta_json.as_deref().is_none_or(|meta_json| {
                                    serde_json::from_str::<serde_json::Value>(meta_json)
                                        .ok()
                                        .and_then(|value| {
                                            value
                                                .get("resolved")
                                                .and_then(|resolved| resolved.as_bool())
                                        })
                                        != Some(true)
                                })
                        })
                        .ok_or_else(|| {
                            OrchestratorError::NotFound(format!(
                                "step {} 缺少待处理的 input_request transcript",
                                step.id
                            ))
                        })?;
                    let previous_message_content = transcript.content.clone();
                    let resolved = Self::resolve_transcript_action(
                        pool,
                        chat_runner,
                        transcript.id,
                        "submitted",
                        Some(input_text),
                    )
                    .await?;
                    let ready_step =
                        WorkflowStep::find_by_id(pool, step.id)
                            .await?
                            .ok_or_else(|| {
                                OrchestratorError::NotFound(format!("step {} 未找到", step.id))
                            })?;
                    (
                        ready_step,
                        resolved.transcript,
                        previous_message_content,
                        resolved.execution,
                        StepFollowUpMode::Paused,
                    )
                };
            if ready_step.status != WorkflowStepStatus::Ready {
                return Err(OrchestratorError::IllegalTransition(format!(
                    "step {} is {:?}, expected ready after input submission",
                    ready_step.id, ready_step.status
                )));
            }

            let active_execution =
                Self::activate_execution_for_step_retry(pool, chat_runner, &retry_execution)
                    .await?;
            let session = ChatSession::find_by_id(pool, active_execution.session_id)
                .await?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!(
                        "session {} 未找到",
                        active_execution.session_id
                    ))
                })?;
            let session_agents = ChatSessionAgent::find_all_for_session(pool, session.id).await?;
            let workflow_sessions =
                WorkflowAgentSession::find_by_execution(pool, active_execution.id).await?;
            let workflow_session =
                resolve_step_workflow_session(&active_execution, &workflow_sessions, &ready_step)?;
            let session_agent = session_agents
                .iter()
                .find(|item| item.id == workflow_session.session_agent_id)
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!(
                        "session agent {} 未找到",
                        workflow_session.session_agent_id
                    ))
                })?;
            let agents = load_agents_for_session(pool, &session_agents).await?;
            let agent = agents
                .iter()
                .find(|item| item.id == session_agent.agent_id)
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("agent {} 未找到", session_agent.agent_id))
                })?;
            if workflow_session.agent_session_id.is_none()
                && session_agent.agent_session_id.is_none()
            {
                return Err(OrchestratorError::IllegalTransition(format!(
                    "step {} cannot resume input because no persisted agent session id was found",
                    ready_step.id
                )));
            }
            let running_step = Self::transition_step_and_sync(
                pool,
                chat_runner,
                &active_execution,
                &ready_step,
                WorkflowStepStatus::Running,
                "step_resumed",
            )
            .await?;
            let follow_up_prompt = Self::build_step_follow_up_prompt(
                &running_step,
                &previous_message_content,
                input_text,
                mode,
            );
            tracing::debug!(
                follow_up_prompt = follow_up_prompt,
                "submit step input for following up prompt"
            );

            let protocol_message = match Self::run_step_agent_protocol_with_retry(
                db,
                pool,
                chat_runner,
                &session,
                agent,
                session_agent,
                workflow_session,
                &follow_up_prompt,
                &running_step,
                true,
            )
            .await
            {
                Ok((message, _raw_output)) => message,
                Err(OrchestratorError::Runtime(WorkflowRuntimeError::Interrupted(reason))) => {
                    let _ = Self::write_transcript(
                        pool,
                        active_execution.id,
                        running_step.round_id.into(),
                        Some(workflow_session.id),
                        Some(running_step.id),
                        "system",
                        "message",
                        &format!("Step \"{}\" interrupted: {}", running_step.title, reason),
                        None,
                    )
                    .await;
                    let execution = Self::refresh_execution_projection_with_reason(
                        pool,
                        chat_runner,
                        active_execution.id,
                        Some(reason.clone()),
                        "step_input_failed",
                        vec![running_step.id.to_string()],
                    )
                    .await?;
                    return Ok(ResolvedTranscriptAction {
                        transcript: input_transcript.clone(),
                        execution,
                        should_wake_scheduler: false,
                    });
                }
                Err(err) => {
                    let failed_step = WorkflowStep::record_execution_result(
                        pool,
                        running_step.id,
                        Uuid::new_v4(),
                        Some(
                            serde_json::to_string(&SummaryPayload {
                                summary: err.to_string(),
                                content: None,
                                outputs: vec![],
                            })
                            .unwrap_or_else(|_| err.to_string()),
                        ),
                        None,
                    )
                    .await?;
                    Self::transition_step_and_sync(
                        pool,
                        chat_runner,
                        &active_execution,
                        &failed_step,
                        WorkflowStepStatus::Failed,
                        "step_failed",
                    )
                    .await?;
                    let _ = Self::write_transcript(
                        pool,
                        active_execution.id,
                        failed_step.round_id.into(),
                        Some(workflow_session.id),
                        Some(failed_step.id),
                        "system",
                        "message",
                        &format!("Step \"{}\" failed: {}", failed_step.title, err),
                        None,
                    )
                    .await;
                    let execution = Self::refresh_execution_projection_with_reason(
                        pool,
                        chat_runner,
                        active_execution.id,
                        Some(err.to_string()),
                        "step_input_failed",
                        vec![running_step.id.to_string()],
                    )
                    .await?;
                    return Ok(ResolvedTranscriptAction {
                        transcript: input_transcript.clone(),
                        execution,
                        should_wake_scheduler: false,
                    });
                }
            };

            let outcome = Self::handle_step_protocol_message(
                pool,
                chat_runner,
                &active_execution,
                &running_step,
                workflow_session,
                protocol_message,
            )
            .await?;
            let execution = match outcome {
                super::StepOutcome::Completed => {
                    Self::finalize_single_step_retry_completion(
                        pool,
                        chat_runner,
                        &active_execution,
                        running_step.id,
                    )
                    .await?
                }
                super::StepOutcome::Parked => {
                    Self::refresh_execution_projection_with_reason(
                        pool,
                        chat_runner,
                        active_execution.id,
                        None,
                        "step_input_waiting",
                        vec![running_step.id.to_string()],
                    )
                    .await?
                }
                super::StepOutcome::Failed(reason) => {
                    Self::refresh_execution_projection_with_reason(
                        pool,
                        chat_runner,
                        active_execution.id,
                        Some(reason),
                        "step_input_failed",
                        vec![running_step.id.to_string()],
                    )
                    .await?
                }
            };

            return Ok(ResolvedTranscriptAction {
                transcript: input_transcript,
                execution,
                should_wake_scheduler: false,
            });
        }

        let workflow_sessions = WorkflowAgentSession::find_by_execution(pool, execution.id).await?;
        let workflow_session =
            resolve_step_workflow_session(&execution, &workflow_sessions, &step)?;

        Self::write_transcript(
            pool,
            execution.id,
            Some(step.round_id),
            Some(workflow_session.id),
            Some(step.id),
            "user",
            "message",
            input_text,
            None,
        )
        .await?;

        let execution = Self::refresh_execution_projection_with_reason(
            pool,
            chat_runner,
            execution.id,
            None,
            "step_input_recorded",
            vec![step.id.to_string()],
        )
        .await?;

        Ok(ResolvedTranscriptAction {
            transcript: WorkflowTranscript::find_by_step(pool, step.id)
                .await?
                .into_iter()
                .last()
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("step {} input transcript 未找到", step.id))
                })?,
            execution,
            should_wake_scheduler: false,
        })
    }

    pub(super) async fn park_for_user_action(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        step: &WorkflowStep,
        workflow_session: &WorkflowAgentSession,
        entry_type: &str,
        content: &str,
        description: Option<String>,
        waiting_step_status: WorkflowStepStatus,
        waiting_agent_state: WorkflowAgentSessionState,
        extra_meta: Option<serde_json::Value>,
    ) -> Result<WorkflowTranscript, OrchestratorError> {
        let waiting_step = Self::transition_step_and_sync(
            pool,
            chat_runner,
            execution,
            step,
            waiting_step_status,
            "step_waiting",
        )
        .await?;
        let waiting_execution = Self::synchronize_runtime_state(pool, execution.id, false).await?;
        let waiting_session = WorkflowAgentSession::find_by_id(pool, workflow_session.id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "workflow agent session {} not found",
                    workflow_session.id
                ))
            })?;
        let _ = waiting_agent_state;

        let mut meta_json = serde_json::json!({
            "description": description,
            "resolved": false,
        });
        if let Some(extra_meta) = extra_meta
            && let Some(extra_meta_obj) = extra_meta.as_object()
            && let Some(meta_json_obj) = meta_json.as_object_mut()
        {
            for (key, value) in extra_meta_obj {
                meta_json_obj.insert(key.clone(), value.clone());
            }
        }
        let meta_json = meta_json.to_string();

        let transcript = Self::write_transcript(
            pool,
            waiting_execution.id,
            Some(waiting_step.round_id),
            Some(waiting_session.id),
            Some(waiting_step.id),
            "control",
            entry_type,
            content,
            Some(&meta_json),
        )
        .await?;

        if matches!(
            entry_type,
            "approval_request" | "permission_request" | "continue_confirmation" | "input_request"
        ) {
            workflow_analytics::track_approval_requested(
                chat_runner.analytics_service(),
                execution.session_id,
                waiting_execution.id,
                waiting_step.id,
                entry_type,
            );
        }

        Self::refresh_execution_projection(pool, chat_runner, waiting_execution.id, None).await?;

        Ok(transcript)
    }

    /// Park execution for final user review after all steps have completed.
    pub(super) async fn park_for_final_review(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
    ) -> Result<WorkflowTranscript, OrchestratorError> {
        let transcript = Self::ensure_unresolved_final_review(pool, execution.id).await?;

        Self::refresh_execution_projection_with_reason(
            pool,
            chat_runner,
            execution.id,
            None,
            "execution_waiting_final_review",
            Vec::new(),
        )
        .await?;

        Ok(transcript)
    }

    pub(super) fn build_step_follow_up_prompt(
        step: &WorkflowStep,
        previous_message_content: &str,
        input_text: &str,
        mode: StepFollowUpMode,
    ) -> String {
        let opening = match mode {
            StepFollowUpMode::Paused => format!(
                "The user has replied while workflow step \"{}\" is paused.",
                step.title
            ),
            StepFollowUpMode::Failed => format!(
                "The previous attempt for workflow step \"{}\" failed. The user has now provided follow-up input to restart the same agent session and continue execution.",
                step.title
            ),
        };
        let resume_rule = match mode {
            StepFollowUpMode::Paused => {
                "Do not repeat the whole task from scratch. Resume from the paused point."
            }
            StepFollowUpMode::Failed => {
                "Do not restart the whole task from scratch unless required. Resume from the failed point and fix the issue that caused the failure."
            }
        };
        let json_schema =
            workflow_step_protocol_json_schema(step.execution_id, &step.step_key, true);
        format!(
            r#"{opening}

Previous agent message:
{previous_message_content}

Latest user input:
{input_text}

Continue from the same session context and reply with exactly one workflow protocol JSON object.
{resume_rule}

Workflow step context:
- step_key: {step_key}
- execution_id: {execution_id}
- step_type: {step_type}
- step_title: {step_title}
- step_instructions: {step_instructions}

Workflow step protocol JSON schema:
{{
  "type": "final_result | error | approval_request | permission_request | continue_confirmation | input_request",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",

  "summary": "required when type=final_result",
  "content": "required when type=final_result, optional when type=error",
  "outputs": ["optional relative workspace paths when type=final_result"],

  "message": "required when type=error or type=continue_confirmation",

  "title": "required when type=approval_request or type=permission_request",
  "description": "optional when type=approval_request | permission_request | continue_confirmation | input_request",

  "prompt": "required when type=input_request",
  "placeholder": "optional when type=input_request"
}}

Required JSON Schema:
```json
{json_schema}
```

Rules:
- step_key must stay exactly "{step_key}".
- execution_id must stay exactly "{execution_id}".
- Return exactly one JSON object and no extra Markdown or explanation.
- outputs must contain only relative workspace paths.
- If the user input fully resolves the pause, continue and return final_result or the next appropriate protocol message.
"#,
            opening = opening,
            step_title = step.title,
            previous_message_content = previous_message_content.trim(),
            input_text = input_text,
            resume_rule = resume_rule,
            step_key = step.step_key,
            execution_id = step.execution_id,
            step_type = format!("{:?}", step.step_type).to_lowercase(),
            step_instructions = step.instructions,
            json_schema = json_schema,
        )
    }
}
