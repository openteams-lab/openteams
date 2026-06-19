async fn run_update_command(
    command: &mut Command,
) -> Result<String, (StatusCode, Json<ApiResponse<()>>)> {
    let output = command
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| internal_api_error(&format!("Failed to start update command: {error}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format_command_output(&stdout, &stderr);

    if output.status.success() {
        Ok(combined)
    } else {
        Err(internal_api_error(&format!(
            "update command failed{}",
            if combined.is_empty() {
                String::new()
            } else {
                format!(": {combined}")
            }
        )))
    }
}

fn format_command_output(stdout: &str, stderr: &str) -> String {
    let mut parts = Vec::new();

    let stdout = compact_command_output(stdout);
    if !stdout.is_empty() {
        parts.push(format!("stdout:\n{stdout}"));
    }

    let stderr = compact_command_output(stderr);
    if !stderr.is_empty() {
        parts.push(format!("stderr:\n{stderr}"));
    }

    parts.join("\n\n")
}

fn compact_command_output(stream: &str) -> String {
    let normalized = stream.replace("\r\n", "\n").replace('\r', "\n");
    let mut compacted = Vec::new();
    let mut current_line: Option<String> = None;
    let mut current_count = 0usize;
    let mut last_progress_line: Option<String> = None;
    let mut progress_count = 0usize;

    for raw_line in normalized.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        if is_progress_line(line) {
            flush_repeated_line(&mut compacted, &mut current_line, &mut current_count);
            last_progress_line = Some(line.to_string());
            progress_count += 1;
            continue;
        }

        flush_progress_block(&mut compacted, &mut last_progress_line, &mut progress_count);

        match current_line.as_deref() {
            Some(existing) if existing == line => {
                current_count += 1;
            }
            _ => {
                flush_repeated_line(&mut compacted, &mut current_line, &mut current_count);
                current_line = Some(line.to_string());
                current_count = 1;
            }
        }
    }

    flush_progress_block(&mut compacted, &mut last_progress_line, &mut progress_count);
    flush_repeated_line(&mut compacted, &mut current_line, &mut current_count);

    compacted.join("\n")
}

fn flush_repeated_line(output: &mut Vec<String>, line: &mut Option<String>, count: &mut usize) {
    let Some(current) = line.take() else {
        *count = 0;
        return;
    };

    if *count > 1 {
        output.push(format!("{current} [repeated {} times]", *count));
    } else {
        output.push(current);
    }

    *count = 0;
}

fn flush_progress_block(
    output: &mut Vec<String>,
    last_progress_line: &mut Option<String>,
    progress_count: &mut usize,
) {
    let Some(last_line) = last_progress_line.take() else {
        *progress_count = 0;
        return;
    };

    if *progress_count > 1 {
        output.push(format!(
            "{last_line} [progress condensed from {} lines]",
            *progress_count
        ));
    } else {
        output.push(last_line);
    }

    *progress_count = 0;
}

fn is_progress_line(line: &str) -> bool {
    line.starts_with("Downloading:")
}

// async fn current_backend_port() -> Option<u16> {
//     if let Ok(port) = env::var("BACKEND_PORT")
//         && let Ok(port) = port.trim().parse::<u16>()
//     {
//         return Some(port);
//     }

//     if let Ok(port) = env::var("PORT")
//         && let Ok(port) = port.trim().parse::<u16>()
//     {
//         return Some(port);
//     }

//     read_port_file("openteams").await.ok()
// }

#[cfg(unix)]
async fn spawn_detached(command: &mut Command) -> std::io::Result<()> {
    command.spawn().map(|_| ())
}

#[cfg(windows)]
async fn spawn_detached(command: &mut Command) -> std::io::Result<()> {
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

    command
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map(|_| ())
}

fn npm_command() -> &'static str {
    if cfg!(windows) { "npm.cmd" } else { "npm" }
}

fn node_command() -> &'static str {
    "node"
}

fn internal_api_error(message: &str) -> (StatusCode, Json<ApiResponse<()>>) {
    (StatusCode::BAD_GATEWAY, Json(ApiResponse::error(message)))
}
