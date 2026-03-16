use std::path::{Component, PathBuf};

use axum::{
    Extension, Json,
    extract::{
        Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::{IntoResponse, Json as ResponseJson},
};
use db::models::{
    analytics::{
        AnalyticsSessionStats, track_session_archive, track_session_create, track_session_delete,
        track_session_restore,
    },
    chat_agent::ChatAgent,
    chat_session::{ChatSession, ChatSessionStatus, CreateChatSession, UpdateChatSession},
    chat_session_agent::{ChatSessionAgent, CreateChatSessionAgent},
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::{assets::asset_dir, response::ApiResponse};
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize, TS)]
pub struct ChatSessionListQuery {
    pub status: Option<ChatSessionStatus>,
}

pub async fn get_sessions(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ChatSessionListQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatSession>>>, ApiError> {
    let sessions = ChatSession::find_all(&deployment.db().pool, query.status).await?;
    Ok(ResponseJson(ApiResponse::success(sessions)))
}

pub async fn get_session(
    Extension(session): Extension<ChatSession>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(session)))
}

pub async fn create_session(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateChatSession>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    let session = ChatSession::create(&deployment.db().pool, &payload, Uuid::new_v4()).await?;

    // Track analytics: session_create
    let title_length = payload.title.as_ref().map(|t| t.len()).unwrap_or(0);
    let _ = track_session_create(&deployment.db().pool, session.id, None, title_length).await;

    // Initialize session stats
    let _ = AnalyticsSessionStats::upsert(&deployment.db().pool, session.id, None).await;

    Ok(ResponseJson(ApiResponse::success(session)))
}

pub async fn update_session(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<UpdateChatSession>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    let updated = ChatSession::update(&deployment.db().pool, session.id, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn delete_session(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    // Check if session had messages before deletion
    let had_messages = AnalyticsSessionStats::find_by_id(&deployment.db().pool, session.id)
        .await
        .ok()
        .flatten()
        .map(|stats| stats.message_count > 0)
        .unwrap_or(false);

    let rows_affected = ChatSession::delete(&deployment.db().pool, session.id).await?;
    if rows_affected == 0 {
        return Err(ApiError::Database(sqlx::Error::RowNotFound));
    }

    // Track analytics: session_delete
    let _ = track_session_delete(&deployment.db().pool, session.id, None, had_messages).await;

    Ok(ResponseJson(ApiResponse::success(())))
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateChatSessionAgentRequest {
    pub agent_id: Uuid,
    pub workspace_path: Option<String>,
    pub allowed_skill_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateChatSessionAgentRequest {
    pub workspace_path: Option<String>,
    pub allowed_skill_ids: Option<Vec<String>>,
}

#[cfg(windows)]
fn is_windows_reserved_name(name: &str) -> bool {
    let upper = name.trim().trim_end_matches('.').to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn validate_workspace_path_legality(trimmed: &str) -> Result<PathBuf, ApiError> {
    let is_absolute = {
        #[cfg(windows)]
        {
            // Windows: C:\, D:\, etc., or UNC paths \\server\share
            // Also allow ~ for home directory (will be expanded later)
            (trimmed.len() >= 2
                && trimmed.chars().nth(1) == Some(':')
                && matches!(trimmed.chars().next(), Some('a'..='z' | 'A'..='Z')))
                || trimmed.starts_with(r"\\")
                || trimmed.starts_with('~')
        }
        #[cfg(not(windows))]
        {
            // Unix/macOS: /path or ~/path
            trimmed.starts_with('/') || trimmed.starts_with('~')
        }
    };

    if !is_absolute {
        return Err(ApiError::BadRequest(
            "Workspace path must be an absolute path.".to_string(),
        ));
    }

    if trimmed.chars().any(|ch| ch == '\0' || ch.is_control()) {
        return Err(ApiError::BadRequest(
            "Workspace path contains invalid characters.".to_string(),
        ));
    }

    let parsed_path = PathBuf::from(trimmed);
    if parsed_path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(ApiError::BadRequest(
            "Workspace path cannot contain '..'.".to_string(),
        ));
    }

    #[cfg(windows)]
    {
        for component in parsed_path.components() {
            if let Component::Normal(value) = component {
                let segment = value.to_string_lossy();
                if segment
                    .chars()
                    .any(|ch| matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
                {
                    return Err(ApiError::BadRequest(
                        "Workspace path contains invalid Windows filename characters.".to_string(),
                    ));
                }

                if is_windows_reserved_name(&segment) {
                    return Err(ApiError::BadRequest(format!(
                        "Workspace path contains reserved Windows name: {segment}"
                    )));
                }
            }
        }
    }

    Ok(parsed_path)
}

async fn normalize_workspace_path(
    workspace_path: Option<String>,
) -> Result<Option<String>, ApiError> {
    let Some(raw_path) = workspace_path else {
        return Ok(None);
    };

    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest(
            "Workspace path is required.".to_string(),
        ));
    }

    let parsed_path = validate_workspace_path_legality(trimmed)?;
    let metadata = tokio::fs::metadata(&parsed_path)
        .await
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => {
                ApiError::BadRequest("Workspace path does not exist.".to_string())
            }
            _ => ApiError::BadRequest(format!("Workspace path is not accessible: {err}")),
        })?;
    if !metadata.is_dir() {
        return Err(ApiError::BadRequest(
            "Workspace path must be an existing directory.".to_string(),
        ));
    }

    Ok(Some(trimmed.to_string()))
}

fn normalize_allowed_skill_ids(allowed_skill_ids: Option<Vec<String>>) -> Vec<String> {
    let mut normalized = allowed_skill_ids
        .unwrap_or_default()
        .into_iter()
        .map(|skill_id| skill_id.trim().to_string())
        .filter(|skill_id| !skill_id.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
}

async fn session_has_duplicate_member_name(
    pool: &sqlx::SqlitePool,
    session_id: Uuid,
    agent_id: Uuid,
    agent_name: &str,
) -> Result<bool, sqlx::Error> {
    let count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(1)
           FROM chat_session_agents session_agents
           JOIN chat_agents agents ON agents.id = session_agents.agent_id
           WHERE session_agents.session_id = ?1
             AND session_agents.agent_id != ?2
             AND lower(trim(agents.name)) = lower(trim(?3))"#,
    )
    .bind(session_id)
    .bind(agent_id)
    .bind(agent_name)
    .fetch_one(pool)
    .await?;

    Ok(count > 0)
}

pub async fn get_session_agents(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatSessionAgent>>>, ApiError> {
    let agents = ChatSessionAgent::find_all_for_session(&deployment.db().pool, session.id).await?;
    Ok(ResponseJson(ApiResponse::success(agents)))
}

pub async fn create_session_agent(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateChatSessionAgentRequest>,
) -> Result<ResponseJson<ApiResponse<ChatSessionAgent>>, ApiError> {
    if session.status != ChatSessionStatus::Active {
        return Err(ApiError::Conflict("Chat session is archived".to_string()));
    }

    let workspace_path = normalize_workspace_path(payload.workspace_path).await?;
    let allowed_skill_ids = normalize_allowed_skill_ids(payload.allowed_skill_ids.clone());

    if let Some(existing) = ChatSessionAgent::find_by_session_and_agent(
        &deployment.db().pool,
        session.id,
        payload.agent_id,
    )
    .await?
    {
        let mut updated = existing.clone();
        let mut changed = false;

        if workspace_path.is_some() {
            updated = ChatSessionAgent::update_workspace_path(
                &deployment.db().pool,
                existing.id,
                workspace_path,
            )
            .await?;
            changed = true;
        }

        if payload.allowed_skill_ids.is_some() {
            updated = ChatSessionAgent::update_allowed_skill_ids(
                &deployment.db().pool,
                existing.id,
                allowed_skill_ids,
            )
            .await?;
            changed = true;
        }

        return Ok(ResponseJson(ApiResponse::success(if changed {
            updated
        } else {
            existing
        })));
    }

    let Some(agent) = ChatAgent::find_by_id(&deployment.db().pool, payload.agent_id).await? else {
        return Err(ApiError::BadRequest("Chat agent not found".to_string()));
    };

    let project_name = session.title.as_deref().map(str::trim).unwrap_or("");
    let agent_name = agent.name.trim();
    if !project_name.is_empty() && project_name.to_lowercase() == agent_name.to_lowercase() {
        return Err(ApiError::BadRequest(
            "AI member name cannot match the project name.".to_string(),
        ));
    }

    if session_has_duplicate_member_name(
        &deployment.db().pool,
        session.id,
        payload.agent_id,
        agent_name,
    )
    .await?
    {
        return Err(ApiError::BadRequest(
            "An AI member with this name already exists in this session.".to_string(),
        ));
    }

    let created = ChatSessionAgent::create(
        &deployment.db().pool,
        &CreateChatSessionAgent {
            session_id: session.id,
            agent_id: payload.agent_id,
            workspace_path,
            allowed_skill_ids,
        },
        Uuid::new_v4(),
    )
    .await?;
    Ok(ResponseJson(ApiResponse::success(created)))
}

pub async fn update_session_agent(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, session_agent_id)): axum::extract::Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateChatSessionAgentRequest>,
) -> Result<ResponseJson<ApiResponse<ChatSessionAgent>>, ApiError> {
    if session.status != ChatSessionStatus::Active {
        return Err(ApiError::Conflict("Chat session is archived".to_string()));
    }

    let Some(existing) =
        ChatSessionAgent::find_by_id(&deployment.db().pool, session_agent_id).await?
    else {
        return Err(ApiError::BadRequest(
            "Chat session agent not found".to_string(),
        ));
    };

    if existing.session_id != session.id {
        return Err(ApiError::Forbidden(
            "Chat session agent does not belong to this session".to_string(),
        ));
    }

    let workspace_path = match payload.workspace_path {
        Some(raw_path) => normalize_workspace_path(Some(raw_path)).await?,
        None => existing.workspace_path.clone(),
    };

    let allowed_skill_ids = payload
        .allowed_skill_ids
        .map(|skill_ids| normalize_allowed_skill_ids(Some(skill_ids)))
        .unwrap_or_else(|| existing.allowed_skill_ids.0.clone());

    let workspace_changed = workspace_path != existing.workspace_path;
    let allowed_skills_changed = allowed_skill_ids != existing.allowed_skill_ids.0;

    let updated = if workspace_changed {
        ChatSessionAgent::update_workspace_path(&deployment.db().pool, existing.id, workspace_path)
            .await?
    } else {
        existing.clone()
    };

    let updated = if allowed_skills_changed {
        ChatSessionAgent::update_allowed_skill_ids(
            &deployment.db().pool,
            updated.id,
            allowed_skill_ids,
        )
        .await?
    } else {
        updated
    };

    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn delete_session_agent(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, session_agent_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let Some(existing) =
        ChatSessionAgent::find_by_id(&deployment.db().pool, session_agent_id).await?
    else {
        return Err(ApiError::BadRequest(
            "Chat session agent not found".to_string(),
        ));
    };

    if existing.session_id != session.id {
        return Err(ApiError::Forbidden(
            "Chat session agent does not belong to this session".to_string(),
        ));
    }

    let rows = ChatSessionAgent::delete(&deployment.db().pool, existing.id).await?;
    if rows == 0 {
        Err(ApiError::BadRequest(
            "Chat session agent not found".to_string(),
        ))
    } else {
        Ok(ResponseJson(ApiResponse::success(())))
    }
}

pub async fn archive_session(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    if session.status == ChatSessionStatus::Archived {
        return Ok(ResponseJson(ApiResponse::success(session)));
    }

    // Get session stats for analytics
    let session_stats = AnalyticsSessionStats::find_by_id(&deployment.db().pool, session.id)
        .await
        .ok()
        .flatten();

    let archive_dir = asset_dir()
        .join("chat")
        .join(format!("session_{}", session.id))
        .join("archive");
    let archive_ref = services::services::chat::export_session_archive(
        &deployment.db().pool,
        &session,
        archive_dir.as_path(),
    )
    .await?;

    let updated = ChatSession::update(
        &deployment.db().pool,
        session.id,
        &UpdateChatSession {
            title: None,
            status: Some(ChatSessionStatus::Archived),
            summary_text: None,
            archive_ref: Some(archive_ref),
            last_seen_diff_key: None,
            team_protocol: None,
            team_protocol_enabled: None,
        },
    )
    .await?;

    // Track analytics: session_archive
    if let Some(stats) = session_stats {
        let duration_seconds = (chrono::Utc::now() - session.created_at).num_seconds();
        let _ = track_session_archive(
            &deployment.db().pool,
            session.id,
            None,
            duration_seconds,
            stats.message_count,
            stats.agent_count,
        )
        .await;
    }

    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn restore_session(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    if session.status == ChatSessionStatus::Active {
        return Ok(ResponseJson(ApiResponse::success(session)));
    }

    let updated = ChatSession::update(
        &deployment.db().pool,
        session.id,
        &UpdateChatSession {
            title: None,
            status: Some(ChatSessionStatus::Active),
            summary_text: None,
            archive_ref: None,
            last_seen_diff_key: None,
            team_protocol: None,
            team_protocol_enabled: None,
        },
    )
    .await?;

    // Track analytics: session_restore
    let _ = track_session_restore(&deployment.db().pool, session.id, None).await;

    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn stream_session_ws(
    ws: WebSocketUpgrade,
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<impl IntoResponse, ApiError> {
    let rx = deployment.chat_runner().subscribe(session.id);

    Ok(ws.on_upgrade(move |socket| async move {
        if let Err(err) = handle_chat_stream_ws(socket, rx).await {
            tracing::warn!("chat stream ws closed: {}", err);
        }
    }))
}

async fn handle_chat_stream_ws(
    socket: WebSocket,
    mut rx: tokio::sync::broadcast::Receiver<services::services::chat_runner::ChatStreamEvent>,
) -> anyhow::Result<()> {
    use futures_util::{SinkExt, StreamExt};

    let (mut sender, mut receiver) = socket.split();
    tokio::spawn(async move { while let Some(Ok(_)) = receiver.next().await {} });

    loop {
        match rx.recv().await {
            Ok(event) => {
                let json = serde_json::to_string(&event)?;
                if sender.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }

    Ok(())
}

/// Stop a running agent
pub async fn stop_session_agent(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, session_agent_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    // Check that session agent exists and belongs to this session
    let Some(existing) =
        ChatSessionAgent::find_by_id(&deployment.db().pool, session_agent_id).await?
    else {
        return Err(ApiError::BadRequest(
            "Chat session agent not found".to_string(),
        ));
    };

    if existing.session_id != session.id {
        return Err(ApiError::Forbidden(
            "Chat session agent does not belong to this session".to_string(),
        ));
    }

    // Stop the agent
    deployment
        .chat_runner()
        .stop_agent(session.id, session_agent_id)
        .await?;

    Ok(ResponseJson(ApiResponse::success(())))
}

#[derive(Debug, Deserialize, TS)]
pub struct ValidateWorkspacePathRequest {
    pub workspace_path: String,
}

#[derive(Debug, Serialize, TS)]
pub struct ValidateWorkspacePathResponse {
    pub valid: bool,
    pub error: Option<String>,
}

pub async fn validate_workspace_path_endpoint(
    Json(payload): Json<ValidateWorkspacePathRequest>,
) -> Result<ResponseJson<ApiResponse<ValidateWorkspacePathResponse>>, ApiError> {
    let trimmed = payload.workspace_path.trim();

    if trimmed.is_empty() {
        return Ok(ResponseJson(ApiResponse::success(
            ValidateWorkspacePathResponse {
                valid: false,
                error: Some("Workspace path is required.".to_string()),
            },
        )));
    }

    if let Err(e) = validate_workspace_path_legality(trimmed) {
        return Ok(ResponseJson(ApiResponse::success(
            ValidateWorkspacePathResponse {
                valid: false,
                error: Some(e.to_string()),
            },
        )));
    }

    let parsed_path = PathBuf::from(trimmed);
    match tokio::fs::metadata(&parsed_path).await {
        Ok(metadata) => {
            if metadata.is_dir() {
                Ok(ResponseJson(ApiResponse::success(
                    ValidateWorkspacePathResponse {
                        valid: true,
                        error: None,
                    },
                )))
            } else {
                Ok(ResponseJson(ApiResponse::success(
                    ValidateWorkspacePathResponse {
                        valid: false,
                        error: Some("Workspace path must be an existing directory.".to_string()),
                    },
                )))
            }
        }
        Err(err) => {
            let error_msg = match err.kind() {
                std::io::ErrorKind::NotFound => "Workspace path does not exist.".to_string(),
                _ => format!("Workspace path is not accessible: {err}"),
            };
            Ok(ResponseJson(ApiResponse::success(
                ValidateWorkspacePathResponse {
                    valid: false,
                    error: Some(error_msg),
                },
            )))
        }
    }
}
