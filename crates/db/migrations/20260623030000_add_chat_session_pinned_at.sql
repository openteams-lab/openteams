-- Persist optional sidebar pin order for chat sessions.
-- NULL means not pinned. Non-NULL values are ordered oldest first so pinned
-- sessions keep the order in which the user pinned them.
ALTER TABLE chat_sessions ADD COLUMN pinned_at TEXT;
