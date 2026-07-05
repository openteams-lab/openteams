use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, Query, State},
    response::Json as ResponseJson,
    routing::{get, post},
};
use db::models::inbox_item::{InboxItem, InboxItemListFilter};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::inbox::{
    InboxItemsArchivedResponse, InboxItemsMarkedReadResponse, InboxScope, InboxService,
    InboxSummary, MarkAllInboxItemsReadRequest, MarkInboxItemsReadRequest,
};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
pub struct InboxSummaryQuery {
    pub project_id: Option<Uuid>,
    pub session_id: Option<Uuid>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
pub struct InboxItemsQuery {
    pub project_id: Option<Uuid>,
    pub session_id: Option<Uuid>,
    pub unread: Option<bool>,
    pub archived: Option<bool>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct InboxItemsResponse {
    pub items: Vec<InboxItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct InboxItemResponse {
    pub item: InboxItem,
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/inbox/summary", get(get_summary))
        .route("/inbox/items", get(list_items))
        .route("/inbox/items/{id}/mark-read", post(mark_item_read))
        .route("/inbox/items/mark-read", post(mark_items_read))
        .route("/inbox/items/mark-all-read", post(mark_all_read))
        .route("/inbox/items/{id}/archive", post(archive_item))
}

async fn get_summary(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<InboxSummaryQuery>,
) -> Result<ResponseJson<ApiResponse<InboxSummary>>, ApiError> {
    let summary = InboxService::new()
        .summary(&deployment.db().pool, query.into())
        .await?;
    Ok(ResponseJson(ApiResponse::success(summary)))
}

async fn list_items(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<InboxItemsQuery>,
) -> Result<ResponseJson<ApiResponse<InboxItemsResponse>>, ApiError> {
    let items = InboxService::new()
        .list_items(&deployment.db().pool, query.into())
        .await?;
    Ok(ResponseJson(ApiResponse::success(InboxItemsResponse {
        items,
    })))
}

async fn mark_item_read(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<InboxItemResponse>>, ApiError> {
    let item = InboxService::new()
        .mark_read(&deployment.db().pool, id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Inbox item not found.".to_string()))?;
    Ok(ResponseJson(ApiResponse::success(InboxItemResponse {
        item,
    })))
}

async fn mark_items_read(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<MarkInboxItemsReadRequest>,
) -> Result<ResponseJson<ApiResponse<InboxItemsMarkedReadResponse>>, ApiError> {
    let marked_count = InboxService::new()
        .mark_many_read(&deployment.db().pool, &payload.ids)
        .await?;
    Ok(ResponseJson(ApiResponse::success(
        InboxItemsMarkedReadResponse { marked_count },
    )))
}

async fn mark_all_read(
    State(deployment): State<DeploymentImpl>,
    body: Bytes,
) -> Result<ResponseJson<ApiResponse<InboxItemsMarkedReadResponse>>, ApiError> {
    let payload = parse_mark_all_payload(body)?;
    let marked_count = InboxService::new()
        .mark_all_read(
            &deployment.db().pool,
            InboxScope {
                project_id: payload.project_id,
                session_id: payload.session_id,
            },
        )
        .await?;
    Ok(ResponseJson(ApiResponse::success(
        InboxItemsMarkedReadResponse { marked_count },
    )))
}

fn parse_mark_all_payload(body: Bytes) -> Result<MarkAllInboxItemsReadRequest, ApiError> {
    if body.is_empty() {
        return Ok(MarkAllInboxItemsReadRequest::default());
    }
    serde_json::from_slice(&body)
        .map_err(|error| ApiError::BadRequest(format!("Invalid mark-all-read payload: {error}")))
}

async fn archive_item(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<InboxItemsArchivedResponse>>, ApiError> {
    let item = InboxService::new()
        .archive(&deployment.db().pool, id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Inbox item not found.".to_string()))?;
    Ok(ResponseJson(ApiResponse::success(
        InboxItemsArchivedResponse { item },
    )))
}

impl From<InboxSummaryQuery> for InboxScope {
    fn from(query: InboxSummaryQuery) -> Self {
        Self {
            project_id: query.project_id,
            session_id: query.session_id,
        }
    }
}

impl From<InboxItemsQuery> for InboxItemListFilter {
    fn from(query: InboxItemsQuery) -> Self {
        Self {
            project_id: query.project_id,
            session_id: query.session_id,
            unread_only: query.unread.unwrap_or(true),
            include_archived: query.archived.unwrap_or(false),
            limit: query.limit.unwrap_or(50),
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Method, Request, StatusCode},
    };
    use db::{
        DBService,
        models::inbox_item::{InboxItemSeverity, UpsertInboxItem},
    };
    use serde_json::{Value, json};
    use services::services::inbox::InboxService;
    use sqlx::SqlitePool;
    use tower::ServiceExt;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::migrate!("../db/migrations")
            .run(&pool)
            .await
            .expect("run migrations for inbox HTTP tests");
        pool
    }

    async fn setup_app() -> (Router, SqlitePool) {
        let pool = setup_pool().await;
        let deployment =
            local_deployment::LocalDeployment::new_for_test_pool(DBService { pool: pool.clone() })
                .await
                .expect("create test deployment");
        (
            Router::new()
                .nest("/api", super::router())
                .with_state(deployment),
            pool,
        )
    }

    async fn request_json(
        app: &Router,
        method: Method,
        uri: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder().method(method).uri(uri);
        let request_body = if let Some(body) = body {
            builder = builder.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&body).expect("serialize request body"))
        } else {
            Body::empty()
        };
        let response = app
            .clone()
            .oneshot(builder.body(request_body).expect("build request"))
            .await
            .expect("execute request");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response body");
        let value = serde_json::from_slice(&bytes).unwrap_or_else(|_| json!({}));
        (status, value)
    }

    fn notification(key: &str, severity: InboxItemSeverity) -> UpsertInboxItem {
        UpsertInboxItem {
            project_id: None,
            session_id: None,
            kind: "workflow_review".to_string(),
            severity,
            title: format!("Review {key}"),
            body: Some("Review body".to_string()),
            source_type: "workflow".to_string(),
            source_id: Some(key.to_string()),
            dedupe_key: key.to_string(),
        }
    }

    #[tokio::test]
    async fn inbox_routes_list_summary_mark_read_mark_all_and_archive() {
        let (app, pool) = setup_app().await;
        let service = InboxService::new();
        let first = service
            .upsert_item(&pool, notification("first", InboxItemSeverity::Warning))
            .await
            .expect("first notification");
        let second = service
            .upsert_item(&pool, notification("second", InboxItemSeverity::Error))
            .await
            .expect("second notification");
        let third = service
            .upsert_item(&pool, notification("third", InboxItemSeverity::Info))
            .await
            .expect("third notification");

        let (status, body) = request_json(&app, Method::GET, "/api/inbox/items", None).await;
        assert_eq!(status, StatusCode::OK, "response body: {body}");
        assert_eq!(body["data"]["items"].as_array().expect("items").len(), 3);

        let (status, body) = request_json(
            &app,
            Method::POST,
            &format!("/api/inbox/items/{}/mark-read", first.id),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "response body: {body}");
        assert!(body["data"]["item"]["read_at"].is_string());

        let (status, body) = request_json(&app, Method::GET, "/api/inbox/summary", None).await;
        assert_eq!(status, StatusCode::OK, "response body: {body}");
        assert_eq!(body["data"]["unread_count"], 2);

        let (status, body) = request_json(
            &app,
            Method::POST,
            "/api/inbox/items/mark-read",
            Some(json!({ "ids": [second.id] })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "response body: {body}");
        assert_eq!(body["data"]["marked_count"], 1);

        let (status, body) = request_json(
            &app,
            Method::POST,
            "/api/inbox/items/mark-all-read",
            Some(json!({})),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "response body: {body}");
        assert_eq!(body["data"]["marked_count"], 1);

        let (status, body) = request_json(
            &app,
            Method::POST,
            &format!("/api/inbox/items/{}/archive", third.id),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "response body: {body}");
        assert!(body["data"]["item"]["archived_at"].is_string());

        let (status, body) = request_json(&app, Method::GET, "/api/inbox/items", None).await;
        assert_eq!(status, StatusCode::OK, "response body: {body}");
        assert_eq!(body["data"]["items"].as_array().expect("items").len(), 0);
    }
}
