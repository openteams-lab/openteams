PRAGMA foreign_keys = OFF;

-- sqlx workaround due to lack of `-- no-transaction` in sqlx-sqlite.
COMMIT TRANSACTION;

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE project_work_items_new (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('feature', 'bug', 'task', 'deploy', 'test', 'doc', 'refactor')),
    status      TEXT NOT NULL CHECK (status IN (
        'open',
        'in_progress',
        'blocked',
        'ready_to_merge',
        'merging',
        'done',
        'cancelled',
        'duplicate'
    )),
    title       TEXT NOT NULL,
    description TEXT,
    priority    TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    source      TEXT NOT NULL CHECK (source IN ('manual', 'github_issue', 'workflow', 'session')),
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

INSERT INTO project_work_items_new (
    id, project_id, type, status, title, description, priority, source,
    created_by, created_at, updated_at
)
SELECT
    id, project_id, type, status, title, description, priority, source,
    created_by, created_at, updated_at
FROM project_work_items;

DROP TABLE project_work_items;
ALTER TABLE project_work_items_new RENAME TO project_work_items;

CREATE INDEX IF NOT EXISTS idx_project_work_items_project_status
    ON project_work_items(project_id, status, updated_at);

PRAGMA foreign_key_check;

COMMIT;

PRAGMA foreign_keys = ON;

-- sqlx workaround due to lack of `-- no-transaction` in sqlx-sqlite.
BEGIN TRANSACTION;
