use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "chat_work_item_type", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum ChatWorkItemType {
    Artifact,
    Conclusion,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ChatWorkItem {
    pub id: Uuid,
    pub session_id: Uuid,
    pub run_id: Uuid,
    pub session_agent_id: Uuid,
    pub agent_id: Uuid,
    pub item_type: ChatWorkItemType,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateChatWorkItem {
    pub session_id: Uuid,
    pub run_id: Uuid,
    pub session_agent_id: Uuid,
    pub agent_id: Uuid,
    pub item_type: ChatWorkItemType,
    pub content: String,
}

impl ChatWorkItem {
    pub async fn find_by_session_id(
        pool: &SqlitePool,
        session_id: Uuid,
        limit: Option<i64>,
    ) -> Result<Vec<Self>, sqlx::Error> {
        if let Some(limit) = limit {
            sqlx::query_as::<_, ChatWorkItem>(
                r#"
                SELECT id, session_id, run_id, session_agent_id, agent_id, item_type, content,
                       created_at
                FROM chat_work_items
                WHERE session_id = ?
                ORDER BY created_at ASC
                LIMIT ?
                "#,
            )
            .bind(session_id)
            .bind(limit)
            .fetch_all(pool)
            .await
        } else {
            sqlx::query_as::<_, ChatWorkItem>(
                r#"
                SELECT id, session_id, run_id, session_agent_id, agent_id, item_type, content,
                       created_at
                FROM chat_work_items
                WHERE session_id = ?
                ORDER BY created_at ASC
                "#,
            )
            .bind(session_id)
            .fetch_all(pool)
            .await
        }
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateChatWorkItem,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatWorkItem>(
            r#"
            INSERT INTO chat_work_items
            (id, session_id, run_id, session_agent_id, agent_id, item_type, content)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            RETURNING id, session_id, run_id, session_agent_id, agent_id, item_type, content,
                      created_at
            "#,
        )
        .bind(id)
        .bind(data.session_id)
        .bind(data.run_id)
        .bind(data.session_agent_id)
        .bind(data.agent_id)
        .bind(&data.item_type)
        .bind(&data.content)
        .fetch_one(pool)
        .await
    }
}
