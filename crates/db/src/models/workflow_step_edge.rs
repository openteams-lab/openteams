use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::workflow_types::WorkflowEdgeKind;

const EDGE_SELECT: &str = r#"
    SELECT id, execution_id, compiled_revision_id,
           from_step_id, to_step_id, edge_kind, created_at
    FROM chat_workflow_step_edges
"#;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowStepEdge {
    pub id: Uuid,
    pub execution_id: Uuid,
    pub compiled_revision_id: Option<Uuid>,
    pub from_step_id: Uuid,
    pub to_step_id: Uuid,
    pub edge_kind: WorkflowEdgeKind,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowStepEdge {
    pub execution_id: Uuid,
    pub compiled_revision_id: Option<Uuid>,
    pub from_step_id: Uuid,
    pub to_step_id: Uuid,
    pub edge_kind: WorkflowEdgeKind,
}

impl WorkflowStepEdge {
    pub async fn find_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{EDGE_SELECT}\nWHERE execution_id = ?1\nORDER BY created_at ASC"
        ))
        .bind(execution_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateWorkflowStepEdge,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO chat_workflow_step_edges (
                id, execution_id, compiled_revision_id,
                from_step_id, to_step_id, edge_kind
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            RETURNING id, execution_id, compiled_revision_id,
                      from_step_id, to_step_id, edge_kind, created_at
            "#,
        )
        .bind(id)
        .bind(data.execution_id)
        .bind(data.compiled_revision_id)
        .bind(data.from_step_id)
        .bind(data.to_step_id)
        .bind(&data.edge_kind)
        .fetch_one(pool)
        .await
    }
}
