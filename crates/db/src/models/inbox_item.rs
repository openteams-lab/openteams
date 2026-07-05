use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

const INBOX_ITEM_COLUMNS: &str = r#"
    id,
    project_id,
    session_id,
    kind,
    severity,
    title,
    body,
    source_type,
    source_id,
    dedupe_key,
    read_at,
    archived_at,
    created_at,
    updated_at
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "inbox_item_severity", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum InboxItemSeverity {
    Info,
    Warning,
    Error,
}

impl std::fmt::Display for InboxItemSeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::Info => "info",
            Self::Warning => "warning",
            Self::Error => "error",
        };
        f.write_str(value)
    }
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct InboxItem {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub session_id: Option<Uuid>,
    pub kind: String,
    pub severity: InboxItemSeverity,
    pub title: String,
    pub body: Option<String>,
    pub source_type: String,
    pub source_id: Option<String>,
    pub dedupe_key: String,
    #[ts(type = "Date | null")]
    pub read_at: Option<DateTime<Utc>>,
    #[ts(type = "Date | null")]
    pub archived_at: Option<DateTime<Utc>>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct UpsertInboxItem {
    pub project_id: Option<Uuid>,
    pub session_id: Option<Uuid>,
    pub kind: String,
    pub severity: InboxItemSeverity,
    pub title: String,
    pub body: Option<String>,
    pub source_type: String,
    pub source_id: Option<String>,
    pub dedupe_key: String,
}

#[derive(Debug, Clone)]
pub struct InboxItemListFilter {
    pub project_id: Option<Uuid>,
    pub session_id: Option<Uuid>,
    pub unread_only: bool,
    pub include_archived: bool,
    pub limit: u32,
}

impl Default for InboxItemListFilter {
    fn default() -> Self {
        Self {
            project_id: None,
            session_id: None,
            unread_only: true,
            include_archived: false,
            limit: 50,
        }
    }
}

impl InboxItem {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "SELECT {INBOX_ITEM_COLUMNS} FROM inbox_items WHERE id = ?1"
        ))
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn upsert(
        pool: &SqlitePool,
        data: &UpsertInboxItem,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            r#"
            INSERT INTO inbox_items (
                id,
                project_id,
                session_id,
                kind,
                severity,
                title,
                body,
                source_type,
                source_id,
                dedupe_key
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(dedupe_key) DO UPDATE SET
                project_id = excluded.project_id,
                session_id = excluded.session_id,
                kind = excluded.kind,
                severity = excluded.severity,
                title = excluded.title,
                body = excluded.body,
                source_type = excluded.source_type,
                source_id = excluded.source_id,
                created_at = datetime('now', 'subsec'),
                updated_at = datetime('now', 'subsec')
            RETURNING {INBOX_ITEM_COLUMNS}
            "#
        ))
        .bind(id)
        .bind(data.project_id)
        .bind(data.session_id)
        .bind(&data.kind)
        .bind(data.severity)
        .bind(&data.title)
        .bind(&data.body)
        .bind(&data.source_type)
        .bind(&data.source_id)
        .bind(&data.dedupe_key)
        .fetch_one(pool)
        .await
    }

    pub async fn list(
        pool: &SqlitePool,
        filter: &InboxItemListFilter,
    ) -> Result<Vec<Self>, sqlx::Error> {
        let mut builder = QueryBuilder::<Sqlite>::new("SELECT ");
        builder.push(INBOX_ITEM_COLUMNS);
        builder.push(" FROM inbox_items WHERE 1 = 1");

        if let Some(project_id) = filter.project_id {
            builder.push(" AND project_id = ");
            builder.push_bind(project_id);
        }
        if let Some(session_id) = filter.session_id {
            builder.push(" AND session_id = ");
            builder.push_bind(session_id);
        }
        if filter.unread_only {
            builder.push(" AND read_at IS NULL");
        }
        if !filter.include_archived {
            builder.push(" AND archived_at IS NULL");
        }

        builder.push(" ORDER BY created_at DESC, id DESC LIMIT ");
        builder.push_bind(i64::from(filter.limit.clamp(1, 100)));

        builder.build_query_as::<Self>().fetch_all(pool).await
    }

    pub async fn mark_read(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            r#"
            UPDATE inbox_items
            SET read_at = COALESCE(read_at, datetime('now', 'subsec')),
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING {INBOX_ITEM_COLUMNS}
            "#
        ))
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn mark_many_read(pool: &SqlitePool, ids: &[Uuid]) -> Result<u64, sqlx::Error> {
        if ids.is_empty() {
            return Ok(0);
        }

        let mut builder = QueryBuilder::<Sqlite>::new(
            "UPDATE inbox_items SET read_at = COALESCE(read_at, datetime('now', 'subsec')), \
             updated_at = datetime('now', 'subsec') WHERE read_at IS NULL AND id IN (",
        );
        let mut separated = builder.separated(", ");
        for id in ids {
            separated.push_bind(id);
        }
        separated.push_unseparated(")");

        let result = builder.build().execute(pool).await?;
        Ok(result.rows_affected())
    }

    pub async fn mark_all_read(
        pool: &SqlitePool,
        project_id: Option<Uuid>,
        session_id: Option<Uuid>,
    ) -> Result<u64, sqlx::Error> {
        let mut builder = QueryBuilder::<Sqlite>::new(
            "UPDATE inbox_items SET read_at = COALESCE(read_at, datetime('now', 'subsec')), \
             updated_at = datetime('now', 'subsec') \
             WHERE read_at IS NULL AND archived_at IS NULL",
        );
        if let Some(project_id) = project_id {
            builder.push(" AND project_id = ");
            builder.push_bind(project_id);
        }
        if let Some(session_id) = session_id {
            builder.push(" AND session_id = ");
            builder.push_bind(session_id);
        }

        let result = builder.build().execute(pool).await?;
        Ok(result.rows_affected())
    }

    pub async fn archive(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            r#"
            UPDATE inbox_items
            SET archived_at = COALESCE(archived_at, datetime('now', 'subsec')),
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING {INBOX_ITEM_COLUMNS}
            "#
        ))
        .bind(id)
        .fetch_optional(pool)
        .await
    }
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::{InboxItem, InboxItemListFilter, InboxItemSeverity, UpsertInboxItem};

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::query(
            r#"
            CREATE TABLE inbox_items (
                id          BLOB NOT NULL PRIMARY KEY,
                project_id  BLOB,
                session_id  BLOB,
                kind        TEXT NOT NULL,
                severity    TEXT NOT NULL DEFAULT 'info'
                            CHECK (severity IN ('info', 'warning', 'error')),
                title       TEXT NOT NULL,
                body        TEXT,
                source_type TEXT NOT NULL,
                source_id   TEXT,
                dedupe_key  TEXT NOT NULL,
                read_at     TEXT,
                archived_at TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create inbox_items table");
        sqlx::query("CREATE UNIQUE INDEX idx_inbox_items_dedupe_key ON inbox_items(dedupe_key)")
            .execute(&pool)
            .await
            .expect("create dedupe index");
        pool
    }

    fn upsert_data(dedupe_key: &str, title: &str) -> UpsertInboxItem {
        UpsertInboxItem {
            project_id: Some(Uuid::new_v4()),
            session_id: Some(Uuid::new_v4()),
            kind: "workflow_review".to_string(),
            severity: InboxItemSeverity::Warning,
            title: title.to_string(),
            body: Some("body".to_string()),
            source_type: "workflow".to_string(),
            source_id: Some("review-1".to_string()),
            dedupe_key: dedupe_key.to_string(),
        }
    }

    #[tokio::test]
    async fn upsert_updates_existing_dedupe_key() {
        let pool = setup_pool().await;
        let first = InboxItem::upsert(
            &pool,
            &upsert_data("workflow:review:1", "Old"),
            Uuid::new_v4(),
        )
        .await
        .expect("insert item");
        let mut updated_data = upsert_data("workflow:review:1", "New");
        updated_data.severity = InboxItemSeverity::Error;
        updated_data.body = Some("updated body".to_string());

        let second = InboxItem::upsert(&pool, &updated_data, Uuid::new_v4())
            .await
            .expect("upsert item");

        assert_eq!(second.id, first.id);
        assert_eq!(second.title, "New");
        assert_eq!(second.body.as_deref(), Some("updated body"));
        assert_eq!(second.severity, InboxItemSeverity::Error);

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM inbox_items")
            .fetch_one(&pool)
            .await
            .expect("count items");
        assert_eq!(count.0, 1);
    }

    #[tokio::test]
    async fn list_defaults_to_unread_unarchived_created_desc() {
        let pool = setup_pool().await;
        let old = InboxItem::upsert(&pool, &upsert_data("old", "Old"), Uuid::new_v4())
            .await
            .expect("insert old");
        let read = InboxItem::upsert(&pool, &upsert_data("read", "Read"), Uuid::new_v4())
            .await
            .expect("insert read");
        let archived =
            InboxItem::upsert(&pool, &upsert_data("archived", "Archived"), Uuid::new_v4())
                .await
                .expect("insert archived");
        let newest = InboxItem::upsert(&pool, &upsert_data("newest", "Newest"), Uuid::new_v4())
            .await
            .expect("insert newest");

        sqlx::query("UPDATE inbox_items SET created_at = '2026-07-05T00:00:01Z' WHERE id = ?1")
            .bind(old.id)
            .execute(&pool)
            .await
            .expect("set old created_at");
        sqlx::query("UPDATE inbox_items SET created_at = '2026-07-05T00:00:02Z' WHERE id = ?1")
            .bind(read.id)
            .execute(&pool)
            .await
            .expect("set read created_at");
        sqlx::query("UPDATE inbox_items SET created_at = '2026-07-05T00:00:03Z' WHERE id = ?1")
            .bind(archived.id)
            .execute(&pool)
            .await
            .expect("set archived created_at");
        sqlx::query("UPDATE inbox_items SET created_at = '2026-07-05T00:00:04Z' WHERE id = ?1")
            .bind(newest.id)
            .execute(&pool)
            .await
            .expect("set newest created_at");
        InboxItem::mark_read(&pool, read.id)
            .await
            .expect("mark read");
        InboxItem::archive(&pool, archived.id)
            .await
            .expect("archive");

        let items = InboxItem::list(&pool, &InboxItemListFilter::default())
            .await
            .expect("list inbox");

        assert_eq!(
            items.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![newest.id, old.id]
        );
    }

    #[tokio::test]
    async fn mark_many_mark_all_and_archive_update_expected_rows() {
        let pool = setup_pool().await;
        let first = InboxItem::upsert(&pool, &upsert_data("first", "First"), Uuid::new_v4())
            .await
            .expect("insert first");
        let second = InboxItem::upsert(&pool, &upsert_data("second", "Second"), Uuid::new_v4())
            .await
            .expect("insert second");
        let third = InboxItem::upsert(&pool, &upsert_data("third", "Third"), Uuid::new_v4())
            .await
            .expect("insert third");

        assert_eq!(
            InboxItem::mark_many_read(&pool, &[first.id, second.id])
                .await
                .expect("mark many"),
            2
        );
        assert!(
            InboxItem::find_by_id(&pool, first.id)
                .await
                .expect("find first")
                .expect("first exists")
                .read_at
                .is_some()
        );

        let archived = InboxItem::archive(&pool, second.id)
            .await
            .expect("archive")
            .expect("archived item");
        assert!(archived.archived_at.is_some());

        assert_eq!(
            InboxItem::mark_all_read(&pool, None, None)
                .await
                .expect("mark all"),
            1
        );
        assert!(
            InboxItem::find_by_id(&pool, third.id)
                .await
                .expect("find third")
                .expect("third exists")
                .read_at
                .is_some()
        );
    }
}
