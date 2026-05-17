-- Keep child workflow tables referencing `chat_workflow_executions` while we
-- rebuild the parent table. SQLite rewrites child foreign keys to the
-- temporary table name during RENAME, so we normalize those references back to
-- the canonical table name before the migration finishes.
PRAGMA legacy_alter_table = ON;

ALTER TABLE chat_workflow_executions RENAME TO chat_workflow_executions_legacy;

CREATE TABLE chat_workflow_executions (
    id                       BLOB    NOT NULL PRIMARY KEY,
    session_id               BLOB    NOT NULL,
    plan_id                  BLOB    NOT NULL REFERENCES chat_workflow_plans(id),
    active_revision_id       BLOB    REFERENCES chat_workflow_plan_revisions(id),
    active_round_id          BLOB,
    workflow_card_message_id BLOB,
    lead_session_agent_id    BLOB,
    status                   TEXT    NOT NULL DEFAULT 'pending'
                                     CHECK (status IN (
                                         'pending', 'running', 'failed', 'paused',
                                         'recompiling', 'completed', 'waiting'
                                     )),
    current_round            INTEGER NOT NULL DEFAULT 0,
    title                    TEXT    NOT NULL DEFAULT '',
    compiled_graph_hash      TEXT,
    started_at               TEXT,
    completed_at             TEXT,
    created_at               TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at               TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

INSERT INTO chat_workflow_executions (
    id,
    session_id,
    plan_id,
    active_revision_id,
    active_round_id,
    workflow_card_message_id,
    lead_session_agent_id,
    status,
    current_round,
    title,
    compiled_graph_hash,
    started_at,
    completed_at,
    created_at,
    updated_at
)
SELECT
    id,
    session_id,
    plan_id,
    active_revision_id,
    active_round_id,
    workflow_card_message_id,
    lead_session_agent_id,
    CASE status
        WHEN 'bootstrapping' THEN 'pending'
        WHEN 'interrupting' THEN 'running'
        WHEN 'waiting_user' THEN 'waiting'
        WHEN 'waiting_user_acceptance' THEN 'waiting'
        WHEN 'resuming' THEN 'running'
        WHEN 'completing' THEN 'running'
        WHEN 'cancelled' THEN 'failed'
        ELSE status
    END,
    current_round,
    title,
    compiled_graph_hash,
    started_at,
    completed_at,
    created_at,
    updated_at
FROM chat_workflow_executions_legacy;

DROP TABLE chat_workflow_executions_legacy;

PRAGMA writable_schema = ON;

UPDATE sqlite_schema
SET sql = REPLACE(sql, '"chat_workflow_executions_legacy"', 'chat_workflow_executions')
WHERE type = 'table'
  AND sql LIKE '%"chat_workflow_executions_legacy"%';

PRAGMA writable_schema = OFF;

PRAGMA legacy_alter_table = OFF;

CREATE INDEX idx_workflow_executions_session_id ON chat_workflow_executions(session_id);
CREATE INDEX idx_workflow_executions_plan_id ON chat_workflow_executions(plan_id);
CREATE INDEX idx_workflow_executions_status ON chat_workflow_executions(status);
CREATE INDEX idx_workflow_executions_active_revision_id
    ON chat_workflow_executions(active_revision_id);
