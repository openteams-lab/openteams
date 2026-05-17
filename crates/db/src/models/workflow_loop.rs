use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::workflow_types::WorkflowLoopStatus;

const LOOP_SELECT: &str = r#"
    SELECT id, execution_id, round_id, loop_key, review_step_id, member_step_ids_json,
           status, retry_count, max_retry, user_review_required, rejection_reason,
           created_at, updated_at
    FROM chat_workflow_loops
"#;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowLoop {
    pub id: Uuid,
    pub execution_id: Uuid,
    pub round_id: Uuid,
    pub loop_key: String,
    pub review_step_id: Uuid,
    pub member_step_ids_json: String,
    pub status: WorkflowLoopStatus,
    pub retry_count: i32,
    pub max_retry: i32,
    pub user_review_required: bool,
    pub rejection_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CreateWorkflowLoop {
    pub execution_id: Uuid,
    pub round_id: Uuid,
    pub loop_key: String,
    pub review_step_id: Uuid,
    pub member_step_ids_json: String,
    pub max_retry: Option<i32>,
    pub user_review_required: Option<bool>,
    pub rejection_reason: Option<String>,
}

impl WorkflowLoop {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!("{LOOP_SELECT}\nWHERE id = ?1"))
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_round(
        pool: &SqlitePool,
        round_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{LOOP_SELECT}\nWHERE round_id = ?1\nORDER BY created_at ASC"
        ))
        .bind(round_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{LOOP_SELECT}\nWHERE execution_id = ?1\nORDER BY created_at ASC"
        ))
        .bind(execution_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateWorkflowLoop,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO chat_workflow_loops (
                id, execution_id, round_id, loop_key, review_step_id, member_step_ids_json,
                max_retry, user_review_required, rejection_reason
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, 3), COALESCE(?8, 1), ?9)
            RETURNING id, execution_id, round_id, loop_key, review_step_id,
                      member_step_ids_json, status, retry_count, max_retry,
                      user_review_required, rejection_reason, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(data.execution_id)
        .bind(data.round_id)
        .bind(&data.loop_key)
        .bind(data.review_step_id)
        .bind(&data.member_step_ids_json)
        .bind(data.max_retry)
        .bind(data.user_review_required)
        .bind(&data.rejection_reason)
        .fetch_one(pool)
        .await
    }

    pub async fn update_status(
        pool: &SqlitePool,
        id: Uuid,
        status: WorkflowLoopStatus,
        rejection_reason: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_loops
            SET status = ?2,
                rejection_reason = ?3,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, execution_id, round_id, loop_key, review_step_id,
                      member_step_ids_json, status, retry_count, max_retry,
                      user_review_required, rejection_reason, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(status)
        .bind(rejection_reason)
        .fetch_one(pool)
        .await
    }

    pub async fn update_user_review_required(
        pool: &SqlitePool,
        id: Uuid,
        user_review_required: bool,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_loops
            SET user_review_required = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, execution_id, round_id, loop_key, review_step_id,
                      member_step_ids_json, status, retry_count, max_retry,
                      user_review_required, rejection_reason, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(user_review_required)
        .fetch_one(pool)
        .await
    }

    pub async fn increment_retry(
        pool: &SqlitePool,
        id: Uuid,
        status: WorkflowLoopStatus,
        rejection_reason: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_loops
            SET retry_count = retry_count + 1,
                status = ?2,
                rejection_reason = ?3,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, execution_id, round_id, loop_key, review_step_id,
                      member_step_ids_json, status, retry_count, max_retry,
                      user_review_required, rejection_reason, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(status)
        .bind(rejection_reason)
        .fetch_one(pool)
        .await
    }
}
