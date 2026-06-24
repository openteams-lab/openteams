use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_with::rust::double_option;
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "chat_session_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum ChatSessionStatus {
    Active,
    Archived,
}

/// Session-level preference for isolated Git worktree creation.
///
/// - `Inherit` (default): defer to the project/global default. Phase 1 treats
///   this the same as `Disabled` — no worktree is created automatically.
/// - `Disabled`: never create an isolated worktree for this session.
/// - `Isolated`: create an isolated worktree lazily on the first agent run
///   via `SessionWorktreeService::ensure_for_session`.
#[derive(Debug, Clone, Copy, Default, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "chat_session_worktree_mode", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum ChatSessionWorktreeMode {
    #[default]
    Inherit,
    Disabled,
    Isolated,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ChatSession {
    pub id: Uuid,
    pub title: Option<String>,
    pub status: ChatSessionStatus,
    pub lead_agent_id: Option<Uuid>,
    pub summary_text: Option<String>,
    pub archive_ref: Option<String>,
    pub last_seen_diff_key: Option<String>,
    pub team_protocol: Option<String>,
    pub team_protocol_enabled: bool,
    pub default_workspace_path: Option<String>,
    pub chat_input_mode: Option<String>,
    pub project_id: Option<Uuid>,
    pub worktree_mode: ChatSessionWorktreeMode,
    pub pinned_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub archived_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateChatSession {
    pub title: Option<String>,
    pub workspace_path: Option<String>,
    pub project_id: Option<Uuid>,
    #[serde(default)]
    #[ts(optional)]
    pub worktree_mode: Option<ChatSessionWorktreeMode>,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateChatSession {
    pub title: Option<String>,
    pub status: Option<ChatSessionStatus>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    #[ts(optional, type = "string | null")]
    pub lead_agent_id: Option<Option<Uuid>>,
    pub summary_text: Option<String>,
    pub archive_ref: Option<String>,
    pub last_seen_diff_key: Option<String>,
    pub team_protocol: Option<String>,
    pub team_protocol_enabled: Option<bool>,
    pub default_workspace_path: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    #[ts(optional, type = "string | null")]
    pub chat_input_mode: Option<Option<String>>,
    #[serde(default)]
    #[ts(optional)]
    pub worktree_mode: Option<ChatSessionWorktreeMode>,
}

impl ChatSession {
    pub async fn find_all(
        pool: &SqlitePool,
        status: Option<ChatSessionStatus>,
        project_id: Option<Uuid>,
    ) -> Result<Vec<Self>, sqlx::Error> {
        if let Some(project_id) = project_id {
            let mut sessions = Self::find_by_project(pool, project_id).await?;
            if let Some(status) = status {
                sessions.retain(|session| session.status == status);
            }
            return Ok(sessions);
        }

        let sessions = if let Some(status) = status {
            sqlx::query_as::<_, ChatSession>(
                r#"SELECT id,
                          title,
                          status,
                          lead_agent_id,
                          summary_text,
                          archive_ref,
                          last_seen_diff_key,
                          team_protocol,
                          team_protocol_enabled,
                          default_workspace_path,
                          chat_input_mode,
                          project_id,
                          worktree_mode,
                          pinned_at,
                          created_at,
                          updated_at,
                          archived_at
                   FROM chat_sessions
                   WHERE status = $1
                   ORDER BY
                     CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END,
                     pinned_at ASC,
                     updated_at DESC"#,
            )
            .bind(status)
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as::<_, ChatSession>(
                r#"SELECT id,
                          title,
                          status,
                          lead_agent_id,
                          summary_text,
                          archive_ref,
                          last_seen_diff_key,
                          team_protocol,
                          team_protocol_enabled,
                          default_workspace_path,
                          chat_input_mode,
                          project_id,
                          worktree_mode,
                          pinned_at,
                          created_at,
                          updated_at,
                          archived_at
                   FROM chat_sessions
                   ORDER BY
                     CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END,
                     pinned_at ASC,
                     updated_at DESC"#,
            )
            .fetch_all(pool)
            .await?
        };

        Ok(sessions)
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ChatSession>(
            r#"SELECT id,
                      title,
                      status,
                      lead_agent_id,
                      summary_text,
                      archive_ref,
                      last_seen_diff_key,
                      team_protocol,
                      team_protocol_enabled,
                      default_workspace_path,
                      chat_input_mode,
                      project_id,
                      worktree_mode,
                      pinned_at,
                      created_at,
                      updated_at,
                      archived_at
               FROM chat_sessions
               WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_project(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, ChatSession>(
            r#"SELECT id,
                      title,
                      status,
                      lead_agent_id,
                      summary_text,
                      archive_ref,
                      last_seen_diff_key,
                      team_protocol,
                      team_protocol_enabled,
                      default_workspace_path,
                      chat_input_mode,
                      project_id,
                      worktree_mode,
                      pinned_at,
                      created_at,
                      updated_at,
                      archived_at
               FROM chat_sessions
               WHERE project_id = $1
               ORDER BY
                 CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END,
                 pinned_at ASC,
                 updated_at DESC"#,
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateChatSession,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        let worktree_mode = data.worktree_mode.unwrap_or_default();
        sqlx::query_as::<_, ChatSession>(
            r#"INSERT INTO chat_sessions (id, title, status, default_workspace_path, project_id, worktree_mode)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id,
                         title,
                         status,
                         lead_agent_id,
                         summary_text,
                         archive_ref,
                         last_seen_diff_key,
                         team_protocol,
                         team_protocol_enabled,
                         default_workspace_path,
                         chat_input_mode,
                         project_id,
                         worktree_mode,
                         pinned_at,
                         created_at,
                         updated_at,
                         archived_at"#,
        )
        .bind(id)
        .bind(&data.title)
        .bind(ChatSessionStatus::Active)
        .bind(&data.workspace_path)
        .bind(data.project_id)
        .bind(worktree_mode)
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        data: &UpdateChatSession,
    ) -> Result<Self, sqlx::Error> {
        let existing = Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        let title = data.title.clone().or(existing.title);
        let status = data.status.clone().unwrap_or(existing.status);
        let lead_agent_id = match &data.lead_agent_id {
            Some(value) => *value,          // Some(Some(uuid)) = set, Some(None) = clear
            None => existing.lead_agent_id, // Not provided, keep existing
        };
        let summary_text = data.summary_text.clone().or(existing.summary_text);
        let archive_ref = data.archive_ref.clone().or(existing.archive_ref);
        let last_seen_diff_key = data
            .last_seen_diff_key
            .clone()
            .or(existing.last_seen_diff_key);
        let team_protocol = data.team_protocol.clone().or(existing.team_protocol);
        let team_protocol_enabled = data
            .team_protocol_enabled
            .unwrap_or(existing.team_protocol_enabled);
        let default_workspace_path = data
            .default_workspace_path
            .clone()
            .or(existing.default_workspace_path);
        let chat_input_mode = match &data.chat_input_mode {
            Some(value) => value.clone(), // Some(Some("workflow")) = set, Some(None) = clear
            None => existing.chat_input_mode, // Not provided, keep existing
        };
        let worktree_mode = data.worktree_mode.unwrap_or(existing.worktree_mode);

        let archived_at = if status == ChatSessionStatus::Archived {
            existing.archived_at.or(Some(Utc::now()))
        } else {
            None
        };

        sqlx::query_as::<_, ChatSession>(
            r#"UPDATE chat_sessions
               SET title = $2,
                   status = $3,
                   lead_agent_id = $4,
                   summary_text = $5,
                   archive_ref = $6,
                   last_seen_diff_key = $7,
                   team_protocol = $8,
                   team_protocol_enabled = $9,
                   archived_at = $10,
                   default_workspace_path = $11,
                   chat_input_mode = $12,
                   worktree_mode = $13,
                   updated_at = datetime('now', 'subsec')
               WHERE id = $1
               RETURNING id,
                         title,
                         status,
                         lead_agent_id,
                         summary_text,
                         archive_ref,
                         last_seen_diff_key,
                         team_protocol,
                         team_protocol_enabled,
                         default_workspace_path,
                         chat_input_mode,
                         project_id,
                         worktree_mode,
                         pinned_at,
                         created_at,
                         updated_at,
                         archived_at"#,
        )
        .bind(id)
        .bind(title)
        .bind(status)
        .bind(lead_agent_id)
        .bind(summary_text)
        .bind(archive_ref)
        .bind(last_seen_diff_key)
        .bind(team_protocol)
        .bind(team_protocol_enabled)
        .bind(archived_at)
        .bind(default_workspace_path)
        .bind(chat_input_mode)
        .bind(worktree_mode)
        .fetch_one(pool)
        .await
    }

    pub async fn set_pinned(
        pool: &SqlitePool,
        id: Uuid,
        pinned: bool,
    ) -> Result<Self, sqlx::Error> {
        let pinned_at = pinned.then(Utc::now);
        sqlx::query_as::<_, ChatSession>(
            r#"UPDATE chat_sessions
               SET pinned_at = $2,
                   updated_at = datetime('now', 'subsec')
               WHERE id = $1
               RETURNING id,
                         title,
                         status,
                         lead_agent_id,
                         summary_text,
                         archive_ref,
                         last_seen_diff_key,
                         team_protocol,
                         team_protocol_enabled,
                         default_workspace_path,
                         chat_input_mode,
                         project_id,
                         worktree_mode,
                         pinned_at,
                         created_at,
                         updated_at,
                         archived_at"#,
        )
        .bind(id)
        .bind(pinned_at)
        .fetch_one(pool)
        .await
    }

    pub async fn touch(pool: &SqlitePool, id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE chat_sessions SET updated_at = datetime('now', 'subsec') WHERE id = $1",
            id
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        // Clear soft references whose foreign keys lack ON DELETE handling
        // (project_work_item_execution_links, project_delivery_records and
        // github_operation_audits reference chat_sessions without a cascade
        // rule), otherwise deleting a session linked to those rows fails.
        sqlx::query(
            "UPDATE project_work_item_execution_links SET session_id = NULL WHERE session_id = ?1",
        )
        .bind(id)
        .execute(pool)
        .await?;
        sqlx::query(
            "UPDATE project_delivery_records SET source_session_id = NULL WHERE source_session_id = ?1",
        )
        .bind(id)
        .execute(pool)
        .await?;
        sqlx::query("UPDATE github_operation_audits SET session_id = NULL WHERE session_id = ?1")
            .bind(id)
            .execute(pool)
            .await?;

        let result = sqlx::query!("DELETE FROM chat_sessions WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::{ChatSession, ChatSessionStatus, CreateChatSession};

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");

        sqlx::query(
            r#"
            CREATE TABLE chat_sessions (
                id BLOB PRIMARY KEY,
                title TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                lead_agent_id BLOB,
                summary_text TEXT,
                archive_ref TEXT,
                last_seen_diff_key TEXT,
                team_protocol TEXT,
                team_protocol_enabled BOOLEAN NOT NULL DEFAULT 0,
                default_workspace_path TEXT,
                chat_input_mode TEXT,
                project_id BLOB,
                worktree_mode TEXT NOT NULL DEFAULT 'inherit'
                    CHECK (worktree_mode IN ('inherit', 'disabled', 'isolated')),
                pinned_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                archived_at TEXT
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create chat_sessions table");

        pool
    }

    #[tokio::test]
    async fn find_all_filters_by_project_id_and_status() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let other_project_id = Uuid::new_v4();
        let matching_id = Uuid::new_v4();
        let archived_id = Uuid::new_v4();

        ChatSession::create(
            &pool,
            &CreateChatSession {
                title: Some("matching".to_string()),
                workspace_path: None,
                project_id: Some(project_id),
                worktree_mode: None,
            },
            matching_id,
        )
        .await
        .expect("create matching session");
        ChatSession::create(
            &pool,
            &CreateChatSession {
                title: Some("other".to_string()),
                workspace_path: None,
                project_id: Some(other_project_id),
                worktree_mode: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create other project session");
        ChatSession::create(
            &pool,
            &CreateChatSession {
                title: Some("legacy".to_string()),
                workspace_path: None,
                project_id: None,
                worktree_mode: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create legacy session");
        ChatSession::create(
            &pool,
            &CreateChatSession {
                title: Some("archived".to_string()),
                workspace_path: None,
                project_id: Some(project_id),
                worktree_mode: None,
            },
            archived_id,
        )
        .await
        .expect("create archived session");
        sqlx::query("UPDATE chat_sessions SET status = 'archived' WHERE id = ?1")
            .bind(archived_id)
            .execute(&pool)
            .await
            .expect("archive session");

        let project_sessions = ChatSession::find_all(&pool, None, Some(project_id))
            .await
            .expect("list project sessions");
        assert_eq!(project_sessions.len(), 2);
        assert!(
            project_sessions
                .iter()
                .all(|s| s.project_id == Some(project_id))
        );

        let active_project_sessions =
            ChatSession::find_all(&pool, Some(ChatSessionStatus::Active), Some(project_id))
                .await
                .expect("list active project sessions");
        assert_eq!(active_project_sessions.len(), 1);
        assert_eq!(active_project_sessions[0].id, matching_id);

        let all_sessions = ChatSession::find_all(&pool, None, None)
            .await
            .expect("list all sessions");
        assert_eq!(all_sessions.len(), 4);
    }

    #[tokio::test]
    async fn find_all_places_pinned_sessions_first_in_pin_order() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let first_pinned_id = Uuid::new_v4();
        let second_pinned_id = Uuid::new_v4();
        let unpinned_id = Uuid::new_v4();

        for (id, title) in [
            (unpinned_id, "unpinned"),
            (second_pinned_id, "second pinned"),
            (first_pinned_id, "first pinned"),
        ] {
            ChatSession::create(
                &pool,
                &CreateChatSession {
                    title: Some(title.to_string()),
                    workspace_path: None,
                    project_id: Some(project_id),
                    worktree_mode: None,
                },
                id,
            )
            .await
            .expect("create session");
        }

        sqlx::query("UPDATE chat_sessions SET pinned_at = ?1 WHERE id = ?2")
            .bind("2026-06-23T00:00:00Z")
            .bind(first_pinned_id)
            .execute(&pool)
            .await
            .expect("pin first session");
        sqlx::query("UPDATE chat_sessions SET pinned_at = ?1 WHERE id = ?2")
            .bind("2026-06-23T00:01:00Z")
            .bind(second_pinned_id)
            .execute(&pool)
            .await
            .expect("pin second session");

        let sessions =
            ChatSession::find_all(&pool, Some(ChatSessionStatus::Active), Some(project_id))
                .await
                .expect("list sessions");

        let ordered_ids = sessions
            .iter()
            .map(|session| session.id)
            .collect::<Vec<_>>();
        assert_eq!(
            ordered_ids,
            vec![first_pinned_id, second_pinned_id, unpinned_id]
        );
    }
}
