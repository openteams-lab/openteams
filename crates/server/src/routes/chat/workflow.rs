use std::collections::HashMap;

use axum::{
    Extension, Json,
    body::Bytes,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json as ResponseJson, Response},
};
use chrono::{DateTime, NaiveDateTime, Utc};
use db::models::{
    chat_agent::ChatAgent,
    chat_message::ChatMessage,
    chat_session::ChatSession,
    chat_session_agent::ChatSessionAgent,
    workflow_execution::WorkflowExecution,
    workflow_loop::WorkflowLoop,
    workflow_plan::{CreateWorkflowPlan, WorkflowPlan},
    workflow_plan_revision::{CreateWorkflowPlanRevision, WorkflowPlanRevision},
    workflow_step::WorkflowStep,
    workflow_step_review::WorkflowStepReview,
    workflow_transcript::WorkflowTranscript,
    workflow_types::{
        ReviewVerdict, ReviewerType, WorkflowExecutionStatus, WorkflowPlanJson, WorkflowPlanStatus,
        WorkflowRevisionEditor, WorkflowValidationStatus,
    },
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::{
    config,
    workflow_analytics::{self, hash_user_id},
    workflow_compiler::WorkflowCompiler,
    workflow_orchestrator::WorkflowOrchestrator,
    workflow_runtime::{
        WorkflowCardAgent, WorkflowCardProjection, build_plan_generation_prompt,
        extract_json_payload, resolve_lead_agent, resolve_workflow_goal,
        resolve_workflow_response_language_instruction, run_workflow_agent_prompt,
    },
    workflow_validator,
};
use ts_rs::TS;
use utils::{assets::config_path, response::ApiResponse};
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

#[derive(Debug, Serialize, TS)]
pub struct RetryPlanGenerationResponse {
    pub status: String,
    pub message_id: Uuid,
}

pub async fn generate_plan_and_run(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<GeneratePlanAndRunRequest>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;

    if !WorkflowExecution::find_generation_blocking_by_session(pool, session.id)
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

    let (lead_agent, lead_session_agent) = resolve_lead_agent(&session, &session_agents, &agents)
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;

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

    let ui_config = config::load_config_from_file(&config_path()).await;
    let response_language_instruction =
        resolve_workflow_response_language_instruction(&ui_config.language);
    let prompt = build_plan_generation_prompt(
        &user_goal,
        &lead_agent.id.to_string(),
        &available_agents,
        None,
        None,
        response_language_instruction,
        None,
    );

    tracing::debug!("Plan generation prompt for lead agent:\n{}", prompt);

    let track_plan_generation_failure = || {
        workflow_analytics::track_plan_generated(
            workflow_analytics::analytics_if_enabled(
                deployment.analytics().as_ref(),
                deployment.analytics_enabled(),
            ),
            session.id,
            None,
            false,
        );
    };

    let raw_plan_output = run_workflow_agent_prompt(
        deployment.db(),
        &session,
        lead_agent,
        lead_session_agent,
        None,
        &prompt,
        uuid::Uuid::nil(),
    )
    .await
    .map_err(|err| {
        track_plan_generation_failure();
        ApiError::BadRequest(err.to_string())
    })?;

    tracing::debug!("Raw plan output from lead agent: {}", raw_plan_output);

    let plan_json = extract_json_payload(&raw_plan_output).ok_or_else(|| {
        track_plan_generation_failure();
        ApiError::BadRequest("Lead agent did not return a workflow JSON object.".to_string())
    })?;

    let parsed_plan: db::models::workflow_types::WorkflowPlanJson =
        serde_json::from_str(&plan_json).map_err(|err| {
            track_plan_generation_failure();
            ApiError::BadRequest(format!("Lead agent returned invalid workflow JSON: {err}"))
        })?;
    let valid_agent_ids = agents
        .iter()
        .map(|agent| agent.id.to_string())
        .collect::<Vec<_>>();
    let validation = workflow_validator::validate_plan(&parsed_plan, &valid_agent_ids);
    if !validation.is_valid {
        track_plan_generation_failure();
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
        .map_err(|err| {
            track_plan_generation_failure();
            ApiError::BadRequest(err.to_string())
        })?;

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

    workflow_analytics::track_plan_executed(
        workflow_analytics::analytics_if_enabled(
            deployment.analytics().as_ref(),
            deployment.analytics_enabled(),
        ),
        session.id,
        plan.id,
        execution.id,
    );

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
            tracing::error!(execution_id = %execution_id, error = %err, "workflow scheduler failed when running plan");
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

pub async fn retry_plan_generation(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Path((_session_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;
    let message = ChatMessage::find_by_id(pool, message_id)
        .await?
        .ok_or(ApiError::Database(sqlx::Error::RowNotFound))?;
    if message.session_id != session.id {
        return Err(ApiError::BadRequest(
            "Workflow plan generation message does not belong to this session.".to_string(),
        ));
    }

    let card_type = message
        .meta
        .0
        .get("card_type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if card_type != "workflow_plan_generation" {
        return Err(ApiError::BadRequest(
            "Message is not a workflow plan generation card.".to_string(),
        ));
    }

    let generation_meta = message
        .meta
        .0
        .get("workflow_plan_generation")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| {
            ApiError::BadRequest("Workflow plan generation metadata is missing.".to_string())
        })?;
    let status = generation_meta
        .get("status")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if status != "failed" {
        return Ok((
            StatusCode::CONFLICT,
            ResponseJson(ApiResponse::<RetryPlanGenerationResponse>::error(
                "Only failed workflow plan generation cards can be retried.",
            )),
        )
            .into_response());
    }

    let plan_goal = generation_meta
        .get("plan_goal")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ApiError::BadRequest("Workflow plan generation goal is missing.".to_string())
        })?
        .to_string();
    let previous_failure_reason = generation_meta
        .get("error_message")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let deployment_clone = deployment.clone();
    let session_id = session.id;
    tokio::spawn(async move {
        if let Err(err) = deployment_clone
            .chat_runner()
            .trigger_plan_generation(
                session_id,
                Uuid::nil(),
                Uuid::nil(),
                "workflow_plan_retry",
                message_id,
                &plan_goal,
                Some(message_id),
                previous_failure_reason.as_deref(),
                None,
            )
            .await
        {
            tracing::error!(
                session_id = %session_id,
                message_id = %message_id,
                error = %err,
                "[workflow] retry plan generation failed"
            );
        }
    });

    Ok((
        StatusCode::ACCEPTED,
        ResponseJson(ApiResponse::<RetryPlanGenerationResponse>::success(
            RetryPlanGenerationResponse {
                status: "queued".to_string(),
                message_id,
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

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ExecutePlanReviewOverride {
    #[serde(alias = "stepKey", alias = "id")]
    pub step_id: String,
    #[serde(default)]
    pub lead_review: Option<bool>,
    #[serde(default)]
    pub user_review: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ExecutePlanRequest {
    #[serde(default)]
    pub plan: Option<WorkflowPlanJson>,
    #[serde(default)]
    pub step_review_overrides: Vec<ExecutePlanReviewOverride>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReviewSettingsRequest {
    #[serde(default)]
    pub step_review_overrides: Vec<ExecutePlanReviewOverride>,
}

pub async fn execute_plan(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, plan_id)): axum::extract::Path<(Uuid, Uuid)>,
    body: Bytes,
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

    let review_overrides = parse_optional_execute_plan_request(&body)?
        .map(collect_execute_plan_review_overrides)
        .unwrap_or_default();

    let bootstrap = WorkflowOrchestrator::execute_plan(pool, deployment.chat_runner(), plan_id)
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    if !review_overrides.is_empty() {
        apply_review_overrides_to_execution(pool, bootstrap.execution.id, &review_overrides)
            .await?;
    }

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
            tracing::error!(execution_id = %execution_id, error = %err, "workflow scheduler failed when executing plan");
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

pub async fn update_review_settings(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, execution_id)): axum::extract::Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateReviewSettingsRequest>,
) -> Result<ResponseJson<ApiResponse<WorkflowCardProjection>>, ApiError> {
    let pool = &deployment.db().pool;
    let overrides = collect_review_override_map(payload.step_review_overrides);
    if overrides.is_empty() {
        return Err(ApiError::BadRequest(
            "At least one review setting is required.".to_string(),
        ));
    }

    let execution = WorkflowExecution::find_by_id(pool, execution_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow execution not found.".to_string()))?;
    if execution.session_id != session.id {
        return Err(ApiError::BadRequest(
            "Workflow execution not found in this session.".to_string(),
        ));
    }
    match execution.status {
        WorkflowExecutionStatus::Completed
        | WorkflowExecutionStatus::Failed
        | WorkflowExecutionStatus::Cancelled => {
            return Err(ApiError::BadRequest(
                "Review settings cannot be changed after execution has finished.".to_string(),
            ));
        }
        WorkflowExecutionStatus::Running
        | WorkflowExecutionStatus::Waiting
        | WorkflowExecutionStatus::Recompiling => {
            return Err(ApiError::BadRequest(
                "Review settings can only be changed while execution is not running or waiting for review."
                    .to_string(),
            ));
        }
        WorkflowExecutionStatus::Pending | WorkflowExecutionStatus::Paused => {}
    }

    apply_review_overrides_to_execution(pool, execution.id, &overrides).await?;

    WorkflowOrchestrator::refresh_execution_projection_with_reason(
        pool,
        deployment.chat_runner(),
        execution.id,
        None,
        "review_settings_updated",
        Vec::new(),
    )
    .await
    .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    let card_message_id = execution.workflow_card_message_id.ok_or_else(|| {
        ApiError::BadRequest("Workflow execution card message is missing.".to_string())
    })?;
    let card_message = ChatMessage::find_by_id(pool, card_message_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow execution card not found.".to_string()))?;
    let projection =
        super::messages::build_execution_workflow_card_projection(pool, &card_message).await?;

    Ok(ResponseJson(ApiResponse::success(projection)))
}

fn parse_optional_execute_plan_request(
    body: &Bytes,
) -> Result<Option<ExecutePlanRequest>, ApiError> {
    if body.iter().all(|byte| byte.is_ascii_whitespace()) {
        return Ok(None);
    }

    serde_json::from_slice::<ExecutePlanRequest>(body)
        .map(Some)
        .map_err(|err| ApiError::BadRequest(format!("Invalid execute plan payload: {err}")))
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
            tracing::error!(execution_id = %execution_id, error = %err, "workflow scheduler failed when resuming execution");
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
    list_transcript_response(
        pool,
        workflow_analytics::analytics_if_enabled(
            deployment.analytics().as_ref(),
            deployment.analytics_enabled(),
        ),
        deployment.user_id(),
        &session,
        execution.id,
        scoped_query,
    )
    .await
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
        deployment.db(),
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
                tracing::error!(execution_id = %execution_id, error = %err, "workflow scheduler failed after submitting step input");
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

    let step =
        WorkflowOrchestrator::interrupt_step(deployment.chat_runner(), pool, execution.id, step_id)
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

    let step =
        WorkflowOrchestrator::interrupt_step(deployment.chat_runner(), pool, execution.id, step_id)
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
    Query(query): Query<RetryStepQuery>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;
    let (_step, _execution) = load_step_for_session(pool, &session, step_id).await?;

    let retry_target = query.retry_target.as_deref().unwrap_or("task");
    let (execution, step) = match retry_target {
        "review" => WorkflowOrchestrator::retry_step_review(
            deployment.db(),
            deployment.chat_runner(),
            step_id,
        )
        .await
        .map_err(|err| ApiError::BadRequest(err.to_string()))?,
        _ => WorkflowOrchestrator::retry_step(deployment.db(), deployment.chat_runner(), step_id)
            .await
            .map_err(|err| ApiError::BadRequest(err.to_string()))?,
    };

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

async fn apply_review_overrides_to_execution(
    pool: &sqlx::SqlitePool,
    execution_id: Uuid,
    overrides: &HashMap<String, ExecutePlanReviewOverride>,
) -> Result<(), ApiError> {
    let steps = WorkflowStep::find_by_execution(pool, execution_id).await?;
    let loops = WorkflowLoop::find_by_execution(pool, execution_id).await?;
    for step in steps {
        let Some(override_item) = overrides.get(&step.step_key) else {
            continue;
        };
        let lead_review_required = override_item
            .lead_review
            .unwrap_or(step.lead_review_required);
        let user_review_required = override_item
            .user_review
            .unwrap_or(step.user_review_required);
        if lead_review_required != step.lead_review_required
            || user_review_required != step.user_review_required
        {
            WorkflowStep::update_review_requirements(
                pool,
                step.id,
                lead_review_required,
                user_review_required,
            )
            .await?;
        }
        if let Some(user_review) = override_item.user_review {
            for workflow_loop in loops
                .iter()
                .filter(|workflow_loop| workflow_loop.review_step_id == step.id)
            {
                if workflow_loop.user_review_required != user_review {
                    WorkflowLoop::update_user_review_required(pool, workflow_loop.id, user_review)
                        .await?;
                }
            }
        }
    }

    Ok(())
}

fn collect_execute_plan_review_overrides(
    payload: ExecutePlanRequest,
) -> HashMap<String, ExecutePlanReviewOverride> {
    let mut overrides = HashMap::new();
    for override_item in payload.step_review_overrides {
        if override_item.lead_review.is_none() && override_item.user_review.is_none() {
            continue;
        }
        overrides.insert(override_item.step_id.clone(), override_item);
    }

    overrides
}

fn collect_review_override_map(
    step_review_overrides: Vec<ExecutePlanReviewOverride>,
) -> HashMap<String, ExecutePlanReviewOverride> {
    step_review_overrides
        .into_iter()
        .filter(|override_item| {
            override_item.lead_review.is_some() || override_item.user_review.is_some()
        })
        .map(|override_item| (override_item.step_id.clone(), override_item))
        .collect()
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
                tracing::error!(execution_id = %execution_id, error = %err, "workflow scheduler failed after resolving step action");
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

#[derive(Debug, Default, Deserialize)]
pub struct RetryStepQuery {
    pub retry_target: Option<String>,
}

#[derive(Debug, Default, Deserialize, TS)]
pub struct WorkflowTranscriptQuery {
    pub step_id: Option<Uuid>,
    pub step_key: Option<String>,
    pub workflow_agent_session_id: Option<Uuid>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

fn normalize_workflow_transcript_created_at(created_at: &str) -> String {
    if let Ok(date_time) = DateTime::parse_from_rfc3339(created_at) {
        return date_time.with_timezone(&Utc).to_rfc3339();
    }

    for format in ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(created_at, format) {
            return naive.and_utc().to_rfc3339();
        }
    }

    created_at.to_string()
}

fn workflow_review_verdict_label(verdict: &ReviewVerdict) -> &'static str {
    match verdict {
        ReviewVerdict::Approved => "approved",
        ReviewVerdict::Rejected => "rejected",
    }
}

fn workflow_reviewer_type_label(reviewer_type: &ReviewerType) -> &'static str {
    match reviewer_type {
        ReviewerType::Lead => "lead",
        ReviewerType::User => "user",
    }
}

fn workflow_transcript_review_key(entry: &WorkflowTranscriptEntry) -> Option<(Uuid, String, i32)> {
    if !matches!(
        entry.entry_type.as_str(),
        "lead_review" | "step_review" | "loop_review"
    ) {
        return None;
    }
    let step_id = entry.step_id?;
    let meta = entry
        .meta_json
        .as_deref()
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())?;
    let reviewer_type = meta
        .get("reviewer_type")
        .and_then(|value| value.as_str())
        .unwrap_or_else(|| {
            if entry.entry_type == "lead_review" {
                "lead"
            } else {
                "user"
            }
        })
        .to_string();
    let review_round = meta
        .get("review_round")
        .and_then(|value| value.as_i64())
        .and_then(|value| i32::try_from(value).ok())?;
    Some((step_id, reviewer_type, review_round))
}

async fn list_transcript_response(
    pool: &sqlx::SqlitePool,
    analytics: Option<&services::services::analytics::AnalyticsService>,
    user_id: &str,
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

    let has_filter = query.step_id.is_some()
        || query.step_key.is_some()
        || query.workflow_agent_session_id.is_some();

    let transcripts = if has_filter {
        WorkflowTranscript::find_by_execution_with_step_filter(
            pool,
            execution_id,
            query.step_id,
            query.step_key.as_deref(),
            query.workflow_agent_session_id,
            query.limit,
            query.offset,
        )
        .await?
    } else {
        let limit = query.limit.unwrap_or(200);
        let offset = query.offset.unwrap_or(0);
        WorkflowTranscript::find_by_execution_paginated(pool, execution_id, limit, offset).await?
    };
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
    let step_by_id: HashMap<Uuid, &WorkflowStep> =
        steps.iter().map(|step| (step.id, step)).collect();

    let mut entries: Vec<WorkflowTranscriptEntry> = transcripts
        .into_iter()
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
                created_at: normalize_workflow_transcript_created_at(&t.created_at),
                agent_name,
            }
        })
        .collect();

    let existing_review_keys: std::collections::HashSet<(Uuid, String, i32)> = entries
        .iter()
        .filter_map(workflow_transcript_review_key)
        .collect();
    let step_reviews = WorkflowStepReview::find_by_execution(pool, execution_id).await?;
    for review in step_reviews {
        let Some(step) = step_by_id.get(&review.step_id) else {
            continue;
        };
        if query
            .step_id
            .is_some_and(|step_id| step_id != review.step_id)
        {
            continue;
        }
        if query
            .step_key
            .as_deref()
            .is_some_and(|step_key| step_key != step.step_key)
        {
            continue;
        }
        if query.workflow_agent_session_id.is_some() {
            continue;
        }

        let reviewer_type = workflow_reviewer_type_label(&review.reviewer_type);
        let review_key = (
            review.step_id,
            reviewer_type.to_string(),
            review.review_round,
        );
        if existing_review_keys.contains(&review_key) {
            continue;
        }

        let entry_type = match &review.reviewer_type {
            ReviewerType::Lead => "lead_review",
            ReviewerType::User => "step_review",
        };
        let sender_type = match &review.reviewer_type {
            ReviewerType::Lead => "agent",
            ReviewerType::User => "user",
        };
        let agent_name = match &review.reviewer_type {
            ReviewerType::Lead => Some("Lead".to_string()),
            ReviewerType::User => Some("User".to_string()),
        };
        entries.push(WorkflowTranscriptEntry {
            id: review.id,
            execution_id: review.execution_id,
            round_id: Some(step.round_id),
            workflow_agent_session_id: None,
            step_id: Some(review.step_id),
            step_key: Some(step.step_key.clone()),
            sender_type: sender_type.to_string(),
            entry_type: entry_type.to_string(),
            content: review.feedback,
            meta_json: Some(
                serde_json::json!({
                    "source": "workflow_step_review",
                    "reviewer_type": reviewer_type,
                    "verdict": workflow_review_verdict_label(&review.verdict),
                    "review_round": review.review_round,
                    "review_id": review.id,
                })
                .to_string(),
            ),
            created_at: review.created_at.to_rfc3339(),
            agent_name,
        });
    }

    entries.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    let transcript_scope = if query.step_id.is_some() || query.step_key.is_some() {
        "step"
    } else {
        "execution"
    };
    let user_id_hash = hash_user_id(user_id);
    workflow_analytics::track_transcript_opened(
        analytics,
        session.id,
        execution_id,
        Some(&user_id_hash),
        query.step_id,
        entries.len(),
        transcript_scope,
    );

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
    list_transcript_response(
        pool,
        workflow_analytics::analytics_if_enabled(
            deployment.analytics().as_ref(),
            deployment.analytics_enabled(),
        ),
        deployment.user_id(),
        &session,
        execution_id,
        query,
    )
    .await
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

    if payload.action.trim().eq_ignore_ascii_case("timeout")
        && let Some(step_id) = transcript.step_id
    {
        workflow_analytics::track_approval_timeout(
            workflow_analytics::analytics_if_enabled(
                deployment.analytics().as_ref(),
                deployment.analytics_enabled(),
            ),
            session.id,
            payload.execution_id,
            step_id,
            "approval_request",
        );
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
                tracing::error!(execution_id = %execution_id, error = %err, "workflow scheduler failed after resolving approval action");
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
