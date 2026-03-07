-- Add download_count column to chat_skills table for tracking skill popularity
ALTER TABLE chat_skills ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;

-- Create index for efficient sorting by download count
CREATE INDEX idx_chat_skills_download_count ON chat_skills(download_count DESC);
