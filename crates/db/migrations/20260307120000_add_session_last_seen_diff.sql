-- Add last_seen_diff_key to track which diff the user has seen
ALTER TABLE chat_sessions ADD COLUMN last_seen_diff_key TEXT;
