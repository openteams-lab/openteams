-- Workflow events: audit log for all state transitions and actions
CREATE TABLE IF NOT EXISTS chat_workflow_events (
    id              BLOB    NOT NULL PRIMARY KEY,
    execution_id    BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
    round_id        BLOB,
    step_id         BLOB,
    agent_session_id BLOB,
    event_type      TEXT    NOT NULL,
    status_before   TEXT,
    status_after    TEXT,
    detail_json     TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_workflow_events_execution_id ON chat_workflow_events(execution_id);
CREATE INDEX idx_workflow_events_event_type ON chat_workflow_events(event_type);
CREATE INDEX idx_workflow_events_created_at ON chat_workflow_events(created_at);
