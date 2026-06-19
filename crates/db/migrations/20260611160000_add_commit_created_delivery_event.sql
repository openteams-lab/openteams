PRAGMA foreign_keys = OFF;

CREATE TABLE project_delivery_records_new (
    id                           TEXT PRIMARY KEY,
    project_work_item_id          TEXT REFERENCES project_work_items(id) ON DELETE SET NULL,
    repo_id                       TEXT REFERENCES repos(id) ON DELETE SET NULL,
    external_link_id              TEXT REFERENCES project_work_item_external_links(id) ON DELETE SET NULL,
    event_type                    TEXT NOT NULL CHECK (event_type IN ('pr_opened', 'pr_merged', 'deployment', 'release', 'test_passed', 'test_failed', 'commit_created')),
    external_id                   TEXT,
    url                           TEXT,
    actor                         TEXT,
    source_session_id             TEXT REFERENCES chat_sessions(id),
    source_workflow_execution_id  TEXT REFERENCES chat_workflow_executions(id),
    metadata_json                 JSONB,
    occurred_at                   TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
);

INSERT INTO project_delivery_records_new (
    id,
    project_work_item_id,
    repo_id,
    external_link_id,
    event_type,
    external_id,
    url,
    actor,
    source_session_id,
    source_workflow_execution_id,
    metadata_json,
    occurred_at,
    created_at
)
SELECT
    id,
    project_work_item_id,
    repo_id,
    external_link_id,
    event_type,
    external_id,
    url,
    actor,
    source_session_id,
    source_workflow_execution_id,
    metadata_json,
    occurred_at,
    created_at
FROM project_delivery_records;

DROP TABLE project_delivery_records;
ALTER TABLE project_delivery_records_new RENAME TO project_delivery_records;

CREATE INDEX IF NOT EXISTS idx_project_delivery_records_work_item
    ON project_delivery_records(project_work_item_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_project_delivery_records_repo
    ON project_delivery_records(repo_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_project_delivery_records_source_session
    ON project_delivery_records(source_session_id, occurred_at);

PRAGMA foreign_keys = ON;
