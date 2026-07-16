use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, SqlitePool, Transaction, Type, types::Json};
use ts_rs::TS;
use uuid::Uuid;

use super::member_execution_config::MemberExecutionConfig;

const CHAT_SESSION_AGENT_SELECT: &str = r#"
    SELECT id,
           session_id,
           agent_id,
           state,
           workspace_path,
           pty_session_key,
           agent_session_id,
           agent_message_id,
           project_member_id,
           member_name,
           COALESCE(execution_config, '{}') AS execution_config,
           allowed_skill_ids,
           created_at,
           updated_at
    FROM chat_session_agents
"#;

const CHAT_SESSION_AGENT_RETURNING: &str = r#"
    RETURNING id,
              session_id,
              agent_id,
              state,
              workspace_path,
              pty_session_key,
              agent_session_id,
              agent_message_id,
              project_member_id,
              member_name,
              COALESCE(execution_config, '{}') AS execution_config,
              allowed_skill_ids,
              created_at,
              updated_at
"#;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "chat_session_agent_state", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum ChatSessionAgentState {
    Idle,
    Running,
    Stopping,
    WaitingApproval,
    Dead,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ChatSessionAgent {
    pub id: Uuid,
    pub session_id: Uuid,
    pub agent_id: Uuid,
    pub state: ChatSessionAgentState,
    pub workspace_path: Option<String>,
    pub pty_session_key: Option<String>,
    pub agent_session_id: Option<String>,
    pub agent_message_id: Option<String>,
    pub project_member_id: Option<Uuid>,
    pub member_name: String,
    #[ts(type = "MemberExecutionConfig")]
    pub execution_config: Json<MemberExecutionConfig>,
    #[ts(type = "string[]")]
    pub allowed_skill_ids: Json<Vec<String>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateChatSessionAgent {
    pub session_id: Uuid,
    pub agent_id: Uuid,
    pub member_name: Option<String>,
    pub workspace_path: Option<String>,
    pub allowed_skill_ids: Vec<String>,
    pub project_member_id: Option<Uuid>,
    pub execution_config: MemberExecutionConfig,
}

impl ChatSessionAgent {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            "{CHAT_SESSION_AGENT_SELECT}\nWHERE id = ?1"
        ))
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_session_and_agent(
        pool: &SqlitePool,
        session_id: Uuid,
        agent_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            "{CHAT_SESSION_AGENT_SELECT}\nWHERE session_id = ?1 AND agent_id = ?2"
        ))
        .bind(session_id)
        .bind(agent_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_all_by_session_and_agent(
        pool: &SqlitePool,
        session_id: Uuid,
        agent_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            "{CHAT_SESSION_AGENT_SELECT}\nWHERE session_id = ?1 AND agent_id = ?2\nORDER BY created_at ASC, id ASC"
        ))
        .bind(session_id)
        .bind(agent_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_session_and_member_name(
        pool: &SqlitePool,
        session_id: Uuid,
        member_name: &str,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            "{CHAT_SESSION_AGENT_SELECT}\nWHERE session_id = ?1 AND member_name = ?2"
        ))
        .bind(session_id)
        .bind(member_name)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_session_and_project_member(
        pool: &SqlitePool,
        session_id: Uuid,
        project_member_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            "{CHAT_SESSION_AGENT_SELECT}\nWHERE session_id = ?1 AND project_member_id = ?2"
        ))
        .bind(session_id)
        .bind(project_member_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_all_for_session(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            "{CHAT_SESSION_AGENT_SELECT}\nWHERE session_id = ?1\nORDER BY created_at ASC"
        ))
        .bind(session_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_all_active(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            "{CHAT_SESSION_AGENT_SELECT}\nWHERE state IN ('running', 'stopping')\nORDER BY created_at ASC"
        ))
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateChatSessionAgent,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            r#"
            INSERT INTO chat_session_agents (
                id,
                session_id,
                agent_id,
                workspace_path,
                allowed_skill_ids,
                project_member_id,
                member_name,
                execution_config,
                state
            )
            VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                COALESCE(
                    NULLIF(TRIM(?7), ''),
                    (SELECT NULLIF(TRIM(member_name), '') FROM project_members WHERE id = ?6),
                    (SELECT NULLIF(TRIM(name), '') FROM chat_agents WHERE id = ?3),
                    'member_' || LOWER(SUBSTR(HEX(?1), 1, 8))
                ),
                ?8,
                'idle'
            )
            {CHAT_SESSION_AGENT_RETURNING}
            "#
        ))
        .bind(id)
        .bind(data.session_id)
        .bind(data.agent_id)
        .bind(data.workspace_path.clone())
        .bind(Json(data.allowed_skill_ids.clone()))
        .bind(data.project_member_id)
        .bind(data.member_name.clone())
        .bind(Json(data.execution_config.clone().normalized()))
        .fetch_one(pool)
        .await
    }

    pub async fn update_state(
        pool: &SqlitePool,
        id: Uuid,
        state: ChatSessionAgentState,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            r#"
            UPDATE chat_session_agents
            SET state = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            {CHAT_SESSION_AGENT_RETURNING}
            "#
        ))
        .bind(id)
        .bind(state)
        .fetch_one(pool)
        .await
    }

    pub async fn update_workspace_path(
        pool: &SqlitePool,
        id: Uuid,
        workspace_path: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            r#"
            UPDATE chat_session_agents
            SET workspace_path = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            {CHAT_SESSION_AGENT_RETURNING}
            "#
        ))
        .bind(id)
        .bind(workspace_path)
        .fetch_one(pool)
        .await
    }

    pub async fn update_member_name(
        pool: &SqlitePool,
        id: Uuid,
        member_name: String,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            r#"
            UPDATE chat_session_agents
            SET member_name = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            {CHAT_SESSION_AGENT_RETURNING}
            "#
        ))
        .bind(id)
        .bind(member_name)
        .fetch_one(pool)
        .await
    }

    pub async fn update_allowed_skill_ids(
        pool: &SqlitePool,
        id: Uuid,
        allowed_skill_ids: Vec<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            r#"
            UPDATE chat_session_agents
            SET allowed_skill_ids = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            {CHAT_SESSION_AGENT_RETURNING}
            "#
        ))
        .bind(id)
        .bind(Json(allowed_skill_ids))
        .fetch_one(pool)
        .await
    }

    pub async fn update_agent_session_id(
        pool: &SqlitePool,
        id: Uuid,
        agent_session_id: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            r#"
            UPDATE chat_session_agents
            SET agent_session_id = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            {CHAT_SESSION_AGENT_RETURNING}
            "#
        ))
        .bind(id)
        .bind(agent_session_id)
        .fetch_one(pool)
        .await
    }

    pub async fn update_agent_message_id(
        pool: &SqlitePool,
        id: Uuid,
        agent_message_id: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            r#"
            UPDATE chat_session_agents
            SET agent_message_id = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            {CHAT_SESSION_AGENT_RETURNING}
            "#
        ))
        .bind(id)
        .bind(agent_message_id)
        .fetch_one(pool)
        .await
    }

    pub async fn reset_runtime_state(
        pool: &SqlitePool,
        id: Uuid,
        state: ChatSessionAgentState,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            r#"
            UPDATE chat_session_agents
            SET state = ?2,
                pty_session_key = NULL,
                agent_session_id = NULL,
                agent_message_id = NULL,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            {CHAT_SESSION_AGENT_RETURNING}
            "#
        ))
        .bind(id)
        .bind(state)
        .fetch_one(pool)
        .await
    }

    pub async fn update_execution_config(
        pool: &SqlitePool,
        id: Uuid,
        execution_config: MemberExecutionConfig,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            r#"
            UPDATE chat_session_agents
            SET execution_config = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            {CHAT_SESSION_AGENT_RETURNING}
            "#
        ))
        .bind(id)
        .bind(Json(execution_config.normalized()))
        .fetch_one(pool)
        .await
    }

    pub async fn update_execution_config_for_next_run(
        pool: &SqlitePool,
        id: Uuid,
        project_member_id: Option<Uuid>,
        execution_config: MemberExecutionConfig,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(&format!(
            r#"
            UPDATE chat_session_agents
            SET project_member_id = COALESCE(?2, project_member_id),
                execution_config = ?3,
                agent_session_id = NULL,
                agent_message_id = NULL,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
              AND state IN ('idle', 'dead')
            {CHAT_SESSION_AGENT_RETURNING}
            "#
        ))
        .bind(id)
        .bind(project_member_id)
        .bind(Json(execution_config.normalized()))
        .fetch_one(pool)
        .await
    }

    pub async fn sync_execution_config_for_project_member(
        pool: &SqlitePool,
        project_member_id: Uuid,
        execution_config: MemberExecutionConfig,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE chat_session_agents
            SET execution_config = ?2,
                agent_session_id = NULL,
                agent_message_id = NULL,
                updated_at = datetime('now', 'subsec')
            WHERE project_member_id = ?1
              AND state IN ('idle', 'dead')
              AND NOT EXISTS (
                  SELECT 1
                  FROM chat_workflow_agent_sessions was
                  WHERE was.session_agent_id = chat_session_agents.id
                    AND was.state IN ('running', 'interrupt_requested')
              )
            "#,
        )
        .bind(project_member_id)
        .bind(Json(execution_config.normalized()))
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn sync_member_name_for_project_member_in_transaction(
        transaction: &mut Transaction<'_, Sqlite>,
        project_member_id: Uuid,
        member_name: &str,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE chat_session_agents
            SET member_name = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE project_member_id = ?1
            "#,
        )
        .bind(project_member_id)
        .bind(member_name)
        .execute(&mut **transaction)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn sync_allowed_skill_ids_for_project_member(
        pool: &SqlitePool,
        project_member_id: Uuid,
        allowed_skill_ids: Vec<String>,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE chat_session_agents
            SET allowed_skill_ids = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE project_member_id = ?1
            "#,
        )
        .bind(project_member_id)
        .bind(Json(allowed_skill_ids))
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn sync_execution_config_for_unlinked_project_agent(
        pool: &SqlitePool,
        project_id: Uuid,
        agent_id: Uuid,
        project_member_id: Uuid,
        execution_config: MemberExecutionConfig,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE chat_session_agents
            SET project_member_id = ?3,
                execution_config = ?4,
                agent_session_id = NULL,
                agent_message_id = NULL,
                updated_at = datetime('now', 'subsec')
            WHERE project_member_id IS NULL
              AND agent_id = ?2
              AND state IN ('idle', 'dead')
              AND EXISTS (
                  SELECT 1
                  FROM chat_sessions sessions
                  WHERE sessions.id = chat_session_agents.session_id
                    AND sessions.project_id = ?1
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM chat_workflow_agent_sessions was
                  WHERE was.session_agent_id = chat_session_agents.id
                    AND was.state IN ('running', 'interrupt_requested')
              )
            "#,
        )
        .bind(project_id)
        .bind(agent_id)
        .bind(project_member_id)
        .bind(Json(execution_config.normalized()))
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn sync_allowed_skill_ids_for_unlinked_project_agent(
        pool: &SqlitePool,
        project_id: Uuid,
        agent_id: Uuid,
        project_member_id: Uuid,
        allowed_skill_ids: Vec<String>,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE chat_session_agents
            SET project_member_id = ?3,
                allowed_skill_ids = ?4,
                updated_at = datetime('now', 'subsec')
            WHERE project_member_id IS NULL
              AND agent_id = ?2
              AND EXISTS (
                  SELECT 1
                  FROM chat_sessions sessions
                  WHERE sessions.id = chat_session_agents.session_id
                    AND sessions.project_id = ?1
              )
            "#,
        )
        .bind(project_id)
        .bind(agent_id)
        .bind(project_member_id)
        .bind(Json(allowed_skill_ids))
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(r#"DELETE FROM chat_session_agents WHERE id = ?1"#)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }

    /// Clear agent_session_id and agent_message_id for all session agents using a specific agent.
    /// This should be called whenever the agent's executor identity changes (for example
    /// runner type, variant, or model), because the old upstream session IDs are no longer valid.
    pub async fn clear_session_ids_for_agent(
        pool: &SqlitePool,
        agent_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE chat_session_agents
            SET agent_session_id = NULL,
                agent_message_id = NULL,
                updated_at = datetime('now', 'subsec')
            WHERE agent_id = ?1
              AND (agent_session_id IS NOT NULL OR agent_message_id IS NOT NULL)
            "#,
        )
        .bind(agent_id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use sqlx::{Row, SqlitePool};
    use uuid::Uuid;

    #[tokio::test]
    async fn member_name_migration_avoids_reserved_suffix_collisions() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(
            r#"
            CREATE TABLE chat_agents (id BLOB PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE chat_sessions (
                id BLOB PRIMARY KEY,
                lead_agent_id BLOB,
                project_id BLOB
            );
            CREATE TABLE project_members (
                id BLOB PRIMARY KEY,
                project_id BLOB,
                member_type TEXT NOT NULL,
                agent_id BLOB,
                member_name TEXT,
                display_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            );
            CREATE TABLE chat_session_agents (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                agent_id BLOB NOT NULL,
                project_member_id BLOB,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            );
            CREATE UNIQUE INDEX idx_chat_session_agents_unique
                ON chat_session_agents(session_id, agent_id);
            CREATE TABLE chat_messages (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                sender_type TEXT NOT NULL,
                sender_id BLOB
            );
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        let session_id = Uuid::new_v4();
        sqlx::query("INSERT INTO chat_sessions (id) VALUES (?1)")
            .bind(session_id)
            .execute(&pool)
            .await
            .unwrap();
        for (display_order, member_name) in [(1_i64, "Foo"), (2, "Foo"), (3, "Foo_2")] {
            let agent_id = Uuid::new_v4();
            let member_id = Uuid::new_v4();
            sqlx::query("INSERT INTO chat_agents (id, name) VALUES (?1, 'template')")
                .bind(agent_id)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query(
                r#"INSERT INTO project_members (
                       id, member_type, agent_id, member_name, display_order
                   ) VALUES (?1, 'agent', ?2, ?3, ?4)"#,
            )
            .bind(member_id)
            .bind(agent_id)
            .bind(member_name)
            .bind(display_order)
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                r#"INSERT INTO chat_session_agents (
                       id, session_id, agent_id, project_member_id
                   ) VALUES (?1, ?2, ?3, ?4)"#,
            )
            .bind(Uuid::new_v4())
            .bind(session_id)
            .bind(agent_id)
            .bind(member_id)
            .execute(&pool)
            .await
            .unwrap();
        }

        sqlx::raw_sql(include_str!(
            "../../migrations/20260716150000_session_member_id_routing.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();

        let rows = sqlx::query(
            "SELECT member_name FROM chat_session_agents ORDER BY member_name COLLATE NOCASE",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let names = rows
            .into_iter()
            .map(|row| row.get::<String, _>("member_name").to_lowercase())
            .collect::<Vec<_>>();
        assert_eq!(names.iter().cloned().collect::<HashSet<_>>().len(), 3);
        assert!(names.contains(&"foo".to_string()));
        assert!(names.contains(&"foo_2".to_string()));
        assert!(names.contains(&"foo_3".to_string()));
    }
}
