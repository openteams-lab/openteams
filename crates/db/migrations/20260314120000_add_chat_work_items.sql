CREATE TABLE chat_work_items (
    id               BLOB PRIMARY KEY,
    session_id       BLOB NOT NULL,
    run_id           BLOB NOT NULL,
    session_agent_id BLOB NOT NULL,
    agent_id         BLOB NOT NULL,
    item_type        TEXT NOT NULL
                       CHECK (item_type IN ('artifact','conclusion')),
    content          TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES chat_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (session_agent_id) REFERENCES chat_session_agents(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES chat_agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_work_items_session_created_at
    ON chat_work_items(session_id, created_at);

CREATE INDEX idx_chat_work_items_run_id
    ON chat_work_items(run_id);
