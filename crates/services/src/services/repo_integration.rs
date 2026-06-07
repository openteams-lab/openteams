use std::path::PathBuf;

use anyhow::{Result, anyhow};
use db::models::{
    project::Project,
    project_repo::ProjectRepo,
    repo::Repo,
    repo_integration::{
        CreateRepoIntegration, RepoIntegration, RepoIntegrationRole, RepoIntegrationSyncStatus,
        UpdateRepoIntegration,
    },
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::SqlitePool;
use ts_rs::TS;
use uuid::Uuid;

use super::github::rest_client::GitHubRestClient;

const MAX_PROJECT_REPO_INTEGRATIONS: usize = 3;

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateProjectGitHubRepoIntegration {
    #[serde(default)]
    #[ts(optional)]
    pub repo_id: Option<Uuid>,
    #[serde(default)]
    #[ts(optional)]
    pub owner: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub full_name: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub html_url: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub clone_url: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub ssh_url: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub default_branch: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub external_id: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub installation_id: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub github_account_id: Option<String>,
    #[serde(default)]
    #[ts(optional, type = "JsonValue | null")]
    pub repo_grant_json: Option<Value>,
    #[serde(default)]
    #[ts(optional)]
    pub role: Option<RepoIntegrationRole>,
}

#[derive(Clone, Default)]
pub struct RepoIntegrationService;

impl RepoIntegrationService {
    pub fn new() -> Self {
        Self
    }

    pub async fn list_repo_integrations(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<RepoIntegration>> {
        Ok(RepoIntegration::find_by_project(pool, project_id).await?)
    }

    pub async fn get_repo_integration(
        &self,
        pool: &SqlitePool,
        repo_id: Uuid,
    ) -> Result<Vec<RepoIntegration>> {
        Ok(RepoIntegration::find_by_repo_id(pool, repo_id).await?)
    }

    pub async fn create_project_repo_integration(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        mut input: CreateRepoIntegration,
    ) -> Result<RepoIntegration> {
        if ProjectRepo::find_by_project_and_repo(pool, project_id, input.repo_id)
            .await?
            .is_none()
        {
            return Err(anyhow!("Repository does not belong to project"));
        }
        let existing = RepoIntegration::find_by_project(pool, project_id).await?;
        if existing.len() >= MAX_PROJECT_REPO_INTEGRATIONS {
            return Err(anyhow!(
                "A project can connect at most 3 GitHub repositories"
            ));
        }
        if input.role.is_none() {
            input.role = Some(if existing.is_empty() {
                RepoIntegrationRole::Primary
            } else {
                RepoIntegrationRole::Auxiliary
            });
        }
        Ok(RepoIntegration::create_with_input(pool, input).await?)
    }

    pub async fn create_project_github_repo_integration(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        input: CreateProjectGitHubRepoIntegration,
    ) -> Result<RepoIntegration> {
        let owner = normalize_optional_string(input.owner);
        let name = normalize_optional_string(input.name);
        let remote_url = normalize_optional_string(input.html_url)
            .or_else(|| normalize_optional_string(input.clone_url))
            .or_else(|| normalize_optional_string(input.ssh_url));
        let default_branch = normalize_optional_string(input.default_branch);
        let external_id = normalize_optional_string(input.external_id);
        let installation_id = normalize_optional_string(input.installation_id);
        let github_account_id = normalize_optional_string(input.github_account_id);
        let repo_grant_json = input.repo_grant_json.map(|value| value.to_string());
        let requested_role = input.role;
        let existing = RepoIntegration::find_by_project(pool, project_id).await?;
        let has_github_identity = external_id.is_some() || (owner.is_some() && name.is_some());

        let matching_existing = existing.iter().find(|integration| {
            integration.provider == "github"
                && (external_id
                    .as_deref()
                    .is_some_and(|value| integration.external_id.as_deref() == Some(value))
                    || (owner
                        .as_deref()
                        .is_some_and(|value| integration.owner.as_deref() == Some(value))
                        && name
                            .as_deref()
                            .is_some_and(|value| integration.name.as_deref() == Some(value)))
                    || (!has_github_identity && input.repo_id == Some(integration.repo_id)))
        });

        if let Some(existing_integration) = matching_existing {
            if existing_integration.sync_status == RepoIntegrationSyncStatus::Connected {
                return Err(anyhow!(
                    "GitHub repository is already connected to this project"
                ));
            }
            let reconnected = RepoIntegration::mark_connected_with_metadata(
                pool,
                existing_integration.id,
                owner.clone(),
                name.clone(),
                remote_url.clone(),
                default_branch.clone(),
                external_id.clone(),
            )
            .await?;
            let updated = RepoIntegration::update(
                pool,
                reconnected.id,
                &UpdateRepoIntegration {
                    provider: None,
                    owner: None,
                    name: None,
                    remote_url: None,
                    default_branch: None,
                    external_id: None,
                    installation_id,
                    github_account_id,
                    repo_grant_json,
                    role: requested_role,
                    sync_status: Some(RepoIntegrationSyncStatus::Connected),
                    last_synced_at: None,
                    last_error: None,
                },
            )
            .await?;
            if updated.role == RepoIntegrationRole::Primary {
                self.demote_other_project_integrations(pool, project_id, updated.id)
                    .await?;
            }
            return Ok(updated);
        }

        let connected_count = existing
            .iter()
            .filter(|integration| integration.sync_status == RepoIntegrationSyncStatus::Connected)
            .count();
        if connected_count >= MAX_PROJECT_REPO_INTEGRATIONS {
            return Err(anyhow!(
                "A project can connect at most 3 GitHub repositories"
            ));
        }

        let repo_id = match input.repo_id {
            Some(repo_id) => {
                self.ensure_project_repo_link(pool, project_id, repo_id)
                    .await?
            }
            None => {
                let owner = owner
                    .as_deref()
                    .ok_or_else(|| anyhow!("GitHub owner is required when repo_id is omitted"))?;
                let name = name.as_deref().ok_or_else(|| {
                    anyhow!("GitHub repo name is required when repo_id is omitted")
                })?;
                self.ensure_project_remote_repo(
                    pool,
                    project_id,
                    owner,
                    name,
                    input.full_name.as_deref(),
                )
                .await?
            }
        };

        let role = requested_role.or_else(|| {
            Some(if connected_count == 0 {
                RepoIntegrationRole::Primary
            } else {
                RepoIntegrationRole::Auxiliary
            })
        });
        let integration = RepoIntegration::create_with_input(
            pool,
            CreateRepoIntegration {
                repo_id,
                provider: "github".to_string(),
                owner,
                name,
                remote_url,
                default_branch,
                external_id,
                installation_id,
                github_account_id,
                repo_grant_json,
                role,
                sync_status: RepoIntegrationSyncStatus::Connected,
            },
        )
        .await?;
        if integration.role == RepoIntegrationRole::Primary {
            self.demote_other_project_integrations(pool, project_id, integration.id)
                .await?;
        }
        Ok(integration)
    }

    pub async fn update_project_repo_integration(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        repo_integration_id: Uuid,
        input: UpdateRepoIntegration,
    ) -> Result<RepoIntegration> {
        let integration = self
            .ensure_project_integration(pool, project_id, repo_integration_id)
            .await?;
        let updated = RepoIntegration::update(pool, integration.id, &input).await?;
        if updated.role == RepoIntegrationRole::Primary {
            self.demote_other_project_integrations(pool, project_id, updated.id)
                .await?;
        }
        Ok(updated)
    }

    pub async fn disconnect_project_repo_integration(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        repo_integration_id: Uuid,
        reason: Option<String>,
    ) -> Result<RepoIntegration> {
        self.ensure_project_integration(pool, project_id, repo_integration_id)
            .await?;
        Ok(RepoIntegration::mark_disconnected(pool, repo_integration_id, reason).await?)
    }

    pub async fn refresh_project_repo_integration(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        repo_integration_id: Uuid,
        client: &GitHubRestClient,
    ) -> Result<RepoIntegration> {
        let integration = self
            .ensure_project_integration(pool, project_id, repo_integration_id)
            .await?;
        let Some(owner) = integration.owner.clone() else {
            return Ok(RepoIntegration::mark_error(
                pool,
                repo_integration_id,
                "GitHub repo owner is missing".to_string(),
            )
            .await?);
        };
        let Some(name) = integration.name.clone() else {
            return Ok(RepoIntegration::mark_error(
                pool,
                repo_integration_id,
                "GitHub repo name is missing".to_string(),
            )
            .await?);
        };
        match client.repo_metadata(&owner, &name).await {
            Ok(metadata) => {
                let (metadata_owner, metadata_name) = metadata
                    .full_name
                    .split_once('/')
                    .map(|(owner, name)| (Some(owner.to_string()), Some(name.to_string())))
                    .unwrap_or((Some(owner), Some(name)));
                Ok(RepoIntegration::mark_connected_with_metadata(
                    pool,
                    repo_integration_id,
                    metadata_owner,
                    metadata_name,
                    Some(metadata.html_url),
                    Some(metadata.default_branch),
                    Some(metadata.node_id),
                )
                .await?)
            }
            Err(err) => {
                Ok(RepoIntegration::mark_error(pool, repo_integration_id, err.to_string()).await?)
            }
        }
    }

    pub async fn ensure_connected(
        &self,
        pool: &SqlitePool,
        repo_integration_id: Uuid,
    ) -> Result<RepoIntegration> {
        let integration = RepoIntegration::find_by_id(pool, repo_integration_id)
            .await?
            .ok_or_else(|| anyhow!("Repo integration not found"))?;
        if integration.sync_status != RepoIntegrationSyncStatus::Connected {
            return Err(anyhow!("github_repo_disconnected"));
        }
        Ok(integration)
    }

    pub async fn ensure_project_connected(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        repo_integration_id: Uuid,
    ) -> Result<RepoIntegration> {
        let integration = self
            .ensure_project_integration(pool, project_id, repo_integration_id)
            .await?;
        if integration.sync_status != RepoIntegrationSyncStatus::Connected {
            return Err(anyhow!("github_repo_disconnected"));
        }
        Ok(integration)
    }

    pub async fn ensure_project_integration(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        repo_integration_id: Uuid,
    ) -> Result<RepoIntegration> {
        RepoIntegration::find_by_project(pool, project_id)
            .await?
            .into_iter()
            .find(|integration| integration.id == repo_integration_id)
            .ok_or_else(|| anyhow!("Repo integration not found in project"))
    }

    async fn demote_other_project_integrations(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        primary_integration_id: Uuid,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE repo_integrations
            SET role = 'auxiliary',
                updated_at = datetime('now', 'subsec')
            WHERE id <> ?1
              AND repo_id IN (SELECT repo_id FROM project_repos WHERE project_id = ?2)
            "#,
        )
        .bind(primary_integration_id)
        .bind(project_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    async fn ensure_project_repo_link(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        repo_id: Uuid,
    ) -> Result<Uuid> {
        if ProjectRepo::find_by_project_and_repo(pool, project_id, repo_id)
            .await?
            .is_some()
        {
            return Ok(repo_id);
        }
        Repo::find_by_id(pool, repo_id)
            .await?
            .ok_or_else(|| anyhow!("Repository not found"))?;
        ProjectRepo::create(pool, project_id, repo_id).await?;
        Ok(repo_id)
    }

    async fn ensure_project_remote_repo(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        owner: &str,
        name: &str,
        full_name: Option<&str>,
    ) -> Result<Uuid> {
        let display_name = full_name
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("{owner}/{name}"));
        if let Some(project) = Project::find_by_id(pool, project_id).await? {
            if let Some(repo_id) = project.active_repo_id {
                return self
                    .ensure_project_repo_link(pool, project_id, repo_id)
                    .await;
            }
            if let Some(workspace_path) = normalize_optional_string(project.default_workspace_path)
            {
                let workspace_path = PathBuf::from(workspace_path);
                let repo = Repo::find_or_create(pool, &workspace_path, &display_name).await?;
                if ProjectRepo::find_by_project_and_repo(pool, project_id, repo.id)
                    .await?
                    .is_none()
                {
                    ProjectRepo::create(pool, project_id, repo.id).await?;
                }
                return Ok(repo.id);
            }
        }

        let path = github_remote_repo_path(owner, name);
        let repo = Repo::find_or_create(pool, &path, &display_name).await?;
        if ProjectRepo::find_by_project_and_repo(pool, project_id, repo.id)
            .await?
            .is_none()
        {
            ProjectRepo::create(pool, project_id, repo.id).await?;
        }
        Ok(repo.id)
    }
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn github_remote_repo_path(owner: &str, name: &str) -> PathBuf {
    PathBuf::from(".openteams")
        .join("github-remotes")
        .join(owner)
        .join(name)
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::{
        project_repo::ProjectRepo,
        repo::Repo,
        repo_integration::{
            CreateRepoIntegration, RepoIntegration, RepoIntegrationRole, RepoIntegrationSyncStatus,
        },
    };
    use secrecy::SecretString;
    use serde_json::json;
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::RepoIntegrationService;
    use crate::services::github::rest_client::GitHubRestClient;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");

        for statement in [
            r#"
            CREATE TABLE projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                default_agent_working_dir TEXT,
                remote_project_id TEXT,
                description TEXT,
                status TEXT,
                default_workspace_path TEXT,
                active_repo_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE repos (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                display_name TEXT NOT NULL,
                setup_script TEXT,
                cleanup_script TEXT,
                archive_script TEXT,
                copy_files TEXT,
                parallel_setup_script BOOLEAN NOT NULL DEFAULT 0,
                dev_server_script TEXT,
                default_target_branch TEXT,
                default_working_dir TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE project_repos (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                repo_id TEXT NOT NULL
            )
            "#,
            r#"
            CREATE TABLE repo_integrations (
                id TEXT PRIMARY KEY,
                repo_id TEXT,
                provider TEXT NOT NULL,
                owner TEXT,
                name TEXT,
                remote_url TEXT,
                default_branch TEXT,
                external_id TEXT,
                installation_id TEXT,
                github_account_id TEXT,
                repo_grant_json TEXT,
                role TEXT,
                sync_status TEXT,
                last_synced_at TEXT,
                last_error TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create minimal repo integration schema");
        }

        pool
    }

    async fn link_repo(pool: &SqlitePool, project_id: Uuid, repo_id: Uuid) {
        sqlx::query("INSERT INTO project_repos (id, project_id, repo_id) VALUES (?1, ?2, ?3)")
            .bind(Uuid::new_v4())
            .bind(project_id)
            .bind(repo_id)
            .execute(pool)
            .await
            .expect("insert project repo");
    }

    #[tokio::test]
    async fn lists_integrations_by_project_join() {
        let pool = setup_pool().await;
        let service = RepoIntegrationService::new();
        let project_id = Uuid::new_v4();
        let repo_id = Uuid::new_v4();
        link_repo(&pool, project_id, repo_id).await;
        RepoIntegration::create(
            &pool,
            repo_id,
            "github".to_string(),
            Some("owner".to_string()),
            Some("repo".to_string()),
            None,
            Some("main".to_string()),
            None,
            None,
            Some("connected".to_string()),
            Some(Utc::now()),
        )
        .await
        .expect("create repo integration");

        let integrations = service
            .list_repo_integrations(&pool, project_id)
            .await
            .expect("list integrations");

        assert_eq!(integrations.len(), 1);
        assert_eq!(integrations[0].provider, "github");
        assert_eq!(
            integrations[0].sync_status,
            RepoIntegrationSyncStatus::Connected
        );
    }

    #[tokio::test]
    async fn create_rejects_more_than_three_project_integrations() {
        let pool = setup_pool().await;
        let service = RepoIntegrationService::new();
        let project_id = Uuid::new_v4();
        for idx in 0..3 {
            let repo_id = Uuid::new_v4();
            link_repo(&pool, project_id, repo_id).await;
            service
                .create_project_repo_integration(
                    &pool,
                    project_id,
                    CreateRepoIntegration {
                        repo_id,
                        provider: "github".to_string(),
                        owner: Some("owner".to_string()),
                        name: Some(format!("repo-{idx}")),
                        remote_url: None,
                        default_branch: Some("main".to_string()),
                        external_id: None,
                        installation_id: None,
                        github_account_id: None,
                        repo_grant_json: None,
                        role: None,
                        sync_status: RepoIntegrationSyncStatus::Connected,
                    },
                )
                .await
                .expect("create repo integration");
        }

        let repo_id = Uuid::new_v4();
        link_repo(&pool, project_id, repo_id).await;
        let fourth = service
            .create_project_repo_integration(
                &pool,
                project_id,
                CreateRepoIntegration {
                    repo_id,
                    provider: "github".to_string(),
                    owner: Some("owner".to_string()),
                    name: Some("repo-4".to_string()),
                    remote_url: None,
                    default_branch: Some("main".to_string()),
                    external_id: None,
                    installation_id: None,
                    github_account_id: None,
                    repo_grant_json: None,
                    role: None,
                    sync_status: RepoIntegrationSyncStatus::Connected,
                },
            )
            .await;

        assert!(fourth.is_err());
    }

    #[tokio::test]
    async fn create_github_integration_auto_creates_project_repo_without_local_repo_id() {
        let pool = setup_pool().await;
        let service = RepoIntegrationService::new();
        let project_id = Uuid::new_v4();
        let workspace_path = "E:/workspace/projectSS/openteams-refactor-restored";
        sqlx::query("INSERT INTO projects (id, name, default_workspace_path) VALUES (?1, ?2, ?3)")
            .bind(project_id)
            .bind("OpenTeams")
            .bind(workspace_path)
            .execute(&pool)
            .await
            .expect("insert project with workspace path");

        let integration = service
            .create_project_github_repo_integration(
                &pool,
                project_id,
                super::CreateProjectGitHubRepoIntegration {
                    repo_id: None,
                    owner: Some("octo-org".to_string()),
                    name: Some("hello-world".to_string()),
                    full_name: Some("octo-org/hello-world".to_string()),
                    html_url: Some("https://github.com/octo-org/hello-world".to_string()),
                    clone_url: Some("https://github.com/octo-org/hello-world.git".to_string()),
                    ssh_url: Some("git@github.com:octo-org/hello-world.git".to_string()),
                    default_branch: Some("main".to_string()),
                    external_id: Some("R_kgDOExample".to_string()),
                    installation_id: None,
                    github_account_id: Some("12345".to_string()),
                    repo_grant_json: Some(json!({"permissions":["metadata","issues"]})),
                    role: None,
                },
            )
            .await
            .expect("auto-create github integration");

        assert_eq!(integration.provider, "github");
        assert_eq!(integration.owner.as_deref(), Some("octo-org"));
        assert_eq!(integration.name.as_deref(), Some("hello-world"));
        assert_eq!(
            integration.remote_url.as_deref(),
            Some("https://github.com/octo-org/hello-world")
        );
        assert_eq!(
            integration.sync_status,
            RepoIntegrationSyncStatus::Connected
        );
        assert_eq!(integration.role, RepoIntegrationRole::Primary);
        assert!(
            integration
                .repo_grant_json
                .as_deref()
                .unwrap_or_default()
                .contains("metadata")
        );

        let project_repo =
            ProjectRepo::find_by_project_and_repo(&pool, project_id, integration.repo_id)
                .await
                .expect("query project repo");
        assert!(project_repo.is_some());
        let repo = Repo::find_by_id(&pool, integration.repo_id)
            .await
            .expect("query repo")
            .expect("repo exists");
        assert_eq!(repo.display_name, "octo-org/hello-world");
        assert_eq!(repo.path.to_string_lossy(), workspace_path);
    }

    #[tokio::test]
    async fn create_github_integration_allows_new_repo_after_disconnect() {
        let pool = setup_pool().await;
        let service = RepoIntegrationService::new();
        let project_id = Uuid::new_v4();
        let workspace_path = "E:/workspace/projectSS/openteams-refactor-restored";
        sqlx::query("INSERT INTO projects (id, name, default_workspace_path) VALUES (?1, ?2, ?3)")
            .bind(project_id)
            .bind("OpenTeams")
            .bind(workspace_path)
            .execute(&pool)
            .await
            .expect("insert project with workspace path");

        let first = service
            .create_project_github_repo_integration(
                &pool,
                project_id,
                super::CreateProjectGitHubRepoIntegration {
                    repo_id: None,
                    owner: Some("octo-org".to_string()),
                    name: Some("first".to_string()),
                    full_name: Some("octo-org/first".to_string()),
                    html_url: Some("https://github.com/octo-org/first".to_string()),
                    clone_url: None,
                    ssh_url: None,
                    default_branch: Some("main".to_string()),
                    external_id: Some("R_first".to_string()),
                    installation_id: None,
                    github_account_id: Some("12345".to_string()),
                    repo_grant_json: Some(json!({"permissions":["metadata","issues"]})),
                    role: None,
                },
            )
            .await
            .expect("create first integration");
        service
            .disconnect_project_repo_integration(
                &pool,
                project_id,
                first.id,
                Some("test disconnect".to_string()),
            )
            .await
            .expect("disconnect first integration");

        let second = service
            .create_project_github_repo_integration(
                &pool,
                project_id,
                super::CreateProjectGitHubRepoIntegration {
                    repo_id: None,
                    owner: Some("octo-org".to_string()),
                    name: Some("second".to_string()),
                    full_name: Some("octo-org/second".to_string()),
                    html_url: Some("https://github.com/octo-org/second".to_string()),
                    clone_url: None,
                    ssh_url: None,
                    default_branch: Some("main".to_string()),
                    external_id: Some("R_second".to_string()),
                    installation_id: None,
                    github_account_id: Some("12345".to_string()),
                    repo_grant_json: Some(json!({"permissions":["metadata","issues"]})),
                    role: None,
                },
            )
            .await
            .expect("create second integration after disconnect");

        assert_ne!(second.id, first.id);
        assert_eq!(second.name.as_deref(), Some("second"));
        assert_eq!(second.sync_status, RepoIntegrationSyncStatus::Connected);

        let integrations = service
            .list_repo_integrations(&pool, project_id)
            .await
            .expect("list integrations");
        assert_eq!(
            integrations
                .iter()
                .filter(|row| row.sync_status == RepoIntegrationSyncStatus::Connected)
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn ensure_connected_rejects_error_status() {
        let pool = setup_pool().await;
        let service = RepoIntegrationService::new();
        let repo_id = Uuid::new_v4();
        let integration = RepoIntegration::create(
            &pool,
            repo_id,
            "github".to_string(),
            Some("owner".to_string()),
            Some("repo".to_string()),
            None,
            Some("main".to_string()),
            None,
            None,
            Some("error".to_string()),
            Some(Utc::now()),
        )
        .await
        .expect("create repo integration");

        let result = service.ensure_connected(&pool, integration.id).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn github_repo_refresh_marks_error_when_metadata_fetch_fails() {
        let pool = setup_pool().await;
        let service = RepoIntegrationService::new();
        let project_id = Uuid::new_v4();
        let repo_id = Uuid::new_v4();
        link_repo(&pool, project_id, repo_id).await;
        let integration = RepoIntegration::create(
            &pool,
            repo_id,
            "github".to_string(),
            Some("owner".to_string()),
            Some("repo".to_string()),
            None,
            Some("main".to_string()),
            None,
            None,
            Some("connected".to_string()),
            Some(Utc::now()),
        )
        .await
        .expect("create repo integration");
        let client = GitHubRestClient::new_with_base_url(
            SecretString::from("unused".to_string()),
            "http://127.0.0.1:1",
        );

        let refreshed = service
            .refresh_project_repo_integration(&pool, project_id, integration.id, &client)
            .await
            .expect("refresh returns persisted error state");

        assert_eq!(refreshed.sync_status, RepoIntegrationSyncStatus::Error);
        assert!(refreshed.last_error.is_some());
    }
}
