ALTER TABLE chat_sessions ADD COLUMN team_protocol TEXT DEFAULT '';
ALTER TABLE chat_sessions ADD COLUMN team_protocol_enabled INTEGER DEFAULT 0;