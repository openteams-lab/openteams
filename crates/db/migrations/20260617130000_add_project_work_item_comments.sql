CREATE TABLE IF NOT EXISTS project_work_item_comments (
    id                   TEXT PRIMARY KEY,
    project_work_item_id TEXT NOT NULL REFERENCES project_work_items(id) ON DELETE CASCADE,
    body                 TEXT NOT NULL,
    author               TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX IF NOT EXISTS idx_project_work_item_comments_work_item
    ON project_work_item_comments(project_work_item_id, created_at);
