use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type, types::Json};
use ts_rs::TS;
use uuid::Uuid;

const CHAT_SESSION_AGENT_SELECT: &str = r#"
    SELECT id,
           session_id,
           agent_id,
           state,
           workspace_path,
           pty_session_key,
           agent_session_id,
           agent_message_id,
           allowed_skill_ids,
           created_at,
           updated_at
    FROM chat_session_agents
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
    #[ts(type = "string[]")]
    pub allowed_skill_ids: Json<Vec<String>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateChatSessionAgent {
    pub session_id: Uuid,
    pub agent_id: Uuid,
    pub workspace_path: Option<String>,
    pub allowed_skill_ids: Vec<String>,
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

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateChatSessionAgent,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(
            r#"
            INSERT INTO chat_session_agents (
                id,
                session_id,
                agent_id,
                workspace_path,
                allowed_skill_ids,
                state
            )
            VALUES (?1, ?2, ?3, ?4, ?5, 'idle')
            RETURNING id,
                      session_id,
                      agent_id,
                      state,
                      workspace_path,
                      pty_session_key,
                      agent_session_id,
                      agent_message_id,
                      allowed_skill_ids,
                      created_at,
                      updated_at
            "#,
        )
        .bind(id)
        .bind(data.session_id)
        .bind(data.agent_id)
        .bind(data.workspace_path.clone())
        .bind(Json(data.allowed_skill_ids.clone()))
        .fetch_one(pool)
        .await
    }

    pub async fn update_state(
        pool: &SqlitePool,
        id: Uuid,
        state: ChatSessionAgentState,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(
            r#"
            UPDATE chat_session_agents
            SET state = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id,
                      session_id,
                      agent_id,
                      state,
                      workspace_path,
                      pty_session_key,
                      agent_session_id,
                      agent_message_id,
                      allowed_skill_ids,
                      created_at,
                      updated_at
            "#,
        )
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
        sqlx::query_as::<_, ChatSessionAgent>(
            r#"
            UPDATE chat_session_agents
            SET workspace_path = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id,
                      session_id,
                      agent_id,
                      state,
                      workspace_path,
                      pty_session_key,
                      agent_session_id,
                      agent_message_id,
                      allowed_skill_ids,
                      created_at,
                      updated_at
            "#,
        )
        .bind(id)
        .bind(workspace_path)
        .fetch_one(pool)
        .await
    }

    pub async fn update_allowed_skill_ids(
        pool: &SqlitePool,
        id: Uuid,
        allowed_skill_ids: Vec<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatSessionAgent>(
            r#"
            UPDATE chat_session_agents
            SET allowed_skill_ids = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id,
                      session_id,
                      agent_id,
                      state,
                      workspace_path,
                      pty_session_key,
                      agent_session_id,
                      agent_message_id,
                      allowed_skill_ids,
                      created_at,
                      updated_at
            "#,
        )
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
        sqlx::query_as::<_, ChatSessionAgent>(
            r#"
            UPDATE chat_session_agents
            SET agent_session_id = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id,
                      session_id,
                      agent_id,
                      state,
                      workspace_path,
                      pty_session_key,
                      agent_session_id,
                      agent_message_id,
                      allowed_skill_ids,
                      created_at,
                      updated_at
            "#,
        )
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
        sqlx::query_as::<_, ChatSessionAgent>(
            r#"
            UPDATE chat_session_agents
            SET agent_message_id = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id,
                      session_id,
                      agent_id,
                      state,
                      workspace_path,
                      pty_session_key,
                      agent_session_id,
                      agent_message_id,
                      allowed_skill_ids,
                      created_at,
                      updated_at
            "#,
        )
        .bind(id)
        .bind(agent_message_id)
        .fetch_one(pool)
        .await
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
