use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
    time::Duration,
};

use serde::Deserialize;
use serde_json::{Value, json};

use super::Codex;
use crate::{
    env::ExecutionEnv,
    executors::ExecutorError,
    model_discovery::{ExecutorModelInfo, ModelDiscoveryProcess},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelPage {
    data: Vec<Model>,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Model {
    model: String,
    display_name: Option<String>,
    #[serde(default)]
    hidden: bool,
    supported_reasoning_efforts: Option<Vec<ReasoningOption>>,
    default_reasoning_effort: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReasoningOption {
    reasoning_effort: String,
}

impl Codex {
    pub(super) async fn discover_models(
        &self,
        current_dir: &Path,
        env: &ExecutionEnv,
    ) -> Result<Vec<ExecutorModelInfo>, ExecutorError> {
        let mut builder = self.build_command_builder()?;
        if let Some(profile) = &self.profile {
            builder = builder.extend_params([
                "-c".to_string(),
                format!("profile={}", serde_json::to_string(profile)?),
            ]);
        }
        if let Some(provider) = &self.model_provider {
            builder = builder.extend_params([
                "-c".to_string(),
                format!("model_provider={}", serde_json::to_string(provider)?),
            ]);
        }
        let mut process = ModelDiscoveryProcess::start(
            builder,
            current_dir,
            &env.clone().with_profile(&self.cmd),
            &[],
        )
        .await?;
        let result = tokio::time::timeout(Duration::from_secs(30), async {
            process
                .send(&json!({"id": 1, "method": "initialize", "params": {
                    "clientInfo": {"name": "openteams-model-discovery", "version": env!("CARGO_PKG_VERSION")}
                }}))
                .await?;
            rpc_result(&mut process, 1).await?;
            process.send(&json!({"method": "initialized"})).await?;
            let mut cursor: Option<String> = None;
            let mut seen_cursors = HashSet::new();
            let mut models = BTreeMap::new();
            for id in 2..102 {
                let mut params = json!({"limit": 100, "includeHidden": false, "cursor": cursor});
                if let Some(provider) = &self.model_provider {
                    params["modelProvider"] = json!(provider);
                }
                process
                    .send(&json!({"id": id, "method": "model/list", "params": params}))
                    .await?;
                let page: ModelPage = serde_json::from_value(rpc_result(&mut process, id).await?)?;
                for model in page.data {
                    if model.hidden || model.model.trim().is_empty() {
                        continue;
                    }
                    let info = ExecutorModelInfo {
                        id: model.model,
                        display_name: model.display_name,
                        reasoning_efforts: model.supported_reasoning_efforts.map(|options| {
                            options.into_iter().map(|option| option.reasoning_effort).collect()
                        }),
                        default_reasoning_effort: model.default_reasoning_effort,
                    };
                    models.insert(info.id.clone(), info);
                }
                cursor = page.next_cursor;
                let Some(next) = &cursor else {
                    if models.is_empty() {
                        return Err(discovery_error("model/list returned no visible models"));
                    }
                    return Ok(models.into_values().collect());
                };
                if !seen_cursors.insert(next.clone()) {
                    return Err(discovery_error("model/list repeated a pagination cursor"));
                }
            }
            Err(discovery_error("model/list exceeded 100 pages"))
        })
        .await;
        process.stop().await;
        result.map_err(|_| discovery_error("model/list timed out after 30 seconds"))?
    }
}

async fn rpc_result(process: &mut ModelDiscoveryProcess, id: i64) -> Result<Value, ExecutorError> {
    loop {
        let message = process.receive().await?;
        if message.get("id").and_then(Value::as_i64) != Some(id) {
            continue;
        }
        if message.get("error").is_some() {
            return Err(discovery_error(
                "app-server rejected the model discovery request",
            ));
        }
        if let Some(result) = message.get("result") {
            return Ok(result.clone());
        }
    }
}

fn discovery_error(message: &str) -> ExecutorError {
    ExecutorError::Io(std::io::Error::other(format!(
        "Codex model discovery: {message}"
    )))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::executors::StandardCodingAgentExecutor;

    fn fixture(dir: &Path, replies: &[Value]) -> Codex {
        let script = dir.join("codex-models.sh");
        let mut body = String::from("#!/bin/sh\nprintf '%s\\n' \"$@\" > args\n");
        for reply in replies {
            body.push_str(
                "IFS= read -r request || exit 1\nprintf '%s\\n' \"$request\" >> requests\n",
            );
            if !reply.is_null() {
                body.push_str(&format!("printf '%s\\n' '{}'\n", reply));
            }
        }
        // Keep the probe alive until the client explicitly terminates it.
        body.push_str("IFS= read -r unexpected\nexit 1\n");
        std::fs::write(&script, body).unwrap();
        serde_json::from_value(json!({"base_command_override": format!("sh {}", script.display()), "profile": "work", "model_provider": "custom"})).unwrap()
    }

    #[tokio::test]
    async fn model_discovery_reads_all_pages_and_preserves_capabilities() {
        let dir = tempfile::tempdir().unwrap();
        let codex = fixture(
            dir.path(),
            &[
                json!({"id": 1, "result": {}}),
                Value::Null,
                json!({"id": 2, "result": {"data": [
                {"id":"picker-id", "model":"gpt-6.2-astra", "displayName":"GPT-6.2 Astra", "supportedReasoningEfforts":[{"reasoningEffort":"low"},{"reasoningEffort":"ultra"}],"defaultReasoningEffort":"low"},
                {"model":"internal", "hidden":true}
            ],"nextCursor":"second"}}),
                json!({"id": 3, "result": {"data": [{"model":"gpt-6.2-sol"},{"model":"gpt-6.1-terra"}],"nextCursor":null}}),
            ],
        );
        let models = codex
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
            ["gpt-6.1-terra", "gpt-6.2-astra", "gpt-6.2-sol"]
        );
        assert_eq!(
            models[1].reasoning_efforts,
            Some(vec!["low".to_string(), "ultra".to_string()])
        );
        assert_eq!(models[1].default_reasoning_effort.as_deref(), Some("low"));
        let requests = std::fs::read_to_string(dir.path().join("requests"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(requests.len(), 4);
        assert_eq!(requests[0]["method"], "initialize");
        assert_eq!(requests[1]["method"], "initialized");
        assert_eq!(requests[2]["params"]["includeHidden"], false);
        assert_eq!(requests[2]["params"]["modelProvider"], "custom");
        assert_eq!(requests[3]["params"]["cursor"], "second");
    }

    #[tokio::test]
    async fn model_discovery_rejects_partial_repeated_cursor_and_empty_results() {
        for response in [
            json!({"data":[{"model":"first"}],"nextCursor":"loop"}),
            json!({"data":[],"nextCursor":null}),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let codex = fixture(
                dir.path(),
                &[
                    json!({"id":1,"result":{}}),
                    Value::Null,
                    json!({"id":2,"result":response}),
                    json!({"id":3,"result":response}),
                ],
            );
            assert!(
                codex
                    .discover_model_catalog(
                        dir.path(),
                        &ExecutionEnv::new(Default::default(), false, String::new())
                    )
                    .await
                    .is_err()
            );
        }
    }

    #[tokio::test]
    async fn model_discovery_errors_do_not_expose_server_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let codex = fixture(
            dir.path(),
            &[json!({"id":1,"error":{"message":"secret-key-never-show"}})],
        );
        let error = codex
            .discover_model_catalog(
                dir.path(),
                &ExecutionEnv::new(Default::default(), false, String::new()),
            )
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("rejected"));
        assert!(!error.contains("secret-key"));
    }
}
