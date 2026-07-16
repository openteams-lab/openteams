-- Analytics is a compact delivery log, not a local BI store. SQLite cannot drop the
-- historical BI columns, so rebuild the table and intentionally discard incompatible rows.
CREATE TABLE analytics_events_v2 (
    id TEXT PRIMARY KEY NOT NULL,
    event_type TEXT NOT NULL,
    session_id TEXT,
    run_id TEXT,
    workflow_execution_id TEXT,
    plan_id TEXT,
    step_id TEXT,
    payload_json TEXT NOT NULL,
    occurred_at DATETIME NOT NULL,
    app_version TEXT NOT NULL,
    posthog_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (posthog_status IN ('pending', 'sending', 'retry', 'delivered', 'dead_letter')),
    posthog_attempt_count INTEGER NOT NULL DEFAULT 0,
    posthog_next_attempt_at DATETIME,
    posthog_last_error_code TEXT,
    posthog_delivered_at DATETIME
);

DROP TABLE IF EXISTS analytics_user_profiles;
DROP TABLE IF EXISTS analytics_session_stats;
DROP TABLE analytics_events;
ALTER TABLE analytics_events_v2 RENAME TO analytics_events;

CREATE INDEX idx_analytics_events_delivery
    ON analytics_events(posthog_status, posthog_next_attempt_at);

CREATE INDEX idx_analytics_events_occurred_at
    ON analytics_events(occurred_at);

CREATE UNIQUE INDEX idx_analytics_events_run_once
    ON analytics_events(event_type, run_id)
    WHERE event_type IN ('agent_run_start', 'agent_run_complete', 'risk.agent_error')
      AND run_id IS NOT NULL;

CREATE UNIQUE INDEX idx_analytics_events_step_attempt_once
    ON analytics_events(
        event_type,
        step_id,
        COALESCE(json_extract(payload_json, '$.retry_count'), 0)
    )
    WHERE event_type IN ('workflow.step_started', 'workflow.step_completed')
      AND step_id IS NOT NULL;
