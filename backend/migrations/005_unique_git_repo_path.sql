-- Add unique constraint to git_repo_path to prevent duplicate repository paths
ALTER TABLE projects ADD CONSTRAINT unique_git_repo_path UNIQUE (git_repo_path);
