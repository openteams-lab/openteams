use std::{
    collections::{BTreeSet, HashSet},
    net::IpAddr,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use command_group::{AsyncCommandGroup, AsyncGroupChild};
use jsonc_parser::ParseOptions;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{ChildStdin, ChildStdout, Command},
    time::timeout,
};
use ts_rs::TS;

use crate::{
    command::{CmdOverrides, CommandBuilder, apply_overrides, redacted_command},
    env::ExecutionEnv,
    executors::ExecutorError,
};

const CLI_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(8);
const PROVIDER_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(10);

/// Model identifiers and capabilities reported by the selected runner/account.
/// `None` means the runner did not report reasoning support; an empty list means
/// the model explicitly does not support an effort override.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct ExecutorModelInfo {
    pub id: String,
    pub display_name: Option<String>,
    pub reasoning_efforts: Option<Vec<String>>,
    pub default_reasoning_effort: Option<String>,
}

impl From<String> for ExecutorModelInfo {
    fn from(id: String) -> Self {
        Self {
            id,
            display_name: None,
            reasoning_efforts: None,
            default_reasoning_effort: None,
        }
    }
}

pub fn validate_model_effort(
    catalog: &[ExecutorModelInfo],
    model: Option<&str>,
    effort: Option<&str>,
) -> Result<(), ExecutorError> {
    let (Some(model), Some(effort)) = (model, effort) else {
        return Ok(());
    };
    if let Some(options) = catalog
        .iter()
        .find(|info| info.id == model)
        .and_then(|info| info.reasoning_efforts.as_ref())
        && !options.iter().any(|option| option == effort)
    {
        return Err(ExecutorError::Configuration(format!(
            "Model {model} does not support reasoning effort {effort}; supported values: {}. Refresh models or update the member configuration.",
            options.join(", ")
        )));
    }
    Ok(())
}

/// A short-lived, prompt-free protocol probe shared by native JSONL adapters.
/// Stderr is discarded: CLI startup errors can contain credentials or config.
pub(crate) struct ModelDiscoveryProcess {
    child: AsyncGroupChild,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
}

impl Drop for ModelDiscoveryProcess {
    fn drop(&mut self) {
        // Cancellation must also terminate descendants launched through npx.
        if self.child.id().is_some() {
            let _ = self.child.start_kill();
        }
    }
}

impl ModelDiscoveryProcess {
    pub async fn start(
        builder: CommandBuilder,
        current_dir: &Path,
        env: &ExecutionEnv,
        remove_env: &[&str],
    ) -> Result<Self, ExecutorError> {
        let (program, args) = builder.build_initial()?.into_resolved().await?;
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(current_dir)
            .kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .env("NO_COLOR", "1")
            .env("NPM_CONFIG_LOGLEVEL", "error");
        env.apply_to_command(&mut command);
        for key in remove_env {
            command.env_remove(key);
        }
        let mut child = command.group_spawn()?;
        let stdin = child.inner().stdin.take().expect("piped discovery stdin");
        let stdout = child.inner().stdout.take().expect("piped discovery stdout");
        Ok(Self {
            child,
            stdin,
            lines: BufReader::new(stdout).lines(),
        })
    }

    pub async fn send(&mut self, message: &Value) -> Result<(), ExecutorError> {
        let mut bytes = serde_json::to_vec(message)?;
        bytes.push(b'\n');
        self.stdin.write_all(&bytes).await?;
        self.stdin.flush().await?;
        Ok(())
    }

    pub async fn receive(&mut self) -> Result<Value, ExecutorError> {
        while let Some(line) = self.lines.next_line().await? {
            if let Ok(message) = serde_json::from_str(&line) {
                return Ok(message);
            }
        }
        Err(ExecutorError::Io(std::io::Error::other(
            "model discovery process exited before responding",
        )))
    }

    pub async fn stop(&mut self) {
        let _ = self.child.kill().await;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    OpenAiCompatible,
    Anthropic,
    Google,
    Ollama,
}

#[derive(Debug, Clone)]
pub struct ProviderEndpoint {
    pub kind: ProviderKind,
    pub base_url: String,
    pub api_key: Option<String>,
}

#[derive(Default)]
pub struct ModelCollector {
    models: BTreeSet<String>,
}

impl ModelCollector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, value: impl AsRef<str>) {
        if let Some(model) = normalize_model_id(value.as_ref()) {
            self.models.insert(model);
        }
    }

    pub fn add_optional(&mut self, value: Option<&str>) {
        if let Some(value) = value {
            self.add(value);
        }
    }

    pub fn add_value_models(&mut self, value: &Value) {
        collect_models_from_json(value, &mut self.models);
    }

    pub fn finish(self) -> Option<Vec<String>> {
        if self.models.is_empty() {
            None
        } else {
            Some(self.models.into_iter().collect())
        }
    }
}

pub async fn discover_from_sources(
    current_dir: &Path,
    env: &ExecutionEnv,
    cmd: &CmdOverrides,
    configured_model: Option<&str>,
    config_paths: Vec<PathBuf>,
    cli_commands: Vec<CommandBuilder>,
    env_provider_kinds: &[ProviderKind],
) -> Result<Option<Vec<String>>, ExecutorError> {
    let mut collector = ModelCollector::new();
    collector.add_optional(configured_model);

    let mut provider_endpoints = provider_endpoints_from_env(env, env_provider_kinds);
    for path in config_paths {
        if let Some(value) = read_config_value(&path).await? {
            collector.add_value_models(&value);
            provider_endpoints.extend(collect_provider_endpoints_from_json(&value));
        }
    }

    for builder in cli_commands {
        discover_from_cli_command(current_dir, env, cmd, builder, &mut collector).await?;
    }

    provider_endpoints.extend(local_provider_endpoints_from_env(env));
    resolve_provider_endpoint_keys(&mut provider_endpoints, env);
    provider_endpoints = dedupe_provider_endpoints(provider_endpoints);

    for endpoint in provider_endpoints {
        discover_from_provider_endpoint(&endpoint, &mut collector).await;
    }

    Ok(collector.finish())
}

pub fn runner_config_paths(paths: impl IntoIterator<Item = Option<PathBuf>>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .flatten()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

pub fn help_command(base: impl Into<String>, cmd: &CmdOverrides) -> Option<CommandBuilder> {
    apply_overrides(
        CommandBuilder::new(base.into()).extend_params(["--help"]),
        cmd,
    )
    .ok()
}

pub fn cli_model_commands(base: impl Into<String>, cmd: &CmdOverrides) -> Vec<CommandBuilder> {
    let base = base.into();
    [
        vec!["models", "--json"],
        vec!["models", "list", "--json"],
        vec!["model", "list", "--json"],
        vec!["models"],
    ]
    .into_iter()
    .filter_map(|args| {
        apply_overrides(CommandBuilder::new(base.clone()).extend_params(args), cmd).ok()
    })
    .collect()
}

pub fn model_slugs_from_models_json(value: &Value) -> Vec<String> {
    let mut models = BTreeSet::new();
    if let Some(models_value) = value.get("models") {
        collect_model_slugs(models_value, &mut models);
    }
    models.into_iter().collect()
}

/// Run a CLI command that returns a top-level `models` object and collect only
/// its keys. This intentionally does not recurse through provider credentials
/// or other configuration values.
pub async fn discover_model_map_from_cli_command(
    current_dir: &Path,
    env: &ExecutionEnv,
    cmd: &CmdOverrides,
    builder: CommandBuilder,
) -> Result<Option<Vec<String>>, ExecutorError> {
    let command_parts = builder.build_initial()?;
    let unresolved_command = command_parts.redacted_display();
    let (program, args) = match command_parts.into_resolved().await {
        Ok(parts) => parts,
        Err(ExecutorError::ExecutableNotFound { .. }) => return Ok(None),
        Err(err) => {
            return Err(command_diagnostic_error(
                &unresolved_command,
                "resolve model discovery executable",
                err,
            ));
        }
    };
    let command_display = redacted_command(&program.display().to_string(), &args);

    let mut command = Command::new(program);
    command
        .kill_on_drop(true)
        .current_dir(current_dir)
        .env("NPM_CONFIG_LOGLEVEL", "error")
        .env("NODE_NO_WARNINGS", "1")
        .env("NO_COLOR", "1")
        .args(args);
    env.clone().with_profile(cmd).apply_to_command(&mut command);

    let output = match timeout(CLI_DISCOVERY_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) => {
            return Err(command_diagnostic_error(
                &command_display,
                "execute model discovery command",
                err,
            ));
        }
        Err(_) => {
            return Err(command_diagnostic_error(
                &command_display,
                "execute model discovery command",
                "timed out after 8 seconds",
            ));
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr.trim().chars().take(512).collect::<String>();
        let result = if detail.is_empty() {
            format!(
                "process exited with {} and produced no error output",
                output.status
            )
        } else {
            format!("process exited with {}; stderr: {detail}", output.status)
        };
        return Err(command_diagnostic_error(
            &command_display,
            "execute model discovery command",
            result,
        ));
    }
    let value = serde_json::from_slice::<Value>(&output.stdout).map_err(|error| {
        command_diagnostic_error(
            &command_display,
            "parse model discovery output as JSON",
            error,
        )
    })?;
    let models = model_ids_from_model_map_json(&value);
    if models.is_empty() {
        return Err(command_diagnostic_error(
            &command_display,
            "validate model discovery output",
            "command returned no model aliases",
        ));
    }
    Ok(Some(models))
}

pub fn model_ids_from_model_map_json(value: &Value) -> Vec<String> {
    let Some(models) = value.get("models").and_then(Value::as_object) else {
        return Vec::new();
    };
    models
        .keys()
        .filter_map(|model| {
            let model = model.trim();
            (!model.is_empty()
                && model.len() <= 160
                && !model.contains(char::is_whitespace)
                && !model.contains("://"))
            .then(|| model.to_string())
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
}

fn collect_model_slugs(value: &Value, models: &mut BTreeSet<String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_model_slugs(item, models);
            }
        }
        Value::Object(map) => {
            if let Some(model) = map
                .get("slug")
                .and_then(Value::as_str)
                .and_then(normalize_model_id)
            {
                models.insert(model);
            }
        }
        _ => {}
    }
}

pub async fn read_config_value(path: &Path) -> Result<Option<Value>, ExecutorError> {
    let content = match tokio::fs::read_to_string(path).await {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => {
            return Err(config_diagnostic_error(path, "read configuration", err));
        }
    };
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Ok(Some(Value::Object(Default::default())));
    }

    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("toml"))
    {
        let value: toml::Value = toml::from_str(trimmed)
            .map_err(|error| config_diagnostic_error(path, "parse TOML configuration", error))?;
        return Ok(Some(serde_json::to_value(value).map_err(|error| {
            config_diagnostic_error(path, "convert TOML configuration", error)
        })?));
    }

    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json") || ext.eq_ignore_ascii_case("jsonc"))
        && let Ok(Some(value)) =
            jsonc_parser::parse_to_serde_value(trimmed, &ParseOptions::default())
    {
        return Ok(Some(value));
    }

    Ok(Some(serde_json::from_str(trimmed).map_err(|error| {
        config_diagnostic_error(path, "parse JSON/JSONC configuration", error)
    })?))
}

fn command_diagnostic_error(
    command: &str,
    operation: &str,
    result: impl std::fmt::Display,
) -> ExecutorError {
    ExecutorError::Io(std::io::Error::other(format!(
        "command=`{command}`; operation={operation}; result={}",
        result.to_string().trim()
    )))
}

fn config_diagnostic_error(
    path: &Path,
    operation: &str,
    result: impl std::fmt::Display,
) -> ExecutorError {
    ExecutorError::Io(std::io::Error::other(format!(
        "source=`{}`; operation={operation}; result={}",
        path.display(),
        result.to_string().trim()
    )))
}

async fn discover_from_cli_command(
    current_dir: &Path,
    env: &ExecutionEnv,
    cmd: &CmdOverrides,
    builder: CommandBuilder,
    collector: &mut ModelCollector,
) -> Result<(), ExecutorError> {
    let command_parts = builder.build_initial()?;
    let unresolved_command = command_parts.redacted_display();
    let (program, args) = match command_parts.into_resolved().await {
        Ok(parts) => parts,
        Err(ExecutorError::ExecutableNotFound { .. }) => return Ok(()),
        Err(err) => {
            return Err(command_diagnostic_error(
                &unresolved_command,
                "resolve model discovery executable",
                err,
            ));
        }
    };
    let command_display = redacted_command(&program.display().to_string(), &args);

    let mut command = Command::new(program);
    command
        .kill_on_drop(true)
        .current_dir(current_dir)
        .env("NPM_CONFIG_LOGLEVEL", "error")
        .env("NODE_NO_WARNINGS", "1")
        .env("NO_COLOR", "1")
        .args(args);
    env.clone().with_profile(cmd).apply_to_command(&mut command);

    let output = match timeout(CLI_DISCOVERY_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) => {
            return Err(command_diagnostic_error(
                &command_display,
                "execute model discovery command",
                err,
            ));
        }
        Err(_) => return Ok(()),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    collect_models_from_cli_output(&stdout, collector);
    collect_models_from_cli_output(&stderr, collector);
    Ok(())
}

fn collect_models_from_cli_output(output: &str, collector: &mut ModelCollector) {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return;
    }
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        collector.add_value_models(&value);
        return;
    }

    for line in trimmed.lines() {
        let line = strip_ansi_escapes::strip_str(line);
        let clean = line
            .trim()
            .trim_matches(|c: char| c == '`' || c == '"' || c == '\'' || c == ',' || c == ';');
        if looks_like_model_id(clean) {
            collector.add(clean);
        }
    }
}

fn collect_models_from_json(value: &Value, models: &mut BTreeSet<String>) {
    match value {
        Value::String(value) => {
            if looks_like_model_id(value)
                && let Some(model) = normalize_model_id(value)
            {
                models.insert(model);
            }
        }
        Value::Array(values) => {
            values
                .iter()
                .for_each(|value| collect_models_from_json(value, models));
        }
        Value::Object(object) => {
            for (key, value) in object {
                let key_lower = key.to_ascii_lowercase();
                if let Some(model) = normalize_model_id(key) {
                    models.insert(model);
                }
                if is_model_collection_key(&key_lower) {
                    match value {
                        Value::Object(map) => {
                            for (model_id, model_value) in map {
                                if let Some(model) = normalize_model_id(model_id) {
                                    models.insert(model);
                                }
                                collect_models_from_json(model_value, models);
                            }
                        }
                        other => collect_models_from_json(other, models),
                    }
                    continue;
                }

                if is_model_scalar_key(&key_lower) {
                    collect_models_from_json(value, models);
                    continue;
                }

                if matches!(value, Value::Array(_) | Value::Object(_) | Value::String(_)) {
                    collect_models_from_json(value, models);
                }
            }
        }
        _ => {}
    }
}

fn is_model_collection_key(key: &str) -> bool {
    matches!(
        key,
        "models"
            | "availablemodels"
            | "available_models"
            | "modelconfigs"
            | "model_configs"
            | "modeloverrides"
            | "model_overrides"
            | "aliases"
            | "profiles"
    )
}

fn is_model_scalar_key(key: &str) -> bool {
    matches!(
        key,
        "model"
            | "modelid"
            | "model_id"
            | "modelname"
            | "model_name"
            | "id"
            | "defaultmodel"
            | "default_model"
            | "default"
            | "small_fast_model"
            | "large_model"
    )
}

fn collect_provider_endpoints_from_json(value: &Value) -> Vec<ProviderEndpoint> {
    let mut endpoints = Vec::new();
    collect_provider_endpoints_from_json_inner(value, None, &mut endpoints);
    endpoints
}

fn collect_provider_endpoints_from_json_inner(
    value: &Value,
    provider_hint: Option<&str>,
    endpoints: &mut Vec<ProviderEndpoint>,
) {
    match value {
        Value::Array(values) => {
            for value in values {
                collect_provider_endpoints_from_json_inner(value, provider_hint, endpoints);
            }
        }
        Value::Object(object) => {
            let hint = object
                .get("id")
                .or_else(|| object.get("name"))
                .or_else(|| object.get("provider"))
                .and_then(Value::as_str)
                .or(provider_hint);
            let kind = provider_kind_from_hint(hint);
            let api_key = find_provider_api_key(object);

            if let Some(base_url) = find_string_key(
                object,
                &[
                    "base_url",
                    "baseURL",
                    "baseUrl",
                    "api_base",
                    "apiBase",
                    "apiBaseUrl",
                    "api_base_url",
                    "endpoint",
                    "url",
                ],
            ) {
                endpoints.push(ProviderEndpoint {
                    kind: kind.unwrap_or(ProviderKind::OpenAiCompatible),
                    base_url,
                    api_key,
                });
            } else if let Some(kind) = kind
                && (api_key.as_deref().is_some_and(has_value) || kind == ProviderKind::Ollama)
                && let Some(base_url) = default_provider_base_url(kind, hint)
            {
                endpoints.push(ProviderEndpoint {
                    kind,
                    base_url,
                    api_key,
                });
            }

            for (key, value) in object {
                collect_provider_endpoints_from_json_inner(value, Some(key), endpoints);
            }
        }
        _ => {}
    }
}

fn find_provider_api_key(object: &serde_json::Map<String, Value>) -> Option<String> {
    find_string_key(
        object,
        &[
            "api_key",
            "apiKey",
            "key",
            "token",
            "authToken",
            "bearerToken",
        ],
    )
    .or_else(|| {
        find_string_key(object, &["api_key_env", "apiKeyEnv", "envKey", "keyEnv"]).and_then(
            |env_key| {
                std::env::var(&env_key)
                    .ok()
                    .filter(|value| has_value(value))
                    .or_else(|| Some(format!("env:{env_key}")))
            },
        )
    })
}

fn find_string_key(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.contains("***"))
        .map(ToOwned::to_owned)
}

fn provider_kind_from_hint(hint: Option<&str>) -> Option<ProviderKind> {
    let hint = hint?.trim().to_ascii_lowercase();
    if hint.contains("anthropic") || hint.contains("claude") {
        Some(ProviderKind::Anthropic)
    } else if hint.contains("google") || hint.contains("gemini") {
        Some(ProviderKind::Google)
    } else if hint.contains("ollama") {
        Some(ProviderKind::Ollama)
    } else if hint.contains("openai")
        || hint.contains("openrouter")
        || hint.contains("moonshot")
        || hint.contains("kimi")
        || hint.contains("dashscope")
        || hint.contains("qwen")
        || hint.contains("copilot")
        || hint.contains("github")
    {
        Some(ProviderKind::OpenAiCompatible)
    } else {
        None
    }
}

fn provider_endpoints_from_env(
    env: &ExecutionEnv,
    provider_kinds: &[ProviderKind],
) -> Vec<ProviderEndpoint> {
    let mut endpoints = Vec::new();
    for kind in provider_kinds {
        match kind {
            ProviderKind::OpenAiCompatible => {
                push_openai_compatible_env_endpoint(
                    env,
                    &mut endpoints,
                    "https://api.openai.com/v1",
                    &["OPENAI_API_KEY"],
                    &["OPENAI_BASE_URL", "OPENAI_API_BASE", "OPENAI_API_BASE_URL"],
                );
                push_openai_compatible_env_endpoint(
                    env,
                    &mut endpoints,
                    "https://openrouter.ai/api/v1",
                    &["OPENROUTER_API_KEY"],
                    &["OPENROUTER_BASE_URL"],
                );
                push_openai_compatible_env_endpoint(
                    env,
                    &mut endpoints,
                    "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    &["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
                    &["DASHSCOPE_BASE_URL", "QWEN_BASE_URL"],
                );
                push_openai_compatible_env_endpoint(
                    env,
                    &mut endpoints,
                    "https://api.moonshot.ai/v1",
                    &["MOONSHOT_API_KEY", "KIMI_API_KEY"],
                    &["MOONSHOT_BASE_URL", "KIMI_BASE_URL"],
                );
                push_openai_compatible_env_endpoint(
                    env,
                    &mut endpoints,
                    "https://models.github.ai",
                    &["GITHUB_TOKEN", "GH_TOKEN", "COPILOT_TOKEN"],
                    &["GITHUB_MODELS_BASE_URL"],
                );
            }
            ProviderKind::Anthropic => {
                if let Some(api_key) = first_env(env, &["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]) {
                    endpoints.push(ProviderEndpoint {
                        kind: ProviderKind::Anthropic,
                        base_url: first_env(env, &["ANTHROPIC_BASE_URL"])
                            .unwrap_or_else(|| "https://api.anthropic.com".to_string()),
                        api_key: Some(api_key),
                    });
                }
            }
            ProviderKind::Google => {
                if let Some(api_key) = first_env(env, &["GEMINI_API_KEY", "GOOGLE_API_KEY"]) {
                    endpoints.push(ProviderEndpoint {
                        kind: ProviderKind::Google,
                        base_url: first_env(env, &["GEMINI_BASE_URL", "GOOGLE_AI_BASE_URL"])
                            .unwrap_or_else(|| {
                                "https://generativelanguage.googleapis.com".to_string()
                            }),
                        api_key: Some(api_key),
                    });
                }
            }
            ProviderKind::Ollama => {
                if let Some(base_url) = first_env(env, &["OLLAMA_HOST", "OLLAMA_BASE_URL"]) {
                    endpoints.push(ProviderEndpoint {
                        kind: ProviderKind::Ollama,
                        base_url,
                        api_key: None,
                    });
                }
            }
        }
    }
    endpoints
}

fn resolve_provider_endpoint_keys(endpoints: &mut [ProviderEndpoint], env: &ExecutionEnv) {
    for endpoint in endpoints {
        let Some(api_key) = endpoint.api_key.as_deref() else {
            continue;
        };
        let Some(env_key) = api_key.strip_prefix("env:") else {
            continue;
        };
        endpoint.api_key = env_value(env, env_key);
    }
}

fn default_provider_base_url(kind: ProviderKind, hint: Option<&str>) -> Option<String> {
    match kind {
        ProviderKind::Anthropic => Some("https://api.anthropic.com".to_string()),
        ProviderKind::Google => Some("https://generativelanguage.googleapis.com".to_string()),
        ProviderKind::Ollama => Some("http://localhost:11434".to_string()),
        ProviderKind::OpenAiCompatible => {
            let hint = hint?.trim().to_ascii_lowercase();
            if hint.contains("openrouter") {
                Some("https://openrouter.ai/api/v1".to_string())
            } else if hint.contains("dashscope") || hint.contains("qwen") {
                Some("https://dashscope.aliyuncs.com/compatible-mode/v1".to_string())
            } else if hint.contains("moonshot") || hint.contains("kimi") {
                Some("https://api.moonshot.ai/v1".to_string())
            } else if hint.contains("github") || hint.contains("copilot") {
                Some("https://models.github.ai".to_string())
            } else if hint.contains("openai") {
                Some("https://api.openai.com/v1".to_string())
            } else {
                None
            }
        }
    }
}

fn local_provider_endpoints_from_env(env: &ExecutionEnv) -> Vec<ProviderEndpoint> {
    let mut endpoints = Vec::new();
    for key in [
        "LOCAL_OPENAI_BASE_URL",
        "OPENAI_COMPATIBLE_BASE_URL",
        "CUSTOM_OPENAI_BASE_URL",
    ] {
        if let Some(base_url) = env_value(env, key)
            && is_local_or_private_endpoint(&base_url)
        {
            endpoints.push(ProviderEndpoint {
                kind: ProviderKind::OpenAiCompatible,
                base_url,
                api_key: first_env(env, &["LOCAL_OPENAI_API_KEY", "OPENAI_COMPATIBLE_API_KEY"]),
            });
        }
    }
    endpoints
}

fn push_openai_compatible_env_endpoint(
    env: &ExecutionEnv,
    endpoints: &mut Vec<ProviderEndpoint>,
    default_base_url: &str,
    api_key_names: &[&str],
    base_url_names: &[&str],
) {
    let api_key = first_env(env, api_key_names);
    let base_url = first_env(env, base_url_names).unwrap_or_else(|| default_base_url.to_string());
    if api_key.is_some() || is_local_or_private_endpoint(&base_url) {
        endpoints.push(ProviderEndpoint {
            kind: ProviderKind::OpenAiCompatible,
            base_url,
            api_key,
        });
    }
}

fn first_env(env: &ExecutionEnv, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| env_value(env, key))
}

fn env_value(env: &ExecutionEnv, key: &str) -> Option<String> {
    env.get(key)
        .cloned()
        .or_else(|| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| has_value(value) && !value.contains("***"))
}

fn dedupe_provider_endpoints(endpoints: Vec<ProviderEndpoint>) -> Vec<ProviderEndpoint> {
    let mut seen = HashSet::new();
    endpoints
        .into_iter()
        .filter(|endpoint| {
            let key = format!(
                "{:?}:{}:{}",
                endpoint.kind,
                endpoint.base_url.trim_end_matches('/'),
                endpoint.api_key.as_deref().unwrap_or_default()
            );
            seen.insert(key)
        })
        .collect()
}

async fn discover_from_provider_endpoint(
    endpoint: &ProviderEndpoint,
    collector: &mut ModelCollector,
) {
    let has_key = endpoint.api_key.as_deref().is_some_and(has_value);
    if !has_key && !is_local_or_private_endpoint(&endpoint.base_url) {
        return;
    }

    let Some(url) = provider_models_url(endpoint) else {
        return;
    };
    let Ok(client) = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
    else {
        return;
    };

    let mut request = client.get(url).timeout(PROVIDER_DISCOVERY_TIMEOUT);
    match endpoint.kind {
        ProviderKind::Anthropic => {
            let Some(api_key) = &endpoint.api_key else {
                return;
            };
            request = request
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01");
        }
        ProviderKind::Google => {
            if let Some(api_key) = &endpoint.api_key {
                request = request.header("x-goog-api-key", api_key);
            }
        }
        ProviderKind::OpenAiCompatible => {
            if let Some(api_key) = &endpoint.api_key {
                request = request.header("Authorization", format!("Bearer {api_key}"));
            }
        }
        ProviderKind::Ollama => {}
    }

    let Ok(response) = request.send().await else {
        return;
    };
    let Ok(response) = response.error_for_status() else {
        return;
    };
    let Ok(value) = response.json::<Value>().await else {
        return;
    };
    collector.add_value_models(&value);
}

fn provider_models_url(endpoint: &ProviderEndpoint) -> Option<String> {
    let mut base = endpoint.base_url.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return None;
    }

    match endpoint.kind {
        ProviderKind::Ollama => {
            if base.ends_with("/api/tags") {
                Some(base)
            } else {
                Some(format!("{base}/api/tags"))
            }
        }
        ProviderKind::Anthropic => {
            if base.ends_with("/models") {
                Some(base)
            } else if base.ends_with("/v1") {
                Some(format!("{base}/models"))
            } else {
                Some(format!("{base}/v1/models"))
            }
        }
        ProviderKind::Google => {
            if base.ends_with("/models") {
                Some(base)
            } else if base.ends_with("/v1beta") {
                Some(format!("{base}/models"))
            } else {
                Some(format!("{base}/v1beta/models"))
            }
        }
        ProviderKind::OpenAiCompatible => {
            if base.ends_with("/catalog/models") {
                return Some(base);
            }
            if base.ends_with("/models") {
                Some(base)
            } else if base.ends_with("/v1") || base.contains("/compatible-mode/v1") {
                Some(format!("{base}/models"))
            } else {
                base.push_str("/v1/models");
                Some(base)
            }
        }
    }
}

fn is_local_or_private_endpoint(raw: &str) -> bool {
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    if matches!(host, "localhost" | "127.0.0.1" | "::1") {
        return true;
    }
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        Ok(IpAddr::V6(ip)) => ip.is_loopback() || ip.is_unique_local(),
        Err(_) => false,
    }
}

fn normalize_model_id(raw: &str) -> Option<String> {
    let model = raw
        .trim()
        .trim_matches(|c: char| c == '`' || c == '"' || c == '\'' || c == ',' || c == ';');
    if !looks_like_model_id(model) {
        return None;
    }
    Some(model.to_string())
}

fn looks_like_model_id(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || value.len() > 160 || value.contains(char::is_whitespace) {
        return false;
    }
    if value.starts_with("http://") || value.starts_with("https://") || value.contains("://") {
        return false;
    }
    let lower = value.to_ascii_lowercase();
    if matches!(lower.as_str(), "auto" | "smart" | "deep" | "rush" | "free") {
        return true;
    }
    if value.contains('/') {
        return value
            .split('/')
            .all(|part| !part.is_empty() && model_token_chars(part));
    }
    model_token_chars(value)
        && [
            "gpt-",
            "o1",
            "o3",
            "o4",
            "codex-",
            "claude-",
            "sonnet",
            "opus",
            "haiku",
            "gemini-",
            "qwen",
            "kimi-",
            "moonshot-",
            "deepseek-",
            "grok-",
            "glm-",
            "cursor-",
            "composer-",
            "llama",
            "mistral",
            "mixtral",
            "yi-",
            "minimax",
        ]
        .iter()
        .any(|prefix| lower.starts_with(prefix))
}

fn model_token_chars(value: &str) -> bool {
    value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':' | '/'))
}

fn has_value(value: &str) -> bool {
    !value.trim().is_empty()
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn model_discovery_effort_validation_uses_each_models_reported_options() {
        let catalog = vec![ExecutorModelInfo {
            id: "gpt-6.2-sol".to_string(),
            display_name: None,
            reasoning_efforts: Some(vec!["low".to_string(), "high".to_string()]),
            default_reasoning_effort: Some("low".to_string()),
        }];
        assert!(validate_model_effort(&catalog, Some("gpt-6.2-sol"), Some("high")).is_ok());
        assert!(validate_model_effort(&catalog, Some("gpt-6.2-sol"), Some("ultra")).is_err());
        assert!(validate_model_effort(&catalog, Some("gpt-6.2-sol"), None).is_ok());
        assert!(validate_model_effort(&catalog, Some("custom-model"), Some("ultra")).is_ok());
        let unsupported = vec![ExecutorModelInfo {
            reasoning_efforts: Some(vec![]),
            ..catalog[0].clone()
        }];
        assert!(validate_model_effort(&unsupported, Some("gpt-6.2-sol"), Some("low")).is_err());
    }

    #[tokio::test]
    async fn reads_json_extension_config_with_jsonc_syntax() {
        let temp_dir = TempDir::new().expect("create temp dir");
        let config_path = temp_dir.path().join("config.json");
        tokio::fs::write(
            &config_path,
            r#"// User-level Copilot configuration
            {
                "model": "gpt-5.3-codex",
            }
            "#,
        )
        .await
        .expect("write JSONC config");

        let value = read_config_value(&config_path)
            .await
            .expect("parse JSONC stored with a .json extension")
            .expect("config value");

        assert_eq!(value["model"], "gpt-5.3-codex");
    }

    #[tokio::test]
    async fn config_parse_error_identifies_source_operation_and_result() {
        let temp_dir = TempDir::new().expect("create temp dir");
        let config_path = temp_dir.path().join("config.json");
        tokio::fs::write(&config_path, "{not valid json")
            .await
            .expect("write invalid config");

        let error = read_config_value(&config_path)
            .await
            .expect_err("invalid configuration should fail")
            .to_string();

        assert!(error.contains(&format!("source=`{}`", config_path.display())));
        assert!(error.contains("operation=parse JSON/JSONC configuration"));
        assert!(error.contains("result="));
    }

    #[test]
    fn extracts_configured_models_from_nested_config_shapes() {
        let value = json!({
            "model": "gpt-5.3-codex",
            "modelConfigs": {
                "aliases": {
                    "openteams-member": {
                        "modelConfig": { "model": "gemini-3-pro-preview" }
                    }
                }
            },
            "profiles": {
                "fast": { "model": "qwen3-coder-flash" }
            },
            "providers": {
                "custom": {
                    "models": {
                        "provider/custom-model": {}
                    }
                }
            }
        });

        let mut collector = ModelCollector::new();
        collector.add_value_models(&value);
        let models = collector.finish().expect("models");

        assert!(models.contains(&"gpt-5.3-codex".to_string()));
        assert!(models.contains(&"gemini-3-pro-preview".to_string()));
        assert!(models.contains(&"qwen3-coder-flash".to_string()));
        assert!(models.contains(&"provider/custom-model".to_string()));
    }

    #[test]
    fn provider_models_url_preserves_existing_models_path() {
        let endpoint = ProviderEndpoint {
            kind: ProviderKind::OpenAiCompatible,
            base_url: "http://127.0.0.1:1234/v1".to_string(),
            api_key: None,
        };
        assert_eq!(
            provider_models_url(&endpoint).as_deref(),
            Some("http://127.0.0.1:1234/v1/models")
        );
    }

    #[test]
    fn skips_remote_no_key_endpoint() {
        assert!(!is_local_or_private_endpoint("https://api.openai.com/v1"));
        assert!(is_local_or_private_endpoint("http://localhost:11434"));
        assert!(is_local_or_private_endpoint("http://192.168.1.12:8080/v1"));
    }

    #[test]
    fn configured_provider_with_key_gets_default_endpoint() {
        let value = json!({
            "providers": {
                "openrouter": {
                    "api_key": "sk-or-test"
                },
                "ollama": {}
            }
        });

        let endpoints = collect_provider_endpoints_from_json(&value);

        assert!(endpoints.iter().any(|endpoint| {
            endpoint.kind == ProviderKind::OpenAiCompatible
                && endpoint.base_url == "https://openrouter.ai/api/v1"
                && endpoint.api_key.as_deref() == Some("sk-or-test")
        }));
        assert!(endpoints.iter().any(|endpoint| {
            endpoint.kind == ProviderKind::Ollama && endpoint.base_url == "http://localhost:11434"
        }));
    }

    #[test]
    fn provider_api_key_env_resolves_from_runtime_env() {
        let mut endpoint = ProviderEndpoint {
            kind: ProviderKind::OpenAiCompatible,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: Some("env:CUSTOM_API_KEY".to_string()),
        };
        let mut env = ExecutionEnv::new(Default::default(), false, String::new());
        env.insert("CUSTOM_API_KEY", "runtime-key");

        resolve_provider_endpoint_keys(std::slice::from_mut(&mut endpoint), &env);

        assert_eq!(endpoint.api_key.as_deref(), Some("runtime-key"));
    }

    #[test]
    fn extracts_models_from_claude_model_cache_shapes() {
        let value = json!({
            "claude-sonnet-4-5-20250929": {
                "display_name": "Claude Sonnet 4.5"
            },
            "models": [
                { "id": "claude-opus-4-1-20250805" },
                "claude-haiku-4-5-20251001"
            ],
            "default_model": "sonnet"
        });

        let mut collector = ModelCollector::new();
        collector.add_value_models(&value);
        let models = collector.finish().expect("models");

        assert!(models.contains(&"claude-sonnet-4-5-20250929".to_string()));
        assert!(models.contains(&"claude-opus-4-1-20250805".to_string()));
        assert!(models.contains(&"claude-haiku-4-5-20251001".to_string()));
        assert!(models.contains(&"sonnet".to_string()));
    }

    #[test]
    fn extracts_codex_models_cache_slugs() {
        let value = json!({
            "fetched_at": "2026-06-03T00:00:00Z",
            "etag": null,
            "models": [
                { "slug": "gpt-5.4", "display_name": "GPT-5.4" },
                { "slug": "gpt-5.3-codex", "display_name": "GPT-5.3 Codex" },
                { "slug": "", "display_name": "empty" }
            ]
        });

        let models = model_slugs_from_models_json(&value);

        assert_eq!(models, vec!["gpt-5.3-codex", "gpt-5.4"]);
    }

    #[test]
    fn extracts_only_top_level_model_map_keys() {
        let value = json!({
            "providers": {
                "custom": {
                    "api_key": "secret/that-must-not-be-a-model"
                }
            },
            "models": {
                "kimi-code/k3": {
                    "model": "vendor-internal-model"
                },
                "kimi-code/kimi-for-coding": {},
                "private-alias": {}
            }
        });
        let models = model_ids_from_model_map_json(&value);

        assert_eq!(
            models,
            vec![
                "kimi-code/k3".to_string(),
                "kimi-code/kimi-for-coding".to_string(),
                "private-alias".to_string()
            ]
        );
    }
}
