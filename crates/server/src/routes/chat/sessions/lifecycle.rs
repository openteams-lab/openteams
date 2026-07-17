#[derive(Debug, Deserialize, TS)]
pub struct ChatSessionListQuery {
    pub status: Option<ChatSessionStatus>,
    pub project_id: Option<Uuid>,
}

pub async fn get_sessions(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ChatSessionListQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatSession>>>, ApiError> {
    let sessions =
        ChatSession::find_all(&deployment.db().pool, query.status, query.project_id).await?;
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
    let session =
        create_session_with_project_members(&deployment.db().pool, &payload, Uuid::new_v4())
            .await?;
    workflow_analytics::track_session_created(
        workflow_analytics::analytics_if_enabled(
            deployment.analytics().as_ref(),
            deployment.analytics_enabled(),
        ),
        session.id,
        Some(deployment.user_id()),
    );

    Ok(ResponseJson(ApiResponse::success(session)))
}

pub async fn update_session(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<UpdateChatSession>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    if let Some(Some(lead_session_agent_id)) = &payload.lead_session_agent_id {
        let session_agent =
            ChatSessionAgent::find_by_id(&deployment.db().pool, *lead_session_agent_id).await?;
        if session_agent.is_none_or(|session_agent| session_agent.session_id != session.id) {
            return Err(ApiError::BadRequest(
                "Session agent is not a member of this session".to_string(),
            ));
        }
    } else if let Some(Some(lead_agent_id)) = &payload.lead_agent_id {
        let session_agents =
            ChatSessionAgent::find_all_for_session(&deployment.db().pool, session.id).await?;
        let agent_exists = session_agents
            .iter()
            .any(|sa| sa.agent_id == *lead_agent_id);
        if !agent_exists {
            return Err(ApiError::BadRequest(
                "Agent is not a member of this session".to_string(),
            ));
        }
    }

    let updated = ChatSession::update(&deployment.db().pool, session.id, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn delete_session(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let had_messages = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM chat_messages WHERE session_id = ? LIMIT 1)",
    )
    .bind(session.id)
    .fetch_one(&deployment.db().pool)
    .await?;

    SessionWorktreeService::new(deployment.db().pool.clone())
        .force_cleanup_for_session_deletion(session.id)
        .await
        .map_err(super::worktree::session_worktree_api_error)?;

    let rows_affected = ChatSession::delete(&deployment.db().pool, session.id).await?;
    if rows_affected == 0 {
        return Err(ApiError::Database(sqlx::Error::RowNotFound));
    }

    let analytics_projector = AnalyticsProjector::new(
        &deployment.db().pool,
        workflow_analytics::analytics_if_enabled(
            deployment.analytics().as_ref(),
            deployment.analytics_enabled(),
        ),
        deployment.analytics_enabled(),
    );
    analytics_projector
        .record_or_warn(
            AnalyticsEvent::new(AnalyticsEventPayload::SessionDeleted { had_messages })
                .with_session(session.id),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(())))
}


pub async fn archive_session(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    if session.status == ChatSessionStatus::Archived {
        return Ok(ResponseJson(ApiResponse::success(session)));
    }

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
            lead_agent_id: None,
            lead_session_agent_id: None,
            summary_text: None,
            archive_ref: Some(archive_ref),
            last_seen_diff_key: None,
            default_workspace_path: None,
            chat_input_mode: None,
            worktree_mode: None,
        },
    )
    .await?;

    workflow_analytics::track_session_archived(
        workflow_analytics::analytics_if_enabled(
            deployment.analytics().as_ref(),
            deployment.analytics_enabled(),
        ),
        session.id,
        Some(deployment.user_id()),
        false,
    );

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
            lead_agent_id: None,
            lead_session_agent_id: None,
            summary_text: None,
            archive_ref: None,
            last_seen_diff_key: None,
            default_workspace_path: None,
            chat_input_mode: None,
            worktree_mode: None,
        },
    )
    .await?;

    workflow_analytics::track_session_archived(
        workflow_analytics::analytics_if_enabled(
            deployment.analytics().as_ref(),
            deployment.analytics_enabled(),
        ),
        session.id,
        Some(deployment.user_id()),
        true,
    );

    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn pin_session(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    if session.status != ChatSessionStatus::Active {
        return Err(ApiError::Conflict("Chat session is archived".to_string()));
    }

    let updated = ChatSession::set_pinned(&deployment.db().pool, session.id, true).await?;
    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn unpin_session(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    if session.status != ChatSessionStatus::Active {
        return Err(ApiError::Conflict("Chat session is archived".to_string()));
    }

    let updated = ChatSession::set_pinned(&deployment.db().pool, session.id, false).await?;
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
