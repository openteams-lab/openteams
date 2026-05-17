-- Workflow executions: a single run of a workflow plan
CREATE TABLE IF NOT EXISTS chat_workflow_executions (
    id                      BLOB    NOT NULL PRIMARY KEY,
    session_id              BLOB    NOT NULL,
    plan_id                 BLOB    NOT NULL REFERENCES chat_workflow_plans(id),
    active_revision_id      BLOB    REFERENCES chat_workflow_plan_revisions(id),
    active_round_id         BLOB,
    workflow_card_message_id BLOB,
    lead_session_agent_id   BLOB,
    status                  TEXT    NOT NULL DEFAULT 'pending'
                                    CHECK (status IN (
                                        'pending', 'bootstrapping', 'running',
                                        'interrupting', 'waiting_user', 'waiting_user_acceptance',
                                        'paused', 'recompiling', 'resuming',
                                        'completing', 'completed', 'failed', 'cancelled'
                                    )),
    current_round           INTEGER NOT NULL DEFAULT 0,
    title                   TEXT    NOT NULL DEFAULT '',
    compiled_graph_hash     TEXT,
    started_at              TEXT,
    completed_at            TEXT,
    created_at              TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at              TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_workflow_executions_session_id ON chat_workflow_executions(session_id);
CREATE INDEX idx_workflow_executions_plan_id ON chat_workflow_executions(plan_id);
CREATE INDEX idx_workflow_executions_status ON chat_workflow_executions(status);
CREATE INDEX idx_workflow_executions_active_revision_id ON chat_workflow_executions(active_revision_id);
