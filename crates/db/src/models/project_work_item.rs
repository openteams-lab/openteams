use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "project_work_item_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum ProjectWorkItemType {
    Feature,
    Bug,
    Task,
    Deploy,
    Test,
    Doc,
    Refactor,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "project_work_item_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum ProjectWorkItemStatus {
    Open,
    InProgress,
    Blocked,
    ReadyToMerge,
    Merging,
    Done,
    Cancelled,
    Duplicate,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "project_work_item_priority", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum ProjectWorkItemPriority {
    Low,
    Medium,
    High,
    Urgent,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "project_work_item_source", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum ProjectWorkItemSource {
    Manual,
    GithubIssue,
    Workflow,
    Session,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ProjectWorkItem {
    pub id: Uuid,
    pub project_id: Uuid,
    pub r#type: ProjectWorkItemType,
    pub status: ProjectWorkItemStatus,
    pub title: String,
    pub description: Option<String>,
    pub labels_json: Option<String>,
    pub priority: ProjectWorkItemPriority,
    pub source: ProjectWorkItemSource,
    pub created_by: Option<String>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateProjectWorkItem {
    pub r#type: ProjectWorkItemType,
    #[serde(default)]
    #[ts(optional)]
    pub status: Option<ProjectWorkItemStatus>,
    pub title: String,
    pub description: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub labels_json: Option<String>,
    pub priority: ProjectWorkItemPriority,
    pub source: ProjectWorkItemSource,
    pub created_by: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UpdateProjectWorkItem {
    pub r#type: Option<ProjectWorkItemType>,
    pub status: Option<ProjectWorkItemStatus>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub labels_json: Option<String>,
    pub priority: Option<ProjectWorkItemPriority>,
}

impl ProjectWorkItem {
    pub async fn create(
        pool: &SqlitePool,
        project_id: Uuid,
        input: CreateProjectWorkItem,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO project_work_items (
                id, project_id, type, status, title, description, labels_json, priority, source, created_by
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            RETURNING id, project_id, type, status, title, description, labels_json, priority, source,
                      created_by, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(project_id)
        .bind(input.r#type)
        .bind(input.status.unwrap_or(ProjectWorkItemStatus::Open))
        .bind(input.title)
        .bind(input.description)
        .bind(input.labels_json)
        .bind(input.priority)
        .bind(input.source)
        .bind(input.created_by)
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_project(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT id, project_id, type, status, title, description, labels_json, priority, source,
                   created_by, created_at, updated_at
            FROM project_work_items
            WHERE project_id = ?1
            ORDER BY updated_at DESC
            "#,
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT id, project_id, type, status, title, description, labels_json, priority, source,
                   created_by, created_at, updated_at
            FROM project_work_items
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        input: UpdateProjectWorkItem,
    ) -> Result<Self, sqlx::Error> {
        let existing = Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE project_work_items
            SET type = ?2,
                status = ?3,
                title = ?4,
                description = ?5,
                labels_json = ?6,
                priority = ?7,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, project_id, type, status, title, description, labels_json, priority, source,
                      created_by, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(input.r#type.unwrap_or(existing.r#type))
        .bind(input.status.unwrap_or(existing.status))
        .bind(input.title.unwrap_or(existing.title))
        .bind(input.description.or(existing.description))
        .bind(input.labels_json.or(existing.labels_json))
        .bind(input.priority.unwrap_or(existing.priority))
        .fetch_one(pool)
        .await
    }
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::{
        CreateProjectWorkItem, ProjectWorkItem, ProjectWorkItemPriority, ProjectWorkItemSource,
        ProjectWorkItemType,
    };
    use crate::models::{
        github_operation_audit::{
            CreateGitHubOperationAudit, GitHubOperationAudit, GitHubOperationResult,
            GitHubOperationSource, GitHubTargetType,
        },
        project_delivery_record::{
            CreateProjectDeliveryRecord, ProjectDeliveryEventTypeV2, ProjectDeliveryRecord,
        },
        project_work_item_execution_link::{
            CreateProjectWorkItemExecutionLink, ProjectExecutionLinkType,
            ProjectWorkItemExecutionLink,
        },
        project_work_item_external_link::{
            CreateProjectWorkItemExternalLink, ProjectExternalType, ProjectWorkItemExternalLink,
        },
    };

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        for statement in [
            "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
            "CREATE TABLE repos (id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL, display_name TEXT NOT NULL)",
            "CREATE TABLE project_repos (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, repo_id TEXT NOT NULL)",
            r#"
            CREATE TABLE project_work_items (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                labels_json TEXT,
                priority TEXT NOT NULL,
                source TEXT NOT NULL,
                created_by TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE project_work_item_external_links (
                id TEXT PRIMARY KEY,
                project_work_item_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                repo_id TEXT,
                external_type TEXT NOT NULL,
                external_id TEXT NOT NULL,
                number INTEGER,
                url TEXT,
                state TEXT,
                metadata_json TEXT,
                last_synced_at TEXT,
                stale BOOLEAN NOT NULL DEFAULT false,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            "CREATE UNIQUE INDEX idx_test_external_unique ON project_work_item_external_links(provider, repo_id, external_type, external_id)",
            r#"
            CREATE TABLE project_work_item_execution_links (
                id TEXT PRIMARY KEY,
                project_work_item_id TEXT NOT NULL,
                session_id TEXT,
                workflow_execution_id TEXT,
                workflow_step_id TEXT,
                run_id TEXT,
                link_type TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE project_delivery_records (
                id TEXT PRIMARY KEY,
                project_work_item_id TEXT,
                repo_id TEXT,
                external_link_id TEXT,
                event_type TEXT NOT NULL,
                external_id TEXT,
                url TEXT,
                actor TEXT,
                source_session_id TEXT,
                source_workflow_execution_id TEXT,
                metadata_json TEXT,
                occurred_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE github_operation_audits (
                id TEXT PRIMARY KEY,
                actor TEXT,
                operation_source TEXT NOT NULL,
                session_id TEXT,
                workflow_execution_id TEXT,
                repo_id TEXT,
                target_type TEXT NOT NULL,
                target_id TEXT,
                action TEXT NOT NULL,
                result TEXT NOT NULL,
                error TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            "CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, project_id TEXT)",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        pool
    }

    async fn create_item(pool: &SqlitePool, project_id: Uuid) -> ProjectWorkItem {
        ProjectWorkItem::create(
            pool,
            project_id,
            CreateProjectWorkItem {
                r#type: ProjectWorkItemType::Bug,
                status: None,
                title: "Fix issue".to_string(),
                description: None,
                labels_json: None,
                priority: ProjectWorkItemPriority::High,
                source: ProjectWorkItemSource::GithubIssue,
                created_by: Some("tester".to_string()),
            },
        )
        .await
        .expect("create project work item")
    }

    #[tokio::test]
    async fn create_item_respects_optional_status() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let open = ProjectWorkItem::create(
            &pool,
            project_id,
            CreateProjectWorkItem {
                r#type: ProjectWorkItemType::Task,
                status: None,
                title: "Open by default".to_string(),
                description: None,
                labels_json: None,
                priority: ProjectWorkItemPriority::Medium,
                source: ProjectWorkItemSource::Manual,
                created_by: None,
            },
        )
        .await
        .expect("create open item");
        assert_eq!(open.status, super::ProjectWorkItemStatus::Open);

        let done = ProjectWorkItem::create(
            &pool,
            project_id,
            CreateProjectWorkItem {
                r#type: ProjectWorkItemType::Task,
                status: Some(super::ProjectWorkItemStatus::Done),
                title: "Done import".to_string(),
                description: None,
                labels_json: None,
                priority: ProjectWorkItemPriority::Medium,
                source: ProjectWorkItemSource::GithubIssue,
                created_by: None,
            },
        )
        .await
        .expect("create done item");
        assert_eq!(done.status, super::ProjectWorkItemStatus::Done);
    }

    #[tokio::test]
    async fn github_issue_external_link_is_unique() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let repo_id = Uuid::new_v4();
        let item = create_item(&pool, project_id).await;

        let input = CreateProjectWorkItemExternalLink {
            provider: "github".to_string(),
            repo_id: Some(repo_id),
            external_type: ProjectExternalType::GithubIssue,
            external_id: "123".to_string(),
            number: Some(123),
            url: Some("https://github.test/o/r/issues/123".to_string()),
            state: Some("open".to_string()),
            metadata_json: None,
            last_synced_at: None,
            stale: false,
        };

        ProjectWorkItemExternalLink::create(&pool, item.id, input.clone())
            .await
            .expect("create issue link");
        let duplicate = ProjectWorkItemExternalLink::create(&pool, item.id, input).await;

        assert!(duplicate.is_err());
    }

    #[tokio::test]
    async fn execution_link_can_be_found_and_deleted() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let item = create_item(&pool, project_id).await;
        let session_id = Uuid::new_v4();

        let link = ProjectWorkItemExecutionLink::create(
            &pool,
            item.id,
            CreateProjectWorkItemExecutionLink {
                session_id: Some(session_id),
                workflow_execution_id: None,
                workflow_step_id: None,
                run_id: None,
                link_type: ProjectExecutionLinkType::DiscussedIn,
            },
        )
        .await
        .expect("create execution link");

        let found = ProjectWorkItemExecutionLink::find_by_id(&pool, link.id)
            .await
            .expect("find execution link")
            .expect("execution link exists");
        assert_eq!(found.session_id, Some(session_id));

        let deleted = ProjectWorkItemExecutionLink::delete(&pool, link.id)
            .await
            .expect("delete execution link");
        assert_eq!(deleted, 1);

        let missing = ProjectWorkItemExecutionLink::find_by_id(&pool, link.id)
            .await
            .expect("find deleted execution link");
        assert!(missing.is_none());
    }

    #[tokio::test]
    async fn delivery_records_query_by_project_work_item_and_repo() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let repo_id = Uuid::new_v4();
        let item = create_item(&pool, project_id).await;
        sqlx::query("INSERT INTO project_repos (id, project_id, repo_id) VALUES (?1, ?2, ?3)")
            .bind(Uuid::new_v4())
            .bind(project_id)
            .bind(repo_id)
            .execute(&pool)
            .await
            .unwrap();

        ProjectDeliveryRecord::create(
            &pool,
            CreateProjectDeliveryRecord {
                project_work_item_id: Some(item.id),
                repo_id: Some(repo_id),
                external_link_id: None,
                event_type: ProjectDeliveryEventTypeV2::PrOpened,
                external_id: Some("pr-1".to_string()),
                url: None,
                actor: Some("tester".to_string()),
                source_session_id: None,
                source_workflow_execution_id: None,
                metadata_json: None,
                occurred_at: None,
            },
        )
        .await
        .expect("create delivery record");

        let records =
            ProjectDeliveryRecord::find_by_project(&pool, project_id, Some(item.id), Some(repo_id))
                .await
                .expect("query delivery records");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].event_type, ProjectDeliveryEventTypeV2::PrOpened);
    }

    #[tokio::test]
    async fn audit_records_do_not_include_token_column() {
        let pool = setup_pool().await;
        let repo_id = Uuid::new_v4();
        let audit = GitHubOperationAudit::create(
            &pool,
            CreateGitHubOperationAudit {
                actor: Some("tester".to_string()),
                operation_source: GitHubOperationSource::UserUi,
                session_id: None,
                workflow_execution_id: None,
                repo_id: Some(repo_id),
                target_type: GitHubTargetType::Issue,
                target_id: Some("123".to_string()),
                action: "comment".to_string(),
                result: GitHubOperationResult::Success,
                error: None,
            },
        )
        .await
        .expect("create audit");

        assert_eq!(audit.repo_id, Some(repo_id));
        let token_column: Option<i64> = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('github_operation_audits') WHERE name LIKE '%token%'",
        )
        .fetch_one(&pool)
        .await
        .expect("inspect columns");
        assert_eq!(token_column, Some(0));
    }
}
