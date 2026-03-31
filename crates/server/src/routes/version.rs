use std::{env, ffi::OsString, path::Path, process::Stdio, time::Duration};

use axum::{
    Json, Router,
    http::StatusCode,
    response::Json as ResponseJson,
    routing::{get, post},
};
use semver::Version;
use serde::{Deserialize, Serialize};
use tokio::{process::Command, time::sleep};
use ts_rs::TS;
use utils::{port_file::read_port_file, response::ApiResponse, version::APP_VERSION};

use crate::DeploymentImpl;

const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/openteams-lab/openteams/releases/latest";
const PROCESS_EXIT_DELAY: Duration = Duration::from_millis(500);
const SKIP_BROWSER_ENV: &str = "OPENTEAMS_SKIP_BROWSER";
const MOCK_GITHUB_LATEST_RELEASE_ENV: &str = "OPENTEAMS_MOCK_GITHUB_LATEST_RELEASE";
const MOCK_DEPLOY_MODE_ENV: &str = "OPENTEAMS_MOCK_DEPLOY_MODE";
const MOCK_RELEASE_TAG_ENV: &str = "OPENTEAMS_MOCK_GITHUB_RELEASE_TAG";
const MOCK_RELEASE_URL_ENV: &str = "OPENTEAMS_MOCK_GITHUB_RELEASE_URL";
const MOCK_RELEASE_NOTES_ENV: &str = "OPENTEAMS_MOCK_GITHUB_RELEASE_NOTES";
const MOCK_RELEASE_PUBLISHED_AT_ENV: &str = "OPENTEAMS_MOCK_GITHUB_RELEASE_PUBLISHED_AT";

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/version/check", get(check_version))
        .route("/version/update-npx", post(update_npx))
        .route("/version/restart", post(restart_service))
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct VersionCheckResponse {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub deploy_mode: String,
    pub release_url: String,
    pub release_notes: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct UpdateNpxResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
struct GitHubLatestRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    published_at: Option<String>,
}

pub async fn check_version()
-> Result<ResponseJson<ApiResponse<VersionCheckResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    fetch_latest_version()
        .await
        .map(|response| ResponseJson(ApiResponse::success(response)))
        .map_err(|error_message| internal_api_error(&error_message))
}

pub async fn update_npx()
-> Result<ResponseJson<ApiResponse<UpdateNpxResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    let output = run_npm_exec([
        "exec",
        "--yes",
        "@openteams-lab/openteams-web@latest",
        "--",
        "update",
    ])
    .await?;

    let message = if output.is_empty() {
        "npx update command completed successfully".to_string()
    } else {
        format!("npx update command completed successfully: {}", output)
    };

    Ok(ResponseJson(ApiResponse::success(UpdateNpxResponse {
        success: true,
        message,
    })))
}

pub async fn restart_service()
-> Result<ResponseJson<ApiResponse<UpdateNpxResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    let executable = env::current_exe().map_err(|error| {
        internal_api_error(&format!("Failed to resolve current executable: {error}"))
    })?;
    let args: Vec<OsString> = env::args_os().skip(1).collect();

    let mut command = Command::new(executable);
    command.args(args);
    command.stdin(Stdio::null());
    command.stdout(Stdio::null());
    command.stderr(Stdio::null());
    command.envs(env::vars_os());
    command.env(SKIP_BROWSER_ENV, "1");

    if env::var_os("BACKEND_PORT").is_none() && env::var_os("PORT").is_none() {
        if let Some(port) = current_backend_port().await {
            command.env("BACKEND_PORT", port.to_string());
        }
    }

    spawn_detached(&mut command)
        .await
        .map_err(|error| internal_api_error(&format!("Failed to restart service: {error}")))?;

    tokio::spawn(async move {
        sleep(PROCESS_EXIT_DELAY).await;
        std::process::exit(0);
    });

    Ok(ResponseJson(ApiResponse::success(UpdateNpxResponse {
        success: true,
        message: "Service restart scheduled successfully".to_string(),
    })))
}

async fn fetch_latest_version() -> Result<VersionCheckResponse, String> {
    let release = if let Some(mock_release) = mock_latest_release_from_env()? {
        mock_release
    } else {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|error| format!("Failed to build HTTP client: {error}"))?
            .get(GITHUB_LATEST_RELEASE_URL)
            .header(
                reqwest::header::USER_AGENT,
                format!("OpenTeams/{}", APP_VERSION),
            )
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .send()
            .await
            .map_err(|error| format!("Failed to request latest release from GitHub: {error}"))?
            .error_for_status()
            .map_err(|error| format!("GitHub latest release API returned an error: {error}"))?
            .json::<GitHubLatestRelease>()
            .await
            .map_err(|error| format!("Failed to parse GitHub release payload: {error}"))?
    };

    let current_version = normalize_version(APP_VERSION)?;
    let latest_version = normalize_version(&release.tag_name)?;

    Ok(VersionCheckResponse {
        current_version: current_version.to_string(),
        latest_version: latest_version.to_string(),
        has_update: latest_version > current_version,
        deploy_mode: effective_deploy_mode()?.to_string(),
        release_url: release.html_url,
        release_notes: release.body.filter(|body| !body.trim().is_empty()),
        published_at: release.published_at,
    })
}

fn normalize_version(raw: &str) -> Result<Version, String> {
    Version::parse(raw.trim().trim_start_matches('v'))
        .map_err(|error| format!("Invalid semver version '{raw}': {error}"))
}

fn effective_deploy_mode() -> Result<&'static str, String> {
    if let Some(mocked) = mock_deploy_mode_from_env()? {
        return Ok(mocked);
    }

    Ok(detect_deploy_mode())
}

fn mock_deploy_mode_from_env() -> Result<Option<&'static str>, String> {
    let Some(value) = env::var_os(MOCK_DEPLOY_MODE_ENV) else {
        return Ok(None);
    };

    let normalized = value.to_string_lossy().trim().to_ascii_lowercase();
    match normalized.as_str() {
        "" => Ok(None),
        "npx" => Ok(Some("npx")),
        "tauri" => Ok(Some("tauri")),
        "unknown" => Ok(Some("unknown")),
        _ => Err(format!(
            "Invalid {} value '{}'; expected one of: npx, tauri, unknown",
            MOCK_DEPLOY_MODE_ENV, normalized
        )),
    }
}

fn mock_latest_release_from_env() -> Result<Option<GitHubLatestRelease>, String> {
    let Some(value) = env::var_os(MOCK_GITHUB_LATEST_RELEASE_ENV) else {
        return Ok(None);
    };

    if !is_truthy_env_value(&value.to_string_lossy()) {
        return Ok(None);
    }

    let tag_name = match env::var(MOCK_RELEASE_TAG_ENV) {
        Ok(tag_name) if !tag_name.trim().is_empty() => tag_name,
        _ => default_mock_release_tag()?,
    };

    let html_url = match env::var(MOCK_RELEASE_URL_ENV) {
        Ok(url) if !url.trim().is_empty() => url,
        _ => format!(
            "https://github.com/openteams-lab/openteams/releases/tag/{}",
            tag_name
        ),
    };

    let body = match env::var(MOCK_RELEASE_NOTES_ENV) {
        Ok(notes) if notes.trim().is_empty() => None,
        Ok(notes) => Some(notes),
        Err(_) => Some(
            "What's Changed \n
Improve session workspace defaults and polish creation dialogs by @monkeyin92 in #23
improve skill discover and new message notify method by @Caleb196x in #26"
                .to_string(),
        ),
    };

    let published_at = match env::var(MOCK_RELEASE_PUBLISHED_AT_ENV) {
        Ok(value) if value.trim().is_empty() => None,
        Ok(value) => Some(value),
        Err(_) => Some("2026-03-29T15:31:06Z".to_string()),
    };

    Ok(Some(GitHubLatestRelease {
        tag_name,
        html_url,
        body,
        published_at,
    }))
}

fn default_mock_release_tag() -> Result<String, String> {
    let mut version = normalize_version(APP_VERSION)?;
    version.patch += 1;
    Ok(format!("v{}", version))
}

fn is_truthy_env_value(value: &str) -> bool {
    !matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "" | "0" | "false" | "off" | "no"
    )
}

fn detect_deploy_mode() -> &'static str {
    let is_desktop = env::var_os("AGENT_CHATGROUP_DESKTOP").is_some();
    let Ok(current_exe) = env::current_exe() else {
        return "unknown";
    };

    detect_deploy_mode_for_path(is_desktop, &current_exe)
}

fn detect_deploy_mode_for_path(is_desktop: bool, current_exe: &Path) -> &'static str {
    if is_desktop {
        return "tauri";
    }

    let normalized = current_exe
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    if normalized.contains("/.openteams/bin/") {
        "npx"
    } else {
        "unknown"
    }
}

async fn run_npm_exec<const N: usize>(
    args: [&str; N],
) -> Result<String, (StatusCode, Json<ApiResponse<()>>)> {
    let output = Command::new(npm_command())
        .args(args)
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| internal_api_error(&format!("Failed to start npm command: {error}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format_command_output(&stdout, &stderr);

    if output.status.success() {
        Ok(combined)
    } else {
        Err(internal_api_error(&format!(
            "npm update command failed{}",
            if combined.is_empty() {
                String::new()
            } else {
                format!(": {combined}")
            }
        )))
    }
}

fn format_command_output(stdout: &str, stderr: &str) -> String {
    let mut parts = Vec::new();

    let stdout = stdout.trim();
    if !stdout.is_empty() {
        parts.push(stdout);
    }

    let stderr = stderr.trim();
    if !stderr.is_empty() {
        parts.push(stderr);
    }

    let combined = parts.join(" | ");
    truncate_message(&combined)
}

fn truncate_message(message: &str) -> String {
    const MAX_LEN: usize = 500;

    if message.chars().count() <= MAX_LEN {
        return message.to_string();
    }

    let truncated: String = message.chars().take(MAX_LEN).collect();
    format!("{truncated}...")
}

async fn current_backend_port() -> Option<u16> {
    if let Ok(port) = env::var("BACKEND_PORT")
        && let Ok(port) = port.trim().parse::<u16>()
    {
        return Some(port);
    }

    if let Ok(port) = env::var("PORT")
        && let Ok(port) = port.trim().parse::<u16>()
    {
        return Some(port);
    }

    read_port_file("openteams").await.ok()
}

#[cfg(unix)]
async fn spawn_detached(command: &mut Command) -> std::io::Result<()> {
    command.spawn().map(|_| ())
}

#[cfg(windows)]
async fn spawn_detached(command: &mut Command) -> std::io::Result<()> {
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

    command
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map(|_| ())
}

fn npm_command() -> &'static str {
    if cfg!(windows) { "npm.cmd" } else { "npm" }
}

fn internal_api_error(message: &str) -> (StatusCode, Json<ApiResponse<()>>) {
    (StatusCode::BAD_GATEWAY, Json(ApiResponse::error(message)))
}

#[cfg(test)]
mod tests {
    use std::{
        path::Path,
        sync::{Mutex, OnceLock},
    };

    use super::{
        MOCK_DEPLOY_MODE_ENV, default_mock_release_tag, detect_deploy_mode_for_path,
        is_truthy_env_value, mock_deploy_mode_from_env, normalize_version,
    };

    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn env_lock() -> &'static Mutex<()> {
        ENV_LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn normalize_version_supports_v_prefix() {
        let version = normalize_version("v1.2.3").expect("version should parse");
        assert_eq!(version.to_string(), "1.2.3");
    }

    #[test]
    fn normalize_version_rejects_invalid_semver() {
        let error = normalize_version("latest").expect_err("version should fail");
        assert!(error.contains("Invalid semver version"));
    }

    #[test]
    fn default_mock_release_tag_bumps_patch_version() {
        let tag = default_mock_release_tag().expect("mock tag should build");
        let current = normalize_version(super::APP_VERSION).expect("current version should parse");
        let mocked = normalize_version(&tag).expect("mock tag should parse");

        assert_eq!(mocked.major, current.major);
        assert_eq!(mocked.minor, current.minor);
        assert_eq!(mocked.patch, current.patch + 1);
    }

    #[test]
    fn truthy_env_value_treats_zero_and_false_as_disabled() {
        assert!(!is_truthy_env_value("0"));
        assert!(!is_truthy_env_value("false"));
        assert!(is_truthy_env_value("1"));
        assert!(is_truthy_env_value("yes"));
    }

    #[test]
    fn mock_deploy_mode_accepts_supported_values() {
        let _guard = env_lock().lock().expect("env lock should acquire");
        unsafe { std::env::set_var(MOCK_DEPLOY_MODE_ENV, "tauri") };
        let deploy_mode = mock_deploy_mode_from_env().expect("deploy mode should parse");
        assert_eq!(deploy_mode, Some("tauri"));
        unsafe { std::env::remove_var(MOCK_DEPLOY_MODE_ENV) };
    }

    #[test]
    fn mock_deploy_mode_rejects_invalid_values() {
        let _guard = env_lock().lock().expect("env lock should acquire");
        unsafe { std::env::set_var(MOCK_DEPLOY_MODE_ENV, "desktop") };
        let error = mock_deploy_mode_from_env().expect_err("invalid deploy mode should fail");
        assert!(error.contains("Invalid OPENTEAMS_MOCK_DEPLOY_MODE value"));
        unsafe { std::env::remove_var(MOCK_DEPLOY_MODE_ENV) };
    }

    #[test]
    fn detect_deploy_mode_prefers_tauri_flag() {
        let deploy_mode = detect_deploy_mode_for_path(true, Path::new("/tmp/openteams"));
        assert_eq!(deploy_mode, "tauri");
    }

    #[test]
    fn detect_deploy_mode_recognizes_npx_install_path() {
        let deploy_mode =
            detect_deploy_mode_for_path(false, Path::new("/home/test/.openteams/bin/openteams"));
        assert_eq!(deploy_mode, "npx");
    }
}
