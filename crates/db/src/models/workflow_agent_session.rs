use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::workflow_types::{WorkflowAgentSessionRole, WorkflowAgentSessionState};

const AGENT_SESSION_SELECT: &str = r#"
    SELECT id, workflow_execution_id, session_agent_id, role,
           agent_session_id, agent_message_id, state,
           created_at, updated_at
    FROM chat_workflow_agent_sessions
"#;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowAgentSession {
    pub id: Uuid,
    pub workflow_execution_id: Uuid,
    pub session_agent_id: Uuid,
    pub role: WorkflowAgentSessionRole,
    pub agent_session_id: Option<String>,
    pub agent_message_id: Option<String>,
    pub state: WorkflowAgentSessionState,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowAgentSession {
    pub workflow_execution_id: Uuid,
    pub session_agent_id: Uuid,
    pub role: WorkflowAgentSessionRole,
}

impl WorkflowAgentSession {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!("{AGENT_SESSION_SELECT}\nWHERE id = ?1"))
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{AGENT_SESSION_SELECT}\nWHERE workflow_execution_id = ?1\nORDER BY created_at ASC"
        ))
        .bind(execution_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateWorkflowAgentSession,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO chat_workflow_agent_sessions (
                id, workflow_execution_id, session_agent_id, role
            )
            VALUES (?1, ?2, ?3, ?4)
            RETURNING id, workflow_execution_id, session_agent_id, role,
                      agent_session_id, agent_message_id, state,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(data.workflow_execution_id)
        .bind(data.session_agent_id)
        .bind(&data.role)
        .fetch_one(pool)
        .await
    }

    pub async fn update_state(
        pool: &SqlitePool,
        id: Uuid,
        state: WorkflowAgentSessionState,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_agent_sessions
            SET state = ?2, updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, workflow_execution_id, session_agent_id, role,
                      agent_session_id, agent_message_id, state,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(state)
        .fetch_one(pool)
        .await
    }

    pub async fn update_agent_session_id(
        pool: &SqlitePool,
        id: Uuid,
        agent_session_id: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_agent_sessions
            SET agent_session_id = ?2, updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, workflow_execution_id, session_agent_id, role,
                      agent_session_id, agent_message_id, state,
                      created_at, updated_at
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
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_agent_sessions
            SET agent_message_id = ?2, updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, workflow_execution_id, session_agent_id, role,
                      agent_session_id, agent_message_id, state,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(agent_message_id)
        .fetch_one(pool)
        .await
    }

    pub async fn clear_runtime_ids_for_project_member(
        pool: &SqlitePool,
        project_member_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE chat_workflow_agent_sessions
            SET agent_session_id = NULL,
                agent_message_id = NULL,
                updated_at = datetime('now', 'subsec')
            WHERE session_agent_id IN (
                SELECT id
                FROM chat_session_agents
                WHERE project_member_id = ?1
                  AND state IN ('idle', 'dead')
            )
              AND state NOT IN ('running', 'interrupt_requested')
              AND (agent_session_id IS NOT NULL OR agent_message_id IS NOT NULL)
            "#,
        )
        .bind(project_member_id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }
}
