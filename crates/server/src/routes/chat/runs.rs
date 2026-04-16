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
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt, SeekFrom},
};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

const DEFAULT_LOG_CHUNK_BYTES: u64 = 256 * 1024;
const MAX_LOG_CHUNK_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_RETENTION_LIST_LIMIT: u32 = 100;
const MAX_RETENTION_LIST_LIMIT: u32 = 500;

#[derive(Debug, Deserialize)]
pub struct RunLogQuery {
    offset: Option<u64>,
    limit: Option<u64>,
    tail: Option<bool>,
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
}
