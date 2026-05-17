-- Workflow plans: the source-of-truth plan definition
CREATE TABLE IF NOT EXISTS chat_workflow_plans (
    id          BLOB    NOT NULL PRIMARY KEY,
    session_id  BLOB    NOT NULL,
    source_message_id          BLOB,
    created_by_session_agent_id BLOB,
    status      TEXT    NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'ready', 'superseded', 'cancelled')),
    title       TEXT    NOT NULL DEFAULT '',
    summary_text TEXT,
    plan_json   TEXT    NOT NULL DEFAULT '{}',
    plan_schema_version INTEGER NOT NULL DEFAULT 1,
    plan_hash   TEXT    NOT NULL DEFAULT '',
    validation_status TEXT NOT NULL DEFAULT 'pending'
                        CHECK (validation_status IN ('pending', 'valid', 'invalid')),
    validation_errors_json TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_workflow_plans_session_id ON chat_workflow_plans(session_id);
CREATE INDEX idx_workflow_plans_status ON chat_workflow_plans(status);
