-- Turn on FK support (important for SQLite)
PRAGMA foreign_keys = ON;

-------------------------------------------------------------------------------
-- 1. Core lookup “enums” (via CHECK constraints)
-------------------------------------------------------------------------------
-- task_status values
-- ('todo','inprogress','done','cancelled','inreview')

-- task_attempt_status values
-- ('init','inprogress','paused')

-------------------------------------------------------------------------------
-- 2. Tables
-------------------------------------------------------------------------------
CREATE TABLE projects (
    id            TEXT PRIMARY KEY,                       -- supply UUID in app
    name          TEXT NOT NULL,
    git_repo_path TEXT NOT NULL DEFAULT '' UNIQUE,
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tasks (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'todo'
                   CHECK (status IN ('todo','inprogress','done','cancelled','inreview')),
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE task_attempts (
    id            TEXT PRIMARY KEY,
    task_id       TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    base_commit   TEXT,
    merge_commit  TEXT,
    executor      TEXT,          -- final column name (no JSONB)
    stdout        TEXT,
    stderr        TEXT,
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE task_attempt_activities (
    id              TEXT PRIMARY KEY,
    task_attempt_id TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'init'
                       CHECK (status IN ('init','inprogress','paused')),
    note            TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_attempt_id) REFERENCES task_attempts(id) ON DELETE CASCADE
);

-------------------------------------------------------------------------------
-- 3. Indexes
-------------------------------------------------------------------------------
CREATE INDEX idx_tasks_project_id                        ON tasks(project_id);
CREATE INDEX idx_tasks_status                            ON tasks(status);
CREATE INDEX idx_task_attempts_task_id                   ON task_attempts(task_id);
CREATE INDEX idx_task_attempt_activities_attempt_id      ON task_attempt_activities(task_attempt_id);
CREATE INDEX idx_task_attempt_activities_status          ON task_attempt_activities(status);
CREATE INDEX idx_task_attempt_activities_created_at      ON task_attempt_activities(created_at);

-------------------------------------------------------------------------------
-- 4. updated_at auto-maintenance triggers
--    (fires only when caller hasn’t manually changed updated_at)
-------------------------------------------------------------------------------
-- Projects
CREATE TRIGGER trg_projects_updated_at
AFTER UPDATE ON projects
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

-- Tasks
CREATE TRIGGER trg_tasks_updated_at
AFTER UPDATE ON tasks
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

-- Task attempts
CREATE TRIGGER trg_task_attempts_updated_at
AFTER UPDATE ON task_attempts
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE task_attempts SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;
