use std::{path::PathBuf, sync::Arc, time::Duration};

use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::RwLock,
    time::timeout,
};

#[derive(Debug, Error)]
pub enum CliManagerError {
    #[error("CLI binary not found")]
    BinaryNotFound,
    #[error("Failed to start CLI: {0}")]
    StartFailed(String),
    #[error("CLI failed to become ready: {0}")]
    ReadyTimeout(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("CLI process error: {0}")]
    Process(String),
}

#[derive(Debug, Clone)]
pub struct CliManagerConfig {
    pub auto_start: bool,
    pub port: u16,
    pub log_level: String,
}

impl Default for CliManagerConfig {
    fn default() -> Self {
        Self {
            auto_start: true,
            port: 0,
            log_level: "INFO".to_string(),
        }
    }
}

impl CliManagerConfig {
    pub fn from_env() -> Self {
        Self {
            auto_start: std::env::var("OPENTEAMS_CLI_AUTO_START")
                .map(|v| v != "false")
                .unwrap_or(true),
            port: std::env::var("OPENTEAMS_CLI_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            log_level: std::env::var("OPENTEAMS_CLI_LOG_LEVEL")
                .map(|v| v.to_uppercase())
                .unwrap_or_else(|_| "INFO".to_string()),
        }
    }
}

struct CliProcess {
    child: Child,
    base_url: String,
    port: u16,
}

#[derive(Clone, Default)]
pub struct CliManager {
    inner: Arc<RwLock<Option<CliProcess>>>,
    config: CliManagerConfig,
    binary_path: Option<PathBuf>,
}

impl CliManager {
    const BINARY_NAME: &'static str = "openteams-cli";
    const READY_TIMEOUT_SECS: u64 = 180;

    pub fn new() -> Self {
        let config = CliManagerConfig::from_env();
        let binary_path = Self::discover_binary();

        Self {
            inner: Arc::new(RwLock::new(None)),
            config,
            binary_path,
        }
    }

    pub fn binary_path(&self) -> Option<&PathBuf> {
        self.binary_path.as_ref()
    }

    pub fn is_available(&self) -> bool {
        self.binary_path.is_some()
    }

    fn discover_binary() -> Option<PathBuf> {
        let binary_name = if cfg!(windows) {
            "openteams-cli.exe"
        } else {
            "openteams-cli"
        };

        if let Ok(path) = std::env::var("OPENTEAMS_CLI_PATH") {
            let p = PathBuf::from(&path);
            if p.exists() {
                tracing::debug!("Found openteams-cli via OPENTEAMS_CLI_PATH: {}", path);
                return Some(p);
            }
        }

        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let bundled = exe_dir.join(binary_name);
                if bundled.exists() {
                    tracing::debug!(
                        "Found openteams-cli alongside server binary: {}",
                        bundled.display()
                    );
                    return Some(bundled);
                }
            }
        }

        if let Ok(cwd) = std::env::current_dir() {
            tracing::debug!(
                cwd = ?cwd,
                "current work dir"
            );
            let dev_binary = cwd.join("binaries").join(binary_name);
            if dev_binary.exists() {
                tracing::debug!(
                    "Found openteams-cli in development binaries/: {}",
                    dev_binary.display()
                );
                return Some(dev_binary);
            }
        }

        if let Some(home) = dirs::home_dir() {
            let bundled = home.join(".openteams").join("bin").join(binary_name);
            if bundled.exists() {
                tracing::debug!("Found bundled openteams-cli: {}", bundled.display());
                return Some(bundled);
            }
        }

        if let Ok(path) = which::which(Self::BINARY_NAME) {
            tracing::debug!("Found openteams-cli in PATH: {}", path.display());
            return Some(path);
        }

        None
    }

    pub async fn start(&self) -> Result<(String, u16), CliManagerError> {
        let binary_path = self
            .binary_path
            .as_ref()
            .ok_or(CliManagerError::BinaryNotFound)?;

        let mut inner = self.inner.write().await;

        if let Some(ref p) = *inner {
            return Ok((p.base_url.clone(), p.port));
        }

        let port_arg = if self.config.port == 0 {
            "0".to_string()
        } else {
            self.config.port.to_string()
        };

        let mut cmd = Command::new(binary_path);
        cmd.args([
            "serve",
            "--hostname",
            "127.0.0.1",
            "--port",
            &port_arg,
            "--log-level",
            &self.config.log_level,
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

        let mut child = cmd.spawn().map_err(|e| {
            CliManagerError::StartFailed(format!("Failed to spawn CLI process: {}", e))
        })?;

        let stdout = child.stdout.take().ok_or_else(|| {
            CliManagerError::StartFailed("CLI process missing stdout".to_string())
        })?;

        let (base_url, port) = Self::wait_for_ready(stdout).await?;

        let cli_process = CliProcess {
            child,
            base_url: base_url.clone(),
            port,
        };

        *inner = Some(cli_process);

        tracing::info!("OpenTeams CLI started on {} (port {})", base_url, port);

        Ok((base_url, port))
    }

    async fn wait_for_ready(
        stdout: tokio::process::ChildStdout,
    ) -> Result<(String, u16), CliManagerError> {
        let mut lines = BufReader::new(stdout).lines();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(Self::READY_TIMEOUT_SECS);
        let mut captured: Vec<String> = Vec::new();

        loop {
            if tokio::time::Instant::now() > deadline {
                return Err(CliManagerError::ReadyTimeout(format!(
                    "Timed out waiting for CLI server. Output:\n{}",
                    captured.join("\n")
                )));
            }

            let line = match timeout(Duration::from_secs(5), lines.next_line()).await {
                Ok(Ok(Some(line))) => line,
                Ok(Ok(None)) => {
                    return Err(CliManagerError::ReadyTimeout(format!(
                        "CLI server exited before printing listening URL. Output:\n{}",
                        captured.join("\n")
                    )));
                }
                Ok(Err(e)) => return Err(CliManagerError::Io(e)),
                Err(_) => continue,
            };

            if captured.len() < 64 {
                captured.push(line.clone());
            }

            if let Some(url) = line
                .trim()
                .strip_prefix("openteams-cli server listening on ")
                .or_else(|| line.trim().strip_prefix("opencode server listening on "))
            {
                let url = url.trim().to_string();
                let port = Self::extract_port(&url)?;
                return Ok((url, port));
            }
        }
    }

    fn extract_port(url: &str) -> Result<u16, CliManagerError> {
        url::Url::parse(url)
            .ok()
            .and_then(|u| u.port())
            .ok_or_else(|| {
                CliManagerError::ReadyTimeout(format!("Could not extract port from URL: {}", url))
            })
    }

    pub async fn stop(&self) -> Result<(), CliManagerError> {
        let mut inner = self.inner.write().await;

        if let Some(mut cli_process) = inner.take() {
            tracing::info!("Stopping OpenTeams CLI...");

            if let Err(e) = cli_process.child.kill().await {
                tracing::warn!("Failed to kill CLI process: {}", e);
            }
        }

        Ok(())
    }

    pub async fn restart(&self) -> Result<(String, u16), CliManagerError> {
        tracing::info!("Restarting OpenTeams CLI...");
        self.stop().await?;
        // Brief pause to ensure the port is released
        tokio::time::sleep(Duration::from_millis(500)).await;
        self.start().await
    }

    pub async fn health_check(&self) -> bool {
        let inner = self.inner.read().await;

        if let Some(ref p) = *inner {
            let url = format!("{}/global/health", p.base_url);

            match reqwest::Client::new()
                .get(&url)
                .timeout(Duration::from_secs(5))
                .send()
                .await
            {
                Ok(resp) => resp.status().is_success(),
                Err(_) => false,
            }
        } else {
            false
        }
    }

    pub fn endpoint(&self) -> Option<String> {
        let inner = self.inner.try_read().ok()?;
        inner.as_ref().map(|p| p.base_url.clone())
    }
}

impl std::fmt::Debug for CliManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CliManager")
            .field("config", &self.config)
            .field("binary_path", &self.binary_path)
            .finish()
    }
}
