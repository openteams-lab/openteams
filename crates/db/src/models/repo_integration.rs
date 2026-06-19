use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "repo_integration_sync_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum RepoIntegrationSyncStatus {
    Connected,
    Disconnected,
    Error,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "repo_integration_role", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum RepoIntegrationRole {
    Primary,
    Auxiliary,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct RepoIntegration {
    pub id: Uuid,
    pub repo_id: Uuid,
    pub provider: String,
    pub owner: Option<String>,
    pub name: Option<String>,
    pub remote_url: Option<String>,
    pub default_branch: Option<String>,
    pub external_id: Option<String>,
    pub installation_id: Option<String>,
    pub github_account_id: Option<String>,
    pub repo_grant_json: Option<String>,
    pub role: RepoIntegrationRole,
    pub sync_status: RepoIntegrationSyncStatus,
    #[ts(type = "Date | null")]
    pub last_synced_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UpdateRepoIntegration {
    pub provider: Option<String>,
    pub owner: Option<String>,
    pub name: Option<String>,
    pub remote_url: Option<String>,
    pub default_branch: Option<String>,
    pub external_id: Option<String>,
    pub installation_id: Option<String>,
    pub github_account_id: Option<String>,
    pub repo_grant_json: Option<String>,
    pub role: Option<RepoIntegrationRole>,
    pub sync_status: Option<RepoIntegrationSyncStatus>,
    #[ts(type = "Date | null")]
    pub last_synced_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateRepoIntegration {
    pub repo_id: Uuid,
    pub provider: String,
    pub owner: Option<String>,
    pub name: Option<String>,
    pub remote_url: Option<String>,
    pub default_branch: Option<String>,
    pub external_id: Option<String>,
    pub installation_id: Option<String>,
    pub github_account_id: Option<String>,
    pub repo_grant_json: Option<String>,
    pub role: Option<RepoIntegrationRole>,
    pub sync_status: RepoIntegrationSyncStatus,
}

impl RepoIntegration {
    fn select_sql() -> &'static str {
        r#"
        SELECT id, repo_id, provider, owner, name, remote_url, default_branch, external_id,
               installation_id, github_account_id, repo_grant_json,
               COALESCE(role, 'primary') AS role,
               COALESCE(NULLIF(sync_status, 'synced'), 'connected') AS sync_status,
               last_synced_at, last_error, created_at, updated_at
        FROM repo_integrations
        "#
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!("{} WHERE id = ?1", Self::select_sql()))
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_repo_id(
        pool: &SqlitePool,
        repo_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{} WHERE repo_id = ?1 ORDER BY provider ASC, created_at ASC",
            Self::select_sql()
        ))
        .bind(repo_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_project(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT ri.id, ri.repo_id, ri.provider, ri.owner, ri.name, ri.remote_url,
                   ri.default_branch, ri.external_id, ri.installation_id, ri.github_account_id,
                   ri.repo_grant_json,
                   COALESCE(ri.role, 'primary') AS role,
                   COALESCE(NULLIF(ri.sync_status, 'synced'), 'connected') AS sync_status,
                   ri.last_synced_at, ri.last_error, ri.created_at, ri.updated_at
            FROM repo_integrations ri
            INNER JOIN project_repos pr ON pr.repo_id = ri.repo_id
            WHERE pr.project_id = ?1
            ORDER BY ri.provider ASC, ri.created_at ASC
            "#,
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create_with_input(
        pool: &SqlitePool,
        input: CreateRepoIntegration,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO repo_integrations (
                id, repo_id, provider, owner, name, remote_url, default_branch, external_id,
                installation_id, github_account_id, repo_grant_json, role, sync_status, last_synced_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, datetime('now', 'subsec'))
            RETURNING id, repo_id, provider, owner, name, remote_url, default_branch, external_id,
                      installation_id, github_account_id, repo_grant_json, role, sync_status,
                      last_synced_at, last_error, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(input.repo_id)
        .bind(input.provider)
        .bind(input.owner)
        .bind(input.name)
        .bind(input.remote_url)
        .bind(input.default_branch)
        .bind(input.external_id)
        .bind(input.installation_id)
        .bind(input.github_account_id)
        .bind(input.repo_grant_json)
        .bind(input.role.unwrap_or(RepoIntegrationRole::Primary))
        .bind(input.sync_status)
        .fetch_one(pool)
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create(
        pool: &SqlitePool,
        repo_id: Uuid,
        provider: String,
        owner: Option<String>,
        name: Option<String>,
        remote_url: Option<String>,
        default_branch: Option<String>,
        external_id: Option<String>,
        installation_id: Option<String>,
        sync_status: Option<String>,
        last_synced_at: Option<DateTime<Utc>>,
    ) -> Result<Self, sqlx::Error> {
        let status = match sync_status.as_deref() {
            Some("disconnected") => RepoIntegrationSyncStatus::Disconnected,
            Some("error") => RepoIntegrationSyncStatus::Error,
            _ => RepoIntegrationSyncStatus::Connected,
        };
        let mut row = Self::create_with_input(
            pool,
            CreateRepoIntegration {
                repo_id,
                provider,
                owner,
                name,
                remote_url,
                default_branch,
                external_id,
                installation_id,
                github_account_id: None,
                repo_grant_json: None,
                role: None,
                sync_status: status,
            },
        )
        .await?;
        if let Some(last_synced_at) = last_synced_at {
            row = Self::update(
                pool,
                row.id,
                &UpdateRepoIntegration {
                    provider: None,
                    owner: None,
                    name: None,
                    remote_url: None,
                    default_branch: None,
                    external_id: None,
                    installation_id: None,
                    github_account_id: None,
                    repo_grant_json: None,
                    role: None,
                    sync_status: None,
                    last_synced_at: Some(last_synced_at),
                    last_error: None,
                },
            )
            .await?;
        }
        Ok(row)
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        data: &UpdateRepoIntegration,
    ) -> Result<Self, sqlx::Error> {
        let existing = Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        sqlx::query_as::<_, Self>(
            r#"
            UPDATE repo_integrations
            SET provider = ?2,
                owner = ?3,
                name = ?4,
                remote_url = ?5,
                default_branch = ?6,
                external_id = ?7,
                installation_id = ?8,
                github_account_id = ?9,
                repo_grant_json = ?10,
                role = ?11,
                sync_status = ?12,
                last_synced_at = ?13,
                last_error = ?14,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, repo_id, provider, owner, name, remote_url, default_branch, external_id,
                      installation_id, github_account_id, repo_grant_json, role, sync_status,
                      last_synced_at, last_error, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(data.provider.clone().unwrap_or(existing.provider))
        .bind(data.owner.clone().or(existing.owner))
        .bind(data.name.clone().or(existing.name))
        .bind(data.remote_url.clone().or(existing.remote_url))
        .bind(data.default_branch.clone().or(existing.default_branch))
        .bind(data.external_id.clone().or(existing.external_id))
        .bind(data.installation_id.clone().or(existing.installation_id))
        .bind(
            data.github_account_id
                .clone()
                .or(existing.github_account_id),
        )
        .bind(data.repo_grant_json.clone().or(existing.repo_grant_json))
        .bind(data.role.clone().unwrap_or(existing.role))
        .bind(data.sync_status.clone().unwrap_or(existing.sync_status))
        .bind(data.last_synced_at.or(existing.last_synced_at))
        .bind(data.last_error.clone().or(existing.last_error))
        .fetch_one(pool)
        .await
    }

    pub async fn mark_disconnected(
        pool: &SqlitePool,
        id: Uuid,
        last_error: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        Self::update(
            pool,
            id,
            &UpdateRepoIntegration {
                provider: None,
                owner: None,
                name: None,
                remote_url: None,
                default_branch: None,
                external_id: None,
                installation_id: None,
                github_account_id: None,
                repo_grant_json: None,
                role: None,
                sync_status: Some(RepoIntegrationSyncStatus::Disconnected),
                last_synced_at: Some(Utc::now()),
                last_error,
            },
        )
        .await
    }

    pub async fn mark_connected_with_metadata(
        pool: &SqlitePool,
        id: Uuid,
        owner: Option<String>,
        name: Option<String>,
        remote_url: Option<String>,
        default_branch: Option<String>,
        external_id: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE repo_integrations
            SET owner = COALESCE(?2, owner),
                name = COALESCE(?3, name),
                remote_url = COALESCE(?4, remote_url),
                default_branch = COALESCE(?5, default_branch),
                external_id = COALESCE(?6, external_id),
                sync_status = 'connected',
                last_synced_at = datetime('now', 'subsec'),
                last_error = NULL,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, repo_id, provider, owner, name, remote_url, default_branch, external_id,
                      installation_id, github_account_id, repo_grant_json, role, sync_status,
                      last_synced_at, last_error, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(owner)
        .bind(name)
        .bind(remote_url)
        .bind(default_branch)
        .bind(external_id)
        .fetch_one(pool)
        .await
    }

    pub async fn mark_error(
        pool: &SqlitePool,
        id: Uuid,
        last_error: String,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE repo_integrations
            SET sync_status = 'error',
                last_synced_at = datetime('now', 'subsec'),
                last_error = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, repo_id, provider, owner, name, remote_url, default_branch, external_id,
                      installation_id, github_account_id, repo_grant_json, role, sync_status,
                      last_synced_at, last_error, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(last_error)
        .fetch_one(pool)
        .await
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM repo_integrations WHERE id = ?1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}
