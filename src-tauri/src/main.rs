#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use portpicker::pick_unused_port;
use tauri::{api::process::{Command, CommandChild}, Manager};

struct BackendState {
    child: Mutex<Option<CommandChild>>,
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
