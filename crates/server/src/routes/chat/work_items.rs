use axum::{
    Extension, Json as ResponseJson,
    extract::{Query, State},
};
use db::models::{chat_session::ChatSession, chat_work_item::ChatWorkItem};
use deployment::Deployment;
use serde::Deserialize;
use ts_rs::TS;
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize, TS)]
pub struct ChatWorkItemListQuery {
    pub limit: Option<i64>,
}

pub async fn get_work_items(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ChatWorkItemListQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatWorkItem>>>, ApiError> {
    let work_items =
        ChatWorkItem::find_by_session_id(&deployment.db().pool, session.id, query.limit).await?;
    Ok(ResponseJson(ApiResponse::success(work_items)))
}
