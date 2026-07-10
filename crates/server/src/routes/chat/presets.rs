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
    config::{
        ChatMemberPreset, ChatPresetsConfig, ChatTeamPreset, ChatWorkflowStep,
        save_config_to_file_atomic,
    },
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
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub lead_member_id: Option<String>,
    #[serde(default)]
    pub workflow_steps: Vec<ChatWorkflowStep>,
    pub team_protocol: Option<String>,
    pub enabled: Option<bool>,
    #[serde(default)]
    pub members: Vec<TeamPresetMemberWrite>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct UpdateTeamPresetRequest {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub lead_member_id: Option<String>,
    #[serde(default)]
    pub workflow_steps: Vec<ChatWorkflowStep>,
    pub team_protocol: Option<String>,
    pub enabled: Option<bool>,
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
) -> Result<ResponseJson<ApiResponse<ChatTeamPreset>>, ApiError> {
    let id = validate_preset_id(&id, "Team preset ID")?;
    let config = deployment.config().read().await;
    let team = get_team_preset_from_config(&config.chat_presets, &id)?;

    Ok(ResponseJson(ApiResponse::success(team)))
}

pub async fn create_team_preset(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateTeamPresetRequest>,
) -> Result<ResponseJson<ApiResponse<ChatTeamPreset>>, ApiError> {
    let mut config_guard = deployment.config().write().await;
    let mut next_config = config_guard.clone();
    let team = create_team_preset_in_config(&mut next_config.chat_presets, payload)?;

    save_config_to_file_atomic(&next_config, &config_path()).await?;
    *config_guard = next_config;

    Ok(ResponseJson(ApiResponse::success(team)))
}

pub async fn update_team_preset(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateTeamPresetRequest>,
) -> Result<ResponseJson<ApiResponse<ChatTeamPreset>>, ApiError> {
    let id = validate_preset_id(&id, "Team preset ID")?;
    let mut config_guard = deployment.config().write().await;
    let mut next_config = config_guard.clone();
    let team = update_team_preset_in_config(&mut next_config.chat_presets, &id, payload)?;

    save_config_to_file_atomic(&next_config, &config_path()).await?;
    *config_guard = next_config;

    Ok(ResponseJson(ApiResponse::success(team)))
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
        member_count = response.team.members.len(),
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
            member_count: response.team.members.len(),
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
        .map(team_preset_summary)
        .collect::<Vec<_>>();
    Ok(TeamPresetListResponse { teams })
}

fn get_team_preset_from_config(
    presets: &ChatPresetsConfig,
    id: &str,
) -> Result<ChatTeamPreset, ApiError> {
    presets
        .teams
        .iter()
        .find(|preset| preset.id == id)
        .cloned()
        .ok_or_else(|| ApiError::BadRequest(format!("Team preset not found: {id}")))
}

fn create_team_preset_in_config(
    presets: &mut ChatPresetsConfig,
    payload: CreateTeamPresetRequest,
) -> Result<ChatTeamPreset, ApiError> {
    let validated = validate_team_preset_payload(payload.into())?;

    if presets.teams.iter().any(|preset| preset.id == validated.id) {
        return Err(ApiError::Conflict(format!(
            "Team preset ID already exists: {}",
            validated.id
        )));
    }

    presets.teams.push(validated.clone());
    Ok(validated)
}

fn update_team_preset_in_config(
    presets: &mut ChatPresetsConfig,
    id: &str,
    payload: UpdateTeamPresetRequest,
) -> Result<ChatTeamPreset, ApiError> {
    let existing_index = presets
        .teams
        .iter()
        .position(|preset| preset.id == id)
        .ok_or_else(|| ApiError::BadRequest(format!("Team preset not found: {id}")))?;
    if presets.teams[existing_index].is_builtin {
        return Err(ApiError::Forbidden(format!(
            "Cannot edit built-in team preset: {id}"
        )));
    }

    let validated = validate_team_preset_payload(payload.into())?;
    if validated.id != id {
        return Err(ApiError::BadRequest(format!(
            "Team preset ID in request must match path ID: {id}"
        )));
    }

    presets.teams[existing_index] = validated.clone();
    Ok(validated)
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

    presets.teams.remove(existing_index);
    Ok(())
}

/// Internal aggregate payload shared by create and update validation.
struct TeamPresetPayload {
    id: String,
    name: String,
    description: Option<String>,
    lead_member_id: Option<String>,
    workflow_steps: Vec<ChatWorkflowStep>,
    team_protocol: Option<String>,
    enabled: Option<bool>,
    members: Vec<TeamPresetMemberWrite>,
}

impl From<CreateTeamPresetRequest> for TeamPresetPayload {
    fn from(req: CreateTeamPresetRequest) -> Self {
        Self {
            id: req.id,
            name: req.name,
            description: req.description,
            lead_member_id: req.lead_member_id,
            workflow_steps: req.workflow_steps,
            team_protocol: req.team_protocol,
            enabled: req.enabled,
            members: req.members,
        }
    }
}

impl From<UpdateTeamPresetRequest> for TeamPresetPayload {
    fn from(req: UpdateTeamPresetRequest) -> Self {
        Self {
            id: req.id,
            name: req.name,
            description: req.description,
            lead_member_id: req.lead_member_id,
            workflow_steps: req.workflow_steps,
            team_protocol: req.team_protocol,
            enabled: req.enabled,
            members: req.members,
        }
    }
}

fn validate_team_preset_payload(payload: TeamPresetPayload) -> Result<ChatTeamPreset, ApiError> {
    let team_id = validate_preset_id(&payload.id, "Team preset ID")?;
    let team_name = normalize_required_string(&payload.name, "Team preset name")?;
    let lead_member_id = normalize_optional_string(payload.lead_member_id)
        .map(|id| validate_preset_id(&id, "Lead member ID"))
        .transpose()?;

    let members = validate_member_presets(payload.members)?;
    if members.is_empty() {
        return Err(ApiError::BadRequest(
            "Team preset must include at least one member.".to_string(),
        ));
    }

    let member_id_set = members
        .iter()
        .map(|member| member.id.clone())
        .collect::<HashSet<_>>();
    if let Some(lead_member_id) = lead_member_id.as_ref()
        && !member_id_set.contains(lead_member_id)
    {
        return Err(ApiError::BadRequest(format!(
            "Lead member ID must reference a team member: {lead_member_id}"
        )));
    }

    let workflow_steps = normalize_workflow_steps(payload.workflow_steps);

    Ok(ChatTeamPreset {
        id: team_id,
        name: team_name,
        description: normalize_optional_string(payload.description).unwrap_or_default(),
        members,
        lead_member_id,
        workflow_steps,
        team_protocol: normalize_optional_string(payload.team_protocol).unwrap_or_default(),
        is_builtin: false,
        enabled: payload.enabled.unwrap_or(true),
    })
}

fn validate_member_presets(
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

        let name = sanitize_member_handle(&member.name);
        if name.is_empty() {
            return Err(ApiError::BadRequest(
                "Member preset name is required.".to_string(),
            ));
        }

        let tools_enabled = member
            .tools_enabled
            .filter(|value| !value.is_null())
            .unwrap_or_else(|| serde_json::json!({}));
        if !tools_enabled.is_object() {
            return Err(ApiError::BadRequest(format!(
                "Member preset {member_id} tools_enabled must be a JSON object."
            )));
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
            tools_enabled,
            is_builtin: false,
            enabled: member.enabled.unwrap_or(true),
        });
    }

    Ok(validated)
}

fn normalize_workflow_steps(steps: Vec<ChatWorkflowStep>) -> Vec<ChatWorkflowStep> {
    steps
        .into_iter()
        .filter(|step| !step.title.trim().is_empty() || !step.description.trim().is_empty())
        .map(|mut step| {
            step.title = step.title.trim().to_string();
            step.description = step.description.trim().to_string();
            step
        })
        .collect()
}

fn team_preset_summary(team: &ChatTeamPreset) -> TeamPresetSummary {
    let members = team
        .members
        .iter()
        .map(member_preset_summary)
        .collect::<Vec<_>>();

    TeamPresetSummary {
        id: team.id.clone(),
        name: team.name.clone(),
        description: team.description.clone(),
        lead_member_id: team.lead_member_id.clone(),
        team_protocol: team.team_protocol.clone(),
        is_builtin: team.is_builtin,
        enabled: team.enabled,
        member_count: team.members.len(),
        members,
    }
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

    let members = build_member_presets(session, &team_id, rows.clone());

    // Resolve lead_member_id: find the member preset that corresponds to the session's lead agent.
    let lead_member_id = session.lead_agent_id.and_then(|lead_agent_id| {
        // Find the row index whose agent_id matches the session's lead_agent_id
        rows.iter()
            .position(|row| row.agent_id == lead_agent_id)
            .and_then(|index| members.get(index))
            .map(|member| member.id.clone())
    });

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
        members: members.clone(),
        lead_member_id,
        workflow_steps: Vec::new(),
        team_protocol,
        is_builtin: false,
        enabled: true,
    };

    if let Some(index) = existing_team_index {
        presets.teams[index] = team.clone();
    } else {
        presets.teams.push(team.clone());
    }

    Ok(CreatePresetSnapshotResponse { team, overwritten })
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

    fn team_preset_member_ids(team: &ChatTeamPreset) -> Vec<String> {
        team.members.iter().map(|m| m.id.clone()).collect()
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
        members: Vec<TeamPresetMemberWrite>,
    ) -> CreateTeamPresetRequest {
        CreateTeamPresetRequest {
            id: id.to_string(),
            name: "Delivery Team".to_string(),
            description: Some("Team description".to_string()),
            lead_member_id: None,
            workflow_steps: Vec::new(),
            team_protocol: Some("Coordinate before shipping.".to_string()),
            enabled: Some(true),
            members,
        }
    }

    fn update_team_request(
        id: &str,
        members: Vec<TeamPresetMemberWrite>,
    ) -> UpdateTeamPresetRequest {
        UpdateTeamPresetRequest {
            id: id.to_string(),
            name: "Delivery Team".to_string(),
            description: Some("Team description".to_string()),
            lead_member_id: None,
            workflow_steps: Vec::new(),
            team_protocol: Some("Coordinate before shipping.".to_string()),
            enabled: Some(true),
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
        let mut request =
            create_team_request("delivery_team", vec![member_write("delivery_backend")]);
        request.lead_member_id = Some("delivery_backend".to_string());

        let team = create_team_preset_in_config(&mut presets, request).expect("create succeeds");

        assert_eq!(team.id, "delivery_team");
        assert_eq!(team_preset_member_ids(&team), vec!["delivery_backend"]);
        assert_eq!(team.lead_member_id.as_deref(), Some("delivery_backend"));
        assert_eq!(team.members.len(), 1);
        assert_eq!(team.members[0].name, "delivery_backend");
        assert_eq!(
            team.members[0].selected_skill_ids,
            vec!["skill-a", "skill-b"]
        );
        assert!(!team.is_builtin);
        assert!(presets.teams.iter().any(|t| t.id == "delivery_team"));
    }

    #[test]
    fn create_team_preset_persists_workflow_steps_team_protocol_and_member_fields() {
        let mut presets = test_presets();
        let mut request =
            create_team_request("delivery_team", vec![member_write("delivery_backend")]);
        request.workflow_steps = vec![
            ChatWorkflowStep {
                title: "Plan".to_string(),
                description: "Clarify scope.".to_string(),
            },
            ChatWorkflowStep {
                title: String::new(),
                description: String::new(),
            },
        ];
        request.team_protocol = Some("Coordinate tightly.".to_string());

        let team = create_team_preset_in_config(&mut presets, request).expect("create succeeds");

        assert_eq!(team.workflow_steps.len(), 1);
        assert_eq!(team.workflow_steps[0].title, "Plan");
        assert_eq!(team.workflow_steps[0].description, "Clarify scope.");
        assert_eq!(team.team_protocol, "Coordinate tightly.");
        assert_eq!(team.members[0].system_prompt, "You are delivery_backend.");
        assert_eq!(team.members[0].tools_enabled, json!({"mode": "test"}));
        assert_eq!(
            team.members[0].selected_skill_ids,
            vec!["skill-a", "skill-b"]
        );
    }

    #[test]
    fn team_preset_crud_rejects_invalid_team_and_member_required_fields() {
        let mut invalid_team_id_presets = test_presets();
        let invalid_team_id_error = create_team_preset_in_config(
            &mut invalid_team_id_presets,
            create_team_request("Delivery Team", vec![member_write("member_one")]),
        )
        .expect_err("invalid team id should fail");

        let mut blank_team_name_presets = test_presets();
        let mut blank_team_name_request =
            create_team_request("custom_team", vec![member_write("member_one")]);
        blank_team_name_request.name = "   ".to_string();
        let blank_team_name_error =
            create_team_preset_in_config(&mut blank_team_name_presets, blank_team_name_request)
                .expect_err("blank team name should fail");

        let mut invalid_member_id_presets = test_presets();
        let invalid_member_id_error = create_team_preset_in_config(
            &mut invalid_member_id_presets,
            create_team_request("custom_team", vec![member_write("Member One")]),
        )
        .expect_err("invalid member id should fail");

        let mut blank_member_name_presets = test_presets();
        let mut blank_member_name = member_write("member_one");
        blank_member_name.name = "   ".to_string();
        let blank_member_name_error = create_team_preset_in_config(
            &mut blank_member_name_presets,
            create_team_request("custom_team", vec![blank_member_name]),
        )
        .expect_err("blank member name should fail");

        assert!(matches!(invalid_team_id_error, ApiError::BadRequest(_)));
        assert!(matches!(blank_team_name_error, ApiError::BadRequest(_)));
        assert!(matches!(invalid_member_id_error, ApiError::BadRequest(_)));
        assert!(matches!(blank_member_name_error, ApiError::BadRequest(_)));
    }

    #[test]
    fn update_team_preset_in_config_replaces_embedded_members() {
        let mut presets = test_presets();
        create_team_preset_in_config(
            &mut presets,
            create_team_request("delivery_team", vec![member_write("delivery_backend")]),
        )
        .expect("create succeeds");

        let mut update =
            update_team_request("delivery_team", vec![member_write("delivery_frontend")]);
        update.name = "Updated Team".to_string();

        let team = update_team_preset_in_config(&mut presets, "delivery_team", update)
            .expect("update succeeds");

        assert_eq!(team.name, "Updated Team");
        assert_eq!(team_preset_member_ids(&team), vec!["delivery_frontend"]);
        assert_eq!(team.members.len(), 1);
        assert!(team.members.iter().all(|m| m.id == "delivery_frontend"));
    }

    #[test]
    fn delete_team_preset_from_config_removes_team() {
        let mut presets = test_presets();
        presets.teams.push(ChatTeamPreset {
            id: "target_team".to_string(),
            name: "Target".to_string(),
            description: "Target".to_string(),
            members: vec![custom_member_preset("owned_member")],
            lead_member_id: None,
            workflow_steps: Vec::new(),
            team_protocol: String::new(),
            is_builtin: false,
            enabled: true,
        });
        presets.teams.push(ChatTeamPreset {
            id: "other_team".to_string(),
            name: "Other".to_string(),
            description: "Other".to_string(),
            members: vec![custom_member_preset("shared_member")],
            lead_member_id: None,
            workflow_steps: Vec::new(),
            team_protocol: String::new(),
            is_builtin: false,
            enabled: true,
        });

        delete_team_preset_from_config(&mut presets, "target_team").expect("delete succeeds");

        assert!(!presets.teams.iter().any(|team| team.id == "target_team"));
        assert!(presets.teams.iter().any(|team| team.id == "other_team"));
    }

    #[test]
    fn team_preset_crud_rejects_builtin_template_mutations() {
        let mut presets = test_presets();
        presets.teams.push(ChatTeamPreset {
            id: "builtin_team".to_string(),
            name: "Built-in".to_string(),
            description: "Built-in".to_string(),
            members: vec![builtin_member_preset("builtin_member")],
            lead_member_id: None,
            workflow_steps: Vec::new(),
            team_protocol: String::new(),
            is_builtin: true,
            enabled: true,
        });

        let update_error = update_team_preset_in_config(
            &mut presets,
            "builtin_team",
            update_team_request("builtin_team", vec![member_write("builtin_member")]),
        )
        .expect_err("built-in update should fail");
        let delete_error = delete_team_preset_from_config(&mut presets, "builtin_team")
            .expect_err("built-in delete should fail");

        assert!(matches!(update_error, ApiError::Forbidden(_)));
        assert!(matches!(delete_error, ApiError::Forbidden(_)));
    }

    #[test]
    fn team_preset_crud_rejects_duplicate_member_ids_and_invalid_references() {
        let mut empty_members_presets = test_presets();
        let empty_members_error = create_team_preset_in_config(
            &mut empty_members_presets,
            create_team_request("custom_team", vec![]),
        )
        .expect_err("empty members should fail");

        let mut duplicate_payload_presets = test_presets();
        let duplicate_payload_error = create_team_preset_in_config(
            &mut duplicate_payload_presets,
            create_team_request(
                "custom_team",
                vec![member_write("member_one"), member_write("member_one")],
            ),
        )
        .expect_err("duplicate member payload should fail");

        let mut invalid_lead_presets = test_presets();
        let mut invalid_lead_request =
            create_team_request("custom_team", vec![member_write("member_one")]);
        invalid_lead_request.lead_member_id = Some("missing_lead".to_string());
        let invalid_lead_error =
            create_team_preset_in_config(&mut invalid_lead_presets, invalid_lead_request)
                .expect_err("invalid lead reference should fail");

        assert!(matches!(empty_members_error, ApiError::BadRequest(_)));
        assert!(matches!(duplicate_payload_error, ApiError::BadRequest(_)));
        assert!(matches!(invalid_lead_error, ApiError::BadRequest(_)));
    }

    #[test]
    fn team_preset_crud_rejects_non_object_tools_enabled() {
        let mut presets = test_presets();
        let mut bad_member = member_write("delivery_backend");
        bad_member.tools_enabled = Some(json!(["not", "an", "object"]));

        let error = create_team_preset_in_config(
            &mut presets,
            create_team_request("custom_team", vec![bad_member]),
        )
        .expect_err("non-object tools_enabled should fail");

        assert!(matches!(error, ApiError::BadRequest(_)));
    }

    #[test]
    fn team_preset_crud_filters_blank_workflow_steps() {
        let mut presets = test_presets();
        let mut request =
            create_team_request("delivery_team", vec![member_write("delivery_backend")]);
        request.workflow_steps = vec![
            ChatWorkflowStep {
                title: "  ".to_string(),
                description: "  ".to_string(),
            },
            ChatWorkflowStep {
                title: "Plan".to_string(),
                description: String::new(),
            },
            ChatWorkflowStep {
                title: String::new(),
                description: "  Build it.  ".to_string(),
            },
        ];

        let team = create_team_preset_in_config(&mut presets, request).expect("create succeeds");

        assert_eq!(team.workflow_steps.len(), 2);
        assert_eq!(team.workflow_steps[0].title, "Plan");
        assert_eq!(team.workflow_steps[1].description, "Build it.");
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
            team_preset_member_ids(&response.team),
            vec!["delivery_backend", "delivery_frontend"]
        );
        assert_eq!(response.team.team_protocol, "Follow the team protocol.");
        assert!(!response.team.is_builtin);
        assert_eq!(response.team.members.len(), 2);
        assert!(
            response
                .team
                .members
                .iter()
                .all(|member| !member.is_builtin)
        );
        assert_eq!(
            response.team.members[0].selected_skill_ids,
            vec!["skill-a", "skill-b"]
        );
        assert_eq!(
            response.team.members[0].recommended_model.as_deref(),
            Some("gpt-5.2")
        );
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
                .team
                .members
                .iter()
                .map(|member| member.name.as_str())
                .collect::<Vec<_>>(),
            vec!["BackendEngineer", "backendengineer_2"]
        );
        assert_eq!(
            team_preset_member_ids(&response.team),
            vec!["delivery_backendengineer", "delivery_backendengineer_2"]
        );

        let imported_names = response
            .team
            .members
            .iter()
            .map(|member| member.name.to_lowercase())
            .collect::<HashSet<_>>();
        assert_eq!(
            imported_names.len(),
            response.team.members.len(),
            "team import names must remain unique"
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
                .team
                .members
                .iter()
                .map(|member| member.name.as_str())
                .collect::<Vec<_>>(),
            vec!["member", "member_2"]
        );
        assert_eq!(
            team_preset_member_ids(&response.team),
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
        row.tools_enabled = SqlxJson(json!({ "executor_profile_variant": "GPT_5.6_SOL" }));

        let response = build_preset_snapshot(
            &session,
            vec![row],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::FailIfExists),
            &mut presets,
        )
        .expect("snapshot succeeds");

        assert_eq!(
            response.team.members[0].recommended_model.as_deref(),
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
        row.tools_enabled = SqlxJson(json!({ "executor_profile_variant": "GPT_5.6_SOL" }));

        let response = build_preset_snapshot(
            &session,
            vec![row],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::FailIfExists),
            &mut presets,
        )
        .expect("snapshot succeeds");

        assert_eq!(
            response.team.members[0].recommended_model.as_deref(),
            Some("gpt-5.6-sol")
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
    fn build_preset_snapshot_rejects_builtin_team_overwrite() {
        let session = test_session(true);
        let mut presets = test_presets();
        presets.teams.push(ChatTeamPreset {
            id: "delivery".to_string(),
            name: "Built-in".to_string(),
            description: "Built-in team".to_string(),
            members: vec![],
            lead_member_id: None,
            workflow_steps: Vec::new(),
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
        presets.teams.push(ChatTeamPreset {
            id: "delivery".to_string(),
            name: "Old team".to_string(),
            description: "Old team".to_string(),
            members: vec![ChatMemberPreset {
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
            }],
            lead_member_id: None,
            workflow_steps: Vec::new(),
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
        assert_eq!(presets.teams[0].members.len(), 1);
        assert_eq!(presets.teams[0].members[0].name, "backend");
        assert_eq!(
            presets.teams[0].members[0].system_prompt,
            "You are backend."
        );
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
