use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ModelPriceCache {
    pub model_id: String,
    pub model_name: String,
    pub input_price_per_1m: f64,
    pub output_price_per_1m: f64,
    pub cache_read_price_per_1m: Option<f64>,
    pub litellm_input_price: Option<f64>,
    pub litellm_output_price: Option<f64>,
    pub litellm_cache_read_price: Option<f64>,
    pub openrouter_input_price: Option<f64>,
    pub openrouter_output_price: Option<f64>,
    pub openrouter_cache_read_price: Option<f64>,
    pub source: String,
    pub last_fetched_at: String,
    pub updated_at: String,
}
