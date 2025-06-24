use axum::{
    extract::Extension,
    response::Json as ResponseJson,
    routing::{get, post},
    Json, Router,
};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::models::{config::{Config, EditorConstants, SoundConstants}, ApiResponse};
use crate::utils;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub fn config_router() -> Router {
    Router::new()
        .route("/config", get(get_config))
        .route("/config", post(update_config))
        .route("/config/constants", get(get_config_constants))
}

async fn get_config(
    Extension(config): Extension<Arc<RwLock<Config>>>,
) -> ResponseJson<ApiResponse<Config>> {
    let config = config.read().await;
    ResponseJson(ApiResponse {
        success: true,
        data: Some(config.clone()),
        message: Some("Config retrieved successfully".to_string()),
    })
}

async fn update_config(
    Extension(config_arc): Extension<Arc<RwLock<Config>>>,
    Json(new_config): Json<Config>,
) -> ResponseJson<ApiResponse<Config>> {
    let config_path = utils::config_path();

    match new_config.save(&config_path) {
        Ok(_) => {
            let mut config = config_arc.write().await;
            *config = new_config.clone();

            ResponseJson(ApiResponse {
                success: true,
                data: Some(new_config),
                message: Some("Config updated successfully".to_string()),
            })
        }
        Err(e) => ResponseJson(ApiResponse {
            success: false,
            data: None,
            message: Some(format!("Failed to save config: {}", e)),
        }),
    }
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConfigConstants {
    pub editor: EditorConstants,
    pub sound: SoundConstants,
}

async fn get_config_constants() -> ResponseJson<ApiResponse<ConfigConstants>> {
    let constants = ConfigConstants {
        editor: EditorConstants::new(),
        sound: SoundConstants::new(),
    };

    ResponseJson(ApiResponse {
        success: true,
        data: Some(constants),
        message: Some("Config constants retrieved successfully".to_string()),
    })
}
