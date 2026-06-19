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
use serde_json::{Value, json};
use services::services::{
    cli_config::{
        CliConfig, CustomProviderEntry, CustomProviderOptions, OllamaConfig, OpenTeamsCliConfig,
        OpenTeamsCliProviderConfig, OpenTeamsCliProviderOptions, ProviderCredentials,
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
            "/config/cli/custom-providers/models",
            post(list_custom_provider_draft_models),
        )
        .route(
            "/config/cli/custom-providers/validate",
            post(validate_custom_provider_draft),
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

include!("system.rs");
include!("cli.rs");
include!("providers.rs");
include!("validation.rs");
include!("tests.rs");
include!("sounds.rs");
include!("mcp.rs");
include!("profiles.rs");
