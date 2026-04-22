use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::workflow_types::WorkflowExecutionStatus;

const EXECUTION_SELECT: &str = r#"
    SELECT id, session_id, plan_id, active_revision_id, active_round_id,
           workflow_card_message_id, lead_session_agent_id, status,
           current_round, title, compiled_graph_hash,
           started_at, completed_at, created_at, updated_at
    FROM chat_workflow_executions
"#;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowExecution {
    pub id: Uuid,
    pub session_id: Uuid,
    pub plan_id: Uuid,
    pub active_revision_id: Option<Uuid>,
    pub active_round_id: Option<Uuid>,
    pub workflow_card_message_id: Option<Uuid>,
    pub lead_session_agent_id: Option<Uuid>,
    pub status: WorkflowExecutionStatus,
    pub current_round: i32,
    pub title: String,
    pub compiled_graph_hash: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowExecution {
    pub session_id: Uuid,
    pub plan_id: Uuid,
    pub active_revision_id: Option<Uuid>,
    pub lead_session_agent_id: Option<Uuid>,
    pub title: String,
}

impl WorkflowExecution {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!("{EXECUTION_SELECT}\nWHERE id = ?1"))
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_session(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{EXECUTION_SELECT}\nWHERE session_id = ?1\nORDER BY created_at DESC"
        ))
        .bind(session_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_active_by_session(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{EXECUTION_SELECT}\nWHERE session_id = ?1 AND status NOT IN ('completed', 'failed')\nORDER BY created_at DESC"
        ))
        .bind(session_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateWorkflowExecution,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO chat_workflow_executions (
                id, session_id, plan_id, active_revision_id,
                lead_session_agent_id, title
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(data.session_id)
        .bind(data.plan_id)
        .bind(data.active_revision_id)
        .bind(data.lead_session_agent_id)
        .bind(&data.title)
        .fetch_one(pool)
        .await
    }

    pub async fn update_status(
        pool: &SqlitePool,
        id: Uuid,
        status: WorkflowExecutionStatus,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_executions
            SET status = ?2, updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(status)
        .fetch_one(pool)
        .await
    }

    pub async fn update_active_round(
        pool: &SqlitePool,
        id: Uuid,
        active_round_id: Uuid,
        current_round: i32,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_executions
            SET active_round_id = ?2,
                current_round = ?3,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(active_round_id)
        .bind(current_round)
        .fetch_one(pool)
        .await
    }

    pub async fn update_compiled_graph_hash(
        pool: &SqlitePool,
        id: Uuid,
        compiled_graph_hash: &str,
        active_revision_id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_executions
            SET compiled_graph_hash = ?2,
                active_revision_id = ?3,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(compiled_graph_hash)
        .bind(active_revision_id)
        .fetch_one(pool)
        .await
    }

    pub async fn set_started(pool: &SqlitePool, id: Uuid) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_executions
            SET started_at = datetime('now', 'subsec'),
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, created_at, updated_at
            "#,
        )
        .bind(id)
        .fetch_one(pool)
        .await
    }

    pub async fn update_workflow_card_message_id(
        pool: &SqlitePool,
        id: Uuid,
        workflow_card_message_id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_executions
            SET workflow_card_message_id = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(workflow_card_message_id)
        .fetch_one(pool)
        .await
    }

    pub async fn set_completed(pool: &SqlitePool, id: Uuid) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_executions
            SET completed_at = datetime('now', 'subsec'),
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, created_at, updated_at
            "#,
        )
        .bind(id)
        .fetch_one(pool)
        .await
    }
}
