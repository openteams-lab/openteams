-- Re-introduce 'cancelled' into simplified workflow execution statuses.
-- sqlx workaround due to lack of `-- no-transaction` in sqlx-sqlite.
COMMIT TRANSACTION;

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

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
                                         'pending', 'running', 'failed', 'cancelled', 'paused',
                                         'recompiling', 'completed', 'waiting'
                                     )),
    current_round            INTEGER NOT NULL DEFAULT 0,
    title                    TEXT    NOT NULL DEFAULT '',
    compiled_graph_hash      TEXT,
    started_at               TEXT,
    completed_at             TEXT,
    cleaned_at               TEXT,
    cleaned_reason           TEXT,
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
    cleaned_at,
    cleaned_reason,
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
    status,
    current_round,
    title,
    compiled_graph_hash,
    started_at,
    completed_at,
    cleaned_at,
    cleaned_reason,
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

PRAGMA foreign_key_check;

COMMIT;

PRAGMA foreign_keys = ON;

-- sqlx workaround due to lack of `-- no-transaction` in sqlx-sqlite.
BEGIN TRANSACTION;
