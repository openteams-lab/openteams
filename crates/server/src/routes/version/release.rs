use axum::extract::Query;

pub async fn check_version(
    Query(query): Query<UpdateCheckQuery>,
) -> Result<ResponseJson<CheckApiResponse>, (StatusCode, Json<CheckApiResponse>)> {
    fetch_latest_version(query)
        .await
        .map(|response| ResponseJson(ApiResponse::success(response)))
        .map_err(|error| {
            let status = if error.code == "invalid_update_context" {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::BAD_GATEWAY
            };
            check_api_error(status, error)
        })
}

pub async fn update_npx(
) -> Result<ResponseJson<ActionApiResponse>, (StatusCode, Json<ActionApiResponse>)> {
    if !should_stage_npx_update_for_restart().map_err(|message| {
        action_api_error(
            StatusCode::BAD_GATEWAY,
            update_error(
                UpdateErrorStage::Download,
                "npx_stage_failed",
                &message,
                true,
            ),
        )
    })? {
        return Err(action_api_error(
            StatusCode::BAD_REQUEST,
            update_error(
                UpdateErrorStage::Download,
                "npx_update_unavailable",
                "npx self-update is unavailable in this deployment mode.",
                false,
            ),
        ));
    }

    let prepared_package = prepare_npx_update_package().await.map_err(|message| {
        action_api_error(
            StatusCode::BAD_GATEWAY,
            update_error(
                UpdateErrorStage::Download,
                "npx_stage_failed",
                &format!("Failed to stage npx update: {message}"),
                true,
            ),
        )
    })?;
    let mut command = build_cli_command(&prepared_package.cli_path, "stage-update", &[]);
    let output = run_update_command(&mut command).await?;

    let message = if output.is_empty() {
        "npx update downloaded and staged successfully".to_string()
    } else {
        format!("npx update downloaded and staged successfully: {output}")
    };

    Ok(ResponseJson(ApiResponse::success(UpdateActionResponse {
        success: true,
        message,
        state: UpdateOperationState::npx_staged(),
    })))
}

pub async fn restart_service(
) -> Result<ResponseJson<ActionApiResponse>, (StatusCode, Json<ActionApiResponse>)> {
    let args: Vec<OsString> = env::args_os().skip(1).collect();
    let working_dir = resolve_restart_working_dir();

    let mut command = if should_stage_npx_update_for_restart().map_err(|message| {
        action_api_error(
            StatusCode::BAD_GATEWAY,
            update_error(
                UpdateErrorStage::Restart,
                "restart_spawn_failed",
                &message,
                true,
            ),
        )
    })? {
        build_npx_restart_helper_command(&args, std::process::id()).map_err(|message| {
            action_api_error(
                StatusCode::BAD_GATEWAY,
                update_error(
                    UpdateErrorStage::Restart,
                    "restart_spawn_failed",
                    &message,
                    true,
                ),
            )
        })?
    } else {
        let executable = resolve_restart_executable().map_err(|message| {
            action_api_error(
                StatusCode::BAD_GATEWAY,
                update_error(
                    UpdateErrorStage::Restart,
                    "restart_spawn_failed",
                    &message,
                    true,
                ),
            )
        })?;
        let mut command = Command::new(executable);
        command.args(&args);
        command
    };

    command.stdin(Stdio::null());
    command.stdout(Stdio::null());
    command.stderr(Stdio::null());
    command.current_dir(&working_dir);
    command.envs(env::vars_os());

    spawn_detached(&mut command).await.map_err(|error| {
        action_api_error(
            StatusCode::BAD_GATEWAY,
            update_error(
                UpdateErrorStage::Restart,
                "restart_spawn_failed",
                &format!(
                    "Failed to restart service from '{}' (cwd '{}'): {error}",
                    command.as_std().get_program().to_string_lossy(),
                    working_dir.display()
                ),
                true,
            ),
        )
    })?;

    tokio::spawn(async move {
        sleep(PROCESS_EXIT_DELAY).await;
        npx_browser_lifecycle::request_shutdown();
    });

    Ok(ResponseJson(ApiResponse::success(UpdateActionResponse {
        success: true,
        message: "Service restart scheduled successfully".to_string(),
        state: UpdateOperationState::restart_completed(),
    })))
}

async fn fetch_latest_version(query: UpdateCheckQuery) -> Result<VersionCheckResponse, UpdateErrorInfo> {
    let mut release = ReleaseBundle {
        release: fetch_latest_release().await?,
        manifest: None,
        signature_contents: HashMap::new(),
    };
    let current_version = normalize_version(APP_VERSION).map_err(|error| {
        update_error(
            UpdateErrorStage::Check,
            "release_check_failed",
            &error,
            true,
        )
    })?;
    let latest_version = normalize_version(&release.release.tag_name).map_err(|error| {
        update_error(
            UpdateErrorStage::Check,
            "release_check_failed",
            &error,
            true,
        )
    })?;

    let capability = match validate_update_context(query.platform, query.architecture)? {
        None => capability_for_backend_executable()?,
        Some(context) => {
            release.manifest = fetch_manifest_from_release_assets(&release.release).await?;
            fetch_signature_for_context(&mut release, context.platform, context.architecture).await?;
            resolve_desktop_capability(context.platform, context.architecture, &release)
        }
    };

    Ok(VersionCheckResponse {
        current_version: current_version.to_string(),
        latest_version: latest_version.to_string(),
        has_update: latest_version > current_version,
        deploy_mode: legacy_deploy_mode_for_capability(&capability).to_string(),
        release_url: release.release.html_url,
        release_notes: release.release.body.filter(|body| !body.trim().is_empty()),
        published_at: release.release.published_at,
        capability,
    })
}

async fn fetch_latest_release() -> Result<GitHubLatestRelease, UpdateErrorInfo> {
    if let Some(mock_release) = mock_latest_release_from_env().map_err(|message| {
        update_error(
            UpdateErrorStage::Check,
            "release_check_failed",
            &message,
            true,
        )
    })? {
        Ok(mock_release)
    } else {
        fetch_json::<GitHubLatestRelease>(GITHUB_LATEST_RELEASE_URL)
            .await
            .map_err(|message| {
                update_error(
                    UpdateErrorStage::Check,
                    "release_check_failed",
                    &message,
                    true,
                )
            })
    }
}

async fn fetch_manifest_from_release_assets(
    release: &GitHubLatestRelease,
) -> Result<Option<TauriManifest>, UpdateErrorInfo> {
    let Some(url) = release
        .assets
        .iter()
        .find(|asset| asset.name == "latest.json")
        .map(|asset| asset.browser_download_url.clone())
    else {
        return Ok(None);
    };

    match fetch_json::<TauriManifest>(&url).await {
        Ok(manifest) => Ok(Some(manifest)),
        Err(_) => Ok(None),
    }
}

async fn fetch_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {error}"))?
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            format!("OpenTeams/{}", APP_VERSION),
        )
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("Failed to request latest release data: {error}"))?
        .error_for_status()
        .map_err(|error| format!("GitHub release request returned an error: {error}"))?
        .json::<T>()
        .await
        .map_err(|error| format!("Failed to parse GitHub release payload: {error}"))
}

async fn fetch_text(url: &str) -> Result<String, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {error}"))?
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            format!("OpenTeams/{}", APP_VERSION),
        )
        .send()
        .await
        .map_err(|error| format!("Failed to request release signature: {error}"))?
        .error_for_status()
        .map_err(|error| format!("GitHub signature request returned an error: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Failed to read signature response body: {error}"))
}

fn validate_update_context(
    platform: Option<UpdatePlatform>,
    architecture: Option<UpdateArchitecture>,
) -> Result<Option<DesktopUpdateContext>, UpdateErrorInfo> {
    match (platform, architecture) {
        (None, None) => Ok(None),
        (
            Some(
                platform @ (UpdatePlatform::Macos
                | UpdatePlatform::LinuxAppimage
                | UpdatePlatform::LinuxDeb
                | UpdatePlatform::Windows),
            ),
            Some(
                architecture @ (UpdateArchitecture::Aarch64
                | UpdateArchitecture::X86_64
                | UpdateArchitecture::I686),
            ),
        ) => Ok(Some(DesktopUpdateContext {
            platform,
            architecture,
        })),
        _ => Err(update_error(
            UpdateErrorStage::Check,
            "invalid_update_context",
            "Platform and architecture must be supplied together and must identify a supported desktop package.",
            false,
        )),
    }
}

async fn fetch_signature_for_context(
    release: &mut ReleaseBundle,
    platform: UpdatePlatform,
    architecture: UpdateArchitecture,
) -> Result<(), UpdateErrorInfo> {
    let Some(manifest) = release.manifest.as_ref() else {
        return Ok(());
    };
    let Some(platform_key) = manifest_platform_key(platform, architecture) else {
        return Ok(());
    };
    let Some(entry) = manifest.platforms.get(&platform_key) else {
        return Ok(());
    };
    let Some(archive_asset) = release_asset_by_url(&release.release.assets, &entry.url) else {
        return Ok(());
    };

    let signature_name = format!("{}.sig", archive_asset.name);
    if release.signature_contents.contains_key(&signature_name) {
        return Ok(());
    }

    let Some(signature_asset) = release
        .release
        .assets
        .iter()
        .find(|asset| asset.name == signature_name)
    else {
        return Ok(());
    };

    if let Ok(signature) = fetch_text(&signature_asset.browser_download_url).await {
        release
            .signature_contents
            .insert(signature_name, signature.trim().to_string());
    }
    Ok(())
}

fn resolve_desktop_capability(
    platform: UpdatePlatform,
    architecture: UpdateArchitecture,
    release: &ReleaseBundle,
) -> UpdateCapability {
    let release_url = release.release.html_url.clone();
    let fallback_url = manual_fallback_url(platform, architecture, release)
        .unwrap_or_else(|| release_url.clone());
    let has_direct_download = fallback_url != release_url;

    match platform {
        UpdatePlatform::LinuxDeb => UpdateCapability {
            platform,
            method: UpdateMethod::ManualDownload,
            can_download: has_direct_download,
            can_install: false,
            requires_restart: false,
            fallback_url: Some(fallback_url),
        },
        UpdatePlatform::Macos | UpdatePlatform::LinuxAppimage | UpdatePlatform::Windows => {
            if has_valid_updater_manifest_entry(platform, architecture, release) {
                UpdateCapability {
                    platform,
                    method: UpdateMethod::TauriUpdater,
                    can_download: true,
                    can_install: true,
                    requires_restart: true,
                    fallback_url: Some(fallback_url),
                }
            } else {
                UpdateCapability {
                    platform,
                    method: UpdateMethod::ManualDownload,
                    can_download: has_direct_download,
                    can_install: false,
                    requires_restart: false,
                    fallback_url: Some(fallback_url),
                }
            }
        }
        _ => UpdateCapability {
            platform: UpdatePlatform::Unknown,
            method: UpdateMethod::Unsupported,
            can_download: false,
            can_install: false,
            requires_restart: false,
            fallback_url: None,
        },
    }
}

fn has_valid_updater_manifest_entry(
    platform: UpdatePlatform,
    architecture: UpdateArchitecture,
    release: &ReleaseBundle,
) -> bool {
    let Some(manifest) = release.manifest.as_ref() else {
        return false;
    };
    let Ok(manifest_version) = normalize_version(&manifest.version) else {
        return false;
    };
    let Ok(release_version) = normalize_version(&release.release.tag_name) else {
        return false;
    };
    if manifest_version != release_version {
        return false;
    }

    let Some(platform_key) = manifest_platform_key(platform, architecture) else {
        return false;
    };
    let Some(entry) = manifest.platforms.get(&platform_key) else {
        return false;
    };
    let signature = entry.signature.trim();
    if signature.is_empty() {
        return false;
    }

    let Some(archive_asset) = release_asset_by_url(&release.release.assets, &entry.url) else {
        return false;
    };
    let expected_extension = updater_archive_extension(platform);
    if !archive_asset.name.ends_with(expected_extension) {
        return false;
    }

    let signature_name = format!("{}.sig", archive_asset.name);
    let Some(signature_asset) = release
        .release
        .assets
        .iter()
        .find(|asset| asset.name == signature_name)
    else {
        return false;
    };
    let Some(downloaded_signature) = release.signature_contents.get(&signature_asset.name) else {
        return false;
    };

    !downloaded_signature.trim().is_empty() && downloaded_signature.trim() == signature
}

fn manual_fallback_url(
    platform: UpdatePlatform,
    architecture: UpdateArchitecture,
    release: &ReleaseBundle,
) -> Option<String> {
    let candidates = match platform {
        UpdatePlatform::Macos => &[".dmg", ".app.tar.gz"][..],
        UpdatePlatform::LinuxAppimage => &[".AppImage"][..],
        UpdatePlatform::LinuxDeb => &[".deb"][..],
        UpdatePlatform::Windows => &[".msi", ".msi.zip"][..],
        _ => &[][..],
    };

    for extension in candidates {
        if let Some(asset) = release.release.assets.iter().find(|asset| {
            asset.name.ends_with(extension) && asset_matches_architecture(&asset.name, architecture)
        }) {
            return Some(asset.browser_download_url.clone());
        }
    }

    None
}

fn updater_archive_extension(platform: UpdatePlatform) -> &'static str {
    match platform {
        UpdatePlatform::Macos => ".app.tar.gz",
        UpdatePlatform::LinuxAppimage => ".AppImage.tar.gz",
        UpdatePlatform::Windows => ".msi.zip",
        _ => "",
    }
}

fn manifest_platform_key(
    platform: UpdatePlatform,
    architecture: UpdateArchitecture,
) -> Option<String> {
    let architecture = match architecture {
        UpdateArchitecture::Aarch64 => "aarch64",
        UpdateArchitecture::X86_64 => "x86_64",
        UpdateArchitecture::I686 => "i686",
        UpdateArchitecture::Unknown => return None,
    };

    let prefix = match platform {
        UpdatePlatform::Macos => "darwin",
        UpdatePlatform::LinuxAppimage | UpdatePlatform::LinuxDeb => "linux",
        UpdatePlatform::Windows => "windows",
        _ => return None,
    };

    Some(format!("{prefix}-{architecture}"))
}

fn release_asset_by_url<'a>(
    assets: &'a [GitHubReleaseAsset],
    url: &str,
) -> Option<&'a GitHubReleaseAsset> {
    assets.iter().find(|asset| asset.browser_download_url == url)
}

fn architecture_aliases(architecture: UpdateArchitecture) -> &'static [&'static str] {
    match architecture {
        UpdateArchitecture::Aarch64 => &["aarch64", "arm64"],
        UpdateArchitecture::X86_64 => &["x86_64", "amd64", "x64"],
        UpdateArchitecture::I686 => &["i686", "i386"],
        UpdateArchitecture::Unknown => &[],
    }
}

fn asset_matches_architecture(name: &str, architecture: UpdateArchitecture) -> bool {
    let lower = name.to_ascii_lowercase();
    architecture_aliases(architecture)
        .iter()
        .any(|alias| {
            lower.match_indices(alias).any(|(start, _)| {
                let before = lower[..start].chars().next_back();
                let end = start + alias.len();
                let after = lower[end..].chars().next();
                let boundary =
                    |value: Option<char>| value.is_none_or(|character| matches!(character, '-' | '_' | '.'));
                boundary(before) && boundary(after)
            })
        })
}

#[cfg(test)]
fn release_fixture_with_linux_manifest() -> ReleaseBundle {
    let tag = "v0.4.8";
    let archive_name = "openteams-0.4.8-x86_64.AppImage.tar.gz";
    let raw_name = "openteams-0.4.8-x86_64.AppImage";
    let deb_name = "openteams_0.4.8_amd64-linux.deb";
    let base = format!("https://github.com/openteams-lab/openteams/releases/download/{tag}");

    ReleaseBundle {
        release: GitHubLatestRelease {
            tag_name: tag.to_string(),
            html_url: format!("https://github.com/openteams-lab/openteams/releases/tag/{tag}"),
            body: Some("release notes".to_string()),
            published_at: Some("2026-07-13T00:00:00Z".to_string()),
            assets: vec![
                GitHubReleaseAsset {
                    name: "latest.json".to_string(),
                    browser_download_url: format!("{base}/latest.json"),
                },
                GitHubReleaseAsset {
                    name: archive_name.to_string(),
                    browser_download_url: format!("{base}/{archive_name}"),
                },
                GitHubReleaseAsset {
                    name: format!("{archive_name}.sig"),
                    browser_download_url: format!("{base}/{archive_name}.sig"),
                },
                GitHubReleaseAsset {
                    name: raw_name.to_string(),
                    browser_download_url: format!("{base}/{raw_name}"),
                },
                GitHubReleaseAsset {
                    name: deb_name.to_string(),
                    browser_download_url: format!("{base}/{deb_name}"),
                },
            ],
        },
        manifest: Some(TauriManifest {
            version: tag.to_string(),
            platforms: HashMap::from([(
                "linux-x86_64".to_string(),
                TauriManifestEntry {
                    signature: "linux-signature".to_string(),
                    url: format!("{base}/{archive_name}"),
                },
            )]),
        }),
        signature_contents: HashMap::from([(
            format!("{archive_name}.sig"),
            "linux-signature".to_string(),
        )]),
    }
}
