use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex, RwLock},
};

static WORKSPACE_DIR_OVERRIDE: LazyLock<RwLock<Option<PathBuf>>> =
    LazyLock::new(|| RwLock::new(None));
static SESSION_WORKTREE_DIR_OVERRIDE: LazyLock<RwLock<Option<PathBuf>>> =
    LazyLock::new(|| RwLock::new(None));

use git::{GitService, GitServiceError};
use git2::{Error as GitError, Repository};
use thiserror::Error;
use tracing::{debug, info, trace, warn};
use utils::{path::normalize_macos_private_alias, shell::resolve_executable_path};

// Global synchronization for worktree creation to prevent race conditions
static WORKTREE_CREATION_LOCKS: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone)]
pub struct WorktreeCleanup {
    pub worktree_path: PathBuf,
    pub git_repo_path: Option<PathBuf>,
}

impl WorktreeCleanup {
    pub fn new(worktree_path: PathBuf, git_repo_path: Option<PathBuf>) -> Self {
        Self {
            worktree_path,
            git_repo_path,
        }
    }
}

#[derive(Debug, Error)]
pub enum WorktreeError {
    #[error(transparent)]
    Git(#[from] GitError),
    #[error(transparent)]
    GitService(#[from] GitServiceError),
    #[error("Git CLI error: {0}")]
    GitCli(String),
    #[error("Task join error: {0}")]
    TaskJoin(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Branch not found: {0}")]
    BranchNotFound(String),
    #[error("Repository error: {0}")]
    Repository(String),
}

pub struct WorktreeManager;

impl WorktreeManager {
    pub fn set_workspace_dir_override(path: PathBuf) {
        Self::set_workspace_dir_override_option(Some(path));
    }

    pub fn set_workspace_dir_override_option(path: Option<PathBuf>) {
        let mut override_path = WORKSPACE_DIR_OVERRIDE
            .write()
            .expect("workspace dir override lock poisoned");
        *override_path = path;
    }

    pub fn set_session_worktree_dir_override(path: Option<PathBuf>) {
        let mut override_path = SESSION_WORKTREE_DIR_OVERRIDE
            .write()
            .expect("session worktree dir override lock poisoned");
        *override_path = path;
    }

    fn workspace_dir_override() -> Option<PathBuf> {
        WORKSPACE_DIR_OVERRIDE
            .read()
            .expect("workspace dir override lock poisoned")
            .clone()
    }

    fn session_worktree_dir_override() -> Option<PathBuf> {
        SESSION_WORKTREE_DIR_OVERRIDE
            .read()
            .expect("session worktree dir override lock poisoned")
            .clone()
    }

    /// Create a worktree with a new branch
    pub async fn create_worktree(
        repo_path: &Path,
        branch_name: &str,
        worktree_path: &Path,
        base_branch: &str,
        create_branch: bool,
    ) -> Result<(), WorktreeError> {
        if create_branch {
            let repo_path_owned = repo_path.to_path_buf();
            let branch_name_owned = branch_name.to_string();
            let base_branch_owned = base_branch.to_string();

            tokio::task::spawn_blocking(move || {
                let repo = Repository::open(&repo_path_owned)?;
                let base_branch_ref =
                    GitService::find_branch(&repo, &base_branch_owned)?.into_reference();
                repo.branch(
                    &branch_name_owned,
                    &base_branch_ref.peel_to_commit()?,
                    false,
                )?;
                Ok::<(), GitServiceError>(())
            })
            .await
            .map_err(|e| WorktreeError::TaskJoin(format!("Task join error: {e}")))??;
        }

        Self::ensure_worktree_exists_inner(repo_path, branch_name, worktree_path, true).await
    }

    /// Ensure worktree exists, recreating if necessary with proper synchronization
    /// This is the main entry point for ensuring a worktree exists and prevents race conditions
    pub async fn ensure_worktree_exists(
        repo_path: &Path,
        branch_name: &str,
        worktree_path: &Path,
    ) -> Result<(), WorktreeError> {
        Self::ensure_worktree_exists_inner(repo_path, branch_name, worktree_path, false).await
    }

    async fn ensure_worktree_exists_inner(
        repo_path: &Path,
        branch_name: &str,
        worktree_path: &Path,
        allow_recreate: bool,
    ) -> Result<(), WorktreeError> {
        let path_str = worktree_path.to_string_lossy().to_string();

        // Get or create a lock for this specific worktree path
        let lock = {
            let mut locks = WORKTREE_CREATION_LOCKS.lock().unwrap();
            locks
                .entry(path_str.clone())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };

        // Acquire the lock for this specific worktree path
        let _guard = lock.lock().await;

        // Check if worktree already exists and is properly set up
        if Self::is_worktree_properly_set_up(repo_path, worktree_path).await? {
            trace!("Worktree already properly set up at path: {}", path_str);
            return Ok(());
        }

        if !allow_recreate && worktree_path.exists() {
            return Err(WorktreeError::Repository(format!(
                "Worktree path {} exists but is not registered correctly; refusing automatic cleanup during ensure",
                worktree_path.display()
            )));
        }

        // If worktree doesn't exist or isn't properly set up, recreate it
        info!("Worktree needs recreation at path: {}", path_str);
        Self::recreate_worktree_internal(repo_path, branch_name, worktree_path, allow_recreate)
            .await
    }

    /// Internal worktree recreation function (always recreates)
    async fn recreate_worktree_internal(
        repo_path: &Path,
        branch_name: &str,
        worktree_path: &Path,
        allow_cleanup: bool,
    ) -> Result<(), WorktreeError> {
        let path_str = worktree_path.to_string_lossy().to_string();
        let branch_name_owned = branch_name.to_string();
        let worktree_path_owned = worktree_path.to_path_buf();

        info!(
            "Creating worktree {} at path {}",
            branch_name_owned, path_str
        );

        // Step 1: Only clean up when there is stale state to remove. Fresh
        // creation should not look like a destructive cleanup in logs, and
        // startup "ensure" paths must not remove healthy worktrees unless the
        // setup check already proved the path/metadata is inconsistent.
        if allow_cleanup && Self::has_worktree_state(repo_path, &worktree_path_owned).await? {
            info!(
                "Removing stale worktree state before recreation at {}",
                worktree_path_owned.display()
            );
            Self::comprehensive_worktree_cleanup_async(repo_path, &worktree_path_owned).await?;
        } else {
            debug!(
                "No existing worktree state found before creation at {}",
                worktree_path_owned.display()
            );
        }

        // Step 2: Ensure parent directory exists (non-blocking)
        if let Some(parent) = worktree_path_owned.parent() {
            let parent_path = parent.to_path_buf();
            tokio::task::spawn_blocking(move || std::fs::create_dir_all(&parent_path))
                .await
                .map_err(|e| WorktreeError::TaskJoin(format!("Task join error: {e}")))?
                .map_err(WorktreeError::Io)?;
        }

        // Step 3: Create the worktree with retry logic for metadata conflicts (non-blocking)
        Self::create_worktree_with_retry(
            repo_path,
            &branch_name_owned,
            &worktree_path_owned,
            &path_str,
        )
        .await
    }

    /// Check if a worktree is properly set up (filesystem + git metadata)
    async fn is_worktree_properly_set_up(
        repo_path: &Path,
        worktree_path: &Path,
    ) -> Result<bool, WorktreeError> {
        let repo_path = repo_path.to_path_buf();
        let worktree_path = worktree_path.to_path_buf();

        tokio::task::spawn_blocking(move || -> Result<bool, WorktreeError> {
            // Check 1: Filesystem path must exist
            if !worktree_path.exists() {
                return Ok(false);
            }

            // Check 2: Worktree must be registered in git metadata using find_worktree
            let repo = Repository::open(&repo_path).map_err(WorktreeError::Git)?;
            let Some(worktree_name) =
                Self::find_worktree_git_internal_name(&repo_path, &worktree_path)?
            else {
                // Directory exists but not registered in git metadata - needs recreation
                return Ok(false);
            };

            // Try to find the worktree - if it exists and is valid, we're good
            match repo.find_worktree(&worktree_name) {
                Ok(_) => Ok(true),
                Err(_) => Ok(false),
            }
        })
        .await
        .map_err(|e| WorktreeError::TaskJoin(format!("{e}")))?
    }

    fn find_worktree_git_internal_name(
        git_repo_path: &Path,
        worktree_path: &Path,
    ) -> Result<Option<String>, WorktreeError> {
        fn canonicalize_for_compare(path: &Path) -> PathBuf {
            dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
        }

        let worktree_root = canonicalize_for_compare(&normalize_macos_private_alias(worktree_path));
        let worktree_metadata_path = Self::get_worktree_metadata_path(git_repo_path)?;
        let worktree_metadata_folders = match fs::read_dir(&worktree_metadata_path) {
            Ok(read_dir) => read_dir
                .filter_map(|entry| entry.ok())
                .collect::<Vec<fs::DirEntry>>(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => {
                return Err(WorktreeError::Repository(format!(
                    "Failed to read worktree metadata directory at {}: {}",
                    worktree_metadata_path.display(),
                    e
                )));
            }
        };
        // read the worktrees/*/gitdir and see which one matches the worktree_path
        for entry in worktree_metadata_folders {
            let gitdir_path = entry.path().join("gitdir");
            if gitdir_path.exists()
                && let Ok(gitdir_content) = fs::read_to_string(&gitdir_path)
                && normalize_macos_private_alias(Path::new(gitdir_content.trim()))
                    .parent()
                    .map(canonicalize_for_compare)
                    .is_some_and(|p| p == worktree_root)
            {
                return Ok(Some(entry.file_name().to_string_lossy().to_string()));
            }
        }
        Ok(None)
    }

    fn get_worktree_metadata_path(git_repo_path: &Path) -> Result<PathBuf, WorktreeError> {
        let repo = Repository::open(git_repo_path).map_err(WorktreeError::Git)?;
        Ok(repo.commondir().join("worktrees"))
    }

    async fn has_worktree_state(
        git_repo_path: &Path,
        worktree_path: &Path,
    ) -> Result<bool, WorktreeError> {
        let git_repo_path = git_repo_path.to_path_buf();
        let worktree_path = worktree_path.to_path_buf();
        tokio::task::spawn_blocking(move || {
            Ok(worktree_path.exists()
                || Self::find_worktree_git_internal_name(&git_repo_path, &worktree_path)?.is_some())
        })
        .await
        .map_err(|e| WorktreeError::TaskJoin(format!("{e}")))?
    }

    /// Comprehensive cleanup of worktree path and metadata to prevent "path exists" errors (blocking)
    fn comprehensive_worktree_cleanup(
        repo: &Repository,
        worktree_path: &Path,
    ) -> Result<(), WorktreeError> {
        let worktree_display_name = worktree_path.to_string_lossy().to_string();
        debug!("Performing cleanup for worktree: {worktree_display_name}");

        let git_repo_path = Self::get_git_repo_path(repo)?;

        // Step 1: Use GitService to remove the worktree registration (force) if present
        // The Git CLI is more robust than libgit2 for mutable worktree operations
        let git_service = GitService::new();
        if let Err(e) = git_service.remove_worktree(&git_repo_path, worktree_path, true) {
            debug!("git worktree remove non-fatal error: {}", e);
        }

        // Step 2: Always force cleanup metadata directory (proactive cleanup)
        if let Err(e) = Self::force_cleanup_worktree_metadata(&git_repo_path, worktree_path) {
            debug!("Metadata cleanup failed (non-fatal): {}", e);
        }

        // Step 3: Clean up physical worktree directory if it exists
        if worktree_path.exists() {
            debug!(
                "Removing existing worktree directory: {}",
                worktree_path.display()
            );
            std::fs::remove_dir_all(worktree_path).map_err(WorktreeError::Io)?;
        }

        // Step 4: Good-practice to clean up any other stale admin entries
        if let Err(e) = git_service.prune_worktrees(&git_repo_path) {
            debug!("git worktree prune non-fatal error: {}", e);
        }

        debug!("Comprehensive cleanup completed for worktree: {worktree_display_name}",);
        Ok(())
    }

    /// Async version of comprehensive cleanup to avoid blocking the main runtime
    async fn comprehensive_worktree_cleanup_async(
        git_repo_path: &Path,
        worktree_path: &Path,
    ) -> Result<(), WorktreeError> {
        let git_repo_path_owned = git_repo_path.to_path_buf();
        let worktree_path_owned = worktree_path.to_path_buf();

        // First, try to open the repository to see if it exists
        let repo_result = tokio::task::spawn_blocking({
            let git_repo_path = git_repo_path_owned.clone();
            move || Repository::open(&git_repo_path)
        })
        .await;

        match repo_result {
            Ok(Ok(repo)) => {
                // Repository exists, perform comprehensive cleanup
                tokio::task::spawn_blocking(move || {
                    Self::comprehensive_worktree_cleanup(&repo, &worktree_path_owned)
                })
                .await
                .map_err(|e| WorktreeError::TaskJoin(format!("Task join error: {e}")))?
            }
            Ok(Err(e)) => {
                // Repository doesn't exist (likely deleted project), fall back to simple cleanup
                debug!(
                    "Failed to open repository at {:?}: {}. Falling back to simple cleanup for worktree at {}",
                    git_repo_path_owned,
                    e,
                    worktree_path_owned.display()
                );
                Self::simple_worktree_cleanup(&worktree_path_owned).await?;
                Ok(())
            }
            Err(e) => Err(WorktreeError::TaskJoin(format!("{e}"))),
        }
    }

    /// Create worktree with retry logic in non-blocking manner
    async fn create_worktree_with_retry(
        git_repo_path: &Path,
        branch_name: &str,
        worktree_path: &Path,
        path_str: &str,
    ) -> Result<(), WorktreeError> {
        let git_repo_path = git_repo_path.to_path_buf();
        let branch_name = branch_name.to_string();
        let worktree_path = worktree_path.to_path_buf();
        let path_str = path_str.to_string();

        tokio::task::spawn_blocking(move || -> Result<(), WorktreeError> {
            // Prefer git CLI for worktree add to inherit sparse-checkout semantics
            let git_service = GitService::new();
            match git_service.add_worktree(&git_repo_path, &worktree_path, &branch_name, false) {
                Ok(()) => {
                    if !worktree_path.exists() {
                        return Err(WorktreeError::Repository(format!(
                            "Worktree creation reported success but path {path_str} does not exist"
                        )));
                    }
                    info!(
                        "Successfully created worktree {} at {} (git CLI)",
                        branch_name, path_str
                    );
                    Ok(())
                }
                Err(e) => {
                    tracing::warn!(
                        "git worktree add failed; attempting metadata cleanup and retry: {}",
                        e
                    );
                    // Force cleanup metadata and try one more time
                    Self::force_cleanup_worktree_metadata(&git_repo_path, &worktree_path)?;
                    // Clean up physical directory if it exists
                    // Needed if previous attempt failed after directory creation
                    if worktree_path.exists() {
                        std::fs::remove_dir_all(&worktree_path).map_err(WorktreeError::Io)?;
                    }
                    if let Err(e2) = git_service.add_worktree(
                        &git_repo_path,
                        &worktree_path,
                        &branch_name,
                        false,
                    ) {
                        return Err(WorktreeError::GitService(e2));
                    }
                    if !worktree_path.exists() {
                        return Err(WorktreeError::Repository(format!(
                            "Worktree creation reported success but path {path_str} does not exist"
                        )));
                    }
                    info!(
                        "Successfully created worktree {} at {} after metadata cleanup (git CLI)",
                        branch_name, path_str
                    );
                    Ok(())
                }
            }
        })
        .await
        .map_err(|e| WorktreeError::TaskJoin(format!("{e}")))?
    }

    /// Get the git repository path
    fn get_git_repo_path(repo: &Repository) -> Result<PathBuf, WorktreeError> {
        repo.workdir()
            .ok_or_else(|| {
                WorktreeError::Repository("Repository has no working directory".to_string())
            })?
            .to_str()
            .ok_or_else(|| {
                WorktreeError::InvalidPath("Repository path is not valid UTF-8".to_string())
            })
            .map(PathBuf::from)
    }

    /// Force cleanup worktree metadata directory
    fn force_cleanup_worktree_metadata(
        git_repo_path: &Path,
        worktree_path: &Path,
    ) -> Result<(), WorktreeError> {
        if let Some(worktree_name) =
            Self::find_worktree_git_internal_name(git_repo_path, worktree_path)?
        {
            let git_worktree_metadata_path =
                Self::get_worktree_metadata_path(git_repo_path)?.join(worktree_name);

            if git_worktree_metadata_path.exists() {
                debug!(
                    "Force removing git worktree metadata: {}",
                    git_worktree_metadata_path.display()
                );
                std::fs::remove_dir_all(&git_worktree_metadata_path)?;
            }
        }

        Ok(())
    }

    /// Clean up multiple worktrees
    pub async fn batch_cleanup_worktrees(data: &[WorktreeCleanup]) -> Result<(), WorktreeError> {
        for cleanup_data in data {
            tracing::debug!("Cleaning up worktree: {:?}", cleanup_data.worktree_path);

            if let Err(e) = Self::cleanup_worktree(cleanup_data).await {
                tracing::error!("Failed to cleanup worktree: {}", e);
            }
        }
        Ok(())
    }

    /// Clean up a worktree path and its git metadata (non-blocking)
    /// If git_repo_path is None, attempts to infer it from the worktree itself
    pub async fn cleanup_worktree(worktree: &WorktreeCleanup) -> Result<(), WorktreeError> {
        let path_str = worktree.worktree_path.to_string_lossy().to_string();

        // Get the same lock to ensure we don't interfere with creation
        let lock = {
            let mut locks = WORKTREE_CREATION_LOCKS.lock().unwrap();
            locks
                .entry(path_str.clone())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };

        let _guard = lock.lock().await;

        // Try to determine the git repo path if not provided
        let resolved_repo_path = if let Some(repo_path) = &worktree.git_repo_path {
            Some(repo_path.to_path_buf())
        } else {
            Self::infer_git_repo_path(&worktree.worktree_path).await
        };

        if let Some(repo_path) = resolved_repo_path {
            Self::comprehensive_worktree_cleanup_async(&repo_path, &worktree.worktree_path).await?;
        } else {
            // Can't determine repo path, just clean up the worktree directory
            debug!(
                "Cannot determine git repo path for worktree {}, performing simple cleanup",
                path_str
            );
            Self::simple_worktree_cleanup(&worktree.worktree_path).await?;
        }

        Ok(())
    }

    /// Force-remove the Git worktree registration and metadata even when the
    /// physical directory is locked by another process. On Windows a process
    /// with cwd/files under the worktree can make `remove_dir_all` fail with
    /// ERROR_SHARING_VIOLATION; in that case the worktree is detached from Git
    /// and the remaining directory is left for a later OS-level cleanup.
    pub async fn force_remove_worktree(worktree: &WorktreeCleanup) -> Result<(), WorktreeError> {
        let path_str = worktree.worktree_path.to_string_lossy().to_string();

        let lock = {
            let mut locks = WORKTREE_CREATION_LOCKS.lock().unwrap();
            locks
                .entry(path_str.clone())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };

        let _guard = lock.lock().await;

        let resolved_repo_path = if let Some(repo_path) = &worktree.git_repo_path {
            Some(repo_path.to_path_buf())
        } else {
            Self::infer_git_repo_path(&worktree.worktree_path).await
        };

        let worktree_path = worktree.worktree_path.clone();
        tokio::task::spawn_blocking(move || -> Result<(), WorktreeError> {
            if let Some(repo_path) = resolved_repo_path {
                let git_service = GitService::new();
                if let Err(err) = git_service.remove_worktree(&repo_path, &worktree_path, true) {
                    debug!("force git worktree remove returned non-fatal error: {err}");
                }
                Self::force_cleanup_worktree_metadata(&repo_path, &worktree_path)?;
                if let Err(err) = git_service.prune_worktrees(&repo_path) {
                    debug!("git worktree prune after force remove failed: {err}");
                }
            }

            if worktree_path.exists() {
                match std::fs::remove_dir_all(&worktree_path) {
                    Ok(()) => {
                        info!(
                            "Force-removed worktree directory: {}",
                            worktree_path.display()
                        );
                    }
                    Err(err) if is_process_lock_error(&err) => {
                        warn!(
                            "Worktree directory is locked by another process; Git metadata was detached but physical directory remains: {} ({})",
                            worktree_path.display(),
                            err
                        );
                    }
                    Err(err) => return Err(WorktreeError::Io(err)),
                }
            }

            Ok(())
        })
        .await
        .map_err(|e| WorktreeError::TaskJoin(format!("{e}")))?
    }

    /// Try to infer the git repository path from a worktree
    async fn infer_git_repo_path(worktree_path: &Path) -> Option<PathBuf> {
        // Try using git rev-parse --git-common-dir from within the worktree
        let worktree_path_owned = worktree_path.to_path_buf();

        let git_path = resolve_executable_path("git").await?;

        let output = tokio::process::Command::new(git_path)
            .args(["rev-parse", "--git-common-dir"])
            .current_dir(&worktree_path_owned)
            .output()
            .await
            .ok()?;

        if output.status.success() {
            let git_common_dir = String::from_utf8(output.stdout).ok()?.trim().to_string();

            // git-common-dir gives us the path to the .git directory
            // We need the working directory (parent of .git)
            let git_dir_path = Path::new(&git_common_dir);
            if git_dir_path.file_name() == Some(std::ffi::OsStr::new(".git")) {
                git_dir_path.parent()?.to_str().map(PathBuf::from)
            } else {
                // In case of bare repo or unusual setup, use the git-common-dir as is
                Some(PathBuf::from(git_common_dir))
            }
        } else {
            None
        }
    }

    /// Simple worktree cleanup when we can't determine the main repo
    async fn simple_worktree_cleanup(worktree_path: &Path) -> Result<(), WorktreeError> {
        let worktree_path_owned = worktree_path.to_path_buf();

        tokio::task::spawn_blocking(move || -> Result<(), WorktreeError> {
            if worktree_path_owned.exists() {
                std::fs::remove_dir_all(&worktree_path_owned).map_err(WorktreeError::Io)?;
                info!(
                    "Removed worktree directory: {}",
                    worktree_path_owned.display()
                );
            }
            Ok(())
        })
        .await
        .map_err(|e| WorktreeError::TaskJoin(format!("{e}")))?
    }

    /// Move a worktree to a new location
    pub async fn move_worktree(
        repo_path: &Path,
        old_path: &Path,
        new_path: &Path,
    ) -> Result<(), WorktreeError> {
        let repo_path = repo_path.to_path_buf();
        let old_path = old_path.to_path_buf();
        let new_path = new_path.to_path_buf();

        tokio::task::spawn_blocking(move || {
            let git_service = GitService::new();
            git_service
                .move_worktree(&repo_path, &old_path, &new_path)
                .map_err(WorktreeError::GitService)
        })
        .await
        .map_err(|e| WorktreeError::TaskJoin(format!("{e}")))?
    }

    /// Get the base directory for openteams worktrees
    pub fn get_worktree_base_dir() -> std::path::PathBuf {
        if let Some(override_path) = Self::workspace_dir_override() {
            // Always use app-owned subdirectory within custom path for safety.
            // This ensures orphan cleanup never touches user's existing folders.
            return override_path.join(".openteams-workspaces");
        }
        Self::get_default_worktree_base_dir()
    }

    /// Get the default base directory (ignoring any override)
    pub fn get_default_worktree_base_dir() -> std::path::PathBuf {
        utils::path::get_agent_chatgroup_temp_dir().join("worktrees")
    }

    /// Get the base directory for session-scoped isolated worktrees.
    ///
    /// When configured, this is the exact directory that will contain
    /// `<short-session-id>` folders. Without a specific override, session
    /// worktrees remain under the normal app-owned worktree base in a
    /// `sessions/` namespace.
    pub fn get_session_worktree_base_dir() -> std::path::PathBuf {
        Self::session_worktree_dir_override()
            .unwrap_or_else(Self::get_default_session_worktree_base_dir)
    }

    pub fn get_default_session_worktree_base_dir() -> std::path::PathBuf {
        Self::get_worktree_base_dir().join("sessions")
    }

    pub async fn cleanup_suspected_worktree(path: &Path) -> Result<bool, WorktreeError> {
        let git_marker = path.join(".git");
        if !git_marker.exists() || !git_marker.is_file() {
            return Ok(false);
        }

        debug!("Cleaning up suspected worktree at {}", path.display());
        let cleanup = WorktreeCleanup::new(path.to_path_buf(), None);
        Self::cleanup_worktree(&cleanup).await?;
        Ok(true)
    }
}

fn is_process_lock_error(err: &std::io::Error) -> bool {
    #[cfg(windows)]
    {
        matches!(err.raw_os_error(), Some(32))
    }
    #[cfg(not(windows))]
    {
        let _ = err;
        false
    }
}

#[tokio::test]
async fn create_worktree_when_repo_path_is_a_worktree() {
    use tempfile::TempDir;
    let td = TempDir::new().unwrap();

    let repo_path = td.path().join("repo");
    let git_service = GitService::new();
    git_service
        .initialize_repo_with_main_branch(&repo_path)
        .unwrap();

    let base_worktree_path = td.path().join("wt-base");
    WorktreeManager::create_worktree(
        &repo_path,
        "wt-base-branch",
        &base_worktree_path,
        "main",
        true,
    )
    .await
    .unwrap();
    assert!(base_worktree_path.join(".git").is_file());

    let child_worktree_path = td.path().join("wt-child");
    WorktreeManager::create_worktree(
        &base_worktree_path,
        "wt-child-branch",
        &child_worktree_path,
        "main",
        true,
    )
    .await
    .unwrap();
    assert!(child_worktree_path.join(".git").is_file());

    // Regression: repo_path itself is a worktree (so `.git` is a file), but metadata lookup still works.
    WorktreeManager::ensure_worktree_exists(
        &base_worktree_path,
        "wt-child-branch",
        &child_worktree_path,
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn ensure_worktree_exists_refuses_to_delete_existing_unregistered_path() {
    use tempfile::TempDir;
    let td = TempDir::new().unwrap();

    let repo_path = td.path().join("repo");
    let git_service = GitService::new();
    git_service
        .initialize_repo_with_main_branch(&repo_path)
        .unwrap();

    let worktree_path = td.path().join("existing-unregistered");
    std::fs::create_dir_all(&worktree_path).unwrap();
    let marker = worktree_path.join("unmerged-work.txt");
    std::fs::write(&marker, "keep me").unwrap();

    let err = WorktreeManager::ensure_worktree_exists(&repo_path, "main", &worktree_path)
        .await
        .expect_err("startup ensure must not delete an existing unregistered path");

    assert!(matches!(err, WorktreeError::Repository(_)));
    assert!(marker.exists());
}
