-- Session-level isolated Git worktree registry.
--
-- One row represents a single isolated worktree created for a chat session.
-- Phase 1 keeps at most one active worktree per session; rows are retained
-- after terminal transitions (merged / archived / cleanup_failed) so the
-- lifecycle is auditable and the UI can render history.
--
-- The runtime worktree state machine lives in the orchestrator/service layer.
-- The DB only enforces the value domain and compare-and-swap transitions via
-- the status column. The reducer in `SessionWorktreeService` is the only legal
-- writer of `status`.
CREATE TABLE IF NOT EXISTS chat_session_worktrees (
    id                    BLOB    NOT NULL PRIMARY KEY,
    session_id            BLOB    NOT NULL,
    project_id            BLOB,
    base_workspace_path   TEXT    NOT NULL,
    repo_path             TEXT    NOT NULL,
    base_branch           TEXT    NOT NULL,
    base_commit           TEXT,
    branch_name           TEXT    NOT NULL,
    worktree_path         TEXT    NOT NULL,
    mode                  TEXT    NOT NULL DEFAULT 'session'
                                  CHECK (mode IN ('session')),
    status                TEXT    NOT NULL DEFAULT 'creating'
                                  CHECK (status IN (
                                      'creating', 'active', 'dirty', 'merging',
                                      'needs_conflict_resolution', 'merged',
                                      'archived', 'cleanup_pending', 'cleanup_failed'
                                  )),
    merge_target_branch   TEXT,
    merge_operation       TEXT
                                  CHECK (merge_operation IS NULL
                                         OR merge_operation IN (
                                             'merge', 'squash_merge', 'cherry_pick', 'rebase'
                                         )),
    conflict_files_json   TEXT    NOT NULL DEFAULT '[]',
    operation_started_at  TEXT,
    cleanup_error         TEXT,
    last_used_at          TEXT,
    merged_at             TEXT,
    archived_at           TEXT,
    created_at            TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at            TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- Phase 1 invariant: at most one non-terminal worktree row per session.
-- Non-terminal = any status except the auditable terminal states listed below.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_session_worktrees_active_session
    ON chat_session_worktrees(session_id)
    WHERE status IN ('creating', 'active', 'dirty', 'merging',
                     'needs_conflict_resolution', 'merged', 'cleanup_pending');

CREATE INDEX IF NOT EXISTS idx_chat_session_worktrees_session_id
    ON chat_session_worktrees(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_session_worktrees_status
    ON chat_session_worktrees(status);
CREATE INDEX IF NOT EXISTS idx_chat_session_worktrees_project_id
    ON chat_session_worktrees(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_session_worktrees_worktree_path
    ON chat_session_worktrees(worktree_path);
