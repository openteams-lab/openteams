#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    path::{Path, PathBuf},
    process::Command as StdCommand,
    sync::Mutex,
};

use directories::ProjectDirs;
use portpicker::pick_unused_port;
use serde::{Deserialize, Serialize};
use tauri::{
    api::process::{Command as SidecarCommand, CommandChild},
    Manager,
};

mod update;

struct BackendState {
    child: Mutex<Option<CommandChild>>,
}

#[derive(Debug, Deserialize)]
struct SelectDirectoryDialogRequest {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    initial_directory: Option<String>,
}

#[derive(Debug, Serialize)]
struct SelectDirectoryDialogResponse {
    path: Option<String>,
    cancelled: bool,
}

fn clean_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[tauri::command]
async fn select_directory_dialog(
    window: tauri::Window,
    payload: SelectDirectoryDialogRequest,
) -> Result<SelectDirectoryDialogResponse, String> {
    let title = clean_optional_string(payload.title);
    let initial_directory =
        clean_optional_string(payload.initial_directory).filter(|path| Path::new(path).is_dir());

    let mut builder = tauri::api::dialog::blocking::FileDialogBuilder::new().set_parent(&window);
    if let Some(title) = title.as_deref() {
        builder = builder.set_title(title);
    }
    if let Some(initial_directory) = initial_directory.as_deref() {
        builder = builder.set_directory(initial_directory);
    }

    let path = builder
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string());
    Ok(SelectDirectoryDialogResponse {
        cancelled: path.is_none(),
        path,
    })
}

/// Delete all user data (database, config, cache, workspaces)
#[tauri::command]
fn delete_all_user_data() -> Result<String, String> {
    let proj = ProjectDirs::from("ai", "openteams-lab", "openteams")
        .ok_or("Could not determine data directories")?;

    let mut deleted_paths = Vec::new();
    let mut errors = Vec::new();

    // Delete data directory (contains db.sqlite, config.json, profiles.json, credentials.json)
    let data_dir = proj.data_dir();
    if data_dir.exists() {
        match std::fs::remove_dir_all(data_dir) {
            Ok(_) => deleted_paths.push(data_dir.display().to_string()),
            Err(e) => errors.push(format!("Failed to delete {}: {}", data_dir.display(), e)),
        }
    }

    // Delete cache directory
    let cache_dir = proj.cache_dir();
    if cache_dir.exists() {
        match std::fs::remove_dir_all(cache_dir) {
            Ok(_) => deleted_paths.push(cache_dir.display().to_string()),
            Err(e) => errors.push(format!("Failed to delete {}: {}", cache_dir.display(), e)),
        }
    }

    // Delete temp workspaces
    let temp_dir = if cfg!(target_os = "macos") || cfg!(target_os = "linux") {
        std::path::PathBuf::from("/var/tmp/openteams")
    } else {
        std::env::temp_dir().join("openteams")
    };
    if temp_dir.exists() {
        match std::fs::remove_dir_all(&temp_dir) {
            Ok(_) => deleted_paths.push(temp_dir.display().to_string()),
            Err(e) => errors.push(format!("Failed to delete {}: {}", temp_dir.display(), e)),
        }
    }

    if errors.is_empty() {
        Ok(format!("Deleted: {:?}", deleted_paths))
    } else {
        Err(errors.join("; "))
    }
}

/// Delete only cache and temp data (keep core data like db.sqlite, config.json)
#[tauri::command]
fn delete_cache_data() -> Result<String, String> {
    let proj = ProjectDirs::from("ai", "openteams-lab", "openteams")
        .ok_or("Could not determine data directories")?;

    let mut deleted_paths = Vec::new();
    let mut errors = Vec::new();

    // Delete cache directory only
    let cache_dir = proj.cache_dir();
    if cache_dir.exists() {
        match std::fs::remove_dir_all(cache_dir) {
            Ok(_) => deleted_paths.push(cache_dir.display().to_string()),
            Err(e) => errors.push(format!("Failed to delete {}: {}", cache_dir.display(), e)),
        }
    }

    // Delete temp workspaces
    let temp_dir = if cfg!(target_os = "macos") || cfg!(target_os = "linux") {
        std::path::PathBuf::from("/var/tmp/openteams")
    } else {
        std::env::temp_dir().join("openteams")
    };
    if temp_dir.exists() {
        match std::fs::remove_dir_all(&temp_dir) {
            Ok(_) => deleted_paths.push(temp_dir.display().to_string()),
            Err(e) => errors.push(format!("Failed to delete {}: {}", temp_dir.display(), e)),
        }
    }

    if errors.is_empty() {
        Ok(format!("Deleted: {:?}", deleted_paths))
    } else {
        Err(errors.join("; "))
    }
}

#[tauri::command]
fn reveal_path_in_file_manager(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is required".to_string());
    }

    let target_path = PathBuf::from(trimmed);
    let metadata = std::fs::metadata(&target_path)
        .map_err(|err| format!("Failed to read path metadata: {err}"))?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err("Path is not a file or directory".to_string());
    }

    reveal_path_in_file_manager_impl(&target_path, metadata.is_dir())
        .map_err(|err| err.to_string())
}

fn spawn_detached_command(command: &mut StdCommand) -> Result<(), std::io::Error> {
    command.current_dir(safe_detached_command_cwd());
    let _child = command.spawn()?;
    Ok(())
}

fn safe_detached_command_cwd() -> PathBuf {
    std::env::temp_dir()
}

#[cfg(target_os = "macos")]
fn reveal_path_in_file_manager_impl(path: &Path, is_directory: bool) -> Result<(), std::io::Error> {
    let mut command = StdCommand::new("open");
    if is_directory {
        command.args(["-a", "Finder"]).arg(path);
    } else {
        command.arg("-R").arg(path);
    }
    spawn_detached_command(&mut command)
}

#[cfg(target_os = "windows")]
fn reveal_path_in_file_manager_impl(path: &Path, is_directory: bool) -> Result<(), std::io::Error> {
    if !is_directory {
        match windows_select_file_in_explorer(path) {
            Ok(()) => return Ok(()),
            Err(err) => {
                eprintln!(
                    "Failed to select file through Windows Shell API, falling back to explorer.exe: {} ({})",
                    path.display(),
                    err
                );
            }
        }
    }

    let mut command = StdCommand::new("explorer");
    if is_directory {
        command.arg(windows_normalized_shell_path(path));
    } else {
        command
            .arg("/select,")
            .arg(windows_normalized_shell_path(path));
    }
    spawn_detached_command(&mut command)
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
    let wide_path: Vec<u16> = shell_path
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

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
fn reveal_path_in_file_manager_impl(path: &Path, is_directory: bool) -> Result<(), std::io::Error> {
    let mut command = StdCommand::new("xdg-open");
    if is_directory {
        command.arg(path);
    } else {
        command.arg(path.parent().unwrap_or(path));
    }
    spawn_detached_command(&mut command)
}

fn spawn_backend(port: u16) -> Result<CommandChild, Box<dyn std::error::Error>> {
    let mut cmd = SidecarCommand::new_sidecar("server")?;
    let mut envs = std::collections::HashMap::new();
    envs.insert("BACKEND_PORT".to_string(), port.to_string());
    envs.insert("HOST".to_string(), "127.0.0.1".to_string());
    envs.insert("RUST_LOG".to_string(), "info".to_string());
    envs.insert("AGENT_CHATGROUP_DESKTOP".to_string(), "1".to_string());
    cmd = cmd.envs(envs);

    let (_rx, child) = cmd.spawn()?;

    Ok(child)
}

fn apply_default_webview_zoom(window: &tauri::Window) {
    #[cfg(windows)]
    {
        // Match an end-user browser zoom setting of 80% at the WebView level so
        // fixed overlays, dialogs, and portal content all scale together.
        let _ = window.with_webview(|webview| unsafe {
            let _ = webview.controller().SetZoomFactor(0.88);
        });
    }
}

/// Wait until the backend TCP port accepts connections (server has bound + is
/// ready to serve), then navigate the webview. Avoids first-launch white screen
/// and the race condition that turns transient connection refusals into a
/// permanent "load failed" state in React Query.
fn wait_for_backend_then_navigate(window: tauri::Window, port: u16) {
    std::thread::spawn(move || {
        let target = format!("http://localhost:{}", port);
        let addr = format!("127.0.0.1:{}", port);
        // Probe up to 60s (200 * 300ms). Server boot includes 87 SQLite migrations
        // and a 1-2MB config write on first launch, which can take a few seconds.
        for _ in 0..200 {
            if std::net::TcpStream::connect_timeout(
                &addr.parse().expect("valid loopback addr"),
                std::time::Duration::from_millis(500),
            )
            .is_ok()
            {
                let _ = window.eval(&format!(
                    "window.location.replace('{}')",
                    target.replace('\'', "\\'")
                ));
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        // Last-resort navigation so the user sees the (broken) target instead of
        // a perpetual blank screen.
        let _ = window.eval(&format!(
            "window.location.replace('{}')",
            target.replace('\'', "\\'")
        ));
    });
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            delete_all_user_data,
            delete_cache_data,
            reveal_path_in_file_manager,
            select_directory_dialog,
            update::get_desktop_update_context,
            update::install_desktop_update
        ])
        .setup(|app| {
            let port = pick_unused_port().unwrap_or(3999);
            let child = spawn_backend(port)?;

            app.manage(BackendState {
                child: Mutex::new(Some(child)),
            });

            if let Some(window) = app.get_window("main") {
                apply_default_webview_zoom(&window);
                wait_for_backend_then_navigate(window, port);
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { .. } => {
                if let Some(state) = app.try_state::<BackendState>() {
                    if let Ok(mut guard) = state.child.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
            _ => {}
        });
}
