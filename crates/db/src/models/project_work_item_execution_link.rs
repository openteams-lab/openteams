use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "project_execution_link_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum ProjectExecutionLinkType {
    CreatedFrom,
    DiscussedIn,
    ImplementedBy,
    ReviewedBy,
    DeliveredBy,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ProjectWorkItemExecutionLink {
    pub id: Uuid,
    pub project_work_item_id: Uuid,
    pub session_id: Option<Uuid>,
    pub workflow_execution_id: Option<Uuid>,
    pub workflow_step_id: Option<Uuid>,
    pub run_id: Option<Uuid>,
    pub link_type: ProjectExecutionLinkType,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateProjectWorkItemExecutionLink {
    pub session_id: Option<Uuid>,
    pub workflow_execution_id: Option<Uuid>,
    pub workflow_step_id: Option<Uuid>,
    pub run_id: Option<Uuid>,
    pub link_type: ProjectExecutionLinkType,
}

impl ProjectWorkItemExecutionLink {
    pub async fn create(
        pool: &SqlitePool,
        project_work_item_id: Uuid,
        input: CreateProjectWorkItemExecutionLink,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO project_work_item_execution_links (
                id, project_work_item_id, session_id, workflow_execution_id,
                workflow_step_id, run_id, link_type
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            RETURNING id, project_work_item_id, session_id, workflow_execution_id,
                      workflow_step_id, run_id, link_type, created_at
            "#,
        )
        .bind(id)
        .bind(project_work_item_id)
        .bind(input.session_id)
        .bind(input.workflow_execution_id)
        .bind(input.workflow_step_id)
        .bind(input.run_id)
        .bind(input.link_type)
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_work_item(
        pool: &SqlitePool,
        project_work_item_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT id, project_work_item_id, session_id, workflow_execution_id,
                   workflow_step_id, run_id, link_type, created_at
            FROM project_work_item_execution_links
            WHERE project_work_item_id = ?1
            ORDER BY created_at ASC
            "#,
        )
        .bind(project_work_item_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT id, project_work_item_id, session_id, workflow_execution_id,
                   workflow_step_id, run_id, link_type, created_at
            FROM project_work_item_execution_links
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_session_id(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT id, project_work_item_id, session_id, workflow_execution_id,
                   workflow_step_id, run_id, link_type, created_at
            FROM project_work_item_execution_links
            WHERE session_id = ?1
            ORDER BY created_at ASC
            "#,
        )
        .bind(session_id)
        .fetch_all(pool)
        .await
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM project_work_item_execution_links WHERE id = ?1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}
