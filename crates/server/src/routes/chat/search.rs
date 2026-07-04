use axum::{
    extract::{Query, State},
    response::Json as ResponseJson,
};
use chrono::{DateTime, Utc};
use db::models::{
    chat_message::ChatSenderType,
    chat_session_worktree::SessionWorktreeStatus,
    project_work_item::{ProjectWorkItemPriority, ProjectWorkItemStatus},
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

const SEARCH_RESULT_LIMIT: i64 = 12;
const RECENT_SESSION_LIMIT: i64 = 8;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum ChatSearchMode {
    All,
    Worktree,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, TS)]
pub struct ChatSearchQuery {
    #[serde(default)]
    #[ts(optional, type = "string | null")]
    pub project_id: Option<Uuid>,
    #[serde(default)]
    #[ts(optional, type = "string | null")]
    pub q: Option<String>,
    #[serde(default)]
    #[ts(optional, type = "ChatSearchMode | null")]
    pub mode: Option<ChatSearchMode>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct ChatSearchResponse {
    pub results: Vec<ChatSearchResult>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(tag = "type", rename_all = "snake_case")]
pub enum ChatSearchResult {
    Session {
        session_id: Uuid,
        title: String,
        snippet: Option<String>,
        updated_at: DateTime<Utc>,
    },
    Issue {
        issue_id: Uuid,
        project_id: Uuid,
        title: String,
        snippet: Option<String>,
        status: ProjectWorkItemStatus,
        priority: ProjectWorkItemPriority,
        updated_at: DateTime<Utc>,
    },
    Message {
        message_id: Uuid,
        session_id: Uuid,
        session_title: String,
        snippet: String,
        sender_type: ChatSenderType,
        sender_id: Option<Uuid>,
        sender_label: String,
        message_time: DateTime<Utc>,
    },
    Worktree {
        session_id: Uuid,
        session_title: String,
        worktree_id: Uuid,
        status: SessionWorktreeStatus,
        branch_name: String,
        path_summary: String,
        updated_at: DateTime<Utc>,
    },
}

#[derive(Debug, FromRow)]
struct SessionSearchRow {
    id: Uuid,
    title: Option<String>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct IssueSearchRow {
    id: Uuid,
    project_id: Uuid,
    title: String,
    description: Option<String>,
    status: ProjectWorkItemStatus,
    priority: ProjectWorkItemPriority,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct MessageSearchRow {
    id: Uuid,
    session_id: Uuid,
    session_title: Option<String>,
    sender_type: ChatSenderType,
    sender_id: Option<Uuid>,
    content: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct WorktreeSearchRow {
    session_id: Uuid,
    session_title: Option<String>,
    worktree_id: Uuid,
    status: SessionWorktreeStatus,
    branch_name: String,
    worktree_path: String,
    updated_at: DateTime<Utc>,
}

pub async fn search_chat(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ChatSearchQuery>,
) -> Result<ResponseJson<ApiResponse<ChatSearchResponse>>, ApiError> {
    let response = search_chat_records(&deployment.db().pool, query).await?;
    Ok(ResponseJson(ApiResponse::success(response)))
}

async fn search_chat_records(
    pool: &SqlitePool,
    query: ChatSearchQuery,
) -> Result<ChatSearchResponse, sqlx::Error> {
    let q = query.q.as_deref().unwrap_or_default().trim();

    if query.mode == Some(ChatSearchMode::Worktree) {
        return Ok(ChatSearchResponse {
            results: search_worktrees(pool, query.project_id, q).await?,
        });
    }

    if q.is_empty() {
        return Ok(ChatSearchResponse {
            results: recent_sessions(pool, query.project_id).await?,
        });
    }

    let session_results = search_session_titles(pool, query.project_id, q).await?;
    if !session_results.is_empty() {
        return Ok(ChatSearchResponse {
            results: session_results,
        });
    }

    let issue_results = search_issues(pool, query.project_id, q).await?;
    if !issue_results.is_empty() {
        return Ok(ChatSearchResponse {
            results: issue_results,
        });
    }

    Ok(ChatSearchResponse {
        results: search_messages(pool, query.project_id, q).await?,
    })
}

async fn recent_sessions(
    pool: &SqlitePool,
    project_id: Option<Uuid>,
) -> Result<Vec<ChatSearchResult>, sqlx::Error> {
    let rows = sqlx::query_as::<_, SessionSearchRow>(
        r#"
        SELECT id, title, updated_at
        FROM chat_sessions
        WHERE status = 'active'
          AND ((?1 IS NULL AND project_id IS NULL) OR project_id = ?1)
        ORDER BY updated_at DESC
        LIMIT ?2
        "#,
    )
    .bind(project_id)
    .bind(RECENT_SESSION_LIMIT)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| ChatSearchResult::Session {
            session_id: row.id,
            title: session_title(row.title),
            snippet: None,
            updated_at: row.updated_at,
        })
        .collect())
}

async fn search_session_titles(
    pool: &SqlitePool,
    project_id: Option<Uuid>,
    q: &str,
) -> Result<Vec<ChatSearchResult>, sqlx::Error> {
    let pattern = like_pattern(q);
    let rows = sqlx::query_as::<_, SessionSearchRow>(
        r#"
        SELECT id, title, updated_at
        FROM chat_sessions
        WHERE status = 'active'
          AND ((?1 IS NULL AND project_id IS NULL) OR project_id = ?1)
          AND LOWER(COALESCE(title, '')) LIKE LOWER(?2) ESCAPE '\'
        ORDER BY updated_at DESC
        LIMIT ?3
        "#,
    )
    .bind(project_id)
    .bind(pattern)
    .bind(SEARCH_RESULT_LIMIT)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let title = session_title(row.title);
            ChatSearchResult::Session {
                session_id: row.id,
                snippet: Some(snippet_for(&title, q)),
                title,
                updated_at: row.updated_at,
            }
        })
        .collect())
}

async fn search_issues(
    pool: &SqlitePool,
    project_id: Option<Uuid>,
    q: &str,
) -> Result<Vec<ChatSearchResult>, sqlx::Error> {
    let Some(project_id) = project_id else {
        return Ok(Vec::new());
    };
    let pattern = like_pattern(q);
    let rows = sqlx::query_as::<_, IssueSearchRow>(
        r#"
        SELECT id, project_id, title, description, status, priority, updated_at
        FROM project_work_items
        WHERE project_id = ?1
          AND (
            LOWER(title) LIKE LOWER(?2) ESCAPE '\'
            OR LOWER(COALESCE(description, '')) LIKE LOWER(?2) ESCAPE '\'
          )
        ORDER BY updated_at DESC
        LIMIT ?3
        "#,
    )
    .bind(project_id)
    .bind(pattern)
    .bind(SEARCH_RESULT_LIMIT)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let snippet_source = row
                .description
                .as_deref()
                .filter(|description| contains_query(description, q))
                .unwrap_or(row.title.as_str());
            let snippet = Some(snippet_for(snippet_source, q));
            ChatSearchResult::Issue {
                issue_id: row.id,
                project_id: row.project_id,
                title: row.title,
                snippet,
                status: row.status,
                priority: row.priority,
                updated_at: row.updated_at,
            }
        })
        .collect())
}

async fn search_messages(
    pool: &SqlitePool,
    project_id: Option<Uuid>,
    q: &str,
) -> Result<Vec<ChatSearchResult>, sqlx::Error> {
    let pattern = like_pattern(q);
    let rows = sqlx::query_as::<_, MessageSearchRow>(
        r#"
        SELECT m.id,
               m.session_id,
               s.title AS session_title,
               m.sender_type,
               m.sender_id,
               m.content,
               m.created_at
        FROM chat_messages m
        INNER JOIN chat_sessions s ON s.id = m.session_id
        WHERE s.status = 'active'
          AND ((?1 IS NULL AND s.project_id IS NULL) OR s.project_id = ?1)
          AND LOWER(m.content) LIKE LOWER(?2) ESCAPE '\'
        ORDER BY m.created_at DESC
        LIMIT ?3
        "#,
    )
    .bind(project_id)
    .bind(pattern)
    .bind(SEARCH_RESULT_LIMIT)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let sender_label = sender_label(&row.sender_type).to_string();
            ChatSearchResult::Message {
                message_id: row.id,
                session_id: row.session_id,
                session_title: session_title(row.session_title),
                snippet: snippet_for(&row.content, q),
                sender_type: row.sender_type,
                sender_id: row.sender_id,
                sender_label,
                message_time: row.created_at,
            }
        })
        .collect())
}

async fn search_worktrees(
    pool: &SqlitePool,
    project_id: Option<Uuid>,
    q: &str,
) -> Result<Vec<ChatSearchResult>, sqlx::Error> {
    let pattern = like_pattern(q);
    let rows = sqlx::query_as::<_, WorktreeSearchRow>(
        r#"
        SELECT s.id AS session_id,
               s.title AS session_title,
               w.id AS worktree_id,
               w.status,
               w.branch_name,
               w.worktree_path,
               w.updated_at
        FROM chat_sessions s
        INNER JOIN chat_session_worktrees w
          ON w.id = (
            SELECT w2.id
            FROM chat_session_worktrees w2
            WHERE w2.session_id = s.id
              AND w2.status IN (
                'creating', 'active', 'dirty', 'merging',
                'needs_conflict_resolution', 'merged',
                'cleanup_pending', 'cleanup_failed'
              )
            ORDER BY w2.updated_at DESC, w2.created_at DESC
            LIMIT 1
          )
        WHERE s.status = 'active'
          AND ((?1 IS NULL AND s.project_id IS NULL) OR s.project_id = ?1)
          AND (
            LOWER(COALESCE(s.title, '')) LIKE LOWER(?2) ESCAPE '\'
            OR LOWER(w.branch_name) LIKE LOWER(?2) ESCAPE '\'
            OR LOWER(w.worktree_path) LIKE LOWER(?2) ESCAPE '\'
            OR LOWER(w.status) LIKE LOWER(?2) ESCAPE '\'
          )
        ORDER BY COALESCE(w.last_used_at, w.updated_at) DESC, s.updated_at DESC
        "#,
    )
    .bind(project_id)
    .bind(pattern)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| ChatSearchResult::Worktree {
            session_id: row.session_id,
            session_title: session_title(row.session_title),
            worktree_id: row.worktree_id,
            status: row.status,
            branch_name: row.branch_name,
            path_summary: summarize_path(&row.worktree_path),
            updated_at: row.updated_at,
        })
        .collect())
}

fn like_pattern(raw: &str) -> String {
    let mut pattern = String::with_capacity(raw.len() + 2);
    pattern.push('%');
    for ch in raw.chars() {
        if matches!(ch, '%' | '_' | '\\') {
            pattern.push('\\');
        }
        pattern.push(ch);
    }
    pattern.push('%');
    pattern
}

fn contains_query(value: &str, q: &str) -> bool {
    value.to_ascii_lowercase().contains(&q.to_ascii_lowercase())
}

fn snippet_for(content: &str, q: &str) -> String {
    let compact = compact_whitespace(content);
    if compact.chars().count() <= 180 && q.trim().is_empty() {
        return compact;
    }

    let needle = q.trim().to_ascii_lowercase();
    let match_byte = if needle.is_empty() {
        0
    } else {
        compact
            .to_ascii_lowercase()
            .find(&needle)
            .unwrap_or_default()
    };

    let chars = compact.chars().collect::<Vec<_>>();
    let match_char = compact[..match_byte].chars().count();
    let start = match_char.saturating_sub(48);
    let end = (start + 160).min(chars.len());
    let mut snippet = chars[start..end].iter().collect::<String>();
    if start > 0 {
        snippet.insert_str(0, "...");
    }
    if end < chars.len() {
        snippet.push_str("...");
    }
    snippet
}

fn compact_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn session_title(title: Option<String>) -> String {
    title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Untitled session".to_string())
}

fn sender_label(sender_type: &ChatSenderType) -> &'static str {
    match sender_type {
        ChatSenderType::User => "User",
        ChatSenderType::Agent => "Agent",
        ChatSenderType::System => "System",
    }
}

fn summarize_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let parts = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    match parts.as_slice() {
        [] => path.to_string(),
        [only] => (*only).to_string(),
        _ => format!("{}/{}", parts[parts.len() - 2], parts[parts.len() - 1]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");

        for statement in [
            r#"
            CREATE TABLE chat_sessions (
                id BLOB PRIMARY KEY,
                title TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                project_id BLOB,
                updated_at TEXT NOT NULL
            )
            "#,
            r#"
            CREATE TABLE project_work_items (
                id BLOB PRIMARY KEY,
                project_id BLOB NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL,
                priority TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            "#,
            r#"
            CREATE TABLE chat_messages (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                sender_type TEXT NOT NULL,
                sender_id BLOB,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            "#,
            r#"
            CREATE TABLE chat_session_worktrees (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                status TEXT NOT NULL,
                branch_name TEXT NOT NULL,
                worktree_path TEXT NOT NULL,
                last_used_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            "#,
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }

        pool
    }

    async fn insert_session(
        pool: &SqlitePool,
        id: Uuid,
        project_id: Option<Uuid>,
        title: &str,
        updated_at: &str,
    ) {
        insert_session_with_status(pool, id, project_id, title, "active", updated_at).await;
    }

    async fn insert_session_with_status(
        pool: &SqlitePool,
        id: Uuid,
        project_id: Option<Uuid>,
        title: &str,
        status: &str,
        updated_at: &str,
    ) {
        sqlx::query(
            r#"
            INSERT INTO chat_sessions (id, title, status, project_id, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
        )
        .bind(id)
        .bind(title)
        .bind(status)
        .bind(project_id)
        .bind(updated_at)
        .execute(pool)
        .await
        .expect("insert session");
    }

    async fn insert_issue(
        pool: &SqlitePool,
        id: Uuid,
        project_id: Uuid,
        title: &str,
        description: Option<&str>,
        updated_at: &str,
    ) {
        sqlx::query(
            r#"
            INSERT INTO project_work_items (
                id, project_id, title, description, status, priority, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, 'open', 'medium', ?5)
            "#,
        )
        .bind(id)
        .bind(project_id)
        .bind(title)
        .bind(description)
        .bind(updated_at)
        .execute(pool)
        .await
        .expect("insert issue");
    }

    async fn insert_message(
        pool: &SqlitePool,
        id: Uuid,
        session_id: Uuid,
        sender_type: &str,
        content: &str,
        created_at: &str,
    ) {
        sqlx::query(
            r#"
            INSERT INTO chat_messages (id, session_id, sender_type, content, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
        )
        .bind(id)
        .bind(session_id)
        .bind(sender_type)
        .bind(content)
        .bind(created_at)
        .execute(pool)
        .await
        .expect("insert message");
    }

    async fn insert_worktree(
        pool: &SqlitePool,
        id: Uuid,
        session_id: Uuid,
        status: &str,
        branch_name: &str,
        worktree_path: &str,
        updated_at: &str,
    ) {
        sqlx::query(
            r#"
            INSERT INTO chat_session_worktrees (
                id, session_id, status, branch_name, worktree_path,
                created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
            "#,
        )
        .bind(id)
        .bind(session_id)
        .bind(status)
        .bind(branch_name)
        .bind(worktree_path)
        .bind(updated_at)
        .execute(pool)
        .await
        .expect("insert worktree");
    }

    #[tokio::test]
    async fn search_returns_session_titles_before_other_matches() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        insert_session(
            &pool,
            session_id,
            Some(project_id),
            "Search modal polish",
            "2026-07-04T00:00:00Z",
        )
        .await;
        insert_issue(
            &pool,
            Uuid::new_v4(),
            project_id,
            "Search modal issue",
            None,
            "2026-07-04T00:01:00Z",
        )
        .await;
        insert_message(
            &pool,
            Uuid::new_v4(),
            session_id,
            "user",
            "Search modal message body",
            "2026-07-04T00:02:00Z",
        )
        .await;

        let response = search_chat_records(
            &pool,
            ChatSearchQuery {
                project_id: Some(project_id),
                q: Some("search".to_string()),
                mode: None,
            },
        )
        .await
        .expect("search");

        assert_eq!(response.results.len(), 1);
        assert!(matches!(
            &response.results[0],
            ChatSearchResult::Session {
                session_id: id, ..
            } if *id == session_id
        ));
    }

    #[tokio::test]
    async fn search_returns_issue_matches_when_session_titles_do_not_match() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        let issue_id = Uuid::new_v4();
        insert_session(
            &pool,
            session_id,
            Some(project_id),
            "General planning",
            "2026-07-04T00:00:00Z",
        )
        .await;
        insert_issue(
            &pool,
            issue_id,
            project_id,
            "Fix dashboard",
            Some("Keyboard navigation is broken"),
            "2026-07-04T00:01:00Z",
        )
        .await;
        insert_message(
            &pool,
            Uuid::new_v4(),
            session_id,
            "user",
            "Keyboard navigation appears in a message too",
            "2026-07-04T00:02:00Z",
        )
        .await;

        let response = search_chat_records(
            &pool,
            ChatSearchQuery {
                project_id: Some(project_id),
                q: Some("keyboard".to_string()),
                mode: None,
            },
        )
        .await
        .expect("search");

        assert_eq!(response.results.len(), 1);
        assert!(matches!(
            &response.results[0],
            ChatSearchResult::Issue { issue_id: id, .. } if *id == issue_id
        ));
    }

    #[tokio::test]
    async fn search_returns_issue_title_and_description_matches_before_messages() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        let title_issue_id = Uuid::new_v4();
        let description_issue_id = Uuid::new_v4();
        insert_session(
            &pool,
            session_id,
            Some(project_id),
            "General planning",
            "2026-07-04T00:00:00Z",
        )
        .await;
        insert_issue(
            &pool,
            title_issue_id,
            project_id,
            "Delta title match",
            None,
            "2026-07-04T00:01:00Z",
        )
        .await;
        insert_issue(
            &pool,
            description_issue_id,
            project_id,
            "Backlog item",
            Some("Delta appears only in this description"),
            "2026-07-04T00:03:00Z",
        )
        .await;
        insert_message(
            &pool,
            Uuid::new_v4(),
            session_id,
            "user",
            "Delta appears in a message but should not be returned.",
            "2026-07-04T00:04:00Z",
        )
        .await;

        let response = search_chat_records(
            &pool,
            ChatSearchQuery {
                project_id: Some(project_id),
                q: Some("delta".to_string()),
                mode: None,
            },
        )
        .await
        .expect("search");

        let issue_ids = response
            .results
            .iter()
            .map(|result| match result {
                ChatSearchResult::Issue { issue_id, .. } => *issue_id,
                other => panic!("expected issue result, got {other:?}"),
            })
            .collect::<Vec<_>>();
        assert_eq!(issue_ids, vec![description_issue_id, title_issue_id]);
    }

    #[tokio::test]
    async fn search_falls_back_to_messages_ordered_by_recent_message() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let older_session_id = Uuid::new_v4();
        let newer_session_id = Uuid::new_v4();
        let older_message_id = Uuid::new_v4();
        let newer_message_id = Uuid::new_v4();
        insert_session(
            &pool,
            older_session_id,
            Some(project_id),
            "Older session",
            "2026-07-04T00:00:00Z",
        )
        .await;
        insert_session(
            &pool,
            newer_session_id,
            Some(project_id),
            "Newer session",
            "2026-07-04T00:01:00Z",
        )
        .await;
        insert_message(
            &pool,
            older_message_id,
            older_session_id,
            "user",
            "The backend aggregator should find this needle",
            "2026-07-04T00:02:00Z",
        )
        .await;
        insert_message(
            &pool,
            newer_message_id,
            newer_session_id,
            "agent",
            "A newer needle message should rank first",
            "2026-07-04T00:03:00Z",
        )
        .await;

        let response = search_chat_records(
            &pool,
            ChatSearchQuery {
                project_id: Some(project_id),
                q: Some("needle".to_string()),
                mode: None,
            },
        )
        .await
        .expect("search");

        assert_eq!(response.results.len(), 2);
        match &response.results[0] {
            ChatSearchResult::Message {
                message_id,
                session_id,
                session_title,
                snippet,
                sender_type,
                sender_label,
                ..
            } => {
                assert_eq!(*message_id, newer_message_id);
                assert_eq!(*session_id, newer_session_id);
                assert_eq!(session_title, "Newer session");
                assert!(snippet.contains("needle"));
                assert_eq!(*sender_type, ChatSenderType::Agent);
                assert_eq!(sender_label, "Agent");
            }
            other => panic!("expected message result, got {other:?}"),
        }
        assert!(matches!(
            &response.results[1],
            ChatSearchResult::Message { message_id, .. } if *message_id == older_message_id
        ));
    }

    #[tokio::test]
    async fn search_filters_sessions_to_requested_project_scope() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let other_project_id = Uuid::new_v4();
        let matching_session_id = Uuid::new_v4();
        insert_session(
            &pool,
            matching_session_id,
            Some(project_id),
            "Scoped result",
            "2026-07-04T00:00:00Z",
        )
        .await;
        insert_session(
            &pool,
            Uuid::new_v4(),
            Some(other_project_id),
            "Scoped result",
            "2026-07-04T00:01:00Z",
        )
        .await;

        let response = search_chat_records(
            &pool,
            ChatSearchQuery {
                project_id: Some(project_id),
                q: Some("scoped".to_string()),
                mode: None,
            },
        )
        .await
        .expect("search");

        assert_eq!(response.results.len(), 1);
        assert!(matches!(
            &response.results[0],
            ChatSearchResult::Session { session_id, .. } if *session_id == matching_session_id
        ));
    }

    #[tokio::test]
    async fn search_filters_all_result_categories_to_requested_project_scope() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let other_project_id = Uuid::new_v4();
        let scoped_session_id = Uuid::new_v4();
        let other_session_id = Uuid::new_v4();
        let scoped_issue_id = Uuid::new_v4();
        let other_issue_id = Uuid::new_v4();
        let message_session_id = Uuid::new_v4();
        let other_message_session_id = Uuid::new_v4();
        let scoped_message_id = Uuid::new_v4();
        let other_message_id = Uuid::new_v4();
        let worktree_session_id = Uuid::new_v4();
        let other_worktree_session_id = Uuid::new_v4();
        let scoped_worktree_id = Uuid::new_v4();
        let other_worktree_id = Uuid::new_v4();

        insert_session(
            &pool,
            scoped_session_id,
            Some(project_id),
            "Scope title match",
            "2026-07-04T00:00:00Z",
        )
        .await;
        insert_session(
            &pool,
            other_session_id,
            Some(other_project_id),
            "Scope title match",
            "2026-07-04T00:01:00Z",
        )
        .await;
        insert_session(
            &pool,
            message_session_id,
            Some(project_id),
            "Message holder",
            "2026-07-04T00:02:00Z",
        )
        .await;
        insert_session(
            &pool,
            other_message_session_id,
            Some(other_project_id),
            "Other message holder",
            "2026-07-04T00:03:00Z",
        )
        .await;
        insert_session(
            &pool,
            worktree_session_id,
            Some(project_id),
            "Worktree holder",
            "2026-07-04T00:04:00Z",
        )
        .await;
        insert_session(
            &pool,
            other_worktree_session_id,
            Some(other_project_id),
            "Other worktree holder",
            "2026-07-04T00:05:00Z",
        )
        .await;
        insert_issue(
            &pool,
            scoped_issue_id,
            project_id,
            "Scope issue match",
            None,
            "2026-07-04T00:06:00Z",
        )
        .await;
        insert_issue(
            &pool,
            other_issue_id,
            other_project_id,
            "Scope issue match",
            None,
            "2026-07-04T00:07:00Z",
        )
        .await;
        insert_message(
            &pool,
            scoped_message_id,
            message_session_id,
            "user",
            "Scope message match",
            "2026-07-04T00:08:00Z",
        )
        .await;
        insert_message(
            &pool,
            other_message_id,
            other_message_session_id,
            "user",
            "Scope message match",
            "2026-07-04T00:09:00Z",
        )
        .await;
        insert_worktree(
            &pool,
            scoped_worktree_id,
            worktree_session_id,
            "active",
            "session/scope-worktree",
            "C:/tmp/openteams/scope-worktree",
            "2026-07-04T00:10:00Z",
        )
        .await;
        insert_worktree(
            &pool,
            other_worktree_id,
            other_worktree_session_id,
            "active",
            "session/scope-worktree",
            "C:/tmp/openteams/other-scope-worktree",
            "2026-07-04T00:11:00Z",
        )
        .await;

        let session_response = search_chat_records(
            &pool,
            ChatSearchQuery {
                project_id: Some(project_id),
                q: Some("scope title".to_string()),
                mode: None,
            },
        )
        .await
        .expect("search sessions");
        assert_eq!(session_response.results.len(), 1);
        assert!(matches!(
            &session_response.results[0],
            ChatSearchResult::Session { session_id, .. } if *session_id == scoped_session_id
        ));

        let issue_response = search_chat_records(
            &pool,
            ChatSearchQuery {
                project_id: Some(project_id),
                q: Some("scope issue".to_string()),
                mode: None,
            },
        )
        .await
        .expect("search issues");
        assert_eq!(issue_response.results.len(), 1);
        assert!(matches!(
            &issue_response.results[0],
            ChatSearchResult::Issue { issue_id, .. } if *issue_id == scoped_issue_id
        ));

        let message_response = search_chat_records(
            &pool,
            ChatSearchQuery {
                project_id: Some(project_id),
                q: Some("scope message".to_string()),
                mode: None,
            },
        )
        .await
        .expect("search messages");
        assert_eq!(message_response.results.len(), 1);
        assert!(matches!(
            &message_response.results[0],
            ChatSearchResult::Message { message_id, .. } if *message_id == scoped_message_id
        ));

        let worktree_response = search_chat_records(
            &pool,
            ChatSearchQuery {
                project_id: Some(project_id),
                q: Some("scope-worktree".to_string()),
                mode: Some(ChatSearchMode::Worktree),
            },
        )
        .await
        .expect("search worktrees");
        assert_eq!(worktree_response.results.len(), 1);
        assert!(matches!(
            &worktree_response.results[0],
            ChatSearchResult::Worktree { worktree_id, .. } if *worktree_id == scoped_worktree_id
        ));
    }

    #[tokio::test]
    async fn empty_query_returns_eight_recent_active_sessions() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let mut session_ids = Vec::new();
        for index in 0..10 {
            let id = Uuid::new_v4();
            session_ids.push(id);
            insert_session(
                &pool,
                id,
                Some(project_id),
                &format!("Session {index}"),
                &format!("2026-07-04T00:{index:02}:00Z"),
            )
            .await;
        }
        insert_session_with_status(
            &pool,
            Uuid::new_v4(),
            Some(project_id),
            "Archived newest",
            "archived",
            "2026-07-04T01:00:00Z",
        )
        .await;

        let response = search_chat_records(
            &pool,
            ChatSearchQuery {
                project_id: Some(project_id),
                q: Some("   ".to_string()),
                mode: None,
            },
        )
        .await
        .expect("search");

        assert_eq!(response.results.len(), 8);
        let returned_ids = response
            .results
            .iter()
            .map(|result| match result {
                ChatSearchResult::Session { session_id, .. } => *session_id,
                other => panic!("expected session result, got {other:?}"),
            })
            .collect::<Vec<_>>();
        let expected = session_ids.into_iter().rev().take(8).collect::<Vec<_>>();
        assert_eq!(returned_ids, expected);
    }

    #[tokio::test]
    async fn worktree_mode_returns_only_current_worktree_sessions_in_project() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let other_project_id = Uuid::new_v4();
        let worktree_session_id = Uuid::new_v4();
        let plain_session_id = Uuid::new_v4();
        let archived_session_id = Uuid::new_v4();
        let other_project_session_id = Uuid::new_v4();
        let worktree_id = Uuid::new_v4();
        insert_session(
            &pool,
            worktree_session_id,
            Some(project_id),
            "Feature branch session",
            "2026-07-04T00:00:00Z",
        )
        .await;
        insert_session(
            &pool,
            plain_session_id,
            Some(project_id),
            "Plain session",
            "2026-07-04T00:01:00Z",
        )
        .await;
        insert_session_with_status(
            &pool,
            archived_session_id,
            Some(project_id),
            "Archived worktree session",
            "archived",
            "2026-07-04T00:02:00Z",
        )
        .await;
        insert_session(
            &pool,
            other_project_session_id,
            Some(other_project_id),
            "Other project worktree session",
            "2026-07-04T00:03:00Z",
        )
        .await;
        insert_worktree(
            &pool,
            worktree_id,
            worktree_session_id,
            "dirty",
            "openteams/session-feature",
            "C:/tmp/openteams/session-feature",
            "2026-07-04T00:04:00Z",
        )
        .await;
        insert_worktree(
            &pool,
            Uuid::new_v4(),
            archived_session_id,
            "active",
            "archived",
            "C:/tmp/openteams/archived",
            "2026-07-04T00:05:00Z",
        )
        .await;
        insert_worktree(
            &pool,
            Uuid::new_v4(),
            other_project_session_id,
            "active",
            "other",
            "C:/tmp/openteams/other",
            "2026-07-04T00:06:00Z",
        )
        .await;

        let response = search_chat_records(
            &pool,
            ChatSearchQuery {
                project_id: Some(project_id),
                q: None,
                mode: Some(ChatSearchMode::Worktree),
            },
        )
        .await
        .expect("search");

        assert_eq!(response.results.len(), 1);
        match &response.results[0] {
            ChatSearchResult::Worktree {
                session_id,
                worktree_id: returned_worktree_id,
                status,
                branch_name,
                path_summary,
                ..
            } => {
                assert_eq!(*session_id, worktree_session_id);
                assert_eq!(*returned_worktree_id, worktree_id);
                assert_eq!(*status, SessionWorktreeStatus::Dirty);
                assert_eq!(branch_name, "openteams/session-feature");
                assert_eq!(path_summary, "openteams/session-feature");
            }
            other => panic!("expected worktree result, got {other:?}"),
        }
    }
}
