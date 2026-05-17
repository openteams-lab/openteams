use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::workflow_types::{ReviewVerdict, ReviewerType};

const REVIEW_SELECT: &str = r#"
    SELECT id, step_id, execution_id, reviewer_type, reviewer_id, verdict, feedback,
           review_round, created_at
    FROM chat_workflow_step_reviews
"#;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowStepReview {
    pub id: Uuid,
    pub step_id: Uuid,
    pub execution_id: Uuid,
    pub reviewer_type: ReviewerType,
    pub reviewer_id: Option<String>,
    pub verdict: ReviewVerdict,
    pub feedback: String,
    pub review_round: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CreateWorkflowStepReview {
    pub step_id: Uuid,
    pub execution_id: Uuid,
    pub reviewer_type: ReviewerType,
    pub reviewer_id: Option<String>,
    pub verdict: ReviewVerdict,
    pub feedback: String,
    pub review_round: Option<i32>,
}

impl WorkflowStepReview {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!("{REVIEW_SELECT}\nWHERE id = ?1"))
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_step(pool: &SqlitePool, step_id: Uuid) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{REVIEW_SELECT}\nWHERE step_id = ?1\nORDER BY created_at ASC"
        ))
        .bind(step_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{REVIEW_SELECT}\nWHERE execution_id = ?1\nORDER BY created_at ASC"
        ))
        .bind(execution_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateWorkflowStepReview,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO chat_workflow_step_reviews (
                id, step_id, execution_id, reviewer_type, reviewer_id, verdict, feedback,
                review_round
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, COALESCE(?8, 0))
            RETURNING id, step_id, execution_id, reviewer_type, reviewer_id, verdict,
                      feedback, review_round, created_at
            "#,
        )
        .bind(id)
        .bind(data.step_id)
        .bind(data.execution_id)
        .bind(&data.reviewer_type)
        .bind(&data.reviewer_id)
        .bind(&data.verdict)
        .bind(&data.feedback)
        .bind(data.review_round)
        .fetch_one(pool)
        .await
    }
}
