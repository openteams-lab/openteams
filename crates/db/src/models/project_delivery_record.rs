use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Row, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "project_delivery_event_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum ProjectDeliveryEventTypeV2 {
    PrOpened,
    PrMerged,
    Deployment,
    Release,
    TestPassed,
    TestFailed,
    CommitCreated,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ProjectDeliveryRecord {
    pub id: Uuid,
    pub project_work_item_id: Option<Uuid>,
    pub repo_id: Option<Uuid>,
    pub external_link_id: Option<Uuid>,
    pub event_type: ProjectDeliveryEventTypeV2,
    pub external_id: Option<String>,
    pub url: Option<String>,
    pub actor: Option<String>,
    pub source_session_id: Option<Uuid>,
    pub source_workflow_execution_id: Option<Uuid>,
    pub metadata_json: Option<String>,
    #[ts(type = "Date")]
    pub occurred_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateProjectDeliveryRecord {
    pub project_work_item_id: Option<Uuid>,
    pub repo_id: Option<Uuid>,
    pub external_link_id: Option<Uuid>,
    pub event_type: ProjectDeliveryEventTypeV2,
    pub external_id: Option<String>,
    pub url: Option<String>,
    pub actor: Option<String>,
    pub source_session_id: Option<Uuid>,
    pub source_workflow_execution_id: Option<Uuid>,
    pub metadata_json: Option<String>,
    #[ts(type = "Date | null")]
    pub occurred_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ProjectDeliveryStatsSummary {
    #[ts(type = "string")]
    pub period_start: NaiveDate,
    #[ts(type = "string")]
    pub period_end: NaiveDate,
    pub pr_opened_count: i64,
    pub pr_merged_count: i64,
    pub deployment_count: i64,
    pub release_count: i64,
    pub test_passed_count: i64,
    pub test_failed_count: i64,
    pub commit_created_count: i64,
}

impl ProjectDeliveryRecord {
    pub async fn create(
        pool: &SqlitePool,
        input: CreateProjectDeliveryRecord,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO project_delivery_records (
                id, project_work_item_id, repo_id, external_link_id, event_type, external_id,
                url, actor, source_session_id, source_workflow_execution_id, metadata_json,
                occurred_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, COALESCE(?12, datetime('now', 'subsec')))
            RETURNING id, project_work_item_id, repo_id, external_link_id, event_type, external_id,
                      url, actor, source_session_id, source_workflow_execution_id, metadata_json,
                      occurred_at, created_at
            "#,
        )
        .bind(id)
        .bind(input.project_work_item_id)
        .bind(input.repo_id)
        .bind(input.external_link_id)
        .bind(input.event_type)
        .bind(input.external_id)
        .bind(input.url)
        .bind(input.actor)
        .bind(input.source_session_id)
        .bind(input.source_workflow_execution_id)
        .bind(input.metadata_json)
        .bind(input.occurred_at)
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_project(
        pool: &SqlitePool,
        project_id: Uuid,
        work_item_id: Option<Uuid>,
        repo_id: Option<Uuid>,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT dr.id, dr.project_work_item_id, dr.repo_id, dr.external_link_id,
                   dr.event_type, dr.external_id, dr.url, dr.actor, dr.source_session_id,
                   dr.source_workflow_execution_id, dr.metadata_json, dr.occurred_at, dr.created_at
            FROM project_delivery_records dr
            LEFT JOIN project_work_items pwi ON pwi.id = dr.project_work_item_id
            LEFT JOIN project_repos pr ON pr.repo_id = dr.repo_id
            LEFT JOIN chat_sessions cs ON cs.id = dr.source_session_id
            WHERE (pwi.project_id = ?1 OR pr.project_id = ?1 OR cs.project_id = ?1)
              AND (?2 IS NULL OR dr.project_work_item_id = ?2)
              AND (?3 IS NULL OR dr.repo_id = ?3)
            ORDER BY dr.occurred_at DESC
            "#,
        )
        .bind(project_id)
        .bind(work_item_id)
        .bind(repo_id)
        .fetch_all(pool)
        .await
    }

    pub async fn stats_summary(
        pool: &SqlitePool,
        project_id: Uuid,
        period_start: NaiveDate,
        period_end: NaiveDate,
    ) -> Result<ProjectDeliveryStatsSummary, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT dr.event_type, COUNT(*) AS count
            FROM project_delivery_records dr
            LEFT JOIN project_work_items pwi ON pwi.id = dr.project_work_item_id
            LEFT JOIN project_repos pr ON pr.repo_id = dr.repo_id
            LEFT JOIN chat_sessions cs ON cs.id = dr.source_session_id
            WHERE (pwi.project_id = ?1 OR pr.project_id = ?1 OR cs.project_id = ?1)
              AND date(dr.occurred_at) >= ?2
              AND date(dr.occurred_at) <= ?3
            GROUP BY dr.event_type
            "#,
        )
        .bind(project_id)
        .bind(period_start.to_string())
        .bind(period_end.to_string())
        .fetch_all(pool)
        .await?;

        let mut summary = ProjectDeliveryStatsSummary {
            period_start,
            period_end,
            pr_opened_count: 0,
            pr_merged_count: 0,
            deployment_count: 0,
            release_count: 0,
            test_passed_count: 0,
            test_failed_count: 0,
            commit_created_count: 0,
        };

        for row in rows {
            let event_type: String = row.try_get("event_type")?;
            let count: i64 = row.try_get("count")?;
            match event_type.as_str() {
                "pr_opened" => summary.pr_opened_count = count,
                "pr_merged" => summary.pr_merged_count = count,
                "deployment" => summary.deployment_count = count,
                "release" => summary.release_count = count,
                "test_passed" => summary.test_passed_count = count,
                "test_failed" => summary.test_failed_count = count,
                "commit_created" => summary.commit_created_count = count,
                _ => {}
            }
        }

        Ok(summary)
    }
}
