ALTER TABLE chat_runs ADD COLUMN workspace_path TEXT;

UPDATE chat_runs
SET workspace_path = (
    SELECT session_agents.workspace_path
    FROM chat_session_agents session_agents
    WHERE session_agents.id = chat_runs.session_agent_id
)
WHERE workspace_path IS NULL;

CREATE INDEX idx_chat_runs_session_workspace_path
    ON chat_runs(session_id, workspace_path);
