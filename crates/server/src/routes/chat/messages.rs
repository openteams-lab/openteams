use std::path::{Component, PathBuf};

use axum::{
    Extension, Json,
    extract::{Multipart, Path, Query, State},
    http::{StatusCode, header},
    response::{Json as ResponseJson, Response},
};
use db::models::{
    chat_agent::ChatAgent,
    chat_message::{ChatMessage, ChatSenderType},
    chat_session::ChatSession,
    chat_session_agent::ChatSessionAgent,
    workflow_agent_session::WorkflowAgentSession,
    workflow_execution::WorkflowExecution,
    workflow_plan::WorkflowPlan,
    workflow_plan_revision::WorkflowPlanRevision,
    workflow_step::WorkflowStep,
    workflow_step_edge::WorkflowStepEdge,
    workflow_types::WorkflowPlanJson,
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::{
    chat::{ChatAttachmentMeta, emit_user_message_workflow_analytics},
    workflow::{
        workflow_analytics,
        workflow_orchestrator::WorkflowOrchestrator,
        workflow_runtime::{
            WorkflowCardProjection, WorkflowCardState, WorkflowCardStep,
            build_workflow_card_projection, build_workflow_card_projection_lightweight,
        },
    },
};
use tokio::{fs, fs::File};
use tokio_util::io::ReaderStream;
use ts_rs::TS;
use utils::{assets::asset_dir, response::ApiResponse};
use uuid::Uuid;

use super::runtime::{ChatSessionRuntimeSnapshot, build_session_runtime_snapshot};
use crate::{DeploymentImpl, error::ApiError};

const ALLOWED_TEXT_EXTENSIONS: &[&str] = &[
    ".txt", ".csv", ".md", ".json", ".xml", ".yaml", ".yml", ".html", ".htm", ".css", ".js", ".ts",
    ".jsx", ".tsx", ".py", ".java", ".c", ".cpp", ".h", ".hpp", ".rb", ".php", ".go", ".rs",
    ".sql", ".sh", ".bash", ".svg",
];

const ALLOWED_IMAGE_EXTENSIONS: &[&str] =
    &[".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];

#[derive(Debug, Deserialize, TS)]
pub struct ChatMessageListQuery {
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateChatMessageRequest {
    pub sender_type: ChatSenderType,
    pub sender_id: Option<Uuid>,
    pub content: String,
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CreateChatMessageResponse {
    pub message: ChatMessage,
    pub runtime: ChatSessionRuntimeSnapshot,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct DeleteMessagesRequest {
    pub message_ids: Vec<Uuid>,
}

fn sanitize_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .collect();
    if sanitized.is_empty() {
        "file".to_string()
    } else {
        sanitized.chars().take(120).collect()
    }
}

fn attachment_kind(mime: Option<&str>) -> String {
    if let Some(mime) = mime
        && mime.starts_with("image/")
    {
        return "image".to_string();
    }
    "file".to_string()
}

fn is_allowed_attachment(filename: &str, mime: Option<&str>) -> bool {
    if let Some(mime) = mime
        && (mime.starts_with("text/") || mime.starts_with("image/"))
    {
        return true;
    }
    let lower = filename.to_ascii_lowercase();
    ALLOWED_TEXT_EXTENSIONS
        .iter()
        .chain(ALLOWED_IMAGE_EXTENSIONS.iter())
        .any(|ext| lower.ends_with(ext))
}

fn attachment_storage_dir(session_id: Uuid, message_id: Uuid) -> PathBuf {
    asset_dir()
        .join("chat")
        .join(format!("session_{session_id}"))
        .join("attachments")
        .join(message_id.to_string())
}

fn resolve_relative_path(relative_path: &str) -> Option<PathBuf> {
    let rel = PathBuf::from(relative_path);
    if rel.is_absolute() {
        return None;
    }
    if rel
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return None;
    }
    Some(asset_dir().join(rel))
}

fn normalize_chat_input_mode(value: &str) -> Option<&'static str> {
    if value.trim() == "workflow" {
        Some("workflow")
    } else {
        None
    }
}

pub async fn get_messages(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ChatMessageListQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatMessage>>>, ApiError> {
    let mut messages =
        ChatMessage::find_by_session_id_lightweight(&deployment.db().pool, session.id, query.limit)
            .await?
            .into_iter()
            .filter(services::services::chat::should_include_message_in_history)
            .collect::<Vec<_>>();
    for message in &mut messages {
        inject_workflow_card_summary_into_message_meta(&mut message.meta.0);
    }
    Ok(ResponseJson(ApiResponse::success(messages)))
}

fn inject_workflow_card_summary_into_message_meta(meta: &mut serde_json::Value) {
    let Some(meta_obj) = meta.as_object_mut() else {
        return;
    };
    let is_workflow_card = meta_obj
        .get("card_type")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|ct| ct == "workflow_execution" || ct == "workflow_plan_generation");
    if !is_workflow_card {
        return;
    }
    if meta_obj.contains_key("workflow_card_summary") || meta_obj.contains_key("workflow_card") {
        return;
    }
    meta_obj.insert(
        "workflow_card_summary".to_string(),
        serde_json::json!({
            "is_terminal": false,
            "has_transcripts": null,
        }),
    );
}

pub async fn create_message(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateChatMessageRequest>,
) -> Result<ResponseJson<ApiResponse<CreateChatMessageResponse>>, ApiError> {
    let message = services::services::chat::create_message(
        &deployment.db().pool,
        session.id,
        payload.sender_type,
        payload.sender_id,
        payload.content,
        payload.meta,
    )
    .await?;

    emit_user_message_workflow_analytics(
        workflow_analytics::analytics_if_enabled(
            deployment.analytics().as_ref(),
            deployment.analytics_enabled(),
        ),
        session.id,
        Some(deployment.user_id()),
        &message,
    );

    deployment
        .chat_runner()
        .handle_message(&session, &message)
        .await;

    let runtime =
        build_session_runtime_snapshot(&deployment, &session, false, Some(&message)).await?;

    Ok(ResponseJson(ApiResponse::success(
        CreateChatMessageResponse { message, runtime },
    )))
}

pub async fn upload_message_attachments(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    mut multipart: Multipart,
) -> Result<ResponseJson<ApiResponse<CreateChatMessageResponse>>, ApiError> {
    let message_id = Uuid::new_v4();
    let mut app_language: Option<String> = None;
    let mut content: Option<String> = None;
    let mut sender_handle: Option<String> = None;
    let mut reference_message_id: Option<Uuid> = None;
    let mut mentions: Vec<String> = Vec::new();
    let mut chat_input_mode: Option<&'static str> = None;
    let mut attachments: Vec<ChatAttachmentMeta> = Vec::new();

    while let Some(field) = multipart.next_field().await? {
        match field.name() {
            Some("content") => {
                let text = field.text().await?;
                if !text.trim().is_empty() {
                    content = Some(text);
                }
            }
            Some("sender_handle") => {
                let text = field.text().await?;
                if !text.trim().is_empty() {
                    sender_handle = Some(text);
                }
            }
            Some("app_language") => {
                let text = field.text().await?;
                let language = text.trim();
                if !language.is_empty() {
                    app_language = Some(language.to_string());
                }
            }
            Some("reference_message_id") => {
                let text = field.text().await?;
                if let Ok(parsed) = Uuid::parse_str(text.trim()) {
                    reference_message_id = Some(parsed);
                }
            }
            Some("mentions") => {
                let text = field.text().await?;
                if let Ok(parsed) = serde_json::from_str::<Vec<String>>(&text) {
                    mentions.extend(
                        parsed
                            .into_iter()
                            .filter(|mention| !mention.trim().is_empty()),
                    );
                }
            }
            Some("chat_input_mode") => {
                let text = field.text().await?;
                chat_input_mode = normalize_chat_input_mode(&text);
            }
            _ => {
                let filename = field.file_name().map(|name| name.to_string());
                let mime_type = field.content_type().map(|value| value.to_string());
                let Some(filename) = filename else {
                    continue;
                };
                if !is_allowed_attachment(&filename, mime_type.as_deref()) {
                    return Err(ApiError::BadRequest(
                        "Only text files and images are allowed.".to_string(),
                    ));
                }
                let data = field.bytes().await?;
                if data.is_empty() {
                    continue;
                }

                let attachment_id = Uuid::new_v4();
                let original_name = filename.to_string();
                let sanitized = sanitize_filename(&filename);
                let stored_name = format!("{attachment_id}_{sanitized}");
                let storage_dir = attachment_storage_dir(session.id, message_id);
                fs::create_dir_all(&storage_dir).await?;
                let storage_path = storage_dir.join(&stored_name);
                fs::write(&storage_path, &data).await?;

                let kind = attachment_kind(mime_type.as_deref());
                let relative_path = format!(
                    "chat/session_{}/attachments/{}/{}",
                    session.id, message_id, stored_name
                );

                attachments.push(ChatAttachmentMeta {
                    id: attachment_id,
                    name: original_name,
                    mime_type,
                    size_bytes: data.len() as i64,
                    kind,
                    relative_path,
                });
            }
        }
    }

    if attachments.is_empty() {
        return Err(ApiError::BadRequest(
            "No attachments were uploaded.".to_string(),
        ));
    }

    let fallback_content = if attachments.len() == 1 {
        format!("Uploaded {}", attachments[0].name)
    } else {
        format!("Uploaded {} files", attachments.len())
    };
    let content = content.unwrap_or(fallback_content);

    let mut meta = serde_json::json!({ "attachments": attachments });
    if let Some(language) = app_language {
        meta["app_language"] = serde_json::json!(language);
    }
    if let Some(handle) = sender_handle {
        meta["sender_handle"] = serde_json::json!(handle);
    }
    if let Some(reference_id) = reference_message_id {
        meta["reference"] = serde_json::json!({ "message_id": reference_id });
    }
    if !mentions.is_empty() {
        meta["mentions"] = serde_json::json!(mentions);
    }
    if let Some(mode) = chat_input_mode {
        meta["chat_input_mode"] = serde_json::json!(mode);
    }

    let message = services::services::chat::create_message_with_id(
        &deployment.db().pool,
        session.id,
        ChatSenderType::User,
        None,
        content,
        Some(meta),
        message_id,
    )
    .await?;

    emit_user_message_workflow_analytics(
        workflow_analytics::analytics_if_enabled(
            deployment.analytics().as_ref(),
            deployment.analytics_enabled(),
        ),
        session.id,
        Some(deployment.user_id()),
        &message,
    );

    deployment
        .chat_runner()
        .handle_message(&session, &message)
        .await;

    let runtime =
        build_session_runtime_snapshot(&deployment, &session, false, Some(&message)).await?;

    Ok(ResponseJson(ApiResponse::success(
        CreateChatMessageResponse { message, runtime },
    )))
}

pub async fn serve_message_attachment(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Path((_session_id, message_id, attachment_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    let message = ChatMessage::find_by_id(&deployment.db().pool, message_id)
        .await?
        .ok_or(ApiError::Database(sqlx::Error::RowNotFound))?;

    if message.session_id != session.id {
        return Err(ApiError::Database(sqlx::Error::RowNotFound));
    }

    let attachments = services::services::chat::extract_attachments(&message.meta.0);
    let attachment = attachments
        .into_iter()
        .find(|item| item.id == attachment_id)
        .ok_or_else(|| ApiError::BadRequest("Attachment not found".to_string()))?;

    let Some(path) = resolve_relative_path(&attachment.relative_path) else {
        return Err(ApiError::BadRequest("Invalid attachment path".to_string()));
    };

    let file = File::open(&path).await?;
    let metadata = file.metadata().await?;
    let stream = ReaderStream::new(file);
    let body = axum::body::Body::from_stream(stream);

    let content_type = attachment
        .mime_type
        .as_deref()
        .unwrap_or("application/octet-stream");

    let header_name = sanitize_filename(&attachment.name);
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, metadata.len())
        .header(
            header::CONTENT_DISPOSITION,
            format!("inline; filename=\"{}\"", header_name),
        )
        .body(body)
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    Ok(response)
}

pub async fn get_message(
    State(deployment): State<DeploymentImpl>,
    Path(message_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<ChatMessage>>, ApiError> {
    let message = ChatMessage::find_by_id(&deployment.db().pool, message_id)
        .await?
        .ok_or(ApiError::Database(sqlx::Error::RowNotFound))?;
    Ok(ResponseJson(ApiResponse::success(message)))
}

#[derive(Debug, Deserialize, TS)]
pub struct WorkflowCardQuery {
    pub detail: Option<String>,
}

pub async fn get_workflow_card(
    State(deployment): State<DeploymentImpl>,
    Path(message_id): Path<Uuid>,
    Query(query): Query<WorkflowCardQuery>,
) -> Result<ResponseJson<ApiResponse<WorkflowCardProjection>>, ApiError> {
    let pool = &deployment.db().pool;
    let message = ChatMessage::find_by_id(pool, message_id)
        .await?
        .ok_or(ApiError::Database(sqlx::Error::RowNotFound))?;

    let card_type = message
        .meta
        .0
        .get("card_type")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| ApiError::BadRequest("Workflow card metadata is missing.".to_string()))?;

    let is_lightweight = query.detail.as_deref() != Some("full");

    let projection = match card_type {
        "workflow_execution" => {
            if is_lightweight {
                build_execution_workflow_card_projection_lightweight(pool, &message).await?
            } else {
                build_execution_workflow_card_projection(pool, &message).await?
            }
        }
        "workflow_plan" => build_plan_workflow_card_projection(pool, &message).await?,
        "workflow_plan_generation" => {
            serde_json::from_value(message.meta.0.get("workflow_card").cloned().ok_or_else(
                || {
                    ApiError::BadRequest(
                        "Workflow plan generation metadata is missing.".to_string(),
                    )
                },
            )?)
            .map_err(|err| ApiError::BadRequest(err.to_string()))?
        }
        _ => {
            return Err(ApiError::BadRequest(
                "Message is not a workflow card.".to_string(),
            ));
        }
    };

    Ok(ResponseJson(ApiResponse::success(projection)))
}

pub(super) async fn build_execution_workflow_card_projection(
    pool: &sqlx::SqlitePool,
    message: &ChatMessage,
) -> Result<WorkflowCardProjection, ApiError> {
    let execution = WorkflowExecution::find_by_session(pool, message.session_id)
        .await?
        .into_iter()
        .find(|item| item.workflow_card_message_id == Some(message.id))
        .ok_or_else(|| ApiError::BadRequest("Workflow execution was not found.".to_string()))?;
    let plan = WorkflowPlan::find_by_id(pool, execution.plan_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow plan was not found.".to_string()))?;
    let revision_id = execution.active_revision_id.ok_or_else(|| {
        ApiError::BadRequest("Workflow execution revision is missing.".to_string())
    })?;
    let revision = WorkflowPlanRevision::find_by_id(pool, revision_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow revision was not found.".to_string()))?;
    let revisions = WorkflowPlanRevision::find_by_plan(pool, plan.id).await?;
    let session_agents = ChatSessionAgent::find_all_for_session(pool, message.session_id).await?;
    let agents = load_effective_agents_for_route(pool, message.session_id, &session_agents).await?;
    let workflow_sessions = WorkflowAgentSession::find_by_execution(pool, execution.id).await?;
    let steps = WorkflowStep::find_by_execution(pool, execution.id).await?;
    let edges = WorkflowStepEdge::find_by_execution(pool, execution.id).await?;
    let rounds =
        db::models::workflow_round::WorkflowRound::find_by_execution(pool, execution.id).await?;
    let loops =
        db::models::workflow_loop::WorkflowLoop::find_by_execution(pool, execution.id).await?;
    let iteration_feedbacks =
        db::models::workflow_iteration_feedback::WorkflowIterationFeedback::find_by_execution(
            pool,
            execution.id,
        )
        .await?;
    let step_reviews =
        db::models::workflow_step_review::WorkflowStepReview::find_by_execution(pool, execution.id)
            .await?;
    let transcripts =
        db::models::workflow_transcript::WorkflowTranscript::find_by_execution(pool, execution.id)
            .await?;
    let stopped_by_user = WorkflowOrchestrator::execution_was_stopped_by_user(pool, execution.id)
        .await
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;

    build_workflow_card_projection(
        &execution,
        &plan,
        &revision,
        &revisions,
        &steps,
        &edges,
        &rounds,
        &loops,
        &iteration_feedbacks,
        &step_reviews,
        &transcripts,
        &workflow_sessions,
        &session_agents,
        &agents,
        stopped_by_user,
        None,
    )
    .map_err(|err| ApiError::BadRequest(err.to_string()))
}

pub(super) async fn build_execution_workflow_card_projection_lightweight(
    pool: &sqlx::SqlitePool,
    message: &ChatMessage,
) -> Result<WorkflowCardProjection, ApiError> {
    let execution = WorkflowExecution::find_by_session(pool, message.session_id)
        .await?
        .into_iter()
        .find(|item| item.workflow_card_message_id == Some(message.id))
        .ok_or_else(|| ApiError::BadRequest("Workflow execution was not found.".to_string()))?;
    let plan = WorkflowPlan::find_by_id(pool, execution.plan_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow plan was not found.".to_string()))?;
    let revision_id = execution.active_revision_id.ok_or_else(|| {
        ApiError::BadRequest("Workflow execution revision is missing.".to_string())
    })?;
    let revision = WorkflowPlanRevision::find_by_id(pool, revision_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow revision was not found.".to_string()))?;
    let revisions = WorkflowPlanRevision::find_by_plan(pool, plan.id).await?;
    let session_agents = ChatSessionAgent::find_all_for_session(pool, message.session_id).await?;
    let agents = load_effective_agents_for_route(pool, message.session_id, &session_agents).await?;
    let workflow_sessions = WorkflowAgentSession::find_by_execution(pool, execution.id).await?;
    let steps = WorkflowStep::find_summary_by_execution(pool, execution.id).await?;
    let edges =
        db::models::workflow_step_edge::WorkflowStepEdge::find_by_execution(pool, execution.id)
            .await?;
    let rounds =
        db::models::workflow_round::WorkflowRound::find_by_execution(pool, execution.id).await?;
    let loops =
        db::models::workflow_loop::WorkflowLoop::find_by_execution(pool, execution.id).await?;
    let iteration_feedbacks =
        db::models::workflow_iteration_feedback::WorkflowIterationFeedback::find_by_execution(
            pool,
            execution.id,
        )
        .await?;
    let step_reviews =
        db::models::workflow_step_review::WorkflowStepReview::find_by_execution(pool, execution.id)
            .await?;
    let transcripts =
        db::models::workflow_transcript::WorkflowTranscript::find_unresolved_reviews_by_execution(
            pool,
            execution.id,
        )
        .await?;
    let transcript_count =
        db::models::workflow_transcript::WorkflowTranscript::count_by_execution(pool, execution.id)
            .await
            .ok();
    let stopped_by_user = WorkflowOrchestrator::execution_was_stopped_by_user(pool, execution.id)
        .await
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;

    build_workflow_card_projection_lightweight(
        &execution,
        &plan,
        &revision,
        &revisions,
        &steps,
        &edges,
        &rounds,
        &loops,
        &iteration_feedbacks,
        &step_reviews,
        &transcripts,
        &workflow_sessions,
        &session_agents,
        &agents,
        transcript_count,
        stopped_by_user,
        None,
    )
    .map_err(|err| ApiError::BadRequest(err.to_string()))
}

async fn build_plan_workflow_card_projection(
    pool: &sqlx::SqlitePool,
    message: &ChatMessage,
) -> Result<WorkflowCardProjection, ApiError> {
    let plan = WorkflowPlan::find_by_session(pool, message.session_id)
        .await?
        .into_iter()
        .find(|item| item.workflow_card_message_id == Some(message.id))
        .ok_or_else(|| ApiError::BadRequest("Workflow plan was not found.".to_string()))?;
    let revision = WorkflowPlanRevision::find_latest_by_plan(pool, plan.id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow revision was not found.".to_string()))?;
    let parsed_plan: WorkflowPlanJson = serde_json::from_str(&revision.plan_json)
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    let session_agents = ChatSessionAgent::find_all_for_session(pool, message.session_id).await?;
    let agents = load_effective_agents_for_route(pool, message.session_id, &session_agents).await?;
    let agent_views = session_agents
        .iter()
        .filter_map(|session_agent| {
            let agent = agents
                .iter()
                .find(|item| item.id == session_agent.agent_id)?;
            Some(
                services::services::workflow::workflow_runtime::WorkflowCardAgent {
                    session_agent_id: session_agent.id.to_string(),
                    workflow_agent_session_id: None,
                    agent_id: agent.id.to_string(),
                    name: agent.name.clone(),
                },
            )
        })
        .collect::<Vec<_>>();
    let agent_name_by_id: std::collections::HashMap<String, String> = agent_views
        .iter()
        .map(|agent| (agent.agent_id.clone(), agent.name.clone()))
        .collect();
    let step_views: Vec<WorkflowCardStep> = parsed_plan
        .nodes
        .iter()
        .map(|node| WorkflowCardStep {
            id: node.id.clone(),
            step_key: node.id.clone(),
            title: node.data.title.clone(),
            step_type: if node.data.step_type.is_empty() {
                "task".to_string()
            } else {
                node.data.step_type.to_lowercase()
            },
            status: "pending".to_string(),
            review_phase: None,
            lead_review_required: true,
            user_review_required: true,
            retry_count: 0,
            max_retry: node.data.max_retry.unwrap_or(1) as i32,
            loop_key: node.data.loop_key.clone(),
            latest_review: None,
            agent_name: node
                .data
                .agent_id
                .as_ref()
                .and_then(|agent_id| agent_name_by_id.get(agent_id).cloned())
                .or_else(|| node.data.agent_id.clone()),
            summary_text: None,
            content: None,
        })
        .collect();

    Ok(WorkflowCardProjection {
        execution_id: None,
        plan_id: plan.id.to_string(),
        revision_id: revision.id.to_string(),
        title: plan.title.clone(),
        goal: plan
            .summary_text
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| plan.title.clone()),
        state: WorkflowCardState::PreviewReady,
        execution_status: "preview".to_string(),
        stopped_by_user: false,
        error_message: None,
        completed_step_count: 0,
        total_step_count: parsed_plan.nodes.len(),
        result_summary: None,
        outputs: Vec::new(),
        agents: agent_views,
        steps: step_views,
        current_round: 0,
        loops: Vec::new(),
        pending_review: None,
        pending_reviews: Vec::new(),
        pending_input: None,
        iteration_history: Vec::new(),
        round_graphs: Vec::new(),
        plan: parsed_plan,
        started_at: None,
        completed_at: None,
        validation_errors: None,
        is_terminal: false,
        has_transcripts: None,
    })
}

async fn load_effective_agents_for_route(
    pool: &sqlx::SqlitePool,
    session_id: Uuid,
    session_agents: &[ChatSessionAgent],
) -> Result<Vec<ChatAgent>, ApiError> {
    let member_names =
        services::services::chat::member_name_overrides_for_session(pool, session_id).await?;
    let mut agents = Vec::with_capacity(session_agents.len());
    for session_agent in session_agents {
        if let Some(mut agent) = ChatAgent::find_by_id(pool, session_agent.agent_id).await? {
            services::services::chat::apply_effective_agent_name(&mut agent, &member_names);
            agents.push(agent);
        }
    }
    Ok(agents)
}

pub async fn delete_message(
    State(deployment): State<DeploymentImpl>,
    Path(message_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let rows_affected = ChatMessage::delete(&deployment.db().pool, message_id).await?;
    if rows_affected == 0 {
        Err(ApiError::Database(sqlx::Error::RowNotFound))
    } else {
        Ok(ResponseJson(ApiResponse::success(())))
    }
}

/// Delete multiple messages at once
pub async fn delete_messages_batch(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<DeleteMessagesRequest>,
) -> Result<ResponseJson<ApiResponse<u64>>, ApiError> {
    if payload.message_ids.is_empty() {
        return Ok(ResponseJson(ApiResponse::success(0)));
    }

    let mut total_deleted: u64 = 0;
    for message_id in payload.message_ids {
        // Verify the message belongs to this session before deleting
        if let Some(message) = ChatMessage::find_by_id(&deployment.db().pool, message_id).await?
            && message.session_id == session.id
        {
            let rows = ChatMessage::delete(&deployment.db().pool, message_id).await?;
            total_deleted += rows;
        }
    }

    Ok(ResponseJson(ApiResponse::success(total_deleted)))
}

pub async fn resend_message(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Path((_session_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let original = ChatMessage::find_by_id(&deployment.db().pool, message_id)
        .await?
        .ok_or(ApiError::Database(sqlx::Error::RowNotFound))?;

    if original.session_id != session.id {
        return Err(ApiError::Database(sqlx::Error::RowNotFound));
    }

    if original.sender_type != ChatSenderType::User {
        return Err(ApiError::BadRequest(
            "Only user messages can be resent.".to_string(),
        ));
    }

    let new_message = services::services::chat::create_message(
        &deployment.db().pool,
        session.id,
        original.sender_type,
        original.sender_id,
        original.content.clone(),
        Some(original.meta.0.clone()),
    )
    .await
    .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    deployment
        .chat_runner()
        .handle_message(&session, &new_message)
        .await;

    Ok(ResponseJson(ApiResponse::success(())))
}

#[cfg(test)]
mod tests {
    use super::{inject_workflow_card_summary_into_message_meta, normalize_chat_input_mode};

    #[test]
    fn normalize_chat_input_mode_accepts_only_workflow() {
        assert_eq!(normalize_chat_input_mode("workflow"), Some("workflow"));
        assert_eq!(normalize_chat_input_mode(" workflow "), Some("workflow"));
        assert_eq!(normalize_chat_input_mode("free"), None);
        assert_eq!(normalize_chat_input_mode(""), None);
    }

    #[test]
    fn inject_summary_adds_placeholder_when_card_already_stripped() {
        let mut meta = serde_json::json!({
            "card_type": "workflow_execution"
        });
        inject_workflow_card_summary_into_message_meta(&mut meta);
        let summary = meta
            .get("workflow_card_summary")
            .expect("summary should exist");
        assert_eq!(summary["is_terminal"], false);
    }

    #[test]
    fn inject_summary_skips_when_summary_already_present() {
        let mut meta = serde_json::json!({
            "card_type": "workflow_execution",
            "workflow_card_summary": {
                "execution_id": "abc",
                "is_terminal": true
            }
        });
        inject_workflow_card_summary_into_message_meta(&mut meta);
        let summary = meta
            .get("workflow_card_summary")
            .expect("summary should exist");
        assert_eq!(summary["execution_id"], "abc");
    }

    #[test]
    fn inject_summary_skips_non_workflow_messages() {
        let mut meta = serde_json::json!({
            "card_type": "other_type",
            "workflow_card": {"some": "data"}
        });
        inject_workflow_card_summary_into_message_meta(&mut meta);
        assert!(
            meta.get("workflow_card").is_some(),
            "non-workflow card should be preserved"
        );
        assert!(meta.get("workflow_card_summary").is_none());
    }
}
