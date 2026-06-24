-- Add worktree_mode column to chat_sessions for session-level worktree
-- isolation preference. Defaults to 'inherit' (use project/global default,
-- which for Phase 1 is effectively disabled) for backward compatibility.
--
-- Values:
--   inherit  - use project/global default (Phase 1: same as disabled)
--   disabled - never create an isolated worktree for this session
--   isolated - create an isolated worktree on first agent run
ALTER TABLE chat_sessions ADD COLUMN worktree_mode TEXT NOT NULL DEFAULT 'inherit'
    CHECK (worktree_mode IN ('inherit', 'disabled', 'isolated'));
