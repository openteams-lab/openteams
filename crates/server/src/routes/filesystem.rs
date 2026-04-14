use std::{
    path::{Component, Path, PathBuf},
    process::Command,
};

use axum::{
    Json, Router,
    extract::{Query, State},
    response::Json as ResponseJson,
    routing::{get, post},
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::filesystem::{DirectoryEntry, DirectoryListResponse, FilesystemError};
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize)]
pub struct ListDirectoryQuery {
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OpenInExplorerRequest {
    pub path: String,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OpenInExplorerResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn open_in_explorer_response(ok: bool, error: Option<String>) -> Json<OpenInExplorerResponse> {
    Json(OpenInExplorerResponse { ok, error })
}

fn resolve_open_target_path(payload: &OpenInExplorerRequest) -> Result<PathBuf, String> {
    let trimmed_path = payload.path.trim();
    if trimmed_path.is_empty() {
        return Err("Path is required".to_string());
    }

    let requested_path = Path::new(trimmed_path);
    if requested_path.is_absolute() {
        return Ok(requested_path.to_path_buf());
    }

    let Some(workspace_path) = payload.workspace_path.as_deref().map(str::trim) else {
        return Ok(PathBuf::from(trimmed_path));
    };
    if workspace_path.is_empty() {
        return Ok(PathBuf::from(trimmed_path));
    }

    for component in requested_path.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Path must stay within workspace".to_string());
            }
        }
    }

    Ok(Path::new(workspace_path).join(requested_path))
}

fn spawn_detached_command(command: &mut Command) -> Result<(), std::io::Error> {
    let _child = command.spawn()?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn spawn_open_in_explorer(path: &Path, is_directory: bool) -> Result<(), std::io::Error> {
    let mut command = Command::new("open");
    if is_directory {
        command.args(["-a", "Finder"]).arg(path);
    } else {
        command.arg("-R").arg(path);
    }
    spawn_detached_command(&mut command)?;

    let mut activate = Command::new("osascript");
    activate.args(["-e", "tell application \"Finder\" to activate"]);
    let _ = spawn_detached_command(&mut activate);
    Ok(())
}

#[cfg(target_os = "windows")]
fn spawn_open_in_explorer(path: &Path, is_directory: bool) -> Result<(), std::io::Error> {
    let mut command = Command::new("explorer");
    if is_directory {
        command.arg(path);
    } else {
        command.arg(format!("/select,{}", path.display()));
    }
    spawn_detached_command(&mut command)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_open_in_explorer(path: &Path, is_directory: bool) -> Result<(), std::io::Error> {
    let mut command = Command::new("xdg-open");
    if is_directory {
        command.arg(path);
    } else {
        command.arg(path.parent().unwrap_or(path));
    }
    spawn_detached_command(&mut command)
}

pub async fn open_in_explorer(
    Json(payload): Json<OpenInExplorerRequest>,
) -> Result<Json<OpenInExplorerResponse>, ApiError> {
    let target_path = match resolve_open_target_path(&payload) {
        Ok(path) => path,
        Err(err) => return Ok(open_in_explorer_response(false, Some(err))),
    };

    let metadata = match tokio::fs::metadata(&target_path).await {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(open_in_explorer_response(
                false,
                Some("Path does not exist".to_string()),
            ));
        }
        Err(err) => {
            return Ok(open_in_explorer_response(false, Some(err.to_string())));
        }
    };

    if !metadata.is_dir() && !metadata.is_file() {
        return Ok(open_in_explorer_response(
            false,
            Some("Path is not a file or directory".to_string()),
        ));
    }

    match spawn_open_in_explorer(&target_path, metadata.is_dir()) {
        Ok(()) => Ok(open_in_explorer_response(true, None)),
        Err(err) => Ok(open_in_explorer_response(false, Some(err.to_string()))),
    }
}

pub async fn list_directory(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ListDirectoryQuery>,
) -> Result<ResponseJson<ApiResponse<DirectoryListResponse>>, ApiError> {
    match deployment.filesystem().list_directory(query.path).await {
        Ok(response) => Ok(ResponseJson(ApiResponse::success(response))),
        Err(FilesystemError::DirectoryDoesNotExist) => {
            Ok(ResponseJson(ApiResponse::error("Directory does not exist")))
        }
        Err(FilesystemError::PathIsNotDirectory) => {
            Ok(ResponseJson(ApiResponse::error("Path is not a directory")))
        }
        Err(FilesystemError::Io(e)) => {
            tracing::error!("Failed to read directory: {}", e);
            Ok(ResponseJson(ApiResponse::error(&format!(
                "Failed to read directory: {}",
                e
            ))))
        }
    }
}

pub async fn list_roots(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<DirectoryEntry>>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(
        deployment.filesystem().list_roots(),
    )))
}

pub async fn list_git_repos(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ListDirectoryQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<DirectoryEntry>>>, ApiError> {
    let res = if let Some(ref path) = query.path {
        deployment
            .filesystem()
            .list_git_repos(Some(path.clone()), 800, 1200, Some(3))
            .await
    } else {
        deployment
            .filesystem()
            .list_common_git_repos(800, 1200, Some(4))
            .await
    };
    match res {
        Ok(response) => Ok(ResponseJson(ApiResponse::success(response))),
        Err(FilesystemError::DirectoryDoesNotExist) => {
            Ok(ResponseJson(ApiResponse::error("Directory does not exist")))
        }
        Err(FilesystemError::PathIsNotDirectory) => {
            Ok(ResponseJson(ApiResponse::error("Path is not a directory")))
        }
        Err(FilesystemError::Io(e)) => {
            tracing::error!("Failed to read directory: {}", e);
            Ok(ResponseJson(ApiResponse::error(&format!(
                "Failed to read directory: {}",
                e
            ))))
        }
    }
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/filesystem/roots", get(list_roots))
        .route("/filesystem/directory", get(list_directory))
        .route("/filesystem/git-repos", get(list_git_repos))
        .route("/filesystem/open-in-explorer", post(open_in_explorer))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_open_target_path_keeps_absolute_path() {
        let tempdir = tempfile::tempdir().expect("create temp directory");
        let absolute_path = tempdir.path().join("file.rs");
        let request = OpenInExplorerRequest {
            path: absolute_path.to_string_lossy().to_string(),
            workspace_path: Some("/workspace/root".to_string()),
        };

        let resolved = resolve_open_target_path(&request).expect("resolve absolute path");
        assert_eq!(resolved, absolute_path);
    }

    #[test]
    fn resolve_open_target_path_joins_workspace_and_relative_path() {
        let request = OpenInExplorerRequest {
            path: "src/main.ts".to_string(),
            workspace_path: Some("/workspace/root".to_string()),
        };

        let resolved = resolve_open_target_path(&request).expect("resolve relative path");
        assert_eq!(
            resolved,
            PathBuf::from("/workspace/root").join("src/main.ts")
        );
    }

    #[test]
    fn resolve_open_target_path_rejects_parent_escape() {
        let request = OpenInExplorerRequest {
            path: "../secret.txt".to_string(),
            workspace_path: Some("/workspace/root".to_string()),
        };

        let error = resolve_open_target_path(&request).expect_err("reject parent escape");
        assert_eq!(error, "Path must stay within workspace");
    }
}
