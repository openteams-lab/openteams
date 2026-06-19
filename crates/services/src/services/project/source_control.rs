use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    ffi::OsString,
    fs,
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};

use dashmap::DashMap;
use db::models::{
    chat_run::ChatRun,
    chat_session::{ChatSession, ChatSessionStatus},
    project::Project,
    project_path::{ProjectPath, ProjectPathKind},
    project_work_item::ProjectWorkItem,
    project_work_item_execution_link::ProjectWorkItemExecutionLink,
};
use git::{ConflictOp, GitCli, GitCliError, GitService, StatusEntry};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use thiserror::Error;
use ts_rs::TS;
use utils::{
    assets::asset_dir,
    diff::{compute_line_change_counts, create_unified_diff},
};
use uuid::Uuid;

use super::delivery::ProjectDeliveryService;

const MAX_INLINE_DIFF_BYTES: u64 = 2 * 1024 * 1024;
const SOURCE_CONTROL_CACHE_TTL: Duration = Duration::from_secs(2);

static SESSION_PATH_CACHE: Lazy<DashMap<SessionPathCacheKey, SessionPathCacheEntry>> =
    Lazy::new(DashMap::new);
static STATUS_CACHE: Lazy<DashMap<SourceControlStatusCacheKey, SourceControlStatusCacheEntry>> =
    Lazy::new(DashMap::new);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SourceControlFileStatus {
    Modified,
    Added,
    Deleted,
    Untracked,
    Renamed,
    Copied,
    TypeChanged,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SourceControlDiffArea {
    Changes,
    Staged,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SourceControlOperationInProgress {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SourceControlPlainReason {
    NotGitRepo,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SourceControlOperationFailureCode {
    PathOutsideWorkspace,
    NotSessionScoped,
    SharedFile,
    ExternalStagedConflict,
    StaleStatus,
    GitOperationBlocked,
    FileMissing,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SourceControlCommitErrorCode {
    EmptyMessage,
    EmptyStaged,
    ExternalStagedConflict,
    SharedFileRequiresConfirmation,
    DetachedHead,
    GitOperationBlocked,
    StaleStatus,
    PathOutsideWorkspace,
    NotSessionScoped,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct SourceControlFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: SourceControlFileStatus,
    pub additions: usize,
    pub deletions: usize,
    pub has_diff: bool,
    pub is_binary: bool,
    pub is_too_large: bool,
    pub shared: bool,
    pub shared_session_ids: Vec<Uuid>,
    pub blocked_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum SessionSourceControlStatus {
    Git {
        workspace_id: Option<Uuid>,
        workspace_path: String,
        branch: String,
        head_sha: Option<String>,
        changes: Vec<SourceControlFile>,
        staged_changes: Vec<SourceControlFile>,
        external_staged_paths: Vec<String>,
        operation_in_progress: Option<SourceControlOperationInProgress>,
        detached_head: bool,
        blocked_reason: Option<String>,
    },
    Plain {
        workspace_id: Option<Uuid>,
        workspace_path: String,
        files: Vec<SourceControlFile>,
        reason: SourceControlPlainReason,
    },
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct SourceControlDiffRequest {
    pub session_id: Uuid,
    #[serde(default)]
    #[ts(optional, type = "string | null")]
    pub workspace_id: Option<Uuid>,
    pub path: String,
    pub area: SourceControlDiffArea,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct SourceControlDiffResponse {
    pub path: String,
    pub old_path: Option<String>,
    pub area: SourceControlDiffArea,
    pub base_label: String,
    pub compare_label: String,
    pub unified_diff: Option<String>,
    pub additions: usize,
    pub deletions: usize,
    pub is_binary: bool,
    pub is_too_large: bool,
    pub content_omitted: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct SourceControlStageRequest {
    pub session_id: Uuid,
    #[serde(default)]
    #[ts(optional, type = "string | null")]
    pub workspace_id: Option<Uuid>,
    pub paths: Vec<String>,
    #[serde(default)]
    #[ts(optional, type = "boolean | null")]
    pub force_shared: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct SourceControlUnstageRequest {
    pub session_id: Uuid,
    #[serde(default)]
    #[ts(optional, type = "string | null")]
    pub workspace_id: Option<Uuid>,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct SourceControlDiscardRequest {
    pub session_id: Uuid,
    #[serde(default)]
    #[ts(optional, type = "string | null")]
    pub workspace_id: Option<Uuid>,
    pub paths: Vec<String>,
    #[serde(default)]
    #[ts(optional, type = "boolean | null")]
    pub force_shared: Option<bool>,
    #[serde(default)]
    #[ts(optional, type = "string | null")]
    pub expected_head_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct SourceControlOperationFailure {
    pub path: String,
    pub code: SourceControlOperationFailureCode,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct SourceControlOperationResponse {
    pub ok: bool,
    pub succeeded: Vec<String>,
    pub failed: Vec<SourceControlOperationFailure>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "SessionSourceControlStatus | null")]
    pub status: Option<SessionSourceControlStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "string | null")]
    pub head_sha: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "string | null")]
    pub operation_id: Option<Uuid>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct SourceControlCommitRequest {
    pub session_id: Uuid,
    #[serde(default)]
    #[ts(optional, type = "string | null")]
    pub workspace_id: Option<Uuid>,
    pub message: String,
    pub expected_staged_paths: Vec<String>,
    #[serde(default)]
    #[ts(optional, type = "boolean | null")]
    pub force_shared: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub work_item_ids: Option<Vec<Uuid>>,
    #[serde(default)]
    #[ts(optional, type = "string | null")]
    pub expected_head_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct SourceControlCommitResponse {
    pub commit_sha: String,
    pub short_sha: String,
    pub branch: String,
    pub message: String,
    pub committed_paths: Vec<String>,
    pub additions: usize,
    pub deletions: usize,
    pub status: SessionSourceControlStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct SourceControlCommitError {
    pub code: SourceControlCommitErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub conflicting_paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub status: Option<SessionSourceControlStatus>,
}

#[derive(Debug, Error)]
pub enum SourceControlError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
    #[error(transparent)]
    Git(#[from] GitCliError),
    #[error("Project not found")]
    ProjectNotFound,
    #[error("Session not found")]
    SessionNotFound,
    #[error("Session does not belong to this project")]
    SessionProjectMismatch,
    #[error("Project default workspace is not configured")]
    WorkspaceNotConfigured,
    #[error("Workspace is not part of this project")]
    WorkspaceNotFound,
    #[error("Workspace path is not accessible: {0}")]
    WorkspaceNotAccessible(String),
    #[error("Invalid source-control path: {0}")]
    InvalidPath(String),
    #[error("Commit rejected")]
    Commit(Box<SourceControlCommitError>),
}

pub type Result<T> = std::result::Result<T, SourceControlError>;

#[derive(Clone, Default)]
pub struct SourceControlService;

#[derive(Debug, Clone)]
struct WorkspaceContext {
    project_id: Uuid,
    session_id: Uuid,
    workspace_id: Option<Uuid>,
    workspace_path: PathBuf,
    workspace_path_string: String,
}

#[derive(Debug, Clone, Default)]
struct SessionPathState {
    existed_after_run: bool,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct SessionPathCacheKey {
    session_id: Uuid,
    workspace_path: String,
}

#[derive(Debug, Clone)]
struct SessionPathCacheEntry {
    captured_at: Instant,
    paths: BTreeMap<String, SessionPathState>,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct SourceControlStatusCacheKey {
    project_id: Uuid,
    session_id: Uuid,
    workspace_id: Option<Uuid>,
    workspace_path: String,
}

#[derive(Debug, Clone)]
struct SourceControlStatusCacheEntry {
    captured_at: Instant,
    status: SessionSourceControlStatus,
}

#[derive(Debug, Clone, Deserialize)]
struct WorkspaceObservedPathRecord {
    path: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    existed_after_run: bool,
}

#[derive(Debug, Deserialize)]
struct RunMetaFile {
    #[serde(default)]
    workspace_observed_paths: Vec<WorkspaceObservedPathRecord>,
}

#[derive(Debug, Deserialize)]
struct WorkRecordJsonLine {
    run_id: Uuid,
    #[serde(default)]
    message_type: String,
    content: String,
}

#[derive(Debug, Clone)]
struct StatusPathEntry {
    path: String,
    old_path: Option<String>,
    staged: char,
    unstaged: char,
    is_untracked: bool,
}

fn is_output_text_only_observed_source(source: &str) -> bool {
    let mut saw_output_text = false;
    let mut saw_other_source = false;
    for part in source
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        if part.eq_ignore_ascii_case("output_text") {
            saw_output_text = true;
        } else {
            saw_other_source = true;
        }
    }
    saw_output_text && !saw_other_source
}

fn is_artifact_observed_source(source: &str) -> bool {
    source
        .split(',')
        .any(|part| part.trim().eq_ignore_ascii_case("artifact_record"))
}

fn is_openteams_relative_path(path: &str) -> bool {
    PathBuf::from(path).components().next().is_some_and(|component| {
        matches!(component, Component::Normal(part) if part == ".openteams")
    })
}

#[derive(Debug, Clone, Copy)]
enum GitArea {
    Changes,
    Staged,
}

impl SourceControlService {
    pub fn new() -> Self {
        Self
    }

    pub fn invalidate_workspace_caches(workspace_path: &str) {
        invalidate_source_control_caches(workspace_path);
    }

    pub fn invalidate_session_caches(session_id: Uuid) {
        invalidate_source_control_session_caches(session_id);
    }

    pub async fn session_status(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        session_id: Uuid,
        workspace_id: Option<Uuid>,
    ) -> Result<SessionSourceControlStatus> {
        let context = resolve_workspace_context(pool, project_id, session_id, workspace_id).await?;
        self.cached_status_for_context(pool, &context).await
    }

    pub async fn diff(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        request: SourceControlDiffRequest,
    ) -> Result<SourceControlDiffResponse> {
        let context =
            resolve_workspace_context(pool, project_id, request.session_id, request.workspace_id)
                .await?;
        validate_relative_path(&request.path).map_err(SourceControlError::InvalidPath)?;
        let session_paths = collect_session_paths(pool, context.session_id, &context).await?;
        if !session_paths.contains_key(&request.path) {
            return Ok(SourceControlDiffResponse {
                path: request.path,
                old_path: None,
                area: request.area,
                base_label: String::new(),
                compare_label: String::new(),
                unified_diff: None,
                additions: 0,
                deletions: 0,
                is_binary: false,
                is_too_large: false,
                content_omitted: true,
                message: Some("Path is not associated with this session.".to_string()),
            });
        }

        if !is_git_repo(&context.workspace_path) {
            return plain_diff_response(&context.workspace_path, &request.path, request.area);
        }

        git_diff_response(&context.workspace_path, &request.path, request.area)
    }

    pub async fn stage(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        request: SourceControlStageRequest,
    ) -> Result<SourceControlOperationResponse> {
        self.stage_with_mode(pool, project_id, request, false).await
    }

    pub async fn stage_fast(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        request: SourceControlStageRequest,
    ) -> Result<SourceControlOperationResponse> {
        self.stage_with_mode(pool, project_id, request, true).await
    }

    async fn stage_with_mode(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        request: SourceControlStageRequest,
        fast_response: bool,
    ) -> Result<SourceControlOperationResponse> {
        let context =
            resolve_workspace_context(pool, project_id, request.session_id, request.workspace_id)
                .await?;
        let (succeeded, failed) = self
            .mutate_paths(
                pool,
                &context,
                request.paths,
                request.force_shared.unwrap_or(false),
                |workspace_path, path| {
                    git_with_paths(workspace_path, &["add"], &[path.to_string()])
                },
                true,
            )
            .await?;
        if !succeeded.is_empty() {
            invalidate_source_control_caches(&context.workspace_path_string);
        }
        self.operation_response(pool, &context, succeeded, failed, fast_response)
            .await
    }

    pub async fn unstage(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        request: SourceControlUnstageRequest,
    ) -> Result<SourceControlOperationResponse> {
        self.unstage_with_mode(pool, project_id, request, false)
            .await
    }

    pub async fn unstage_fast(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        request: SourceControlUnstageRequest,
    ) -> Result<SourceControlOperationResponse> {
        self.unstage_with_mode(pool, project_id, request, true)
            .await
    }

    async fn unstage_with_mode(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        request: SourceControlUnstageRequest,
        fast_response: bool,
    ) -> Result<SourceControlOperationResponse> {
        let context =
            resolve_workspace_context(pool, project_id, request.session_id, request.workspace_id)
                .await?;
        let (succeeded, failed) = self
            .mutate_paths(
                pool,
                &context,
                request.paths,
                false,
                |workspace_path, path| {
                    git_with_paths(
                        workspace_path,
                        &["restore", "--staged"],
                        &[path.to_string()],
                    )
                },
                false,
            )
            .await?;
        if !succeeded.is_empty() {
            invalidate_source_control_caches(&context.workspace_path_string);
        }
        self.operation_response(pool, &context, succeeded, failed, fast_response)
            .await
    }

    pub async fn discard(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        request: SourceControlDiscardRequest,
    ) -> Result<SourceControlOperationResponse> {
        self.discard_with_mode(pool, project_id, request, false)
            .await
    }

    pub async fn discard_fast(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        request: SourceControlDiscardRequest,
    ) -> Result<SourceControlOperationResponse> {
        self.discard_with_mode(pool, project_id, request, true)
            .await
    }

    async fn discard_with_mode(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        request: SourceControlDiscardRequest,
        fast_response: bool,
    ) -> Result<SourceControlOperationResponse> {
        let context =
            resolve_workspace_context(pool, project_id, request.session_id, request.workspace_id)
                .await?;
        let mut stale_failure = None;
        let expected_head_sha = request.expected_head_sha;
        let force_shared = request.force_shared.unwrap_or(false);
        let paths = request.paths;
        if let Some(expected) = expected_head_sha.as_deref() {
            let current = current_head_sha(&context.workspace_path);
            if current.as_deref() != Some(expected) {
                stale_failure = Some(SourceControlOperationFailure {
                    path: "*".to_string(),
                    code: SourceControlOperationFailureCode::StaleStatus,
                    message: "Workspace HEAD changed. Refresh and retry.".to_string(),
                });
            }
        }

        let mut succeeded = Vec::new();
        let mut failed = Vec::new();
        if let Some(failure) = stale_failure {
            failed.push(failure);
        } else if let Some(op) = detect_operation_in_progress(&context.workspace_path) {
            for path in dedup_paths(paths) {
                failed.push(operation_failure(
                    path,
                    SourceControlOperationFailureCode::GitOperationBlocked,
                    format!("A Git {op:?} operation is in progress."),
                ));
            }
        } else {
            let (ok_paths, failures) = self
                .mutate_paths(pool, &context, paths, force_shared, discard_path, true)
                .await?;
            succeeded = ok_paths;
            failed = failures;
        }
        if !succeeded.is_empty() {
            invalidate_source_control_caches(&context.workspace_path_string);
        }
        self.operation_response(pool, &context, succeeded, failed, fast_response)
            .await
    }

    pub async fn commit(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        request: SourceControlCommitRequest,
    ) -> Result<SourceControlCommitResponse> {
        let context =
            resolve_workspace_context(pool, project_id, request.session_id, request.workspace_id)
                .await?;
        let message = request.message.trim().to_string();
        let force_shared = request.force_shared.unwrap_or(false);
        let requested_work_item_ids = request.work_item_ids.clone();
        if message.is_empty() {
            return Err(commit_error(
                SourceControlCommitErrorCode::EmptyMessage,
                "Commit message is required.",
                None,
                None,
            ));
        }

        let status = self.status_for_context(pool, &context).await?;
        let SessionSourceControlStatus::Git {
            head_sha,
            branch,
            staged_changes,
            external_staged_paths,
            operation_in_progress,
            detached_head,
            ..
        } = status.clone()
        else {
            return Err(commit_error(
                SourceControlCommitErrorCode::GitOperationBlocked,
                "Commits are only available for Git workspaces.",
                None,
                Some(status),
            ));
        };

        if let Some(op) = operation_in_progress {
            return Err(commit_error(
                SourceControlCommitErrorCode::GitOperationBlocked,
                format!("A Git {op:?} operation is in progress."),
                None,
                Some(status),
            ));
        }
        if detached_head {
            return Err(commit_error(
                SourceControlCommitErrorCode::DetachedHead,
                "Cannot commit while HEAD is detached.",
                None,
                Some(status),
            ));
        }
        if let Some(expected) = request.expected_head_sha.as_deref()
            && head_sha.as_deref() != Some(expected)
        {
            return Err(commit_error(
                SourceControlCommitErrorCode::StaleStatus,
                "Workspace HEAD changed. Refresh and retry.",
                None,
                Some(status),
            ));
        }

        let real_staged = staged_paths(&context.workspace_path)?;
        if real_staged.is_empty() {
            return Err(commit_error(
                SourceControlCommitErrorCode::EmptyStaged,
                "There are no staged files to commit.",
                None,
                Some(status),
            ));
        }

        let expected_staged =
            normalize_path_set(&request.expected_staged_paths).map_err(|err| {
                commit_error(
                    SourceControlCommitErrorCode::PathOutsideWorkspace,
                    err,
                    None,
                    Some(status.clone()),
                )
            })?;
        let real_staged_set = real_staged.iter().cloned().collect::<BTreeSet<_>>();
        if real_staged_set != expected_staged {
            let extras = real_staged_set
                .difference(&expected_staged)
                .cloned()
                .collect::<Vec<_>>();
            let missing = expected_staged
                .difference(&real_staged_set)
                .cloned()
                .collect::<Vec<_>>();
            let mut conflicts = extras.clone();
            conflicts.extend(missing);
            conflicts.sort();
            conflicts.dedup();
            let code = if !extras.is_empty() {
                SourceControlCommitErrorCode::ExternalStagedConflict
            } else {
                SourceControlCommitErrorCode::StaleStatus
            };
            return Err(commit_error(
                code,
                "The real Git index no longer matches the expected staged paths.",
                Some(conflicts),
                Some(status),
            ));
        }

        if !external_staged_paths.is_empty() {
            return Err(commit_error(
                SourceControlCommitErrorCode::ExternalStagedConflict,
                "The Git index contains files outside the current session.",
                Some(external_staged_paths),
                Some(status),
            ));
        }

        let shared_paths = staged_changes
            .iter()
            .filter(|file| file.shared)
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();
        if !shared_paths.is_empty() && !force_shared {
            return Err(commit_error(
                SourceControlCommitErrorCode::SharedFileRequiresConfirmation,
                "Staged changes include files shared with another active session.",
                Some(shared_paths),
                Some(status),
            ));
        }

        let (additions, deletions) = staged_changes.iter().fold((0usize, 0usize), |acc, file| {
            (acc.0 + file.additions, acc.1 + file.deletions)
        });
        let committed_paths = real_staged;
        let work_item_ids = resolve_commit_work_item_ids(
            pool,
            project_id,
            context.session_id,
            requested_work_item_ids,
        )
        .await?;

        commit_with_default_identity(&context.workspace_path, &message)?;
        let commit_sha = current_head_sha(&context.workspace_path).ok_or_else(|| {
            SourceControlError::WorkspaceNotAccessible(
                "Unable to read commit SHA after commit.".to_string(),
            )
        })?;
        let short_sha = commit_sha.chars().take(7).collect::<String>();
        ProjectDeliveryService::new()
            .create_commit_records(
                pool,
                context.session_id,
                &commit_sha,
                &short_sha,
                &branch,
                &message,
                &committed_paths,
                additions,
                deletions,
                &work_item_ids,
                force_shared,
            )
            .await?;
        invalidate_source_control_caches(&context.workspace_path_string);
        let status = self.status_for_context(pool, &context).await?;

        Ok(SourceControlCommitResponse {
            short_sha,
            commit_sha,
            branch,
            message,
            committed_paths,
            additions,
            deletions,
            status,
        })
    }

    async fn status_for_context(
        &self,
        pool: &SqlitePool,
        context: &WorkspaceContext,
    ) -> Result<SessionSourceControlStatus> {
        ensure_workspace_accessible(&context.workspace_path)?;
        let session_paths = collect_session_paths(pool, context.session_id, context).await?;
        let session_path_set = session_paths.keys().cloned().collect::<BTreeSet<_>>();

        if !is_git_repo(&context.workspace_path) {
            return Ok(SessionSourceControlStatus::Plain {
                workspace_id: context.workspace_id,
                workspace_path: context.workspace_path_string.clone(),
                files: build_plain_files(&context.workspace_path, session_paths),
                reason: SourceControlPlainReason::NotGitRepo,
            });
        }

        let git = GitCli::new();
        let worktree_status = git.get_worktree_status(&context.workspace_path)?;
        let entries = normalize_status_entries(worktree_status.entries);
        let shared_paths = collect_shared_paths(pool, context, &session_path_set).await?;
        let mut changes = Vec::new();
        let mut staged_changes = Vec::new();
        let mut external_staged_paths = Vec::new();

        for entry in entries {
            if entry.staged != ' ' && !entry.is_untracked {
                if session_path_set.contains(&entry.path) {
                    staged_changes.push(source_file_from_status(
                        &context.workspace_path,
                        &entry,
                        GitArea::Staged,
                        &shared_paths,
                    ));
                } else {
                    external_staged_paths.push(entry.path.clone());
                }
            }

            if entry.is_untracked || entry.unstaged != ' ' {
                if session_path_set.contains(&entry.path) {
                    changes.push(source_file_from_status(
                        &context.workspace_path,
                        &entry,
                        GitArea::Changes,
                        &shared_paths,
                    ));
                }
            }
        }

        changes.sort_by(|a, b| a.path.cmp(&b.path));
        staged_changes.sort_by(|a, b| a.path.cmp(&b.path));
        external_staged_paths.sort();
        external_staged_paths.dedup();

        let head_sha = current_head_sha(&context.workspace_path);
        let branch = current_branch(&context.workspace_path).unwrap_or_else(|| "HEAD".to_string());
        let operation_in_progress = detect_operation_in_progress(&context.workspace_path);
        let detached_head = is_detached_head(&context.workspace_path);
        let blocked_reason = match (operation_in_progress, detached_head) {
            (Some(op), _) => Some(format!("A Git {op:?} operation is in progress.")),
            (None, true) => Some("HEAD is detached.".to_string()),
            _ => None,
        };

        Ok(SessionSourceControlStatus::Git {
            workspace_id: context.workspace_id,
            workspace_path: context.workspace_path_string.clone(),
            branch,
            head_sha,
            changes,
            staged_changes,
            external_staged_paths,
            operation_in_progress,
            detached_head,
            blocked_reason,
        })
    }

    async fn cached_status_for_context(
        &self,
        pool: &SqlitePool,
        context: &WorkspaceContext,
    ) -> Result<SessionSourceControlStatus> {
        let key = SourceControlStatusCacheKey {
            project_id: context.project_id,
            session_id: context.session_id,
            workspace_id: context.workspace_id,
            workspace_path: context.workspace_path_string.clone(),
        };
        let now = Instant::now();
        if let Some(entry) = STATUS_CACHE.get(&key)
            && now.duration_since(entry.captured_at) <= SOURCE_CONTROL_CACHE_TTL
        {
            return Ok(entry.status.clone());
        }

        let status = self.status_for_context(pool, context).await?;
        STATUS_CACHE.insert(
            key,
            SourceControlStatusCacheEntry {
                captured_at: Instant::now(),
                status: status.clone(),
            },
        );
        Ok(status)
    }

    async fn operation_response(
        &self,
        pool: &SqlitePool,
        context: &WorkspaceContext,
        succeeded: Vec<String>,
        failed: Vec<SourceControlOperationFailure>,
        fast_response: bool,
    ) -> Result<SourceControlOperationResponse> {
        let head_sha = current_head_sha(&context.workspace_path);
        let status = if fast_response {
            None
        } else {
            Some(self.status_for_context(pool, context).await?)
        };

        Ok(SourceControlOperationResponse {
            ok: failed.is_empty(),
            succeeded,
            failed,
            status,
            head_sha,
            operation_id: if fast_response {
                Some(Uuid::new_v4())
            } else {
                None
            },
        })
    }

    async fn mutate_paths<F>(
        &self,
        pool: &SqlitePool,
        context: &WorkspaceContext,
        raw_paths: Vec<String>,
        force_shared: bool,
        mutate: F,
        block_shared: bool,
    ) -> Result<(Vec<String>, Vec<SourceControlOperationFailure>)>
    where
        F: Fn(&Path, &str) -> std::result::Result<(), GitCliError>,
    {
        let session_paths = collect_session_paths(pool, context.session_id, context).await?;
        let requested_paths = dedup_paths(raw_paths);
        let shared_target_paths = if block_shared && !force_shared {
            requested_paths
                .iter()
                .filter_map(|raw_path| validate_relative_path(raw_path).ok())
                .filter(|path| session_paths.contains_key(path))
                .collect::<BTreeSet<_>>()
        } else {
            BTreeSet::new()
        };
        let shared_paths = if shared_target_paths.is_empty() {
            HashMap::new()
        } else {
            collect_shared_paths(pool, context, &shared_target_paths).await?
        };
        let mut succeeded = Vec::new();
        let mut failed = Vec::new();

        for raw_path in requested_paths {
            let path = match validate_relative_path(&raw_path) {
                Ok(path) => path,
                Err(message) => {
                    failed.push(operation_failure(
                        raw_path,
                        SourceControlOperationFailureCode::PathOutsideWorkspace,
                        message,
                    ));
                    continue;
                }
            };

            if !session_paths.contains_key(&path) {
                failed.push(operation_failure(
                    path,
                    SourceControlOperationFailureCode::NotSessionScoped,
                    "Path is not associated with this session.",
                ));
                continue;
            }

            if block_shared
                && !force_shared
                && shared_paths
                    .get(&path)
                    .map(|sessions| !sessions.is_empty())
                    .unwrap_or(false)
            {
                failed.push(operation_failure(
                    path,
                    SourceControlOperationFailureCode::SharedFile,
                    "Path is shared with another active session.",
                ));
                continue;
            }

            match mutate(&context.workspace_path, &path) {
                Ok(()) => succeeded.push(path),
                Err(err) => failed.push(operation_failure(
                    path,
                    SourceControlOperationFailureCode::GitOperationBlocked,
                    err.to_string(),
                )),
            }
        }

        Ok((succeeded, failed))
    }
}

fn source_control_op(op: ConflictOp) -> SourceControlOperationInProgress {
    match op {
        ConflictOp::Rebase => SourceControlOperationInProgress::Rebase,
        ConflictOp::Merge => SourceControlOperationInProgress::Merge,
        ConflictOp::CherryPick => SourceControlOperationInProgress::CherryPick,
        ConflictOp::Revert => SourceControlOperationInProgress::Revert,
    }
}

fn detect_operation_in_progress(workspace_path: &Path) -> Option<SourceControlOperationInProgress> {
    GitService::new()
        .detect_conflict_op(workspace_path)
        .ok()
        .flatten()
        .map(source_control_op)
}

async fn resolve_workspace_context(
    pool: &SqlitePool,
    project_id: Uuid,
    session_id: Uuid,
    workspace_id: Option<Uuid>,
) -> Result<WorkspaceContext> {
    let project = Project::find_by_id(pool, project_id)
        .await?
        .ok_or(SourceControlError::ProjectNotFound)?;
    let session = ChatSession::find_by_id(pool, session_id)
        .await?
        .ok_or(SourceControlError::SessionNotFound)?;
    if session.project_id != Some(project_id) {
        return Err(SourceControlError::SessionProjectMismatch);
    }

    let (workspace_id, workspace_path) =
        resolve_project_workspace(pool, &project, workspace_id).await?;
    ensure_workspace_accessible(&workspace_path)?;
    let workspace_path_string = workspace_path.to_string_lossy().to_string();

    Ok(WorkspaceContext {
        project_id,
        session_id,
        workspace_id,
        workspace_path,
        workspace_path_string,
    })
}

async fn resolve_project_workspace(
    pool: &SqlitePool,
    project: &Project,
    workspace_id: Option<Uuid>,
) -> Result<(Option<Uuid>, PathBuf)> {
    let paths = ProjectPath::find_by_project(pool, project.id).await?;
    if let Some(workspace_id) = workspace_id {
        let path = paths
            .into_iter()
            .find(|path| path.id == workspace_id && path.kind == ProjectPathKind::Workspace)
            .ok_or(SourceControlError::WorkspaceNotFound)?;
        return Ok((Some(path.id), PathBuf::from(path.path)));
    }

    if let Some(path) = project
        .default_workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        return Ok((None, PathBuf::from(path)));
    }

    if let Some(path) = paths
        .into_iter()
        .find(|path| path.kind == ProjectPathKind::Workspace && path.is_default)
    {
        return Ok((Some(path.id), PathBuf::from(path.path)));
    }

    Err(SourceControlError::WorkspaceNotConfigured)
}

fn ensure_workspace_accessible(workspace_path: &Path) -> Result<()> {
    match fs::metadata(workspace_path) {
        Ok(metadata) if metadata.is_dir() => Ok(()),
        Ok(_) => Err(SourceControlError::WorkspaceNotAccessible(
            "Workspace path must be a directory.".to_string(),
        )),
        Err(err) => Err(SourceControlError::WorkspaceNotAccessible(err.to_string())),
    }
}

fn is_git_repo(workspace_path: &Path) -> bool {
    git2::Repository::open(workspace_path).is_ok()
}

async fn collect_session_paths(
    pool: &SqlitePool,
    session_id: Uuid,
    context: &WorkspaceContext,
) -> Result<BTreeMap<String, SessionPathState>> {
    let key = SessionPathCacheKey {
        session_id,
        workspace_path: context.workspace_path_string.clone(),
    };
    let now = Instant::now();
    if let Some(entry) = SESSION_PATH_CACHE.get(&key)
        && now.duration_since(entry.captured_at) <= SOURCE_CONTROL_CACHE_TTL
    {
        return Ok(entry.paths.clone());
    }

    let runs =
        ChatRun::list_for_session_workspace(pool, session_id, &context.workspace_path_string)
            .await?;
    let paths = collect_paths_from_runs(session_id, &context.workspace_path, &runs)?;
    SESSION_PATH_CACHE.insert(
        key,
        SessionPathCacheEntry {
            captured_at: Instant::now(),
            paths: paths.clone(),
        },
    );
    Ok(paths)
}

async fn collect_shared_paths(
    pool: &SqlitePool,
    context: &WorkspaceContext,
    target_paths: &BTreeSet<String>,
) -> Result<HashMap<String, Vec<Uuid>>> {
    if target_paths.is_empty() {
        return Ok(HashMap::new());
    }

    let sessions = ChatSession::find_by_project(pool, context.project_id).await?;
    let mut by_path = HashMap::<String, BTreeSet<Uuid>>::new();
    for session in sessions.into_iter().filter(|session| {
        session.status == ChatSessionStatus::Active && session.id != context.session_id
    }) {
        let paths = collect_session_paths(pool, session.id, context).await?;
        for path in paths.keys().filter(|path| target_paths.contains(*path)) {
            by_path.entry(path.clone()).or_default().insert(session.id);
        }
    }

    Ok(by_path
        .into_iter()
        .map(|(path, sessions)| (path, sessions.into_iter().collect::<Vec<_>>()))
        .collect())
}

async fn resolve_commit_work_item_ids(
    pool: &SqlitePool,
    project_id: Uuid,
    session_id: Uuid,
    requested_work_item_ids: Option<Vec<Uuid>>,
) -> Result<Vec<Uuid>> {
    let mut ids = match requested_work_item_ids {
        Some(ids) => ids,
        None => ProjectWorkItemExecutionLink::find_by_session_id(pool, session_id)
            .await?
            .into_iter()
            .map(|link| link.project_work_item_id)
            .collect(),
    };
    ids.sort();
    ids.dedup();

    let mut valid_ids = Vec::new();
    for id in ids {
        match ProjectWorkItem::find_by_id(pool, id).await? {
            Some(item) if item.project_id == project_id => valid_ids.push(id),
            _ => {
                return Err(commit_error(
                    SourceControlCommitErrorCode::NotSessionScoped,
                    "Project work item does not belong to this project.",
                    Some(vec![id.to_string()]),
                    None,
                ));
            }
        }
    }
    Ok(valid_ids)
}

fn invalidate_source_control_caches(workspace_path: &str) {
    let path_keys = SESSION_PATH_CACHE
        .iter()
        .filter(|entry| entry.key().workspace_path.as_str() == workspace_path)
        .map(|entry| entry.key().clone())
        .collect::<Vec<_>>();
    for key in path_keys {
        SESSION_PATH_CACHE.remove(&key);
    }

    let status_keys = STATUS_CACHE
        .iter()
        .filter(|entry| entry.key().workspace_path.as_str() == workspace_path)
        .map(|entry| entry.key().clone())
        .collect::<Vec<_>>();
    for key in status_keys {
        STATUS_CACHE.remove(&key);
    }
}

fn invalidate_source_control_session_caches(session_id: Uuid) {
    let path_keys = SESSION_PATH_CACHE
        .iter()
        .filter(|entry| entry.key().session_id == session_id)
        .map(|entry| entry.key().clone())
        .collect::<Vec<_>>();
    for key in path_keys {
        SESSION_PATH_CACHE.remove(&key);
    }

    let status_keys = STATUS_CACHE
        .iter()
        .filter(|entry| entry.key().session_id == session_id)
        .map(|entry| entry.key().clone())
        .collect::<Vec<_>>();
    for key in status_keys {
        STATUS_CACHE.remove(&key);
    }
}

fn collect_paths_from_runs(
    session_id: Uuid,
    workspace_path: &Path,
    runs: &[ChatRun],
) -> Result<BTreeMap<String, SessionPathState>> {
    let mut paths = BTreeMap::<String, SessionPathState>::new();
    for run in runs {
        for entry in load_run_meta_observed_paths(run)? {
            if is_output_text_only_observed_source(&entry.source) {
                continue;
            }
            if let Ok(path) = normalize_workspace_relative_path(&entry.path, workspace_path) {
                if is_artifact_observed_source(&entry.source) && is_openteams_relative_path(&path) {
                    continue;
                }
                let state = paths.entry(path).or_default();
                state.existed_after_run |= entry.existed_after_run;
            }
        }

        if let Some(patch) = read_first_existing_file(&run_scoped_diff_paths(run)) {
            for path in parse_diff_patch_paths(&patch, workspace_path) {
                paths.entry(path).or_insert(SessionPathState {
                    existed_after_run: true,
                });
            }
        }

        for dir in run_scoped_untracked_dirs(run) {
            for path in collect_relative_file_paths(&dir) {
                if let Ok(path) = normalize_workspace_relative_path(&path, workspace_path) {
                    paths.entry(path).or_insert(SessionPathState {
                        existed_after_run: true,
                    });
                }
            }
        }
    }

    let run_ids = runs.iter().map(|run| run.id).collect::<HashSet<_>>();
    for line in load_work_record_lines(session_id)? {
        if !run_ids.contains(&line.run_id) || !line.message_type.eq_ignore_ascii_case("artifact") {
            continue;
        }
        for path in extract_workspace_paths_from_text(&line.content, workspace_path) {
            if is_openteams_relative_path(&path) {
                continue;
            }
            paths.entry(path).or_default();
        }
    }

    Ok(paths)
}

fn load_run_meta_observed_paths(run: &ChatRun) -> Result<Vec<WorkspaceObservedPathRecord>> {
    let meta_path = run
        .meta_path
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(&run.run_dir).join("meta.json"));
    if !meta_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(meta_path)?;
    Ok(serde_json::from_str::<RunMetaFile>(&content)
        .map(|meta| meta.workspace_observed_paths)
        .unwrap_or_default())
}

fn run_scoped_diff_paths(run: &ChatRun) -> [PathBuf; 3] {
    let run_dir = PathBuf::from(&run.run_dir);
    [
        run_dir.join(format!(
            "session_agent_{}_run_{:04}_diff.patch",
            run.session_agent_id, run.run_index
        )),
        run_dir.join(format!("run_{:04}_diff.patch", run.run_index)),
        run_dir.join("diff.patch"),
    ]
}

fn run_scoped_untracked_dirs(run: &ChatRun) -> [PathBuf; 3] {
    let run_dir = PathBuf::from(&run.run_dir);
    [
        run_dir.join(format!(
            "session_agent_{}_run_{:04}_untracked",
            run.session_agent_id, run.run_index
        )),
        run_dir.join(format!("run_{:04}_untracked", run.run_index)),
        run_dir.join("untracked"),
    ]
}

fn read_first_existing_file(paths: &[PathBuf]) -> Option<String> {
    paths.iter().find_map(|path| fs::read_to_string(path).ok())
}

fn parse_diff_patch_paths(patch: &str, workspace_path: &Path) -> Vec<String> {
    patch
        .lines()
        .filter_map(|line| {
            let rest = line.strip_prefix("diff --git a/")?;
            let (old_path, new_path) = rest.split_once(" b/")?;
            let preferred = if new_path == "/dev/null" {
                old_path
            } else {
                new_path
            };
            normalize_workspace_relative_path(preferred, workspace_path).ok()
        })
        .collect()
}

fn collect_relative_file_paths(root: &Path) -> Vec<String> {
    fn walk(dir: &Path, root: &Path, result: &mut Vec<String>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                walk(&path, root, result);
            } else if file_type.is_file()
                && let Ok(relative) = path.strip_prefix(root)
            {
                result.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }

    let mut result = Vec::new();
    if root.exists() {
        walk(root, root, &mut result);
    }
    result
}

fn load_work_record_lines(session_id: Uuid) -> Result<Vec<WorkRecordJsonLine>> {
    let path = asset_dir()
        .join("chat")
        .join(format!("session_{session_id}"))
        .join("protocol")
        .join("work_records.jsonl");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path)?;
    Ok(content
        .lines()
        .filter_map(|line| serde_json::from_str::<WorkRecordJsonLine>(line).ok())
        .collect())
}

fn extract_workspace_paths_from_text(text: &str, workspace_path: &Path) -> Vec<String> {
    text.split_whitespace()
        .filter_map(|token| normalize_workspace_relative_path(token, workspace_path).ok())
        .collect()
}

fn normalize_workspace_relative_path(
    raw: &str,
    workspace_root: &Path,
) -> std::result::Result<String, String> {
    let trimmed = trim_path_token(raw);
    if trimmed.is_empty() {
        return Err("Path is empty.".to_string());
    }
    let candidate = PathBuf::from(&trimmed);
    let relative = if candidate.is_absolute() {
        candidate
            .strip_prefix(workspace_root)
            .map_err(|_| "Path is outside the workspace.".to_string())?
            .to_path_buf()
    } else {
        candidate
    };
    normalize_relative_components(&relative)
}

fn validate_relative_path(raw: &str) -> std::result::Result<String, String> {
    let trimmed = trim_path_token(raw);
    if trimmed.is_empty() {
        return Err("Path is empty.".to_string());
    }
    let path = PathBuf::from(&trimmed);
    if path.is_absolute() {
        return Err("Path must be relative to the workspace.".to_string());
    }
    normalize_relative_components(&path)
}

fn trim_path_token(raw: &str) -> String {
    raw.trim()
        .trim_matches(|ch: char| {
            matches!(
                ch,
                '`' | '"' | '\'' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | ';'
            )
        })
        .trim_end_matches(['.', ':', '!', '?'])
        .replace('\\', "/")
}

fn normalize_relative_components(path: &Path) -> std::result::Result<String, String> {
    let mut normalized = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let part = part.to_string_lossy();
                if part.chars().any(|ch| ch == '\0' || ch.is_control()) {
                    return Err("Path contains invalid characters.".to_string());
                }
                normalized.push(part.to_string());
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Path cannot leave the workspace.".to_string());
            }
        }
    }
    if normalized.is_empty() {
        return Err("Path is empty.".to_string());
    }
    Ok(normalized.join("/"))
}

fn build_plain_files(
    workspace_path: &Path,
    paths: BTreeMap<String, SessionPathState>,
) -> Vec<SourceControlFile> {
    paths
        .into_iter()
        .filter_map(|(path, state)| {
            let absolute_path = workspace_path.join(&path);
            let status = match fs::metadata(&absolute_path) {
                Ok(metadata) if metadata.is_file() => SourceControlFileStatus::Modified,
                _ if state.existed_after_run => SourceControlFileStatus::Deleted,
                _ => return None,
            };
            let (is_too_large, is_binary) = file_flags(&absolute_path);
            Some(SourceControlFile {
                path,
                old_path: None,
                status,
                additions: 0,
                deletions: 0,
                has_diff: false,
                is_binary,
                is_too_large,
                shared: false,
                shared_session_ids: Vec::new(),
                blocked_reason: None,
            })
        })
        .collect()
}

fn normalize_status_entries(entries: Vec<StatusEntry>) -> Vec<StatusPathEntry> {
    entries
        .into_iter()
        .filter_map(|entry| {
            let path = normalize_status_path(&entry.path)?;
            let old_path = entry.orig_path.as_deref().and_then(normalize_status_path);
            Some(StatusPathEntry {
                path,
                old_path,
                staged: entry.staged,
                unstaged: entry.unstaged,
                is_untracked: entry.is_untracked,
            })
        })
        .collect()
}

fn normalize_status_path(path: &[u8]) -> Option<String> {
    validate_relative_path(&String::from_utf8_lossy(path)).ok()
}

fn source_file_from_status(
    workspace_path: &Path,
    entry: &StatusPathEntry,
    area: GitArea,
    shared_paths: &HashMap<String, Vec<Uuid>>,
) -> SourceControlFile {
    let status = match area {
        GitArea::Changes if entry.is_untracked => SourceControlFileStatus::Untracked,
        GitArea::Changes => status_from_code(entry.unstaged),
        GitArea::Staged => status_from_code(entry.staged),
    };
    let (additions, deletions, has_text_diff) =
        diff_stats(workspace_path, &entry.path, area, entry.is_untracked);
    let absolute_path = workspace_path.join(&entry.path);
    let (is_too_large, is_binary) = file_flags(&absolute_path);
    let shared_session_ids = shared_paths.get(&entry.path).cloned().unwrap_or_default();
    let blocked_reason =
        (!shared_session_ids.is_empty()).then(|| "Shared with another active session.".to_string());

    SourceControlFile {
        path: entry.path.clone(),
        old_path: entry.old_path.clone(),
        status,
        additions,
        deletions,
        has_diff: has_text_diff && !is_too_large && !is_binary,
        is_binary,
        is_too_large,
        shared: !shared_session_ids.is_empty(),
        shared_session_ids,
        blocked_reason,
    }
}

fn status_from_code(code: char) -> SourceControlFileStatus {
    match code {
        'A' => SourceControlFileStatus::Added,
        'D' => SourceControlFileStatus::Deleted,
        'R' => SourceControlFileStatus::Renamed,
        'C' => SourceControlFileStatus::Copied,
        'T' => SourceControlFileStatus::TypeChanged,
        '?' => SourceControlFileStatus::Untracked,
        _ => SourceControlFileStatus::Modified,
    }
}

fn diff_stats(
    workspace_path: &Path,
    path: &str,
    area: GitArea,
    is_untracked: bool,
) -> (usize, usize, bool) {
    if matches!(area, GitArea::Changes) && is_untracked {
        return fs::read_to_string(workspace_path.join(path))
            .map(|content| (content.lines().count(), 0, true))
            .unwrap_or((0, 0, false));
    }

    let mut args = vec![
        "-c".to_string(),
        "core.quotepath=false".to_string(),
        "diff".to_string(),
        "--numstat".to_string(),
    ];
    if matches!(area, GitArea::Staged) {
        args.push("--cached".to_string());
    }
    args.push("--".to_string());
    args.push(path.to_string());
    let output = GitCli::new().git(workspace_path, args).unwrap_or_default();
    parse_numstat(&output).unwrap_or((0, 0, !output.trim().is_empty()))
}

fn parse_numstat(output: &str) -> Option<(usize, usize, bool)> {
    let line = output.lines().find(|line| !line.trim().is_empty())?;
    let mut parts = line.split('\t');
    let additions = parts.next()?;
    let deletions = parts.next()?;
    if additions == "-" || deletions == "-" {
        return Some((0, 0, false));
    }
    Some((additions.parse().ok()?, deletions.parse().ok()?, true))
}

fn old_path_from_diff(diff: &str) -> Option<String> {
    diff.lines().find_map(|line| {
        line.strip_prefix("rename from ")
            .or_else(|| line.strip_prefix("copy from "))
            .and_then(|path| validate_relative_path(path).ok())
    })
}

fn file_flags(path: &Path) -> (bool, bool) {
    let is_too_large = fs::metadata(path)
        .map(|metadata| metadata.len() > MAX_INLINE_DIFF_BYTES)
        .unwrap_or(false);
    let is_binary = fs::read(path)
        .map(|bytes| bytes.iter().take(8192).any(|byte| *byte == 0))
        .unwrap_or(false);
    (is_too_large, is_binary)
}

fn is_untracked_path(workspace_path: &Path, path: &str) -> bool {
    GitCli::new()
        .get_worktree_status(workspace_path)
        .map(|status| {
            status.entries.into_iter().any(|entry| {
                entry.is_untracked && normalize_status_path(&entry.path).as_deref() == Some(path)
            })
        })
        .unwrap_or(false)
}

fn plain_diff_response(
    workspace_path: &Path,
    path: &str,
    area: SourceControlDiffArea,
) -> Result<SourceControlDiffResponse> {
    let absolute_path = workspace_path.join(path);
    let (is_too_large, is_binary) = file_flags(&absolute_path);
    Ok(SourceControlDiffResponse {
        path: path.to_string(),
        old_path: None,
        area,
        base_label: "session".to_string(),
        compare_label: "workspace".to_string(),
        unified_diff: None,
        additions: 0,
        deletions: 0,
        is_binary,
        is_too_large,
        content_omitted: true,
        message: Some("Plain workspaces do not provide Git diffs.".to_string()),
    })
}

fn git_diff_response(
    workspace_path: &Path,
    path: &str,
    area: SourceControlDiffArea,
) -> Result<SourceControlDiffResponse> {
    let absolute_path = workspace_path.join(path);
    let (is_too_large, is_binary) = file_flags(&absolute_path);
    if is_too_large || is_binary {
        return Ok(SourceControlDiffResponse {
            path: path.to_string(),
            old_path: None,
            area,
            base_label: diff_base_label(area).to_string(),
            compare_label: diff_compare_label(area).to_string(),
            unified_diff: None,
            additions: 0,
            deletions: 0,
            is_binary,
            is_too_large,
            content_omitted: true,
            message: Some("File is binary or too large for inline diff.".to_string()),
        });
    }

    let is_untracked =
        area == SourceControlDiffArea::Changes && is_untracked_path(workspace_path, path);
    if is_untracked {
        let content = fs::read_to_string(&absolute_path).unwrap_or_default();
        return Ok(SourceControlDiffResponse {
            path: path.to_string(),
            old_path: None,
            area,
            base_label: "empty".to_string(),
            compare_label: "worktree".to_string(),
            unified_diff: Some(create_unified_diff(path, "", &content)),
            additions: content.lines().count(),
            deletions: 0,
            is_binary: false,
            is_too_large: false,
            content_omitted: false,
            message: None,
        });
    }

    let mut args = vec![
        "-c".to_string(),
        "core.quotepath=false".to_string(),
        "diff".to_string(),
        "--no-color".to_string(),
        "-M".to_string(),
    ];
    if area == SourceControlDiffArea::Staged {
        args.push("--cached".to_string());
    }
    args.push("--".to_string());
    args.push(path.to_string());
    let diff = GitCli::new().git(workspace_path, args)?;
    let git_area = if area == SourceControlDiffArea::Staged {
        GitArea::Staged
    } else {
        GitArea::Changes
    };
    let (additions, deletions, _) = diff_stats(workspace_path, path, git_area, is_untracked);
    let old_path = old_path_from_diff(&diff);
    Ok(SourceControlDiffResponse {
        path: path.to_string(),
        old_path,
        area,
        base_label: diff_base_label(area).to_string(),
        compare_label: diff_compare_label(area).to_string(),
        unified_diff: (!diff.trim().is_empty()).then_some(diff),
        additions,
        deletions,
        is_binary: false,
        is_too_large: false,
        content_omitted: false,
        message: None,
    })
}

fn diff_base_label(area: SourceControlDiffArea) -> &'static str {
    match area {
        SourceControlDiffArea::Changes => "index",
        SourceControlDiffArea::Staged => "HEAD",
    }
}

fn diff_compare_label(area: SourceControlDiffArea) -> &'static str {
    match area {
        SourceControlDiffArea::Changes => "worktree",
        SourceControlDiffArea::Staged => "index",
    }
}

fn git_with_paths(
    workspace_path: &Path,
    args: &[&str],
    paths: &[String],
) -> std::result::Result<(), GitCliError> {
    let mut command = args.iter().map(OsString::from).collect::<Vec<_>>();
    command.push("--".into());
    command.extend(paths.iter().map(OsString::from));
    GitCli::new().git(workspace_path, command).map(|_| ())
}

fn discard_path(workspace_path: &Path, path: &str) -> std::result::Result<(), GitCliError> {
    if is_untracked_path(workspace_path, path) {
        let absolute_path = workspace_path.join(path);
        fs::remove_file(&absolute_path).map_err(|err| GitCliError::CommandFailed(err.to_string()))
    } else {
        git_with_paths(
            workspace_path,
            &["restore", "--worktree"],
            &[path.to_string()],
        )
    }
}

fn staged_paths(workspace_path: &Path) -> Result<Vec<String>> {
    let mut paths =
        normalize_status_entries(GitCli::new().get_worktree_status(workspace_path)?.entries)
            .into_iter()
            .filter(|entry| entry.staged != ' ' && !entry.is_untracked)
            .map(|entry| entry.path)
            .collect::<Vec<_>>();
    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn normalize_path_set(paths: &[String]) -> std::result::Result<BTreeSet<String>, String> {
    paths
        .iter()
        .map(|path| validate_relative_path(path))
        .collect::<std::result::Result<BTreeSet<_>, _>>()
}

fn dedup_paths(paths: Vec<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn operation_failure(
    path: String,
    code: SourceControlOperationFailureCode,
    message: impl Into<String>,
) -> SourceControlOperationFailure {
    SourceControlOperationFailure {
        path,
        code,
        message: message.into(),
    }
}

fn commit_error(
    code: SourceControlCommitErrorCode,
    message: impl Into<String>,
    conflicting_paths: Option<Vec<String>>,
    status: Option<SessionSourceControlStatus>,
) -> SourceControlError {
    SourceControlError::Commit(Box::new(SourceControlCommitError {
        code,
        message: message.into(),
        conflicting_paths,
        status,
    }))
}

fn current_head_sha(workspace_path: &Path) -> Option<String> {
    GitService::new()
        .get_head_info(workspace_path)
        .ok()
        .map(|head| head.oid)
}

fn current_branch(workspace_path: &Path) -> Option<String> {
    GitService::new()
        .get_head_info(workspace_path)
        .ok()
        .map(|head| head.branch)
}

fn is_detached_head(workspace_path: &Path) -> bool {
    git2::Repository::open(workspace_path)
        .ok()
        .and_then(|repo| repo.head().ok().map(|head| !head.is_branch()))
        .unwrap_or(false)
}

fn commit_with_default_identity(workspace_path: &Path, message: &str) -> Result<()> {
    let repo = git2::Repository::open(workspace_path)
        .map_err(|err| SourceControlError::WorkspaceNotAccessible(err.to_string()))?;
    let cfg = repo.config().map_err(|err| {
        SourceControlError::WorkspaceNotAccessible(format!("Unable to read Git config: {err}"))
    })?;
    let mut args = Vec::<OsString>::new();
    if cfg.get_string("user.name").is_err() {
        args.push("-c".into());
        args.push("user.name=openteams".into());
    }
    if cfg.get_string("user.email").is_err() {
        args.push("-c".into());
        args.push("user.email=noreply@openteams.com".into());
    }
    args.push("commit".into());
    args.push("-m".into());
    args.push(OsString::from(message));
    GitCli::new().git(workspace_path, args)?;
    Ok(())
}

#[allow(dead_code)]
fn line_stats_from_content(old: &str, new: &str) -> (usize, usize) {
    compute_line_change_counts(old, new)
}
