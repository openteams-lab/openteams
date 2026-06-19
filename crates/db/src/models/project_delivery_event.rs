use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "project_delivery_event_type", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum ProjectDeliveryEventType {
    Feature,
    Bugfix,
    Test,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ProjectDeliveryEvent {
    pub id: Uuid,
    pub project_id: Uuid,
    pub session_id: Option<Uuid>,
    pub workflow_execution_id: Option<Uuid>,
    pub step_id: Option<Uuid>,
    pub event_type: ProjectDeliveryEventType,
    pub title: Option<String>,
    pub source: Option<String>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
}

impl ProjectDeliveryEvent {
    #[allow(clippy::too_many_arguments)]
    pub async fn create(
        pool: &SqlitePool,
        project_id: Uuid,
        event_type: ProjectDeliveryEventType,
        session_id: Option<Uuid>,
        workflow_execution_id: Option<Uuid>,
        step_id: Option<Uuid>,
        title: Option<String>,
        source: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();

        sqlx::query_as!(
            ProjectDeliveryEvent,
            r#"INSERT INTO project_delivery_events (
                    id,
                    project_id,
                    session_id,
                    workflow_execution_id,
                    step_id,
                    event_type,
                    title,
                    source
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id as "id!: Uuid",
                         project_id as "project_id!: Uuid",
                         session_id as "session_id: Uuid",
                         workflow_execution_id as "workflow_execution_id: Uuid",
                         step_id as "step_id: Uuid",
                         event_type as "event_type!: ProjectDeliveryEventType",
                         title,
                         source,
                         created_at as "created_at!: DateTime<Utc>""#,
            id,
            project_id,
            session_id,
            workflow_execution_id,
            step_id,
            event_type,
            title,
            source
        )
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_project(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ProjectDeliveryEvent,
            r#"SELECT id as "id!: Uuid",
                      project_id as "project_id!: Uuid",
                      session_id as "session_id: Uuid",
                      workflow_execution_id as "workflow_execution_id: Uuid",
                      step_id as "step_id: Uuid",
                      event_type as "event_type!: ProjectDeliveryEventType",
                      title,
                      source,
                      created_at as "created_at!: DateTime<Utc>"
               FROM project_delivery_events
               WHERE project_id = $1
               ORDER BY created_at DESC"#,
            project_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_project_and_period(
        pool: &SqlitePool,
        project_id: Uuid,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ProjectDeliveryEvent,
            r#"SELECT id as "id!: Uuid",
                      project_id as "project_id!: Uuid",
                      session_id as "session_id: Uuid",
                      workflow_execution_id as "workflow_execution_id: Uuid",
                      step_id as "step_id: Uuid",
                      event_type as "event_type!: ProjectDeliveryEventType",
                      title,
                      source,
                      created_at as "created_at!: DateTime<Utc>"
               FROM project_delivery_events
               WHERE project_id = $1
                 AND created_at >= $2
                 AND created_at < $3
               ORDER BY created_at DESC"#,
            project_id,
            start,
            end
        )
        .fetch_all(pool)
        .await
    }
}
