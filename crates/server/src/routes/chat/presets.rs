use axum::{Extension, Json, extract::State, response::Json as ResponseJson};
use db::models::chat_session::{ChatSession, UpdateChatSession};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TeamProtocolConfig {
    pub content: String,
    pub enabled: bool,
}

pub async fn get_team_protocol(
    Extension(session): Extension<ChatSession>,
) -> Result<ResponseJson<ApiResponse<TeamProtocolConfig>>, ApiError> {
    let content = session.team_protocol.unwrap_or_default();
    let enabled = session.team_protocol_enabled;
    Ok(ResponseJson(ApiResponse::success(TeamProtocolConfig {
        content,
        enabled,
    })))
}

pub async fn update_team_protocol(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<TeamProtocolConfig>,
) -> Result<ResponseJson<ApiResponse<TeamProtocolConfig>>, ApiError> {
    let content = if payload.enabled {
        payload.content.clone()
    } else {
        String::new()
    };
    let effective = TeamProtocolConfig {
        enabled: !content.trim().is_empty(),
        content: content.clone(),
    };

    ChatSession::update(
        &deployment.db().pool,
        session.id,
        &UpdateChatSession {
            title: None,
            status: None,
            summary_text: None,
            archive_ref: None,
            last_seen_diff_key: None,
            team_protocol: Some(content),
            team_protocol_enabled: Some(effective.enabled),
        },
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(effective)))
}
