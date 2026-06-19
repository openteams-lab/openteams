UPDATE repo_integrations
SET sync_status = 'connected'
WHERE sync_status IS NULL OR sync_status = '' OR sync_status = 'synced';

ALTER TABLE repo_integrations ADD COLUMN last_error TEXT;
ALTER TABLE repo_integrations ADD COLUMN github_account_id TEXT;
ALTER TABLE repo_integrations ADD COLUMN repo_grant_json JSONB;
ALTER TABLE repo_integrations ADD COLUMN role TEXT NOT NULL DEFAULT 'primary';

PRAGMA foreign_keys = OFF;

CREATE TABLE repo_integrations_constrained (
    id                TEXT PRIMARY KEY,
    repo_id           TEXT REFERENCES repos(id) ON DELETE CASCADE,
    provider          TEXT NOT NULL,
    owner             TEXT,
    name              TEXT,
    remote_url        TEXT,
    default_branch    TEXT,
    external_id       TEXT,
    installation_id   TEXT,
    github_account_id TEXT,
    repo_grant_json   JSONB,
    role              TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'auxiliary')),
    sync_status       TEXT NOT NULL DEFAULT 'connected' CHECK (sync_status IN ('connected', 'disconnected', 'error')),
    last_synced_at    TIMESTAMPTZ,
    last_error        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

INSERT INTO repo_integrations_constrained (
    id, repo_id, provider, owner, name, remote_url, default_branch, external_id,
    installation_id, github_account_id, repo_grant_json, role, sync_status, last_synced_at,
    last_error, created_at, updated_at
)
SELECT id, repo_id, provider, owner, name, remote_url, default_branch, external_id,
       installation_id, github_account_id, repo_grant_json,
       CASE role
           WHEN 'auxiliary' THEN 'auxiliary'
           ELSE 'primary'
       END,
       CASE sync_status
           WHEN 'disconnected' THEN 'disconnected'
           WHEN 'error' THEN 'error'
           ELSE 'connected'
       END,
       last_synced_at, last_error, created_at, updated_at
FROM repo_integrations;

DROP TABLE repo_integrations;
ALTER TABLE repo_integrations_constrained RENAME TO repo_integrations;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS project_work_items (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('feature', 'bug', 'task', 'deploy', 'test', 'doc', 'refactor')),
    status      TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
    title       TEXT NOT NULL,
    description TEXT,
    priority    TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    source      TEXT NOT NULL CHECK (source IN ('manual', 'github_issue', 'workflow', 'session')),
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX IF NOT EXISTS idx_project_work_items_project_status
    ON project_work_items(project_id, status, updated_at);

CREATE TABLE IF NOT EXISTS project_work_item_external_links (
    id                   TEXT PRIMARY KEY,
    project_work_item_id TEXT NOT NULL REFERENCES project_work_items(id) ON DELETE CASCADE,
    provider             TEXT NOT NULL,
    repo_id              TEXT REFERENCES repos(id),
    external_type        TEXT NOT NULL CHECK (external_type IN ('github_issue', 'github_pr', 'github_commit', 'github_deployment', 'github_release')),
    external_id          TEXT NOT NULL,
    number               INTEGER,
    url                  TEXT,
    state                TEXT,
    metadata_json        JSONB,
    last_synced_at       TIMESTAMPTZ,
    stale                BOOLEAN NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_work_item_external_unique
    ON project_work_item_external_links(provider, repo_id, external_type, external_id);
CREATE INDEX IF NOT EXISTS idx_project_work_item_external_work_item
    ON project_work_item_external_links(project_work_item_id);

CREATE TABLE IF NOT EXISTS project_work_item_execution_links (
    id                    TEXT PRIMARY KEY,
    project_work_item_id  TEXT NOT NULL REFERENCES project_work_items(id) ON DELETE CASCADE,
    session_id            TEXT REFERENCES chat_sessions(id),
    workflow_execution_id TEXT REFERENCES chat_workflow_executions(id),
    workflow_step_id      TEXT REFERENCES chat_workflow_steps(id),
    run_id                TEXT REFERENCES chat_runs(id),
    link_type             TEXT NOT NULL CHECK (link_type IN ('created_from', 'discussed_in', 'implemented_by', 'reviewed_by', 'delivered_by')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX IF NOT EXISTS idx_project_work_item_execution_work_item
    ON project_work_item_execution_links(project_work_item_id);

CREATE TABLE IF NOT EXISTS project_delivery_records (
    id                           TEXT PRIMARY KEY,
    project_work_item_id          TEXT REFERENCES project_work_items(id) ON DELETE SET NULL,
    repo_id                       TEXT REFERENCES repos(id) ON DELETE SET NULL,
    external_link_id              TEXT REFERENCES project_work_item_external_links(id) ON DELETE SET NULL,
    event_type                    TEXT NOT NULL CHECK (event_type IN ('pr_opened', 'pr_merged', 'deployment', 'release', 'test_passed', 'test_failed')),
    external_id                   TEXT,
    url                           TEXT,
    actor                         TEXT,
    source_session_id             TEXT REFERENCES chat_sessions(id),
    source_workflow_execution_id  TEXT REFERENCES chat_workflow_executions(id),
    metadata_json                 JSONB,
    occurred_at                   TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX IF NOT EXISTS idx_project_delivery_records_work_item
    ON project_delivery_records(project_work_item_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_project_delivery_records_repo
    ON project_delivery_records(repo_id, occurred_at);

CREATE TABLE IF NOT EXISTS github_operation_audits (
    id                    TEXT PRIMARY KEY,
    actor                 TEXT,
    operation_source      TEXT NOT NULL CHECK (operation_source IN ('user_ui', 'agent')),
    session_id            TEXT REFERENCES chat_sessions(id),
    workflow_execution_id TEXT REFERENCES chat_workflow_executions(id),
    repo_id               TEXT REFERENCES repos(id),
    target_type           TEXT NOT NULL CHECK (target_type IN ('issue', 'pull_request', 'repo')),
    target_id             TEXT,
    action                TEXT NOT NULL,
    result                TEXT NOT NULL CHECK (result IN ('pending_approval', 'approved', 'denied', 'success', 'failed')),
    error                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX IF NOT EXISTS idx_github_operation_audits_repo_created
    ON github_operation_audits(repo_id, created_at);
CREATE INDEX IF NOT EXISTS idx_github_operation_audits_session
    ON github_operation_audits(session_id, created_at);

CREATE TABLE IF NOT EXISTS github_pending_pr_creations (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    repo_integration_id TEXT NOT NULL REFERENCES repo_integrations(id) ON DELETE CASCADE,
    work_item_id        TEXT REFERENCES project_work_items(id) ON DELETE SET NULL,
    audit_id            TEXT REFERENCES github_operation_audits(id) ON DELETE SET NULL,
    base_branch         TEXT NOT NULL,
    head_branch         TEXT NOT NULL,
    title               TEXT NOT NULL,
    body                TEXT,
    status              TEXT NOT NULL CHECK (status IN ('push_failed', 'pushed', 'create_failed', 'local_link_failed', 'completed')),
    pull_request_number INTEGER,
    pull_request_url    TEXT,
    last_error          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX IF NOT EXISTS idx_github_pending_pr_project_status
    ON github_pending_pr_creations(project_id, status, updated_at);

CREATE TABLE IF NOT EXISTS github_pending_operations (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    repo_integration_id TEXT NOT NULL REFERENCES repo_integrations(id) ON DELETE CASCADE,
    audit_id            TEXT NOT NULL REFERENCES github_operation_audits(id) ON DELETE CASCADE,
    operation_kind      TEXT NOT NULL CHECK (operation_kind IN ('issue_comment', 'issue_state', 'issue_labels', 'issue_assignees')),
    target_type         TEXT NOT NULL CHECK (target_type IN ('issue', 'pull_request', 'repo')),
    target_id           TEXT,
    payload_json        JSONB NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('pending_approval', 'completed', 'failed', 'denied')),
    last_error          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_pending_operations_audit
    ON github_pending_operations(audit_id);
CREATE INDEX IF NOT EXISTS idx_github_pending_operations_project_status
    ON github_pending_operations(project_id, status, updated_at);
