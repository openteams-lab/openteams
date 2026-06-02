use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ModelPricing {
    pub id: Uuid,
    pub project_id: Uuid,
    pub model_id: String,
    pub model_name: String,
    pub input_price_per_1m: f64,
    pub output_price_per_1m: f64,
    pub cache_read_price_per_1m: Option<f64>,
    pub custom_input_price: Option<f64>,
    pub custom_output_price: Option<f64>,
    pub custom_cache_read_price: Option<f64>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}
