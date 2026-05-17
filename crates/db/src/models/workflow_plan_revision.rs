use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::workflow_types::{WorkflowRevisionEditor, WorkflowValidationStatus};

const REVISION_SELECT: &str = r#"
    SELECT id, plan_id, revision_no, edited_by, editor_session_agent_id,
           reason, plan_json, plan_hash, validation_status,
           validation_errors_json, created_at
    FROM chat_workflow_plan_revisions
"#;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowPlanRevision {
    pub id: Uuid,
    pub plan_id: Uuid,
    pub revision_no: i32,
    pub edited_by: WorkflowRevisionEditor,
    pub editor_session_agent_id: Option<Uuid>,
    pub reason: Option<String>,
    pub plan_json: String,
    pub plan_hash: String,
    pub validation_status: WorkflowValidationStatus,
    pub validation_errors_json: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowPlanRevision {
    pub plan_id: Uuid,
    pub revision_no: i32,
    pub edited_by: WorkflowRevisionEditor,
    pub editor_session_agent_id: Option<Uuid>,
    pub reason: Option<String>,
    pub plan_json: String,
    pub plan_hash: String,
    pub validation_status: WorkflowValidationStatus,
    pub validation_errors_json: Option<String>,
}

impl WorkflowPlanRevision {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!("{REVISION_SELECT}\nWHERE id = ?1"))
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_plan(pool: &SqlitePool, plan_id: Uuid) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{REVISION_SELECT}\nWHERE plan_id = ?1\nORDER BY revision_no ASC"
        ))
        .bind(plan_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_latest_by_plan(
        pool: &SqlitePool,
        plan_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{REVISION_SELECT}\nWHERE plan_id = ?1\nORDER BY revision_no DESC\nLIMIT 1"
        ))
        .bind(plan_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateWorkflowPlanRevision,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO chat_workflow_plan_revisions (
                id, plan_id, revision_no, edited_by, editor_session_agent_id,
                reason, plan_json, plan_hash, validation_status, validation_errors_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            RETURNING id, plan_id, revision_no, edited_by, editor_session_agent_id,
                      reason, plan_json, plan_hash, validation_status,
                      validation_errors_json, created_at
            "#,
        )
        .bind(id)
        .bind(data.plan_id)
        .bind(data.revision_no)
        .bind(&data.edited_by)
        .bind(data.editor_session_agent_id)
        .bind(&data.reason)
        .bind(&data.plan_json)
        .bind(&data.plan_hash)
        .bind(&data.validation_status)
        .bind(&data.validation_errors_json)
        .fetch_one(pool)
        .await
    }
}
