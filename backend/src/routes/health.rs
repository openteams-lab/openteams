use axum::response::Json;
use crate::models::ApiResponse;

pub async fn health_check() -> Json<ApiResponse<String>> {
    Json(ApiResponse {
        success: true,
        data: Some("OK".to_string()),
        message: Some("Service is healthy".to_string()),
    })
}
