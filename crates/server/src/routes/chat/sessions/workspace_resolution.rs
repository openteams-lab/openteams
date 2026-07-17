fn workspace_path_metadata_error(err: std::io::Error) -> WorkspaceGitErrorData {
    match err.kind() {
        std::io::ErrorKind::NotFound => {
            workspace_git_error(WorkspaceGitErrorCode::WorkspacePathNotFound)
        }
        _ => workspace_git_error(WorkspaceGitErrorCode::WorkspacePathNotAccessible),
    }
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
        None => {
            // For isolated sessions, do NOT inherit the session default
            // workspace path. Keeping it None ensures the ChatRunner
            // resolver always runs worktree resolution instead of treating
            // the inherited default as an "explicit agent workspace".
            if session.worktree_mode == ChatSessionWorktreeMode::Isolated {
                Ok(None)
            } else {
                Ok(session.default_workspace_path.clone())
            }
        }
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
    excluded_session_agent_id: Option<Uuid>,
    member_name: &str,
) -> Result<bool, sqlx::Error> {
    let count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(1)
           FROM chat_session_agents
           WHERE session_id = ?1
             AND (?2 IS NULL OR id != ?2)
             AND lower(trim(member_name)) = lower(trim(?3))"#,
    )
    .bind(session_id)
    .bind(excluded_session_agent_id)
    .bind(member_name)
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
    sqlx::query_as::<_, SessionWorkspaceRow>(
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
    .await
}

fn same_workspace_path(left: &str, right: &str) -> bool {
    !left.trim().is_empty()
        && !right.trim().is_empty()
        && (left == right || Path::new(left) == Path::new(right))
}

fn synthetic_workspace_row(workspace_path: String) -> SessionWorkspaceRow {
    SessionWorkspaceRow {
        workspace_path,
        agent_id: Uuid::nil(),
        agent_name: String::new(),
    }
}

fn worktree_workspace_for_request(
    session: &ChatSession,
    worktree: &SessionWorktree,
    requested_path: &str,
) -> Option<String> {
    let matches_base = same_workspace_path(requested_path, &worktree.base_workspace_path);
    let matches_worktree = same_workspace_path(requested_path, &worktree.worktree_path);
    let matches_session_default = session
        .default_workspace_path
        .as_deref()
        .is_some_and(|path| same_workspace_path(requested_path, path));

    if !(matches_base || matches_worktree || matches_session_default) {
        return None;
    }

    if worktree.status.is_active_for_workspace() {
        Some(worktree.worktree_path.clone())
    } else {
        Some(worktree.base_workspace_path.clone())
    }
}

async fn latest_session_worktree(
    pool: &sqlx::SqlitePool,
    session: &ChatSession,
) -> Result<Option<SessionWorktree>, ApiError> {
    if session.worktree_mode != ChatSessionWorktreeMode::Isolated {
        return Ok(None);
    }

    SessionWorktreeService::new(pool.clone())
        .get_latest_for_session(session.id)
        .await
        .map_err(|err| ApiError::BadRequest(format!("Failed to inspect session worktree: {err}")))
}

pub(crate) async fn resolve_session_workspace_path_for_request(
    pool: &sqlx::SqlitePool,
    session: &ChatSession,
    requested_path: &str,
) -> Result<Option<String>, ApiError> {
    let Some(worktree) = latest_session_worktree(pool, session).await? else {
        return Ok(None);
    };
    Ok(worktree_workspace_for_request(
        session,
        &worktree,
        requested_path,
    ))
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
    let mut rows = list_session_workspace_rows(&deployment.db().pool, session.id).await?;
    if let Some(default_workspace) = session.default_workspace_path.clone() {
        rows.push(synthetic_workspace_row(default_workspace));
    }
    if let Some(worktree) = latest_session_worktree(&deployment.db().pool, &session).await? {
        let workspace_path = if worktree.status.is_active_for_workspace() {
            worktree.worktree_path
        } else {
            worktree.base_workspace_path
        };
        rows.push(synthetic_workspace_row(workspace_path));
    }

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

    let worktree_workspace_path =
        resolve_session_workspace_path_for_request(&deployment.db().pool, &session, workspace_path)
            .await?;
    if worktree_workspace_path.is_none()
        && !session_has_workspace_path(&deployment.db().pool, session.id, workspace_path).await?
    {
        workflow_analytics::track_permission_denied(
            workflow_analytics::analytics_if_enabled(
                deployment.analytics().as_ref(),
                deployment.analytics_enabled(),
            ),
            session.id,
            "workspace_path_not_in_session",
        );
        return Err(ApiError::BadRequest(
            "Workspace path is not part of this session.".to_string(),
        ));
    }

    let workspace_path_owned =
        worktree_workspace_path.unwrap_or_else(|| workspace_path.to_string());
    let mut run_workspace_paths = vec![workspace_path_owned.clone()];
    if !same_workspace_path(&workspace_path_owned, workspace_path) {
        run_workspace_paths.push(workspace_path.to_string());
    }
    let mut seen_run_workspace_paths = Vec::<String>::new();
    let mut runs = Vec::new();
    for run_workspace_path in run_workspace_paths {
        if seen_run_workspace_paths
            .iter()
            .any(|seen| same_workspace_path(seen, &run_workspace_path))
        {
            continue;
        }
        seen_run_workspace_paths.push(run_workspace_path.clone());
        runs.extend(
            ChatRun::list_for_session_workspace(
                &deployment.db().pool,
                session.id,
                &run_workspace_path,
            )
            .await?,
        );
    }
    let work_items = ChatWorkItem::find_by_session_id(&deployment.db().pool, session.id, None)
        .await?
        .into_iter()
        .filter(|item| item.item_type == ChatWorkItemType::Artifact)
        .collect::<Vec<_>>();
    let session_id = session.id;
    let response = tokio::task::spawn_blocking(move || {
        collect_workspace_changes_with_artifacts(
            session_id,
            &workspace_path_owned,
            include_diff,
            runs,
            work_items,
            HashSet::new(),
        )
    })
    .await
    .map_err(|err| ApiError::BadRequest(format!("Failed to inspect workspace changes: {err}")))?;

    let (modified_count, added_count, deleted_count, untracked_count) = response
        .changes
        .as_ref()
        .map(|changes| {
            (
                changes.modified.len(),
                changes.added.len(),
                changes.deleted.len(),
                changes.untracked.len(),
            )
        })
        .unwrap_or((0, 0, 0, 0));
    tracing::debug!(
        session_id = %session.id,
        workspace_path,
        include_diff,
        is_git_repo = response.is_git_repo,
        has_changes = response.changes.is_some(),
        modified_count,
        added_count,
        deleted_count,
        untracked_count,
        error = ?response.error,
        "[chat_sessions] Returning session workspace changes"
    );

    Ok(ResponseJson(ApiResponse::success(response)))
}
