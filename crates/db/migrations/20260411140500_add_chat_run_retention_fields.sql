ALTER TABLE chat_runs ADD COLUMN log_state TEXT NOT NULL DEFAULT 'live';

ALTER TABLE chat_runs ADD COLUMN artifact_state TEXT NOT NULL DEFAULT 'full';

ALTER TABLE chat_runs ADD COLUMN log_truncated INTEGER NOT NULL DEFAULT 0;

ALTER TABLE chat_runs ADD COLUMN log_capture_degraded INTEGER NOT NULL DEFAULT 0;

ALTER TABLE chat_runs ADD COLUMN pruned_at TEXT;

ALTER TABLE chat_runs ADD COLUMN prune_reason TEXT;

ALTER TABLE chat_runs ADD COLUMN retention_summary_json TEXT;

UPDATE chat_runs
SET log_state = CASE
        WHEN raw_log_path IS NULL THEN 'pruned'
        ELSE 'tail'
    END,
    artifact_state = 'full',
    log_truncated = 0,
    log_capture_degraded = 0,
    pruned_at = NULL,
    prune_reason = NULL,
    retention_summary_json = NULL;
