use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::workflow_types::WorkflowEventType;

const EVENT_SELECT: &str = r#"
    SELECT id, execution_id, round_id, step_id, agent_session_id,
           event_type, status_before, status_after, detail_json, created_at
    FROM chat_workflow_events
"#;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowEvent {
    pub id: Uuid,
    pub execution_id: Uuid,
    pub round_id: Option<Uuid>,
    pub step_id: Option<Uuid>,
    pub agent_session_id: Option<Uuid>,
    pub event_type: WorkflowEventType,
    pub status_before: Option<String>,
    pub status_after: Option<String>,
    pub detail_json: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowEvent {
    pub execution_id: Uuid,
    pub round_id: Option<Uuid>,
    pub step_id: Option<Uuid>,
    pub agent_session_id: Option<Uuid>,
    pub event_type: WorkflowEventType,
    pub status_before: Option<String>,
    pub status_after: Option<String>,
    pub detail_json: Option<String>,
}

impl WorkflowEvent {
    pub async fn find_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{EVENT_SELECT}\nWHERE execution_id = ?1\nORDER BY created_at ASC"
        ))
        .bind(execution_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateWorkflowEvent,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO chat_workflow_events (
                id, execution_id, round_id, step_id, agent_session_id,
                event_type, status_before, status_after, detail_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            RETURNING id, execution_id, round_id, step_id, agent_session_id,
                      event_type, status_before, status_after, detail_json, created_at
            "#,
        )
        .bind(id)
        .bind(data.execution_id)
        .bind(data.round_id)
        .bind(data.step_id)
        .bind(data.agent_session_id)
        .bind(&data.event_type)
        .bind(&data.status_before)
        .bind(&data.status_after)
        .bind(&data.detail_json)
        .fetch_one(pool)
        .await
    }

    pub async fn delete_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            DELETE FROM chat_workflow_events
            WHERE execution_id = ?1
              AND event_type NOT IN (
                  'ExecutionCreated', 'ExecutionRunning', 'ExecutionFailed',
                  'ExecutionCompleted', 'ExecutionPaused', 'ExecutionWaiting',
                  'UserAccepted', 'UserRejected'
              )
            "#,
        )
        .bind(execution_id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }
}
