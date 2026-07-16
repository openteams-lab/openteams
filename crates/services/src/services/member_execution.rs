use std::str::FromStr;

use anyhow::{Result, anyhow};
use db::models::{
    chat_agent::ChatAgent,
    chat_session::ChatSession,
    chat_session_agent::ChatSessionAgent,
    member_execution_config::MemberExecutionConfig,
    project_member::{ProjectMember, ProjectMemberType},
    workflow_agent_session::WorkflowAgentSession,
};
use executors::{
    env::ExecutionEnv,
    executors::{BaseCodingAgent, CodingAgent},
    model_sync::with_member_execution_overrides,
    profile::{ExecutorConfigs, ExecutorProfileId, canonical_variant_key},
};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::services::agent_runtime::apply_agent_runtime_config;

pub const EXECUTOR_PROFILE_VARIANT_KEY: &str = "executor_profile_variant";

#[derive(Debug, Clone)]
pub struct EffectiveMemberExecutionConfig {
    pub runner_type: BaseCodingAgent,
    pub profile_id: ExecutorProfileId,
    pub model_name: Option<String>,
    pub thinking_effort: Option<String>,
    pub model_variant: Option<String>,
    pub has_member_config: bool,
}

#[derive(Debug, Clone)]
pub struct SessionAgentExecutionConfigRefresh {
    pub session_agent: ChatSessionAgent,
    pub changed: bool,
}

pub async fn refresh_session_agent_execution_config_before_run(
    pool: &SqlitePool,
    session: &ChatSession,
    session_agent: ChatSessionAgent,
    agent_id: Uuid,
    workflow_agent_session_id: Option<Uuid>,
) -> Result<SessionAgentExecutionConfigRefresh, sqlx::Error> {
    let mut project_member = if let Some(project_member_id) = session_agent.project_member_id {
        ProjectMember::find_by_id(pool, project_member_id).await?
    } else {
        None
    };

    if project_member.as_ref().is_some_and(|member| {
        member.member_type != ProjectMemberType::Agent || member.agent_id != Some(agent_id)
    }) {
        project_member = None;
    }

    if project_member.is_none()
        && let Some(project_id) = session.project_id
    {
        project_member = ProjectMember::find_by_project(pool, project_id)
            .await?
            .into_iter()
            .find(|member| {
                member.member_type == ProjectMemberType::Agent && member.agent_id == Some(agent_id)
            });
    }

    let Some(project_member) = project_member else {
        return Ok(SessionAgentExecutionConfigRefresh {
            session_agent,
            changed: false,
        });
    };

    let current_config = session_agent.execution_config.0.clone().normalized();
    let next_config = project_member.execution_config.0.clone().normalized();
    let changed =
        current_config != next_config || session_agent.project_member_id != Some(project_member.id);
    if !changed {
        return Ok(SessionAgentExecutionConfigRefresh {
            session_agent,
            changed: false,
        });
    }

    if let Some(workflow_agent_session_id) = workflow_agent_session_id {
        WorkflowAgentSession::clear_runtime_ids(pool, workflow_agent_session_id).await?;
    }
    let session_agent = ChatSessionAgent::update_execution_config_for_next_run(
        pool,
        session_agent.id,
        Some(project_member.id),
        next_config,
    )
    .await?;

    Ok(SessionAgentExecutionConfigRefresh {
        session_agent,
        changed: true,
    })
}

impl EffectiveMemberExecutionConfig {
    pub fn analytics_profile_label(&self) -> String {
        if self.has_member_config {
            format!("{}:MEMBER", self.runner_type)
        } else {
            self.profile_id.to_string()
        }
    }
}

pub fn resolve_effective_member_execution_config(
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
) -> Result<EffectiveMemberExecutionConfig> {
    let member_config = session_agent.execution_config.0.clone().normalized();
    let has_member_config = member_config.has_overrides();
    let fallback_runner = parse_runner_type(&agent.runner_type)?;
    let runner_type = member_config.runner_type.unwrap_or(fallback_runner);

    let profile_id = if has_member_config {
        ExecutorProfileId::new(runner_type)
    } else {
        match extract_executor_profile_variant(&agent.tools_enabled.0) {
            Some(variant) => ExecutorProfileId::with_variant(runner_type, variant),
            None => ExecutorProfileId::new(runner_type),
        }
    };

    Ok(EffectiveMemberExecutionConfig {
        runner_type,
        profile_id,
        model_name: resolve_model_name(agent, &member_config, has_member_config),
        thinking_effort: if has_member_config {
            member_config.thinking_effort
        } else {
            None
        },
        model_variant: if has_member_config {
            member_config.model_variant
        } else {
            None
        },
        has_member_config,
    })
}

pub fn build_effective_member_executor(
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    env: &mut ExecutionEnv,
) -> Result<(EffectiveMemberExecutionConfig, CodingAgent)> {
    let resolved = resolve_effective_member_execution_config(agent, session_agent)?;
    let mut executor =
        ExecutorConfigs::get_cached().get_coding_agent_or_default(&resolved.profile_id);
    apply_agent_runtime_config(resolved.runner_type, &mut executor, env)?;
    executor = with_member_execution_overrides(
        &executor,
        resolved.model_name.as_deref(),
        resolved.thinking_effort.as_deref(),
        resolved.model_variant.as_deref(),
    );
    Ok((resolved, executor))
}

pub fn parse_runner_type(raw: &str) -> Result<BaseCodingAgent> {
    let trimmed = raw.trim();
    let mut normalized = trimmed.replace(['-', ' '], "_").to_ascii_uppercase();
    if normalized == "OPENTEAMS_CLI" {
        normalized = "OPEN_TEAMS_CLI".to_string();
    }
    BaseCodingAgent::from_str(&normalized).map_err(|_| anyhow!("unknown runner type: {trimmed}"))
}

pub fn extract_executor_profile_variant(tools_enabled: &serde_json::Value) -> Option<String> {
    let variant = tools_enabled
        .as_object()
        .and_then(|value| value.get(EXECUTOR_PROFILE_VARIANT_KEY))
        .and_then(serde_json::Value::as_str)?
        .trim();
    if variant.is_empty() || variant.eq_ignore_ascii_case("DEFAULT") {
        return None;
    }
    Some(canonical_variant_key(variant))
}

fn resolve_model_name(
    agent: &ChatAgent,
    member_config: &MemberExecutionConfig,
    has_member_config: bool,
) -> Option<String> {
    if has_member_config {
        member_config.model_name.clone()
    } else {
        normalize_optional_string(agent.model_name.clone())
    }
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use db::models::{
        chat_agent::ChatAgent,
        chat_session_agent::{ChatSessionAgent, ChatSessionAgentState},
    };
    use executors::executors::BaseCodingAgent;
    use sqlx::types::Json;
    use uuid::Uuid;

    use super::*;

    fn agent() -> ChatAgent {
        ChatAgent {
            id: Uuid::new_v4(),
            name: "coder".to_string(),
            runner_type: "codex".to_string(),
            system_prompt: String::new(),
            tools_enabled: Json(serde_json::json!({
                "executor_profile_variant": "HIGH_REASONING"
            })),
            model_name: Some("legacy-model".to_string()),
            owner_project_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    fn session_agent(config: MemberExecutionConfig) -> ChatSessionAgent {
        ChatSessionAgent {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            agent_id: Uuid::new_v4(),
            state: ChatSessionAgentState::Idle,
            workspace_path: None,
            pty_session_key: None,
            agent_session_id: None,
            agent_message_id: None,
            project_member_id: None,
            member_name: "member".to_string(),
            execution_config: Json(config),
            allowed_skill_ids: Json(Vec::new()),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn uses_legacy_profile_only_when_member_config_is_empty() {
        let resolved =
            resolve_effective_member_execution_config(&agent(), &session_agent(Default::default()))
                .expect("resolve config");

        assert!(!resolved.has_member_config);
        assert_eq!(resolved.runner_type, BaseCodingAgent::Codex);
        assert_eq!(resolved.model_name.as_deref(), Some("legacy-model"));
        assert!(resolved.profile_id.to_string().contains("HIGH_REASONING"));
    }

    #[test]
    fn member_config_disables_legacy_profile_fallback() {
        let resolved = resolve_effective_member_execution_config(
            &agent(),
            &session_agent(MemberExecutionConfig {
                runner_type: Some(BaseCodingAgent::Gemini),
                model_name: Some("gemini-3-pro-preview".to_string()),
                thinking_effort: Some("high".to_string()),
                model_variant: None,
            }),
        )
        .expect("resolve config");

        assert!(resolved.has_member_config);
        assert_eq!(resolved.runner_type, BaseCodingAgent::Gemini);
        assert_eq!(resolved.model_name.as_deref(), Some("gemini-3-pro-preview"));
        assert_eq!(resolved.thinking_effort.as_deref(), Some("high"));
        assert_eq!(resolved.profile_id.to_string(), "GEMINI");
    }

    #[test]
    fn parses_openteams_cli_runner_aliases() {
        for raw in ["OPEN_TEAMS_CLI", "OPENTEAMS_CLI", "openteams-cli"] {
            assert_eq!(
                parse_runner_type(raw).expect("parse runner"),
                BaseCodingAgent::OpenTeamsCli
            );
        }
    }
}
