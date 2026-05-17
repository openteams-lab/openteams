-- Workflow steps: compiled step records for execution
CREATE TABLE IF NOT EXISTS chat_workflow_steps (
    id                              BLOB    NOT NULL PRIMARY KEY,
    execution_id                    BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
    round_id                        BLOB    NOT NULL REFERENCES chat_workflow_rounds(id),
    compiled_revision_id            BLOB    REFERENCES chat_workflow_plan_revisions(id),
    step_key                        TEXT    NOT NULL,
    step_type                       TEXT    NOT NULL
                                            CHECK (step_type IN ('task', 'review', 'result')),
    title                           TEXT    NOT NULL DEFAULT '',
    instructions                    TEXT    NOT NULL DEFAULT '',
    assigned_workflow_agent_session_id BLOB,
    status                          TEXT    NOT NULL DEFAULT 'pending'
                                            CHECK (status IN (
                                                'pending', 'ready', 'running',
                                                'interrupt_requested', 'interrupted',
                                                'waiting_input', 'waiting_review',
                                                'blocked', 'completed', 'failed',
                                                'skipped', 'cancelled'
                                            )),
    retry_count                     INTEGER NOT NULL DEFAULT 0,
    max_retry                       INTEGER NOT NULL DEFAULT 1,
    round_index                     INTEGER NOT NULL DEFAULT 1,
    display_order                   INTEGER NOT NULL DEFAULT 0,
    latest_run_id                   BLOB,
    summary_text                    TEXT,
    created_at                      TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at                      TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    started_at                      TEXT,
    completed_at                    TEXT
);

CREATE INDEX idx_workflow_steps_execution_id ON chat_workflow_steps(execution_id);
CREATE INDEX idx_workflow_steps_round_id ON chat_workflow_steps(round_id);
CREATE INDEX idx_workflow_steps_status ON chat_workflow_steps(status);
CREATE UNIQUE INDEX idx_workflow_steps_round_key ON chat_workflow_steps(round_id, step_key);

-- Workflow step edges: dependency relationships between steps
CREATE TABLE IF NOT EXISTS chat_workflow_step_edges (
    id                  BLOB    NOT NULL PRIMARY KEY,
    execution_id        BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
    compiled_revision_id BLOB   REFERENCES chat_workflow_plan_revisions(id),
    from_step_id        BLOB    NOT NULL REFERENCES chat_workflow_steps(id),
    to_step_id          BLOB    NOT NULL REFERENCES chat_workflow_steps(id),
    edge_kind           TEXT    NOT NULL DEFAULT 'hard'
                                CHECK (edge_kind IN ('hard', 'soft')),
    created_at          TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_workflow_step_edges_execution_id ON chat_workflow_step_edges(execution_id);
CREATE INDEX idx_workflow_step_edges_from ON chat_workflow_step_edges(from_step_id);
CREATE INDEX idx_workflow_step_edges_to ON chat_workflow_step_edges(to_step_id);
