CREATE TABLE IF NOT EXISTS chat_workflow_loops (
    id                   BLOB    NOT NULL PRIMARY KEY,
    execution_id         BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
    round_id             BLOB    NOT NULL REFERENCES chat_workflow_rounds(id),
    loop_key             TEXT    NOT NULL,
    review_step_id       BLOB    NOT NULL REFERENCES chat_workflow_steps(id),
    member_step_ids_json TEXT    NOT NULL,
    status               TEXT    NOT NULL DEFAULT 'pending'
                                 CHECK (status IN (
                                     'pending', 'running', 'waiting_review', 'passed', 'rejected',
                                     'waiting_user', 'completed', 'failed'
                                 )),
    retry_count          INTEGER NOT NULL DEFAULT 0,
    max_retry            INTEGER NOT NULL DEFAULT 3,
    user_review_required INTEGER NOT NULL DEFAULT 1,
    rejection_reason     TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_workflow_loops_execution_id ON chat_workflow_loops(execution_id);
CREATE INDEX idx_workflow_loops_round_id ON chat_workflow_loops(round_id);
CREATE INDEX idx_workflow_loops_status ON chat_workflow_loops(status);
CREATE UNIQUE INDEX idx_workflow_loops_round_key ON chat_workflow_loops(round_id, loop_key);
