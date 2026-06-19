use anyhow::Result;
use chrono::NaiveDate;
use db::models::project_delivery_record::{
    CreateProjectDeliveryRecord, ProjectDeliveryEventTypeV2, ProjectDeliveryRecord,
    ProjectDeliveryStatsSummary,
};
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Clone, Default)]
pub struct ProjectDeliveryService;

impl ProjectDeliveryService {
    pub fn new() -> Self {
        Self
    }

    pub async fn create_record(
        &self,
        pool: &SqlitePool,
        input: CreateProjectDeliveryRecord,
    ) -> Result<ProjectDeliveryRecord> {
        Ok(ProjectDeliveryRecord::create(pool, input).await?)
    }

    pub async fn create_commit_records(
        &self,
        pool: &SqlitePool,
        session_id: Uuid,
        commit_sha: &str,
        short_sha: &str,
        branch: &str,
        message: &str,
        committed_paths: &[String],
        additions: usize,
        deletions: usize,
        work_item_ids: &[Uuid],
        force_shared: bool,
    ) -> std::result::Result<Vec<ProjectDeliveryRecord>, sqlx::Error> {
        let work_item_id_values = work_item_ids
            .iter()
            .map(Uuid::to_string)
            .collect::<Vec<_>>();
        let metadata_json = json!({
            "commit_sha": commit_sha,
            "short_sha": short_sha,
            "branch": branch,
            "message": message,
            "files": committed_paths,
            "additions": additions,
            "deletions": deletions,
            "work_item_ids": work_item_id_values,
            "force_shared": force_shared,
        })
        .to_string();

        let record_work_item_ids = if work_item_ids.is_empty() {
            vec![None]
        } else {
            work_item_ids.iter().copied().map(Some).collect()
        };

        let mut records = Vec::new();
        for work_item_id in record_work_item_ids {
            records.push(
                ProjectDeliveryRecord::create(
                    pool,
                    CreateProjectDeliveryRecord {
                        project_work_item_id: work_item_id,
                        repo_id: None,
                        external_link_id: None,
                        event_type: ProjectDeliveryEventTypeV2::CommitCreated,
                        external_id: Some(commit_sha.to_string()),
                        url: None,
                        actor: None,
                        source_session_id: Some(session_id),
                        source_workflow_execution_id: None,
                        metadata_json: Some(metadata_json.clone()),
                        occurred_at: None,
                    },
                )
                .await?,
            );
        }

        Ok(records)
    }

    pub async fn list_records(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        work_item_id: Option<Uuid>,
        repo_id: Option<Uuid>,
    ) -> Result<Vec<ProjectDeliveryRecord>> {
        Ok(ProjectDeliveryRecord::find_by_project(pool, project_id, work_item_id, repo_id).await?)
    }

    pub async fn stats_summary(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        period_start: NaiveDate,
        period_end: NaiveDate,
    ) -> Result<ProjectDeliveryStatsSummary> {
        Ok(
            ProjectDeliveryRecord::stats_summary(pool, project_id, period_start, period_end)
                .await?,
        )
    }
}
