use std::collections::HashMap;

use chrono::NaiveDate;
use serde_json::Value;
use sqlx::{FromRow, Result, SqlitePool, types::Json};
use uuid::Uuid;

use super::model_pricing_sync::resolve_canonical_id;

#[derive(Clone, Default)]
pub struct TokenCostStatsService;

#[derive(Debug, Clone, PartialEq)]
pub struct DailyTokenStats {
    pub date: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
    pub estimated_cost: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionTokenStats {
    pub session_id: String,
    pub title: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
    pub estimated_cost: f64,
}

#[derive(Debug, Clone)]
pub struct ModelUsageStats {
    pub model_id: String,
    pub model_name: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
    pub input_price_per_1m: f64,
    pub output_price_per_1m: f64,
    pub cache_read_price_per_1m: f64,
    pub estimated_cost: f64,
    pub price_source: String,
    pub cache_price_source: String,
}

#[derive(Debug, Clone, Default)]
pub struct ProjectTokenCostTotals {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
    pub cost_total: f64,
}

#[derive(Debug, FromRow)]
struct TokenMessageRow {
    message_id: String,
    date: String,
    session_id: String,
    title: Option<String>,
    sender_id: Option<String>,
    runner_type: Option<String>,
    model_name: Option<String>,
    meta: Json<Value>,
}

#[derive(Debug, FromRow)]
struct PriceRow {
    model_id: String,
    input_price_per_1m: f64,
    output_price_per_1m: f64,
    cache_read_price_per_1m: Option<f64>,
    custom_input_price: Option<f64>,
    custom_output_price: Option<f64>,
    custom_cache_read_price: Option<f64>,
    source: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct TokenBreakdown {
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    reasoning_output_tokens: i64,
}

impl TokenBreakdown {
    fn total_tokens(&self) -> i64 {
        self.input_tokens + self.output_tokens
    }

    fn is_zero(&self) -> bool {
        self.input_tokens == 0
            && self.output_tokens == 0
            && self.cache_read_tokens == 0
            && self.reasoning_output_tokens == 0
    }

    fn saturating_delta(&self, previous: &Self) -> Self {
        Self {
            input_tokens: (self.input_tokens - previous.input_tokens).max(0),
            output_tokens: (self.output_tokens - previous.output_tokens).max(0),
            cache_read_tokens: (self.cache_read_tokens - previous.cache_read_tokens).max(0),
            reasoning_output_tokens: (self.reasoning_output_tokens
                - previous.reasoning_output_tokens)
                .max(0),
        }
    }
}

#[derive(Debug, Clone)]
struct TokenUsageCandidate {
    order: usize,
    dedupe_key: String,
    date: String,
    session_id: String,
    title: String,
    thread_key: String,
    model_id: String,
    usage_scope: String,
    delta: Option<TokenBreakdown>,
    snapshot: Option<TokenBreakdown>,
}

#[derive(Debug, Clone)]
struct TokenUsageRecord {
    date: String,
    session_id: String,
    title: String,
    model_id: String,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    reasoning_output_tokens: i64,
    total_tokens: i64,
}

#[derive(Debug, Clone)]
struct EffectivePrice {
    input_price_per_1m: f64,
    output_price_per_1m: f64,
    cache_read_price_per_1m: Option<f64>,
    source: String,
    cache_source: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeUsageSupport {
    NativeUsage,
    GenericTokenUsageOnly,
    UnsupportedNoUsage,
}

#[derive(Debug, Clone)]
struct ResolvedUsagePrice {
    model_name: String,
    input_price_per_1m: f64,
    output_price_per_1m: f64,
    cache_read_price_per_1m: f64,
    source: String,
    cache_source: String,
}

#[derive(Debug, Default, Clone)]
struct TokenAccumulator {
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    reasoning_output_tokens: i64,
    total_tokens: i64,
    estimated_cost: f64,
}

impl TokenAccumulator {
    fn add(&mut self, record: &TokenUsageRecord, estimated_cost: f64) {
        self.input_tokens += record.input_tokens;
        self.output_tokens += record.output_tokens;
        self.cache_read_tokens += record.cache_read_tokens;
        self.reasoning_output_tokens += record.reasoning_output_tokens;
        self.total_tokens += record.total_tokens;
        self.estimated_cost += estimated_cost;
    }
}

impl TokenCostStatsService {
    pub fn new() -> Self {
        Self
    }

    pub async fn daily_tokens(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        start_date: NaiveDate,
        end_date: NaiveDate,
    ) -> Result<Vec<DailyTokenStats>> {
        let records = self
            .load_real_usage_records(pool, project_id, Some(start_date), Some(end_date))
            .await?;
        let prices = self.load_effective_prices(pool, project_id).await?;
        let mut by_day: HashMap<String, TokenAccumulator> = HashMap::new();

        for record in &records {
            let resolved = resolve_usage_price(record, find_effective_price(&prices, record));
            let estimated_cost = estimated_cost_for_record(record, &resolved);
            by_day
                .entry(record.date.clone())
                .or_default()
                .add(record, estimated_cost);
        }

        let mut days: Vec<_> = by_day
            .into_iter()
            .map(|(date, totals)| DailyTokenStats {
                date,
                input_tokens: totals.input_tokens,
                output_tokens: totals.output_tokens,
                cache_read_tokens: totals.cache_read_tokens,
                reasoning_output_tokens: totals.reasoning_output_tokens,
                total_tokens: totals.total_tokens,
                estimated_cost: totals.estimated_cost,
            })
            .collect();
        days.sort_by(|a, b| a.date.cmp(&b.date));
        Ok(days)
    }

    pub async fn session_tokens(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        limit: u32,
    ) -> Result<Vec<SessionTokenStats>> {
        let records = self
            .load_real_usage_records(pool, project_id, None, None)
            .await?;
        let prices = self.load_effective_prices(pool, project_id).await?;
        let mut by_session: HashMap<String, (String, TokenAccumulator)> = HashMap::new();

        for record in &records {
            let resolved = resolve_usage_price(record, find_effective_price(&prices, record));
            let estimated_cost = estimated_cost_for_record(record, &resolved);
            let entry = by_session
                .entry(record.session_id.clone())
                .or_insert_with(|| (record.title.clone(), TokenAccumulator::default()));
            entry.1.add(record, estimated_cost);
        }

        let mut sessions: Vec<_> = by_session
            .into_iter()
            .map(|(session_id, (title, totals))| SessionTokenStats {
                session_id,
                title,
                input_tokens: totals.input_tokens,
                output_tokens: totals.output_tokens,
                cache_read_tokens: totals.cache_read_tokens,
                reasoning_output_tokens: totals.reasoning_output_tokens,
                total_tokens: totals.total_tokens,
                estimated_cost: totals.estimated_cost,
            })
            .collect();
        sessions.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));
        sessions.truncate(limit as usize);
        Ok(sessions)
    }

    pub async fn model_usage(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        limit: u32,
    ) -> Result<Vec<ModelUsageStats>> {
        let records = self
            .load_real_usage_records(pool, project_id, None, None)
            .await?;
        let prices = self.load_effective_prices(pool, project_id).await?;
        Ok(model_usage_from_records(records, prices, limit))
    }

    pub async fn model_usage_for_period(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        start_date: NaiveDate,
        end_date: NaiveDate,
        limit: u32,
    ) -> Result<Vec<ModelUsageStats>> {
        let records = self
            .load_real_usage_records(pool, project_id, Some(start_date), Some(end_date))
            .await?;
        let prices = self.load_effective_prices(pool, project_id).await?;
        Ok(model_usage_from_records(records, prices, limit))
    }

    pub async fn project_period_totals(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        start_date: NaiveDate,
        end_date: NaiveDate,
    ) -> Result<ProjectTokenCostTotals> {
        let records = self
            .load_real_usage_records(pool, project_id, Some(start_date), Some(end_date))
            .await?;
        let prices = self.load_effective_prices(pool, project_id).await?;

        let mut totals = ProjectTokenCostTotals::default();
        for record in &records {
            let resolved = resolve_usage_price(record, find_effective_price(&prices, record));
            totals.input_tokens += record.input_tokens;
            totals.output_tokens += record.output_tokens;
            totals.cache_read_tokens += record.cache_read_tokens;
            totals.reasoning_output_tokens += record.reasoning_output_tokens;
            totals.total_tokens += record.total_tokens;
            totals.cost_total += estimated_cost_for_record(record, &resolved);
        }
        Ok(totals)
    }

    async fn load_real_usage_records(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        start_date: Option<NaiveDate>,
        end_date: Option<NaiveDate>,
    ) -> Result<Vec<TokenUsageRecord>> {
        let rows = sqlx::query_as::<_, TokenMessageRow>(
            r#"
            SELECT
                CASE
                    WHEN typeof(cm.id) = 'blob' THEN lower(hex(cm.id))
                    ELSE CAST(cm.id AS TEXT)
                END AS message_id,
                date(cm.created_at) AS date,
                CASE
                    WHEN typeof(cs.id) = 'blob' THEN lower(hex(cs.id))
                    ELSE CAST(cs.id AS TEXT)
                END AS session_id,
                cs.title AS title,
                CASE
                    WHEN typeof(cm.sender_id) = 'blob' THEN lower(hex(cm.sender_id))
                    ELSE CAST(cm.sender_id AS TEXT)
                END AS sender_id,
                ca.runner_type AS runner_type,
                ca.model_name AS model_name,
                cm.meta AS meta
            FROM chat_messages cm
            JOIN chat_sessions cs ON cs.id = cm.session_id
            LEFT JOIN chat_agents ca ON ca.id = cm.sender_id
            WHERE cm.sender_type = 'agent'
              AND (
                cs.project_id = ?1
                OR replace(lower(CAST(cs.project_id AS TEXT)), '-', '') = lower(hex(?1))
              )
              AND (?2 IS NULL OR date(cm.created_at) <= ?2)
            ORDER BY cm.created_at ASC, cm.id ASC
            "#,
        )
        .bind(project_id)
        .bind(end_date.map(|date| date.to_string()))
        .fetch_all(pool)
        .await?;

        Ok(real_usage_records_from_rows(rows, start_date, end_date))
    }

    async fn load_effective_prices(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<HashMap<String, EffectivePrice>> {
        let rows = sqlx::query_as::<_, PriceRow>(
            r#"
            SELECT
                mpc.model_id AS model_id,
                mpc.input_price_per_1m AS input_price_per_1m,
                mpc.output_price_per_1m AS output_price_per_1m,
                mpc.cache_read_price_per_1m AS cache_read_price_per_1m,
                mp.custom_input_price AS custom_input_price,
                mp.custom_output_price AS custom_output_price,
                mp.custom_cache_read_price AS custom_cache_read_price,
                COALESCE(mpc.source, 'usage') AS source
            FROM model_price_cache mpc
            LEFT JOIN model_pricing mp
              ON (
                    mp.project_id = ?1
                    OR replace(lower(CAST(mp.project_id AS TEXT)), '-', '') = lower(hex(?1))
                 )
             AND mp.model_id = mpc.model_id
            UNION ALL
            SELECT
                mp.model_id AS model_id,
                0.0 AS input_price_per_1m,
                0.0 AS output_price_per_1m,
                NULL AS cache_read_price_per_1m,
                mp.custom_input_price AS custom_input_price,
                mp.custom_output_price AS custom_output_price,
                mp.custom_cache_read_price AS custom_cache_read_price,
                COALESCE(mp.price_source, 'custom') AS source
            FROM model_pricing mp
            LEFT JOIN model_price_cache mpc ON mpc.model_id = mp.model_id
            WHERE (
                mp.project_id = ?1
                OR replace(lower(CAST(mp.project_id AS TEXT)), '-', '') = lower(hex(?1))
              )
              AND mpc.model_id IS NULL
              AND (
                mp.custom_input_price IS NOT NULL
                OR mp.custom_output_price IS NOT NULL
                OR mp.custom_cache_read_price IS NOT NULL
              )
            "#,
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;

        let mut prices = HashMap::new();
        for row in rows {
            let has_custom_input =
                row.custom_input_price.is_some() || row.custom_output_price.is_some();
            let has_custom_cache = row.custom_cache_read_price.is_some();
            prices.insert(
                row.model_id,
                EffectivePrice {
                    input_price_per_1m: row.custom_input_price.unwrap_or(row.input_price_per_1m),
                    output_price_per_1m: row.custom_output_price.unwrap_or(row.output_price_per_1m),
                    cache_read_price_per_1m: row
                        .custom_cache_read_price
                        .or(row.cache_read_price_per_1m),
                    source: if has_custom_input {
                        "custom".to_string()
                    } else {
                        row.source.clone()
                    },
                    cache_source: if has_custom_cache {
                        "custom".to_string()
                    } else if row.cache_read_price_per_1m.is_some() {
                        row.source
                    } else {
                        "missing".to_string()
                    },
                },
            );
        }
        Ok(prices)
    }
}

fn real_usage_records_from_rows(
    rows: Vec<TokenMessageRow>,
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
) -> Vec<TokenUsageRecord> {
    let start = start_date.map(|date| date.to_string());
    let end = end_date.map(|date| date.to_string());
    let mut deduped: HashMap<String, TokenUsageCandidate> = HashMap::new();

    for (order, row) in rows.into_iter().enumerate() {
        let Some(candidate) = parse_usage_candidate(row, order) else {
            continue;
        };
        let dedupe_key = candidate_dedupe_key(&candidate);
        deduped.insert(dedupe_key, candidate);
    }

    let mut candidates: Vec<_> = deduped.into_values().collect();
    candidates.sort_by_key(|candidate| candidate.order);

    let mut records = Vec::new();
    let mut snapshots_by_thread: HashMap<String, TokenBreakdown> = HashMap::new();

    for candidate in candidates {
        if candidate.usage_scope == "thread_total_snapshot" {
            let Some(snapshot) = candidate.snapshot.clone() else {
                continue;
            };
            let delta = snapshots_by_thread
                .get(&candidate.thread_key)
                .map(|previous| snapshot.saturating_delta(previous))
                .unwrap_or_else(|| snapshot.clone());
            snapshots_by_thread.insert(candidate.thread_key.clone(), snapshot);
            if date_in_range(&candidate.date, start.as_deref(), end.as_deref()) && !delta.is_zero()
            {
                records.push(record_from_candidate(candidate, delta));
            }
            continue;
        }

        let Some(delta) = candidate.delta.clone() else {
            continue;
        };
        if date_in_range(&candidate.date, start.as_deref(), end.as_deref()) {
            records.push(record_from_candidate(candidate, delta));
        }
    }

    records
}

fn parse_usage_candidate(row: TokenMessageRow, order: usize) -> Option<TokenUsageCandidate> {
    let meta = row.meta.0;
    let Some(token_usage) = meta.get("token_usage") else {
        let _support = runtime_usage_support(row.runner_type.as_deref());
        return None;
    };
    if token_usage
        .get("is_estimated")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return None;
    }

    let usage_scope =
        string_value(token_usage, &["usage_scope"]).unwrap_or_else(|| "turn_delta".to_string());
    let raw_model_id = runtime_model_value(token_usage, row.model_name);
    let model_id = normalize_runtime_model_id(&raw_model_id, row.runner_type.as_deref());
    let runtime_thread_id = string_value(token_usage, &["runtime_thread_id"])
        .or_else(|| string_value(&meta, &["agent_session_id"]))
        .or_else(|| string_value(&meta, &["agent_message_id"]))
        .unwrap_or_else(|| "unknown".to_string());
    let sender_id = row.sender_id.unwrap_or_else(|| "unknown".to_string());
    let thread_key = format!("{}:{sender_id}:{runtime_thread_id}", row.session_id);

    let nested_last = token_usage.get("last_token_usage");
    let nested_total = token_usage.get("total_token_usage");
    let delta_source = nested_last.unwrap_or(token_usage);
    let snapshot_source = nested_total.unwrap_or(token_usage);
    let delta = breakdown_from_value(delta_source, false);
    let snapshot = breakdown_from_value(snapshot_source, true);

    if usage_scope == "thread_total_snapshot" {
        snapshot.as_ref()?;
    } else {
        delta.as_ref()?;
    }

    Some(TokenUsageCandidate {
        order,
        dedupe_key: string_value(&meta, &["run_id"])
            .map(|run_id| format!("run:{run_id}"))
            .unwrap_or_else(|| format!("message:{}", row.message_id)),
        date: row.date,
        session_id: row.session_id,
        title: row.title.unwrap_or_default(),
        thread_key,
        model_id,
        usage_scope,
        delta,
        snapshot,
    })
}

fn candidate_dedupe_key(candidate: &TokenUsageCandidate) -> String {
    candidate.dedupe_key.clone()
}

fn record_from_candidate(
    candidate: TokenUsageCandidate,
    breakdown: TokenBreakdown,
) -> TokenUsageRecord {
    TokenUsageRecord {
        date: candidate.date,
        session_id: candidate.session_id,
        title: candidate.title,
        model_id: candidate.model_id,
        input_tokens: breakdown.input_tokens,
        output_tokens: breakdown.output_tokens,
        cache_read_tokens: breakdown.cache_read_tokens,
        reasoning_output_tokens: breakdown.reasoning_output_tokens,
        total_tokens: breakdown.total_tokens(),
    }
}

fn breakdown_from_value(value: &Value, prefer_snapshot_fields: bool) -> Option<TokenBreakdown> {
    let input_names = if prefer_snapshot_fields {
        &["snapshot_input_tokens", "input_tokens"][..]
    } else {
        &["input_tokens"][..]
    };
    let output_names = if prefer_snapshot_fields {
        &["snapshot_output_tokens", "output_tokens"][..]
    } else {
        &["output_tokens"][..]
    };
    let cache_read_names = if prefer_snapshot_fields {
        &[
            "snapshot_cache_read_tokens",
            "cache_read_tokens",
            "cached_input_tokens",
        ][..]
    } else {
        &["cache_read_tokens", "cached_input_tokens"][..]
    };
    let reasoning_names = if prefer_snapshot_fields {
        &[
            "snapshot_reasoning_output_tokens",
            "reasoning_output_tokens",
        ][..]
    } else {
        &["reasoning_output_tokens"][..]
    };

    let input_tokens = nonnegative_i64(value, input_names)?;
    let output_tokens = nonnegative_i64(value, output_names)?;
    Some(TokenBreakdown {
        input_tokens,
        output_tokens,
        cache_read_tokens: nonnegative_i64(value, cache_read_names).unwrap_or(0),
        reasoning_output_tokens: nonnegative_i64(value, reasoning_names).unwrap_or(0),
    })
}

fn nonnegative_i64(value: &Value, names: &[&str]) -> Option<i64> {
    for name in names {
        if let Some(raw) = value.get(*name).and_then(Value::as_i64) {
            if raw < 0 {
                return None;
            }
            return Some(raw);
        }
    }
    None
}

fn string_value(value: &Value, names: &[&str]) -> Option<String> {
    for name in names {
        if let Some(value) = value.get(*name).and_then(Value::as_str) {
            return Some(value.to_string());
        }
    }
    None
}

fn runtime_model_value(token_usage: &Value, agent_model_name: Option<String>) -> String {
    let runtime_model = string_value(
        token_usage,
        &["runtime_model_id", "model_id", "model", "model_name"],
    );

    if runtime_model
        .as_deref()
        .is_some_and(|model| !is_default_model_id(model))
    {
        return runtime_model.unwrap();
    }

    if agent_model_name
        .as_deref()
        .is_some_and(|model| !is_default_model_id(model))
    {
        return agent_model_name.unwrap();
    }

    runtime_model
        .or(agent_model_name)
        .unwrap_or_else(|| "unknown".to_string())
}

fn normalize_executor_model_id(model_id: &str) -> String {
    let trimmed = model_id.trim();
    if trimmed.is_empty() {
        "unknown".to_string()
    } else {
        trimmed.to_string()
    }
}

fn is_default_model_id(model_id: &str) -> bool {
    model_id.trim().eq_ignore_ascii_case("default")
}

fn normalize_runtime_model_id(model_id: &str, runner_type: Option<&str>) -> String {
    let normalized = normalize_executor_model_id(model_id);
    if !is_default_model_id(&normalized) {
        return normalized;
    }

    match runner_type.map(|runner| runner.replace(['-', ' '], "_").to_ascii_uppercase()) {
        Some(runner) if runner == "CODEX" => "gpt-5-codex".to_string(),
        _ => "default".to_string(),
    }
}

fn bare_model_id(model_id: &str) -> String {
    normalize_executor_model_id(model_id)
        .rsplit_once('/')
        .map_or_else(
            || normalize_executor_model_id(model_id),
            |(_, bare_model_id)| normalize_executor_model_id(bare_model_id),
        )
        .to_ascii_lowercase()
}

fn canonical_lookup_id(model_id: &str) -> String {
    resolve_canonical_id(model_id).to_ascii_lowercase()
}

fn find_effective_price<'a>(
    prices: &'a HashMap<String, EffectivePrice>,
    record: &TokenUsageRecord,
) -> Option<&'a EffectivePrice> {
    if let Some(price) = prices.get(&record.model_id) {
        return Some(price);
    }

    let lower_model_id = record.model_id.to_ascii_lowercase();
    if lower_model_id != record.model_id {
        if let Some(price) = prices.get(&lower_model_id) {
            return Some(price);
        }
    }

    let canonical_model_id = resolve_canonical_id(&record.model_id);
    if canonical_model_id != record.model_id {
        if let Some(price) = prices.get(&canonical_model_id) {
            return Some(price);
        }
    }

    let canonical_lower_model_id = canonical_model_id.to_ascii_lowercase();
    if canonical_lower_model_id != canonical_model_id && canonical_lower_model_id != lower_model_id
    {
        if let Some(price) = prices.get(&canonical_lower_model_id) {
            return Some(price);
        }
    }

    let target_bare = bare_model_id(&record.model_id);
    if target_bare != lower_model_id {
        if let Some(price) = prices.get(&target_bare) {
            return Some(price);
        }
    }

    let target_canonical = canonical_lookup_id(&record.model_id);
    prices.iter().find_map(|(price_model_id, price)| {
        if bare_model_id(price_model_id) == target_bare
            || canonical_lookup_id(price_model_id) == target_canonical
        {
            Some(price)
        } else {
            None
        }
    })
}

fn date_in_range(date: &str, start: Option<&str>, end: Option<&str>) -> bool {
    start.is_none_or(|start| date >= start) && end.is_none_or(|end| date <= end)
}

fn runtime_usage_support(runner_type: Option<&str>) -> RuntimeUsageSupport {
    let runner = runner_type.unwrap_or_default().to_ascii_lowercase();
    if runner.contains("claude")
        || runner.contains("amp")
        || runner.contains("codex")
        || runner.contains("opencode")
        || runner.contains("openteams_cli")
        || runner.contains("open_teams_cli")
    {
        return RuntimeUsageSupport::NativeUsage;
    }

    if runner.contains("gemini") || runner.contains("qwen") {
        return RuntimeUsageSupport::GenericTokenUsageOnly;
    }

    if runner.contains("cursor")
        || runner.contains("copilot")
        || runner.contains("droid")
        || runner.contains("kimi")
    {
        return RuntimeUsageSupport::UnsupportedNoUsage;
    }

    RuntimeUsageSupport::GenericTokenUsageOnly
}

fn resolve_usage_price(
    record: &TokenUsageRecord,
    price: Option<&EffectivePrice>,
) -> ResolvedUsagePrice {
    let input_price = price.map(|item| item.input_price_per_1m).unwrap_or(0.0);
    let output_price = price.map(|item| item.output_price_per_1m).unwrap_or(0.0);
    let source = price
        .map(|item| item.source.clone())
        .unwrap_or_else(|| "missing".to_string());
    let model_name = record.model_id.clone();

    let cache_read_price = price
        .and_then(|item| item.cache_read_price_per_1m)
        .unwrap_or(0.0);
    let cache_source = if price
        .and_then(|item| item.cache_read_price_per_1m)
        .is_some()
    {
        price
            .map(|item| item.cache_source.clone())
            .unwrap_or_else(|| "missing".to_string())
    } else {
        "missing".to_string()
    };

    ResolvedUsagePrice {
        model_name,
        input_price_per_1m: input_price,
        output_price_per_1m: output_price,
        cache_read_price_per_1m: cache_read_price,
        source,
        cache_source,
    }
}

fn estimated_cost_for_record(record: &TokenUsageRecord, price: &ResolvedUsagePrice) -> f64 {
    (record.input_tokens as f64 / 1_000_000.0) * price.input_price_per_1m
        + (record.output_tokens as f64 / 1_000_000.0) * price.output_price_per_1m
        + (record.cache_read_tokens as f64 / 1_000_000.0) * price.cache_read_price_per_1m
}

fn model_usage_from_records(
    records: Vec<TokenUsageRecord>,
    prices: HashMap<String, EffectivePrice>,
    limit: u32,
) -> Vec<ModelUsageStats> {
    let mut by_model: HashMap<String, (TokenAccumulator, ResolvedUsagePrice)> = HashMap::new();
    for record in &records {
        let resolved = resolve_usage_price(record, find_effective_price(&prices, record));
        let estimated_cost = estimated_cost_for_record(record, &resolved);
        let entry = by_model
            .entry(record.model_id.clone())
            .or_insert_with(|| (TokenAccumulator::default(), resolved.clone()));
        entry.0.add(record, estimated_cost);
    }

    let mut models: Vec<_> = by_model
        .into_iter()
        .map(|(model_id, (totals, price))| ModelUsageStats {
            model_name: price.model_name,
            model_id,
            input_tokens: totals.input_tokens,
            output_tokens: totals.output_tokens,
            cache_read_tokens: totals.cache_read_tokens,
            reasoning_output_tokens: totals.reasoning_output_tokens,
            total_tokens: totals.total_tokens,
            input_price_per_1m: price.input_price_per_1m,
            output_price_per_1m: price.output_price_per_1m,
            cache_read_price_per_1m: price.cache_read_price_per_1m,
            estimated_cost: totals.estimated_cost,
            price_source: price.source,
            cache_price_source: price.cache_source,
        })
        .collect();

    models.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));
    models.truncate(limit as usize);
    models
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;

    use super::*;

    fn row(
        id: &str,
        run_id: &str,
        runner_type: &str,
        model_name: Option<&str>,
        meta: Value,
    ) -> TokenMessageRow {
        let mut meta = meta;
        if !run_id.is_empty() {
            meta["run_id"] = Value::String(run_id.to_string());
        }
        TokenMessageRow {
            message_id: id.to_string(),
            date: "2026-06-01".to_string(),
            session_id: "session-1".to_string(),
            title: Some("Session".to_string()),
            sender_id: Some("agent-1".to_string()),
            runner_type: Some(runner_type.to_string()),
            model_name: model_name.map(String::from),
            meta: Json(meta),
        }
    }

    fn usage(input: i64, output: i64, is_estimated: bool) -> Value {
        serde_json::json!({
            "token_usage": {
                "input_tokens": input,
                "output_tokens": output,
                "total_tokens": input + output,
                "is_estimated": is_estimated
            }
        })
    }

    #[test]
    fn filters_estimated_and_incomplete_records() {
        let records = real_usage_records_from_rows(
            vec![
                row(
                    "m1",
                    "run-1",
                    "codex",
                    Some("gpt-4o"),
                    usage(100, 50, false),
                ),
                row(
                    "m2",
                    "run-2",
                    "codex",
                    Some("gpt-4o"),
                    usage(200, 100, true),
                ),
                row(
                    "m3",
                    "run-3",
                    "codex",
                    Some("gpt-4o"),
                    serde_json::json!({
                        "token_usage": {
                            "total_tokens": 300,
                            "is_estimated": false
                        }
                    }),
                ),
            ],
            None,
            None,
        );

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].input_tokens, 100);
        assert_eq!(records[0].output_tokens, 50);
        assert_eq!(records[0].total_tokens, 150);
    }

    #[test]
    fn includes_cache_tokens_in_records() {
        let records = real_usage_records_from_rows(
            vec![row(
                "m1",
                "run-1",
                "claude_code",
                Some("claude-3-5-sonnet-20241022"),
                serde_json::json!({
                    "token_usage": {
                        "input_tokens": 100,
                        "output_tokens": 50,
                        "cache_read_tokens": 30,
                        "reasoning_output_tokens": 10,
                        "is_estimated": false
                    }
                }),
            )],
            None,
            None,
        );

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].cache_read_tokens, 30);
        assert_eq!(records[0].reasoning_output_tokens, 10);
        assert_eq!(records[0].total_tokens, 150);
    }

    #[test]
    fn uses_runtime_model_id_from_token_usage() {
        let records = real_usage_records_from_rows(
            vec![row(
                "m1",
                "run-1",
                "codex",
                None,
                serde_json::json!({
                    "token_usage": {
                        "runtime_model_id": "openai/gpt-5-codex",
                        "input_tokens": 100,
                        "output_tokens": 50,
                        "is_estimated": false
                    }
                }),
            )],
            None,
            None,
        );

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].model_id, "openai/gpt-5-codex");
    }

    #[test]
    fn maps_codex_default_to_runtime_default_model() {
        let records = real_usage_records_from_rows(
            vec![row(
                "m1",
                "run-1",
                "codex",
                Some("default"),
                serde_json::json!({
                    "token_usage": {
                        "input_tokens": 100,
                        "output_tokens": 50,
                        "is_estimated": false
                    }
                }),
            )],
            None,
            None,
        );

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].model_id, "gpt-5-codex");
    }

    #[test]
    fn runtime_default_prefers_explicit_agent_model_name() {
        let records = real_usage_records_from_rows(
            vec![row(
                "m1",
                "run-1",
                "codex",
                Some("openai/gpt-5.5"),
                serde_json::json!({
                    "token_usage": {
                        "runtime_model_id": "default",
                        "input_tokens": 100,
                        "output_tokens": 50,
                        "is_estimated": false
                    }
                }),
            )],
            None,
            None,
        );

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].model_id, "openai/gpt-5.5");
    }

    #[test]
    fn converts_thread_snapshots_to_deltas() {
        let records = real_usage_records_from_rows(
            vec![
                row(
                    "m1",
                    "run-1",
                    "codex",
                    Some("gpt-4o"),
                    serde_json::json!({
                        "agent_session_id": "thread-1",
                        "token_usage": {
                            "usage_scope": "thread_total_snapshot",
                            "input_tokens": 100,
                            "output_tokens": 40,
                            "cached_input_tokens": 10,
                            "is_estimated": false
                        }
                    }),
                ),
                row(
                    "m2",
                    "run-2",
                    "codex",
                    Some("gpt-4o"),
                    serde_json::json!({
                        "agent_session_id": "thread-1",
                        "token_usage": {
                            "usage_scope": "thread_total_snapshot",
                            "input_tokens": 175,
                            "output_tokens": 70,
                            "cached_input_tokens": 25,
                            "is_estimated": false
                        }
                    }),
                ),
            ],
            None,
            None,
        );

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].input_tokens, 100);
        assert_eq!(records[0].cache_read_tokens, 10);
        assert_eq!(records[1].input_tokens, 75);
        assert_eq!(records[1].output_tokens, 30);
        assert_eq!(records[1].cache_read_tokens, 15);
    }

    #[test]
    fn model_usage_prefers_custom_prices_and_charges_cache() {
        let records = vec![TokenUsageRecord {
            date: "2026-06-01".to_string(),
            session_id: "session-1".to_string(),
            title: "Session".to_string(),
            model_id: "gpt-4o".to_string(),
            input_tokens: 1_000_000,
            output_tokens: 500_000,
            cache_read_tokens: 1_000_000,
            reasoning_output_tokens: 0,
            total_tokens: 1_500_000,
        }];
        let mut prices = HashMap::new();
        prices.insert(
            "gpt-4o".to_string(),
            EffectivePrice {
                input_price_per_1m: 1.0,
                output_price_per_1m: 2.0,
                cache_read_price_per_1m: Some(0.25),
                source: "custom".to_string(),
                cache_source: "custom".to_string(),
            },
        );

        let models = model_usage_from_records(records, prices, 5);

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].price_source, "custom");
        assert_eq!(models[0].cache_price_source, "custom");
        assert_eq!(models[0].model_name, "gpt-4o");
        assert!((models[0].estimated_cost - 2.25).abs() < f64::EPSILON);
    }

    #[test]
    fn model_usage_does_not_use_default_prices_when_cache_is_empty() {
        let records = vec![TokenUsageRecord {
            date: "2026-06-01".to_string(),
            session_id: "session-1".to_string(),
            title: "Session".to_string(),
            model_id: "gpt-4o".to_string(),
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            cache_read_tokens: 1_000_000,
            reasoning_output_tokens: 0,
            total_tokens: 2_000_000,
        }];

        let models = model_usage_from_records(records, HashMap::new(), 5);

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].price_source, "missing");
        assert_eq!(models[0].cache_price_source, "missing");
        assert_eq!(models[0].estimated_cost, 0.0);
    }

    #[test]
    fn model_usage_uses_glm_5_1_synced_price() {
        let records = vec![TokenUsageRecord {
            date: "2026-06-01".to_string(),
            session_id: "session-1".to_string(),
            title: "Session".to_string(),
            model_id: "z-ai/glm-5.1".to_string(),
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            cache_read_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 2_000_000,
        }];
        let mut prices = HashMap::new();
        prices.insert(
            "glm-5.1".to_string(),
            EffectivePrice {
                input_price_per_1m: 0.98,
                output_price_per_1m: 3.08,
                cache_read_price_per_1m: Some(0.182),
                source: "openrouter".to_string(),
                cache_source: "openrouter".to_string(),
            },
        );

        let models = model_usage_from_records(records, prices, 5);

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].model_id, "z-ai/glm-5.1");
        assert_eq!(models[0].model_name, "z-ai/glm-5.1");
        assert_eq!(models[0].price_source, "openrouter");
        assert!((models[0].estimated_cost - 4.06).abs() < 1e-9);
    }

    #[test]
    fn model_usage_falls_back_to_bare_price_model_id() {
        let records = vec![TokenUsageRecord {
            date: "2026-06-01".to_string(),
            session_id: "session-1".to_string(),
            title: "Session".to_string(),
            model_id: "openai/some-new-model".to_string(),
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            cache_read_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 2_000_000,
        }];
        let mut prices = HashMap::new();
        prices.insert(
            "some-new-model".to_string(),
            EffectivePrice {
                input_price_per_1m: 1.5,
                output_price_per_1m: 2.5,
                cache_read_price_per_1m: None,
                source: "litellm".to_string(),
                cache_source: "missing".to_string(),
            },
        );

        let models = model_usage_from_records(records, prices, 5);

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].model_id, "openai/some-new-model");
        assert_eq!(models[0].model_name, "openai/some-new-model");
        assert_eq!(models[0].price_source, "litellm");
        assert!((models[0].estimated_cost - 4.0).abs() < f64::EPSILON);
    }

    #[test]
    fn model_usage_falls_back_between_provider_prefixed_model_ids() {
        let records = vec![TokenUsageRecord {
            date: "2026-06-01".to_string(),
            session_id: "session-1".to_string(),
            title: "Session".to_string(),
            model_id: "custom_provider/gpt-5.5".to_string(),
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            cache_read_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 2_000_000,
        }];
        let mut prices = HashMap::new();
        prices.insert(
            "openai/gpt-5.5".to_string(),
            EffectivePrice {
                input_price_per_1m: 3.0,
                output_price_per_1m: 4.0,
                cache_read_price_per_1m: None,
                source: "openrouter".to_string(),
                cache_source: "missing".to_string(),
            },
        );

        let models = model_usage_from_records(records, prices, 5);

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].model_id, "custom_provider/gpt-5.5");
        assert_eq!(models[0].model_name, "custom_provider/gpt-5.5");
        assert_eq!(models[0].price_source, "openrouter");
        assert!((models[0].estimated_cost - 7.0).abs() < f64::EPSILON);
    }

    #[test]
    fn model_usage_prefers_exact_price_before_bare_fallback() {
        let records = vec![TokenUsageRecord {
            date: "2026-06-01".to_string(),
            session_id: "session-1".to_string(),
            title: "Session".to_string(),
            model_id: "openai/some-new-model".to_string(),
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            cache_read_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 2_000_000,
        }];
        let mut prices = HashMap::new();
        prices.insert(
            "some-new-model".to_string(),
            EffectivePrice {
                input_price_per_1m: 1.0,
                output_price_per_1m: 1.0,
                cache_read_price_per_1m: None,
                source: "litellm".to_string(),
                cache_source: "missing".to_string(),
            },
        );
        prices.insert(
            "openai/some-new-model".to_string(),
            EffectivePrice {
                input_price_per_1m: 3.0,
                output_price_per_1m: 4.0,
                cache_read_price_per_1m: None,
                source: "openrouter".to_string(),
                cache_source: "missing".to_string(),
            },
        );

        let models = model_usage_from_records(records, prices, 5);

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].model_name, "openai/some-new-model");
        assert_eq!(models[0].price_source, "openrouter");
        assert!((models[0].estimated_cost - 7.0).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn load_effective_prices_includes_custom_only_unknown_models() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            r#"
            CREATE TABLE model_price_cache (
                model_id TEXT PRIMARY KEY,
                model_name TEXT NOT NULL,
                input_price_per_1m REAL NOT NULL DEFAULT 0.0,
                output_price_per_1m REAL NOT NULL DEFAULT 0.0,
                cache_read_price_per_1m REAL,
                source TEXT NOT NULL DEFAULT 'external'
            );
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"
            CREATE TABLE model_pricing (
                id BLOB PRIMARY KEY,
                project_id BLOB NOT NULL,
                model_id TEXT NOT NULL,
                model_name TEXT NOT NULL,
                input_price_per_1m REAL NOT NULL DEFAULT 0.0,
                output_price_per_1m REAL NOT NULL DEFAULT 0.0,
                cache_read_price_per_1m REAL,
                custom_input_price REAL,
                custom_output_price REAL,
                custom_cache_read_price REAL,
                price_source TEXT NOT NULL DEFAULT 'custom',
                UNIQUE(project_id, model_id)
            );
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        let project_id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO model_pricing (
                id,
                project_id,
                model_id,
                model_name,
                custom_input_price,
                custom_output_price,
                custom_cache_read_price,
                price_source
            )
            VALUES (?1, ?2, 'unknown-model', 'unknown-model', 2.0, 8.0, 0.5, 'custom')
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(project_id)
        .execute(&pool)
        .await
        .unwrap();

        let prices = TokenCostStatsService::new()
            .load_effective_prices(&pool, project_id)
            .await
            .unwrap();
        let records = vec![TokenUsageRecord {
            date: "2026-06-01".to_string(),
            session_id: "session-1".to_string(),
            title: "Session".to_string(),
            model_id: "unknown-model".to_string(),
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            cache_read_tokens: 1_000_000,
            reasoning_output_tokens: 0,
            total_tokens: 2_000_000,
        }];

        let models = model_usage_from_records(records, prices, 5);

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].model_id, "unknown-model");
        assert_eq!(models[0].price_source, "custom");
        assert_eq!(models[0].cache_price_source, "custom");
        assert!((models[0].estimated_cost - 10.5).abs() < f64::EPSILON);
    }

    #[test]
    fn model_usage_sorts_by_total_tokens() {
        let records = vec![
            TokenUsageRecord {
                date: "2026-06-01".to_string(),
                session_id: "session-1".to_string(),
                title: "Session".to_string(),
                model_id: "small".to_string(),
                input_tokens: 10,
                output_tokens: 5,
                cache_read_tokens: 0,
                reasoning_output_tokens: 0,
                total_tokens: 15,
            },
            TokenUsageRecord {
                date: "2026-06-01".to_string(),
                session_id: "session-2".to_string(),
                title: "Session".to_string(),
                model_id: "large".to_string(),
                input_tokens: 100,
                output_tokens: 50,
                cache_read_tokens: 0,
                reasoning_output_tokens: 0,
                total_tokens: 150,
            },
        ];

        let models = model_usage_from_records(records, HashMap::new(), 5);

        assert_eq!(models[0].model_id, "large");
        assert_eq!(models[1].model_id, "small");
    }

    #[test]
    fn classifies_current_agent_usage_support() {
        assert_eq!(
            runtime_usage_support(Some("codex")),
            RuntimeUsageSupport::NativeUsage
        );
        assert_eq!(
            runtime_usage_support(Some("claude_code")),
            RuntimeUsageSupport::NativeUsage
        );
        assert_eq!(
            runtime_usage_support(Some("opencode")),
            RuntimeUsageSupport::NativeUsage
        );
        assert_eq!(
            runtime_usage_support(Some("openteams_cli")),
            RuntimeUsageSupport::NativeUsage
        );
        assert_eq!(
            runtime_usage_support(Some("gemini")),
            RuntimeUsageSupport::GenericTokenUsageOnly
        );
        assert_eq!(
            runtime_usage_support(Some("qwen_code")),
            RuntimeUsageSupport::GenericTokenUsageOnly
        );
        assert_eq!(
            runtime_usage_support(Some("cursor_agent")),
            RuntimeUsageSupport::UnsupportedNoUsage
        );
        assert_eq!(
            runtime_usage_support(Some("copilot")),
            RuntimeUsageSupport::UnsupportedNoUsage
        );
        assert_eq!(
            runtime_usage_support(Some("droid")),
            RuntimeUsageSupport::UnsupportedNoUsage
        );
        assert_eq!(
            runtime_usage_support(Some("kimi_code")),
            RuntimeUsageSupport::UnsupportedNoUsage
        );
    }
}
