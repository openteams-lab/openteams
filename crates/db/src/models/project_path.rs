use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "project_path_kind", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum ProjectPathKind {
    Workspace,
    Artifact,
    External,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ProjectPath {
    pub id: Uuid,
    pub project_id: Uuid,
    pub path: String,
    pub label: Option<String>,
    pub kind: ProjectPathKind,
    pub is_default: bool,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateProjectPath {
    pub path: String,
    pub label: Option<String>,
    pub kind: ProjectPathKind,
    pub is_default: bool,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UpdateProjectPath {
    pub path: Option<String>,
    pub label: Option<String>,
    pub kind: Option<ProjectPathKind>,
    pub is_default: Option<bool>,
}

impl ProjectPath {
    pub async fn find_by_project(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ProjectPath,
            r#"SELECT id as "id!: Uuid",
                      project_id as "project_id!: Uuid",
                      path,
                      label,
                      kind as "kind!: ProjectPathKind",
                      is_default as "is_default!: bool",
                      created_at as "created_at!: DateTime<Utc>",
                      updated_at as "updated_at!: DateTime<Utc>"
               FROM project_paths
               WHERE project_id = $1
               ORDER BY is_default DESC, created_at ASC"#,
            project_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_default(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            ProjectPath,
            r#"SELECT id as "id!: Uuid",
                      project_id as "project_id!: Uuid",
                      path,
                      label,
                      kind as "kind!: ProjectPathKind",
                      is_default as "is_default!: bool",
                      created_at as "created_at!: DateTime<Utc>",
                      updated_at as "updated_at!: DateTime<Utc>"
               FROM project_paths
               WHERE project_id = $1
                 AND is_default = 1
               ORDER BY created_at ASC
               LIMIT 1"#,
            project_id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        project_id: Uuid,
        path: String,
        label: Option<String>,
        kind: ProjectPathKind,
        is_default: bool,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();

        sqlx::query_as!(
            ProjectPath,
            r#"INSERT INTO project_paths (id, project_id, path, label, kind, is_default)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id as "id!: Uuid",
                         project_id as "project_id!: Uuid",
                         path,
                         label,
                         kind as "kind!: ProjectPathKind",
                         is_default as "is_default!: bool",
                         created_at as "created_at!: DateTime<Utc>",
                         updated_at as "updated_at!: DateTime<Utc>""#,
            id,
            project_id,
            path,
            label,
            kind,
            is_default
        )
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        data: &UpdateProjectPath,
    ) -> Result<Self, sqlx::Error> {
        let existing = sqlx::query_as!(
            ProjectPath,
            r#"SELECT id as "id!: Uuid",
                      project_id as "project_id!: Uuid",
                      path,
                      label,
                      kind as "kind!: ProjectPathKind",
                      is_default as "is_default!: bool",
                      created_at as "created_at!: DateTime<Utc>",
                      updated_at as "updated_at!: DateTime<Utc>"
               FROM project_paths
               WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;

        let path = data.path.clone().unwrap_or(existing.path);
        let label = data.label.clone().or(existing.label);
        let kind = data.kind.clone().unwrap_or(existing.kind);
        let is_default = data.is_default.unwrap_or(existing.is_default);

        sqlx::query_as!(
            ProjectPath,
            r#"UPDATE project_paths
               SET path = $2,
                   label = $3,
                   kind = $4,
                   is_default = $5,
                   updated_at = datetime('now', 'subsec')
               WHERE id = $1
               RETURNING id as "id!: Uuid",
                         project_id as "project_id!: Uuid",
                         path,
                         label,
                         kind as "kind!: ProjectPathKind",
                         is_default as "is_default!: bool",
                         created_at as "created_at!: DateTime<Utc>",
                         updated_at as "updated_at!: DateTime<Utc>""#,
            id,
            path,
            label,
            kind,
            is_default
        )
        .fetch_one(pool)
        .await
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM project_paths WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::{ProjectPath, ProjectPathKind, UpdateProjectPath};

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");

        sqlx::query(
            r#"
            CREATE TABLE project_paths (
                id BLOB PRIMARY KEY,
                project_id BLOB,
                path TEXT NOT NULL,
                label TEXT,
                kind TEXT CHECK (kind IN ('workspace', 'artifact', 'external')),
                is_default BOOLEAN DEFAULT false,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create project_paths table");

        pool
    }

    #[tokio::test]
    async fn crud_and_default_path_lookup_work() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();

        let default_path = ProjectPath::create(
            &pool,
            project_id,
            "/workspace".to_string(),
            Some("Workspace".to_string()),
            ProjectPathKind::Workspace,
            true,
        )
        .await
        .expect("create default path");
        let artifact_path = ProjectPath::create(
            &pool,
            project_id,
            "/artifacts".to_string(),
            Some("Artifacts".to_string()),
            ProjectPathKind::Artifact,
            false,
        )
        .await
        .expect("create artifact path");

        let paths = ProjectPath::find_by_project(&pool, project_id)
            .await
            .expect("list paths");
        assert_eq!(paths.len(), 2);
        assert_eq!(paths[0].id, default_path.id);

        let found_default = ProjectPath::find_default(&pool, project_id)
            .await
            .expect("find default path")
            .expect("default path exists");
        assert_eq!(found_default.path, "/workspace");

        let updated = ProjectPath::update(
            &pool,
            artifact_path.id,
            &UpdateProjectPath {
                path: Some("/dist".to_string()),
                label: Some("Dist".to_string()),
                kind: Some(ProjectPathKind::External),
                is_default: Some(true),
            },
        )
        .await
        .expect("update path");
        assert_eq!(updated.path, "/dist");
        assert_eq!(updated.label.as_deref(), Some("Dist"));
        assert_eq!(updated.kind, ProjectPathKind::External);
        assert!(updated.is_default);

        assert_eq!(
            ProjectPath::delete(&pool, default_path.id)
                .await
                .expect("delete path"),
            1
        );
        let remaining = ProjectPath::find_by_project(&pool, project_id)
            .await
            .expect("list remaining paths");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, updated.id);
    }
}
