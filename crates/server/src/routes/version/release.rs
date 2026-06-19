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

    let mut command =
        if should_stage_npx_update_for_restart().map_err(|message| internal_api_error(&message))? {
            build_npx_restart_helper_command(&args, std::process::id())
                .map_err(|message| internal_api_error(&message))?
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
    // command.env(SKIP_BROWSER_ENV, "1");

    // if env::var_os("BACKEND_PORT").is_none()
    //     && env::var_os("PORT").is_none()
    //     && let Some(port) = current_backend_port().await
    // {
    //     command.env("BACKEND_PORT", port.to_string());
    // }

    spawn_detached(&mut command).await.map_err(|error| {
        internal_api_error(&format!(
            "Failed to restart service from '{}' (cwd '{}'): {error}",
            command.as_std().get_program().to_string_lossy(),
            working_dir.display()
        ))
    })?;

    tokio::spawn(async move {
        sleep(PROCESS_EXIT_DELAY).await;
        npx_browser_lifecycle::request_shutdown();
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
