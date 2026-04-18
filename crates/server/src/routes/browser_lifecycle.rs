use axum::{Json, Router, response::Json as ResponseJson, routing::post};
use serde::Deserialize;
use utils::response::ApiResponse;

use crate::{DeploymentImpl, npx_browser_lifecycle};

pub fn router() -> Router<DeploymentImpl> {
    Router::new().route("/browser-session", post(report_browser_session))
}

#[derive(Debug, Deserialize)]
struct BrowserSessionEventRequest {
    session_id: String,
    event: BrowserSessionEvent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum BrowserSessionEvent {
    Open,
    Heartbeat,
    Close,
}

async fn report_browser_session(
    Json(payload): Json<BrowserSessionEventRequest>,
) -> ResponseJson<ApiResponse<()>> {
    if !npx_browser_lifecycle::is_enabled() {
        return ResponseJson(ApiResponse::success(()));
    }

    match payload.event {
        BrowserSessionEvent::Open => npx_browser_lifecycle::note_open(&payload.session_id),
        BrowserSessionEvent::Heartbeat => {
            npx_browser_lifecycle::note_heartbeat(&payload.session_id);
        }
        BrowserSessionEvent::Close => npx_browser_lifecycle::note_close(&payload.session_id),
    }

    ResponseJson(ApiResponse::success(()))
}
