-- Repair foreign keys that SQLite rewrote to chat_workflow_steps_old while
-- rebuilding chat_workflow_steps in 20260503100300_alter_workflow_steps_feedback.
PRAGMA foreign_keys = OFF;

-- sqlx workaround due to lack of `-- no-transaction` in sqlx-sqlite.
COMMIT TRANSACTION;

BEGIN TRANSACTION;

CREATE TABLE chat_workflow_transcripts_new (
    id                        BLOB NOT NULL PRIMARY KEY,
    execution_id              BLOB NOT NULL REFERENCES chat_workflow_executions(id),
    round_id                  BLOB REFERENCES chat_workflow_rounds(id),
    workflow_agent_session_id BLOB REFERENCES chat_workflow_agent_sessions(id),
    step_id                   BLOB REFERENCES chat_workflow_steps(id),
    sender_type               TEXT NOT NULL DEFAULT 'system',
    entry_type                TEXT NOT NULL DEFAULT 'message',
    content                   TEXT NOT NULL DEFAULT '',
    meta_json                 TEXT,
    created_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO chat_workflow_transcripts_new (
    id, execution_id, round_id, workflow_agent_session_id, step_id,
    sender_type, entry_type, content, meta_json, created_at
)
SELECT
    id, execution_id, round_id, workflow_agent_session_id, step_id,
    sender_type, entry_type, content, meta_json, created_at
FROM chat_workflow_transcripts;

DROP TABLE chat_workflow_transcripts;
ALTER TABLE chat_workflow_transcripts_new RENAME TO chat_workflow_transcripts;

CREATE INDEX idx_workflow_transcripts_execution_id ON chat_workflow_transcripts(execution_id);
CREATE INDEX idx_workflow_transcripts_step_id ON chat_workflow_transcripts(step_id);
CREATE INDEX idx_workflow_transcripts_entry_type ON chat_workflow_transcripts(entry_type);
CREATE INDEX idx_workflow_transcripts_created_at ON chat_workflow_transcripts(created_at);

CREATE TABLE chat_workflow_step_edges_new (
    id                    BLOB    NOT NULL PRIMARY KEY,
    execution_id          BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
    compiled_revision_id  BLOB    REFERENCES chat_workflow_plan_revisions(id),
    from_step_id          BLOB    NOT NULL REFERENCES chat_workflow_steps(id),
    to_step_id            BLOB    NOT NULL REFERENCES chat_workflow_steps(id),
    edge_kind             TEXT    NOT NULL DEFAULT 'hard'
                                   CHECK (edge_kind IN ('hard', 'soft')),
    created_at            TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

INSERT INTO chat_workflow_step_edges_new (
    id, execution_id, compiled_revision_id, from_step_id, to_step_id,
    edge_kind, created_at
)
SELECT
    id, execution_id, compiled_revision_id, from_step_id, to_step_id,
    edge_kind, created_at
FROM chat_workflow_step_edges;

DROP TABLE chat_workflow_step_edges;
ALTER TABLE chat_workflow_step_edges_new RENAME TO chat_workflow_step_edges;

CREATE INDEX idx_workflow_step_edges_execution_id ON chat_workflow_step_edges(execution_id);
CREATE INDEX idx_workflow_step_edges_from ON chat_workflow_step_edges(from_step_id);
CREATE INDEX idx_workflow_step_edges_to ON chat_workflow_step_edges(to_step_id);

CREATE TABLE chat_workflow_loops_new (
    id                   BLOB    NOT NULL PRIMARY KEY,
    execution_id         BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
    round_id             BLOB    NOT NULL REFERENCES chat_workflow_rounds(id),
    loop_key             TEXT    NOT NULL,
    review_step_id       BLOB    NOT NULL REFERENCES chat_workflow_steps(id),
    member_step_ids_json TEXT    NOT NULL,
    status               TEXT    NOT NULL DEFAULT 'pending'
                                  CHECK (status IN (
                                      'pending', 'running', 'waiting_review', 'passed',
                                      'rejected', 'waiting_user', 'completed', 'failed'
                                  )),
    retry_count          INTEGER NOT NULL DEFAULT 0,
    max_retry            INTEGER NOT NULL DEFAULT 3,
    user_review_required INTEGER NOT NULL DEFAULT 1,
    rejection_reason     TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

INSERT INTO chat_workflow_loops_new (
    id, execution_id, round_id, loop_key, review_step_id, member_step_ids_json,
    status, retry_count, max_retry, user_review_required, rejection_reason,
    created_at, updated_at
)
SELECT
    id, execution_id, round_id, loop_key, review_step_id, member_step_ids_json,
    status, retry_count, max_retry, user_review_required, rejection_reason,
    created_at, updated_at
FROM chat_workflow_loops;

DROP TABLE chat_workflow_loops;
ALTER TABLE chat_workflow_loops_new RENAME TO chat_workflow_loops;

CREATE INDEX idx_workflow_loops_execution_id ON chat_workflow_loops(execution_id);
CREATE INDEX idx_workflow_loops_round_id ON chat_workflow_loops(round_id);
CREATE INDEX idx_workflow_loops_status ON chat_workflow_loops(status);
CREATE UNIQUE INDEX idx_workflow_loops_round_key ON chat_workflow_loops(round_id, loop_key);

CREATE TABLE chat_workflow_step_reviews_new (
    id            BLOB    NOT NULL PRIMARY KEY,
    step_id        BLOB    NOT NULL REFERENCES chat_workflow_steps(id),
    execution_id   BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
    reviewer_type  TEXT    NOT NULL CHECK (reviewer_type IN ('lead', 'user')),
    reviewer_id    TEXT,
    verdict        TEXT    NOT NULL CHECK (verdict IN ('approved', 'rejected')),
    feedback       TEXT    NOT NULL DEFAULT '',
    review_round   INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

INSERT INTO chat_workflow_step_reviews_new (
    id, step_id, execution_id, reviewer_type, reviewer_id, verdict,
    feedback, review_round, created_at
)
SELECT
    id, step_id, execution_id, reviewer_type, reviewer_id, verdict,
    feedback, review_round, created_at
FROM chat_workflow_step_reviews;

DROP TABLE chat_workflow_step_reviews;
ALTER TABLE chat_workflow_step_reviews_new RENAME TO chat_workflow_step_reviews;

CREATE INDEX idx_workflow_step_reviews_step_id ON chat_workflow_step_reviews(step_id);
CREATE INDEX idx_workflow_step_reviews_execution_id ON chat_workflow_step_reviews(execution_id);
CREATE INDEX idx_workflow_step_reviews_reviewer_type ON chat_workflow_step_reviews(reviewer_type);

PRAGMA foreign_key_check;

COMMIT;

PRAGMA foreign_keys = ON;

-- sqlx workaround due to lack of `-- no-transaction` in sqlx-sqlite.
BEGIN TRANSACTION;
