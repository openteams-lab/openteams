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
        WorkflowRevisionEditor, WorkflowStepStatus, WorkflowValidationStatus,
        to_workflow_wire_value,
    },
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::{
    build_stats::token_cost_stats::TokenCostStatsService,
    config,
    workflow::{
        workflow_analytics,
        workflow_compiler::WorkflowCompiler,
        workflow_orchestrator::{
            WorkflowOrchestrator, workflow_agent_id_map, workflow_plan_agent_id,
            workflow_valid_agent_ids,
        },
        workflow_runtime::{
            WorkflowCardAgent, WorkflowCardProjection, build_plan_generation_prompt,
            extract_json_payload, resolve_lead_agent, resolve_workflow_goal,
            resolve_workflow_response_language_instruction, run_workflow_agent_prompt,
        },
        workflow_validator,
    },
};
use sqlx::SqlitePool;
use ts_rs::TS;
use utils::{assets::config_path, response::ApiResponse};
use uuid::Uuid;

use crate::{
    DeploymentImpl,
    error::ApiError,
    routes::build_stats::{WorkflowStepTokenEntry, WorkflowStepTokenUsageResponse},
};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowSidebarState {
    Idle,
    Running,
    Reviewing,
    Waiting,
    WaitingInput,
    WaitingUserReview,
    Paused,
    Failed,
}

#[derive(Debug, Serialize)]
pub struct WorkflowSessionStatusResponse {
    pub sidebar_workflow_state: WorkflowSidebarState,
    pub has_running_workflow: bool,
    pub pending_workflow_input_id: Option<String>,
    pub pending_workflow_review_id: Option<String>,
}

fn is_sidebar_running_workflow_state(state: WorkflowSidebarState) -> bool {
    matches!(
        state,
        WorkflowSidebarState::Running
            | WorkflowSidebarState::Reviewing
            | WorkflowSidebarState::Waiting
    )
}

fn execution_base_sidebar_state(status: &WorkflowExecutionStatus) -> WorkflowSidebarState {
    if status == &WorkflowExecutionStatus::Pending
        || status == &WorkflowExecutionStatus::Running
        || status == &WorkflowExecutionStatus::Recompiling
    {
        WorkflowSidebarState::Running
    } else if status == &WorkflowExecutionStatus::Waiting {
        WorkflowSidebarState::Waiting
    } else if status == &WorkflowExecutionStatus::Paused {
        WorkflowSidebarState::Paused
    } else if status == &WorkflowExecutionStatus::Failed {
        WorkflowSidebarState::Failed
    } else {
        WorkflowSidebarState::Idle
    }
}

fn sidebar_state_priority(state: WorkflowSidebarState) -> u8 {
    match state {
        WorkflowSidebarState::Reviewing => 60,
        WorkflowSidebarState::Running => 50,
        WorkflowSidebarState::Failed => 40,
        WorkflowSidebarState::Waiting => 30,
        WorkflowSidebarState::WaitingUserReview => 25,
        WorkflowSidebarState::WaitingInput => 25,
        WorkflowSidebarState::Paused => 20,
        WorkflowSidebarState::Idle => 0,
    }
}

fn merge_sidebar_state(
    current: WorkflowSidebarState,
    candidate: WorkflowSidebarState,
) -> WorkflowSidebarState {
    if sidebar_state_priority(candidate) > sidebar_state_priority(current) {
        candidate
    } else {
        current
    }
}

fn execution_accepts_live_step_sidebar_state(status: &WorkflowExecutionStatus) -> bool {
    status == &WorkflowExecutionStatus::Pending
        || status == &WorkflowExecutionStatus::Running
        || status == &WorkflowExecutionStatus::Recompiling
        || status == &WorkflowExecutionStatus::Waiting
}

fn execution_may_have_sidebar_relevant_steps(status: &WorkflowExecutionStatus) -> bool {
    execution_accepts_live_step_sidebar_state(status) || status == &WorkflowExecutionStatus::Paused
}

fn step_sidebar_state_for_execution(
    execution_status: &WorkflowExecutionStatus,
    step_status: &WorkflowStepStatus,
) -> Option<WorkflowSidebarState> {
    let accepts_live_steps = execution_accepts_live_step_sidebar_state(execution_status);
    if step_status == &WorkflowStepStatus::WaitingReview && accepts_live_steps {
        Some(WorkflowSidebarState::Reviewing)
    } else if step_status == &WorkflowStepStatus::Failed
        && (accepts_live_steps || execution_status == &WorkflowExecutionStatus::Paused)
    {
        Some(WorkflowSidebarState::Failed)
    } else if (step_status == &WorkflowStepStatus::WaitingInput
        || step_status == &WorkflowStepStatus::PreCompleted)
        && accepts_live_steps
    {
        Some(WorkflowSidebarState::Waiting)
    } else if (step_status == &WorkflowStepStatus::Pending
        || step_status == &WorkflowStepStatus::Ready
        || step_status == &WorkflowStepStatus::Running
        || step_status == &WorkflowStepStatus::Revising
        || step_status == &WorkflowStepStatus::InterruptRequested)
        && accepts_live_steps
    {
        Some(WorkflowSidebarState::Running)
    } else {
        None
    }
}

async fn derive_sidebar_workflow_state(
    pool: &SqlitePool,
    executions: &[WorkflowExecution],
    pending_workflow_input_id: Option<&str>,
    pending_workflow_review_id: Option<&str>,
) -> Result<WorkflowSidebarState, sqlx::Error> {
    if pending_workflow_review_id.is_some() {
        return Ok(WorkflowSidebarState::WaitingUserReview);
    }
    if pending_workflow_input_id.is_some() {
        return Ok(WorkflowSidebarState::WaitingInput);
    }

    let mut state = WorkflowSidebarState::Idle;

    for execution in executions {
        state = merge_sidebar_state(state, execution_base_sidebar_state(&execution.status));

        if !execution_may_have_sidebar_relevant_steps(&execution.status) {
            continue;
        }

        let steps = WorkflowStep::find_by_execution(pool, execution.id).await?;
        for step in steps {
            if let Some(step_state) =
                step_sidebar_state_for_execution(&execution.status, &step.status)
            {
                state = merge_sidebar_state(state, step_state);
            }
        }
    }

    Ok(state)
}

async fn find_pending_workflow_input_id(
    pool: &SqlitePool,
    executions: &[WorkflowExecution],
) -> Result<Option<Uuid>, sqlx::Error> {
    for execution in executions {
        if !execution_accepts_live_step_sidebar_state(&execution.status) {
            continue;
        }

        let input_id = sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT t.id
            FROM chat_workflow_transcripts t
            INNER JOIN chat_workflow_steps s ON s.id = t.step_id
            WHERE t.execution_id = ?1
              AND t.entry_type = 'input_request'
              AND s.status = ?2
              AND (
                t.meta_json IS NULL
                OR json_valid(t.meta_json) = 0
                OR json_extract(t.meta_json, '$.resolved') IS NULL
                OR json_extract(t.meta_json, '$.resolved') = 0
              )
            ORDER BY t.created_at DESC
            LIMIT 1
            "#,
        )
        .bind(execution.id)
        .bind(WorkflowStepStatus::WaitingInput)
        .fetch_optional(pool)
        .await?;

        if input_id.is_some() {
            return Ok(input_id);
        }
    }

    Ok(None)
}

async fn find_pending_workflow_review_id(
    pool: &SqlitePool,
    executions: &[WorkflowExecution],
) -> Result<Option<Uuid>, sqlx::Error> {
    for execution in executions {
        if !execution_accepts_live_step_sidebar_state(&execution.status) {
            continue;
        }

        let review_id = sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT t.id
            FROM chat_workflow_transcripts t
            WHERE t.execution_id = ?1
              AND t.entry_type IN ('step_review', 'loop_review', 'final_review')
              AND (
                t.meta_json IS NULL
                OR json_valid(t.meta_json) = 0
                OR json_extract(t.meta_json, '$.resolved') IS NULL
                OR json_extract(t.meta_json, '$.resolved') = 0
              )
            ORDER BY t.created_at DESC
            LIMIT 1
            "#,
        )
        .bind(execution.id)
        .fetch_optional(pool)
        .await?;

        if review_id.is_some() {
            return Ok(review_id);
        }
    }

    Ok(None)
}

pub async fn get_workflow_status(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<WorkflowSessionStatusResponse>>, ApiError> {
    let executions =
        WorkflowExecution::find_generation_blocking_by_session(&deployment.db().pool, session.id)
            .await?;
    let pending_workflow_input_id =
        find_pending_workflow_input_id(&deployment.db().pool, &executions)
            .await?
            .map(|id| id.to_string());
    let pending_workflow_review_id =
        find_pending_workflow_review_id(&deployment.db().pool, &executions)
            .await?
            .map(|id| id.to_string());
    let sidebar_workflow_state = derive_sidebar_workflow_state(
        &deployment.db().pool,
        &executions,
        pending_workflow_input_id.as_deref(),
        pending_workflow_review_id.as_deref(),
    )
    .await?;
    let has_running_workflow = is_sidebar_running_workflow_state(sidebar_workflow_state);

    Ok(ResponseJson(ApiResponse::success(
        WorkflowSessionStatusResponse {
            sidebar_workflow_state,
            has_running_workflow,
            pending_workflow_input_id,
            pending_workflow_review_id,
        },
    )))
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

    let agents = load_effective_agents_for_route(pool, session.id, &session_agents).await?;

    let (lead_agent, lead_session_agent) = resolve_lead_agent(&session, &session_agents, &agents)
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    let available_agents = session_agents
        .iter()
        .map(|session_agent| WorkflowCardAgent {
            session_agent_id: session_agent.id.to_string(),
            workflow_agent_session_id: None,
            agent_id: workflow_plan_agent_id(session_agent),
            name: session_agent.member_name.clone(),
        })
        .collect::<Vec<_>>();

    let ui_config = config::load_config_from_file(&config_path()).await;
    let response_language_instruction =
        resolve_workflow_response_language_instruction(&ui_config.language);
    let prompt = build_plan_generation_prompt(
        &user_goal,
        &workflow_plan_agent_id(lead_session_agent),
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
    let valid_agent_ids = workflow_valid_agent_ids(&session_agents);
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

    let agent_id_map = workflow_agent_id_map(&session_agents);
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
        WorkflowExecutionStatus::Completed | WorkflowExecutionStatus::Failed => {
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

pub async fn stop_execution(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, execution_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    let execution = WorkflowExecution::find_by_id(&deployment.db().pool, execution_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Execution not found.".to_string()))?;
    if execution.session_id != session.id {
        return Err(ApiError::BadRequest(
            "Execution not found in this session.".to_string(),
        ));
    }
    let stopped = WorkflowOrchestrator::stop_execution(
        deployment.chat_runner(),
        &deployment.db().pool,
        execution_id,
    )
    .await
    .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<serde_json::Value>::success(
            serde_json::json!({
                "status": db::models::workflow_types::to_workflow_wire_value(&stopped.status)
            }),
        )),
    )
        .into_response())
}

pub async fn mark_execution_completed(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, execution_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    let execution = WorkflowExecution::find_by_id(&deployment.db().pool, execution_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Execution not found.".to_string()))?;
    if execution.session_id != session.id {
        return Err(ApiError::BadRequest(
            "Execution not found in this session.".to_string(),
        ));
    }

    let completed = WorkflowOrchestrator::mark_execution_completed(
        deployment.chat_runner(),
        &deployment.db().pool,
        execution_id,
    )
    .await
    .map_err(|error| ApiError::BadRequest(error.to_string()))?;

    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<serde_json::Value>::success(
            serde_json::json!({
                "status": db::models::workflow_types::to_workflow_wire_value(&completed.status)
            }),
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

pub async fn get_step_token_usage(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, step_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<WorkflowStepTokenUsageResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let (_step, _execution) = load_step_for_session(pool, &session, step_id).await?;
    let project_id = session.project_id.ok_or_else(|| {
        ApiError::BadRequest("Session is not associated with a project.".to_string())
    })?;
    let usage = TokenCostStatsService::new()
        .workflow_step_token_usage(pool, project_id, &step_id.to_string())
        .await?
        .map(WorkflowStepTokenEntry::from);

    Ok(ResponseJson(ApiResponse::success(
        WorkflowStepTokenUsageResponse { usage },
    )))
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

pub async fn skip_step(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, step_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    let pool = &deployment.db().pool;
    let (_step, _execution) = load_step_for_session(pool, &session, step_id).await?;

    let (execution, step) =
        WorkflowOrchestrator::skip_step(pool, deployment.chat_runner(), step_id)
            .await
            .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    let deployment_clone = deployment.clone();
    tokio::spawn(async move {
        if let Err(err) = WorkflowOrchestrator::wake_scheduler(
            deployment_clone.db(),
            deployment_clone.chat_runner(),
            execution.id,
        )
        .await
        {
            tracing::error!(execution_id = %execution.id, step_id = %step_id, error = %err, "workflow scheduler failed after skipping step");
        }
    });

    Ok((
        StatusCode::OK,
        ResponseJson(ApiResponse::<StepActionResponse>::success(
            StepActionResponse {
                status: to_workflow_wire_value(&step.status),
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
    pub entry_type: Option<String>,
    pub unresolved: Option<bool>,
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
        || query.workflow_agent_session_id.is_some()
        || query.entry_type.is_some()
        || query.unresolved.is_some();

    let transcripts = if has_filter {
        WorkflowTranscript::find_by_execution_filtered(
            pool,
            execution_id,
            query.step_id,
            query.step_key.as_deref(),
            query.workflow_agent_session_id,
            query.entry_type.as_deref(),
            query.unresolved,
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
    let agents = load_effective_agents_for_route(pool, session.id, &session_agents).await?;
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

async fn load_effective_agents_for_route(
    pool: &sqlx::SqlitePool,
    _session_id: Uuid,
    session_agents: &[ChatSessionAgent],
) -> Result<Vec<ChatAgent>, ApiError> {
    let mut agents = Vec::with_capacity(session_agents.len());
    for sa in session_agents {
        let mut agent = ChatAgent::find_by_id(pool, sa.agent_id)
            .await?
            .ok_or_else(|| {
                ApiError::BadRequest("Session agent is missing its agent record.".to_string())
            })?;
        agent.name = sa.member_name.clone();
        agents.push(agent);
    }
    Ok(agents)
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Method, Request},
    };
    use db::{
        DBService,
        models::{
            chat_message::{ChatSenderType, CreateChatMessage},
            chat_session::CreateChatSession,
            workflow_execution::CreateWorkflowExecution,
            workflow_round::{CreateWorkflowRound, WorkflowRound},
            workflow_step::{CreateWorkflowStep, WorkflowStep},
            workflow_types::WorkflowStepType,
        },
    };
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::*;
    use crate::routes::chat::messages::{
        build_execution_workflow_card_projection,
        build_execution_workflow_card_projection_lightweight,
    };

    async fn setup_workflow_route_app() -> (Router, SqlitePool) {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::migrate!("../db/migrations")
            .run(&pool)
            .await
            .expect("run migrations");
        let deployment =
            local_deployment::LocalDeployment::new_for_test_pool(DBService { pool: pool.clone() })
                .await
                .expect("create test deployment");
        let app = Router::new()
            .nest("/api", crate::routes::chat::router(&deployment))
            .with_state(deployment);
        (app, pool)
    }

    async fn create_test_session(pool: &SqlitePool, title: &str) -> ChatSession {
        ChatSession::create(
            pool,
            &CreateChatSession {
                title: Some(title.to_string()),
                workspace_path: None,
                project_id: None,
                worktree_mode: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat session")
    }

    async fn seed_running_execution(pool: &SqlitePool, session: &ChatSession) -> WorkflowExecution {
        let card = ChatMessage::create(
            pool,
            &CreateChatMessage {
                session_id: session.id,
                sender_type: ChatSenderType::System,
                sender_id: None,
                content: "Workflow".to_string(),
                mentions: Vec::new(),
                meta: json!({ "card_type": "workflow_execution" }),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow card");
        let plan_json = json!({
            "version": "1",
            "title": "Stop route",
            "goal": "Verify stop route",
            "agents": { "lead": "lead", "available": [] },
            "nodes": [],
            "edges": []
        })
        .to_string();
        let plan = WorkflowPlan::create(
            pool,
            &CreateWorkflowPlan {
                session_id: session.id,
                source_message_id: None,
                created_by_session_agent_id: None,
                title: "Stop route".to_string(),
                summary_text: Some("Verify stop route".to_string()),
                plan_json: plan_json.clone(),
                plan_schema_version: 1,
                plan_hash: "stop-route-plan".to_string(),
                validation_status: WorkflowValidationStatus::Valid,
                validation_errors_json: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow plan");
        let plan = WorkflowPlan::update_workflow_card_message_id(pool, plan.id, card.id)
            .await
            .expect("attach card to plan");
        let revision = WorkflowPlanRevision::create(
            pool,
            &CreateWorkflowPlanRevision {
                plan_id: plan.id,
                revision_no: 1,
                edited_by: WorkflowRevisionEditor::System,
                editor_session_agent_id: None,
                reason: Some("route-test".to_string()),
                plan_json,
                plan_hash: "stop-route-plan".to_string(),
                validation_status: WorkflowValidationStatus::Valid,
                validation_errors_json: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow revision");
        let execution = WorkflowExecution::create(
            pool,
            &CreateWorkflowExecution {
                session_id: session.id,
                plan_id: plan.id,
                active_revision_id: Some(revision.id),
                lead_session_agent_id: None,
                title: "Stop route".to_string(),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow execution");
        let execution =
            WorkflowExecution::update_workflow_card_message_id(pool, execution.id, card.id)
                .await
                .expect("attach card to execution");
        WorkflowExecution::update_status(pool, execution.id, WorkflowExecutionStatus::Running)
            .await
            .expect("mark execution running")
    }

    async fn post_without_body(app: &Router, uri: String) -> (StatusCode, Value) {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(uri)
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("execute request");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response");
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).expect("parse JSON response")
        };
        (status, body)
    }

    async fn seed_step_with_status(
        pool: &SqlitePool,
        execution: &WorkflowExecution,
        status: WorkflowStepStatus,
    ) -> WorkflowStep {
        let round = WorkflowRound::create(
            pool,
            &CreateWorkflowRound {
                execution_id: execution.id,
                round_index: 1,
                source_revision_id: execution.active_revision_id,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow round");
        WorkflowExecution::update_active_round(pool, execution.id, round.id, 1)
            .await
            .expect("attach active round");
        let step = WorkflowStep::create(
            pool,
            &CreateWorkflowStep {
                execution_id: execution.id,
                round_id: round.id,
                compiled_revision_id: execution.active_revision_id,
                step_key: format!("{}-step", to_workflow_wire_value(&status)),
                step_type: WorkflowStepType::Task,
                title: format!("{status:?} step"),
                instructions: "Exercise skip route status validation".to_string(),
                assigned_workflow_agent_session_id: None,
                max_retry: 1,
                round_index: 1,
                display_order: 0,
                loop_id: None,
                lead_review_required: Some(false),
                user_review_required: Some(false),
                revision_context: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow step");
        let step = WorkflowStep::update_status(pool, step.id, status)
            .await
            .expect("set workflow step status");
        WorkflowExecution::update_status(pool, execution.id, WorkflowExecutionStatus::Paused)
            .await
            .expect("pause failed execution");
        step
    }

    #[tokio::test]
    async fn workflow_stop_execution_route_enforces_owner_terminal_state_and_resume_guard() {
        let (app, pool) = setup_workflow_route_app().await;
        let owner = create_test_session(&pool, "owner").await;
        let other = create_test_session(&pool, "other").await;
        let execution = seed_running_execution(&pool, &owner).await;

        let (cross_status, _) = post_without_body(
            &app,
            format!(
                "/api/chat/sessions/{}/workflow/executions/{}/stop",
                other.id, execution.id
            ),
        )
        .await;
        assert_eq!(cross_status, StatusCode::BAD_REQUEST);

        let (stop_status, stop_body) = post_without_body(
            &app,
            format!(
                "/api/chat/sessions/{}/workflow/executions/{}/stop",
                owner.id, execution.id
            ),
        )
        .await;
        assert_eq!(stop_status, StatusCode::OK, "{stop_body}");
        assert_eq!(stop_body["success"], true);
        assert_eq!(stop_body["data"]["status"], "failed");

        let card = ChatMessage::find_by_id(
            &pool,
            execution
                .workflow_card_message_id
                .expect("execution has workflow card"),
        )
        .await
        .expect("load workflow card")
        .expect("workflow card exists");
        let full = build_execution_workflow_card_projection(&pool, &card)
            .await
            .expect("rebuild full projection after stop");
        let lightweight = build_execution_workflow_card_projection_lightweight(&pool, &card)
            .await
            .expect("rebuild lightweight projection after stop");
        for projection in [full, lightweight] {
            assert!(projection.stopped_by_user);
            assert_eq!(projection.error_message, None);
            let json = serde_json::to_string(&projection).expect("serialize projection");
            assert!(!json.contains("\"error_message\":\"stopped_by_user\""));
        }

        let (resume_status, resume_body) = post_without_body(
            &app,
            format!(
                "/api/chat/sessions/{}/workflow/executions/{}/resume",
                owner.id, execution.id
            ),
        )
        .await;
        assert_eq!(resume_status, StatusCode::BAD_REQUEST);
        assert!(
            resume_body
                .to_string()
                .contains("workflow stopped by user cannot be resumed")
        );
    }

    #[tokio::test]
    async fn workflow_mark_completed_route_enforces_owner_and_is_idempotent() {
        let (app, pool) = setup_workflow_route_app().await;
        let owner = create_test_session(&pool, "owner").await;
        let other = create_test_session(&pool, "other").await;
        let execution = seed_running_execution(&pool, &owner).await;

        let (running_status, running_body) = post_without_body(
            &app,
            format!(
                "/api/chat/sessions/{}/workflow/executions/{}/complete",
                owner.id, execution.id
            ),
        )
        .await;
        assert_eq!(running_status, StatusCode::BAD_REQUEST);
        assert!(
            running_body
                .to_string()
                .contains("expected failed or paused")
        );

        let (cross_status, _) = post_without_body(
            &app,
            format!(
                "/api/chat/sessions/{}/workflow/executions/{}/complete",
                other.id, execution.id
            ),
        )
        .await;
        assert_eq!(cross_status, StatusCode::BAD_REQUEST);

        WorkflowExecution::update_status(&pool, execution.id, WorkflowExecutionStatus::Failed)
            .await
            .expect("fail execution before manual completion");

        for _ in 0..2 {
            let (complete_status, complete_body) = post_without_body(
                &app,
                format!(
                    "/api/chat/sessions/{}/workflow/executions/{}/complete",
                    owner.id, execution.id
                ),
            )
            .await;
            assert_eq!(complete_status, StatusCode::OK, "{complete_body}");
            assert_eq!(complete_body["success"], true);
            assert_eq!(complete_body["data"]["status"], "completed");
        }

        let completed = WorkflowExecution::find_by_id(&pool, execution.id)
            .await
            .expect("load execution")
            .expect("execution exists");
        assert_eq!(completed.status, WorkflowExecutionStatus::Completed);
        assert!(completed.completed_at.is_some());
    }

    #[tokio::test]
    async fn workflow_skip_step_route_accepts_supported_states_owned_by_session() {
        let (app, pool) = setup_workflow_route_app().await;
        let owner = create_test_session(&pool, "owner").await;
        let other = create_test_session(&pool, "other").await;
        let execution = seed_running_execution(&pool, &owner).await;
        let step = seed_step_with_status(&pool, &execution, WorkflowStepStatus::Failed).await;

        let (cross_status, _) = post_without_body(
            &app,
            format!(
                "/api/chat/sessions/{}/workflow-steps/{}/skip",
                other.id, step.id
            ),
        )
        .await;
        assert_eq!(cross_status, StatusCode::BAD_REQUEST);

        let (skip_status, skip_body) = post_without_body(
            &app,
            format!(
                "/api/chat/sessions/{}/workflow-steps/{}/skip",
                owner.id, step.id
            ),
        )
        .await;
        assert_eq!(skip_status, StatusCode::OK, "{skip_body}");
        assert_eq!(skip_body["success"], true);
        assert_eq!(skip_body["data"]["status"], "skipped");

        let skipped = WorkflowStep::find_by_id(&pool, step.id)
            .await
            .expect("load skipped step")
            .expect("skipped step exists");
        assert_eq!(skipped.status, WorkflowStepStatus::Skipped);

        for supported_status in [WorkflowStepStatus::Interrupted, WorkflowStepStatus::Blocked] {
            let execution = seed_running_execution(&pool, &owner).await;
            let step = seed_step_with_status(&pool, &execution, supported_status.clone()).await;
            let (skip_status, skip_body) = post_without_body(
                &app,
                format!(
                    "/api/chat/sessions/{}/workflow-steps/{}/skip",
                    owner.id, step.id
                ),
            )
            .await;
            assert_eq!(
                skip_status,
                StatusCode::OK,
                "{supported_status:?}: {skip_body}"
            );
            assert_eq!(skip_body["success"], true);
            assert_eq!(skip_body["data"]["status"], "skipped");

            let skipped = WorkflowStep::find_by_id(&pool, step.id)
                .await
                .expect("load skipped step")
                .expect("skipped step exists");
            assert_eq!(skipped.status, WorkflowStepStatus::Skipped);
        }

        let (repeat_status, repeat_body) = post_without_body(
            &app,
            format!(
                "/api/chat/sessions/{}/workflow-steps/{}/skip",
                owner.id, step.id
            ),
        )
        .await;
        assert_eq!(repeat_status, StatusCode::BAD_REQUEST);
        assert!(
            repeat_body
                .to_string()
                .contains("only interrupted, blocked, or failed steps can be skipped")
        );

        let execution = seed_running_execution(&pool, &owner).await;
        let running_step =
            seed_step_with_status(&pool, &execution, WorkflowStepStatus::Running).await;
        let (running_status, running_body) = post_without_body(
            &app,
            format!(
                "/api/chat/sessions/{}/workflow-steps/{}/skip",
                owner.id, running_step.id
            ),
        )
        .await;
        assert_eq!(running_status, StatusCode::BAD_REQUEST);
        assert!(
            running_body
                .to_string()
                .contains("only interrupted, blocked, or failed steps can be skipped")
        );
    }

    #[test]
    fn sidebar_running_workflow_state_only_counts_active_states() {
        for state in [
            WorkflowSidebarState::Running,
            WorkflowSidebarState::Reviewing,
            WorkflowSidebarState::Waiting,
        ] {
            assert!(is_sidebar_running_workflow_state(state));
        }

        for state in [
            WorkflowSidebarState::Idle,
            WorkflowSidebarState::WaitingInput,
            WorkflowSidebarState::WaitingUserReview,
            WorkflowSidebarState::Paused,
            WorkflowSidebarState::Failed,
        ] {
            assert!(!is_sidebar_running_workflow_state(state));
        }
    }

    #[test]
    fn only_live_executions_accept_live_step_sidebar_state() {
        for status in [
            WorkflowExecutionStatus::Pending,
            WorkflowExecutionStatus::Running,
            WorkflowExecutionStatus::Recompiling,
            WorkflowExecutionStatus::Waiting,
        ] {
            assert!(execution_accepts_live_step_sidebar_state(&status));
            assert!(execution_may_have_sidebar_relevant_steps(&status));
        }

        assert!(execution_may_have_sidebar_relevant_steps(
            &WorkflowExecutionStatus::Paused
        ));

        for status in [
            WorkflowExecutionStatus::Failed,
            WorkflowExecutionStatus::Completed,
        ] {
            assert!(!execution_accepts_live_step_sidebar_state(&status));
            assert!(!execution_may_have_sidebar_relevant_steps(&status));
        }

        assert!(!execution_accepts_live_step_sidebar_state(
            &WorkflowExecutionStatus::Paused
        ));
    }

    #[test]
    fn passive_execution_steps_cannot_look_running_in_sidebar() {
        for execution_status in [
            WorkflowExecutionStatus::Paused,
            WorkflowExecutionStatus::Failed,
            WorkflowExecutionStatus::Completed,
        ] {
            for step_status in [
                WorkflowStepStatus::WaitingReview,
                WorkflowStepStatus::WaitingInput,
                WorkflowStepStatus::Pending,
                WorkflowStepStatus::Ready,
                WorkflowStepStatus::Running,
                WorkflowStepStatus::Revising,
                WorkflowStepStatus::InterruptRequested,
            ] {
                assert_eq!(
                    step_sidebar_state_for_execution(&execution_status, &step_status),
                    None
                );
            }
        }
    }

    #[test]
    fn paused_failed_step_keeps_sidebar_error_attention() {
        assert_eq!(
            step_sidebar_state_for_execution(
                &WorkflowExecutionStatus::Paused,
                &WorkflowStepStatus::Failed
            ),
            Some(WorkflowSidebarState::Failed)
        );
    }

    #[test]
    fn live_execution_steps_refine_sidebar_state() {
        assert_eq!(
            step_sidebar_state_for_execution(
                &WorkflowExecutionStatus::Running,
                &WorkflowStepStatus::WaitingReview
            ),
            Some(WorkflowSidebarState::Reviewing)
        );
        assert_eq!(
            step_sidebar_state_for_execution(
                &WorkflowExecutionStatus::Running,
                &WorkflowStepStatus::WaitingInput
            ),
            Some(WorkflowSidebarState::Waiting)
        );
        assert_eq!(
            step_sidebar_state_for_execution(
                &WorkflowExecutionStatus::Running,
                &WorkflowStepStatus::Running
            ),
            Some(WorkflowSidebarState::Running)
        );
    }
}
