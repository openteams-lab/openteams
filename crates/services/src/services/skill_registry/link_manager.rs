fn openteams_app_data_dir() -> PathBuf {
    let proj = directories::ProjectDirs::from("ai", "openteams-lab", "openteams")
        .expect("Could not determine data directory");
    proj.data_dir().to_path_buf()
}

fn openteams_skill_data_dir(slug: &str, app_data: &Path) -> PathBuf {
    app_data.join("skills").join(slug)
}

fn marker_path(skill_dir: &Path) -> PathBuf {
    skill_dir.join(".openteams-managed")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LinkKind {
    Symlink,
    #[cfg(windows)]
    Junction,
    CopyWithMarker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LinkConflict {
    Empty,
    ManagedLink,
    UserOwned,
}

fn is_path_inside(target: &Path, base: &Path) -> bool {
    if target
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return false;
    }

    if let (Ok(target), Ok(base)) = (target.canonicalize(), base.canonicalize()) {
        return target.starts_with(base);
    }

    target.starts_with(base)
}

async fn marker_source_is_openteams(path: &Path) -> bool {
    let Ok(content) = tokio::fs::read(marker_path(path)).await else {
        return false;
    };
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&content) else {
        return false;
    };
    json.get("source").and_then(|value| value.as_str()) == Some("openteams")
}

async fn is_openteams_managed_link(path: &Path, app_data: &Path) -> bool {
    let meta = match tokio::fs::symlink_metadata(path).await {
        Ok(meta) => meta,
        Err(_) => return false,
    };

    if meta.file_type().is_symlink() {
        return tokio::fs::read_link(path)
            .await
            .map(|target| is_path_inside(&target, app_data))
            .unwrap_or(false);
    }

    #[cfg(windows)]
    {
        if junction::exists(path).unwrap_or(false) {
            return junction::get_target(path)
                .map(|target| is_path_inside(&target, app_data))
                .unwrap_or(false);
        }
    }

    marker_source_is_openteams(path).await
}

async fn check_link_conflict(path: &Path, app_data: &Path) -> LinkConflict {
    match tokio::fs::symlink_metadata(path).await {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => LinkConflict::Empty,
        Ok(_) if is_openteams_managed_link(path, app_data).await => LinkConflict::ManagedLink,
        Ok(_) => LinkConflict::UserOwned,
        Err(_) => LinkConflict::UserOwned,
    }
}

async fn create_skill_link(
    real_target: &Path,
    agent_link_dir: &Path,
) -> Result<LinkKind, SkillInstallError> {
    if let Some(parent) = agent_link_dir.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    #[cfg(unix)]
    {
        match tokio::fs::symlink(real_target, agent_link_dir).await {
            Ok(_) => return Ok(LinkKind::Symlink),
            Err(err) => {
                tracing::warn!(error = %err, "symlink failed, falling back to copy+marker");
            }
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::symlink_dir;

        match symlink_dir(real_target, agent_link_dir) {
            Ok(_) => return Ok(LinkKind::Symlink),
            Err(err) => {
                tracing::warn!(error = %err, "symlink_dir failed, trying junction");
            }
        }

        match junction::create(real_target, agent_link_dir) {
            Ok(_) => return Ok(LinkKind::Junction),
            Err(err) => {
                tracing::warn!(error = %err, "junction failed, falling back to copy+marker");
            }
        }
    }

    copy_dir_recursive(real_target, agent_link_dir).await?;
    write_marker(agent_link_dir, real_target).await?;
    Ok(LinkKind::CopyWithMarker)
}

async fn remove_skill_link(path: &Path) -> Result<(), SkillInstallError> {
    let meta = match tokio::fs::symlink_metadata(path).await {
        Ok(meta) => meta,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(SkillInstallError::DeleteFailed(err.to_string())),
    };

    if meta.file_type().is_symlink() {
        #[cfg(windows)]
        {
            let points_to_dir = tokio::fs::metadata(path)
                .await
                .map(|metadata| metadata.is_dir())
                .unwrap_or(false);
            if points_to_dir {
                tokio::fs::remove_dir(path)
                    .await
                    .map_err(|err| SkillInstallError::DeleteFailed(err.to_string()))?;
                return Ok(());
            }
        }

        tokio::fs::remove_file(path)
            .await
            .map_err(|err| SkillInstallError::DeleteFailed(err.to_string()))?;
        return Ok(());
    }

    #[cfg(windows)]
    {
        if junction::exists(path).unwrap_or(false) {
            junction::delete(path)
                .map_err(|err| SkillInstallError::DeleteFailed(err.to_string()))?;
            return Ok(());
        }
    }

    if marker_source_is_openteams(path).await {
        tokio::fs::remove_dir_all(path)
            .await
            .map_err(|err| SkillInstallError::DeleteFailed(err.to_string()))?;
    }

    Ok(())
}

fn copy_dir_recursive_sync(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_recursive_sync(&src_path, &dst_path)?;
        } else if file_type.is_file() {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

async fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), SkillInstallError> {
    let src = src.to_path_buf();
    let dst = dst.to_path_buf();
    tokio::task::spawn_blocking(move || copy_dir_recursive_sync(&src, &dst))
        .await
        .map_err(|err| SkillInstallError::SaveFailed(format!("copy task failed: {err}")))?
        .map_err(|err| SkillInstallError::SaveFailed(err.to_string()))
}

async fn write_marker(skill_dir: &Path, real_target: &Path) -> Result<(), SkillInstallError> {
    let content = serde_json::json!({
        "source": "openteams",
        "target": real_target.to_string_lossy(),
    });
    tokio::fs::write(marker_path(skill_dir), content.to_string())
        .await
        .map_err(|err| SkillInstallError::SaveFailed(err.to_string()))
}
