use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::workflow_types::WorkflowRoundStatus;

const ROUND_SELECT: &str = r#"
    SELECT id, execution_id, round_index, source_revision_id, status,
           result_step_id, user_decision_summary,
           started_at, completed_at, archived_at, created_at, updated_at
    FROM chat_workflow_rounds
"#;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowRound {
    pub id: Uuid,
    pub execution_id: Uuid,
    pub round_index: i32,
    pub source_revision_id: Option<Uuid>,
    pub status: WorkflowRoundStatus,
    pub result_step_id: Option<Uuid>,
    pub user_decision_summary: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowRound {
    pub execution_id: Uuid,
    pub round_index: i32,
    pub source_revision_id: Option<Uuid>,
}

impl WorkflowRound {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!("{ROUND_SELECT}\nWHERE id = ?1"))
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{ROUND_SELECT}\nWHERE execution_id = ?1\nORDER BY round_index ASC"
        ))
        .bind(execution_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateWorkflowRound,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO chat_workflow_rounds (
                id, execution_id, round_index, source_revision_id,
                started_at
            )
            VALUES (?1, ?2, ?3, ?4, datetime('now', 'subsec'))
            RETURNING id, execution_id, round_index, source_revision_id, status,
                      result_step_id, user_decision_summary,
                      started_at, completed_at, archived_at, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(data.execution_id)
        .bind(data.round_index)
        .bind(data.source_revision_id)
        .fetch_one(pool)
        .await
    }

    pub async fn update_status(
        pool: &SqlitePool,
        id: Uuid,
        status: WorkflowRoundStatus,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_rounds
            SET status = ?2, updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, execution_id, round_index, source_revision_id, status,
                      result_step_id, user_decision_summary,
                      started_at, completed_at, archived_at, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(status)
        .fetch_one(pool)
        .await
    }
}
