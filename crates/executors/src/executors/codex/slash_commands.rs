use std::path::Path;

use codex_app_server_protocol::{JSONRPCNotification, ThreadResumeParams};
use codex_protocol::protocol::{
    AgentMessageEvent, ErrorEvent, EventMsg, RolloutItem, TokenUsageInfo, TurnContextItem,
};
use serde_json::json;

use super::{
    Codex,
    client::{AppServerClient, LogWriter},
    session::SessionHandler,
};
use crate::{
    env::ExecutionEnv,
    executors::{
        ExecutorError, ExecutorExitResult, SpawnedChild,
        utils::{SlashCommandCall, parse_slash_command},
    },
    stdout_dup::spawn_local_output_process,
};

const CODEX_INIT_PROMPT: &str = include_str!("init_prompt.md");
const DEFAULT_PROJECT_DOC_FILENAME: &str = "AGENTS.md";

#[derive(Debug, Clone)]
pub enum CodexSlashCommand {
    Init,
    Compact { instructions: Option<String> },
    Status,
    Mcp,
}

impl CodexSlashCommand {
    pub fn parse(prompt: &str) -> Option<Self> {
        let cmd: SlashCommandCall<'_> = parse_slash_command(prompt)?;
        match cmd.name.as_str() {
            "init" => Some(Self::Init),
            "compact" => Some(Self::Compact {
                instructions: if cmd.arguments.is_empty() {
                    None
                } else {
                    Some(cmd.arguments.to_string())
                },
            }),
            "status" => Some(Self::Status),
            "mcp" => Some(Self::Mcp),
            _ => None,
        }
    }
}

impl Codex {
    pub async fn spawn_slash_command(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        if let Some(command) = CodexSlashCommand::parse(prompt) {
            return match command {
                CodexSlashCommand::Init => {
                    let init_target = current_dir.join(DEFAULT_PROJECT_DOC_FILENAME);
                    if init_target.exists() {
                        let message = format!(
                            "`{DEFAULT_PROJECT_DOC_FILENAME}` already exists. Skipping `/init` to avoid overwriting it."
                        );
                        self.return_static_reply(current_dir, Ok(message)).await
                    } else {
                        self.spawn_agent_with_prompt(
                            current_dir,
                            CODEX_INIT_PROMPT,
                            session_id,
                            env,
                        )
                        .await
                    }
                }
                CodexSlashCommand::Compact { instructions } => match session_id {
                    Some(session_id) => {
                        self.perform_compact(current_dir, session_id, instructions, env)
                            .await
                    }
                    None => {
                        self.return_static_reply(
                            current_dir,
                            Ok("_No active session to compact._".to_string()),
                        )
                        .await
                    }
                },
                CodexSlashCommand::Status => {
                    self.return_static_reply(
                        current_dir,
                        self.build_status_message(session_id)
                            .await
                            .map_err(|err| format!("Status unavailable: {err}")),
                    )
                    .await
                }
                CodexSlashCommand::Mcp => {
                    self.handle_app_server_slash_command(current_dir, command, env)
                        .await
                }
            };
        }

        self.spawn_agent_with_prompt(current_dir, prompt, session_id, env)
            .await
    }

    async fn spawn_agent_with_prompt(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let command_parts = match session_id {
            Some(_) => self.build_command_builder()?.build_follow_up(&[])?,
            None => self.build_command_builder()?.build_initial()?,
        };
        let combined_prompt = self.append_prompt.combine_prompt(prompt);
        let action = super::CodexSessionAction::Chat {
            prompt: combined_prompt,
        };
        self.spawn_inner(current_dir, command_parts, action, session_id, env)
            .await
    }

    async fn perform_compact(
        &self,
        current_dir: &Path,
        session_id: &str,
        _instructions: Option<String>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let command_parts = self.build_command_builder()?.build_initial()?;
        let thread_params = self.build_thread_start_params(current_dir);
        let session_id = session_id.to_string();

        self.spawn_app_server(
            current_dir,
            command_parts,
            env,
            move |client, _exit_signal_tx| async move {
                let auth_status = client.get_auth_status().await?;
                if auth_status.requires_openai_auth.unwrap_or(true)
                    && auth_status.auth_method.is_none()
                {
                    return Err(ExecutorError::AuthRequired(
                        "Codex authentication required".to_string(),
                    ));
                }

                let rollout_path = SessionHandler::find_rollout_file_path(&session_id)
                    .map_err(|err| ExecutorError::Io(std::io::Error::other(err.to_string())))?;
                let params = ThreadResumeParams {
                    thread_id: session_id,
                    path: Some(rollout_path),
                    model: thread_params.model,
                    model_provider: thread_params.model_provider,
                    cwd: thread_params.cwd,
                    approval_policy: thread_params.approval_policy,
                    sandbox: thread_params.sandbox,
                    config: thread_params.config,
                    base_instructions: thread_params.base_instructions,
                    developer_instructions: thread_params.developer_instructions,
                    ..Default::default()
                };
                let response = client.resume_thread(params).await?;
                let thread_id = response.thread.id;
                client.register_session(&thread_id).await?;
                client.start_compact(thread_id).await?;
                Ok(())
            },
        )
        .await
    }

    // Handle slash commands that require interaction with the app server
    async fn handle_app_server_slash_command(
        &self,
        current_dir: &Path,
        command: CodexSlashCommand,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let command_parts = self.build_command_builder()?.build_initial()?;

        self.spawn_app_server(
            current_dir,
            command_parts,
            env,
            move |client, exit_signal_tx| async move {
                match command {
                    CodexSlashCommand::Mcp => {
                        let message = fetch_mcp_status_message(&client).await?;
                        log_event_raw(client.log_writer(), message).await?;
                    }
                    _ => {
                        return Err(ExecutorError::Io(std::io::Error::other(
                            "Unsupported Codex slash command",
                        )));
                    }
                }

                // singal completion because the app server doesn't produce codex/event/task_complete for these API calls
                exit_signal_tx
                    .send_exit_signal(ExecutorExitResult::Success)
                    .await;

                Ok(())
            },
        )
        .await
    }

    pub async fn return_static_reply(
        &self,
        current_dir: &Path,
        message: Result<String, String>,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn_static_reply_helper(
            current_dir,
            vec![match message {
                Ok(message) => EventMsg::AgentMessage(AgentMessageEvent {
                    message,
                    phase: None,
                    memory_citation: None,
                }),
                Err(message) => EventMsg::Error(ErrorEvent {
                    message,
                    codex_error_info: None,
                }),
            }],
        )
        .await
    }

    // Helper to spawn a process whose sole purpose is to channel back a static reply
    pub async fn spawn_static_reply_helper(
        &self,
        _current_dir: &Path,
        events: Vec<EventMsg>,
    ) -> Result<SpawnedChild, ExecutorError> {
        let (mut spawned, writer) = spawn_local_output_process()?;
        let log_writer = LogWriter::new(writer);
        let (exit_signal_tx, exit_signal_rx) = tokio::sync::oneshot::channel();

        tokio::spawn(async move {
            let mut exit_result = ExecutorExitResult::Success;
            for event in events {
                if let Err(err) = log_event_notification(&log_writer, event).await {
                    tracing::error!("Failed to emit slash command output: {err}");
                    exit_result = ExecutorExitResult::Failure;
                    break;
                }
            }
            let _ = exit_signal_tx.send(exit_result);
        });

        spawned.exit_signal = Some(exit_signal_rx);
        Ok(spawned)
    }

    async fn build_status_message(
        &self,
        session_id: Option<&str>,
    ) -> Result<String, ExecutorError> {
        let mut model = self.model.clone();
        let mut approval_policy = self
            .ask_for_approval
            .as_ref()
            .map(|policy| policy.as_ref().to_string());
        let mut sandbox = self.sandbox.as_ref().map(|mode| mode.as_ref().to_string());
        let mut reasoning = None;
        let mut token_usage = None;

        if let Some(session_id) = session_id {
            let items = Self::load_rollout_items(session_id).await?;
            if let Some(context) = Self::latest_turn_context(&items) {
                model = Some(context.model);
                approval_policy = Some(context.approval_policy.to_string());
                sandbox = Some(context.sandbox_policy.to_string());
                reasoning = Some(format!(
                    "effort: {} summary: {}",
                    context
                        .effort
                        .map(|effort| effort.to_string())
                        .unwrap_or_else(|| "default".to_string()),
                    context.summary
                ));
            }
            token_usage = Self::latest_token_usage(&items);
        }

        let mut lines = Vec::new();
        lines.push("# Session Status\n".to_string());

        // Configuration section
        lines.push("## Configuration".to_string());
        lines.push(format!(
            "- **Model**: `{}`",
            model.unwrap_or_else(|| "unknown".to_string())
        ));
        if let Some(approval_policy) = approval_policy {
            lines.push(format!("- **Approvals**: `{approval_policy}`"));
        }
        if let Some(sandbox) = sandbox {
            lines.push(format!("- **Sandbox**: `{sandbox}`"));
        }
        if let Some(reasoning) = reasoning {
            lines.push(format!("- **Reasoning**: {reasoning}"));
        }

        // Token usage section
        lines.push("\n## Token Usage".to_string());
        if let Some(token_usage) = token_usage {
            lines.extend(Self::format_token_usage(&token_usage));
        } else {
            lines.push("_Token usage unavailable_".to_string());
        }

        Ok(lines.join("\n"))
    }

    async fn load_rollout_items(session_id: &str) -> Result<Vec<RolloutItem>, ExecutorError> {
        let rollout_path = SessionHandler::find_rollout_file_path(session_id)
            .map_err(|err| ExecutorError::Io(std::io::Error::other(err.to_string())))?;
        let content = tokio::fs::read_to_string(&rollout_path)
            .await
            .map_err(ExecutorError::Io)?;
        let mut items = Vec::new();
        for (index, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let item = serde_json::from_str::<RolloutItem>(line).map_err(|err| {
                ExecutorError::Io(std::io::Error::other(format!(
                    "failed to parse rollout item at line {} in {}: {err}",
                    index + 1,
                    rollout_path.display()
                )))
            })?;
            items.push(item);
        }
        Ok(items)
    }

    fn latest_turn_context(items: &[RolloutItem]) -> Option<TurnContextItem> {
        items.iter().rev().find_map(|item| match item {
            RolloutItem::TurnContext(context) => Some(context.clone()),
            _ => None,
        })
    }

    fn latest_token_usage(items: &[RolloutItem]) -> Option<TokenUsageInfo> {
        items.iter().rev().find_map(|item| match item {
            RolloutItem::EventMsg(EventMsg::TokenCount(payload)) => payload.info.clone(),
            _ => None,
        })
    }

    fn format_token_usage(info: &TokenUsageInfo) -> Vec<String> {
        let total = &info.total_token_usage;
        let last = &info.last_token_usage;
        let mut lines = Vec::new();

        // Total tokens
        lines.push(format!("**Total**: `{}`", total.total_tokens));
        lines.push(format!(
            "  - Input: `{}` | Output: `{}` | Reasoning: `{}` | Cached: `{}`",
            total.input_tokens,
            total.output_tokens,
            total.reasoning_output_tokens,
            total.cached_input_tokens,
        ));

        // Last turn tokens
        lines.push(format!("\n**Last Turn**: `{}`", last.total_tokens));
        lines.push(format!(
            "  - Input: `{}` | Output: `{}` | Reasoning: `{}` | Cached: `{}`",
            last.input_tokens,
            last.output_tokens,
            last.reasoning_output_tokens,
            last.cached_input_tokens,
        ));

        // Context window
        if let Some(window) = info.model_context_window {
            lines.push(format!("\n**Context Window**: `{window}`"));
        }

        lines
    }

    pub async fn log_event(
        &self,
        log_writer: &LogWriter,
        event: EventMsg,
    ) -> Result<(), ExecutorError> {
        log_event_notification(log_writer, event).await
    }
}

pub async fn log_event_notification(
    log_writer: &LogWriter,
    event: EventMsg,
) -> Result<(), ExecutorError> {
    let event = match event {
        EventMsg::SessionConfigured(mut configured) => {
            configured.initial_messages = None;
            EventMsg::SessionConfigured(configured)
        }
        other => other,
    };
    let notification = JSONRPCNotification {
        method: "codex/event".to_string(),
        params: Some(json!({ "msg": event })),
    };
    let raw = serde_json::to_string(&notification)
        .map_err(|err| ExecutorError::Io(std::io::Error::other(err.to_string())))?;
    log_writer.log_raw(&raw).await
}

pub async fn log_event_raw(log_writer: &LogWriter, message: String) -> Result<(), ExecutorError> {
    log_event_notification(
        log_writer,
        EventMsg::AgentMessage(AgentMessageEvent {
            message,
            phase: None,
            memory_citation: None,
        }),
    )
    .await
}

async fn fetch_mcp_status_message(client: &AppServerClient) -> Result<String, ExecutorError> {
    let mut cursor = None;
    let mut servers = Vec::new();
    loop {
        let response = client.list_mcp_server_status(cursor).await?;
        servers.extend(response.data);
        cursor = response.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    Ok(format_mcp_status(&servers))
}

fn format_mcp_status(servers: &[codex_app_server_protocol::McpServerStatus]) -> String {
    if servers.is_empty() {
        return "_No MCP servers configured._".to_string();
    }
    let mut lines = vec![format!("# MCP Servers ({})\n", servers.len())];
    for server in servers {
        let auth = format_mcp_auth_status(&server.auth_status);
        lines.push(format!("## {}", server.name));
        lines.push(format!("- **Auth**: `{auth}`"));

        let mut tools: Vec<String> = server.tools.keys().cloned().collect();
        tools.sort();
        if tools.is_empty() {
            lines.push("- **Tools**: _none_".to_string());
        } else {
            lines.push(format!("- **Tools**: `{}`", tools.join("`, `")));
        }

        if !server.resources.is_empty() {
            let mut names: Vec<String> = server
                .resources
                .iter()
                .map(|res| res.name.clone())
                .collect();
            names.sort();
            lines.push(format!("- **Resources**: `{}`", names.join("`, `")));
        }

        if !server.resource_templates.is_empty() {
            let mut names: Vec<String> = server
                .resource_templates
                .iter()
                .map(|template| template.name.clone())
                .collect();
            names.sort();
            lines.push(format!(
                "- **Resource Templates**: `{}`",
                names.join("`, `")
            ));
        }

        lines.push(String::new()); // Empty line between servers
    }
    lines.join("\n")
}

fn format_mcp_auth_status(status: &codex_app_server_protocol::McpAuthStatus) -> &'static str {
    match status {
        codex_app_server_protocol::McpAuthStatus::Unsupported => "unsupported",
        codex_app_server_protocol::McpAuthStatus::NotLoggedIn => "not logged in",
        codex_app_server_protocol::McpAuthStatus::BearerToken => "bearer token",
        codex_app_server_protocol::McpAuthStatus::OAuth => "oauth",
    }
}
