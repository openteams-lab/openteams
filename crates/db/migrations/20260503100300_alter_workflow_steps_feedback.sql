-- SQLite table rebuild to add review-feedback columns and expand status CHECK.
PRAGMA foreign_keys = OFF;

-- sqlx workaround due to lack of `-- no-transaction` in sqlx-sqlite.
COMMIT TRANSACTION;

BEGIN TRANSACTION;

PRAGMA legacy_alter_table = ON;

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
                                                'revising', 'completed', 'failed', 'skipped',
                                                'cancelled'
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
    instructions, assigned_workflow_agent_session_id, status, retry_count, max_retry,
    round_index, display_order, latest_run_id, summary_text, content, NULL,
    1, 0, NULL, created_at, updated_at, started_at, completed_at
FROM chat_workflow_steps_old;

DROP TABLE chat_workflow_steps_old;

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
