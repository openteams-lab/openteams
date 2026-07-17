use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "chat_sender_type", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum ChatSenderType {
    User,
    Agent,
    System,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ChatMessage {
    pub id: Uuid,
    pub session_id: Uuid,
    pub sender_type: ChatSenderType,
    pub sender_id: Option<Uuid>,
    pub sender_session_agent_id: Option<Uuid>,
    pub content: String,
    #[ts(type = "string[]")]
    pub mentions: sqlx::types::Json<Vec<String>>,
    #[ts(type = "JsonValue")]
    pub meta: sqlx::types::Json<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateChatMessage {
    pub session_id: Uuid,
    pub sender_type: ChatSenderType,
    pub sender_id: Option<Uuid>,
    pub content: String,
    pub mentions: Vec<String>,
    pub meta: serde_json::Value,
}

impl ChatMessage {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ChatMessage>(
            r#"SELECT id,
                      session_id,
                      sender_type,
                      sender_id,
                      sender_session_agent_id,
                      content,
                      mentions,
                      meta,
                      created_at
               FROM chat_messages
               WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_session_id(
        pool: &SqlitePool,
        session_id: Uuid,
        limit: Option<i64>,
    ) -> Result<Vec<Self>, sqlx::Error> {
        if let Some(limit) = limit {
            sqlx::query_as::<_, ChatMessage>(
                r#"SELECT id,
                          session_id,
                          sender_type,
                          sender_id,
                          sender_session_agent_id,
                          content,
                          mentions,
                          meta,
                          created_at
                   FROM chat_messages
                   WHERE session_id = $1
                   ORDER BY created_at ASC
                   LIMIT $2"#,
            )
            .bind(session_id)
            .bind(limit)
            .fetch_all(pool)
            .await
        } else {
            sqlx::query_as::<_, ChatMessage>(
                r#"SELECT id,
                          session_id,
                          sender_type,
                          sender_id,
                          sender_session_agent_id,
                          content,
                          mentions,
                          meta,
                          created_at
                   FROM chat_messages
                   WHERE session_id = $1
                   ORDER BY created_at ASC"#,
            )
            .bind(session_id)
            .fetch_all(pool)
            .await
        }
    }

    pub async fn find_by_session_id_lightweight(
        pool: &SqlitePool,
        session_id: Uuid,
        limit: Option<i64>,
    ) -> Result<Vec<Self>, sqlx::Error> {
        let base_sql = r#"
            SELECT id, session_id, sender_type, sender_id, sender_session_agent_id, content, mentions,
                CASE
                    WHEN json_valid(meta)
                         AND json_extract(meta, '$.card_type') IN ('workflow_execution', 'workflow_plan_generation')
                         AND json_extract(meta, '$.workflow_card') IS NOT NULL
                    THEN json_insert(
                        json_remove(meta, '$.workflow_card'),
                        '$.workflow_card_summary',
                        json_object(
                            'execution_id', json_extract(meta, '$.workflow_card.execution_id'),
                            'state', json_extract(meta, '$.workflow_card.state'),
                            'is_terminal', json_extract(meta, '$.workflow_card.is_terminal'),
                            'has_transcripts', json_extract(meta, '$.workflow_card.has_transcripts'),
                            'execution_status', json_extract(meta, '$.workflow_card.execution_status'),
                            'error_message', json_extract(meta, '$.workflow_card.error_message')
                        )
                    )
                    ELSE meta
                END as meta,
                created_at
            FROM chat_messages
            WHERE session_id = ?
            ORDER BY created_at ASC"#;
        if let Some(limit) = limit {
            let sql = format!("{base_sql} LIMIT ?");
            sqlx::query_as::<_, ChatMessage>(&sql)
                .bind(session_id)
                .bind(limit)
                .fetch_all(pool)
                .await
        } else {
            sqlx::query_as::<_, ChatMessage>(base_sql)
                .bind(session_id)
                .fetch_all(pool)
                .await
        }
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateChatMessage,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        let mentions_json = sqlx::types::Json(data.mentions.clone());
        let meta_json = sqlx::types::Json(data.meta.clone());
        let sender_session_agent_id = data
            .meta
            .get("session_agent_id")
            .and_then(serde_json::Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());

        sqlx::query_as::<_, ChatMessage>(
            r#"INSERT INTO chat_messages (
                   id, session_id, sender_type, sender_id, sender_session_agent_id,
                   content, mentions, meta
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id,
                         session_id,
                         sender_type,
                         sender_id,
                         sender_session_agent_id,
                         content,
                         mentions,
                         meta,
                         created_at"#,
        )
        .bind(id)
        .bind(data.session_id)
        .bind(data.sender_type.clone())
        .bind(data.sender_id)
        .bind(sender_session_agent_id)
        .bind(&data.content)
        .bind(mentions_json)
        .bind(meta_json)
        .fetch_one(pool)
        .await
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM chat_messages WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn update_meta(
        pool: &SqlitePool,
        id: Uuid,
        meta: serde_json::Value,
    ) -> Result<u64, sqlx::Error> {
        let meta_str = serde_json::to_string(&meta).unwrap_or_default();
        let result = sqlx::query("UPDATE chat_messages SET meta = $1 WHERE id = $2")
            .bind(meta_str)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn update_content_and_meta(
        pool: &SqlitePool,
        id: Uuid,
        content: &str,
        meta: serde_json::Value,
    ) -> Result<Self, sqlx::Error> {
        let meta_str = serde_json::to_string(&meta).unwrap_or_default();
        sqlx::query_as::<_, ChatMessage>(
            r#"UPDATE chat_messages
               SET content = ?1, meta = ?2
               WHERE id = ?3
               RETURNING id, session_id, sender_type, sender_id, sender_session_agent_id,
                         content, mentions, meta, created_at"#,
        )
        .bind(content)
        .bind(meta_str)
        .bind(id)
        .fetch_one(pool)
        .await
    }
}
