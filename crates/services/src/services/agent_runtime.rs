use std::{
    collections::{BTreeSet, HashMap},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc, LazyLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use executors::{
    command::{CmdOverrides, CommandBuilder},
    env::ExecutionEnv,
    executors::{AvailabilityInfo, BaseCodingAgent, CodingAgent, StandardCodingAgentExecutor},
    model_sync::with_model,
    profile::{ExecutorConfig, ExecutorConfigs, ProfileError, canonical_variant_key},
};
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use tokio::{process::Command, time::timeout};
use ts_rs::TS;

const STORE_FILE_NAME: &str = "agent_runtime_config.json";
const DISCOVERY_TTL: ChronoDuration = ChronoDuration::hours(24);
const RUNTIME_DISCOVERY_CONCURRENCY: usize = 4;

static BACKGROUND_RUNTIME_REFRESH_RUNNING: AtomicBool = AtomicBool::new(false);
static RUNTIME_REFRESH_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

#[derive(Debug, Error)]
pub enum AgentRuntimeError {
    #[error("invalid environment variable key: {0}")]
    InvalidEnvKey(String),
    #[error("invalid model name: {0}")]
    InvalidModelName(String),
    #[error("model not found in profile: {0}")]
    ModelNotFound(String),
    #[error("unknown runner: {0}")]
    UnknownRunner(String),
    #[error("runner does not support configurable models: {0}")]
    UnsupportedModelRunner(BaseCodingAgent),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Profile(#[from] ProfileError),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AgentRunMode {
    Auto,
    Local,
    Disabled,
}

impl Default for AgentRunMode {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct AgentRuntimeConfig {
    pub runner_type: BaseCodingAgent,
    pub run_mode: AgentRunMode,
    pub env_json: HashMap<String, String>,
    #[serde(default)]
    #[ts(type = "JsonValue")]
    pub executor_options: Value,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct UpdateAgentRuntimeConfig {
    pub run_mode: Option<AgentRunMode>,
    pub env_json: Option<HashMap<String, String>>,
    #[ts(type = "JsonValue | null")]
    pub executor_options: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct AgentRuntimeEnvSummary {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AgentRuntimeModelSource {
    Runner,
    ProfileFallback,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentRuntimeStatus {
    pub runner_type: BaseCodingAgent,
    pub installed: bool,
    pub executable: bool,
    pub availability: AvailabilityInfo,
    pub discovered_models: Vec<String>,
    pub model_source: AgentRuntimeModelSource,
    pub version: Option<String>,
    pub last_checked_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub run_mode: AgentRunMode,
    pub env_summary: Vec<AgentRuntimeEnvSummary>,
    #[ts(type = "JsonValue")]
    pub executor_options: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum AgentRuntimeReasoningCapability {
    Effort { options: Vec<String> },
    Variant { options: Vec<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentRuntimeListResponse {
    pub runners: Vec<AgentRuntimeStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct AgentRuntimeRefreshError {
    pub runner_type: BaseCodingAgent,
    pub message: String,
    pub preserved_models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentRuntimeRefreshResponse {
    pub runners: Vec<AgentRuntimeStatus>,
    pub errors: Vec<AgentRuntimeRefreshError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentRuntimeDiagnostics {
    pub runner_type: BaseCodingAgent,
    pub installed: bool,
    pub executable: bool,
    pub availability: AvailabilityInfo,
    pub config_path: String,
    pub install_indicator_path: Option<String>,
    pub discovered_models: Vec<String>,
    pub model_source: AgentRuntimeModelSource,
    pub version: Option<String>,
    pub last_checked_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub run_mode: AgentRunMode,
    pub env_summary: Vec<AgentRuntimeEnvSummary>,
    #[ts(type = "JsonValue")]
    pub executor_options: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct AgentRuntimeDiscovery {
    models: Vec<String>,
    version: Option<String>,
    last_checked_at: DateTime<Utc>,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
struct AgentRuntimeStore {
    #[serde(default)]
    configs: HashMap<BaseCodingAgent, AgentRuntimeConfig>,
    #[serde(default)]
    discoveries: HashMap<BaseCodingAgent, AgentRuntimeDiscovery>,
}

pub fn store_path() -> PathBuf {
    utils::assets::asset_dir().join(STORE_FILE_NAME)
}

pub fn list_runtime_statuses() -> Result<AgentRuntimeListResponse, AgentRuntimeError> {
    let store = read_store(&store_path())?;
    let profiles = ExecutorConfigs::get_cached();
    Ok(AgentRuntimeListResponse {
        runners: build_statuses(&profiles, &store),
    })
}

pub async fn list_runtime_statuses_with_discovery(
    current_dir: &Path,
) -> Result<AgentRuntimeListResponse, AgentRuntimeError> {
    let store = read_store(&store_path())?;
    let profiles = ExecutorConfigs::get_cached();
    let runners = build_statuses(&profiles, &store);

    if runtime_discovery_needs_refresh(&profiles, &store) {
        spawn_background_runtime_discovery(current_dir.to_path_buf());
    }

    Ok(AgentRuntimeListResponse { runners })
}

pub async fn refresh_runtime_discovery(
    current_dir: &Path,
) -> Result<AgentRuntimeRefreshResponse, AgentRuntimeError> {
    let _guard = RUNTIME_REFRESH_LOCK.lock().await;
    refresh_runtime_discovery_unlocked(current_dir).await
}

async fn refresh_runtime_discovery_unlocked(
    current_dir: &Path,
) -> Result<AgentRuntimeRefreshResponse, AgentRuntimeError> {
    let path = store_path();
    let mut store = read_store(&path)?;
    let profiles = ExecutorConfigs::get_cached();
    let mut errors = Vec::new();
    let current_dir = current_dir.to_path_buf();
    let store_snapshot = Arc::new(store.clone());
    let discovery_inputs = profiles
        .executors
        .iter()
        .map(|(runner, executor_config)| (*runner, executor_config.clone()))
        .collect::<Vec<_>>();

    let outcomes = stream::iter(
        discovery_inputs
            .into_iter()
            .map(|(runner, executor_config)| {
                let current_dir = current_dir.clone();
                let store = Arc::clone(&store_snapshot);
                async move {
                    discover_runner_runtime(runner, &executor_config, &store, &current_dir).await
                }
            }),
    )
    .buffer_unordered(RUNTIME_DISCOVERY_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;

    for outcome in outcomes {
        match outcome? {
            RunnerDiscoveryOutcome::Skipped => {}
            RunnerDiscoveryOutcome::ModelsDiscovered {
                runner,
                models,
                detected_version,
            } => {
                let version = version_for_discovery_update(&store, runner, detected_version);
                store.discoveries.insert(
                    runner,
                    AgentRuntimeDiscovery {
                        models,
                        version,
                        last_checked_at: Utc::now(),
                        last_error: None,
                    },
                );
            }
            RunnerDiscoveryOutcome::VersionOnly {
                runner,
                detected_version,
            } => {
                cache_version_only_discovery(&mut store, runner, detected_version);
            }
            RunnerDiscoveryOutcome::Failed {
                runner,
                message,
                detected_version,
                preserved_models,
            } => {
                store
                    .discoveries
                    .entry(runner)
                    .and_modify(|entry| {
                        entry.last_checked_at = Utc::now();
                        entry.last_error = Some(message.clone());
                        if let Some(version) = detected_version.clone() {
                            entry.version = Some(version);
                        }
                    })
                    .or_insert_with(|| AgentRuntimeDiscovery {
                        models: Vec::new(),
                        version: detected_version.clone(),
                        last_checked_at: Utc::now(),
                        last_error: Some(message.clone()),
                    });
                errors.push(AgentRuntimeRefreshError {
                    runner_type: runner,
                    message,
                    preserved_models,
                });
            }
        }
    }

    write_store(&path, &store)?;
    Ok(AgentRuntimeRefreshResponse {
        runners: build_statuses(&profiles, &store),
        errors,
    })
}

fn spawn_background_runtime_discovery(current_dir: PathBuf) {
    if BACKGROUND_RUNTIME_REFRESH_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    tokio::spawn(async move {
        let _refresh_guard = BackgroundRefreshGuard;
        let result = match RUNTIME_REFRESH_LOCK.try_lock() {
            Ok(_guard) => refresh_runtime_discovery_unlocked(&current_dir).await,
            Err(_) => return,
        };

        if let Err(err) = result {
            tracing::warn!("Failed to refresh agent runtime discovery in background: {err}");
        }
    });
}

struct BackgroundRefreshGuard;

impl Drop for BackgroundRefreshGuard {
    fn drop(&mut self) {
        BACKGROUND_RUNTIME_REFRESH_RUNNING.store(false, Ordering::Release);
    }
}

enum RunnerDiscoveryOutcome {
    Skipped,
    ModelsDiscovered {
        runner: BaseCodingAgent,
        models: Vec<String>,
        detected_version: Option<String>,
    },
    VersionOnly {
        runner: BaseCodingAgent,
        detected_version: Option<String>,
    },
    Failed {
        runner: BaseCodingAgent,
        message: String,
        detected_version: Option<String>,
        preserved_models: Vec<String>,
    },
}

async fn discover_runner_runtime(
    runner: BaseCodingAgent,
    executor_config: &ExecutorConfig,
    store: &AgentRuntimeStore,
    current_dir: &Path,
) -> Result<RunnerDiscoveryOutcome, AgentRuntimeError> {
    let Some(mut base) = executor_config
        .get_default()
        .or_else(|| executor_config.configurations.values().next())
        .cloned()
    else {
        return Ok(RunnerDiscoveryOutcome::Skipped);
    };

    if !base.get_availability_info().is_available() {
        return Ok(RunnerDiscoveryOutcome::Skipped);
    }

    let mut env = ExecutionEnv::new(Default::default(), false, String::new());
    apply_config_to_executor_and_env(runner, &mut base, &mut env, store)?;

    let (detected_version, discovered_models) = tokio::join!(
        detect_refresh_version(&base, &env),
        discover_models_for_executor(&base, current_dir, &env)
    );

    Ok(match discovered_models {
        Ok(Some(models)) => RunnerDiscoveryOutcome::ModelsDiscovered {
            runner,
            models,
            detected_version,
        },
        Ok(None) => RunnerDiscoveryOutcome::VersionOnly {
            runner,
            detected_version,
        },
        Err(message) => RunnerDiscoveryOutcome::Failed {
            runner,
            message,
            detected_version,
            preserved_models: models_for_runner(runner, executor_config, store),
        },
    })
}

pub fn update_runtime_config(
    runner: BaseCodingAgent,
    payload: UpdateAgentRuntimeConfig,
) -> Result<AgentRuntimeStatus, AgentRuntimeError> {
    let path = store_path();
    let mut store = read_store(&path)?;
    let profiles = ExecutorConfigs::get_cached();

    if !profiles.executors.contains_key(&runner) {
        return Err(AgentRuntimeError::UnknownRunner(runner.to_string()));
    }

    let mut config = store
        .configs
        .get(&runner)
        .cloned()
        .unwrap_or_else(|| default_config(runner));

    if let Some(run_mode) = payload.run_mode {
        config.run_mode = run_mode;
    }
    if let Some(env_json) = payload.env_json {
        validate_env_json(&env_json)?;
        config.env_json = env_json;
    }
    if let Some(executor_options) = payload.executor_options {
        config.executor_options = executor_options;
    }
    config.updated_at = Utc::now();

    store.configs.insert(runner, config);
    write_store(&path, &store)?;

    let status = build_statuses(&profiles, &store)
        .into_iter()
        .find(|status| status.runner_type == runner)
        .ok_or_else(|| AgentRuntimeError::UnknownRunner(runner.to_string()))?;
    Ok(status)
}

pub fn add_runtime_model(
    runner: BaseCodingAgent,
    model_name: String,
) -> Result<AgentRuntimeStatus, AgentRuntimeError> {
    let model = normalize_model_name(&model_name)?;
    let mut profiles = ExecutorConfigs::get_cached();

    let executor_config = profiles
        .executors
        .get_mut(&runner)
        .ok_or_else(|| AgentRuntimeError::UnknownRunner(runner.to_string()))?;
    let base = executor_config
        .get_default()
        .or_else(|| executor_config.configurations.values().next())
        .cloned()
        .ok_or_else(|| AgentRuntimeError::UnknownRunner(runner.to_string()))?;
    let model_config =
        with_model(&base, &model).ok_or(AgentRuntimeError::UnsupportedModelRunner(runner))?;
    let variant_key = canonical_variant_key(&model);

    if variant_key == "DEFAULT" {
        return Err(AgentRuntimeError::InvalidModelName(model));
    }

    let changed = match executor_config.configurations.get(&variant_key) {
        Some(existing) if existing == &model_config => false,
        _ => {
            executor_config
                .configurations
                .insert(variant_key, model_config);
            true
        }
    };

    if changed {
        profiles.save_overrides()?;
        ExecutorConfigs::reload();
    }

    runtime_status_for_runner(runner)
}

pub fn rename_runtime_model(
    runner: BaseCodingAgent,
    old_model_name: String,
    new_model_name: String,
) -> Result<AgentRuntimeStatus, AgentRuntimeError> {
    let old_model = normalize_model_name(&old_model_name)?;
    let new_model = normalize_model_name(&new_model_name)?;

    if old_model == new_model {
        return runtime_status_for_runner(runner);
    }

    let mut profiles = ExecutorConfigs::get_cached();
    let defaults = ExecutorConfigs::from_defaults();

    if rename_model_in_profiles(&mut profiles, &defaults, runner, &old_model, &new_model)? {
        profiles.save_overrides()?;
        ExecutorConfigs::reload();
    }

    runtime_status_for_runner(runner)
}

pub async fn runtime_diagnostics(
    runner: BaseCodingAgent,
) -> Result<AgentRuntimeDiagnostics, AgentRuntimeError> {
    let path = store_path();
    let mut store = read_store(&path)?;
    let profiles = ExecutorConfigs::get_cached();
    let config = profiles
        .executors
        .get(&runner)
        .ok_or_else(|| AgentRuntimeError::UnknownRunner(runner.to_string()))?;
    let Some(base) = config
        .get_default()
        .or_else(|| config.configurations.values().next())
    else {
        return Err(AgentRuntimeError::UnknownRunner(runner.to_string()));
    };

    let cli_config_path = base
        .default_mcp_config_path()
        .map(|path| path.display().to_string());
    let status = build_status(runner, config, base, &store);
    let mut runtime_executor = base.clone();
    let mut env = ExecutionEnv::new(Default::default(), false, String::new());
    apply_config_to_executor_and_env(runner, &mut runtime_executor, &mut env, &store)?;

    let detected_version = if status.installed {
        detect_cli_version(&runtime_executor, &env).await
    } else {
        None
    };
    if let Some(version) = detected_version.as_deref() {
        cache_runner_version(&mut store, runner, version.to_string());
        write_store(&path, &store)?;
    }
    let version = detected_version.or(status.version);

    Ok(AgentRuntimeDiagnostics {
        runner_type: status.runner_type,
        installed: status.installed,
        executable: status.executable,
        availability: status.availability,
        config_path: cli_config_path
            .clone()
            .unwrap_or_else(|| path.display().to_string()),
        install_indicator_path: cli_config_path,
        discovered_models: status.discovered_models,
        model_source: status.model_source,
        version,
        last_checked_at: status.last_checked_at,
        last_error: status.last_error,
        run_mode: status.run_mode,
        env_summary: status.env_summary,
        executor_options: status.executor_options,
    })
}

pub fn apply_agent_runtime_config(
    runner: BaseCodingAgent,
    executor: &mut CodingAgent,
    env: &mut ExecutionEnv,
) -> Result<(), AgentRuntimeError> {
    let store = read_store(&store_path())?;
    apply_config_to_executor_and_env(runner, executor, env, &store)?;
    Ok(())
}

fn apply_config_to_executor_and_env(
    runner: BaseCodingAgent,
    executor: &mut CodingAgent,
    env: &mut ExecutionEnv,
    store: &AgentRuntimeStore,
) -> Result<(), AgentRuntimeError> {
    if let Some(config) = store.configs.get(&runner) {
        merge_agent_env_without_overwriting_session(env, &config.env_json);
        apply_executor_options(runner, executor, &config.executor_options)?;
    }
    Ok(())
}

fn apply_executor_options(
    runner: BaseCodingAgent,
    executor: &mut CodingAgent,
    executor_options: &Value,
) -> Result<(), AgentRuntimeError> {
    let Some(options) = executor_options
        .as_object()
        .filter(|options| !options.is_empty())
    else {
        return Ok(());
    };

    let tag = serde_json::to_value(runner)?
        .as_str()
        .unwrap_or_default()
        .to_string();
    let mut wrapped = serde_json::to_value(&*executor)?;
    let Value::Object(root) = &mut wrapped else {
        return Ok(());
    };
    let Some(inner) = root.get_mut(&tag) else {
        return Ok(());
    };

    merge_json_object(inner, &Value::Object(options.clone()));
    *executor = serde_json::from_value(wrapped)?;
    Ok(())
}

fn merge_json_object(target: &mut Value, source: &Value) {
    match (target, source) {
        (Value::Object(target_map), Value::Object(source_map)) => {
            for (key, value) in source_map {
                match (target_map.get_mut(key), value) {
                    (Some(existing @ Value::Object(_)), Value::Object(_)) => {
                        merge_json_object(existing, value);
                    }
                    _ => {
                        target_map.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (target, source) => {
            *target = source.clone();
        }
    }
}

fn merge_agent_env_without_overwriting_session(
    env: &mut ExecutionEnv,
    agent_env: &HashMap<String, String>,
) {
    for (key, value) in agent_env {
        if !env.contains_key(key) {
            env.insert(key.clone(), value.clone());
        }
    }
}

async fn detect_cli_version(executor: &CodingAgent, env: &ExecutionEnv) -> Option<String> {
    let base = version_command_base(executor)?;
    let parts = CommandBuilder::new(base)
        .extend_params(["--version"])
        .build_initial()
        .ok()?
        .into_resolved()
        .await
        .ok()?;
    let (executable_path, args) = parts;

    let mut command = Command::new(executable_path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if let Some(cmd_overrides) = cmd_overrides_for_executor(executor) {
        env.clone()
            .with_profile(cmd_overrides)
            .apply_to_command(&mut command);
    } else {
        env.apply_to_command(&mut command);
    }

    let output = timeout(Duration::from_secs(12), command.output())
        .await
        .ok()?
        .ok()?;
    normalize_cli_version_output(&output.stdout, &output.stderr)
}

async fn detect_refresh_version(executor: &CodingAgent, env: &ExecutionEnv) -> Option<String> {
    detect_cli_version(executor, env).await
}

fn version_command_base(executor: &CodingAgent) -> Option<String> {
    if let Some(base_override) = cmd_overrides_for_executor(executor)
        .and_then(|cmd| cmd.base_command_override.as_deref())
        .map(str::trim)
        .filter(|base| !base.is_empty())
    {
        return Some(base_override.to_string());
    }

    Some(match executor {
        CodingAgent::ClaudeCode(config) => {
            if config.claude_code_router.unwrap_or(false) {
                "npx -y @musistudio/claude-code-router@2.0.0".to_string()
            } else {
                "npx -y @anthropic-ai/claude-code@2.1.161".to_string()
            }
        }
        CodingAgent::Amp(_) => "npx -y @sourcegraph/amp@0.0.1780464815-g688406".to_string(),
        CodingAgent::Gemini(_) => "npx -y @google/gemini-cli@0.45.0".to_string(),
        CodingAgent::Codex(_) => "npx -y @openai/codex@0.136.0".to_string(),
        CodingAgent::Opencode(_) => "npx -y opencode-ai@1.15.13".to_string(),
        CodingAgent::OpenTeamsCli(_) => openteams_cli_binary_base(),
        CodingAgent::CursorAgent(_) => "cursor-agent".to_string(),
        CodingAgent::QwenCode(_) => "npx -y @qwen-code/qwen-code@0.17.0".to_string(),
        CodingAgent::Copilot(_) => "npx -y @github/copilot@1.0.59".to_string(),
        CodingAgent::Droid(_) => "droid".to_string(),
        CodingAgent::KimiCode(_) => "kimi".to_string(),
        #[cfg(feature = "qa-mode")]
        CodingAgent::QaMock(_) => return None,
    })
}

fn cmd_overrides_for_executor(executor: &CodingAgent) -> Option<&CmdOverrides> {
    match executor {
        CodingAgent::ClaudeCode(config) => Some(&config.cmd),
        CodingAgent::Amp(config) => Some(&config.cmd),
        CodingAgent::Gemini(config) => Some(&config.cmd),
        CodingAgent::Codex(config) => Some(&config.cmd),
        CodingAgent::Opencode(config) => Some(&config.cmd),
        CodingAgent::OpenTeamsCli(config) => Some(&config.cmd),
        CodingAgent::CursorAgent(config) => Some(&config.cmd),
        CodingAgent::QwenCode(config) => Some(&config.cmd),
        CodingAgent::Copilot(config) => Some(&config.cmd),
        CodingAgent::Droid(config) => Some(&config.cmd),
        CodingAgent::KimiCode(config) => Some(&config.cmd),
        #[cfg(feature = "qa-mode")]
        CodingAgent::QaMock(_) => None,
    }
}

fn openteams_cli_binary_base() -> String {
    let binary_name = if cfg!(windows) {
        "openteams-cli.exe"
    } else {
        "openteams-cli"
    };

    if let Ok(path) = std::env::var("OPENTEAMS_CLI_PATH") {
        let path = PathBuf::from(path);
        if path.exists() {
            return command_base_from_path(path);
        }
    }

    if let Ok(exe_path) = std::env::current_exe()
        && let Some(exe_dir) = exe_path.parent()
    {
        let bundled = exe_dir.join(binary_name);
        if bundled.exists() {
            return command_base_from_path(bundled);
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let dev_binary = cwd.join("binaries").join(binary_name);
        if dev_binary.exists() {
            return command_base_from_path(dev_binary);
        }
    }

    if let Some(home) = dirs::home_dir() {
        let bundled = home.join(".openteams").join("bin").join(binary_name);
        if bundled.exists() {
            return command_base_from_path(bundled);
        }
    }

    which::which("openteams-cli")
        .ok()
        .map(command_base_from_path)
        .unwrap_or_else(|| "npx -y openteams-cli@latest".to_string())
}

fn command_base_from_path(path: PathBuf) -> String {
    let raw = path.to_string_lossy();
    if raw.contains(' ') {
        format!("\"{raw}\"")
    } else {
        raw.to_string()
    }
}

fn normalize_cli_version_output(stdout: &[u8], stderr: &[u8]) -> Option<String> {
    let stdout = String::from_utf8_lossy(stdout);
    first_version_line(&stdout).or_else(|| {
        let stderr = String::from_utf8_lossy(stderr);
        first_version_line(&stderr)
    })
}

fn first_version_line(output: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(160).collect())
}

fn cache_runner_version(store: &mut AgentRuntimeStore, runner: BaseCodingAgent, version: String) {
    let now = Utc::now();
    store
        .discoveries
        .entry(runner)
        .and_modify(|entry| {
            entry.version = Some(version.clone());
            entry.last_checked_at = now;
        })
        .or_insert_with(|| AgentRuntimeDiscovery {
            models: Vec::new(),
            version: Some(version),
            last_checked_at: now,
            last_error: None,
        });
}

fn cache_version_only_discovery(
    store: &mut AgentRuntimeStore,
    runner: BaseCodingAgent,
    detected_version: Option<String>,
) {
    let now = Utc::now();
    store
        .discoveries
        .entry(runner)
        .and_modify(|entry| {
            entry.last_checked_at = now;
            entry.last_error = None;
            if let Some(version) = detected_version.clone() {
                entry.version = Some(version);
            }
        })
        .or_insert_with(|| AgentRuntimeDiscovery {
            models: Vec::new(),
            version: detected_version,
            last_checked_at: now,
            last_error: None,
        });
}

fn version_for_discovery_update(
    store: &AgentRuntimeStore,
    runner: BaseCodingAgent,
    detected_version: Option<String>,
) -> Option<String> {
    detected_version.or_else(|| {
        store
            .discoveries
            .get(&runner)
            .and_then(|entry| entry.version.clone())
    })
}

async fn discover_models_for_executor(
    executor: &CodingAgent,
    current_dir: &Path,
    env: &ExecutionEnv,
) -> Result<Option<Vec<String>>, String> {
    executor
        .list_models(current_dir, env)
        .await
        .map_err(|err| err.to_string())
}

fn build_statuses(
    profiles: &ExecutorConfigs,
    store: &AgentRuntimeStore,
) -> Vec<AgentRuntimeStatus> {
    let mut runners = profiles
        .executors
        .iter()
        .filter_map(|(runner, config)| {
            let base = config
                .get_default()
                .or_else(|| config.configurations.values().next())?;
            Some(build_status(*runner, config, base, store))
        })
        .collect::<Vec<_>>();
    runners.sort_by_key(|status| status.runner_type.to_string());
    runners
}

fn runtime_discovery_needs_refresh(profiles: &ExecutorConfigs, store: &AgentRuntimeStore) -> bool {
    let now = Utc::now();
    profiles.executors.iter().any(|(runner, executor_config)| {
        let Some(base) = executor_config
            .get_default()
            .or_else(|| executor_config.configurations.values().next())
        else {
            return false;
        };
        if !base.get_availability_info().is_available() {
            return false;
        }
        store
            .discoveries
            .get(runner)
            .map(|discovery| now - discovery.last_checked_at >= DISCOVERY_TTL)
            .unwrap_or(true)
    })
}

fn build_status(
    runner: BaseCodingAgent,
    executor_config: &ExecutorConfig,
    base: &CodingAgent,
    store: &AgentRuntimeStore,
) -> AgentRuntimeStatus {
    let config = store
        .configs
        .get(&runner)
        .cloned()
        .unwrap_or_else(|| default_config(runner));
    let discovery = store.discoveries.get(&runner);
    let availability = base.get_availability_info();
    let installed = availability.is_available();
    let executable = installed && config.run_mode != AgentRunMode::Disabled;

    AgentRuntimeStatus {
        runner_type: runner,
        installed,
        executable,
        availability,
        discovered_models: models_for_runner(runner, executor_config, store),
        model_source: model_source_for_runner(runner, executor_config, store),
        version: discovery.and_then(|entry| entry.version.clone()),
        last_checked_at: discovery.map(|entry| entry.last_checked_at),
        last_error: discovery.and_then(|entry| entry.last_error.clone()),
        run_mode: config.run_mode,
        env_summary: summarize_env(&config.env_json),
        executor_options: config.executor_options,
    }
}

fn reasoning_capability_for_runner(
    runner: BaseCodingAgent,
) -> Option<AgentRuntimeReasoningCapability> {
    match runner {
        BaseCodingAgent::ClaudeCode => Some(AgentRuntimeReasoningCapability::Effort {
            options: strings(["low", "medium", "high"]),
        }),
        BaseCodingAgent::Codex => Some(AgentRuntimeReasoningCapability::Effort {
            options: strings(["low", "medium", "high", "xhigh"]),
        }),
        BaseCodingAgent::Droid => Some(AgentRuntimeReasoningCapability::Effort {
            options: strings(["none", "dynamic", "off", "low", "medium", "high"]),
        }),
        BaseCodingAgent::Gemini => Some(AgentRuntimeReasoningCapability::Effort {
            options: strings(["off", "low", "medium", "high", "max"]),
        }),
        BaseCodingAgent::Opencode | BaseCodingAgent::OpenTeamsCli => {
            Some(AgentRuntimeReasoningCapability::Effort {
                options: strings(["thinking-low", "thinking-medium", "thinking-high"]),
            })
        }
        BaseCodingAgent::QwenCode => Some(AgentRuntimeReasoningCapability::Effort {
            options: strings(["off", "low", "medium", "high", "max"]),
        }),
        BaseCodingAgent::Amp
        | BaseCodingAgent::CursorAgent
        | BaseCodingAgent::Copilot
        | BaseCodingAgent::KimiCode => None,
        #[cfg(feature = "qa-mode")]
        BaseCodingAgent::QaMock => None,
    }
}

pub fn reasoning_capability_for_runner_type(
    runner: BaseCodingAgent,
) -> Option<AgentRuntimeReasoningCapability> {
    reasoning_capability_for_runner(runner)
}

fn strings<const N: usize>(values: [&str; N]) -> Vec<String> {
    values.into_iter().map(String::from).collect()
}

fn models_for_runner(
    runner: BaseCodingAgent,
    executor_config: &ExecutorConfig,
    store: &AgentRuntimeStore,
) -> Vec<String> {
    let mut models = BTreeSet::new();

    if let Some(discovery) = store.discoveries.get(&runner)
        && !discovery.models.is_empty()
    {
        models.extend(discovery.models.iter().cloned());
    }

    models.extend(configured_models(executor_config));
    models.into_iter().collect()
}

fn model_source_for_runner(
    runner: BaseCodingAgent,
    executor_config: &ExecutorConfig,
    store: &AgentRuntimeStore,
) -> AgentRuntimeModelSource {
    if let Some(discovery) = store.discoveries.get(&runner)
        && !discovery.models.is_empty()
    {
        return AgentRuntimeModelSource::Runner;
    }

    if configured_models(executor_config).is_empty() {
        AgentRuntimeModelSource::None
    } else {
        AgentRuntimeModelSource::ProfileFallback
    }
}

fn configured_models(executor_config: &ExecutorConfig) -> Vec<String> {
    let mut models = BTreeSet::new();
    for config in executor_config.configurations.values() {
        if let Some(model) = model_name(config) {
            models.insert(model.to_string());
        }
    }
    models.into_iter().collect()
}

fn model_name(config: &CodingAgent) -> Option<&str> {
    match config {
        CodingAgent::Codex(config) => config.model.as_deref(),
        CodingAgent::ClaudeCode(config) => config.model.as_deref(),
        CodingAgent::Gemini(config) => config.model.as_deref(),
        CodingAgent::Opencode(config) => config.model.as_deref(),
        CodingAgent::OpenTeamsCli(config) => config.model.as_deref(),
        CodingAgent::QwenCode(config) => config.model.as_deref(),
        CodingAgent::CursorAgent(config) => config.model.as_deref(),
        CodingAgent::Copilot(config) => config.model.as_deref(),
        CodingAgent::Droid(config) => config.model.as_deref(),
        CodingAgent::KimiCode(config) => config.model.as_deref(),
        #[cfg(feature = "qa-mode")]
        CodingAgent::QaMock(_) => None,
        _ => None,
    }
}

fn rename_model_in_profiles(
    profiles: &mut ExecutorConfigs,
    defaults: &ExecutorConfigs,
    runner: BaseCodingAgent,
    old_model: &str,
    new_model: &str,
) -> Result<bool, AgentRuntimeError> {
    let executor_config = profiles
        .executors
        .get_mut(&runner)
        .ok_or_else(|| AgentRuntimeError::UnknownRunner(runner.to_string()))?;
    let Some(target_key) = find_model_variant_key(executor_config, old_model) else {
        return Err(AgentRuntimeError::ModelNotFound(old_model.to_string()));
    };
    let current_config = executor_config
        .configurations
        .get(&target_key)
        .cloned()
        .ok_or_else(|| AgentRuntimeError::ModelNotFound(old_model.to_string()))?;
    let next_config = with_model(&current_config, new_model)
        .ok_or(AgentRuntimeError::UnsupportedModelRunner(runner))?;

    if next_config == current_config {
        return Ok(false);
    }

    let next_key = canonical_variant_key(new_model);
    if next_key == "DEFAULT" && target_key != "DEFAULT" {
        return Err(AgentRuntimeError::InvalidModelName(new_model.to_string()));
    }

    let target_is_builtin = defaults
        .executors
        .get(&runner)
        .is_some_and(|default_config| {
            default_config.configurations.contains_key(&target_key)
                || default_config
                    .configurations
                    .keys()
                    .any(|key| canonical_variant_key(key) == target_key)
        });

    if target_key == "DEFAULT" || target_is_builtin {
        executor_config
            .configurations
            .insert(target_key, next_config);
        return Ok(true);
    }

    executor_config.configurations.remove(&target_key);
    executor_config.configurations.insert(next_key, next_config);
    Ok(true)
}

fn find_model_variant_key(executor_config: &ExecutorConfig, model: &str) -> Option<String> {
    let canonical_key = canonical_variant_key(model);
    if canonical_key != "DEFAULT"
        && executor_config
            .configurations
            .get(&canonical_key)
            .and_then(model_name)
            == Some(model)
    {
        return Some(canonical_key);
    }

    let mut matching_keys = executor_config
        .configurations
        .iter()
        .filter(|(key, config)| key.as_str() != "DEFAULT" && model_name(config) == Some(model))
        .map(|(key, _)| key.clone())
        .collect::<Vec<_>>();
    matching_keys.sort();

    matching_keys.into_iter().next().or_else(|| {
        executor_config
            .configurations
            .get("DEFAULT")
            .and_then(model_name)
            .filter(|default_model| *default_model == model)
            .map(|_| "DEFAULT".to_string())
    })
}

fn runtime_status_for_runner(
    runner: BaseCodingAgent,
) -> Result<AgentRuntimeStatus, AgentRuntimeError> {
    list_runtime_statuses()?
        .runners
        .into_iter()
        .find(|status| status.runner_type == runner)
        .ok_or_else(|| AgentRuntimeError::UnknownRunner(runner.to_string()))
}

fn default_config(runner: BaseCodingAgent) -> AgentRuntimeConfig {
    AgentRuntimeConfig {
        runner_type: runner,
        run_mode: AgentRunMode::Auto,
        env_json: HashMap::new(),
        executor_options: serde_json::json!({}),
        updated_at: Utc::now(),
    }
}

fn summarize_env(env: &HashMap<String, String>) -> Vec<AgentRuntimeEnvSummary> {
    let mut summaries = env
        .iter()
        .map(|(key, value)| AgentRuntimeEnvSummary {
            key: key.clone(),
            value: value.clone(),
        })
        .collect::<Vec<_>>();
    summaries.sort_by(|a, b| a.key.cmp(&b.key));
    summaries
}

fn validate_env_json(env: &HashMap<String, String>) -> Result<(), AgentRuntimeError> {
    for key in env.keys() {
        validate_env_key(key)?;
    }
    Ok(())
}

fn validate_env_key(key: &str) -> Result<(), AgentRuntimeError> {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return Err(AgentRuntimeError::InvalidEnvKey(key.to_string()));
    };
    if !(first == '_' || first.is_ascii_alphabetic()) {
        return Err(AgentRuntimeError::InvalidEnvKey(key.to_string()));
    }
    if chars.any(|ch| !(ch == '_' || ch.is_ascii_alphanumeric())) {
        return Err(AgentRuntimeError::InvalidEnvKey(key.to_string()));
    }
    Ok(())
}

fn normalize_model_name(model_name: &str) -> Result<String, AgentRuntimeError> {
    let model = model_name.trim();
    if model.is_empty() || model.contains('\n') || model.contains('\r') {
        return Err(AgentRuntimeError::InvalidModelName(model.to_string()));
    }
    Ok(model.to_string())
}

fn read_store(path: &Path) -> Result<AgentRuntimeStore, AgentRuntimeError> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(serde_json::from_str(&content)?),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(AgentRuntimeStore::default()),
        Err(err) => Err(err.into()),
    }
}

fn write_store(path: &Path, store: &AgentRuntimeStore) -> Result<(), AgentRuntimeError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(store)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use executors::executors::{AppendPrompt, kimi::KimiCode};

    use super::*;

    fn model_agent(model: Option<&str>) -> CodingAgent {
        CodingAgent::KimiCode(KimiCode {
            append_prompt: AppendPrompt::default(),
            model: model.map(str::to_string),
            yolo: None,
            cmd: Default::default(),
        })
    }

    #[test]
    fn env_key_validation_accepts_shell_safe_names() {
        let mut env = HashMap::new();
        env.insert("OPENAI_API_KEY".to_string(), "secret".to_string());
        env.insert("_CUSTOM_1".to_string(), "secret".to_string());

        assert!(validate_env_json(&env).is_ok());
    }

    #[test]
    fn env_key_validation_rejects_invalid_names() {
        let mut env = HashMap::new();
        env.insert("BAD-NAME".to_string(), "secret".to_string());

        assert!(matches!(
            validate_env_json(&env),
            Err(AgentRuntimeError::InvalidEnvKey(key)) if key == "BAD-NAME"
        ));
    }

    #[test]
    fn env_summary_includes_values() {
        let mut env = HashMap::new();
        env.insert("OPENAI_API_KEY".to_string(), "sk-test".to_string());

        let summary = summarize_env(&env);

        assert_eq!(summary[0].key, "OPENAI_API_KEY");
        assert_eq!(summary[0].value, "sk-test");
    }

    #[test]
    fn cli_version_output_prefers_stdout_and_trims() {
        let version =
            normalize_cli_version_output(b"\n codex-cli 0.125.0 \n", b"npm notice ignored\n");

        assert_eq!(version.as_deref(), Some("codex-cli 0.125.0"));
    }

    #[test]
    fn cli_version_output_falls_back_to_stderr() {
        let version = normalize_cli_version_output(b"", b"\nclaude-code 2.1.74\n");

        assert_eq!(version.as_deref(), Some("claude-code 2.1.74"));
    }

    #[test]
    fn discovery_update_version_prefers_detected_then_cached() {
        let runner = BaseCodingAgent::Opencode;
        let mut store = AgentRuntimeStore::default();
        store.discoveries.insert(
            runner,
            AgentRuntimeDiscovery {
                models: vec!["openai/gpt-5.2-codex".to_string()],
                version: Some("opencode 1.2.23".to_string()),
                last_checked_at: Utc::now(),
                last_error: None,
            },
        );

        assert_eq!(
            version_for_discovery_update(&store, runner, Some("opencode 1.2.24".to_string()))
                .as_deref(),
            Some("opencode 1.2.24")
        );
        assert_eq!(
            version_for_discovery_update(&store, runner, None).as_deref(),
            Some("opencode 1.2.23")
        );
    }

    #[test]
    fn version_only_discovery_clears_stale_error_and_preserves_models() {
        let runner = BaseCodingAgent::Opencode;
        let mut store = AgentRuntimeStore::default();
        store.discoveries.insert(
            runner,
            AgentRuntimeDiscovery {
                models: vec!["openai/gpt-5.2-codex".to_string()],
                version: Some("opencode 1.2.23".to_string()),
                last_checked_at: Utc::now(),
                last_error: Some("temporary provider failure".to_string()),
            },
        );

        cache_version_only_discovery(&mut store, runner, Some("opencode 1.2.24".to_string()));

        let discovery = store
            .discoveries
            .get(&runner)
            .expect("runtime discovery should remain cached");
        assert_eq!(discovery.models, vec!["openai/gpt-5.2-codex"]);
        assert_eq!(discovery.version.as_deref(), Some("opencode 1.2.24"));
        assert_eq!(discovery.last_error, None);
    }

    #[test]
    fn refresh_failure_preserves_old_discovery_models() {
        let runner = BaseCodingAgent::Opencode;
        let mut configs = HashMap::new();
        configs.insert(
            runner,
            AgentRuntimeDiscovery {
                models: vec!["openai/gpt-5.2-codex".to_string()],
                version: None,
                last_checked_at: Utc::now(),
                last_error: None,
            },
        );
        let store = AgentRuntimeStore {
            configs: HashMap::new(),
            discoveries: configs,
        };
        let executor_config = ExecutorConfig::new_with_default(model_agent(None));

        let models = models_for_runner(runner, &executor_config, &store);

        assert_eq!(models, vec!["openai/gpt-5.2-codex"]);
    }

    #[test]
    fn aggregation_returns_runner_config_and_models() {
        let runner = BaseCodingAgent::KimiCode;
        let mut executors = HashMap::new();
        executors.insert(
            runner,
            ExecutorConfig::new_with_default(model_agent(Some("kimi-k2.5"))),
        );
        let profiles = ExecutorConfigs { executors };
        let mut runtime = default_config(runner);
        runtime.run_mode = AgentRunMode::Local;
        runtime
            .env_json
            .insert("KIMI_API_KEY".to_string(), "secret".to_string());
        let mut store = AgentRuntimeStore::default();
        store.configs.insert(runner, runtime);

        let statuses = build_statuses(&profiles, &store);

        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].runner_type, runner);
        assert_eq!(statuses[0].run_mode, AgentRunMode::Local);
        assert_eq!(statuses[0].discovered_models, vec!["kimi-k2.5"]);
        assert_eq!(
            statuses[0].model_source,
            AgentRuntimeModelSource::ProfileFallback
        );
        assert_eq!(statuses[0].env_summary[0].value, "secret");
    }

    #[test]
    fn model_source_prefers_runner_discovery_over_profile_fallback() {
        let runner = BaseCodingAgent::Opencode;
        let mut store = AgentRuntimeStore::default();
        store.discoveries.insert(
            runner,
            AgentRuntimeDiscovery {
                models: vec!["opencode/free-model".to_string()],
                version: None,
                last_checked_at: Utc::now(),
                last_error: None,
            },
        );
        let executor_config =
            ExecutorConfig::new_with_default(model_agent(Some("profile/fallback-model")));

        assert_eq!(
            models_for_runner(runner, &executor_config, &store),
            vec!["opencode/free-model", "profile/fallback-model"]
        );
        assert_eq!(
            model_source_for_runner(runner, &executor_config, &store),
            AgentRuntimeModelSource::Runner
        );
    }

    #[test]
    fn model_source_reports_none_when_no_models_are_available() {
        let runner = BaseCodingAgent::OpenTeamsCli;
        let store = AgentRuntimeStore::default();
        let executor_config = ExecutorConfig::new_with_default(model_agent(None));

        assert_eq!(
            model_source_for_runner(runner, &executor_config, &store),
            AgentRuntimeModelSource::None
        );
    }

    #[test]
    fn rename_custom_model_updates_original_variant_key() {
        let runner = BaseCodingAgent::KimiCode;
        let mut executor_config = ExecutorConfig::new_with_default(model_agent(Some("default")));
        executor_config
            .configurations
            .insert("OLD_MODEL".to_string(), model_agent(Some("old-model")));
        let defaults = ExecutorConfigs {
            executors: HashMap::from([(
                runner,
                ExecutorConfig::new_with_default(model_agent(Some("default"))),
            )]),
        };
        let mut profiles = ExecutorConfigs {
            executors: HashMap::from([(runner, executor_config)]),
        };

        let changed =
            rename_model_in_profiles(&mut profiles, &defaults, runner, "old-model", "new-model")
                .unwrap();

        let configurations = &profiles.executors[&runner].configurations;
        assert!(changed);
        assert!(!configurations.contains_key("OLD_MODEL"));
        assert_eq!(
            configurations.get("NEW_MODEL").and_then(model_name),
            Some("new-model")
        );
    }

    #[test]
    fn rename_builtin_model_preserves_original_variant_key() {
        let runner = BaseCodingAgent::KimiCode;
        let mut executor_config = ExecutorConfig::new_with_default(model_agent(Some("default")));
        executor_config
            .configurations
            .insert("OLD_MODEL".to_string(), model_agent(Some("old-model")));
        let defaults = ExecutorConfigs {
            executors: HashMap::from([(runner, executor_config.clone())]),
        };
        let mut profiles = ExecutorConfigs {
            executors: HashMap::from([(runner, executor_config)]),
        };

        let changed =
            rename_model_in_profiles(&mut profiles, &defaults, runner, "old-model", "new-model")
                .unwrap();

        let configurations = &profiles.executors[&runner].configurations;
        assert!(changed);
        assert!(configurations.contains_key("OLD_MODEL"));
        assert!(!configurations.contains_key("NEW_MODEL"));
        assert_eq!(
            configurations.get("OLD_MODEL").and_then(model_name),
            Some("new-model")
        );
    }

    #[test]
    fn rename_model_requires_existing_profile_model() {
        let runner = BaseCodingAgent::KimiCode;
        let executor_config = ExecutorConfig::new_with_default(model_agent(Some("default")));
        let defaults = ExecutorConfigs {
            executors: HashMap::from([(runner, executor_config.clone())]),
        };
        let mut profiles = ExecutorConfigs {
            executors: HashMap::from([(runner, executor_config)]),
        };

        let error =
            rename_model_in_profiles(&mut profiles, &defaults, runner, "missing", "new-model")
                .unwrap_err();

        assert!(matches!(
            error,
            AgentRuntimeError::ModelNotFound(model) if model == "missing"
        ));
    }

    #[test]
    fn config_store_round_trips_runtime_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("runtime.json");
        let runner = BaseCodingAgent::KimiCode;
        let mut runtime = default_config(runner);
        runtime.run_mode = AgentRunMode::Disabled;
        runtime.executor_options = serde_json::json!({
            "yolo": true,
            "cmd": {
                "base_command_override": "kimi-dev"
            }
        });
        runtime
            .env_json
            .insert("KIMI_API_KEY".to_string(), "secret".to_string());
        let mut store = AgentRuntimeStore::default();
        store.configs.insert(runner, runtime);

        write_store(&path, &store).unwrap();
        let restored = read_store(&path).unwrap();

        let restored_config = restored.configs.get(&runner).unwrap();
        assert_eq!(restored_config.runner_type, runner);
        assert_eq!(restored_config.run_mode, AgentRunMode::Disabled);
        assert_eq!(restored_config.env_json["KIMI_API_KEY"], "secret");
        assert_eq!(restored_config.executor_options["yolo"], true);
    }

    #[test]
    fn executor_options_merge_into_default_executor() {
        let runner = BaseCodingAgent::KimiCode;
        let mut runtime = default_config(runner);
        runtime.executor_options = serde_json::json!({
            "model": "kimi-k2.6",
            "yolo": true
        });
        let mut store = AgentRuntimeStore::default();
        store.configs.insert(runner, runtime);
        let mut executor = model_agent(Some("gpt-5.2-codex"));
        let mut env = ExecutionEnv::new(Default::default(), false, String::new());

        apply_config_to_executor_and_env(runner, &mut executor, &mut env, &store).unwrap();

        assert_eq!(model_name(&executor), Some("kimi-k2.6"));
        let CodingAgent::KimiCode(config) = executor else {
            panic!("expected KimiCode executor");
        };
        assert_eq!(config.yolo, Some(true));
    }

    #[test]
    fn session_env_wins_over_agent_env_on_conflict() {
        let runner = BaseCodingAgent::KimiCode;
        let mut runtime = default_config(runner);
        runtime
            .env_json
            .insert("VK_CHAT_SESSION_ID".to_string(), "agent".to_string());
        runtime
            .env_json
            .insert("OPENAI_API_KEY".to_string(), "agent-key".to_string());
        let mut store = AgentRuntimeStore::default();
        store.configs.insert(runner, runtime);
        let mut executor = model_agent(None);
        let mut env = ExecutionEnv::new(Default::default(), false, String::new());
        env.insert("VK_CHAT_SESSION_ID", "session");

        apply_config_to_executor_and_env(runner, &mut executor, &mut env, &store).unwrap();

        assert_eq!(
            env.get("VK_CHAT_SESSION_ID").map(String::as_str),
            Some("session")
        );
        assert_eq!(
            env.get("OPENAI_API_KEY").map(String::as_str),
            Some("agent-key")
        );
    }

    #[test]
    fn serialized_runtime_status_has_no_model_override_or_reasoning_level() {
        let status = AgentRuntimeStatus {
            runner_type: BaseCodingAgent::Codex,
            installed: true,
            executable: true,
            availability: AvailabilityInfo::InstallationFound,
            discovered_models: vec!["gpt-5.2-codex".to_string()],
            model_source: AgentRuntimeModelSource::Runner,
            version: None,
            last_checked_at: None,
            last_error: None,
            run_mode: AgentRunMode::Auto,
            env_summary: Vec::new(),
            executor_options: serde_json::json!({ "ask_for_approval": "never" }),
        };

        let value = serde_json::to_value(status).unwrap();

        assert!(value.get("model_override").is_none());
        assert!(value.get("reasoning_level").is_none());
        assert!(value.get("model_reasoning_effort").is_none());
        assert_eq!(value["executor_options"]["ask_for_approval"], "never");
    }

    #[test]
    fn reasoning_capabilities_include_opencode_family_effort() {
        for runner in [BaseCodingAgent::Opencode, BaseCodingAgent::OpenTeamsCli] {
            let capability = reasoning_capability_for_runner(runner)
                .unwrap_or_else(|| panic!("{runner} should expose reasoning capability"));
            assert_eq!(
                capability,
                AgentRuntimeReasoningCapability::Effort {
                    options: vec![
                        "thinking-low".to_string(),
                        "thinking-medium".to_string(),
                        "thinking-high".to_string(),
                    ],
                }
            );
        }
    }
}
