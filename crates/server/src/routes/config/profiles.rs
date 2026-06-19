#[derive(Debug, Serialize, Deserialize)]
pub struct ProfilesContent {
    pub content: String,
    pub path: String,
}

async fn get_profiles(
    State(_deployment): State<DeploymentImpl>,
) -> ResponseJson<ApiResponse<ProfilesContent>> {
    let profiles_path = utils::assets::profiles_path();

    // Use cached data to ensure consistency with runtime and PUT updates
    let profiles = ExecutorConfigs::get_cached();

    let content = serde_json::to_string_pretty(&profiles).unwrap_or_else(|e| {
        tracing::error!("Failed to serialize profiles to JSON: {}", e);
        serde_json::to_string_pretty(&ExecutorConfigs::from_defaults())
            .unwrap_or_else(|_| "{}".to_string())
    });

    ResponseJson(ApiResponse::success(ProfilesContent {
        content,
        path: profiles_path.display().to_string(),
    }))
}

async fn update_profiles(
    State(_deployment): State<DeploymentImpl>,
    body: String,
) -> ResponseJson<ApiResponse<String>> {
    // Try to parse as ExecutorProfileConfigs format
    match serde_json::from_str::<ExecutorConfigs>(&body) {
        Ok(executor_profiles) => {
            // Save the profiles to file
            match executor_profiles.save_overrides() {
                Ok(_) => {
                    tracing::info!("Executor profiles saved successfully");
                    // Reload the cached profiles
                    ExecutorConfigs::reload();
                    ResponseJson(ApiResponse::success(
                        "Executor profiles updated successfully".to_string(),
                    ))
                }
                Err(e) => {
                    tracing::error!("Failed to save executor profiles: {}", e);
                    ResponseJson(ApiResponse::error(&format!(
                        "Failed to save executor profiles: {}",
                        e
                    )))
                }
            }
        }
        Err(e) => ResponseJson(ApiResponse::error(&format!(
            "Invalid executor profiles format: {}",
            e
        ))),
    }
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct CheckEditorAvailabilityQuery {
    editor_type: EditorType,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct CheckEditorAvailabilityResponse {
    available: bool,
}

async fn check_editor_availability(
    State(_deployment): State<DeploymentImpl>,
    Query(query): Query<CheckEditorAvailabilityQuery>,
) -> ResponseJson<ApiResponse<CheckEditorAvailabilityResponse>> {
    // Construct a minimal EditorConfig for checking
    let editor_config = EditorConfig::new(
        query.editor_type,
        None, // custom_command
        None, // remote_ssh_host
        None, // remote_ssh_user
    );

    let available = editor_config.check_availability().await;
    ResponseJson(ApiResponse::success(CheckEditorAvailabilityResponse {
        available,
    }))
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct CheckAgentAvailabilityQuery {
    executor: BaseCodingAgent,
}

async fn check_agent_availability(
    State(_deployment): State<DeploymentImpl>,
    Query(query): Query<CheckAgentAvailabilityQuery>,
) -> ResponseJson<ApiResponse<AvailabilityInfo>> {
    let profiles = ExecutorConfigs::get_cached();
    let profile_id = ExecutorProfileId::new(query.executor);

    let info = match profiles.get_coding_agent(&profile_id) {
        Some(agent) => agent.get_availability_info(),
        None => AvailabilityInfo::NotFound,
    };

    ResponseJson(ApiResponse::success(info))
}

#[derive(Debug, Deserialize)]
pub struct AgentSlashCommandsStreamQuery {
    executor: BaseCodingAgent,
    #[serde(default)]
    workspace_id: Option<Uuid>,
    #[serde(default)]
    repo_id: Option<Uuid>,
}

pub async fn stream_agent_slash_commands_ws(
    ws: WebSocketUpgrade,
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<AgentSlashCommandsStreamQuery>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = handle_agent_slash_commands_ws(socket, deployment, query).await {
            tracing::warn!("slash commands WS closed: {}", e);
        }
    })
}

async fn handle_agent_slash_commands_ws(
    socket: WebSocket,
    deployment: DeploymentImpl,
    query: AgentSlashCommandsStreamQuery,
) -> anyhow::Result<()> {
    use futures_util::{SinkExt, StreamExt};

    let (mut sender, mut receiver) = socket.split();

    tokio::spawn(async move { while let Some(Ok(_)) = receiver.next().await {} });

    match deployment
        .container()
        .available_agent_slash_commands(
            ExecutorProfileId::new(query.executor),
            query.workspace_id,
            query.repo_id,
        )
        .await
    {
        Ok(Some(mut stream)) => {
            if let Some(patch) = stream.next().await {
                let _ = sender
                    .send(LogMsg::JsonPatch(patch).to_ws_message_unchecked())
                    .await;
            }

            let _ = sender.send(LogMsg::Ready.to_ws_message_unchecked()).await;

            while let Some(patch) = stream.next().await {
                if sender
                    .send(LogMsg::JsonPatch(patch).to_ws_message_unchecked())
                    .await
                    .is_err()
                {
                    break;
                }
            }
        }
        Ok(None) => {
            let _ = sender.send(LogMsg::Ready.to_ws_message_unchecked()).await;
        }
        Err(e) => {
            tracing::warn!("Failed to start slash command stream: {}", e);
        }
    }

    let _ = sender
        .send(LogMsg::Finished.to_ws_message_unchecked())
        .await;
    Ok(())
}
