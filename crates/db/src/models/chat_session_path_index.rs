use chrono::{DateTime, Utc};
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use uuid::Uuid;

const PATH_INDEX_QUERY_CHUNK_SIZE: usize = 400;

#[derive(Debug, Clone)]
pub struct UpsertChatSessionPathIndex {
    pub path: String,
    pub last_run_id: Option<Uuid>,
    pub last_observed_at: DateTime<Utc>,
    pub existed_after_run: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharedSessionPath {
    pub path: String,
    pub session_id: Uuid,
    pub last_observed_at: DateTime<Utc>,
}

pub struct ChatSessionPathIndex;

impl ChatSessionPathIndex {
    pub async fn upsert_many(
        pool: &SqlitePool,
        project_id: Uuid,
        workspace_path: &str,
        session_id: Uuid,
        rows: &[UpsertChatSessionPathIndex],
    ) -> Result<u64, sqlx::Error> {
        if rows.is_empty() {
            return Ok(0);
        }

        let mut rows_affected = 0;
        for chunk in rows.chunks(PATH_INDEX_QUERY_CHUNK_SIZE) {
            let mut builder = QueryBuilder::<Sqlite>::new(
                r#"
                INSERT INTO chat_session_path_index (
                    project_id, workspace_path, session_id, path, last_run_id,
                    last_observed_at, existed_after_run
                )
                "#,
            );
            builder.push_values(chunk, |mut values, row| {
                values
                    .push_bind(project_id)
                    .push_bind(workspace_path)
                    .push_bind(session_id)
                    .push_bind(&row.path)
                    .push_bind(row.last_run_id)
                    .push_bind(row.last_observed_at)
                    .push_bind(row.existed_after_run);
            });
            builder.push(
                r#"
                ON CONFLICT(project_id, workspace_path, session_id, path)
                DO UPDATE SET
                    last_run_id = CASE
                        WHEN excluded.last_observed_at >= chat_session_path_index.last_observed_at
                             AND excluded.last_run_id IS NOT NULL
                        THEN excluded.last_run_id
                        ELSE chat_session_path_index.last_run_id
                    END,
                    last_observed_at = CASE
                        WHEN excluded.last_observed_at > chat_session_path_index.last_observed_at
                        THEN excluded.last_observed_at
                        ELSE chat_session_path_index.last_observed_at
                    END,
                    existed_after_run = CASE
                        WHEN excluded.last_observed_at >= chat_session_path_index.last_observed_at
                        THEN excluded.existed_after_run
                        ELSE chat_session_path_index.existed_after_run
                    END,
                    updated_at = datetime('now', 'subsec')
                "#,
            );

            rows_affected += builder.build().execute(pool).await?.rows_affected();
        }

        Ok(rows_affected)
    }

    pub async fn delete_paths(
        pool: &SqlitePool,
        project_id: Uuid,
        workspace_path: &str,
        session_id: Uuid,
        paths: &[String],
    ) -> Result<u64, sqlx::Error> {
        if paths.is_empty() {
            return Ok(0);
        }

        let mut rows_affected = 0;
        for chunk in paths.chunks(PATH_INDEX_QUERY_CHUNK_SIZE) {
            let mut builder = QueryBuilder::<Sqlite>::new(
                "DELETE FROM chat_session_path_index WHERE project_id = ",
            );
            builder
                .push_bind(project_id)
                .push(" AND workspace_path = ")
                .push_bind(workspace_path)
                .push(" AND session_id = ")
                .push_bind(session_id)
                .push(" AND path IN (");
            let mut separated = builder.separated(", ");
            for path in chunk {
                separated.push_bind(path);
            }
            separated.push_unseparated(")");

            rows_affected += builder.build().execute(pool).await?.rows_affected();
        }

        Ok(rows_affected)
    }

    pub async fn find_shared_sessions_for_paths(
        pool: &SqlitePool,
        project_id: Uuid,
        workspace_path: &str,
        current_session_id: Uuid,
        paths: &[String],
    ) -> Result<Vec<SharedSessionPath>, sqlx::Error> {
        if paths.is_empty() {
            return Ok(Vec::new());
        }

        let mut shared_paths = Vec::new();
        for chunk in paths.chunks(PATH_INDEX_QUERY_CHUNK_SIZE) {
            let mut builder = QueryBuilder::<Sqlite>::new(
                r#"
                SELECT idx.path, idx.session_id, idx.last_observed_at
                FROM chat_session_path_index idx
                JOIN chat_sessions sessions ON sessions.id = idx.session_id
                WHERE idx.project_id = 
                "#,
            );
            builder
                .push_bind(project_id)
                .push(" AND idx.workspace_path = ")
                .push_bind(workspace_path)
                .push(" AND idx.session_id != ")
                .push_bind(current_session_id)
                .push(" AND sessions.status = 'active'")
                .push(" AND idx.path IN (");
            let mut separated = builder.separated(", ");
            for path in chunk {
                separated.push_bind(path);
            }
            separated.push_unseparated(")");

            let rows = builder.build().fetch_all(pool).await?;
            for row in rows {
                shared_paths.push(SharedSessionPath {
                    path: row.try_get("path")?,
                    session_id: row.try_get("session_id")?,
                    last_observed_at: row.try_get("last_observed_at")?,
                });
            }
        }

        Ok(shared_paths)
    }
}
