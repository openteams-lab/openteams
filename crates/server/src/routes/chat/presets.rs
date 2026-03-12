use axum::{Json, extract::State, response::Json as ResponseJson};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::{assets::config_path, response::ApiResponse};

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TeamProtocolConfig {
    pub content: String,
    pub enabled: bool,
}

impl TeamProtocolConfig {
    fn from_stored(content: Option<&str>) -> Self {
        let content = content.unwrap_or_default().to_string();
        let enabled = !content.trim().is_empty();
        Self { content, enabled }
    }
}

pub async fn get_team_protocol(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<TeamProtocolConfig>>, ApiError> {
    let config = deployment.config().read().await;
    let payload = TeamProtocolConfig::from_stored(config.chat_presets.team_protocol.as_deref());
    Ok(ResponseJson(ApiResponse::success(payload)))
}

pub async fn update_team_protocol(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<TeamProtocolConfig>,
) -> Result<ResponseJson<ApiResponse<TeamProtocolConfig>>, ApiError> {
    let mut next_config = deployment.config().read().await.clone();
    let content = if payload.enabled {
        payload.content
    } else {
        String::new()
    };
    let effective = TeamProtocolConfig {
        enabled: !content.trim().is_empty(),
        content: content.clone(),
    };
    next_config.chat_presets.team_protocol = Some(content);

    services::services::config::save_config_to_file(&next_config, &config_path()).await?;

    let mut config = deployment.config().write().await;
    *config = next_config;
    drop(config);

    Ok(ResponseJson(ApiResponse::success(effective)))
}
