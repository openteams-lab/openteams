PRAGMA foreign_keys = OFF;

ALTER TABLE chat_workflow_transcripts
RENAME TO chat_workflow_transcripts_repair_old;

CREATE TABLE chat_workflow_transcripts (
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

INSERT INTO chat_workflow_transcripts (
    id,
    execution_id,
    round_id,
    workflow_agent_session_id,
    step_id,
    sender_type,
    entry_type,
    content,
    meta_json,
    created_at
)
SELECT
    old.id,
    old.execution_id,
    old.round_id,
    old.workflow_agent_session_id,
    old.step_id,
    old.sender_type,
    old.entry_type,
    old.content,
    old.meta_json,
    old.created_at
FROM chat_workflow_transcripts_repair_old old
WHERE old.workflow_agent_session_id IS NULL
   OR EXISTS (
       SELECT 1
       FROM chat_workflow_agent_sessions s
       WHERE s.id = old.workflow_agent_session_id
   );

DROP TABLE chat_workflow_transcripts_repair_old;

CREATE INDEX idx_workflow_transcripts_execution_id ON chat_workflow_transcripts(execution_id);
CREATE INDEX idx_workflow_transcripts_step_id ON chat_workflow_transcripts(step_id);
CREATE INDEX idx_workflow_transcripts_entry_type ON chat_workflow_transcripts(entry_type);
CREATE INDEX idx_workflow_transcripts_created_at ON chat_workflow_transcripts(created_at);

PRAGMA foreign_keys = ON;
