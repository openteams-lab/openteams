use axum::{
    Router,
    extract::{Path, Query, State},
    response::Json as ResponseJson,
    routing::{delete, get, put},
};
use chrono::{NaiveDate, Utc};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::build_stats::token_cost_stats::TokenCostStatsService;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

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
pub struct SessionWorkflowStepTokensQuery {
    pub project_id: Uuid,
    pub session_id: String,
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
    pub cache_read_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
    pub estimated_cost: f64,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct DailyTokensResponse {
    pub days: Vec<DailyTokenDataPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SessionTokenEntry {
    pub session_id: String,
    pub title: String,
    pub run_count: i64,
    pub total_tokens: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub estimated_cost: f64,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct SessionTokensResponse {
    pub sessions: Vec<SessionTokenEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowStepTokenEntry {
    pub session_id: String,
    pub session_title: String,
    pub workflow_execution_id: String,
    pub workflow_step_id: String,
    pub workflow_step_key: String,
    pub workflow_step_title: String,
    pub agent_name: Option<String>,
    pub latest_run_id: Option<String>,
    pub run_count: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
    pub estimated_cost: f64,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
}

impl From<services::services::build_stats::token_cost_stats::WorkflowStepTokenStats>
    for WorkflowStepTokenEntry
{
    fn from(
        stats: services::services::build_stats::token_cost_stats::WorkflowStepTokenStats,
    ) -> Self {
        Self {
            session_id: stats.session_id,
            session_title: stats.session_title,
            workflow_execution_id: stats.workflow_execution_id,
            workflow_step_id: stats.workflow_step_id,
            workflow_step_key: stats.workflow_step_key,
            workflow_step_title: stats.workflow_step_title,
            agent_name: stats.agent_name,
            latest_run_id: stats.latest_run_id,
            run_count: stats.run_count,
            input_tokens: stats.input_tokens,
            output_tokens: stats.output_tokens,
            cache_read_tokens: stats.cache_read_tokens,
            reasoning_output_tokens: stats.reasoning_output_tokens,
            total_tokens: stats.total_tokens,
            estimated_cost: stats.estimated_cost,
            model_id: stats.model_id,
            model_name: stats.model_name,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct WorkflowStepTokensResponse {
    pub steps: Vec<WorkflowStepTokenEntry>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct WorkflowStepTokenUsageResponse {
    pub usage: Option<WorkflowStepTokenEntry>,
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
    pub period: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateModelPricingRequest {
    pub custom_input_price: Option<Option<f64>>,
    pub custom_output_price: Option<Option<f64>>,
    pub custom_cache_read_price: Option<Option<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ModelUsageRow {
    pub model_id: String,
    pub model_name: String,
    pub total_tokens: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub input_price_per_1m: f64,
    pub output_price_per_1m: f64,
    pub cache_read_price_per_1m: f64,
    pub estimated_cost: f64,
    pub price_source: String,
    pub cache_price_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ModelPriceRow {
    pub model_id: String,
    pub model_name: String,
    pub input_price_per_1m: f64,
    pub output_price_per_1m: f64,
    pub cache_read_price_per_1m: Option<f64>,
    pub custom_input_price: Option<f64>,
    pub custom_output_price: Option<f64>,
    pub custom_cache_read_price: Option<f64>,
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
        .route(
            "/build-stats/session-workflow-step-tokens",
            get(get_session_workflow_step_tokens),
        )
        .route("/build-stats/activity", get(get_activity))
        .route("/build-stats/model-pricing", get(get_model_pricing))
        .route(
            "/build-stats/model-pricing/{model_id}",
            put(update_model_pricing),
        )
        .route(
            "/build-stats/model-pricing/{model_id}/custom",
            delete(reset_model_pricing),
        )
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

fn parse_filter_date(date: &str) -> Result<NaiveDate, ApiError> {
    let valid_shape = date.len() == 10
        && date.as_bytes()[4] == b'-'
        && date.as_bytes()[7] == b'-'
        && date
            .as_bytes()
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit());
    if !valid_shape {
        return Err(ApiError::BadRequest(
            "Invalid date. Must use YYYY-MM-DD".to_string(),
        ));
    }
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid date. Must use YYYY-MM-DD".to_string()))
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
    let data_map: HashMap<String, &DailyTokenDataPoint> =
        sparse_data.iter().map(|dp| (dp.date.clone(), dp)).collect();

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
                cache_read_tokens: 0,
                reasoning_output_tokens: 0,
                total_tokens: 0,
                estimated_cost: 0.0,
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

    let data_map: HashMap<String, &ActivityDataPoint> =
        sparse_data.iter().map(|dp| (dp.date.clone(), dp)).collect();

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
    let end_date = today;

    let sparse_data: Vec<DailyTokenDataPoint> = TokenCostStatsService::new()
        .daily_tokens(pool, params.project_id, start_date, end_date)
        .await?
        .into_iter()
        .map(|stats| DailyTokenDataPoint {
            date: stats.date,
            input_tokens: stats.input_tokens,
            output_tokens: stats.output_tokens,
            cache_read_tokens: stats.cache_read_tokens,
            reasoning_output_tokens: stats.reasoning_output_tokens,
            total_tokens: stats.total_tokens,
            estimated_cost: stats.estimated_cost,
        })
        .collect();

    let days = fill_zero_days(sparse_data, start_date, num_days);

    Ok(ResponseJson(ApiResponse::success(DailyTokensResponse {
        days,
    })))
}
// 鈹€鈹€鈹€ Internal Types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

// 鈹€鈹€鈹€ Session Tokens Handler 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

async fn get_session_tokens(
    State(deployment): State<DeploymentImpl>,
    Query(params): Query<SessionTokensQuery>,
) -> Result<ResponseJson<ApiResponse<SessionTokensResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let limit = params.limit.unwrap_or(50).min(50);

    let sessions: Vec<SessionTokenEntry> = TokenCostStatsService::new()
        .session_tokens(pool, params.project_id, limit)
        .await?
        .into_iter()
        .map(|stats| SessionTokenEntry {
            session_id: stats.session_id,
            title: stats.title,
            run_count: stats.run_count,
            total_tokens: stats.total_tokens,
            input_tokens: stats.input_tokens,
            output_tokens: stats.output_tokens,
            cache_read_tokens: stats.cache_read_tokens,
            reasoning_output_tokens: stats.reasoning_output_tokens,
            estimated_cost: stats.estimated_cost,
        })
        .collect();

    Ok(ResponseJson(ApiResponse::success(SessionTokensResponse {
        sessions,
    })))
}
async fn get_session_workflow_step_tokens(
    State(deployment): State<DeploymentImpl>,
    Query(params): Query<SessionWorkflowStepTokensQuery>,
) -> Result<ResponseJson<ApiResponse<WorkflowStepTokensResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let steps: Vec<WorkflowStepTokenEntry> = TokenCostStatsService::new()
        .session_workflow_step_tokens(pool, params.project_id, &params.session_id)
        .await?
        .into_iter()
        .map(WorkflowStepTokenEntry::from)
        .collect();

    Ok(ResponseJson(ApiResponse::success(
        WorkflowStepTokensResponse { steps },
    )))
}

// 鈹€鈹€鈹€ Activity Handler 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

#[derive(Debug, sqlx::FromRow)]
struct ActivityTrendRow {
    date: String,
    bugs_fixed: i64,
    features_delivered: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct IssueActivityRow {
    date: String,
    labels_json: Option<String>,
    github_metadata_json: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IssueActivityCategory {
    Bugfix,
    Feature,
}

fn labels_from_json_array(value: Option<&str>) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(value).unwrap_or_default()
}

fn github_issue_labels_from_metadata(value: Option<&str>) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(value) else {
        return Vec::new();
    };
    parsed
        .get("summary")
        .and_then(|summary| summary.get("labels"))
        .and_then(|labels| labels.as_array())
        .map(|labels| {
            labels
                .iter()
                .filter_map(|label| label.as_str())
                .map(str::trim)
                .filter(|label| !label.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn issue_labels_contain(labels: &[String], candidates: &[&str]) -> bool {
    labels.iter().any(|label| {
        let normalized = label.to_ascii_lowercase().replace(['_', '-', '/'], " ");
        candidates.iter().any(|candidate| {
            normalized == *candidate
                || normalized.ends_with(&format!(" {candidate}"))
                || normalized.ends_with(&format!(":{candidate}"))
        })
    })
}

fn issue_activity_category(labels: &[String]) -> Option<IssueActivityCategory> {
    if issue_labels_contain(labels, &["bug"]) {
        Some(IssueActivityCategory::Bugfix)
    } else if issue_labels_contain(
        labels,
        &[
            "feature",
            "enhancement",
            "improvement",
            "feature request",
            "new feature",
        ],
    ) {
        Some(IssueActivityCategory::Feature)
    } else {
        None
    }
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

    let issue_rows = sqlx::query_as::<_, IssueActivityRow>(
        r#"
        WITH completed_issues AS (
            SELECT
                pwi.id,
                CASE
                    WHEN pwi.status = 'done' THEN pwi.updated_at
                    ELSE (
                        SELECT MAX(link.updated_at)
                        FROM project_work_item_external_links link
                        WHERE link.project_work_item_id = pwi.id
                          AND link.external_type = 'github_issue'
                          AND lower(COALESCE(link.state, '')) = 'closed'
                    )
                END AS completed_at,
                pwi.labels_json,
                (
                    SELECT link.metadata_json
                    FROM project_work_item_external_links link
                    WHERE link.project_work_item_id = pwi.id
                      AND link.provider = 'github'
                      AND link.external_type = 'github_issue'
                      AND link.metadata_json IS NOT NULL
                    ORDER BY link.updated_at DESC
                    LIMIT 1
                ) AS github_metadata_json
            FROM project_work_items pwi
            WHERE (
                pwi.project_id = ?1
                OR replace(lower(CAST(pwi.project_id AS TEXT)), '-', '') = lower(hex(?1))
              )
              AND (
                pwi.status = 'done'
                OR EXISTS (
                    SELECT 1
                    FROM project_work_item_external_links link
                    WHERE link.project_work_item_id = pwi.id
                      AND link.external_type = 'github_issue'
                      AND lower(COALESCE(link.state, '')) = 'closed'
                )
              )
        )
        SELECT
            date(completed_at) AS date,
            labels_json,
            github_metadata_json
        FROM completed_issues
        WHERE completed_at IS NOT NULL
          AND completed_at >= ?2
        ORDER BY date ASC
        "#,
    )
    .bind(params.project_id)
    .bind(&start_timestamp)
    .fetch_all(pool)
    .await?;

    let mut activity_by_date = std::collections::HashMap::<String, ActivityDataPoint>::new();
    for row in rows {
        activity_by_date.insert(
            row.date.clone(),
            ActivityDataPoint {
                date: row.date,
                bugs_fixed: row.bugs_fixed,
                features_delivered: row.features_delivered,
            },
        );
    }
    for row in issue_rows {
        let mut labels = labels_from_json_array(row.labels_json.as_deref());
        labels.extend(github_issue_labels_from_metadata(
            row.github_metadata_json.as_deref(),
        ));
        let Some(category) = issue_activity_category(&labels) else {
            continue;
        };
        let entry = activity_by_date
            .entry(row.date.clone())
            .or_insert(ActivityDataPoint {
                date: row.date,
                bugs_fixed: 0,
                features_delivered: 0,
            });
        match category {
            IssueActivityCategory::Bugfix => entry.bugs_fixed += 1,
            IssueActivityCategory::Feature => entry.features_delivered += 1,
        }
    }

    let mut sparse_data = activity_by_date.into_values().collect::<Vec<_>>();
    sparse_data.sort_by(|a, b| a.date.cmp(&b.date));
    let days = fill_zero_activity_days(sparse_data, start_date, num_days);

    Ok(ResponseJson(ApiResponse::success(ActivityResponse {
        days,
    })))
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

async fn get_model_pricing(
    State(deployment): State<DeploymentImpl>,
    Query(params): Query<ModelPricingQuery>,
) -> Result<ResponseJson<ApiResponse<ModelPricingResponse>>, ApiError> {
    let pool = &deployment.db().pool;

    let service = TokenCostStatsService::new();
    let model_stats = if let Some(date) = params.date.as_deref() {
        let date = parse_filter_date(date)?;
        service
            .model_usage_for_period(pool, params.project_id, date, date, u32::MAX)
            .await?
    } else if let Some(period) = params.period.as_deref() {
        let num_days = parse_period_days(period)?;
        let today = Utc::now().date_naive();
        let start_date = today - chrono::Duration::days(num_days - 1);
        service
            .model_usage_for_period(pool, params.project_id, start_date, today, u32::MAX)
            .await?
    } else {
        service
            .model_usage(pool, params.project_id, u32::MAX)
            .await?
    };

    let models = model_stats
        .into_iter()
        .map(|stats| ModelUsageRow {
            model_id: stats.model_id,
            model_name: stats.model_name,
            total_tokens: stats.total_tokens,
            input_tokens: stats.input_tokens,
            output_tokens: stats.output_tokens,
            cache_read_tokens: stats.cache_read_tokens,
            reasoning_output_tokens: stats.reasoning_output_tokens,
            input_price_per_1m: stats.input_price_per_1m,
            output_price_per_1m: stats.output_price_per_1m,
            cache_read_price_per_1m: stats.cache_read_price_per_1m,
            estimated_cost: stats.estimated_cost,
            price_source: stats.price_source,
            cache_price_source: stats.cache_price_source,
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
        validate_price(*price)
            .map_err(|e| ApiError::BadRequest(format!("custom_input_price: {}", e)))?;
    }
    if let Some(Some(price)) = &body.custom_output_price {
        validate_price(*price)
            .map_err(|e| ApiError::BadRequest(format!("custom_output_price: {}", e)))?;
    }
    if let Some(Some(price)) = &body.custom_cache_read_price {
        validate_price(*price)
            .map_err(|e| ApiError::BadRequest(format!("custom_cache_read_price: {}", e)))?;
    }

    let cache_row = sqlx::query_as::<_, (String, String, f64, f64, Option<f64>, String, String)>(
        r#"
        SELECT
            model_id,
            model_name,
            input_price_per_1m,
            output_price_per_1m,
            cache_read_price_per_1m,
            source,
            updated_at
        FROM model_price_cache
        WHERE model_id = ?1
        "#,
    )
    .bind(&model_id)
    .fetch_optional(pool)
    .await?;

    // Determine the custom prices to set
    // If the field is Some(value), use that value (which may be Some(price) or None to clear)
    // If the field is None (not provided), keep existing value
    let existing = sqlx::query_as::<_, (Option<f64>, Option<f64>, Option<f64>, Option<String>)>(
        "SELECT custom_input_price, custom_output_price, custom_cache_read_price, model_name FROM model_pricing WHERE project_id = ?1 AND model_id = ?2",
    )
    .bind(params.project_id)
    .bind(&model_id)
    .fetch_optional(pool)
    .await?;

    let (existing_input, existing_output, existing_cache_read, existing_model_name) =
        existing.unwrap_or((None, None, None, None));

    let (model_name, input_price, output_price, cache_read_price, source, price_updated_at) =
        cache_row
            .map(
                |(
                    _,
                    model_name,
                    input_price,
                    output_price,
                    cache_read_price,
                    source,
                    updated_at,
                )| {
                    (
                        model_name,
                        input_price,
                        output_price,
                        cache_read_price,
                        source,
                        updated_at,
                    )
                },
            )
            .unwrap_or_else(|| {
                (
                    existing_model_name
                        .filter(|name| !name.trim().is_empty())
                        .unwrap_or_else(|| model_id.clone()),
                    0.0,
                    0.0,
                    None,
                    "custom".to_string(),
                    Utc::now().to_rfc3339(),
                )
            });

    let new_input_price = match body.custom_input_price {
        Some(val) => val,
        None => existing_input,
    };
    let new_output_price = match body.custom_output_price {
        Some(val) => val,
        None => existing_output,
    };
    let new_cache_read_price = match body.custom_cache_read_price {
        Some(val) => val,
        None => existing_cache_read,
    };

    // Upsert into model_pricing (INSERT OR REPLACE)
    let new_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO model_pricing (
            id,
            project_id,
            model_id,
            model_name,
            input_price_per_1m,
            output_price_per_1m,
            cache_read_price_per_1m,
            custom_input_price,
            custom_output_price,
            custom_cache_read_price,
            price_source,
            price_updated_at,
            created_at,
            updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, datetime('now', 'subsec'), datetime('now', 'subsec'))
        ON CONFLICT(project_id, model_id) DO UPDATE SET
            model_name = excluded.model_name,
            input_price_per_1m = excluded.input_price_per_1m,
            output_price_per_1m = excluded.output_price_per_1m,
            cache_read_price_per_1m = excluded.cache_read_price_per_1m,
            custom_input_price = excluded.custom_input_price,
            custom_output_price = excluded.custom_output_price,
            custom_cache_read_price = excluded.custom_cache_read_price,
            price_source = excluded.price_source,
            price_updated_at = excluded.price_updated_at,
            updated_at = datetime('now', 'subsec')
        "#,
    )
    .bind(new_id)
    .bind(params.project_id)
    .bind(&model_id)
    .bind(&model_name)
    .bind(input_price)
    .bind(output_price)
    .bind(cache_read_price)
    .bind(new_input_price)
    .bind(new_output_price)
    .bind(new_cache_read_price)
    .bind(&source)
    .bind(&price_updated_at)
    .execute(pool)
    .await?;

    Ok(ResponseJson(ApiResponse::success(ModelPriceRow {
        model_id,
        model_name,
        input_price_per_1m: input_price,
        output_price_per_1m: output_price,
        cache_read_price_per_1m: cache_read_price,
        custom_input_price: new_input_price,
        custom_output_price: new_output_price,
        custom_cache_read_price: new_cache_read_price,
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

    let cache_row = sqlx::query_as::<_, (String, String, f64, f64, Option<f64>, String, String)>(
        r#"
        SELECT
            model_id,
            model_name,
            input_price_per_1m,
            output_price_per_1m,
            cache_read_price_per_1m,
            source,
            updated_at
        FROM model_price_cache
        WHERE model_id = ?1
        "#,
    )
    .bind(&model_id)
    .fetch_optional(pool)
    .await?;

    let existing_model_name = sqlx::query_as::<_, (Option<String>,)>(
        "SELECT model_name FROM model_pricing WHERE project_id = ?1 AND model_id = ?2",
    )
    .bind(params.project_id)
    .bind(&model_id)
    .fetch_optional(pool)
    .await?
    .and_then(|row| row.0);

    let (model_name, input_price, output_price, cache_read_price, source, price_updated_at) =
        cache_row
            .map(
                |(
                    _,
                    model_name,
                    input_price,
                    output_price,
                    cache_read_price,
                    source,
                    updated_at,
                )| {
                    (
                        model_name,
                        input_price,
                        output_price,
                        cache_read_price,
                        source,
                        updated_at,
                    )
                },
            )
            .unwrap_or_else(|| {
                (
                    existing_model_name
                        .filter(|name| !name.trim().is_empty())
                        .unwrap_or_else(|| model_id.clone()),
                    0.0,
                    0.0,
                    None,
                    "custom".to_string(),
                    Utc::now().to_rfc3339(),
                )
            });

    // Reset custom prices to NULL
    sqlx::query(
        r#"
        UPDATE model_pricing
        SET
            custom_input_price = NULL,
            custom_output_price = NULL,
            custom_cache_read_price = NULL,
            updated_at = datetime('now', 'subsec')
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
        cache_read_price_per_1m: cache_read_price,
        custom_input_price: None,
        custom_output_price: None,
        custom_cache_read_price: None,
        price_source: source,
        price_updated_at,
    })))
}

// 鈹€鈹€鈹€ Tests 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::*;

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

    #[test]
    fn test_parse_filter_date() {
        assert_eq!(
            parse_filter_date("2026-06-03").unwrap(),
            NaiveDate::from_ymd_opt(2026, 6, 3).unwrap()
        );
        assert!(parse_filter_date("2026/06/03").is_err());
        assert!(parse_filter_date("2026-6-3").is_err());
        assert!(parse_filter_date("").is_err());
    }

    #[test]
    fn test_issue_activity_category_prefers_bug_labels() {
        let labels = vec!["enhancement".to_string(), "bug".to_string()];
        assert_eq!(
            issue_activity_category(&labels),
            Some(IssueActivityCategory::Bugfix)
        );
    }

    #[test]
    fn test_issue_activity_category_matches_feature_synonyms() {
        for label in [
            "feature",
            "enhancement",
            "type:feature",
            "kind/enhancement",
            "feature request",
            "new feature",
        ] {
            let labels = vec![label.to_string()];
            assert_eq!(
                issue_activity_category(&labels),
                Some(IssueActivityCategory::Feature),
                "label {label} should count as feature activity"
            );
        }
    }

    #[test]
    fn test_github_issue_labels_from_metadata() {
        let metadata = serde_json::json!({
            "summary": {
                "labels": ["bug", "needs triage"]
            }
        })
        .to_string();
        assert_eq!(
            github_issue_labels_from_metadata(Some(&metadata)),
            vec!["bug".to_string(), "needs triage".to_string()]
        );
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
            assert_eq!(dp.cache_read_tokens, 0);
            assert_eq!(dp.reasoning_output_tokens, 0);
            assert_eq!(dp.total_tokens, 0);
            assert_eq!(dp.estimated_cost, 0.0);
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
                cache_read_tokens: 10,
                reasoning_output_tokens: 0,
                total_tokens: 300,
                estimated_cost: 0.5,
            },
            DailyTokenDataPoint {
                date: "2025-01-05".to_string(),
                input_tokens: 50,
                output_tokens: 75,
                cache_read_tokens: 0,
                reasoning_output_tokens: 0,
                total_tokens: 125,
                estimated_cost: 0.2,
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
        assert_eq!(result[1].cache_read_tokens, 10);
        assert_eq!(result[1].estimated_cost, 0.5);
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
                cache_read_tokens: 0,
                reasoning_output_tokens: 0,
                total_tokens: 30,
                estimated_cost: 0.0,
            },
            DailyTokenDataPoint {
                date: "2025-06-02".to_string(),
                input_tokens: 40,
                output_tokens: 50,
                cache_read_tokens: 0,
                reasoning_output_tokens: 0,
                total_tokens: 90,
                estimated_cost: 0.0,
            },
            DailyTokenDataPoint {
                date: "2025-06-03".to_string(),
                input_tokens: 70,
                output_tokens: 80,
                cache_read_tokens: 0,
                reasoning_output_tokens: 0,
                total_tokens: 150,
                estimated_cost: 0.0,
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
        let sparse = vec![DailyTokenDataPoint {
            date: "2025-03-30".to_string(),
            input_tokens: 5,
            output_tokens: 10,
            cache_read_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 15,
            estimated_cost: 0.0,
        }];

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
