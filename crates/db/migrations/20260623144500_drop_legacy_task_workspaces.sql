-- Remove the legacy project/task workspace execution stack.
-- Chat sessions, session worktrees, workflow executions, project paths, and
-- project work items are intentionally preserved.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS task_images;
DROP TABLE IF EXISTS merges;
DROP TABLE IF EXISTS execution_process_repo_states;
DROP TABLE IF EXISTS execution_process_logs;
DROP TABLE IF EXISTS coding_agent_turns;
DROP TABLE IF EXISTS execution_processes;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS workspace_repos;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS tasks;

PRAGMA foreign_keys = ON;
