use std::{
    collections::{BTreeSet, HashMap},
    net::SocketAddr,
    path::{Path as StdPath, PathBuf},
    time::Duration,
};

use axum::{
    Json, Router,
    body::Body,
    extract::{
        Path, Query, State,
        ws::{WebSocket, WebSocketUpgrade},
    },
    http,
    response::{IntoResponse, Json as ResponseJson, Response},
    routing::{get, post, put},
};
use deployment::{Deployment, DeploymentError};
use executors::{
    executors::{
        AvailabilityInfo, BaseAgentCapability, BaseCodingAgent, CodingAgent,
        StandardCodingAgentExecutor,
    },
    mcp_config::{McpConfig, read_agent_config, write_agent_config},
    model_sync::with_model,
    profile::{ExecutorConfigs, ExecutorProfileId, canonical_variant_key},
};
use jsonc_parser::ParseOptions;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use services::services::{
    cli_config::{
        CliConfig, CustomProviderEntry, OpenTeamsCliConfig, OpenTeamsCliProviderConfig,
        OpenTeamsCliProviderOptions,
    },
    config::{
        Config, ConfigError, SoundFile,
        editor::{EditorConfig, EditorType},
        save_config_to_file,
    },
    container::ContainerService,
};
use tokio::fs;
use ts_rs::TS;
use url::{Host, Url};
use utils::{
    api::oauth::LoginStatus, assets::config_path, log_msg::LogMsg, path::home_directory,
    response::ApiResponse,
};
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/info", get(get_user_system_info))
        .route("/config", put(update_config))
        .route("/config/cli", get(get_cli_config).put(update_cli_config))
        .route(
            "/config/cli/sync-to-cli",
            post(sync_cli_config_to_openteams_cli),
        )
        .route("/config/cli/providers", get(list_cli_providers))
        .route(
            "/config/cli/providers/{provider}/models",
            get(list_provider_models),
        )
        .route(
            "/config/cli/providers/{provider}/validate",
            post(validate_provider),
        )
        .route(
            "/config/cli/custom-providers",
            get(list_custom_providers).post(create_custom_provider),
        )
        .route(
            "/config/cli/custom-providers/{id}",
            put(update_custom_provider).delete(delete_custom_provider),
        )
        .route("/config/cli/restart-service", post(restart_cli_service))
        .route("/sounds/{sound}", get(get_sound))
        .route("/mcp-config", get(get_mcp_servers).post(update_mcp_servers))
        .route("/profiles", get(get_profiles).put(update_profiles))
        .route(
            "/editors/check-availability",
            get(check_editor_availability),
        )
        .route("/agents/check-availability", get(check_agent_availability))
        .route(
            "/agents/slash-commands/ws",
            get(stream_agent_slash_commands_ws),
        )
}

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

            // Track config events when fields transition from false → true and run side effects
            handle_config_events(&deployment, &old_config, &new_config).await;

            ResponseJson(ApiResponse::success(new_config))
        }
        Err(e) => ResponseJson(ApiResponse::error(&format!("Failed to save config: {}", e))),
    }
}

/// Track config events when fields transition from false → true
async fn track_config_events(deployment: &DeploymentImpl, old: &Config, new: &Config) {
    let events = [
        (
            !old.disclaimer_acknowledged && new.disclaimer_acknowledged,
            "onboarding_disclaimer_accepted",
            serde_json::json!({}),
        ),
        (
            !old.onboarding_acknowledged && new.onboarding_acknowledged,
            "onboarding_completed",
            serde_json::json!({
                "profile": new.executor_profile,
                "editor": new.editor
            }),
        ),
        (
            !old.analytics_enabled && new.analytics_enabled,
            "analytics_session_start",
            serde_json::json!({}),
        ),
    ];

    for (should_track, event_name, properties) in events {
        if should_track {
            deployment
                .track_if_analytics_allowed(event_name, properties)
                .await;
        }
    }
}

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

/// Read CLI config from ~/.openteams/config.toml, masking API keys
async fn get_cli_config(
    State(_deployment): State<DeploymentImpl>,
) -> ResponseJson<ApiResponse<CliConfig>> {
    let config = read_cli_config_from_disk().await;
    ResponseJson(ApiResponse::success(mask_api_keys(config)))
}

/// Write CLI config to ~/.openteams/config.toml
async fn update_cli_config(
    State(_deployment): State<DeploymentImpl>,
    Json(mut new_config): Json<CliConfig>,
) -> ResponseJson<ApiResponse<CliConfig>> {
    if let Ok(old_config) = try_read_cli_config_from_disk().await {
        merge_masked_keys(&mut new_config, &old_config);
    }

    match write_cli_config_to_disk(&new_config).await {
        Ok(_) => {
            // 同步默认 provider/model 到 openteams-cli
            if let Err(e) = sync_openteams_cli_profiles_from_disk().await {
                tracing::error!("Failed to sync OpenTeams CLI profiles: {}", e);
            }
            ResponseJson(ApiResponse::success(mask_api_keys(new_config)))
        }
        Err(e) => ResponseJson(ApiResponse::error(&format!(
            "Failed to save CLI config: {}",
            e
        ))),
    }
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct SyncToCliRequest {
    pub custom_provider_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct SyncToCliResponse {
    pub synced: bool,
    pub message: String,
    pub config_path: Option<String>,
}

async fn sync_cli_config_to_openteams_cli(
    State(_deployment): State<DeploymentImpl>,
    Json(req): Json<SyncToCliRequest>,
) -> ResponseJson<ApiResponse<SyncToCliResponse>> {
    let openteams_config = read_cli_config_from_disk().await;

    match sync_to_openteams_cli(&openteams_config, req.custom_provider_id.as_deref()).await {
        Ok(config_path) => ResponseJson(ApiResponse::success(SyncToCliResponse {
            synced: true,
            message: "Configuration synced to openteams-cli".to_string(),
            config_path: Some(config_path),
        })),
        Err(e) => ResponseJson(ApiResponse::error(&format!(
            "Failed to sync to openteams-cli: {}",
            e
        ))),
    }
}

async fn sync_to_openteams_cli(
    openteams_config: &CliConfig,
    custom_provider_id: Option<&str>,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let cli_config_path = OpenTeamsCliConfig::config_path()
        .ok_or("Cannot determine openteams-cli config directory")?;

    let mut cli_config = try_read_openteams_cli_config_from_disk().await?;
    let original_cli_config = cli_config.clone();

    sync_requested_provider_to_cli_config(&mut cli_config, openteams_config, custom_provider_id);

    if cli_config_changed(&original_cli_config, &cli_config)? {
        write_openteams_cli_config_to_disk(&cli_config).await?;
    }
    sync_openteams_cli_profiles_from_cli_config(&cli_config)?;

    Ok(cli_config_path.to_string_lossy().to_string())
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct RestartCliResponse {
    pub restarted: bool,
    pub message: String,
    pub base_url: Option<String>,
    pub port: Option<u16>,
}

/// POST /config/cli/restart-service
/// 重启 openteams-cli 服务，使配置变更生效
async fn restart_cli_service(
    State(deployment): State<DeploymentImpl>,
) -> ResponseJson<ApiResponse<RestartCliResponse>> {
    match deployment.restart_cli().await {
        Ok((base_url, port)) => ResponseJson(ApiResponse::success(RestartCliResponse {
            restarted: true,
            message: "openteams-cli service restarted successfully".to_string(),
            base_url: Some(base_url),
            port: Some(port),
        })),
        Err(e) => ResponseJson(ApiResponse::error(&format!(
            "Failed to restart openteams-cli: {}",
            e
        ))),
    }
}

// ── Custom Providers CRUD ──────────────────────────────────────────

/// GET /config/cli/custom-providers
async fn list_custom_providers(
    State(_deployment): State<DeploymentImpl>,
) -> ResponseJson<ApiResponse<Vec<CustomProviderEntry>>> {
    let config = read_cli_config_from_disk().await;
    let providers: Vec<CustomProviderEntry> = config
        .provider
        .custom_providers
        .unwrap_or_default()
        .into_values()
        .map(|mut p| {
            mask_custom_provider_key(&mut p);
            p
        })
        .collect();
    ResponseJson(ApiResponse::success(providers))
}

/// POST /config/cli/custom-providers
async fn create_custom_provider(
    State(_deployment): State<DeploymentImpl>,
    Json(entry): Json<CustomProviderEntry>,
) -> ResponseJson<ApiResponse<CustomProviderEntry>> {
    if entry.id.is_empty() {
        return ResponseJson(ApiResponse::error("Provider id cannot be empty"));
    }

    let mut config = read_cli_config_from_disk().await;
    let providers = config
        .provider
        .custom_providers
        .get_or_insert_with(HashMap::new);

    if providers.contains_key(&entry.id) {
        return ResponseJson(ApiResponse::error(&format!(
            "Provider '{}' already exists",
            entry.id
        )));
    }

    providers.insert(entry.id.clone(), entry.clone());

    if let Err(e) = write_cli_config_to_disk(&config).await {
        return ResponseJson(ApiResponse::error(&format!("Failed to save config: {}", e)));
    }

    // 自动同步到 openteams-cli，失败时返回错误而非静默吞掉
    if let Err(e) = sync_custom_providers_to_cli(&config, None).await {
        tracing::error!("Failed to sync custom providers to cli: {}", e);
        return ResponseJson(ApiResponse::error(&format!(
            "Provider saved but failed to sync to openteams-cli: {}",
            e
        )));
    }
    if let Err(e) = sync_openteams_cli_profiles_from_disk().await {
        tracing::error!("Failed to sync OpenTeams CLI profiles: {}", e);
        return ResponseJson(ApiResponse::error(&format!(
            "Provider saved but failed to sync OpenTeams CLI profiles: {}",
            e
        )));
    }

    let mut masked = entry;
    mask_custom_provider_key(&mut masked);
    ResponseJson(ApiResponse::success(masked))
}

/// PUT /config/cli/custom-providers/{id}
async fn update_custom_provider(
    State(_deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
    Json(mut entry): Json<CustomProviderEntry>,
) -> ResponseJson<ApiResponse<CustomProviderEntry>> {
    entry.id = id.clone();

    let mut config = read_cli_config_from_disk().await;
    let providers = config
        .provider
        .custom_providers
        .get_or_insert_with(HashMap::new);

    if !providers.contains_key(&id) {
        return ResponseJson(ApiResponse::error(&format!("Provider '{}' not found", id)));
    }

    // 如果 api_key 是掩码，保留旧值
    if let Some(old) = providers.get(&id)
        && let Some(ref new_key) = entry.options.api_key
        && new_key.contains("***")
    {
        entry.options.api_key = old.options.api_key.clone();
    }

    providers.insert(id, entry.clone());

    if let Err(e) = write_cli_config_to_disk(&config).await {
        return ResponseJson(ApiResponse::error(&format!("Failed to save config: {}", e)));
    }

    if let Err(e) = sync_custom_providers_to_cli(&config, None).await {
        tracing::error!("Failed to sync custom providers to cli: {}", e);
        return ResponseJson(ApiResponse::error(&format!(
            "Provider saved but failed to sync to openteams-cli: {}",
            e
        )));
    }
    if let Err(e) = sync_openteams_cli_profiles_from_disk().await {
        tracing::error!("Failed to sync OpenTeams CLI profiles: {}", e);
        return ResponseJson(ApiResponse::error(&format!(
            "Provider saved but failed to sync OpenTeams CLI profiles: {}",
            e
        )));
    }

    mask_custom_provider_key(&mut entry);
    ResponseJson(ApiResponse::success(entry))
}

/// DELETE /config/cli/custom-providers/{id}
async fn delete_custom_provider(
    State(_deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
) -> ResponseJson<ApiResponse<()>> {
    let mut config = read_cli_config_from_disk().await;
    let providers = config
        .provider
        .custom_providers
        .get_or_insert_with(HashMap::new);

    if providers.remove(&id).is_none() {
        return ResponseJson(ApiResponse::error(&format!("Provider '{}' not found", id)));
    }

    // 任务7：如果删除的是当前默认 Provider，自动回退到 anthropic
    if config.provider.default == id {
        config.provider.default = "anthropic".to_string();
        config.model.default = "claude-sonnet-4-20250514".to_string();
    }

    if let Err(e) = write_cli_config_to_disk(&config).await {
        return ResponseJson(ApiResponse::error(&format!("Failed to save config: {}", e)));
    }

    if let Err(e) = sync_custom_providers_to_cli(&config, Some(&id)).await {
        tracing::error!("Failed to sync custom providers to cli: {}", e);
        return ResponseJson(ApiResponse::error(&format!(
            "Provider deleted but failed to sync to openteams-cli: {}",
            e
        )));
    }
    if let Err(e) = sync_openteams_cli_profiles_from_disk().await {
        tracing::error!("Failed to sync OpenTeams CLI profiles: {}", e);
        return ResponseJson(ApiResponse::error(&format!(
            "Provider deleted but failed to sync OpenTeams CLI profiles: {}",
            e
        )));
    }

    ResponseJson(ApiResponse::success(()))
}

/// 将 custom_providers 同步到 ~/.config/openteams-cli/openteams.json
/// deleted_id: 如果有刚删除的 provider id，同步时从 CLI 配置中移除
async fn sync_custom_providers_to_cli(
    app_config: &CliConfig,
    deleted_id: Option<&str>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut cli_config = try_read_openteams_cli_config_from_disk().await?;
    let original_cli_config = cli_config.clone();

    sync_managed_custom_providers_to_cli_config(&mut cli_config, app_config, deleted_id);

    if cli_config_changed(&original_cli_config, &cli_config)? {
        write_openteams_cli_config_to_disk(&cli_config).await?;
    }
    Ok(())
}

/*

    // 任务8：如果有刚删除的 provider，从 CLI 配置中移除
    if let Some(id) = deleted_id {
        cli_providers.remove(id);
    }

    // 仅 upsert custom_providers 中的条目，不删除用户手工维护的其他 provider
    if let Some(providers) = custom_providers {
        for (id, entry) in providers {
            let cli_provider = OpenTeamsCliProviderConfig {
                npm: normalized_custom_provider_npm(id, entry),
                name: entry.name.clone(),
                options: Some(OpenTeamsCliProviderOptions {
                    api_key: entry.options.api_key.clone(),
                    base_url: entry.options.base_url.clone(),
                    timeout: entry.options.timeout,
                    chunk_timeout: None,
                    enterprise_url: None,
                    set_cache_key: None,
                }),
                models: entry.models.as_ref().map(|models| {
                    models
                        .iter()
                        .map(|(model_id, model_cfg)| {
                            let cli_model =
                                services::services::cli_config::OpenTeamsCliModelConfig {
                                    name: model_cfg.name.clone(),
                                    modalities: model_cfg.modalities.clone(),
                                    options: model_cfg.options.clone(),
                                    limit: model_cfg.limit.clone(),
                                    variants: None,
                                };
                            (model_id.clone(), cli_model)
                        })
                        .collect()
                }),
                whitelist: None,
                blacklist: None,
            };
            cli_providers.insert(id.clone(), cli_provider);
        }
    }

    // 同步默认 provider/model 到 openteams-cli
    let default_provider = &app_config.provider.default;
    let default_model = &app_config.model.default;

    if builtin_keys.contains(default_provider.as_str()) {
        // 内置 provider：直接使用 provider/model 格式
        cli_config.model = Some(format!("{}/{}", default_provider, default_model));
    } else if cli_providers.contains_key(default_provider) {
        // 自定义 provider：确认已注册后设置
        cli_config.model = Some(format!("{}/{}", default_provider, default_model));
    }

    write_openteams_cli_config_to_disk(&cli_config).await?;
    Ok(())
}

*/

fn sync_requested_provider_to_cli_config(
    cli_config: &mut OpenTeamsCliConfig,
    app_config: &CliConfig,
    custom_provider_id: Option<&str>,
) {
    if let Some(provider_id) = custom_provider_id {
        if let Some(entry) = app_config
            .provider
            .custom_providers
            .as_ref()
            .and_then(|providers| providers.get(provider_id))
        {
            cli_config.provider.get_or_insert_with(HashMap::new).insert(
                provider_id.to_string(),
                build_cli_provider_config(provider_id, entry),
            );
        }
        return;
    }

    if app_config.provider.default.trim() != "custom" {
        return;
    }

    if let Some(custom) = &app_config.provider.custom {
        let provider_id = custom_provider_id.unwrap_or("custom").to_string();
        let provider_config = OpenTeamsCliProviderConfig {
            name: custom.name.clone(),
            npm: None,
            options: Some(OpenTeamsCliProviderOptions {
                api_key: custom.api_key.clone(),
                base_url: custom.endpoint.clone(),
                timeout: None,
                chunk_timeout: None,
                enterprise_url: None,
                set_cache_key: None,
            }),
            models: None,
            whitelist: None,
            blacklist: None,
        };
        cli_config
            .provider
            .get_or_insert_with(HashMap::new)
            .insert(provider_id, provider_config);
    }
}

fn sync_managed_custom_providers_to_cli_config(
    cli_config: &mut OpenTeamsCliConfig,
    app_config: &CliConfig,
    deleted_id: Option<&str>,
) {
    let cli_providers = cli_config.provider.get_or_insert_with(HashMap::new);

    if let Some(id) = deleted_id {
        cli_providers.remove(id);
    }

    if let Some(providers) = &app_config.provider.custom_providers {
        for (id, entry) in providers {
            cli_providers.insert(id.clone(), build_cli_provider_config(id, entry));
        }
    }
}

fn build_cli_provider_config(id: &str, entry: &CustomProviderEntry) -> OpenTeamsCliProviderConfig {
    OpenTeamsCliProviderConfig {
        npm: normalized_custom_provider_npm(id, entry),
        name: entry.name.clone(),
        options: Some(OpenTeamsCliProviderOptions {
            api_key: entry.options.api_key.clone(),
            base_url: entry.options.base_url.clone(),
            timeout: entry.options.timeout,
            chunk_timeout: None,
            enterprise_url: None,
            set_cache_key: None,
        }),
        models: entry.models.as_ref().map(|models| {
            models
                .iter()
                .map(|(model_id, model_cfg)| {
                    let cli_model = services::services::cli_config::OpenTeamsCliModelConfig {
                        name: model_cfg.name.clone(),
                        modalities: model_cfg.modalities.clone(),
                        options: model_cfg.options.clone(),
                        limit: model_cfg.limit.clone(),
                        variants: None,
                    };
                    (model_id.clone(), cli_model)
                })
                .collect()
        }),
        whitelist: None,
        blacklist: None,
    }
}

fn cli_config_changed(
    original: &OpenTeamsCliConfig,
    updated: &OpenTeamsCliConfig,
) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    Ok(serde_json::to_value(original)? != serde_json::to_value(updated)?)
}

async fn sync_openteams_cli_profiles_from_disk()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cli_config = try_read_openteams_cli_config_from_disk().await?;
    sync_openteams_cli_profiles_from_cli_config(&cli_config)
}

fn sync_openteams_cli_profiles_from_cli_config(
    cli_config: &OpenTeamsCliConfig,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    ExecutorConfigs::reload();
    let mut profiles = ExecutorConfigs::get_cached();
    let changed = sync_openteams_cli_models_into_profiles(&mut profiles, cli_config);

    if changed {
        profiles.save_overrides()?;
        ExecutorConfigs::reload();
    }

    Ok(())
}

fn sync_openteams_cli_models_into_profiles(
    profiles: &mut ExecutorConfigs,
    cli_config: &OpenTeamsCliConfig,
) -> bool {
    let Some(executor_config) = profiles.executors.get_mut(&BaseCodingAgent::OpenTeamsCli) else {
        return false;
    };

    let before = executor_config.clone();
    let Some(base_config) = executor_config
        .get_default()
        .cloned()
        .or_else(|| executor_config.configurations.values().next().cloned())
        .and_then(openteams_cli_default_config)
    else {
        return false;
    };

    executor_config.configurations.remove("PLAN");
    executor_config.configurations.remove("APPROVALS");
    executor_config.set_default(base_config.clone());

    let desired_variant_keys: BTreeSet<_> = resolve_openteams_cli_model_ids(cli_config)
        .into_iter()
        .map(|qualified_model| model_variant_key(&qualified_model))
        .collect();

    let existing_managed_variants: Vec<_> = executor_config
        .configurations
        .iter()
        .filter_map(|(key, config)| {
            is_managed_openteams_cli_model_variant(key, config, &base_config).then_some(key.clone())
        })
        .collect();
    for variant_key in existing_managed_variants {
        if !desired_variant_keys.contains(&variant_key) {
            executor_config.configurations.remove(&variant_key);
        }
    }

    for variant_key in desired_variant_keys {
        let Some(model_config) = with_model(&base_config, &variant_key) else {
            continue;
        };
        executor_config
            .configurations
            .insert(variant_key, model_config);
    }

    before != *executor_config
}

fn is_managed_openteams_cli_model_variant(
    variant_key: &str,
    config: &CodingAgent,
    base_config: &CodingAgent,
) -> bool {
    if variant_key.starts_with(AUTO_MODEL_VARIANT_PREFIX) {
        return true;
    }

    if !variant_key.contains('/') {
        return false;
    }

    match (config, base_config) {
        (CodingAgent::OpenTeamsCli(current), CodingAgent::OpenTeamsCli(base)) => {
            if current.model.as_deref() != Some(variant_key)
                || current.variant.is_some()
                || current.agent.is_some()
            {
                return false;
            }

            let mut normalized = current.clone();
            normalized.model = None;
            normalized.variant = None;
            normalized.agent = None;

            normalized == *base
        }
        _ => false,
    }
}

fn openteams_cli_default_config(config: CodingAgent) -> Option<CodingAgent> {
    match config {
        CodingAgent::OpenTeamsCli(mut inner) => {
            inner.model = None;
            inner.variant = None;
            inner.agent = None;
            Some(CodingAgent::OpenTeamsCli(inner))
        }
        _ => None,
    }
}

fn resolve_openteams_cli_model_ids(cli_config: &OpenTeamsCliConfig) -> Vec<String> {
    let mut model_ids = BTreeSet::new();
    if let Some(providers) = &cli_config.provider {
        for (provider_id, provider) in providers {
            if let Some(models) = &provider.models {
                for model_id in models.keys() {
                    if let Some(qualified) = qualify_model_id(provider_id, model_id) {
                        model_ids.insert(qualified);
                    }
                }
            }
        }
    }

    if let Some(default_model) = cli_config.model.as_deref().map(str::trim)
        && !default_model.is_empty()
    {
        model_ids.insert(default_model.to_string());
    }

    model_ids.into_iter().collect()
}

fn qualify_model_id(provider_id: &str, model_id: &str) -> Option<String> {
    let provider_id = provider_id.trim();
    let model_id = model_id.trim();
    if model_id.is_empty() {
        return None;
    }
    if model_id.contains('/') || provider_id.is_empty() {
        return Some(model_id.to_string());
    }
    Some(format!("{provider_id}/{model_id}"))
}

fn model_variant_key(model_id: &str) -> String {
    canonical_variant_key(model_id.trim())
}

fn normalized_custom_provider_npm(id: &str, entry: &CustomProviderEntry) -> Option<String> {
    if should_use_openai_compatible_npm(id, entry) {
        return Some(DEFAULT_CUSTOM_PROVIDER_NPM.to_string());
    }

    entry
        .npm
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn should_use_openai_compatible_npm(id: &str, entry: &CustomProviderEntry) -> bool {
    let npm = entry
        .npm
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let id_or_name_mentions_litellm = id.to_ascii_lowercase().contains("litellm")
        || entry
            .name
            .as_deref()
            .map(|name| name.to_ascii_lowercase().contains("litellm"))
            .unwrap_or(false);
    let endpoint_mentions_litellm = entry
        .options
        .base_url
        .as_deref()
        .map(|base_url| {
            base_url.to_ascii_lowercase().contains("litellm")
                || Url::parse(base_url)
                    .ok()
                    .and_then(|url| url.host_str().map(|host| host.to_ascii_lowercase()))
                    .map(|host| host.contains("litellm"))
                    .unwrap_or(false)
        })
        .unwrap_or(false);

    (id_or_name_mentions_litellm || endpoint_mentions_litellm)
        && matches!(npm, None | Some(LEGACY_CUSTOM_PROVIDER_NPM))
}

fn normalize_custom_provider_entries(config: &mut CliConfig) {
    if let Some(custom_providers) = config.provider.custom_providers.as_mut() {
        for (id, entry) in custom_providers.iter_mut() {
            entry.npm = normalized_custom_provider_npm(id, entry);
        }
    }
}

fn mask_custom_provider_key(entry: &mut CustomProviderEntry) {
    if let Some(ref key) = entry.options.api_key {
        entry.options.api_key = Some(mask_key(key));
    }
}

async fn try_read_openteams_cli_config_from_disk()
-> Result<OpenTeamsCliConfig, Box<dyn std::error::Error + Send + Sync>> {
    let path = OpenTeamsCliConfig::config_path()
        .ok_or("Cannot determine openteams-cli config directory")?;

    if !path.exists() {
        return Ok(OpenTeamsCliConfig::default());
    }

    let content = fs::read_to_string(&path).await?;
    parse_openteams_cli_config_content(&content)
}

fn parse_openteams_cli_config_content(
    content: &str,
) -> Result<OpenTeamsCliConfig, Box<dyn std::error::Error + Send + Sync>> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Ok(OpenTeamsCliConfig::default());
    }

    match jsonc_parser::parse_to_serde_value(trimmed, &ParseOptions::default()) {
        Ok(Some(value)) => {
            let config = serde_json::from_value(value)?;
            return Ok(config);
        }
        Ok(None) => return Ok(OpenTeamsCliConfig::default()),
        Err(err) => {
            tracing::debug!(?err, "Failed to parse openteams-cli config as JSONC");
        }
    }

    let config: OpenTeamsCliConfig = serde_json::from_str(trimmed).or_else(|e| {
        let cleaned = remove_json_trailing_commas(trimmed);
        serde_json::from_str(&cleaned).map_err(|_| e)
    })?;
    Ok(config)
}

fn remove_json_trailing_commas(json: &str) -> String {
    let mut result = String::with_capacity(json.len());
    let mut in_string = false;
    let mut escape_next = false;
    let chars: Vec<char> = json.chars().collect();

    for i in 0..chars.len() {
        let c = chars[i];

        if escape_next {
            result.push(c);
            escape_next = false;
            continue;
        }

        if c == '\\' && in_string {
            result.push(c);
            escape_next = true;
            continue;
        }

        if c == '"' && !escape_next {
            in_string = !in_string;
            result.push(c);
            continue;
        }

        if in_string {
            result.push(c);
            continue;
        }

        // Check for trailing comma before ] or }
        if c == ',' {
            // Look ahead for the next non-whitespace character
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && (chars[j] == ']' || chars[j] == '}') {
                // Skip this trailing comma
                continue;
            }
        }

        result.push(c);
    }

    result
}

async fn write_openteams_cli_config_to_disk(
    config: &OpenTeamsCliConfig,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = OpenTeamsCliConfig::config_path()
        .ok_or("Cannot determine openteams-cli config directory")?;

    let content = serde_json::to_string_pretty(config)?;

    // 复用安全写入逻辑（Windows 上 fs::rename 不能覆盖已有文件）
    write_secure_cli_config_file(path, content).await?;

    Ok(())
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub configured: bool,
}

/// List available providers with configuration status
async fn list_cli_providers(
    State(_deployment): State<DeploymentImpl>,
) -> ResponseJson<ApiResponse<Vec<ProviderInfo>>> {
    let config = read_cli_config_from_disk().await;
    let providers = vec![
        ProviderInfo {
            id: "anthropic".into(),
            name: "Anthropic".into(),
            configured: config
                .provider
                .anthropic
                .as_ref()
                .and_then(|p| p.api_key.as_ref())
                .map(|k| !k.is_empty())
                .unwrap_or(false),
        },
        ProviderInfo {
            id: "openai".into(),
            name: "OpenAI".into(),
            configured: config
                .provider
                .openai
                .as_ref()
                .and_then(|p| p.api_key.as_ref())
                .map(|k| !k.is_empty())
                .unwrap_or(false),
        },
        ProviderInfo {
            id: "google".into(),
            name: "Google".into(),
            configured: config
                .provider
                .google
                .as_ref()
                .and_then(|p| p.api_key.as_ref())
                .map(|k| !k.is_empty())
                .unwrap_or(false),
        },
        ProviderInfo {
            id: "openrouter".into(),
            name: "OpenRouter".into(),
            configured: config
                .provider
                .openrouter
                .as_ref()
                .and_then(|p| p.api_key.as_ref())
                .map(|k| !k.is_empty())
                .unwrap_or(false),
        },
        ProviderInfo {
            id: "ollama".into(),
            name: "Ollama".into(),
            configured: config.provider.ollama.is_some(),
        },
        ProviderInfo {
            id: "custom".into(),
            name: "Custom Provider".into(),
            configured: config
                .provider
                .custom
                .as_ref()
                .and_then(|p| p.endpoint.as_ref())
                .map(|e| !e.is_empty())
                .unwrap_or(false),
        },
    ];
    ResponseJson(ApiResponse::success(providers))
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}

/// List models for a specific provider
async fn list_provider_models(
    Path(provider): Path<String>,
) -> ResponseJson<ApiResponse<Vec<ModelInfo>>> {
    let models = match provider.as_str() {
        "anthropic" => vec![
            ModelInfo {
                id: "claude-opus-4-20250514".into(),
                name: "Claude Opus 4".into(),
            },
            ModelInfo {
                id: "claude-sonnet-4-20250514".into(),
                name: "Claude Sonnet 4".into(),
            },
            ModelInfo {
                id: "claude-haiku-4-20250506".into(),
                name: "Claude Haiku 4".into(),
            },
            ModelInfo {
                id: "claude-3-5-sonnet-20241022".into(),
                name: "Claude 3.5 Sonnet".into(),
            },
        ],
        "openai" => vec![
            ModelInfo {
                id: "gpt-4o".into(),
                name: "GPT-4o".into(),
            },
            ModelInfo {
                id: "gpt-4o-mini".into(),
                name: "GPT-4o Mini".into(),
            },
            ModelInfo {
                id: "o3".into(),
                name: "o3".into(),
            },
            ModelInfo {
                id: "o4-mini".into(),
                name: "o4-mini".into(),
            },
        ],
        "google" => vec![
            ModelInfo {
                id: "gemini-2.5-pro".into(),
                name: "Gemini 2.5 Pro".into(),
            },
            ModelInfo {
                id: "gemini-2.5-flash".into(),
                name: "Gemini 2.5 Flash".into(),
            },
            ModelInfo {
                id: "gemini-2.0-flash".into(),
                name: "Gemini 2.0 Flash".into(),
            },
        ],
        "openrouter" => vec![
            ModelInfo {
                id: "anthropic/claude-sonnet-4-20250514".into(),
                name: "Claude Sonnet 4 (via OpenRouter)".into(),
            },
            ModelInfo {
                id: "openai/gpt-4o".into(),
                name: "GPT-4o (via OpenRouter)".into(),
            },
            ModelInfo {
                id: "google/gemini-2.5-pro".into(),
                name: "Gemini 2.5 Pro (via OpenRouter)".into(),
            },
        ],
        "ollama" => vec![
            ModelInfo {
                id: "llama3.3".into(),
                name: "Llama 3.3".into(),
            },
            ModelInfo {
                id: "qwen2.5-coder".into(),
                name: "Qwen 2.5 Coder".into(),
            },
            ModelInfo {
                id: "deepseek-coder-v2".into(),
                name: "DeepSeek Coder V2".into(),
            },
        ],
        _ => vec![],
    };
    ResponseJson(ApiResponse::success(models))
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct ValidateProviderRequest {
    pub api_key: Option<String>,
    pub endpoint: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct ValidateProviderResponse {
    pub valid: bool,
    pub message: String,
}

const VALIDATION_TIMEOUT: Duration = Duration::from_secs(10);
const VALIDATION_CONNECTION_FAILED_MESSAGE: &str =
    "Connection test failed. Check the endpoint and credentials.";
const DEFAULT_ANTHROPIC_ENDPOINT: &str = "https://api.anthropic.com/";
const DEFAULT_OPENAI_ENDPOINT: &str = "https://api.openai.com/v1/";
const DEFAULT_GOOGLE_ENDPOINT: &str = "https://generativelanguage.googleapis.com/";
const DEFAULT_OPENROUTER_ENDPOINT: &str = "https://openrouter.ai/api/v1/";
const DEFAULT_OLLAMA_ENDPOINT: &str = "http://localhost:11434/";
const DEFAULT_CUSTOM_PROVIDER_NPM: &str = "@ai-sdk/anthropic";
const LEGACY_CUSTOM_PROVIDER_NPM: &str = "@ai-sdk/anthropic";
const AUTO_MODEL_VARIANT_PREFIX: &str = "AUTO_MODEL_";

struct ValidationRequestSpec {
    url: Url,
    auth_header: Option<(&'static str, String)>,
    dns_override: Option<(String, Vec<SocketAddr>)>,
}

fn validation_result(
    valid: bool,
    message: impl Into<String>,
) -> ResponseJson<ApiResponse<ValidateProviderResponse>> {
    ResponseJson(ApiResponse::success(ValidateProviderResponse {
        valid,
        message: message.into(),
    }))
}

fn normalize_validation_api_key(api_key: Option<&str>) -> Option<String> {
    api_key
        .map(str::trim)
        .filter(|key| !key.is_empty() && !key.contains("***"))
        .map(ToOwned::to_owned)
}

fn saved_provider_api_key(config: &CliConfig, provider: &str) -> Option<String> {
    match provider {
        "anthropic" => config.provider.anthropic.as_ref()?.api_key.clone(),
        "openai" => config.provider.openai.as_ref()?.api_key.clone(),
        "google" => config.provider.google.as_ref()?.api_key.clone(),
        "openrouter" => config.provider.openrouter.as_ref()?.api_key.clone(),
        "custom" => config.provider.custom.as_ref()?.api_key.clone(),
        other => config
            .provider
            .custom_providers
            .as_ref()
            .and_then(|p| p.get(other))
            .and_then(|e| e.options.api_key.clone()),
    }
}

fn ensure_trailing_slash(url: &mut Url) {
    let path = url.path();
    if path.is_empty() {
        url.set_path("/");
    } else if !path.ends_with('/') {
        let next = format!("{path}/");
        url.set_path(&next);
    }
}

fn parse_endpoint_url(raw: &str) -> Result<Url, String> {
    let mut url = Url::parse(raw).map_err(|_| "Endpoint URL is invalid".to_string())?;

    if !url.username().is_empty() || url.password().is_some() {
        return Err("Endpoint URL cannot include credentials".into());
    }

    if url.query().is_some() || url.fragment().is_some() {
        return Err("Endpoint URL cannot include query parameters or fragments".into());
    }

    if url.host().is_none() {
        return Err("Endpoint URL must include a host".into());
    }

    ensure_trailing_slash(&mut url);
    Ok(url)
}

fn validate_known_https_endpoint(raw: &str, allowed_hosts: &[&str]) -> Result<Url, String> {
    let url = parse_endpoint_url(raw)?;

    if url.scheme() != "https" {
        return Err("Endpoint must use HTTPS".into());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "Endpoint URL must include a host".to_string())?;
    if !allowed_hosts
        .iter()
        .any(|allowed| host.eq_ignore_ascii_case(allowed))
    {
        return Err("Endpoint host is not allowed for this provider".into());
    }

    if let Some(port) = url.port()
        && port != 443
    {
        return Err("Endpoint port is not allowed for this provider".into());
    }

    Ok(url)
}

fn validate_ollama_endpoint(raw: &str) -> Result<Url, String> {
    let url = parse_endpoint_url(raw)?;

    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Ollama endpoint must use HTTP or HTTPS".into());
    }

    Ok(url)
}

async fn validate_custom_endpoint(raw: &str) -> Result<Url, String> {
    let url = parse_endpoint_url(raw)?;

    if url.scheme() != "https" {
        return Err("Custom provider endpoint must use HTTPS".into());
    }

    Ok(url)
}

async fn resolve_validation_host(url: &Url) -> Result<Option<(String, Vec<SocketAddr>)>, String> {
    let Some(host) = url.host() else {
        return Err("Endpoint URL must include a host".into());
    };

    let port = url
        .port_or_known_default()
        .ok_or_else(|| "Endpoint URL must include a valid port".to_string())?;

    match host {
        Host::Domain(domain) => {
            let addrs = tokio::net::lookup_host((domain, port))
                .await
                .map_err(|_| "Endpoint host could not be resolved".to_string())?
                .collect::<Vec<_>>();

            if addrs.is_empty() {
                return Err("Endpoint host could not be resolved".into());
            }

            Ok(Some((domain.to_ascii_lowercase(), addrs)))
        }
        Host::Ipv4(_) => Ok(None),
        Host::Ipv6(_) => Ok(None),
    }
}

async fn validation_request_spec(
    url: Url,
    auth_header: Option<(&'static str, String)>,
) -> Result<ValidationRequestSpec, String> {
    let dns_override = resolve_validation_host(&url).await?;
    Ok(ValidationRequestSpec {
        url,
        auth_header,
        dns_override,
    })
}

fn join_validation_url(base: Url, relative_path: &str) -> Result<Url, String> {
    base.join(relative_path)
        .map_err(|_| "Failed to build provider validation request".to_string())
}

async fn build_validation_request(
    provider: &str,
    req: &ValidateProviderRequest,
    api_key: &str,
) -> Result<ValidationRequestSpec, String> {
    match provider {
        "anthropic" => {
            let url = join_validation_url(
                validate_known_https_endpoint(
                    req.endpoint
                        .as_deref()
                        .filter(|endpoint| !endpoint.is_empty())
                        .unwrap_or(DEFAULT_ANTHROPIC_ENDPOINT),
                    &["api.anthropic.com"],
                )?,
                "v1/models",
            )?;
            validation_request_spec(url, Some(("x-api-key", api_key.to_string()))).await
        }
        "openai" => {
            tracing::debug!("openai matched");
            let url = join_validation_url(
                validate_known_https_endpoint(
                    req.endpoint
                        .as_deref()
                        .filter(|endpoint| !endpoint.is_empty())
                        .unwrap_or(DEFAULT_OPENAI_ENDPOINT),
                    &["api.openai.com"],
                )?,
                "models",
            )?;
            validation_request_spec(url, Some(("Authorization", format!("Bearer {api_key}")))).await
        }
        "google" => {
            let url = join_validation_url(
                validate_known_https_endpoint(
                    req.endpoint
                        .as_deref()
                        .filter(|endpoint| !endpoint.is_empty())
                        .unwrap_or(DEFAULT_GOOGLE_ENDPOINT),
                    &["generativelanguage.googleapis.com"],
                )?,
                "v1beta/models",
            )?;
            validation_request_spec(url, Some(("x-goog-api-key", api_key.to_string()))).await
        }
        "openrouter" => {
            let url = join_validation_url(
                validate_known_https_endpoint(
                    req.endpoint
                        .as_deref()
                        .filter(|endpoint| !endpoint.is_empty())
                        .unwrap_or(DEFAULT_OPENROUTER_ENDPOINT),
                    &["openrouter.ai"],
                )?,
                "models",
            )?;
            validation_request_spec(url, Some(("Authorization", format!("Bearer {api_key}")))).await
        }
        "ollama" => {
            let url = join_validation_url(
                validate_ollama_endpoint(
                    req.endpoint
                        .as_deref()
                        .filter(|endpoint| !endpoint.is_empty())
                        .unwrap_or(DEFAULT_OLLAMA_ENDPOINT),
                )?,
                "api/tags",
            )?;
            validation_request_spec(url, None).await
        }
        "custom" => {
            tracing::debug!("custom matched");
            let endpoint = req
                .endpoint
                .as_deref()
                .filter(|endpoint| !endpoint.is_empty())
                .ok_or_else(|| "Custom provider requires an endpoint URL".to_string())?;
            let url = join_validation_url(validate_custom_endpoint(endpoint).await?, "models")?;
            let auth_header = if api_key.is_empty() {
                None
            } else {
                Some(("Authorization", format!("Bearer {api_key}")))
            };
            validation_request_spec(url, auth_header).await
        }
        _ => Err(format!("Unknown provider: {provider}")),
    }
}

/// Validate provider credentials (basic connectivity check)
async fn validate_provider(
    Path(provider): Path<String>,
    Json(req): Json<ValidateProviderRequest>,
) -> ResponseJson<ApiResponse<ValidateProviderResponse>> {
    let request_api_key = normalize_validation_api_key(req.api_key.as_deref());
    let stored_config = if request_api_key.is_none() {
        Some(read_cli_config_from_disk().await)
    } else {
        None
    };
    tracing::debug!(
        provider =  ?provider,
        "provider"
    );
    let api_key = request_api_key
        .or_else(|| {
            stored_config
                .as_ref()
                .and_then(|config| saved_provider_api_key(config, provider.as_str()))
        })
        .unwrap_or_default();

    // Providers that require an API key
    let requires_api_key = matches!(
        provider.as_str(),
        "anthropic" | "openai" | "google" | "openrouter"
    );
    if requires_api_key && api_key.is_empty() {
        return validation_result(false, "API key is required");
    }

    let spec = match build_validation_request(provider.as_str(), &req, &api_key).await {
        Ok(spec) => spec,
        Err(message) => return validation_result(false, message),
    };

    let mut client_builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none());
    if let Some((domain, addrs)) = &spec.dns_override {
        client_builder = client_builder.resolve_to_addrs(domain, addrs);
    }

    let client = match client_builder.build() {
        Ok(client) => client,
        Err(err) => {
            tracing::warn!(provider = %provider, %err, "failed to build validation client");
            return validation_result(false, VALIDATION_CONNECTION_FAILED_MESSAGE);
        }
    };

    let mut request = client.get(spec.url.clone()).timeout(VALIDATION_TIMEOUT);
    if let Some((header_name, header_value)) = spec.auth_header {
        request = request.header(header_name, header_value);
    }

    match request.send().await {
        Ok(resp) if resp.status().is_success() => validation_result(true, "Connection successful"),
        Ok(resp) => {
            tracing::warn!(
                provider = %provider,
                status = %resp.status(),
                "provider validation returned non-success status"
            );
            validation_result(false, format!("API returned status {}", resp.status()))
        }
        Err(err) => {
            tracing::warn!(
                provider = %provider,
                is_connect = err.is_connect(),
                is_timeout = err.is_timeout(),
                "provider validation request failed"
            );
            validation_result(false, VALIDATION_CONNECTION_FAILED_MESSAGE)
        }
    }
}

// ── CLI Config Helpers ───────────────────────────────────────────────

async fn read_cli_config_from_disk() -> CliConfig {
    try_read_cli_config_from_disk()
        .await
        .unwrap_or_else(|_| CliConfig::default_config())
}

async fn try_read_cli_config_from_disk()
-> Result<CliConfig, Box<dyn std::error::Error + Send + Sync>> {
    let path = CliConfig::config_path().ok_or("Cannot determine home directory")?;
    let content = fs::read_to_string(&path).await?;
    let mut config: CliConfig = toml::from_str(&content)?;
    normalize_custom_provider_entries(&mut config);
    Ok(config)
}

async fn write_cli_config_to_disk(
    config: &CliConfig,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = CliConfig::config_path().ok_or("Cannot determine home directory")?;
    let mut normalized = config.clone();
    normalize_custom_provider_entries(&mut normalized);
    let content = toml::to_string_pretty(&normalized)?;
    write_secure_cli_config_file(path, content).await?;
    Ok(())
}

async fn write_secure_cli_config_file(
    path: PathBuf,
    content: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tokio::task::spawn_blocking(move || write_secure_cli_config_file_sync(&path, &content))
        .await
        .map_err(|err| -> Box<dyn std::error::Error + Send + Sync> { Box::new(err) })?
        .map_err(|err| -> Box<dyn std::error::Error + Send + Sync> { Box::new(err) })?;
    Ok(())
}

fn ensure_cli_config_parent_dir(path: &StdPath) -> std::io::Result<()> {
    std::fs::create_dir_all(path)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }

    Ok(())
}

fn set_cli_config_file_permissions(_path: &StdPath) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(_path, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

#[cfg(windows)]
fn replace_file_atomically(from: &StdPath, to: &StdPath) -> std::io::Result<()> {
    use std::{iter, os::windows::ffi::OsStrExt};

    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let from_wide = from
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let to_wide = to
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();

    let result = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if result == 0 {
        return Err(std::io::Error::last_os_error());
    }

    Ok(())
}

#[cfg(not(windows))]
fn replace_file_atomically(from: &StdPath, to: &StdPath) -> std::io::Result<()> {
    std::fs::rename(from, to)
}

fn write_secure_cli_config_file_sync(path: &StdPath, content: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        ensure_cli_config_parent_dir(parent)?;
    }

    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "config.toml".to_string());

    let temp_path = path.with_file_name(format!(".{file_name}.{}.tmp", Uuid::new_v4()));

    let write_result = (|| -> std::io::Result<()> {
        let file = {
            let mut opts = std::fs::OpenOptions::new();
            opts.create_new(true).write(true);

            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }

            opts.open(&temp_path)?
        };

        use std::io::Write;
        let mut file = file;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        set_cli_config_file_permissions(&temp_path)?;
        Ok(())
    })();

    if let Err(err) = write_result {
        let _ = std::fs::remove_file(&temp_path);
        return Err(err);
    }

    if let Err(err) = replace_file_atomically(&temp_path, path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(err);
    }

    set_cli_config_file_permissions(path)?;

    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        std::fs::File::open(parent)?.sync_all()?;
    }

    Ok(())
}

/// Mask an API key: show first 6 and last 4 chars, replace middle with ***
fn mask_key(key: &str) -> String {
    if key.len() <= 10 {
        return "***".to_string();
    }
    format!("{}***{}", &key[..6], &key[key.len() - 4..])
}

fn mask_api_keys(mut config: CliConfig) -> CliConfig {
    fn mask_provider_key(key: &mut Option<String>) {
        if let Some(k) = key.as_ref() {
            *key = Some(mask_key(k));
        }
    }

    if let Some(p) = config.provider.anthropic.as_mut() {
        mask_provider_key(&mut p.api_key);
    }
    if let Some(p) = config.provider.openai.as_mut() {
        mask_provider_key(&mut p.api_key);
    }
    if let Some(p) = config.provider.google.as_mut() {
        mask_provider_key(&mut p.api_key);
    }
    if let Some(p) = config.provider.openrouter.as_mut() {
        mask_provider_key(&mut p.api_key);
    }
    if let Some(p) = config.provider.custom.as_mut() {
        mask_provider_key(&mut p.api_key);
    }
    if let Some(providers) = config.provider.custom_providers.as_mut() {
        for entry in providers.values_mut() {
            mask_custom_provider_key(entry);
        }
    }
    config
}

/// If user sends a masked key back (contains "***"), keep the old real key
fn merge_masked_keys(new_config: &mut CliConfig, old_config: &CliConfig) {
    fn keep_old_if_masked(new_key: &mut Option<String>, old_key: &Option<String>) {
        if let (Some(nk), Some(ok)) = (new_key.as_ref(), old_key.as_ref())
            && nk.contains("***")
        {
            *new_key = Some(ok.clone());
        }
    }

    if let (Some(np), Some(op)) = (
        new_config.provider.anthropic.as_mut(),
        old_config.provider.anthropic.as_ref(),
    ) {
        keep_old_if_masked(&mut np.api_key, &op.api_key);
    }
    if let (Some(np), Some(op)) = (
        new_config.provider.openai.as_mut(),
        old_config.provider.openai.as_ref(),
    ) {
        keep_old_if_masked(&mut np.api_key, &op.api_key);
    }
    if let (Some(np), Some(op)) = (
        new_config.provider.google.as_mut(),
        old_config.provider.google.as_ref(),
    ) {
        keep_old_if_masked(&mut np.api_key, &op.api_key);
    }
    if let (Some(np), Some(op)) = (
        new_config.provider.openrouter.as_mut(),
        old_config.provider.openrouter.as_ref(),
    ) {
        keep_old_if_masked(&mut np.api_key, &op.api_key);
    }
    if let (Some(np), Some(op)) = (
        new_config.provider.custom.as_mut(),
        old_config.provider.custom.as_ref(),
    ) {
        keep_old_if_masked(&mut np.api_key, &op.api_key);
    }
    if let (Some(new_providers), Some(old_providers)) = (
        new_config.provider.custom_providers.as_mut(),
        old_config.provider.custom_providers.as_ref(),
    ) {
        for (id, new_entry) in new_providers.iter_mut() {
            if let Some(old_entry) = old_providers.get(id) {
                keep_old_if_masked(&mut new_entry.options.api_key, &old_entry.options.api_key);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn temp_test_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("openteams-config-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("failed to create temp test dir");
        dir.join(name)
    }

    #[tokio::test]
    async fn google_validation_request_keeps_api_key_out_of_url() {
        let req = ValidateProviderRequest {
            api_key: Some("secret-key".into()),
            endpoint: None,
        };

        let spec = build_validation_request("google", &req, "secret-key")
            .await
            .expect("expected validation request");

        assert_eq!(
            spec.url.as_str(),
            "https://generativelanguage.googleapis.com/v1beta/models"
        );
        assert_eq!(
            spec.auth_header,
            Some(("x-goog-api-key", "secret-key".to_string()))
        );
        assert!(spec.url.query().is_none());
    }

    #[tokio::test]
    async fn custom_validation_allows_private_ip_endpoints() {
        let req = ValidateProviderRequest {
            api_key: None,
            endpoint: Some("https://127.0.0.1:8443/".into()),
        };

        let spec = build_validation_request("custom", &req, "")
            .await
            .expect("expected custom endpoint to be accepted");

        assert_eq!(spec.url.as_str(), "https://127.0.0.1:8443/models");
        assert!(spec.dns_override.is_none());
    }

    #[tokio::test]
    async fn custom_validation_allows_localhost_endpoints() {
        let req = ValidateProviderRequest {
            api_key: None,
            endpoint: Some("https://localhost:8443/".into()),
        };

        let spec = build_validation_request("custom", &req, "")
            .await
            .expect("expected localhost custom endpoint to be accepted");

        let (host, addrs) = spec
            .dns_override
            .expect("localhost should still resolve to concrete addresses");
        assert_eq!(host, "localhost");
        assert!(!addrs.is_empty());
    }

    #[tokio::test]
    async fn ollama_validation_allows_private_ip_endpoints() {
        let req = ValidateProviderRequest {
            api_key: None,
            endpoint: Some("http://192.168.1.10:11434/".into()),
        };

        let spec = build_validation_request("ollama", &req, "")
            .await
            .expect("expected private ollama endpoint to be accepted");

        assert_eq!(spec.url.as_str(), "http://192.168.1.10:11434/api/tags");
        assert!(spec.dns_override.is_none());
    }

    #[tokio::test]
    async fn ollama_validation_request_pins_loopback_resolution() {
        let req = ValidateProviderRequest {
            api_key: None,
            endpoint: Some("http://localhost:11434/".into()),
        };

        let spec = build_validation_request("ollama", &req, "")
            .await
            .expect("expected validation request");

        let (host, addrs) = spec
            .dns_override
            .expect("localhost should be pinned to resolved loopback addresses");
        assert_eq!(host, "localhost");
        assert!(!addrs.is_empty());
        assert!(addrs.iter().all(|addr| addr.ip().is_loopback()));
    }

    #[test]
    fn saved_provider_api_key_reuses_stored_secret_when_request_key_is_masked() {
        let mut config = CliConfig::default_config();
        config.provider.anthropic = Some(services::services::cli_config::ProviderCredentials {
            api_key: Some("live-secret".into()),
            endpoint: None,
        });

        let request_key = normalize_validation_api_key(Some("live***cret"));
        let resolved = request_key.or_else(|| saved_provider_api_key(&config, "anthropic"));

        assert_eq!(resolved.as_deref(), Some("live-secret"));
    }

    #[test]
    fn normalize_custom_provider_entries_fixes_legacy_litellm_npm() {
        let mut config = CliConfig::default_config();
        config.provider.custom_providers = Some(HashMap::from([(
            "litellm".to_string(),
            CustomProviderEntry {
                id: "litellm".into(),
                name: Some("LITELLM".into()),
                npm: Some(LEGACY_CUSTOM_PROVIDER_NPM.into()),
                options: services::services::cli_config::CustomProviderOptions {
                    base_url: Some("https://litellm.example.com/v1".into()),
                    api_key: Some("secret".into()),
                    timeout: None,
                },
                models: None,
            },
        )]));

        normalize_custom_provider_entries(&mut config);

        assert_eq!(
            config
                .provider
                .custom_providers
                .as_ref()
                .and_then(|providers| providers.get("litellm"))
                .and_then(|provider| provider.npm.as_deref()),
            Some(DEFAULT_CUSTOM_PROVIDER_NPM)
        );
    }

    #[test]
    fn normalize_custom_provider_entries_keeps_non_litellm_anthropic_provider() {
        let mut config = CliConfig::default_config();
        config.provider.custom_providers = Some(HashMap::from([(
            "anthropic-proxy".to_string(),
            CustomProviderEntry {
                id: "anthropic-proxy".into(),
                name: Some("Anthropic Proxy".into()),
                npm: Some(LEGACY_CUSTOM_PROVIDER_NPM.into()),
                options: services::services::cli_config::CustomProviderOptions {
                    base_url: Some("https://api.anthropic.com".into()),
                    api_key: Some("secret".into()),
                    timeout: None,
                },
                models: None,
            },
        )]));

        normalize_custom_provider_entries(&mut config);

        assert_eq!(
            config
                .provider
                .custom_providers
                .as_ref()
                .and_then(|providers| providers.get("anthropic-proxy"))
                .and_then(|provider| provider.npm.as_deref()),
            Some(LEGACY_CUSTOM_PROVIDER_NPM)
        );
    }

    #[test]
    fn sync_requested_provider_to_cli_config_skips_legacy_custom_when_default_is_builtin() {
        let mut cli_config = OpenTeamsCliConfig::default();
        let mut app_config = CliConfig::default_config();
        app_config.provider.default = "anthropic".into();
        app_config.provider.custom = Some(services::services::cli_config::CustomProviderConfig {
            name: Some("Legacy Custom".into()),
            endpoint: Some("https://custom.example.com/v1".into()),
            api_key: Some("secret".into()),
        });

        sync_requested_provider_to_cli_config(&mut cli_config, &app_config, None);

        assert!(cli_config.provider.is_none());
    }

    fn build_test_openteams_cli_config(
        models: &[&str],
        default_model: Option<&str>,
    ) -> OpenTeamsCliConfig {
        OpenTeamsCliConfig {
            provider: Some(HashMap::from([(
                "litellm".to_string(),
                OpenTeamsCliProviderConfig {
                    npm: Some(DEFAULT_CUSTOM_PROVIDER_NPM.into()),
                    name: Some("LiteLLM".into()),
                    options: Some(OpenTeamsCliProviderOptions {
                        api_key: Some("secret".into()),
                        base_url: Some("https://litellm.example.com/v1".into()),
                        timeout: None,
                        chunk_timeout: None,
                        enterprise_url: None,
                        set_cache_key: None,
                    }),
                    models: Some(
                        models
                            .iter()
                            .map(|model_id| {
                                (
                                    (*model_id).to_string(),
                                    services::services::cli_config::OpenTeamsCliModelConfig {
                                        name: Some((*model_id).to_string()),
                                        modalities: None,
                                        options: None,
                                        limit: None,
                                        variants: None,
                                    },
                                )
                            })
                            .collect(),
                    ),
                    whitelist: None,
                    blacklist: None,
                },
            )])),
            model: default_model.map(str::to_string),
            ..OpenTeamsCliConfig::default()
        }
    }

    #[test]
    fn sync_openteams_cli_models_into_profiles_replaces_builtin_variants() {
        let mut profiles = ExecutorConfigs::from_defaults();
        let cli_config = build_test_openteams_cli_config(
            &["gpt-4o", "claude-sonnet-4-20250514", "gemini-2.5-pro"],
            Some("litellm/gpt-4o"),
        );

        let changed = sync_openteams_cli_models_into_profiles(&mut profiles, &cli_config);

        assert!(changed);

        let executor_config = profiles
            .executors
            .get(&BaseCodingAgent::OpenTeamsCli)
            .expect("OpenTeams CLI executor should exist");
        assert!(!executor_config.configurations.contains_key("PLAN"));
        assert!(!executor_config.configurations.contains_key("APPROVALS"));
        assert_eq!(executor_config.configurations.len(), 4);
        match executor_config
            .get_default()
            .expect("OpenTeams CLI default config should exist")
        {
            executors::executors::CodingAgent::OpenTeamsCli(config) => {
                assert_eq!(config.model, None);
                assert_eq!(config.variant, None);
                assert_eq!(config.agent, None);
            }
            other => panic!("expected OpenTeams CLI config, got {other:?}"),
        }

        let default_variant_key = model_variant_key("litellm/gpt-4o");
        let claude_variant_key = model_variant_key("litellm/claude-sonnet-4-20250514");
        let gemini_variant_key = model_variant_key("litellm/gemini-2.5-pro");
        assert!(
            executor_config
                .configurations
                .contains_key(&default_variant_key)
        );
        assert!(
            executor_config
                .configurations
                .contains_key(&claude_variant_key)
        );
        assert!(
            executor_config
                .configurations
                .contains_key(&gemini_variant_key)
        );

        match executor_config
            .configurations
            .get(&claude_variant_key)
            .expect("Claude variant should exist")
        {
            executors::executors::CodingAgent::OpenTeamsCli(config) => {
                assert_eq!(
                    config.model.as_deref(),
                    Some("litellm/claude-sonnet-4-20250514")
                );
            }
            other => panic!("expected OpenTeams CLI config, got {other:?}"),
        }
    }

    #[test]
    fn sync_openteams_cli_models_into_profiles_keeps_generic_default_on_resync() {
        let mut profiles = ExecutorConfigs::from_defaults();
        let cli_config = build_test_openteams_cli_config(
            &["gpt-4o", "claude-sonnet-4-20250514"],
            Some("litellm/gpt-4o"),
        );

        assert!(sync_openteams_cli_models_into_profiles(
            &mut profiles,
            &cli_config
        ));

        assert!(!sync_openteams_cli_models_into_profiles(
            &mut profiles,
            &cli_config
        ));

        let executor_config = profiles
            .executors
            .get(&BaseCodingAgent::OpenTeamsCli)
            .expect("OpenTeams CLI executor should exist");

        match executor_config
            .get_default()
            .expect("OpenTeams CLI default config should exist")
        {
            executors::executors::CodingAgent::OpenTeamsCli(config) => {
                assert_eq!(config.model, None);
                assert_eq!(config.variant, None);
                assert_eq!(config.agent, None);
            }
            other => panic!("expected OpenTeams CLI config, got {other:?}"),
        }

        let gpt_variant_key = model_variant_key("litellm/gpt-4o");
        let claude_variant_key = model_variant_key("litellm/claude-sonnet-4-20250514");
        assert!(
            executor_config
                .configurations
                .contains_key(&gpt_variant_key)
        );
        assert!(
            executor_config
                .configurations
                .contains_key(&claude_variant_key)
        );
    }

    #[test]
    fn sync_openteams_cli_models_into_profiles_removes_deleted_custom_models() {
        let mut profiles = ExecutorConfigs::from_defaults();
        let mut cli_config = build_test_openteams_cli_config(
            &["gpt-4o", "claude-sonnet-4-20250514"],
            Some("litellm/gpt-4o"),
        );

        assert!(sync_openteams_cli_models_into_profiles(
            &mut profiles,
            &cli_config
        ));

        cli_config
            .provider
            .as_mut()
            .and_then(|providers| providers.get_mut("litellm"))
            .and_then(|provider| provider.models.as_mut())
            .expect("custom provider models should exist")
            .remove("claude-sonnet-4-20250514");

        assert!(sync_openteams_cli_models_into_profiles(
            &mut profiles,
            &cli_config
        ));

        let executor_config = profiles
            .executors
            .get(&BaseCodingAgent::OpenTeamsCli)
            .expect("OpenTeams CLI executor should exist");
        let gpt_variant_key = model_variant_key("litellm/gpt-4o");
        let claude_variant_key = model_variant_key("litellm/claude-sonnet-4-20250514");

        assert!(
            executor_config
                .configurations
                .contains_key(&gpt_variant_key)
        );
        assert!(
            !executor_config
                .configurations
                .contains_key(&claude_variant_key)
        );
    }

    #[test]
    fn sync_openteams_cli_models_into_profiles_keeps_all_models_from_provider_map() {
        let mut profiles = ExecutorConfigs::from_defaults();
        let cli_config = build_test_openteams_cli_config(
            &["gpt-5.3-codex-2026-02-24", "gpt-5.4-2026-03-05"],
            Some("codingplane/glm-5"),
        );

        assert!(sync_openteams_cli_models_into_profiles(
            &mut profiles,
            &cli_config
        ));

        let executor_config = profiles
            .executors
            .get(&BaseCodingAgent::OpenTeamsCli)
            .expect("OpenTeams CLI executor should exist");
        let gpt53_variant_key = model_variant_key("litellm/gpt-5.3-codex-2026-02-24");
        let gpt54_variant_key = model_variant_key("litellm/gpt-5.4-2026-03-05");
        let default_variant_key = model_variant_key("codingplane/glm-5");

        assert!(
            executor_config
                .configurations
                .contains_key(&gpt53_variant_key)
        );
        assert!(
            executor_config
                .configurations
                .contains_key(&gpt54_variant_key)
        );
        assert!(
            executor_config
                .configurations
                .contains_key(&default_variant_key)
        );
    }

    #[test]
    fn openteams_cli_provider_options_serialize_with_camel_case_keys() {
        let options = OpenTeamsCliProviderOptions {
            api_key: Some("secret".into()),
            base_url: Some("https://litellm.example.com/v1".into()),
            timeout: Some(30_000),
            chunk_timeout: Some(5_000),
            enterprise_url: Some("https://ghe.example.com".into()),
            set_cache_key: Some(true),
        };

        let value = serde_json::to_value(&options).expect("serialize provider options");

        assert_eq!(
            value,
            json!({
                "apiKey": "secret",
                "baseURL": "https://litellm.example.com/v1",
                "timeout": 30_000,
                "chunkTimeout": 5_000,
                "enterpriseUrl": "https://ghe.example.com",
                "setCacheKey": true,
            })
        );
    }

    #[test]
    fn openteams_cli_provider_options_deserialize_legacy_snake_case_keys() {
        let value = json!({
            "api_key": "secret",
            "baseURL": "https://litellm.example.com/v1",
            "chunk_timeout": 5_000,
            "enterprise_url": "https://ghe.example.com",
            "set_cache_key": true,
        });

        let options: OpenTeamsCliProviderOptions =
            serde_json::from_value(value).expect("deserialize provider options");

        assert_eq!(options.api_key.as_deref(), Some("secret"));
        assert_eq!(
            options.base_url.as_deref(),
            Some("https://litellm.example.com/v1")
        );
        assert_eq!(options.chunk_timeout, Some(5_000));
        assert_eq!(
            options.enterprise_url.as_deref(),
            Some("https://ghe.example.com")
        );
        assert_eq!(options.set_cache_key, Some(true));
    }

    #[test]
    fn parse_openteams_cli_config_content_accepts_trailing_commas() {
        let config = parse_openteams_cli_config_content(
            r#"{
  "provider": {
    "custom": {
      "npm": "@acme/provider",
    },
  },
  "model": "custom/foo",
}"#,
        )
        .expect("parse openteams cli config with trailing commas");

        assert_eq!(config.model.as_deref(), Some("custom/foo"));
        assert!(
            config
                .provider
                .as_ref()
                .is_some_and(|providers| providers.contains_key("custom"))
        );
    }

    #[test]
    fn parse_openteams_cli_config_content_accepts_jsonc_comments() {
        let config = parse_openteams_cli_config_content(
            r#"{
  // preferred provider
  "provider": {
    "custom": {
      "npm": "@acme/provider"
    }
  },
  "model": "custom/foo"
}"#,
        )
        .expect("parse openteams cli config with comments");

        assert_eq!(config.model.as_deref(), Some("custom/foo"));
    }

    #[test]
    fn write_secure_cli_config_file_sync_overwrites_atomically() {
        let path = temp_test_path("config.toml");
        let first = toml::to_string_pretty(&CliConfig::default_config()).unwrap();

        write_secure_cli_config_file_sync(&path, &first).expect("first write should succeed");

        let mut updated = CliConfig::default_config();
        updated.provider.default = "openai".into();
        let second = toml::to_string_pretty(&updated).unwrap();
        write_secure_cli_config_file_sync(&path, &second).expect("second write should succeed");

        let persisted = std::fs::read_to_string(&path).expect("config should exist");
        let parsed: CliConfig = toml::from_str(&persisted).expect("config should parse");
        assert_eq!(parsed.provider.default, "openai");

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn write_secure_cli_config_file_sync_uses_restricted_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let path = temp_test_path("config.toml");
        let content = toml::to_string_pretty(&CliConfig::default_config()).unwrap();

        write_secure_cli_config_file_sync(&path, &content).expect("write should succeed");

        let mode = std::fs::metadata(&path)
            .expect("config metadata should exist")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn write_secure_cli_config_file_sync_restricts_parent_directory_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let path = temp_test_path("config.toml");
        let content = toml::to_string_pretty(&CliConfig::default_config()).unwrap();

        write_secure_cli_config_file_sync(&path, &content).expect("write should succeed");

        let dir_mode = std::fs::metadata(path.parent().unwrap())
            .expect("parent metadata should exist")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(dir_mode, 0o700);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}

async fn get_sound(Path(sound): Path<SoundFile>) -> Result<Response, ApiError> {
    let sound = sound.serve().await.map_err(DeploymentError::Other)?;
    let response = Response::builder()
        .status(http::StatusCode::OK)
        .header(
            http::header::CONTENT_TYPE,
            http::HeaderValue::from_static("audio/wav"),
        )
        .body(Body::from(sound.data.into_owned()))
        .unwrap();
    Ok(response)
}

#[derive(TS, Debug, Deserialize)]
pub struct McpServerQuery {
    executor: BaseCodingAgent,
}

#[derive(TS, Debug, Serialize, Deserialize)]
pub struct GetMcpServerResponse {
    // servers: HashMap<String, Value>,
    mcp_config: McpConfig,
    config_path: String,
}

#[derive(TS, Debug, Serialize, Deserialize)]
pub struct UpdateMcpServersBody {
    servers: HashMap<String, Value>,
}

async fn get_mcp_servers(
    State(_deployment): State<DeploymentImpl>,
    Query(query): Query<McpServerQuery>,
) -> Result<ResponseJson<ApiResponse<GetMcpServerResponse>>, ApiError> {
    let coding_agent = ExecutorConfigs::get_cached()
        .get_coding_agent(&ExecutorProfileId::new(query.executor))
        .ok_or(ConfigError::ValidationError(
            "Executor not found".to_string(),
        ))?;

    if !coding_agent.supports_mcp() {
        return Ok(ResponseJson(ApiResponse::error(
            "MCP not supported by this executor",
        )));
    }

    // Resolve supplied config path or agent default
    let config_path = match coding_agent.default_mcp_config_path() {
        Some(path) => path,
        None => {
            return Ok(ResponseJson(ApiResponse::error(
                "Could not determine config file path",
            )));
        }
    };

    let mut mcpc = coding_agent.get_mcp_config();
    let raw_config = read_agent_config(&config_path, &mcpc).await?;
    let servers = get_mcp_servers_from_config_path(&raw_config, &mcpc.servers_path);
    mcpc.set_servers(servers);
    Ok(ResponseJson(ApiResponse::success(GetMcpServerResponse {
        mcp_config: mcpc,
        config_path: config_path.to_string_lossy().to_string(),
    })))
}

async fn update_mcp_servers(
    State(_deployment): State<DeploymentImpl>,
    Query(query): Query<McpServerQuery>,
    Json(payload): Json<UpdateMcpServersBody>,
) -> Result<ResponseJson<ApiResponse<String>>, ApiError> {
    let profiles = ExecutorConfigs::get_cached();
    let agent = profiles
        .get_coding_agent(&ExecutorProfileId::new(query.executor))
        .ok_or(ConfigError::ValidationError(
            "Executor not found".to_string(),
        ))?;

    if !agent.supports_mcp() {
        return Ok(ResponseJson(ApiResponse::error(
            "This executor does not support MCP servers",
        )));
    }

    // Resolve supplied config path or agent default
    let config_path = match agent.default_mcp_config_path() {
        Some(path) => path.to_path_buf(),
        None => {
            return Ok(ResponseJson(ApiResponse::error(
                "Could not determine config file path",
            )));
        }
    };

    let mcpc = agent.get_mcp_config();
    match update_mcp_servers_in_config(&config_path, &mcpc, payload.servers).await {
        Ok(message) => Ok(ResponseJson(ApiResponse::success(message))),
        Err(e) => Ok(ResponseJson(ApiResponse::error(&format!(
            "Failed to update MCP servers: {}",
            e
        )))),
    }
}

async fn update_mcp_servers_in_config(
    config_path: &std::path::Path,
    mcpc: &McpConfig,
    new_servers: HashMap<String, Value>,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    // Ensure parent directory exists
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).await?;
    }
    // Read existing config (JSON or TOML depending on agent)
    let mut config = read_agent_config(config_path, mcpc).await?;

    // Get the current server count for comparison
    let old_servers = get_mcp_servers_from_config_path(&config, &mcpc.servers_path).len();

    // Set the MCP servers using the correct attribute path
    set_mcp_servers_in_config_path(&mut config, &mcpc.servers_path, &new_servers)?;

    // Write the updated config back to file (JSON or TOML depending on agent)
    write_agent_config(config_path, mcpc, &config).await?;

    let new_count = new_servers.len();
    let message = match (old_servers, new_count) {
        (0, 0) => "No MCP servers configured".to_string(),
        (0, n) => format!("Added {} MCP server(s)", n),
        (old, new) if old == new => format!("Updated MCP server configuration ({} server(s))", new),
        (old, new) => format!(
            "Updated MCP server configuration (was {}, now {})",
            old, new
        ),
    };

    Ok(message)
}

/// Helper function to get MCP servers from config using a path
fn get_mcp_servers_from_config_path(raw_config: &Value, path: &[String]) -> HashMap<String, Value> {
    let mut current = raw_config;
    for part in path {
        current = match current.get(part) {
            Some(val) => val,
            None => return HashMap::new(),
        };
    }
    // Extract the servers object
    match current.as_object() {
        Some(servers) => servers
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
        None => HashMap::new(),
    }
}

/// Helper function to set MCP servers in config using a path
fn set_mcp_servers_in_config_path(
    raw_config: &mut Value,
    path: &[String],
    servers: &HashMap<String, Value>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Ensure config is an object
    if !raw_config.is_object() {
        *raw_config = serde_json::json!({});
    }

    let mut current = raw_config;
    // Navigate/create the nested structure (all parts except the last)
    for part in &path[..path.len() - 1] {
        if current.get(part).is_none() {
            current
                .as_object_mut()
                .unwrap()
                .insert(part.to_string(), serde_json::json!({}));
        }
        current = current.get_mut(part).unwrap();
        if !current.is_object() {
            *current = serde_json::json!({});
        }
    }

    // Set the final attribute
    let final_attr = path.last().unwrap();
    current
        .as_object_mut()
        .unwrap()
        .insert(final_attr.to_string(), serde_json::to_value(servers)?);

    Ok(())
}

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
