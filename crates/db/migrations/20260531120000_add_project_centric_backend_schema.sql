CREATE TABLE IF NOT EXISTS project_members (
    id                     TEXT PRIMARY KEY,
    project_id             TEXT REFERENCES projects(id) ON DELETE CASCADE,
    member_type            TEXT CHECK (member_type IN ('human', 'agent')),
    user_id                TEXT,
    agent_id               TEXT REFERENCES chat_agents(id),
    role                   TEXT,
    display_order          INTEGER DEFAULT 0,
    default_workspace_path TEXT,
    allowed_skill_ids      JSONB,
    is_default             BOOLEAN DEFAULT false,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_members_one_human_per_project
    ON project_members(project_id)
    WHERE member_type = 'human';

CREATE TABLE IF NOT EXISTS project_paths (
    id         TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    path       TEXT NOT NULL,
    label      TEXT,
    kind       TEXT CHECK (kind IN ('workspace', 'artifact', 'external')),
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE TABLE IF NOT EXISTS repo_integrations (
    id              TEXT PRIMARY KEY,
    repo_id         TEXT REFERENCES repos(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,
    owner           TEXT,
    name            TEXT,
    remote_url      TEXT,
    default_branch  TEXT,
    external_id     TEXT,
    installation_id TEXT,
    sync_status     TEXT,
    last_synced_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE TABLE IF NOT EXISTS github_installations (
    id                   TEXT PRIMARY KEY,
    account_login        TEXT,
    account_type         TEXT,
    installation_id      TEXT,
    permissions_json     JSONB,
    repository_selection TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE TABLE IF NOT EXISTS github_pull_requests (
    id                  TEXT PRIMARY KEY,
    repo_integration_id TEXT REFERENCES repo_integrations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS github_issues (
    id                  TEXT PRIMARY KEY,
    repo_integration_id TEXT REFERENCES repo_integrations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS github_workflow_runs (
    id                  TEXT PRIMARY KEY,
    repo_integration_id TEXT REFERENCES repo_integrations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS github_sync_jobs (
    id                  TEXT PRIMARY KEY,
    repo_integration_id TEXT REFERENCES repo_integrations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_delivery_events (
    id                    TEXT PRIMARY KEY,
    project_id            TEXT REFERENCES projects(id) ON DELETE CASCADE,
    session_id            TEXT,
    workflow_execution_id TEXT,
    step_id               TEXT,
    event_type            TEXT CHECK (event_type IN ('feature', 'bugfix', 'test')),
    title                 TEXT,
    source                TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE TABLE IF NOT EXISTS project_stats (
    id             TEXT PRIMARY KEY,
    project_id     TEXT REFERENCES projects(id) ON DELETE CASCADE,
    period_start   DATE,
    period_end     DATE,
    feature_count  INTEGER DEFAULT 0,
    bugfix_count   INTEGER DEFAULT 0,
    test_count     INTEGER DEFAULT 0,
    input_tokens   BIGINT DEFAULT 0,
    output_tokens  BIGINT DEFAULT 0,
    total_tokens   BIGINT DEFAULT 0,
    cost_total     DECIMAL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_stats_project_period
    ON project_stats(project_id, period_start, period_end);

ALTER TABLE chat_sessions ADD COLUMN project_id TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_project_updated
    ON chat_sessions(project_id, updated_at);

ALTER TABLE projects ADD COLUMN description TEXT;
ALTER TABLE projects ADD COLUMN status TEXT;
ALTER TABLE projects ADD COLUMN default_workspace_path TEXT;
ALTER TABLE projects ADD COLUMN active_repo_id TEXT;
