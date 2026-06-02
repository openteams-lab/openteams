use axum::{
    Router,
    extract::{Path, Query, State},
    response::Json as ResponseJson,
    routing::{delete, get, put},
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

use deployment::Deployment;

// 鈹€鈹€鈹€ Query Parameters 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

#[derive(Debug, Deserialize)]
pub struct DailyTokensQuery {
    pub project_id: Uuid,
    #[serde(default = "default_period")]
    pub period: String,
}

#[derive(Debug, Deserialize)]
pub struct SessionTokensQuery {
    pub project_id: Uuid,
    #[serde(default = "default_limit")]
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct ActivityQuery {
    pub project_id: Uuid,
    #[serde(default = "default_activity_period")]
    pub period: String,
}

fn default_period() -> String {
    "7d".to_string()
}

fn default_activity_period() -> String {
    "30d".to_string()
}

fn default_limit() -> Option<u32> {
    Some(50)
}

// 鈹€鈹€鈹€ Response Types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DailyTokenDataPoint {
    pub date: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct DailyTokensResponse {
    pub days: Vec<DailyTokenDataPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SessionTokenEntry {
    pub session_id: String,
    pub title: String,
    pub total_tokens: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct SessionTokensResponse {
    pub sessions: Vec<SessionTokenEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ActivityDataPoint {
    pub date: String,
    pub bugs_fixed: i64,
    pub features_delivered: i64,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct ActivityResponse {
    pub days: Vec<ActivityDataPoint>,
}

// 鈹€鈹€鈹€ Model Pricing Types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

#[derive(Debug, Deserialize)]
pub struct ModelPricingQuery {
    pub project_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct UpdateModelPricingRequest {
    pub custom_input_price: Option<Option<f64>>,
    pub custom_output_price: Option<Option<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ModelUsageRow {
    pub model_id: String,
    pub model_name: String,
    pub total_tokens: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub input_price_per_1m: f64,
    pub output_price_per_1m: f64,
    pub estimated_cost: f64,
    pub price_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ModelPriceRow {
    pub model_id: String,
    pub model_name: String,
    pub input_price_per_1m: f64,
    pub output_price_per_1m: f64,
    pub custom_input_price: Option<f64>,
    pub custom_output_price: Option<f64>,
    pub price_source: String,
    pub price_updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct ModelPricingResponse {
    pub models: Vec<ModelUsageRow>,
}

// 鈹€鈹€鈹€ Router 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/build-stats/daily-tokens", get(get_daily_tokens))
        .route("/build-stats/session-tokens", get(get_session_tokens))
        .route("/build-stats/activity", get(get_activity))
        .route("/build-stats/model-pricing", get(get_model_pricing))
        .route("/build-stats/model-pricing/{model_id}", put(update_model_pricing))
        .route("/build-stats/model-pricing/{model_id}/custom", delete(reset_model_pricing))
}

// 鈹€鈹€鈹€ Helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/// Parse a period string ("7d", "30d", "90d") into the number of days.
/// Returns an error for invalid period values.
fn parse_period_days(period: &str) -> Result<i64, ApiError> {
    match period {
        "7d" => Ok(7),
        "30d" => Ok(30),
        "90d" => Ok(90),
        _ => Err(ApiError::BadRequest(
            "Invalid period. Must be one of: 7d, 30d, 90d".to_string(),
        )),
    }
}

/// Fill zero-value entries for dates with no data within the selected range.
/// Ensures the output has exactly `num_days` entries, one per day, sorted ascending.
pub fn fill_zero_days(
    sparse_data: Vec<DailyTokenDataPoint>,
    start_date: NaiveDate,
    num_days: i64,
) -> Vec<DailyTokenDataPoint> {
    use std::collections::HashMap;

    // Build a lookup map from date string to data point
    let data_map: HashMap<String, &DailyTokenDataPoint> = sparse_data
        .iter()
        .map(|dp| (dp.date.clone(), dp))
        .collect();

    let mut result = Vec::with_capacity(num_days as usize);
    for i in 0..num_days {
        let date = start_date + chrono::Duration::days(i);
        let date_str = date.format("%Y-%m-%d").to_string();

        if let Some(dp) = data_map.get(&date_str) {
            result.push((*dp).clone());
        } else {
            result.push(DailyTokenDataPoint {
                date: date_str,
                input_tokens: 0,
                output_tokens: 0,
                total_tokens: 0,
            });
        }
    }

    result
}

fn fill_zero_activity_days(
    sparse_data: Vec<ActivityDataPoint>,
    start_date: NaiveDate,
    num_days: i64,
) -> Vec<ActivityDataPoint> {
    use std::collections::HashMap;

    let data_map: HashMap<String, &ActivityDataPoint> = sparse_data
        .iter()
        .map(|dp| (dp.date.clone(), dp))
        .collect();

    let mut result = Vec::with_capacity(num_days as usize);
    for i in 0..num_days {
        let date = start_date + chrono::Duration::days(i);
        let date_str = date.format("%Y-%m-%d").to_string();

        if let Some(dp) = data_map.get(&date_str) {
            result.push((*dp).clone());
        } else {
            result.push(ActivityDataPoint {
                date: date_str,
                bugs_fixed: 0,
                features_delivered: 0,
            });
        }
    }

    result
}

// 鈹€鈹€鈹€ Handlers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

async fn get_daily_tokens(
    State(deployment): State<DeploymentImpl>,
    Query(params): Query<DailyTokensQuery>,
) -> Result<ResponseJson<ApiResponse<DailyTokensResponse>>, ApiError> {
    let num_days = parse_period_days(&params.period)?;
    let pool = &deployment.db().pool;

    let today = Utc::now().date_naive();
    let start_date = today - chrono::Duration::days(num_days - 1);
    let start_timestamp = start_date.format("%Y-%m-%d").to_string();

    let rows = sqlx::query_as::<_, DailyTokenRow>(
        r#"
        SELECT
            date(ae.timestamp) as date,
            COALESCE(SUM(json_extract(ae.properties, '$.input_tokens')), 0) as input_tokens,
            COALESCE(SUM(json_extract(ae.properties, '$.output_tokens')), 0) as output_tokens,
            COALESCE(SUM(json_extract(ae.properties, '$.total_tokens')), 0) as total_tokens
        FROM analytics_events ae
        JOIN chat_sessions cs
          ON ae.session_id = CAST(cs.id AS TEXT)
          OR replace(lower(ae.session_id), '-', '') = lower(hex(cs.id))
        WHERE ae.event_type = 'token_usage'
          AND (
            cs.project_id = ?1
            OR replace(lower(CAST(cs.project_id AS TEXT)), '-', '') = lower(hex(?1))
          )
          AND ae.timestamp >= ?2
        GROUP BY date(ae.timestamp)
        ORDER BY date(ae.timestamp) ASC
        "#,
    )
    .bind(params.project_id)
    .bind(&start_timestamp)
    .fetch_all(pool)
    .await?;

    let sparse_data: Vec<DailyTokenDataPoint> = rows
        .into_iter()
        .map(|row| DailyTokenDataPoint {
            date: row.date,
            input_tokens: row.input_tokens,
            output_tokens: row.output_tokens,
            total_tokens: row.total_tokens,
        })
        .collect();

    let days = fill_zero_days(sparse_data, start_date, num_days);

    Ok(ResponseJson(ApiResponse::success(DailyTokensResponse {
        days,
    })))
}
// 鈹€鈹€鈹€ Internal Types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

#[derive(Debug, sqlx::FromRow)]
struct DailyTokenRow {
    date: String,
    input_tokens: i64,
    output_tokens: i64,
    total_tokens: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct SessionTokenRow {
    session_id: String,
    title: String,
    input_tokens: i64,
    output_tokens: i64,
    total_tokens: i64,
}

// 鈹€鈹€鈹€ Session Tokens Handler 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

async fn get_session_tokens(
    State(deployment): State<DeploymentImpl>,
    Query(params): Query<SessionTokensQuery>,
) -> Result<ResponseJson<ApiResponse<SessionTokensResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let limit = params.limit.unwrap_or(50).min(50) as i64;

    let rows = sqlx::query_as::<_, SessionTokenRow>(
        r#"
        SELECT
            ae.session_id as session_id,
            COALESCE(cs.title, '') as title,
            COALESCE(SUM(json_extract(ae.properties, '$.input_tokens')), 0) as input_tokens,
            COALESCE(SUM(json_extract(ae.properties, '$.output_tokens')), 0) as output_tokens,
            COALESCE(SUM(json_extract(ae.properties, '$.total_tokens')), 0) as total_tokens
        FROM analytics_events ae
        JOIN chat_sessions cs
          ON ae.session_id = CAST(cs.id AS TEXT)
          OR replace(lower(ae.session_id), '-', '') = lower(hex(cs.id))
        WHERE ae.event_type = 'token_usage'
          AND (
            cs.project_id = ?1
            OR replace(lower(CAST(cs.project_id AS TEXT)), '-', '') = lower(hex(?1))
          )
        GROUP BY ae.session_id, cs.title
        ORDER BY total_tokens DESC
        LIMIT ?2
        "#,
    )
    .bind(params.project_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let sessions: Vec<SessionTokenEntry> = rows
        .into_iter()
        .map(|row| SessionTokenEntry {
            session_id: row.session_id,
            title: row.title,
            total_tokens: row.total_tokens,
            input_tokens: row.input_tokens,
            output_tokens: row.output_tokens,
        })
        .collect();

    Ok(ResponseJson(ApiResponse::success(SessionTokensResponse {
        sessions,
    })))
}
// 鈹€鈹€鈹€ Activity Handler 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

#[derive(Debug, sqlx::FromRow)]
struct ActivityTrendRow {
    date: String,
    bugs_fixed: i64,
    features_delivered: i64,
}

async fn get_activity(
    State(deployment): State<DeploymentImpl>,
    Query(params): Query<ActivityQuery>,
) -> Result<ResponseJson<ApiResponse<ActivityResponse>>, ApiError> {
    let num_days = parse_period_days(&params.period)?;
    let pool = &deployment.db().pool;

    let today = Utc::now().date_naive();
    let start_date = today - chrono::Duration::days(num_days - 1);
    let start_timestamp = start_date.format("%Y-%m-%d").to_string();

    let rows = sqlx::query_as::<_, ActivityTrendRow>(
        r#"
        SELECT
            date(created_at) as date,
            SUM(CASE WHEN event_type = 'bugfix' THEN 1 ELSE 0 END) as bugs_fixed,
            SUM(CASE WHEN event_type = 'feature' THEN 1 ELSE 0 END) as features_delivered
        FROM project_delivery_events
        WHERE (
            project_id = ?1
            OR replace(lower(CAST(project_id AS TEXT)), '-', '') = lower(hex(?1))
          )
          AND created_at >= ?2
          AND event_type IN ('bugfix', 'feature')
        GROUP BY date(created_at)
        ORDER BY date(created_at) ASC
        "#,
    )
    .bind(params.project_id)
    .bind(&start_timestamp)
    .fetch_all(pool)
    .await?;

    let sparse_data = rows
        .into_iter()
        .map(|row| ActivityDataPoint {
            date: row.date,
            bugs_fixed: row.bugs_fixed,
            features_delivered: row.features_delivered,
        })
        .collect();
    let days = fill_zero_activity_days(sparse_data, start_date, num_days);

    Ok(ResponseJson(ApiResponse::success(ActivityResponse { days })))
}
// 鈹€鈹€鈹€ Price Validation 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/// Validate a price value: must be non-negative, at most 6 decimal places, and 鈮?10000.
/// Returns Ok(()) if valid, or an error message string if invalid.
pub fn validate_price(value: f64) -> Result<(), String> {
    if value < 0.0 {
        return Err("Price must be non-negative".to_string());
    }
    if value > 10000.0 {
        return Err("Price must not exceed 10000".to_string());
    }
    // Check decimal places: multiply by 10^6 and verify it's close to an integer
    let scaled = value * 1_000_000.0;
    if (scaled - scaled.round()).abs() > 1e-9 {
        return Err("Price must have at most 6 decimal places".to_string());
    }
    Ok(())
}

// 鈹€鈹€鈹€ Model Pricing Handlers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

#[derive(Debug, sqlx::FromRow)]
struct ModelUsageQueryRow {
    model_id: String,
    model_name: String,
    total_tokens: i64,
    input_tokens: i64,
    output_tokens: i64,
    input_price_per_1m: f64,
    output_price_per_1m: f64,
    source: String,
}

async fn get_model_pricing(
    State(deployment): State<DeploymentImpl>,
    Query(params): Query<ModelPricingQuery>,
) -> Result<ResponseJson<ApiResponse<ModelPricingResponse>>, ApiError> {
    let pool = &deployment.db().pool;

    let rows = sqlx::query_as::<_, ModelUsageQueryRow>(
        r#"
        WITH model_usage AS (
            SELECT
                COALESCE(json_extract(ae.properties, '$.model'), 'unknown') as model_id,
                COALESCE(SUM(json_extract(ae.properties, '$.input_tokens')), 0) as input_tokens,
                COALESCE(SUM(json_extract(ae.properties, '$.output_tokens')), 0) as output_tokens,
                COALESCE(SUM(json_extract(ae.properties, '$.total_tokens')), 0) as total_tokens
            FROM analytics_events ae
            JOIN chat_sessions cs
              ON ae.session_id = CAST(cs.id AS TEXT)
              OR replace(lower(ae.session_id), '-', '') = lower(hex(cs.id))
            WHERE ae.event_type = 'token_usage'
              AND (
                cs.project_id = ?1
                OR replace(lower(CAST(cs.project_id AS TEXT)), '-', '') = lower(hex(?1))
              )
              AND COALESCE(json_extract(ae.properties, '$.model'), '') != ''
            GROUP BY model_id
        )
        SELECT
            mu.model_id,
            COALESCE(mpc.model_name, mu.model_id) as model_name,
            mu.total_tokens,
            mu.input_tokens,
            mu.output_tokens,
            COALESCE(mp.custom_input_price, mpc.input_price_per_1m, 0.0) as input_price_per_1m,
            COALESCE(mp.custom_output_price, mpc.output_price_per_1m, 0.0) as output_price_per_1m,
            COALESCE(mpc.source, 'usage') as source
        FROM model_usage mu
        LEFT JOIN model_price_cache mpc ON mpc.model_id = mu.model_id
        LEFT JOIN model_pricing mp
            ON mp.model_id = mu.model_id
            AND mp.project_id = ?1
        ORDER BY mu.total_tokens DESC
        LIMIT 5
        "#,
    )
    .bind(params.project_id)
    .fetch_all(pool)
    .await?;

    let models = rows
        .into_iter()
        .map(|row| {
            let estimated_cost = (row.input_tokens as f64 / 1_000_000.0) * row.input_price_per_1m
                + (row.output_tokens as f64 / 1_000_000.0) * row.output_price_per_1m;
            ModelUsageRow {
                model_id: row.model_id,
                model_name: row.model_name,
                total_tokens: row.total_tokens,
                input_tokens: row.input_tokens,
                output_tokens: row.output_tokens,
                input_price_per_1m: row.input_price_per_1m,
                output_price_per_1m: row.output_price_per_1m,
                estimated_cost,
                price_source: row.source,
            }
        })
        .collect();

    Ok(ResponseJson(ApiResponse::success(ModelPricingResponse {
        models,
    })))
}
async fn update_model_pricing(
    State(deployment): State<DeploymentImpl>,
    Query(params): Query<ModelPricingQuery>,
    Path(model_id): Path<String>,
    ResponseJson(body): ResponseJson<UpdateModelPricingRequest>,
) -> Result<ResponseJson<ApiResponse<ModelPriceRow>>, ApiError> {
    let pool = &deployment.db().pool;

    // Validate prices if provided
    if let Some(Some(price)) = &body.custom_input_price {
        validate_price(*price).map_err(|e| ApiError::BadRequest(format!("custom_input_price: {}", e)))?;
    }
    if let Some(Some(price)) = &body.custom_output_price {
        validate_price(*price).map_err(|e| ApiError::BadRequest(format!("custom_output_price: {}", e)))?;
    }

    // Verify the model exists in the cache
    let cache_row = sqlx::query_as::<_, (String, String, f64, f64, String, String)>(
        r#"
        SELECT model_id, model_name, input_price_per_1m, output_price_per_1m, source, updated_at
        FROM model_price_cache
        WHERE model_id = ?1
        "#,
    )
    .bind(&model_id)
    .fetch_optional(pool)
    .await?;

    let (_, model_name, input_price, output_price, source, price_updated_at) = cache_row
        .ok_or_else(|| ApiError::BadRequest(format!("Model '{}' not found", model_id)))?;

    // Determine the custom prices to set
    // If the field is Some(value), use that value (which may be Some(price) or None to clear)
    // If the field is None (not provided), keep existing value
    let existing = sqlx::query_as::<_, (Option<f64>, Option<f64>)>(
        "SELECT custom_input_price, custom_output_price FROM model_pricing WHERE project_id = ?1 AND model_id = ?2",
    )
    .bind(params.project_id)
    .bind(&model_id)
    .fetch_optional(pool)
    .await?;

    let (existing_input, existing_output) = existing.unwrap_or((None, None));

    let new_input_price = match body.custom_input_price {
        Some(val) => val,
        None => existing_input,
    };
    let new_output_price = match body.custom_output_price {
        Some(val) => val,
        None => existing_output,
    };

    // Upsert into model_pricing (INSERT OR REPLACE)
    let new_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO model_pricing (id, project_id, model_id, model_name, input_price_per_1m, output_price_per_1m, custom_input_price, custom_output_price, price_source, price_updated_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now', 'subsec'), datetime('now', 'subsec'))
        ON CONFLICT(project_id, model_id) DO UPDATE SET
            custom_input_price = excluded.custom_input_price,
            custom_output_price = excluded.custom_output_price,
            updated_at = datetime('now', 'subsec')
        "#,
    )
    .bind(new_id)
    .bind(params.project_id)
    .bind(&model_id)
    .bind(&model_name)
    .bind(input_price)
    .bind(output_price)
    .bind(new_input_price)
    .bind(new_output_price)
    .bind(&source)
    .bind(&price_updated_at)
    .execute(pool)
    .await?;

    Ok(ResponseJson(ApiResponse::success(ModelPriceRow {
        model_id,
        model_name,
        input_price_per_1m: input_price,
        output_price_per_1m: output_price,
        custom_input_price: new_input_price,
        custom_output_price: new_output_price,
        price_source: source,
        price_updated_at,
    })))
}

async fn reset_model_pricing(
    State(deployment): State<DeploymentImpl>,
    Query(params): Query<ModelPricingQuery>,
    Path(model_id): Path<String>,
) -> Result<ResponseJson<ApiResponse<ModelPriceRow>>, ApiError> {
    let pool = &deployment.db().pool;

    // Verify the model exists in the cache
    let cache_row = sqlx::query_as::<_, (String, String, f64, f64, String, String)>(
        r#"
        SELECT model_id, model_name, input_price_per_1m, output_price_per_1m, source, updated_at
        FROM model_price_cache
        WHERE model_id = ?1
        "#,
    )
    .bind(&model_id)
    .fetch_optional(pool)
    .await?;

    let (_, model_name, input_price, output_price, source, price_updated_at) = cache_row
        .ok_or_else(|| ApiError::BadRequest(format!("Model '{}' not found", model_id)))?;

    // Reset custom prices to NULL
    sqlx::query(
        r#"
        UPDATE model_pricing
        SET custom_input_price = NULL, custom_output_price = NULL, updated_at = datetime('now', 'subsec')
        WHERE project_id = ?1 AND model_id = ?2
        "#,
    )
    .bind(params.project_id)
    .bind(&model_id)
    .execute(pool)
    .await?;

    Ok(ResponseJson(ApiResponse::success(ModelPriceRow {
        model_id,
        model_name,
        input_price_per_1m: input_price,
        output_price_per_1m: output_price,
        custom_input_price: None,
        custom_output_price: None,
        price_source: source,
        price_updated_at,
    })))
}

// 鈹€鈹€鈹€ Tests 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn test_parse_period_days_valid() {
        assert_eq!(parse_period_days("7d").unwrap(), 7);
        assert_eq!(parse_period_days("30d").unwrap(), 30);
        assert_eq!(parse_period_days("90d").unwrap(), 90);
    }

    #[test]
    fn test_parse_period_days_invalid() {
        assert!(parse_period_days("1d").is_err());
        assert!(parse_period_days("").is_err());
        assert!(parse_period_days("7").is_err());
        assert!(parse_period_days("invalid").is_err());
    }

    // 鈹€鈹€鈹€ Price Validation Tests 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

    #[test]
    fn test_validate_price_valid_values() {
        assert!(validate_price(0.0).is_ok());
        assert!(validate_price(1.0).is_ok());
        assert!(validate_price(3.5).is_ok());
        assert!(validate_price(10000.0).is_ok());
        assert!(validate_price(0.123456).is_ok());
        assert!(validate_price(99.999999).is_ok());
    }

    #[test]
    fn test_validate_price_negative() {
        assert!(validate_price(-0.01).is_err());
        assert!(validate_price(-1.0).is_err());
        assert!(validate_price(-100.0).is_err());
    }

    #[test]
    fn test_validate_price_exceeds_max() {
        assert!(validate_price(10000.01).is_err());
        assert!(validate_price(10001.0).is_err());
        assert!(validate_price(99999.0).is_err());
    }

    #[test]
    fn test_validate_price_too_many_decimals() {
        assert!(validate_price(1.1234567).is_err());
        assert!(validate_price(0.0000001).is_err());
    }

    // 鈹€鈹€鈹€ Zero Fill Tests 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

    #[test]
    fn test_fill_zero_days_empty_data() {
        let start = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let result = fill_zero_days(vec![], start, 7);

        assert_eq!(result.len(), 7);
        for (i, dp) in result.iter().enumerate() {
            let expected_date = (start + chrono::Duration::days(i as i64))
                .format("%Y-%m-%d")
                .to_string();
            assert_eq!(dp.date, expected_date);
            assert_eq!(dp.input_tokens, 0);
            assert_eq!(dp.output_tokens, 0);
            assert_eq!(dp.total_tokens, 0);
        }
    }

    #[test]
    fn test_fill_zero_days_with_sparse_data() {
        let start = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let sparse = vec![
            DailyTokenDataPoint {
                date: "2025-01-02".to_string(),
                input_tokens: 100,
                output_tokens: 200,
                total_tokens: 300,
            },
            DailyTokenDataPoint {
                date: "2025-01-05".to_string(),
                input_tokens: 50,
                output_tokens: 75,
                total_tokens: 125,
            },
        ];

        let result = fill_zero_days(sparse, start, 7);

        assert_eq!(result.len(), 7);
        // Day 1 (Jan 1) - zero
        assert_eq!(result[0].date, "2025-01-01");
        assert_eq!(result[0].total_tokens, 0);
        // Day 2 (Jan 2) - has data
        assert_eq!(result[1].date, "2025-01-02");
        assert_eq!(result[1].input_tokens, 100);
        assert_eq!(result[1].output_tokens, 200);
        assert_eq!(result[1].total_tokens, 300);
        // Day 3 (Jan 3) - zero
        assert_eq!(result[2].date, "2025-01-03");
        assert_eq!(result[2].total_tokens, 0);
        // Day 5 (Jan 5) - has data
        assert_eq!(result[4].date, "2025-01-05");
        assert_eq!(result[4].input_tokens, 50);
        assert_eq!(result[4].total_tokens, 125);
    }

    #[test]
    fn test_fill_zero_days_all_days_have_data() {
        let start = NaiveDate::from_ymd_opt(2025, 6, 1).unwrap();
        let sparse = vec![
            DailyTokenDataPoint {
                date: "2025-06-01".to_string(),
                input_tokens: 10,
                output_tokens: 20,
                total_tokens: 30,
            },
            DailyTokenDataPoint {
                date: "2025-06-02".to_string(),
                input_tokens: 40,
                output_tokens: 50,
                total_tokens: 90,
            },
            DailyTokenDataPoint {
                date: "2025-06-03".to_string(),
                input_tokens: 70,
                output_tokens: 80,
                total_tokens: 150,
            },
        ];

        let result = fill_zero_days(sparse, start, 3);

        assert_eq!(result.len(), 3);
        assert_eq!(result[0].total_tokens, 30);
        assert_eq!(result[1].total_tokens, 90);
        assert_eq!(result[2].total_tokens, 150);
    }

    #[test]
    fn test_fill_zero_days_preserves_order() {
        let start = NaiveDate::from_ymd_opt(2025, 3, 28).unwrap();
        let sparse = vec![
            DailyTokenDataPoint {
                date: "2025-03-30".to_string(),
                input_tokens: 5,
                output_tokens: 10,
                total_tokens: 15,
            },
        ];

        let result = fill_zero_days(sparse, start, 5);

        assert_eq!(result.len(), 5);
        assert_eq!(result[0].date, "2025-03-28");
        assert_eq!(result[1].date, "2025-03-29");
        assert_eq!(result[2].date, "2025-03-30");
        assert_eq!(result[2].total_tokens, 15);
        assert_eq!(result[3].date, "2025-03-31");
        assert_eq!(result[4].date, "2025-04-01");
    }
}





