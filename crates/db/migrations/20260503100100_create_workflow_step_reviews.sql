CREATE TABLE IF NOT EXISTS chat_workflow_step_reviews (
    id            BLOB    NOT NULL PRIMARY KEY,
    step_id        BLOB    NOT NULL REFERENCES chat_workflow_steps(id),
    execution_id   BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
    reviewer_type  TEXT    NOT NULL CHECK (reviewer_type IN ('lead', 'user')),
    reviewer_id    TEXT,
    verdict        TEXT    NOT NULL CHECK (verdict IN ('approved', 'rejected')),
    feedback       TEXT    NOT NULL DEFAULT '',
    review_round   INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_workflow_step_reviews_step_id ON chat_workflow_step_reviews(step_id);
CREATE INDEX idx_workflow_step_reviews_execution_id ON chat_workflow_step_reviews(execution_id);
CREATE INDEX idx_workflow_step_reviews_reviewer_type ON chat_workflow_step_reviews(reviewer_type);
