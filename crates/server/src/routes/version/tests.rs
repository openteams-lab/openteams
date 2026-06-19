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
