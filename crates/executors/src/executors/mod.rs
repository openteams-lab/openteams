use std::{
    cmp,
    fs::{self, File},
    path::{Path, PathBuf},
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};

use async_trait::async_trait;
use command_group::AsyncGroupChild;
use enum_dispatch::enum_dispatch;
use futures::stream::BoxStream;
use futures_io::Error as FuturesIoError;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sqlx::Type;
use strum_macros::{Display, EnumDiscriminants, EnumString, VariantNames};
use thiserror::Error;
use tokio::io::{AsyncRead, ReadBuf};
use ts_rs::TS;
use workspace_utils::msg_store::MsgStore;

#[cfg(feature = "qa-mode")]
use crate::executors::acp::AcpQaExecutor;
#[cfg(feature = "qa-mode")]
use crate::executors::qa_mock::QaMockExecutor;
use crate::{
    actions::{ExecutorAction, review::RepoReviewContext},
    approvals::ExecutorApprovalService,
    command::{CommandBuildError, CommandParts},
    env::{ExecutionEnv, SensitiveValueRedactor, SensitiveValueStreamRedactor},
    executors::{
        amp::Amp, claude::ClaudeCode, codex::Codex, copilot::Copilot, cursor::CursorAgent,
        deepseek_harness::DeepseekHarness, droid::Droid, gemini::Gemini, hermes::Hermes,
        kimi::KimiCode, kiro::KiroCli, opencode::Opencode, openteams_cli::OpenTeamsCli, pi::Pi,
        qoder::QoderCli, qwen::QwenCode,
    },
    logs::utils::patch,
    mcp_config::{McpConfig, MemberMcpConfig},
    mcp_run::{McpRunContext, PreparedMcpRun},
    skill_config::{
        NativeDiscoveredSkill, NativeSkillConfigBackend, list_native_skills,
        set_native_skill_enabled,
    },
};

pub mod acp;
pub mod amp;
pub mod claude;
pub mod codex;
pub mod copilot;
pub mod cursor;
pub mod deepseek_harness;
pub mod droid;
pub mod gemini;
pub mod hermes;
pub mod kimi;
pub mod kiro;
pub mod opencode;
pub mod openteams_cli;
pub mod pi;
#[cfg(feature = "qa-mode")]
pub mod qa_mock;
pub mod qoder;
pub mod qwen;
pub mod utils;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct SlashCommandDescription {
    /// Command name without the leading slash, e.g. `help` for `/help`.
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Provider-neutral structured user prompt. Executors that support rich
/// content can forward image blocks; text-only executors retain the exact
/// markdown prompt through the default trait methods.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutorPrompt {
    pub text: String,
    pub images: Vec<ExecutorPromptImage>,
}

impl ExecutorPrompt {
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            images: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutorPromptImage {
    pub data: String,
    pub mime_type: String,
    pub uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(use_ts_enum)]
pub enum BaseAgentCapability {
    SessionFork,
    /// Agent requires a setup script before it can run (e.g., login, installation)
    SetupHelper,
    /// Agent reports context/token usage information
    ContextUsage,
}

#[derive(Debug, Error)]
pub enum ExecutorError {
    #[error("Follow-up is not supported: {0}")]
    FollowUpNotSupported(String),
    #[error(transparent)]
    SpawnError(#[from] FuturesIoError),
    #[error("Unknown executor type: {0}")]
    UnknownExecutorType(String),
    #[error("I/O error: {0}")]
    Io(std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    TomlSerialize(#[from] toml::ser::Error),
    #[error(transparent)]
    TomlDeserialize(#[from] toml::de::Error),
    #[error(transparent)]
    Yaml(#[from] serde_yaml::Error),
    #[error(transparent)]
    ExecutorApprovalError(#[from] crate::approvals::ExecutorApprovalError),
    #[error(transparent)]
    CommandBuild(#[from] CommandBuildError),
    #[error("Executable `{program}` not found in PATH")]
    ExecutableNotFound { program: String },
    #[error("Setup helper not supported")]
    SetupHelperNotSupported,
    #[error("Auth required: {0}")]
    AuthRequired(String),
    #[error("Configuration error: {0}")]
    Configuration(String),
    #[error("MCP is not supported by this executor")]
    McpNotSupported,
    #[error("Run-scoped MCP isolation is not implemented by this executor")]
    McpIsolationNotImplemented,
}

#[enum_dispatch]
#[derive(
    Debug, Clone, Serialize, Deserialize, PartialEq, TS, Display, EnumDiscriminants, VariantNames,
)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE")]
#[strum_discriminants(
    name(BaseCodingAgent),
    // Only add Hash; Eq/PartialEq are already provided by EnumDiscriminants.
    derive(EnumString, Hash, strum_macros::Display, Serialize, Deserialize, TS, Type),
    strum(serialize_all = "SCREAMING_SNAKE_CASE"),
    ts(use_ts_enum),
    serde(rename_all = "SCREAMING_SNAKE_CASE"),
    sqlx(type_name = "TEXT", rename_all = "SCREAMING_SNAKE_CASE")
)]
pub enum CodingAgent {
    ClaudeCode,
    Amp,
    Gemini,
    Codex,
    Opencode,
    OpenTeamsCli,
    #[serde(alias = "CURSOR")]
    #[strum_discriminants(serde(alias = "CURSOR"))]
    #[strum_discriminants(strum(serialize = "CURSOR", serialize = "CURSOR_AGENT"))]
    CursorAgent,
    QwenCode,
    Copilot,
    Droid,
    KimiCode,
    QoderCli,
    Pi,
    Hermes,
    KiroCli,
    DeepseekHarness,
    #[cfg(feature = "qa-mode")]
    QaMock(QaMockExecutor),
    #[cfg(feature = "qa-mode")]
    AcpQa(AcpQaExecutor),
}

impl CodingAgent {
    pub fn set_acp_mcp_policy(&mut self, policy: acp::mcp::AcpMcpPolicy) {
        match self {
            Self::Gemini(config) => config.acp_mcp_policy = policy,
            Self::QwenCode(config) => config.acp_mcp_policy = policy,
            Self::KimiCode(config) => config.acp_mcp_policy = policy,
            Self::QoderCli(config) => config.acp_mcp_policy = policy,
            Self::Pi(config) => config.acp_mcp_policy = policy,
            Self::Hermes(config) => config.acp_mcp_policy = policy,
            Self::KiroCli(config) => config.acp_mcp_policy = policy,
            #[cfg(feature = "qa-mode")]
            Self::AcpQa(config) => config.acp_mcp_policy = policy,
            _ => {}
        }
    }

    pub fn get_mcp_config(&self) -> McpConfig {
        match self {
            Self::Codex(_) => McpConfig::new(
                vec!["mcp_servers".to_string()],
                serde_json::json!({
                    "mcp_servers": {}
                }),
                self.preconfigured_mcp(),
                true,
            ),
            Self::Amp(_) => McpConfig::new(
                vec!["amp.mcpServers".to_string()],
                serde_json::json!({
                    "amp.mcpServers": {}
                }),
                self.preconfigured_mcp(),
                false,
            ),
            Self::Opencode(_) => McpConfig::new(
                vec!["mcp".to_string()],
                serde_json::json!({
                    "mcp": {},
                    "$schema": "https://opencode.ai/config.json"
                }),
                self.preconfigured_mcp(),
                false,
            ),
            Self::OpenTeamsCli(_) => McpConfig::new(
                vec!["mcp".to_string()],
                serde_json::json!({
                    "mcp": {}
                }),
                self.preconfigured_mcp(),
                false,
            ),
            Self::Droid(_) => McpConfig::new(
                vec!["mcpServers".to_string()],
                serde_json::json!({
                    "mcpServers": {}
                }),
                self.preconfigured_mcp(),
                false,
            ),
            Self::Hermes(_) => McpConfig::new(
                vec!["mcp_servers".to_string()],
                serde_json::json!({
                    "mcp_servers": {}
                }),
                self.preconfigured_mcp(),
                false,
            ),
            _ => McpConfig::new(
                vec!["mcpServers".to_string()],
                serde_json::json!({
                    "mcpServers": {}
                }),
                self.preconfigured_mcp(),
                false,
            ),
        }
    }

    pub fn supports_mcp(&self) -> bool {
        StandardCodingAgentExecutor::supports_mcp(self)
    }

    pub fn capabilities(&self) -> Vec<BaseAgentCapability> {
        match self {
            Self::ClaudeCode(_) => vec![
                BaseAgentCapability::SessionFork,
                BaseAgentCapability::ContextUsage,
            ],
            Self::Opencode(_) | Self::OpenTeamsCli(_) => vec![
                BaseAgentCapability::SessionFork,
                BaseAgentCapability::ContextUsage,
            ],
            Self::Codex(_) => vec![
                BaseAgentCapability::SessionFork,
                BaseAgentCapability::SetupHelper,
                BaseAgentCapability::ContextUsage,
            ],
            Self::Amp(_) | Self::Gemini(_) | Self::QwenCode(_) | Self::Droid(_) => {
                vec![BaseAgentCapability::SessionFork]
            }
            Self::CursorAgent(_) => vec![BaseAgentCapability::SetupHelper],
            Self::Copilot(_) => vec![],
            Self::KimiCode(_) | Self::QoderCli(_) | Self::Pi(_) => vec![
                BaseAgentCapability::SessionFork,
                BaseAgentCapability::SetupHelper,
            ],
            Self::Hermes(_) => vec![BaseAgentCapability::ContextUsage],
            Self::KiroCli(_) | Self::DeepseekHarness(_) => vec![],
            #[cfg(feature = "qa-mode")]
            Self::QaMock(_) | Self::AcpQa(_) => vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum AvailabilityInfo {
    LoginDetected { last_auth_timestamp: i64 },
    InstallationFound,
    NotFound,
}

impl AvailabilityInfo {
    pub fn is_available(&self) -> bool {
        matches!(
            self,
            AvailabilityInfo::LoginDetected { .. } | AvailabilityInfo::InstallationFound
        )
    }
}

fn authentication_detected(
    env: &ExecutionEnv,
    auth_env_vars: &[&str],
    cli_auth_detected: bool,
) -> bool {
    cli_auth_detected
        || auth_env_vars.iter().any(|key| {
            env.get(key).is_some_and(|value| !value.trim().is_empty())
                || std::env::var_os(key).is_some_and(|value| !value.is_empty())
        })
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum AcpModelFallback {
    #[default]
    Allowed,
    Disabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcpProbeAuthState {
    Authenticated,
    Unauthenticated,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AcpProbeInterpretation {
    pub models: Option<Vec<String>>,
    pub auth_state: Option<AcpProbeAuthState>,
    pub model_fallback: AcpModelFallback,
}

impl AcpProbeInterpretation {
    pub fn from_probe(probe: &acp::AcpCapabilityProbe) -> Self {
        Self {
            models: probe.model_ids(),
            auth_state: None,
            model_fallback: AcpModelFallback::Allowed,
        }
    }
}

#[async_trait]
#[enum_dispatch(CodingAgent)]
pub trait StandardCodingAgentExecutor {
    fn use_approvals(&mut self, _approvals: Arc<dyn ExecutorApprovalService>) {}

    fn overlay_acp_execution_options(&mut self, _higher_priority: &acp::AcpExecutionOptions) {}

    fn acp_full_access_enabled(&self) -> bool {
        false
    }

    async fn available_slash_commands(
        &self,
        _workdir: &Path,
    ) -> Result<BoxStream<'static, json_patch::Patch>, ExecutorError> {
        Ok(Box::pin(futures::stream::once(async move {
            patch::slash_commands(Vec::new(), false, None)
        })))
    }

    async fn list_models(
        &self,
        _current_dir: &Path,
        _env: &ExecutionEnv,
    ) -> Result<Option<Vec<String>>, ExecutorError> {
        Ok(None)
    }

    /// Rich model discovery; older adapters retain their existing ID-only API.
    async fn discover_model_catalog(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<Option<Vec<crate::model_discovery::ExecutorModelInfo>>, ExecutorError> {
        Ok(self
            .list_models(current_dir, env)
            .await?
            .map(|models| models.into_iter().map(Into::into).collect()))
    }

    /// Validate adapter-specific selections against previously discovered capabilities.
    fn validate_model_catalog(
        &self,
        _catalog: &[crate::model_discovery::ExecutorModelInfo],
    ) -> Result<(), ExecutorError> {
        Ok(())
    }

    async fn probe_acp(
        &self,
        _current_dir: &Path,
        _env: &ExecutionEnv,
        _auth_method_id: Option<&str>,
    ) -> Result<Option<acp::AcpCapabilityProbe>, ExecutorError> {
        Ok(None)
    }

    /// Exact executor-owned launch command shown by runtime diagnostics.
    /// Adapters with checkout-relative or otherwise structured commands can
    /// expose them without adding concrete-runner branches to shared services.
    fn runtime_command_for_diagnostics(&self) -> Result<Option<CommandParts>, ExecutorError> {
        Ok(None)
    }

    /// Exact executor-owned version command shown by runtime diagnostics.
    ///
    /// Adapters whose version command differs from the generic `<base> --version`
    /// shape can expose it without adding concrete-runner branches to shared
    /// services.
    fn version_command_for_diagnostics(&self) -> Result<Option<CommandParts>, ExecutorError> {
        Ok(None)
    }

    fn acp_model_fallback(&self) -> AcpModelFallback {
        AcpModelFallback::Allowed
    }

    fn interpret_acp_probe(&self, probe: &acp::AcpCapabilityProbe) -> AcpProbeInterpretation {
        let mut interpretation = AcpProbeInterpretation::from_probe(probe);
        interpretation.model_fallback = self.acp_model_fallback();
        interpretation
    }

    /// Report whether this CLI can currently authenticate model requests.
    /// Production executors override this with their CLI-specific OAuth and
    /// provider configuration rules.
    fn is_authenticated(&self, _env: &ExecutionEnv) -> bool {
        matches!(
            self.get_availability_info(),
            AvailabilityInfo::LoginDetected { .. }
        )
    }

    /// Probe whether the effective executor environment can authenticate.
    ///
    /// Most adapters can answer synchronously from their existing login
    /// artifacts or environment variables. Adapters with a vendor-owned
    /// account command can override this method without exposing account data.
    async fn probe_authentication(
        &self,
        _current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<bool, ExecutorError> {
        Ok(self.is_authenticated(env))
    }

    /// Shared authentication primitive used by executor-specific detectors.
    /// A CLI login artifact, an executor runtime/profile variable, or a
    /// process environment variable with a non-blank value is sufficient.
    fn authentication_detected(
        &self,
        env: &ExecutionEnv,
        auth_env_vars: &[&str],
        cli_auth_detected: bool,
    ) -> bool {
        authentication_detected(env, auth_env_vars, cli_auth_detected)
    }

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError>;

    async fn spawn_structured(
        &self,
        current_dir: &Path,
        prompt: &ExecutorPrompt,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn(current_dir, &prompt.text, env).await
    }

    /// Continue a session, optionally resetting to a specific message.
    async fn spawn_follow_up(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: &str,
        reset_to_message_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError>;

    async fn spawn_follow_up_structured(
        &self,
        current_dir: &Path,
        prompt: &ExecutorPrompt,
        session_id: &str,
        reset_to_message_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn_follow_up(
            current_dir,
            &prompt.text,
            session_id,
            reset_to_message_id,
            env,
        )
        .await
    }

    async fn spawn_review(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        match session_id {
            Some(id) => {
                self.spawn_follow_up(current_dir, prompt, id, None, env)
                    .await
            }
            None => self.spawn(current_dir, prompt, env).await,
        }
    }

    fn normalize_logs(&self, _raw_logs_event_store: Arc<MsgStore>, _worktree_path: &Path);

    /// Primary runner settings file shown by runtime diagnostics.
    ///
    /// Most runners keep their MCP servers in the primary settings file, so
    /// the compatibility default matches the MCP path. Runners with a separate
    /// MCP file override this independently.
    fn default_runtime_config_path(&self) -> Option<std::path::PathBuf> {
        self.default_mcp_config_path()
    }

    // MCP configuration methods
    fn default_mcp_config_path(&self) -> Option<std::path::PathBuf>;

    /// Whether this executor accepts member MCP configuration for a run.
    ///
    /// The default preserves the historical behavior for adapters whose MCP
    /// support is represented by a vendor config path. Pure runtime-injection
    /// adapters can override this without claiming ownership of vendor files.
    fn supports_mcp(&self) -> bool {
        self.default_mcp_config_path().is_some()
    }

    async fn prepare_mcp_for_run(
        &mut self,
        canonical: &MemberMcpConfig,
        _context: &McpRunContext,
        _env: &mut ExecutionEnv,
    ) -> Result<PreparedMcpRun, ExecutorError> {
        let prepared = PreparedMcpRun::new(canonical)?;
        if self.default_mcp_config_path().is_some() {
            return Err(ExecutorError::McpIsolationNotImplemented);
        }
        if prepared.server_count() > 0 {
            return Err(ExecutorError::McpNotSupported);
        }
        Ok(prepared)
    }

    fn default_skill_config_path(&self) -> Option<std::path::PathBuf> {
        None
    }

    fn native_skill_discovery_roots(&self) -> Vec<std::path::PathBuf> {
        Vec::new()
    }

    fn native_skill_config_backend(&self) -> NativeSkillConfigBackend {
        NativeSkillConfigBackend::Unsupported
    }

    async fn list_native_skills(&self) -> Result<Vec<NativeDiscoveredSkill>, ExecutorError> {
        list_native_skills(
            self.native_skill_config_backend(),
            self.default_skill_config_path(),
            self.native_skill_discovery_roots(),
        )
        .await
    }

    async fn set_native_skill_enabled(
        &self,
        skill_name: &str,
        skill_path: &Path,
        enabled: bool,
    ) -> Result<(), ExecutorError> {
        set_native_skill_enabled(
            self.native_skill_config_backend(),
            self.default_skill_config_path(),
            skill_name,
            skill_path,
            enabled,
        )
        .await
    }

    async fn get_setup_helper_action(&self) -> Result<ExecutorAction, ExecutorError> {
        Err(ExecutorError::SetupHelperNotSupported)
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        AvailabilityInfo::NotFound
    }
}

/// Result communicated through the exit signal
#[derive(Debug, Clone)]
pub enum ExecutorExitResult {
    /// Process completed successfully (exit code 0)
    Success,
    /// Process should be marked as failed (non-zero exit)
    Failure,
    /// Process failed with a specific error message (e.g., from turn/completed)
    FailureWithError(String),
}

/// Optional exit notification from an executor.
/// When this receiver resolves, the container should gracefully stop the process
/// and mark it according to the result.
pub type ExecutorExitSignal = tokio::sync::oneshot::Receiver<ExecutorExitResult>;

/// Cancellation token for requesting graceful shutdown of an executor.
/// When cancelled, the executor should attempt to cancel gracefully before being killed.
pub type CancellationToken = tokio_util::sync::CancellationToken;

/// Executor-owned stdout stream. Most executors expose the child process pipe directly; protocol
/// adapters may provide a synthetic stream so callbacks can be drained before process startup is
/// reported as complete.
pub struct ExecutorOutput {
    inner: Pin<Box<dyn AsyncRead + Send + 'static>>,
}

impl ExecutorOutput {
    pub(crate) fn new<R>(reader: R) -> Self
    where
        R: AsyncRead + Send + 'static,
    {
        Self {
            inner: Box::pin(reader),
        }
    }

    pub(crate) fn new_redacted<R>(reader: R, redactor: SensitiveValueRedactor) -> Self
    where
        R: AsyncRead + Send + 'static,
    {
        Self::new(SensitiveValueRedactingReader {
            reader: Box::pin(reader),
            redactor: redactor.stream(),
            ready: Vec::new(),
            ready_offset: 0,
            eof: false,
        })
    }
}

struct SensitiveValueRedactingReader<R> {
    reader: Pin<Box<R>>,
    redactor: SensitiveValueStreamRedactor,
    ready: Vec<u8>,
    ready_offset: usize,
    eof: bool,
}

impl<R: AsyncRead> AsyncRead for SensitiveValueRedactingReader<R> {
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        loop {
            if this.ready_offset < this.ready.len() {
                let count = cmp::min(buffer.remaining(), this.ready.len() - this.ready_offset);
                buffer.put_slice(&this.ready[this.ready_offset..this.ready_offset + count]);
                this.ready_offset += count;
                if this.ready_offset == this.ready.len() {
                    this.ready.clear();
                    this.ready_offset = 0;
                }
                return Poll::Ready(Ok(()));
            }
            if this.eof {
                return Poll::Ready(Ok(()));
            }

            let mut chunk = [0_u8; 8192];
            let mut chunk_buffer = ReadBuf::new(&mut chunk);
            match this.reader.as_mut().poll_read(context, &mut chunk_buffer) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Err(error)) => return Poll::Ready(Err(error)),
                Poll::Ready(Ok(())) if chunk_buffer.filled().is_empty() => {
                    this.eof = true;
                    this.ready = this.redactor.finish();
                }
                Poll::Ready(Ok(())) => {
                    this.ready = this.redactor.push(chunk_buffer.filled());
                }
            }
        }
    }
}

impl std::fmt::Debug for ExecutorOutput {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ExecutorOutput")
            .finish_non_exhaustive()
    }
}

impl AsyncRead for ExecutorOutput {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        self.inner.as_mut().poll_read(context, buffer)
    }
}

#[derive(Debug)]
enum ExecutorRunCleanupResource {
    File(PathBuf),
    LockedFile { path: PathBuf, _lock: File },
    PrivateDirectory(PathBuf),
}

/// Private resources whose lifetime must match the executor process rather than command startup.
#[derive(Debug)]
pub struct ExecutorRunCleanup {
    resources: Vec<ExecutorRunCleanupResource>,
}

impl ExecutorRunCleanup {
    pub(crate) fn new(paths: Vec<PathBuf>) -> Self {
        Self {
            resources: paths
                .into_iter()
                .map(ExecutorRunCleanupResource::File)
                .collect(),
        }
    }

    pub(crate) fn private_directory(path: PathBuf) -> Self {
        Self {
            resources: vec![ExecutorRunCleanupResource::PrivateDirectory(path)],
        }
    }

    pub(crate) fn locked_file(path: PathBuf, lock: File) -> Self {
        Self {
            resources: vec![ExecutorRunCleanupResource::LockedFile { path, _lock: lock }],
        }
    }

    pub fn combine(first: Option<Self>, second: Option<Self>) -> Option<Self> {
        match (first, second) {
            (Some(mut first), Some(second)) => {
                first.merge(second);
                Some(first)
            }
            (Some(cleanup), None) | (None, Some(cleanup)) => Some(cleanup),
            (None, None) => None,
        }
    }

    pub fn merge(&mut self, mut other: Self) {
        self.resources.append(&mut other.resources);
    }
}

impl Drop for ExecutorRunCleanup {
    fn drop(&mut self) {
        for resource in &self.resources {
            match resource {
                ExecutorRunCleanupResource::File(path)
                | ExecutorRunCleanupResource::LockedFile { path, .. } => {
                    let _ = fs::remove_file(path);
                }
                ExecutorRunCleanupResource::PrivateDirectory(_) => {}
            }
        }
        let mut directories = self
            .resources
            .iter()
            .filter_map(|resource| match resource {
                ExecutorRunCleanupResource::PrivateDirectory(path) => Some(path),
                ExecutorRunCleanupResource::File(_)
                | ExecutorRunCleanupResource::LockedFile { .. } => None,
            })
            .collect::<Vec<_>>();
        directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
        for path in directories {
            let _ = fs::remove_dir_all(path);
        }
    }
}

#[derive(Debug)]
pub struct SpawnedChild {
    pub child: AsyncGroupChild,
    /// Optional executor-owned stdout. Falls back to the child process pipe when absent.
    pub stdout: Option<ExecutorOutput>,
    /// Optional executor-owned stderr. Falls back to the child process pipe when absent.
    pub stderr: Option<ExecutorOutput>,
    /// Executor → Container: signals when executor wants to exit
    pub exit_signal: Option<ExecutorExitSignal>,
    /// Container → Executor: signals when container wants to cancel the execution
    pub cancel: Option<CancellationToken>,
    /// Runtime resources retained until the container finishes process-tree cleanup.
    pub cleanup: Option<ExecutorRunCleanup>,
}

impl From<AsyncGroupChild> for SpawnedChild {
    fn from(child: AsyncGroupChild) -> Self {
        Self {
            child,
            stdout: None,
            stderr: None,
            exit_signal: None,
            cancel: None,
            cleanup: None,
        }
    }
}

impl SpawnedChild {
    pub fn take_stdout(&mut self) -> Option<ExecutorOutput> {
        self.stdout
            .take()
            .or_else(|| self.child.inner().stdout.take().map(ExecutorOutput::new))
    }

    pub fn take_stderr(&mut self) -> Option<ExecutorOutput> {
        self.stderr
            .take()
            .or_else(|| self.child.inner().stderr.take().map(ExecutorOutput::new))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema)]
#[serde(transparent)]
#[schemars(
    title = "Append Prompt",
    description = "Extra text appended to the prompt",
    extend("format" = "textarea")
)]
#[derive(Default)]
pub struct AppendPrompt(pub Option<String>);

impl AppendPrompt {
    pub fn get(&self) -> Option<String> {
        self.0.clone()
    }

    pub fn combine_prompt(&self, prompt: &str) -> String {
        match self {
            AppendPrompt(Some(value)) => format!("{prompt}{value}"),
            AppendPrompt(None) => prompt.to_string(),
        }
    }
}

pub fn build_review_prompt(
    context: Option<&[RepoReviewContext]>,
    additional_prompt: Option<&str>,
) -> String {
    let mut prompt = String::from("Please review the code changes.\n\n");

    if let Some(repos) = context {
        for repo in repos {
            prompt.push_str(&format!("Repository: {}\n", repo.repo_name));
            prompt.push_str(&format!(
                "Review all changes from base commit {} to HEAD.\n",
                repo.base_commit
            ));
            prompt.push_str(&format!(
                "Use `git diff {}..HEAD` to see the changes.\n",
                repo.base_commit
            ));
            prompt.push('\n');
        }
    }

    if let Some(additional) = additional_prompt {
        prompt.push_str(additional);
    }

    prompt
}

#[cfg(test)]
mod tests {
    use std::{collections::VecDeque, str::FromStr};

    use tokio::io::AsyncReadExt;

    use super::*;

    struct ChunkedReader {
        chunks: VecDeque<&'static [u8]>,
    }

    impl AsyncRead for ChunkedReader {
        fn poll_read(
            mut self: Pin<&mut Self>,
            _context: &mut Context<'_>,
            buffer: &mut ReadBuf<'_>,
        ) -> Poll<std::io::Result<()>> {
            if let Some(chunk) = self.chunks.pop_front() {
                assert!(chunk.len() <= buffer.remaining());
                buffer.put_slice(chunk);
            }
            Poll::Ready(Ok(()))
        }
    }

    #[test]
    fn login_state_remains_available_for_legacy_executors() {
        assert!(
            AvailabilityInfo::LoginDetected {
                last_auth_timestamp: 1,
            }
            .is_available()
        );
        assert!(AvailabilityInfo::InstallationFound.is_available());
        assert!(!AvailabilityInfo::NotFound.is_available());
    }

    #[test]
    fn test_cursor_agent_deserialization() {
        // Test that CURSOR_AGENT is accepted
        let result = BaseCodingAgent::from_str("CURSOR_AGENT");
        assert!(result.is_ok(), "CURSOR_AGENT should be valid");
        assert_eq!(result.unwrap(), BaseCodingAgent::CursorAgent);

        // Test that legacy CURSOR is still accepted for backwards compatibility
        let result = BaseCodingAgent::from_str("CURSOR");
        assert!(
            result.is_ok(),
            "CURSOR should be valid for backwards compatibility"
        );
        assert_eq!(result.unwrap(), BaseCodingAgent::CursorAgent);

        // Test serde deserialization for CURSOR_AGENT
        let result: Result<BaseCodingAgent, _> = serde_json::from_str(r#""CURSOR_AGENT""#);
        assert!(result.is_ok(), "CURSOR_AGENT should deserialize via serde");
        assert_eq!(result.unwrap(), BaseCodingAgent::CursorAgent);

        // Test serde deserialization for legacy CURSOR
        let result: Result<BaseCodingAgent, _> = serde_json::from_str(r#""CURSOR""#);
        assert!(result.is_ok(), "CURSOR should deserialize via serde");
        assert_eq!(result.unwrap(), BaseCodingAgent::CursorAgent);
    }

    #[test]
    fn generic_acp_runner_is_not_a_production_variant() {
        #[cfg(not(feature = "qa-mode"))]
        assert!(BaseCodingAgent::from_str("ACP_QA").is_err());

        #[cfg(feature = "qa-mode")]
        assert_eq!(
            BaseCodingAgent::from_str("ACP_QA").unwrap(),
            BaseCodingAgent::AcpQa
        );
    }

    #[test]
    fn pi_is_a_strongly_typed_production_variant() {
        assert_eq!(
            BaseCodingAgent::from_str("PI").unwrap(),
            BaseCodingAgent::Pi
        );
        assert_eq!(
            serde_json::to_string(&BaseCodingAgent::Pi).unwrap(),
            r#""PI""#
        );
    }

    #[test]
    fn authentication_accepts_cli_login_or_nonblank_runtime_key() {
        let mut env = ExecutionEnv::new(Default::default(), false, String::new());
        env.insert("OPENTEAMS_TEST_AUTH_KEY", "secret");

        assert!(authentication_detected(
            &env,
            &["OPENTEAMS_TEST_AUTH_KEY"],
            false
        ));
        assert!(authentication_detected(&env, &[], true));
    }

    #[test]
    fn authentication_rejects_blank_and_foreign_runtime_keys() {
        let mut env = ExecutionEnv::new(Default::default(), false, String::new());
        env.insert("OPENTEAMS_TEST_AUTH_KEY", "   ");
        env.insert("OPENTEAMS_FOREIGN_AUTH_KEY", "secret");

        assert!(!authentication_detected(
            &env,
            &["OPENTEAMS_TEST_AUTH_KEY"],
            false
        ));
    }

    #[tokio::test]
    async fn executor_output_redacts_member_mcp_secrets_split_across_stderr_chunks() {
        let api_key = "k3!";
        let env_secret = "e!";
        let header_secret = "h?";
        let mut env = ExecutionEnv::new(Default::default(), false, String::new());
        env.insert("KIRO_API_KEY", api_key);
        let redactor = env
            .sensitive_value_redactor()
            .with_sensitive_values([env_secret, header_secret]);
        let reader = ChunkedReader {
            chunks: VecDeque::from([
                b"Kiro stderr echoed e".as_slice(),
                b"! and h".as_slice(),
                b"?; api=k".as_slice(),
                b"3!".as_slice(),
            ]),
        };
        let mut output = ExecutorOutput::new_redacted(reader, redactor);
        let mut body = String::new();

        output
            .read_to_string(&mut body)
            .await
            .expect("read redacted stderr");

        assert_eq!(
            body,
            "Kiro stderr echoed [redacted] and [redacted]; api=[redacted]"
        );
        assert!(!body.contains(api_key));
        assert!(!body.contains(env_secret));
        assert!(!body.contains(header_secret));
    }
}
