//! Step execution core: lead review feedback loop, protocol message handling.

use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
};

use chrono::Utc;
use db::{
    DBService,
    models::{
        chat_agent::ChatAgent,
        chat_session::ChatSession,
        chat_session_agent::ChatSessionAgent,
        workflow_agent_session::WorkflowAgentSession,
        workflow_event::{CreateWorkflowEvent, WorkflowEvent},
        workflow_execution::WorkflowExecution,
        workflow_plan::WorkflowPlan,
        workflow_step::WorkflowStep,
        workflow_step_edge::WorkflowStepEdge,
        workflow_step_review::{CreateWorkflowStepReview, WorkflowStepReview},
        workflow_transcript::WorkflowTranscript,
        workflow_types::*,
    },
};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::{
    super::{
        chat_runner::ChatRunner,
        workflow_analytics,
        workflow_runtime::{
            self, SummaryPayload, WORKFLOW_PROTOCOL_PARSE_MAX_RETRIES, WorkflowAgentRunOutput,
            WorkflowReviewProtocolMessage, WorkflowRevisionFeedbackSource, WorkflowRuntimeError,
            WorkflowStepProtocolMessage, WorkflowStepRunResult,
            build_lead_review_prompt_with_schema, build_step_execution_prompt_with_schema,
            build_step_revision_prompt_with_schema, build_workflow_protocol_retry_prompt,
            parse_review_protocol_output, predecessor_summaries,
            predecessor_summaries_with_reviews, run_workflow_step_agent_follow_up,
            run_workflow_step_agent_prompt, should_retry_workflow_protocol_parse_failure,
            workflow_review_protocol_json_schema, workflow_step_protocol_json_schema,
        },
    },
    OrchestratorError, StepOutcome, WorkflowOrchestrator, resolve_step_workflow_session,
};
use crate::services::agent_skill_policy::AgentPromptContext;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(super) enum StepUserReviewResolution {
    Approved { feedback: String },
    Rejected { feedback: String },
    Parked,
}

#[derive(Debug, Clone)]
struct ActiveFrontierWorkspaceConflict {
    workspace_path: String,
    members: Vec<ActiveFrontierWorkspaceMember>,
}

#[derive(Debug, Clone)]
struct ActiveFrontierWorkspaceMember {
    session_agent_id: Uuid,
    agent_id: Uuid,
    agent_name: String,
    step_key: String,
}

fn detect_active_frontier_workspace_conflicts(
    session: &ChatSession,
    running_step: &WorkflowStep,
    current_steps: &[WorkflowStep],
    edges: &[WorkflowStepEdge],
    workflow_agent_sessions: &[WorkflowAgentSession],
    session_agents: &[ChatSessionAgent],
    agents: &[ChatAgent],
) -> Vec<ActiveFrontierWorkspaceConflict> {
    let mut step_by_id: HashMap<Uuid, WorkflowStep> = current_steps
        .iter()
        .cloned()
        .map(|step| (step.id, step))
        .collect();
    step_by_id.insert(running_step.id, running_step.clone());

    let predecessors_by_step = edges.iter().fold(
        HashMap::<Uuid, Vec<Uuid>>::new(),
        |mut predecessors, edge| {
            predecessors
                .entry(edge.to_step_id)
                .or_default()
                .push(edge.from_step_id);
            predecessors
        },
    );
    let workflow_session_by_id: HashMap<Uuid, &WorkflowAgentSession> = workflow_agent_sessions
        .iter()
        .map(|workflow_session| (workflow_session.id, workflow_session))
        .collect();
    let session_agent_by_id: HashMap<Uuid, &ChatSessionAgent> = session_agents
        .iter()
        .map(|session_agent| (session_agent.id, session_agent))
        .collect();
    let agent_by_id: HashMap<Uuid, &ChatAgent> =
        agents.iter().map(|agent| (agent.id, agent)).collect();
    let mut members_by_workspace: BTreeMap<String, BTreeMap<Uuid, ActiveFrontierWorkspaceMember>> =
        BTreeMap::new();

    for step in step_by_id.values() {
        if step.step_type != WorkflowStepType::Task || !is_active_frontier_step(step) {
            continue;
        }
        let predecessors_completed = predecessors_by_step
            .get(&step.id)
            .map(|predecessors| {
                predecessors.iter().all(|predecessor_id| {
                    step_by_id
                        .get(predecessor_id)
                        .is_some_and(is_completed_like_step)
                })
            })
            .unwrap_or(true);
        if !predecessors_completed {
            continue;
        }

        let Some(workflow_session_id) = step.assigned_workflow_agent_session_id else {
            continue;
        };
        let Some(workflow_session) = workflow_session_by_id.get(&workflow_session_id) else {
            continue;
        };
        let Some(session_agent) = session_agent_by_id.get(&workflow_session.session_agent_id)
        else {
            continue;
        };
        let Some(agent) = agent_by_id.get(&session_agent.agent_id) else {
            continue;
        };
        let workspace_path = normalize_workspace_path(&workflow_runtime::resolve_workspace_path(
            session,
            agent,
            session_agent,
        ));
        if workspace_path.is_empty() {
            continue;
        }

        members_by_workspace
            .entry(workspace_path)
            .or_default()
            .entry(session_agent.id)
            .or_insert_with(|| ActiveFrontierWorkspaceMember {
                session_agent_id: session_agent.id,
                agent_id: agent.id,
                agent_name: agent.name.clone(),
                step_key: step.step_key.clone(),
            });
    }

    members_by_workspace
        .into_iter()
        .filter_map(|(workspace_path, members)| {
            if members.len() <= 1 {
                return None;
            }
            Some(ActiveFrontierWorkspaceConflict {
                workspace_path,
                members: members.into_values().collect(),
            })
        })
        .collect()
}

fn is_active_frontier_step(step: &WorkflowStep) -> bool {
    matches!(
        step.status,
        WorkflowStepStatus::Ready | WorkflowStepStatus::Running | WorkflowStepStatus::Revising
    )
}

fn is_completed_like_step(step: &WorkflowStep) -> bool {
    matches!(
        step.status,
        WorkflowStepStatus::Completed | WorkflowStepStatus::Skipped
    )
}

fn normalize_workspace_path(path: &Path) -> String {
    let mut normalized = path.to_string_lossy().trim().replace('\\', "/");
    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }
    #[cfg(windows)]
    {
        normalized = normalized.to_ascii_lowercase();
    }
    normalized
}

fn inject_step_prompt_section_before_schema(prompt: &mut String, section: &str) {
    if let Some(index) = prompt.find("\n\nRequired JSON Schema:") {
        prompt.insert_str(index, section);
    } else {
        prompt.push_str(section);
    }
}

#[derive(Debug, Clone)]
pub(super) struct PersistedWorkerAttempt {
    pub(super) step: WorkflowStep,
    pub(super) result: WorkflowStepRunResult,
}

fn workflow_step_run_result_from_agent_output(
    agent_output: &WorkflowAgentRunOutput,
    summary: String,
    content: String,
    outputs: Vec<String>,
) -> WorkflowStepRunResult {
    WorkflowStepRunResult {
        run_id: agent_output.run_id.unwrap_or_else(Uuid::new_v4),
        summary,
        content,
        outputs,
    }
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(super) struct PendingRevisionFeedback {
    pub(super) source: WorkflowRevisionFeedbackSource,
    pub(super) feedback: String,
    pub(super) previous_summary: String,
    pub(super) previous_content: Option<String>,
    pub(super) previous_outputs: Vec<String>,
    pub(super) review_round: i32,
}

#[derive(Debug, Clone)]
struct ResultDependencyContextFile {
    absolute_path: PathBuf,
    workspace_relative_path: String,
}

impl WorkflowOrchestrator {
    pub(super) fn parse_step_output_message(
        execution_id: Uuid,
        step: &WorkflowStep,
        raw_output: &str,
    ) -> Result<WorkflowStepProtocolMessage, OrchestratorError> {
        tracing::debug!(
            "Parsing protocol output for step {}: {}",
            step.step_key,
            raw_output
        );

        workflow_runtime::parse_step_protocol_output(execution_id, &step.step_key, raw_output)
            .map_err(OrchestratorError::from)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn run_step_agent_protocol_with_retry(
        db: &DBService,
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        session: &ChatSession,
        agent: &ChatAgent,
        session_agent: &ChatSessionAgent,
        workflow_session: &WorkflowAgentSession,
        prompt: &str,
        step: &WorkflowStep,
        first_run_is_follow_up: bool,
    ) -> Result<(WorkflowStepProtocolMessage, WorkflowAgentRunOutput), OrchestratorError> {
        let mut attempt = 0;
        let mut run_as_follow_up = first_run_is_follow_up;
        let mut prompt_to_send = prompt.to_string();

        loop {
            let active_workflow_session = if run_as_follow_up {
                WorkflowAgentSession::find_by_id(pool, workflow_session.id)
                    .await?
                    .ok_or_else(|| {
                        OrchestratorError::NotFound(format!(
                            "workflow session {} not found",
                            workflow_session.id
                        ))
                    })?
            } else {
                workflow_session.clone()
            };

            let agent_output = if run_as_follow_up {
                run_workflow_step_agent_follow_up(
                    db,
                    chat_runner,
                    session,
                    agent,
                    session_agent,
                    &active_workflow_session,
                    &prompt_to_send,
                    step,
                )
                .await?
            } else {
                run_workflow_step_agent_prompt(
                    db,
                    chat_runner,
                    session,
                    agent,
                    session_agent,
                    Some(&active_workflow_session),
                    &prompt_to_send,
                    step,
                )
                .await?
            };
            let raw_output = &agent_output.output;

            match Self::parse_step_output_message(step.execution_id, step, raw_output) {
                Ok(message) => return Ok((message, agent_output)),
                Err(err)
                    if attempt < WORKFLOW_PROTOCOL_PARSE_MAX_RETRIES
                        && should_retry_workflow_protocol_parse_failure(raw_output) =>
                {
                    tracing::warn!(
                        step_id = %step.id,
                        step_key = %step.step_key,
                        attempt,
                        error = %err,
                        "workflow step protocol parse failed; retrying"
                    );
                    let schema =
                        workflow_step_protocol_json_schema(step.execution_id, &step.step_key, true);
                    prompt_to_send = build_workflow_protocol_retry_prompt(
                        "step output",
                        &schema,
                        &err.to_string(),
                        prompt,
                        raw_output,
                    );
                    attempt += 1;
                    run_as_follow_up = true;
                }
                Err(err) => return Err(err),
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_step_review_protocol_with_retry(
        db: &DBService,
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        session: &ChatSession,
        agent: &ChatAgent,
        session_agent: &ChatSessionAgent,
        workflow_session: &WorkflowAgentSession,
        prompt: &str,
        step: &WorkflowStep,
    ) -> Result<(WorkflowReviewProtocolMessage, String), OrchestratorError> {
        let mut attempt = 0;
        let mut run_as_follow_up = false;
        let mut prompt_to_send = prompt.to_string();

        loop {
            let active_workflow_session = if run_as_follow_up {
                WorkflowAgentSession::find_by_id(pool, workflow_session.id)
                    .await?
                    .ok_or_else(|| {
                        OrchestratorError::NotFound(format!(
                            "workflow session {} not found",
                            workflow_session.id
                        ))
                    })?
            } else {
                workflow_session.clone()
            };

            let agent_output = if run_as_follow_up {
                run_workflow_step_agent_follow_up(
                    db,
                    chat_runner,
                    session,
                    agent,
                    session_agent,
                    &active_workflow_session,
                    &prompt_to_send,
                    step,
                )
                .await?
            } else {
                run_workflow_step_agent_prompt(
                    db,
                    chat_runner,
                    session,
                    agent,
                    session_agent,
                    Some(&active_workflow_session),
                    &prompt_to_send,
                    step,
                )
                .await?
            };
            let raw_output = agent_output.output;

            match parse_review_protocol_output(execution.id, &step.step_key, &raw_output) {
                Ok(message) => return Ok((message, raw_output)),
                Err(err)
                    if attempt < WORKFLOW_PROTOCOL_PARSE_MAX_RETRIES
                        && should_retry_workflow_protocol_parse_failure(&raw_output) =>
                {
                    tracing::warn!(
                        step_id = %step.id,
                        step_key = %step.step_key,
                        attempt,
                        error = %err,
                        "workflow review protocol parse failed; retrying"
                    );
                    let schema = workflow_review_protocol_json_schema(execution.id, &step.step_key);
                    prompt_to_send = build_workflow_protocol_retry_prompt(
                        "step review output",
                        &schema,
                        &err.to_string(),
                        prompt,
                        &raw_output,
                    );
                    attempt += 1;
                    run_as_follow_up = true;
                }
                Err(err) => return Err(err.into()),
            }
        }
    }

    pub(super) fn step_message_error(
        message: String,
        content: Option<String>,
    ) -> OrchestratorError {
        OrchestratorError::Runtime(WorkflowRuntimeError::Validation(
            content
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!("{message}: {value}"))
                .unwrap_or(message),
        ))
    }

    fn result_dependency_context_prompt(file: &ResultDependencyContextFile) -> String {
        format!(
            r#"## Result Dependency Context File

All workflow node run results and reviewer conclusions are stored in this workspace-relative file:

`{path}`

Read this file before writing the final result. Do not rely on the workflow plan JSON alone; use the formal predecessor results and reviewer conclusions in that file as the source of truth."#,
            path = file.workspace_relative_path
        )
    }

    async fn write_result_dependency_context_file(
        session: &ChatSession,
        agent: &ChatAgent,
        session_agent: &ChatSessionAgent,
        execution: &WorkflowExecution,
        step: &WorkflowStep,
        contexts: &[String],
    ) -> Result<ResultDependencyContextFile, OrchestratorError> {
        let workspace_path =
            workflow_runtime::resolve_workspace_path(session, agent, session_agent);
        let tmp_dir = workspace_path.join(".openteams").join("tmp");
        tokio::fs::create_dir_all(&tmp_dir)
            .await
            .map_err(WorkflowRuntimeError::from)?;

        let filename = format!("workflow-result-context-{}-{}.md", execution.id, step.id);
        let absolute_path = tmp_dir.join(filename);
        let workspace_relative_path = absolute_path
            .strip_prefix(&workspace_path)
            .unwrap_or(absolute_path.as_path())
            .to_string_lossy()
            .replace('\\', "/");
        let content = format!(
            "# Workflow Result Dependency Context\n\nExecution: `{}`\nResult step: `{}` ({})\n\n{}",
            execution.id,
            step.step_key,
            step.title,
            contexts.join("\n\n---\n\n")
        );

        tokio::fs::write(&absolute_path, content)
            .await
            .map_err(WorkflowRuntimeError::from)?;

        Ok(ResultDependencyContextFile {
            absolute_path,
            workspace_relative_path,
        })
    }

    async fn cleanup_result_dependency_context_file(path: Option<&Path>) {
        let Some(path) = path else {
            return;
        };

        match tokio::fs::remove_file(path).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => tracing::warn!(
                path = %path.display(),
                %error,
                "failed to remove workflow result dependency context file"
            ),
        }
    }

    fn acceptance_criteria_for_step(plan: &WorkflowPlan, step: &WorkflowStep) -> Vec<String> {
        serde_json::from_str::<WorkflowPlanJson>(&plan.plan_json)
            .ok()
            .and_then(|plan_json| {
                plan_json
                    .nodes
                    .into_iter()
                    .find(|node| node.id == step.step_key)
                    .and_then(|node| node.data.acceptance)
            })
            .unwrap_or_default()
            .into_iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect()
    }

    pub(super) fn merge_revision_context(
        existing_revision_context: Option<&str>,
        feedback_source: WorkflowRevisionFeedbackSource,
        feedback_content: &str,
        previous_summary: &str,
        previous_content: Option<&str>,
        previous_outputs: &[String],
        review_round: i32,
    ) -> String {
        let mut context = existing_revision_context
            .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        if !context.is_object() {
            context = serde_json::json!({});
        }

        let source = match feedback_source {
            WorkflowRevisionFeedbackSource::Lead => "lead",
            WorkflowRevisionFeedbackSource::User => "user",
        };

        let entry = serde_json::json!({
            "round": review_round,
            "source": source,
            "feedback": feedback_content.trim(),
            "timestamp": Utc::now().to_rfc3339(),
        });

        let context_obj = context.as_object_mut().expect("revision context object");
        let history = context_obj
            .entry("feedback_history")
            .or_insert_with(|| serde_json::json!([]));
        if !history.is_array() {
            *history = serde_json::json!([]);
        }
        history
            .as_array_mut()
            .expect("feedback history array")
            .push(entry);

        context_obj.insert(
            "previous_summary".to_string(),
            serde_json::json!(previous_summary.trim()),
        );
        context_obj.insert(
            "previous_content".to_string(),
            serde_json::json!(previous_content.unwrap_or_default().trim()),
        );
        context_obj.insert(
            "previous_outputs".to_string(),
            serde_json::json!(previous_outputs),
        );
        context_obj.insert(
            "pending_feedback".to_string(),
            serde_json::json!({
                "source": source,
                "feedback": feedback_content.trim(),
                "previous_summary": previous_summary.trim(),
                "previous_content": previous_content.unwrap_or_default().trim(),
                "previous_outputs": previous_outputs,
                "review_round": review_round,
            }),
        );

        context.to_string()
    }

    pub(super) fn parse_pending_revision_feedback(
        revision_context: Option<&str>,
    ) -> Option<PendingRevisionFeedback> {
        let value =
            revision_context.and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())?;
        let pending = value.get("pending_feedback")?;
        let source = match pending.get("source")?.as_str()? {
            "lead" => WorkflowRevisionFeedbackSource::Lead,
            "user" => WorkflowRevisionFeedbackSource::User,
            _ => return None,
        };

        Some(PendingRevisionFeedback {
            source,
            feedback: pending.get("feedback")?.as_str()?.trim().to_string(),
            previous_summary: pending
                .get("previous_summary")
                .and_then(|item| item.as_str())
                .unwrap_or_default()
                .trim()
                .to_string(),
            previous_content: pending
                .get("previous_content")
                .and_then(|item| item.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            previous_outputs: pending
                .get("previous_outputs")
                .and_then(|item| item.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str())
                        .map(|item| item.to_string())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            review_round: pending
                .get("review_round")
                .and_then(|item| item.as_i64())
                .unwrap_or_default() as i32,
        })
    }

    pub(super) fn pending_revision_feedback_is_loop(revision_context: Option<&str>) -> bool {
        revision_context
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .and_then(|value| value.get("pending_feedback").cloned())
            .is_some_and(|pending| {
                pending.get("scope").and_then(|value| value.as_str()) == Some("loop")
            })
    }

    pub(super) fn clear_pending_revision_feedback(
        existing_revision_context: Option<&str>,
    ) -> Option<String> {
        let mut value = existing_revision_context
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())?;
        let object = value.as_object_mut()?;
        object.remove("pending_feedback");
        Some(value.to_string())
    }

    pub(super) async fn emit_step_domain_event(
        pool: &SqlitePool,
        execution: &WorkflowExecution,
        step: &WorkflowStep,
        event_type: WorkflowEventType,
        detail_json: Option<serde_json::Value>,
    ) -> Result<WorkflowEvent, OrchestratorError> {
        WorkflowEvent::create(
            pool,
            &CreateWorkflowEvent {
                execution_id: execution.id,
                round_id: Some(step.round_id),
                step_id: Some(step.id),
                agent_session_id: step.assigned_workflow_agent_session_id,
                event_type,
                status_before: None,
                status_after: Some(to_workflow_wire_value(&step.status)),
                detail_json: detail_json.map(|value| value.to_string()),
            },
            Uuid::new_v4(),
        )
        .await
        .map_err(OrchestratorError::Database)
    }

    pub(crate) async fn save_step_review(
        pool: &SqlitePool,
        step: &WorkflowStep,
        reviewer_type: ReviewerType,
        reviewer_id: Option<String>,
        verdict: ReviewVerdict,
        feedback: &str,
    ) -> Result<WorkflowStepReview, OrchestratorError> {
        WorkflowStepReview::create(
            pool,
            &CreateWorkflowStepReview {
                step_id: step.id,
                execution_id: step.execution_id,
                reviewer_type,
                reviewer_id,
                verdict,
                feedback: feedback.trim().to_string(),
                review_round: Some(step.retry_count + 1),
            },
            Uuid::new_v4(),
        )
        .await
        .map_err(OrchestratorError::Database)
    }

    fn resolve_lead_review_targets<'a>(
        execution: &WorkflowExecution,
        workflow_sessions: &'a [WorkflowAgentSession],
        session_agents: &'a [ChatSessionAgent],
        agents: &'a [ChatAgent],
    ) -> Result<
        (
            &'a WorkflowAgentSession,
            &'a ChatSessionAgent,
            &'a ChatAgent,
        ),
        OrchestratorError,
    > {
        let lead_session_agent_id = execution.lead_session_agent_id.ok_or_else(|| {
            OrchestratorError::NotFound(format!(
                "execution {} 缺少 lead session agent",
                execution.id
            ))
        })?;
        let workflow_session = workflow_sessions
            .iter()
            .find(|session| session.session_agent_id == lead_session_agent_id)
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "execution {} 的 lead workflow session 未找到",
                    execution.id
                ))
            })?;
        let session_agent = session_agents
            .iter()
            .find(|item| item.id == workflow_session.session_agent_id)
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "lead session agent {} 未找到",
                    workflow_session.session_agent_id
                ))
            })?;
        let agent = agents
            .iter()
            .find(|item| item.id == session_agent.agent_id)
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("agent {} 未找到", session_agent.agent_id))
            })?;

        Ok((workflow_session, session_agent, agent))
    }

    async fn persist_worker_attempt_result(
        pool: &SqlitePool,
        execution: &WorkflowExecution,
        step: &WorkflowStep,
        workflow_session: &WorkflowAgentSession,
        result: WorkflowStepRunResult,
    ) -> Result<PersistedWorkerAttempt, OrchestratorError> {
        let recorded_step = WorkflowStep::record_execution_result(
            pool,
            step.id,
            result.run_id,
            Some(
                serde_json::to_string(&SummaryPayload {
                    summary: result.summary.clone(),
                    content: Some(result.content.clone()),
                    outputs: result.outputs.clone(),
                })
                .unwrap_or_else(|_| result.summary.clone()),
            ),
            Some(result.content.clone()),
        )
        .await?;
        let _ = Self::write_transcript(
            pool,
            execution.id,
            Some(recorded_step.round_id),
            Some(workflow_session.id),
            Some(recorded_step.id),
            "agent",
            "message",
            &result.content,
            Some(
                &serde_json::json!({
                    "summary": result.summary.clone(),
                    "outputs": result.outputs.clone(),
                    "source": "workflow_protocol_final_result",
                })
                .to_string(),
            ),
        )
        .await;

        Ok(PersistedWorkerAttempt {
            step: recorded_step,
            result,
        })
    }

    async fn wait_for_step_user_review_stub(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        step: &WorkflowStep,
        workflow_session: &WorkflowAgentSession,
        result: &WorkflowStepRunResult,
    ) -> Result<StepUserReviewResolution, OrchestratorError> {
        Self::emit_step_domain_event(
            pool,
            execution,
            step,
            WorkflowEventType::StepUserReviewStarted,
            Some(serde_json::json!({
                "step_key": step.step_key,
                "summary": result.summary,
            })),
        )
        .await?;

        Self::park_for_user_action(
            pool,
            chat_runner,
            execution,
            step,
            workflow_session,
            "step_review",
            &format!("请审核步骤「{}」的执行结果", step.title),
            Some(result.summary.clone()),
            WorkflowStepStatus::WaitingInput,
            WorkflowAgentSessionState::Paused,
            Some(serde_json::json!({
                "summary": result.summary,
                "outputs": result.outputs,
                "review_kind": "step_user_review",
            })),
        )
        .await?;

        Ok(StepUserReviewResolution::Parked)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn execute_step_with_feedback(
        db: &DBService,
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        step: &WorkflowStep,
        workflow_session: &WorkflowAgentSession,
        session: &ChatSession,
        session_agent: &ChatSessionAgent,
        agent: &ChatAgent,
        workflow_agent_sessions: &[WorkflowAgentSession],
        session_agents: &[ChatSessionAgent],
        agents: &[ChatAgent],
        plan: &WorkflowPlan,
        current_steps: &[WorkflowStep],
        edges: &[WorkflowStepEdge],
        initial_result: WorkflowStepRunResult,
        skip_initial_lead_review: bool,
    ) -> Result<StepOutcome, OrchestratorError> {
        let dependency_summaries = predecessor_summaries(step, current_steps, edges, Some(plan));
        let acceptance_criteria = Self::acceptance_criteria_for_step(plan, step);
        let workflow_goal = plan
            .summary_text
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| plan.title.clone());
        let (lead_workflow_session, lead_session_agent, lead_agent) =
            Self::resolve_lead_review_targets(
                execution,
                workflow_agent_sessions,
                session_agents,
                agents,
            )?;

        let mut active_step = step.clone();
        let mut current_result = initial_result;
        let mut skip_lead_review_for_current_attempt = skip_initial_lead_review;

        loop {
            let persisted = Self::persist_worker_attempt_result(
                pool,
                execution,
                &active_step,
                workflow_session,
                current_result.clone(),
            )
            .await?;
            let waiting_review_step = Self::transition_step_and_sync(
                pool,
                chat_runner,
                execution,
                &persisted.step,
                WorkflowStepStatus::WaitingReview,
                "step_waiting_review",
            )
            .await?;

            let skip_lead_review_this_attempt =
                std::mem::take(&mut skip_lead_review_for_current_attempt);
            let should_run_lead_review =
                waiting_review_step.lead_review_required && !skip_lead_review_this_attempt;

            if !should_run_lead_review {
                if waiting_review_step.user_review_required {
                    match Self::wait_for_step_user_review_stub(
                        pool,
                        chat_runner,
                        execution,
                        &waiting_review_step,
                        workflow_session,
                        &persisted.result,
                    )
                    .await?
                    {
                        StepUserReviewResolution::Parked => return Ok(StepOutcome::Parked),
                        StepUserReviewResolution::Approved { .. }
                        | StepUserReviewResolution::Rejected { .. } => {
                            return Err(OrchestratorError::IllegalTransition(
                                "step user review resolved synchronously".to_string(),
                            ));
                        }
                    }
                }

                let completed_step = Self::transition_step_and_sync(
                    pool,
                    chat_runner,
                    execution,
                    &waiting_review_step,
                    WorkflowStepStatus::Completed,
                    "step_completed",
                )
                .await?;
                workflow_analytics::track_handoff_completed(
                    chat_runner.analytics_service(),
                    execution.session_id,
                    execution.id,
                    completed_step.id,
                );
                return Ok(StepOutcome::Completed);
            }

            Self::emit_step_domain_event(
                pool,
                execution,
                &waiting_review_step,
                WorkflowEventType::StepLeadReviewStarted,
                Some(serde_json::json!({
                    "step_key": waiting_review_step.step_key,
                    "summary": persisted.result.summary,
                    "review_round": waiting_review_step.retry_count + 1,
                })),
            )
            .await?;

            let review_prompt = build_lead_review_prompt_with_schema(
                &workflow_goal,
                &waiting_review_step,
                &persisted.result,
                &dependency_summaries,
                &acceptance_criteria,
            );

            let (review_message, _raw_review_output) =
                match Self::run_step_review_protocol_with_retry(
                    db,
                    pool,
                    chat_runner,
                    execution,
                    session,
                    lead_agent,
                    lead_session_agent,
                    lead_workflow_session,
                    &review_prompt,
                    &waiting_review_step,
                )
                .await
                {
                    Ok(raw_output) => raw_output,
                    Err(err) => {
                        let failed_step = Self::transition_step_and_sync(
                            pool,
                            chat_runner,
                            execution,
                            &waiting_review_step,
                            WorkflowStepStatus::Failed,
                            "step_failed",
                        )
                        .await?;
                        let _ = Self::write_transcript(
                            pool,
                            execution.id,
                            Some(failed_step.round_id),
                            Some(lead_workflow_session.id),
                            Some(failed_step.id),
                            "system",
                            "message",
                            &format!(
                                "Lead review failed for step \"{}\": {}",
                                failed_step.title, err
                            ),
                            None,
                        )
                        .await;
                        return Ok(StepOutcome::Failed(err.to_string()));
                    }
                };

            let WorkflowReviewProtocolMessage::ReviewResult {
                verdict, feedback, ..
            } = review_message;

            Self::save_step_review(
                pool,
                &waiting_review_step,
                ReviewerType::Lead,
                Some(lead_agent.id.to_string()),
                verdict.clone(),
                &feedback,
            )
            .await?;
            let _ = Self::write_transcript(
                pool,
                execution.id,
                Some(waiting_review_step.round_id),
                Some(lead_workflow_session.id),
                Some(waiting_review_step.id),
                "agent",
                "lead_review",
                &feedback,
                Some(
                    &serde_json::json!({
                        "verdict": verdict,
                        "reviewer_type": "lead",
                        "review_round": waiting_review_step.retry_count + 1,
                    })
                    .to_string(),
                ),
            )
            .await;

            match verdict {
                ReviewVerdict::Approved => {
                    Self::emit_step_domain_event(
                        pool,
                        execution,
                        &waiting_review_step,
                        WorkflowEventType::StepLeadReviewPassed,
                        Some(serde_json::json!({
                            "feedback": feedback,
                            "review_round": waiting_review_step.retry_count + 1,
                        })),
                    )
                    .await?;

                    if waiting_review_step.user_review_required {
                        match Self::wait_for_step_user_review_stub(
                            pool,
                            chat_runner,
                            execution,
                            &waiting_review_step,
                            workflow_session,
                            &persisted.result,
                        )
                        .await?
                        {
                            StepUserReviewResolution::Parked => return Ok(StepOutcome::Parked),
                            StepUserReviewResolution::Approved { feedback } => {
                                Self::save_step_review(
                                    pool,
                                    &waiting_review_step,
                                    ReviewerType::User,
                                    None,
                                    ReviewVerdict::Approved,
                                    &feedback,
                                )
                                .await?;
                                Self::emit_step_domain_event(
                                    pool,
                                    execution,
                                    &waiting_review_step,
                                    WorkflowEventType::StepUserReviewPassed,
                                    Some(serde_json::json!({ "feedback": feedback })),
                                )
                                .await?;
                            }
                            StepUserReviewResolution::Rejected { feedback } => {
                                Self::save_step_review(
                                    pool,
                                    &waiting_review_step,
                                    ReviewerType::User,
                                    None,
                                    ReviewVerdict::Rejected,
                                    &feedback,
                                )
                                .await?;
                                Self::emit_step_domain_event(
                                    pool,
                                    execution,
                                    &waiting_review_step,
                                    WorkflowEventType::StepUserReviewRejected,
                                    Some(serde_json::json!({ "feedback": feedback })),
                                )
                                .await?;

                                let revising_step = Self::transition_step_and_sync(
                                    pool,
                                    chat_runner,
                                    execution,
                                    &waiting_review_step,
                                    WorkflowStepStatus::Revising,
                                    "step_revising",
                                )
                                .await?;
                                let merged_context = Self::merge_revision_context(
                                    revising_step.revision_context.as_deref(),
                                    WorkflowRevisionFeedbackSource::User,
                                    &feedback,
                                    &persisted.result.summary,
                                    Some(&persisted.result.content),
                                    &persisted.result.outputs,
                                    revising_step.retry_count + 1,
                                );
                                let revising_step = WorkflowStep::update_revision_context(
                                    pool,
                                    revising_step.id,
                                    Some(merged_context),
                                )
                                .await?;

                                let revised_step =
                                    WorkflowStep::prepare_retry(pool, revising_step.id).await?;
                                let running_revision_step = Self::transition_step_and_sync(
                                    pool,
                                    chat_runner,
                                    execution,
                                    &revised_step,
                                    WorkflowStepStatus::Running,
                                    "step_revising_running",
                                )
                                .await?;
                                let mut sa_clone = session_agent.clone();
                                let agent_skill_names: Vec<String> = chat_runner
                                    .prepare_and_resolve_agent_skills(
                                        &mut sa_clone,
                                        agent,
                                        AgentPromptContext::StepRevision,
                                    )
                                    .await
                                    .unwrap_or_default()
                                    .iter()
                                    .map(|s| s.name.clone())
                                    .collect();
                                let revision_prompt = build_step_revision_prompt_with_schema(
                                    &running_revision_step,
                                    WorkflowRevisionFeedbackSource::User,
                                    &feedback,
                                    &persisted.result.summary,
                                    Some(&persisted.result.content),
                                    running_revision_step.retry_count,
                                    &agent_skill_names,
                                );

                                let (protocol_message, agent_output) =
                                    match Self::run_step_agent_protocol_with_retry(
                                        db,
                                        pool,
                                        chat_runner,
                                        session,
                                        agent,
                                        session_agent,
                                        workflow_session,
                                        &revision_prompt,
                                        &running_revision_step,
                                        true,
                                    )
                                    .await
                                    {
                                        Ok(result) => result,
                                        Err(err) => {
                                            let failed_step = Self::transition_step_and_sync(
                                                pool,
                                                chat_runner,
                                                execution,
                                                &running_revision_step,
                                                WorkflowStepStatus::Failed,
                                                "step_failed",
                                            )
                                            .await?;
                                            let _ = Self::write_transcript(
                                                pool,
                                                execution.id,
                                                Some(failed_step.round_id),
                                                Some(workflow_session.id),
                                                Some(failed_step.id),
                                                "system",
                                                "message",
                                                &format!(
                                                    "Step \"{}\" failed during user revision: {}",
                                                    failed_step.title, err
                                                ),
                                                None,
                                            )
                                            .await;
                                            return Ok(StepOutcome::Failed(err.to_string()));
                                        }
                                    };

                                match protocol_message {
                                    WorkflowStepProtocolMessage::FinalResult {
                                        summary,
                                        content,
                                        outputs,
                                        ..
                                    } => {
                                        active_step = running_revision_step;
                                        current_result = workflow_step_run_result_from_agent_output(
                                            &agent_output,
                                            summary,
                                            content,
                                            outputs,
                                        );
                                        skip_lead_review_for_current_attempt = true;
                                        continue;
                                    }
                                    other => {
                                        return Self::handle_step_protocol_message(
                                            pool,
                                            chat_runner,
                                            execution,
                                            &running_revision_step,
                                            workflow_session,
                                            other,
                                            agent_output.run_id,
                                        )
                                        .await;
                                    }
                                }
                            }
                        }
                    }

                    let completed_step = Self::transition_step_and_sync(
                        pool,
                        chat_runner,
                        execution,
                        &waiting_review_step,
                        WorkflowStepStatus::Completed,
                        "step_completed",
                    )
                    .await?;
                    workflow_analytics::track_handoff_completed(
                        chat_runner.analytics_service(),
                        execution.session_id,
                        execution.id,
                        completed_step.id,
                    );
                    return Ok(StepOutcome::Completed);
                }
                ReviewVerdict::Rejected => {
                    Self::emit_step_domain_event(
                        pool,
                        execution,
                        &waiting_review_step,
                        WorkflowEventType::StepLeadReviewRejected,
                        Some(serde_json::json!({
                            "feedback": feedback,
                            "review_round": waiting_review_step.retry_count + 1,
                        })),
                    )
                    .await?;

                    let revising_step = Self::transition_step_and_sync(
                        pool,
                        chat_runner,
                        execution,
                        &waiting_review_step,
                        WorkflowStepStatus::Revising,
                        "step_revising",
                    )
                    .await?;
                    let merged_context = Self::merge_revision_context(
                        revising_step.revision_context.as_deref(),
                        WorkflowRevisionFeedbackSource::Lead,
                        &feedback,
                        &persisted.result.summary,
                        Some(&persisted.result.content),
                        &persisted.result.outputs,
                        revising_step.retry_count + 1,
                    );
                    let revising_step = WorkflowStep::update_revision_context(
                        pool,
                        revising_step.id,
                        Some(merged_context),
                    )
                    .await?;

                    let revised_step = WorkflowStep::prepare_retry(pool, revising_step.id).await?;
                    let running_revision_step = Self::transition_step_and_sync(
                        pool,
                        chat_runner,
                        execution,
                        &revised_step,
                        WorkflowStepStatus::Running,
                        "step_revising_running",
                    )
                    .await?;
                    let mut sa_clone = session_agent.clone();
                    let agent_skill_names: Vec<String> = chat_runner
                        .prepare_and_resolve_agent_skills(
                            &mut sa_clone,
                            agent,
                            AgentPromptContext::StepRevision,
                        )
                        .await
                        .unwrap_or_default()
                        .iter()
                        .map(|s| s.name.clone())
                        .collect();
                    let revision_prompt = build_step_revision_prompt_with_schema(
                        &running_revision_step,
                        WorkflowRevisionFeedbackSource::Lead,
                        &feedback,
                        &persisted.result.summary,
                        Some(&persisted.result.content),
                        running_revision_step.retry_count,
                        &agent_skill_names,
                    );

                    let (protocol_message, agent_output) =
                        match Self::run_step_agent_protocol_with_retry(
                            db,
                            pool,
                            chat_runner,
                            session,
                            agent,
                            session_agent,
                            workflow_session,
                            &revision_prompt,
                            &running_revision_step,
                            true,
                        )
                        .await
                        {
                            Ok(result) => result,
                            Err(err) => {
                                let failed_step = Self::transition_step_and_sync(
                                    pool,
                                    chat_runner,
                                    execution,
                                    &running_revision_step,
                                    WorkflowStepStatus::Failed,
                                    "step_failed",
                                )
                                .await?;
                                let _ = Self::write_transcript(
                                    pool,
                                    execution.id,
                                    Some(failed_step.round_id),
                                    Some(workflow_session.id),
                                    Some(failed_step.id),
                                    "system",
                                    "message",
                                    &format!(
                                        "Step \"{}\" failed during revision: {}",
                                        failed_step.title, err
                                    ),
                                    None,
                                )
                                .await;
                                return Ok(StepOutcome::Failed(err.to_string()));
                            }
                        };

                    match protocol_message {
                        WorkflowStepProtocolMessage::FinalResult {
                            summary,
                            content,
                            outputs,
                            ..
                        } => {
                            active_step = running_revision_step;
                            current_result = workflow_step_run_result_from_agent_output(
                                &agent_output,
                                summary,
                                content,
                                outputs,
                            );
                            skip_lead_review_for_current_attempt = false;
                        }
                        other => {
                            return Self::handle_step_protocol_message(
                                pool,
                                chat_runner,
                                execution,
                                &running_revision_step,
                                workflow_session,
                                other,
                                agent_output.run_id,
                            )
                            .await;
                        }
                    }
                }
            }
        }
    }

    pub(super) async fn handle_step_protocol_message(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        running_step: &WorkflowStep,
        workflow_session: &WorkflowAgentSession,
        protocol_message: WorkflowStepProtocolMessage,
        run_id_hint: Option<Uuid>,
    ) -> Result<StepOutcome, OrchestratorError> {
        match protocol_message {
            WorkflowStepProtocolMessage::ApprovalRequest {
                title, description, ..
            } => {
                Self::park_for_user_action(
                    pool,
                    chat_runner,
                    execution,
                    running_step,
                    workflow_session,
                    "approval_request",
                    &title,
                    description,
                    WorkflowStepStatus::WaitingReview,
                    WorkflowAgentSessionState::Paused,
                    None,
                )
                .await?;
                Ok(StepOutcome::Parked)
            }
            WorkflowStepProtocolMessage::PermissionRequest {
                title, description, ..
            } => {
                Self::park_for_user_action(
                    pool,
                    chat_runner,
                    execution,
                    running_step,
                    workflow_session,
                    "permission_request",
                    &title,
                    description,
                    WorkflowStepStatus::WaitingReview,
                    WorkflowAgentSessionState::Paused,
                    None,
                )
                .await?;
                Ok(StepOutcome::Parked)
            }
            WorkflowStepProtocolMessage::ContinueConfirmation {
                message,
                description,
                ..
            } => {
                Self::park_for_user_action(
                    pool,
                    chat_runner,
                    execution,
                    running_step,
                    workflow_session,
                    "continue_confirmation",
                    &message,
                    description,
                    WorkflowStepStatus::WaitingInput,
                    WorkflowAgentSessionState::Paused,
                    None,
                )
                .await?;
                Ok(StepOutcome::Parked)
            }
            WorkflowStepProtocolMessage::InputRequest {
                prompt,
                description,
                placeholder,
                ..
            } => {
                Self::park_for_user_action(
                    pool,
                    chat_runner,
                    execution,
                    running_step,
                    workflow_session,
                    "input_request",
                    &prompt,
                    description,
                    WorkflowStepStatus::WaitingInput,
                    WorkflowAgentSessionState::Paused,
                    Some(serde_json::json!({
                        "placeholder": placeholder,
                    })),
                )
                .await?;
                Ok(StepOutcome::Parked)
            }
            WorkflowStepProtocolMessage::Error {
                message, content, ..
            } => {
                let error_message = message.trim().to_string();
                let error_detail = content
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                let err = Self::step_message_error(error_message.clone(), error_detail.clone());
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
                let error_meta = serde_json::json!({
                    "description": error_detail,
                    "source": "workflow_protocol_error",
                })
                .to_string();
                let _ = Self::write_transcript(
                    pool,
                    execution.id,
                    failed_step.round_id.into(),
                    Some(workflow_session.id),
                    Some(failed_step.id),
                    "control",
                    "error",
                    &error_message,
                    Some(&error_meta),
                )
                .await;
                Self::transition_step_and_sync(
                    pool,
                    chat_runner,
                    execution,
                    &failed_step,
                    WorkflowStepStatus::Failed,
                    "step_failed",
                )
                .await?;
                Ok(StepOutcome::Failed(err.to_string()))
            }
            WorkflowStepProtocolMessage::FinalResult {
                summary,
                content,
                outputs,
                ..
            } => {
                let execution_result = WorkflowStepRunResult {
                    run_id: run_id_hint.unwrap_or_else(Uuid::new_v4),
                    summary,
                    content,
                    outputs,
                };
                let recorded_step = WorkflowStep::record_execution_result(
                    pool,
                    running_step.id,
                    execution_result.run_id,
                    Some(
                        serde_json::to_string(&SummaryPayload {
                            summary: execution_result.summary.clone(),
                            content: Some(execution_result.content.clone()),
                            outputs: execution_result.outputs.clone(),
                        })
                        .unwrap_or_else(|_| execution_result.summary.clone()),
                    ),
                    Some(execution_result.content.clone()),
                )
                .await?;
                let _ = Self::write_transcript(
                    pool,
                    execution.id,
                    recorded_step.round_id.into(),
                    Some(workflow_session.id),
                    Some(recorded_step.id),
                    "agent",
                    "message",
                    &execution_result.content,
                    Some(
                        &serde_json::json!({
                            "summary": execution_result.summary.clone(),
                            "outputs": execution_result.outputs.clone(),
                            "source": "workflow_protocol_final_result",
                        })
                        .to_string(),
                    ),
                )
                .await;
                let completed_step = Self::transition_step_and_sync(
                    pool,
                    chat_runner,
                    execution,
                    &recorded_step,
                    WorkflowStepStatus::Completed,
                    "step_completed",
                )
                .await?;
                workflow_analytics::track_handoff_completed(
                    chat_runner.analytics_service(),
                    execution.session_id,
                    execution.id,
                    completed_step.id,
                );
                Ok(StepOutcome::Completed)
            }
        }
    }

    fn active_frontier_workspace_isolation_prompt(
        session: &ChatSession,
        running_step: &WorkflowStep,
        current_steps: &[WorkflowStep],
        edges: &[WorkflowStepEdge],
        workflow_agent_sessions: &[WorkflowAgentSession],
        current_session_agent: &ChatSessionAgent,
        session_agents: &[ChatSessionAgent],
        agents: &[ChatAgent],
    ) -> Option<String> {
        let conflicts = detect_active_frontier_workspace_conflicts(
            session,
            running_step,
            current_steps,
            edges,
            workflow_agent_sessions,
            session_agents,
            agents,
        );
        let conflict = conflicts.iter().find(|conflict| {
            conflict
                .members
                .iter()
                .any(|member| member.session_agent_id == current_session_agent.id)
        })?;

        let members = conflict
            .members
            .iter()
            .map(|member| {
                format!(
                    "- {} ({}) running step `{}`",
                    member.agent_name, member.agent_id, member.step_key
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        Some(format!(
            r#"

## Workspace Isolation Requirement

The active workflow frontier has multiple members running in parallel in the same workspace:

- Shared workspace: `{workspace_path}`
{members}

Before modifying files, you MUST use the `using-git-workspace` skill to create an isolated git workspace for this step. Do all edits and verification inside that isolated environment. Before returning the final_result, merge/sync the completed changes back into the original workflow workspace and report the merge result in your JSON output.
"#,
            workspace_path = conflict.workspace_path,
            members = members
        ))
    }

    /// Execute a single step: resolve context, transition to Running, run agent
    /// prompt, process the result.
    pub(crate) async fn prepare_and_run_step(
        db: &DBService,
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        step: &WorkflowStep,
        workflow_agent_sessions: &[WorkflowAgentSession],
        session: &ChatSession,
        session_agents: &[ChatSessionAgent],
        agents: &[ChatAgent],
        plan: &WorkflowPlan,
        current_steps: &[WorkflowStep],
        edges: &[WorkflowStepEdge],
    ) -> Result<StepOutcome, OrchestratorError> {
        let workflow_session =
            resolve_step_workflow_session(execution, workflow_agent_sessions, step)?;
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

        let running_step = match Self::guarded_transition_step_and_sync(
            pool,
            chat_runner,
            execution,
            step,
            WorkflowStepStatus::Running,
            "step_started",
        )
        .await?
        {
            Some(s) => s,
            None => {
                return Ok(StepOutcome::Completed);
            }
        };

        let (dependency_summaries, result_dependency_context_file) =
            if running_step.step_type == WorkflowStepType::Result {
                let reviews = WorkflowStepReview::find_by_execution(pool, execution.id).await?;
                let result_contexts = predecessor_summaries_with_reviews(
                    &running_step,
                    current_steps,
                    edges,
                    Some(plan),
                    &reviews,
                );
                let context_file = Self::write_result_dependency_context_file(
                    session,
                    agent,
                    session_agent,
                    execution,
                    &running_step,
                    &result_contexts,
                )
                .await?;
                (
                    vec![Self::result_dependency_context_prompt(&context_file)],
                    Some(context_file),
                )
            } else {
                (
                    predecessor_summaries(&running_step, current_steps, edges, Some(plan)),
                    None,
                )
            };
        let step_transcript_context = WorkflowTranscript::find_by_step(pool, running_step.id)
            .await?
            .into_iter()
            .map(|transcript| {
                format!(
                    "- [{}:{}] {}",
                    transcript.sender_type, transcript.entry_type, transcript.content
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        let workflow_goal = plan
            .summary_text
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| plan.title.clone());
        let pending_revision_feedback =
            Self::parse_pending_revision_feedback(running_step.revision_context.as_deref());
        let pending_loop_revision_feedback =
            Self::pending_revision_feedback_is_loop(running_step.revision_context.as_deref());
        let skip_initial_lead_review = pending_loop_revision_feedback
            || pending_revision_feedback
                .as_ref()
                .is_some_and(|feedback| feedback.source == WorkflowRevisionFeedbackSource::User);
        let prompt_context = if pending_revision_feedback.is_some() {
            AgentPromptContext::StepRevision
        } else {
            AgentPromptContext::StepExecution
        };
        let mut sa_clone = session_agent.clone();
        let agent_skill_names: Vec<String> = chat_runner
            .prepare_and_resolve_agent_skills(&mut sa_clone, agent, prompt_context)
            .await
            .unwrap_or_default()
            .iter()
            .map(|s| s.name.clone())
            .collect();
        let workspace_isolation_prompt = Self::active_frontier_workspace_isolation_prompt(
            session,
            &running_step,
            current_steps,
            edges,
            workflow_agent_sessions,
            session_agent,
            session_agents,
            agents,
        );
        let mut prompt = if let Some(pending_feedback) = pending_revision_feedback.as_ref() {
            build_step_revision_prompt_with_schema(
                &running_step,
                pending_feedback.source,
                &pending_feedback.feedback,
                &pending_feedback.previous_summary,
                pending_feedback.previous_content.as_deref(),
                running_step.retry_count,
                &agent_skill_names,
            )
        } else {
            build_step_execution_prompt_with_schema(
                execution,
                &workflow_goal,
                &running_step,
                &dependency_summaries,
                Some(&step_transcript_context),
                &agent_skill_names,
            )
        };
        if let Some(section) = workspace_isolation_prompt.as_deref() {
            inject_step_prompt_section_before_schema(&mut prompt, section);
        }

        tracing::debug!(
            "Running step {} with prompt:\n{}",
            running_step.title,
            prompt
        );

        let running_step = if pending_revision_feedback.is_some() {
            WorkflowStep::update_revision_context(
                pool,
                running_step.id,
                Self::clear_pending_revision_feedback(running_step.revision_context.as_deref()),
            )
            .await?
        } else {
            running_step
        };

        let (protocol_message, agent_output) = match Self::run_step_agent_protocol_with_retry(
            db,
            pool,
            chat_runner,
            session,
            agent,
            session_agent,
            workflow_session,
            &prompt,
            &running_step,
            pending_revision_feedback.is_some(),
        )
        .await
        {
            Ok((message, agent_output)) => {
                tracing::debug!(
                    "Raw output from step {}: {}",
                    running_step.title,
                    agent_output.output
                );
                (message, agent_output)
            }
            Err(OrchestratorError::Runtime(WorkflowRuntimeError::Interrupted(reason))) => {
                Self::cleanup_result_dependency_context_file(
                    result_dependency_context_file
                        .as_ref()
                        .map(|item| item.absolute_path.as_path()),
                )
                .await;
                let _ = Self::write_transcript(
                    pool,
                    execution.id,
                    running_step.round_id.into(),
                    Some(workflow_session.id),
                    Some(running_step.id),
                    "system",
                    "message",
                    &format!("Step \"{}\" interrupted: {}", running_step.title, reason),
                    None,
                )
                .await;
                return Ok(StepOutcome::Interrupted);
            }
            Err(err) => {
                let err_message = err.to_string();
                Self::cleanup_result_dependency_context_file(
                    result_dependency_context_file
                        .as_ref()
                        .map(|item| item.absolute_path.as_path()),
                )
                .await;
                let failed_step = WorkflowStep::record_execution_result(
                    pool,
                    running_step.id,
                    Uuid::new_v4(),
                    Some(
                        serde_json::to_string(&SummaryPayload {
                            summary: err_message.clone(),
                            content: None,
                            outputs: vec![],
                        })
                        .unwrap_or_else(|_| err_message.clone()),
                    ),
                    None,
                )
                .await?;
                Self::transition_step_and_sync(
                    pool,
                    chat_runner,
                    execution,
                    &failed_step,
                    WorkflowStepStatus::Failed,
                    "step_failed",
                )
                .await?;
                let _ = Self::write_transcript(
                    pool,
                    execution.id,
                    failed_step.round_id.into(),
                    Some(workflow_session.id),
                    Some(failed_step.id),
                    "system",
                    "message",
                    &format!("Step \"{}\" failed: {}", failed_step.title, err),
                    None,
                )
                .await;
                return Ok(StepOutcome::Failed(err_message));
            }
        };
        Self::cleanup_result_dependency_context_file(
            result_dependency_context_file
                .as_ref()
                .map(|item| item.absolute_path.as_path()),
        )
        .await;

        let latest_running_step = WorkflowStep::find_by_id(pool, running_step.id)
            .await?
            .unwrap_or_else(|| running_step.clone());

        match protocol_message {
            WorkflowStepProtocolMessage::FinalResult {
                summary,
                content,
                outputs,
                ..
            } if latest_running_step.step_type == WorkflowStepType::Task
                && (latest_running_step.lead_review_required
                    || latest_running_step.user_review_required) =>
            {
                Self::execute_step_with_feedback(
                    db,
                    pool,
                    chat_runner,
                    execution,
                    &latest_running_step,
                    workflow_session,
                    session,
                    session_agent,
                    agent,
                    workflow_agent_sessions,
                    session_agents,
                    agents,
                    plan,
                    current_steps,
                    edges,
                    workflow_step_run_result_from_agent_output(
                        &agent_output,
                        summary,
                        content,
                        outputs,
                    ),
                    skip_initial_lead_review,
                )
                .await
            }
            other => {
                Self::handle_step_protocol_message(
                    pool,
                    chat_runner,
                    execution,
                    &running_step,
                    workflow_session,
                    other,
                    agent_output.run_id,
                )
                .await
            }
        }
    }
}
