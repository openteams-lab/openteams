use std::path::Path;

use db::models::{chat_session_agent::ChatSessionAgent, chat_skill::ChatSkill};
use executors::{
    executors::{BaseCodingAgent, StandardCodingAgentExecutor},
    profile::{ExecutorConfigs, ExecutorProfileId},
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

use crate::services::skill_registry::{
    RemoteSkillPackage, SkillRegistryError, find_builtin_skill_by_name,
    install_skill_files_from_embedded, sync_discovered_global_skills,
};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InstalledNativeSkill {
    pub skill: ChatSkill,
    pub enabled: bool,
    pub can_toggle: bool,
    pub native_path: String,
    pub config_path: Option<String>,
}

#[derive(Debug, Error)]
pub enum NativeSkillError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Executor(#[from] executors::executors::ExecutorError),
    #[error(transparent)]
    SkillRegistry(#[from] SkillRegistryError),
    #[error("Native skill metadata not found for installed skill: {0}")]
    SkillMetadataMissing(String),
    #[error("Installed native skill not found: {0}")]
    SkillNotFound(Uuid),
    #[error("Runner does not support native skill toggles: {0}")]
    ToggleUnsupported(String),
}

pub async fn list_native_skills_for_runner(
    pool: &SqlitePool,
    runner: BaseCodingAgent,
) -> Result<Vec<InstalledNativeSkill>, NativeSkillError> {
    sync_discovered_global_skills(pool).await?;

    let executor_profile = ExecutorProfileId::new(runner);
    let executor = ExecutorConfigs::get_cached().get_coding_agent_or_default(&executor_profile);
    let discovered = executor.list_native_skills().await?;
    let all_skills = ChatSkill::find_all(pool).await?;

    let skill_by_slug = all_skills
        .into_iter()
        .map(|skill| (slugify_skill_name(&skill.name), skill))
        .collect::<std::collections::HashMap<_, _>>();

    let mut installed = Vec::new();
    for native_skill in discovered {
        let Some(skill) = skill_by_slug.get(&native_skill.slug).cloned() else {
            tracing::warn!(
                native_skill = %native_skill.name,
                native_path = %native_skill.path.display(),
                "Installed native skill has no matching chat_skills metadata"
            );
            continue;
        };

        installed.push(InstalledNativeSkill {
            skill,
            enabled: native_skill.enabled,
            can_toggle: native_skill.can_toggle,
            native_path: native_skill.path.to_string_lossy().to_string(),
            config_path: native_skill
                .config_path
                .map(|path| path.to_string_lossy().to_string()),
        });
    }

    installed.sort_by(|left, right| left.skill.name.cmp(&right.skill.name));
    Ok(installed)
}

pub async fn update_native_skill_enabled_for_runner(
    pool: &SqlitePool,
    runner: BaseCodingAgent,
    skill_id: Uuid,
    enabled: bool,
) -> Result<InstalledNativeSkill, NativeSkillError> {
    let installed = list_native_skills_for_runner(pool, runner).await?;
    let Some(current) = installed.into_iter().find(|item| item.skill.id == skill_id) else {
        return Err(NativeSkillError::SkillNotFound(skill_id));
    };

    if !current.can_toggle {
        return Err(NativeSkillError::ToggleUnsupported(runner.to_string()));
    }

    let executor_profile = ExecutorProfileId::new(runner);
    let executor = ExecutorConfigs::get_cached().get_coding_agent_or_default(&executor_profile);
    executor
        .set_native_skill_enabled(
            &current.skill.name,
            Path::new(&current.native_path),
            enabled,
        )
        .await?;

    list_native_skills_for_runner(pool, runner)
        .await?
        .into_iter()
        .find(|item| item.skill.id == skill_id)
        .ok_or_else(|| NativeSkillError::SkillNotFound(skill_id))
}

fn slugify_skill_name(name: &str) -> String {
    name.trim().to_lowercase().replace(' ', "-")
}

struct AgentCompatEntry {
    compatible_id: &'static str,
    agent_dir_id: &'static str,
}

static RUNNER_COMPAT_MAP: Lazy<Vec<(&'static str, AgentCompatEntry)>> = Lazy::new(|| {
    vec![
        (
            "CLAUDE_CODE",
            AgentCompatEntry {
                compatible_id: "claude-code",
                agent_dir_id: "claude",
            },
        ),
        (
            "GEMINI",
            AgentCompatEntry {
                compatible_id: "gemini",
                agent_dir_id: "gemini",
            },
        ),
        (
            "CODEX",
            AgentCompatEntry {
                compatible_id: "codex",
                agent_dir_id: "agents",
            },
        ),
        (
            "OPENCODE",
            AgentCompatEntry {
                compatible_id: "opencode",
                agent_dir_id: "agents",
            },
        ),
        (
            "CURSOR_AGENT",
            AgentCompatEntry {
                compatible_id: "cursor",
                agent_dir_id: "cursor",
            },
        ),
        (
            "QWEN_CODE",
            AgentCompatEntry {
                compatible_id: "qwen-code",
                agent_dir_id: "qwen",
            },
        ),
        (
            "COPILOT",
            AgentCompatEntry {
                compatible_id: "copilot",
                agent_dir_id: "copilot",
            },
        ),
        (
            "DROID",
            AgentCompatEntry {
                compatible_id: "droid",
                agent_dir_id: "droid",
            },
        ),
        (
            "KIMI_CODE",
            AgentCompatEntry {
                compatible_id: "kimi",
                agent_dir_id: "kimi",
            },
        ),
        (
            "OPENTEAMS_CLI",
            AgentCompatEntry {
                compatible_id: "openteams-cli",
                agent_dir_id: "agents",
            },
        ),
    ]
});

fn runner_compat_entry(runner: BaseCodingAgent) -> Option<&'static AgentCompatEntry> {
    let key = runner.to_string();
    RUNNER_COMPAT_MAP
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v)
}

pub async fn ensure_builtin_skills_installed(
    pool: &SqlitePool,
    runner: BaseCodingAgent,
    skill_names: &[&str],
) -> Result<(), NativeSkillError> {
    let Some(entry) = runner_compat_entry(runner) else {
        return Ok(());
    };

    if skill_names.is_empty() {
        return Ok(());
    }

    let wanted: Vec<&RemoteSkillPackage> = skill_names
        .iter()
        .filter_map(|name| find_builtin_skill_by_name(name))
        .collect();

    if wanted.is_empty() {
        return Ok(());
    }

    let home_dir = dirs::home_dir().unwrap_or_default();
    let folder = match entry.agent_dir_id {
        "agents" => ".agents",
        "claude" => ".claude",
        "copilot" => ".github",
        "cursor" => ".cursor",
        "qwen" => ".qwen",
        "opencode" => ".opencode",
        "gemini" => ".gemini",
        "kimi" => ".kimi",
        "droid" => ".factory",
        _ => ".agents",
    };
    let skill_root = home_dir.join(folder).join("skills");

    let mut any_installed = false;
    for skill in &wanted {
        let skill_dir = skill_root.join(slugify_skill_name(&skill.name));
        if skill_dir.join("SKILL.md").exists() {
            continue;
        }
        match install_skill_files_from_embedded(skill, Some(&[entry.agent_dir_id.to_string()]))
            .await
        {
            Ok(count) => {
                tracing::info!(
                    skill = %skill.name,
                    files = count,
                    "Auto-installed builtin skill for {}",
                    entry.compatible_id
                );
                any_installed = true;
            }
            Err(err) => {
                tracing::warn!(
                    skill = %skill.name,
                    error = %err,
                    "Failed to auto-install builtin skill"
                );
            }
        }
    }

    if any_installed {
        sync_discovered_global_skills(pool).await?;
    }

    Ok(())
}

pub async fn auto_allow_builtin_skills(
    pool: &SqlitePool,
    session_agent: &mut ChatSessionAgent,
    runner: BaseCodingAgent,
    skill_names: &[&str],
) -> Result<(), NativeSkillError> {
    let Some(_) = runner_compat_entry(runner) else {
        return Ok(());
    };

    if skill_names.is_empty() {
        return Ok(());
    }

    let installed = list_native_skills_for_runner(pool, runner).await?;
    let wanted_names: std::collections::HashSet<String> =
        skill_names.iter().map(|s| slugify_skill_name(s)).collect();

    let builtin_skill_ids: Vec<String> = installed
        .iter()
        .filter(|item| wanted_names.contains(&slugify_skill_name(&item.skill.name)))
        .map(|item| item.skill.id.to_string())
        .collect();

    if builtin_skill_ids.is_empty() {
        return Ok(());
    }

    let existing: std::collections::HashSet<String> = session_agent
        .allowed_skill_ids
        .0
        .iter()
        .filter(|id| !id.trim().is_empty())
        .cloned()
        .collect();

    let mut merged: Vec<String> = existing.into_iter().collect();
    let mut changed = false;
    for id in &builtin_skill_ids {
        if !merged.contains(id) {
            merged.push(id.clone());
            changed = true;
        }
    }

    if changed {
        let updated =
            ChatSessionAgent::update_allowed_skill_ids(pool, session_agent.id, merged).await?;
        *session_agent = updated;
    }

    Ok(())
}
