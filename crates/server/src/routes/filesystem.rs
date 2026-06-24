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
use uuid::Uuid;

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
    #[serde(default)]
    pub session_id: Option<Uuid>,
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

fn validate_workspace_relative_path(path: &Path) -> Result<(), String> {
    for component in path.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Path must stay within workspace".to_string());
            }
        }
    }

    Ok(())
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

    validate_workspace_relative_path(requested_path)?;

    Ok(Path::new(workspace_path).join(requested_path))
}

fn resolve_relative_target_in_workspaces(
    requested_path: &Path,
    workspace_paths: &[String],
) -> Option<PathBuf> {
    let candidates: Vec<PathBuf> = workspace_paths
        .iter()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .map(|workspace_path| Path::new(workspace_path).join(requested_path))
        .collect();

    candidates
        .iter()
        .find(|candidate| candidate.exists())
        .cloned()
        .or_else(|| candidates.into_iter().next())
}

async fn list_open_workspace_paths(
    pool: &sqlx::SqlitePool,
    session_id: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        r#"
        SELECT workspace_path
        FROM (
            SELECT sessions.default_workspace_path AS workspace_path,
                   0 AS priority
            FROM chat_sessions sessions
            WHERE sessions.id = ?1
              AND sessions.default_workspace_path IS NOT NULL
              AND trim(sessions.default_workspace_path) != ''

            UNION

            SELECT session_agents.workspace_path AS workspace_path,
                   1 AS priority
            FROM chat_session_agents session_agents
            WHERE session_agents.session_id = ?1
              AND session_agents.workspace_path IS NOT NULL
              AND trim(session_agents.workspace_path) != ''

            UNION

            SELECT runs.workspace_path AS workspace_path,
                   2 AS priority
            FROM chat_runs runs
            WHERE runs.session_id = ?1
              AND runs.workspace_path IS NOT NULL
              AND trim(runs.workspace_path) != ''
        ) workspaces
        GROUP BY workspace_path
        ORDER BY MIN(priority) ASC, lower(workspace_path) ASC
        "#,
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
}

async fn resolve_open_target_path_for_open(
    pool: &sqlx::SqlitePool,
    payload: &OpenInExplorerRequest,
) -> Result<PathBuf, String> {
    let resolved = resolve_open_target_path(payload)?;
    if resolved.is_absolute()
        || payload
            .workspace_path
            .as_deref()
            .is_some_and(|path| !path.trim().is_empty())
    {
        return Ok(resolved);
    }

    let Some(session_id) = payload.session_id else {
        return Ok(resolved);
    };

    validate_workspace_relative_path(&resolved)?;

    let workspace_paths = list_open_workspace_paths(pool, session_id)
        .await
        .map_err(|err| err.to_string())?;
    Ok(resolve_relative_target_in_workspaces(&resolved, &workspace_paths).unwrap_or(resolved))
}

fn spawn_detached_command(command: &mut Command) -> Result<(), std::io::Error> {
    command.current_dir(safe_detached_command_cwd());
    let _child = command.spawn()?;
    Ok(())
}

fn safe_detached_command_cwd() -> std::path::PathBuf {
    std::env::temp_dir()
}

fn absolute_open_target_path(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        return path;
    }

    match std::env::current_dir() {
        Ok(cwd) => cwd.join(&path),
        Err(_) => path,
    }
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
    if !is_directory {
        match windows_select_file_in_explorer(path) {
            Ok(()) => return Ok(()),
            Err(err) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %err,
                    "Failed to select file through Windows Shell API, falling back to explorer.exe"
                );
            }
        }
    }

    let mut command = Command::new("explorer");
    for arg in windows_explorer_args(path, is_directory) {
        command.arg(arg);
    }
    spawn_detached_command(&mut command)
}

#[cfg(target_os = "windows")]
fn windows_explorer_args(path: &Path, is_directory: bool) -> Vec<std::ffi::OsString> {
    if is_directory {
        return vec![windows_normalized_shell_path(path)];
    }

    vec![
        std::ffi::OsString::from("/select,"),
        windows_normalized_shell_path(path),
    ]
}

#[cfg(target_os = "windows")]
fn windows_normalized_shell_path(path: &Path) -> std::ffi::OsString {
    std::ffi::OsString::from(path.to_string_lossy().replace('/', "\\"))
}

#[cfg(target_os = "windows")]
fn windows_select_file_in_explorer(path: &Path) -> Result<(), std::io::Error> {
    let path = path.to_path_buf();
    std::thread::spawn(move || windows_select_file_in_explorer_on_current_thread(&path))
        .join()
        .map_err(|_| std::io::Error::other("Windows Shell API thread panicked"))?
}

#[cfg(target_os = "windows")]
fn windows_select_file_in_explorer_on_current_thread(path: &Path) -> Result<(), std::io::Error> {
    use std::os::windows::ffi::OsStrExt;

    use windows_sys::Win32::{
        System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize},
        UI::Shell::{ILCreateFromPathW, ILFree, SHOpenFolderAndSelectItems},
    };

    const S_OK: i32 = 0;
    const S_FALSE: i32 = 1;
    const RPC_E_CHANGED_MODE: i32 = 0x80010106u32 as i32;

    let shell_path = windows_normalized_shell_path(path);
    let wide_path: Vec<u16> = shell_path.encode_wide().chain(std::iter::once(0)).collect();

    unsafe {
        let init_result = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        let should_uninitialize = init_result == S_OK || init_result == S_FALSE;
        if init_result < 0 && init_result != RPC_E_CHANGED_MODE {
            return Err(hresult_error("CoInitializeEx", init_result));
        }

        let pidl = ILCreateFromPathW(wide_path.as_ptr());
        if pidl.is_null() {
            if should_uninitialize {
                CoUninitialize();
            }
            return Err(std::io::Error::other(
                "ILCreateFromPathW failed to create a shell item",
            ));
        }

        let select_result = SHOpenFolderAndSelectItems(pidl, 0, std::ptr::null(), 0);
        ILFree(pidl);
        if should_uninitialize {
            CoUninitialize();
        }

        if select_result >= 0 {
            Ok(())
        } else {
            Err(hresult_error("SHOpenFolderAndSelectItems", select_result))
        }
    }
}

#[cfg(target_os = "windows")]
fn hresult_error(context: &str, hresult: i32) -> std::io::Error {
    std::io::Error::other(format!(
        "{context} failed with HRESULT 0x{:08X}",
        hresult as u32
    ))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_open_in_explorer(path: &Path, is_directory: bool) -> Result<(), std::io::Error> {
    let mut command = Command::new("xdg-open");
    if is_directory {
        command.arg(path);
        return spawn_detached_command(&mut command);
    }

    if try_show_item_via_freedesktop_file_manager(path).unwrap_or(false) {
        return Ok(());
    }

    if try_show_item_via_linux_file_manager(path).unwrap_or(false) {
        return Ok(());
    }

    command.arg(path.parent().unwrap_or(path));
    spawn_detached_command(&mut command)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn try_show_item_via_freedesktop_file_manager(path: &Path) -> Result<bool, std::io::Error> {
    let Some(uri) = file_uri_for_path(path) else {
        return Ok(false);
    };

    let mut command = Command::new("dbus-send");
    command.args(freedesktop_file_manager_show_items_args(&uri));

    match command.status() {
        Ok(status) => Ok(status.success()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(err),
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn file_uri_for_path(path: &Path) -> Option<String> {
    url::Url::from_file_path(path)
        .ok()
        .map(|url| url.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn freedesktop_file_manager_show_items_args(uri: &str) -> Vec<std::ffi::OsString> {
    vec![
        std::ffi::OsString::from("--session"),
        std::ffi::OsString::from("--dest=org.freedesktop.FileManager1"),
        std::ffi::OsString::from("--type=method_call"),
        std::ffi::OsString::from("/org/freedesktop/FileManager1"),
        std::ffi::OsString::from("org.freedesktop.FileManager1.ShowItems"),
        std::ffi::OsString::from(format!("array:string:{uri}")),
        std::ffi::OsString::from("string:"),
    ]
}

#[cfg(all(unix, not(target_os = "macos")))]
fn try_show_item_via_linux_file_manager(path: &Path) -> Result<bool, std::io::Error> {
    for (program, args) in linux_file_manager_select_commands(path) {
        let mut command = Command::new(program);
        command.args(args);
        match spawn_detached_command(&mut command) {
            Ok(()) => return Ok(true),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(err),
        }
    }

    Ok(false)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn linux_file_manager_select_commands(path: &Path) -> Vec<(&'static str, Vec<std::ffi::OsString>)> {
    let select_arg = path.as_os_str().to_os_string();
    vec![
        (
            "nautilus",
            vec![std::ffi::OsString::from("--select"), select_arg.clone()],
        ),
        (
            "dolphin",
            vec![std::ffi::OsString::from("--select"), select_arg.clone()],
        ),
        (
            "caja",
            vec![std::ffi::OsString::from("--select"), select_arg.clone()],
        ),
        (
            "thunar",
            vec![std::ffi::OsString::from("--select"), select_arg],
        ),
    ]
}

pub async fn open_in_explorer(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<OpenInExplorerRequest>,
) -> Result<Json<OpenInExplorerResponse>, ApiError> {
    let target_path = match resolve_open_target_path_for_open(&deployment.db().pool, &payload).await
    {
        Ok(path) => path,
        Err(err) => return Ok(open_in_explorer_response(false, Some(err))),
    };
    let target_path = absolute_open_target_path(target_path);

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
            session_id: None,
        };

        let resolved = resolve_open_target_path(&request).expect("resolve absolute path");
        assert_eq!(resolved, absolute_path);
    }

    #[test]
    fn resolve_open_target_path_joins_workspace_and_relative_path() {
        let request = OpenInExplorerRequest {
            path: "src/main.ts".to_string(),
            workspace_path: Some("/workspace/root".to_string()),
            session_id: None,
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
            session_id: None,
        };

        let error = resolve_open_target_path(&request).expect_err("reject parent escape");
        assert_eq!(error, "Path must stay within workspace");
    }

    #[test]
    fn resolve_relative_target_in_workspaces_uses_existing_workspace_file() {
        let first_workspace = tempfile::tempdir().expect("create first workspace");
        let second_workspace = tempfile::tempdir().expect("create second workspace");
        let nested_dir = second_workspace.path().join("src");
        std::fs::create_dir_all(&nested_dir).expect("create nested dir");
        std::fs::write(nested_dir.join("main.rs"), "").expect("write file");
        let workspaces = vec![
            first_workspace.path().to_string_lossy().to_string(),
            second_workspace.path().to_string_lossy().to_string(),
        ];

        let resolved = resolve_relative_target_in_workspaces(Path::new("src/main.rs"), &workspaces)
            .expect("resolve workspace relative path");

        assert_eq!(resolved, second_workspace.path().join("src/main.rs"));
    }

    #[test]
    fn resolve_relative_target_in_workspaces_falls_back_to_first_workspace() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let workspaces = vec![workspace.path().to_string_lossy().to_string()];

        let resolved = resolve_relative_target_in_workspaces(Path::new("missing.txt"), &workspaces)
            .expect("resolve missing workspace relative path");

        assert_eq!(resolved, workspace.path().join("missing.txt"));
    }

    #[test]
    fn absolute_open_target_path_makes_relative_paths_absolute() {
        let relative = PathBuf::from("src/main.rs");
        let resolved = absolute_open_target_path(relative.clone());

        assert!(resolved.is_absolute());
        assert!(resolved.ends_with(relative));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_explorer_args_passes_select_switch_and_path_separately() {
        let path = PathBuf::from(r"C:\workspace\project with spaces\src\main.rs");
        let args = windows_explorer_args(&path, false);

        assert_eq!(
            args,
            vec![std::ffi::OsString::from("/select,"), path.into()]
        );
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn freedesktop_file_manager_args_use_show_items() {
        let args = freedesktop_file_manager_show_items_args("file:///tmp/project/src/main.rs");

        assert_eq!(
            args,
            vec![
                std::ffi::OsString::from("--session"),
                std::ffi::OsString::from("--dest=org.freedesktop.FileManager1"),
                std::ffi::OsString::from("--type=method_call"),
                std::ffi::OsString::from("/org/freedesktop/FileManager1"),
                std::ffi::OsString::from("org.freedesktop.FileManager1.ShowItems"),
                std::ffi::OsString::from("array:string:file:///tmp/project/src/main.rs"),
                std::ffi::OsString::from("string:"),
            ]
        );
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn linux_file_manager_select_commands_cover_common_file_managers() {
        let path = PathBuf::from("/tmp/project/src/main.rs");
        let commands = linux_file_manager_select_commands(&path);

        assert_eq!(
            commands
                .iter()
                .map(|(program, _)| *program)
                .collect::<Vec<_>>(),
            vec!["nautilus", "dolphin", "caja", "thunar"]
        );
        assert!(commands.iter().all(|(_, args)| args.len() == 2));
        assert!(
            commands
                .iter()
                .all(|(_, args)| args[1].as_os_str() == path.as_os_str())
        );
    }
}
