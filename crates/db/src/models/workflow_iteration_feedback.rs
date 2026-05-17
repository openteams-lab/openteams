use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

const FEEDBACK_SELECT: &str = r#"
    SELECT id, execution_id, from_round_id, to_round_id, user_feedback_json,
           current_status_summary, new_plan_diff, created_at
    FROM chat_workflow_iteration_feedbacks
"#;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowIterationFeedback {
    pub id: Uuid,
    pub execution_id: Uuid,
    pub from_round_id: Uuid,
    pub to_round_id: Option<Uuid>,
    pub user_feedback_json: String,
    pub current_status_summary: String,
    pub new_plan_diff: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CreateWorkflowIterationFeedback {
    pub execution_id: Uuid,
    pub from_round_id: Uuid,
    pub to_round_id: Option<Uuid>,
    pub user_feedback_json: String,
    pub current_status_summary: String,
    pub new_plan_diff: Option<String>,
}

impl WorkflowIterationFeedback {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!("{FEEDBACK_SELECT}\nWHERE id = ?1"))
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{FEEDBACK_SELECT}\nWHERE execution_id = ?1\nORDER BY created_at ASC"
        ))
        .bind(execution_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_from_round(
        pool: &SqlitePool,
        from_round_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{FEEDBACK_SELECT}\nWHERE from_round_id = ?1\nORDER BY created_at ASC"
        ))
        .bind(from_round_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateWorkflowIterationFeedback,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO chat_workflow_iteration_feedbacks (
                id, execution_id, from_round_id, to_round_id, user_feedback_json,
                current_status_summary, new_plan_diff
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            RETURNING id, execution_id, from_round_id, to_round_id, user_feedback_json,
                      current_status_summary, new_plan_diff, created_at
            "#,
        )
        .bind(id)
        .bind(data.execution_id)
        .bind(data.from_round_id)
        .bind(data.to_round_id)
        .bind(&data.user_feedback_json)
        .bind(&data.current_status_summary)
        .bind(&data.new_plan_diff)
        .fetch_one(pool)
        .await
    }

    pub async fn update_generated_plan(
        pool: &SqlitePool,
        id: Uuid,
        to_round_id: Uuid,
        new_plan_diff: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_iteration_feedbacks
            SET to_round_id = ?2,
                new_plan_diff = ?3
            WHERE id = ?1
            RETURNING id, execution_id, from_round_id, to_round_id, user_feedback_json,
                      current_status_summary, new_plan_diff, created_at
            "#,
        )
        .bind(id)
        .bind(to_round_id)
        .bind(new_plan_diff)
        .fetch_one(pool)
        .await
    }
}
