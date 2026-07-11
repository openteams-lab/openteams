use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ProjectTeamProtocol {
    pub project_id: Uuid,
    pub content: String,
    pub enabled: bool,
}

impl ProjectTeamProtocol {
    pub fn content_if_enabled(&self) -> Option<&str> {
        if !self.enabled {
            return None;
        }
        let content = self.content.trim();
        (!content.is_empty()).then_some(content)
    }

    pub async fn find_by_project(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"SELECT project_id, content, enabled
               FROM project_team_protocols
               WHERE project_id = ?1"#,
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn upsert(
        pool: &SqlitePool,
        project_id: Uuid,
        content: String,
        enabled: bool,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"INSERT INTO project_team_protocols (project_id, content, enabled)
               VALUES (?1, ?2, ?3)
               ON CONFLICT(project_id) DO UPDATE SET
                   content = excluded.content,
                   enabled = excluded.enabled,
                   updated_at = datetime('now', 'subsec')
               RETURNING project_id, content, enabled"#,
        )
        .bind(project_id)
        .bind(&content)
        .bind(enabled)
        .fetch_one(pool)
        .await
    }
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::ProjectTeamProtocol;

    #[test]
    fn enabled_content_rejects_disabled_or_blank_protocols() {
        let project_id = Uuid::new_v4();
        assert_eq!(
            ProjectTeamProtocol {
                project_id,
                content: "Protocol".to_string(),
                enabled: false,
            }
            .content_if_enabled(),
            None
        );
        assert_eq!(
            ProjectTeamProtocol {
                project_id,
                content: "   ".to_string(),
                enabled: true,
            }
            .content_if_enabled(),
            None
        );
    }

    #[tokio::test]
    async fn upsert_updates_project_protocol() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        for statement in [r#"CREATE TABLE project_team_protocols (
                project_id BLOB PRIMARY KEY,
                content TEXT NOT NULL DEFAULT '',
                enabled BOOLEAN NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )"#]
        {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }

        let project_id = Uuid::new_v4();
        let protocol = ProjectTeamProtocol::upsert(
            &pool,
            project_id,
            "Review before handoff.".to_string(),
            true,
        )
        .await
        .unwrap();

        assert_eq!(protocol.content, "Review before handoff.");
        assert!(protocol.enabled);
        assert_eq!(
            protocol.content_if_enabled(),
            Some("Review before handoff.")
        );
    }

    #[tokio::test]
    async fn migration_backfills_project_protocol_before_dropping_session_columns() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE projects (id BLOB PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            r#"CREATE TABLE chat_sessions (
                id BLOB PRIMARY KEY,
                project_id BLOB,
                team_protocol TEXT,
                team_protocol_enabled BOOLEAN NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let project_id = Uuid::new_v4();
        sqlx::query("INSERT INTO projects (id) VALUES (?1)")
            .bind(project_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO chat_sessions (id, project_id, team_protocol, team_protocol_enabled) VALUES (?1, ?2, ?3, 1)",
        )
        .bind(Uuid::new_v4())
        .bind(project_id)
        .bind("Preserve this protocol.")
        .execute(&pool)
        .await
        .unwrap();

        sqlx::raw_sql(include_str!(
            "../../migrations/20260711120000_create_project_team_protocols.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/20260711130000_drop_chat_session_team_protocol.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();

        let protocol = ProjectTeamProtocol::find_by_project(&pool, project_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(protocol.content, "Preserve this protocol.");
        assert!(protocol.enabled);
        let removed_columns: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('chat_sessions') WHERE name IN ('team_protocol', 'team_protocol_enabled')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(removed_columns, 0);
    }
}
