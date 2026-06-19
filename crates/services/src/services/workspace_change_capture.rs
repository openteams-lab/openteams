use std::{
    collections::{BTreeMap, HashSet},
    path::{Component, Path, PathBuf},
};

use chrono::{DateTime, Utc};
use serde::Serialize;
use tokio::{fs, process::Command};
use uuid::Uuid;

const OPENTEAMS_DIR: &str = ".openteams";

#[derive(Debug, Clone, Default)]
pub struct WorkspaceChangeBaseline {
    pub git_tree: Option<String>,
    pub untracked_files: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct WorkspaceChangeDelta {
    pub diff_patch: Option<String>,
    pub diff_paths: Vec<String>,
    pub untracked_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceObservedPathRecord {
    pub path: String,
    pub source: String,
    pub existed_after_run: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
}

pub fn workspace_run_records_dir(workspace_path: &Path, session_id: Uuid) -> PathBuf {
    workspace_path
        .join(OPENTEAMS_DIR)
        .join("runs")
        .join(session_id.to_string())
        .join("run_records")
}

pub fn run_records_prefix(session_agent_id: Uuid, run_index: i64) -> String {
    format!("session_agent_{session_agent_id}_run_{run_index:04}")
}

pub async fn capture_workspace_change_baseline(workspace_path: &Path) -> WorkspaceChangeBaseline {
    let git_tree = capture_baseline_git_tree(workspace_path).await;
    let untracked_files = capture_untracked_file_snapshot(workspace_path).await;
    tracing::debug!(
        workspace_path = %workspace_path.display(),
        baseline_has_git_tree = git_tree.is_some(),
        baseline_untracked_count = untracked_files.len(),
        "[workspace_change_capture] Captured workspace change baseline"
    );

    WorkspaceChangeBaseline {
        git_tree,
        untracked_files,
    }
}

pub async fn capture_workspace_change_delta(
    workspace_path: &Path,
    run_dir: &Path,
    session_agent_id: Uuid,
    run_index: i64,
    baseline: &WorkspaceChangeBaseline,
) -> WorkspaceChangeDelta {
    let (diff_patch, diff_paths) = match baseline.git_tree.as_deref() {
        Some(tree) => capture_git_diff_from_tree(workspace_path, tree)
            .await
            .map(|patch| filter_git_diff_to_observed_paths(&patch, workspace_path))
            .unwrap_or_default(),
        None => (String::new(), Vec::new()),
    };

    let mut diff_patch_written = false;
    if !diff_patch.trim().is_empty() && !diff_paths.is_empty() {
        let diff_path = run_dir.join(format!(
            "{}_diff.patch",
            run_records_prefix(session_agent_id, run_index)
        ));
        match fs::write(&diff_path, &diff_patch).await {
            Ok(_) => {
                diff_patch_written = true;
                tracing::debug!(
                    path = %diff_path.display(),
                    diff_patch_bytes = diff_patch.len(),
                    diff_path_count = diff_paths.len(),
                    "[workspace_change_capture] Wrote run-scoped diff patch"
                );
            }
            Err(err) => {
                tracing::warn!(
                    path = %diff_path.display(),
                    error = %err,
                    "failed to write run-scoped diff patch"
                );
            }
        }
    }

    let baseline_untracked = baseline.untracked_files.iter().collect::<HashSet<_>>();
    let untracked_files = capture_untracked_file_snapshot(workspace_path)
        .await
        .into_iter()
        .filter(|path| !baseline_untracked.contains(path))
        .collect::<Vec<_>>();

    tracing::debug!(
        workspace_path = %workspace_path.display(),
        run_dir = %run_dir.display(),
        session_agent_id = %session_agent_id,
        run_index,
        baseline_has_git_tree = baseline.git_tree.is_some(),
        diff_path_count = diff_paths.len(),
        diff_patch_bytes = diff_patch.len(),
        diff_patch_written,
        untracked_count = untracked_files.len(),
        "[workspace_change_capture] Captured workspace change delta"
    );

    WorkspaceChangeDelta {
        diff_patch: (!diff_patch.trim().is_empty() && !diff_paths.is_empty()).then_some(diff_patch),
        diff_paths,
        untracked_files,
    }
}

pub fn build_git_observed_path_records(
    workspace_path: &Path,
    diff_paths: &[String],
    untracked_files: &[String],
) -> Vec<WorkspaceObservedPathRecord> {
    let mut observed = BTreeMap::<String, WorkspaceObservedPathRecord>::new();

    for path in diff_paths {
        upsert_observed_path(&mut observed, workspace_path, path, "git_diff");
    }
    for path in untracked_files {
        upsert_observed_path(&mut observed, workspace_path, path, "git_untracked");
    }

    observed.into_values().collect()
}

fn upsert_observed_path(
    observed: &mut BTreeMap<String, WorkspaceObservedPathRecord>,
    workspace_path: &Path,
    relative_path: &str,
    source: &str,
) {
    let (existed_after_run, modified_at) = observed_file_metadata(workspace_path, relative_path);
    observed
        .entry(relative_path.to_string())
        .and_modify(|entry| {
            if !entry.source.split(',').any(|part| part.trim() == source) {
                entry.source.push(',');
                entry.source.push_str(source);
            }
            entry.existed_after_run |= existed_after_run;
            if entry.modified_at.is_none() {
                entry.modified_at = modified_at.clone();
            }
        })
        .or_insert_with(|| WorkspaceObservedPathRecord {
            path: relative_path.to_string(),
            source: source.to_string(),
            existed_after_run,
            modified_at,
        });
}

fn observed_file_metadata(workspace_path: &Path, relative_path: &str) -> (bool, Option<String>) {
    let absolute_path = workspace_path.join(relative_path);
    match std::fs::metadata(&absolute_path) {
        Ok(metadata) => {
            let modified_at = metadata
                .modified()
                .ok()
                .map(DateTime::<Utc>::from)
                .map(|dt| dt.to_rfc3339());
            (metadata.is_file(), modified_at)
        }
        Err(_) => (false, None),
    }
}

async fn capture_baseline_git_tree(workspace_path: &Path) -> Option<String> {
    if !is_git_worktree(workspace_path).await {
        return None;
    }

    let index_path = std::env::temp_dir().join(format!(
        "openteams-workspace-baseline-{}.index",
        Uuid::new_v4()
    ));

    let head_tree = git_stdout(
        workspace_path,
        &["rev-parse", "--verify", "HEAD^{tree}"],
        None,
    )
    .await
    .map(|tree| tree.trim().to_string())
    .filter(|tree| !tree.is_empty());

    let result = async {
        let read_tree_ok = if let Some(head_tree) = head_tree.as_deref() {
            run_git(workspace_path, &["read-tree", head_tree], Some(&index_path))
                .await
                .unwrap_or(false)
        } else {
            run_git(workspace_path, &["read-tree", "--empty"], Some(&index_path))
                .await
                .unwrap_or(false)
        };
        if !read_tree_ok {
            return None;
        }
        if !run_git(workspace_path, &["add", "-u", "--", "."], Some(&index_path))
            .await
            .unwrap_or(false)
        {
            return None;
        }
        git_stdout(workspace_path, &["write-tree"], Some(&index_path)).await
    }
    .await;

    let _ = fs::remove_file(&index_path).await;
    result
        .map(|tree| tree.trim().to_string())
        .filter(|tree| !tree.is_empty())
}

async fn is_git_worktree(workspace_path: &Path) -> bool {
    run_git(
        workspace_path,
        &["rev-parse", "--is-inside-work-tree"],
        None,
    )
    .await
    .unwrap_or(false)
}

async fn capture_git_diff_from_tree(workspace_path: &Path, tree: &str) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(workspace_path)
        .args([
            "-c",
            "core.quotePath=false",
            "diff",
            "--no-color",
            tree,
            "--",
            ".",
        ])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let diff = String::from_utf8_lossy(&output.stdout).to_string();
    (!diff.trim().is_empty()).then_some(diff)
}

pub async fn capture_untracked_file_snapshot(workspace_path: &Path) -> Vec<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(workspace_path)
        .args([
            "-c",
            "core.quotePath=false",
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
        ])
        .output()
        .await;

    let output = match output {
        Ok(output) if output.status.success() => output,
        _ => return Vec::new(),
    };

    let mut files = Vec::new();
    for raw in output.stdout.split(|b| *b == b'\0') {
        if raw.is_empty() {
            continue;
        }
        let rel = String::from_utf8_lossy(raw).to_string();
        if let Some(path) = normalize_git_relative_path(&rel) {
            files.push(path);
        }
    }

    files.sort();
    files.dedup();
    files
}

async fn run_git(workspace_path: &Path, args: &[&str], index_path: Option<&Path>) -> Option<bool> {
    let mut command = Command::new("git");
    command.arg("-C").arg(workspace_path).args(args);
    if let Some(index_path) = index_path {
        command.env("GIT_INDEX_FILE", index_path);
    }
    command
        .output()
        .await
        .ok()
        .map(|output| output.status.success())
}

async fn git_stdout(
    workspace_path: &Path,
    args: &[&str],
    index_path: Option<&Path>,
) -> Option<String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(workspace_path).args(args);
    if let Some(index_path) = index_path {
        command.env("GIT_INDEX_FILE", index_path);
    }
    let output = command.output().await.ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).to_string())
}

fn filter_git_diff_to_observed_paths(diff: &str, _workspace_path: &Path) -> (String, Vec<String>) {
    let mut filtered = String::new();
    let mut observed_paths = Vec::new();

    for (path, patch) in split_git_diff_by_path(diff) {
        if normalize_git_relative_path(&path).is_none() {
            continue;
        }
        filtered.push_str(&patch);
        if !filtered.ends_with('\n') {
            filtered.push('\n');
        }
        observed_paths.push(path);
    }

    (filtered, observed_paths)
}

fn split_git_diff_by_path(diff: &str) -> BTreeMap<String, String> {
    let mut patches = BTreeMap::<String, String>::new();
    let mut current_path: Option<String> = None;
    let mut current_patch = String::new();

    for line in diff.split_inclusive('\n') {
        if let Some(next_path) = diff_header_path(line) {
            if let Some(path) = current_path.take()
                && !current_patch.trim().is_empty()
            {
                patches.insert(path, std::mem::take(&mut current_patch));
            }
            current_path = Some(next_path);
        }

        if current_path.is_some() {
            current_patch.push_str(line);
        }
    }

    if let Some(path) = current_path
        && !current_patch.trim().is_empty()
    {
        patches.insert(path, current_patch);
    }

    patches
}

fn diff_header_path(line: &str) -> Option<String> {
    let rest = line.strip_prefix("diff --git a/")?;
    let (old_path, new_path) = rest.split_once(" b/")?;
    let preferred = if new_path.trim() == "/dev/null" {
        old_path
    } else {
        new_path
    };
    normalize_git_relative_path(preferred)
}

fn normalize_git_relative_path(raw: &str) -> Option<String> {
    let trimmed = raw
        .trim()
        .trim_matches(|ch: char| {
            matches!(
                ch,
                '`' | '"' | '\'' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | ';'
            )
        })
        .trim_end_matches(['.', ':', '!', '?']);

    if trimmed.is_empty() || trimmed.contains("://") {
        return None;
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        return None;
    }

    let mut normalized = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => normalized.push(part.to_string_lossy().to_string()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    if normalized.is_empty() {
        return None;
    }

    let mut relative = PathBuf::new();
    for part in &normalized {
        relative.push(part);
    }
    if is_internal_openteams_runtime_path(&relative) {
        return None;
    }

    Some(normalized.join("/"))
}

fn is_internal_openteams_runtime_path(path: &Path) -> bool {
    let components = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            Component::CurDir => None,
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => None,
        })
        .collect::<Vec<_>>();

    match components.as_slice() {
        [openteams, runs, ..] if openteams == OPENTEAMS_DIR && runs == "runs" => true,
        [openteams, context, _session_id, file]
            if openteams == OPENTEAMS_DIR
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
            if openteams == OPENTEAMS_DIR
                && context == "context"
                && matches!(internal_dir.as_str(), "attachments" | "references") =>
        {
            true
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use git::GitService;

    use super::*;

    #[tokio::test]
    async fn delta_diff_is_between_run_baseline_and_after_state() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let repo_path = tempdir.path().join("repo");
        let git = GitService::new();
        git.initialize_repo_with_main_branch(&repo_path)
            .expect("init repo");

        std::fs::write(repo_path.join("shared.txt"), "alpha\nbeta\ngamma\n")
            .expect("write baseline");
        git.commit(&repo_path, "baseline").expect("commit baseline");

        std::fs::write(repo_path.join("shared.txt"), "ALPHA\nbeta\ngamma\n")
            .expect("write pre-existing session change");
        let baseline = capture_workspace_change_baseline(&repo_path).await;

        std::fs::write(repo_path.join("shared.txt"), "ALPHA\nBETA\ngamma\n")
            .expect("write current run change");
        let run_dir = tempdir.path().join("run-record");
        tokio::fs::create_dir_all(&run_dir)
            .await
            .expect("create run dir");

        let session_agent_id = Uuid::new_v4();
        let delta =
            capture_workspace_change_delta(&repo_path, &run_dir, session_agent_id, 1, &baseline)
                .await;

        assert_eq!(delta.diff_paths, vec!["shared.txt".to_string()]);
        let patch = delta.diff_patch.expect("delta patch");
        assert!(patch.contains("-beta"));
        assert!(patch.contains("+BETA"));
        assert!(!patch.contains("-alpha"));
        assert!(!patch.contains("+ALPHA"));
    }

    #[tokio::test]
    async fn delta_untracked_files_excludes_run_baseline_untracked_files() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let repo_path = tempdir.path().join("repo");
        let git = GitService::new();
        git.initialize_repo_with_main_branch(&repo_path)
            .expect("init repo");
        std::fs::write(repo_path.join("tracked.txt"), "tracked\n").expect("write tracked");
        git.commit(&repo_path, "baseline").expect("commit baseline");

        std::fs::write(repo_path.join("other-session.txt"), "other\n").expect("write other");
        let baseline = capture_workspace_change_baseline(&repo_path).await;

        std::fs::write(repo_path.join("current-session.txt"), "current\n").expect("write current");
        let run_dir = tempdir.path().join("run-record");
        tokio::fs::create_dir_all(&run_dir)
            .await
            .expect("create run dir");

        let delta =
            capture_workspace_change_delta(&repo_path, &run_dir, Uuid::new_v4(), 1, &baseline)
                .await;

        assert_eq!(
            delta.untracked_files,
            vec!["current-session.txt".to_string()]
        );
    }
}
