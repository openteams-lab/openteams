ALTER TABLE project_members
    ADD COLUMN execution_config TEXT NOT NULL DEFAULT '{}';

ALTER TABLE chat_session_agents
    ADD COLUMN project_member_id BLOB;

ALTER TABLE chat_session_agents
    ADD COLUMN execution_config TEXT NOT NULL DEFAULT '{}';

CREATE INDEX idx_chat_session_agents_project_member_id
    ON chat_session_agents(project_member_id);
