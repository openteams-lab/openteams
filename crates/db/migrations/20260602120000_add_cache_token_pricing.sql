ALTER TABLE model_price_cache ADD COLUMN cache_read_price_per_1m REAL;
ALTER TABLE model_price_cache ADD COLUMN litellm_cache_read_price REAL;
ALTER TABLE model_price_cache ADD COLUMN openrouter_cache_read_price REAL;

ALTER TABLE model_pricing ADD COLUMN cache_read_price_per_1m REAL;
ALTER TABLE model_pricing ADD COLUMN custom_cache_read_price REAL;

ALTER TABLE project_stats ADD COLUMN cache_read_tokens BIGINT DEFAULT 0;
ALTER TABLE project_stats ADD COLUMN reasoning_output_tokens BIGINT DEFAULT 0;
