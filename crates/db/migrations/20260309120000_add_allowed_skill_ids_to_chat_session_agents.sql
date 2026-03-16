ALTER TABLE chat_session_agents
    ADD COLUMN allowed_skill_ids TEXT NOT NULL DEFAULT '[]';
