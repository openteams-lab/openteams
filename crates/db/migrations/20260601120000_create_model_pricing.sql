CREATE TABLE model_pricing (
    id BLOB PRIMARY KEY,
    project_id BLOB NOT NULL,
    model_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    input_price_per_1m REAL NOT NULL DEFAULT 0.0,
    output_price_per_1m REAL NOT NULL DEFAULT 0.0,
    custom_input_price REAL,
    custom_output_price REAL,
    price_source TEXT NOT NULL DEFAULT 'custom',
    price_updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    UNIQUE(project_id, model_id)
);

CREATE INDEX idx_model_pricing_project ON model_pricing(project_id);

-- Global model price cache table (shared across projects, updated daily)
CREATE TABLE model_price_cache (
    model_id TEXT PRIMARY KEY,
    model_name TEXT NOT NULL,
    input_price_per_1m REAL NOT NULL DEFAULT 0.0,
    output_price_per_1m REAL NOT NULL DEFAULT 0.0,
    litellm_input_price REAL,
    litellm_output_price REAL,
    openrouter_input_price REAL,
    openrouter_output_price REAL,
    source TEXT NOT NULL DEFAULT 'external',
    last_fetched_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
);
