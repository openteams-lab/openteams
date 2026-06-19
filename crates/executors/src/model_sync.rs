use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use crate::{
    env::ExecutionEnv,
    executors::{
        BaseCodingAgent, CodingAgent, StandardCodingAgentExecutor,
        codex::ReasoningEffort as CodexReasoningEffort,
        droid::ReasoningEffortLevel as DroidReasoningEffort,
    },
    profile::{ExecutorConfig, ExecutorConfigs, ProfileError, canonical_variant_key},
};

const AUTO_MODEL_VARIANT_PREFIX: &str = "AUTO_MODEL_";

pub async fn refresh_profiles_from_agent_models(
    current_dir: &Path,
    env: &ExecutionEnv,
) -> Result<bool, ProfileError> {
    ExecutorConfigs::reload();
    let mut configs = ExecutorConfigs::get_cached();
    let updates = discover_models(&configs, current_dir, env).await;

    if updates.is_empty() {
        return Ok(false);
    }

    let changed = apply_model_updates(&mut configs, &updates);
    if changed {
        configs.save_overrides()?;
        ExecutorConfigs::reload();
    }

    Ok(changed)
}

async fn discover_models(
    configs: &ExecutorConfigs,
    current_dir: &Path,
    env: &ExecutionEnv,
) -> HashMap<BaseCodingAgent, Vec<String>> {
    let mut updates = HashMap::new();

    for (executor, executor_config) in &configs.executors {
        let Some(base) = executor_config
            .get_default()
            .or_else(|| executor_config.configurations.values().next())
        else {
            continue;
        };

        if !base.get_availability_info().is_available() {
            continue;
        }

        match base.list_models(current_dir, env).await {
            Ok(Some(models)) => {
                if !models.is_empty() {
                    updates.insert(*executor, models);
                }
            }
            Ok(None) => {}
            Err(err) => {
                tracing::debug!("Failed to list models for {executor}: {err}");
            }
        }
    }

    updates
}

fn apply_model_updates(
    configs: &mut ExecutorConfigs,
    updates: &HashMap<BaseCodingAgent, Vec<String>>,
) -> bool {
    let mut changed = false;

    for (executor, models) in updates {
        let Some(executor_config) = configs.executors.get_mut(executor) else {
            continue;
        };

        changed |= upsert_model_variants(executor_config, models);
    }

    changed
}

fn upsert_model_variants(executor_config: &mut ExecutorConfig, models: &[String]) -> bool {
    let Some(base) = executor_config
        .get_default()
        .or_else(|| executor_config.configurations.values().next())
        .cloned()
    else {
        return false;
    };

    if !supports_model(&base) {
        return false;
    }

    let mut changed = false;
    let mut desired = HashSet::new();
    for model in models {
        desired.insert(auto_variant_key(model));
    }

    let existing_auto: Vec<String> = executor_config
        .configurations
        .keys()
        .filter(|key| key.starts_with(AUTO_MODEL_VARIANT_PREFIX))
        .cloned()
        .collect();

    for key in existing_auto {
        if !desired.contains(&key) {
            executor_config.configurations.remove(&key);
            changed = true;
        }
    }

    for model in models {
        let key = auto_variant_key(model);
        let Some(config) = with_model(&base, model) else {
            continue;
        };

        match executor_config.configurations.get(&key) {
            Some(existing) if existing == &config => {}
            _ => {
                executor_config.configurations.insert(key, config);
                changed = true;
            }
        }
    }

    changed
}

fn supports_model(config: &CodingAgent) -> bool {
    matches!(
        config,
        CodingAgent::Codex(_)
            | CodingAgent::ClaudeCode(_)
            | CodingAgent::Gemini(_)
            | CodingAgent::Opencode(_)
            | CodingAgent::QwenCode(_)
            | CodingAgent::CursorAgent(_)
            | CodingAgent::Copilot(_)
            | CodingAgent::Droid(_)
            | CodingAgent::KimiCode(_)
            | CodingAgent::OpenTeamsCli(_)
    )
}

pub fn with_model(config: &CodingAgent, model: &str) -> Option<CodingAgent> {
    let model = model.to_string();
    match config {
        CodingAgent::Codex(base) => {
            let mut next = base.clone();
            next.model = Some(model);
            Some(CodingAgent::Codex(next))
        }
        CodingAgent::ClaudeCode(base) => {
            let mut next = base.clone();
            next.model = Some(model);
            Some(CodingAgent::ClaudeCode(next))
        }
        CodingAgent::Gemini(base) => {
            let mut next = base.clone();
            next.model = Some(model);
            Some(CodingAgent::Gemini(next))
        }
        CodingAgent::Opencode(base) => {
            let mut next = base.clone();
            next.model = Some(model);
            Some(CodingAgent::Opencode(next))
        }
        CodingAgent::QwenCode(base) => {
            let mut next = base.clone();
            next.model = Some(model);
            Some(CodingAgent::QwenCode(next))
        }
        CodingAgent::CursorAgent(base) => {
            let mut next = base.clone();
            next.model = Some(model);
            Some(CodingAgent::CursorAgent(next))
        }
        CodingAgent::Copilot(base) => {
            let mut next = base.clone();
            next.model = Some(model);
            Some(CodingAgent::Copilot(next))
        }
        CodingAgent::Droid(base) => {
            let mut next = base.clone();
            next.model = Some(model);
            Some(CodingAgent::Droid(next))
        }
        CodingAgent::KimiCode(base) => {
            let mut next = base.clone();
            next.model = Some(model);
            Some(CodingAgent::KimiCode(next))
        }
        CodingAgent::OpenTeamsCli(base) => {
            let mut next = base.clone();
            next.model = Some(model);
            Some(CodingAgent::OpenTeamsCli(next))
        }
        _ => None,
    }
}

pub fn with_member_execution_overrides(
    config: &CodingAgent,
    model_name: Option<&str>,
    thinking_effort: Option<&str>,
    model_variant: Option<&str>,
) -> CodingAgent {
    let mut next = config.clone();

    if let Some(model) = model_name.and_then(non_empty)
        && let Some(updated) = with_model(&next, model)
    {
        next = updated;
    }

    if let Some(updated) = with_thinking_or_variant(
        &next,
        thinking_effort.and_then(non_empty),
        model_variant.and_then(non_empty),
    ) {
        next = updated;
    }

    next
}

fn with_thinking_or_variant(
    config: &CodingAgent,
    thinking_effort: Option<&str>,
    model_variant: Option<&str>,
) -> Option<CodingAgent> {
    match config {
        CodingAgent::ClaudeCode(base) => {
            let effort = thinking_effort?;
            let mut next = base.clone();
            next.effort = Some(effort.to_string());
            Some(CodingAgent::ClaudeCode(next))
        }
        CodingAgent::Codex(base) => {
            let effort = parse_codex_reasoning_effort(thinking_effort?)?;
            let mut next = base.clone();
            next.model_reasoning_effort = Some(effort);
            Some(CodingAgent::Codex(next))
        }
        CodingAgent::Droid(base) => {
            let effort = parse_droid_reasoning_effort(thinking_effort?)?;
            let mut next = base.clone();
            next.reasoning_effort = Some(effort);
            Some(CodingAgent::Droid(next))
        }
        CodingAgent::Opencode(base) => {
            let variant = model_variant.or(thinking_effort)?;
            let mut next = base.clone();
            next.variant = Some(variant.to_string());
            Some(CodingAgent::Opencode(next))
        }
        CodingAgent::OpenTeamsCli(base) => {
            let variant = model_variant.or(thinking_effort)?;
            let mut next = base.clone();
            next.variant = Some(variant.to_string());
            Some(CodingAgent::OpenTeamsCli(next))
        }
        CodingAgent::Gemini(base) => {
            let effort = thinking_effort?;
            let mut next = base.clone();
            next.thinking_effort = Some(effort.to_string());
            Some(CodingAgent::Gemini(next))
        }
        CodingAgent::QwenCode(base) => {
            let effort = thinking_effort?;
            let mut next = base.clone();
            next.thinking_effort = Some(effort.to_string());
            Some(CodingAgent::QwenCode(next))
        }
        _ => None,
    }
}

fn non_empty(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn parse_codex_reasoning_effort(value: &str) -> Option<CodexReasoningEffort> {
    serde_json::from_value(serde_json::Value::String(value.trim().to_ascii_lowercase())).ok()
}

fn parse_droid_reasoning_effort(value: &str) -> Option<DroidReasoningEffort> {
    serde_json::from_value(serde_json::Value::String(value.trim().to_ascii_lowercase())).ok()
}

fn auto_variant_key(model: &str) -> String {
    canonical_variant_key(model)
}

#[cfg(test)]
mod tests {
    use crate::{
        executors::{AppendPrompt, CodingAgent},
        model_sync::{supports_model, with_member_execution_overrides, with_model},
    };

    #[test]
    fn with_model_sets_kimi_code_model() {
        let base = CodingAgent::KimiCode(crate::executors::kimi::KimiCode {
            append_prompt: AppendPrompt::default(),
            model: None,
            yolo: None,
            cmd: Default::default(),
        });

        assert!(supports_model(&base));

        let Some(CodingAgent::KimiCode(config)) = with_model(&base, "kimi-k2.5") else {
            panic!("expected KimiCode config");
        };

        assert_eq!(config.model.as_deref(), Some("kimi-k2.5"));
    }

    fn agent_from_json(value: serde_json::Value) -> CodingAgent {
        serde_json::from_value(value).expect("deserialize coding agent")
    }

    #[test]
    fn auto_model_variant_keys_do_not_use_legacy_prefix() {
        assert_eq!(
            super::auto_variant_key("opencode/glm-5-free"),
            "opencode/glm-5-free"
        );
        assert_eq!(super::auto_variant_key("gpt-5.2-codex"), "GPT_5.2_CODEX");
    }

    #[test]
    fn model_sync_replaces_legacy_auto_model_prefix_keys() {
        let mut config = crate::profile::ExecutorConfig::new_with_default(agent_from_json(
            serde_json::json!({ "OPENCODE": {} }),
        ));
        let legacy_key = "AUTO_MODEL_opencode/glm-5-free".to_string();
        let base = config.get_default().unwrap().clone();
        config.configurations.insert(
            legacy_key.clone(),
            super::with_model(&base, "opencode/glm-5-free").unwrap(),
        );

        let changed =
            super::upsert_model_variants(&mut config, &["opencode/glm-5-free".to_string()]);

        assert!(changed);
        assert!(!config.configurations.contains_key(&legacy_key));
        assert!(config.configurations.contains_key("opencode/glm-5-free"));
    }

    #[test]
    fn member_overrides_map_thinking_to_supported_executors() {
        let claude = with_member_execution_overrides(
            &agent_from_json(serde_json::json!({ "CLAUDE_CODE": {} })),
            Some("claude-sonnet-4"),
            Some("high"),
            None,
        );
        let CodingAgent::ClaudeCode(claude) = claude else {
            panic!("expected ClaudeCode");
        };
        assert_eq!(claude.model.as_deref(), Some("claude-sonnet-4"));
        assert_eq!(claude.effort.as_deref(), Some("high"));

        let codex = with_member_execution_overrides(
            &agent_from_json(serde_json::json!({ "CODEX": {} })),
            Some("gpt-5.2-codex"),
            Some("xhigh"),
            None,
        );
        let CodingAgent::Codex(codex) = codex else {
            panic!("expected Codex");
        };
        assert_eq!(codex.model.as_deref(), Some("gpt-5.2-codex"));
        assert!(codex.model_reasoning_effort.is_some());

        let droid = with_member_execution_overrides(
            &agent_from_json(serde_json::json!({ "DROID": {} })),
            None,
            Some("dynamic"),
            None,
        );
        let CodingAgent::Droid(droid) = droid else {
            panic!("expected Droid");
        };
        assert!(droid.reasoning_effort.is_some());

        let opencode = with_member_execution_overrides(
            &agent_from_json(serde_json::json!({ "OPENCODE": {} })),
            Some("openai/gpt-5.2-codex"),
            Some("ignored-effort"),
            Some("thinking-high"),
        );
        let CodingAgent::Opencode(opencode) = opencode else {
            panic!("expected Opencode");
        };
        assert_eq!(opencode.model.as_deref(), Some("openai/gpt-5.2-codex"));
        assert_eq!(opencode.variant.as_deref(), Some("thinking-high"));

        let openteams_cli = with_member_execution_overrides(
            &agent_from_json(serde_json::json!({ "OPEN_TEAMS_CLI": {} })),
            Some("openai/gpt-5.2-codex"),
            Some("thinking-high"),
            None,
        );
        let CodingAgent::OpenTeamsCli(openteams_cli) = openteams_cli else {
            panic!("expected OpenTeamsCli");
        };
        assert_eq!(openteams_cli.model.as_deref(), Some("openai/gpt-5.2-codex"));
        assert_eq!(openteams_cli.variant.as_deref(), Some("thinking-high"));

        let gemini = with_member_execution_overrides(
            &agent_from_json(serde_json::json!({ "GEMINI": {} })),
            None,
            Some("high"),
            None,
        );
        let CodingAgent::Gemini(gemini) = gemini else {
            panic!("expected Gemini");
        };
        assert_eq!(gemini.thinking_effort.as_deref(), Some("high"));

        let qwen = with_member_execution_overrides(
            &agent_from_json(serde_json::json!({ "QWEN_CODE": {} })),
            None,
            Some("max"),
            None,
        );
        let CodingAgent::QwenCode(qwen) = qwen else {
            panic!("expected QwenCode");
        };
        assert_eq!(qwen.thinking_effort.as_deref(), Some("max"));
    }
}
