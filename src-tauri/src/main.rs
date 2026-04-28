#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use directories::ProjectDirs;
use portpicker::pick_unused_port;
use tauri::{api::process::{Command, CommandChild}, Manager};

struct BackendState {
    child: Mutex<Option<CommandChild>>,
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

fn spawn_backend(port: u16) -> Result<CommandChild, Box<dyn std::error::Error>> {
    let mut cmd = Command::new_sidecar("server")?;
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
        .invoke_handler(tauri::generate_handler![delete_all_user_data, delete_cache_data])
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
