use std::path::{Path as StdPath, PathBuf};

use axum::{
    Extension,
    extract::{Path, Query, State},
    http::{
        HeaderValue, StatusCode,
        header::{CONTENT_TYPE, HeaderName},
    },
    response::{IntoResponse, Json as ResponseJson, Response},
};
use db::models::{
    chat_run::{ChatRun, ChatRunLogState, ChatRunRetentionInfo},
    chat_session::ChatSession,
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::chat_runner::ChatRunActivityLine;
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt, SeekFrom},
};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use super::sessions::{
    WorkspaceChanges, collect_run_files, resolve_session_workspace_path_for_request,
};
use crate::{DeploymentImpl, error::ApiError};

const DEFAULT_LOG_CHUNK_BYTES: u64 = 256 * 1024;
const MAX_LOG_CHUNK_BYTES: u64 = 2 * 1024 * 1024;
const RUN_ACTIVITY_FILE_NAME: &str = "activity.jsonl";
const DEFAULT_ACTIVITY_LIMIT: u64 = 1000;
const MAX_ACTIVITY_LIMIT: u64 = 1000;
const DEFAULT_RETENTION_LIST_LIMIT: u32 = 100;
const MAX_RETENTION_LIST_LIMIT: u32 = 500;

#[derive(Debug, Deserialize)]
pub struct RunLogQuery {
    offset: Option<u64>,
    limit: Option<u64>,
    tail: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct RunActivityQuery {
    offset: Option<u64>,
    limit: Option<u64>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ChatRunActivityResponse {
    pub run_id: Uuid,
    pub lines: Vec<ChatRunActivityLine>,
    pub next_offset: Option<u64>,
    pub is_pruned: bool,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct ChatRunRetentionListQuery {
    pub run_ids: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ChatRunRetentionListResponse {
    pub runs: Vec<ChatRunRetentionInfo>,
}

fn parse_run_ids(raw: Option<&str>) -> Result<Option<Vec<Uuid>>, ApiError> {
    let Some(raw) = raw.map(str::trim) else {
        return Ok(None);
    };

    if raw.is_empty() {
        return Ok(Some(Vec::new()));
    }

    raw.split(',')
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            Uuid::parse_str(segment)
                .map_err(|_| ApiError::BadRequest("Invalid run_ids query parameter".to_string()))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}

pub async fn get_session_runs_retention(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ChatRunRetentionListQuery>,
) -> Result<ResponseJson<ApiResponse<ChatRunRetentionListResponse>>, ApiError> {
    let run_ids = parse_run_ids(query.run_ids.as_deref())?;
    let limit = query
        .limit
        .unwrap_or(DEFAULT_RETENTION_LIST_LIMIT)
        .clamp(1, MAX_RETENTION_LIST_LIMIT);
    let runs = ChatRun::list_retention_for_session(
        &deployment.db().pool,
        session.id,
        run_ids.as_deref(),
        limit,
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(
        ChatRunRetentionListResponse { runs },
    )))
}

async fn read_activity_file_page(
    activity_path: &StdPath,
    offset: u64,
    limit: u64,
) -> Result<(Vec<ChatRunActivityLine>, Option<u64>), std::io::Error> {
    let content = tokio::fs::read_to_string(activity_path).await?;

    let raw_lines = content.lines().collect::<Vec<_>>();
    let start = (offset as usize).min(raw_lines.len());
    let end = start.saturating_add(limit as usize).min(raw_lines.len());
    let mut lines = Vec::new();
    for raw in &raw_lines[start..end] {
        match serde_json::from_str::<ChatRunActivityLine>(raw) {
            Ok(line) => lines.push(line),
            Err(error) => tracing::warn!(
                activity_path = %activity_path.display(),
                %error,
                "skipping malformed chat run activity line"
            ),
        }
    }

    let next_offset = (end < raw_lines.len()).then_some(end as u64);
    Ok((lines, next_offset))
}

pub async fn get_run_activity(
    State(deployment): State<DeploymentImpl>,
    Path(run_id): Path<Uuid>,
    Query(query): Query<RunActivityQuery>,
) -> Result<Response, ApiError> {
    let Some(run) = ChatRun::find_by_id(&deployment.db().pool, run_id).await? else {
        return Err(ApiError::BadRequest("Chat run not found".to_string()));
    };

    let activity_path = PathBuf::from(&run.run_dir).join(RUN_ACTIVITY_FILE_NAME);
    let offset = query.offset.unwrap_or(0);
    let limit = query
        .limit
        .unwrap_or(DEFAULT_ACTIVITY_LIMIT)
        .clamp(1, MAX_ACTIVITY_LIMIT);

    let (lines, next_offset) = match read_activity_file_page(&activity_path, offset, limit).await {
        Ok(page) => page,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok((
                StatusCode::GONE,
                ResponseJson(ApiResponse::<()>::error("Chat run activity expired")),
            )
                .into_response());
        }
        Err(_) => {
            return Err(ApiError::BadRequest(
                "Chat run activity file not found".to_string(),
            ));
        }
    };

    Ok(
        ResponseJson(ApiResponse::<ChatRunActivityResponse>::success(
            ChatRunActivityResponse {
                run_id,
                lines,
                next_offset,
                is_pruned: false,
            },
        ))
        .into_response(),
    )
}

pub async fn get_run_log(
    State(deployment): State<DeploymentImpl>,
    Path(run_id): Path<Uuid>,
    Query(query): Query<RunLogQuery>,
) -> Result<Response, ApiError> {
    let Some(run) = ChatRun::find_by_id(&deployment.db().pool, run_id).await? else {
        return Err(ApiError::BadRequest("Chat run not found".to_string()));
    };

    if run.log_state == ChatRunLogState::Pruned || run.raw_log_path.is_none() {
        return Ok((
            StatusCode::GONE,
            ResponseJson(ApiResponse::<()>::error("Chat run log expired")),
        )
            .into_response());
    }

    let log_path = run.raw_log_path.expect("checked above");

    let mut file = match File::open(&log_path).await {
        Ok(file) => file,
        Err(_) => {
            if run.log_state == ChatRunLogState::Pruned {
                return Ok((
                    StatusCode::GONE,
                    ResponseJson(ApiResponse::<()>::error("Chat run log expired")),
                )
                    .into_response());
            }
            return Err(ApiError::BadRequest(
                "Chat run log file not found".to_string(),
            ));
        }
    };

    let file_size = match file.metadata().await {
        Ok(metadata) => metadata.len(),
        Err(_) => {
            return Err(ApiError::BadRequest(
                "Chat run log file not found".to_string(),
            ));
        }
    };

    let limit = query
        .limit
        .unwrap_or(DEFAULT_LOG_CHUNK_BYTES)
        .clamp(1, MAX_LOG_CHUNK_BYTES);
    let start = match query.offset {
        Some(offset) => offset.min(file_size),
        None => {
            if query.tail.unwrap_or(true) {
                file_size.saturating_sub(limit)
            } else {
                0
            }
        }
    };
    let read_len = file_size.saturating_sub(start).min(limit);

    if file.seek(SeekFrom::Start(start)).await.is_err() {
        return Err(ApiError::BadRequest(
            "Chat run log file not found".to_string(),
        ));
    }

    let mut buffer = Vec::with_capacity(read_len as usize);
    {
        let mut reader = file.take(read_len);
        if reader.read_to_end(&mut buffer).await.is_err() {
            return Err(ApiError::BadRequest(
                "Chat run log file not found".to_string(),
            ));
        }
    }
    let content = String::from_utf8_lossy(&buffer).into_owned();

    let mut response = ([(CONTENT_TYPE, "text/plain; charset=utf-8")], content).into_response();
    response.headers_mut().insert(
        HeaderName::from_static("x-openteams-log-state"),
        HeaderValue::from_static(match run.log_state {
            ChatRunLogState::Live => "live",
            ChatRunLogState::Tail => "tail",
            ChatRunLogState::Pruned => "pruned",
        }),
    );
    response.headers_mut().insert(
        HeaderName::from_static("x-openteams-log-truncated"),
        HeaderValue::from_static(if run.log_truncated { "true" } else { "false" }),
    );
    Ok(response)
}

pub async fn get_run_diff(
    State(deployment): State<DeploymentImpl>,
    Path(run_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let Some(run) = ChatRun::find_by_id(&deployment.db().pool, run_id).await? else {
        return Err(ApiError::BadRequest("Chat run not found".to_string()));
    };

    let scoped_diff_path = PathBuf::from(&run.run_dir).join(format!(
        "session_agent_{}_run_{:04}_diff.patch",
        run.session_agent_id, run.run_index
    ));
    let prefixed_diff_path =
        PathBuf::from(&run.run_dir).join(format!("run_{:04}_diff.patch", run.run_index));
    let legacy_diff_path = PathBuf::from(&run.run_dir).join("diff.patch");
    let content = match tokio::fs::read_to_string(&scoped_diff_path).await {
        Ok(content) => content,
        Err(_) => match tokio::fs::read_to_string(&prefixed_diff_path).await {
            Ok(content) => content,
            Err(_) => match tokio::fs::read_to_string(&legacy_diff_path).await {
                Ok(content) => content,
                Err(_) => {
                    return Err(ApiError::BadRequest(
                        "Chat run diff file not found".to_string(),
                    ));
                }
            },
        },
    };

    Ok(([(CONTENT_TYPE, "text/plain; charset=utf-8")], content).into_response())
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct ChatRunFilesQuery {
    /// When true, include the per-file unified diff text for each changed file.
    /// Defaults to false (paths + counts only) to keep the response light.
    pub include_diff: Option<bool>,
}

/// Structured per-run changed-file list. Mirrors the session-level
/// `WorkspaceChangesResponse` shape but scoped to a single chat run, so the
/// frontend can reuse `WorkspaceChangedFile` / `flattenWorkspaceChanges`.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ChatRunFilesResponse {
    pub run_id: Uuid,
    pub workspace_path: Option<String>,
    pub is_git_repo: bool,
    pub changes: WorkspaceChanges,
    pub error: Option<String>,
}

/// Returns the structured changed-file list for a single chat run (the per-run
/// counterpart of `GET /chat/sessions/{id}/workspace-changes`). Each file
/// carries its path, `+`/`-` counts and (optionally) inline unified diff,
/// classified into modified / added / deleted / untracked.
pub async fn get_run_files(
    State(deployment): State<DeploymentImpl>,
    Path(run_id): Path<Uuid>,
    Query(query): Query<ChatRunFilesQuery>,
) -> Result<ResponseJson<ApiResponse<ChatRunFilesResponse>>, ApiError> {
    let Some(run) = ChatRun::find_by_id(&deployment.db().pool, run_id).await? else {
        return Err(ApiError::BadRequest("Chat run not found".to_string()));
    };

    let include_diff = query.include_diff.unwrap_or(false);
    let workspace_path = if let Some(session) =
        ChatSession::find_by_id(&deployment.db().pool, run.session_id).await?
    {
        match run.workspace_path.as_deref() {
            Some(path) => {
                resolve_session_workspace_path_for_request(&deployment.db().pool, &session, path)
                    .await?
                    .or_else(|| run.workspace_path.clone())
            }
            None => run.workspace_path.clone(),
        }
    } else {
        run.workspace_path.clone()
    };
    let is_git_repo = workspace_path
        .as_deref()
        .map(|path| git2::Repository::open(path).is_ok())
        .unwrap_or(false);

    let mut effective_run = run.clone();
    effective_run.workspace_path = workspace_path.clone();
    let changes = collect_run_files(&effective_run, include_diff);
    tracing::debug!(
        run_id = %run_id,
        session_id = %run.session_id,
        session_agent_id = %run.session_agent_id,
        run_index = run.run_index,
        workspace_path = ?workspace_path,
        include_diff,
        is_git_repo,
        modified_count = changes.modified.len(),
        added_count = changes.added.len(),
        deleted_count = changes.deleted.len(),
        untracked_count = changes.untracked.len(),
        "[chat_runs] Returning structured run file changes"
    );

    Ok(ResponseJson(ApiResponse::success(ChatRunFilesResponse {
        run_id,
        workspace_path,
        is_git_repo,
        changes,
        error: None,
    })))
}

#[derive(Debug, Deserialize)]
pub struct UntrackedFileQuery {
    path: String,
}

fn run_untracked_candidate_paths(run: &ChatRun, rel_path: &StdPath) -> Vec<PathBuf> {
    let run_dir = PathBuf::from(&run.run_dir);
    let mut candidates = vec![
        run_dir
            .join(format!(
                "session_agent_{}_run_{:04}_untracked",
                run.session_agent_id, run.run_index
            ))
            .join(rel_path),
        run_dir
            .join(format!("run_{:04}_untracked", run.run_index))
            .join(rel_path),
        run_dir.join("untracked").join(rel_path),
    ];

    if let Some(workspace_path) = run.workspace_path.as_deref() {
        candidates.push(PathBuf::from(workspace_path).join(rel_path));
    }

    candidates
}

async fn read_run_untracked_file_content(
    run: &ChatRun,
    rel_path: &StdPath,
) -> Result<String, ApiError> {
    for candidate in run_untracked_candidate_paths(run, rel_path) {
        match tokio::fs::read_to_string(&candidate).await {
            Ok(content) => return Ok(content),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => continue,
        }
    }

    Err(ApiError::BadRequest(
        "Untracked file content not found".to_string(),
    ))
}

pub async fn get_run_untracked_file(
    State(deployment): State<DeploymentImpl>,
    Path(run_id): Path<Uuid>,
    Query(query): Query<UntrackedFileQuery>,
) -> Result<Response, ApiError> {
    let Some(run) = ChatRun::find_by_id(&deployment.db().pool, run_id).await? else {
        return Err(ApiError::BadRequest("Chat run not found".to_string()));
    };

    let rel_path = PathBuf::from(&query.path);
    if rel_path.is_absolute()
        || rel_path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(ApiError::BadRequest("Invalid untracked path".to_string()));
    }

    let content = read_run_untracked_file_content(&run, &rel_path).await?;

    Ok(([(CONTENT_TYPE, "text/plain; charset=utf-8")], content).into_response())
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::chat_run::ChatRunArtifactState;
    use services::services::chat_runner::{ChatRunActivityLineType, ChatStreamDeltaType};
    use uuid::Uuid;

    use super::*;

    fn test_run(run_dir: &StdPath, workspace_path: Option<&StdPath>) -> ChatRun {
        ChatRun {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            session_agent_id: Uuid::new_v4(),
            workspace_path: workspace_path.map(|path| path.to_string_lossy().to_string()),
            run_index: 2,
            run_dir: run_dir.to_string_lossy().to_string(),
            input_path: None,
            output_path: None,
            raw_log_path: None,
            meta_path: None,
            log_state: ChatRunLogState::Live,
            artifact_state: ChatRunArtifactState::Full,
            log_truncated: false,
            log_capture_degraded: false,
            pruned_at: None,
            prune_reason: None,
            retention_summary_json: None,
            created_at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn read_run_untracked_file_content_falls_back_to_workspace_file() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let run_dir = tempdir.path().join("run-record");
        let workspace_path = tempdir.path().join("workspace");
        tokio::fs::create_dir_all(&run_dir)
            .await
            .expect("create run dir");
        tokio::fs::create_dir_all(workspace_path.join("docs"))
            .await
            .expect("create workspace dir");
        tokio::fs::write(
            workspace_path.join("docs").join("note.md"),
            "live content\n",
        )
        .await
        .expect("write workspace file");

        let run = test_run(&run_dir, Some(&workspace_path));
        let content = read_run_untracked_file_content(&run, StdPath::new("docs/note.md"))
            .await
            .expect("read fallback content");

        assert_eq!(content, "live content\n");
    }

    fn activity_line(run_id: Uuid, sequence: u64, content: &str) -> ChatRunActivityLine {
        ChatRunActivityLine {
            line_id: Uuid::new_v4(),
            run_id,
            session_id: Uuid::new_v4(),
            session_agent_id: Uuid::new_v4(),
            agent_id: Uuid::new_v4(),
            agent_name: "codex".to_string(),
            sequence,
            line_type: ChatRunActivityLineType::Thinking,
            stream_type: ChatStreamDeltaType::Thinking,
            content: content.to_string(),
            created_at: Utc::now().to_rfc3339(),
        }
    }

    #[tokio::test]
    async fn read_activity_file_page_paginates_jsonl_lines() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let run_id = Uuid::new_v4();
        let path = tempdir.path().join(RUN_ACTIVITY_FILE_NAME);
        let lines = [
            activity_line(run_id, 0, "first"),
            activity_line(run_id, 1, "second"),
            activity_line(run_id, 2, "third"),
        ];
        let jsonl = lines
            .iter()
            .map(serde_json::to_string)
            .collect::<Result<Vec<_>, _>>()
            .expect("serialize activity")
            .join("\n");
        tokio::fs::write(&path, format!("{jsonl}\n"))
            .await
            .expect("write activity");

        let (page, next_offset) = read_activity_file_page(&path, 1, 1)
            .await
            .expect("read page");

        assert_eq!(page.len(), 1);
        assert_eq!(page[0].content, "second");
        assert_eq!(next_offset, Some(2));
    }

    #[tokio::test]
    async fn read_activity_file_page_missing_file_is_not_found() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let path = tempdir.path().join(RUN_ACTIVITY_FILE_NAME);

        let err = read_activity_file_page(&path, 0, 1000)
            .await
            .expect_err("missing activity should fail");

        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    }
}
