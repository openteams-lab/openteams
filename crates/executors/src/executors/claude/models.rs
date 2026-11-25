use std::{collections::BTreeMap, path::Path, time::Duration};

use serde::Deserialize;
use serde_json::json;

use super::{ClaudeCode, base_command};
use crate::{
    command::{CommandBuilder, apply_overrides},
    env::ExecutionEnv,
    executors::ExecutorError,
    model_discovery::{ExecutorModelInfo, ModelDiscoveryProcess},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Model {
    value: String,
    display_name: Option<String>,
    supports_effort: Option<bool>,
    supported_effort_levels: Option<Vec<String>>,
}

impl ClaudeCode {
    pub(super) async fn discover_models(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<Vec<ExecutorModelInfo>, ExecutorError> {
        let builder = apply_overrides(
            CommandBuilder::new(base_command(self.claude_code_router.unwrap_or(false)))
                .extend_params([
                    "--print",
                    "--verbose",
                    "--input-format",
                    "stream-json",
                    "--output-format",
                    "stream-json",
                    "--strict-mcp-config",
                    "--mcp-config",
                    "{\"mcpServers\":{}}",
                    "--no-session-persistence",
                ]),
            &self.cmd,
        )?;
        let remove_env = if self.disable_api_key.unwrap_or(false) {
            &["ANTHROPIC_API_KEY"][..]
        } else {
            &[]
        };
        let mut process = ModelDiscoveryProcess::start(
            builder,
            current_dir,
            &env.clone().with_profile(&self.cmd),
            remove_env,
        )
        .await?;
        let result = tokio::time::timeout(Duration::from_secs(30), async {
            process
                .send(&json!({"type": "control_request", "request_id": "models", "request": {"subtype": "initialize"}}))
                .await?;
            loop {
                let message = process.receive().await?;
                if message["type"] != "control_response" || message["response"]["request_id"] != "models" {
                    continue;
                }
                if message["response"]["subtype"] != "success" {
                    return Err(discovery_error("CLI rejected initialize"));
                }
                let entries: Vec<Model> = serde_json::from_value(message["response"]["response"]["models"].clone())?;
                let models = entries
                    .into_iter()
                    .filter(|model| !model.value.trim().is_empty())
                    .map(|model| {
                        let info = ExecutorModelInfo {
                            id: model.value,
                            display_name: model.display_name,
                            reasoning_efforts: if model.supports_effort == Some(false) {
                                Some(Vec::new())
                            } else {
                                model.supported_effort_levels
                            },
                            default_reasoning_effort: None,
                        };
                        (info.id.clone(), info)
                    })
                    .collect::<BTreeMap<_, _>>();
                if models.is_empty() {
                    return Err(discovery_error("initialize returned no models"));
                }
                return Ok(models.into_values().collect());
            }
        })
        .await;
        process.stop().await;
        result.map_err(|_| discovery_error("initialize timed out after 30 seconds"))?
    }
}

fn discovery_error(message: &str) -> ExecutorError {
    ExecutorError::Io(std::io::Error::other(format!(
        "Claude model discovery: {message}"
    )))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::executors::StandardCodingAgentExecutor;

    #[tokio::test]
    async fn fable_selection_and_effort_are_used_for_new_and_resumed_commands() {
        for model in ["fable", "claude-fable-5-2"] {
            let claude: ClaudeCode =
                serde_json::from_value(json!({"model":model, "effort":"max"})).unwrap();
            for args in [
                vec![],
                vec!["--resume".to_string(), "session-id".to_string()],
            ] {
                let (_, command_args) = claude
                    .build_command_builder(None)
                    .await
                    .unwrap()
                    .extend_params(args.clone())
                    .build_initial()
                    .unwrap()
                    .into_parts_for_test();
                assert!(
                    command_args
                        .windows(2)
                        .any(|pair| pair == ["--model", model])
                );
                assert!(
                    command_args
                        .windows(2)
                        .any(|pair| pair == ["--effort", "max"])
                );
                if !args.is_empty() {
                    assert!(
                        command_args
                            .windows(2)
                            .any(|pair| pair == ["--resume", "session-id"])
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn model_discovery_preserves_account_aliases_and_effort_restrictions() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("claude-models.sh");
        let response = json!({"type":"control_response","response":{"subtype":"success","request_id":"models","response":{"models":[
            {"value":"fable","displayName":"Fable 5.2","supportsEffort":true,"supportedEffortLevels":["low","high","max"]},
            {"value":"claude-fable-5-2","displayName":"Fable 5.2 (pinned)"},
            {"value":"haiku","supportsEffort":false,"supportedEffortLevels":["high"]},
            {"value":"sonnet[1m]"}
        ]}}});
        std::fs::write(&script, format!("#!/bin/sh\nprintf '%s\\n' \"$@\" > args\nprintf '%s' \"${{ANTHROPIC_API_KEY-unset}}\" > api-key-state\nIFS= read -r request\nprintf '%s' \"$request\" > request\nprintf '%s\\n' '{}'\nIFS= read -r unexpected\n", response)).unwrap();
        let claude: ClaudeCode = serde_json::from_value(json!({"base_command_override":format!("sh {}",script.display()),"disable_api_key":true,"env":{"ANTHROPIC_API_KEY":"test-secret"}})).unwrap();
        let models = claude
            .discover_model_catalog(
                dir.path(),
                &ExecutionEnv::new(Default::default(), false, String::new()),
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["claude-fable-5-2", "fable", "haiku", "sonnet[1m]"]
        );
        assert_eq!(
            models[1].reasoning_efforts,
            Some(vec![
                "low".to_string(),
                "high".to_string(),
                "max".to_string()
            ])
        );
        assert_eq!(models[2].reasoning_efforts, Some(vec![]));
        assert_eq!(
            std::fs::read_to_string(dir.path().join("api-key-state")).unwrap(),
            "unset"
        );
        let request: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.path().join("request")).unwrap())
                .unwrap();
        assert_eq!(request["request"]["subtype"], "initialize");
        let args = std::fs::read_to_string(dir.path().join("args")).unwrap();
        assert!(args.contains("--strict-mcp-config"));
        assert!(args.contains("--no-session-persistence"));
    }

    #[tokio::test]
    async fn model_discovery_failure_is_reported_instead_of_empty_success() {
        let claude: ClaudeCode =
            serde_json::from_value(json!({"base_command_override":"sh -c 'exit 1'"})).unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert!(
            claude
                .discover_model_catalog(
                    dir.path(),
                    &ExecutionEnv::new(Default::default(), false, String::new())
                )
                .await
                .is_err()
        );
    }
}
