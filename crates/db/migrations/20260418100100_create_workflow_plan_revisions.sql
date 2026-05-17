-- Workflow plan revisions: immutable history of plan edits
CREATE TABLE IF NOT EXISTS chat_workflow_plan_revisions (
    id              BLOB    NOT NULL PRIMARY KEY,
    plan_id         BLOB    NOT NULL REFERENCES chat_workflow_plans(id),
    revision_no     INTEGER NOT NULL DEFAULT 1,
    edited_by       TEXT    NOT NULL DEFAULT 'lead'
                            CHECK (edited_by IN ('lead', 'system')),
    editor_session_agent_id BLOB,
    reason          TEXT,
    plan_json       TEXT    NOT NULL DEFAULT '{}',
    plan_hash       TEXT    NOT NULL DEFAULT '',
    validation_status TEXT  NOT NULL DEFAULT 'pending'
                            CHECK (validation_status IN ('pending', 'valid', 'invalid')),
    validation_errors_json TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_workflow_plan_revisions_plan_id ON chat_workflow_plan_revisions(plan_id);
CREATE UNIQUE INDEX idx_workflow_plan_revisions_plan_revision ON chat_workflow_plan_revisions(plan_id, revision_no);
