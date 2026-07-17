/// Builds the structured per-run changed-file list for a single chat run.
///
/// This is the per-run counterpart of `collect_workspace_changes`: it inspects
/// the run's captured git diff patch (`{prefix}_diff.patch`), classifies each
/// touched file, counts `+`/`-` lines, then overlays validated artifact paths.
/// Artifact paths are authoritative: matching scoped-diff files keep their
/// diff, while artifact-only existing files appear without a diff. Scoped diff
/// files that were not reported as artifacts are intentionally suppressed.
///
/// Returns an empty `WorkspaceChanges` when no artifact paths are recorded for
/// the run, no run-scoped diff data exists, or no recorded artifact path still
/// matches a valid workspace/diff path.
pub(crate) fn collect_run_files(run: &ChatRun, include_diff: bool) -> WorkspaceChanges {
    let mut changes = empty_workspace_changes();
    let workspace_root = run
        .workspace_path
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let root = workspace_root.as_path();

    let mut covered: HashSet<String> = HashSet::new();
    let mut artifact_paths: HashSet<String> = HashSet::new();

    if let Some(patch) = read_first_existing_file(&run_scoped_diff_paths(run)) {
        for block in parse_run_diff_blocks(&patch) {
            let Some(path) = normalize_diff_path(&block.path, root) else {
                continue;
            };
            if !covered.insert(path.clone()) {
                continue;
            }

            match block.status {
                DiffFileStatus::Added => changes.added.push(WorkspaceChangedFile {
                    path,
                    additions: block.additions,
                    deletions: block.deletions,
                    unified_diff: if include_diff {
                        Some(block.text.clone())
                    } else {
                        None
                    },
                    has_diff: true,
                }),
                DiffFileStatus::Deleted => changes.deleted.push(WorkspaceChangedFile {
                    path,
                    additions: block.additions,
                    deletions: block.deletions,
                    unified_diff: if include_diff {
                        Some(block.text.clone())
                    } else {
                        None
                    },
                    has_diff: true,
                }),
                DiffFileStatus::Modified => changes.modified.push(WorkspaceChangedFile {
                    path,
                    additions: block.additions,
                    deletions: block.deletions,
                    unified_diff: if include_diff {
                        Some(block.text.clone())
                    } else {
                        None
                    },
                    has_diff: true,
                }),
            }
        }
    }

    // Augment with newly-created untracked files and artifact-only paths
    // recorded in the run metadata. Artifact paths are run-scoped deliverables;
    // they intentionally appear in the message-bottom run file list even when
    // they live under ignored directories such as `.openteams/`.
    let meta_paths = load_run_meta_observed_paths(run);
    for entry in meta_paths {
        let is_untracked = entry
            .source
            .split(',')
            .any(|source| source.trim() == "git_untracked");
        let is_artifact = is_artifact_observed_source(&entry.source);
        if !is_untracked && !is_artifact {
            continue;
        }
        let Some(path) =
            normalize_workspace_relative_path_with_options(&entry.path, root, is_artifact)
        else {
            continue;
        };
        if is_artifact && !covered.contains(&path) && !workspace_file_exists(root, &path) {
            continue;
        }
        if is_artifact {
            artifact_paths.insert(path.clone());
        }
        if covered.contains(&path) {
            continue;
        }

        let (additions, has_diff, unified_diff) = match read_run_untracked_content(run, &path) {
            Some(content) => {
                let additions = content.lines().count().max(1);
                let unified = include_diff.then_some(content);
                (additions, true, unified)
            }
            None => (0, false, None),
        };
        covered.insert(path.clone());
        changes.untracked.push(WorkspaceChangedFile {
            path,
            additions,
            deletions: 0,
            unified_diff,
            has_diff,
        });
    }

    // Protocol artifact work records are written after the run delta/meta path
    // capture, so read them at request time as a fallback for message-bottom
    // run files. These rows deliberately have no inline diff.
    let work_record_artifacts = load_run_artifact_work_record_paths(run, root, &covered);
    for path in work_record_artifacts.paths {
        artifact_paths.insert(path.clone());
        if !covered.insert(path.clone()) {
            continue;
        }

        changes.untracked.push(WorkspaceChangedFile {
            path,
            additions: 0,
            deletions: 0,
            unified_diff: None,
            has_diff: false,
        });
    }

    retain_workspace_changes_to_paths(&mut changes, &artifact_paths);

    changes.modified.sort_by(|a, b| a.path.cmp(&b.path));
    changes.added.sort_by(|a, b| a.path.cmp(&b.path));
    changes.deleted.sort_by(|a, b| a.path.cmp(&b.path));
    changes.untracked.sort_by(|a, b| a.path.cmp(&b.path));

    changes
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

struct LoadedArtifactPaths {
    paths: HashSet<String>,
}

fn load_run_artifact_work_record_paths(
    run: &ChatRun,
    workspace_path: &std::path::Path,
    scoped_paths: &HashSet<String>,
) -> LoadedArtifactPaths {
    let mut paths = HashSet::new();
    for record in load_work_record_lines(run.session_id)
        .into_iter()
        .filter(|record| {
            record.session_id == run.session_id
                && record.run_id == run.id
                && record.message_type.eq_ignore_ascii_case("artifact")
        })
    {
        for path in extract_workspace_paths_from_artifact_text(&record.content, workspace_path) {
            if scoped_paths.contains(&path) || workspace_file_exists(workspace_path, &path) {
                paths.insert(path);
            }
        }
    }

    LoadedArtifactPaths { paths }
}

fn collect_session_artifact_paths(
    workspace_path: &std::path::Path,
    runs: &[ChatRun],
    work_items: &[ChatWorkItem],
    extra_artifact_paths: HashSet<String>,
) -> HashSet<String> {
    let mut artifact_paths = extra_artifact_paths;
    let run_ids = runs.iter().map(|run| run.id).collect::<HashSet<_>>();

    for run in runs {
        for entry in load_run_meta_observed_paths(run) {
            if !is_artifact_observed_source(&entry.source) {
                continue;
            }
            if let Some(path) = normalize_workspace_relative_path(&entry.path, workspace_path) {
                artifact_paths.insert(path);
            }
        }
    }

    for run in runs {
        for record in load_work_record_lines(run.session_id)
            .into_iter()
            .filter(|record| {
                record.session_id == run.session_id
                    && record.run_id == run.id
                    && record.message_type.eq_ignore_ascii_case("artifact")
            })
        {
            artifact_paths.extend(extract_workspace_paths_from_text_with_options(
                &record.content,
                workspace_path,
                false,
            ));
        }
    }

    for item in work_items.iter().filter(|item| {
        item.item_type == ChatWorkItemType::Artifact && run_ids.contains(&item.run_id)
    }) {
        artifact_paths.extend(extract_workspace_paths_from_text_with_options(
            &item.content,
            workspace_path,
            false,
        ));
    }

    artifact_paths
}

fn build_plain_artifact_changes(
    workspace_path: &std::path::Path,
    artifact_paths: HashSet<String>,
) -> WorkspaceChanges {
    let observed = artifact_paths
        .into_iter()
        .map(|path| {
            (
                path,
                PlainWorkspaceObservedPath {
                    existed_after_run: true,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();

    build_plain_workspace_changes(workspace_path, observed, None)
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
                changes.deleted.push(WorkspaceChangedFile {
                    path: relative_path,
                    additions: 0,
                    deletions: 0,
                    unified_diff: None,
                    has_diff: false,
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
    workspace_path: &std::path::Path,
    runs: &[ChatRun],
    work_items: &[ChatWorkItem],
    extra_artifact_paths: HashSet<String>,
    include_diff: bool,
) -> WorkspaceChangesResponse {
    let session_paths =
        collect_session_artifact_paths(workspace_path, runs, work_items, extra_artifact_paths);

    if session_paths.is_empty() {
        return WorkspaceChangesResponse {
            workspace_path: workspace_path.to_string_lossy().to_string(),
            is_git_repo: true,
            changes: Some(empty_workspace_changes()),
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

    let head_commit = Commit::new(head_oid);
    let diffs = if session_paths.is_empty() {
        Vec::new()
    } else {
        // Do not pass `session_paths` as git pathspec arguments here. Large
        // sessions can produce enough paths to exceed Windows' command-line
        // length limit (os error 206). Collect the workspace diff with the
        // standard runtime-directory excludes, then filter back to the
        // session-observed paths in Rust so unrelated files still do not leak
        // into the response.
        match git_service.get_diffs(
            DiffTarget::Worktree {
                worktree_path: workspace_path,
                base_commit: &head_commit,
            },
            None,
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

    let git_changes = build_workspace_changes(diffs, &untracked_paths, include_diff);

    WorkspaceChangesResponse {
        workspace_path: workspace_path.to_string_lossy().to_string(),
        is_git_repo: true,
        changes: Some(git_changes),
        error: None,
    }
}

fn collect_session_scoped_plain_changes(
    workspace_path: &std::path::Path,
    runs: &[ChatRun],
    work_items: &[ChatWorkItem],
    extra_artifact_paths: HashSet<String>,
) -> WorkspaceChangesResponse {
    let artifact_paths =
        collect_session_artifact_paths(workspace_path, runs, work_items, extra_artifact_paths);

    WorkspaceChangesResponse {
        workspace_path: workspace_path.to_string_lossy().to_string(),
        is_git_repo: false,
        changes: Some(build_plain_artifact_changes(workspace_path, artifact_paths)),
        error: None,
    }
}

fn collect_workspace_changes_with_artifacts(
    _session_id: Uuid,
    workspace_path: &str,
    include_diff: bool,
    runs: Vec<ChatRun>,
    work_items: Vec<ChatWorkItem>,
    extra_artifact_paths: HashSet<String>,
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
        return collect_session_scoped_git_changes(
            &path,
            &runs,
            &work_items,
            extra_artifact_paths,
            include_diff,
        );
    }

    collect_session_scoped_plain_changes(&path, &runs, &work_items, extra_artifact_paths)
}

#[cfg(test)]
fn collect_workspace_changes(
    session_id: Uuid,
    workspace_path: &str,
    include_diff: bool,
    runs: Vec<ChatRun>,
) -> WorkspaceChangesResponse {
    collect_workspace_changes_with_artifacts(
        session_id,
        workspace_path,
        include_diff,
        runs,
        Vec::new(),
        HashSet::new(),
    )
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
    validate_workspace_path_legality_data(trimmed)
        .map_err(|error| ApiError::BadRequest(error.message))
}

fn validate_workspace_path_legality_data(trimmed: &str) -> Result<PathBuf, WorkspaceGitErrorData> {
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

    if trimmed.is_empty() {
        return Err(workspace_git_error(
            WorkspaceGitErrorCode::WorkspacePathRequired,
        ));
    }

    if !is_absolute {
        let mut error = workspace_git_error(WorkspaceGitErrorCode::WorkspacePathInvalid);
        error.message = "Workspace path must be an absolute path.".to_string();
        return Err(error);
    }

    if trimmed.chars().any(|ch| ch == '\0' || ch.is_control()) {
        return Err(workspace_git_error(
            WorkspaceGitErrorCode::WorkspacePathInvalid,
        ));
    }

    let parsed_path = PathBuf::from(trimmed);
    if parsed_path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(workspace_git_error(
            WorkspaceGitErrorCode::WorkspacePathInvalid,
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
                    return Err(workspace_git_error(
                        WorkspaceGitErrorCode::WorkspacePathInvalid,
                    ));
                }

                if is_windows_reserved_name(&segment) {
                    return Err(workspace_git_error(
                        WorkspaceGitErrorCode::WorkspacePathInvalid,
                    ));
                }
            }
        }
    }

    Ok(parsed_path)
}
