/// Embedded skill files from assets/skills directory
/// This allows installing skills without network access
#[derive(RustEmbed)]
#[folder = "../../assets/skills/"]
struct EmbeddedSkillFiles;

/// Install a remote skill to the local database
pub async fn install_skill_from_registry(
    pool: &SqlitePool,
    skill: &RemoteSkillPackage,
) -> Result<ChatSkill, SkillRegistryError> {
    let create_data = CreateChatSkill {
        name: skill.name.clone(),
        description: Some(skill.description.clone()),
        content: skill.content.clone(),
        trigger_type: Some("always".to_string()),
        trigger_keywords: None,
        enabled: Some(true),
        source: Some("registry".to_string()),
        source_url: skill.source_url.clone(),
        version: Some(skill.version.clone()),
        author: skill.author.clone(),
        tags: Some(skill.tags.clone()),
        category: skill.category.clone(),
        compatible_agents: Some(skill.compatible_agents.clone()),
        download_count: skill.download_count,
    };

    let installed = ChatSkill::create(pool, &create_data, Uuid::new_v4()).await?;
    Ok(installed)
}

/// Install skill files from registry into OpenTeams central app data and link
/// them into selected native agent skill directories.
///
/// Returns the number of downloaded source files.
///
/// Fallback: If remote registry is unavailable, attempts to install from embedded assets.
///
/// # Arguments
/// * `skill` - The skill package to install
/// * `registry_url` - Optional registry URL override
/// * `target_agents` - Optional list of target agent IDs. If None or empty, installs to all agents.
pub async fn install_skill_files_to_global_directory(
    skill: &RemoteSkillPackage,
    registry_url: Option<&str>,
    target_agents: Option<&[String]>,
) -> Result<usize, SkillInstallError> {
    let client = SkillRegistryClient::new(registry_url.map(String::from));

    // Try to get file list from registry
    match client.get_skill_files(&skill.id).await {
        Ok(download_response) => {
            if download_response.files.is_empty() {
                return Err(SkillInstallError::DownloadFailed(format!(
                    "Registry returned zero files for skill: {}",
                    skill.id
                )));
            }

            let home_dir = resolve_home_dir()?;
            let app_data = openteams_app_data_dir();
            let slug = slugify_skill_name(&skill.name);
            let staging_dir = skill_staging_dir(&slug, &app_data);
            let mut files_downloaded = 0;

            let write_result = async {
                tokio::fs::create_dir_all(&staging_dir).await?;
                for file_info in &download_response.files {
                    let relative_path = sanitize_skill_relative_path(&file_info.path)?;
                    let content = client
                        .download_file(&file_info.download_url)
                        .await
                        .map_err(|e| SkillInstallError::DownloadFailed(e.to_string()))?;
                    let file_path = staging_dir.join(&relative_path);
                    if let Some(parent) = file_path.parent() {
                        tokio::fs::create_dir_all(parent).await?;
                    }
                    tokio::fs::write(&file_path, &content)
                        .await
                        .map_err(|e| SkillInstallError::SaveFailed(e.to_string()))?;
                    files_downloaded += 1;
                }
                Ok::<(), SkillInstallError>(())
            }
            .await;

            if let Err(err) = write_result {
                let _ = tokio::fs::remove_dir_all(&staging_dir).await;
                return Err(err);
            }

            let real_data_dir = replace_skill_data_dir(&slug, &staging_dir, &app_data).await?;
            link_skill_data_to_agent_roots(
                &skill.name,
                &real_data_dir,
                &home_dir,
                &app_data,
                target_agents,
            )
            .await?;

            Ok(files_downloaded)
        }
        Err(e) => {
            // Remote registry failed, try embedded assets as fallback
            tracing::warn!(
                skill_id = %skill.id,
                error = %e,
                "Remote registry unavailable, falling back to embedded skill files"
            );

            if has_embedded_skill_files(&skill.name) {
                install_skill_files_from_embedded(skill, target_agents).await
            } else {
                Err(SkillInstallError::DownloadFailed(format!(
                    "Remote registry failed and no embedded files available for skill: {}",
                    skill.name
                )))
            }
        }
    }
}

/// Remove installed skill files from global user directories.
/// Missing paths are ignored.
pub async fn uninstall_skill_files_from_global_directory(
    skill: &ChatSkill,
) -> Result<(), SkillInstallError> {
    let home_dir = resolve_home_dir()?;
    let app_data = openteams_app_data_dir();
    uninstall_skill_files_from_global_directory_at_paths(skill, &home_dir, &app_data).await
}

async fn uninstall_skill_files_from_global_directory_at_paths(
    skill: &ChatSkill,
    home_dir: &Path,
    app_data: &Path,
) -> Result<(), SkillInstallError> {
    let base_roots = global_skill_base_roots(home_dir);
    for identifier in skill_uninstall_identifiers(skill) {
        let relative = sanitize_skill_relative_path(&identifier)?;
        for root in &base_roots {
            let target_dir = root.join(&relative);
            if is_openteams_managed_link(&target_dir, app_data).await {
                remove_skill_link(&target_dir).await?;
            } else {
                tracing::info!(
                    path = %target_dir.display(),
                    "Skipping non-OpenTeams directory during skill uninstall"
                );
            }
        }
    }

    for identifier in skill_uninstall_identifiers(skill) {
        let data_dir = openteams_skill_data_dir(&identifier, app_data);
        match tokio::fs::remove_dir_all(&data_dir).await {
            Ok(_) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => {
                tracing::warn!(
                    path = %data_dir.display(),
                    error = %err,
                    "Failed to remove central skill data dir"
                );
            }
        }
    }

    // Claude slash-command file generated by native installer.
    let command_file = home_dir
        .join(".claude")
        .join("commands")
        .join(format!("{}.md", slugify_skill_name(&skill.name)));
    match tokio::fs::remove_file(&command_file).await {
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => {
            return Err(SkillInstallError::DeleteFailed(format!(
                "{} ({})",
                command_file.display(),
                err
            )));
        }
    }

    Ok(())
}

fn skill_staging_dir(slug: &str, app_data: &Path) -> PathBuf {
    app_data
        .join("skills")
        .join(".staging")
        .join(format!("{}-{}", slug, Uuid::new_v4()))
}

async fn replace_skill_data_dir(
    slug: &str,
    staging_dir: &Path,
    app_data: &Path,
) -> Result<PathBuf, SkillInstallError> {
    let real_data_dir = openteams_skill_data_dir(slug, app_data);
    if let Some(parent) = real_data_dir.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    match tokio::fs::remove_dir_all(&real_data_dir).await {
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(SkillInstallError::DeleteFailed(err.to_string())),
    }

    tokio::fs::rename(staging_dir, &real_data_dir)
        .await
        .map_err(|err| SkillInstallError::SaveFailed(err.to_string()))?;

    Ok(real_data_dir)
}

async fn link_skill_data_to_agent_roots(
    skill_name: &str,
    real_data_dir: &Path,
    home_dir: &Path,
    app_data: &Path,
    target_agents: Option<&[String]>,
) -> Result<(), SkillInstallError> {
    let target_roots = filter_skill_roots_by_agents(home_dir, skill_name, target_agents);

    for root in &target_roots {
        match check_link_conflict(root, app_data).await {
            LinkConflict::Empty => {
                create_skill_link(real_data_dir, root).await?;
            }
            LinkConflict::ManagedLink => {
                remove_skill_link(root).await?;
                create_skill_link(real_data_dir, root).await?;
            }
            LinkConflict::UserOwned => {
                tracing::warn!(
                    path = %root.display(),
                    "Skipping user-owned skill directory during install"
                );
            }
        }
    }

    Ok(())
}

fn resolve_home_dir() -> Result<PathBuf, SkillInstallError> {
    dirs::home_dir().ok_or(SkillInstallError::HomeDirNotFound)
}

fn global_skill_roots(home_dir: &Path, skill_name: &str) -> Vec<PathBuf> {
    let install_dir_name = slugify_skill_name(skill_name);
    global_skill_base_roots(home_dir)
        .into_iter()
        .map(|root| root.join(&install_dir_name))
        .collect()
}

fn global_skill_base_roots(home_dir: &Path) -> Vec<PathBuf> {
    discovery_root_paths(home_dir)
        .into_iter()
        .map(|root| root.path)
        .collect()
}

fn slugify_skill_name(name: &str) -> String {
    name.to_lowercase().replace(' ', "-")
}

fn skill_uninstall_identifiers(skill: &ChatSkill) -> Vec<String> {
    let mut ids = vec![slugify_skill_name(&skill.name)];

    if skill.source.eq_ignore_ascii_case("registry")
        && let Some(url) = skill.source_url.as_deref()
    {
        let candidate = url
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or_default();
        if !candidate.is_empty() && !candidate.contains('/') && !candidate.contains('\\') {
            ids.push(candidate.to_string());
        }
    }

    ids.sort();
    ids.dedup();
    ids
}

fn sanitize_skill_relative_path(path: &str) -> Result<PathBuf, SkillInstallError> {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err(SkillInstallError::InvalidPath(path.to_string()));
    }

    let mut clean = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => continue,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(SkillInstallError::InvalidPath(path.to_string()));
            }
        }
    }

    if clean.as_os_str().is_empty() {
        return Err(SkillInstallError::InvalidPath(path.to_string()));
    }

    Ok(clean)
}

/// Check if a skill from registry is already installed locally
pub async fn is_skill_installed(
    pool: &SqlitePool,
    registry_id: &str,
) -> Result<bool, SkillRegistryError> {
    let skills = ChatSkill::find_by_source(pool, "registry").await?;

    // Check if any skill has a source_url matching this registry_id
    Ok(skills.iter().any(|s| {
        s.source_url
            .as_ref()
            .map(|url| url.ends_with(&format!("/{}", registry_id)))
            .unwrap_or(false)
    }))
}

// ============================================================
// Built-in Skills Functions (from awesome-claude-skills)
// ============================================================

/// Install a built-in skill by ID to the local database
/// Also installs skill files from embedded assets if available
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `skill_id` - The skill ID to install
/// * `target_agents` - Optional list of target agent IDs. If None or empty, installs to all agents.
pub async fn install_builtin_skill(
    pool: &SqlitePool,
    skill_id: &str,
    target_agents: Option<&[String]>,
) -> Result<ChatSkill, SkillRegistryError> {
    let skill = get_builtin_skill(skill_id)
        .ok_or_else(|| SkillRegistryError::SkillNotFound(skill_id.to_string()))?;

    // Try to install skill files from embedded assets
    if has_embedded_skill_files(&skill.name) {
        match install_skill_files_from_embedded(&skill, target_agents).await {
            Ok(count) => {
                tracing::info!(
                    skill_name = %skill.name,
                    files_count = count,
                    "Installed builtin skill files from embedded assets"
                );
            }
            Err(e) => {
                tracing::warn!(
                    skill_name = %skill.name,
                    error = %e,
                    "Failed to install builtin skill files from embedded assets"
                );
            }
        }
    }

    install_skill_from_registry(pool, &skill).await
}

/// Install a skill with full fallback logic:
/// 1. Try remote registry first
/// 2. If remote fails, try builtin skill
/// 3. Install files (remote or embedded)
///
/// Only returns error if skill not found anywhere
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `skill_id` - The skill ID to install
/// * `registry_url` - Optional registry URL override
/// * `target_agents` - Optional list of target agent IDs. If None or empty, installs to all agents.
pub async fn install_skill_with_fallback(
    pool: &SqlitePool,
    skill_id: &str,
    registry_url: Option<&str>,
    target_agents: Option<&[String]>,
) -> Result<ChatSkill, SkillRegistryError> {
    let skill_package = get_skill_with_fallback(registry_url.map(String::from), skill_id)
        .await
        .ok_or_else(|| SkillRegistryError::SkillNotFound(skill_id.to_string()))?;

    // Try to install files with fallback
    match install_skill_files_to_global_directory(&skill_package, registry_url, target_agents).await
    {
        Ok(count) => {
            tracing::info!(
                skill_id = %skill_id,
                files_count = count,
                "Installed skill files"
            );
        }
        Err(e) => {
            tracing::warn!(
                skill_id = %skill_id,
                error = %e,
                "Failed to install skill files, continuing with database install"
            );
        }
    }

    install_skill_from_registry(pool, &skill_package).await
}

// ============================================================
// Embedded Skill Files Functions
// ============================================================

/// Get list of embedded skill files for a given skill name
/// Returns a list of (relative_path, content) pairs
fn get_embedded_skill_files(skill_name: &str) -> Vec<(String, Vec<u8>)> {
    let slug = slugify_skill_name(skill_name);
    let prefix = format!("{}/", slug);

    EmbeddedSkillFiles::iter()
        .filter(|path| path.starts_with(&prefix))
        .filter_map(|path| {
            let file = EmbeddedSkillFiles::get(&path)?;
            Some((path.to_string(), file.data.to_vec()))
        })
        .collect()
}

/// Check if embedded skill files exist for a given skill name
pub fn has_embedded_skill_files(skill_name: &str) -> bool {
    let slug = slugify_skill_name(skill_name);
    let prefix = format!("{}/", slug);
    EmbeddedSkillFiles::iter().any(|path| path.starts_with(&prefix))
}

/// Install skill files from embedded assets to global user directories.
/// This is used as a fallback when the remote registry is unavailable.
///
/// # Arguments
/// * `skill` - The skill package to install
/// * `target_agents` - Optional list of target agent IDs. If None or empty, installs to all agents.
pub async fn install_skill_files_from_embedded(
    skill: &RemoteSkillPackage,
    target_agents: Option<&[String]>,
) -> Result<usize, SkillInstallError> {
    let home_dir = resolve_home_dir()?;
    let app_data = openteams_app_data_dir();
    install_skill_files_from_embedded_at_paths(skill, target_agents, &home_dir, &app_data).await
}

async fn install_skill_files_from_embedded_at_paths(
    skill: &RemoteSkillPackage,
    target_agents: Option<&[String]>,
    home_dir: &Path,
    app_data: &Path,
) -> Result<usize, SkillInstallError> {
    let files = get_embedded_skill_files(&skill.name);

    if files.is_empty() {
        return Err(SkillInstallError::DownloadFailed(format!(
            "No embedded files found for skill: {}",
            skill.name
        )));
    }

    let slug = slugify_skill_name(&skill.name);
    let staging_dir = skill_staging_dir(&slug, app_data);
    let mut files_written = 0;

    let write_result = async {
        tokio::fs::create_dir_all(&staging_dir).await?;
        for (relative_path, content) in &files {
            let sanitized = sanitize_skill_relative_path(
                &relative_path
                    .split('/')
                    .skip(1)
                    .collect::<Vec<_>>()
                    .join("/"),
            )?;
            let file_path = staging_dir.join(&sanitized);
            if let Some(parent) = file_path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(&file_path, content)
                .await
                .map_err(|e| SkillInstallError::SaveFailed(e.to_string()))?;
            files_written += 1;
        }
        Ok::<(), SkillInstallError>(())
    }
    .await;

    if let Err(err) = write_result {
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;
        return Err(err);
    }

    let real_data_dir = replace_skill_data_dir(&slug, &staging_dir, app_data).await?;
    link_skill_data_to_agent_roots(&skill.name, &real_data_dir, home_dir, app_data, target_agents)
        .await?;

    tracing::info!(
        skill_name = %skill.name,
        files_count = files_written,
        "Installed skill files from embedded assets"
    );

    Ok(files_written)
}
