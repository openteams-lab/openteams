use std::collections::HashMap;

use axum::{
    Extension, Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json as ResponseJson, Response},
};
use db::models::{
    chat_agent::ChatAgent,
    chat_message::ChatMessage,
    chat_session::ChatSession,
    chat_session_agent::ChatSessionAgent,
    workflow_execution::WorkflowExecution,
    workflow_plan::{CreateWorkflowPlan, WorkflowPlan},
    workflow_plan_revision::{CreateWorkflowPlanRevision, WorkflowPlanRevision},
    workflow_step::WorkflowStep,
    workflow_transcript::WorkflowTranscript,
    workflow_types::{
        WorkflowExecutionStatus, WorkflowPlanStatus, WorkflowRevisionEditor,
        WorkflowValidationStatus,
    },
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::{
    workflow_compiler::WorkflowCompiler,
    workflow_orchestrator::WorkflowOrchestrator,
    workflow_runtime::{
        WorkflowCardAgent, build_plan_generation_prompt, extract_json_payload,
        resolve_workflow_goal, run_workflow_agent_prompt,
    },
    workflow_validator,
};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize, TS)]
pub struct GeneratePlanAndRunRequest {
    pub user_goal: Option<String>,
}

#[derive(Debug, Serialize, TS)]
pub struct GeneratePlanAndRunResponse {
    pub execution_id: Uuid,
    pub workflow_card_message: db::models::chat_message::ChatMessage,
}

pub async fn generate_plan_and_run(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<GeneratePlanAndRunRequest>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;

    if !WorkflowExecution::find_active_by_session(pool, session.id)
        .await?
        .is_empty()
    {
        return Ok((
            StatusCode::CONFLICT,
            ResponseJson(ApiResponse::<GeneratePlanAndRunResponse>::error(
                "A workflow execution is already active in this session.",
            )),
        )
            .into_response());
    }

    let messages = ChatMessage::find_by_session_id(pool, session.id, None).await?;
    let user_goal =
        resolve_workflow_goal(payload.user_goal.as_deref(), &messages).ok_or_else(|| {
            ApiError::BadRequest(
                "Workflow goal is required. Add a user message first or provide user_goal."
                    .to_string(),
            )
        })?;
    let source_message_id = messages
        .iter()
        .rev()
        .find(|message| message.sender_type == db::models::chat_message::ChatSenderType::User)
        .map(|message| message.id);

    let session_agents = ChatSessionAgent::find_all_for_session(pool, session.id).await?;
    if session_agents.is_empty() {
        return Err(ApiError::BadRequest(
            "At least one session agent is required before running a workflow.".to_string(),
        ));
    }

    let mut agents = Vec::with_capacity(session_agents.len());
    for session_agent in &session_agents {
        let agent = ChatAgent::find_by_id(pool, session_agent.agent_id)
            .await?
            .ok_or_else(|| {
                ApiError::BadRequest("Session agent is missing its agent record.".to_string())
            })?;
        agents.push(agent);
    }

    let lead_session_agent = session_agents
        .first()
        .ok_or_else(|| ApiError::BadRequest("Lead session agent was not found.".to_string()))?;
    let lead_agent = agents
        .iter()
        .find(|agent| agent.id == lead_session_agent.agent_id)
        .ok_or_else(|| ApiError::BadRequest("Lead agent was not found.".to_string()))?;

    let available_agents = session_agents
        .iter()
        .filter_map(|session_agent| {
            let agent = agents
                .iter()
                .find(|agent| agent.id == session_agent.agent_id)?;
            Some(WorkflowCardAgent {
                session_agent_id: session_agent.id.to_string(),
                workflow_agent_session_id: None,
                agent_id: agent.id.to_string(),
                name: agent.name.clone(),
            })
        })
        .collect::<Vec<_>>();

    let prompt =
        build_plan_generation_prompt(&user_goal, &lead_agent.id.to_string(), &available_agents);

    tracing::debug!("Plan generation prompt for lead agent:\n{}", prompt);

    let raw_plan_output = run_workflow_agent_prompt(
        deployment.db(),
        &session,
        lead_agent,
        lead_session_agent,
        &prompt,
        uuid::Uuid::nil(),
    )
    .await
    .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    tracing::debug!("Raw plan output from lead agent: {}", raw_plan_output);

    let plan_json = extract_json_payload(&raw_plan_output).ok_or_else(|| {
        ApiError::BadRequest("Lead agent did not return a workflow JSON object.".to_string())
    })?;

    let parsed_plan: db::models::workflow_types::WorkflowPlanJson =
        serde_json::from_str(&plan_json).map_err(|err| {
            ApiError::BadRequest(format!("Lead agent returned invalid workflow JSON: {err}"))
        })?;
    let valid_agent_ids = agents
        .iter()
        .map(|agent| agent.id.to_string())
        .collect::<Vec<_>>();
    let validation = workflow_validator::validate_plan(&parsed_plan, &valid_agent_ids);
    if !validation.is_valid {
        persist_invalid_plan(
            pool,
            session.id,
            source_message_id,
            lead_session_agent.id,
            &parsed_plan,
            &plan_json,
            &validation.errors,
        )
        .await?;

        let validation_message = validation
            .errors
            .iter()
            .map(|error| format!("{}: {}", error.field, error.message))
            .collect::<Vec<_>>()
            .join("; ");

        return Ok((
            StatusCode::BAD_REQUEST,
            ResponseJson(ApiResponse::<GeneratePlanAndRunResponse>::error(
                &validation_message,
            )),
        )
            .into_response());
    }

    let (plan, revision, workflow_card_message) =
        WorkflowOrchestrator::create_workflow_plan_and_card(
            pool,
            deployment.chat_runner(),
            &session,
            source_message_id,
            lead_session_agent,
            &plan_json,
        )
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    let agent_id_map = session_agents
        .iter()
        .map(|session_agent| (session_agent.agent_id.to_string(), session_agent.id))
        .collect::<HashMap<_, _>>();
    let bootstrap = WorkflowOrchestrator::bootstrap_execution(
        pool,
        &plan,
        &revision,
        Some(lead_session_agent.id),
        &valid_agent_ids,
        &agent_id_map,
    )
    .await
    .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    let execution = WorkflowExecution::update_workflow_card_message_id(
        pool,
        bootstrap.execution.id,
        workflow_card_message.id,
    )
    .await?;

    WorkflowOrchestrator::refresh_workflow_card(
        pool,
        deployment.chat_runner(),
        &execution,
        &plan,
        &revision,
        &session_agents,
        &agents,
        bootstrap.failure_reason.clone(),
    )
    .await
    .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    let workflow_card_message = ChatMessage::find_by_id(pool, workflow_card_message.id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow card message was not found.".to_string()))?;

    let deployment_clone = deployment.clone();
    let execution_id = execution.id;
    tokio::spawn(async move {
        if let Err(err) = WorkflowOrchestrator::wake_scheduler(
            deployment_clone.db(),
            deployment_clone.chat_runner(),
            execution_id,
        )
        .await
        {
            tracing::error!(execution_id = %execution_id, error = %err, "workflow scheduler failed");
        }
    });

    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<GeneratePlanAndRunResponse>::success(
            GeneratePlanAndRunResponse {
                execution_id: execution.id,
                workflow_card_message,
            },
        )),
    )
        .into_response())
}

// -----------------------------------------------------------------------
// Execute Plan (idempotent)
// -----------------------------------------------------------------------

#[derive(Debug, Serialize, TS)]
pub struct ExecutePlanResponse {
    pub execution_id: Uuid,
}

pub async fn execute_plan(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, plan_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;

    // Verify the plan belongs to this session
    let plan = WorkflowPlan::find_by_id(pool, plan_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Plan not found.".to_string()))?;
    if plan.session_id != session.id {
        return Err(ApiError::BadRequest(
            "Plan not found in this session.".to_string(),
        ));
    }

    let bootstrap = WorkflowOrchestrator::execute_plan(pool, deployment.chat_runner(), plan_id)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    // Wake the scheduler to start executing steps
    let deployment_clone = deployment.clone();
    let execution_id = bootstrap.execution.id;
    tokio::spawn(async move {
        if let Err(err) = WorkflowOrchestrator::wake_scheduler(
            deployment_clone.db(),
            deployment_clone.chat_runner(),
            execution_id,
        )
        .await
        {
            tracing::error!(execution_id = %execution_id, error = %err, "workflow scheduler failed");
        }
    });

    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<ExecutePlanResponse>::success(
            ExecutePlanResponse {
                execution_id: bootstrap.execution.id,
            },
        )),
    )
        .into_response())
}

// -----------------------------------------------------------------------
// Resume Execution
// -----------------------------------------------------------------------

#[derive(Debug, Serialize, TS)]
pub struct ResumeExecutionResponse {
    pub status: String,
}

pub async fn resume_execution(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, execution_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;

    let execution = WorkflowExecution::find_by_id(pool, execution_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Execution not found.".to_string()))?;
    if execution.session_id != session.id {
        return Err(ApiError::BadRequest(
            "Execution not found in this session.".to_string(),
        ));
    }

    let resumed =
        WorkflowOrchestrator::resume_execution(pool, deployment.chat_runner(), execution_id)
            .await
            .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    let deployment_clone = deployment.clone();
    tokio::spawn(async move {
        if let Err(err) = WorkflowOrchestrator::wake_scheduler(
            deployment_clone.db(),
            deployment_clone.chat_runner(),
            execution_id,
        )
        .await
        {
            tracing::error!(execution_id = %execution_id, error = %err, "workflow scheduler failed");
        }
    });

    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<ResumeExecutionResponse>::success(
            ResumeExecutionResponse {
                status: format!("{:?}", resumed.status).to_lowercase(),
            },
        )),
    )
        .into_response())
}

// -----------------------------------------------------------------------
// Pause All
// -----------------------------------------------------------------------

#[derive(Debug, Deserialize, TS)]
pub struct PauseAllRequest {
    pub execution_id: Uuid,
}

#[derive(Debug, Serialize, TS)]
pub struct PauseAllResponse {
    pub status: String,
}

pub async fn pause_all(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<PauseAllRequest>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;

    let execution = WorkflowExecution::find_by_id(pool, payload.execution_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Execution not found.".to_string()))?;
    if execution.session_id != session.id {
        return Err(ApiError::BadRequest(
            "Execution not found in this session.".to_string(),
        ));
    }

    let execution =
        WorkflowOrchestrator::pause_all(deployment.chat_runner(), pool, payload.execution_id)
    .await
    .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<PauseAllResponse>::success(PauseAllResponse {
            status: format!("{:?}", execution.status).to_lowercase(),
        })),
    )
        .into_response())
}

// -----------------------------------------------------------------------
// Interrupt Step
// -----------------------------------------------------------------------

#[derive(Debug, Deserialize, TS)]
pub struct InterruptStepRequest {
    pub execution_id: Uuid,
    pub step_id: Uuid,
}

#[derive(Debug, Serialize, TS)]
pub struct InterruptStepResponse {
    pub status: String,
}

pub async fn interrupt_step(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<InterruptStepRequest>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;

    let execution = WorkflowExecution::find_by_id(pool, payload.execution_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Execution not found.".to_string()))?;
    if execution.session_id != session.id {
        return Err(ApiError::BadRequest(
            "Execution not found in this session.".to_string(),
        ));
    }

    let step = WorkflowOrchestrator::interrupt_step(
        deployment.chat_runner(),
        pool,
        payload.execution_id,
        payload.step_id,
    )
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<InterruptStepResponse>::success(
            InterruptStepResponse {
                status: format!("{:?}", step.status).to_lowercase(),
            },
        )),
    )
        .into_response())
}

#[derive(Debug, Deserialize, TS)]
pub struct StepActionRequest {
    pub transcript_id: Option<Uuid>,
    pub action: Option<String>,
    pub input_text: Option<String>,
}

#[derive(Debug, Serialize, TS)]
pub struct StepActionResponse {
    pub status: String,
}

#[derive(Debug, Deserialize, TS)]
pub struct StepInputRequest {
    pub input_text: String,
}

async fn load_step_for_session(
    pool: &sqlx::SqlitePool,
    session: &ChatSession,
    step_id: Uuid,
) -> Result<(WorkflowStep, WorkflowExecution), ApiError> {
    let step = WorkflowStep::find_by_id(pool, step_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Step not found.".to_string()))?;
    let execution = WorkflowExecution::find_by_id(pool, step.execution_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Execution not found.".to_string()))?;
    if execution.session_id != session.id {
        return Err(ApiError::BadRequest(
            "Step not found in this session.".to_string(),
        ));
    }
    Ok((step, execution))
}

pub async fn get_step_transcripts(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, step_id)): axum::extract::Path<(Uuid, Uuid)>,
    Query(query): Query<WorkflowTranscriptQuery>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;
    let (_step, execution) = load_step_for_session(pool, &session, step_id).await?;
    let mut scoped_query = query;
    scoped_query.step_id = Some(step_id);
    list_transcript_response(pool, &session, execution.id, scoped_query).await
}

pub async fn submit_step_input(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, step_id)): axum::extract::Path<(Uuid, Uuid)>,
    Json(payload): Json<StepInputRequest>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;
    let (_step, _execution) = load_step_for_session(pool, &session, step_id).await?;

    let result = WorkflowOrchestrator::submit_step_input(
        pool,
        deployment.chat_runner(),
        step_id,
        &payload.input_text,
    )
    .await
    .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    if result.should_wake_scheduler {
        let deployment_clone = deployment.clone();
        let execution_id = result.execution.id;
        tokio::spawn(async move {
            if let Err(err) = WorkflowOrchestrator::wake_scheduler(
                deployment_clone.db(),
                deployment_clone.chat_runner(),
                execution_id,
            )
            .await
            {
                tracing::error!(execution_id = %execution_id, error = %err, "workflow scheduler failed");
            }
        });
    }

    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<StepActionResponse>::success(
            StepActionResponse {
                status: format!("{:?}", result.execution.status).to_lowercase(),
            },
        )),
    )
        .into_response())
}

pub async fn interrupt_step_by_step_id(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, step_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;
    let (_step, execution) = load_step_for_session(pool, &session, step_id).await?;

    let step = WorkflowOrchestrator::interrupt_step(
        deployment.chat_runner(),
        pool,
        execution.id,
        step_id,
    )
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<InterruptStepResponse>::success(
            InterruptStepResponse {
                status: format!("{:?}", step.status).to_lowercase(),
            },
        )),
    )
        .into_response())
}

pub async fn stop_step(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, step_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;
    let (_step, execution) = load_step_for_session(pool, &session, step_id).await?;

    let step = WorkflowOrchestrator::interrupt_step(
        deployment.chat_runner(),
        pool,
        execution.id,
        step_id,
    )
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<InterruptStepResponse>::success(
            InterruptStepResponse {
                status: format!("{:?}", step.status).to_lowercase(),
            },
        )),
    )
        .into_response())
}

pub async fn retry_step(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, step_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;
    let (_step, _execution) = load_step_for_session(pool, &session, step_id).await?;

    let (execution, step) =
        WorkflowOrchestrator::retry_step(deployment.db(), deployment.chat_runner(), step_id)
            .await
            .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<StepActionResponse>::success(
            StepActionResponse {
                status: if execution.status == WorkflowExecutionStatus::Failed {
                    "failed".to_string()
                } else {
                    format!("{:?}", step.status).to_lowercase()
                },
            },
        )),
    )
        .into_response())
}

async fn resolve_step_action(
    pool: &sqlx::SqlitePool,
    deployment: &DeploymentImpl,
    step_id: Uuid,
    payload: StepActionRequest,
) -> Result<ResolveActionResponse, ApiError> {
    let transcript_id = payload
        .transcript_id
        .ok_or_else(|| ApiError::BadRequest("transcript_id is required.".to_string()))?;
    let action = payload
        .action
        .clone()
        .ok_or_else(|| ApiError::BadRequest("action is required.".to_string()))?;

    let transcript = WorkflowTranscript::find_by_id(pool, transcript_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Transcript not found.".to_string()))?;
    if transcript.step_id != Some(step_id) {
        return Err(ApiError::BadRequest(
            "Transcript does not belong to this step.".to_string(),
        ));
    }

    let resolved = WorkflowOrchestrator::resolve_transcript_action(
        pool,
        deployment.chat_runner(),
        transcript_id,
        &action,
        payload.input_text.as_deref(),
    )
    .await
    .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    if resolved.should_wake_scheduler {
        let deployment_clone = deployment.clone();
        let execution_id = resolved.execution.id;
        tokio::spawn(async move {
            if let Err(err) = WorkflowOrchestrator::wake_scheduler(
                deployment_clone.db(),
                deployment_clone.chat_runner(),
                execution_id,
            )
            .await
            {
                tracing::error!(execution_id = %execution_id, error = %err, "workflow scheduler failed");
            }
        });
    }

    Ok(ResolveActionResponse {
        status: format!("{:?}", resolved.execution.status).to_lowercase(),
    })
}

pub async fn approve_step_action(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, step_id)): axum::extract::Path<(Uuid, Uuid)>,
    Json(payload): Json<StepActionRequest>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;
    let _ = load_step_for_session(pool, &session, step_id).await?;
    let response = resolve_step_action(pool, &deployment, step_id, payload).await?;
    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<ResolveActionResponse>::success(response)),
    )
        .into_response())
}

pub async fn resolve_step_permission(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, step_id)): axum::extract::Path<(Uuid, Uuid)>,
    Json(payload): Json<StepActionRequest>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;
    let _ = load_step_for_session(pool, &session, step_id).await?;
    let response = resolve_step_action(pool, &deployment, step_id, payload).await?;
    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<ResolveActionResponse>::success(response)),
    )
        .into_response())
}

async fn persist_invalid_plan(
    pool: &sqlx::SqlitePool,
    session_id: Uuid,
    source_message_id: Option<Uuid>,
    lead_session_agent_id: Uuid,
    parsed_plan: &db::models::workflow_types::WorkflowPlanJson,
    plan_json: &str,
    errors: &[workflow_validator::ValidationError],
) -> Result<(WorkflowPlan, WorkflowPlanRevision), ApiError> {
    let validation_errors_json = serde_json::to_string(errors).map_err(|err| {
        ApiError::BadRequest(format!("Failed to serialize validation errors: {err}"))
    })?;
    let plan_hash = WorkflowCompiler::compute_hash(parsed_plan);
    let plan_schema_version = parsed_plan
        .plan_schema_version()
        .map_err(ApiError::BadRequest)?;

    let plan = WorkflowPlan::create(
        pool,
        &CreateWorkflowPlan {
            session_id,
            source_message_id,
            created_by_session_agent_id: Some(lead_session_agent_id),
            title: parsed_plan.title.clone(),
            summary_text: Some(parsed_plan.goal.clone()),
            plan_json: plan_json.to_string(),
            plan_schema_version,
            plan_hash: plan_hash.clone(),
            validation_status: WorkflowValidationStatus::Invalid,
            validation_errors_json: Some(validation_errors_json.clone()),
        },
        Uuid::new_v4(),
    )
    .await?;
    let plan = WorkflowPlan::update_status(pool, plan.id, WorkflowPlanStatus::Draft).await?;

    let revision = WorkflowPlanRevision::create(
        pool,
        &CreateWorkflowPlanRevision {
            plan_id: plan.id,
            revision_no: 1,
            edited_by: WorkflowRevisionEditor::Lead,
            editor_session_agent_id: Some(lead_session_agent_id),
            reason: Some("generate-plan-and-run-invalid".to_string()),
            plan_json: plan_json.to_string(),
            plan_hash,
            validation_status: WorkflowValidationStatus::Invalid,
            validation_errors_json: Some(validation_errors_json),
        },
        Uuid::new_v4(),
    )
    .await?;

    Ok((plan, revision))
}

// -----------------------------------------------------------------------
// Get Workflow Transcripts
// -----------------------------------------------------------------------

#[derive(Debug, Serialize, TS)]
pub struct WorkflowTranscriptEntry {
    pub id: Uuid,
    pub execution_id: Uuid,
    pub round_id: Option<Uuid>,
    pub workflow_agent_session_id: Option<Uuid>,
    pub step_id: Option<Uuid>,
    pub step_key: Option<String>,
    pub sender_type: String,
    pub entry_type: String,
    pub content: String,
    pub meta_json: Option<String>,
    pub created_at: String,
    pub agent_name: Option<String>,
}

#[derive(Debug, Default, Deserialize, TS)]
pub struct WorkflowTranscriptQuery {
    pub step_id: Option<Uuid>,
    pub step_key: Option<String>,
    pub workflow_agent_session_id: Option<Uuid>,
}

async fn list_transcript_response(
    pool: &sqlx::SqlitePool,
    session: &ChatSession,
    execution_id: Uuid,
    query: WorkflowTranscriptQuery,
) -> Result<Response, ApiError> {
    let execution = WorkflowExecution::find_by_id(pool, execution_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Execution not found.".to_string()))?;
    if execution.session_id != session.id {
        return Err(ApiError::BadRequest(
            "Execution not found in this session.".to_string(),
        ));
    }

    let transcripts = WorkflowTranscript::find_by_execution(pool, execution_id).await?;
    let steps = WorkflowStep::find_by_execution(pool, execution_id).await?;
    let workflow_agent_sessions =
        db::models::workflow_agent_session::WorkflowAgentSession::find_by_execution(
            pool,
            execution_id,
        )
        .await?;
    let session_agents = ChatSessionAgent::find_all_for_session(pool, session.id).await?;
    let agents = load_agents_for_route(pool, &session_agents).await?;
    let step_key_by_id: HashMap<Uuid, String> = steps
        .iter()
        .map(|step| (step.id, step.step_key.clone()))
        .collect();

    let entries: Vec<WorkflowTranscriptEntry> = transcripts
        .into_iter()
        .filter(|transcript| {
            query
                .workflow_agent_session_id
                .is_none_or(|workflow_agent_session_id| {
                    transcript.workflow_agent_session_id == Some(workflow_agent_session_id)
                })
        })
        .filter(|transcript| {
            query
                .step_id
                .is_none_or(|step_id| transcript.step_id == Some(step_id))
        })
        .filter(|transcript| {
            query.step_key.as_ref().is_none_or(|step_key| {
                transcript
                    .step_id
                    .and_then(|step_id| step_key_by_id.get(&step_id))
                    .is_some_and(|actual_step_key| actual_step_key == step_key)
            })
        })
        .map(|t| {
            let agent_name = t
                .workflow_agent_session_id
                .and_then(|was_id| workflow_agent_sessions.iter().find(|was| was.id == was_id))
                .and_then(|was| {
                    session_agents
                        .iter()
                        .find(|sa| sa.id == was.session_agent_id)
                })
                .and_then(|sa| agents.iter().find(|a| a.id == sa.agent_id))
                .map(|a| a.name.clone());
            WorkflowTranscriptEntry {
                id: t.id,
                execution_id: t.execution_id,
                round_id: t.round_id,
                workflow_agent_session_id: t.workflow_agent_session_id,
                step_id: t.step_id,
                step_key: t
                    .step_id
                    .and_then(|step_id| step_key_by_id.get(&step_id).cloned()),
                sender_type: t.sender_type,
                entry_type: t.entry_type,
                content: t.content,
                meta_json: t.meta_json,
                created_at: t.created_at,
                agent_name,
            }
        })
        .collect();

    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<Vec<WorkflowTranscriptEntry>>::success(
            entries,
        )),
    )
        .into_response())
}

pub async fn get_transcripts(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, execution_id)): axum::extract::Path<(Uuid, Uuid)>,
    Query(query): Query<WorkflowTranscriptQuery>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;
    list_transcript_response(pool, &session, execution_id, query).await
}

// -----------------------------------------------------------------------
// Resolve Approval / Permission
// -----------------------------------------------------------------------

#[derive(Debug, Deserialize, TS)]
pub struct ResolveActionRequest {
    pub execution_id: Uuid,
    pub transcript_id: Uuid,
    pub action: String,
    pub input_text: Option<String>,
}

#[derive(Debug, Serialize, TS)]
pub struct ResolveActionResponse {
    pub status: String,
}

pub async fn resolve_approval(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<ResolveActionRequest>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;

    let execution = WorkflowExecution::find_by_id(pool, payload.execution_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Execution not found.".to_string()))?;
    if execution.session_id != session.id {
        return Err(ApiError::BadRequest(
            "Execution not found in this session.".to_string(),
        ));
    }
    let transcript = WorkflowTranscript::find_by_id(pool, payload.transcript_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Transcript not found.".to_string()))?;
    if transcript.execution_id != payload.execution_id {
        return Err(ApiError::BadRequest(
            "Transcript does not belong to the provided execution.".to_string(),
        ));
    }

    let resolved = WorkflowOrchestrator::resolve_transcript_action(
        pool,
        deployment.chat_runner(),
        payload.transcript_id,
        &payload.action,
        payload.input_text.as_deref(),
    )
    .await
    .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    if resolved.should_wake_scheduler {
        let deployment_clone = deployment.clone();
        let execution_id = resolved.execution.id;
        tokio::spawn(async move {
            if let Err(err) = WorkflowOrchestrator::wake_scheduler(
                deployment_clone.db(),
                deployment_clone.chat_runner(),
                execution_id,
            )
            .await
            {
                tracing::error!(execution_id = %execution_id, error = %err, "workflow scheduler failed");
            }
        });
    }

    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<ResolveActionResponse>::success(
            ResolveActionResponse {
                status: format!("{:?}", resolved.execution.status).to_lowercase(),
            },
        )),
    )
        .into_response())
}

async fn load_agents_for_route(
    pool: &sqlx::SqlitePool,
    session_agents: &[ChatSessionAgent],
) -> Result<Vec<ChatAgent>, ApiError> {
    let mut agents = Vec::with_capacity(session_agents.len());
    for sa in session_agents {
        if let Some(agent) = ChatAgent::find_by_id(pool, sa.agent_id).await? {
            agents.push(agent);
        }
    }
    Ok(agents)
}
