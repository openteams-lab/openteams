use std::collections::HashMap;

use anyhow::{Context, Result};
use chrono::Utc;
use serde::Deserialize;
use sqlx::SqlitePool;
use tracing::{info, warn};

/// URL for LiteLLM model pricing data
const LITELLM_PRICES_URL: &str =
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/// URL for OpenRouter model listing
const OPENROUTER_MODELS_URL: &str = "https://openrouter.ai/api/v1/models";

/// Maximum acceptable price per 1M tokens (validation threshold)
const MAX_PRICE_PER_1M: f64 = 10000.0;

/// Model ID alias mapping for cross-source matching.
/// Each entry maps a canonical model_id to a list of known aliases
/// used by different pricing sources.
const MODEL_ID_ALIASES: &[(&str, &[&str])] = &[
    (
        "claude-3.5-sonnet",
        &["claude-3-5-sonnet-20241022", "anthropic/claude-3.5-sonnet"],
    ),
    ("gpt-4o", &["gpt-4o-2024-08-06", "openai/gpt-4o"]),
    (
        "gemini-1.5-pro",
        &["gemini-1.5-pro-latest", "google/gemini-pro-1.5"],
    ),
    ("claude-3-haiku", &["claude-3-haiku-20240307", "anthropic/claude-3-haiku"]),
    ("gpt-4o-mini", &["gpt-4o-mini-2024-07-18", "openai/gpt-4o-mini"]),
    (
        "gemini-1.5-flash",
        &["gemini-1.5-flash-latest", "google/gemini-flash-1.5"],
    ),
    ("qwen-2.5-coder", &["qwen/qwen-2.5-coder-32b-instruct"]),
];

/// Seed data used as fallback when price sync fails or hasn't run yet.
const SEED_DATA: &[SeedModel] = &[
    SeedModel {
        model_id: "claude-3.5-sonnet",
        model_name: "Claude 3.5 Sonnet",
        input_price_per_1m: 3.0,
        output_price_per_1m: 15.0,
    },
    SeedModel {
        model_id: "claude-3-haiku",
        model_name: "Claude 3 Haiku",
        input_price_per_1m: 0.25,
        output_price_per_1m: 1.25,
    },
    SeedModel {
        model_id: "gpt-4o",
        model_name: "GPT-4o",
        input_price_per_1m: 2.5,
        output_price_per_1m: 10.0,
    },
    SeedModel {
        model_id: "gpt-4o-mini",
        model_name: "GPT-4o mini",
        input_price_per_1m: 0.15,
        output_price_per_1m: 0.6,
    },
    SeedModel {
        model_id: "gemini-1.5-pro",
        model_name: "Gemini 1.5 Pro",
        input_price_per_1m: 1.25,
        output_price_per_1m: 5.0,
    },
    SeedModel {
        model_id: "gemini-1.5-flash",
        model_name: "Gemini 1.5 Flash",
        input_price_per_1m: 0.075,
        output_price_per_1m: 0.3,
    },
    SeedModel {
        model_id: "qwen-2.5-coder",
        model_name: "Qwen 2.5 Coder",
        input_price_per_1m: 0.14,
        output_price_per_1m: 0.28,
    },
];

/// A seed model entry with hardcoded pricing.
struct SeedModel {
    model_id: &'static str,
    model_name: &'static str,
    input_price_per_1m: f64,
    output_price_per_1m: f64,
}

/// Raw price data extracted from a single source.
#[derive(Debug, Clone)]
pub struct RawModelPrice {
    pub model_id: String,
    pub model_name: String,
    pub input_price_per_1m: f64,
    pub output_price_per_1m: f64,
    pub source: String,
}

/// Merged price data combining multiple sources.
#[derive(Debug, Clone)]
pub struct MergedModelPrice {
    pub model_id: String,
    pub model_name: String,
    pub input_price_per_1m: f64,
    pub output_price_per_1m: f64,
    pub litellm_input_price: Option<f64>,
    pub litellm_output_price: Option<f64>,
    pub openrouter_input_price: Option<f64>,
    pub openrouter_output_price: Option<f64>,
    pub source: String,
}

/// Response shape from OpenRouter `/api/v1/models`
#[derive(Debug, Deserialize)]
struct OpenRouterResponse {
    data: Vec<OpenRouterModel>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterModel {
    id: String,
    name: Option<String>,
    pricing: Option<OpenRouterPricing>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterPricing {
    prompt: Option<String>,
    completion: Option<String>,
}

/// LiteLLM model entry shape (only the fields we need)
#[derive(Debug, Deserialize)]
struct LiteLLMModelEntry {
    input_cost_per_token: Option<f64>,
    output_cost_per_token: Option<f64>,
}

/// Service responsible for syncing model pricing from external sources
/// and maintaining the `model_price_cache` table.
#[derive(Clone, Default)]
pub struct ModelPricingSyncService;

impl ModelPricingSyncService {
    pub fn new() -> Self {
        Self
    }

    /// Execute daily price sync: fetch latest prices from LiteLLM and OpenRouter,
    /// merge them, and update the model_price_cache table.
    /// Falls back to seed data if both fetches fail.
    pub async fn sync_prices(&self, pool: &SqlitePool) -> Result<()> {
        let litellm_result = self.fetch_litellm_prices().await;
        let openrouter_result = self.fetch_openrouter_prices().await;

        let litellm_prices = match litellm_result {
            Ok(prices) => {
                info!("Fetched {} prices from LiteLLM", prices.len());
                prices
            }
            Err(e) => {
                warn!("Failed to fetch LiteLLM prices: {e}");
                Vec::new()
            }
        };

        let openrouter_prices = match openrouter_result {
            Ok(prices) => {
                info!("Fetched {} prices from OpenRouter", prices.len());
                prices
            }
            Err(e) => {
                warn!("Failed to fetch OpenRouter prices: {e}");
                Vec::new()
            }
        };

        let merged = if litellm_prices.is_empty() && openrouter_prices.is_empty() {
            warn!("Both price sources failed, using seed data as fallback");
            self.get_seed_data()
        } else {
            self.merge_prices(litellm_prices, openrouter_prices)
        };

        self.update_cache(pool, merged).await?;
        Ok(())
    }

    /// Fetch model pricing from LiteLLM GitHub repository.
    /// The JSON is a map of model_id -> { input_cost_per_token, output_cost_per_token, ... }
    /// Prices are in USD per token, we convert to USD per 1M tokens.
    pub async fn fetch_litellm_prices(&self) -> Result<Vec<RawModelPrice>> {
        let client = reqwest::Client::new();
        let response = client
            .get(LITELLM_PRICES_URL)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .context("Failed to fetch LiteLLM prices")?;

        let body: HashMap<String, serde_json::Value> = response
            .json()
            .await
            .context("Failed to parse LiteLLM JSON response")?;

        let mut prices = Vec::new();

        for (model_id, value) in &body {
            // Skip non-object entries (e.g., "sample_spec" key)
            let entry: LiteLLMModelEntry = match serde_json::from_value(value.clone()) {
                Ok(e) => e,
                Err(_) => continue,
            };

            let input_cost = entry.input_cost_per_token.unwrap_or(0.0);
            let output_cost = entry.output_cost_per_token.unwrap_or(0.0);

            // Convert from per-token to per-1M tokens
            let input_price_per_1m = input_cost * 1_000_000.0;
            let output_price_per_1m = output_cost * 1_000_000.0;

            // Validate prices
            if !is_valid_price(input_price_per_1m) || !is_valid_price(output_price_per_1m) {
                continue;
            }

            // Skip entries with zero prices for both
            if input_price_per_1m == 0.0 && output_price_per_1m == 0.0 {
                continue;
            }

            prices.push(RawModelPrice {
                model_id: model_id.clone(),
                model_name: model_id.clone(),
                input_price_per_1m,
                output_price_per_1m,
                source: "litellm".to_string(),
            });
        }

        Ok(prices)
    }

    /// Fetch model pricing from OpenRouter API.
    /// Prices are in USD per token (as strings), we convert to USD per 1M tokens.
    pub async fn fetch_openrouter_prices(&self) -> Result<Vec<RawModelPrice>> {
        let client = reqwest::Client::new();
        let response = client
            .get(OPENROUTER_MODELS_URL)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .context("Failed to fetch OpenRouter models")?;

        let body: OpenRouterResponse = response
            .json()
            .await
            .context("Failed to parse OpenRouter JSON response")?;

        let mut prices = Vec::new();

        for model in body.data {
            let pricing = match model.pricing {
                Some(p) => p,
                None => continue,
            };

            let input_cost: f64 = pricing
                .prompt
                .as_deref()
                .unwrap_or("0")
                .parse()
                .unwrap_or(0.0);
            let output_cost: f64 = pricing
                .completion
                .as_deref()
                .unwrap_or("0")
                .parse()
                .unwrap_or(0.0);

            // Convert from per-token to per-1M tokens
            let input_price_per_1m = input_cost * 1_000_000.0;
            let output_price_per_1m = output_cost * 1_000_000.0;

            // Validate prices
            if !is_valid_price(input_price_per_1m) || !is_valid_price(output_price_per_1m) {
                continue;
            }

            // Skip entries with zero prices for both
            if input_price_per_1m == 0.0 && output_price_per_1m == 0.0 {
                continue;
            }

            let model_name = model.name.unwrap_or_else(|| model.id.clone());

            prices.push(RawModelPrice {
                model_id: model.id,
                model_name,
                input_price_per_1m,
                output_price_per_1m,
                source: "openrouter".to_string(),
            });
        }

        Ok(prices)
    }

    /// Merge prices from LiteLLM and OpenRouter sources.
    /// For the same model (matched via canonical ID or alias mapping),
    /// take the **lower** price when both sources have data.
    pub fn merge_prices(
        &self,
        litellm: Vec<RawModelPrice>,
        openrouter: Vec<RawModelPrice>,
    ) -> Vec<MergedModelPrice> {
        // Build lookup maps keyed by canonical model ID
        let mut litellm_map: HashMap<String, &RawModelPrice> = HashMap::new();
        for price in &litellm {
            let canonical = resolve_canonical_id(&price.model_id);
            litellm_map.entry(canonical).or_insert(price);
        }

        let mut openrouter_map: HashMap<String, &RawModelPrice> = HashMap::new();
        for price in &openrouter {
            let canonical = resolve_canonical_id(&price.model_id);
            openrouter_map.entry(canonical).or_insert(price);
        }

        // Collect all unique canonical IDs
        let mut all_ids: Vec<String> = litellm_map.keys().cloned().collect();
        for id in openrouter_map.keys() {
            if !all_ids.contains(id) {
                all_ids.push(id.clone());
            }
        }

        let mut merged = Vec::new();

        for canonical_id in all_ids {
            let litellm_entry = litellm_map.get(&canonical_id);
            let openrouter_entry = openrouter_map.get(&canonical_id);

            let (input_price, output_price, source, litellm_input, litellm_output, or_input, or_output, model_name) =
                match (litellm_entry, openrouter_entry) {
                    (Some(l), Some(o)) => {
                        // Both sources: take lower price for each direction
                        let input = l.input_price_per_1m.min(o.input_price_per_1m);
                        let output = l.output_price_per_1m.min(o.output_price_per_1m);
                        (
                            input,
                            output,
                            "merged".to_string(),
                            Some(l.input_price_per_1m),
                            Some(l.output_price_per_1m),
                            Some(o.input_price_per_1m),
                            Some(o.output_price_per_1m),
                            // Prefer OpenRouter name as it's usually more human-readable
                            o.model_name.clone(),
                        )
                    }
                    (Some(l), None) => (
                        l.input_price_per_1m,
                        l.output_price_per_1m,
                        "litellm".to_string(),
                        Some(l.input_price_per_1m),
                        Some(l.output_price_per_1m),
                        None,
                        None,
                        l.model_name.clone(),
                    ),
                    (None, Some(o)) => (
                        o.input_price_per_1m,
                        o.output_price_per_1m,
                        "openrouter".to_string(),
                        None,
                        None,
                        Some(o.input_price_per_1m),
                        Some(o.output_price_per_1m),
                        o.model_name.clone(),
                    ),
                    (None, None) => continue,
                };

            merged.push(MergedModelPrice {
                model_id: canonical_id,
                model_name,
                input_price_per_1m: input_price,
                output_price_per_1m: output_price,
                litellm_input_price: litellm_input,
                litellm_output_price: litellm_output,
                openrouter_input_price: or_input,
                openrouter_output_price: or_output,
                source,
            });
        }

        merged
    }

    /// Update the `model_price_cache` table with merged price data.
    /// Uses INSERT OR REPLACE (upsert) semantics.
    pub async fn update_cache(
        &self,
        pool: &SqlitePool,
        prices: Vec<MergedModelPrice>,
    ) -> Result<()> {
        let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        for price in &prices {
            sqlx::query(
                r#"
                INSERT OR REPLACE INTO model_price_cache (
                    model_id, model_name, input_price_per_1m, output_price_per_1m,
                    litellm_input_price, litellm_output_price,
                    openrouter_input_price, openrouter_output_price,
                    source, last_fetched_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                "#,
            )
            .bind(&price.model_id)
            .bind(&price.model_name)
            .bind(price.input_price_per_1m)
            .bind(price.output_price_per_1m)
            .bind(price.litellm_input_price)
            .bind(price.litellm_output_price)
            .bind(price.openrouter_input_price)
            .bind(price.openrouter_output_price)
            .bind(&price.source)
            .bind(&now)
            .bind(&now)
            .execute(pool)
            .await
            .context("Failed to upsert model_price_cache")?;
        }

        info!("Updated model_price_cache with {} entries", prices.len());
        Ok(())
    }

    /// Get seed data as MergedModelPrice entries (used as fallback).
    pub fn get_seed_data(&self) -> Vec<MergedModelPrice> {
        SEED_DATA
            .iter()
            .map(|seed| MergedModelPrice {
                model_id: seed.model_id.to_string(),
                model_name: seed.model_name.to_string(),
                input_price_per_1m: seed.input_price_per_1m,
                output_price_per_1m: seed.output_price_per_1m,
                litellm_input_price: None,
                litellm_output_price: None,
                openrouter_input_price: None,
                openrouter_output_price: None,
                source: "seed".to_string(),
            })
            .collect()
    }

    /// Ensure seed data exists in the cache table.
    /// Called on startup to guarantee the cache is never empty.
    pub async fn ensure_seed_data(&self, pool: &SqlitePool) -> Result<()> {
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM model_price_cache")
            .fetch_one(pool)
            .await
            .unwrap_or((0,));

        if count.0 == 0 {
            info!("model_price_cache is empty, inserting seed data");
            let seed = self.get_seed_data();
            self.update_cache(pool, seed).await?;
        }

        Ok(())
    }
}

/// Validate that a price is within acceptable bounds.
/// Only accept prices > 0 and < 10000.
fn is_valid_price(price: f64) -> bool {
    price >= 0.0 && price < MAX_PRICE_PER_1M
}

/// Resolve a model ID to its canonical form using the alias mapping.
/// If the ID matches any alias, returns the canonical ID.
/// Otherwise returns the input unchanged.
pub fn resolve_canonical_id(model_id: &str) -> String {
    for (canonical, aliases) in MODEL_ID_ALIASES {
        if *canonical == model_id {
            return canonical.to_string();
        }
        for alias in *aliases {
            if *alias == model_id {
                return canonical.to_string();
            }
        }
    }
    model_id.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_canonical_id_exact_match() {
        assert_eq!(resolve_canonical_id("claude-3.5-sonnet"), "claude-3.5-sonnet");
        assert_eq!(resolve_canonical_id("gpt-4o"), "gpt-4o");
    }

    #[test]
    fn test_resolve_canonical_id_alias_match() {
        assert_eq!(
            resolve_canonical_id("claude-3-5-sonnet-20241022"),
            "claude-3.5-sonnet"
        );
        assert_eq!(
            resolve_canonical_id("anthropic/claude-3.5-sonnet"),
            "claude-3.5-sonnet"
        );
        assert_eq!(resolve_canonical_id("gpt-4o-2024-08-06"), "gpt-4o");
        assert_eq!(resolve_canonical_id("openai/gpt-4o"), "gpt-4o");
        assert_eq!(
            resolve_canonical_id("gemini-1.5-pro-latest"),
            "gemini-1.5-pro"
        );
        assert_eq!(
            resolve_canonical_id("google/gemini-pro-1.5"),
            "gemini-1.5-pro"
        );
    }

    #[test]
    fn test_resolve_canonical_id_unknown() {
        assert_eq!(
            resolve_canonical_id("some-unknown-model"),
            "some-unknown-model"
        );
    }

    #[test]
    fn test_is_valid_price() {
        assert!(is_valid_price(0.0));
        assert!(is_valid_price(1.5));
        assert!(is_valid_price(9999.99));
        assert!(!is_valid_price(10000.0));
        assert!(!is_valid_price(-1.0));
        assert!(!is_valid_price(f64::NAN));
    }

    #[test]
    fn test_merge_prices_takes_lower_when_both_sources() {
        let service = ModelPricingSyncService::new();

        let litellm = vec![RawModelPrice {
            model_id: "gpt-4o".to_string(),
            model_name: "gpt-4o".to_string(),
            input_price_per_1m: 3.0,
            output_price_per_1m: 12.0,
            source: "litellm".to_string(),
        }];

        let openrouter = vec![RawModelPrice {
            model_id: "openai/gpt-4o".to_string(),
            model_name: "GPT-4o".to_string(),
            input_price_per_1m: 2.5,
            output_price_per_1m: 10.0,
            source: "openrouter".to_string(),
        }];

        let merged = service.merge_prices(litellm, openrouter);

        assert_eq!(merged.len(), 1);
        let entry = &merged[0];
        assert_eq!(entry.model_id, "gpt-4o");
        assert_eq!(entry.input_price_per_1m, 2.5); // lower of 3.0 and 2.5
        assert_eq!(entry.output_price_per_1m, 10.0); // lower of 12.0 and 10.0
        assert_eq!(entry.source, "merged");
        assert_eq!(entry.litellm_input_price, Some(3.0));
        assert_eq!(entry.openrouter_input_price, Some(2.5));
    }

    #[test]
    fn test_merge_prices_single_source_litellm() {
        let service = ModelPricingSyncService::new();

        let litellm = vec![RawModelPrice {
            model_id: "claude-3.5-sonnet".to_string(),
            model_name: "claude-3.5-sonnet".to_string(),
            input_price_per_1m: 3.0,
            output_price_per_1m: 15.0,
            source: "litellm".to_string(),
        }];

        let openrouter: Vec<RawModelPrice> = vec![];

        let merged = service.merge_prices(litellm, openrouter);

        assert_eq!(merged.len(), 1);
        let entry = &merged[0];
        assert_eq!(entry.model_id, "claude-3.5-sonnet");
        assert_eq!(entry.input_price_per_1m, 3.0);
        assert_eq!(entry.output_price_per_1m, 15.0);
        assert_eq!(entry.source, "litellm");
        assert_eq!(entry.openrouter_input_price, None);
    }

    #[test]
    fn test_merge_prices_single_source_openrouter() {
        let service = ModelPricingSyncService::new();

        let litellm: Vec<RawModelPrice> = vec![];

        let openrouter = vec![RawModelPrice {
            model_id: "anthropic/claude-3.5-sonnet".to_string(),
            model_name: "Claude 3.5 Sonnet".to_string(),
            input_price_per_1m: 3.0,
            output_price_per_1m: 15.0,
            source: "openrouter".to_string(),
        }];

        let merged = service.merge_prices(litellm, openrouter);

        assert_eq!(merged.len(), 1);
        let entry = &merged[0];
        assert_eq!(entry.model_id, "claude-3.5-sonnet"); // resolved to canonical
        assert_eq!(entry.source, "openrouter");
        assert_eq!(entry.litellm_input_price, None);
    }

    #[test]
    fn test_get_seed_data() {
        let service = ModelPricingSyncService::new();
        let seed = service.get_seed_data();

        assert_eq!(seed.len(), 7);

        let claude = seed.iter().find(|s| s.model_id == "claude-3.5-sonnet").unwrap();
        assert_eq!(claude.model_name, "Claude 3.5 Sonnet");
        assert_eq!(claude.input_price_per_1m, 3.0);
        assert_eq!(claude.output_price_per_1m, 15.0);
        assert_eq!(claude.source, "seed");

        let gpt4o = seed.iter().find(|s| s.model_id == "gpt-4o").unwrap();
        assert_eq!(gpt4o.model_name, "GPT-4o");
        assert_eq!(gpt4o.input_price_per_1m, 2.5);
        assert_eq!(gpt4o.output_price_per_1m, 10.0);

        let gemini = seed.iter().find(|s| s.model_id == "gemini-1.5-pro").unwrap();
        assert_eq!(gemini.model_name, "Gemini 1.5 Pro");
        assert_eq!(gemini.input_price_per_1m, 1.25);
        assert_eq!(gemini.output_price_per_1m, 5.0);
    }

    #[test]
    fn test_merge_prices_alias_matching_across_sources() {
        let service = ModelPricingSyncService::new();

        // LiteLLM uses versioned ID
        let litellm = vec![RawModelPrice {
            model_id: "claude-3-5-sonnet-20241022".to_string(),
            model_name: "claude-3-5-sonnet-20241022".to_string(),
            input_price_per_1m: 3.5,
            output_price_per_1m: 15.0,
            source: "litellm".to_string(),
        }];

        // OpenRouter uses provider-prefixed ID
        let openrouter = vec![RawModelPrice {
            model_id: "anthropic/claude-3.5-sonnet".to_string(),
            model_name: "Claude 3.5 Sonnet".to_string(),
            input_price_per_1m: 3.0,
            output_price_per_1m: 15.0,
            source: "openrouter".to_string(),
        }];

        let merged = service.merge_prices(litellm, openrouter);

        // Both should resolve to the same canonical ID
        assert_eq!(merged.len(), 1);
        let entry = &merged[0];
        assert_eq!(entry.model_id, "claude-3.5-sonnet");
        assert_eq!(entry.input_price_per_1m, 3.0); // lower of 3.5 and 3.0
        assert_eq!(entry.output_price_per_1m, 15.0); // same
        assert_eq!(entry.source, "merged");
    }

    #[tokio::test]
    async fn test_update_cache_and_ensure_seed() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");

        sqlx::query(
            r#"
            CREATE TABLE model_price_cache (
                model_id TEXT PRIMARY KEY,
                model_name TEXT NOT NULL,
                input_price_per_1m REAL NOT NULL DEFAULT 0.0,
                output_price_per_1m REAL NOT NULL DEFAULT 0.0,
                litellm_input_price REAL,
                litellm_output_price REAL,
                openrouter_input_price REAL,
                openrouter_output_price REAL,
                source TEXT NOT NULL DEFAULT 'seed',
                last_fetched_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create model_price_cache table");

        let service = ModelPricingSyncService::new();

        // Ensure seed data populates empty cache
        service.ensure_seed_data(&pool).await.expect("ensure seed data");

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM model_price_cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 7);

        // Ensure seed data doesn't duplicate when called again
        service.ensure_seed_data(&pool).await.expect("ensure seed data again");
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM model_price_cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 7);
    }
}
