-- Keep child workflow tables referencing `chat_workflow_agent_sessions` while
-- we rebuild the parent table. SQLite rewrites child foreign keys to the
-- temporary table name during RENAME, so we normalize those references back to
-- the canonical table name before the migration finishes.
PRAGMA legacy_alter_table = ON;

ALTER TABLE chat_workflow_agent_sessions RENAME TO chat_workflow_agent_sessions_legacy;

CREATE TABLE chat_workflow_agent_sessions (
    id                      BLOB    NOT NULL PRIMARY KEY,
    workflow_execution_id   BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
    session_agent_id        BLOB    NOT NULL,
    role                    TEXT    NOT NULL DEFAULT 'worker'
                                    CHECK (role IN ('lead', 'worker', 'reviewer')),
    agent_session_id        TEXT,
    agent_message_id        TEXT,
    state                   TEXT    NOT NULL DEFAULT 'idle'
                                    CHECK (state IN (
                                        'idle', 'running', 'interrupt_requested',
                                        'interrupted', 'paused', 'completed',
                                        'failed', 'expired'
                                    )),
    created_at              TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at              TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

INSERT INTO chat_workflow_agent_sessions (
    id,
    workflow_execution_id,
    session_agent_id,
    role,
    agent_session_id,
    agent_message_id,
    state,
    created_at,
    updated_at
)
SELECT
    id,
    workflow_execution_id,
    session_agent_id,
    role,
    agent_session_id,
    agent_message_id,
    CASE
        WHEN state IN ('waiting_input', 'waiting_approval') THEN 'paused'
        ELSE state
    END,
    created_at,
    updated_at
FROM chat_workflow_agent_sessions_legacy legacy
WHERE EXISTS (
    SELECT 1
    FROM chat_workflow_executions exec
    WHERE exec.id = legacy.workflow_execution_id
);

-- Drop rows that may already be orphaned due to historical FK-disabled writes.
-- This keeps the migration resilient on existing local databases.
DELETE FROM chat_workflow_transcripts
WHERE workflow_agent_session_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM chat_workflow_agent_sessions s
      WHERE s.id = chat_workflow_transcripts.workflow_agent_session_id
  );

DROP TABLE chat_workflow_agent_sessions_legacy;

PRAGMA writable_schema = ON;

UPDATE sqlite_schema
SET sql = REPLACE(sql, '"chat_workflow_agent_sessions_legacy"', 'chat_workflow_agent_sessions')
WHERE type = 'table'
  AND sql LIKE '%"chat_workflow_agent_sessions_legacy"%';

PRAGMA writable_schema = OFF;

PRAGMA legacy_alter_table = OFF;

CREATE INDEX idx_workflow_agent_sessions_execution_id ON chat_workflow_agent_sessions(workflow_execution_id);
CREATE INDEX idx_workflow_agent_sessions_state ON chat_workflow_agent_sessions(state);
