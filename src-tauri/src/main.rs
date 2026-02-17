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
    let proj = ProjectDirs::from("ai", "starterra.ai", "agents-chatgroup")
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
        std::path::PathBuf::from("/var/tmp/agents-chatgroup")
    } else {
        std::env::temp_dir().join("agents-chatgroup")
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
    let proj = ProjectDirs::from("ai", "starterra.ai", "agents-chatgroup")
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
        std::path::PathBuf::from("/var/tmp/agents-chatgroup")
    } else {
        std::env::temp_dir().join("agents-chatgroup")
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
                let url = format!("http://127.0.0.1:{}", port);
                window.eval(&format!(
                    "window.location.replace('{}')",
                    url.replace('\'', "\\'")
                ))?;
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
