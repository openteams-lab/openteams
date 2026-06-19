use anyhow::Result;
use db::models::project_path::{ProjectPath, ProjectPathKind, UpdateProjectPath};
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Clone, Default)]
pub struct ProjectPathService;

impl ProjectPathService {
    pub fn new() -> Self {
        Self
    }

    pub async fn list_paths(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<ProjectPath>> {
        Ok(ProjectPath::find_by_project(pool, project_id).await?)
    }

    pub async fn get_default_path(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Option<ProjectPath>> {
        Ok(ProjectPath::find_default(pool, project_id).await?)
    }

    pub async fn add_path(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        path: String,
        label: Option<String>,
        kind: ProjectPathKind,
        is_default: bool,
    ) -> Result<ProjectPath> {
        Ok(ProjectPath::create(pool, project_id, path, label, kind, is_default).await?)
    }

    pub async fn update_path(
        &self,
        pool: &SqlitePool,
        id: Uuid,
        path: Option<String>,
        label: Option<String>,
        kind: Option<ProjectPathKind>,
        is_default: Option<bool>,
    ) -> Result<ProjectPath> {
        Ok(ProjectPath::update(
            pool,
            id,
            &UpdateProjectPath {
                path,
                label,
                kind,
                is_default,
            },
        )
        .await?)
    }

    pub async fn remove_path(&self, pool: &SqlitePool, id: Uuid) -> Result<u64> {
        Ok(ProjectPath::delete(pool, id).await?)
    }
}

#[cfg(test)]
mod tests {
    use db::models::project_path::ProjectPathKind;
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::ProjectPathService;

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
        .expect("create project_paths");

        pool
    }

    #[tokio::test]
    async fn lists_and_reads_default_path() {
        let pool = setup_pool().await;
        let service = ProjectPathService::new();
        let project_id = Uuid::new_v4();

        service
            .add_path(
                &pool,
                project_id,
                "E:/repo".to_string(),
                Some("Repo".to_string()),
                ProjectPathKind::Workspace,
                true,
            )
            .await
            .expect("add project path");

        let paths = service
            .list_paths(&pool, project_id)
            .await
            .expect("list paths");
        let default_path = service
            .get_default_path(&pool, project_id)
            .await
            .expect("get default path")
            .expect("default path exists");

        assert_eq!(paths.len(), 1);
        assert_eq!(default_path.path, "E:/repo");
    }
}
