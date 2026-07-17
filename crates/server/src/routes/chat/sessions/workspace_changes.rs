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
    pub deleted: Vec<WorkspaceChangedFile>,
    pub untracked: Vec<WorkspaceChangedFile>,
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
}

#[derive(Debug, Deserialize)]
struct RunMetaFile {
    #[serde(default)]
    workspace_observed_paths: Vec<WorkspaceObservedPathRecord>,
}

#[derive(Debug, Deserialize)]
struct WorkRecordJsonLine {
    session_id: Uuid,
    run_id: Uuid,
    message_type: String,
    content: String,
}

#[derive(Debug, Clone)]
struct PlainWorkspaceObservedPath {
    existed_after_run: bool,
}

fn is_artifact_observed_source(source: &str) -> bool {
    source
        .split(',')
        .any(|part| part.trim().eq_ignore_ascii_case("artifact_record"))
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

        if row.agent_id != Uuid::nil() && !workspace.agent_ids.contains(&row.agent_id) {
            workspace.agent_ids.push(row.agent_id);
        }

        if !row.agent_name.is_empty() && !workspace.agent_names.contains(&row.agent_name) {
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
            changes
                .untracked
                .push(diff_to_workspace_changed_file(diff, path, include_diff));
            continue;
        }

        match diff.change {
            DiffChangeKind::Added => {
                changes
                    .added
                    .push(diff_to_workspace_changed_file(diff, path, include_diff));
            }
            DiffChangeKind::Deleted => {
                changes
                    .deleted
                    .push(diff_to_workspace_changed_file(diff, path, include_diff));
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
    normalize_workspace_relative_path_with_options(raw, workspace_root, false)
}

fn normalize_workspace_relative_path_with_options(
    raw: &str,
    workspace_root: &std::path::Path,
    allow_internal_runtime_path: bool,
) -> Option<String> {
    let trimmed = raw
        .trim()
        .trim_matches(|ch: char| {
            matches!(
                ch,
                '`' | '"' | '\'' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | ';'
            )
        })
        .trim_end_matches(['.', ':', '!', '?']);

    if trimmed.is_empty() || !looks_like_workspace_path(trimmed) {
        return None;
    }

    let candidate = PathBuf::from(trimmed);
    let relative = if candidate.is_absolute() {
        candidate.strip_prefix(workspace_root).ok()?.to_path_buf()
    } else {
        candidate
    };

    if !allow_internal_runtime_path && is_internal_openteams_runtime_path(&relative) {
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

fn workspace_file_exists(workspace_root: &std::path::Path, relative_path: &str) -> bool {
    std::fs::metadata(workspace_root.join(relative_path))
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

fn extract_workspace_paths_from_artifact_text(
    text: &str,
    workspace_root: &std::path::Path,
) -> HashSet<String> {
    extract_workspace_paths_from_text_with_options(text, workspace_root, true)
}

fn extract_workspace_paths_from_text_with_options(
    text: &str,
    workspace_root: &std::path::Path,
    allow_internal_runtime_path: bool,
) -> HashSet<String> {
    let mut candidates = Vec::new();

    if let Ok(paths) = serde_json::from_str::<Vec<String>>(text.trim()) {
        candidates.extend(paths);
    } else {
        for capture in INLINE_CODE_PATH_RE.captures_iter(text) {
            if let Some(matched) = capture.get(1) {
                candidates.push(matched.as_str().to_string());
            }
        }

        if candidates.is_empty() {
            for token in text.split_whitespace() {
                candidates.push(token.to_string());
            }
        }
    }

    candidates
        .into_iter()
        .filter_map(|candidate| {
            normalize_workspace_relative_path_with_options(
                &candidate,
                workspace_root,
                allow_internal_runtime_path,
            )
        })
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

/// Classification of a single file's change within a git diff patch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DiffFileStatus {
    Added,
    Deleted,
    Modified,
}

/// One file block parsed from a run-scoped git diff patch.
#[derive(Debug, Clone)]
struct RunDiffBlock {
    path: String,
    status: DiffFileStatus,
    additions: usize,
    deletions: usize,
    text: String,
}

/// Extracts the relative path from a `diff --git a/<old> b/<new>` header line.
/// Returns the raw (un-normalized) path so the caller can resolve it against a
/// workspace root.
fn diff_block_path(line: &str) -> Option<String> {
    let rest = line.strip_prefix("diff --git a/")?;
    let (old_path, new_path) = rest.split_once(" b/")?;
    let preferred = if new_path.trim() == "/dev/null" {
        old_path
    } else {
        new_path
    };
    Some(preferred.trim().to_string())
}

fn classify_diff_block(text: &str) -> DiffFileStatus {
    // The mode markers always appear within the first few header lines.
    if text
        .lines()
        .take(8)
        .any(|line| line.starts_with("new file mode"))
    {
        DiffFileStatus::Added
    } else if text
        .lines()
        .take(8)
        .any(|line| line.starts_with("deleted file mode"))
    {
        DiffFileStatus::Deleted
    } else {
        // Renames, copies, mode changes and plain modifications all render as
        // "modified" in the changes panel.
        DiffFileStatus::Modified
    }
}

/// Counts `+`/`-` content lines inside the hunk bodies of a single file block.
/// File headers (`--- a/x`, `+++ b/x`) and `\ No newline` markers are skipped.
fn count_diff_block_changes(text: &str) -> (usize, usize) {
    let mut additions = 0usize;
    let mut deletions = 0usize;
    let mut in_hunk = false;

    for line in text.lines() {
        if line.starts_with("@@") {
            in_hunk = true;
            continue;
        }
        if !in_hunk {
            continue;
        }
        // Defensive guard: file headers never appear inside hunks, but skip them
        // regardless to avoid miscounting a stray `+++`/`---`.
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            additions += 1;
        } else if line.starts_with('-') {
            deletions += 1;
        }
    }

    (additions, deletions)
}

/// Splits a multi-file git diff patch into per-file blocks with status and
/// `+`/`-` counts. Paths are returned raw (repo-relative); callers normalize
/// them against the workspace root.
fn parse_run_diff_blocks(patch: &str) -> Vec<RunDiffBlock> {
    let mut raw_blocks: Vec<(String, String)> = Vec::new();
    let mut current: Option<(String, String)> = None;

    for line in patch.split_inclusive('\n') {
        if let Some(path) = diff_block_path(line)
            && current.is_none()
        {
            current = Some((path, String::new()));
        } else if let Some(path) = diff_block_path(line) {
            if let Some((prev_path, prev_text)) = current.take()
                && !prev_text.trim().is_empty()
            {
                raw_blocks.push((prev_path, prev_text));
            }
            current = Some((path, String::new()));
        }

        if let Some((_, text)) = current.as_mut() {
            text.push_str(line);
        }
    }

    if let Some((path, text)) = current
        && !text.trim().is_empty()
    {
        raw_blocks.push((path, text));
    }

    raw_blocks
        .into_iter()
        .map(|(path, text)| {
            let status = classify_diff_block(&text);
            let (additions, deletions) = count_diff_block_changes(&text);
            RunDiffBlock {
                path,
                status,
                additions,
                deletions,
                text,
            }
        })
        .collect()
}

/// Normalizes a path extracted from a git diff header. Diff paths are
/// authoritative (produced by git), so unlike `normalize_workspace_relative_path`
/// this does not apply the "looks like a path" free-text heuristic — it only
/// cleans path components, strips a workspace prefix for absolute paths, and
/// filters internal `.openteams` runtime artifacts.
fn normalize_diff_path(raw: &str, workspace_root: &std::path::Path) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.contains("://") {
        return None;
    }

    let candidate = PathBuf::from(trimmed);
    let relative = if candidate.is_absolute() {
        candidate.strip_prefix(workspace_root).ok()?
    } else {
        candidate.as_path()
    };

    if is_internal_openteams_runtime_path(relative) {
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

/// Reads the captured content of an untracked file written during a run, if a
/// run-scoped untracked snapshot directory still holds it.
fn read_run_untracked_content(run: &ChatRun, rel_path: &str) -> Option<String> {
    for dir in run_scoped_untracked_dirs(run) {
        let candidate = dir.join(rel_path);
        if let Ok(content) = std::fs::read_to_string(&candidate) {
            return Some(content);
        }
    }
    None
}

fn retain_workspace_changes_to_paths(changes: &mut WorkspaceChanges, paths: &HashSet<String>) {
    changes.modified.retain(|entry| paths.contains(&entry.path));
    changes.added.retain(|entry| paths.contains(&entry.path));
    changes.deleted.retain(|entry| paths.contains(&entry.path));
    changes
        .untracked
        .retain(|entry| paths.contains(&entry.path));
}
