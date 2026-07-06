use std::{
    collections::{BTreeSet, HashSet},
    io,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use async_trait::async_trait;
use command_group::{AsyncCommandGroup, AsyncGroupChild};
use derivative::Derivative;
use futures::StreamExt;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use tokio::{io::AsyncBufReadExt, process::Command};
use ts_rs::TS;
use workspace_utils::msg_store::MsgStore;

use crate::{
    approvals::ExecutorApprovalService,
    command::{CmdOverrides, CommandBuildError, CommandBuilder, apply_overrides},
    env::ExecutionEnv,
    executors::{
        AppendPrompt, AvailabilityInfo, ExecutorError, ExecutorExitResult, SpawnedChild,
        StandardCodingAgentExecutor, opencode::types::OpencodeExecutorEvent,
    },
    logs::utils::patch,
    skill_config::NativeSkillConfigBackend,
    stdout_dup::create_stdout_pipe_writer,
};

mod models;
mod normalize_logs;
mod sdk;
mod slash_commands;
mod types;

use sdk::{
    LogWriter, ProviderInfo, ProviderListResponse, RunConfig, build_default_headers,
    generate_server_password, list_providers, run_session, run_slash_command, wait_for_health,
};
use slash_commands::{OpencodeSlashCommand, hardcoded_slash_commands};

#[derive(Derivative, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[derivative(Debug, PartialEq)]
pub struct Opencode {
    #[serde(default)]
    pub append_prompt: AppendPrompt,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "mode")]
    pub agent: Option<String>,
    /// Auto-approve agent actions
    #[serde(default = "default_to_true")]
    pub auto_approve: bool,
    /// Enable auto-compaction when the context length approaches the model's context window limit
    #[serde(default = "default_to_true")]
    pub auto_compact: bool,
    #[serde(flatten)]
    pub cmd: CmdOverrides,
    #[serde(skip)]
    #[ts(skip)]
    #[derivative(Debug = "ignore", PartialEq = "ignore")]
    pub approvals: Option<Arc<dyn ExecutorApprovalService>>,
}

/// Represents a spawned OpenCode server with its base URL
struct OpencodeServer {
    #[allow(unused)]
    child: Option<AsyncGroupChild>,
    base_url: String,
    server_password: ServerPassword,
    startup_command: String,
    stderr_lines: Arc<tokio::sync::Mutex<Vec<String>>>,
    stderr_task: Option<tokio::task::JoinHandle<()>>,
}

impl Drop for OpencodeServer {
    fn drop(&mut self) {
        if let Some(task) = self.stderr_task.take() {
            task.abort();
        }
        // kill the process properly using the kill helper as the native kill_on_drop doesn't work reliably causing orphaned processes and memory leaks
        if let Some(mut child) = self.child.take() {
            tokio::spawn(async move {
                let _ = workspace_utils::process::kill_process_group(&mut child).await;
            });
        }
    }
}

impl OpencodeServer {
    async fn stderr_tail(&self) -> String {
        let lines = self.stderr_lines.lock().await;
        format_server_log_tail(&lines)
    }

    async fn shutdown(mut self) {
        if let Some(mut child) = self.child.take() {
            if let Err(err) = workspace_utils::process::kill_process_group(&mut child).await {
                tracing::warn!("Failed to stop OpenCode discovery server: {}", err);
            }
        }
        if let Some(task) = self.stderr_task.take() {
            let _ = tokio::time::timeout(Duration::from_millis(800), task).await;
        }
    }
}

type ServerPassword = String;
const MAX_SERVER_LOG_LINES: usize = 200;

impl Opencode {
    const PACKAGE_VERSION: &'static str = "1.17.8";
    const BASE_COMMAND: &'static str = "npx -y opencode-ai@1.17.8";

    fn build_command_builder(&self) -> Result<CommandBuilder, CommandBuildError> {
        let builder = CommandBuilder::new(Self::BASE_COMMAND)
            // Pass hostname/port as separate args so OpenCode treats them as explicitly set
            // (it checks `process.argv.includes(\"--port\")` / `\"--hostname\"`).
            .extend_params(["serve", "--hostname", "127.0.0.1", "--port", "0"]);
        apply_overrides(builder, &self.cmd)
    }

    /// Compute a cache key for model context windows based on configuration that can affect the list of available models.
    fn compute_models_cache_key(&self) -> String {
        serde_json::json!({
            "cmd": &self.cmd,
            "opencode_version": Self::PACKAGE_VERSION,
        })
        .to_string()
    }

    pub async fn list_models(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<Vec<String>, ExecutorError> {
        let server = self.spawn_server(current_dir, env).await?;
        let directory = current_dir.to_string_lossy().to_string();

        let result = async {
            let client = reqwest::Client::builder()
                .default_headers(build_default_headers(&directory, &server.server_password))
                .build()
                .map_err(|err| ExecutorError::Io(io::Error::other(err)))?;
            let version = wait_for_health(&client, &server.base_url).await?;
            sdk::ensure_expected_version(&version, Self::PACKAGE_VERSION)?;
            let providers = list_providers(&client, &server.base_url, &directory).await?;
            Ok(collect_configured_models(&providers))
        }
        .await;

        let result = match result {
            Ok(models) => Ok(models),
            Err(err) => {
                let server_logs = server.stderr_tail().await;
                tracing::error!(
                    error = %err,
                    opencode_startup_command = %server.startup_command,
                    opencode_server_logs = %server_logs,
                    "OpenCode model discovery failed"
                );
                Err(opencode_server_error(
                    err,
                    &server.startup_command,
                    &server_logs,
                ))
            }
        };

        server.shutdown().await;
        result
    }

    /// Common boilerplate for spawning an OpenCode server process.
    async fn spawn_server_process(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<(AsyncGroupChild, ServerPassword, String), ExecutorError> {
        let command_parts = self.build_command_builder()?.build_initial()?;
        let (program_path, args) = command_parts.into_resolved().await?;

        let server_password = generate_server_password();
        let startup_command = format_command_for_log(&program_path, &args);
        tracing::info!(
            opencode_startup_command = %startup_command,
            current_dir = %current_dir.display(),
            "Starting OpenCode server process"
        );

        let mut command = Command::new(program_path);
        command
            .kill_on_drop(true)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .current_dir(current_dir)
            .env("NPM_CONFIG_LOGLEVEL", "error")
            .env("NODE_NO_WARNINGS", "1")
            .env("NO_COLOR", "1")
            .env("OPENCODE_SERVER_USERNAME", "opencode")
            .env("OPENCODE_SERVER_PASSWORD", &server_password)
            .args(&args);

        env.clone()
            .with_profile(&self.cmd)
            .apply_to_command(&mut command);
        apply_isolated_opencode_env(&mut command, current_dir, Self::PACKAGE_VERSION)?;

        let child = command.group_spawn()?;

        Ok((child, server_password, startup_command))
    }

    /// Handles process spawning, waiting for the server URL
    async fn spawn_server(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<OpencodeServer, ExecutorError> {
        let (mut child, server_password, startup_command) =
            self.spawn_server_process(current_dir, env).await?;
        let server_stdout = child.inner().stdout.take().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other("OpenCode server missing stdout"))
        })?;
        let (stderr_lines, stderr_task) = collect_server_stderr(child.inner().stderr.take());

        let base_url = match wait_for_server_url(server_stdout, None).await {
            Ok(base_url) => base_url,
            Err(err) => {
                let server_logs = {
                    let lines = stderr_lines.lock().await;
                    format_server_log_tail(&lines)
                };
                if let Some(task) = stderr_task {
                    task.abort();
                }
                return Err(opencode_server_error(err, &startup_command, &server_logs));
            }
        };

        Ok(OpencodeServer {
            child: Some(child),
            base_url,
            server_password,
            startup_command,
            stderr_lines,
            stderr_task,
        })
    }

    async fn spawn_inner(
        &self,
        current_dir: &Path,
        prompt: &str,
        resume_session: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let slash_command = OpencodeSlashCommand::parse(prompt);
        let combined_prompt = if slash_command.is_some() {
            prompt.to_string()
        } else {
            self.append_prompt.combine_prompt(prompt)
        };

        let (mut child, server_password, _startup_command) =
            self.spawn_server_process(current_dir, env).await?;
        let server_stdout = child.inner().stdout.take().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other("OpenCode server missing stdout"))
        })?;

        let stdout = create_stdout_pipe_writer(&mut child)?;
        let log_writer = LogWriter::new(stdout);

        let (exit_signal_tx, exit_signal_rx) = tokio::sync::oneshot::channel();
        let cancel = tokio_util::sync::CancellationToken::new();

        // Prepare config values that will be moved into the spawned task
        let directory = current_dir.to_string_lossy().to_string();
        let approvals = if self.auto_approve {
            None
        } else {
            self.approvals.clone()
        };
        let model = self.model.clone();
        let model_variant = self.variant.clone();
        let agent = self.agent.clone();
        let auto_approve = self.auto_approve;
        let resume_session_id = resume_session.map(|s| s.to_string());
        let models_cache_key = self.compute_models_cache_key();
        let cancel_for_task = cancel.clone();
        let commit_reminder = env.commit_reminder;
        let commit_reminder_prompt = env.commit_reminder_prompt.clone();
        let repo_context = env.repo_context.clone();

        tokio::spawn(async move {
            // Wait for server to print listening URL
            let base_url = match wait_for_server_url(server_stdout, Some(log_writer.clone())).await
            {
                Ok(url) => url,
                Err(err) => {
                    let _ = log_writer
                        .log_error(format!("OpenCode startup error: {err}"))
                        .await;
                    let _ = exit_signal_tx.send(ExecutorExitResult::Failure);
                    return;
                }
            };

            let config = RunConfig {
                base_url,
                directory,
                prompt: combined_prompt,
                resume_session_id,
                model,
                model_variant,
                agent,
                approvals,
                auto_approve,
                server_password,
                expected_version: Self::PACKAGE_VERSION.to_string(),
                models_cache_key,
                commit_reminder,
                commit_reminder_prompt,
                repo_context,
            };

            let result = match slash_command {
                Some(command) => {
                    run_slash_command(config, log_writer.clone(), command, cancel_for_task).await
                }
                None => run_session(config, log_writer.clone(), cancel_for_task).await,
            };
            let exit_result = match result {
                Ok(()) => ExecutorExitResult::Success,
                Err(err) => {
                    let _ = log_writer
                        .log_error(format!("OpenCode executor error: {err}"))
                        .await;
                    ExecutorExitResult::Failure
                }
            };
            let _ = exit_signal_tx.send(exit_result);
        });

        Ok(SpawnedChild {
            child,
            exit_signal: Some(exit_signal_rx),
            cancel: Some(cancel),
        })
    }
}

fn collect_server_stderr(
    stderr: Option<tokio::process::ChildStderr>,
) -> (
    Arc<tokio::sync::Mutex<Vec<String>>>,
    Option<tokio::task::JoinHandle<()>>,
) {
    let lines = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let Some(stderr) = stderr else {
        return (lines, None);
    };

    let task_lines = Arc::clone(&lines);
    let task = tokio::spawn(async move {
        let mut stderr_lines = tokio::io::BufReader::new(stderr).lines();
        loop {
            match stderr_lines.next_line().await {
                Ok(Some(line)) => {
                    tracing::debug!(line = %line, "OpenCode server stderr");
                    let mut captured = task_lines.lock().await;
                    captured.push(line);
                    if captured.len() > MAX_SERVER_LOG_LINES {
                        let excess = captured.len() - MAX_SERVER_LOG_LINES;
                        captured.drain(0..excess);
                    }
                }
                Ok(None) => break,
                Err(err) => {
                    tracing::debug!("Failed to read OpenCode server stderr: {err}");
                    break;
                }
            }
        }
    });

    (lines, Some(task))
}

fn apply_isolated_opencode_env(
    command: &mut Command,
    current_dir: &Path,
    package_version: &str,
) -> io::Result<()> {
    let runtime_root = openteams_home_dir()?
        .join("opencode")
        .join(format!(
            "opencode-ai-{}",
            sanitize_path_segment(package_version)
        ))
        .join(workspace_runtime_key(current_dir));
    let data_home = runtime_root.join("data");
    let state_home = runtime_root.join("state");
    let opencode_data_dir = data_home.join("opencode");

    std::fs::create_dir_all(&opencode_data_dir)?;
    std::fs::create_dir_all(&state_home)?;
    mirror_user_opencode_auth(&opencode_data_dir)?;

    command
        .env("XDG_DATA_HOME", data_home)
        .env("XDG_STATE_HOME", state_home);
    Ok(())
}

fn openteams_home_dir() -> io::Result<PathBuf> {
    dirs::home_dir()
        .map(|home| home.join(".openteams"))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "home directory not found"))
}

fn workspace_runtime_key(current_dir: &Path) -> String {
    let canonical =
        std::fs::canonicalize(current_dir).unwrap_or_else(|_| current_dir.to_path_buf());
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    let digest = hasher.finalize();
    format!("{:x}", digest)[..16].to_string()
}

fn mirror_user_opencode_auth(isolated_opencode_data_dir: &Path) -> io::Result<()> {
    let Some(source_auth) = user_opencode_auth_path() else {
        return Ok(());
    };
    if !source_auth.exists() {
        return Ok(());
    }

    let target_auth = isolated_opencode_data_dir.join("auth.json");
    if source_auth == target_auth {
        return Ok(());
    }

    let _ = std::fs::remove_file(&target_auth);
    symlink_or_copy_file(&source_auth, &target_auth)
}

fn user_opencode_auth_path() -> Option<PathBuf> {
    #[cfg(not(windows))]
    {
        let base_dirs = xdg::BaseDirectories::with_prefix("opencode");
        base_dirs.get_data_home().map(|data| data.join("auth.json"))
    }
    #[cfg(windows)]
    {
        std::env::var("XDG_DATA_HOME")
            .ok()
            .map(PathBuf::from)
            .or_else(|| dirs::data_local_dir())
            .map(|data| data.join("opencode").join("auth.json"))
    }
}

fn symlink_or_copy_file(source: &Path, target: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        if std::os::unix::fs::symlink(source, target).is_ok() {
            return Ok(());
        }
    }
    #[cfg(windows)]
    {
        if std::os::windows::fs::symlink_file(source, target).is_ok() {
            return Ok(());
        }
    }

    std::fs::copy(source, target).map(|_| ())
}

fn sanitize_path_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn format_server_log_tail(captured: &[String]) -> String {
    captured
        .iter()
        .rev()
        .take(80)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join("\n")
}

fn opencode_server_error(
    err: ExecutorError,
    startup_command: &str,
    server_logs: &str,
) -> ExecutorError {
    let mut message = format!("{err}\nOpenCode startup command:\n{startup_command}");
    if !server_logs.trim().is_empty() {
        message.push_str("\nOpenCode server logs:\n");
        message.push_str(server_logs);
    }
    ExecutorError::Io(io::Error::other(message))
}

fn format_command_for_log(program: &PathBuf, args: &[String]) -> String {
    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push(quote_command_part(&program.display().to_string()));

    let mut redact_next = false;
    for arg in args {
        let formatted = if redact_next {
            redact_next = false;
            "<redacted>".to_string()
        } else if let Some(redacted) = redact_sensitive_arg(arg) {
            if !arg.contains('=') {
                redact_next = true;
            }
            redacted
        } else {
            arg.clone()
        };
        parts.push(quote_command_part(&formatted));
    }

    parts.join(" ")
}

fn redact_sensitive_arg(arg: &str) -> Option<String> {
    let lower = arg.to_ascii_lowercase();
    let is_sensitive =
        lower.contains("key") || lower.contains("token") || lower.contains("password");
    if !is_sensitive {
        return None;
    }

    match arg.split_once('=') {
        Some((name, _value)) => Some(format!("{name}=<redacted>")),
        None => Some(arg.to_string()),
    }
}

fn quote_command_part(value: &str) -> String {
    if value.is_empty()
        || value
            .chars()
            .any(|ch| ch.is_whitespace() || matches!(ch, '"' | '\''))
    {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

fn collect_configured_models(provider_list: &ProviderListResponse) -> Vec<String> {
    let connected: HashSet<_> = provider_list.connected.iter().map(String::as_str).collect();
    let mut models = BTreeSet::new();

    for provider in &provider_list.all {
        if !connected.contains(provider.id.as_str()) || !is_configured_provider(provider) {
            continue;
        }

        for model_id in provider.models.keys() {
            if let Some(model) = model_from_provider(&provider.id, model_id) {
                models.insert(model);
            }
        }
    }

    models.into_iter().collect()
}

fn is_configured_provider(provider: &ProviderInfo) -> bool {
    if provider_has_api_key(provider) {
        return true;
    }

    match provider.source.as_deref() {
        Some("api" | "env" | "custom") => true,
        // Config-only built-in providers still appear as connected in OpenCode,
        // but without a key they are not usable. Custom config providers often
        // have no built-in env metadata, so keep those.
        Some("config") => provider.env.is_empty(),
        _ => false,
    }
}

fn provider_has_api_key(provider: &ProviderInfo) -> bool {
    provider.key.as_deref().is_some_and(has_secret_value)
        || string_option(&provider.options, "apiKey").is_some_and(has_secret_value)
        || string_option(&provider.options, "api_key").is_some_and(has_secret_value)
}

fn string_option<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
}

fn has_secret_value(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && !trimmed.contains("***")
}

fn model_from_provider(provider_id: &str, model_id: &str) -> Option<String> {
    let provider_id = provider_id.trim();
    let model_id = model_id.trim();
    if provider_id.is_empty() || model_id.is_empty() {
        return None;
    }
    Some(format!("{provider_id}/{model_id}"))
}

fn format_tail(captured: Vec<String>) -> String {
    captured
        .into_iter()
        .rev()
        .take(12)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

async fn wait_for_server_url(
    stdout: tokio::process::ChildStdout,
    log_writer: Option<LogWriter>,
) -> Result<String, ExecutorError> {
    let mut lines = tokio::io::BufReader::new(stdout).lines();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(180);
    let mut captured: Vec<String> = Vec::new();

    loop {
        if tokio::time::Instant::now() > deadline {
            return Err(ExecutorError::Io(std::io::Error::other(format!(
                "Timed out waiting for OpenCode server to print listening URL.\nServer output tail:\n{}",
                format_tail(captured)
            ))));
        }

        let line = match tokio::time::timeout_at(deadline, lines.next_line()).await {
            Ok(Ok(Some(line))) => line,
            Ok(Ok(None)) => {
                return Err(ExecutorError::Io(std::io::Error::other(format!(
                    "OpenCode server exited before printing listening URL.\nServer output tail:\n{}",
                    format_tail(captured)
                ))));
            }
            Ok(Err(err)) => return Err(ExecutorError::Io(err)),
            Err(_) => continue,
        };

        if let Some(log_writer) = &log_writer {
            log_writer
                .log_event(&OpencodeExecutorEvent::StartupLog {
                    message: line.clone(),
                })
                .await?;
        }
        if captured.len() < 64 {
            captured.push(line.clone());
        }

        if let Some(url) = line.trim().strip_prefix("opencode server listening on ") {
            // Keep draining stdout to avoid backpressure on the server, but don't block startup.
            tokio::spawn(async move {
                let mut lines = tokio::io::BufReader::new(lines.into_inner()).lines();
                while let Ok(Some(_)) = lines.next_line().await {}
            });
            return Ok(url.trim().to_string());
        }
    }
}

#[async_trait]
impl StandardCodingAgentExecutor for Opencode {
    fn use_approvals(&mut self, approvals: Arc<dyn ExecutorApprovalService>) {
        self.approvals = Some(approvals);
    }

    async fn list_models(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<Option<Vec<String>>, ExecutorError> {
        Opencode::list_models(self, current_dir, env)
            .await
            .map(Some)
    }

    async fn available_slash_commands(
        &self,
        current_dir: &Path,
    ) -> Result<futures::stream::BoxStream<'static, json_patch::Patch>, ExecutorError> {
        let defaults = hardcoded_slash_commands();
        let this = self.clone();
        let current_dir = current_dir.to_path_buf();

        let initial = patch::slash_commands(defaults.clone(), true, None);

        let discovery_stream = futures::stream::once(async move {
            match this.discover_slash_commands(&current_dir).await {
                Ok(commands) => patch::slash_commands(commands, false, None),
                Err(e) => {
                    tracing::warn!("Failed to discover OpenCode slash commands: {}", e);
                    patch::slash_commands(defaults, false, Some(e.to_string()))
                }
            }
        });

        Ok(Box::pin(
            futures::stream::once(async move { initial }).chain(discovery_stream),
        ))
    }

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let env = setup_permissions_env(self.auto_approve, env);
        let env = setup_compaction_env(self.auto_compact, &env);
        self.spawn_inner(current_dir, prompt, None, &env).await
    }

    async fn spawn_follow_up(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: &str,
        _reset_to_message_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let env = setup_permissions_env(self.auto_approve, env);
        let env = setup_compaction_env(self.auto_compact, &env);
        self.spawn_inner(current_dir, prompt, Some(session_id), &env)
            .await
    }

    fn normalize_logs(&self, msg_store: Arc<MsgStore>, worktree_path: &Path) {
        normalize_logs::normalize_logs(msg_store, worktree_path);
    }

    fn default_mcp_config_path(&self) -> Option<std::path::PathBuf> {
        #[cfg(not(windows))]
        {
            let base_dirs = xdg::BaseDirectories::with_prefix("opencode");
            // First try opencode.json, then opencode.jsonc
            base_dirs
                .get_config_file("opencode.json")
                .filter(|p| p.exists())
                .or_else(|| base_dirs.get_config_file("opencode.jsonc"))
        }
        #[cfg(windows)]
        {
            let config_dir = std::env::var("XDG_CONFIG_HOME")
                .map(std::path::PathBuf::from)
                .ok()
                .or_else(|| dirs::home_dir().map(|p| p.join(".config")))
                .map(|p| p.join("opencode"))?;

            let path = Some(config_dir.join("opencode.json"))
                .filter(|p| p.exists())
                .unwrap_or_else(|| config_dir.join("opencode.jsonc"));
            Some(path)
        }
    }

    fn default_skill_config_path(&self) -> Option<std::path::PathBuf> {
        self.default_mcp_config_path()
    }

    fn native_skill_discovery_roots(&self) -> Vec<std::path::PathBuf> {
        let mut roots = Vec::new();

        if let Some(home) = dirs::home_dir() {
            roots.push(home.join(".opencode").join("skills"));
            roots.push(home.join(".claude").join("skills"));
            roots.push(home.join(".agents").join("skills"));
        }

        roots
    }

    fn native_skill_config_backend(&self) -> NativeSkillConfigBackend {
        NativeSkillConfigBackend::Opencode
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        let mcp_config_found = self
            .default_mcp_config_path()
            .map(|p| p.exists())
            .unwrap_or(false);

        // Check multiple installation indicator paths:
        // 1. XDG config dir: $XDG_CONFIG_HOME/opencode
        // 2. XDG data dir: $XDG_DATA_HOME/opencode
        // 3. XDG state dir: $XDG_STATE_HOME/opencode
        // 4. OpenCode CLI home: ~/.opencode
        #[cfg(not(windows))]
        let installation_indicator_found = {
            let base_dirs = xdg::BaseDirectories::with_prefix("opencode");

            let config_dir_exists = base_dirs
                .get_config_home()
                .map(|config| config.exists())
                .unwrap_or(false);

            let data_dir_exists = base_dirs
                .get_data_home()
                .map(|data| data.exists())
                .unwrap_or(false);

            let state_dir_exists = base_dirs
                .get_state_home()
                .map(|state| state.exists())
                .unwrap_or(false);

            config_dir_exists || data_dir_exists || state_dir_exists
        };

        #[cfg(windows)]
        let installation_indicator_found = std::env::var("XDG_CONFIG_HOME")
            .ok()
            .map(std::path::PathBuf::from)
            .and_then(|p| p.join("opencode").exists().then_some(()))
            .or_else(|| {
                dirs::home_dir()
                    .and_then(|p| p.join(".config").join("opencode").exists().then_some(()))
            })
            .is_some();

        let home_opencode_exists = dirs::home_dir()
            .map(|home| home.join(".opencode").exists())
            .unwrap_or(false);

        if mcp_config_found || installation_indicator_found || home_opencode_exists {
            AvailabilityInfo::InstallationFound
        } else {
            AvailabilityInfo::NotFound
        }
    }
}

fn default_to_true() -> bool {
    true
}

fn setup_permissions_env(auto_approve: bool, env: &ExecutionEnv) -> ExecutionEnv {
    let mut env = env.clone();

    let permissions = match env.get("OPENCODE_PERMISSION") {
        Some(existing) => merge_question_deny(existing),
        None => build_default_permissions(auto_approve),
    };

    env.insert("OPENCODE_PERMISSION", &permissions);
    env
}

fn build_default_permissions(auto_approve: bool) -> String {
    if auto_approve {
        r#"{"question":"deny"}"#.to_string()
    } else {
        r#"{"edit":"ask","bash":"ask","webfetch":"ask","doom_loop":"ask","external_directory":"ask","question":"deny"}"#.to_string()
    }
}

fn merge_question_deny(existing_json: &str) -> String {
    let mut permissions: Map<String, serde_json::Value> =
        serde_json::from_str(existing_json.trim()).unwrap_or_default();

    permissions.insert(
        "question".to_string(),
        serde_json::Value::String("deny".to_string()),
    );

    serde_json::to_string(&permissions).unwrap_or_else(|_| r#"{"question":"deny"}"#.to_string())
}

fn setup_compaction_env(auto_compact: bool, env: &ExecutionEnv) -> ExecutionEnv {
    if !auto_compact {
        return env.clone();
    }

    let mut env = env.clone();
    let merged = merge_compaction_config(env.get("OPENCODE_CONFIG_CONTENT").map(String::as_str));
    env.insert("OPENCODE_CONFIG_CONTENT", merged);
    env
}

fn merge_compaction_config(existing_json: Option<&str>) -> String {
    let mut config: Map<String, Value> = existing_json
        .and_then(|value| serde_json::from_str(value.trim()).ok())
        .unwrap_or_default();

    let mut compaction = config
        .remove("compaction")
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    compaction.insert("auto".to_string(), Value::Bool(true));
    config.insert("compaction".to_string(), Value::Object(compaction));

    serde_json::to_string(&config).unwrap_or_else(|_| r#"{"compaction":{"auto":true}}"#.to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::{Value, json};

    use super::{
        collect_configured_models,
        sdk::{ProviderInfo, ProviderListResponse},
    };

    fn provider(
        id: &str,
        source: Option<&str>,
        env: &[&str],
        key: Option<&str>,
        options: Value,
        models: &[&str],
    ) -> ProviderInfo {
        ProviderInfo {
            id: id.to_string(),
            name: id.to_string(),
            source: source.map(str::to_string),
            env: env.iter().map(|value| value.to_string()).collect(),
            key: key.map(str::to_string),
            options,
            models: models
                .iter()
                .map(|model| (model.to_string(), json!({})))
                .collect::<HashMap<_, _>>(),
        }
    }

    #[test]
    fn opencode_model_discovery_keeps_only_configured_providers() {
        let provider_list = ProviderListResponse {
            all: vec![
                provider(
                    "openai",
                    Some("custom"),
                    &["OPENAI_API_KEY"],
                    None,
                    Value::Null,
                    &["gpt-5.2-codex"],
                ),
                provider(
                    "openrouter",
                    Some("config"),
                    &["OPENROUTER_API_KEY"],
                    None,
                    Value::Null,
                    &["openai/gpt-5.2-codex"],
                ),
                provider(
                    "anthropic",
                    Some("api"),
                    &["ANTHROPIC_API_KEY"],
                    Some("sk-test"),
                    Value::Null,
                    &["claude-sonnet-4-5"],
                ),
                provider(
                    "litellm",
                    Some("config"),
                    &[],
                    None,
                    Value::Null,
                    &["gpt-5.2-codex"],
                ),
                provider(
                    "dashscope",
                    Some("config"),
                    &["DASHSCOPE_API_KEY"],
                    None,
                    json!({ "apiKey": "sk-test" }),
                    &["qwen3-coder-plus"],
                ),
                provider(
                    "gemini",
                    Some("env"),
                    &["GEMINI_API_KEY"],
                    None,
                    Value::Null,
                    &["gemini-3-pro"],
                ),
            ],
            default: HashMap::new(),
            connected: vec![
                "openrouter".to_string(),
                "anthropic".to_string(),
                "litellm".to_string(),
                "dashscope".to_string(),
                "gemini".to_string(),
            ],
        };

        let models = collect_configured_models(&provider_list);

        assert_eq!(
            models,
            vec![
                "anthropic/claude-sonnet-4-5",
                "dashscope/qwen3-coder-plus",
                "gemini/gemini-3-pro",
                "litellm/gpt-5.2-codex",
            ]
        );
        assert!(!models.iter().any(|model| model.starts_with("openai/")));
        assert!(!models.iter().any(|model| model.starts_with("openrouter/")));
    }
}
