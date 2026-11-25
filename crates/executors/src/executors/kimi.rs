use std::{
    collections::BTreeSet,
    ffi::OsStr,
    fs::{self, DirBuilder, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

use async_trait::async_trait;
use derivative::Derivative;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ts_rs::TS;
use workspace_utils::msg_store::MsgStore;

use super::acp::{
    AcpAccessMode, AcpAgentHarness, AcpApprovalMode, AcpApprovalPolicy, AcpAuthSelection,
    AcpCapabilityProbe, AcpClientServicePolicy, AcpConfigChoice, AcpConfigOptionKind,
    AcpConfigOptionSnapshot, AcpConfigSource, AcpExecutionOptions, AcpResumePolicy,
    mcp::{
        AcpMcpPolicy, load_prepared_acp_mcp_config, pin_mcp_run_environment,
        prepare_acp_mcp_for_run,
    },
};
use crate::{
    approvals::ExecutorApprovalService,
    command::{
        CmdOverrides, CommandBuildError, CommandBuilder, apply_overrides, command_is_available,
    },
    env::ExecutionEnv,
    executors::{
        AppendPrompt, AvailabilityInfo, ExecutorError, ExecutorPrompt, SpawnedChild,
        StandardCodingAgentExecutor,
        utils::{json_has_nonempty_string, read_json_file},
    },
    mcp_config::MemberMcpConfig,
    mcp_run::{McpRunContext, PreparedMcpRun},
    model_discovery::{
        ExecutorModelInfo, discover_model_map_from_cli_command, model_ids_from_model_map_json,
        read_config_value,
    },
};

#[derive(Derivative, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[derivative(Debug, PartialEq)]
pub struct KimiCode {
    #[serde(default)]
    pub append_prompt: AppendPrompt,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Kimi model alias configured in Kimi Code CLI")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Per-run Kimi thinking effort: low, high, or max")]
    pub thinking_effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acp: Option<AcpExecutionOptions>,
    #[serde(flatten)]
    pub cmd: CmdOverrides,
    #[serde(skip)]
    #[ts(skip)]
    #[derivative(Debug = "ignore", PartialEq = "ignore")]
    pub acp_mcp_policy: AcpMcpPolicy,
    #[serde(skip)]
    #[ts(skip)]
    #[derivative(Debug = "ignore", PartialEq = "ignore")]
    pub approvals: Option<Arc<dyn ExecutorApprovalService>>,
}

impl KimiCode {
    const BASE_COMMAND: &'static str = "kimi";
    const TERMINAL_AUTH_METHOD: &'static str = "login";
    const CODE_HOME_ENV: &'static str = "KIMI_CODE_HOME";
    const SHARE_DIR_ENV: &'static str = "KIMI_SHARE_DIR";
    const EMPTY_END_TURN_AUTH_ERROR: &'static str = "Kimi ACP ended the turn without returning content or activity. The Kimi login may have expired; run `kimi login` and retry.";

    pub fn base_command() -> &'static str {
        Self::BASE_COMMAND
    }

    fn build_command_builder(&self) -> Result<CommandBuilder, CommandBuildError> {
        apply_overrides(
            CommandBuilder::new(Self::BASE_COMMAND).extend_params(["acp"]),
            &self.cmd,
        )
    }

    fn provider_list_command(&self) -> Result<CommandBuilder, CommandBuildError> {
        apply_overrides(
            CommandBuilder::new(Self::BASE_COMMAND).extend_params(["provider", "list", "--json"]),
            &self.cmd,
        )
    }

    fn validate_auth_selection(&self) -> Result<(), ExecutorError> {
        match self.acp.as_ref().and_then(|options| options.auth.as_ref()) {
            Some(AcpAuthSelection::MethodId { method_id }) => {
                Err(unsupported_terminal_auth(method_id))
            }
            Some(AcpAuthSelection::Auto) | None => Ok(()),
        }
    }

    async fn acp_harness(&self, env: &ExecutionEnv) -> Result<AcpAgentHarness, ExecutorError> {
        let options = self.acp.clone().unwrap_or_default();
        let approval_policy = match options.approval_mode.unwrap_or_default() {
            AcpApprovalMode::Ask => AcpApprovalPolicy::Ask,
            AcpApprovalMode::AutoAllow => AcpApprovalPolicy::AutoAllow,
            AcpApprovalMode::AutoReject => AcpApprovalPolicy::AutoReject,
        };
        let additional_directories = options
            .validated_directories()
            .await
            .map_err(ExecutorError::Io)?;
        let full_access = options.access_mode.unwrap_or_default() == AcpAccessMode::FullAccess;
        let mut harness = AcpAgentHarness::new()
            .with_approval_policy(approval_policy)
            .with_resume_policy(AcpResumePolicy::UnknownSessionStartsNew)
            .with_empty_end_turn_auth_error(Self::EMPTY_END_TURN_AUTH_ERROR)
            .with_required_session_mode("mode", "default")
            .with_additional_directories(additional_directories)
            .with_client_services(AcpClientServicePolicy {
                read_text_file: true,
                write_text_file: true,
                terminal: true,
                full_access,
                ..AcpClientServicePolicy::default()
            });
        self.validate_auth_selection()?;

        let config_overrides = options.config_overrides.as_deref().unwrap_or_default();
        let has_model_override = config_overrides.iter().any(|selection| {
            selection.category_snapshot.as_deref() == Some("model")
                || selection.option_id.eq_ignore_ascii_case("model")
        });
        let has_thought_override = config_overrides.iter().any(|selection| {
            selection.category_snapshot.as_deref() == Some("thought_level")
                || matches!(
                    normalized_config_key(&selection.option_id).as_str(),
                    "thinking" | "thoughtlevel"
                )
        });
        if let Some(model) = self
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .filter(|_| !has_model_override)
        {
            harness = harness.with_model(model);
        }
        if let Some(effort) = self
            .thinking_effort
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .filter(|_| !has_thought_override)
        {
            harness = harness.with_native_thought_level_fallback(effort);
        }
        for selection in config_overrides {
            harness = harness.with_config_override(selection);
        }

        let effective = load_prepared_acp_mcp_config(env).await?;
        tracing::debug!(
            server_count = effective.servers.len(),
            config_hash = %effective.config_hash,
            "resolved effective Kimi native MCP configuration"
        );
        // Kimi 0.38 rejects the standard ACP stdio shape because stdio servers
        // have no `type` discriminator. The same member snapshot is installed
        // in the isolated native Kimi view during preparation, so no MCP server
        // is duplicated through `session/new` or `session/load`.
        Ok(harness.with_mcp_servers(Vec::new()))
    }

    async fn configured_default_model(&self, env: &ExecutionEnv) -> Option<String> {
        for home in kimi_code_homes(Some(env)) {
            let path = home.join("config.toml");
            let config = match read_config_value(&path).await {
                Ok(Some(config)) => config,
                Ok(None) => continue,
                Err(error) => {
                    tracing::warn!(
                        error = %error,
                        path = %path.display(),
                        "ignoring unreadable Kimi config"
                    );
                    continue;
                }
            };
            if let Some(model) = config
                .get("default_model")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Some(model.to_string());
            }
        }
        None
    }

    async fn configured_models(&self, env: &ExecutionEnv) -> Vec<String> {
        let mut models = BTreeSet::new();
        for home in kimi_code_homes(Some(env)) {
            let path = home.join("config.toml");
            match read_config_value(&path).await {
                Ok(Some(config)) => models.extend(model_ids_from_model_map_json(&config)),
                Ok(None) => {}
                Err(error) => {
                    tracing::warn!(
                        error = %error,
                        path = %path.display(),
                        "ignoring unreadable Kimi config"
                    );
                }
            }
        }
        models.into_iter().collect()
    }

    fn discovered_model_option(
        &self,
        models: Vec<String>,
        default_model: Option<&str>,
    ) -> AcpConfigOptionSnapshot {
        let current_value = self
            .model
            .as_deref()
            .or(default_model)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .filter(|selected| models.iter().any(|model| model == selected))
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| models[0].clone());
        AcpConfigOptionSnapshot {
            id: "model".to_string(),
            name: "Model".to_string(),
            description: Some("Models reported by Kimi Code CLI".to_string()),
            category: Some("model".to_string()),
            kind: AcpConfigOptionKind::Select {
                current_value,
                options: models
                    .into_iter()
                    .map(|model| AcpConfigChoice {
                        name: model.clone(),
                        value: model,
                        description: None,
                    })
                    .collect(),
            },
        }
    }
}

const KIMI_MCP_VIEW_LOCK_FILE: &str = ".openteams-mcp-view.lock";

fn is_shared_kimi_state_file(name: &OsStr) -> bool {
    matches!(
        name.to_str(),
        Some("session_index.jsonl" | "workspaces.json")
    )
}

fn create_private_kimi_view_directory(path: &Path) -> Result<(), ExecutorError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => return Ok(()),
        Ok(_) => {
            return Err(ExecutorError::Configuration(
                "Kimi MCP view path is not a private directory".to_string(),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(ExecutorError::Io(error)),
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(ExecutorError::Io)?;
    }
    let mut builder = DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let metadata = fs::symlink_metadata(path).map_err(ExecutorError::Io)?;
            if metadata.is_dir() && !metadata.file_type().is_symlink() {
                Ok(())
            } else {
                Err(ExecutorError::Configuration(
                    "Kimi MCP view path is not a private directory".to_string(),
                ))
            }
        }
        Err(error) => Err(ExecutorError::Io(error)),
    }
}

fn kimi_mcp_view_home(
    context: &McpRunContext,
    source_home: &Path,
) -> Result<PathBuf, ExecutorError> {
    let workspace = fs::canonicalize(context.current_dir()).map_err(ExecutorError::Io)?;
    let runtime_root = context.current_dir().join(".openteams");
    create_private_kimi_view_directory(&runtime_root)?;
    let runtime_root = fs::canonicalize(&runtime_root).map_err(ExecutorError::Io)?;
    if !runtime_root.starts_with(&workspace) {
        return Err(ExecutorError::Configuration(
            "Kimi MCP view escapes the workspace".to_string(),
        ));
    }
    let state_root = runtime_root.join("executor-state").join("kimi-mcp-view");
    create_private_kimi_view_directory(&runtime_root.join("executor-state"))?;
    create_private_kimi_view_directory(&state_root)?;
    let source_hash = format!(
        "{:x}",
        Sha256::digest(source_home.as_os_str().as_encoded_bytes())
    );
    let view_home = state_root.join(format!(
        "{}-{}",
        context.session_agent_id(),
        &source_hash[..16]
    ));
    create_private_kimi_view_directory(&view_home)?;
    Ok(view_home)
}

#[cfg(windows)]
fn replace_kimi_view_file_atomically(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::{iter, os::windows::ffi::OsStrExt};

    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let from = from
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let to = to
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_kimi_view_file_atomically(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}

fn replace_private_kimi_view_file(path: &Path, contents: &[u8]) -> Result<(), ExecutorError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() || metadata.file_type().is_symlink() => {}
        Ok(_) => {
            return Err(ExecutorError::Configuration(
                "Kimi MCP view file path is not a file".to_string(),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(ExecutorError::Io(error)),
    }
    let parent = path.parent().ok_or_else(|| {
        ExecutorError::Configuration("Kimi MCP view file has no parent directory".to_string())
    })?;
    let file_name = path.file_name().ok_or_else(|| {
        ExecutorError::Configuration("Kimi MCP view file has no name".to_string())
    })?;
    let temporary_path = parent.join(format!(
        ".{}.{}.tmp",
        file_name.to_string_lossy(),
        uuid::Uuid::new_v4()
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&temporary_path).map_err(ExecutorError::Io)?;
        file.write_all(contents).map_err(ExecutorError::Io)?;
        file.sync_all().map_err(ExecutorError::Io)?;
        replace_kimi_view_file_atomically(&temporary_path, path).map_err(ExecutorError::Io)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

fn lock_kimi_mcp_view(view_home: &Path) -> Result<File, ExecutorError> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock = options
        .open(view_home.join(KIMI_MCP_VIEW_LOCK_FILE))
        .map_err(ExecutorError::Io)?;
    lock.lock().map_err(ExecutorError::Io)?;
    Ok(lock)
}

#[cfg(windows)]
fn copy_kimi_directory_recursively(source: &Path, target: &Path) -> std::io::Result<()> {
    for entry in walkdir::WalkDir::new(source).follow_links(true) {
        let entry = entry.map_err(|error| std::io::Error::other(error.to_string()))?;
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(std::io::Error::other)?;
        let target_path = target.join(relative);
        let metadata = fs::metadata(entry.path())?;
        if metadata.is_dir() {
            fs::create_dir_all(target_path)?;
        } else if metadata.is_file() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(entry.path(), target_path)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn copy_kimi_windows_shared_state_fallback(
    source: &Path,
    target: &Path,
    source_is_directory: bool,
) -> std::io::Result<()> {
    let result = if source_is_directory {
        copy_kimi_directory_recursively(source, target)
    } else {
        fs::copy(source, target).map(|_| ())
    };
    if result.is_err() {
        if source_is_directory {
            let _ = fs::remove_dir_all(target);
        } else {
            let _ = fs::remove_file(target);
        }
    }
    result
}

fn materialize_kimi_shared_state(source: &Path, target: &Path) -> Result<(), ExecutorError> {
    let source = fs::canonicalize(source).map_err(ExecutorError::Io)?;
    let source_is_directory = fs::metadata(&source).map_err(ExecutorError::Io)?.is_dir();
    match fs::symlink_metadata(target) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            if fs::canonicalize(target).map_err(ExecutorError::Io)? == source {
                return Ok(());
            }
            fs::remove_file(target).map_err(ExecutorError::Io)?;
        }
        Ok(metadata) if cfg!(windows) && source_is_directory && metadata.is_dir() => {
            return Ok(());
        }
        Ok(metadata) if cfg!(windows) && !source_is_directory && metadata.is_file() => {
            return Ok(());
        }
        Ok(metadata) if metadata.is_file() => {
            fs::remove_file(target).map_err(ExecutorError::Io)?;
        }
        Ok(_) => {
            return Err(ExecutorError::Configuration(
                "Kimi shared state target is not a symbolic link".to_string(),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(ExecutorError::Io(error)),
    }
    #[cfg(unix)]
    {
        let _ = source_is_directory;
        std::os::unix::fs::symlink(source, target).map_err(ExecutorError::Io)
    }
    #[cfg(windows)]
    {
        let symlink_result = if source_is_directory {
            std::os::windows::fs::symlink_dir(&source, target)
        } else {
            std::os::windows::fs::symlink_file(&source, target)
        };
        match symlink_result {
            Ok(()) => Ok(()),
            Err(symlink_error) => {
                copy_kimi_windows_shared_state_fallback(&source, target, source_is_directory)
                    .map_err(|fallback_error| {
                        let fallback = if source_is_directory {
                            "directory copy"
                        } else {
                            "file copy"
                        };
                        ExecutorError::Configuration(format!(
                            "Kimi shared state could not use a Windows symlink or {fallback} fallback; enable Developer Mode or verify workspace write access and free space (symlink_os_error={:?}, fallback_os_error={:?})",
                            symlink_error.raw_os_error(),
                            fallback_error.raw_os_error()
                        ))
                    })
            }
        }
    }
}

fn ensure_kimi_shared_session_state(source_home: &Path) -> Result<(), ExecutorError> {
    let sessions = source_home.join("sessions");
    match fs::metadata(&sessions) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => {
            return Err(ExecutorError::Configuration(
                "Kimi sessions path is not a directory".to_string(),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            create_private_kimi_view_directory(&sessions)?;
        }
        Err(error) => return Err(ExecutorError::Io(error)),
    }
    let session_index = source_home.join("session_index.jsonl");
    let mut options = OpenOptions::new();
    options.append(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(session_index).map_err(ExecutorError::Io)?;
    Ok(())
}

/// Build a member-stable configuration view of Kimi's normal home whenever a
/// native member MCP file is required or an ambient `mcp.json` must be hidden.
/// Authentication and session resources remain linked to the canonical home
/// when the platform permits it. Windows falls back to persistent member-local
/// copies when symbolic-link privileges are unavailable. The member MCP file
/// exists only for the executor process lifetime.
/// The stable view path is retained because Kimi persists absolute session
/// paths below its code home.
fn prepare_kimi_member_mcp_view_blocking(
    source_home: Option<&Path>,
    context: &McpRunContext,
    member_mcp: &[u8],
    has_member_mcp: bool,
) -> Result<Option<(PathBuf, File)>, ExecutorError> {
    let Some(source_home) = source_home else {
        return Ok(None);
    };
    let has_ambient_mcp = match fs::symlink_metadata(source_home.join("mcp.json")) {
        Ok(metadata) if metadata.is_file() || metadata.file_type().is_symlink() => true,
        Ok(_) => {
            return Err(ExecutorError::Configuration(
                "Kimi ambient MCP path is not a file".to_string(),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(ExecutorError::Io(error)),
    };
    if !has_member_mcp && !has_ambient_mcp {
        return Ok(None);
    }
    match fs::symlink_metadata(source_home) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            create_private_kimi_view_directory(source_home)?;
        }
        Err(error) => return Err(ExecutorError::Io(error)),
    }
    let source_home = fs::canonicalize(source_home).map_err(ExecutorError::Io)?;
    ensure_kimi_shared_session_state(&source_home)?;
    let view_home = kimi_mcp_view_home(context, &source_home)?;
    let view_lock = lock_kimi_mcp_view(&view_home)?;
    let entries = fs::read_dir(source_home)
        .map_err(ExecutorError::Io)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(ExecutorError::Io)?;
    let source_entry_names = entries
        .iter()
        .map(fs::DirEntry::file_name)
        .collect::<BTreeSet<_>>();
    for entry in fs::read_dir(&view_home).map_err(ExecutorError::Io)? {
        let entry = entry.map_err(ExecutorError::Io)?;
        let name = entry.file_name();
        if name == OsStr::new("mcp.json")
            || name == OsStr::new(KIMI_MCP_VIEW_LOCK_FILE)
            || source_entry_names.contains(&name)
        {
            continue;
        }
        let file_type = entry.file_type().map_err(ExecutorError::Io)?;
        if file_type.is_file() || file_type.is_symlink() {
            fs::remove_file(entry.path()).map_err(ExecutorError::Io)?;
        }
    }
    for entry in entries {
        let name = entry.file_name();
        if name == OsStr::new("mcp.json") {
            continue;
        }
        let file_type = entry.file_type().map_err(ExecutorError::Io)?;
        let metadata = if file_type.is_symlink() {
            Some(fs::metadata(entry.path()).map_err(ExecutorError::Io)?)
        } else {
            None
        };
        let is_directory =
            file_type.is_dir() || metadata.as_ref().is_some_and(std::fs::Metadata::is_dir);
        if is_directory || is_shared_kimi_state_file(&name) {
            materialize_kimi_shared_state(&entry.path(), &view_home.join(&name))?;
            continue;
        }
        if file_type.is_file() || metadata.as_ref().is_some_and(std::fs::Metadata::is_file) {
            let contents = fs::read(entry.path()).map_err(ExecutorError::Io)?;
            replace_private_kimi_view_file(&view_home.join(&name), &contents)?;
        }
    }
    replace_private_kimi_view_file(&view_home.join("mcp.json"), member_mcp)?;
    Ok(Some((view_home, view_lock)))
}

async fn prepare_kimi_member_mcp_view(
    source_home: Option<&Path>,
    context: &McpRunContext,
    member_mcp: Vec<u8>,
    has_member_mcp: bool,
) -> Result<Option<(PathBuf, File)>, ExecutorError> {
    let source_home = source_home.map(Path::to_path_buf);
    let context = context.clone();
    tokio::task::spawn_blocking(move || {
        prepare_kimi_member_mcp_view_blocking(
            source_home.as_deref(),
            &context,
            &member_mcp,
            has_member_mcp,
        )
    })
    .await
    .map_err(|error| {
        ExecutorError::Io(std::io::Error::other(format!(
            "Kimi MCP view preparation task failed: {error}"
        )))
    })?
}

#[async_trait]
impl StandardCodingAgentExecutor for KimiCode {
    async fn prepare_mcp_for_run(
        &mut self,
        canonical: &MemberMcpConfig,
        context: &McpRunContext,
        env: &mut ExecutionEnv,
    ) -> Result<PreparedMcpRun, ExecutorError> {
        let source_env = env.clone().with_profile(&self.cmd);
        let source_home = kimi_code_home(Some(&source_env));
        let prepared =
            prepare_acp_mcp_for_run(canonical, context, env, &mut self.cmd, "kimi-acp-mcp")?;
        let member_mcp = serde_json::to_vec_pretty(canonical)?;
        let Some((mcp_view_home, view_lock)) = prepare_kimi_member_mcp_view(
            source_home.as_deref(),
            context,
            member_mcp,
            !canonical.mcp_servers.is_empty(),
        )
        .await?
        else {
            return Ok(prepared);
        };
        let native_mcp_path = mcp_view_home.join("mcp.json");
        let mcp_view_home = mcp_view_home.to_string_lossy().into_owned();
        pin_mcp_run_environment(
            env,
            &mut self.cmd,
            Self::CODE_HOME_ENV,
            mcp_view_home.clone(),
        );
        pin_mcp_run_environment(env, &mut self.cmd, Self::SHARE_DIR_ENV, mcp_view_home);
        Ok(
            prepared.with_cleanup(crate::executors::ExecutorRunCleanup::locked_file(
                native_mcp_path,
                view_lock,
            )),
        )
    }

    fn overlay_acp_execution_options(&mut self, higher_priority: &AcpExecutionOptions) {
        let inherited = self.acp.clone().unwrap_or_default();
        self.acp = Some(inherited.overlay(higher_priority));
    }

    fn acp_full_access_enabled(&self) -> bool {
        self.acp
            .as_ref()
            .and_then(|options| options.access_mode)
            .unwrap_or_default()
            == AcpAccessMode::FullAccess
    }

    fn is_authenticated(&self, env: &ExecutionEnv) -> bool {
        let env = env.clone().with_profile(&self.cmd);
        let homes = kimi_code_homes(Some(&env));
        let oauth_login = homes.iter().any(|home| {
            read_json_file(&home.join("credentials").join("kimi-code.json")).is_some_and(|value| {
                json_has_nonempty_string(&value, &["/access_token", "/refresh_token"])
            })
        });
        let provider_configured = homes.iter().any(|home| {
            std::fs::read_to_string(home.join("config.toml"))
                .ok()
                .and_then(|content| toml::from_str::<toml::Value>(&content).ok())
                .is_some_and(|value| kimi_provider_configured(&value))
        });
        self.authentication_detected(
            &env,
            &["KIMI_API_KEY", "MOONSHOT_API_KEY"],
            oauth_login || provider_configured,
        )
    }

    fn use_approvals(&mut self, approvals: Arc<dyn ExecutorApprovalService>) {
        self.approvals = Some(approvals);
    }

    async fn list_models(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<Option<Vec<String>>, ExecutorError> {
        let mut models = BTreeSet::new();
        match discover_model_map_from_cli_command(
            current_dir,
            env,
            &self.cmd,
            self.provider_list_command()?,
        )
        .await
        {
            Ok(Some(discovered)) => models.extend(discovered),
            Ok(None) => {}
            Err(error) => tracing::debug!(
                error = %error,
                "Kimi provider listing is unavailable; falling back to configured models"
            ),
        }
        models.extend(self.configured_models(env).await);
        if let Some(model) = self
            .model
            .as_deref()
            .map(str::trim)
            .filter(|model| !model.is_empty())
        {
            models.insert(model.to_string());
        }
        Ok((!models.is_empty()).then(|| models.into_iter().collect()))
    }

    async fn discover_model_catalog(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<Option<Vec<ExecutorModelInfo>>, ExecutorError> {
        // Explicit refresh must report failures so the service retains the last
        // successful account list. The ID-only API keeps legacy config fallback.
        let models = discover_model_map_from_cli_command(
            current_dir,
            env,
            &self.cmd,
            self.provider_list_command()?,
        )
        .await?
        .ok_or_else(|| {
            ExecutorError::Configuration(
                "Kimi model discovery executable is unavailable".to_string(),
            )
        })?;
        Ok(Some(models.into_iter().map(Into::into).collect()))
    }

    async fn probe_acp(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
        auth_method_id: Option<&str>,
    ) -> Result<Option<AcpCapabilityProbe>, ExecutorError> {
        if let Some(method_id) = auth_method_id {
            return Err(unsupported_terminal_auth(method_id));
        }
        let mut probe = super::acp::runtime::probe_acp_command_without_session(
            self.build_command_builder()?.build_initial()?,
            current_dir,
            env,
            &self.cmd,
            None,
        )
        .await?;
        if let Some(models) = self.discover_model_catalog(current_dir, env).await?
            && !models.is_empty()
        {
            let default_model = self.configured_default_model(env).await;
            probe.config_source = AcpConfigSource::Stable;
            probe.config_options.push(self.discovered_model_option(
                models.into_iter().map(|model| model.id).collect(),
                default_model.as_deref(),
            ));
        }
        Ok(Some(probe))
    }

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let harness = self.acp_harness(env).await?;
        let combined_prompt = self.append_prompt.combine_prompt(prompt);
        let command = self.build_command_builder()?.build_initial()?;
        harness
            .spawn_with_command(
                current_dir,
                combined_prompt,
                command,
                env,
                &self.cmd,
                self.approvals.clone(),
            )
            .await
    }

    async fn spawn_follow_up(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: &str,
        _reset_to_message_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let harness = self.acp_harness(env).await?;
        let combined_prompt = self.append_prompt.combine_prompt(prompt);
        let command = self.build_command_builder()?.build_follow_up(&[])?;
        harness
            .spawn_follow_up_with_command(
                current_dir,
                combined_prompt,
                session_id,
                command,
                env,
                &self.cmd,
                self.approvals.clone(),
            )
            .await
    }

    async fn spawn_structured(
        &self,
        current_dir: &Path,
        prompt: &ExecutorPrompt,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let harness = self.acp_harness(env).await?;
        let command = self.build_command_builder()?.build_initial()?;
        let mut prompt = prompt.clone();
        prompt.text = self.append_prompt.combine_prompt(&prompt.text);
        harness
            .spawn_structured_with_command(
                current_dir,
                prompt,
                command,
                env,
                &self.cmd,
                self.approvals.clone(),
            )
            .await
    }

    async fn spawn_follow_up_structured(
        &self,
        current_dir: &Path,
        prompt: &ExecutorPrompt,
        session_id: &str,
        _reset_to_message_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let harness = self.acp_harness(env).await?;
        let command = self.build_command_builder()?.build_follow_up(&[])?;
        let mut prompt = prompt.clone();
        prompt.text = self.append_prompt.combine_prompt(&prompt.text);
        harness
            .spawn_follow_up_structured_with_command(
                current_dir,
                prompt,
                session_id,
                command,
                env,
                &self.cmd,
                self.approvals.clone(),
            )
            .await
    }

    fn normalize_logs(&self, msg_store: Arc<MsgStore>, worktree_path: &Path) {
        super::acp::normalize_logs(msg_store, worktree_path);
    }

    fn default_runtime_config_path(&self) -> Option<PathBuf> {
        kimi_runtime_config_path(None)
    }

    fn default_mcp_config_path(&self) -> Option<PathBuf> {
        kimi_mcp_config_path(None)
    }

    fn native_skill_discovery_roots(&self) -> Vec<PathBuf> {
        let mut roots = dirs::home_dir()
            .map(|home| vec![home.join(".agents").join("skills")])
            .unwrap_or_default();
        for home in kimi_code_homes(None) {
            roots.push(home.join("skills"));
        }
        roots.sort();
        roots.dedup();
        roots
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        if command_is_available(Self::BASE_COMMAND, &self.cmd) {
            AvailabilityInfo::InstallationFound
        } else {
            AvailabilityInfo::NotFound
        }
    }
}

fn kimi_provider_configured(value: &toml::Value) -> bool {
    value
        .get("providers")
        .and_then(toml::Value::as_table)
        .is_some_and(|providers| !providers.is_empty())
        || value
            .get("services")
            .and_then(toml::Value::as_table)
            .is_some_and(|services| services.values().any(toml_value_has_credential))
}

fn toml_value_has_credential(value: &toml::Value) -> bool {
    match value {
        toml::Value::Table(table) => table.iter().any(|(key, value)| {
            matches!(
                key.as_str(),
                "api_key" | "apiKey" | "token" | "access_token"
            ) && value.as_str().is_some_and(|value| !value.trim().is_empty())
                || toml_value_has_credential(value)
        }),
        toml::Value::Array(values) => values.iter().any(toml_value_has_credential),
        _ => false,
    }
}

fn normalized_config_key(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn unsupported_terminal_auth(method_id: &str) -> ExecutorError {
    let message = if method_id == KimiCode::TERMINAL_AUTH_METHOD {
        "Kimi ACP login is terminal-based; run `kimi login` and keep ACP auth set to auto"
            .to_string()
    } else {
        format!(
            "Kimi ACP authentication method `{method_id}` is not supported; run `kimi login` and keep ACP auth set to auto"
        )
    };
    ExecutorError::Io(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        message,
    ))
}

fn kimi_code_homes(env: Option<&ExecutionEnv>) -> Vec<PathBuf> {
    let mut configured = Vec::new();
    for key in ["KIMI_CODE_HOME", "KIMI_SHARE_DIR"] {
        if let Some(path) = env
            .and_then(|env| env.get(key).cloned())
            .or_else(|| std::env::var(key).ok())
            .and_then(|value| {
                let value = value.trim();
                (!value.is_empty()).then(|| PathBuf::from(value))
            })
            && !configured.contains(&path)
        {
            configured.push(path);
        }
    }
    if !configured.is_empty() {
        return configured;
    }

    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let modern = home.join(".kimi-code");
    let legacy = home.join(".kimi");
    match (modern.exists(), legacy.exists()) {
        (false, true) => vec![legacy, modern],
        _ => vec![modern, legacy],
    }
}

fn kimi_code_home(env: Option<&ExecutionEnv>) -> Option<PathBuf> {
    kimi_code_homes(env).into_iter().next()
}

fn kimi_mcp_config_path(env: Option<&ExecutionEnv>) -> Option<PathBuf> {
    kimi_code_home(env).map(|home| home.join("mcp.json"))
}

fn kimi_runtime_config_path(env: Option<&ExecutionEnv>) -> Option<PathBuf> {
    kimi_code_home(env).map(|home| home.join("config.toml"))
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::env::RepoContext;

    fn run_context(workspace: &Path) -> McpRunContext {
        run_context_for(workspace, uuid::Uuid::new_v4())
    }

    fn run_context_for(workspace: &Path, session_agent_id: uuid::Uuid) -> McpRunContext {
        McpRunContext::new(workspace, session_agent_id, uuid::Uuid::new_v4()).expect("run context")
    }

    fn kimi() -> KimiCode {
        KimiCode {
            append_prompt: AppendPrompt::default(),
            model: Some("kimi-code/k3".to_string()),
            thinking_effort: Some("high".to_string()),
            acp: None,
            cmd: CmdOverrides::default(),
            acp_mcp_policy: AcpMcpPolicy::default(),
            approvals: None,
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_shared_state_copy_fallbacks_persist_in_the_member_view() {
        let temp = TempDir::new().expect("create Windows Kimi link fixture");
        let source_directory = temp.path().join("source-directory");
        let directory_target = temp.path().join("directory-target");
        fs::create_dir(&source_directory).expect("create source directory");
        fs::write(source_directory.join("existing-session.json"), b"source")
            .expect("write source directory state");

        copy_kimi_windows_shared_state_fallback(&source_directory, &directory_target, true)
            .expect("copy directory fallback");
        assert_eq!(
            fs::read(directory_target.join("existing-session.json"))
                .expect("read copied directory state"),
            b"source"
        );
        fs::write(directory_target.join("session.json"), b"{}")
            .expect("write member-local directory state");
        assert!(!source_directory.join("session.json").exists());
        materialize_kimi_shared_state(&source_directory, &directory_target)
            .expect("reuse existing directory copy");
        assert!(directory_target.join("session.json").is_file());

        let source_file = temp.path().join("session_index.jsonl");
        let file_target = temp.path().join("session-index-target.jsonl");
        fs::write(&source_file, b"before").expect("write source state file");
        copy_kimi_windows_shared_state_fallback(&source_file, &file_target, false)
            .expect("copy file fallback");
        fs::write(&file_target, b"after").expect("write member-local file state");
        assert_eq!(
            fs::read(&source_file).expect("read shared source state file"),
            b"before"
        );
        materialize_kimi_shared_state(&source_file, &file_target)
            .expect("reuse existing file copy");
        assert_eq!(
            fs::read(file_target).expect("read persisted member-local file state"),
            b"after"
        );
    }

    #[test]
    fn provider_or_service_credentials_count_as_authentication() {
        let provider: toml::Value = toml::from_str(
            r#"
                [providers.custom]
                type = "openai"
                base_url = "http://localhost:11434/v1"
            "#,
        )
        .unwrap();
        let service: toml::Value = toml::from_str(
            r#"
                [services.search]
                api_key = "service-token"
            "#,
        )
        .unwrap();

        assert!(kimi_provider_configured(&provider));
        assert!(kimi_provider_configured(&service));
        assert!(!kimi_provider_configured(&toml::Value::Table(
            Default::default()
        )));
    }

    #[test]
    fn command_builder_uses_kimi_acp_subcommand() {
        let (_program, args) = kimi()
            .build_command_builder()
            .unwrap()
            .build_initial()
            .unwrap()
            .into_parts_for_test();
        assert!(args.iter().any(|arg| arg == "acp"));
        assert!(!args.iter().any(|arg| arg == "--print"));
        assert!(!args.iter().any(|arg| arg == "--output-format"));
        assert!(!args.iter().any(|arg| arg == "--model"));
    }

    #[test]
    fn model_discovery_uses_provider_list_json() {
        let (_program, args) = kimi()
            .provider_list_command()
            .unwrap()
            .build_initial()
            .unwrap()
            .into_parts_for_test();
        assert_eq!(args, vec!["provider", "list", "--json"]);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn model_discovery_preserves_k31_pro_and_highspeed_aliases() {
        let dir = TempDir::new().unwrap();
        let script = dir.path().join("models.sh");
        fs::write(&script, "#!/bin/sh\nprintf '%s\\n' '{\"models\":{\"kimi-code/k3.1-pro\":{\"model\":\"k3.1-pro\"},\"kimi-code/k3.1-pro-highspeed\":{\"model\":\"k3.1-pro-highspeed\"}},\"providers\":{\"api_key\":\"secret\"}}'\n").unwrap();
        let mut executor = kimi();
        executor.cmd.base_command_override = Some(format!("sh {}", script.display()));
        let env = ExecutionEnv::new(Default::default(), false, String::new());
        let catalog = executor
            .discover_model_catalog(dir.path(), &env)
            .await
            .unwrap()
            .unwrap();
        let aliases = catalog.into_iter().map(|info| info.id).collect::<Vec<_>>();
        assert_eq!(
            aliases,
            ["kimi-code/k3.1-pro", "kimi-code/k3.1-pro-highspeed"]
        );
        for selected in &aliases {
            executor.model = Some(selected.clone());
            let option = executor.discovered_model_option(aliases.clone(), None);
            let AcpConfigOptionKind::Select {
                current_value,
                options,
            } = option.kind
            else {
                panic!("expected model select");
            };
            assert_eq!(&current_value, selected);
            assert!(options.iter().any(|option| &option.value == selected));
        }
        fs::write(&script, "#!/bin/sh\nexit 1\n").unwrap();
        assert!(
            executor
                .discover_model_catalog(dir.path(), &env)
                .await
                .is_err()
        );
    }

    #[test]
    fn discovered_models_become_stable_acp_model_option() {
        let option = kimi().discovered_model_option(
            vec![
                "kimi-code/kimi-for-coding".to_string(),
                "kimi-code/k3".to_string(),
            ],
            Some("kimi-code/k3"),
        );
        assert_eq!(option.category.as_deref(), Some("model"));
        let AcpConfigOptionKind::Select {
            current_value,
            options,
        } = option.kind
        else {
            panic!("expected select option");
        };
        assert_eq!(current_value, "kimi-code/k3");
        assert_eq!(options.len(), 2);
    }

    #[test]
    fn explicit_terminal_auth_is_rejected_with_login_guidance() {
        let mut executor = kimi();
        executor.acp = Some(AcpExecutionOptions {
            auth: Some(AcpAuthSelection::MethodId {
                method_id: "login".to_string(),
            }),
            ..Default::default()
        });
        let error = executor.validate_auth_selection().unwrap_err().to_string();
        assert!(error.contains("kimi login"));
        assert!(error.contains("auth set to auto"));
    }

    #[tokio::test]
    async fn empty_end_turn_is_promoted_with_login_guidance() {
        let workspace = tempfile::tempdir().expect("workspace");
        let mut env = ExecutionEnv::new(
            RepoContext::new(workspace.path().to_path_buf(), Vec::new()),
            false,
            String::new(),
        );
        let mut executor = kimi();
        let prepared = executor
            .prepare_mcp_for_run(
                &MemberMcpConfig::default(),
                &run_context(workspace.path()),
                &mut env,
            )
            .await
            .expect("prepare Kimi MCP");

        let harness = executor.acp_harness(&env).await.expect("Kimi ACP harness");

        assert_eq!(
            harness.empty_end_turn_auth_error(),
            Some(KimiCode::EMPTY_END_TURN_AUTH_ERROR)
        );
        drop(prepared.into_cleanup());
    }

    #[tokio::test]
    async fn every_approval_policy_enforces_default_agent_mode() {
        let temp = TempDir::new().expect("create Kimi test home");
        let mut env = ExecutionEnv::new(
            RepoContext::new(temp.path().to_path_buf(), Vec::new()),
            false,
            String::new(),
        );
        env.insert("KIMI_CODE_HOME", temp.path().to_string_lossy().into_owned());

        for approval_mode in [
            AcpApprovalMode::Ask,
            AcpApprovalMode::AutoAllow,
            AcpApprovalMode::AutoReject,
        ] {
            let mut executor = kimi();
            executor.acp = Some(AcpExecutionOptions {
                approval_mode: Some(approval_mode),
                config_overrides: Some(vec![super::super::acp::AcpConfigOverride {
                    option_id: "mode".to_string(),
                    value: super::super::acp::AcpConfigValue::ValueId {
                        value: "yolo".to_string(),
                    },
                    label_snapshot: Some("Mode".to_string()),
                    category_snapshot: Some("mode".to_string()),
                }]),
                ..Default::default()
            });

            let mut run_env = env.clone();
            let prepared = executor
                .prepare_mcp_for_run(
                    &MemberMcpConfig::default(),
                    &run_context(temp.path()),
                    &mut run_env,
                )
                .await
                .expect("Kimi MCP preparation");

            let harness = executor
                .acp_harness(&run_env)
                .await
                .expect("build Kimi harness");
            let (option_id, value) = harness.required_session_mode().expect("required Kimi mode");
            assert_eq!(option_id, "mode");
            assert_eq!(
                value,
                &agent_client_protocol::schema::v1::SessionConfigOptionValue::value_id("default")
            );
            drop(prepared.into_cleanup());
        }
    }

    #[tokio::test]
    async fn preparation_hides_ambient_home_mcp_and_shares_session_state() {
        let workspace = tempfile::tempdir().expect("workspace");
        let source_home = workspace.path().join("source-kimi-home");
        tokio::fs::create_dir_all(source_home.join("credentials"))
            .await
            .expect("credentials directory");
        tokio::fs::create_dir_all(source_home.join("sessions"))
            .await
            .expect("sessions directory");
        let source_config_path = source_home.join("config.toml");
        let source_credentials_path = source_home.join("credentials/kimi-code.json");
        let source_mcp_path = source_home.join("mcp.json");
        tokio::fs::write(
            &source_config_path,
            "[providers.fixture]\ntype = \"openai\"\n",
        )
        .await
        .expect("Kimi config");
        tokio::fs::write(
            &source_credentials_path,
            r#"{"access_token":"fixture-login-token","refresh_token":"fixture-refresh-token","expires_at":10}"#,
        )
        .await
        .expect("Kimi credentials");
        tokio::fs::write(
            &source_mcp_path,
            r#"{"mcpServers":{"ambient":{"command":"must-not-run"}}}"#,
        )
        .await
        .expect("ambient Kimi MCP");
        let original_config = tokio::fs::read(&source_config_path)
            .await
            .expect("read original Kimi config");
        let original_credentials = tokio::fs::read(&source_credentials_path)
            .await
            .expect("read original Kimi credentials");
        let original_mcp = tokio::fs::read(&source_mcp_path)
            .await
            .expect("read original Kimi MCP");
        let mut executor = kimi();
        let canonical = MemberMcpConfig {
            mcp_servers: [(
                "member-only".to_string(),
                serde_json::json!({"command": "/bin/echo"}),
            )]
            .into_iter()
            .collect(),
        };
        let mut env = ExecutionEnv::new(
            RepoContext::new(workspace.path().to_path_buf(), Vec::new()),
            false,
            String::new(),
        );
        env.insert("KIMI_CODE_HOME", source_home.to_string_lossy().into_owned());

        let session_agent_id = uuid::Uuid::new_v4();
        let prepared = executor
            .prepare_mcp_for_run(
                &canonical,
                &run_context_for(workspace.path(), session_agent_id),
                &mut env,
            )
            .await
            .expect("Kimi MCP preparation");
        let snapshot_path = PathBuf::from(
            env.get(super::super::acp::mcp::PREPARED_ACP_MCP_SNAPSHOT_ENV)
                .expect("prepared snapshot"),
        );
        let effective = load_prepared_acp_mcp_config(&env)
            .await
            .expect("prepared member MCP");
        let runtime_home = PathBuf::from(env.get("KIMI_CODE_HOME").expect("runtime Kimi home"));
        let runtime_mcp: serde_json::Value = serde_json::from_slice(
            &tokio::fs::read(runtime_home.join("mcp.json"))
                .await
                .expect("read runtime Kimi MCP"),
        )
        .expect("parse runtime Kimi MCP");

        assert_ne!(runtime_home, source_home);
        assert_eq!(
            env.get("KIMI_SHARE_DIR").map(PathBuf::from),
            Some(runtime_home.clone())
        );
        assert_eq!(
            runtime_mcp["mcpServers"]
                .as_object()
                .expect("runtime server map")
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            vec!["member-only"]
        );
        assert_eq!(
            tokio::fs::read(runtime_home.join("config.toml"))
                .await
                .expect("read runtime Kimi config"),
            original_config
        );
        assert!(
            !std::fs::symlink_metadata(runtime_home.join("config.toml"))
                .expect("runtime config metadata")
                .file_type()
                .is_symlink()
        );
        assert_eq!(
            std::fs::canonicalize(runtime_home.join("credentials"))
                .expect("runtime credentials target"),
            std::fs::canonicalize(source_home.join("credentials"))
                .expect("source credentials target")
        );
        assert_eq!(
            std::fs::canonicalize(runtime_home.join("sessions")).expect("runtime sessions target"),
            std::fs::canonicalize(source_home.join("sessions")).expect("source sessions target")
        );
        assert_eq!(
            std::fs::canonicalize(runtime_home.join("session_index.jsonl"))
                .expect("runtime session index target"),
            std::fs::canonicalize(source_home.join("session_index.jsonl"))
                .expect("source session index target")
        );
        assert_eq!(
            tokio::fs::read(&source_config_path)
                .await
                .expect("read source Kimi config after preparation"),
            original_config
        );
        assert_eq!(
            tokio::fs::read(&source_credentials_path)
                .await
                .expect("read source Kimi credentials after preparation"),
            original_credentials
        );
        assert_eq!(
            tokio::fs::read(&source_mcp_path)
                .await
                .expect("read source Kimi MCP after preparation"),
            original_mcp
        );
        assert!(executor.is_authenticated(&env));
        assert_eq!(effective.server_names(), ["member-only".to_string()].into());
        assert_eq!(
            executor
                .acp_harness(&env)
                .await
                .expect("Kimi native MCP harness")
                .mcp_server_count(),
            0
        );
        tokio::fs::write(runtime_home.join("sessions/shared-state.json"), b"{}")
            .await
            .expect("write shared session state through runtime view");
        assert!(source_home.join("sessions/shared-state.json").is_file());

        drop(prepared.into_cleanup());
        assert!(!snapshot_path.exists());
        assert!(runtime_home.exists());
        assert!(!runtime_home.join("mcp.json").exists());
        assert_eq!(
            tokio::fs::read(&source_config_path)
                .await
                .expect("read source Kimi config after cleanup"),
            original_config
        );
        assert_eq!(
            tokio::fs::read(&source_credentials_path)
                .await
                .expect("read source Kimi credentials after cleanup"),
            original_credentials
        );
        assert_eq!(
            tokio::fs::read(&source_mcp_path)
                .await
                .expect("read source Kimi MCP after cleanup"),
            original_mcp
        );

        let mut next_executor = kimi();
        let mut next_env = ExecutionEnv::new(
            RepoContext::new(workspace.path().to_path_buf(), Vec::new()),
            false,
            String::new(),
        );
        next_env.insert("KIMI_CODE_HOME", source_home.to_string_lossy().into_owned());
        tokio::fs::remove_file(&source_config_path)
            .await
            .expect("remove canonical Kimi config before refresh");
        let next_prepared = next_executor
            .prepare_mcp_for_run(
                &canonical,
                &run_context_for(workspace.path(), session_agent_id),
                &mut next_env,
            )
            .await
            .expect("next Kimi MCP preparation");
        assert_eq!(
            next_env.get("KIMI_CODE_HOME").map(PathBuf::from),
            Some(runtime_home.clone())
        );
        assert!(
            next_env
                .get("KIMI_CODE_HOME")
                .map(PathBuf::from)
                .expect("next Kimi MCP view")
                .join("sessions/shared-state.json")
                .is_file()
        );
        assert!(!runtime_home.join("config.toml").exists());
        drop(next_prepared.into_cleanup());
        assert!(!runtime_home.join("mcp.json").exists());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_preparation_reuses_one_member_runtime_view() {
        let workspace = tempfile::tempdir().expect("workspace");
        let source_home = workspace.path().join("source-kimi-home");
        tokio::fs::create_dir_all(&source_home)
            .await
            .expect("source Kimi home");
        tokio::fs::write(
            source_home.join("config.toml"),
            "[providers.fixture]\ntype = \"openai\"\n",
        )
        .await
        .expect("Kimi config");
        tokio::fs::write(
            source_home.join("mcp.json"),
            r#"{"mcpServers":{"ambient":{"command":"must-not-run"}}}"#,
        )
        .await
        .expect("ambient Kimi MCP");
        let session_agent_id = uuid::Uuid::new_v4();
        let workspace_path = workspace.path().to_path_buf();

        let runtime_homes = futures::future::join_all((0..8).map(|_| {
            let source_home = source_home.clone();
            let workspace_path = workspace_path.clone();
            async move {
                let mut executor = kimi();
                let mut env = ExecutionEnv::new(
                    RepoContext::new(workspace_path.clone(), Vec::new()),
                    false,
                    String::new(),
                );
                env.insert("KIMI_CODE_HOME", source_home.to_string_lossy().into_owned());
                let prepared = executor
                    .prepare_mcp_for_run(
                        &MemberMcpConfig::default(),
                        &run_context_for(&workspace_path, session_agent_id),
                        &mut env,
                    )
                    .await
                    .expect("concurrent Kimi MCP preparation");
                let runtime_home = PathBuf::from(
                    env.get("KIMI_CODE_HOME")
                        .expect("concurrent runtime Kimi home"),
                );
                let runtime_mcp: serde_json::Value = serde_json::from_slice(
                    &tokio::fs::read(runtime_home.join("mcp.json"))
                        .await
                        .expect("concurrent runtime Kimi MCP"),
                )
                .expect("parse concurrent runtime Kimi MCP");
                assert!(
                    runtime_mcp["mcpServers"]
                        .as_object()
                        .expect("runtime server map")
                        .is_empty()
                );
                drop(prepared.into_cleanup());
                runtime_home
            }
        }))
        .await;

        assert!(
            runtime_homes
                .iter()
                .all(|runtime_home| runtime_home == &runtime_homes[0])
        );
        assert!(
            std::fs::read_dir(&runtime_homes[0])
                .expect("runtime Kimi view")
                .all(|entry| !entry
                    .expect("runtime Kimi view entry")
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tmp"))
        );
        assert!(!runtime_homes[0].join("mcp.json").exists());
    }

    #[tokio::test]
    async fn explicit_empty_member_map_hides_ambient_kimi_mcp() {
        let workspace = tempfile::tempdir().expect("workspace");
        let source_home = workspace.path().join("source-kimi-home");
        tokio::fs::create_dir_all(&source_home)
            .await
            .expect("source Kimi home");
        let ambient_path = source_home.join("mcp.json");
        tokio::fs::write(
            &ambient_path,
            br#"{"mcpServers":{"ambient-global":{"command":"must-not-run"}}}"#,
        )
        .await
        .expect("ambient Kimi MCP");
        let original_mcp = tokio::fs::read(&ambient_path)
            .await
            .expect("read original Kimi MCP");
        let mut executor = kimi();
        let mut env = ExecutionEnv::new(
            RepoContext::new(workspace.path().to_path_buf(), Vec::new()),
            false,
            String::new(),
        );
        env.insert("KIMI_CODE_HOME", source_home.to_string_lossy().into_owned());

        let prepared = executor
            .prepare_mcp_for_run(
                &MemberMcpConfig::default(),
                &run_context(workspace.path()),
                &mut env,
            )
            .await
            .expect("empty Kimi MCP preparation");
        let effective = load_prepared_acp_mcp_config(&env)
            .await
            .expect("prepared empty Kimi MCP");
        let runtime_home = PathBuf::from(env.get("KIMI_CODE_HOME").expect("runtime Kimi home"));
        let runtime_mcp: serde_json::Value = serde_json::from_slice(
            &tokio::fs::read(runtime_home.join("mcp.json"))
                .await
                .expect("read runtime Kimi MCP"),
        )
        .expect("parse runtime Kimi MCP");

        assert!(ambient_path.is_file());
        assert_ne!(runtime_home, source_home);
        assert_eq!(
            env.get("KIMI_SHARE_DIR").map(PathBuf::from),
            Some(runtime_home.clone())
        );
        assert!(effective.server_names().is_empty());
        assert!(
            runtime_mcp["mcpServers"]
                .as_object()
                .expect("runtime server map")
                .is_empty()
        );
        assert!(
            !workspace
                .path()
                .join(".openteams/executor-state/kimi-code")
                .exists()
        );
        assert_eq!(
            tokio::fs::read(&ambient_path)
                .await
                .expect("read source Kimi MCP after preparation"),
            original_mcp
        );

        drop(prepared.into_cleanup());
        assert!(runtime_home.exists());
        assert!(!runtime_home.join("mcp.json").exists());
        assert_eq!(
            tokio::fs::read(&ambient_path)
                .await
                .expect("read source Kimi MCP after cleanup"),
            original_mcp
        );
    }

    #[tokio::test]
    async fn home_without_ambient_mcp_stays_canonical() {
        let workspace = tempfile::tempdir().expect("workspace");
        let source_home = workspace.path().join("source-kimi-home");
        tokio::fs::create_dir_all(&source_home)
            .await
            .expect("source Kimi home");
        tokio::fs::write(
            source_home.join("config.toml"),
            "[providers.fixture]\ntype = \"openai\"\n",
        )
        .await
        .expect("Kimi config");
        let mut executor = kimi();
        let mut env = ExecutionEnv::new(
            RepoContext::new(workspace.path().to_path_buf(), Vec::new()),
            false,
            String::new(),
        );
        env.insert("KIMI_CODE_HOME", source_home.to_string_lossy().into_owned());

        let prepared = executor
            .prepare_mcp_for_run(
                &MemberMcpConfig::default(),
                &run_context(workspace.path()),
                &mut env,
            )
            .await
            .expect("Kimi MCP preparation");

        assert_eq!(
            env.get("KIMI_CODE_HOME").map(String::as_str),
            Some(source_home.to_string_lossy().as_ref())
        );
        assert!(env.get("KIMI_SHARE_DIR").is_none());

        drop(prepared.into_cleanup());
        assert!(source_home.join("config.toml").is_file());
    }

    #[tokio::test]
    async fn member_stdio_mcp_uses_native_view_without_acp_injection() {
        let workspace = tempfile::tempdir().expect("workspace");
        let source_home = workspace.path().join("source-kimi-home");
        let command = std::env::current_exe()
            .expect("current executable")
            .to_string_lossy()
            .into_owned();
        let canonical = MemberMcpConfig {
            mcp_servers: [(
                "playwright".to_string(),
                serde_json::json!({"command": command}),
            )]
            .into_iter()
            .collect(),
        };
        let mut executor = kimi();
        let mut env = ExecutionEnv::new(
            RepoContext::new(workspace.path().to_path_buf(), Vec::new()),
            false,
            String::new(),
        );
        env.insert("KIMI_CODE_HOME", source_home.to_string_lossy().into_owned());

        let prepared = executor
            .prepare_mcp_for_run(&canonical, &run_context(workspace.path()), &mut env)
            .await
            .expect("Kimi native MCP preparation");
        let runtime_home = PathBuf::from(env.get("KIMI_CODE_HOME").expect("runtime Kimi home"));
        let runtime_mcp: serde_json::Value = serde_json::from_slice(
            &tokio::fs::read(runtime_home.join("mcp.json"))
                .await
                .expect("runtime Kimi MCP"),
        )
        .expect("parse runtime Kimi MCP");
        let harness = executor
            .acp_harness(&env)
            .await
            .expect("Kimi native MCP harness");

        assert_ne!(runtime_home, source_home);
        assert_eq!(runtime_mcp["mcpServers"]["playwright"]["command"], command);
        assert_eq!(harness.mcp_server_count(), 0);

        drop(prepared.into_cleanup());
        assert!(!runtime_home.join("mcp.json").exists());
        assert!(source_home.join("sessions").is_dir());
        assert!(source_home.join("session_index.jsonl").is_file());
    }

    #[tokio::test]
    async fn legacy_kimi_share_dir_provides_models_and_default() {
        let temp = TempDir::new().expect("create legacy Kimi home");
        tokio::fs::write(
            temp.path().join("config.toml"),
            r#"
                default_model = "kimi-code/k3"

                [models."kimi-code/kimi-for-coding"]
                model = "kimi-for-coding"

                [models."kimi-code/k3"]
                model = "k3"
            "#,
        )
        .await
        .expect("write legacy Kimi config");
        let mut env = ExecutionEnv::new(
            RepoContext::new(temp.path().to_path_buf(), Vec::new()),
            false,
            String::new(),
        );
        env.insert("KIMI_SHARE_DIR", temp.path().to_string_lossy().into_owned());

        assert_eq!(
            kimi().configured_models(&env).await,
            vec![
                "kimi-code/k3".to_string(),
                "kimi-code/kimi-for-coding".to_string()
            ]
        );
        assert_eq!(
            kimi().configured_default_model(&env).await.as_deref(),
            Some("kimi-code/k3")
        );
        assert_eq!(
            kimi_mcp_config_path(Some(&env)),
            Some(temp.path().join("mcp.json"))
        );
        assert_eq!(
            kimi_runtime_config_path(Some(&env)),
            Some(temp.path().join("config.toml"))
        );
    }

    #[tokio::test]
    async fn unsupported_provider_command_falls_back_to_configured_models() {
        let temp = TempDir::new().expect("create legacy Kimi home");
        tokio::fs::write(
            temp.path().join("config.toml"),
            r#"
                [models."kimi-code/kimi-for-coding"]
                model = "kimi-for-coding"
            "#,
        )
        .await
        .expect("write legacy Kimi config");
        let mut env = ExecutionEnv::new(
            RepoContext::new(temp.path().to_path_buf(), Vec::new()),
            false,
            String::new(),
        );
        env.insert("KIMI_SHARE_DIR", temp.path().to_string_lossy().into_owned());
        let mut executor = kimi();
        executor.model = None;
        #[cfg(windows)]
        {
            executor.cmd.base_command_override = Some("cmd.exe /c exit /b 2".to_string());
        }
        #[cfg(not(windows))]
        {
            executor.cmd.base_command_override = Some("sh -c 'exit 2'".to_string());
        }

        assert_eq!(
            executor.list_models(temp.path(), &env).await.unwrap(),
            Some(vec!["kimi-code/kimi-for-coding".to_string()])
        );
    }

    #[tokio::test]
    async fn malformed_config_is_skipped_without_failing_probe() {
        let temp = TempDir::new().expect("create Kimi home with malformed config");
        tokio::fs::write(temp.path().join("config.toml"), "default_model = [broken")
            .await
            .expect("write malformed Kimi config");
        let mut env = ExecutionEnv::new(
            RepoContext::new(temp.path().to_path_buf(), Vec::new()),
            false,
            String::new(),
        );
        env.insert("KIMI_SHARE_DIR", temp.path().to_string_lossy().into_owned());

        assert!(kimi().configured_models(&env).await.is_empty());
        assert_eq!(kimi().configured_default_model(&env).await, None);
        let mut executor = kimi();
        executor.model = None;
        #[cfg(windows)]
        {
            executor.cmd.base_command_override = Some("cmd.exe /c exit /b 2".to_string());
        }
        #[cfg(not(windows))]
        {
            executor.cmd.base_command_override = Some("sh -c 'exit 2'".to_string());
        }
        assert_eq!(executor.list_models(temp.path(), &env).await.unwrap(), None);
    }
}
