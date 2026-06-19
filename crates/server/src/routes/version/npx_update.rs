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
