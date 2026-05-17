-- Workflow agent sessions: per-workflow agent execution context
CREATE TABLE IF NOT EXISTS chat_workflow_agent_sessions (
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
                                        'interrupted', 'waiting_input', 'waiting_approval',
                                        'paused', 'completed', 'failed', 'expired'
                                    )),
    created_at              TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at              TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_workflow_agent_sessions_execution_id ON chat_workflow_agent_sessions(workflow_execution_id);
CREATE INDEX idx_workflow_agent_sessions_state ON chat_workflow_agent_sessions(state);
