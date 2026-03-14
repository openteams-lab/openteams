use std::str::FromStr;

use axum::{Json, extract::State, response::Json as ResponseJson};
use db::models::{
    analytics::{track_skill_assign, track_skill_disable, track_skill_enable, track_skill_install},
    chat_agent_skill::{AssignSkillToAgent, ChatAgentSkill, UpdateAgentSkill},
    chat_skill::{ChatSkill, CreateChatSkill, UpdateChatSkill},
};
use deployment::Deployment;
use executors::executors::BaseCodingAgent;
use serde::Deserialize;
use services::services::{
    native_skills::{
        InstalledNativeSkill, NativeSkillError, list_native_skills_for_runner,
        update_native_skill_enabled_for_runner,
    },
    skill_registry::{
        RemoteSkillMeta, RemoteSkillPackage, SkillCategory,
        builtin_skills_count, filter_builtin_skills_by_agent, filter_builtin_skills_by_category,
        get_builtin_categories, get_skill_with_fallback, install_builtin_skill,
        install_skill_with_fallback, list_categories_with_fallback, list_skills_with_fallback,
        search_skills_with_fallback, sync_discovered_global_skills,
        uninstall_skill_files_from_global_directory,
    },
};
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

fn parse_runner_type(runner_type: &str) -> Result<BaseCodingAgent, ApiError> {
    let normalized = runner_type.trim().replace('-', "_").to_ascii_uppercase();
    BaseCodingAgent::from_str(&normalized)
        .map_err(|_| ApiError::BadRequest(format!("Unsupported runner type: {runner_type}")))
}

fn map_native_skill_error(error: NativeSkillError) -> ApiError {
    match error {
        NativeSkillError::Database(error) => ApiError::Database(error),
        NativeSkillError::Executor(error) => ApiError::BadRequest(error.to_string()),
        NativeSkillError::SkillRegistry(error) => ApiError::BadRequest(error.to_string()),
        NativeSkillError::SkillMetadataMissing(message) => ApiError::BadRequest(message),
        NativeSkillError::SkillNotFound(skill_id) => {
            ApiError::BadRequest(format!("Native skill not found: {skill_id}"))
        }
        NativeSkillError::ToggleUnsupported(message) => ApiError::BadRequest(message),
    }
}

// ─── Skill CRUD ───

pub async fn get_skills(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatSkill>>>, ApiError> {
    if let Err(err) = sync_discovered_global_skills(&deployment.db().pool).await {
        tracing::warn!(error = %err, "Failed to sync discovered global skills");
    }

    let skills = ChatSkill::find_all(&deployment.db().pool).await?;
    Ok(ResponseJson(ApiResponse::success(skills)))
}

#[derive(Debug, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct UpdateNativeSkillRequest {
    pub enabled: bool,
}

pub async fn get_native_skills(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path(runner_type): axum::extract::Path<String>,
) -> Result<ResponseJson<ApiResponse<Vec<InstalledNativeSkill>>>, ApiError> {
    let runner = parse_runner_type(&runner_type)?;
    let skills = list_native_skills_for_runner(&deployment.db().pool, runner)
        .await
        .map_err(map_native_skill_error)?;
    Ok(ResponseJson(ApiResponse::success(skills)))
}

pub async fn update_native_skill(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((runner_type, skill_id)): axum::extract::Path<(String, Uuid)>,
    Json(payload): Json<UpdateNativeSkillRequest>,
) -> Result<ResponseJson<ApiResponse<InstalledNativeSkill>>, ApiError> {
    let runner = parse_runner_type(&runner_type)?;
    let skill = update_native_skill_enabled_for_runner(
        &deployment.db().pool,
        runner,
        skill_id,
        payload.enabled,
    )
    .await
    .map_err(map_native_skill_error)?;

    Ok(ResponseJson(ApiResponse::success(skill)))
}

pub async fn get_skill(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path(skill_id): axum::extract::Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<ChatSkill>>, ApiError> {
    let skill = ChatSkill::find_by_id(&deployment.db().pool, skill_id)
        .await?
        .ok_or(ApiError::Database(sqlx::Error::RowNotFound))?;
    Ok(ResponseJson(ApiResponse::success(skill)))
}

pub async fn create_skill(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateChatSkill>,
) -> Result<ResponseJson<ApiResponse<ChatSkill>>, ApiError> {
    let skill = ChatSkill::create(&deployment.db().pool, &payload, Uuid::new_v4()).await?;
    Ok(ResponseJson(ApiResponse::success(skill)))
}

pub async fn update_skill(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path(skill_id): axum::extract::Path<Uuid>,
    Json(payload): Json<UpdateChatSkill>,
) -> Result<ResponseJson<ApiResponse<ChatSkill>>, ApiError> {
    let skill = ChatSkill::update(&deployment.db().pool, skill_id, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(skill)))
}

pub async fn delete_skill(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path(skill_id): axum::extract::Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let skill = ChatSkill::find_by_id(&deployment.db().pool, skill_id)
        .await?
        .ok_or(ApiError::Database(sqlx::Error::RowNotFound))?;

    uninstall_skill_files_from_global_directory(&skill)
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to remove skill directory: {}", e)))?;

    let rows_affected = ChatSkill::delete(&deployment.db().pool, skill_id).await?;
    if rows_affected == 0 {
        Err(ApiError::Database(sqlx::Error::RowNotFound))
    } else {
        Ok(ResponseJson(ApiResponse::success(())))
    }
}

// ─── Agent-Skill Assignment ───

/// Get all skills assigned to a specific agent
pub async fn get_agent_skills(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path(agent_id): axum::extract::Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatSkill>>>, ApiError> {
    let skills = ChatSkill::find_by_agent_id(&deployment.db().pool, agent_id).await?;
    Ok(ResponseJson(ApiResponse::success(skills)))
}

/// Get all agent-skill assignment records for an agent
pub async fn get_agent_skill_assignments(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path(agent_id): axum::extract::Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatAgentSkill>>>, ApiError> {
    let assignments = ChatAgentSkill::find_by_agent_id(&deployment.db().pool, agent_id).await?;
    Ok(ResponseJson(ApiResponse::success(assignments)))
}

/// Assign a skill to an agent
pub async fn assign_skill_to_agent(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<AssignSkillToAgent>,
) -> Result<ResponseJson<ApiResponse<ChatAgentSkill>>, ApiError> {
    let assignment =
        ChatAgentSkill::assign(&deployment.db().pool, &payload, Uuid::new_v4()).await?;

    // Track analytics: skill_assign
    let _ = track_skill_assign(
        &deployment.db().pool,
        None,
        payload.skill_id,
        payload.agent_id,
    )
    .await;

    Ok(ResponseJson(ApiResponse::success(assignment)))
}

/// Update an agent-skill assignment (enable/disable)
pub async fn update_agent_skill(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_agent_id, assignment_id)): axum::extract::Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateAgentSkill>,
) -> Result<ResponseJson<ApiResponse<ChatAgentSkill>>, ApiError> {
    let assignment = ChatAgentSkill::update(&deployment.db().pool, assignment_id, &payload).await?;

    // Track analytics: skill_enable or skill_disable
    if let Some(enabled) = payload.enabled {
        if enabled {
            let _ = track_skill_enable(
                &deployment.db().pool,
                None,
                assignment.skill_id,
                assignment.agent_id,
            )
            .await;
        } else {
            let _ = track_skill_disable(
                &deployment.db().pool,
                None,
                assignment.skill_id,
                assignment.agent_id,
            )
            .await;
        }
    }

    Ok(ResponseJson(ApiResponse::success(assignment)))
}

/// Unassign a skill from an agent
pub async fn unassign_skill_from_agent(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_agent_id, assignment_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let rows_affected = ChatAgentSkill::unassign(&deployment.db().pool, assignment_id).await?;
    if rows_affected == 0 {
        Err(ApiError::Database(sqlx::Error::RowNotFound))
    } else {
        Ok(ResponseJson(ApiResponse::success(())))
    }
}

// ─── Remote Skill Registry ───

#[derive(Debug, Deserialize)]
pub struct RegistryQuery {
    pub registry_url: Option<String>,
}

/// List available skills from the remote registry with fallback to built-in skills
pub async fn list_registry_skills(
    State(_deployment): State<DeploymentImpl>,
    axum::extract::Query(query): axum::extract::Query<RegistryQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<RemoteSkillMeta>>>, ApiError> {
    let skills = list_skills_with_fallback(query.registry_url).await;
    Ok(ResponseJson(ApiResponse::success(skills)))
}

/// Get a specific skill from the registry with fallback to built-in skills
pub async fn get_registry_skill(
    State(_deployment): State<DeploymentImpl>,
    axum::extract::Path(skill_id): axum::extract::Path<String>,
    axum::extract::Query(query): axum::extract::Query<RegistryQuery>,
) -> Result<ResponseJson<ApiResponse<RemoteSkillPackage>>, ApiError> {
    let skill = get_skill_with_fallback(query.registry_url, &skill_id)
        .await
        .ok_or_else(|| ApiError::BadRequest(format!("Skill not found: {}", skill_id)))?;
    Ok(ResponseJson(ApiResponse::success(skill)))
}

/// List available categories from the registry with fallback
pub async fn list_registry_categories(
    State(_deployment): State<DeploymentImpl>,
    axum::extract::Query(query): axum::extract::Query<RegistryQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<SkillCategory>>>, ApiError> {
    let categories = list_categories_with_fallback(query.registry_url).await;
    Ok(ResponseJson(ApiResponse::success(categories)))
}

/// Install a skill from the registry to the local database
/// and download full skill files to global user skill directories.
///
/// Fallback: If remote registry is unavailable, uses built-in skills.
/// Only returns error if skill is not found anywhere.
pub async fn install_registry_skill(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path(skill_id): axum::extract::Path<String>,
    axum::extract::Query(query): axum::extract::Query<RegistryQuery>,
) -> Result<ResponseJson<ApiResponse<ChatSkill>>, ApiError> {
    let installed = install_skill_with_fallback(&deployment.db().pool, &skill_id, query.registry_url.as_deref())
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to install skill: {}", e)))?;

    // Track analytics: skill_install
    let _ = track_skill_install(
        &deployment.db().pool,
        None,
        installed.id,
        &installed.name,
        "registry",
    )
    .await;

    Ok(ResponseJson(ApiResponse::success(installed)))
}

// ─── Built-in Skills (from awesome-claude-skills) ───

#[derive(Debug, Deserialize)]
pub struct BuiltinSkillsQuery {
    pub category: Option<String>,
    pub agent: Option<String>,
    pub search: Option<String>,
}

/// List all skills using dual-source: Go server first, builtin as fallback
pub async fn list_builtin_skills_api(
    State(_deployment): State<DeploymentImpl>,
    axum::extract::Query(query): axum::extract::Query<BuiltinSkillsQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<RemoteSkillMeta>>>, ApiError> {
    // For search queries, use the dual-source search
    if let Some(search) = &query.search {
        let skills = search_skills_with_fallback(None, search).await;
        return Ok(ResponseJson(ApiResponse::success(skills)));
    }

    // For category/agent filters, still use builtin as we have them locally
    // These filters may not be supported by the Go server yet
    if let Some(category) = &query.category {
        return Ok(ResponseJson(ApiResponse::success(
            filter_builtin_skills_by_category(category),
        )));
    }
    if let Some(agent) = &query.agent {
        return Ok(ResponseJson(ApiResponse::success(
            filter_builtin_skills_by_agent(agent),
        )));
    }

    // Default: list all skills from Go server with builtin fallback
    let skills = list_skills_with_fallback(None).await;
    Ok(ResponseJson(ApiResponse::success(skills)))
}

/// Get built-in skills statistics
pub async fn get_builtin_skills_stats(
    State(_deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<BuiltinSkillsStats>>, ApiError> {
    let stats = BuiltinSkillsStats {
        total_skills: builtin_skills_count(),
        categories: get_builtin_categories(),
    };
    Ok(ResponseJson(ApiResponse::success(stats)))
}

#[derive(Debug, serde::Serialize)]
pub struct BuiltinSkillsStats {
    pub total_skills: usize,
    pub categories: Vec<String>,
}

/// Get a specific skill by ID using dual-source: Go server first, builtin as fallback
pub async fn get_builtin_skill_api(
    State(_deployment): State<DeploymentImpl>,
    axum::extract::Path(skill_id): axum::extract::Path<String>,
) -> Result<ResponseJson<ApiResponse<RemoteSkillPackage>>, ApiError> {
    let skill = get_skill_with_fallback(None, &skill_id)
        .await
        .ok_or_else(|| ApiError::BadRequest(format!("Skill not found: {}", skill_id)))?;
    Ok(ResponseJson(ApiResponse::success(skill)))
}

/// Install a built-in skill to the local database
pub async fn install_builtin_skill_api(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path(skill_id): axum::extract::Path<String>,
) -> Result<ResponseJson<ApiResponse<ChatSkill>>, ApiError> {
    let installed = install_builtin_skill(&deployment.db().pool, &skill_id)
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to install skill: {}", e)))?;

    // Track analytics: skill_install
    let _ = track_skill_install(
        &deployment.db().pool,
        None,
        installed.id,
        &installed.name,
        "builtin",
    )
    .await;

    Ok(ResponseJson(ApiResponse::success(installed)))
}
