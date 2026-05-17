use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::workflow_types::{WorkflowPlanStatus, WorkflowValidationStatus};

const WORKFLOW_PLAN_SELECT: &str = r#"
    SELECT id, session_id, source_message_id, created_by_session_agent_id,
           status, title, summary_text, plan_json, plan_schema_version,
           plan_hash, validation_status, validation_errors_json,
           workflow_card_message_id,
           created_at, updated_at
    FROM chat_workflow_plans
"#;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowPlan {
    pub id: Uuid,
    pub session_id: Uuid,
    pub source_message_id: Option<Uuid>,
    pub created_by_session_agent_id: Option<Uuid>,
    pub status: WorkflowPlanStatus,
    pub title: String,
    pub summary_text: Option<String>,
    pub plan_json: String,
    pub plan_schema_version: i32,
    pub plan_hash: String,
    pub validation_status: WorkflowValidationStatus,
    pub validation_errors_json: Option<String>,
    pub workflow_card_message_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowPlan {
    pub session_id: Uuid,
    pub source_message_id: Option<Uuid>,
    pub created_by_session_agent_id: Option<Uuid>,
    pub title: String,
    pub summary_text: Option<String>,
    pub plan_json: String,
    pub plan_schema_version: i32,
    pub plan_hash: String,
    pub validation_status: WorkflowValidationStatus,
    pub validation_errors_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpdateWorkflowPlanJson<'a> {
    pub title: &'a str,
    pub summary_text: Option<String>,
    pub plan_json: &'a str,
    pub plan_schema_version: i32,
    pub plan_hash: &'a str,
    pub validation_status: WorkflowValidationStatus,
    pub validation_errors_json: Option<String>,
}

impl WorkflowPlan {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!("{WORKFLOW_PLAN_SELECT}\nWHERE id = ?1"))
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_session(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{WORKFLOW_PLAN_SELECT}\nWHERE session_id = ?1\nORDER BY created_at DESC"
        ))
        .bind(session_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateWorkflowPlan,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO chat_workflow_plans (
                id, session_id, source_message_id, created_by_session_agent_id,
                title, summary_text, plan_json, plan_schema_version,
                plan_hash, validation_status, validation_errors_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            RETURNING id, session_id, source_message_id, created_by_session_agent_id,
                      status, title, summary_text, plan_json, plan_schema_version,
                      plan_hash, validation_status, validation_errors_json,
                      workflow_card_message_id, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(data.session_id)
        .bind(data.source_message_id)
        .bind(data.created_by_session_agent_id)
        .bind(&data.title)
        .bind(&data.summary_text)
        .bind(&data.plan_json)
        .bind(data.plan_schema_version)
        .bind(&data.plan_hash)
        .bind(&data.validation_status)
        .bind(&data.validation_errors_json)
        .fetch_one(pool)
        .await
    }

    pub async fn update_status(
        pool: &SqlitePool,
        id: Uuid,
        status: WorkflowPlanStatus,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_plans
            SET status = ?2, updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, source_message_id, created_by_session_agent_id,
                      status, title, summary_text, plan_json, plan_schema_version,
                      plan_hash, validation_status, validation_errors_json,
                      workflow_card_message_id, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(status)
        .fetch_one(pool)
        .await
    }

    pub async fn update_validation(
        pool: &SqlitePool,
        id: Uuid,
        validation_status: WorkflowValidationStatus,
        validation_errors_json: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_plans
            SET validation_status = ?2,
                validation_errors_json = ?3,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, source_message_id, created_by_session_agent_id,
                      status, title, summary_text, plan_json, plan_schema_version,
                      plan_hash, validation_status, validation_errors_json,
                      workflow_card_message_id, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(validation_status)
        .bind(validation_errors_json)
        .fetch_one(pool)
        .await
    }

    pub async fn update_plan_json(
        pool: &SqlitePool,
        id: Uuid,
        data: &UpdateWorkflowPlanJson<'_>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_plans
            SET title = ?2,
                summary_text = ?3,
                plan_json = ?4,
                plan_schema_version = ?5,
                plan_hash = ?6,
                validation_status = ?7,
                validation_errors_json = ?8,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, source_message_id, created_by_session_agent_id,
                      status, title, summary_text, plan_json, plan_schema_version,
                      plan_hash, validation_status, validation_errors_json,
                      workflow_card_message_id, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(data.title)
        .bind(&data.summary_text)
        .bind(data.plan_json)
        .bind(data.plan_schema_version)
        .bind(data.plan_hash)
        .bind(&data.validation_status)
        .bind(&data.validation_errors_json)
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
            UPDATE chat_workflow_plans
            SET workflow_card_message_id = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, source_message_id, created_by_session_agent_id,
                      status, title, summary_text, plan_json, plan_schema_version,
                      plan_hash, validation_status, validation_errors_json,
                      workflow_card_message_id, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(workflow_card_message_id)
        .fetch_one(pool)
        .await
    }
}
