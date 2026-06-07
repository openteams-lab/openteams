use anyhow::{Result, anyhow};
use db::models::{
    github_operation_audit::GitHubOperationAudit,
    project_delivery_record::ProjectDeliveryRecord,
    project_repo::ProjectRepo,
    project_work_item::{CreateProjectWorkItem, ProjectWorkItem, UpdateProjectWorkItem},
    project_work_item_execution_link::{
        CreateProjectWorkItemExecutionLink, ProjectWorkItemExecutionLink,
    },
    project_work_item_external_link::{
        CreateProjectWorkItemExternalLink, ProjectWorkItemExternalLink,
    },
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;
use uuid::Uuid;

use crate::services::github::rest_client::GitHubIssueDetail;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ProjectWorkItemDetail {
    pub work_item: ProjectWorkItem,
    pub external_links: Vec<ProjectWorkItemExternalLink>,
    pub execution_links: Vec<ProjectWorkItemExecutionLink>,
    pub delivery_records: Vec<ProjectDeliveryRecord>,
    pub github_audits: Vec<GitHubOperationAudit>,
    pub github_issue_detail: Option<GitHubIssueDetail>,
}

#[derive(Clone, Default)]
pub struct ProjectWorkItemService;

impl ProjectWorkItemService {
    pub fn new() -> Self {
        Self
    }

    pub async fn list(&self, pool: &SqlitePool, project_id: Uuid) -> Result<Vec<ProjectWorkItem>> {
        Ok(ProjectWorkItem::find_by_project(pool, project_id).await?)
    }

    pub async fn create(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        input: CreateProjectWorkItem,
    ) -> Result<ProjectWorkItem> {
        Ok(ProjectWorkItem::create(pool, project_id, input).await?)
    }

    pub async fn update(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        work_item_id: Uuid,
        input: UpdateProjectWorkItem,
    ) -> Result<ProjectWorkItem> {
        let existing = ProjectWorkItem::find_by_id(pool, work_item_id)
            .await?
            .ok_or_else(|| anyhow!("Project work item not found"))?;
        if existing.project_id != project_id {
            return Err(anyhow!("Project work item not found"));
        }
        Ok(ProjectWorkItem::update(pool, work_item_id, input).await?)
    }

    pub async fn detail(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        work_item_id: Uuid,
    ) -> Result<ProjectWorkItemDetail> {
        let work_item = ProjectWorkItem::find_by_id(pool, work_item_id)
            .await?
            .ok_or_else(|| anyhow!("Project work item not found"))?;
        if work_item.project_id != project_id {
            return Err(anyhow!("Project work item not found"));
        }
        let external_links =
            ProjectWorkItemExternalLink::find_by_work_item(pool, work_item_id).await?;
        let execution_links =
            ProjectWorkItemExecutionLink::find_by_work_item(pool, work_item_id).await?;
        let delivery_records =
            ProjectDeliveryRecord::find_by_project(pool, project_id, Some(work_item_id), None)
                .await?;
        let github_audits = crate::services::github::audit::GitHubAuditService::new()
            .list_by_project(pool, project_id, None, Some(work_item_id))
            .await?;
        Ok(ProjectWorkItemDetail {
            work_item,
            external_links,
            execution_links,
            delivery_records,
            github_audits,
            github_issue_detail: None,
        })
    }

    pub async fn link_external(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        work_item_id: Uuid,
        input: CreateProjectWorkItemExternalLink,
    ) -> Result<ProjectWorkItemExternalLink> {
        let work_item = ProjectWorkItem::find_by_id(pool, work_item_id)
            .await?
            .ok_or_else(|| anyhow!("Project work item not found"))?;
        if work_item.project_id != project_id {
            return Err(anyhow!("Project work item not found"));
        }
        if let Some(repo_id) = input.repo_id
            && ProjectRepo::find_by_project_and_repo(pool, project_id, repo_id)
                .await?
                .is_none()
        {
            return Err(anyhow!("Repository does not belong to project"));
        }
        if let Some(existing) = ProjectWorkItemExternalLink::find_by_external(
            pool,
            &input.provider,
            input.repo_id,
            input.external_type.clone(),
            &input.external_id,
        )
        .await?
        {
            return Ok(existing);
        }
        Ok(ProjectWorkItemExternalLink::create(pool, work_item_id, input).await?)
    }

    pub async fn unlink_external(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        work_item_id: Uuid,
        link_id: Uuid,
    ) -> Result<u64> {
        let work_item = ProjectWorkItem::find_by_id(pool, work_item_id)
            .await?
            .ok_or_else(|| anyhow!("Project work item not found"))?;
        if work_item.project_id != project_id {
            return Err(anyhow!("Project work item not found"));
        }
        let link = ProjectWorkItemExternalLink::find_by_id(pool, link_id)
            .await?
            .ok_or_else(|| anyhow!("Project work item external link not found"))?;
        if link.project_work_item_id != work_item_id {
            return Err(anyhow!("Project work item external link not found"));
        }
        Ok(ProjectWorkItemExternalLink::delete(pool, link_id).await?)
    }

    pub async fn link_execution(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        work_item_id: Uuid,
        input: CreateProjectWorkItemExecutionLink,
    ) -> Result<ProjectWorkItemExecutionLink> {
        let work_item = ProjectWorkItem::find_by_id(pool, work_item_id)
            .await?
            .ok_or_else(|| anyhow!("Project work item not found"))?;
        if work_item.project_id != project_id {
            return Err(anyhow!("Project work item not found"));
        }
        Ok(ProjectWorkItemExecutionLink::create(pool, work_item_id, input).await?)
    }
}
