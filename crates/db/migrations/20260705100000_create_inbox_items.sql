CREATE TABLE IF NOT EXISTS inbox_items (
    id            BLOB NOT NULL PRIMARY KEY,
    project_id    BLOB,
    session_id    BLOB,
    kind          TEXT NOT NULL,
    severity      TEXT NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('info', 'warning', 'error')),
    title         TEXT NOT NULL,
    body          TEXT,
    source_type   TEXT NOT NULL,
    source_id     TEXT,
    dedupe_key    TEXT NOT NULL,
    read_at       TEXT,
    archived_at   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_items_dedupe_key
    ON inbox_items(dedupe_key);

CREATE INDEX IF NOT EXISTS idx_inbox_items_unread
    ON inbox_items(archived_at, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_items_project
    ON inbox_items(project_id, archived_at, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_items_session
    ON inbox_items(session_id, archived_at, read_at, created_at DESC);
