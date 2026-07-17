use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "project_external_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum ProjectExternalType {
    GithubIssue,
    GithubPr,
    GithubCommit,
    GithubDeployment,
    GithubRelease,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ProjectWorkItemExternalLink {
    pub id: Uuid,
    pub project_work_item_id: Uuid,
    pub provider: String,
    pub repo_id: Option<Uuid>,
    pub external_type: ProjectExternalType,
    pub external_id: String,
    pub number: Option<i64>,
    pub url: Option<String>,
    pub state: Option<String>,
    pub metadata_json: Option<String>,
    #[ts(type = "Date | null")]
    pub last_synced_at: Option<DateTime<Utc>>,
    pub stale: bool,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateProjectWorkItemExternalLink {
    pub provider: String,
    pub repo_id: Option<Uuid>,
    pub external_type: ProjectExternalType,
    pub external_id: String,
    pub number: Option<i64>,
    pub url: Option<String>,
    pub state: Option<String>,
    pub metadata_json: Option<String>,
    #[ts(type = "Date | null")]
    pub last_synced_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub stale: bool,
}

impl ProjectWorkItemExternalLink {
    pub async fn create(
        pool: &SqlitePool,
        project_work_item_id: Uuid,
        input: CreateProjectWorkItemExternalLink,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO project_work_item_external_links (
                id, project_work_item_id, provider, repo_id, external_type, external_id,
                number, url, state, metadata_json, last_synced_at, stale
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            RETURNING id, project_work_item_id, provider, repo_id, external_type, external_id,
                      number, url, state, metadata_json, last_synced_at, stale,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(project_work_item_id)
        .bind(input.provider)
        .bind(input.repo_id)
        .bind(input.external_type)
        .bind(input.external_id)
        .bind(input.number)
        .bind(input.url)
        .bind(input.state)
        .bind(input.metadata_json)
        .bind(input.last_synced_at)
        .bind(input.stale)
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_work_item(
        pool: &SqlitePool,
        project_work_item_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT id, project_work_item_id, provider, repo_id, external_type, external_id,
                   number, url, state, metadata_json, last_synced_at, stale,
                   created_at, updated_at
            FROM project_work_item_external_links
            WHERE project_work_item_id = ?1
            ORDER BY created_at ASC
            "#,
        )
        .bind(project_work_item_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT id, project_work_item_id, provider, repo_id, external_type, external_id,
                   number, url, state, metadata_json, last_synced_at, stale,
                   created_at, updated_at
            FROM project_work_item_external_links
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_external(
        pool: &SqlitePool,
        provider: &str,
        repo_id: Option<Uuid>,
        external_type: ProjectExternalType,
        external_id: &str,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT id, project_work_item_id, provider, repo_id, external_type, external_id,
                   number, url, state, metadata_json, last_synced_at, stale,
                   created_at, updated_at
            FROM project_work_item_external_links
            WHERE provider = ?1
              AND ((repo_id IS NULL AND ?2 IS NULL) OR repo_id = ?2)
              AND external_type = ?3
              AND external_id = ?4
            "#,
        )
        .bind(provider)
        .bind(repo_id)
        .bind(external_type)
        .bind(external_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn mark_stale(
        pool: &SqlitePool,
        id: Uuid,
        stale: bool,
        state: Option<String>,
        metadata_json: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE project_work_item_external_links
            SET stale = ?2,
                state = COALESCE(?3, state),
                metadata_json = COALESCE(?4, metadata_json),
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, project_work_item_id, provider, repo_id, external_type, external_id,
                      number, url, state, metadata_json, last_synced_at, stale,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(stale)
        .bind(state)
        .bind(metadata_json)
        .fetch_one(pool)
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_cache_by_external(
        pool: &SqlitePool,
        provider: &str,
        repo_id: Option<Uuid>,
        external_type: ProjectExternalType,
        external_id: &str,
        number: Option<i64>,
        url: Option<String>,
        state: Option<String>,
        metadata_json: Option<String>,
        last_synced_at: Option<DateTime<Utc>>,
        stale: bool,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE project_work_item_external_links
            SET number = COALESCE(?5, number),
                url = COALESCE(?6, url),
                state = COALESCE(?7, state),
                metadata_json = COALESCE(?8, metadata_json),
                last_synced_at = COALESCE(?9, last_synced_at),
                stale = ?10,
                updated_at = datetime('now', 'subsec')
            WHERE provider = ?1
              AND ((repo_id IS NULL AND ?2 IS NULL) OR repo_id = ?2)
              AND external_type = ?3
              AND external_id = ?4
            RETURNING id, project_work_item_id, provider, repo_id, external_type, external_id,
                      number, url, state, metadata_json, last_synced_at, stale,
                      created_at, updated_at
            "#,
        )
        .bind(provider)
        .bind(repo_id)
        .bind(external_type)
        .bind(external_id)
        .bind(number)
        .bind(url)
        .bind(state)
        .bind(metadata_json)
        .bind(last_synced_at)
        .bind(stale)
        .fetch_optional(pool)
        .await
    }

    pub async fn mark_repo_external_type_stale(
        pool: &SqlitePool,
        provider: &str,
        repo_id: Uuid,
        external_type: ProjectExternalType,
        stale: bool,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE project_work_item_external_links
            SET stale = ?4,
                updated_at = datetime('now', 'subsec')
            WHERE provider = ?1
              AND repo_id = ?2
              AND external_type = ?3
            "#,
        )
        .bind(provider)
        .bind(repo_id)
        .bind(external_type)
        .bind(stale)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM project_work_item_external_links WHERE id = ?1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}
