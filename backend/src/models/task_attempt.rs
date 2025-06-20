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
use crate::app_state::ExecutionType;
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
    pub executor: Option<String>, // Name of the executor to use
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
    // Currently no updateable fields, but keeping struct for API compatibility
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
            r#"SELECT id as "id!: Uuid", task_id as "task_id!: Uuid", worktree_path, merge_commit, executor, created_at as "created_at!: DateTime<Utc>", updated_at as "updated_at!: DateTime<Utc>"
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
            r#"SELECT id as "id!: Uuid", task_id as "task_id!: Uuid", worktree_path, merge_commit, executor, created_at as "created_at!: DateTime<Utc>", updated_at as "updated_at!: DateTime<Utc>"
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
            r#"INSERT INTO task_attempts (id, task_id, worktree_path, merge_commit, executor) 
               VALUES ($1, $2, $3, $4, $5) 
               RETURNING id as "id!: Uuid", task_id as "task_id!: Uuid", worktree_path, merge_commit, executor, created_at as "created_at!: DateTime<Utc>", updated_at as "updated_at!: DateTime<Utc>""#,
            attempt_id,
            data.task_id,
            data.worktree_path,
            data.merge_commit,
            data.executor
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

    /// Perform the actual git merge operations (synchronous)
    fn perform_merge_operation(
        worktree_path: &str,
        main_repo_path: &str,
        attempt_id: Uuid,
        task_title: &str,
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
            worktree_repo.odb()?.read(final_commit)?.data(),
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

            let merge_commit_message = format!("Merge task: {} into {}", task_title, main_branch);
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
            r#"SELECT ta.id as "id!: Uuid", ta.task_id as "task_id!: Uuid", ta.worktree_path, ta.merge_commit, ta.executor, ta.created_at as "created_at!: DateTime<Utc>", ta.updated_at as "updated_at!: DateTime<Utc>"
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
        let task = Task::find_by_id(pool, task_id)
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
            &task.title,
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
        app_state: &crate::app_state::AppState,
        attempt_id: Uuid,
        task_id: Uuid,
        project_id: Uuid,
    ) -> Result<(), TaskAttemptError> {
        use crate::models::execution_process::{
            CreateExecutionProcess, ExecutionProcess, ExecutionProcessType,
        };
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

                // Create execution process record for setup script
                let setup_process_id = Uuid::new_v4();
                let create_setup_process = CreateExecutionProcess {
                    task_attempt_id: attempt_id,
                    process_type: ExecutionProcessType::SetupScript,
                    command: "bash".to_string(),
                    args: Some(serde_json::to_string(&["-c", setup_script]).unwrap()),
                    working_directory: task_attempt.worktree_path.clone(),
                };

                let _setup_process =
                    ExecutionProcess::create(pool, &create_setup_process, setup_process_id).await?;

                tracing::info!("Running setup script for task attempt {}", attempt_id);

                // Start setup script as streaming process
                let child = tokio::process::Command::new("bash")
                    .arg("-c")
                    .arg(setup_script)
                    .current_dir(&task_attempt.worktree_path)
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
                    .map_err(|e| {
                        TaskAttemptError::Git(git2::Error::from_str(&format!(
                            "Failed to execute setup script: {}",
                            e
                        )))
                    })?;

                // Add setup script to running executions for monitoring
                app_state
                    .add_running_execution(
                        setup_process_id,
                        crate::app_state::RunningExecution {
                            task_attempt_id: attempt_id,
                            execution_type: ExecutionType::SetupScript,
                            child,
                        },
                    )
                    .await;

                tracing::info!(
                    "Started setup script execution {} for task attempt {}",
                    setup_process_id,
                    attempt_id
                );

                // Wait for setup script to complete before starting executor
                // We'll let the execution monitor handle the completion and then start the executor
                return Ok(());
            }
        }

        // If no setup script, start executor directly
        Self::start_coding_agent(pool, app_state, attempt_id, task_id, project_id).await
    }

    /// Start the coding agent after setup is complete or if no setup is needed
    pub async fn start_coding_agent(
        pool: &SqlitePool,
        app_state: &crate::app_state::AppState,
        attempt_id: Uuid,
        task_id: Uuid,
        _project_id: Uuid,
    ) -> Result<(), TaskAttemptError> {
        use crate::models::execution_process::{
            CreateExecutionProcess, ExecutionProcess, ExecutionProcessType,
        };
        use crate::models::task_attempt_activity::{
            CreateTaskAttemptActivity, TaskAttemptActivity,
        };

        // Get the task attempt
        let task_attempt = TaskAttempt::find_by_id(pool, attempt_id)
            .await?
            .ok_or(TaskAttemptError::TaskNotFound)?;

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

        // Create execution process record for coding agent
        let agent_process_id = Uuid::new_v4();
        let create_agent_process = CreateExecutionProcess {
            task_attempt_id: attempt_id,
            process_type: ExecutionProcessType::CodingAgent,
            command: "executor".to_string(), // This will be the actual executor command
            args: None, // Executor-specific args will be handled by the executor itself
            working_directory: task_attempt.worktree_path.clone(),
        };

        let _agent_process =
            ExecutionProcess::create(pool, &create_agent_process, agent_process_id).await?;

        let child = executor
            .execute_streaming(
                pool,
                task_id,
                attempt_id,
                agent_process_id,
                &task_attempt.worktree_path,
            )
            .await
            .map_err(|e| TaskAttemptError::Git(git2::Error::from_str(&e.to_string())))?;

        // Add to running executions
        app_state
            .add_running_execution(
                agent_process_id,
                crate::app_state::RunningExecution {
                    task_attempt_id: attempt_id,
                    execution_type: ExecutionType::CodingAgent,
                    child,
                },
            )
            .await;

        tracing::info!(
            "Started execution {} for task attempt {}",
            agent_process_id,
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
            r#"SELECT ta.id as "id!: Uuid", ta.task_id as "task_id!: Uuid", ta.worktree_path, ta.merge_commit, ta.executor, ta.created_at as "created_at!: DateTime<Utc>", ta.updated_at as "updated_at!: DateTime<Utc>"
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

                    // Generate line-based diff chunks
                    if old_content != new_content {
                        let diff_chunks =
                            Self::generate_line_based_diff(&old_content, &new_content);

                        if !diff_chunks.is_empty() {
                            files.push(FileDiff {
                                path: path_str.to_string(),
                                chunks: diff_chunks,
                            });
                        }
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

    /// Generate line-based diff chunks for better display
    pub fn generate_line_based_diff(old_content: &str, new_content: &str) -> Vec<DiffChunk> {
        let old_lines: Vec<&str> = old_content.lines().collect();
        let new_lines: Vec<&str> = new_content.lines().collect();
        let mut chunks = Vec::new();

        // Use a simple line-by-line comparison algorithm
        let mut old_idx = 0;
        let mut new_idx = 0;

        while old_idx < old_lines.len() || new_idx < new_lines.len() {
            if old_idx < old_lines.len() && new_idx < new_lines.len() {
                let old_line = old_lines[old_idx];
                let new_line = new_lines[new_idx];

                if old_line == new_line {
                    // Lines are identical
                    chunks.push(DiffChunk {
                        chunk_type: DiffChunkType::Equal,
                        content: format!("{}\n", old_line),
                    });
                    old_idx += 1;
                    new_idx += 1;
                } else {
                    // Lines are different - look ahead to see if this is a modification, insertion, or deletion
                    let mut found_match = false;

                    // Check if the new line appears later in old lines (deletion)
                    for look_ahead in (old_idx + 1)..std::cmp::min(old_idx + 5, old_lines.len()) {
                        if old_lines[look_ahead] == new_line {
                            // Found the new line later in old, so old_line was deleted
                            chunks.push(DiffChunk {
                                chunk_type: DiffChunkType::Delete,
                                content: format!("{}\n", old_line),
                            });
                            old_idx += 1;
                            found_match = true;
                            break;
                        }
                    }

                    if !found_match {
                        // Check if the old line appears later in new lines (insertion)
                        for look_ahead in (new_idx + 1)..std::cmp::min(new_idx + 5, new_lines.len())
                        {
                            if new_lines[look_ahead] == old_line {
                                // Found the old line later in new, so new_line was inserted
                                chunks.push(DiffChunk {
                                    chunk_type: DiffChunkType::Insert,
                                    content: format!("{}\n", new_line),
                                });
                                new_idx += 1;
                                found_match = true;
                                break;
                            }
                        }
                    }

                    if !found_match {
                        // Lines are different - collect consecutive changes to group them
                        let change_start_old = old_idx;
                        let change_start_new = new_idx;

                        // Find the end of the change block by looking for the next matching section
                        let mut next_match_old = old_lines.len();
                        let mut next_match_new = new_lines.len();

                        // Look for the next sequence of matching lines (at least 2 consecutive matches)
                        for search_old in (old_idx + 1)..old_lines.len() {
                            for search_new in (new_idx + 1)..new_lines.len() {
                                if search_old < old_lines.len() - 1
                                    && search_new < new_lines.len() - 1
                                {
                                    // Check for at least 2 consecutive matching lines to confirm this is not a coincidental match
                                    if old_lines[search_old] == new_lines[search_new]
                                        && old_lines[search_old + 1] == new_lines[search_new + 1]
                                    {
                                        next_match_old = search_old;
                                        next_match_new = search_new;
                                        break;
                                    }
                                } else if search_old == old_lines.len() - 1
                                    && search_new == new_lines.len() - 1
                                {
                                    // Last lines match
                                    if old_lines[search_old] == new_lines[search_new] {
                                        next_match_old = search_old;
                                        next_match_new = search_new;
                                        break;
                                    }
                                }
                            }
                            if next_match_old < old_lines.len() {
                                break;
                            }
                        }

                        let change_end_old = next_match_old;
                        let change_end_new = next_match_new;

                        // Create grouped delete chunk if there are lines to delete
                        if change_end_old > change_start_old {
                            let delete_content = old_lines[change_start_old..change_end_old]
                                .iter()
                                .map(|line| format!("{}\n", line))
                                .collect::<String>();
                            chunks.push(DiffChunk {
                                chunk_type: DiffChunkType::Delete,
                                content: delete_content,
                            });
                        }

                        // Create grouped insert chunk if there are lines to insert
                        if change_end_new > change_start_new {
                            let insert_content = new_lines[change_start_new..change_end_new]
                                .iter()
                                .map(|line| format!("{}\n", line))
                                .collect::<String>();
                            chunks.push(DiffChunk {
                                chunk_type: DiffChunkType::Insert,
                                content: insert_content,
                            });
                        }

                        old_idx = change_end_old;
                        new_idx = change_end_new;
                    }
                }
            } else if old_idx < old_lines.len() {
                // Remaining old lines (deletions) - group them together
                let remaining_content = old_lines[old_idx..]
                    .iter()
                    .map(|line| format!("{}\n", line))
                    .collect::<String>();
                chunks.push(DiffChunk {
                    chunk_type: DiffChunkType::Delete,
                    content: remaining_content,
                });
                old_idx = old_lines.len();
            } else {
                // Remaining new lines (insertions) - group them together
                let remaining_content = new_lines[new_idx..]
                    .iter()
                    .map(|line| format!("{}\n", line))
                    .collect::<String>();
                chunks.push(DiffChunk {
                    chunk_type: DiffChunkType::Insert,
                    content: remaining_content,
                });
                new_idx = new_lines.len();
            }
        }

        chunks
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
            r#"SELECT ta.id as "id!: Uuid", ta.task_id as "task_id!: Uuid", ta.worktree_path, ta.merge_commit, ta.executor, ta.created_at as "created_at!: DateTime<Utc>", ta.updated_at as "updated_at!: DateTime<Utc>"
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
                Ok(_op) => {
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
        let _final_oid = repo.head()?.peel_to_commit()?.id();

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
            r#"SELECT ta.id as "id!: Uuid", ta.task_id as "task_id!: Uuid", ta.worktree_path, ta.merge_commit, ta.executor, ta.created_at as "created_at!: DateTime<Utc>", ta.updated_at as "updated_at!: DateTime<Utc>"
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

    /// Delete a file from the worktree and commit the change
    pub async fn delete_file(
        pool: &SqlitePool,
        attempt_id: Uuid,
        task_id: Uuid,
        project_id: Uuid,
        file_path: &str,
    ) -> Result<String, TaskAttemptError> {
        // Get the task attempt with validation
        let attempt = sqlx::query_as!(
            TaskAttempt,
            r#"SELECT ta.id as "id!: Uuid", ta.task_id as "task_id!: Uuid", ta.worktree_path, ta.merge_commit, ta.executor, ta.created_at as "created_at!: DateTime<Utc>", ta.updated_at as "updated_at!: DateTime<Utc>"
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

        // Open the worktree repository
        let repo = Repository::open(&attempt.worktree_path)?;

        // Get the absolute path to the file within the worktree
        let worktree_path = Path::new(&attempt.worktree_path);
        let file_full_path = worktree_path.join(file_path);

        // Check if file exists and delete it
        if file_full_path.exists() {
            std::fs::remove_file(&file_full_path).map_err(|e| {
                TaskAttemptError::Git(GitError::from_str(&format!(
                    "Failed to delete file {}: {}",
                    file_path, e
                )))
            })?;

            debug!("Deleted file: {}", file_path);
        } else {
            info!("File {} does not exist, skipping deletion", file_path);
        }

        // Stage the deletion
        let mut index = repo.index()?;
        index.remove_path(Path::new(file_path))?;
        index.write()?;

        // Create a commit for the file deletion
        let signature = repo.signature()?;
        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;

        // Get the current HEAD commit
        let head = repo.head()?;
        let parent_commit = head.peel_to_commit()?;

        let commit_message = format!("Delete file: {}", file_path);
        let commit_id = repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &commit_message,
            &tree,
            &[&parent_commit],
        )?;

        info!("File {} deleted and committed: {}", file_path, commit_id);

        Ok(commit_id.to_string())
    }
}
