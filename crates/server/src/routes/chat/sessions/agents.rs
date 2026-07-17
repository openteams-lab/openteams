#[derive(Debug, Deserialize, TS)]
pub struct CreateChatSessionAgentRequest {
    pub agent_id: Uuid,
    #[serde(default)]
    #[ts(optional)]
    pub member_name: Option<String>,
    pub workspace_path: Option<String>,
    pub allowed_skill_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateChatSessionAgentRequest {
    #[serde(default)]
    #[ts(optional)]
    pub member_name: Option<String>,
    pub workspace_path: Option<String>,
    pub allowed_skill_ids: Option<Vec<String>>,
}


pub async fn create_session_agent(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateChatSessionAgentRequest>,
) -> Result<ResponseJson<ApiResponse<ChatSessionAgent>>, ApiError> {
    if session.status != ChatSessionStatus::Active {
        return Err(ApiError::Conflict("Chat session is archived".to_string()));
    }

    let workspace_path =
        normalize_or_inherit_workspace_path(&session, payload.workspace_path).await?;
    let allowed_skill_ids = normalize_allowed_skill_ids(payload.allowed_skill_ids.clone());

    let Some(agent) = ChatAgent::find_by_id(&deployment.db().pool, payload.agent_id).await? else {
        return Err(ApiError::BadRequest("Chat agent not found".to_string()));
    };

    let project_name = session.title.as_deref().map(str::trim).unwrap_or("");
    let requested_member_name = payload.member_name.as_deref().unwrap_or(&agent.name);
    let member_name = utils::text::sanitize_member_handle(requested_member_name);
    if member_name.is_empty() {
        return Err(ApiError::BadRequest(
            "Member name cannot be empty".to_string(),
        ));
    }
    let agent_name = member_name.as_str();
    if !project_name.is_empty() && project_name.to_lowercase() == agent_name.to_lowercase() {
        return Err(ApiError::BadRequest(
            "AI member name cannot match the project name.".to_string(),
        ));
    }

    if let Some(existing) = ChatSessionAgent::find_by_session_and_member_name(
        &deployment.db().pool,
        session.id,
        &member_name,
    )
    .await?
    {
        if existing.agent_id != payload.agent_id {
            return Err(ApiError::BadRequest(
                "An AI member with this name already exists in this session.".to_string(),
            ));
        }
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

    if session_has_duplicate_member_name(&deployment.db().pool, session.id, None, agent_name)
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
            member_name: Some(member_name.clone()),
            workspace_path,
            allowed_skill_ids,
            project_member_id: None,
            execution_config: MemberExecutionConfig::default(),
        },
        Uuid::new_v4(),
    )
    .await?;
    workflow_analytics::track_agent_added(
        workflow_analytics::analytics_if_enabled(
            deployment.analytics().as_ref(),
            deployment.analytics_enabled(),
        ),
        session.id,
        Some(deployment.user_id()),
        Some(&agent.runner_type),
        created.workspace_path.is_some(),
    );
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

    if payload.member_name.is_some() && existing.project_member_id.is_some() {
        return Err(ApiError::BadRequest(
            "Project-linked member names must be changed through the project member API."
                .to_string(),
        ));
    }

    let workspace_changed = workspace_path != existing.workspace_path;
    let allowed_skills_changed = allowed_skill_ids != existing.allowed_skill_ids.0;
    let member_name = payload
        .member_name
        .as_deref()
        .map(utils::text::sanitize_member_handle)
        .filter(|name| !name.is_empty());
    let member_name_changed = member_name
        .as_deref()
        .is_some_and(|name| name != existing.member_name);

    if let Some(member_name) = member_name.as_deref()
        && session_has_duplicate_member_name(
            &deployment.db().pool,
            session.id,
            Some(existing.id),
            member_name,
        )
        .await?
    {
        return Err(ApiError::BadRequest(
            "An AI member with this name already exists in this session.".to_string(),
        ));
    }

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
    let updated = if member_name_changed {
        ChatSessionAgent::update_member_name(
            &deployment.db().pool,
            updated.id,
            member_name.expect("member name checked above"),
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
        return Err(ApiError::BadRequest(
            "Chat session agent not found".to_string(),
        ));
    }

    // If the removed member was the lead, reset both compatibility and authoritative IDs.
    if session.lead_session_agent_id == Some(existing.id)
        || (session.lead_session_agent_id.is_none()
            && session.lead_agent_id == Some(existing.agent_id))
    {
        let remaining_agents =
            ChatSessionAgent::find_all_for_session(&deployment.db().pool, session.id).await?;
        let new_lead_agent_id = remaining_agents.first().map(|sa| sa.agent_id);

        let update = UpdateChatSession {
            title: None,
            status: None,
            lead_agent_id: Some(new_lead_agent_id),
            lead_session_agent_id: Some(remaining_agents.first().map(|sa| sa.id)),
            summary_text: None,
            archive_ref: None,
            last_seen_diff_key: None,
            default_workspace_path: None,
            chat_input_mode: None,
            worktree_mode: None,
        };
        ChatSession::update(&deployment.db().pool, session.id, &update).await?;
    }

    Ok(ResponseJson(ApiResponse::success(())))
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
