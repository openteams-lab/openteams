use axum::{Json, extract::State, response::Json as ResponseJson};
use db::models::{
    chat_agent_skill::{AssignSkillToAgent, ChatAgentSkill, UpdateAgentSkill},
    chat_skill::{ChatSkill, CreateChatSkill, UpdateChatSkill},
};
use deployment::Deployment;
use serde::Deserialize;
use services::services::skill_registry::{
    RemoteSkillMeta, RemoteSkillPackage, SkillCategory, SkillRegistryClient, builtin_skills_count,
    filter_builtin_skills_by_agent, filter_builtin_skills_by_category, get_builtin_categories,
    get_builtin_skill, install_builtin_skill, install_skill_files_to_global_directory,
    install_skill_from_registry, list_builtin_skills, search_builtin_skills,
    uninstall_skill_files_from_global_directory,
};
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

// ─── Skill CRUD ───

pub async fn get_skills(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatSkill>>>, ApiError> {
    let skills = ChatSkill::find_all(&deployment.db().pool).await?;
    Ok(ResponseJson(ApiResponse::success(skills)))
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
    Ok(ResponseJson(ApiResponse::success(assignment)))
}

/// Update an agent-skill assignment (enable/disable)
pub async fn update_agent_skill(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_agent_id, assignment_id)): axum::extract::Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateAgentSkill>,
) -> Result<ResponseJson<ApiResponse<ChatAgentSkill>>, ApiError> {
    let assignment = ChatAgentSkill::update(&deployment.db().pool, assignment_id, &payload).await?;
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

/// List available skills from the remote registry
pub async fn list_registry_skills(
    State(_deployment): State<DeploymentImpl>,
    axum::extract::Query(query): axum::extract::Query<RegistryQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<RemoteSkillMeta>>>, ApiError> {
    let client = SkillRegistryClient::new(query.registry_url);
    let skills = client.list_skills().await.map_err(|e| {
        ApiError::BadRequest(format!("Failed to fetch skills from registry: {}", e))
    })?;
    Ok(ResponseJson(ApiResponse::success(skills)))
}

/// Get a specific skill from the registry
pub async fn get_registry_skill(
    State(_deployment): State<DeploymentImpl>,
    axum::extract::Path(skill_id): axum::extract::Path<String>,
    axum::extract::Query(query): axum::extract::Query<RegistryQuery>,
) -> Result<ResponseJson<ApiResponse<RemoteSkillPackage>>, ApiError> {
    let client = SkillRegistryClient::new(query.registry_url);
    let skill = client
        .get_skill(&skill_id)
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to fetch skill from registry: {}", e)))?;
    Ok(ResponseJson(ApiResponse::success(skill)))
}

/// List available categories from the registry
pub async fn list_registry_categories(
    State(_deployment): State<DeploymentImpl>,
    axum::extract::Query(query): axum::extract::Query<RegistryQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<SkillCategory>>>, ApiError> {
    let client = SkillRegistryClient::new(query.registry_url);
    let categories = client.list_categories().await.map_err(|e| {
        ApiError::BadRequest(format!("Failed to fetch categories from registry: {}", e))
    })?;
    Ok(ResponseJson(ApiResponse::success(categories)))
}

/// Install a skill from the registry to the local database
/// and download full skill files to global user skill directories.
pub async fn install_registry_skill(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path(skill_id): axum::extract::Path<String>,
    axum::extract::Query(query): axum::extract::Query<RegistryQuery>,
) -> Result<ResponseJson<ApiResponse<ChatSkill>>, ApiError> {
    let client = SkillRegistryClient::new(query.registry_url.clone());
    let skill_package = client
        .get_skill(&skill_id)
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to fetch skill from registry: {}", e)))?;

    let files_count =
        install_skill_files_to_global_directory(&skill_id, query.registry_url.as_deref())
            .await
            .map_err(|e| {
                ApiError::BadRequest(format!(
                    "Failed to install skill files to global directories: {}",
                    e
                ))
            })?;

    tracing::info!(
        skill_id = %skill_id,
        files_count = files_count,
        "Installed registry skill files to global user directories"
    );

    let installed = install_skill_from_registry(&deployment.db().pool, &skill_package)
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to install skill: {}", e)))?;

    Ok(ResponseJson(ApiResponse::success(installed)))
}

// ─── Built-in Skills (from awesome-claude-skills) ───

#[derive(Debug, Deserialize)]
pub struct BuiltinSkillsQuery {
    pub category: Option<String>,
    pub agent: Option<String>,
    pub search: Option<String>,
}

/// List all built-in skills from the embedded registry
pub async fn list_builtin_skills_api(
    State(_deployment): State<DeploymentImpl>,
    axum::extract::Query(query): axum::extract::Query<BuiltinSkillsQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<RemoteSkillMeta>>>, ApiError> {
    let skills = if let Some(search) = &query.search {
        search_builtin_skills(search)
    } else if let Some(category) = &query.category {
        filter_builtin_skills_by_category(category)
    } else if let Some(agent) = &query.agent {
        filter_builtin_skills_by_agent(agent)
    } else {
        list_builtin_skills()
    };
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

/// Get a specific built-in skill by ID
pub async fn get_builtin_skill_api(
    State(_deployment): State<DeploymentImpl>,
    axum::extract::Path(skill_id): axum::extract::Path<String>,
) -> Result<ResponseJson<ApiResponse<RemoteSkillPackage>>, ApiError> {
    let skill = get_builtin_skill(&skill_id)
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

    Ok(ResponseJson(ApiResponse::success(installed)))
}
