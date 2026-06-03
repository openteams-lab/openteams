use std::{path::Path, sync::Arc};

use async_trait::async_trait;
use derivative::Derivative;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::fs;
use ts_rs::TS;
use uuid::Uuid;
use workspace_utils::msg_store::MsgStore;

use crate::{
    approvals::ExecutorApprovalService,
    command::{CmdOverrides, CommandBuildError, CommandBuilder, apply_overrides},
    env::ExecutionEnv,
    executors::{
        AppendPrompt, AvailabilityInfo, ExecutorError, SpawnedChild, StandardCodingAgentExecutor,
        gemini::AcpAgentHarness,
    },
    model_discovery::{
        ProviderKind, cli_model_commands, discover_from_sources, runner_config_paths,
    },
};

#[derive(Derivative, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[derivative(Debug, PartialEq)]
pub struct QwenCode {
    #[serde(default)]
    pub append_prompt: AppendPrompt,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Model to use (e.g., qwen3-coder-plus, qwen3-coder-flash)")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(
        description = "Per-run Qwen Code reasoning effort: off, low, medium, high, max, or a numeric token budget"
    )]
    pub thinking_effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub yolo: Option<bool>,
    #[serde(flatten)]
    pub cmd: CmdOverrides,
    #[serde(skip)]
    #[ts(skip)]
    #[derivative(Debug = "ignore", PartialEq = "ignore")]
    pub approvals: Option<Arc<dyn ExecutorApprovalService>>,
}

impl QwenCode {
    const BASE_COMMAND: &'static str = "npx -y @qwen-code/qwen-code@0.17.0";
    const MAX_RESUME_PROMPT_BYTES: usize = 160 * 1024;

    fn build_command_builder(&self) -> Result<CommandBuilder, CommandBuildError> {
        let mut builder = CommandBuilder::new(Self::BASE_COMMAND);

        if let Some(model) = &self.model {
            builder = builder.extend_params(["--model", model.as_str()]);
        }

        if self.yolo.unwrap_or(false) {
            builder = builder.extend_params(["--yolo"]);
        }
        builder = builder.extend_params(["--acp"]);
        apply_overrides(builder, &self.cmd)
    }

    async fn env_with_per_run_settings(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<ExecutionEnv, ExecutorError> {
        let Some(effort) = self
            .thinking_effort
            .as_deref()
            .filter(|value| has_value(value))
        else {
            return Ok(env.clone());
        };

        let settings_path = write_internal_settings(
            current_dir,
            "qwen-settings",
            &json!({
                "model": {
                    "generationConfig": {
                        "reasoning": qwen_reasoning_config(effort),
                    }
                }
            }),
        )
        .await?;

        let mut next_env = env.clone();
        next_env.insert(
            "QWEN_CODE_SYSTEM_SETTINGS_PATH",
            settings_path.to_string_lossy().to_string(),
        );
        Ok(next_env)
    }
}

fn has_value(value: &str) -> bool {
    !value.trim().is_empty()
}

fn qwen_reasoning_config(effort: &str) -> serde_json::Value {
    let normalized = effort.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "off" | "none" | "disabled" | "disable" => json!(false),
        "low" | "medium" | "high" | "max" => json!({ "effort": normalized }),
        _ => normalized
            .parse::<i64>()
            .map(|budget| json!({ "budget_tokens": budget.max(0) }))
            .unwrap_or_else(|_| json!({ "effort": normalized })),
    }
}

async fn write_internal_settings(
    current_dir: &Path,
    prefix: &str,
    value: &serde_json::Value,
) -> Result<std::path::PathBuf, ExecutorError> {
    let dir = current_dir.join(".openteams").join("tmp");
    fs::create_dir_all(&dir).await.map_err(ExecutorError::Io)?;
    let path = dir.join(format!("{prefix}-{}.json", Uuid::new_v4()));
    let body = serde_json::to_vec_pretty(value)?;
    fs::write(&path, body).await.map_err(ExecutorError::Io)?;
    Ok(path)
}

#[async_trait]
impl StandardCodingAgentExecutor for QwenCode {
    fn use_approvals(&mut self, approvals: Arc<dyn ExecutorApprovalService>) {
        self.approvals = Some(approvals);
    }

    async fn list_models(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<Option<Vec<String>>, ExecutorError> {
        let config_paths = runner_config_paths([
            self.default_mcp_config_path(),
            dirs::home_dir().map(|home| home.join(".qwen").join("settings.jsonc")),
        ]);
        discover_from_sources(
            current_dir,
            env,
            &self.cmd,
            self.model.as_deref(),
            config_paths,
            cli_model_commands(Self::BASE_COMMAND, &self.cmd),
            &[ProviderKind::OpenAiCompatible],
        )
        .await
    }

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let qwen_command = self.build_command_builder()?.build_initial()?;
        let combined_prompt = self.append_prompt.combine_prompt(prompt);
        let harness = AcpAgentHarness::with_session_namespace("qwen_sessions")
            .with_max_resume_prompt_bytes(Self::MAX_RESUME_PROMPT_BYTES);
        let runtime_env = self.env_with_per_run_settings(current_dir, env).await?;
        let approvals = if self.yolo.unwrap_or(false) {
            None
        } else {
            self.approvals.clone()
        };
        harness
            .spawn_with_command(
                current_dir,
                combined_prompt,
                qwen_command,
                &runtime_env,
                &self.cmd,
                approvals,
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
        let qwen_command = self.build_command_builder()?.build_follow_up(&[])?;
        let combined_prompt = self.append_prompt.combine_prompt(prompt);
        let harness = AcpAgentHarness::with_session_namespace("qwen_sessions")
            .with_max_resume_prompt_bytes(Self::MAX_RESUME_PROMPT_BYTES);
        let runtime_env = self.env_with_per_run_settings(current_dir, env).await?;
        let approvals = if self.yolo.unwrap_or(false) {
            None
        } else {
            self.approvals.clone()
        };
        harness
            .spawn_follow_up_with_command(
                current_dir,
                combined_prompt,
                session_id,
                qwen_command,
                &runtime_env,
                &self.cmd,
                approvals,
            )
            .await
    }

    fn normalize_logs(&self, msg_store: Arc<MsgStore>, worktree_path: &Path) {
        crate::executors::acp::normalize_logs(msg_store, worktree_path);
    }

    // MCP configuration methods
    fn default_mcp_config_path(&self) -> Option<std::path::PathBuf> {
        dirs::home_dir().map(|home| home.join(".qwen").join("settings.json"))
    }

    fn native_skill_discovery_roots(&self) -> Vec<std::path::PathBuf> {
        dirs::home_dir()
            .map(|home| vec![home.join(".qwen").join("skills")])
            .unwrap_or_default()
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        let mcp_config_found = self
            .default_mcp_config_path()
            .map(|p| p.exists())
            .unwrap_or(false);

        let installation_indicator_found = dirs::home_dir()
            .map(|home| home.join(".qwen").join("installation_id").exists())
            .unwrap_or(false);

        if mcp_config_found || installation_indicator_found {
            AvailabilityInfo::InstallationFound
        } else {
            AvailabilityInfo::NotFound
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_builder_uses_current_acp_flag() {
        let qwen = QwenCode {
            append_prompt: AppendPrompt::default(),
            model: Some("qwen3-coder-plus".to_string()),
            thinking_effort: None,
            yolo: Some(true),
            cmd: CmdOverrides::default(),
            approvals: None,
        };

        let (_program, args) = qwen
            .build_command_builder()
            .expect("build command")
            .build_initial()
            .expect("build initial")
            .into_parts_for_test();

        assert!(args.iter().any(|arg| arg == "--acp"));
        assert!(!args.iter().any(|arg| arg == "--experimental-acp"));
    }
}
