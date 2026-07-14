use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum UpdatePlatform {
    WebNpx,
    Macos,
    LinuxAppimage,
    LinuxDeb,
    Windows,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum UpdateArchitecture {
    Aarch64,
    X86_64,
    I686,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum UpdateMethod {
    NpxStagedRestart,
    TauriUpdater,
    ManualDownload,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum UpdateCheckStatus {
    Idle,
    Checking,
    UpdateAvailable,
    UpToDate,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum UpdateDownloadStatus {
    Idle,
    Downloading,
    Downloaded,
    Failed,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum UpdateInstallStatus {
    Idle,
    Installing,
    RestartRequired,
    Completed,
    Failed,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum UpdateErrorStage {
    Check,
    Download,
    Install,
    Restart,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct UpdateErrorInfo {
    pub stage: UpdateErrorStage,
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct UpdateCapability {
    pub platform: UpdatePlatform,
    pub method: UpdateMethod,
    pub can_download: bool,
    pub can_install: bool,
    pub requires_restart: bool,
    pub fallback_url: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct UpdateCheckQuery {
    pub platform: Option<UpdatePlatform>,
    pub architecture: Option<UpdateArchitecture>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DesktopUpdateContext {
    pub platform: UpdatePlatform,
    pub architecture: UpdateArchitecture,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct VersionCheckResponse {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub deploy_mode: String,
    pub release_url: String,
    pub release_notes: Option<String>,
    pub published_at: Option<String>,
    pub capability: UpdateCapability,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct UpdateOperationState {
    pub download_status: UpdateDownloadStatus,
    pub install_status: UpdateInstallStatus,
    #[ts(type = "number | null")]
    pub downloaded_bytes: Option<u64>,
    #[ts(type = "number | null")]
    pub total_bytes: Option<u64>,
    pub error: Option<UpdateErrorInfo>,
}

impl UpdateOperationState {
    pub fn failed(error: UpdateErrorInfo) -> Self {
        let (download_status, install_status) = match error.stage {
            UpdateErrorStage::Download => {
                (UpdateDownloadStatus::Failed, UpdateInstallStatus::Idle)
            }
            UpdateErrorStage::Install => {
                (UpdateDownloadStatus::Idle, UpdateInstallStatus::Failed)
            }
            UpdateErrorStage::Restart => (
                UpdateDownloadStatus::Downloaded,
                UpdateInstallStatus::Failed,
            ),
            UpdateErrorStage::Check => (UpdateDownloadStatus::Idle, UpdateInstallStatus::Idle),
        };

        Self {
            download_status,
            install_status,
            downloaded_bytes: None,
            total_bytes: None,
            error: Some(error),
        }
    }

    pub fn npx_staged() -> Self {
        Self {
            download_status: UpdateDownloadStatus::Downloaded,
            install_status: UpdateInstallStatus::RestartRequired,
            downloaded_bytes: None,
            total_bytes: None,
            error: None,
        }
    }

    pub fn restart_completed() -> Self {
        Self {
            download_status: UpdateDownloadStatus::Downloaded,
            install_status: UpdateInstallStatus::Completed,
            downloaded_bytes: None,
            total_bytes: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct UpdateActionResponse {
    pub success: bool,
    pub message: String,
    pub state: UpdateOperationState,
}

pub fn action_update_error(error: UpdateErrorInfo) -> UpdateActionResponse {
    let message = error.message.clone();
    UpdateActionResponse {
        success: false,
        message,
        state: UpdateOperationState::failed(error),
    }
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubLatestRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct TauriManifestEntry {
    signature: String,
    url: String,
}

#[derive(Debug, Clone, Deserialize)]
struct TauriManifest {
    version: String,
    platforms: HashMap<String, TauriManifestEntry>,
}

#[derive(Debug, Clone)]
struct ReleaseBundle {
    release: GitHubLatestRelease,
    manifest: Option<TauriManifest>,
    signature_contents: HashMap<String, String>,
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
