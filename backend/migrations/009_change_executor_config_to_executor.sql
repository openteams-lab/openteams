-- Change executor_config column to executor (string) in task_attempts table

-- Add the new executor column
ALTER TABLE task_attempts ADD COLUMN executor TEXT;

-- Convert existing executor_config data to executor names
-- This assumes the existing JSONB data has a structure we can extract from
UPDATE task_attempts 
SET executor = CASE 
    WHEN executor_config IS NULL THEN NULL
    WHEN executor_config->>'type' = 'Echo' THEN 'echo'
    WHEN executor_config->>'type' = 'Claude' THEN 'claude'
    ELSE 'echo' -- Default fallback
END
WHERE executor_config IS NOT NULL;

-- Drop the old executor_config column
ALTER TABLE task_attempts DROP COLUMN executor_config;
