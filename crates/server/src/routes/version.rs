use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use axum::{
    Json, Router,
    http::StatusCode,
    response::Json as ResponseJson,
    routing::{get, post},
};
use flate2::read::GzDecoder;
use semver::Version;
use serde::{Deserialize, Serialize};
use tar::Archive;
use tokio::{process::Command, time::sleep};
use ts_rs::TS;
use utils::{port_file::read_port_file, response::ApiResponse, version::APP_VERSION};

use crate::DeploymentImpl;

const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/openteams-lab/openteams/releases/latest";
const NPX_UPDATE_PACKAGE_SPEC: &str = "@openteams-lab/openteams-web@latest";
const NPX_UPDATE_PACKAGE_ENV: &str = "OPENTEAMS_NPX_UPDATE_PACKAGE";
const NPX_UPDATE_STATE_FILE: &str = "prepared-package.json";
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PreparedNpxPackage {
    package_spec: String,
    cli_path: PathBuf,
    archive_path: Option<PathBuf>,
    extract_dir: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
struct NpmPackEntry {
    filename: String,
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
    if !should_stage_npx_update_for_restart().map_err(|message| internal_api_error(&message))? {
        return Err(internal_api_error(
            "npx self-update is unavailable in this deployment mode.",
        ));
    }

    let prepared_package = prepare_npx_update_package()
        .await
        .map_err(|message| internal_api_error(&message))?;
    let mut command = build_cli_command(&prepared_package.cli_path, "stage-update", &[]);
    let output = run_update_command(&mut command).await?;

    let message = if output.is_empty() {
        "npx update downloaded and staged successfully".to_string()
    } else {
        format!("npx update downloaded and staged successfully: {}", output)
    };

    Ok(ResponseJson(ApiResponse::success(UpdateNpxResponse {
        success: true,
        message,
    })))
}

pub async fn restart_service()
-> Result<ResponseJson<ApiResponse<UpdateNpxResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    let args: Vec<OsString> = env::args_os().skip(1).collect();
    let working_dir = resolve_restart_working_dir();

    let mut command = if should_stage_npx_update_for_restart()
        .map_err(|message| internal_api_error(&message))?
    {
        build_npx_restart_helper_command(&args).map_err(|message| internal_api_error(&message))?
    } else {
        let executable =
            resolve_restart_executable().map_err(|message| internal_api_error(&message))?;
        let mut command = Command::new(executable);
        command.args(&args);
        command
    };

    command.stdin(Stdio::null());
    command.stdout(Stdio::null());
    command.stderr(Stdio::null());
    command.current_dir(&working_dir);
    command.envs(env::vars_os());
    command.env(SKIP_BROWSER_ENV, "1");

    if env::var_os("BACKEND_PORT").is_none()
        && env::var_os("PORT").is_none()
        && let Some(port) = current_backend_port().await
    {
        command.env("BACKEND_PORT", port.to_string());
    }

    spawn_detached(&mut command).await.map_err(|error| {
        internal_api_error(&format!(
            "Failed to restart service from '{}' (cwd '{}'): {error}",
            command.as_std().get_program().to_string_lossy(),
            working_dir.display()
        ))
    })?;

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

fn should_stage_npx_update_for_restart() -> Result<bool, String> {
    Ok(effective_deploy_mode()? == "npx")
}

fn resolve_npx_update_package_spec() -> String {
    match env::var(NPX_UPDATE_PACKAGE_ENV) {
        Ok(value) if !value.trim().is_empty() => value,
        _ => NPX_UPDATE_PACKAGE_SPEC.to_string(),
    }
}

fn should_direct_execute_npx_update_target(target: &str) -> bool {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return false;
    }

    let path = Path::new(trimmed);
    if !is_local_script_path(trimmed, path) {
        return false;
    }

    matches!(
        path.extension().and_then(|value| value.to_str()),
        Some("js" | "cjs" | "mjs")
    )
}

fn is_local_script_path(raw: &str, path: &Path) -> bool {
    path.is_absolute()
        || raw.starts_with("./")
        || raw.starts_with(".\\")
        || raw.starts_with("../")
        || raw.starts_with("..\\")
        || raw.starts_with('/')
        || raw.starts_with('\\')
        || has_windows_drive_prefix(raw)
}

fn has_windows_drive_prefix(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

fn resolve_updates_root_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Failed to resolve home directory for npx updater cache.".to_string())?;
    Ok(home.join(".openteams").join("updates").join("npm-package"))
}

fn prepared_npx_state_path() -> Result<PathBuf, String> {
    Ok(resolve_updates_root_dir()?.join(NPX_UPDATE_STATE_FILE))
}

fn load_prepared_npx_package() -> Result<PreparedNpxPackage, String> {
    let state_path = prepared_npx_state_path()?;
    let content = fs::read_to_string(&state_path).map_err(|error| {
        format!(
            "Failed to read prepared npx package state '{}': {error}",
            state_path.display()
        )
    })?;
    let prepared = serde_json::from_str::<PreparedNpxPackage>(&content).map_err(|error| {
        format!(
            "Failed to parse prepared npx package state '{}': {error}",
            state_path.display()
        )
    })?;

    if !prepared.cli_path.exists() {
        return Err(format!(
            "Prepared npx CLI script '{}' no longer exists. Update again before restarting.",
            prepared.cli_path.display()
        ));
    }

    Ok(prepared)
}

fn persist_prepared_npx_package(prepared: &PreparedNpxPackage) -> Result<(), String> {
    let state_path = prepared_npx_state_path()?;
    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create npx updater state directory '{}': {error}",
                parent.display()
            )
        })?;
    }

    let content = serde_json::to_string_pretty(prepared)
        .map_err(|error| format!("Failed to serialize prepared npx package state: {error}"))?;
    fs::write(&state_path, content).map_err(|error| {
        format!(
            "Failed to write prepared npx package state '{}': {error}",
            state_path.display()
        )
    })
}

fn cleanup_prepared_npx_package() -> Result<(), String> {
    let updates_root = resolve_updates_root_dir()?;
    if !updates_root.exists() {
        return Ok(());
    }

    let current_state = load_prepared_npx_package().ok();
    if let Some(prepared) = current_state {
        if let Some(extract_dir) = prepared.extract_dir {
            let _ = fs::remove_dir_all(&extract_dir);
        }

        if let Some(archive_path) = prepared.archive_path {
            let _ = fs::remove_file(&archive_path);
        }
    }

    let state_path = updates_root.join(NPX_UPDATE_STATE_FILE);
    let _ = fs::remove_file(state_path);
    Ok(())
}

fn resolve_local_package_archive_path(spec: &str) -> Option<PathBuf> {
    let trimmed = spec.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(rest) = trimmed.strip_prefix("file:") {
        if rest.is_empty() {
            return None;
        }
        return Some(PathBuf::from(rest));
    }

    let path = Path::new(trimmed);
    let is_path_like = path.is_absolute()
        || trimmed.starts_with('.')
        || trimmed.contains('\\')
        || trimmed.contains('/');
    if is_path_like && path.extension().and_then(|value| value.to_str()) == Some("tgz") {
        return Some(path.to_path_buf());
    }

    None
}

async fn download_npm_package_archive(spec: &str, updates_root: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(updates_root).map_err(|error| {
        format!(
            "Failed to create npx updater cache directory '{}': {error}",
            updates_root.display()
        )
    })?;

    if let Some(local_archive) = resolve_local_package_archive_path(spec) {
        let source_path = if local_archive.is_absolute() {
            local_archive
        } else {
            env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(local_archive)
        };
        if !source_path.exists() {
            return Err(format!(
                "Configured npx package archive '{}' does not exist.",
                source_path.display()
            ));
        }

        let file_name = source_path
            .file_name()
            .map(|value| value.to_os_string())
            .unwrap_or_else(|| OsString::from("openteams-update.tgz"));
        let destination = updates_root.join(file_name);
        fs::copy(&source_path, &destination).map_err(|error| {
            format!(
                "Failed to copy npx package archive from '{}' to '{}': {error}",
                source_path.display(),
                destination.display()
            )
        })?;
        return Ok(destination);
    }

    let mut command = Command::new(npm_command());
    command.current_dir(updates_root);
    command.args(["pack", "--json", spec]);
    let output = command
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| format!("Failed to download npm package via 'npm pack': {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        let combined = format_command_output(&stdout, &stderr);
        return Err(if combined.is_empty() {
            "npm pack failed".to_string()
        } else {
            format!("npm pack failed: {combined}")
        });
    }

    let pack_entries = serde_json::from_str::<Vec<NpmPackEntry>>(&stdout).map_err(|error| {
        format!("Failed to parse npm pack output while downloading update package: {error}")
    })?;
    let filename = pack_entries
        .last()
        .map(|entry| entry.filename.clone())
        .ok_or_else(|| "npm pack did not return a package filename.".to_string())?;
    Ok(updates_root.join(filename))
}

fn extract_npm_package_archive(archive_path: &Path, extract_dir: &Path) -> Result<(), String> {
    if extract_dir.exists() {
        fs::remove_dir_all(extract_dir).map_err(|error| {
            format!(
                "Failed to clear previous extracted npm package '{}': {error}",
                extract_dir.display()
            )
        })?;
    }

    fs::create_dir_all(extract_dir).map_err(|error| {
        format!(
            "Failed to create npm package extraction directory '{}': {error}",
            extract_dir.display()
        )
    })?;

    let archive_file = fs::File::open(archive_path).map_err(|error| {
        format!(
            "Failed to open npm package archive '{}': {error}",
            archive_path.display()
        )
    })?;
    let decoder = GzDecoder::new(archive_file);
    let mut archive = Archive::new(decoder);
    archive.unpack(extract_dir).map_err(|error| {
        format!(
            "Failed to extract npm package archive '{}' into '{}': {error}",
            archive_path.display(),
            extract_dir.display()
        )
    })
}

fn locate_cli_path_in_extracted_package(extract_dir: &Path) -> Result<PathBuf, String> {
    let package_root = locate_extracted_package_root(extract_dir)?;
    let candidates = [
        package_root.join("bin").join("cli.js"),
        package_root
            .join("npx")
            .join("openteams-npx")
            .join("bin")
            .join("cli.js"),
    ];

    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| {
            format!(
                "Failed to locate cli.js in extracted npm package under '{}'.",
                extract_dir.display()
            )
        })
}

fn locate_extracted_package_root(extract_dir: &Path) -> Result<PathBuf, String> {
    let package_root = extract_dir.join("package");
    let package_json = package_root.join("package.json");
    if package_json.exists() {
        Ok(package_root)
    } else {
        Err(format!(
            "Failed to locate extracted npm package root under '{}'.",
            extract_dir.display()
        ))
    }
}

async fn ensure_extracted_package_dependencies(package_root: &Path) -> Result<(), String> {
    let node_modules = package_root.join("node_modules");
    if node_modules.exists() {
        return Ok(());
    }

    let mut command = Command::new(npm_command());
    command.current_dir(package_root);
    command.args([
        "install",
        "--omit=dev",
        "--ignore-scripts",
        "--no-package-lock",
        "--fund=false",
        "--audit=false",
        "--loglevel=error",
    ]);

    let output = command
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| {
            format!(
                "Failed to install runtime dependencies for extracted npm package '{}': {error}",
                package_root.display()
            )
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if output.status.success() {
        return Ok(());
    }

    let combined = format_command_output(&stdout, &stderr);
    Err(if combined.is_empty() {
        format!(
            "Failed to install runtime dependencies for extracted npm package '{}'.",
            package_root.display()
        )
    } else {
        format!(
            "Failed to install runtime dependencies for extracted npm package '{}': {combined}",
            package_root.display()
        )
    })
}

async fn prepare_npx_update_package() -> Result<PreparedNpxPackage, String> {
    let package_spec = resolve_npx_update_package_spec();

    if should_direct_execute_npx_update_target(&package_spec) {
        let cli_path = PathBuf::from(package_spec.clone());
        if !cli_path.exists() {
            return Err(format!(
                "Configured npx CLI script '{}' does not exist.",
                cli_path.display()
            ));
        }

        let prepared = PreparedNpxPackage {
            package_spec,
            cli_path,
            archive_path: None,
            extract_dir: None,
        };
        persist_prepared_npx_package(&prepared)?;
        return Ok(prepared);
    }

    cleanup_prepared_npx_package()?;

    let updates_root = resolve_updates_root_dir()?;
    let archive_path = download_npm_package_archive(&package_spec, &updates_root).await?;
    let extract_dir = updates_root.join("package");
    extract_npm_package_archive(&archive_path, &extract_dir)?;
    let package_root = locate_extracted_package_root(&extract_dir)?;
    ensure_extracted_package_dependencies(&package_root).await?;
    let cli_path = locate_cli_path_in_extracted_package(&extract_dir)?;

    let prepared = PreparedNpxPackage {
        package_spec,
        cli_path,
        archive_path: Some(archive_path),
        extract_dir: Some(extract_dir),
    };
    persist_prepared_npx_package(&prepared)?;
    Ok(prepared)
}

fn build_cli_command(cli_path: &Path, command_name: &str, extra_args: &[OsString]) -> Command {
    let mut command = Command::new(node_command());
    command.arg(cli_path);
    command.arg(command_name);
    command.args(extra_args);
    command
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

pub(crate) fn detect_deploy_mode() -> &'static str {
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

fn resolve_restart_executable() -> Result<PathBuf, String> {
    let current_exe = env::current_exe()
        .map_err(|error| format!("Failed to resolve current executable: {error}"))?;
    let deploy_mode = effective_deploy_mode()?;

    if deploy_mode != "npx" {
        return Ok(current_exe);
    }

    if let Some(installed_binary) = npx_installed_binary_path()
        && installed_binary.exists()
    {
        return Ok(installed_binary);
    }

    if current_exe.exists() {
        return Ok(current_exe);
    }

    Err(match npx_installed_binary_path() {
        Some(installed_binary) => format!(
            "Failed to resolve npx executable for restart. Checked '{}' and '{}', but neither exists.",
            current_exe.display(),
            installed_binary.display()
        ),
        None => format!(
            "Failed to resolve npx executable for restart. Current executable '{}' does not exist, and the home directory could not be resolved.",
            current_exe.display()
        ),
    })
}

fn build_npx_restart_helper_command(args: &[OsString]) -> Result<Command, String> {
    let prepared = load_prepared_npx_package()?;
    let helper_args = vec![OsString::from("--wait-ms=1500"), OsString::from("--")];
    let mut merged_args = helper_args;
    merged_args.extend(args.iter().cloned());

    Ok(build_cli_command(
        &prepared.cli_path,
        "apply-update-and-restart",
        &merged_args,
    ))
}

fn npx_installed_binary_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| {
        home.join(".openteams")
            .join("bin")
            .join(current_binary_name())
    })
}

fn current_binary_name() -> &'static str {
    if cfg!(windows) {
        "openteams.exe"
    } else {
        "openteams"
    }
}

fn resolve_restart_working_dir() -> PathBuf {
    env::current_dir()
        .ok()
        .filter(|path| path.is_dir())
        .or_else(dirs::home_dir)
        .unwrap_or_else(env::temp_dir)
}

async fn run_update_command(
    command: &mut Command,
) -> Result<String, (StatusCode, Json<ApiResponse<()>>)> {
    let output = command
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| internal_api_error(&format!("Failed to start update command: {error}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format_command_output(&stdout, &stderr);

    if output.status.success() {
        Ok(combined)
    } else {
        Err(internal_api_error(&format!(
            "update command failed{}",
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

    let stdout = compact_command_output(stdout);
    if !stdout.is_empty() {
        parts.push(format!("stdout:\n{stdout}"));
    }

    let stderr = compact_command_output(stderr);
    if !stderr.is_empty() {
        parts.push(format!("stderr:\n{stderr}"));
    }

    parts.join("\n\n")
}

fn compact_command_output(stream: &str) -> String {
    let normalized = stream.replace("\r\n", "\n").replace('\r', "\n");
    let mut compacted = Vec::new();
    let mut current_line: Option<String> = None;
    let mut current_count = 0usize;
    let mut last_progress_line: Option<String> = None;
    let mut progress_count = 0usize;

    for raw_line in normalized.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        if is_progress_line(line) {
            flush_repeated_line(&mut compacted, &mut current_line, &mut current_count);
            last_progress_line = Some(line.to_string());
            progress_count += 1;
            continue;
        }

        flush_progress_block(&mut compacted, &mut last_progress_line, &mut progress_count);

        match current_line.as_deref() {
            Some(existing) if existing == line => {
                current_count += 1;
            }
            _ => {
                flush_repeated_line(&mut compacted, &mut current_line, &mut current_count);
                current_line = Some(line.to_string());
                current_count = 1;
            }
        }
    }

    flush_progress_block(&mut compacted, &mut last_progress_line, &mut progress_count);
    flush_repeated_line(&mut compacted, &mut current_line, &mut current_count);

    compacted.join("\n")
}

fn flush_repeated_line(output: &mut Vec<String>, line: &mut Option<String>, count: &mut usize) {
    let Some(current) = line.take() else {
        *count = 0;
        return;
    };

    if *count > 1 {
        output.push(format!("{current} [repeated {} times]", *count));
    } else {
        output.push(current);
    }

    *count = 0;
}

fn flush_progress_block(
    output: &mut Vec<String>,
    last_progress_line: &mut Option<String>,
    progress_count: &mut usize,
) {
    let Some(last_line) = last_progress_line.take() else {
        *progress_count = 0;
        return;
    };

    if *progress_count > 1 {
        output.push(format!(
            "{last_line} [progress condensed from {} lines]",
            *progress_count
        ));
    } else {
        output.push(last_line);
    }

    *progress_count = 0;
}

fn is_progress_line(line: &str) -> bool {
    line.starts_with("Downloading:")
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

fn node_command() -> &'static str {
    "node"
}

fn internal_api_error(message: &str) -> (StatusCode, Json<ApiResponse<()>>) {
    (StatusCode::BAD_GATEWAY, Json(ApiResponse::error(message)))
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        path::{Path, PathBuf},
        sync::{Mutex, OnceLock},
    };

    use super::{
        MOCK_DEPLOY_MODE_ENV, NPX_UPDATE_PACKAGE_ENV, NPX_UPDATE_PACKAGE_SPEC,
        compact_command_output, current_binary_name, default_mock_release_tag,
        detect_deploy_mode_for_path, format_command_output, is_truthy_env_value,
        locate_cli_path_in_extracted_package, locate_extracted_package_root,
        mock_deploy_mode_from_env, normalize_version, resolve_local_package_archive_path,
        resolve_npx_update_package_spec, resolve_restart_working_dir,
        should_direct_execute_npx_update_target, should_stage_npx_update_for_restart,
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

    #[test]
    fn current_binary_name_matches_platform() {
        let expected = if cfg!(windows) {
            "openteams.exe"
        } else {
            "openteams"
        };
        assert_eq!(current_binary_name(), expected);
    }

    #[test]
    fn restart_working_dir_prefers_current_dir_when_available() {
        let expected = env::current_dir().expect("cwd should resolve");

        let resolved = resolve_restart_working_dir();

        assert_eq!(resolved, expected);
    }

    #[test]
    fn npx_update_strategy_stages_restart_for_npx_mode() {
        let _guard = env_lock().lock().expect("env lock should acquire");
        unsafe { std::env::set_var(MOCK_DEPLOY_MODE_ENV, "npx") };

        let should_stage = should_stage_npx_update_for_restart().expect("strategy should resolve");

        assert!(should_stage);
        unsafe { std::env::remove_var(MOCK_DEPLOY_MODE_ENV) };
    }

    #[test]
    fn npx_update_strategy_skips_restart_staging_for_non_npx_modes() {
        let _guard = env_lock().lock().expect("env lock should acquire");
        unsafe { std::env::set_var(MOCK_DEPLOY_MODE_ENV, "unknown") };

        let should_stage = should_stage_npx_update_for_restart().expect("strategy should resolve");

        assert!(!should_stage);
        unsafe { std::env::remove_var(MOCK_DEPLOY_MODE_ENV) };
    }

    #[test]
    fn npx_update_package_spec_uses_env_override_when_present() {
        let _guard = env_lock().lock().expect("env lock should acquire");
        unsafe { std::env::set_var(NPX_UPDATE_PACKAGE_ENV, "file:/tmp/openteams.tgz") };

        let package_spec = resolve_npx_update_package_spec();

        assert_eq!(package_spec, "file:/tmp/openteams.tgz");
        unsafe { std::env::remove_var(NPX_UPDATE_PACKAGE_ENV) };
    }

    #[test]
    fn npx_update_package_spec_falls_back_to_default() {
        let _guard = env_lock().lock().expect("env lock should acquire");
        unsafe { std::env::remove_var(NPX_UPDATE_PACKAGE_ENV) };

        let package_spec = resolve_npx_update_package_spec();

        assert_eq!(package_spec, NPX_UPDATE_PACKAGE_SPEC);
    }

    #[test]
    fn direct_execute_update_target_detects_local_js_paths() {
        assert!(should_direct_execute_npx_update_target(
            "E:/workspace/projectSS/openteams/npx/openteams-npx/bin/cli.js"
        ));
        assert!(should_direct_execute_npx_update_target(
            r"E:\workspace\projectSS\openteams\npx\openteams-npx\bin\cli.js"
        ));
        assert!(should_direct_execute_npx_update_target(
            "./npx/openteams-npx/bin/cli.js"
        ));
        assert!(should_direct_execute_npx_update_target(
            "/workspace/projectSS/openteams/npx/openteams-npx/bin/cli.js"
        ));
        assert!(!should_direct_execute_npx_update_target(
            "@openteams-lab/openteams-web@latest"
        ));
        assert!(!should_direct_execute_npx_update_target(
            "C:/Users/test/openteams-0.3.15.tgz"
        ));
    }

    #[test]
    fn local_package_archive_path_detects_file_scheme_and_tgz_paths() {
        assert_eq!(
            resolve_local_package_archive_path("file:E:/tmp/openteams-0.3.15.tgz")
                .expect("file scheme should parse"),
            PathBuf::from("E:/tmp/openteams-0.3.15.tgz")
        );
        assert_eq!(
            resolve_local_package_archive_path("./openteams-0.3.15.tgz")
                .expect("relative tgz should parse"),
            PathBuf::from("./openteams-0.3.15.tgz")
        );
        assert!(
            resolve_local_package_archive_path("@openteams-lab/openteams-web@latest").is_none()
        );
    }

    #[test]
    fn locate_cli_path_supports_published_and_root_package_layouts() {
        let temp = tempfile::tempdir().expect("temp dir should create");
        let package_root = temp.path().join("package");
        fs::create_dir_all(&package_root).expect("package root should create");
        fs::write(package_root.join("package.json"), "{}").expect("package json should write");
        let published_path = package_root.join("bin");
        fs::create_dir_all(&published_path).expect("published path should create");
        fs::write(published_path.join("cli.js"), "").expect("cli should write");

        let located = locate_cli_path_in_extracted_package(temp.path())
            .expect("published layout should resolve");
        assert_eq!(located, published_path.join("cli.js"));

        fs::remove_file(&located).expect("published cli should remove");
        let root_path = temp
            .path()
            .join("package")
            .join("npx")
            .join("openteams-npx")
            .join("bin");
        fs::create_dir_all(&root_path).expect("root path should create");
        fs::write(root_path.join("cli.js"), "").expect("root cli should write");

        let located =
            locate_cli_path_in_extracted_package(temp.path()).expect("root layout should resolve");
        assert_eq!(located, root_path.join("cli.js"));
    }

    #[test]
    fn locate_extracted_package_root_requires_package_json() {
        let temp = tempfile::tempdir().expect("temp dir should create");
        let package_root = temp.path().join("package");
        fs::create_dir_all(&package_root).expect("package root should create");
        fs::write(package_root.join("package.json"), "{}").expect("package json should write");

        let located =
            locate_extracted_package_root(temp.path()).expect("package root should resolve");
        assert_eq!(located, package_root);
    }

    #[test]
    fn compact_command_output_condenses_progress_lines() {
        let compacted = compact_command_output(
            "Downloading: 0.0MB / 53.9MB (0%)\rDownloading: 0.0MB / 53.9MB (0%)\rDownloading: 0.1MB / 53.9MB (0%)",
        );

        assert_eq!(
            compacted,
            "Downloading: 0.1MB / 53.9MB (0%) [progress condensed from 3 lines]"
        );
    }

    #[test]
    fn format_command_output_condenses_duplicate_lines_and_labels_streams() {
        let output = format_command_output(
            "Preparing binary package...\nPreparing binary package...\nDone",
            "Downloading: 0.0MB / 53.9MB (0%)\rDownloading: 0.1MB / 53.9MB (0%)",
        );

        assert_eq!(
            output,
            "stdout:\nPreparing binary package... [repeated 2 times]\nDone\n\nstderr:\nDownloading: 0.1MB / 53.9MB (0%) [progress condensed from 2 lines]"
        );
    }
}
