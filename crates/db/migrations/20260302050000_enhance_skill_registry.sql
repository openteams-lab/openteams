-- Add remote registry support fields to chat_skills
ALTER TABLE chat_skills ADD COLUMN source TEXT NOT NULL DEFAULT 'local'
    CHECK (source IN ('local', 'registry', 'github', 'url'));
ALTER TABLE chat_skills ADD COLUMN source_url TEXT;
ALTER TABLE chat_skills ADD COLUMN version TEXT NOT NULL DEFAULT '1.0.0';
ALTER TABLE chat_skills ADD COLUMN author TEXT;
ALTER TABLE chat_skills ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE chat_skills ADD COLUMN category TEXT;
ALTER TABLE chat_skills ADD COLUMN compatible_agents TEXT NOT NULL DEFAULT '[]';

CREATE INDEX idx_chat_skills_source ON chat_skills(source);
CREATE INDEX idx_chat_skills_category ON chat_skills(category);