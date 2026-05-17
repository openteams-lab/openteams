-- Workflow rounds: each user-acceptance cycle within an execution
CREATE TABLE IF NOT EXISTS chat_workflow_rounds (
    id                  BLOB    NOT NULL PRIMARY KEY,
    execution_id        BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
    round_index         INTEGER NOT NULL DEFAULT 1,
    source_revision_id  BLOB    REFERENCES chat_workflow_plan_revisions(id),
    status              TEXT    NOT NULL DEFAULT 'running'
                                CHECK (status IN (
                                    'running', 'waiting_user_acceptance',
                                    'accepted', 'rejected', 'archived'
                                )),
    result_step_id      BLOB,
    user_decision_summary TEXT,
    started_at          TEXT,
    completed_at        TEXT,
    archived_at         TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_workflow_rounds_execution_id ON chat_workflow_rounds(execution_id);
CREATE UNIQUE INDEX idx_workflow_rounds_exec_index ON chat_workflow_rounds(execution_id, round_index);
