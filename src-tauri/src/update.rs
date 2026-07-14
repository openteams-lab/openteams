use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DesktopWirePlatform {
    Macos,
    LinuxAppimage,
    LinuxDeb,
    Windows,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DesktopWireArchitecture {
    Aarch64,
    X86_64,
    I686,
    Unknown,
}

impl DesktopWireArchitecture {
    fn from_target(value: &str) -> Self {
        match value {
            "aarch64" => Self::Aarch64,
            "x86_64" => Self::X86_64,
            "x86" | "i686" => Self::I686,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct DesktopUpdateContext {
    pub(crate) platform: DesktopWirePlatform,
    pub(crate) architecture: DesktopWireArchitecture,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum UpdateDownloadStatus {
    Idle,
    Downloading,
    Downloaded,
    Failed,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum UpdateInstallStatus {
    Idle,
    Installing,
    RestartRequired,
    Completed,
    Failed,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum UpdateErrorStage {
    Check,
    Download,
    Install,
    Restart,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct UpdateErrorInfo {
    pub(crate) stage: UpdateErrorStage,
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) retryable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct UpdateOperationState {
    pub(crate) download_status: UpdateDownloadStatus,
    pub(crate) install_status: UpdateInstallStatus,
    pub(crate) downloaded_bytes: Option<u64>,
    pub(crate) total_bytes: Option<u64>,
    pub(crate) error: Option<UpdateErrorInfo>,
}

fn update_error(
    stage: UpdateErrorStage,
    code: &str,
    message: &str,
    retryable: bool,
) -> UpdateErrorInfo {
    UpdateErrorInfo {
        stage,
        code: code.to_string(),
        message: message.to_string(),
        retryable,
    }
}

fn completed_update_state() -> UpdateOperationState {
    UpdateOperationState {
        download_status: UpdateDownloadStatus::Downloaded,
        install_status: UpdateInstallStatus::Completed,
        downloaded_bytes: None,
        total_bytes: None,
        error: None,
    }
}

fn already_up_to_date_state() -> UpdateOperationState {
    UpdateOperationState {
        download_status: UpdateDownloadStatus::NotApplicable,
        install_status: UpdateInstallStatus::Completed,
        downloaded_bytes: None,
        total_bytes: None,
        error: None,
    }
}

fn classify_download_and_install_error(error: &tauri::updater::Error) -> UpdateErrorInfo {
    match error {
        tauri::updater::Error::Network(_) | tauri::updater::Error::ReleaseNotFound => {
            update_error(
                UpdateErrorStage::Download,
                "desktop_update_download_failed",
                &format!("Failed to download desktop update: {error}"),
                true,
            )
        }
        tauri::updater::Error::Minisign(_)
        | tauri::updater::Error::Base64(_)
        | tauri::updater::Error::SignatureUtf8(_) => update_error(
            UpdateErrorStage::Install,
            "desktop_update_signature_failed",
            &format!("Failed to verify desktop update signature: {error}"),
            false,
        ),
        _ => update_error(
            UpdateErrorStage::Install,
            "desktop_update_install_failed",
            &format!("Failed to install desktop update: {error}"),
            true,
        ),
    }
}

fn desktop_context(os: &str, arch: &str, appimage_present: bool) -> DesktopUpdateContext {
    let platform = match (os, appimage_present) {
        ("macos", _) => DesktopWirePlatform::Macos,
        ("linux", true) => DesktopWirePlatform::LinuxAppimage,
        ("linux", false) => DesktopWirePlatform::LinuxDeb,
        ("windows", _) => DesktopWirePlatform::Windows,
        _ => DesktopWirePlatform::Unknown,
    };

    DesktopUpdateContext {
        platform,
        architecture: DesktopWireArchitecture::from_target(arch),
    }
}

fn should_restart_after_install(target_os: &str) -> bool {
    matches!(target_os, "macos" | "linux")
}

fn validate_install_target(context: &DesktopUpdateContext) -> Result<(), UpdateErrorInfo> {
    match context.platform {
        DesktopWirePlatform::Macos
        | DesktopWirePlatform::LinuxAppimage
        | DesktopWirePlatform::Windows => Ok(()),
        DesktopWirePlatform::LinuxDeb => Err(update_error(
            UpdateErrorStage::Install,
            "desktop_update_manual_install_required",
            "Native desktop updater is unavailable for Linux deb packages. Download and install the GitHub release manually.",
            false,
        )),
        DesktopWirePlatform::Unknown => Err(update_error(
            UpdateErrorStage::Install,
            "desktop_update_unsupported_platform",
            "Native desktop updater is unavailable on this platform.",
            false,
        )),
    }
}

#[tauri::command]
pub(crate) fn get_desktop_update_context() -> DesktopUpdateContext {
    desktop_context(
        std::env::consts::OS,
        std::env::consts::ARCH,
        std::env::var_os("APPIMAGE").is_some(),
    )
}

#[tauri::command]
pub(crate) async fn install_desktop_update(
    app: tauri::AppHandle,
) -> Result<UpdateOperationState, UpdateErrorInfo> {
    validate_install_target(&get_desktop_update_context())?;

    let update = tauri::updater::builder(app.clone())
        .check()
        .await
        .map_err(|error| {
            update_error(
                UpdateErrorStage::Check,
                "desktop_update_check_failed",
                &format!("Failed to check for desktop update: {error}"),
                true,
            )
        })?;

    if !update.is_update_available() {
        return Ok(already_up_to_date_state());
    }

    update.download_and_install().await.map_err(|error| {
        classify_download_and_install_error(&error)
    })?;

    if should_restart_after_install(std::env::consts::OS) {
        app.restart();
    }

    Ok(completed_update_state())
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tauri::updater::Error as UpdaterError;

    use super::{
        DesktopUpdateContext, DesktopWireArchitecture, DesktopWirePlatform, UpdateDownloadStatus,
        UpdateErrorInfo, UpdateErrorStage, UpdateInstallStatus, UpdateOperationState,
        already_up_to_date_state, classify_download_and_install_error,
        completed_update_state, desktop_context, should_restart_after_install,
        validate_install_target,
    };

    #[test]
    fn desktop_context_serializes_linux_appimage_identity() {
        let context = desktop_context("linux", "x86_64", true);
        assert_eq!(
            serde_json::to_value(&context).unwrap(),
            json!({
                "platform": "linux_appimage",
                "architecture": "x86_64",
            })
        );
    }

    #[test]
    fn desktop_context_maps_i686_aliases() {
        assert_eq!(
            desktop_context("linux", "x86", false),
            DesktopUpdateContext {
                platform: DesktopWirePlatform::LinuxDeb,
                architecture: DesktopWireArchitecture::I686,
            }
        );
        assert_eq!(
            desktop_context("linux", "i686", false),
            DesktopUpdateContext {
                platform: DesktopWirePlatform::LinuxDeb,
                architecture: DesktopWireArchitecture::I686,
            }
        );
    }

    #[test]
    fn update_operation_state_serializes_server_wire_shape() {
        let completed = UpdateOperationState {
            download_status: UpdateDownloadStatus::Downloaded,
            install_status: UpdateInstallStatus::Completed,
            downloaded_bytes: Some(30),
            total_bytes: Some(30),
            error: None,
        };
        assert_eq!(
            serde_json::to_value(&completed).unwrap(),
            json!({
                "download_status": "downloaded",
                "install_status": "completed",
                "downloaded_bytes": 30,
                "total_bytes": 30,
                "error": null,
            })
        );

        let failed = UpdateOperationState {
            download_status: UpdateDownloadStatus::Downloaded,
            install_status: UpdateInstallStatus::Failed,
            downloaded_bytes: None,
            total_bytes: None,
            error: Some(UpdateErrorInfo {
                stage: UpdateErrorStage::Install,
                code: "desktop_update_install_failed".to_string(),
                message: "install failed".to_string(),
                retryable: true,
            }),
        };
        assert_eq!(
            serde_json::to_value(&failed).unwrap(),
            json!({
                "download_status": "downloaded",
                "install_status": "failed",
                "downloaded_bytes": null,
                "total_bytes": null,
                "error": {
                    "stage": "install",
                    "code": "desktop_update_install_failed",
                    "message": "install failed",
                    "retryable": true,
                }
            })
        );
    }

    #[test]
    fn restart_policy_only_restarts_after_supported_desktop_installs() {
        assert!(should_restart_after_install("macos"));
        assert!(should_restart_after_install("linux"));
        assert!(!should_restart_after_install("windows"));
        assert!(!should_restart_after_install("unknown"));
    }

    #[test]
    fn no_update_command_state_reports_completed_without_download() {
        assert_eq!(
            already_up_to_date_state(),
            UpdateOperationState {
                download_status: UpdateDownloadStatus::NotApplicable,
                install_status: UpdateInstallStatus::Completed,
                downloaded_bytes: None,
                total_bytes: None,
                error: None,
            }
        );
    }

    #[test]
    fn successful_install_command_state_reports_downloaded_and_completed() {
        assert_eq!(
            completed_update_state(),
            UpdateOperationState {
                download_status: UpdateDownloadStatus::Downloaded,
                install_status: UpdateInstallStatus::Completed,
                downloaded_bytes: None,
                total_bytes: None,
                error: None,
            }
        );
    }

    #[test]
    fn network_failures_are_reported_as_download_errors() {
        let error = classify_download_and_install_error(&UpdaterError::Network(
            "connection refused".to_string(),
        ));

        assert_eq!(error.stage, UpdateErrorStage::Download);
        assert_eq!(error.code, "desktop_update_download_failed");
        assert!(error.message.contains("download"));
    }

    #[test]
    fn native_signature_errors_are_non_retryable_install_failures() {
        let error = UpdaterError::SignatureUtf8("tampered signature".to_string());
        let classified = classify_download_and_install_error(&error);

        assert_eq!(classified.code, "desktop_update_signature_failed");
        assert_eq!(classified.stage, UpdateErrorStage::Install);
        assert!(!classified.retryable);
    }

    #[test]
    fn extraction_failures_are_reported_as_install_errors() {
        let error =
            classify_download_and_install_error(&UpdaterError::Extract("bad archive".to_string()));

        assert_eq!(error.stage, UpdateErrorStage::Install);
        assert_eq!(error.code, "desktop_update_install_failed");
        assert!(error.message.contains("install"));
    }

    #[test]
    fn linux_deb_is_rejected_for_native_updater() {
        let error = validate_install_target(&desktop_context("linux", "x86_64", false))
            .expect_err("linux deb should be rejected");

        assert_eq!(error.stage, UpdateErrorStage::Install);
        assert_eq!(error.code, "desktop_update_manual_install_required");
        assert!(!error.retryable);
    }

    #[test]
    fn appimage_and_macos_remain_valid_native_updater_targets() {
        validate_install_target(&desktop_context("linux", "x86_64", true))
            .expect("appimage should stay supported");
        validate_install_target(&desktop_context("macos", "aarch64", false))
            .expect("macos should stay supported");
    }
}
