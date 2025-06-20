use anyhow::anyhow;
use chrono::{DateTime, Utc};
use git2::build::CheckoutBuilder;
use git2::{Error as GitError, MergeOptions, Oid, RebaseOptions, Repository};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use std::path::Path;
use tracing::{debug, error, info};
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
    GitOutOfSync(anyhow::Error),
}

impl std::fmt::Display for TaskAttemptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskAttemptError::Database(e) => write!(f, "Database error: {}", e),
            TaskAttemptError::Git(e) => write!(f, "Git error: {}", e),
            TaskAttemptError::TaskNotFound => write!(f, "Task not found"),
            TaskAttemptError::ProjectNotFound => write!(f, "Project not found"),
            TaskAttemptError::GitOutOfSync(e) => write!(f, "Git out of sync: {}", e),
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
    SetupRunning,
    SetupComplete,
    SetupFailed,
    ExecutorRunning,
    ExecutorComplete,
    ExecutorFailed,
    Paused,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskAttempt {
    pub id: Uuid,
    pub task_id: Uuid, // Foreign key to Task
    pub worktree_path: String,
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
    pub merge_commit: Option<String>,
    pub executor: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateTaskAttempt {
    pub worktree_path: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BranchStatus {
    pub is_behind: bool,
    pub commits_behind: usize,
    pub commits_ahead: usize,
    pub up_to_date: bool,
    pub merged: bool,
}

impl TaskAttempt {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            TaskAttempt,
            r#"SELECT id as "id!: Uuid", task_id as "task_id!: Uuid", worktree_path, merge_commit, executor, stdout, stderr, created_at as "created_at!: DateTime<Utc>", updated_at as "updated_at!: DateTime<Utc>"
               FROM task_attempts 
               WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_task_id(
        pool: &SqlitePool,
        task_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            TaskAttempt,
            r#"SELECT id as "id!: Uuid", task_id as "task_id!: Uuid", worktree_path, merge_commit, executor, stdout, stderr, created_at as "created_at!: DateTime<Utc>", updated_at as "updated_at!: DateTime<Utc>"
               FROM task_attempts 
               WHERE task_id = $1 
               ORDER BY created_at DESC"#,
            task_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
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

        // We no longer store base_commit in the database - it's retrieved live via git2

        // Create the worktree directory if it doesn't exist
        if let Some(parent) = worktree_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| TaskAttemptError::Git(GitError::from_str(&e.to_string())))?;
        }

        // Create the worktree at the specified path
        let branch_name = format!("attempt-{}", attempt_id);
        repo.worktree(&branch_name, worktree_path, None)?;

        // Insert the record into the database
        Ok(sqlx::query_as!(
            TaskAttempt,
            r#"INSERT INTO task_attempts (id, task_id, worktree_path, merge_commit, executor, stdout, stderr) 
               VALUES ($1, $2, $3, $4, $5, $6, $7) 
               RETURNING id as "id!: Uuid", task_id as "task_id!: Uuid", worktree_path, merge_commit, executor, stdout, stderr, created_at as "created_at!: DateTime<Utc>", updated_at as "updated_at!: DateTime<Utc>""#,
            attempt_id,
            data.task_id,
            data.worktree_path,
            data.merge_commit,
            data.executor,
            None::<String>, // stdout
            None::<String>  // stderr
        )
        .fetch_one(pool)
        .await?)
    }

    pub async fn exists_for_task(
        pool: &SqlitePool,
        attempt_id: Uuid,
        task_id: Uuid,
        project_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query!(
            "SELECT ta.id as \"id!: Uuid\" FROM task_attempts ta 
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
                "amp" => ExecutorConfig::Amp.create_executor(),
                _ => ExecutorConfig::Echo.create_executor(), // Default fallback
            }
        } else {
            // Default to echo executor
            ExecutorConfig::Echo.create_executor()
        }
    }

    /// Update stdout and stderr for this task attempt
    pub async fn update_output(
        pool: &SqlitePool,
        id: Uuid,
        stdout: Option<&str>,
        stderr: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE task_attempts SET stdout = $1, stderr = $2, updated_at = datetime('now') WHERE id = $3",
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
        pool: &SqlitePool,
        id: Uuid,
        stdout_append: Option<&str>,
        stderr_append: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        if let Some(stdout_data) = stdout_append {
            sqlx::query!(
                "UPDATE task_attempts SET stdout = COALESCE(stdout, '') || $1, updated_at = datetime('now') WHERE id = $2",
                stdout_data,
                id
            )
            .execute(pool)
            .await?;
        }

        if let Some(stderr_data) = stderr_append {
            sqlx::query!(
                "UPDATE task_attempts SET stderr = COALESCE(stderr, '') || $1, updated_at = datetime('now') WHERE id = $2",
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

        // Get the current HEAD commit in the worktree (changes should already be committed by execution monitor)
        let head = worktree_repo.head()?;
        let parent_commit = head.peel_to_commit()?;
        let final_commit = parent_commit.id();

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
        pool: &SqlitePool,
        attempt_id: Uuid,
        task_id: Uuid,
        project_id: Uuid,
    ) -> Result<String, TaskAttemptError> {
        // Get the task attempt with validation
        let attempt = sqlx::query_as!(
            TaskAttempt,
            r#"SELECT ta.id as "id!: Uuid", ta.task_id as "task_id!: Uuid", ta.worktree_path, ta.merge_commit, ta.executor, ta.stdout, ta.stderr, ta.created_at as "created_at!: DateTime<Utc>", ta.updated_at as "updated_at!: DateTime<Utc>"
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
            "UPDATE task_attempts SET merge_commit = $1, updated_at = datetime('now') WHERE id = $2",
            merge_commit_id,
            attempt_id
        )
        .execute(pool)
        .await?;

        Ok(merge_commit_id)
    }

    /// Start the execution flow for a task attempt (setup script + executor)
    pub async fn start_execution(
        pool: &SqlitePool,
        app_state: &crate::execution_monitor::AppState,
        attempt_id: Uuid,
        task_id: Uuid,
        project_id: Uuid,
    ) -> Result<(), TaskAttemptError> {
        use crate::models::project::Project;
        use crate::models::task::{Task, TaskStatus};
        use crate::models::task_attempt_activity::{
            CreateTaskAttemptActivity, TaskAttemptActivity,
        };

        // Get the task attempt, task, and project
        let task_attempt = TaskAttempt::find_by_id(pool, attempt_id)
            .await?
            .ok_or(TaskAttemptError::TaskNotFound)?;

        let _task = Task::find_by_id(pool, task_id)
            .await?
            .ok_or(TaskAttemptError::TaskNotFound)?;

        let project = Project::find_by_id(pool, project_id)
            .await?
            .ok_or(TaskAttemptError::ProjectNotFound)?;

        // Update task status to InProgress at the start of execution (during setup)
        Task::update_status(pool, task_id, project_id, TaskStatus::InProgress).await?;

        // Step 1: Run setup script if it exists
        if let Some(setup_script) = &project.setup_script {
            if !setup_script.trim().is_empty() {
                // Create activity for setup script start
                let activity_id = Uuid::new_v4();
                let create_activity = CreateTaskAttemptActivity {
                    task_attempt_id: attempt_id,
                    status: Some(TaskAttemptStatus::SetupRunning),
                    note: Some("Starting setup script".to_string()),
                };

                TaskAttemptActivity::create(
                    pool,
                    &create_activity,
                    activity_id,
                    TaskAttemptStatus::SetupRunning,
                )
                .await?;

                tracing::info!("Running setup script for task attempt {}", attempt_id);

                let output = tokio::process::Command::new("bash")
                    .arg("-c")
                    .arg(setup_script)
                    .current_dir(&task_attempt.worktree_path)
                    .output()
                    .await
                    .map_err(|e| {
                        TaskAttemptError::Git(git2::Error::from_str(&format!(
                            "Failed to execute setup script: {}",
                            e
                        )))
                    })?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    tracing::error!("Setup script failed for attempt {}: {}", attempt_id, stderr);

                    // Create activity for setup script failure
                    let activity_id = Uuid::new_v4();
                    let create_activity = CreateTaskAttemptActivity {
                        task_attempt_id: attempt_id,
                        status: Some(TaskAttemptStatus::SetupFailed),
                        note: Some(format!("Setup script failed: {}", stderr)),
                    };

                    TaskAttemptActivity::create(
                        pool,
                        &create_activity,
                        activity_id,
                        TaskAttemptStatus::SetupFailed,
                    )
                    .await?;

                    // Update task status to InReview
                    Task::update_status(pool, task_id, project_id, TaskStatus::InReview).await?;

                    return Err(TaskAttemptError::Git(git2::Error::from_str(&format!(
                        "Setup script failed: {}",
                        stderr
                    ))));
                }

                let stdout = String::from_utf8_lossy(&output.stdout);
                tracing::info!(
                    "Setup script completed for attempt {}: {}",
                    attempt_id,
                    stdout
                );

                // Create activity for setup script completion
                let activity_id = Uuid::new_v4();
                let create_activity = CreateTaskAttemptActivity {
                    task_attempt_id: attempt_id,
                    status: Some(TaskAttemptStatus::SetupComplete),
                    note: Some("Setup script completed successfully".to_string()),
                };

                TaskAttemptActivity::create(
                    pool,
                    &create_activity,
                    activity_id,
                    TaskAttemptStatus::SetupComplete,
                )
                .await?;
            }
        }

        // Step 2: Start the executor
        let executor = task_attempt.get_executor();

        // Create activity for executor start
        let activity_id = Uuid::new_v4();
        let create_activity = CreateTaskAttemptActivity {
            task_attempt_id: attempt_id,
            status: Some(TaskAttemptStatus::ExecutorRunning),
            note: Some("Starting executor".to_string()),
        };

        TaskAttemptActivity::create(
            pool,
            &create_activity,
            activity_id,
            TaskAttemptStatus::ExecutorRunning,
        )
        .await?;

        let child = executor
            .execute_streaming(pool, task_id, attempt_id, &task_attempt.worktree_path)
            .await
            .map_err(|e| TaskAttemptError::Git(git2::Error::from_str(&e.to_string())))?;

        // Add to running executions
        let execution_id = Uuid::new_v4();
        {
            let mut executions = app_state.running_executions.lock().await;
            executions.insert(
                execution_id,
                crate::execution_monitor::RunningExecution {
                    task_attempt_id: attempt_id,
                    child,
                    started_at: chrono::Utc::now(),
                },
            );
        }

        tracing::info!(
            "Started execution {} for task attempt {}",
            execution_id,
            attempt_id
        );

        Ok(())
    }

    /// Get the git diff between the base commit and the current committed worktree state
    pub async fn get_diff(
        pool: &SqlitePool,
        attempt_id: Uuid,
        task_id: Uuid,
        project_id: Uuid,
    ) -> Result<WorktreeDiff, TaskAttemptError> {
        // Get the task attempt with validation
        let attempt = sqlx::query_as!(
            TaskAttempt,
            r#"SELECT ta.id as "id!: Uuid", ta.task_id as "task_id!: Uuid", ta.worktree_path, ta.merge_commit, ta.executor, ta.stdout, ta.stderr, ta.created_at as "created_at!: DateTime<Utc>", ta.updated_at as "updated_at!: DateTime<Utc>"
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

        // Get the project to access the main repository for base commit
        let project = Project::find_by_id(pool, project_id)
            .await?
            .ok_or(TaskAttemptError::ProjectNotFound)?;

        // Get the base commit from the main repository (live data)
        let main_repo = Repository::open(&project.git_repo_path)?;
        let base_oid = main_repo.head()?.peel_to_commit()?.id();
        let base_commit = worktree_repo.find_commit(base_oid)?;
        let base_tree = base_commit.tree()?;

        // Get the current HEAD commit in the worktree
        let head = worktree_repo.head()?;
        let current_commit = head.peel_to_commit()?;
        let current_tree = current_commit.tree()?;

        // Create a diff between the base tree and current tree
        let diff = worktree_repo.diff_tree_to_tree(Some(&base_tree), Some(&current_tree), None)?;

        let mut files = Vec::new();

        // Process each diff delta (file change)
        diff.foreach(
            &mut |delta, _progress| {
                if let Some(path_str) = delta.new_file().path().and_then(|p| p.to_str()) {
                    let old_file = delta.old_file();
                    let new_file = delta.new_file();

                    // Get old content
                    let old_content = if !old_file.id().is_zero() {
                        match worktree_repo.find_blob(old_file.id()) {
                            Ok(blob) => String::from_utf8_lossy(blob.content()).to_string(),
                            Err(_) => String::new(),
                        }
                    } else {
                        String::new() // File didn't exist in base commit
                    };

                    // Get new content
                    let new_content = if !new_file.id().is_zero() {
                        match worktree_repo.find_blob(new_file.id()) {
                            Ok(blob) => String::from_utf8_lossy(blob.content()).to_string(),
                            Err(_) => String::new(),
                        }
                    } else {
                        String::new() // File was deleted
                    };

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
                true // Continue processing
            },
            None,
            None,
            None,
        )?;

        Ok(WorktreeDiff { files })
    }

    /// Get the branch status for this task attempt (ahead/behind main)
    pub async fn get_branch_status(
        pool: &SqlitePool,
        attempt_id: Uuid,
        task_id: Uuid,
        project_id: Uuid,
    ) -> Result<BranchStatus, TaskAttemptError> {
        // Get the task attempt with validation
        let attempt = sqlx::query_as!(
            TaskAttempt,
            r#"SELECT ta.id as "id!: Uuid", ta.task_id as "task_id!: Uuid", ta.worktree_path, ta.merge_commit, ta.executor, ta.stdout, ta.stderr, ta.created_at as "created_at!: DateTime<Utc>", ta.updated_at as "updated_at!: DateTime<Utc>"
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

        // Get the project
        let project = Project::find_by_id(pool, project_id)
            .await?
            .ok_or(TaskAttemptError::ProjectNotFound)?;

        // Open the main repository
        let main_repo = Repository::open(&project.git_repo_path)?;

        // Open the worktree repository
        let worktree_repo = Repository::open(&attempt.worktree_path)?;

        // Get the current HEAD of main branch in the main repo
        let main_head = main_repo.head()?.peel_to_commit()?;
        let main_oid = main_head.id();

        // Get the current HEAD of the worktree
        let worktree_head = worktree_repo.head()?.peel_to_commit()?;
        let worktree_oid = worktree_head.id();

        if main_oid == worktree_oid {
            // Branches are at the same commit
            return Ok(BranchStatus {
                is_behind: false,
                commits_behind: 0,
                commits_ahead: 0,
                up_to_date: true,
                merged: attempt.merge_commit.is_some(),
            });
        }

        // Count commits ahead/behind
        let mut revwalk = main_repo.revwalk()?;

        // Count commits behind (main has commits that worktree doesn't)
        revwalk.push(main_oid)?;
        revwalk.hide(worktree_oid)?;
        let commits_behind = revwalk.count();

        // Count commits ahead (worktree has commits that main doesn't)
        let mut revwalk = main_repo.revwalk()?;
        revwalk.push(worktree_oid)?;
        revwalk.hide(main_oid)?;
        let commits_ahead = revwalk.count();

        Ok(BranchStatus {
            is_behind: commits_behind > 0,
            commits_behind,
            commits_ahead,
            up_to_date: commits_behind == 0 && commits_ahead == 0,
            merged: attempt.merge_commit.is_some(),
        })
    }

    /// Perform the actual git rebase operations (synchronous)
    fn perform_rebase_operation(
        worktree_path: &str,
        main_repo_path: &str,
    ) -> Result<String, TaskAttemptError> {
        let main_repo = Repository::open(main_repo_path)?;
        let repo = Repository::open(worktree_path)?;

        // 1️⃣ get main HEAD oid
        let main_oid = main_repo.head()?.peel_to_commit()?.id();

        // 2️⃣ early exit if up-to-date
        let orig_oid = repo.head()?.peel_to_commit()?.id();
        if orig_oid == main_oid {
            return Ok(orig_oid.to_string());
        }

        // 3️⃣ prepare upstream
        let main_annot = repo.find_annotated_commit(main_oid)?;

        // 4️⃣ set up in-memory rebase
        let mut opts = RebaseOptions::new();
        opts.inmemory(true).merge_options(MergeOptions::new());

        // 5️⃣ start rebase of HEAD onto main
        let mut reb = repo.rebase(None, Some(&main_annot), None, Some(&mut opts))?;

        // 6️⃣ replay commits, remember last OID
        let sig = repo.signature()?;
        let mut last_oid: Option<Oid> = None;
        while let Some(res) = reb.next() {
            match res {
                Ok(op) => {
                    let new_oid = reb.commit(None, &sig, None)?;
                    last_oid = Some(new_oid);
                }
                Err(e) => {
                    error!("rebase op failed: {}", e);
                    reb.abort()?;
                    return Err(TaskAttemptError::Git(e));
                }
            }
        }

        // 7️⃣ finish (still in-memory)
        reb.finish(Some(&sig))?;

        // 8️⃣ repoint your branch ref (HEAD is a symbolic to this ref)
        if let Some(target) = last_oid {
            let head_ref = repo.head()?; // symbolic HEAD
            let branch_name = head_ref.name().unwrap(); // e.g. "refs/heads/feature"
            let mut r = repo.find_reference(branch_name)?;
            r.set_target(target, "rebase: update branch")?;
        }

        // 9️⃣ update working tree
        repo.checkout_head(Some(CheckoutBuilder::new().force()))?;

        // 🔟 final check
        let final_oid = repo.head()?.peel_to_commit()?.id();

        Ok(main_oid.to_string())
    }

    /// Rebase the worktree branch onto main
    pub async fn rebase_onto_main(
        pool: &SqlitePool,
        attempt_id: Uuid,
        task_id: Uuid,
        project_id: Uuid,
    ) -> Result<String, TaskAttemptError> {
        // Get the task attempt with validation
        let attempt = sqlx::query_as!(
            TaskAttempt,
            r#"SELECT ta.id as "id!: Uuid", ta.task_id as "task_id!: Uuid", ta.worktree_path, ta.merge_commit, ta.executor, ta.stdout, ta.stderr, ta.created_at as "created_at!: DateTime<Utc>", ta.updated_at as "updated_at!: DateTime<Utc>"
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

        // Get the project
        let project = Project::find_by_id(pool, project_id)
            .await?
            .ok_or(TaskAttemptError::ProjectNotFound)?;

        // Perform the git rebase operations (synchronous)
        let new_base_commit =
            Self::perform_rebase_operation(&attempt.worktree_path, &project.git_repo_path)?;

        // No need to update database as we now get base_commit live from git
        Ok(new_base_commit)
    }
}
