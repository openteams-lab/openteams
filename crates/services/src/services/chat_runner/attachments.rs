struct ReferenceAttachment {
    name: String,
    mime_type: Option<String>,
    size_bytes: i64,
    kind: String,
    local_path: String,
}

struct ReferenceContext {
    message_id: Uuid,
    sender_label: String,
    sender_type: ChatSenderType,
    created_at: String,
    content: String,
    attachments: Vec<ReferenceAttachment>,
}

#[allow(dead_code)]
struct MessageAttachmentContext {
    attachments: Vec<ReferenceAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct WorkspaceObservedPathEntry {
    path: String,
    source: String,
    existed_after_run: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    modified_at: Option<String>,
}

fn looks_like_workspace_path(candidate: &str) -> bool {
    if candidate.is_empty() || candidate.contains("://") {
        return false;
    }

    if candidate.contains('/') || candidate.contains('\\') {
        return true;
    }

    Path::new(candidate)
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| {
            PATH_LIKE_EXTENSIONS
                .iter()
                .any(|allowed| allowed.eq_ignore_ascii_case(extension))
        })
        .unwrap_or(false)
}

pub(super) fn is_internal_openteams_runtime_path(path: &Path) -> bool {
    let components = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            Component::CurDir => None,
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => None,
        })
        .collect::<Vec<_>>();

    match components.as_slice() {
        [openteams, runs, ..] if openteams == OPENTEAMS_HOME_DIR && runs == RUNS_DIR_NAME => true,
        [openteams, context, _session_id, file]
            if openteams == OPENTEAMS_HOME_DIR
                && context == CONTEXT_DIR_NAME
                && matches!(
                    file.as_str(),
                    "messages.jsonl"
                        | LEGACY_COMPACTED_CONTEXT_FILE_NAME
                        | SHARED_BLACKBOARD_FILE_NAME
                        | WORK_RECORDS_FILE_NAME
                ) =>
        {
            true
        }
        [openteams, context, _session_id, internal_dir, ..]
            if openteams == OPENTEAMS_HOME_DIR
                && context == CONTEXT_DIR_NAME
                && matches!(internal_dir.as_str(), "attachments" | "references") =>
        {
            true
        }
        _ => false,
    }
}

fn normalize_workspace_observed_path_with_options(
    raw: &str,
    workspace_root: &Path,
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

    let candidate_path = PathBuf::from(trimmed);
    let relative = if candidate_path.is_absolute() {
        candidate_path
            .strip_prefix(workspace_root)
            .ok()?
            .to_path_buf()
    } else {
        candidate_path
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

fn normalize_workspace_observed_path(raw: &str, workspace_root: &Path) -> Option<String> {
    normalize_workspace_observed_path_with_options(raw, workspace_root, false)
}

fn extract_workspace_paths_from_artifact_text(text: &str, workspace_root: &Path) -> Vec<String> {
    extract_workspace_paths_from_text_with_options(text, workspace_root, true)
}

fn extract_workspace_paths_from_text_with_options(
    text: &str,
    workspace_root: &Path,
    allow_internal_runtime_path: bool,
) -> Vec<String> {
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

    let mut deduped = BTreeMap::<String, ()>::new();
    for candidate in candidates {
        if let Some(path) = normalize_workspace_observed_path_with_options(
            &candidate,
            workspace_root,
            allow_internal_runtime_path,
        ) {
            deduped.insert(path, ());
        }
    }

    deduped.into_keys().collect()
}
