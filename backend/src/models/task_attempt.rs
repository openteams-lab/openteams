use chrono::{DateTime, Utc};
use git2::{Error as GitError, Repository};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Type};
use std::path::Path;
use ts_rs::TS;
use uuid::Uuid;

use super::project::Project;
use super::task::Task;
use crate::executor::ExecutorConfig;

#[derive(Debug)]
pub enum TaskAttemptError {
    Database(sqlx::Error),
    Git(GitError),
    TaskNotFound,
    ProjectNotFound,
}

impl std::fmt::Display for TaskAttemptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskAttemptError::Database(e) => write!(f, "Database error: {}", e),
            TaskAttemptError::Git(e) => write!(f, "Git error: {}", e),
            TaskAttemptError::TaskNotFound => write!(f, "Task not found"),
            TaskAttemptError::ProjectNotFound => write!(f, "Project not found"),
        }
    }
}

impl std::error::Error for TaskAttemptError {}

impl From<sqlx::Error> for TaskAttemptError {
    fn from(err: sqlx::Error) -> Self {
        TaskAttemptError::Database(err)
    }
}

impl From<GitError> for TaskAttemptError {
    fn from(err: GitError) -> Self {
        TaskAttemptError::Git(err)
    }
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "task_attempt_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum TaskAttemptStatus {
    Init,
    InProgress,
    Paused,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskAttempt {
    pub id: Uuid,
    pub task_id: Uuid, // Foreign key to Task
    pub worktree_path: String,
    pub base_commit: Option<String>,
    pub merge_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executor: Option<String>, // Name of the executor to use
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateTaskAttempt {
    pub task_id: Uuid,
    pub worktree_path: String,
    pub base_commit: Option<String>,
    pub merge_commit: Option<String>,
    pub executor: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateTaskAttempt {
    pub worktree_path: Option<String>,
    pub base_commit: Option<String>,
    pub merge_commit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum DiffChunkType {
    Equal,
    Insert,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DiffChunk {
    pub chunk_type: DiffChunkType,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FileDiff {
    pub path: String,
    pub chunks: Vec<DiffChunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorktreeDiff {
    pub files: Vec<FileDiff>,
}

impl TaskAttempt {
    pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            TaskAttempt,
            r#"SELECT id, task_id, worktree_path, base_commit, merge_commit, executor, stdout, stderr, created_at, updated_at 
               FROM task_attempts 
               WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_task_id(pool: &PgPool, task_id: Uuid) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            TaskAttempt,
            r#"SELECT id, task_id, worktree_path, base_commit, merge_commit, executor, stdout, stderr, created_at, updated_at 
               FROM task_attempts 
               WHERE task_id = $1 
               ORDER BY created_at DESC"#,
            task_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &PgPool,
        data: &CreateTaskAttempt,
        attempt_id: Uuid,
    ) -> Result<Self, TaskAttemptError> {
        // First, get the task to get the project_id
        let task = Task::find_by_id(pool, data.task_id)
            .await?
            .ok_or(TaskAttemptError::TaskNotFound)?;

        // Then get the project using the project_id
        let project = Project::find_by_id(pool, task.project_id)
            .await?
            .ok_or(TaskAttemptError::ProjectNotFound)?;

        // Create the worktree using git2
        let repo = Repository::open(&project.git_repo_path)?;
        let worktree_path = Path::new(&data.worktree_path);

        // Get base commit
        let base_commit = {
            let head = repo.head()?;
            // Peel it to a commit object and grab its ID
            let commit = head.peel_to_commit()?;
            commit.id().to_string()
        };

        // Create the worktree directory if it doesn't exist
        if let Some(parent) = worktree_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| TaskAttemptError::Git(GitError::from_str(&e.to_string())))?;
        }

        // Create the worktree at the specified path
        let branch_name = format!("attempt-{}", attempt_id);
        repo.worktree(&branch_name, worktree_path, None)?;

        // Insert the record into the database
        let task_attempt = sqlx::query_as!(
            TaskAttempt,
            r#"INSERT INTO task_attempts (id, task_id, worktree_path, base_commit, merge_commit, executor, stdout, stderr) 
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
               RETURNING id, task_id, worktree_path, base_commit, merge_commit, executor, stdout, stderr, created_at, updated_at"#,
            attempt_id,
            data.task_id,
            data.worktree_path,
            base_commit,
            data.merge_commit,
            data.executor,
            None::<String>, // stdout
            None::<String>  // stderr
        )
        .fetch_one(pool)
        .await?;

        Ok(task_attempt)
    }

    pub async fn exists_for_task(
        pool: &PgPool,
        attempt_id: Uuid,
        task_id: Uuid,
        project_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query!(
            "SELECT ta.id FROM task_attempts ta 
             JOIN tasks t ON ta.task_id = t.id 
             WHERE ta.id = $1 AND t.id = $2 AND t.project_id = $3",
            attempt_id,
            task_id,
            project_id
        )
        .fetch_optional(pool)
        .await?;
        Ok(result.is_some())
    }

    /// Get the executor for this task attempt, defaulting to Echo if none is specified
    pub fn get_executor(&self) -> Box<dyn crate::executor::Executor> {
        if let Some(executor_name) = &self.executor {
            match executor_name.as_str() {
                "echo" => ExecutorConfig::Echo.create_executor(),
                "claude" => ExecutorConfig::Claude.create_executor(),
                _ => ExecutorConfig::Echo.create_executor(), // Default fallback
            }
        } else {
            // Default to echo executor
            ExecutorConfig::Echo.create_executor()
        }
    }

    /// Update stdout and stderr for this task attempt
    pub async fn update_output(
        pool: &PgPool,
        id: Uuid,
        stdout: Option<&str>,
        stderr: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE task_attempts SET stdout = $1, stderr = $2, updated_at = NOW() WHERE id = $3",
            stdout,
            stderr,
            id
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Append to stdout and stderr for this task attempt (for streaming updates)
    pub async fn append_output(
        pool: &PgPool,
        id: Uuid,
        stdout_append: Option<&str>,
        stderr_append: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        if let Some(stdout_data) = stdout_append {
            sqlx::query!(
                "UPDATE task_attempts SET stdout = COALESCE(stdout, '') || $1, updated_at = NOW() WHERE id = $2",
                stdout_data,
                id
            )
            .execute(pool)
            .await?;
        }

        if let Some(stderr_data) = stderr_append {
            sqlx::query!(
                "UPDATE task_attempts SET stderr = COALESCE(stderr, '') || $1, updated_at = NOW() WHERE id = $2",
                stderr_data,
                id
            )
            .execute(pool)
            .await?;
        }

        Ok(())
    }

    /// Perform the actual git merge operations (synchronous)
    fn perform_merge_operation(
        worktree_path: &str,
        main_repo_path: &str,
        attempt_id: Uuid,
    ) -> Result<String, TaskAttemptError> {
        // Open the worktree repository
        let worktree_repo = Repository::open(worktree_path)?;

        // Open the main repository
        let main_repo = Repository::open(main_repo_path)?;

        // Get the current signature for commits
        let signature = main_repo.signature()?;

        // First, commit any uncommitted changes in the worktree
        let mut worktree_index = worktree_repo.index()?;
        let tree_id = worktree_index.write_tree()?;
        let _tree = worktree_repo.find_tree(tree_id)?;

        // Get the current HEAD commit in the worktree
        let head = worktree_repo.head()?;
        let parent_commit = head.peel_to_commit()?;

        // Check if there are any changes to commit
        let status = worktree_repo.statuses(None)?;
        let has_changes = status.iter().any(|entry| {
            let flags = entry.status();
            flags.contains(git2::Status::INDEX_NEW)
                || flags.contains(git2::Status::INDEX_MODIFIED)
                || flags.contains(git2::Status::INDEX_DELETED)
                || flags.contains(git2::Status::WT_NEW)
                || flags.contains(git2::Status::WT_MODIFIED)
                || flags.contains(git2::Status::WT_DELETED)
        });

        let mut final_commit = parent_commit.id();

        if has_changes {
            // Stage all changes
            let mut worktree_index = worktree_repo.index()?;
            worktree_index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
            worktree_index.write()?;

            let tree_id = worktree_index.write_tree()?;
            let tree = worktree_repo.find_tree(tree_id)?;

            // Create commit for the changes
            let commit_message = format!("Task attempt {} - Final changes", attempt_id);
            final_commit = worktree_repo.commit(
                Some("HEAD"),
                &signature,
                &signature,
                &commit_message,
                &tree,
                &[&parent_commit],
            )?;
        }

        // Now we need to merge the worktree branch into the main repository
        let branch_name = format!("attempt-{}", attempt_id);

        // Get the main branch (usually "main" or "master")
        let main_branch = main_repo.head()?.shorthand().unwrap_or("main").to_string();

        // Fetch the worktree branch into the main repository
        let worktree_branch_ref = format!("refs/heads/{}", branch_name);
        let main_branch_ref = format!("refs/heads/{}", main_branch);

        // Get the final commit from worktree
        let _final_commit_obj = worktree_repo.find_commit(final_commit)?;

        // Create the branch in main repo pointing to the final commit
        let branch_oid = main_repo.odb()?.write(
            git2::ObjectType::Commit,
            &worktree_repo.odb()?.read(final_commit)?.data(),
        )?;

        // Create reference in main repo
        main_repo.reference(
            &worktree_branch_ref,
            branch_oid,
            true,
            "Import worktree changes",
        )?;

        // Now merge the branch into main
        let main_branch_commit = main_repo
            .reference_to_annotated_commit(&main_repo.find_reference(&main_branch_ref)?)?;
        let worktree_branch_commit = main_repo
            .reference_to_annotated_commit(&main_repo.find_reference(&worktree_branch_ref)?)?;

        // Perform the merge
        let mut merge_opts = git2::MergeOptions::new();
        merge_opts.file_favor(git2::FileFavor::Theirs); // Prefer worktree changes in conflicts

        let mut checkout_opts = git2::build::CheckoutBuilder::new();
        checkout_opts.conflict_style_merge(true);

        main_repo.merge(
            &[&worktree_branch_commit],
            Some(&mut merge_opts),
            Some(&mut checkout_opts),
        )?;

        // Check if merge was successful (no conflicts)
        let merge_head_path = main_repo.path().join("MERGE_HEAD");
        if merge_head_path.exists() {
            // Complete the merge by creating a merge commit
            let mut index = main_repo.index()?;
            let tree_id = index.write_tree()?;
            let tree = main_repo.find_tree(tree_id)?;

            let main_commit = main_repo.find_commit(main_branch_commit.id())?;
            let worktree_commit = main_repo.find_commit(worktree_branch_commit.id())?;

            let merge_commit_message =
                format!("Merge task attempt {} into {}", attempt_id, main_branch);
            let merge_commit_id = main_repo.commit(
                Some(&main_branch_ref),
                &signature,
                &signature,
                &merge_commit_message,
                &tree,
                &[&main_commit, &worktree_commit],
            )?;

            // Clean up merge state
            main_repo.cleanup_state()?;

            Ok(merge_commit_id.to_string())
        } else {
            // Fast-forward merge completed
            let head_commit = main_repo.head()?.peel_to_commit()?;
            let merge_commit_id = head_commit.id();

            Ok(merge_commit_id.to_string())
        }
    }

    /// Merge the worktree changes back to the main repository
    pub async fn merge_changes(
        pool: &PgPool,
        attempt_id: Uuid,
        task_id: Uuid,
        project_id: Uuid,
    ) -> Result<String, TaskAttemptError> {
        // Get the task attempt with validation
        let attempt = sqlx::query_as!(
            TaskAttempt,
            r#"SELECT ta.id, ta.task_id, ta.worktree_path, ta.base_commit, ta.merge_commit, ta.executor, ta.stdout, ta.stderr, ta.created_at, ta.updated_at 
               FROM task_attempts ta 
               JOIN tasks t ON ta.task_id = t.id 
               WHERE ta.id = $1 AND t.id = $2 AND t.project_id = $3"#,
            attempt_id,
            task_id,
            project_id
        )
        .fetch_optional(pool)
        .await?
        .ok_or(TaskAttemptError::TaskNotFound)?;

        // Get the task and project
        let _task = Task::find_by_id(pool, task_id)
            .await?
            .ok_or(TaskAttemptError::TaskNotFound)?;

        let project = Project::find_by_id(pool, project_id)
            .await?
            .ok_or(TaskAttemptError::ProjectNotFound)?;

        // Perform the git merge operations (synchronous)
        let merge_commit_id = Self::perform_merge_operation(
            &attempt.worktree_path,
            &project.git_repo_path,
            attempt_id,
        )?;

        // Update the task attempt with the merge commit
        sqlx::query!(
            "UPDATE task_attempts SET merge_commit = $1, updated_at = NOW() WHERE id = $2",
            merge_commit_id,
            attempt_id
        )
        .execute(pool)
        .await?;

        Ok(merge_commit_id)
    }

    /// Get the git diff between the base commit and the current worktree state
    pub async fn get_diff(
        pool: &PgPool,
        attempt_id: Uuid,
        task_id: Uuid,
        project_id: Uuid,
    ) -> Result<WorktreeDiff, TaskAttemptError> {
        // Get the task attempt with validation
        let attempt = sqlx::query_as!(
            TaskAttempt,
            r#"SELECT ta.id, ta.task_id, ta.worktree_path, ta.base_commit, ta.merge_commit, ta.executor, ta.stdout, ta.stderr, ta.created_at, ta.updated_at 
               FROM task_attempts ta 
               JOIN tasks t ON ta.task_id = t.id 
               WHERE ta.id = $1 AND t.id = $2 AND t.project_id = $3"#,
            attempt_id,
            task_id,
            project_id
        )
        .fetch_optional(pool)
        .await?
        .ok_or(TaskAttemptError::TaskNotFound)?;

        // Get the project to access the main repository
        let _task = Task::find_by_id(pool, task_id)
            .await?
            .ok_or(TaskAttemptError::TaskNotFound)?;

        let _project = Project::find_by_id(pool, project_id)
            .await?
            .ok_or(TaskAttemptError::ProjectNotFound)?;

        // Open the worktree repository
        let worktree_repo = Repository::open(&attempt.worktree_path)?;

        // Get the base commit
        let base_commit_str = attempt
            .base_commit
            .ok_or_else(|| TaskAttemptError::Git(GitError::from_str("No base commit found")))?;

        let base_oid =
            git2::Oid::from_str(&base_commit_str).map_err(|e| TaskAttemptError::Git(e))?;

        let base_commit = worktree_repo.find_commit(base_oid)?;
        let base_tree = base_commit.tree()?;

        // Get status of all files in the worktree
        let statuses = worktree_repo.statuses(None)?;
        let mut files = Vec::new();

        for status_entry in statuses.iter() {
            if let Some(path_str) = status_entry.path() {
                let path = std::path::Path::new(path_str);
                let full_path = std::path::Path::new(&attempt.worktree_path).join(path);

                // Get old content from base commit
                let old_content = match base_tree.get_path(path) {
                    Ok(entry) => match entry.to_object(&worktree_repo) {
                        Ok(obj) => {
                            if let Some(blob) = obj.as_blob() {
                                String::from_utf8_lossy(blob.content()).to_string()
                            } else {
                                String::new()
                            }
                        }
                        Err(_) => String::new(),
                    },
                    Err(_) => String::new(), // File didn't exist in base commit
                };

                // Get new content from working directory
                let new_content = std::fs::read_to_string(&full_path).unwrap_or_default();

                // Generate diff chunks using dissimilar
                if old_content != new_content {
                    let chunks = dissimilar::diff(&old_content, &new_content);
                    let mut diff_chunks = Vec::new();

                    for chunk in chunks {
                        let diff_chunk = match chunk {
                            dissimilar::Chunk::Equal(text) => DiffChunk {
                                chunk_type: DiffChunkType::Equal,
                                content: text.to_string(),
                            },
                            dissimilar::Chunk::Delete(text) => DiffChunk {
                                chunk_type: DiffChunkType::Delete,
                                content: text.to_string(),
                            },
                            dissimilar::Chunk::Insert(text) => DiffChunk {
                                chunk_type: DiffChunkType::Insert,
                                content: text.to_string(),
                            },
                        };
                        diff_chunks.push(diff_chunk);
                    }

                    files.push(FileDiff {
                        path: path_str.to_string(),
                        chunks: diff_chunks,
                    });
                }
            }
        }

        Ok(WorktreeDiff { files })
    }
}
