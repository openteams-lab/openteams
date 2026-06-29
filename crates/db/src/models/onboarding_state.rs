use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use thiserror::Error;
use ts_rs::TS;

const ONBOARDING_STATE_COLUMNS: &str = r#"
    id,
    welcome_seen_at,
    onboarding_completed_at,
    current_step,
    selected_scenario,
    recommended_team_name,
    team_config_json,
    project_path,
    project_name,
    created_project_id,
    project_path_is_git,
    language,
    appearance,
    last_seen_upgrade_version,
    created_at,
    updated_at
"#;

const ONBOARDING_STATE_ID: i64 = 1;

#[derive(Debug, Error)]
pub enum OnboardingStateError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "onboarding_step", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum OnboardingStep {
    #[default]
    Scenario,
    Executor,
    ProjectPath,
    Appearance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "onboarding_scenario", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum OnboardingScenario {
    Software,
    Design,
    Research,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "onboarding_language", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum OnboardingLanguage {
    Browser,
    En,
    Fr,
    Ja,
    Es,
    Ko,
    ZhHans,
    ZhHant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "onboarding_appearance", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum OnboardingAppearance {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct OnboardingTeamMemberConfig {
    pub member: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub runner_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct OnboardingState {
    #[ts(type = "Date | null")]
    pub welcome_seen_at: Option<DateTime<Utc>>,
    #[ts(type = "Date | null")]
    pub onboarding_completed_at: Option<DateTime<Utc>>,
    pub current_step: OnboardingStep,
    pub selected_scenario: Option<OnboardingScenario>,
    pub recommended_team_name: Option<String>,
    pub team_config: Option<Vec<OnboardingTeamMemberConfig>>,
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    pub created_project_id: Option<String>,
    pub project_path_is_git: bool,
    pub language: Option<OnboardingLanguage>,
    pub appearance: Option<OnboardingAppearance>,
    pub last_seen_upgrade_version: Option<String>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default, Deserialize, TS)]
pub struct UpdateOnboardingStateRequest {
    #[serde(default)]
    #[ts(optional)]
    pub welcome_seen: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub current_step: Option<OnboardingStep>,
    #[serde(default)]
    #[ts(optional)]
    pub selected_scenario: Option<OnboardingScenario>,
    #[serde(default)]
    #[ts(optional)]
    pub recommended_team_name: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub team_config: Option<Vec<OnboardingTeamMemberConfig>>,
    #[serde(default)]
    #[ts(optional)]
    pub project_path: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub project_name: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub created_project_id: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub language: Option<OnboardingLanguage>,
    #[serde(default)]
    #[ts(optional)]
    pub appearance: Option<OnboardingAppearance>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct MarkUpgradeReadRequest {
    pub version: String,
}

#[derive(Debug, Clone, Default)]
pub struct OnboardingStatePatch {
    pub welcome_seen_at: Option<DateTime<Utc>>,
    pub onboarding_completed_at: Option<DateTime<Utc>>,
    pub current_step: Option<OnboardingStep>,
    pub selected_scenario: Option<OnboardingScenario>,
    pub recommended_team_name: Option<String>,
    pub team_config: Option<Vec<OnboardingTeamMemberConfig>>,
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    pub created_project_id: Option<String>,
    pub project_path_is_git: Option<bool>,
    pub language: Option<OnboardingLanguage>,
    pub appearance: Option<OnboardingAppearance>,
    pub last_seen_upgrade_version: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
struct OnboardingStateRow {
    id: i64,
    welcome_seen_at: Option<DateTime<Utc>>,
    onboarding_completed_at: Option<DateTime<Utc>>,
    current_step: OnboardingStep,
    selected_scenario: Option<OnboardingScenario>,
    recommended_team_name: Option<String>,
    team_config_json: Option<String>,
    project_path: Option<String>,
    project_name: Option<String>,
    created_project_id: Option<String>,
    project_path_is_git: bool,
    language: Option<OnboardingLanguage>,
    appearance: Option<OnboardingAppearance>,
    last_seen_upgrade_version: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl TryFrom<OnboardingStateRow> for OnboardingState {
    type Error = OnboardingStateError;

    fn try_from(row: OnboardingStateRow) -> Result<Self, Self::Error> {
        let team_config = row
            .team_config_json
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(serde_json::from_str)
            .transpose()?;

        Ok(Self {
            welcome_seen_at: row.welcome_seen_at,
            onboarding_completed_at: row.onboarding_completed_at,
            current_step: row.current_step,
            selected_scenario: row.selected_scenario,
            recommended_team_name: row.recommended_team_name,
            team_config,
            project_path: row.project_path,
            project_name: row.project_name,
            created_project_id: row.created_project_id,
            project_path_is_git: row.project_path_is_git,
            language: row.language,
            appearance: row.appearance,
            last_seen_upgrade_version: row.last_seen_upgrade_version,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

impl OnboardingStateRow {
    fn into_state(self) -> Result<OnboardingState, OnboardingStateError> {
        OnboardingState::try_from(self)
    }
}

impl OnboardingState {
    pub async fn get_or_create(pool: &SqlitePool) -> Result<Self, OnboardingStateError> {
        Self::ensure_exists(pool).await?;
        Self::fetch_row(pool).await?.into_state()
    }

    pub async fn apply_patch(
        pool: &SqlitePool,
        patch: &OnboardingStatePatch,
    ) -> Result<Self, OnboardingStateError> {
        Self::ensure_exists(pool).await?;
        let existing = Self::fetch_row(pool).await?;
        let team_config_json = match &patch.team_config {
            Some(config) => Some(serde_json::to_string(config)?),
            None => existing.team_config_json,
        };

        let row = sqlx::query_as::<_, OnboardingStateRow>(&format!(
            "UPDATE onboarding_state
             SET welcome_seen_at = ?2,
                 onboarding_completed_at = ?3,
                 current_step = ?4,
                 selected_scenario = ?5,
                 recommended_team_name = ?6,
                 team_config_json = ?7,
                 project_path = ?8,
                 project_name = ?9,
                 created_project_id = ?10,
                 project_path_is_git = ?11,
                 language = ?12,
                 appearance = ?13,
                 last_seen_upgrade_version = ?14,
                 updated_at = datetime('now', 'subsec')
             WHERE id = ?1
             RETURNING {ONBOARDING_STATE_COLUMNS}"
        ))
        .bind(existing.id)
        .bind(patch.welcome_seen_at.or(existing.welcome_seen_at))
        .bind(
            patch
                .onboarding_completed_at
                .or(existing.onboarding_completed_at),
        )
        .bind(patch.current_step.unwrap_or(existing.current_step))
        .bind(patch.selected_scenario.or(existing.selected_scenario))
        .bind(
            patch
                .recommended_team_name
                .clone()
                .or(existing.recommended_team_name),
        )
        .bind(team_config_json)
        .bind(patch.project_path.clone().or(existing.project_path))
        .bind(patch.project_name.clone().or(existing.project_name))
        .bind(
            patch
                .created_project_id
                .clone()
                .or(existing.created_project_id),
        )
        .bind(
            patch
                .project_path_is_git
                .unwrap_or(existing.project_path_is_git),
        )
        .bind(patch.language.or(existing.language))
        .bind(patch.appearance.or(existing.appearance))
        .bind(
            patch
                .last_seen_upgrade_version
                .clone()
                .or(existing.last_seen_upgrade_version),
        )
        .fetch_one(pool)
        .await?;

        row.into_state()
    }

    pub async fn reset_onboarding(pool: &SqlitePool) -> Result<Self, OnboardingStateError> {
        Self::ensure_exists(pool).await?;
        let row = sqlx::query_as::<_, OnboardingStateRow>(&format!(
            "UPDATE onboarding_state
             SET welcome_seen_at = NULL,
                 onboarding_completed_at = NULL,
                 current_step = 'scenario',
                 selected_scenario = NULL,
                 recommended_team_name = NULL,
                 team_config_json = NULL,
                 project_path = NULL,
                 project_name = NULL,
                 created_project_id = NULL,
                 project_path_is_git = 0,
                 language = NULL,
                 appearance = NULL,
                 updated_at = datetime('now', 'subsec')
             WHERE id = ?1
             RETURNING {ONBOARDING_STATE_COLUMNS}"
        ))
        .bind(ONBOARDING_STATE_ID)
        .fetch_one(pool)
        .await?;

        row.into_state()
    }

    pub async fn reset_upgrade_read(pool: &SqlitePool) -> Result<Self, OnboardingStateError> {
        Self::ensure_exists(pool).await?;
        let row = sqlx::query_as::<_, OnboardingStateRow>(&format!(
            "UPDATE onboarding_state
             SET last_seen_upgrade_version = NULL,
                 updated_at = datetime('now', 'subsec')
             WHERE id = ?1
             RETURNING {ONBOARDING_STATE_COLUMNS}"
        ))
        .bind(ONBOARDING_STATE_ID)
        .fetch_one(pool)
        .await?;

        row.into_state()
    }

    async fn ensure_exists(pool: &SqlitePool) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO onboarding_state (id) VALUES (?1) ON CONFLICT(id) DO NOTHING")
            .bind(ONBOARDING_STATE_ID)
            .execute(pool)
            .await?;
        Ok(())
    }

    async fn fetch_row(pool: &SqlitePool) -> Result<OnboardingStateRow, sqlx::Error> {
        sqlx::query_as::<_, OnboardingStateRow>(&format!(
            "SELECT {ONBOARDING_STATE_COLUMNS}
             FROM onboarding_state
             WHERE id = ?1"
        ))
        .bind(ONBOARDING_STATE_ID)
        .fetch_one(pool)
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::raw_sql(include_str!(
            "../../migrations/20260629090000_create_onboarding_state.sql"
        ))
        .execute(&pool)
        .await
        .expect("create onboarding_state table");
        sqlx::raw_sql(include_str!(
            "../../migrations/20260629142000_extend_onboarding_project_fields.sql"
        ))
        .execute(&pool)
        .await
        .expect("extend onboarding_state table");
        pool
    }

    #[tokio::test]
    async fn get_or_create_returns_default_singleton_state() {
        let pool = setup_pool().await;

        let state = OnboardingState::get_or_create(&pool)
            .await
            .expect("get default state");

        assert_eq!(state.current_step, OnboardingStep::Scenario);
        assert!(state.welcome_seen_at.is_none());
        assert!(state.onboarding_completed_at.is_none());
        assert!(state.selected_scenario.is_none());
        assert!(state.team_config.is_none());
        assert!(state.project_path.is_none());
        assert!(state.project_name.is_none());
        assert!(state.created_project_id.is_none());
        assert!(!state.project_path_is_git);
    }

    #[tokio::test]
    async fn apply_patch_saves_step_team_and_project_git_state() {
        let pool = setup_pool().await;
        let seen_at = Utc::now();

        let state = OnboardingState::apply_patch(
            &pool,
            &OnboardingStatePatch {
                welcome_seen_at: Some(seen_at),
                current_step: Some(OnboardingStep::ProjectPath),
                selected_scenario: Some(OnboardingScenario::Software),
                recommended_team_name: Some("Software team".to_string()),
                team_config: Some(vec![OnboardingTeamMemberConfig {
                    member: "Lead Agent".to_string(),
                    runner_type: Some("codex".to_string()),
                    model_name: Some("gpt-5".to_string()),
                }]),
                project_path: Some("/workspace/project".to_string()),
                project_name: Some("Launch Workspace".to_string()),
                created_project_id: Some("project-123".to_string()),
                project_path_is_git: Some(true),
                language: Some(OnboardingLanguage::En),
                appearance: Some(OnboardingAppearance::Dark),
                ..Default::default()
            },
        )
        .await
        .expect("save onboarding patch");

        assert_eq!(state.current_step, OnboardingStep::ProjectPath);
        assert_eq!(state.selected_scenario, Some(OnboardingScenario::Software));
        assert_eq!(
            state.recommended_team_name.as_deref(),
            Some("Software team")
        );
        assert_eq!(
            state.team_config.as_ref().and_then(|items| items.first()),
            Some(&OnboardingTeamMemberConfig {
                member: "Lead Agent".to_string(),
                runner_type: Some("codex".to_string()),
                model_name: Some("gpt-5".to_string()),
            })
        );
        assert_eq!(state.project_path.as_deref(), Some("/workspace/project"));
        assert_eq!(state.project_name.as_deref(), Some("Launch Workspace"));
        assert_eq!(state.created_project_id.as_deref(), Some("project-123"));
        assert!(state.project_path_is_git);
        assert_eq!(state.language, Some(OnboardingLanguage::En));
        assert_eq!(state.appearance, Some(OnboardingAppearance::Dark));
    }

    #[tokio::test]
    async fn reset_onboarding_clears_guide_fields_but_preserves_upgrade_version() {
        let pool = setup_pool().await;
        OnboardingState::apply_patch(
            &pool,
            &OnboardingStatePatch {
                welcome_seen_at: Some(Utc::now()),
                onboarding_completed_at: Some(Utc::now()),
                current_step: Some(OnboardingStep::Appearance),
                selected_scenario: Some(OnboardingScenario::Research),
                recommended_team_name: Some("Research team".to_string()),
                project_path: Some("/workspace/research".to_string()),
                project_name: Some("Research Workspace".to_string()),
                created_project_id: Some("project-456".to_string()),
                project_path_is_git: Some(true),
                last_seen_upgrade_version: Some("0.0.2".to_string()),
                ..Default::default()
            },
        )
        .await
        .expect("seed onboarding state");

        let reset = OnboardingState::reset_onboarding(&pool)
            .await
            .expect("reset onboarding");

        assert_eq!(reset.current_step, OnboardingStep::Scenario);
        assert!(reset.welcome_seen_at.is_none());
        assert!(reset.onboarding_completed_at.is_none());
        assert!(reset.selected_scenario.is_none());
        assert!(reset.project_path.is_none());
        assert!(reset.project_name.is_none());
        assert!(reset.created_project_id.is_none());
        assert!(!reset.project_path_is_git);
        assert_eq!(reset.last_seen_upgrade_version.as_deref(), Some("0.0.2"));
    }
}
