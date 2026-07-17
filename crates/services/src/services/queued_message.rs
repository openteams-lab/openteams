use chrono::{DateTime, Utc};
use db::models::chat_message_queue::{
    ChatMessageQueue, CreateChatMessageQueue, QueuedMessageStatus,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;
use uuid::Uuid;

/// Durable queued message for one chat session member.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QueuedMessage {
    pub id: Uuid,
    pub session_id: Uuid,
    pub session_agent_id: Uuid,
    pub agent_id: Uuid,
    pub chat_message_id: Uuid,
    pub status: QueuedMessageStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub processing_started_at: Option<DateTime<Utc>>,
    pub run_id: Option<Uuid>,
    pub failure_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MemberQueueStatus {
    Empty,
    Queued,
    Processing,
    Running,
    Blocked,
    Paused,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QueuedMessageListItem {
    pub message: QueuedMessage,
    pub can_delete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MemberQueueSnapshot {
    pub session_id: Uuid,
    pub session_agent_id: Uuid,
    pub agent_id: Uuid,
    pub status: MemberQueueStatus,
    pub blocked: bool,
    pub paused: bool,
    pub can_continue: bool,
    pub queued_count: i64,
    pub items: Vec<QueuedMessageListItem>,
}

/// Frontend-facing queue state derived from durable member queue rows.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "snake_case")]
#[ts(export)]
pub enum QueueStatus {
    Empty,
    Queued {
        messages: Vec<QueuedMessage>,
    },
    Processing {
        message: QueuedMessage,
        queued_count: i64,
    },
    Running {
        message: QueuedMessage,
        queued_count: i64,
    },
    /// A failed item is blocking the member queue until the user chooses to continue.
    Blocked {
        message: QueuedMessage,
        queued_count: i64,
    },
    /// Alias for UIs that display failed queues as paused rather than blocked.
    Paused {
        message: QueuedMessage,
        queued_count: i64,
    },
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateQueuedMessage {
    pub session_id: Uuid,
    pub session_agent_id: Uuid,
    pub agent_id: Uuid,
    pub chat_message_id: Uuid,
}

/// Database-backed service for managing member-scoped queued chat messages.
///
/// The service keeps no in-memory queue state. Every operation delegates to the
/// `chat_message_queue` table, where each row references the existing `chat_messages` source row
/// and is scoped to one `session_agent_id`.
#[derive(Clone, Default)]
pub struct QueuedMessageService;

impl QueuedMessageService {
    pub fn new() -> Self {
        Self
    }

    fn from_row(row: ChatMessageQueue) -> QueuedMessage {
        QueuedMessage {
            id: row.id,
            session_id: row.session_id,
            session_agent_id: row.session_agent_id,
            agent_id: row.agent_id,
            chat_message_id: row.chat_message_id,
            status: row.status,
            created_at: row.created_at,
            updated_at: row.updated_at,
            processing_started_at: row.processing_started_at,
            run_id: row.run_id,
            failure_reason: row.failure_reason,
        }
    }

    fn active_messages(messages: Vec<QueuedMessage>) -> Vec<QueuedMessage> {
        messages
            .into_iter()
            .filter(|message| {
                matches!(
                    message.status,
                    QueuedMessageStatus::Queued
                        | QueuedMessageStatus::Processing
                        | QueuedMessageStatus::Running
                        | QueuedMessageStatus::Failed
                )
            })
            .collect()
    }

    fn snapshot_from_messages(
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
        messages: Vec<QueuedMessage>,
    ) -> MemberQueueSnapshot {
        let active_messages = Self::active_messages(messages);
        let queued_count = active_messages
            .iter()
            .filter(|message| message.status == QueuedMessageStatus::Queued)
            .count() as i64;
        let has_failed = active_messages
            .iter()
            .any(|message| message.status == QueuedMessageStatus::Failed);
        let status = if has_failed && queued_count > 0 {
            MemberQueueStatus::Blocked
        } else if has_failed {
            MemberQueueStatus::Paused
        } else if active_messages
            .iter()
            .any(|message| message.status == QueuedMessageStatus::Running)
        {
            MemberQueueStatus::Running
        } else if active_messages
            .iter()
            .any(|message| message.status == QueuedMessageStatus::Processing)
        {
            MemberQueueStatus::Processing
        } else if queued_count > 0 {
            MemberQueueStatus::Queued
        } else {
            MemberQueueStatus::Empty
        };

        MemberQueueSnapshot {
            session_id,
            session_agent_id,
            agent_id,
            status,
            blocked: has_failed,
            paused: status == MemberQueueStatus::Paused,
            can_continue: has_failed && queued_count > 0,
            queued_count,
            items: active_messages
                .into_iter()
                .map(|message| QueuedMessageListItem {
                    can_delete: message.status == QueuedMessageStatus::Queued,
                    message,
                })
                .collect(),
        }
    }

    fn create_data(data: &CreateQueuedMessage) -> CreateChatMessageQueue {
        CreateChatMessageQueue {
            session_id: data.session_id,
            session_agent_id: data.session_agent_id,
            agent_id: data.agent_id,
            chat_message_id: data.chat_message_id,
        }
    }

    pub async fn find_by_id(
        &self,
        pool: &SqlitePool,
        id: Uuid,
    ) -> Result<Option<QueuedMessage>, sqlx::Error> {
        Ok(ChatMessageQueue::find_by_id(pool, id)
            .await?
            .map(Self::from_row))
    }

    /// Persist a queued row for a member. The user message itself remains in `chat_messages`.
    pub async fn create_queued(
        &self,
        pool: &SqlitePool,
        data: &CreateQueuedMessage,
    ) -> Result<QueuedMessage, sqlx::Error> {
        let row =
            ChatMessageQueue::create_queued(pool, &Self::create_data(data), Uuid::new_v4()).await?;
        Ok(Self::from_row(row))
    }

    /// Return all queue rows for one member, oldest first, for recovery/display.
    pub async fn list_for_member(
        &self,
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<Vec<QueuedMessage>, sqlx::Error> {
        let rows = ChatMessageQueue::list_for_member(pool, session_agent_id).await?;
        Ok(rows.into_iter().map(Self::from_row).collect())
    }

    /// Return claimed rows that never reached run binding, regardless of member runtime state.
    pub async fn list_unbound_processing(
        &self,
        pool: &SqlitePool,
    ) -> Result<Vec<QueuedMessage>, sqlx::Error> {
        let rows = ChatMessageQueue::list_unbound_processing(pool).await?;
        Ok(rows.into_iter().map(Self::from_row).collect())
    }

    /// Return the member's currently claimed or running queue row, if one exists.
    pub async fn find_active_for_member(
        &self,
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<Option<QueuedMessage>, sqlx::Error> {
        Ok(
            ChatMessageQueue::find_active_for_member(pool, session_agent_id)
                .await?
                .map(Self::from_row),
        )
    }

    /// Check whether a member has queued rows that have not started yet.
    pub async fn has_queued(
        &self,
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        Ok(ChatMessageQueue::count_queued_for_member(pool, session_agent_id).await? > 0)
    }

    pub async fn has_blocking_failure(
        &self,
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        ChatMessageQueue::has_blocking_failure(pool, session_agent_id).await
    }

    /// Atomically claim the oldest queued row for a member and move it to `processing`.
    pub async fn claim_next(
        &self,
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<Option<QueuedMessage>, sqlx::Error> {
        Ok(ChatMessageQueue::claim_next(pool, session_agent_id)
            .await?
            .map(Self::from_row))
    }

    pub async fn start_or_create_running(
        &self,
        pool: &SqlitePool,
        data: &CreateQueuedMessage,
        id: Uuid,
        run_id: Uuid,
    ) -> Result<QueuedMessage, sqlx::Error> {
        ChatMessageQueue::start_or_create_running(pool, &Self::create_data(data), id, run_id)
            .await
            .map(Self::from_row)
    }

    pub async fn find_by_run_id(
        &self,
        pool: &SqlitePool,
        run_id: Uuid,
    ) -> Result<Option<QueuedMessage>, sqlx::Error> {
        Ok(ChatMessageQueue::find_by_run_id(pool, run_id)
            .await?
            .map(Self::from_row))
    }

    /// Bind a `processing` row to a run and move it to `running`.
    pub async fn bind_run(
        &self,
        pool: &SqlitePool,
        id: Uuid,
        run_id: Uuid,
    ) -> Result<Option<QueuedMessage>, sqlx::Error> {
        Ok(ChatMessageQueue::bind_run(pool, id, run_id)
            .await?
            .map(Self::from_row))
    }

    pub async fn complete_run_and_claim_next(
        &self,
        pool: &SqlitePool,
        run_id: Uuid,
        session_agent_id: Uuid,
    ) -> Result<Option<QueuedMessage>, sqlx::Error> {
        let (_completed, claimed) =
            ChatMessageQueue::complete_run_and_claim_next(pool, run_id, session_agent_id).await?;
        Ok(claimed.map(Self::from_row))
    }

    /// Mark `processing` or `running` as `completed` after success or a normal stop.
    pub async fn mark_completed(
        &self,
        pool: &SqlitePool,
        id: Uuid,
    ) -> Result<Option<QueuedMessage>, sqlx::Error> {
        Ok(ChatMessageQueue::mark_completed(pool, id)
            .await?
            .map(Self::from_row))
    }

    /// Mark `processing` or `running` as `failed`. Remaining queued rows are left intact.
    pub async fn mark_failed(
        &self,
        pool: &SqlitePool,
        id: Uuid,
        failure_reason: Option<String>,
    ) -> Result<Option<QueuedMessage>, sqlx::Error> {
        Ok(ChatMessageQueue::mark_failed(pool, id, failure_reason)
            .await?
            .map(Self::from_row))
    }

    /// Continue a blocked member queue by marking failed rows as `skipped`.
    pub async fn skip_failed_for_member(
        &self,
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        ChatMessageQueue::skip_failed_for_member(pool, session_agent_id).await
    }

    /// Skip an in-flight entry directly when a run fails but no queued messages remain for the
    /// member. Keeps the queue clean so the next message runs instead of being blocked.
    pub async fn skip_inflight(
        &self,
        pool: &SqlitePool,
        id: Uuid,
        failure_reason: Option<String>,
    ) -> Result<Option<QueuedMessage>, sqlx::Error> {
        Ok(ChatMessageQueue::skip_inflight(pool, id, failure_reason)
            .await?
            .map(Self::from_row))
    }

    /// Delete a queued row that has not started yet.
    pub async fn delete_queued(&self, pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        ChatMessageQueue::delete_queued(pool, id).await
    }

    /// Count other queue rows that reference the same source `chat_messages` row, excluding the
    /// given queue id. Used to decide whether the source message can be cleaned up after a queued
    /// row is deleted.
    pub async fn other_reference_count_for_chat_message(
        &self,
        pool: &SqlitePool,
        chat_message_id: Uuid,
        exclude_queue_id: Uuid,
    ) -> Result<i64, sqlx::Error> {
        ChatMessageQueue::count_other_references_for_chat_message(
            pool,
            chat_message_id,
            exclude_queue_id,
        )
        .await
    }

    pub async fn requeue_stale_inflight(
        &self,
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        ChatMessageQueue::requeue_stale_inflight(pool, session_agent_id).await
    }

    pub async fn snapshot_for_member(
        &self,
        pool: &SqlitePool,
        session_id: Uuid,
        session_agent_id: Uuid,
        agent_id: Uuid,
    ) -> Result<MemberQueueSnapshot, sqlx::Error> {
        let messages = self.list_for_member(pool, session_agent_id).await?;
        Ok(Self::snapshot_from_messages(
            session_id,
            session_agent_id,
            agent_id,
            messages,
        ))
    }

    /// Derive member queue state from persisted rows. Failed rows take precedence because they
    /// block later queued messages until skipped by the continue action.
    pub async fn get_status(
        &self,
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<QueueStatus, sqlx::Error> {
        let messages = self.list_for_member(pool, session_agent_id).await?;
        let queued_count = messages
            .iter()
            .filter(|message| message.status == QueuedMessageStatus::Queued)
            .count() as i64;

        if let Some(message) = messages
            .iter()
            .find(|message| message.status == QueuedMessageStatus::Failed)
            .cloned()
        {
            return if queued_count > 0 {
                Ok(QueueStatus::Blocked {
                    message,
                    queued_count,
                })
            } else {
                Ok(QueueStatus::Paused {
                    message,
                    queued_count,
                })
            };
        }

        if let Some(message) = messages
            .iter()
            .find(|message| message.status == QueuedMessageStatus::Running)
            .cloned()
        {
            return Ok(QueueStatus::Running {
                message,
                queued_count,
            });
        }

        if let Some(message) = messages
            .iter()
            .find(|message| message.status == QueuedMessageStatus::Processing)
            .cloned()
        {
            return Ok(QueueStatus::Processing {
                message,
                queued_count,
            });
        }

        let queued: Vec<QueuedMessage> = messages
            .into_iter()
            .filter(|message| message.status == QueuedMessageStatus::Queued)
            .collect();
        if queued.is_empty() {
            Ok(QueueStatus::Empty)
        } else {
            Ok(QueueStatus::Queued { messages: queued })
        }
    }
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::*;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::query(
            r#"
            CREATE TABLE chat_message_queue (
                id                    BLOB PRIMARY KEY,
                session_id            BLOB NOT NULL,
                session_agent_id      BLOB NOT NULL,
                agent_id              BLOB NOT NULL,
                chat_message_id       BLOB NOT NULL,
                status                TEXT NOT NULL DEFAULT 'queued'
                                        CHECK (status IN ('queued','processing','running','failed','skipped','completed')),
                processing_started_at TEXT,
                run_id                BLOB,
                failure_reason        TEXT,
                created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create chat_message_queue table");
        sqlx::query(
            r#"
            CREATE UNIQUE INDEX idx_chat_message_queue_one_active
                ON chat_message_queue(session_agent_id)
                WHERE status IN ('processing', 'running')
            "#,
        )
        .execute(&pool)
        .await
        .expect("create partial unique index");
        pool
    }

    fn sample_create(session_agent_id: Uuid) -> CreateQueuedMessage {
        CreateQueuedMessage {
            session_id: Uuid::new_v4(),
            session_agent_id,
            agent_id: Uuid::new_v4(),
            chat_message_id: Uuid::new_v4(),
        }
    }

    async fn create_with_order(
        service: &QueuedMessageService,
        pool: &SqlitePool,
        session_agent_id: Uuid,
        seq: i64,
    ) -> QueuedMessage {
        let message = service
            .create_queued(pool, &sample_create(session_agent_id))
            .await
            .expect("create queued");
        sqlx::query("UPDATE chat_message_queue SET created_at = ?2 WHERE id = ?1")
            .bind(message.id)
            .bind(format!("2026-06-17T00:00:0{seq}.000"))
            .execute(pool)
            .await
            .expect("set created_at");
        message
    }

    #[tokio::test]
    async fn service_recovers_member_queue_from_database() {
        let pool = setup_pool().await;
        let service = QueuedMessageService::new();
        let member = Uuid::new_v4();

        let first = create_with_order(&service, &pool, member, 1).await;
        let second = create_with_order(&service, &pool, member, 2).await;

        let recovered = QueuedMessageService::new()
            .list_for_member(&pool, member)
            .await
            .expect("recover queue");

        assert_eq!(recovered.len(), 2);
        assert_eq!(recovered[0].id, first.id);
        assert_eq!(recovered[1].id, second.id);
        assert!(service.has_queued(&pool, member).await.unwrap());
    }

    #[tokio::test]
    async fn service_claims_binds_and_completes_with_cas_states() {
        let pool = setup_pool().await;
        let service = QueuedMessageService::new();
        let member = Uuid::new_v4();
        let first = create_with_order(&service, &pool, member, 1).await;
        let second = create_with_order(&service, &pool, member, 2).await;

        let claimed = service
            .claim_next(&pool, member)
            .await
            .unwrap()
            .expect("claim first");
        assert_eq!(claimed.id, first.id);
        assert_eq!(claimed.status, QueuedMessageStatus::Processing);
        assert!(service.claim_next(&pool, member).await.unwrap().is_none());

        let run_id = Uuid::new_v4();
        let running = service
            .bind_run(&pool, claimed.id, run_id)
            .await
            .unwrap()
            .expect("bind run");
        assert_eq!(running.status, QueuedMessageStatus::Running);
        assert_eq!(running.run_id, Some(run_id));

        let completed = service
            .mark_completed(&pool, claimed.id)
            .await
            .unwrap()
            .expect("complete");
        assert_eq!(completed.status, QueuedMessageStatus::Completed);

        let next = service
            .claim_next(&pool, member)
            .await
            .unwrap()
            .expect("claim next");
        assert_eq!(next.id, second.id);
    }

    #[tokio::test]
    async fn failure_blocks_until_continue_skips_failed_item() {
        let pool = setup_pool().await;
        let service = QueuedMessageService::new();
        let member = Uuid::new_v4();
        create_with_order(&service, &pool, member, 1).await;
        create_with_order(&service, &pool, member, 2).await;

        let claimed = service
            .claim_next(&pool, member)
            .await
            .unwrap()
            .expect("claim first");
        let failed = service
            .mark_failed(&pool, claimed.id, Some("boom".to_string()))
            .await
            .unwrap()
            .expect("fail");
        assert_eq!(failed.status, QueuedMessageStatus::Failed);

        match service.get_status(&pool, member).await.unwrap() {
            QueueStatus::Blocked {
                message,
                queued_count,
            } => {
                assert_eq!(message.id, claimed.id);
                assert_eq!(queued_count, 1);
            }
            other => panic!("expected blocked status, got {other:?}"),
        }
        assert!(service.claim_next(&pool, member).await.unwrap().is_none());

        assert_eq!(
            service.skip_failed_for_member(&pool, member).await.unwrap(),
            1
        );
        let next = service
            .claim_next(&pool, member)
            .await
            .unwrap()
            .expect("claim after continue");
        assert_eq!(next.status, QueuedMessageStatus::Processing);
    }

    #[tokio::test]
    async fn snapshot_exposes_blocked_state_and_item_actions() {
        let pool = setup_pool().await;
        let service = QueuedMessageService::new();
        let member = Uuid::new_v4();
        let first = create_with_order(&service, &pool, member, 1).await;
        let second = create_with_order(&service, &pool, member, 2).await;

        let claimed = service
            .claim_next(&pool, member)
            .await
            .unwrap()
            .expect("claim first");
        service
            .mark_failed(&pool, claimed.id, Some("boom".to_string()))
            .await
            .unwrap()
            .expect("fail");

        let snapshot = service
            .snapshot_for_member(&pool, first.session_id, member, first.agent_id)
            .await
            .expect("snapshot");

        assert_eq!(snapshot.status, MemberQueueStatus::Blocked);
        assert!(snapshot.blocked);
        assert!(!snapshot.paused);
        assert!(snapshot.can_continue);
        assert_eq!(snapshot.queued_count, 1);
        assert_eq!(snapshot.items.len(), 2);
        assert_eq!(snapshot.items[0].message.id, first.id);
        assert!(!snapshot.items[0].can_delete);
        assert_eq!(snapshot.items[1].message.id, second.id);
        assert!(snapshot.items[1].can_delete);
    }

    #[tokio::test]
    async fn complete_run_and_claim_next_returns_processing_entry() {
        let pool = setup_pool().await;
        let service = QueuedMessageService::new();
        let member = Uuid::new_v4();
        let first = create_with_order(&service, &pool, member, 1).await;
        let second = create_with_order(&service, &pool, member, 2).await;
        let claimed = service
            .claim_next(&pool, member)
            .await
            .unwrap()
            .expect("claim first");
        assert_eq!(claimed.id, first.id);
        let run_id = Uuid::new_v4();
        service
            .bind_run(&pool, claimed.id, run_id)
            .await
            .unwrap()
            .expect("bind run");

        let next = service
            .complete_run_and_claim_next(&pool, run_id, member)
            .await
            .unwrap()
            .expect("claim next");

        assert_eq!(next.id, second.id);
        assert_eq!(next.status, QueuedMessageStatus::Processing);
    }

    #[tokio::test]
    async fn failed_member_without_remaining_queue_is_paused() {
        let pool = setup_pool().await;
        let service = QueuedMessageService::new();
        let member = Uuid::new_v4();
        create_with_order(&service, &pool, member, 1).await;

        let claimed = service
            .claim_next(&pool, member)
            .await
            .unwrap()
            .expect("claim only item");
        service
            .mark_failed(&pool, claimed.id, Some("boom".to_string()))
            .await
            .unwrap()
            .expect("fail");

        match service.get_status(&pool, member).await.unwrap() {
            QueueStatus::Paused {
                message,
                queued_count,
            } => {
                assert_eq!(message.id, claimed.id);
                assert_eq!(queued_count, 0);
            }
            other => panic!("expected paused status, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn delete_only_removes_rows_that_are_still_queued() {
        let pool = setup_pool().await;
        let service = QueuedMessageService::new();
        let member = Uuid::new_v4();
        let queued = create_with_order(&service, &pool, member, 1).await;
        let to_claim = create_with_order(&service, &pool, member, 2).await;

        assert_eq!(service.delete_queued(&pool, queued.id).await.unwrap(), 1);

        let claimed = service
            .claim_next(&pool, member)
            .await
            .unwrap()
            .expect("claim remaining");
        assert_eq!(claimed.id, to_claim.id);
        assert_eq!(service.delete_queued(&pool, claimed.id).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn paused_snapshot_without_queued_messages_hides_continue() {
        let pool = setup_pool().await;
        let service = QueuedMessageService::new();
        let member = Uuid::new_v4();
        let entry = create_with_order(&service, &pool, member, 1).await;

        let claimed = service
            .claim_next(&pool, member)
            .await
            .unwrap()
            .expect("claim only item");
        service
            .mark_failed(&pool, claimed.id, Some("boom".to_string()))
            .await
            .unwrap()
            .expect("fail");

        let snapshot = service
            .snapshot_for_member(&pool, entry.session_id, member, entry.agent_id)
            .await
            .expect("snapshot");

        assert_eq!(snapshot.status, MemberQueueStatus::Paused);
        assert!(snapshot.blocked);
        assert!(snapshot.paused);
        // No queued messages waiting → "continue execution" is not meaningful.
        assert!(!snapshot.can_continue);
        assert_eq!(snapshot.queued_count, 0);
    }

    #[tokio::test]
    async fn blocked_snapshot_with_queued_messages_shows_continue() {
        let pool = setup_pool().await;
        let service = QueuedMessageService::new();
        let member = Uuid::new_v4();
        let first = create_with_order(&service, &pool, member, 1).await;
        create_with_order(&service, &pool, member, 2).await;

        let claimed = service
            .claim_next(&pool, member)
            .await
            .unwrap()
            .expect("claim first");
        service
            .mark_failed(&pool, claimed.id, Some("boom".to_string()))
            .await
            .unwrap()
            .expect("fail");

        let snapshot = service
            .snapshot_for_member(&pool, first.session_id, member, first.agent_id)
            .await
            .expect("snapshot");

        assert_eq!(snapshot.status, MemberQueueStatus::Blocked);
        assert!(snapshot.blocked);
        // Queued messages are waiting → "continue execution" is meaningful.
        assert!(snapshot.can_continue);
        assert_eq!(snapshot.queued_count, 1);
    }

    #[tokio::test]
    async fn skip_inflight_cleans_up_lone_failure() {
        let pool = setup_pool().await;
        let service = QueuedMessageService::new();
        let member = Uuid::new_v4();
        let entry = create_with_order(&service, &pool, member, 1).await;

        let claimed = service
            .claim_next(&pool, member)
            .await
            .unwrap()
            .expect("claim");

        let skipped = service
            .skip_inflight(&pool, claimed.id, Some("auto-skip".to_string()))
            .await
            .unwrap()
            .expect("skip inflight");
        assert_eq!(skipped.status, QueuedMessageStatus::Skipped);

        // No blocking failure and no queued messages — the queue is clean.
        assert!(!service.has_blocking_failure(&pool, member).await.unwrap());
        assert!(!service.has_queued(&pool, member).await.unwrap());

        let snapshot = service
            .snapshot_for_member(&pool, entry.session_id, member, entry.agent_id)
            .await
            .expect("snapshot");
        assert_eq!(snapshot.status, MemberQueueStatus::Empty);
        assert!(!snapshot.can_continue);
    }
}
