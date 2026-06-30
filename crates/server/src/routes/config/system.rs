#[derive(Debug, Serialize, Deserialize, TS)]
pub struct Environment {
    pub os_type: String,
    pub os_version: String,
    pub os_architecture: String,
    pub bitness: String,
}

impl Default for Environment {
    fn default() -> Self {
        Self::new()
    }
}

impl Environment {
    pub fn new() -> Self {
        let info = os_info::get();
        Environment {
            os_type: info.os_type().to_string(),
            os_version: info.version().to_string(),
            os_architecture: info.architecture().unwrap_or("unknown").to_string(),
            bitness: info.bitness().to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct UserSystemInfo {
    pub config: Config,
    pub analytics_user_id: String,
    pub deploy_mode: String,
    pub login_status: LoginStatus,
    pub home_directory: String,
    #[serde(flatten)]
    pub profiles: ExecutorConfigs,
    pub environment: Environment,
    /// Capabilities supported per executor (e.g., { "CLAUDE_CODE": ["SESSION_FORK"] })
    pub capabilities: HashMap<String, Vec<BaseAgentCapability>>,
}

// TODO: update frontend, BE schema has changed, this replaces GET /config and /config/constants
#[axum::debug_handler]
async fn get_user_system_info(
    State(deployment): State<DeploymentImpl>,
) -> ResponseJson<ApiResponse<UserSystemInfo>> {
    let config = deployment.config().read().await;
    let login_status = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        deployment.get_login_status(),
    )
    .await
    .unwrap_or(LoginStatus::LoggedOut);

    let user_system_info = UserSystemInfo {
        config: config.clone(),
        analytics_user_id: deployment.user_id().to_string(),
        deploy_mode: super::version::detect_deploy_mode().to_string(),
        login_status,
        home_directory: home_directory().to_string_lossy().to_string(),
        profiles: ExecutorConfigs::get_cached(),
        environment: Environment::new(),
        capabilities: {
            let mut caps: HashMap<String, Vec<BaseAgentCapability>> = HashMap::new();
            let profs = ExecutorConfigs::get_cached();
            for key in profs.executors.keys() {
                if let Some(agent) = profs.get_coding_agent(&ExecutorProfileId::new(*key)) {
                    caps.insert(key.to_string(), agent.capabilities());
                }
            }
            caps
        },
    };

    ResponseJson(ApiResponse::success(user_system_info))
}

async fn update_config(
    State(deployment): State<DeploymentImpl>,
    Json(new_config): Json<Config>,
) -> ResponseJson<ApiResponse<Config>> {
    let config_path = config_path();

    // Validate git branch prefix
    if !git::is_valid_branch_prefix(&new_config.git_branch_prefix) {
        return ResponseJson(ApiResponse::error(
            "Invalid git branch prefix. Must be a valid git branch name component without slashes.",
        ));
    }

    // Get old config state before updating
    let old_config = deployment.config().read().await.clone();

    match save_config_to_file(&new_config, &config_path).await {
        Ok(_) => {
            let mut config = deployment.config().write().await;
            *config = new_config.clone();
            drop(config);
            deployment.set_analytics_enabled(new_config.analytics_enabled);
            apply_worktree_dir_config(&new_config);

            // Track config events when fields transition from false → true and run side effects
            handle_config_events(&deployment, &old_config, &new_config).await;

            ResponseJson(ApiResponse::success(new_config))
        }
        Err(e) => ResponseJson(ApiResponse::error(&format!("Failed to save config: {}", e))),
    }
}

fn configured_path(value: Option<&str>) -> Option<std::path::PathBuf> {
    value
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(expand_tilde)
}

fn apply_worktree_dir_config(config: &Config) {
    WorktreeManager::set_workspace_dir_override_option(configured_path(
        config.workspace_dir.as_deref(),
    ));
    WorktreeManager::set_session_worktree_dir_override(configured_path(
        config.worktree_sessions_dir.as_deref(),
    ));
}

/// Track config events when fields transition from false → true
async fn track_config_events(_deployment: &DeploymentImpl, _old: &Config, _new: &Config) {}

async fn handle_config_events(deployment: &DeploymentImpl, old: &Config, new: &Config) {
    track_config_events(deployment, old, new).await;

    if !old.disclaimer_acknowledged && new.disclaimer_acknowledged {
        // Spawn auto project setup as background task to avoid blocking config response
        let deployment_clone = deployment.clone();
        tokio::spawn(async move {
            deployment_clone.trigger_auto_project_setup().await;
        });
    }
}

// ── CLI Config Endpoints ──────────────────────────────────────────────
