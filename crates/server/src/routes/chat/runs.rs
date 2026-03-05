use std::path::PathBuf;

use axum::{
    extract::{Path, Query, State},
    http::header::CONTENT_TYPE,
    response::{IntoResponse, Response},
};
use db::models::chat_run::ChatRun;
use deployment::Deployment;
use serde::Deserialize;
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt, SeekFrom},
};
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

const DEFAULT_LOG_CHUNK_BYTES: u64 = 256 * 1024;
const MAX_LOG_CHUNK_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct RunLogQuery {
    offset: Option<u64>,
    limit: Option<u64>,
    tail: Option<bool>,
}

pub async fn get_run_log(
    State(deployment): State<DeploymentImpl>,
    Path(run_id): Path<Uuid>,
    Query(query): Query<RunLogQuery>,
) -> Result<Response, ApiError> {
    let Some(run) = ChatRun::find_by_id(&deployment.db().pool, run_id).await? else {
        return Err(ApiError::BadRequest("Chat run not found".to_string()));
    };

    let Some(log_path) = run.raw_log_path else {
        return Err(ApiError::BadRequest("Chat run has no log".to_string()));
    };

    let mut file = match File::open(&log_path).await {
        Ok(file) => file,
        Err(_) => {
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

    Ok(([(CONTENT_TYPE, "text/plain; charset=utf-8")], content).into_response())
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

    let scoped_untracked_dir = PathBuf::from(&run.run_dir).join(format!(
        "session_agent_{}_run_{:04}_untracked",
        run.session_agent_id, run.run_index
    ));
    let prefixed_untracked_dir =
        PathBuf::from(&run.run_dir).join(format!("run_{:04}_untracked", run.run_index));
    let legacy_untracked_dir = PathBuf::from(&run.run_dir).join("untracked");
    let scoped_path = scoped_untracked_dir.join(&rel_path);
    let content = match tokio::fs::read_to_string(&scoped_path).await {
        Ok(content) => content,
        Err(_) => {
            let prefixed_path = prefixed_untracked_dir.join(&rel_path);
            match tokio::fs::read_to_string(&prefixed_path).await {
                Ok(content) => content,
                Err(_) => {
                    let legacy_path = legacy_untracked_dir.join(rel_path);
                    match tokio::fs::read_to_string(&legacy_path).await {
                        Ok(content) => content,
                        Err(_) => {
                            return Err(ApiError::BadRequest(
                                "Untracked file content not found".to_string(),
                            ));
                        }
                    }
                }
            }
        }
    };

    Ok(([(CONTENT_TYPE, "text/plain; charset=utf-8")], content).into_response())
}
