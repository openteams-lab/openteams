-- Remove workflow-level cancelled statuses from the scheduler state machine.
-- Historical execution cancellations are treated as failed executions; historical
-- step cancellations are treated as skipped steps to preserve completed-like
-- dependency semantics.
PRAGMA foreign_keys = OFF;

-- sqlx workaround due to lack of `-- no-transaction` in sqlx-sqlite.
COMMIT TRANSACTION;

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

PRAGMA legacy_alter_table = ON;

ALTER TABLE chat_workflow_executions RENAME TO chat_workflow_executions_old;

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
    CASE status WHEN 'cancelled' THEN 'failed' ELSE status END,
    current_round,
    title,
    compiled_graph_hash,
    started_at,
    completed_at,
    cleaned_at,
    cleaned_reason,
    created_at,
    updated_at
FROM chat_workflow_executions_old;

DROP TABLE chat_workflow_executions_old;

CREATE INDEX idx_workflow_executions_session_id ON chat_workflow_executions(session_id);
CREATE INDEX idx_workflow_executions_plan_id ON chat_workflow_executions(plan_id);
CREATE INDEX idx_workflow_executions_status ON chat_workflow_executions(status);
CREATE INDEX idx_workflow_executions_active_revision_id
    ON chat_workflow_executions(active_revision_id);

ALTER TABLE chat_workflow_steps RENAME TO chat_workflow_steps_old;

CREATE TABLE chat_workflow_steps (
    id                                 BLOB    NOT NULL PRIMARY KEY,
    execution_id                       BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
    round_id                           BLOB    NOT NULL REFERENCES chat_workflow_rounds(id),
    compiled_revision_id               BLOB    REFERENCES chat_workflow_plan_revisions(id),
    step_key                           TEXT    NOT NULL,
    step_type                          TEXT    NOT NULL
                                            CHECK (step_type IN ('task', 'review', 'result')),
    title                              TEXT    NOT NULL DEFAULT '',
    instructions                       TEXT    NOT NULL DEFAULT '',
    assigned_workflow_agent_session_id BLOB,
    status                             TEXT    NOT NULL DEFAULT 'pending'
                                            CHECK (status IN (
                                                'pending', 'ready', 'running', 'pre_completed',
                                                'interrupt_requested', 'interrupted',
                                                'waiting_input', 'waiting_review', 'blocked',
                                                'revising', 'completed', 'failed', 'skipped'
                                            )),
    retry_count                        INTEGER NOT NULL DEFAULT 0,
    max_retry                          INTEGER NOT NULL DEFAULT 1,
    round_index                        INTEGER NOT NULL DEFAULT 1,
    display_order                      INTEGER NOT NULL DEFAULT 0,
    latest_run_id                      BLOB,
    summary_text                       TEXT,
    content                            TEXT,
    loop_id                            BLOB    REFERENCES chat_workflow_loops(id),
    lead_review_required               INTEGER NOT NULL DEFAULT 1,
    user_review_required               INTEGER NOT NULL DEFAULT 1,
    revision_context                   TEXT,
    created_at                         TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at                         TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    started_at                         TEXT,
    completed_at                       TEXT
);

INSERT INTO chat_workflow_steps (
    id, execution_id, round_id, compiled_revision_id, step_key, step_type, title,
    instructions, assigned_workflow_agent_session_id, status, retry_count, max_retry,
    round_index, display_order, latest_run_id, summary_text, content, loop_id,
    lead_review_required, user_review_required, revision_context, created_at,
    updated_at, started_at, completed_at
)
SELECT
    id, execution_id, round_id, compiled_revision_id, step_key, step_type, title,
    instructions, assigned_workflow_agent_session_id,
    CASE status WHEN 'cancelled' THEN 'skipped' ELSE status END,
    retry_count, max_retry, round_index, display_order, latest_run_id, summary_text,
    content, loop_id, lead_review_required, user_review_required, revision_context,
    created_at, updated_at, started_at, completed_at
FROM chat_workflow_steps_old;

DROP TABLE chat_workflow_steps_old;

PRAGMA writable_schema = ON;

UPDATE sqlite_schema
SET sql = REPLACE(sql, '"chat_workflow_executions_old"', 'chat_workflow_executions')
WHERE type = 'table'
  AND sql LIKE '%"chat_workflow_executions_old"%';

UPDATE sqlite_schema
SET sql = REPLACE(sql, 'chat_workflow_executions_old', 'chat_workflow_executions')
WHERE type = 'table'
  AND sql LIKE '%chat_workflow_executions_old%';

UPDATE sqlite_schema
SET sql = REPLACE(sql, '"chat_workflow_steps_old"', 'chat_workflow_steps')
WHERE type = 'table'
  AND sql LIKE '%"chat_workflow_steps_old"%';

UPDATE sqlite_schema
SET sql = REPLACE(sql, 'chat_workflow_steps_old', 'chat_workflow_steps')
WHERE type = 'table'
  AND sql LIKE '%chat_workflow_steps_old%';

PRAGMA writable_schema = OFF;
PRAGMA schema_version = 2026051814;

CREATE INDEX idx_workflow_steps_execution_id ON chat_workflow_steps(execution_id);
CREATE INDEX idx_workflow_steps_round_id ON chat_workflow_steps(round_id);
CREATE INDEX idx_workflow_steps_status ON chat_workflow_steps(status);
CREATE UNIQUE INDEX idx_workflow_steps_round_key ON chat_workflow_steps(round_id, step_key);

PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_key_check;

COMMIT;

PRAGMA foreign_keys = ON;

-- sqlx workaround due to lack of `-- no-transaction` in sqlx-sqlite.
BEGIN TRANSACTION;
