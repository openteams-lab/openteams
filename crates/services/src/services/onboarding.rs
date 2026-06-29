use chrono::Utc;
use db::models::onboarding_state::{
    MarkUpgradeReadRequest, OnboardingState, OnboardingStateError, OnboardingStatePatch,
    OnboardingStep, OnboardingTeamMemberConfig, UpdateOnboardingStateRequest,
};
use sqlx::SqlitePool;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum OnboardingServiceError {
    #[error(transparent)]
    State(#[from] OnboardingStateError),
    #[error("Invalid onboarding state: {0}")]
    Validation(String),
}

#[derive(Debug, Clone, Default)]
pub struct OnboardingService;

impl OnboardingService {
    pub fn new() -> Self {
        Self
    }

    pub async fn get_state(
        &self,
        pool: &SqlitePool,
    ) -> Result<OnboardingState, OnboardingServiceError> {
        Ok(OnboardingState::get_or_create(pool).await?)
    }

    pub async fn update_state(
        &self,
        pool: &SqlitePool,
        request: UpdateOnboardingStateRequest,
        project_path_is_git: Option<bool>,
    ) -> Result<OnboardingState, OnboardingServiceError> {
        let patch = patch_from_request(request, project_path_is_git);
        Ok(OnboardingState::apply_patch(pool, &patch).await?)
    }

    pub async fn complete(
        &self,
        pool: &SqlitePool,
        request: UpdateOnboardingStateRequest,
        project_path_is_git: Option<bool>,
    ) -> Result<OnboardingState, OnboardingServiceError> {
        let now = Utc::now();
        let mut patch = patch_from_request(request, project_path_is_git);
        if patch.welcome_seen_at.is_none() {
            patch.welcome_seen_at = Some(now);
        }
        patch.onboarding_completed_at = Some(now);
        if patch.current_step.is_none() {
            patch.current_step = Some(OnboardingStep::Appearance);
        }
        Ok(OnboardingState::apply_patch(pool, &patch).await?)
    }

    pub async fn reset(
        &self,
        pool: &SqlitePool,
    ) -> Result<OnboardingState, OnboardingServiceError> {
        Ok(OnboardingState::reset_onboarding(pool).await?)
    }

    pub async fn mark_upgrade_read(
        &self,
        pool: &SqlitePool,
        request: MarkUpgradeReadRequest,
    ) -> Result<OnboardingState, OnboardingServiceError> {
        let version = request.version.trim();
        if version.is_empty() {
            return Err(OnboardingServiceError::Validation(
                "upgrade version is required".to_string(),
            ));
        }

        Ok(OnboardingState::apply_patch(
            pool,
            &OnboardingStatePatch {
                last_seen_upgrade_version: Some(version.to_string()),
                ..Default::default()
            },
        )
        .await?)
    }

    pub async fn reset_upgrade_read(
        &self,
        pool: &SqlitePool,
    ) -> Result<OnboardingState, OnboardingServiceError> {
        Ok(OnboardingState::reset_upgrade_read(pool).await?)
    }
}

fn patch_from_request(
    request: UpdateOnboardingStateRequest,
    project_path_is_git: Option<bool>,
) -> OnboardingStatePatch {
    OnboardingStatePatch {
        welcome_seen_at: request.welcome_seen.and_then(|seen| seen.then(Utc::now)),
        current_step: request.current_step,
        selected_scenario: request.selected_scenario,
        recommended_team_name: trim_optional(request.recommended_team_name),
        team_config: request.team_config.map(normalize_team_config),
        project_path: trim_optional(request.project_path),
        project_name: trim_optional(request.project_name),
        created_project_id: trim_optional(request.created_project_id),
        project_path_is_git,
        language: request.language,
        appearance: request.appearance,
        ..Default::default()
    }
}

fn normalize_team_config(
    members: Vec<OnboardingTeamMemberConfig>,
) -> Vec<OnboardingTeamMemberConfig> {
    members
        .into_iter()
        .map(|member| OnboardingTeamMemberConfig {
            member: member.member.trim().to_string(),
            runner_type: trim_optional(member.runner_type),
            model_name: trim_optional(member.model_name),
        })
        .filter(|member| !member.member.is_empty())
        .collect()
}

fn trim_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use db::models::onboarding_state::{
        MarkUpgradeReadRequest, OnboardingAppearance, OnboardingScenario, OnboardingState,
        OnboardingStatePatch, OnboardingStep, OnboardingTeamMemberConfig,
        UpdateOnboardingStateRequest,
    };
    use sqlx::{Row, SqlitePool};
    use uuid::Uuid;

    use super::OnboardingService;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::raw_sql(include_str!(
            "../../../db/migrations/20260629090000_create_onboarding_state.sql"
        ))
        .execute(&pool)
        .await
        .expect("create onboarding_state table");
        sqlx::raw_sql(include_str!(
            "../../../db/migrations/20260629142000_extend_onboarding_project_fields.sql"
        ))
        .execute(&pool)
        .await
        .expect("extend onboarding_state table");
        pool
    }

    #[tokio::test]
    async fn first_state_is_default_scenario_step() {
        let pool = setup_pool().await;
        let service = OnboardingService::new();

        let state = service.get_state(&pool).await.expect("get state");

        assert_eq!(state.current_step, OnboardingStep::Scenario);
        assert!(state.welcome_seen_at.is_none());
        assert!(state.onboarding_completed_at.is_none());
        assert!(state.project_path.is_none());
    }

    #[tokio::test]
    async fn update_and_complete_save_progress() {
        let pool = setup_pool().await;
        let service = OnboardingService::new();

        let updated = service
            .update_state(
                &pool,
                UpdateOnboardingStateRequest {
                    welcome_seen: Some(true),
                    current_step: Some(OnboardingStep::Executor),
                    selected_scenario: Some(OnboardingScenario::Software),
                    recommended_team_name: Some(" Software team ".to_string()),
                    team_config: Some(vec![OnboardingTeamMemberConfig {
                        member: " Lead Agent ".to_string(),
                        runner_type: Some(" codex ".to_string()),
                        model_name: Some(" gpt-5 ".to_string()),
                    }]),
                    project_name: Some(" Onboarding Project ".to_string()),
                    appearance: Some(OnboardingAppearance::System),
                    ..Default::default()
                },
                None,
            )
            .await
            .expect("update state");

        assert!(updated.welcome_seen_at.is_some());
        assert_eq!(updated.current_step, OnboardingStep::Executor);
        assert_eq!(
            updated.recommended_team_name.as_deref(),
            Some("Software team")
        );
        assert_eq!(updated.project_name.as_deref(), Some("Onboarding Project"));
        assert_eq!(
            updated
                .team_config
                .as_ref()
                .and_then(|members| members.first())
                .map(|member| member.member.as_str()),
            Some("Lead Agent")
        );

        let completed = service
            .complete(
                &pool,
                UpdateOnboardingStateRequest {
                    created_project_id: Some(" project-123 ".to_string()),
                    ..Default::default()
                },
                None,
            )
            .await
            .expect("complete onboarding");

        assert!(completed.onboarding_completed_at.is_some());
        assert_eq!(completed.current_step, OnboardingStep::Appearance);
        assert_eq!(
            completed.project_name.as_deref(),
            Some("Onboarding Project")
        );
        assert_eq!(completed.created_project_id.as_deref(), Some("project-123"));
    }

    #[tokio::test]
    async fn reset_only_clears_onboarding_state() {
        let pool = setup_pool().await;
        sqlx::query("CREATE TABLE projects (id BLOB PRIMARY KEY, name TEXT NOT NULL)")
            .execute(&pool)
            .await
            .expect("create projects table");
        let project_id = Uuid::new_v4();
        sqlx::query("INSERT INTO projects (id, name) VALUES (?1, ?2)")
            .bind(project_id)
            .bind("Business project")
            .execute(&pool)
            .await
            .expect("insert project");

        OnboardingState::apply_patch(
            &pool,
            &OnboardingStatePatch {
                welcome_seen_at: Some(chrono::Utc::now()),
                onboarding_completed_at: Some(chrono::Utc::now()),
                current_step: Some(OnboardingStep::Appearance),
                selected_scenario: Some(OnboardingScenario::Design),
                recommended_team_name: Some("Design team".to_string()),
                project_path: Some("/workspace/design".to_string()),
                project_name: Some("Design Workspace".to_string()),
                created_project_id: Some("project-456".to_string()),
                project_path_is_git: Some(true),
                last_seen_upgrade_version: Some("0.0.2".to_string()),
                ..Default::default()
            },
        )
        .await
        .expect("seed onboarding state");

        let reset = OnboardingService::new()
            .reset(&pool)
            .await
            .expect("reset onboarding");

        let (project_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM projects")
            .fetch_one(&pool)
            .await
            .expect("count projects");
        let row = sqlx::query("SELECT name FROM projects WHERE id = ?1")
            .bind(project_id)
            .fetch_one(&pool)
            .await
            .expect("project still exists");

        assert_eq!(reset.current_step, OnboardingStep::Scenario);
        assert!(reset.onboarding_completed_at.is_none());
        assert!(reset.project_path.is_none());
        assert!(reset.project_name.is_none());
        assert!(reset.created_project_id.is_none());
        assert_eq!(project_count, 1);
        assert_eq!(row.get::<String, _>("name"), "Business project");
        assert_eq!(reset.last_seen_upgrade_version.as_deref(), Some("0.0.2"));
    }

    #[tokio::test]
    async fn upgrade_read_and_reset_update_only_seen_version() {
        let pool = setup_pool().await;
        let service = OnboardingService::new();

        let read = service
            .mark_upgrade_read(
                &pool,
                MarkUpgradeReadRequest {
                    version: " 0.0.2 ".to_string(),
                },
            )
            .await
            .expect("mark upgrade read");
        assert_eq!(read.last_seen_upgrade_version.as_deref(), Some("0.0.2"));

        let reset = service
            .reset_upgrade_read(&pool)
            .await
            .expect("reset upgrade read");
        assert!(reset.last_seen_upgrade_version.is_none());
        assert_eq!(reset.current_step, OnboardingStep::Scenario);
    }

    #[tokio::test]
    async fn project_path_git_state_is_saved_with_path() {
        let pool = setup_pool().await;
        let service = OnboardingService::new();

        let state = service
            .update_state(
                &pool,
                UpdateOnboardingStateRequest {
                    current_step: Some(OnboardingStep::ProjectPath),
                    project_path: Some(" /workspace/repo ".to_string()),
                    ..Default::default()
                },
                Some(true),
            )
            .await
            .expect("save project path");

        assert_eq!(state.current_step, OnboardingStep::ProjectPath);
        assert_eq!(state.project_path.as_deref(), Some("/workspace/repo"));
        assert!(state.project_path_is_git);
    }
}
