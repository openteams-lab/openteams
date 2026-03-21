use std::{
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
use tokio::{io::AsyncBufReadExt, process::Command};
use ts_rs::TS;
use workspace_utils::msg_store::MsgStore;

use crate::{
    approvals::ExecutorApprovalService,
    command::{CmdOverrides, CommandBuildError, CommandBuilder, apply_overrides},
    env::ExecutionEnv,
    executors::{
        AppendPrompt, AvailabilityInfo, ExecutorError, ExecutorExitResult, SpawnedChild,
        StandardCodingAgentExecutor, openteams_cli::types::OpenTeamsCliExecutorEvent,
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
    LogWriter, RunConfig, build_default_headers, generate_server_password, list_providers,
    run_session, run_slash_command, wait_for_health,
};
use slash_commands::{OpenTeamsCliSlashCommand, hardcoded_slash_commands};

#[derive(Derivative, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[derivative(Debug, PartialEq)]
pub struct OpenTeamsCli {
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

/// Represents a spawned OpenTeams CLI server with its base URL
pub(crate) struct OpenTeamsCliServer {
    #[allow(unused)]
    child: Option<AsyncGroupChild>,
    base_url: String,
    server_password: ServerPassword,
}

impl Drop for OpenTeamsCliServer {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            tokio::spawn(async move {
                let _ = workspace_utils::process::kill_process_group(&mut child).await;
            });
        }
    }
}

type ServerPassword = String;
pub(crate) const SERVER_USERNAME: &str = "openteams-cli";
pub(crate) const DIRECTORY_HEADER: &str = "x-openteams-directory";

impl OpenTeamsCli {
    const BINARY_NAME: &'static str = "openteams-cli";
    const NPX_FALLBACK: &'static str = "npx -y openteams-cli@latest";

    /// Discover the openteams-cli binary using a priority chain:
    /// 1. OPENTEAMS_CLI_PATH environment variable
    /// 2. Same directory as current executable (packaged mode - Desktop/NPX)
    /// 3. ./binaries/ relative to CWD (development mode)
    /// 4. Bundled binary at ~/.openteams/bin/openteams-cli
    /// 5. System PATH lookup
    ///
    /// Returns None if not found (will fallback to npx).
    fn find_binary() -> Option<PathBuf> {
        let binary_name = if cfg!(windows) {
            "openteams-cli.exe"
        } else {
            "openteams-cli"
        };

        // 1. Check OPENTEAMS_CLI_PATH env var
        if let Ok(path) = std::env::var("OPENTEAMS_CLI_PATH") {
            let p = PathBuf::from(&path);
            if p.exists() {
                tracing::debug!("Found openteams-cli via OPENTEAMS_CLI_PATH: {}", path);
                return Some(p);
            }
        }

        // 2. Check same directory as current executable (packaged mode)
        // This works when CLI is bundled alongside the server binary
        if let Ok(exe_path) = std::env::current_exe()
            && let Some(exe_dir) = exe_path.parent()
        {
            let bundled = exe_dir.join(binary_name);
            if bundled.exists() {
                tracing::debug!(
                    "Found openteams-cli alongside server binary: {}",
                    bundled.display()
                );
                return Some(bundled);
            }
        }

        // 3. Check ./binaries/ relative to CWD (development mode)
        if let Ok(cwd) = std::env::current_dir() {
            let dev_binary = cwd.join("binaries").join(binary_name);
            if dev_binary.exists() {
                tracing::debug!(
                    "Found openteams-cli in development binaries/: {}",
                    dev_binary.display()
                );
                return Some(dev_binary);
            }
        }

        // 4. Check bundled binary at ~/.openteams/bin/
        if let Some(home) = dirs::home_dir() {
            let bundled = home.join(".openteams").join("bin").join(binary_name);
            if bundled.exists() {
                tracing::debug!("Found bundled openteams-cli: {}", bundled.display());
                return Some(bundled);
            }
        }

        // 5. Check system PATH
        if let Ok(path) = which::which(Self::BINARY_NAME) {
            tracing::debug!("Found openteams-cli in PATH: {}", path.display());
            return Some(path);
        }

        None
    }

    fn build_command_builder(&self) -> Result<CommandBuilder, CommandBuildError> {
        let base_command = match Self::find_binary() {
            Some(path) => path.to_string_lossy().to_string(),
            None => Self::NPX_FALLBACK.to_string(),
        };
        let builder = CommandBuilder::new(&base_command).extend_params([
            "serve",
            "--hostname",
            "127.0.0.1",
            "--port",
            "0",
        ]);
        apply_overrides(builder, &self.cmd)
    }

    fn compute_models_cache_key(&self) -> String {
        serde_json::to_string(&self.cmd).unwrap_or_default()
    }

    pub async fn list_models(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<Vec<String>, ExecutorError> {
        let server = self.spawn_server(current_dir, env).await?;
        let directory = current_dir.to_string_lossy().to_string();
        let client = reqwest::Client::builder()
            .default_headers(build_default_headers(&directory, &server.server_password))
            .build()
            .map_err(|err| ExecutorError::Io(io::Error::other(err)))?;

        wait_for_health(&client, &server.base_url).await?;
        let providers = list_providers(&client, &server.base_url, &directory).await?;
        let mut models = Vec::new();

        for provider in providers.all {
            for model_id in provider.models.keys() {
                models.push(format!("{}/{}", provider.id, model_id));
            }
        }

        models.sort();
        models.dedup();
        Ok(models)
    }

    async fn spawn_server_process(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<(AsyncGroupChild, ServerPassword), ExecutorError> {
        let command_parts = self.build_command_builder()?.build_initial()?;
        let (program_path, args) = command_parts.into_resolved().await?;

        let server_password = generate_server_password();
        tracing::debug!(
            program = %program_path.display(),
            arg_count = args.len(),
            current_dir = %current_dir.display(),
            "Starting OpenTeamsCli server process"
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
            .env("OPENTEAMS_SERVER_USERNAME", SERVER_USERNAME)
            .env("OPENTEAMS_SERVER_PASSWORD", &server_password)
            .args(&args);

        env.clone()
            .with_profile(&self.cmd)
            .apply_to_command(&mut command);

        let child = command.group_spawn()?;

        Ok((child, server_password))
    }

    async fn spawn_server(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<OpenTeamsCliServer, ExecutorError> {
        let (mut child, server_password) = self.spawn_server_process(current_dir, env).await?;
        let server_stdout = child.inner().stdout.take().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other("OpenTeams CLI server missing stdout"))
        })?;

        let base_url = wait_for_server_url(server_stdout, None).await?;
        tracing::debug!(
            base_url = %base_url,
            current_dir = %current_dir.display(),
            "OpenTeamsCli server is ready"
        );

        Ok(OpenTeamsCliServer {
            child: Some(child),
            base_url,
            server_password,
        })
    }

    async fn spawn_inner(
        &self,
        current_dir: &Path,
        prompt: &str,
        resume_session: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let slash_command = OpenTeamsCliSlashCommand::parse(prompt);
        let combined_prompt = if slash_command.is_some() {
            prompt.to_string()
        } else {
            self.append_prompt.combine_prompt(prompt)
        };

        let (mut child, server_password) = self.spawn_server_process(current_dir, env).await?;
        let server_stdout = child.inner().stdout.take().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other("OpenTeams CLI server missing stdout"))
        })?;

        let stdout = create_stdout_pipe_writer(&mut child)?;
        let log_writer = LogWriter::new(stdout);

        let (exit_signal_tx, exit_signal_rx) = tokio::sync::oneshot::channel();
        let cancel = tokio_util::sync::CancellationToken::new();

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
            let base_url = match wait_for_server_url(server_stdout, Some(log_writer.clone())).await
            {
                Ok(url) => url,
                Err(err) => {
                    let _ = log_writer
                        .log_error(format!("OpenTeams CLI startup error: {err}"))
                        .await;
                    let _ = exit_signal_tx.send(ExecutorExitResult::Failure);
                    return;
                }
            };
            tracing::debug!(
                base_url = %base_url,
                directory = %directory,
                resume_session_id = ?resume_session_id,
                has_slash_command = slash_command.is_some(),
                "OpenTeamsCli executor connected to local server"
            );

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
                        .log_error(format!("OpenTeams CLI executor error: {err}"))
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
                "Timed out waiting for OpenTeams CLI server to print listening URL.\nServer output tail:\n{}",
                format_tail(captured)
            ))));
        }

        let line = match tokio::time::timeout_at(deadline, lines.next_line()).await {
            Ok(Ok(Some(line))) => line,
            Ok(Ok(None)) => {
                return Err(ExecutorError::Io(std::io::Error::other(format!(
                    "OpenTeams CLI server exited before printing listening URL.\nServer output tail:\n{}",
                    format_tail(captured)
                ))));
            }
            Ok(Err(err)) => return Err(ExecutorError::Io(err)),
            Err(_) => continue,
        };

        if let Some(log_writer) = &log_writer {
            log_writer
                .log_event(&OpenTeamsCliExecutorEvent::StartupLog {
                    message: line.clone(),
                })
                .await?;
        }
        if captured.len() < 64 {
            captured.push(line.clone());
        }

        // Match both possible server listening messages
        let url = line
            .trim()
            .strip_prefix("openteams-cli server listening on ")
            .or_else(|| line.trim().strip_prefix("opencode server listening on "));
        if let Some(url) = url {
            tokio::spawn(async move {
                let mut lines = tokio::io::BufReader::new(lines.into_inner()).lines();
                while let Ok(Some(_)) = lines.next_line().await {}
            });
            return Ok(url.trim().to_string());
        }
    }
}

#[async_trait]
impl StandardCodingAgentExecutor for OpenTeamsCli {
    fn use_approvals(&mut self, approvals: Arc<dyn ExecutorApprovalService>) {
        self.approvals = Some(approvals);
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
                    tracing::warn!("Failed to discover OpenTeams CLI slash commands: {}", e);
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
        // OpenTeams CLI uses ~/.openteams/openteams.json
        dirs::home_dir().map(|home| {
            let config_dir = home.join(".openteams");
            let json_path = config_dir.join("openteams.json");
            let jsonc_path = config_dir.join("openteams.jsonc");
            if json_path.exists() {
                json_path
            } else {
                jsonc_path
            }
        })
    }

    fn default_skill_config_path(&self) -> Option<std::path::PathBuf> {
        self.default_mcp_config_path()
    }

    fn native_skill_discovery_roots(&self) -> Vec<std::path::PathBuf> {
        let mut roots = Vec::new();

        if let Some(home) = dirs::home_dir() {
            roots.push(home.join(".openteams").join("skills"));
            roots.push(home.join(".claude").join("skills"));
            roots.push(home.join(".agents").join("skills"));
        }

        roots
    }

    fn native_skill_config_backend(&self) -> NativeSkillConfigBackend {
        // Reuse the Opencode backend since openteams-cli uses the same config format
        NativeSkillConfigBackend::Opencode
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        let mcp_config_found = self
            .default_mcp_config_path()
            .map(|p| p.exists())
            .unwrap_or(false);

        let home_openteams_exists = dirs::home_dir()
            .map(|home| home.join(".openteams").exists())
            .unwrap_or(false);

        let binary_found = Self::find_binary().is_some();

        if mcp_config_found || home_openteams_exists || binary_found {
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

    let permissions = match env.get("OPENTEAMS_PERMISSION") {
        Some(existing) => merge_question_deny(existing),
        None => build_default_permissions(auto_approve),
    };

    env.insert("OPENTEAMS_PERMISSION", &permissions);
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
    let merged = merge_compaction_config(env.get("OPENTEAMS_CONFIG_CONTENT").map(String::as_str));
    env.insert("OPENTEAMS_CONFIG_CONTENT", merged);
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
