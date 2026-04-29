use std::{collections::HashSet, str::FromStr};

use axum::{Extension, Json, extract::State, response::Json as ResponseJson};
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
use utils::{assets::config_path, response::ApiResponse};
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

#[derive(Debug, Clone, FromRow)]
struct SessionPresetMemberRow {
    session_agent_id: Uuid,
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
            summary_text: None,
            archive_ref: None,
            last_seen_diff_key: None,
            team_protocol: Some(content),
            team_protocol_enabled: Some(effective.enabled),
            default_workspace_path: None,
        },
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(effective)))
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
        .unwrap_or_else(|| format!("Snapshot of chat session {}.", session.id));

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
    let members = build_member_presets(session, &team_id, rows);
    validate_member_id_conflicts(presets, &members, &replaceable_member_ids)?;

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
    let normalized = value.split_whitespace().collect::<Vec<_>>().join("_");
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
        if let Some(existing) = presets.members.iter().find(|preset| preset.id == member.id) {
            if existing.is_builtin || !replaceable_member_ids.contains(&existing.id) {
                return Err(ApiError::Conflict(format!(
                    "Member preset ID already exists: {}",
                    member.id
                )));
            }
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
            summary_text: None,
            archive_ref: None,
            last_seen_diff_key: None,
            team_protocol: Some("Follow the team protocol.".to_string()),
            team_protocol_enabled,
            default_workspace_path: Some("/workspace/default".to_string()),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            archived_at: None,
        }
    }

    fn test_presets() -> ChatPresetsConfig {
        ChatPresetsConfig {
            members: vec![],
            teams: vec![],
            team_protocol: Some(String::new()),
        }
    }

    fn test_row(name: &str) -> SessionPresetMemberRow {
        SessionPresetMemberRow {
            session_agent_id: Uuid::new_v4(),
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
            vec!["Backend_Engineer", "backend_engineer_2"]
        );
        assert_eq!(
            response.team.member_ids,
            vec!["delivery_backend_engineer", "delivery_backend_engineer_2"]
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
        row.tools_enabled = SqlxJson(json!({ "executor_profile_variant": "GPT_5_5" }));

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
        row.tools_enabled = SqlxJson(json!({ "executor_profile_variant": "GPT_5_5" }));

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
