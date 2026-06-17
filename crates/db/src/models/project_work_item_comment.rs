use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ProjectWorkItemComment {
    pub id: Uuid,
    pub project_work_item_id: Uuid,
    pub body: String,
    pub author: Option<String>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateProjectWorkItemComment {
    pub body: String,
    pub author: Option<String>,
}

impl ProjectWorkItemComment {
    pub async fn create(
        pool: &SqlitePool,
        project_work_item_id: Uuid,
        input: CreateProjectWorkItemComment,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO project_work_item_comments (
                id, project_work_item_id, body, author
            ) VALUES (?1, ?2, ?3, ?4)
            RETURNING id, project_work_item_id, body, author, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(project_work_item_id)
        .bind(input.body)
        .bind(input.author)
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_work_item(
        pool: &SqlitePool,
        project_work_item_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT id, project_work_item_id, body, author, created_at, updated_at
            FROM project_work_item_comments
            WHERE project_work_item_id = ?1
            ORDER BY created_at ASC
            "#,
        )
        .bind(project_work_item_id)
        .fetch_all(pool)
        .await
    }
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::{CreateProjectWorkItemComment, ProjectWorkItemComment};

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::query(
            r#"
            CREATE TABLE project_work_item_comments (
                id TEXT PRIMARY KEY,
                project_work_item_id TEXT NOT NULL,
                body TEXT NOT NULL,
                author TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create comments table");
        pool
    }

    #[tokio::test]
    async fn comments_are_listed_in_creation_order() {
        let pool = setup_pool().await;
        let work_item_id = Uuid::new_v4();

        ProjectWorkItemComment::create(
            &pool,
            work_item_id,
            CreateProjectWorkItemComment {
                body: "first".to_string(),
                author: Some("tester".to_string()),
            },
        )
        .await
        .expect("create first comment");
        ProjectWorkItemComment::create(
            &pool,
            work_item_id,
            CreateProjectWorkItemComment {
                body: "second".to_string(),
                author: None,
            },
        )
        .await
        .expect("create second comment");

        let comments = ProjectWorkItemComment::find_by_work_item(&pool, work_item_id)
            .await
            .expect("list comments");

        assert_eq!(comments.len(), 2);
        assert_eq!(comments[0].body, "first");
        assert_eq!(comments[1].body, "second");
    }
}
