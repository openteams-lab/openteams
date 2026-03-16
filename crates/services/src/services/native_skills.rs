use std::path::Path;

use db::models::chat_skill::ChatSkill;
use executors::{
    executors::{BaseCodingAgent, StandardCodingAgentExecutor},
    profile::{ExecutorConfigs, ExecutorProfileId},
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

use crate::services::skill_registry::{SkillRegistryError, sync_discovered_global_skills};

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
