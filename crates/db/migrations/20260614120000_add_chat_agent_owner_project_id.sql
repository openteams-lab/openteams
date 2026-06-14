ALTER TABLE chat_agents
ADD COLUMN owner_project_id BLOB REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_agents_owner_project_id
    ON chat_agents(owner_project_id);
