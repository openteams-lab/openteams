-- Add stdout and stderr columns to task_attempts table
ALTER TABLE task_attempts 
ADD COLUMN stdout TEXT,
ADD COLUMN stderr TEXT;
