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
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub archived_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateChatSession {
    pub title: Option<String>,
    pub workspace_path: Option<String>,
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
}

impl ChatSession {
    pub async fn find_all(
        pool: &SqlitePool,
        status: Option<ChatSessionStatus>,
    ) -> Result<Vec<Self>, sqlx::Error> {
        let sessions = if let Some(status) = status {
            sqlx::query_as!(
                ChatSession,
                r#"SELECT id as "id!: Uuid",
                          title,
                          status as "status!: ChatSessionStatus",
                          lead_agent_id as "lead_agent_id: Uuid",
                          summary_text,
                          archive_ref,
                          last_seen_diff_key,
                          team_protocol,
                          team_protocol_enabled as "team_protocol_enabled!: bool",
                          default_workspace_path,
                          chat_input_mode,
                          created_at as "created_at!: DateTime<Utc>",
                          updated_at as "updated_at!: DateTime<Utc>",
                          archived_at as "archived_at: DateTime<Utc>"
                   FROM chat_sessions
                   WHERE status = $1
                   ORDER BY updated_at DESC"#,
                status
            )
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as!(
                ChatSession,
                r#"SELECT id as "id!: Uuid",
                          title,
                          status as "status!: ChatSessionStatus",
                          lead_agent_id as "lead_agent_id: Uuid",
                          summary_text,
                          archive_ref,
                          last_seen_diff_key,
                          team_protocol,
                          team_protocol_enabled as "team_protocol_enabled!: bool",
                          default_workspace_path,
                          chat_input_mode,
                          created_at as "created_at!: DateTime<Utc>",
                          updated_at as "updated_at!: DateTime<Utc>",
                          archived_at as "archived_at: DateTime<Utc>"
                   FROM chat_sessions
                   ORDER BY updated_at DESC"#
            )
            .fetch_all(pool)
            .await?
        };

        Ok(sessions)
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            ChatSession,
            r#"SELECT id as "id!: Uuid",
                      title,
                      status as "status!: ChatSessionStatus",
                      lead_agent_id as "lead_agent_id: Uuid",
                      summary_text,
                      archive_ref,
                      last_seen_diff_key,
                      team_protocol,
                      team_protocol_enabled as "team_protocol_enabled!: bool",
                      default_workspace_path,
                      chat_input_mode,
                      created_at as "created_at!: DateTime<Utc>",
                      updated_at as "updated_at!: DateTime<Utc>",
                      archived_at as "archived_at: DateTime<Utc>"
               FROM chat_sessions
               WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateChatSession,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as!(
            ChatSession,
            r#"INSERT INTO chat_sessions (id, title, status, default_workspace_path)
               VALUES ($1, $2, $3, $4)
               RETURNING id as "id!: Uuid",
                         title,
                         status as "status!: ChatSessionStatus",
                         lead_agent_id as "lead_agent_id: Uuid",
                         summary_text,
                         archive_ref,
                         last_seen_diff_key,
                         team_protocol,
                         team_protocol_enabled as "team_protocol_enabled!: bool",
                         default_workspace_path,
                         chat_input_mode,
                         created_at as "created_at!: DateTime<Utc>",
                         updated_at as "updated_at!: DateTime<Utc>",
                         archived_at as "archived_at: DateTime<Utc>""#,
            id,
            data.title,
            ChatSessionStatus::Active,
            data.workspace_path
        )
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

        let archived_at = if status == ChatSessionStatus::Archived {
            existing.archived_at.or(Some(Utc::now()))
        } else {
            None
        };

        sqlx::query_as!(
            ChatSession,
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
                   updated_at = datetime('now', 'subsec')
               WHERE id = $1
               RETURNING id as "id!: Uuid",
                         title,
                         status as "status!: ChatSessionStatus",
                         lead_agent_id as "lead_agent_id: Uuid",
                         summary_text,
                         archive_ref,
                         last_seen_diff_key,
                         team_protocol,
                         team_protocol_enabled as "team_protocol_enabled!: bool",
                         default_workspace_path,
                         chat_input_mode,
                         created_at as "created_at!: DateTime<Utc>",
                         updated_at as "updated_at!: DateTime<Utc>",
                         archived_at as "archived_at: DateTime<Utc>""#,
            id,
            title,
            status,
            lead_agent_id,
            summary_text,
            archive_ref,
            last_seen_diff_key,
            team_protocol,
            team_protocol_enabled,
            archived_at,
            default_workspace_path,
            chat_input_mode
        )
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
        let result = sqlx::query!("DELETE FROM chat_sessions WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}
