use std::{path::PathBuf, sync::Arc, time::Duration};

use serde::Serialize;
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

/// Describes how the openteams-cli binary was discovered at runtime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CliDiscoverySource {
    /// Explicit override via `OPENTEAMS_CLI_PATH` environment variable.
    EnvVar,
    /// Found alongside the running server binary (desktop sidecar / Tauri externalBin).
    DesktopSidecar,
    /// Found in `cwd/binaries/` during local development.
    Development,
    /// Found in `~/.openteams/bin/` (NPX / curl installer).
    UserInstall,
    /// Found via the system `PATH`.
    SystemPath,
}

impl std::fmt::Display for CliDiscoverySource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EnvVar => write!(f, "env_var"),
            Self::DesktopSidecar => write!(f, "desktop_sidecar"),
            Self::Development => write!(f, "development"),
            Self::UserInstall => write!(f, "user_install"),
            Self::SystemPath => write!(f, "system_path"),
        }
    }
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
    discovery_source: Option<CliDiscoverySource>,
}

impl CliManager {
    const BINARY_NAME: &'static str = "openteams-cli";
    const READY_TIMEOUT_SECS: u64 = 180;

    pub fn new() -> Self {
        let config = CliManagerConfig::from_env();
        let (binary_path, discovery_source) = Self::discover_binary();

        if let Some(ref source) = discovery_source {
            tracing::info!(
                source = %source,
                path = ?binary_path,
                "openteams-cli discovered"
            );
        } else {
            tracing::warn!("openteams-cli not found in any known location");
        }

        Self {
            inner: Arc::new(RwLock::new(None)),
            config,
            binary_path,
            discovery_source,
        }
    }

    pub fn binary_path(&self) -> Option<&PathBuf> {
        self.binary_path.as_ref()
    }

    pub fn is_available(&self) -> bool {
        self.binary_path.is_some()
    }

    /// Returns how the CLI binary was discovered (e.g. sidecar, user install, PATH).
    pub fn discovery_source(&self) -> Option<&CliDiscoverySource> {
        self.discovery_source.as_ref()
    }

    fn binary_name() -> &'static str {
        if cfg!(windows) {
            "openteams-cli.exe"
        } else {
            "openteams-cli"
        }
    }

    fn discover_binary() -> (Option<PathBuf>, Option<CliDiscoverySource>) {
        let binary_name = Self::binary_name();

        // 1. Explicit env var override
        if let Ok(path) = std::env::var("OPENTEAMS_CLI_PATH") {
            let p = PathBuf::from(&path);
            if p.exists() {
                tracing::debug!("Found openteams-cli via OPENTEAMS_CLI_PATH: {}", path);
                return (Some(p), Some(CliDiscoverySource::EnvVar));
            }
        }

        // 2. Desktop sidecar: alongside the running server binary (Tauri externalBin)
        if let Some(result) = Self::discover_desktop_sidecar(binary_name) {
            return result;
        }

        // 3. Development: cwd/binaries/
        if let Ok(cwd) = std::env::current_dir() {
            tracing::debug!(cwd = ?cwd, "current work dir");
            let dev_binary = cwd.join("binaries").join(binary_name);
            if dev_binary.exists() {
                tracing::debug!(
                    "Found openteams-cli in development binaries/: {}",
                    dev_binary.display()
                );
                return (Some(dev_binary), Some(CliDiscoverySource::Development));
            }
        }

        // 4. User install: ~/.openteams/bin/
        if let Some(home) = dirs::home_dir() {
            let user_install = home.join(".openteams").join("bin").join(binary_name);
            if user_install.exists() {
                tracing::debug!(
                    "Found openteams-cli in user install dir: {}",
                    user_install.display()
                );
                return (Some(user_install), Some(CliDiscoverySource::UserInstall));
            }
        }

        // 5. System PATH
        if let Ok(path) = which::which(Self::BINARY_NAME) {
            tracing::debug!("Found openteams-cli in PATH: {}", path.display());
            return (Some(path), Some(CliDiscoverySource::SystemPath));
        }

        (None, None)
    }

    /// Desktop sidecar discovery: check alongside the current executable and,
    /// on macOS, also check the `.app` bundle Resources/MacOS directories.
    fn discover_desktop_sidecar(
        binary_name: &str,
    ) -> Option<(Option<PathBuf>, Option<CliDiscoverySource>)> {
        let exe_path = std::env::current_exe().ok()?;
        let exe_dir = exe_path.parent()?;

        // Direct sibling (covers Windows/Linux desktop and all non-bundle layouts)
        let bundled = exe_dir.join(binary_name);
        if bundled.exists() {
            tracing::debug!(
                "Found openteams-cli alongside server binary (desktop sidecar): {}",
                bundled.display()
            );
            return Some((Some(bundled), Some(CliDiscoverySource::DesktopSidecar)));
        }

        // macOS .app bundle: the exe may be at MyApp.app/Contents/MacOS/server
        // and the CLI at MyApp.app/Contents/MacOS/openteams-cli
        // Tauri places externalBin in the same MacOS dir, but let's also check
        // the Resources dir as a fallback.
        #[cfg(target_os = "macos")]
        {
            if let Some(macos_dir) = exe_dir
                .to_str()
                .filter(|s| s.contains(".app/Contents/"))
                .and_then(|_| Some(exe_dir))
            {
                // Already checked exe_dir above; also try Resources sibling
                let resources_dir = macos_dir
                    .parent()
                    .map(|contents| contents.join("Resources"));
                if let Some(res_dir) = resources_dir {
                    let res_cli = res_dir.join(binary_name);
                    if res_cli.exists() {
                        tracing::debug!(
                            "Found openteams-cli in macOS app bundle Resources: {}",
                            res_cli.display()
                        );
                        return Some((Some(res_cli), Some(CliDiscoverySource::DesktopSidecar)));
                    }
                }
            }
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
            .field("discovery_source", &self.discovery_source)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Mutex};

    use tempfile::TempDir;

    use super::*;

    /// Mutex to serialize tests that modify environment variables.
    static ENV_MUTEX: Mutex<()> = Mutex::new(());

    /// Helper: create a fake binary file at a given path.
    fn create_fake_binary(path: &std::path::Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, b"fake").unwrap();
    }

    #[test]
    fn discovery_source_display() {
        assert_eq!(CliDiscoverySource::EnvVar.to_string(), "env_var");
        assert_eq!(
            CliDiscoverySource::DesktopSidecar.to_string(),
            "desktop_sidecar"
        );
        assert_eq!(CliDiscoverySource::Development.to_string(), "development");
        assert_eq!(CliDiscoverySource::UserInstall.to_string(), "user_install");
        assert_eq!(CliDiscoverySource::SystemPath.to_string(), "system_path");
    }

    #[test]
    fn discover_via_env_var() {
        let _lock = ENV_MUTEX.lock().unwrap();
        let td = TempDir::new().unwrap();
        let cli_path = td.path().join(CliManager::binary_name());
        create_fake_binary(&cli_path);

        // Temporarily set env var
        let _guard = EnvVarGuard::set("OPENTEAMS_CLI_PATH", cli_path.to_str().unwrap());
        let (path, source) = CliManager::discover_binary();

        assert_eq!(path.unwrap(), cli_path);
        assert_eq!(source.unwrap(), CliDiscoverySource::EnvVar);
    }

    #[test]
    fn discover_via_user_install() {
        let _lock = ENV_MUTEX.lock().unwrap();
        // We can't easily mock home_dir, but we can verify the user_install path pattern
        // by confirming the discovery falls through env_var and sidecar when nothing exists.
        let _guard = EnvVarGuard::remove("OPENTEAMS_CLI_PATH");
        let (path, _source) = CliManager::discover_binary();
        // Without a real CLI binary, result depends on environment.
        // Just verify no panic occurs.
        let _ = (path, _source);
    }

    #[test]
    fn discover_via_development_binaries() {
        let _lock = ENV_MUTEX.lock().unwrap();
        let td = TempDir::new().unwrap();
        let binaries_dir = td.path().join("binaries");
        let cli_path = binaries_dir.join(CliManager::binary_name());
        create_fake_binary(&cli_path);

        let _env_guard = EnvVarGuard::remove("OPENTEAMS_CLI_PATH");

        // Change cwd temporarily
        let original_cwd = std::env::current_dir().unwrap();
        std::env::set_current_dir(td.path()).unwrap();

        let (path, source) = CliManager::discover_binary();

        // Restore cwd
        std::env::set_current_dir(original_cwd).unwrap();

        assert_eq!(path.unwrap(), cli_path);
        assert_eq!(source.unwrap(), CliDiscoverySource::Development);
    }

    #[test]
    fn discovery_source_serializes_to_snake_case() {
        let json = serde_json::to_string(&CliDiscoverySource::DesktopSidecar).unwrap();
        assert_eq!(json, r#""desktop_sidecar""#);

        let json = serde_json::to_string(&CliDiscoverySource::UserInstall).unwrap();
        assert_eq!(json, r#""user_install""#);
    }

    /// RAII guard for environment variables in tests.
    struct EnvVarGuard {
        key: String,
        old_value: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &str, value: &str) -> Self {
            let old_value = std::env::var(key).ok();
            // SAFETY: tests in this module run serially and restore the original value on drop.
            unsafe { std::env::set_var(key, value) };
            Self {
                key: key.to_string(),
                old_value,
            }
        }

        fn remove(key: &str) -> Self {
            let old_value = std::env::var(key).ok();
            // SAFETY: tests in this module run serially and restore the original value on drop.
            unsafe { std::env::remove_var(key) };
            Self {
                key: key.to_string(),
                old_value,
            }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.old_value {
                // SAFETY: restoring the original env var value set before the test.
                Some(val) => unsafe { std::env::set_var(&self.key, val) },
                None => unsafe { std::env::remove_var(&self.key) },
            }
        }
    }
}
