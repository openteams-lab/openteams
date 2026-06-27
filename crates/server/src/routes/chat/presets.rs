use std::{collections::HashSet, str::FromStr};

use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    response::Json as ResponseJson,
    routing::get,
};
use db::models::chat_session::{ChatSession, UpdateChatSession};
use deployment::Deployment;
use executors::{
    executors::{BaseCodingAgent, CodingAgent},
    profile::{ExecutorConfigs, ExecutorProfileId, canonical_variant_key},
};
use serde::{Deserialize, Serialize};
use services::services::{
    analytics_events::{AnalyticsProjector, DomainEvent},
    config::{ChatMemberPreset, ChatPresetsConfig, ChatTeamPreset, save_config_to_file_atomic},
};
use sqlx::{FromRow, types::Json as SqlxJson};
use ts_rs::TS;
use utils::{assets::config_path, response::ApiResponse, text::sanitize_member_handle};
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TeamProtocolConfig {
    pub content: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct CreatePresetSnapshotRequest {
    pub team_preset_id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub overwrite_strategy: Option<PresetSnapshotOverwriteStrategy>,
}

#[derive(Debug, Clone, Copy, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PresetSnapshotOverwriteStrategy {
    FailIfExists,
    OverwriteCustom,
}

impl PresetSnapshotOverwriteStrategy {
    fn as_str(self) -> &'static str {
        match self {
            Self::FailIfExists => "fail_if_exists",
            Self::OverwriteCustom => "overwrite_custom",
        }
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct CreatePresetSnapshotResponse {
    pub team: ChatTeamPreset,
    pub members: Vec<ChatMemberPreset>,
    pub overwritten: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct TeamPresetMemberSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub runner_type: Option<String>,
    pub recommended_model: Option<String>,
    pub is_builtin: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct TeamPresetSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub member_ids: Vec<String>,
    pub lead_member_id: Option<String>,
    pub team_protocol: String,
    pub is_builtin: bool,
    pub enabled: bool,
    pub member_count: usize,
    pub members: Vec<TeamPresetMemberSummary>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct TeamPresetListResponse {
    pub teams: Vec<TeamPresetSummary>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct TeamPresetDetail {
    pub team: ChatTeamPreset,
    pub members: Vec<ChatMemberPreset>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct TeamPresetWrite {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub member_ids: Vec<String>,
    pub lead_member_id: Option<String>,
    pub team_protocol: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct TeamPresetMemberWrite {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub runner_type: Option<String>,
    pub recommended_model: Option<String>,
    pub system_prompt: Option<String>,
    pub default_workspace_path: Option<String>,
    #[serde(default)]
    pub selected_skill_ids: Vec<String>,
    pub tools_enabled: Option<serde_json::Value>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct CreateTeamPresetRequest {
    pub team: TeamPresetWrite,
    #[serde(default)]
    pub members: Vec<TeamPresetMemberWrite>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct UpdateTeamPresetRequest {
    pub team: TeamPresetWrite,
    #[serde(default)]
    pub members: Vec<TeamPresetMemberWrite>,
}

#[derive(Debug, Clone, FromRow)]
struct SessionPresetMemberRow {
    session_agent_id: Uuid,
    agent_id: Uuid,
    agent_name: String,
    runner_type: String,
    system_prompt: String,
    tools_enabled: SqlxJson<serde_json::Value>,
    model_name: Option<String>,
    workspace_path: Option<String>,
    allowed_skill_ids: SqlxJson<Vec<String>>,
}

pub async fn get_team_protocol(
    Extension(session): Extension<ChatSession>,
) -> Result<ResponseJson<ApiResponse<TeamProtocolConfig>>, ApiError> {
    let content = session.team_protocol.unwrap_or_default();
    let enabled = session.team_protocol_enabled;
    Ok(ResponseJson(ApiResponse::success(TeamProtocolConfig {
        content,
        enabled,
    })))
}

pub async fn update_team_protocol(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<TeamProtocolConfig>,
) -> Result<ResponseJson<ApiResponse<TeamProtocolConfig>>, ApiError> {
    let content = if payload.enabled {
        payload.content.clone()
    } else {
        String::new()
    };
    let effective = TeamProtocolConfig {
        enabled: !content.trim().is_empty(),
        content: content.clone(),
    };

    ChatSession::update(
        &deployment.db().pool,
        session.id,
        &UpdateChatSession {
            title: None,
            status: None,
            lead_agent_id: None,
            summary_text: None,
            archive_ref: None,
            last_seen_diff_key: None,
            team_protocol: Some(content),
            team_protocol_enabled: Some(effective.enabled),
            default_workspace_path: None,
            chat_input_mode: None,
            worktree_mode: None,
        },
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(effective)))
}

pub fn team_presets_router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/", get(list_team_presets).post(create_team_preset))
        .route(
            "/{id}",
            get(get_team_preset)
                .put(update_team_preset)
                .delete(delete_team_preset),
        )
}

pub async fn list_team_presets(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<TeamPresetListResponse>>, ApiError> {
    let config = deployment.config().read().await;
    let response = list_team_presets_from_config(&config.chat_presets)?;

    Ok(ResponseJson(ApiResponse::success(response)))
}

pub async fn get_team_preset(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
) -> Result<ResponseJson<ApiResponse<TeamPresetDetail>>, ApiError> {
    let id = validate_preset_id(&id, "Team preset ID")?;
    let config = deployment.config().read().await;
    let detail = get_team_preset_from_config(&config.chat_presets, &id)?;

    Ok(ResponseJson(ApiResponse::success(detail)))
}

pub async fn create_team_preset(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateTeamPresetRequest>,
) -> Result<ResponseJson<ApiResponse<TeamPresetDetail>>, ApiError> {
    let mut config_guard = deployment.config().write().await;
    let mut next_config = config_guard.clone();
    let detail = create_team_preset_in_config(&mut next_config.chat_presets, payload)?;

    save_config_to_file_atomic(&next_config, &config_path()).await?;
    *config_guard = next_config;

    Ok(ResponseJson(ApiResponse::success(detail)))
}

pub async fn update_team_preset(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateTeamPresetRequest>,
) -> Result<ResponseJson<ApiResponse<TeamPresetDetail>>, ApiError> {
    let id = validate_preset_id(&id, "Team preset ID")?;
    let mut config_guard = deployment.config().write().await;
    let mut next_config = config_guard.clone();
    let detail = update_team_preset_in_config(&mut next_config.chat_presets, &id, payload)?;

    save_config_to_file_atomic(&next_config, &config_path()).await?;
    *config_guard = next_config;

    Ok(ResponseJson(ApiResponse::success(detail)))
}

pub async fn delete_team_preset(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let id = validate_preset_id(&id, "Team preset ID")?;
    let mut config_guard = deployment.config().write().await;
    let mut next_config = config_guard.clone();

    delete_team_preset_from_config(&mut next_config.chat_presets, &id)?;

    save_config_to_file_atomic(&next_config, &config_path()).await?;
    *config_guard = next_config;

    Ok(ResponseJson(ApiResponse::success(())))
}

pub async fn create_preset_snapshot(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreatePresetSnapshotRequest>,
) -> Result<ResponseJson<ApiResponse<CreatePresetSnapshotResponse>>, ApiError> {
    let rows = list_session_preset_member_rows(&deployment.db().pool, session.id).await?;
    if rows.is_empty() {
        return Err(ApiError::BadRequest(
            "Cannot snapshot a team preset without session members.".to_string(),
        ));
    }
    let requested_overwrite_strategy = payload
        .overwrite_strategy
        .unwrap_or(PresetSnapshotOverwriteStrategy::FailIfExists);

    let mut config_guard = deployment.config().write().await;
    let mut next_config = config_guard.clone();
    let response = build_preset_snapshot(&session, rows, payload, &mut next_config.chat_presets)?;

    save_config_to_file_atomic(&next_config, &config_path()).await?;
    *config_guard = next_config;
    drop(config_guard);

    tracing::info!(
        session_id = %session.id,
        team_preset_id = %response.team.id,
        member_count = response.members.len(),
        overwritten = response.overwritten,
        overwrite_strategy = requested_overwrite_strategy.as_str(),
        "created chat preset snapshot"
    );
    let analytics_projector = AnalyticsProjector::new(
        &deployment.db().pool,
        deployment.analytics().as_ref(),
        deployment.analytics_enabled(),
    );
    analytics_projector
        .project_or_warn(DomainEvent::PresetSnapshotCreated {
            session_id: session.id,
            actor_user_id: deployment.user_id().to_string(),
            team_preset_id: response.team.id.clone(),
            member_count: response.members.len(),
            overwritten: response.overwritten,
            overwrite_strategy: requested_overwrite_strategy.as_str().to_string(),
        })
        .await;

    Ok(ResponseJson(ApiResponse::success(response)))
}

async fn list_session_preset_member_rows(
    pool: &sqlx::SqlitePool,
    session_id: Uuid,
) -> Result<Vec<SessionPresetMemberRow>, sqlx::Error> {
    sqlx::query_as::<_, SessionPresetMemberRow>(
        r#"
        SELECT session_agents.id AS session_agent_id,
               session_agents.agent_id AS agent_id,
               agents.name AS agent_name,
               agents.runner_type AS runner_type,
               agents.system_prompt AS system_prompt,
               agents.tools_enabled AS tools_enabled,
               agents.model_name AS model_name,
               session_agents.workspace_path AS workspace_path,
               session_agents.allowed_skill_ids AS allowed_skill_ids
        FROM chat_session_agents session_agents
        JOIN chat_agents agents ON agents.id = session_agents.agent_id
        WHERE session_agents.session_id = ?1
        ORDER BY session_agents.created_at ASC
        "#,
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
}

fn list_team_presets_from_config(
    presets: &ChatPresetsConfig,
) -> Result<TeamPresetListResponse, ApiError> {
    let teams = presets
        .teams
        .iter()
        .map(|team| team_preset_summary(presets, team))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(TeamPresetListResponse { teams })
}

fn get_team_preset_from_config(
    presets: &ChatPresetsConfig,
    id: &str,
) -> Result<TeamPresetDetail, ApiError> {
    let team = presets
        .teams
        .iter()
        .find(|preset| preset.id == id)
        .ok_or_else(|| ApiError::BadRequest(format!("Team preset not found: {id}")))?;

    team_preset_detail(presets, team)
}

fn create_team_preset_in_config(
    presets: &mut ChatPresetsConfig,
    payload: CreateTeamPresetRequest,
) -> Result<TeamPresetDetail, ApiError> {
    let validated = validate_team_preset_payload(
        presets,
        None,
        payload.team,
        payload.members,
        "Team preset ID",
    )?;

    if presets
        .teams
        .iter()
        .any(|preset| preset.id == validated.team.id)
    {
        return Err(ApiError::Conflict(format!(
            "Team preset ID already exists: {}",
            validated.team.id
        )));
    }

    upsert_member_presets(presets, validated.members);
    presets.teams.push(validated.team.clone());

    team_preset_detail(presets, &validated.team)
}

fn update_team_preset_in_config(
    presets: &mut ChatPresetsConfig,
    id: &str,
    payload: UpdateTeamPresetRequest,
) -> Result<TeamPresetDetail, ApiError> {
    let existing_index = presets
        .teams
        .iter()
        .position(|preset| preset.id == id)
        .ok_or_else(|| ApiError::BadRequest(format!("Team preset not found: {id}")))?;
    let existing_team = presets.teams[existing_index].clone();

    if existing_team.is_builtin {
        return Err(ApiError::Forbidden(format!(
            "Cannot edit built-in team preset: {id}"
        )));
    }

    let validated = validate_team_preset_payload(
        presets,
        Some(&existing_team),
        payload.team,
        payload.members,
        "Team preset ID",
    )?;
    if validated.team.id != id {
        return Err(ApiError::BadRequest(format!(
            "Team preset ID in request must match path ID: {id}"
        )));
    }

    let cleanup_candidates = existing_team
        .member_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    presets.teams[existing_index] = validated.team.clone();
    upsert_member_presets(presets, validated.members);
    cleanup_unused_custom_members(presets, &cleanup_candidates);

    team_preset_detail(presets, &validated.team)
}

fn delete_team_preset_from_config(
    presets: &mut ChatPresetsConfig,
    id: &str,
) -> Result<(), ApiError> {
    let existing_index = presets
        .teams
        .iter()
        .position(|preset| preset.id == id)
        .ok_or_else(|| ApiError::BadRequest(format!("Team preset not found: {id}")))?;
    if presets.teams[existing_index].is_builtin {
        return Err(ApiError::Forbidden(format!(
            "Cannot delete built-in team preset: {id}"
        )));
    }

    let removed = presets.teams.remove(existing_index);
    let cleanup_candidates = removed.member_ids.into_iter().collect::<HashSet<_>>();
    cleanup_unused_custom_members(presets, &cleanup_candidates);

    Ok(())
}

#[derive(Debug)]
struct ValidatedTeamPresetPayload {
    team: ChatTeamPreset,
    members: Vec<ChatMemberPreset>,
}

fn validate_team_preset_payload(
    presets: &ChatPresetsConfig,
    existing_team: Option<&ChatTeamPreset>,
    team: TeamPresetWrite,
    members: Vec<TeamPresetMemberWrite>,
    id_label: &str,
) -> Result<ValidatedTeamPresetPayload, ApiError> {
    let team_id = validate_preset_id(&team.id, id_label)?;
    let team_name = normalize_required_string(&team.name, "Team preset name")?;
    let member_ids = validate_member_reference_ids(&team.member_ids)?;
    let member_id_set = member_ids.iter().cloned().collect::<HashSet<_>>();
    let lead_member_id = normalize_optional_string(team.lead_member_id)
        .map(|id| validate_preset_id(&id, "Lead member ID"))
        .transpose()?;

    if let Some(lead_member_id) = lead_member_id.as_ref()
        && !member_id_set.contains(lead_member_id)
    {
        return Err(ApiError::BadRequest(format!(
            "Lead member ID must reference a team member: {lead_member_id}"
        )));
    }

    let replaceable_member_ids = existing_team
        .map(|preset| preset.member_ids.iter().cloned().collect::<HashSet<_>>())
        .unwrap_or_default();
    let members = validate_member_presets(presets, &replaceable_member_ids, members)?;
    let member_payload_ids = members
        .iter()
        .map(|member| member.id.clone())
        .collect::<HashSet<_>>();

    for member in &members {
        if !member_id_set.contains(&member.id) {
            return Err(ApiError::BadRequest(format!(
                "Member preset payload is not referenced by team: {}",
                member.id
            )));
        }
    }

    for member_id in &member_ids {
        let exists_in_config = presets.members.iter().any(|member| member.id == *member_id);
        if !exists_in_config && !member_payload_ids.contains(member_id) {
            return Err(ApiError::BadRequest(format!(
                "Team preset references unknown member preset: {member_id}"
            )));
        }
    }

    Ok(ValidatedTeamPresetPayload {
        team: ChatTeamPreset {
            id: team_id,
            name: team_name,
            description: normalize_optional_string(team.description).unwrap_or_default(),
            member_ids,
            lead_member_id,
            team_protocol: normalize_optional_string(team.team_protocol).unwrap_or_default(),
            is_builtin: false,
            enabled: team.enabled.unwrap_or(true),
        },
        members,
    })
}

fn validate_member_presets(
    presets: &ChatPresetsConfig,
    replaceable_member_ids: &HashSet<String>,
    members: Vec<TeamPresetMemberWrite>,
) -> Result<Vec<ChatMemberPreset>, ApiError> {
    let mut seen_ids = HashSet::new();
    let mut validated = Vec::with_capacity(members.len());

    for member in members {
        let member_id = validate_preset_id(&member.id, "Member preset ID")?;
        if !seen_ids.insert(member_id.clone()) {
            return Err(ApiError::BadRequest(format!(
                "Member preset payload must not contain duplicate ID: {member_id}"
            )));
        }

        if let Some(existing_member) = presets.members.iter().find(|preset| preset.id == member_id)
        {
            if existing_member.is_builtin {
                return Err(ApiError::Forbidden(format!(
                    "Cannot edit built-in member preset: {member_id}"
                )));
            }
            if !replaceable_member_ids.contains(&member_id) {
                return Err(ApiError::Conflict(format!(
                    "Member preset ID already exists: {member_id}"
                )));
            }
        }

        let name = sanitize_member_handle(&member.name);
        if name.is_empty() {
            return Err(ApiError::BadRequest(
                "Member preset name is required.".to_string(),
            ));
        }

        validated.push(ChatMemberPreset {
            id: member_id,
            name,
            description: normalize_optional_string(member.description).unwrap_or_default(),
            runner_type: normalize_optional_string(member.runner_type),
            recommended_model: normalize_optional_string(member.recommended_model),
            system_prompt: member.system_prompt.unwrap_or_default(),
            default_workspace_path: normalize_optional_string(member.default_workspace_path),
            selected_skill_ids: normalize_skill_ids(member.selected_skill_ids),
            tools_enabled: member
                .tools_enabled
                .filter(|value| !value.is_null())
                .unwrap_or_else(|| serde_json::json!({})),
            is_builtin: false,
            enabled: member.enabled.unwrap_or(true),
        });
    }

    Ok(validated)
}

fn validate_member_reference_ids(member_ids: &[String]) -> Result<Vec<String>, ApiError> {
    let mut seen_ids = HashSet::new();
    let mut normalized_ids = Vec::with_capacity(member_ids.len());

    for member_id in member_ids {
        let member_id = validate_preset_id(member_id, "Member preset ID")?;
        if !seen_ids.insert(member_id.clone()) {
            return Err(ApiError::BadRequest(format!(
                "Team preset member_ids must not contain duplicate ID: {member_id}"
            )));
        }
        normalized_ids.push(member_id);
    }

    if normalized_ids.is_empty() {
        return Err(ApiError::BadRequest(
            "Team preset must include at least one member.".to_string(),
        ));
    }

    Ok(normalized_ids)
}

fn upsert_member_presets(presets: &mut ChatPresetsConfig, members: Vec<ChatMemberPreset>) {
    for member in members {
        if let Some(index) = presets
            .members
            .iter()
            .position(|preset| preset.id == member.id)
        {
            presets.members[index] = member;
        } else {
            presets.members.push(member);
        }
    }
}

fn cleanup_unused_custom_members(
    presets: &mut ChatPresetsConfig,
    candidate_member_ids: &HashSet<String>,
) {
    if candidate_member_ids.is_empty() {
        return;
    }

    let referenced_member_ids = presets
        .teams
        .iter()
        .flat_map(|team| team.member_ids.iter().cloned())
        .collect::<HashSet<_>>();

    presets.members.retain(|member| {
        member.is_builtin
            || !candidate_member_ids.contains(&member.id)
            || referenced_member_ids.contains(&member.id)
    });
}

fn team_preset_detail(
    presets: &ChatPresetsConfig,
    team: &ChatTeamPreset,
) -> Result<TeamPresetDetail, ApiError> {
    Ok(TeamPresetDetail {
        team: team.clone(),
        members: resolve_team_members(presets, team)?,
    })
}

fn team_preset_summary(
    presets: &ChatPresetsConfig,
    team: &ChatTeamPreset,
) -> Result<TeamPresetSummary, ApiError> {
    let members = resolve_team_members(presets, team)?
        .iter()
        .map(member_preset_summary)
        .collect::<Vec<_>>();

    Ok(TeamPresetSummary {
        id: team.id.clone(),
        name: team.name.clone(),
        description: team.description.clone(),
        member_ids: team.member_ids.clone(),
        lead_member_id: team.lead_member_id.clone(),
        team_protocol: team.team_protocol.clone(),
        is_builtin: team.is_builtin,
        enabled: team.enabled,
        member_count: team.member_ids.len(),
        members,
    })
}

fn resolve_team_members(
    presets: &ChatPresetsConfig,
    team: &ChatTeamPreset,
) -> Result<Vec<ChatMemberPreset>, ApiError> {
    team.member_ids
        .iter()
        .map(|member_id| {
            presets
                .members
                .iter()
                .find(|member| member.id == *member_id)
                .cloned()
                .ok_or_else(|| {
                    ApiError::BadRequest(format!(
                        "Team preset references unknown member preset: {member_id}"
                    ))
                })
        })
        .collect()
}

fn member_preset_summary(member: &ChatMemberPreset) -> TeamPresetMemberSummary {
    TeamPresetMemberSummary {
        id: member.id.clone(),
        name: member.name.clone(),
        description: member.description.clone(),
        runner_type: member.runner_type.clone(),
        recommended_model: member.recommended_model.clone(),
        is_builtin: member.is_builtin,
        enabled: member.enabled,
    }
}

fn validate_preset_id(value: &str, label: &str) -> Result<String, ApiError> {
    let id = value.trim();
    if id.is_empty() {
        return Err(ApiError::BadRequest(format!("{label} is required.")));
    }

    if !id
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || ch == '-')
    {
        return Err(ApiError::BadRequest(format!(
            "{label} must contain only lowercase letters, numbers, underscores, or hyphens."
        )));
    }

    Ok(id.to_string())
}

fn normalize_required_string(value: &str, label: &str) -> Result<String, ApiError> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(ApiError::BadRequest(format!("{label} is required.")));
    }
    Ok(value)
}

fn build_preset_snapshot(
    session: &ChatSession,
    rows: Vec<SessionPresetMemberRow>,
    payload: CreatePresetSnapshotRequest,
    presets: &mut ChatPresetsConfig,
) -> Result<CreatePresetSnapshotResponse, ApiError> {
    if rows.is_empty() {
        return Err(ApiError::BadRequest(
            "Cannot snapshot a team preset without session members.".to_string(),
        ));
    }

    let team_name = payload
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| session.title.as_deref().map(str::trim).map(str::to_string))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Session Team".to_string());
    let team_id = payload
        .team_preset_id
        .as_deref()
        .map(normalize_preset_id)
        .transpose()?
        .unwrap_or_else(|| slugify(&team_name, "session_team"));
    let description = payload
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_default();

    let existing_team_index = presets.teams.iter().position(|preset| preset.id == team_id);
    let overwritten = existing_team_index.is_some();
    let overwrite_strategy = payload
        .overwrite_strategy
        .unwrap_or(PresetSnapshotOverwriteStrategy::FailIfExists);
    if let Some(index) = existing_team_index {
        let existing = &presets.teams[index];
        if overwrite_strategy == PresetSnapshotOverwriteStrategy::FailIfExists {
            return Err(ApiError::Conflict(format!(
                "Team preset ID already exists: {team_id}"
            )));
        }
        if existing.is_builtin {
            return Err(ApiError::Forbidden(format!(
                "Cannot overwrite built-in team preset: {team_id}"
            )));
        }
    }

    let replaceable_member_ids: HashSet<String> = existing_team_index
        .map(|index| presets.teams[index].member_ids.iter().cloned().collect())
        .unwrap_or_default();
    let members = build_member_presets(session, &team_id, rows.clone());
    validate_member_id_conflicts(presets, &members, &replaceable_member_ids)?;

    // Resolve lead_member_id: find the member preset that corresponds to the session's lead agent.
    let lead_member_id = session.lead_agent_id.and_then(|lead_agent_id| {
        // Find the row index whose agent_id matches the session's lead_agent_id
        rows.iter()
            .position(|row| row.agent_id == lead_agent_id)
            .and_then(|index| members.get(index))
            .map(|member| member.id.clone())
    });

    let member_ids = members
        .iter()
        .map(|member| member.id.clone())
        .collect::<Vec<_>>();
    let team_protocol = if session.team_protocol_enabled {
        session
            .team_protocol
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
            .to_string()
    } else {
        String::new()
    };
    let team = ChatTeamPreset {
        id: team_id,
        name: team_name,
        description,
        member_ids,
        lead_member_id,
        team_protocol,
        is_builtin: false,
        enabled: true,
    };

    let generated_member_ids = members
        .iter()
        .map(|member| member.id.as_str())
        .collect::<HashSet<_>>();
    presets
        .members
        .retain(|preset| !generated_member_ids.contains(preset.id.as_str()));
    presets.members.extend(members.clone());

    if let Some(index) = existing_team_index {
        presets.teams[index] = team.clone();
    } else {
        presets.teams.push(team.clone());
    }

    Ok(CreatePresetSnapshotResponse {
        team,
        members,
        overwritten,
    })
}

fn build_member_presets(
    session: &ChatSession,
    team_id: &str,
    rows: Vec<SessionPresetMemberRow>,
) -> Vec<ChatMemberPreset> {
    let mut used_ids = HashSet::new();
    let mut used_names = HashSet::new();
    rows.into_iter()
        .map(|row| {
            let name = unique_member_name(normalize_member_name(&row.agent_name), &mut used_names);
            let base_id = format!("{}_{}", team_id, slugify(&name, "member"));
            let id = unique_id(base_id, &mut used_ids);
            let default_workspace_path = row
                .workspace_path
                .clone()
                .or_else(|| session.default_workspace_path.clone())
                .map(|path| path.trim().to_string())
                .filter(|path| !path.is_empty());
            let recommended_model = resolve_recommended_model(&row);
            ChatMemberPreset {
                id,
                name,
                description: format!(
                    "Snapshot of session member {} from chat session {}.",
                    row.session_agent_id, session.id
                ),
                runner_type: Some(row.runner_type),
                recommended_model,
                system_prompt: row.system_prompt,
                default_workspace_path,
                selected_skill_ids: normalize_skill_ids(row.allowed_skill_ids.0),
                tools_enabled: row.tools_enabled.0,
                is_builtin: false,
                enabled: true,
            }
        })
        .collect()
}

fn resolve_recommended_model(row: &SessionPresetMemberRow) -> Option<String> {
    normalize_optional_string(row.model_name.clone())
        .or_else(|| selected_profile_model(&row.runner_type, &row.tools_enabled.0))
}

fn selected_profile_model(runner_type: &str, tools_enabled: &serde_json::Value) -> Option<String> {
    let executor = parse_base_coding_agent(runner_type)?;
    let variant = tools_enabled
        .as_object()
        .and_then(|value| value.get("executor_profile_variant"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|variant| !variant.is_empty() && !variant.eq_ignore_ascii_case("DEFAULT"))
        .map(canonical_variant_key);

    let profile_id = match variant {
        Some(variant) => ExecutorProfileId::with_variant(executor, variant),
        None => ExecutorProfileId::new(executor),
    };
    let coding_agent = ExecutorConfigs::get_cached().get_coding_agent(&profile_id)?;
    model_from_coding_agent(&coding_agent)
}

fn parse_base_coding_agent(runner_type: &str) -> Option<BaseCodingAgent> {
    let normalized = runner_type.trim().replace('-', "_").to_ascii_uppercase();
    BaseCodingAgent::from_str(&normalized).ok()
}

fn model_from_coding_agent(coding_agent: &CodingAgent) -> Option<String> {
    let value = serde_json::to_value(coding_agent).ok()?;
    value
        .as_object()
        .and_then(|agent| agent.values().find_map(|config| config.get("model")))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .and_then(|value| normalize_optional_string(Some(value)))
}

fn normalize_member_name(value: &str) -> String {
    let normalized = sanitize_member_handle(value);
    if normalized.is_empty() {
        "member".to_string()
    } else {
        normalized
    }
}

fn unique_member_name(base_name: String, used_names: &mut HashSet<String>) -> String {
    if used_names.insert(base_name.to_lowercase()) {
        return base_name;
    }

    let mut suffix = 2;
    loop {
        let candidate = format!("{base_name}_{suffix}");
        if used_names.insert(candidate.to_lowercase()) {
            return candidate;
        }
        suffix += 1;
    }
}

fn validate_member_id_conflicts(
    presets: &ChatPresetsConfig,
    members: &[ChatMemberPreset],
    replaceable_member_ids: &HashSet<String>,
) -> Result<(), ApiError> {
    for member in members {
        if let Some(existing) = presets.members.iter().find(|preset| preset.id == member.id)
            && (existing.is_builtin || !replaceable_member_ids.contains(&existing.id))
        {
            return Err(ApiError::Conflict(format!(
                "Member preset ID already exists: {}",
                member.id
            )));
        }
    }
    Ok(())
}

fn normalize_preset_id(value: &str) -> Result<String, ApiError> {
    let id = slugify(value, "");
    if id.is_empty() {
        return Err(ApiError::BadRequest(
            "Team preset ID is required.".to_string(),
        ));
    }
    Ok(id)
}

fn slugify(value: &str, fallback: &str) -> String {
    let mut slug = String::new();
    let mut previous_separator = false;
    for ch in value.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            previous_separator = false;
        } else if (ch == '_' || ch == '-' || ch.is_ascii_whitespace()) && !previous_separator {
            slug.push('_');
            previous_separator = true;
        }
    }
    let slug = slug.trim_matches('_').to_string();
    if slug.is_empty() {
        fallback.to_string()
    } else {
        slug
    }
}

fn unique_id(base_id: String, used_ids: &mut HashSet<String>) -> String {
    if used_ids.insert(base_id.clone()) {
        return base_id;
    }

    let mut suffix = 2;
    loop {
        let candidate = format!("{base_id}_{suffix}");
        if used_ids.insert(candidate.clone()) {
            return candidate;
        }
        suffix += 1;
    }
}

fn normalize_skill_ids(skill_ids: Vec<String>) -> Vec<String> {
    let mut normalized = skill_ids
        .into_iter()
        .map(|skill_id| skill_id.trim().to_string())
        .filter(|skill_id| !skill_id.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    let value = value?.trim().to_string();
    if value.is_empty() { None } else { Some(value) }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::chat_session::ChatSessionStatus;
    use serde_json::json;

    use super::*;

    fn test_session(team_protocol_enabled: bool) -> ChatSession {
        ChatSession {
            id: Uuid::new_v4(),
            title: Some("Delivery Team".to_string()),
            status: ChatSessionStatus::Active,
            lead_agent_id: None,
            summary_text: None,
            archive_ref: None,
            last_seen_diff_key: None,
            team_protocol: Some("Follow the team protocol.".to_string()),
            team_protocol_enabled,
            default_workspace_path: Some("/workspace/default".to_string()),
            chat_input_mode: None,
            project_id: None,
            pinned_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            archived_at: None,
            worktree_mode: Default::default(),
        }
    }

    fn test_presets() -> ChatPresetsConfig {
        ChatPresetsConfig {
            members: vec![],
            teams: vec![],
            team_protocol: Some(String::new()),
        }
    }

    fn custom_member_preset(id: &str) -> ChatMemberPreset {
        ChatMemberPreset {
            id: id.to_string(),
            name: id.to_string(),
            description: format!("{id} description"),
            runner_type: Some("codex".to_string()),
            recommended_model: Some("gpt-5.2".to_string()),
            system_prompt: format!("You are {id}."),
            default_workspace_path: None,
            selected_skill_ids: vec![],
            tools_enabled: json!({}),
            is_builtin: false,
            enabled: true,
        }
    }

    fn builtin_member_preset(id: &str) -> ChatMemberPreset {
        ChatMemberPreset {
            is_builtin: true,
            ..custom_member_preset(id)
        }
    }

    fn team_write(id: &str, member_ids: Vec<&str>) -> TeamPresetWrite {
        TeamPresetWrite {
            id: id.to_string(),
            name: "Delivery Team".to_string(),
            description: Some("Team description".to_string()),
            member_ids: member_ids.into_iter().map(str::to_string).collect(),
            lead_member_id: None,
            team_protocol: Some("Coordinate before shipping.".to_string()),
            enabled: Some(true),
        }
    }

    fn member_write(id: &str) -> TeamPresetMemberWrite {
        TeamPresetMemberWrite {
            id: id.to_string(),
            name: id.to_string(),
            description: Some(format!("{id} description")),
            runner_type: Some("codex".to_string()),
            recommended_model: Some("gpt-5.2".to_string()),
            system_prompt: Some(format!("You are {id}.")),
            default_workspace_path: None,
            selected_skill_ids: vec!["skill-b".to_string(), "skill-a".to_string()],
            tools_enabled: Some(json!({"mode": "test"})),
            enabled: Some(true),
        }
    }

    fn create_team_request(
        id: &str,
        member_ids: Vec<&str>,
        members: Vec<TeamPresetMemberWrite>,
    ) -> CreateTeamPresetRequest {
        CreateTeamPresetRequest {
            team: team_write(id, member_ids),
            members,
        }
    }

    fn update_team_request(
        id: &str,
        member_ids: Vec<&str>,
        members: Vec<TeamPresetMemberWrite>,
    ) -> UpdateTeamPresetRequest {
        UpdateTeamPresetRequest {
            team: team_write(id, member_ids),
            members,
        }
    }

    fn test_row(name: &str) -> SessionPresetMemberRow {
        SessionPresetMemberRow {
            session_agent_id: Uuid::new_v4(),
            agent_id: Uuid::new_v4(),
            agent_name: name.to_string(),
            runner_type: "codex".to_string(),
            system_prompt: format!("You are {name}."),
            tools_enabled: SqlxJson(json!({ "executor_profile_variant": "DEFAULT" })),
            model_name: Some("gpt-5.2".to_string()),
            workspace_path: None,
            allowed_skill_ids: SqlxJson(vec![
                " skill-b ".to_string(),
                "skill-a".to_string(),
                "skill-a".to_string(),
            ]),
        }
    }

    fn snapshot_request(
        id: &str,
        overwrite_strategy: PresetSnapshotOverwriteStrategy,
    ) -> CreatePresetSnapshotRequest {
        CreatePresetSnapshotRequest {
            team_preset_id: Some(id.to_string()),
            name: Some("Delivery Team".to_string()),
            description: Some("Saved delivery team.".to_string()),
            overwrite_strategy: Some(overwrite_strategy),
        }
    }

    fn snapshot_request_without_description(id: &str) -> CreatePresetSnapshotRequest {
        CreatePresetSnapshotRequest {
            team_preset_id: Some(id.to_string()),
            name: Some("Delivery Team".to_string()),
            description: None,
            overwrite_strategy: Some(PresetSnapshotOverwriteStrategy::FailIfExists),
        }
    }

    #[test]
    fn create_team_preset_in_config_creates_custom_team_and_members() {
        let mut presets = test_presets();
        let mut request = create_team_request(
            "delivery_team",
            vec!["delivery_backend"],
            vec![member_write("delivery_backend")],
        );
        request.team.lead_member_id = Some("delivery_backend".to_string());

        let detail = create_team_preset_in_config(&mut presets, request).expect("create succeeds");

        assert_eq!(detail.team.id, "delivery_team");
        assert_eq!(detail.team.member_ids, vec!["delivery_backend"]);
        assert_eq!(
            detail.team.lead_member_id.as_deref(),
            Some("delivery_backend")
        );
        assert_eq!(detail.members.len(), 1);
        assert_eq!(detail.members[0].name, "delivery_backend");
        assert_eq!(
            detail.members[0].selected_skill_ids,
            vec!["skill-a", "skill-b"]
        );
        assert!(!detail.team.is_builtin);
        assert!(presets.teams.iter().any(|team| team.id == "delivery_team"));
        assert!(
            presets
                .members
                .iter()
                .any(|member| member.id == "delivery_backend")
        );
    }

    #[test]
    fn update_team_preset_in_config_updates_custom_team_and_removes_unreferenced_members() {
        let mut presets = test_presets();
        create_team_preset_in_config(
            &mut presets,
            create_team_request(
                "delivery_team",
                vec!["delivery_backend"],
                vec![member_write("delivery_backend")],
            ),
        )
        .expect("create succeeds");

        let mut update = update_team_request(
            "delivery_team",
            vec!["delivery_frontend"],
            vec![member_write("delivery_frontend")],
        );
        update.team.name = "Updated Team".to_string();

        let detail = update_team_preset_in_config(&mut presets, "delivery_team", update)
            .expect("update succeeds");

        assert_eq!(detail.team.name, "Updated Team");
        assert_eq!(detail.team.member_ids, vec!["delivery_frontend"]);
        assert!(
            presets
                .members
                .iter()
                .any(|member| member.id == "delivery_frontend")
        );
        assert!(
            !presets
                .members
                .iter()
                .any(|member| member.id == "delivery_backend")
        );
    }

    #[test]
    fn delete_team_preset_from_config_removes_only_unshared_custom_members() {
        let mut presets = test_presets();
        presets.members.push(custom_member_preset("owned_member"));
        presets.members.push(custom_member_preset("shared_member"));
        presets
            .members
            .push(builtin_member_preset("builtin_member"));
        presets.teams.push(ChatTeamPreset {
            id: "target_team".to_string(),
            name: "Target".to_string(),
            description: "Target".to_string(),
            member_ids: vec![
                "owned_member".to_string(),
                "shared_member".to_string(),
                "builtin_member".to_string(),
            ],
            lead_member_id: None,
            team_protocol: String::new(),
            is_builtin: false,
            enabled: true,
        });
        presets.teams.push(ChatTeamPreset {
            id: "other_team".to_string(),
            name: "Other".to_string(),
            description: "Other".to_string(),
            member_ids: vec!["shared_member".to_string()],
            lead_member_id: None,
            team_protocol: String::new(),
            is_builtin: false,
            enabled: true,
        });

        delete_team_preset_from_config(&mut presets, "target_team").expect("delete succeeds");

        assert!(!presets.teams.iter().any(|team| team.id == "target_team"));
        assert!(
            !presets
                .members
                .iter()
                .any(|member| member.id == "owned_member")
        );
        assert!(
            presets
                .members
                .iter()
                .any(|member| member.id == "shared_member")
        );
        assert!(
            presets
                .members
                .iter()
                .any(|member| member.id == "builtin_member")
        );
    }

    #[test]
    fn team_preset_crud_rejects_builtin_template_mutations() {
        let mut presets = test_presets();
        presets
            .members
            .push(builtin_member_preset("builtin_member"));
        presets.teams.push(ChatTeamPreset {
            id: "builtin_team".to_string(),
            name: "Built-in".to_string(),
            description: "Built-in".to_string(),
            member_ids: vec!["builtin_member".to_string()],
            lead_member_id: None,
            team_protocol: String::new(),
            is_builtin: true,
            enabled: true,
        });

        let update_error = update_team_preset_in_config(
            &mut presets,
            "builtin_team",
            update_team_request("builtin_team", vec!["builtin_member"], vec![]),
        )
        .expect_err("built-in update should fail");
        let delete_error = delete_team_preset_from_config(&mut presets, "builtin_team")
            .expect_err("built-in delete should fail");

        assert!(matches!(update_error, ApiError::Forbidden(_)));
        assert!(matches!(delete_error, ApiError::Forbidden(_)));
    }

    #[test]
    fn team_preset_crud_rejects_builtin_member_edits() {
        let mut presets = test_presets();
        presets
            .members
            .push(builtin_member_preset("builtin_member"));

        let error = create_team_preset_in_config(
            &mut presets,
            create_team_request(
                "custom_team",
                vec!["builtin_member"],
                vec![member_write("builtin_member")],
            ),
        )
        .expect_err("built-in member edit should fail");

        assert!(matches!(error, ApiError::Forbidden(_)));
    }

    #[test]
    fn team_preset_crud_validates_member_references_and_duplicate_ids() {
        let mut missing_reference_presets = test_presets();
        let missing_reference_error = create_team_preset_in_config(
            &mut missing_reference_presets,
            create_team_request("custom_team", vec!["missing_member"], vec![]),
        )
        .expect_err("missing member reference should fail");

        let mut duplicate_reference_presets = test_presets();
        let duplicate_reference_error = create_team_preset_in_config(
            &mut duplicate_reference_presets,
            create_team_request(
                "custom_team",
                vec!["member_one", "member_one"],
                vec![member_write("member_one")],
            ),
        )
        .expect_err("duplicate member reference should fail");

        let mut duplicate_payload_presets = test_presets();
        let duplicate_payload_error = create_team_preset_in_config(
            &mut duplicate_payload_presets,
            create_team_request(
                "custom_team",
                vec!["member_one"],
                vec![member_write("member_one"), member_write("member_one")],
            ),
        )
        .expect_err("duplicate member payload should fail");

        let mut invalid_lead_presets = test_presets();
        let mut invalid_lead_request = create_team_request(
            "custom_team",
            vec!["member_one"],
            vec![member_write("member_one")],
        );
        invalid_lead_request.team.lead_member_id = Some("missing_lead".to_string());
        let invalid_lead_error =
            create_team_preset_in_config(&mut invalid_lead_presets, invalid_lead_request)
                .expect_err("invalid lead reference should fail");

        assert!(matches!(missing_reference_error, ApiError::BadRequest(_)));
        assert!(matches!(duplicate_reference_error, ApiError::BadRequest(_)));
        assert!(matches!(duplicate_payload_error, ApiError::BadRequest(_)));
        assert!(matches!(invalid_lead_error, ApiError::BadRequest(_)));
    }

    #[test]
    fn build_preset_snapshot_creates_custom_members_and_team() {
        let session = test_session(true);
        let mut presets = test_presets();

        let response = build_preset_snapshot(
            &session,
            vec![test_row("backend"), test_row("frontend")],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::FailIfExists),
            &mut presets,
        )
        .expect("snapshot succeeds");

        assert_eq!(response.team.id, "delivery");
        assert_eq!(
            response.team.member_ids,
            vec!["delivery_backend", "delivery_frontend"]
        );
        assert_eq!(response.team.team_protocol, "Follow the team protocol.");
        assert!(!response.team.is_builtin);
        assert_eq!(response.members.len(), 2);
        assert!(response.members.iter().all(|member| !member.is_builtin));
        assert_eq!(
            response.members[0].selected_skill_ids,
            vec!["skill-a", "skill-b"]
        );
        assert_eq!(
            response.members[0].recommended_model.as_deref(),
            Some("gpt-5.2")
        );
        assert_eq!(presets.members.len(), 2);
        assert_eq!(presets.teams.len(), 1);
    }

    #[test]
    fn build_preset_snapshot_keeps_blank_team_description_empty() {
        let session = test_session(true);
        let mut presets = test_presets();

        let response = build_preset_snapshot(
            &session,
            vec![test_row("backend")],
            snapshot_request_without_description("delivery"),
            &mut presets,
        )
        .expect("snapshot succeeds");

        assert_eq!(response.team.description, "");
    }

    #[test]
    fn build_preset_snapshot_deduplicates_member_names_and_ids() {
        let session = test_session(true);
        let mut presets = test_presets();

        let response = build_preset_snapshot(
            &session,
            vec![test_row("Backend Engineer"), test_row("backend   engineer")],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::FailIfExists),
            &mut presets,
        )
        .expect("snapshot succeeds");

        assert_eq!(
            response
                .members
                .iter()
                .map(|member| member.name.as_str())
                .collect::<Vec<_>>(),
            vec!["BackendEngineer", "backendengineer_2"]
        );
        assert_eq!(
            response.team.member_ids,
            vec!["delivery_backendengineer", "delivery_backendengineer_2"]
        );

        let imported_names = response
            .team
            .member_ids
            .iter()
            .map(|member_id| {
                presets
                    .members
                    .iter()
                    .find(|member| member.id == *member_id)
                    .expect("team member preset should exist")
                    .name
                    .clone()
            })
            .collect::<Vec<_>>();
        let unique_imported_names = imported_names
            .iter()
            .map(|name| name.to_lowercase())
            .collect::<HashSet<_>>();
        assert_eq!(
            imported_names.len(),
            unique_imported_names.len(),
            "team import names must remain unique after resolving member_ids"
        );
    }

    #[test]
    fn build_preset_snapshot_falls_back_for_blank_member_names() {
        let session = test_session(true);
        let mut presets = test_presets();

        let response = build_preset_snapshot(
            &session,
            vec![test_row("   "), test_row("\t")],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::FailIfExists),
            &mut presets,
        )
        .expect("snapshot succeeds");

        assert_eq!(
            response
                .members
                .iter()
                .map(|member| member.name.as_str())
                .collect::<Vec<_>>(),
            vec!["member", "member_2"]
        );
        assert_eq!(
            response.team.member_ids,
            vec!["delivery_member", "delivery_member_2"]
        );
    }

    #[test]
    fn build_preset_snapshot_prefers_agent_model_name_over_profile_variant() {
        let session = test_session(true);
        let mut presets = test_presets();
        let mut row = test_row("backend");
        row.model_name = Some("explicit-model".to_string());
        row.runner_type = "codex".to_string();
        row.tools_enabled = SqlxJson(json!({ "executor_profile_variant": "GPT_5.5" }));

        let response = build_preset_snapshot(
            &session,
            vec![row],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::FailIfExists),
            &mut presets,
        )
        .expect("snapshot succeeds");

        assert_eq!(
            response.members[0].recommended_model.as_deref(),
            Some("explicit-model")
        );
    }

    #[test]
    fn build_preset_snapshot_uses_selected_profile_model_when_agent_model_missing() {
        let session = test_session(true);
        let mut presets = test_presets();
        let mut row = test_row("backend");
        row.model_name = None;
        row.runner_type = "codex".to_string();
        row.tools_enabled = SqlxJson(json!({ "executor_profile_variant": "GPT_5.5" }));

        let response = build_preset_snapshot(
            &session,
            vec![row],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::FailIfExists),
            &mut presets,
        )
        .expect("snapshot succeeds");

        assert_eq!(
            response.members[0].recommended_model.as_deref(),
            Some("gpt-5.5")
        );
    }

    #[test]
    fn build_preset_snapshot_rejects_no_members() {
        let session = test_session(true);
        let mut presets = test_presets();

        let error = build_preset_snapshot(
            &session,
            vec![],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::FailIfExists),
            &mut presets,
        )
        .expect_err("empty snapshot should fail");

        assert!(matches!(error, ApiError::BadRequest(_)));
    }

    #[test]
    fn build_preset_snapshot_rejects_member_id_conflict() {
        let session = test_session(true);
        let mut presets = test_presets();
        presets.members.push(ChatMemberPreset {
            id: "delivery_backend".to_string(),
            name: "existing".to_string(),
            description: "Existing member".to_string(),
            runner_type: Some("codex".to_string()),
            recommended_model: None,
            system_prompt: String::new(),
            default_workspace_path: None,
            selected_skill_ids: vec![],
            tools_enabled: json!({}),
            is_builtin: false,
            enabled: true,
        });

        let error = build_preset_snapshot(
            &session,
            vec![test_row("backend")],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::FailIfExists),
            &mut presets,
        )
        .expect_err("member conflict should fail");

        assert!(matches!(error, ApiError::Conflict(_)));
    }

    #[test]
    fn build_preset_snapshot_rejects_builtin_team_overwrite() {
        let session = test_session(true);
        let mut presets = test_presets();
        presets.teams.push(ChatTeamPreset {
            id: "delivery".to_string(),
            name: "Built-in".to_string(),
            description: "Built-in team".to_string(),
            member_ids: vec![],
            lead_member_id: None,
            team_protocol: String::new(),
            is_builtin: true,
            enabled: true,
        });

        let error = build_preset_snapshot(
            &session,
            vec![test_row("backend")],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::OverwriteCustom),
            &mut presets,
        )
        .expect_err("built-in overwrite should fail");

        assert!(matches!(error, ApiError::Forbidden(_)));
    }

    #[test]
    fn build_preset_snapshot_overwrites_custom_team_and_members() {
        let session = test_session(true);
        let mut presets = test_presets();
        presets.members.push(ChatMemberPreset {
            id: "delivery_backend".to_string(),
            name: "old-backend".to_string(),
            description: "Old member".to_string(),
            runner_type: Some("codex".to_string()),
            recommended_model: None,
            system_prompt: "old".to_string(),
            default_workspace_path: None,
            selected_skill_ids: vec![],
            tools_enabled: json!({}),
            is_builtin: false,
            enabled: true,
        });
        presets.teams.push(ChatTeamPreset {
            id: "delivery".to_string(),
            name: "Old team".to_string(),
            description: "Old team".to_string(),
            member_ids: vec!["delivery_backend".to_string()],
            lead_member_id: None,
            team_protocol: "old".to_string(),
            is_builtin: false,
            enabled: true,
        });

        let response = build_preset_snapshot(
            &session,
            vec![test_row("backend")],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::OverwriteCustom),
            &mut presets,
        )
        .expect("custom overwrite succeeds");

        assert!(response.overwritten);
        assert_eq!(presets.teams[0].name, "Delivery Team");
        assert_eq!(presets.members.len(), 1);
        assert_eq!(presets.members[0].name, "backend");
        assert_eq!(presets.members[0].system_prompt, "You are backend.");
    }

    #[test]
    fn build_preset_snapshot_omits_disabled_team_protocol() {
        let session = test_session(false);
        let mut presets = test_presets();

        let response = build_preset_snapshot(
            &session,
            vec![test_row("backend")],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::FailIfExists),
            &mut presets,
        )
        .expect("snapshot succeeds");

        assert_eq!(response.team.team_protocol, "");
    }
}
