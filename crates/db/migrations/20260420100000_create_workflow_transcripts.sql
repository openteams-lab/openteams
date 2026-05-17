CREATE TABLE IF NOT EXISTS chat_workflow_transcripts (
    id              BLOB NOT NULL PRIMARY KEY,
    execution_id    BLOB NOT NULL REFERENCES chat_workflow_executions(id),
    round_id        BLOB     REFERENCES chat_workflow_rounds(id),
    workflow_agent_session_id BLOB REFERENCES chat_workflow_agent_sessions(id),
    step_id         BLOB     REFERENCES chat_workflow_steps(id),
    sender_type     TEXT NOT NULL DEFAULT 'system',
    entry_type      TEXT NOT NULL DEFAULT 'message',
    content         TEXT NOT NULL DEFAULT '',
    meta_json       TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workflow_transcripts_execution_id ON chat_workflow_transcripts(execution_id);
CREATE INDEX IF NOT EXISTS idx_workflow_transcripts_step_id ON chat_workflow_transcripts(step_id);
CREATE INDEX IF NOT EXISTS idx_workflow_transcripts_entry_type ON chat_workflow_transcripts(entry_type);
CREATE INDEX IF NOT EXISTS idx_workflow_transcripts_created_at ON chat_workflow_transcripts(created_at);
