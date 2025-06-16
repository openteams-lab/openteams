-- Add git_repo_path field to projects table
ALTER TABLE projects ADD COLUMN git_repo_path VARCHAR(500) NOT NULL DEFAULT '';
