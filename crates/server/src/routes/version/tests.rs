#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        path::{Path, PathBuf},
        sync::{Mutex, OnceLock},
    };

    use serde::Serialize;

    use super::{
        MOCK_DEPLOY_MODE_ENV, NPX_UPDATE_PACKAGE_ENV, NPX_UPDATE_PACKAGE_SPEC,
        UpdateArchitecture, UpdateDownloadStatus, UpdateErrorInfo, UpdateErrorStage,
        UpdateInstallStatus, UpdateMethod, UpdatePlatform, UpdatePlatform::*,
        action_update_error, asset_matches_architecture, capability_for_executable_path,
        fetch_manifest_from_release_assets,
        fetch_signature_for_context,
        compact_command_output, current_binary_name, default_mock_release_tag,
        detect_deploy_mode_for_path, format_command_output, is_truthy_env_value,
        legacy_deploy_mode_for_capability, locate_cli_path_in_extracted_package,
        locate_extracted_package_root, mock_deploy_mode_from_env, normalize_version,
        release_fixture_with_linux_manifest, resolve_desktop_capability,
        resolve_local_package_archive_path,
        resolve_npx_update_package_spec, resolve_restart_working_dir,
        should_direct_execute_npx_update_target, should_stage_npx_update_for_restart,
        validate_update_context,
    };

    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn env_lock() -> &'static Mutex<()> {
        ENV_LOCK.get_or_init(|| Mutex::new(()))
    }

    fn assert_wire_pairs<T: Serialize>(pairs: &[(T, &str)]) {
        for (value, expected) in pairs {
            assert_eq!(serde_json::to_string(value).unwrap(), format!("\"{expected}\""));
        }
    }

    #[test]
    fn update_platform_uses_snake_case_wire_values() {
        let cases = [
            (WebNpx, "\"web_npx\""),
            (Macos, "\"macos\""),
            (LinuxAppimage, "\"linux_appimage\""),
            (LinuxDeb, "\"linux_deb\""),
            (Windows, "\"windows\""),
            (Unknown, "\"unknown\""),
        ];
        for (value, expected) in cases {
            assert_eq!(serde_json::to_string(&value).unwrap(), expected);
        }
    }

    #[test]
    fn remaining_update_enums_use_exact_wire_values() {
        assert_wire_pairs(&[
            (UpdateMethod::NpxStagedRestart, "npx_staged_restart"),
            (UpdateMethod::TauriUpdater, "tauri_updater"),
            (UpdateMethod::ManualDownload, "manual_download"),
            (UpdateMethod::Unsupported, "unsupported"),
        ]);
        assert_wire_pairs(&[
            (UpdateErrorStage::Check, "check"),
            (UpdateErrorStage::Download, "download"),
            (UpdateErrorStage::Install, "install"),
            (UpdateErrorStage::Restart, "restart"),
        ]);
        assert_wire_pairs(&[
            (UpdateDownloadStatus::Idle, "idle"),
            (UpdateDownloadStatus::Downloading, "downloading"),
            (UpdateDownloadStatus::Downloaded, "downloaded"),
            (UpdateDownloadStatus::Failed, "failed"),
            (UpdateDownloadStatus::NotApplicable, "not_applicable"),
        ]);
        assert_wire_pairs(&[
            (UpdateInstallStatus::Idle, "idle"),
            (UpdateInstallStatus::Installing, "installing"),
            (UpdateInstallStatus::RestartRequired, "restart_required"),
            (UpdateInstallStatus::Completed, "completed"),
            (UpdateInstallStatus::Failed, "failed"),
            (UpdateInstallStatus::NotApplicable, "not_applicable"),
        ]);
        assert_wire_pairs(&[
            (UpdateArchitecture::Aarch64, "aarch64"),
            (UpdateArchitecture::X86_64, "x86_64"),
            (UpdateArchitecture::I686, "i686"),
            (UpdateArchitecture::Unknown, "unknown"),
        ]);
    }

    #[test]
    fn manual_assets_use_packager_architecture_aliases() {
        let cases = [
            (
                UpdateArchitecture::X86_64,
                "openteams_0.4.8_amd64-linux.deb",
                true,
            ),
            (
                UpdateArchitecture::X86_64,
                "openteams-0.4.8-x86_64.AppImage",
                true,
            ),
            (
                UpdateArchitecture::Aarch64,
                "openteams_0.4.8_arm64-linux.deb",
                true,
            ),
            (
                UpdateArchitecture::Aarch64,
                "openteams-0.4.8-aarch64.dmg",
                true,
            ),
            (
                UpdateArchitecture::I686,
                "openteams_0.4.8_i386-linux.deb",
                true,
            ),
            (
                UpdateArchitecture::I686,
                "openteams-0.4.8-x86_64.AppImage",
                false,
            ),
            (
                UpdateArchitecture::X86_64,
                "openteams_0.4.8_arm64-linux.deb",
                false,
            ),
        ];
        for (architecture, name, expected) in cases {
            assert_eq!(asset_matches_architecture(name, architecture), expected, "{name}");
        }
    }

    #[test]
    fn appimage_requires_matching_manifest_asset_and_signature() {
        let capability = resolve_desktop_capability(
            UpdatePlatform::LinuxAppimage,
            UpdateArchitecture::X86_64,
            &release_fixture_with_linux_manifest(),
        );

        assert_eq!(capability.method, UpdateMethod::TauriUpdater);
        assert!(capability.can_install);
        assert!(capability.fallback_url.unwrap().ends_with(".AppImage"));
    }

    #[test]
    fn appimage_without_manifest_degrades_to_manual_asset() {
        let mut release = release_fixture_with_linux_manifest();
        release.manifest = None;

        let capability = resolve_desktop_capability(
            UpdatePlatform::LinuxAppimage,
            UpdateArchitecture::X86_64,
            &release,
        );

        assert_eq!(capability.method, UpdateMethod::ManualDownload);
        assert!(capability.fallback_url.unwrap().ends_with(".AppImage"));
    }

    #[test]
    fn validate_update_context_rejects_partial_and_unknown_pairs() {
        let cases = [
            (Some(UpdatePlatform::Macos), None),
            (None, Some(UpdateArchitecture::X86_64)),
            (Some(UpdatePlatform::WebNpx), Some(UpdateArchitecture::X86_64)),
            (Some(UpdatePlatform::Macos), Some(UpdateArchitecture::Unknown)),
        ];

        for (platform, architecture) in cases {
            let error = validate_update_context(platform, architecture)
                .expect_err("invalid context should fail");
            assert_eq!(error.code, "invalid_update_context");
            assert_eq!(error.stage, UpdateErrorStage::Check);
            assert!(!error.retryable);
        }
    }

    #[test]
    fn capability_for_executable_path_maps_npx_and_unknown_modes() {
        let npx = capability_for_executable_path(
            false,
            Path::new("/home/test/.openteams/bin/openteams"),
        );
        assert_eq!(npx.platform, UpdatePlatform::WebNpx);
        assert_eq!(npx.method, UpdateMethod::NpxStagedRestart);

        let unknown = capability_for_executable_path(false, Path::new("/tmp/openteams"));
        assert_eq!(unknown.platform, UpdatePlatform::Unknown);
        assert_eq!(unknown.method, UpdateMethod::Unsupported);
    }

    #[test]
    fn action_errors_preserve_stage_specific_statuses() {
        let download = action_update_error(UpdateErrorInfo {
            stage: UpdateErrorStage::Download,
            code: "npx_stage_failed".to_string(),
            message: "download failed".to_string(),
            retryable: true,
        });
        assert_eq!(download.state.download_status, UpdateDownloadStatus::Failed);
        assert_eq!(download.state.install_status, UpdateInstallStatus::Idle);
        assert_eq!(download.state.error.unwrap().code, "npx_stage_failed");

        let restart = action_update_error(UpdateErrorInfo {
            stage: UpdateErrorStage::Restart,
            code: "restart_spawn_failed".to_string(),
            message: "restart failed".to_string(),
            retryable: true,
        });
        assert_eq!(restart.state.download_status, UpdateDownloadStatus::Downloaded);
        assert_eq!(restart.state.install_status, UpdateInstallStatus::Failed);
        assert_eq!(restart.state.error.unwrap().code, "restart_spawn_failed");
    }

    #[test]
    fn legacy_deploy_mode_preserves_frontend_compatibility() {
        assert_eq!(
            legacy_deploy_mode_for_capability(&capability_for_executable_path(
                false,
                Path::new("/home/test/.openteams/bin/openteams"),
            )),
            "npx"
        );
        assert_eq!(
            legacy_deploy_mode_for_capability(&resolve_desktop_capability(
                UpdatePlatform::Macos,
                UpdateArchitecture::Aarch64,
                &release_fixture_with_linux_manifest(),
            )),
            "tauri"
        );
        assert_eq!(
            legacy_deploy_mode_for_capability(&capability_for_executable_path(
                false,
                Path::new("/tmp/openteams"),
            )),
            "unknown"
        );
    }

    #[tokio::test]
    async fn manifest_fetch_failures_degrade_instead_of_failing_version_check() {
        let release = super::GitHubLatestRelease {
            tag_name: "v0.4.8".to_string(),
            html_url: "https://github.com/openteams-lab/openteams/releases/tag/v0.4.8"
                .to_string(),
            body: None,
            published_at: None,
            assets: vec![super::GitHubReleaseAsset {
                name: "latest.json".to_string(),
                browser_download_url: "http://127.0.0.1:9/latest.json".to_string(),
            }],
        };

        let manifest = fetch_manifest_from_release_assets(&release)
            .await
            .expect("manifest fetch should degrade instead of failing");

        assert!(manifest.is_none());
    }

    #[tokio::test]
    async fn signature_fetch_failures_degrade_to_manual_download_capability() {
        let mut release = release_fixture_with_linux_manifest();
        for asset in &mut release.release.assets {
            if asset.name.ends_with(".sig") {
                asset.browser_download_url = "http://127.0.0.1:9/linux.sig".to_string();
            }
        }
        release.signature_contents.clear();

        fetch_signature_for_context(
            &mut release,
            UpdatePlatform::LinuxAppimage,
            UpdateArchitecture::X86_64,
        )
        .await
        .expect("signature fetch should degrade instead of failing");

        let capability = resolve_desktop_capability(
            UpdatePlatform::LinuxAppimage,
            UpdateArchitecture::X86_64,
            &release,
        );

        assert_eq!(capability.method, UpdateMethod::ManualDownload);
        assert!(capability.fallback_url.unwrap().ends_with(".AppImage"));
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
