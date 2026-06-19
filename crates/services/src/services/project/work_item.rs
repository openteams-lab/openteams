use anyhow::{Result, anyhow};
use db::models::{
    github_operation_audit::GitHubOperationAudit,
    project_delivery_record::ProjectDeliveryRecord,
    project_repo::ProjectRepo,
    project_work_item::{CreateProjectWorkItem, ProjectWorkItem, UpdateProjectWorkItem},
    project_work_item_comment::{CreateProjectWorkItemComment, ProjectWorkItemComment},
    project_work_item_execution_link::{
        CreateProjectWorkItemExecutionLink, ProjectWorkItemExecutionLink,
    },
    project_work_item_external_link::{
        CreateProjectWorkItemExternalLink, ProjectExternalType, ProjectWorkItemExternalLink,
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
    pub comments: Vec<ProjectWorkItemComment>,
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

    pub async fn list_by_session(
        &self,
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Vec<ProjectWorkItem>> {
        let links = ProjectWorkItemExecutionLink::find_by_session_id(pool, session_id).await?;
        let work_item_ids: Vec<Uuid> = links
            .into_iter()
            .map(|link| link.project_work_item_id)
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();
        let mut items = Vec::new();
        for id in work_item_ids {
            if let Some(item) = ProjectWorkItem::find_by_id(pool, id).await? {
                items.push(item);
            }
        }
        items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(items)
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

    pub async fn delete(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        work_item_id: Uuid,
    ) -> Result<u64> {
        let existing = ProjectWorkItem::find_by_id(pool, work_item_id)
            .await?
            .ok_or_else(|| anyhow!("Project work item not found"))?;
        if existing.project_id != project_id {
            return Err(anyhow!("Project work item not found"));
        }

        let mut tx = pool.begin().await?;
        sqlx::query(
            r#"
            UPDATE project_delivery_records
            SET external_link_id = NULL
            WHERE external_link_id IN (
                SELECT id
                FROM project_work_item_external_links
                WHERE project_work_item_id = ?1
            )
            "#,
        )
        .bind(work_item_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE project_delivery_records SET project_work_item_id = NULL WHERE project_work_item_id = ?1",
        )
        .bind(work_item_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE github_pending_pr_creations SET work_item_id = NULL WHERE work_item_id = ?1",
        )
        .bind(work_item_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM project_work_item_comments WHERE project_work_item_id = ?1")
            .bind(work_item_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "DELETE FROM project_work_item_execution_links WHERE project_work_item_id = ?1",
        )
        .bind(work_item_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM project_work_item_external_links WHERE project_work_item_id = ?1")
            .bind(work_item_id)
            .execute(&mut *tx)
            .await?;
        let result = sqlx::query("DELETE FROM project_work_items WHERE id = ?1")
            .bind(work_item_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(result.rows_affected())
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
        let github_issue_detail = external_links.iter().find_map(cached_github_issue_detail);
        let comments = ProjectWorkItemComment::find_by_work_item(pool, work_item_id).await?;
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
            comments,
            execution_links,
            delivery_records,
            github_audits,
            github_issue_detail,
        })
    }

    pub async fn create_comment(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        work_item_id: Uuid,
        input: CreateProjectWorkItemComment,
    ) -> Result<ProjectWorkItemComment> {
        let work_item = ProjectWorkItem::find_by_id(pool, work_item_id)
            .await?
            .ok_or_else(|| anyhow!("Project work item not found"))?;
        if work_item.project_id != project_id {
            return Err(anyhow!("Project work item not found"));
        }
        let body = input.body.trim().to_string();
        if body.is_empty() {
            return Err(anyhow!("Comment body is required"));
        }
        let comment = ProjectWorkItemComment::create(
            pool,
            work_item_id,
            CreateProjectWorkItemComment {
                body,
                author: input.author,
            },
        )
        .await?;
        sqlx::query(
            "UPDATE project_work_items SET updated_at = datetime('now', 'subsec') WHERE id = ?1",
        )
        .bind(work_item_id)
        .execute(pool)
        .await?;
        Ok(comment)
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

    pub async fn unlink_execution(
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
        let link = ProjectWorkItemExecutionLink::find_by_id(pool, link_id)
            .await?
            .ok_or_else(|| anyhow!("Project work item execution link not found"))?;
        if link.project_work_item_id != work_item_id {
            return Err(anyhow!("Project work item execution link not found"));
        }
        Ok(ProjectWorkItemExecutionLink::delete(pool, link_id).await?)
    }
}

fn cached_github_issue_detail(link: &ProjectWorkItemExternalLink) -> Option<GitHubIssueDetail> {
    if link.provider != "github" || link.external_type != ProjectExternalType::GithubIssue {
        return None;
    }
    serde_json::from_str(link.metadata_json.as_deref()?).ok()
}
