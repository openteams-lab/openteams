use std::{
    collections::{BTreeMap, HashSet},
    path::{Component, PathBuf},
    sync::LazyLock,
};

use axum::{
    Extension, Json,
    extract::{
        Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::{IntoResponse, Json as ResponseJson},
};
use chrono::{DateTime, Utc};
use db::models::{
    analytics::AnalyticsSessionStats,
    chat_agent::ChatAgent,
    chat_run::ChatRun,
    chat_session::{ChatSession, ChatSessionStatus, CreateChatSession, UpdateChatSession},
    chat_session_agent::{ChatSessionAgent, CreateChatSessionAgent},
};
use deployment::Deployment;
use git::{Commit, DiffTarget, GitCli, GitService};
use regex::Regex;
use serde::{Deserialize, Serialize};
use services::services::analytics_events::{
    AnalyticsProjector, DomainEvent, extract_executor_profile_variant,
};
use sqlx::FromRow;
use ts_rs::TS;
use utils::{
    assets::asset_dir,
    diff::{Diff, DiffChangeKind, create_unified_diff},
    response::ApiResponse,
};
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize, TS)]
pub struct ChatSessionListQuery {
    pub status: Option<ChatSessionStatus>,
}

pub async fn get_sessions(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ChatSessionListQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatSession>>>, ApiError> {
    let sessions = ChatSession::find_all(&deployment.db().pool, query.status).await?;
    Ok(ResponseJson(ApiResponse::success(sessions)))
}

pub async fn get_session(
    Extension(session): Extension<ChatSession>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(session)))
}

pub async fn create_session(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateChatSession>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    let session = ChatSession::create(&deployment.db().pool, &payload, Uuid::new_v4()).await?;

    let analytics_projector = AnalyticsProjector::new(
        &deployment.db().pool,
        deployment.analytics().as_ref(),
        deployment.analytics_enabled(),
    );
    let title_length = payload.title.as_ref().map(|t| t.len()).unwrap_or(0);
    analytics_projector
        .project_or_warn(DomainEvent::SessionCreated {
            session_id: session.id,
            actor_user_id: deployment.user_id().to_string(),
            title_length,
        })
        .await;

    // Initialize session stats
    let _ = AnalyticsSessionStats::upsert(&deployment.db().pool, session.id, None).await;

    Ok(ResponseJson(ApiResponse::success(session)))
}

pub async fn update_session(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<UpdateChatSession>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    let updated = ChatSession::update(&deployment.db().pool, session.id, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn delete_session(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    // Check if session had messages before deletion
    let had_messages = AnalyticsSessionStats::find_by_id(&deployment.db().pool, session.id)
        .await
        .ok()
        .flatten()
        .map(|stats| stats.message_count > 0)
        .unwrap_or(false);

    let rows_affected = ChatSession::delete(&deployment.db().pool, session.id).await?;
    if rows_affected == 0 {
        return Err(ApiError::Database(sqlx::Error::RowNotFound));
    }

    let analytics_projector = AnalyticsProjector::new(
        &deployment.db().pool,
        deployment.analytics().as_ref(),
        deployment.analytics_enabled(),
    );
    analytics_projector
        .project_or_warn(DomainEvent::SessionDeleted {
            session_id: session.id,
            actor_user_id: deployment.user_id().to_string(),
            had_messages,
        })
        .await;

    Ok(ResponseJson(ApiResponse::success(())))
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateChatSessionAgentRequest {
    pub agent_id: Uuid,
    pub workspace_path: Option<String>,
    pub allowed_skill_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateChatSessionAgentRequest {
    pub workspace_path: Option<String>,
    pub allowed_skill_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct SessionWorkspace {
    pub workspace_path: String,
    pub agent_ids: Vec<Uuid>,
    pub agent_names: Vec<String>,
    pub is_git_repo: bool,
}

#[derive(Debug, Serialize, TS)]
pub struct SessionWorkspacesResponse {
    pub workspaces: Vec<SessionWorkspace>,
}

#[derive(Debug, Deserialize, TS)]
pub struct SessionWorkspaceChangesQuery {
    pub path: String,
    pub include_diff: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, TS)]
pub struct WorkspaceChangedFile {
    pub path: String,
    pub additions: usize,
    pub deletions: usize,
    pub unified_diff: Option<String>,
    /// Whether a diff can be generated for this file (false for files in .gitignore'd directories).
    pub has_diff: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, TS)]
pub struct WorkspacePathEntry {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, TS)]
pub struct WorkspaceChanges {
    pub modified: Vec<WorkspaceChangedFile>,
    pub added: Vec<WorkspaceChangedFile>,
    pub deleted: Vec<WorkspacePathEntry>,
    pub untracked: Vec<WorkspacePathEntry>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct WorkspaceChangesResponse {
    pub workspace_path: String,
    pub is_git_repo: bool,
    pub changes: Option<WorkspaceChanges>,
    pub error: Option<String>,
}

#[derive(Debug, FromRow)]
struct SessionWorkspaceRow {
    workspace_path: String,
    agent_id: Uuid,
    agent_name: String,
}

#[derive(Debug, Deserialize)]
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
    message_type: String,
    content: String,
}

#[derive(Debug, Clone)]
struct PlainWorkspaceObservedPath {
    existed_after_run: bool,
}

static INLINE_CODE_PATH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"`([^`\r\n]+)`").expect("inline code path regex"));

const PATH_LIKE_EXTENSIONS: &[&str] = &[
    "c", "cc", "cpp", "cs", "css", "go", "h", "hpp", "html", "java", "js", "json", "jsx", "md",
    "mjs", "py", "rb", "rs", "scss", "sh", "sql", "svg", "toml", "ts", "tsx", "txt", "vue", "xml",
    "yaml", "yml",
];

fn build_session_workspaces(rows: Vec<SessionWorkspaceRow>) -> Vec<SessionWorkspace> {
    let mut grouped = BTreeMap::<String, SessionWorkspace>::new();

    for row in rows {
        let workspace = grouped
            .entry(row.workspace_path.clone())
            .or_insert_with(|| SessionWorkspace {
                workspace_path: row.workspace_path.clone(),
                agent_ids: Vec::new(),
                agent_names: Vec::new(),
                is_git_repo: git2::Repository::open(&row.workspace_path).is_ok(),
            });

        if !workspace.agent_ids.contains(&row.agent_id) {
            workspace.agent_ids.push(row.agent_id);
        }

        if !workspace.agent_names.contains(&row.agent_name) {
            workspace.agent_names.push(row.agent_name);
        }
    }

    grouped.into_values().collect()
}

fn empty_workspace_changes() -> WorkspaceChanges {
    WorkspaceChanges {
        modified: Vec::new(),
        added: Vec::new(),
        deleted: Vec::new(),
        untracked: Vec::new(),
    }
}

fn diff_primary_path(diff: &Diff) -> String {
    GitService::diff_path(diff)
}

fn diff_to_workspace_changed_file(
    diff: Diff,
    path: String,
    include_diff: bool,
) -> WorkspaceChangedFile {
    let additions = diff.additions.unwrap_or(0);
    let deletions = diff.deletions.unwrap_or(0);
    let unified_diff = if include_diff {
        Some(match (&diff.old_content, &diff.new_content) {
            (Some(old_content), Some(new_content)) => {
                create_unified_diff(&path, old_content, new_content)
            }
            (Some(old_content), None) => create_unified_diff(&path, old_content, ""),
            (None, Some(new_content)) => create_unified_diff(&path, "", new_content),
            (None, None) => String::new(),
        })
    } else {
        None
    };

    WorkspaceChangedFile {
        path,
        additions,
        deletions,
        unified_diff,
        has_diff: true,
    }
}

fn build_workspace_changes(
    diffs: Vec<Diff>,
    untracked_paths: &HashSet<String>,
    include_diff: bool,
) -> WorkspaceChanges {
    let mut changes = empty_workspace_changes();

    for diff in diffs {
        let path = diff_primary_path(&diff);
        if path.is_empty() {
            continue;
        }

        if untracked_paths.contains(&path) {
            changes.untracked.push(WorkspacePathEntry { path });
            continue;
        }

        match diff.change {
            DiffChangeKind::Added => {
                changes
                    .added
                    .push(diff_to_workspace_changed_file(diff, path, include_diff));
            }
            DiffChangeKind::Deleted => {
                changes.deleted.push(WorkspacePathEntry { path });
            }
            DiffChangeKind::Modified
            | DiffChangeKind::Renamed
            | DiffChangeKind::Copied
            | DiffChangeKind::PermissionChange => {
                changes
                    .modified
                    .push(diff_to_workspace_changed_file(diff, path, include_diff));
            }
        }
    }

    changes.modified.sort_by(|a, b| a.path.cmp(&b.path));
    changes.added.sort_by(|a, b| a.path.cmp(&b.path));
    changes.deleted.sort_by(|a, b| a.path.cmp(&b.path));
    changes.untracked.sort_by(|a, b| a.path.cmp(&b.path));
    changes.untracked.dedup_by(|a, b| a.path == b.path);

    changes
}

fn looks_like_workspace_path(candidate: &str) -> bool {
    if candidate.is_empty() || candidate.contains("://") {
        return false;
    }

    if candidate.contains('/') || candidate.contains('\\') {
        return true;
    }

    PathBuf::from(candidate)
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| {
            PATH_LIKE_EXTENSIONS
                .iter()
                .any(|allowed| allowed.eq_ignore_ascii_case(extension))
        })
        .unwrap_or(false)
}

fn is_internal_openteams_runtime_path(path: &std::path::Path) -> bool {
    let components = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            Component::CurDir => None,
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => None,
        })
        .collect::<Vec<_>>();

    match components.as_slice() {
        [openteams, runs, ..] if openteams == ".openteams" && runs == "runs" => true,
        [openteams, context, _session_id, file]
            if openteams == ".openteams"
                && context == "context"
                && matches!(
                    file.as_str(),
                    "messages.jsonl"
                        | "messages_compacted.background.jsonl"
                        | "shared_blackboard.jsonl"
                        | "work_records.jsonl"
                ) =>
        {
            true
        }
        [openteams, context, _session_id, internal_dir, ..]
            if openteams == ".openteams"
                && context == "context"
                && matches!(internal_dir.as_str(), "attachments" | "references") =>
        {
            true
        }
        _ => false,
    }
}

fn normalize_workspace_relative_path(
    raw: &str,
    workspace_root: &std::path::Path,
) -> Option<String> {
    let trimmed = raw
        .trim()
        .trim_matches(|ch: char| {
            matches!(
                ch,
                '`' | '"' | '\'' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | ';'
            )
        })
        .trim_end_matches(|ch: char| matches!(ch, '.' | ':' | '!' | '?'));

    if trimmed.is_empty() || !looks_like_workspace_path(trimmed) {
        return None;
    }

    let candidate = PathBuf::from(trimmed);
    let relative = if candidate.is_absolute() {
        candidate.strip_prefix(workspace_root).ok()?.to_path_buf()
    } else {
        candidate
    };

    if is_internal_openteams_runtime_path(&relative) {
        return None;
    }

    let mut normalized = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => normalized.push(part.to_string_lossy().to_string()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    if normalized.is_empty() {
        return None;
    }

    Some(normalized.join("/"))
}

fn extract_workspace_paths_from_text(
    text: &str,
    workspace_root: &std::path::Path,
) -> HashSet<String> {
    let mut candidates = Vec::new();

    for capture in INLINE_CODE_PATH_RE.captures_iter(text) {
        if let Some(matched) = capture.get(1) {
            candidates.push(matched.as_str().to_string());
        }
    }

    for token in text.split_whitespace() {
        candidates.push(token.to_string());
    }

    candidates
        .into_iter()
        .filter_map(|candidate| normalize_workspace_relative_path(&candidate, workspace_root))
        .collect()
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
    for path in paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            return Some(content);
        }
    }
    None
}

fn parse_diff_patch_paths(patch: &str, workspace_root: &std::path::Path) -> HashSet<String> {
    let mut paths = HashSet::new();

    for line in patch.lines() {
        let Some(rest) = line.strip_prefix("diff --git a/") else {
            continue;
        };
        let Some((old_path, new_path)) = rest.split_once(" b/") else {
            continue;
        };
        let preferred = if new_path == "/dev/null" {
            old_path
        } else {
            new_path
        };
        if let Some(path) = normalize_workspace_relative_path(preferred, workspace_root) {
            paths.insert(path);
        }
    }

    paths
}

fn collect_relative_file_paths(root: &std::path::Path) -> HashSet<String> {
    fn walk(dir: &std::path::Path, root: &std::path::Path, result: &mut HashSet<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                walk(&path, root, result);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            if let Ok(relative) = path.strip_prefix(root) {
                let normalized = relative.to_string_lossy().replace('\\', "/");
                if !normalized.is_empty() {
                    result.insert(normalized);
                }
            }
        }
    }

    let mut result = HashSet::new();
    if root.exists() {
        walk(root, root, &mut result);
    }
    result
}

fn load_run_meta_observed_paths(run: &ChatRun) -> Vec<WorkspaceObservedPathRecord> {
    let meta_path = run
        .meta_path
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(&run.run_dir).join("meta.json"));
    let Ok(content) = std::fs::read_to_string(meta_path) else {
        return Vec::new();
    };
    serde_json::from_str::<RunMetaFile>(&content)
        .map(|meta| meta.workspace_observed_paths)
        .unwrap_or_default()
}

fn load_work_record_lines(session_id: Uuid) -> Vec<WorkRecordJsonLine> {
    let path = asset_dir()
        .join("chat")
        .join(format!("session_{session_id}"))
        .join("protocol")
        .join("work_records.jsonl");
    let Ok(content) = std::fs::read_to_string(path) else {
        return Vec::new();
    };

    content
        .lines()
        .filter_map(|line| serde_json::from_str::<WorkRecordJsonLine>(line).ok())
        .collect()
}

fn collect_session_git_path_union(
    workspace_path: &std::path::Path,
    runs: &[ChatRun],
) -> HashSet<String> {
    let mut union = HashSet::new();

    for run in runs {
        let meta_paths = load_run_meta_observed_paths(run);
        let mut added_from_meta = false;
        for entry in meta_paths {
            let is_git_source = entry
                .source
                .split(',')
                .any(|source| matches!(source.trim(), "git_diff" | "git_untracked"));
            if !is_git_source {
                continue;
            }
            if let Some(path) = normalize_workspace_relative_path(&entry.path, workspace_path) {
                union.insert(path);
                added_from_meta = true;
            }
        }

        if added_from_meta {
            continue;
        }

        if let Some(patch) = read_first_existing_file(&run_scoped_diff_paths(run)) {
            union.extend(parse_diff_patch_paths(&patch, workspace_path));
        }

        for dir in run_scoped_untracked_dirs(run) {
            union.extend(collect_relative_file_paths(&dir));
        }
    }

    union
}

fn collect_session_plain_observed_paths(
    session_id: Uuid,
    workspace_path: &std::path::Path,
    runs: &[ChatRun],
) -> BTreeMap<String, PlainWorkspaceObservedPath> {
    let work_records = load_work_record_lines(session_id);
    let mut observed = BTreeMap::<String, PlainWorkspaceObservedPath>::new();

    for run in runs {
        let meta_paths = load_run_meta_observed_paths(run);
        for entry in meta_paths {
            if let Some(path) = normalize_workspace_relative_path(&entry.path, workspace_path) {
                let state = observed.entry(path).or_insert(PlainWorkspaceObservedPath {
                    existed_after_run: false,
                });
                state.existed_after_run |= entry.existed_after_run;
            }
        }

        for record in work_records.iter().filter(|record| {
            record.run_id == run.id && record.message_type.eq_ignore_ascii_case("artifact")
        }) {
            for path in extract_workspace_paths_from_text(&record.content, workspace_path) {
                observed.entry(path).or_insert(PlainWorkspaceObservedPath {
                    existed_after_run: false,
                });
            }
        }

        if let Some(output_path) = run.output_path.as_deref()
            && let Ok(content) = std::fs::read_to_string(output_path)
        {
            for path in extract_workspace_paths_from_text(&content, workspace_path) {
                observed.entry(path).or_insert(PlainWorkspaceObservedPath {
                    existed_after_run: false,
                });
            }
        }
    }

    observed
}

fn build_plain_workspace_changes(
    workspace_path: &std::path::Path,
    observed: BTreeMap<String, PlainWorkspaceObservedPath>,
    first_run_at: Option<DateTime<Utc>>,
) -> WorkspaceChanges {
    let mut changes = empty_workspace_changes();

    for (relative_path, state) in observed {
        let absolute_path = workspace_path.join(&relative_path);
        match std::fs::metadata(&absolute_path) {
            Ok(metadata) if metadata.is_file() => {
                let modified_at = metadata.modified().ok().map(DateTime::<Utc>::from);
                if let (Some(modified_at), Some(first_run_at)) =
                    (modified_at, first_run_at.as_ref())
                    && modified_at < *first_run_at
                {
                    continue;
                }

                let created_after_session = first_run_at
                    .as_ref()
                    .and_then(|first_run_at| {
                        metadata
                            .created()
                            .ok()
                            .map(DateTime::<Utc>::from)
                            .map(|created_at| created_at >= *first_run_at)
                    })
                    .unwrap_or(false);

                let entry = WorkspaceChangedFile {
                    path: relative_path,
                    additions: 0,
                    deletions: 0,
                    unified_diff: None,
                    has_diff: false,
                };
                if created_after_session {
                    changes.added.push(entry);
                } else {
                    changes.modified.push(entry);
                }
            }
            _ if state.existed_after_run => {
                changes.deleted.push(WorkspacePathEntry {
                    path: relative_path,
                });
            }
            _ => {}
        }
    }

    changes.modified.sort_by(|a, b| a.path.cmp(&b.path));
    changes.added.sort_by(|a, b| a.path.cmp(&b.path));
    changes.deleted.sort_by(|a, b| a.path.cmp(&b.path));
    changes
}

fn collect_session_scoped_git_changes(
    session_id: Uuid,
    workspace_path: &std::path::Path,
    runs: &[ChatRun],
    include_diff: bool,
) -> WorkspaceChangesResponse {
    let session_paths = collect_session_git_path_union(workspace_path, runs);

    // Also collect all observed paths (including those in .gitignore'd directories)
    // so we can fall back to plain file logic for files git cannot see.
    let all_observed = collect_session_plain_observed_paths(session_id, workspace_path, runs);
    let first_run_at = runs.iter().map(|run| run.created_at).min();

    if session_paths.is_empty() {
        // No git-tracked changes, but there may be files in .gitignore'd directories.
        let plain_changes =
            build_plain_workspace_changes(workspace_path, all_observed, first_run_at);
        return WorkspaceChangesResponse {
            workspace_path: workspace_path.to_string_lossy().to_string(),
            is_git_repo: true,
            changes: Some(plain_changes),
            error: None,
        };
    }

    let git_service = GitService::new();
    let git_cli = GitCli::new();

    let head_info = match git_service.get_head_info(workspace_path) {
        Ok(head_info) => head_info,
        Err(err) => {
            return WorkspaceChangesResponse {
                workspace_path: workspace_path.to_string_lossy().to_string(),
                is_git_repo: true,
                changes: None,
                error: Some(err.to_string()),
            };
        }
    };

    let head_oid = match git2::Oid::from_str(&head_info.oid) {
        Ok(oid) => oid,
        Err(err) => {
            return WorkspaceChangesResponse {
                workspace_path: workspace_path.to_string_lossy().to_string(),
                is_git_repo: true,
                changes: None,
                error: Some(err.to_string()),
            };
        }
    };

    let untracked_paths = match git_cli.get_worktree_status(workspace_path) {
        Ok(status) => status
            .entries
            .into_iter()
            .filter(|entry| entry.is_untracked)
            .map(|entry| String::from_utf8_lossy(&entry.path).replace('\\', "/"))
            .filter(|path| session_paths.contains(path))
            .collect::<HashSet<_>>(),
        Err(err) => {
            return WorkspaceChangesResponse {
                workspace_path: workspace_path.to_string_lossy().to_string(),
                is_git_repo: true,
                changes: None,
                error: Some(err.to_string()),
            };
        }
    };

    let path_filter = session_paths.iter().map(String::as_str).collect::<Vec<_>>();
    let head_commit = Commit::new(head_oid);
    let diffs = if path_filter.is_empty() {
        Vec::new()
    } else {
        match git_service.get_diffs(
            DiffTarget::Worktree {
                worktree_path: workspace_path,
                base_commit: &head_commit,
            },
            Some(&path_filter),
        ) {
            Ok(diffs) => diffs
                .into_iter()
                .filter(|diff| session_paths.contains(&diff_primary_path(diff)))
                .collect::<Vec<_>>(),
            Err(err) => {
                return WorkspaceChangesResponse {
                    workspace_path: workspace_path.to_string_lossy().to_string(),
                    is_git_repo: true,
                    changes: None,
                    error: Some(err.to_string()),
                };
            }
        }
    };

    let mut git_changes = build_workspace_changes(diffs, &untracked_paths, include_diff);

    // Find observed paths that git did not return (e.g. files in .gitignore'd directories).
    // For those, apply plain file logic so they appear in the changes panel.
    let git_covered: HashSet<&str> = git_changes
        .modified
        .iter()
        .map(|f| f.path.as_str())
        .chain(git_changes.added.iter().map(|f| f.path.as_str()))
        .chain(git_changes.deleted.iter().map(|f| f.path.as_str()))
        .chain(git_changes.untracked.iter().map(|f| f.path.as_str()))
        .collect();

    let uncovered_observed: BTreeMap<String, PlainWorkspaceObservedPath> = all_observed
        .into_iter()
        .filter(|(path, _)| !git_covered.contains(path.as_str()))
        .collect();

    if !uncovered_observed.is_empty() {
        let plain_changes =
            build_plain_workspace_changes(workspace_path, uncovered_observed, first_run_at);
        git_changes.modified.extend(plain_changes.modified);
        git_changes.added.extend(plain_changes.added);
        git_changes.deleted.extend(plain_changes.deleted);
        git_changes.modified.sort_by(|a, b| a.path.cmp(&b.path));
        git_changes.added.sort_by(|a, b| a.path.cmp(&b.path));
        git_changes.deleted.sort_by(|a, b| a.path.cmp(&b.path));
    }

    WorkspaceChangesResponse {
        workspace_path: workspace_path.to_string_lossy().to_string(),
        is_git_repo: true,
        changes: Some(git_changes),
        error: None,
    }
}

fn collect_session_scoped_plain_changes(
    session_id: Uuid,
    workspace_path: &std::path::Path,
    runs: &[ChatRun],
) -> WorkspaceChangesResponse {
    let observed = collect_session_plain_observed_paths(session_id, workspace_path, runs);
    let first_run_at = runs.iter().map(|run| run.created_at).min();

    WorkspaceChangesResponse {
        workspace_path: workspace_path.to_string_lossy().to_string(),
        is_git_repo: false,
        changes: Some(build_plain_workspace_changes(
            workspace_path,
            observed,
            first_run_at,
        )),
        error: None,
    }
}

fn collect_workspace_changes(
    session_id: Uuid,
    workspace_path: &str,
    include_diff: bool,
    runs: Vec<ChatRun>,
) -> WorkspaceChangesResponse {
    let path = PathBuf::from(workspace_path);
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(err) => {
            return WorkspaceChangesResponse {
                workspace_path: workspace_path.to_string(),
                is_git_repo: false,
                changes: None,
                error: Some(format!("Workspace path is not accessible: {err}")),
            };
        }
    };

    if !metadata.is_dir() {
        return WorkspaceChangesResponse {
            workspace_path: workspace_path.to_string(),
            is_git_repo: false,
            changes: None,
            error: Some("Workspace path must be a directory.".to_string()),
        };
    }

    if git2::Repository::open(&path).is_ok() {
        return collect_session_scoped_git_changes(session_id, &path, &runs, include_diff);
    }

    collect_session_scoped_plain_changes(session_id, &path, &runs)
}

#[cfg(windows)]
fn is_windows_reserved_name(name: &str) -> bool {
    let upper = name.trim().trim_end_matches('.').to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn validate_workspace_path_legality(trimmed: &str) -> Result<PathBuf, ApiError> {
    let is_absolute = {
        #[cfg(windows)]
        {
            // Windows: C:\, D:\, etc., or UNC paths \\server\share
            // Also allow ~ for home directory (will be expanded later)
            (trimmed.len() >= 2
                && trimmed.chars().nth(1) == Some(':')
                && matches!(trimmed.chars().next(), Some('a'..='z' | 'A'..='Z')))
                || trimmed.starts_with(r"\\")
                || trimmed.starts_with('~')
        }
        #[cfg(not(windows))]
        {
            // Unix/macOS: /path or ~/path
            trimmed.starts_with('/') || trimmed.starts_with('~')
        }
    };

    if !is_absolute {
        return Err(ApiError::BadRequest(
            "Workspace path must be an absolute path.".to_string(),
        ));
    }

    if trimmed.chars().any(|ch| ch == '\0' || ch.is_control()) {
        return Err(ApiError::BadRequest(
            "Workspace path contains invalid characters.".to_string(),
        ));
    }

    let parsed_path = PathBuf::from(trimmed);
    if parsed_path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(ApiError::BadRequest(
            "Workspace path cannot contain '..'.".to_string(),
        ));
    }

    #[cfg(windows)]
    {
        for component in parsed_path.components() {
            if let Component::Normal(value) = component {
                let segment = value.to_string_lossy();
                if segment
                    .chars()
                    .any(|ch| matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
                {
                    return Err(ApiError::BadRequest(
                        "Workspace path contains invalid Windows filename characters.".to_string(),
                    ));
                }

                if is_windows_reserved_name(&segment) {
                    return Err(ApiError::BadRequest(format!(
                        "Workspace path contains reserved Windows name: {segment}"
                    )));
                }
            }
        }
    }

    Ok(parsed_path)
}

async fn normalize_workspace_path(
    workspace_path: Option<String>,
) -> Result<Option<String>, ApiError> {
    let Some(raw_path) = workspace_path else {
        return Ok(None);
    };

    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest(
            "Workspace path is required.".to_string(),
        ));
    }

    let parsed_path = validate_workspace_path_legality(trimmed)?;
    let metadata = tokio::fs::metadata(&parsed_path)
        .await
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => {
                ApiError::BadRequest("Workspace path does not exist.".to_string())
            }
            _ => ApiError::BadRequest(format!("Workspace path is not accessible: {err}")),
        })?;
    if !metadata.is_dir() {
        return Err(ApiError::BadRequest(
            "Workspace path must be an existing directory.".to_string(),
        ));
    }

    Ok(Some(trimmed.to_string()))
}

async fn normalize_or_inherit_workspace_path(
    session: &ChatSession,
    workspace_path: Option<String>,
) -> Result<Option<String>, ApiError> {
    match workspace_path {
        Some(path) => normalize_workspace_path(Some(path)).await,
        None => Ok(session.default_workspace_path.clone()),
    }
}

fn normalize_allowed_skill_ids(allowed_skill_ids: Option<Vec<String>>) -> Vec<String> {
    let mut normalized = allowed_skill_ids
        .unwrap_or_default()
        .into_iter()
        .map(|skill_id| skill_id.trim().to_string())
        .filter(|skill_id| !skill_id.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
}

async fn session_has_duplicate_member_name(
    pool: &sqlx::SqlitePool,
    session_id: Uuid,
    agent_id: Uuid,
    agent_name: &str,
) -> Result<bool, sqlx::Error> {
    let count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(1)
           FROM chat_session_agents session_agents
           JOIN chat_agents agents ON agents.id = session_agents.agent_id
           WHERE session_agents.session_id = ?1
             AND session_agents.agent_id != ?2
             AND lower(trim(agents.name)) = lower(trim(?3))"#,
    )
    .bind(session_id)
    .bind(agent_id)
    .bind(agent_name)
    .fetch_one(pool)
    .await?;

    Ok(count > 0)
}

async fn session_has_workspace_path(
    pool: &sqlx::SqlitePool,
    session_id: Uuid,
    workspace_path: &str,
) -> Result<bool, sqlx::Error> {
    let rows = list_session_workspace_rows(pool, session_id).await?;
    Ok(rows.iter().any(|row| row.workspace_path == workspace_path))
}

async fn list_session_workspace_rows(
    pool: &sqlx::SqlitePool,
    session_id: Uuid,
) -> Result<Vec<SessionWorkspaceRow>, sqlx::Error> {
    Ok(sqlx::query_as::<_, SessionWorkspaceRow>(
        r#"
        SELECT workspaces.workspace_path AS workspace_path,
               workspaces.agent_id AS agent_id,
               workspaces.agent_name AS agent_name
        FROM (
            SELECT session_agents.workspace_path AS workspace_path,
                   session_agents.agent_id AS agent_id,
                   agents.name AS agent_name
            FROM chat_session_agents session_agents
            JOIN chat_agents agents ON agents.id = session_agents.agent_id
            WHERE session_agents.session_id = ?1
              AND session_agents.workspace_path IS NOT NULL
              AND trim(session_agents.workspace_path) != ''

            UNION

            SELECT runs.workspace_path AS workspace_path,
                   session_agents.agent_id AS agent_id,
                   agents.name AS agent_name
            FROM chat_runs runs
            JOIN chat_session_agents session_agents
              ON session_agents.id = runs.session_agent_id
            JOIN chat_agents agents ON agents.id = session_agents.agent_id
            WHERE runs.session_id = ?1
              AND runs.workspace_path IS NOT NULL
              AND trim(runs.workspace_path) != ''
        ) workspaces
        ORDER BY lower(workspaces.workspace_path) ASC,
                 lower(workspaces.agent_name) ASC
        "#,
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?)
}

pub async fn get_session_agents(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatSessionAgent>>>, ApiError> {
    let agents = ChatSessionAgent::find_all_for_session(&deployment.db().pool, session.id).await?;
    Ok(ResponseJson(ApiResponse::success(agents)))
}

pub async fn get_session_workspaces(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<SessionWorkspacesResponse>>, ApiError> {
    let rows = list_session_workspace_rows(&deployment.db().pool, session.id).await?;

    Ok(ResponseJson(ApiResponse::success(
        SessionWorkspacesResponse {
            workspaces: build_session_workspaces(rows),
        },
    )))
}

pub async fn get_session_workspace_changes(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<SessionWorkspaceChangesQuery>,
) -> Result<ResponseJson<ApiResponse<WorkspaceChangesResponse>>, ApiError> {
    let workspace_path = query.path.trim();
    let include_diff = query.include_diff.unwrap_or(true);
    if workspace_path.is_empty() {
        return Err(ApiError::BadRequest(
            "Workspace path is required.".to_string(),
        ));
    }

    if !session_has_workspace_path(&deployment.db().pool, session.id, workspace_path).await? {
        return Err(ApiError::BadRequest(
            "Workspace path is not part of this session.".to_string(),
        ));
    }

    let runs =
        ChatRun::list_for_session_workspace(&deployment.db().pool, session.id, workspace_path)
            .await?;
    let workspace_path_owned = workspace_path.to_string();
    let session_id = session.id;
    let response = tokio::task::spawn_blocking(move || {
        collect_workspace_changes(session_id, &workspace_path_owned, include_diff, runs)
    })
    .await
    .map_err(|err| ApiError::BadRequest(format!("Failed to inspect workspace changes: {err}")))?;

    Ok(ResponseJson(ApiResponse::success(response)))
}

pub async fn create_session_agent(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateChatSessionAgentRequest>,
) -> Result<ResponseJson<ApiResponse<ChatSessionAgent>>, ApiError> {
    if session.status != ChatSessionStatus::Active {
        return Err(ApiError::Conflict("Chat session is archived".to_string()));
    }

    let workspace_path =
        normalize_or_inherit_workspace_path(&session, payload.workspace_path).await?;
    let allowed_skill_ids = normalize_allowed_skill_ids(payload.allowed_skill_ids.clone());

    if let Some(existing) = ChatSessionAgent::find_by_session_and_agent(
        &deployment.db().pool,
        session.id,
        payload.agent_id,
    )
    .await?
    {
        let mut updated = existing.clone();
        let mut changed = false;

        if workspace_path.is_some() {
            updated = ChatSessionAgent::update_workspace_path(
                &deployment.db().pool,
                existing.id,
                workspace_path,
            )
            .await?;
            changed = true;
        }

        if payload.allowed_skill_ids.is_some() {
            updated = ChatSessionAgent::update_allowed_skill_ids(
                &deployment.db().pool,
                existing.id,
                allowed_skill_ids,
            )
            .await?;
            changed = true;
        }

        return Ok(ResponseJson(ApiResponse::success(if changed {
            updated
        } else {
            existing
        })));
    }

    let Some(agent) = ChatAgent::find_by_id(&deployment.db().pool, payload.agent_id).await? else {
        return Err(ApiError::BadRequest("Chat agent not found".to_string()));
    };

    let project_name = session.title.as_deref().map(str::trim).unwrap_or("");
    let agent_name = agent.name.trim();
    if !project_name.is_empty() && project_name.to_lowercase() == agent_name.to_lowercase() {
        return Err(ApiError::BadRequest(
            "AI member name cannot match the project name.".to_string(),
        ));
    }

    if session_has_duplicate_member_name(
        &deployment.db().pool,
        session.id,
        payload.agent_id,
        agent_name,
    )
    .await?
    {
        return Err(ApiError::BadRequest(
            "An AI member with this name already exists in this session.".to_string(),
        ));
    }

    let created = ChatSessionAgent::create(
        &deployment.db().pool,
        &CreateChatSessionAgent {
            session_id: session.id,
            agent_id: payload.agent_id,
            workspace_path,
            allowed_skill_ids,
        },
        Uuid::new_v4(),
    )
    .await?;

    let analytics_projector = AnalyticsProjector::new(
        &deployment.db().pool,
        deployment.analytics().as_ref(),
        deployment.analytics_enabled(),
    );
    analytics_projector
        .project_or_warn(DomainEvent::AgentAdded {
            session_id: session.id,
            actor_user_id: deployment.user_id().to_string(),
            agent_id: agent.id,
            agent_name: agent.name.clone(),
            runner_type: agent.runner_type.clone(),
            executor_profile_variant: extract_executor_profile_variant(&agent.tools_enabled.0),
            has_workspace: created.workspace_path.is_some(),
        })
        .await;
    Ok(ResponseJson(ApiResponse::success(created)))
}

pub async fn update_session_agent(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, session_agent_id)): axum::extract::Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateChatSessionAgentRequest>,
) -> Result<ResponseJson<ApiResponse<ChatSessionAgent>>, ApiError> {
    if session.status != ChatSessionStatus::Active {
        return Err(ApiError::Conflict("Chat session is archived".to_string()));
    }

    let Some(existing) =
        ChatSessionAgent::find_by_id(&deployment.db().pool, session_agent_id).await?
    else {
        return Err(ApiError::BadRequest(
            "Chat session agent not found".to_string(),
        ));
    };

    if existing.session_id != session.id {
        return Err(ApiError::Forbidden(
            "Chat session agent does not belong to this session".to_string(),
        ));
    }

    let workspace_path = match payload.workspace_path {
        Some(raw_path) => normalize_workspace_path(Some(raw_path)).await?,
        None => existing.workspace_path.clone(),
    };

    let allowed_skill_ids = payload
        .allowed_skill_ids
        .map(|skill_ids| normalize_allowed_skill_ids(Some(skill_ids)))
        .unwrap_or_else(|| existing.allowed_skill_ids.0.clone());

    let workspace_changed = workspace_path != existing.workspace_path;
    let allowed_skills_changed = allowed_skill_ids != existing.allowed_skill_ids.0;

    let updated = if workspace_changed {
        ChatSessionAgent::update_workspace_path(&deployment.db().pool, existing.id, workspace_path)
            .await?
    } else {
        existing.clone()
    };

    let updated = if allowed_skills_changed {
        ChatSessionAgent::update_allowed_skill_ids(
            &deployment.db().pool,
            updated.id,
            allowed_skill_ids,
        )
        .await?
    } else {
        updated
    };

    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn delete_session_agent(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, session_agent_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let Some(existing) =
        ChatSessionAgent::find_by_id(&deployment.db().pool, session_agent_id).await?
    else {
        return Err(ApiError::BadRequest(
            "Chat session agent not found".to_string(),
        ));
    };

    if existing.session_id != session.id {
        return Err(ApiError::Forbidden(
            "Chat session agent does not belong to this session".to_string(),
        ));
    }

    let rows = ChatSessionAgent::delete(&deployment.db().pool, existing.id).await?;
    if rows == 0 {
        Err(ApiError::BadRequest(
            "Chat session agent not found".to_string(),
        ))
    } else {
        Ok(ResponseJson(ApiResponse::success(())))
    }
}

pub async fn archive_session(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    if session.status == ChatSessionStatus::Archived {
        return Ok(ResponseJson(ApiResponse::success(session)));
    }

    // Get session stats for analytics
    let session_stats = AnalyticsSessionStats::find_by_id(&deployment.db().pool, session.id)
        .await
        .ok()
        .flatten();

    let archive_dir = asset_dir()
        .join("chat")
        .join(format!("session_{}", session.id))
        .join("archive");
    let archive_ref = services::services::chat::export_session_archive(
        &deployment.db().pool,
        &session,
        archive_dir.as_path(),
    )
    .await?;

    let updated = ChatSession::update(
        &deployment.db().pool,
        session.id,
        &UpdateChatSession {
            title: None,
            status: Some(ChatSessionStatus::Archived),
            summary_text: None,
            archive_ref: Some(archive_ref),
            last_seen_diff_key: None,
            team_protocol: None,
            team_protocol_enabled: None,
            default_workspace_path: None,
        },
    )
    .await?;

    if let Some(stats) = session_stats {
        let analytics_projector = AnalyticsProjector::new(
            &deployment.db().pool,
            deployment.analytics().as_ref(),
            deployment.analytics_enabled(),
        );
        let duration_seconds = (chrono::Utc::now() - session.created_at).num_seconds();
        analytics_projector
            .project_or_warn(DomainEvent::SessionArchived {
                session_id: session.id,
                actor_user_id: deployment.user_id().to_string(),
                duration_seconds,
                message_count: stats.message_count,
                agent_count: stats.agent_count,
            })
            .await;
    }

    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn restore_session(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    if session.status == ChatSessionStatus::Active {
        return Ok(ResponseJson(ApiResponse::success(session)));
    }

    let updated = ChatSession::update(
        &deployment.db().pool,
        session.id,
        &UpdateChatSession {
            title: None,
            status: Some(ChatSessionStatus::Active),
            summary_text: None,
            archive_ref: None,
            last_seen_diff_key: None,
            team_protocol: None,
            team_protocol_enabled: None,
            default_workspace_path: None,
        },
    )
    .await?;

    let analytics_projector = AnalyticsProjector::new(
        &deployment.db().pool,
        deployment.analytics().as_ref(),
        deployment.analytics_enabled(),
    );
    analytics_projector
        .project_or_warn(DomainEvent::SessionRestored {
            session_id: session.id,
            actor_user_id: deployment.user_id().to_string(),
        })
        .await;

    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn stream_session_ws(
    ws: WebSocketUpgrade,
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<impl IntoResponse, ApiError> {
    let rx = deployment.chat_runner().subscribe(session.id);

    Ok(ws.on_upgrade(move |socket| async move {
        if let Err(err) = handle_chat_stream_ws(socket, rx).await {
            tracing::warn!("chat stream ws closed: {}", err);
        }
    }))
}

async fn handle_chat_stream_ws(
    socket: WebSocket,
    mut rx: tokio::sync::broadcast::Receiver<services::services::chat_runner::ChatStreamEvent>,
) -> anyhow::Result<()> {
    use futures_util::{SinkExt, StreamExt};

    let (mut sender, mut receiver) = socket.split();
    tokio::spawn(async move { while let Some(Ok(_)) = receiver.next().await {} });

    loop {
        match rx.recv().await {
            Ok(event) => {
                let json = serde_json::to_string(&event)?;
                if sender.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }

    Ok(())
}

/// Stop a running agent
pub async fn stop_session_agent(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, session_agent_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    // Check that session agent exists and belongs to this session
    let Some(existing) =
        ChatSessionAgent::find_by_id(&deployment.db().pool, session_agent_id).await?
    else {
        return Err(ApiError::BadRequest(
            "Chat session agent not found".to_string(),
        ));
    };

    if existing.session_id != session.id {
        return Err(ApiError::Forbidden(
            "Chat session agent does not belong to this session".to_string(),
        ));
    }

    // Stop the agent
    deployment
        .chat_runner()
        .stop_agent(session.id, session_agent_id)
        .await?;

    Ok(ResponseJson(ApiResponse::success(())))
}

#[derive(Debug, Deserialize, TS)]
pub struct ValidateWorkspacePathRequest {
    pub workspace_path: String,
}

#[derive(Debug, Serialize, TS)]
pub struct ValidateWorkspacePathResponse {
    pub valid: bool,
    pub error: Option<String>,
}

pub async fn validate_workspace_path_endpoint(
    Json(payload): Json<ValidateWorkspacePathRequest>,
) -> Result<ResponseJson<ApiResponse<ValidateWorkspacePathResponse>>, ApiError> {
    let trimmed = payload.workspace_path.trim();

    if trimmed.is_empty() {
        return Ok(ResponseJson(ApiResponse::success(
            ValidateWorkspacePathResponse {
                valid: false,
                error: Some("Workspace path is required.".to_string()),
            },
        )));
    }

    if let Err(e) = validate_workspace_path_legality(trimmed) {
        return Ok(ResponseJson(ApiResponse::success(
            ValidateWorkspacePathResponse {
                valid: false,
                error: Some(e.to_string()),
            },
        )));
    }

    let parsed_path = PathBuf::from(trimmed);
    match tokio::fs::metadata(&parsed_path).await {
        Ok(metadata) => {
            if metadata.is_dir() {
                Ok(ResponseJson(ApiResponse::success(
                    ValidateWorkspacePathResponse {
                        valid: true,
                        error: None,
                    },
                )))
            } else {
                Ok(ResponseJson(ApiResponse::success(
                    ValidateWorkspacePathResponse {
                        valid: false,
                        error: Some("Workspace path must be an existing directory.".to_string()),
                    },
                )))
            }
        }
        Err(err) => {
            let error_msg = match err.kind() {
                std::io::ErrorKind::NotFound => "Workspace path does not exist.".to_string(),
                _ => format!("Workspace path is not accessible: {err}"),
            };
            Ok(ResponseJson(ApiResponse::success(
                ValidateWorkspacePathResponse {
                    valid: false,
                    error: Some(error_msg),
                },
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use chrono::Utc;
    use db::models::{
        chat_run::{ChatRun, ChatRunArtifactState, ChatRunLogState},
        chat_session::ChatSessionStatus,
    };
    use git::GitService;
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::*;

    async fn setup_workspace_history_pool() -> (SqlitePool, Uuid, Uuid) {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");

        sqlx::query(
            r#"CREATE TABLE chat_agents (
                id BLOB PRIMARY KEY,
                name TEXT NOT NULL
            )"#,
        )
        .execute(&pool)
        .await
        .expect("create chat_agents");
        sqlx::query(
            r#"CREATE TABLE chat_session_agents (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                agent_id BLOB NOT NULL,
                workspace_path TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .expect("create chat_session_agents");
        sqlx::query(
            r#"CREATE TABLE chat_runs (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                session_agent_id BLOB NOT NULL,
                workspace_path TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )"#,
        )
        .execute(&pool)
        .await
        .expect("create chat_runs");

        let session_id = Uuid::new_v4();
        let agent_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        sqlx::query("INSERT INTO chat_agents (id, name) VALUES (?1, ?2)")
            .bind(agent_id)
            .bind("historian")
            .execute(&pool)
            .await
            .expect("insert chat_agent");
        sqlx::query(
            "INSERT INTO chat_session_agents (id, session_id, agent_id, workspace_path) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(session_agent_id)
        .bind(session_id)
        .bind(agent_id)
        .bind("/workspace/current")
        .execute(&pool)
        .await
        .expect("insert session agent");
        sqlx::query(
            "INSERT INTO chat_runs (id, session_id, session_agent_id, workspace_path) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(Uuid::new_v4())
        .bind(session_id)
        .bind(session_agent_id)
        .bind("/workspace/old")
        .execute(&pool)
        .await
        .expect("insert chat run");

        (pool, session_id, agent_id)
    }

    fn test_session(default_workspace_path: Option<&str>) -> ChatSession {
        ChatSession {
            id: Uuid::new_v4(),
            title: Some("Test Session".to_string()),
            status: ChatSessionStatus::Active,
            summary_text: None,
            archive_ref: None,
            last_seen_diff_key: None,
            team_protocol: None,
            team_protocol_enabled: false,
            default_workspace_path: default_workspace_path.map(str::to_string),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            archived_at: None,
        }
    }

    fn test_run(
        session_id: Uuid,
        session_agent_id: Uuid,
        run_index: i64,
        run_dir: &Path,
        created_at: chrono::DateTime<Utc>,
    ) -> ChatRun {
        ChatRun {
            id: Uuid::new_v4(),
            session_id,
            session_agent_id,
            workspace_path: None,
            run_index,
            run_dir: run_dir.to_string_lossy().to_string(),
            input_path: None,
            output_path: None,
            raw_log_path: None,
            meta_path: Some(run_dir.join("meta.json").to_string_lossy().to_string()),
            log_state: ChatRunLogState::Tail,
            artifact_state: ChatRunArtifactState::Full,
            log_truncated: false,
            log_capture_degraded: false,
            pruned_at: None,
            prune_reason: None,
            retention_summary_json: None,
            created_at,
        }
    }

    #[test]
    fn build_session_workspaces_deduplicates_paths_and_detects_git_repos() {
        let git_dir = tempfile::tempdir().expect("create git dir");
        git2::Repository::init(git_dir.path()).expect("init git repo");

        let plain_dir = tempfile::tempdir().expect("create plain dir");
        let git_path = git_dir.path().to_string_lossy().to_string();
        let plain_path = plain_dir.path().to_string_lossy().to_string();
        let agent_a = Uuid::new_v4();
        let agent_b = Uuid::new_v4();
        let agent_c = Uuid::new_v4();

        let workspaces = build_session_workspaces(vec![
            SessionWorkspaceRow {
                workspace_path: plain_path.clone(),
                agent_id: agent_c,
                agent_name: "agent-c".to_string(),
            },
            SessionWorkspaceRow {
                workspace_path: git_path.clone(),
                agent_id: agent_b,
                agent_name: "agent-b".to_string(),
            },
            SessionWorkspaceRow {
                workspace_path: git_path.clone(),
                agent_id: agent_a,
                agent_name: "agent-a".to_string(),
            },
            SessionWorkspaceRow {
                workspace_path: git_path.clone(),
                agent_id: agent_a,
                agent_name: "agent-a".to_string(),
            },
        ]);

        assert_eq!(workspaces.len(), 2);

        let git_workspace = workspaces
            .iter()
            .find(|workspace| workspace.workspace_path == git_path)
            .expect("git workspace present");
        assert_eq!(git_workspace.agent_ids, vec![agent_b, agent_a]);
        assert_eq!(git_workspace.agent_names, vec!["agent-b", "agent-a"]);
        assert!(git_workspace.is_git_repo);

        let plain_workspace = workspaces
            .iter()
            .find(|workspace| workspace.workspace_path == plain_path)
            .expect("plain workspace present");
        assert_eq!(plain_workspace.agent_ids, vec![agent_c]);
        assert_eq!(plain_workspace.agent_names, vec!["agent-c"]);
        assert!(!plain_workspace.is_git_repo);
    }

    #[tokio::test]
    async fn list_session_workspace_rows_includes_current_and_historical_workspaces() {
        let (pool, session_id, agent_id) = setup_workspace_history_pool().await;

        let rows = list_session_workspace_rows(&pool, session_id)
            .await
            .expect("list session workspace rows");
        let workspaces = build_session_workspaces(rows);

        assert_eq!(workspaces.len(), 2);
        let current = workspaces
            .iter()
            .find(|workspace| workspace.workspace_path == "/workspace/current")
            .expect("current workspace present");
        assert_eq!(current.agent_ids, vec![agent_id]);
        let historical = workspaces
            .iter()
            .find(|workspace| workspace.workspace_path == "/workspace/old")
            .expect("historical workspace present");
        assert_eq!(historical.agent_ids, vec![agent_id]);
    }

    #[tokio::test]
    async fn session_has_workspace_path_accepts_historical_run_workspace() {
        let (pool, session_id, _) = setup_workspace_history_pool().await;

        assert!(
            session_has_workspace_path(&pool, session_id, "/workspace/current")
                .await
                .expect("check current workspace")
        );
        assert!(
            session_has_workspace_path(&pool, session_id, "/workspace/old")
                .await
                .expect("check historical workspace")
        );
        assert!(
            !session_has_workspace_path(&pool, session_id, "/workspace/missing")
                .await
                .expect("check missing workspace")
        );
    }

    #[test]
    fn build_workspace_changes_splits_untracked_from_added() {
        let changes = build_workspace_changes(
            vec![
                Diff {
                    change: DiffChangeKind::Modified,
                    old_path: Some("src/main.ts".to_string()),
                    new_path: Some("src/main.ts".to_string()),
                    old_content: Some("old\n".to_string()),
                    new_content: Some("new\n".to_string()),
                    content_omitted: false,
                    additions: Some(1),
                    deletions: Some(1),
                    repo_id: None,
                },
                Diff {
                    change: DiffChangeKind::Added,
                    old_path: None,
                    new_path: Some("src/staged.ts".to_string()),
                    old_content: None,
                    new_content: Some("added\n".to_string()),
                    content_omitted: false,
                    additions: Some(1),
                    deletions: Some(0),
                    repo_id: None,
                },
                Diff {
                    change: DiffChangeKind::Added,
                    old_path: None,
                    new_path: Some("tmp/debug.log".to_string()),
                    old_content: None,
                    new_content: Some("debug\n".to_string()),
                    content_omitted: false,
                    additions: Some(1),
                    deletions: Some(0),
                    repo_id: None,
                },
                Diff {
                    change: DiffChangeKind::Deleted,
                    old_path: Some("src/old.ts".to_string()),
                    new_path: None,
                    old_content: Some("gone\n".to_string()),
                    new_content: None,
                    content_omitted: false,
                    additions: Some(0),
                    deletions: Some(1),
                    repo_id: None,
                },
            ],
            &HashSet::from(["tmp/debug.log".to_string()]),
            true,
        );

        assert_eq!(changes.modified.len(), 1);
        assert_eq!(changes.modified[0].path, "src/main.ts");
        assert!(changes.modified[0].unified_diff.is_some());
        assert_eq!(changes.added.len(), 1);
        assert_eq!(changes.added[0].path, "src/staged.ts");
        assert!(changes.added[0].unified_diff.is_some());
        assert_eq!(
            changes.deleted,
            vec![WorkspacePathEntry {
                path: "src/old.ts".to_string()
            }]
        );
        assert_eq!(
            changes.untracked,
            vec![WorkspacePathEntry {
                path: "tmp/debug.log".to_string()
            }]
        );
    }

    #[test]
    fn build_workspace_changes_omits_diff_when_disabled() {
        let changes = build_workspace_changes(
            vec![Diff {
                change: DiffChangeKind::Modified,
                old_path: Some("src/main.ts".to_string()),
                new_path: Some("src/main.ts".to_string()),
                old_content: Some("old\n".to_string()),
                new_content: Some("new\n".to_string()),
                content_omitted: false,
                additions: Some(1),
                deletions: Some(1),
                repo_id: None,
            }],
            &HashSet::new(),
            false,
        );

        assert_eq!(changes.modified.len(), 1);
        assert_eq!(changes.modified[0].unified_diff, None);
    }

    #[test]
    fn collect_workspace_changes_returns_session_scoped_git_and_untracked_sections() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let repo_path = tempdir.path().join("repo");
        let git = GitService::new();
        git.initialize_repo_with_main_branch(&repo_path)
            .expect("init repo");

        fs::write(repo_path.join("tracked.txt"), "base\n").expect("write tracked");
        git.commit(&repo_path, "baseline").expect("commit baseline");

        fs::write(repo_path.join("tracked.txt"), "updated\n").expect("modify tracked");
        fs::write(repo_path.join("outside.txt"), "outside\n").expect("write unrelated change");
        fs::write(repo_path.join("untracked.txt"), "untracked\n").expect("write untracked");

        let session_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(run_dir.join("untracked")).expect("create untracked dir");
        fs::write(
            run_dir.join("diff.patch"),
            "diff --git a/tracked.txt b/tracked.txt\n--- a/tracked.txt\n+++ b/tracked.txt\n",
        )
        .expect("write diff patch");
        fs::write(
            run_dir.join("untracked").join("untracked.txt"),
            "snapshot\n",
        )
        .expect("write untracked snapshot");
        let run = test_run(session_id, session_agent_id, 1, &run_dir, Utc::now());

        let response =
            collect_workspace_changes(session_id, &repo_path.to_string_lossy(), true, vec![run]);

        assert!(response.is_git_repo);
        assert!(response.error.is_none());
        let changes = response.changes.expect("changes present");
        assert!(
            changes
                .modified
                .iter()
                .any(|entry| entry.path == "tracked.txt")
        );
        assert!(
            changes
                .modified
                .iter()
                .all(|entry| entry.path != "outside.txt")
        );
        assert_eq!(
            changes.untracked,
            vec![WorkspacePathEntry {
                path: "untracked.txt".to_string()
            }]
        );
    }

    #[test]
    fn collect_workspace_changes_can_skip_diff_payload_for_session_scoped_git() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let repo_path = tempdir.path().join("repo");
        let git = GitService::new();
        git.initialize_repo_with_main_branch(&repo_path)
            .expect("init repo");

        fs::write(repo_path.join("tracked.txt"), "base\n").expect("write tracked");
        git.commit(&repo_path, "baseline").expect("commit baseline");
        fs::write(repo_path.join("tracked.txt"), "updated\n").expect("modify tracked");

        let session_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(&run_dir).expect("create run dir");
        fs::write(
            run_dir.join("diff.patch"),
            "diff --git a/tracked.txt b/tracked.txt\n--- a/tracked.txt\n+++ b/tracked.txt\n",
        )
        .expect("write diff patch");
        let run = test_run(session_id, session_agent_id, 1, &run_dir, Utc::now());

        let response =
            collect_workspace_changes(session_id, &repo_path.to_string_lossy(), false, vec![run]);

        let changes = response.changes.expect("changes present");
        assert!(
            changes
                .modified
                .iter()
                .all(|entry| entry.unified_diff.is_none())
        );
    }

    #[test]
    fn collect_workspace_changes_returns_non_git_changes_from_manifest() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let workspace_path = tempdir.path();
        fs::write(workspace_path.join("plain.txt"), "plain\n").expect("write plain file");

        let session_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(&run_dir).expect("create run dir");
        fs::write(
            run_dir.join("meta.json"),
            r#"{"workspace_observed_paths":[{"path":"plain.txt","source":"output_text","existed_after_run":true}]}"#,
        )
        .expect("write meta");
        let run = test_run(
            session_id,
            session_agent_id,
            1,
            &run_dir,
            Utc::now() - chrono::Duration::minutes(1),
        );

        let response = collect_workspace_changes(
            session_id,
            &workspace_path.to_string_lossy(),
            true,
            vec![run],
        );

        assert!(!response.is_git_repo);
        let changes = response.changes.expect("plain changes present");
        assert!(
            changes.added.iter().any(|entry| entry.path == "plain.txt")
                || changes
                    .modified
                    .iter()
                    .any(|entry| entry.path == "plain.txt")
        );
        assert!(response.error.is_none());
    }

    #[test]
    fn collect_workspace_changes_marks_deleted_non_git_manifest_entries() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let session_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(&run_dir).expect("create run dir");
        fs::write(
            run_dir.join("meta.json"),
            r#"{"workspace_observed_paths":[{"path":"deleted.txt","source":"artifact_record","existed_after_run":true}]}"#,
        )
        .expect("write meta");
        let run = test_run(
            session_id,
            session_agent_id,
            1,
            &run_dir,
            Utc::now() - chrono::Duration::minutes(1),
        );

        let response = collect_workspace_changes(
            session_id,
            &tempdir.path().to_string_lossy(),
            true,
            vec![run],
        );

        assert!(!response.is_git_repo);
        let changes = response.changes.expect("plain changes present");
        assert_eq!(
            changes.deleted,
            vec![WorkspacePathEntry {
                path: "deleted.txt".to_string()
            }]
        );
    }

    #[test]
    fn normalize_workspace_relative_path_allows_user_openteams_files_but_filters_runtime_artifacts()
    {
        let tempdir = tempfile::tempdir().expect("create tempdir");

        assert_eq!(
            normalize_workspace_relative_path(".openteams/test.txt", tempdir.path()),
            Some(".openteams/test.txt".to_string())
        );
        assert_eq!(
            normalize_workspace_relative_path(
                ".openteams/context/demo/messages.jsonl",
                tempdir.path()
            ),
            None
        );
        assert_eq!(
            normalize_workspace_relative_path(
                ".openteams/context/demo/independent-mode-discussion-proposal.md",
                tempdir.path()
            ),
            Some(".openteams/context/demo/independent-mode-discussion-proposal.md".to_string())
        );
        assert_eq!(
            normalize_workspace_relative_path(
                ".openteams/context/demo/attachments/message-1/input.txt",
                tempdir.path()
            ),
            None
        );
        assert_eq!(
            normalize_workspace_relative_path(
                ".openteams/runs/demo/run_records/output.txt",
                tempdir.path()
            ),
            None
        );
    }

    #[test]
    fn collect_workspace_changes_merges_artifact_paths_with_git_meta_and_allows_user_openteams_files()
     {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let repo_path = tempdir.path().join("repo");
        let git = GitService::new();
        git.initialize_repo_with_main_branch(&repo_path)
            .expect("init repo");

        fs::write(repo_path.join("tracked.txt"), "base\n").expect("write tracked");
        git.commit(&repo_path, "baseline").expect("commit baseline");

        fs::write(repo_path.join("tracked.txt"), "updated\n").expect("modify tracked");
        fs::create_dir_all(repo_path.join("binaries")).expect("create binaries dir");
        fs::write(repo_path.join("binaries").join("test.txt"), "binary\n")
            .expect("write binaries file");
        fs::create_dir_all(repo_path.join(".openteams").join("context").join("demo"))
            .expect("create runtime dir");
        fs::write(repo_path.join(".openteams").join("test.txt"), "user\n")
            .expect("write user openteams file");
        fs::write(
            repo_path
                .join(".openteams")
                .join("context")
                .join("demo")
                .join("messages.jsonl"),
            "runtime\n",
        )
        .expect("write runtime artifact");
        fs::write(
            repo_path
                .join(".openteams")
                .join("context")
                .join("demo")
                .join("independent-mode-discussion-proposal.md"),
            "proposal\n",
        )
        .expect("write proposal artifact");
        fs::create_dir_all(
            repo_path
                .join(".openteams")
                .join("context")
                .join("demo")
                .join("attachments")
                .join("message-1"),
        )
        .expect("create attachment dir");
        fs::write(
            repo_path
                .join(".openteams")
                .join("context")
                .join("demo")
                .join("attachments")
                .join("message-1")
                .join("input.txt"),
            "attachment\n",
        )
        .expect("write attachment artifact");

        let session_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(&run_dir).expect("create run dir");
        fs::write(
            run_dir.join("meta.json"),
            r#"{"workspace_observed_paths":[{"path":"tracked.txt","source":"git_diff","existed_after_run":true}]}"#,
        )
        .expect("write meta");
        let run = test_run(
            session_id,
            session_agent_id,
            1,
            &run_dir,
            Utc::now() - chrono::Duration::minutes(1),
        );

        let protocol_dir = asset_dir()
            .join("chat")
            .join(format!("session_{session_id}"))
            .join("protocol");
        fs::create_dir_all(&protocol_dir).expect("create protocol dir");
        fs::write(
            protocol_dir.join("work_records.jsonl"),
            format!(
                concat!(
                    "{{\"run_id\":\"{run_id}\",\"message_type\":\"artifact\",\"content\":\"Saved `binaries/test.txt`.\"}}\n",
                    "{{\"run_id\":\"{run_id}\",\"message_type\":\"artifact\",\"content\":\"Saved `.openteams/test.txt`, `.openteams/context/demo/messages.jsonl`, and `.openteams/context/demo/independent-mode-discussion-proposal.md`.\"}}\n"
                ),
                run_id = run.id
            ),
        )
        .expect("write work records");

        let response =
            collect_workspace_changes(session_id, &repo_path.to_string_lossy(), true, vec![run]);

        let session_asset_dir = asset_dir()
            .join("chat")
            .join(format!("session_{session_id}"));
        let _ = fs::remove_dir_all(session_asset_dir);

        assert!(response.is_git_repo);
        assert!(response.error.is_none());
        let changes = response.changes.expect("changes present");
        let all_paths = changes
            .modified
            .iter()
            .map(|entry| entry.path.as_str())
            .chain(changes.added.iter().map(|entry| entry.path.as_str()))
            .chain(changes.deleted.iter().map(|entry| entry.path.as_str()))
            .chain(changes.untracked.iter().map(|entry| entry.path.as_str()))
            .collect::<Vec<_>>();

        assert!(all_paths.contains(&"tracked.txt"));
        assert!(all_paths.contains(&"binaries/test.txt"));
        assert!(all_paths.contains(&".openteams/test.txt"));
        assert!(
            all_paths.contains(&".openteams/context/demo/independent-mode-discussion-proposal.md")
        );
        assert!(!all_paths.contains(&".openteams/context/demo/messages.jsonl"));
        assert!(!all_paths.contains(&".openteams/context/demo/attachments/message-1/input.txt"));
    }

    #[tokio::test]
    async fn normalize_or_inherit_workspace_path_uses_session_default_when_missing() {
        let session = test_session(Some("/tmp/openteams-default"));

        let resolved = normalize_or_inherit_workspace_path(&session, None)
            .await
            .expect("resolve workspace path");

        assert_eq!(resolved.as_deref(), Some("/tmp/openteams-default"));
    }

    #[tokio::test]
    async fn normalize_or_inherit_workspace_path_prefers_explicit_request_value() {
        let session = test_session(Some("/tmp/openteams-default"));
        let tempdir = tempfile::tempdir().expect("create temp directory");
        let explicit_path = tempdir.path().to_string_lossy().to_string();

        let resolved = normalize_or_inherit_workspace_path(&session, Some(explicit_path.clone()))
            .await
            .expect("resolve explicit workspace path");

        assert_eq!(resolved.as_deref(), Some(explicit_path.as_str()));
    }
}
