use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(
    type_name = "chat_message_target_route_kind",
    rename_all = "snake_case"
)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum ChatMessageTargetRouteKind {
    ExplicitMention,
    SelectedMember,
    DefaultLead,
    AgentProtocol,
    ProtocolRetry,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(
    type_name = "chat_message_target_resolution_status",
    rename_all = "snake_case"
)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum ChatMessageTargetResolutionStatus {
    Resolved,
    Missing,
    Removed,
    Rejected,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ChatMessageTarget {
    pub message_id: Uuid,
    pub ordinal: i64,
    pub session_id: Uuid,
    pub session_agent_id: Option<Uuid>,
    pub project_member_id: Option<Uuid>,
    pub agent_id: Uuid,
    pub member_name_snapshot: String,
    pub route_kind: ChatMessageTargetRouteKind,
    pub resolution_status: ChatMessageTargetResolutionStatus,
    pub created_at: DateTime<Utc>,
}

pub struct CreateChatMessageTarget {
    pub message_id: Uuid,
    pub ordinal: i64,
    pub session_id: Uuid,
    pub session_agent_id: Option<Uuid>,
    pub project_member_id: Option<Uuid>,
    pub agent_id: Uuid,
    pub member_name_snapshot: String,
    pub route_kind: ChatMessageTargetRouteKind,
    pub resolution_status: ChatMessageTargetResolutionStatus,
}

impl ChatMessageTarget {
    pub async fn create(
        pool: &SqlitePool,
        data: &CreateChatMessageTarget,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO chat_message_targets (
                message_id, ordinal, session_id, session_agent_id, project_member_id,
                agent_id, member_name_snapshot, route_kind, resolution_status
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(message_id, ordinal) DO UPDATE SET
                session_id = excluded.session_id,
                session_agent_id = excluded.session_agent_id,
                project_member_id = excluded.project_member_id,
                agent_id = excluded.agent_id,
                member_name_snapshot = excluded.member_name_snapshot,
                route_kind = excluded.route_kind,
                resolution_status = excluded.resolution_status
            RETURNING message_id, ordinal, session_id, session_agent_id, project_member_id,
                      agent_id, member_name_snapshot, route_kind, resolution_status, created_at
            "#,
        )
        .bind(data.message_id)
        .bind(data.ordinal)
        .bind(data.session_id)
        .bind(data.session_agent_id)
        .bind(data.project_member_id)
        .bind(data.agent_id)
        .bind(&data.member_name_snapshot)
        .bind(data.route_kind)
        .bind(data.resolution_status)
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_message(
        pool: &SqlitePool,
        message_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT message_id, ordinal, session_id, session_agent_id, project_member_id,
                   agent_id, member_name_snapshot, route_kind, resolution_status, created_at
            FROM chat_message_targets
            WHERE message_id = ?1
            ORDER BY ordinal ASC
            "#,
        )
        .bind(message_id)
        .fetch_all(pool)
        .await
    }

    pub async fn record_protocol_retry(
        pool: &SqlitePool,
        data: &CreateChatMessageTarget,
    ) -> Result<Self, sqlx::Error> {
        let existing_ordinal: Option<i64> = sqlx::query_scalar(
            r#"SELECT ordinal
               FROM chat_message_targets
               WHERE message_id = ?1 AND session_agent_id = ?2
               LIMIT 1"#,
        )
        .bind(data.message_id)
        .bind(data.session_agent_id)
        .fetch_optional(pool)
        .await?
        .flatten();
        let ordinal = match existing_ordinal {
            Some(ordinal) => ordinal,
            None => {
                sqlx::query_scalar::<_, i64>(
                    r#"SELECT COALESCE(MAX(ordinal), -1) + 1
                   FROM chat_message_targets
                   WHERE message_id = ?1"#,
                )
                .bind(data.message_id)
                .fetch_one(pool)
                .await?
            }
        };
        let retry = CreateChatMessageTarget {
            message_id: data.message_id,
            ordinal,
            session_id: data.session_id,
            session_agent_id: data.session_agent_id,
            project_member_id: data.project_member_id,
            agent_id: data.agent_id,
            member_name_snapshot: data.member_name_snapshot.clone(),
            route_kind: ChatMessageTargetRouteKind::ProtocolRetry,
            resolution_status: data.resolution_status,
        };
        Self::create(pool, &retry).await
    }
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::*;

    #[tokio::test]
    async fn persists_resolved_session_member_identity() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            r#"
            CREATE TABLE chat_message_targets (
                message_id BLOB NOT NULL,
                ordinal INTEGER NOT NULL,
                session_id BLOB NOT NULL,
                session_agent_id BLOB,
                project_member_id BLOB,
                agent_id BLOB NOT NULL,
                member_name_snapshot TEXT NOT NULL,
                route_kind TEXT NOT NULL,
                resolution_status TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                PRIMARY KEY (message_id, ordinal),
                UNIQUE (message_id, session_agent_id)
            )
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let data = CreateChatMessageTarget {
            message_id: Uuid::new_v4(),
            ordinal: 0,
            session_id: Uuid::new_v4(),
            session_agent_id: Some(Uuid::new_v4()),
            project_member_id: Some(Uuid::new_v4()),
            agent_id: Uuid::new_v4(),
            member_name_snapshot: "CodexAgent2".to_string(),
            route_kind: ChatMessageTargetRouteKind::ExplicitMention,
            resolution_status: ChatMessageTargetResolutionStatus::Resolved,
        };

        let created = ChatMessageTarget::create(&pool, &data).await.unwrap();
        assert_eq!(created.session_agent_id, data.session_agent_id);
        assert_eq!(created.member_name_snapshot, "CodexAgent2");
        assert_eq!(
            ChatMessageTarget::find_by_message(&pool, data.message_id)
                .await
                .unwrap()
                .len(),
            1
        );
        let retry = ChatMessageTarget::record_protocol_retry(&pool, &data)
            .await
            .unwrap();
        assert_eq!(retry.route_kind, ChatMessageTargetRouteKind::ProtocolRetry);
        assert_eq!(
            ChatMessageTarget::find_by_message(&pool, data.message_id)
                .await
                .unwrap()
                .len(),
            1
        );
    }
}
