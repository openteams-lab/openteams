CREATE TABLE IF NOT EXISTS chat_workflow_iteration_feedbacks (
    id                     BLOB    NOT NULL PRIMARY KEY,
    execution_id           BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
    from_round_id          BLOB    NOT NULL REFERENCES chat_workflow_rounds(id),
    to_round_id            BLOB    REFERENCES chat_workflow_rounds(id),
    user_feedback_json     TEXT    NOT NULL,
    current_status_summary TEXT    NOT NULL,
    new_plan_diff          TEXT,
    created_at             TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_workflow_iteration_feedbacks_execution_id
    ON chat_workflow_iteration_feedbacks(execution_id);
CREATE INDEX idx_workflow_iteration_feedbacks_from_round_id
    ON chat_workflow_iteration_feedbacks(from_round_id);
CREATE INDEX idx_workflow_iteration_feedbacks_to_round_id
    ON chat_workflow_iteration_feedbacks(to_round_id);
