CREATE TABLE IF NOT EXISTS chat_session_path_index (
    project_id          BLOB NOT NULL,
    workspace_path      TEXT NOT NULL,
    session_id          BLOB NOT NULL,
    path                TEXT NOT NULL,
    last_run_id         BLOB REFERENCES chat_runs(id) ON DELETE SET NULL,
    last_observed_at    TEXT NOT NULL,
    existed_after_run   INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    PRIMARY KEY (project_id, workspace_path, session_id, path),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_session_path_index_lookup
    ON chat_session_path_index(project_id, workspace_path, path, session_id);

CREATE INDEX IF NOT EXISTS idx_chat_session_path_index_session
    ON chat_session_path_index(session_id, workspace_path);
