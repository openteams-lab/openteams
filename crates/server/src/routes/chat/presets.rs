use std::{collections::HashSet, str::FromStr};

use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State},
    response::Json as ResponseJson,
    routing::get,
};
use db::models::{chat_session::ChatSession, project_team_protocol::ProjectTeamProtocol};
use deployment::Deployment;
use executors::{
    executors::{BaseCodingAgent, CodingAgent},
    profile::{ExecutorConfigs, ExecutorProfileId, canonical_variant_key},
};
use serde::{Deserialize, Serialize};
use services::services::{
    analytics_events::{AnalyticsEvent, AnalyticsEventPayload, AnalyticsProjector},
    config::{
        ChatMemberPreset, ChatPresetsConfig, ChatTeamPreset, ChatTeamTemplateTier,
        ChatWorkflowStep, Config, TeamTemplateCatalogService,
    },
};
use sqlx::{FromRow, types::Json as SqlxJson};
use ts_rs::TS;
use utils::{assets::config_path, response::ApiResponse, text::sanitize_member_handle};
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

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
    pub tier: ChatTeamTemplateTier,
    pub member_count: usize,
    pub members: Vec<TeamPresetMemberSummary>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct TeamPresetListResponse {
    pub teams: Vec<TeamPresetSummary>,
}

#[derive(Debug, Clone, Default, Deserialize, TS)]
#[ts(export)]
pub struct TeamPresetLocaleQuery {
    pub locale: Option<String>,
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
    pub tier: Option<ChatTeamTemplateTier>,
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
    pub tier: Option<ChatTeamTemplateTier>,
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
    Query(query): Query<TeamPresetLocaleQuery>,
) -> Result<ResponseJson<ApiResponse<TeamPresetListResponse>>, ApiError> {
    let config = deployment.config().read().await;
    let catalog = TeamTemplateCatalogService::new(deployment.db().pool.clone(), config_path());
    let templates = catalog
        .list_templates(&config, query.locale.as_deref())
        .await?;
    let response = list_team_presets_from_templates(&templates);

    Ok(ResponseJson(ApiResponse::success(response)))
}

pub async fn get_team_preset(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<String>,
    Query(query): Query<TeamPresetLocaleQuery>,
) -> Result<ResponseJson<ApiResponse<ChatTeamPreset>>, ApiError> {
    let id = validate_preset_id(&id, "Team preset ID")?;
    let config = deployment.config().read().await;
    let catalog = TeamTemplateCatalogService::new(deployment.db().pool.clone(), config_path());
    let team = catalog
        .get_template(&config, &id, query.locale.as_deref())
        .await?
        .ok_or_else(|| ApiError::BadRequest(format!("Team preset not found: {id}")))?;

    Ok(ResponseJson(ApiResponse::success(team)))
}

pub async fn create_team_preset(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateTeamPresetRequest>,
) -> Result<ResponseJson<ApiResponse<ChatTeamPreset>>, ApiError> {
    let mut config_guard = deployment.config().write().await;
    let mut next_config = config_guard.clone();
    let team = create_team_preset_in_config(&mut next_config.chat_presets, payload)?;

    persist_team_presets_config(&deployment.db().pool, &config_path(), &next_config).await?;
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

    persist_team_presets_config(&deployment.db().pool, &config_path(), &next_config).await?;
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

    persist_team_presets_config(&deployment.db().pool, &config_path(), &next_config).await?;
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
    let team_protocol = if let Some(project_id) = session.project_id {
        ProjectTeamProtocol::find_by_project(&deployment.db().pool, project_id)
            .await?
            .and_then(|protocol| protocol.content_if_enabled().map(str::to_string))
    } else {
        None
    };

    let mut config_guard = deployment.config().write().await;
    let mut next_config = config_guard.clone();
    let response = build_preset_snapshot(
        &session,
        team_protocol.as_deref(),
        rows,
        payload,
        &mut next_config.chat_presets,
    )?;

    persist_team_presets_config(&deployment.db().pool, &config_path(), &next_config).await?;
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
        .record_or_warn(
            AnalyticsEvent::new(AnalyticsEventPayload::PresetSnapshotCreated {
                member_count: response.team.members.len().min(u32::MAX as usize) as u32,
                overwritten: response.overwritten,
                overwrite_strategy: requested_overwrite_strategy.as_str().to_string(),
            })
            .with_session(session.id),
        )
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

async fn persist_team_presets_config(
    pool: &sqlx::SqlitePool,
    config_path: &std::path::Path,
    config: &Config,
) -> Result<(), ApiError> {
    TeamTemplateCatalogService::new(pool.clone(), config_path.to_path_buf())
        .save_config_and_sync(config)
        .await?;
    Ok(())
}

fn list_team_presets_from_templates(presets: &[ChatTeamPreset]) -> TeamPresetListResponse {
    let teams = presets.iter().map(team_preset_summary).collect::<Vec<_>>();
    TeamPresetListResponse { teams }
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
    tier: Option<ChatTeamTemplateTier>,
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
            tier: req.tier,
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
            tier: req.tier,
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
        tier: payload.tier.unwrap_or(ChatTeamTemplateTier::Standard),
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
        tier: team.tier,
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
    team_protocol: Option<&str>,
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

    let team_protocol = team_protocol
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string();
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
        tier: ChatTeamTemplateTier::Standard,
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
    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Method, Request, StatusCode},
    };
    use chrono::Utc;
    use db::{
        DBService,
        models::{
            chat_session::ChatSessionStatus,
            chat_team_template_catalog::{ChatTeamTemplateCatalog, TeamTemplateCatalogSource},
        },
    };
    use serde_json::{Value, json};
    use sqlx::SqlitePool;
    use tower::ServiceExt;

    use super::*;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::migrate!("../db/migrations")
            .run(&pool)
            .await
            .expect("run migrations");
        pool
    }

    async fn setup_app() -> (Router, SqlitePool) {
        let pool = setup_pool().await;
        let deployment =
            local_deployment::LocalDeployment::new_for_test_pool(DBService { pool: pool.clone() })
                .await
                .expect("create test deployment");
        let app = Router::new()
            .nest("/api/team-presets", team_presets_router())
            .with_state(deployment);
        (app, pool)
    }

    async fn request_json(
        app: &Router,
        method: Method,
        uri: String,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder().method(method).uri(uri);
        let request_body = if let Some(body) = body {
            builder = builder.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&body).expect("serialize request body"))
        } else {
            Body::empty()
        };
        let response = app
            .clone()
            .oneshot(builder.body(request_body).expect("build request"))
            .await
            .expect("execute request");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response body");
        let body = serde_json::from_slice(&bytes).expect("parse response JSON");
        (status, body)
    }

    async fn api_get(app: &Router, uri: impl Into<String>) -> Value {
        let (status, body) = request_json(app, Method::GET, uri.into(), None).await;
        assert_eq!(status, StatusCode::OK, "response body: {body}");
        response_data(&body).clone()
    }

    fn response_data(body: &Value) -> &Value {
        assert_eq!(body["success"], true, "response body: {body}");
        body.get("data").expect("response data")
    }

    fn test_session() -> ChatSession {
        ChatSession {
            id: Uuid::new_v4(),
            title: Some("Delivery Team".to_string()),
            status: ChatSessionStatus::Active,
            lead_agent_id: None,
            lead_session_agent_id: None,
            summary_text: None,
            archive_ref: None,
            last_seen_diff_key: None,
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
            tier: None,
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
            tier: None,
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
        request.tier = Some(ChatTeamTemplateTier::Advanced);
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
        assert_eq!(team.tier, ChatTeamTemplateTier::Advanced);
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
            tier: ChatTeamTemplateTier::Standard,
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
            tier: ChatTeamTemplateTier::Standard,
        });

        delete_team_preset_from_config(&mut presets, "target_team").expect("delete succeeds");

        assert!(!presets.teams.iter().any(|team| team.id == "target_team"));
        assert!(presets.teams.iter().any(|team| team.id == "other_team"));
    }

    #[tokio::test]
    async fn persist_team_presets_config_keeps_catalog_in_sync_for_custom_mutations() {
        let pool = setup_pool().await;
        let temp = tempfile::TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        let mut config = Config::default();
        let mut team = ChatTeamPreset {
            id: "route_custom_team".to_string(),
            name: "Route Custom Team".to_string(),
            description: "Created through route persistence.".to_string(),
            members: vec![custom_member_preset("route_member")],
            lead_member_id: None,
            workflow_steps: Vec::new(),
            team_protocol: "Original protocol.".to_string(),
            is_builtin: false,
            enabled: true,
            tier: ChatTeamTemplateTier::Standard,
        };
        config.chat_presets.teams.push(team.clone());

        persist_team_presets_config(&pool, &config_path, &config)
            .await
            .expect("persist create");
        let created = ChatTeamTemplateCatalog::find_by_id(&pool, "route_custom_team")
            .await
            .expect("find created")
            .expect("catalog row exists");
        assert_eq!(created.source, TeamTemplateCatalogSource::Custom);

        let original_checksum = created.content_checksum.clone();
        team.team_protocol = "Updated protocol.".to_string();
        config
            .chat_presets
            .teams
            .retain(|preset| preset.id != "route_custom_team");
        config.chat_presets.teams.push(team);
        persist_team_presets_config(&pool, &config_path, &config)
            .await
            .expect("persist update");
        let updated = ChatTeamTemplateCatalog::find_by_id(&pool, "route_custom_team")
            .await
            .expect("find updated")
            .expect("catalog row still exists");
        assert_ne!(updated.content_checksum, original_checksum);

        config
            .chat_presets
            .teams
            .retain(|preset| preset.id != "route_custom_team");
        persist_team_presets_config(&pool, &config_path, &config)
            .await
            .expect("persist delete");
        assert!(
            ChatTeamTemplateCatalog::find_by_id(&pool, "route_custom_team")
                .await
                .expect("find deleted")
                .is_none()
        );
    }

    #[tokio::test]
    async fn catalog_backed_team_preset_list_and_detail_support_all_locales_and_tier() {
        let pool = setup_pool().await;
        let temp = tempfile::TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        let config = Config::default();
        persist_team_presets_config(&pool, &config_path, &config)
            .await
            .expect("persist defaults");
        let catalog = TeamTemplateCatalogService::new(pool, config_path);
        let english = catalog
            .get_template(&config, "fullstack_delivery_team", Some("en"))
            .await
            .expect("get English")
            .expect("English template exists");

        for locale in ["en", "zh", "ja", "ko", "fr", "es"] {
            let templates = catalog
                .list_templates(&config, Some(locale))
                .await
                .expect("list localized templates");
            let detail = catalog
                .get_template(&config, "fullstack_delivery_team", Some(locale))
                .await
                .expect("get localized template")
                .expect("localized template exists");
            let response = list_team_presets_from_templates(&templates);

            assert_eq!(response.teams.len(), 11, "{locale}");
            assert!(response.teams.iter().any(|team| {
                team.id == "advanced-growth-ops" && team.tier == ChatTeamTemplateTier::Advanced
            }));
            assert_eq!(detail.id, "fullstack_delivery_team");
            assert!(!detail.team_protocol.trim().is_empty());
            if locale != "en" {
                assert_ne!(detail.name, english.name, "{locale}");
            }
        }
    }

    #[tokio::test]
    async fn team_preset_routes_accept_locale_and_return_localized_protocol() {
        let (app, _pool) = setup_app().await;
        let english = api_get(&app, "/api/team-presets/fullstack_delivery_team?locale=en").await;
        let localized = api_get(
            &app,
            "/api/team-presets/fullstack_delivery_team?locale=fr-FR",
        )
        .await;
        let list = api_get(&app, "/api/team-presets?locale=fr-FR").await;

        assert_ne!(localized["name"], english["name"]);
        assert_ne!(localized["team_protocol"], english["team_protocol"]);
        assert_eq!(list["teams"].as_array().expect("teams array").len(), 11);
        assert!(
            list["teams"]
                .as_array()
                .expect("teams array")
                .iter()
                .any(|team| team["id"] == "advanced-growth-ops" && team["tier"] == "advanced")
        );
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
            tier: ChatTeamTemplateTier::Standard,
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
        let session = test_session();
        let mut presets = test_presets();

        let response = build_preset_snapshot(
            &session,
            Some("Follow the team protocol."),
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
        let session = test_session();
        let mut presets = test_presets();

        let response = build_preset_snapshot(
            &session,
            Some("Follow the team protocol."),
            vec![test_row("backend")],
            snapshot_request_without_description("delivery"),
            &mut presets,
        )
        .expect("snapshot succeeds");

        assert_eq!(response.team.description, "");
    }

    #[test]
    fn build_preset_snapshot_deduplicates_member_names_and_ids() {
        let session = test_session();
        let mut presets = test_presets();

        let response = build_preset_snapshot(
            &session,
            Some("Follow the team protocol."),
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
        let session = test_session();
        let mut presets = test_presets();

        let response = build_preset_snapshot(
            &session,
            Some("Follow the team protocol."),
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
        let session = test_session();
        let mut presets = test_presets();
        let mut row = test_row("backend");
        row.model_name = Some("explicit-model".to_string());
        row.runner_type = "codex".to_string();
        row.tools_enabled = SqlxJson(json!({ "executor_profile_variant": "GPT_5.6_SOL" }));

        let response = build_preset_snapshot(
            &session,
            Some("Follow the team protocol."),
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
        let session = test_session();
        let mut presets = test_presets();
        let mut row = test_row("backend");
        row.model_name = None;
        row.runner_type = "codex".to_string();
        row.tools_enabled = SqlxJson(json!({ "executor_profile_variant": "GPT_5.6_SOL" }));

        let response = build_preset_snapshot(
            &session,
            Some("Follow the team protocol."),
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
        let session = test_session();
        let mut presets = test_presets();

        let error = build_preset_snapshot(
            &session,
            Some("Follow the team protocol."),
            vec![],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::FailIfExists),
            &mut presets,
        )
        .expect_err("empty snapshot should fail");

        assert!(matches!(error, ApiError::BadRequest(_)));
    }

    #[test]
    fn build_preset_snapshot_rejects_builtin_team_overwrite() {
        let session = test_session();
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
            tier: ChatTeamTemplateTier::Standard,
        });

        let error = build_preset_snapshot(
            &session,
            Some("Follow the team protocol."),
            vec![test_row("backend")],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::OverwriteCustom),
            &mut presets,
        )
        .expect_err("built-in overwrite should fail");

        assert!(matches!(error, ApiError::Forbidden(_)));
    }

    #[test]
    fn build_preset_snapshot_overwrites_custom_team_and_members() {
        let session = test_session();
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
            tier: ChatTeamTemplateTier::Standard,
        });

        let response = build_preset_snapshot(
            &session,
            Some("Follow the team protocol."),
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
    fn build_preset_snapshot_omits_missing_project_team_protocol() {
        let session = test_session();
        let mut presets = test_presets();

        let response = build_preset_snapshot(
            &session,
            None,
            vec![test_row("backend")],
            snapshot_request("delivery", PresetSnapshotOverwriteStrategy::FailIfExists),
            &mut presets,
        )
        .expect("snapshot succeeds");

        assert_eq!(response.team.team_protocol, "");
    }
}
