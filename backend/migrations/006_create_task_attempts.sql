-- Create task_attempt_status enum
CREATE TYPE task_attempt_status AS ENUM ('init', 'inprogress', 'paused');

-- Create task_attempts table
CREATE TABLE task_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    worktree_path VARCHAR(255) NOT NULL,
    base_commit VARCHAR(255),
    merge_commit VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create task_attempt_activities table
CREATE TABLE task_attempt_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_attempt_id UUID NOT NULL REFERENCES task_attempts(id) ON DELETE CASCADE,
    status task_attempt_status NOT NULL DEFAULT 'init',
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_task_attempts_task_id ON task_attempts(task_id);
CREATE INDEX idx_task_attempt_activities_task_attempt_id ON task_attempt_activities(task_attempt_id);
CREATE INDEX idx_task_attempt_activities_status ON task_attempt_activities(status);
CREATE INDEX idx_task_attempt_activities_created_at ON task_attempt_activities(created_at);

-- Create triggers to auto-update updated_at
CREATE TRIGGER update_task_attempts_updated_at 
    BEFORE UPDATE ON task_attempts 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
