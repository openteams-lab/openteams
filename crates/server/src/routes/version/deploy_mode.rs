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

fn build_npx_restart_helper_command(args: &[OsString], parent_pid: u32) -> Result<Command, String> {
    let prepared = load_prepared_npx_package()?;
    let helper_args = vec![
        OsString::from("--wait-ms=1500"),
        OsString::from(format!("--parent-pid={parent_pid}")),
        OsString::from("--"),
    ];
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
