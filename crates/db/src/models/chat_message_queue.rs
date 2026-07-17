use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

const CHAT_MESSAGE_QUEUE_COLUMNS: &str = r#"
    id,
    session_id,
    session_agent_id,
    agent_id,
    chat_message_id,
    status,
    processing_started_at,
    run_id,
    failure_reason,
    created_at,
    updated_at
"#;

/// Lifecycle of a single queued member message.
///
/// `queued` -> `processing` (claimed atomically) -> `running` (bound to a run) ->
/// `completed` (success / normal stop) or `failed` (error). A `failed` entry blocks the
/// member queue until the user continues, which moves it to `skipped`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "chat_message_queue_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum QueuedMessageStatus {
    Queued,
    Processing,
    Running,
    Failed,
    Skipped,
    Completed,
}

/// A durable, member-scoped queue entry referencing an existing `chat_messages` row.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ChatMessageQueue {
    pub id: Uuid,
    pub session_id: Uuid,
    pub session_agent_id: Uuid,
    pub agent_id: Uuid,
    pub chat_message_id: Uuid,
    pub status: QueuedMessageStatus,
    pub processing_started_at: Option<DateTime<Utc>>,
    pub run_id: Option<Uuid>,
    pub failure_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateChatMessageQueue {
    pub session_id: Uuid,
    pub session_agent_id: Uuid,
    pub agent_id: Uuid,
    pub chat_message_id: Uuid,
}

impl ChatMessageQueue {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "SELECT {CHAT_MESSAGE_QUEUE_COLUMNS} FROM chat_message_queue WHERE id = ?1"
        ))
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    /// All entries for a member, oldest first. Used to recover and display the queue.
    pub async fn list_for_member(
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "SELECT {CHAT_MESSAGE_QUEUE_COLUMNS}
             FROM chat_message_queue
             WHERE session_agent_id = ?1
             ORDER BY created_at ASC, id ASC"
        ))
        .bind(session_agent_id)
        .fetch_all(pool)
        .await
    }

    /// The currently in-flight (`processing` or `running`) entry for a member, if any.
    pub async fn find_active_for_member(
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "SELECT {CHAT_MESSAGE_QUEUE_COLUMNS}
             FROM chat_message_queue
             WHERE session_agent_id = ?1 AND status IN ('processing', 'running')
             LIMIT 1"
        ))
        .bind(session_agent_id)
        .fetch_optional(pool)
        .await
    }

    /// Processing entries that were claimed but never bound to a run.
    ///
    /// These rows can survive a backend interruption even when the session-agent state was
    /// already persisted as `idle` or `dead`, so recovery cannot discover them from agent state
    /// alone.
    pub async fn list_unbound_processing(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "SELECT {CHAT_MESSAGE_QUEUE_COLUMNS}
             FROM chat_message_queue
             WHERE status = 'processing' AND run_id IS NULL
             ORDER BY created_at ASC, id ASC"
        ))
        .fetch_all(pool)
        .await
    }

    pub async fn count_queued_for_member(
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<i64, sqlx::Error> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM chat_message_queue
             WHERE session_agent_id = ?1 AND status = 'queued'",
        )
        .bind(session_agent_id)
        .fetch_one(pool)
        .await?;
        Ok(count)
    }

    /// True when the member queue is blocked: a `failed` entry is awaiting user action.
    pub async fn has_blocking_failure(
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let (exists,): (bool,) = sqlx::query_as(
            "SELECT EXISTS(
                 SELECT 1 FROM chat_message_queue
                 WHERE session_agent_id = ?1 AND status = 'failed'
             )",
        )
        .bind(session_agent_id)
        .fetch_one(pool)
        .await?;
        Ok(exists)
    }

    pub async fn create_queued(
        pool: &SqlitePool,
        data: &CreateChatMessageQueue,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "INSERT INTO chat_message_queue (
                 id, session_id, session_agent_id, agent_id, chat_message_id, status
             )
             VALUES (?1, ?2, ?3, ?4, ?5, 'queued')
             RETURNING {CHAT_MESSAGE_QUEUE_COLUMNS}"
        ))
        .bind(id)
        .bind(data.session_id)
        .bind(data.session_agent_id)
        .bind(data.agent_id)
        .bind(data.chat_message_id)
        .fetch_one(pool)
        .await
    }

    /// Atomically claim the oldest `queued` entry for a member and move it to `processing`.
    ///
    /// Returns `None` when there is nothing to claim, the member already has an in-flight entry,
    /// or the member is blocked by a `failed` entry. The `NOT EXISTS` guard (backed by the
    /// partial unique index) keeps a member to a single in-flight entry, and the `failed` clause
    /// enforces "stop on failure": a failed entry must first be resolved via
    /// [`Self::skip_failed_for_member`] before the queue can advance.
    pub async fn claim_next(
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "UPDATE chat_message_queue
             SET status = 'processing',
                 processing_started_at = datetime('now', 'subsec'),
                 updated_at = datetime('now', 'subsec')
             WHERE id = (
                 SELECT id FROM chat_message_queue
                 WHERE session_agent_id = ?1 AND status = 'queued'
                 ORDER BY created_at ASC, id ASC
                 LIMIT 1
             )
             AND NOT EXISTS (
                 SELECT 1 FROM chat_message_queue
                 WHERE session_agent_id = ?1 AND status IN ('processing', 'running', 'failed')
             )
             RETURNING {CHAT_MESSAGE_QUEUE_COLUMNS}"
        ))
        .bind(session_agent_id)
        .fetch_optional(pool)
        .await
    }

    /// Look up the queue entry currently bound to a run.
    pub async fn find_by_run_id(
        pool: &SqlitePool,
        run_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "SELECT {CHAT_MESSAGE_QUEUE_COLUMNS}
             FROM chat_message_queue
             WHERE run_id = ?1
             LIMIT 1"
        ))
        .bind(run_id)
        .fetch_optional(pool)
        .await
    }

    /// Bind a message to a starting run and move it to `running`, creating the row if it does not
    /// already exist.
    ///
    /// A message that waited in the queue already has a `queued`/`processing` row, which is
    /// advanced in place. A message dispatched directly while the member was idle has no row yet,
    /// so one is inserted straight into `running`. This keeps every dispatched message tracked by
    /// exactly one queue row that the completion handler can finalize via [`Self::find_by_run_id`].
    pub async fn start_or_create_running(
        pool: &SqlitePool,
        data: &CreateChatMessageQueue,
        id: Uuid,
        run_id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        if let Some(row) = sqlx::query_as::<_, Self>(&format!(
            "UPDATE chat_message_queue
             SET status = 'running',
                 run_id = ?3,
                 processing_started_at = COALESCE(processing_started_at, datetime('now', 'subsec')),
                 updated_at = datetime('now', 'subsec')
             WHERE session_agent_id = ?1
               AND chat_message_id = ?2
               AND status IN ('queued', 'processing')
             RETURNING {CHAT_MESSAGE_QUEUE_COLUMNS}"
        ))
        .bind(data.session_agent_id)
        .bind(data.chat_message_id)
        .bind(run_id)
        .fetch_optional(pool)
        .await?
        {
            return Ok(row);
        }

        sqlx::query_as::<_, Self>(&format!(
            "INSERT INTO chat_message_queue (
                 id, session_id, session_agent_id, agent_id, chat_message_id,
                 status, run_id, processing_started_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, datetime('now', 'subsec'))
             RETURNING {CHAT_MESSAGE_QUEUE_COLUMNS}"
        ))
        .bind(id)
        .bind(data.session_id)
        .bind(data.session_agent_id)
        .bind(data.agent_id)
        .bind(data.chat_message_id)
        .bind(run_id)
        .fetch_one(pool)
        .await
    }

    /// Reset any in-flight (`processing`/`running`) entries back to `queued` so they can be
    /// re-dispatched. Used on startup/recovery when a backend interruption left rows stranded
    /// in an in-flight state. Returns the number of re-queued entries.
    pub async fn requeue_stale_inflight(
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE chat_message_queue
             SET status = 'queued',
                 run_id = NULL,
                 processing_started_at = NULL,
                 updated_at = datetime('now', 'subsec')
             WHERE session_agent_id = ?1 AND status IN ('processing', 'running')",
        )
        .bind(session_agent_id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    /// Bind a claimed (`processing`) entry to its run and move it to `running`.
    pub async fn bind_run(
        pool: &SqlitePool,
        id: Uuid,
        run_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "UPDATE chat_message_queue
             SET status = 'running',
                 run_id = ?2,
                 updated_at = datetime('now', 'subsec')
             WHERE id = ?1 AND status = 'processing'
             RETURNING {CHAT_MESSAGE_QUEUE_COLUMNS}"
        ))
        .bind(id)
        .bind(run_id)
        .fetch_optional(pool)
        .await
    }

    /// Mark an in-flight entry `completed` on success or normal stop.
    pub async fn mark_completed(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "UPDATE chat_message_queue
             SET status = 'completed',
                 updated_at = datetime('now', 'subsec')
             WHERE id = ?1 AND status IN ('processing', 'running')
             RETURNING {CHAT_MESSAGE_QUEUE_COLUMNS}"
        ))
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    /// Complete the row bound to `run_id` and atomically claim this member's next queued row.
    pub async fn complete_run_and_claim_next(
        pool: &SqlitePool,
        run_id: Uuid,
        session_agent_id: Uuid,
    ) -> Result<(Option<Self>, Option<Self>), sqlx::Error> {
        let mut tx = pool.begin().await?;

        let completed = sqlx::query_as::<_, Self>(&format!(
            "UPDATE chat_message_queue
             SET status = 'completed',
                 updated_at = datetime('now', 'subsec')
             WHERE run_id = ?1 AND status IN ('processing', 'running')
             RETURNING {CHAT_MESSAGE_QUEUE_COLUMNS}"
        ))
        .bind(run_id)
        .fetch_optional(&mut *tx)
        .await?;

        let claimed = sqlx::query_as::<_, Self>(&format!(
            "UPDATE chat_message_queue
             SET status = 'processing',
                 processing_started_at = datetime('now', 'subsec'),
                 updated_at = datetime('now', 'subsec')
             WHERE id = (
                 SELECT id FROM chat_message_queue
                 WHERE session_agent_id = ?1 AND status = 'queued'
                 ORDER BY created_at ASC, id ASC
                 LIMIT 1
             )
             AND NOT EXISTS (
                 SELECT 1 FROM chat_message_queue
                 WHERE session_agent_id = ?1 AND status IN ('processing', 'running', 'failed')
             )
             RETURNING {CHAT_MESSAGE_QUEUE_COLUMNS}"
        ))
        .bind(session_agent_id)
        .fetch_optional(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok((completed, claimed))
    }

    /// Mark an in-flight entry `failed`. Remaining `queued` entries are left untouched so the
    /// member queue is blocked rather than drained.
    pub async fn mark_failed(
        pool: &SqlitePool,
        id: Uuid,
        failure_reason: Option<String>,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "UPDATE chat_message_queue
             SET status = 'failed',
                 failure_reason = ?2,
                 updated_at = datetime('now', 'subsec')
             WHERE id = ?1 AND status IN ('processing', 'running')
             RETURNING {CHAT_MESSAGE_QUEUE_COLUMNS}"
        ))
        .bind(id)
        .bind(failure_reason)
        .fetch_optional(pool)
        .await
    }

    /// Skip an in-flight (`processing`/`running`) entry directly, transitioning it to `skipped`.
    ///
    /// Used when a run fails but there are no queued messages waiting behind it, so the queue
    /// stays clean for the next message instead of being blocked by a stale `failed` row.
    pub async fn skip_inflight(
        pool: &SqlitePool,
        id: Uuid,
        failure_reason: Option<String>,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "UPDATE chat_message_queue
             SET status = 'skipped',
                 failure_reason = ?2,
                 updated_at = datetime('now', 'subsec')
             WHERE id = ?1 AND status IN ('processing', 'running')
             RETURNING {CHAT_MESSAGE_QUEUE_COLUMNS}"
        ))
        .bind(id)
        .bind(failure_reason)
        .fetch_optional(pool)
        .await
    }

    /// Continue execution after a failure: move all `failed` entries for a member to `skipped`
    /// so `claim_next` can pick up the remaining queue. Returns the number of skipped entries.
    pub async fn skip_failed_for_member(
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE chat_message_queue
             SET status = 'skipped',
                 updated_at = datetime('now', 'subsec')
             WHERE session_agent_id = ?1 AND status = 'failed'",
        )
        .bind(session_agent_id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    /// Delete a `queued` entry (user removed it before it started). Only `queued` rows can be
    /// deleted; in-flight or terminal rows are preserved. Returns the number of deleted rows.
    pub async fn delete_queued(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result =
            sqlx::query("DELETE FROM chat_message_queue WHERE id = ?1 AND status = 'queued'")
                .bind(id)
                .execute(pool)
                .await?;
        Ok(result.rows_affected())
    }

    /// Count queue rows that reference the same `chat_message_id`, excluding the given queue id.
    ///
    /// Used by the delete-queue flow to decide whether the underlying `chat_messages` row can be
    /// removed safely: when no other queue entry (any member, any status) references it, the source
    /// message was never visible to any agent run and should be cleaned up so it does not
    /// reappear on refresh.
    pub async fn count_other_references_for_chat_message(
        pool: &SqlitePool,
        chat_message_id: Uuid,
        exclude_queue_id: Uuid,
    ) -> Result<i64, sqlx::Error> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM chat_message_queue
             WHERE chat_message_id = ?1 AND id <> ?2",
        )
        .bind(chat_message_id)
        .bind(exclude_queue_id)
        .fetch_one(pool)
        .await?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::{ChatMessageQueue, CreateChatMessageQueue, QueuedMessageStatus};

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

    async fn setup_pool_with_foreign_keys() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .expect("enable foreign keys");
        sqlx::query("CREATE TABLE chat_sessions (id BLOB PRIMARY KEY)")
            .execute(&pool)
            .await
            .expect("create chat_sessions");
        sqlx::query("CREATE TABLE chat_agents (id BLOB PRIMARY KEY)")
            .execute(&pool)
            .await
            .expect("create chat_agents");
        sqlx::query(
            r#"
            CREATE TABLE chat_session_agents (
                id         BLOB PRIMARY KEY,
                session_id BLOB NOT NULL REFERENCES chat_sessions(id),
                agent_id   BLOB NOT NULL REFERENCES chat_agents(id)
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create chat_session_agents");
        sqlx::query(
            r#"
            CREATE TABLE chat_messages (
                id         BLOB PRIMARY KEY,
                session_id BLOB NOT NULL REFERENCES chat_sessions(id)
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create chat_messages");
        sqlx::query(
            r#"
            CREATE TABLE chat_runs (
                id                        BLOB PRIMARY KEY,
                session_id                BLOB NOT NULL,
                session_agent_id          BLOB NOT NULL,
                workspace_path            TEXT,
                run_index                 INTEGER NOT NULL,
                run_dir                   TEXT NOT NULL,
                input_path                TEXT,
                output_path               TEXT,
                raw_log_path              TEXT,
                meta_path                 TEXT,
                log_state                 TEXT NOT NULL DEFAULT 'live',
                artifact_state            TEXT NOT NULL DEFAULT 'full',
                log_truncated             INTEGER NOT NULL DEFAULT 0,
                log_capture_degraded      INTEGER NOT NULL DEFAULT 0,
                pruned_at                 TEXT,
                prune_reason              TEXT,
                retention_summary_json    TEXT,
                created_at                TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create chat_runs");
        sqlx::query(
            r#"
            CREATE TABLE chat_message_queue (
                id                    BLOB PRIMARY KEY,
                session_id            BLOB NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                session_agent_id      BLOB NOT NULL REFERENCES chat_session_agents(id) ON DELETE CASCADE,
                agent_id              BLOB NOT NULL REFERENCES chat_agents(id) ON DELETE CASCADE,
                chat_message_id       BLOB NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
                status                TEXT NOT NULL DEFAULT 'queued'
                                        CHECK (status IN ('queued','processing','running','failed','skipped','completed')),
                processing_started_at TEXT,
                run_id                BLOB REFERENCES chat_runs(id) ON DELETE SET NULL,
                failure_reason        TEXT,
                created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create chat_message_queue");
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

    async fn seed_referenced_chat_rows(
        pool: &SqlitePool,
        data: &CreateChatMessageQueue,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO chat_sessions (id) VALUES (?1)")
            .bind(data.session_id)
            .execute(pool)
            .await?;
        sqlx::query("INSERT INTO chat_agents (id) VALUES (?1)")
            .bind(data.agent_id)
            .execute(pool)
            .await?;
        sqlx::query(
            "INSERT INTO chat_session_agents (id, session_id, agent_id) VALUES (?1, ?2, ?3)",
        )
        .bind(data.session_agent_id)
        .bind(data.session_id)
        .bind(data.agent_id)
        .execute(pool)
        .await?;
        sqlx::query("INSERT INTO chat_messages (id, session_id) VALUES (?1, ?2)")
            .bind(data.chat_message_id)
            .bind(data.session_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    async fn insert_chat_run(
        pool: &SqlitePool,
        run_id: Uuid,
        data: &CreateChatMessageQueue,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO chat_runs (id, session_id, session_agent_id, run_index, run_dir)
            VALUES (?1, ?2, ?3, 1, 'run-dir')
            "#,
        )
        .bind(run_id)
        .bind(data.session_id)
        .bind(data.session_agent_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Enqueue an entry. `seq` makes `created_at` strictly ordering across entries so the
    /// in-memory clock granularity never makes the test flaky.
    async fn enqueue(pool: &SqlitePool, session_agent_id: Uuid, seq: i64) -> ChatMessageQueue {
        let entry = ChatMessageQueue::create_queued(
            pool,
            &CreateChatMessageQueue {
                session_id: Uuid::new_v4(),
                session_agent_id,
                agent_id: Uuid::new_v4(),
                chat_message_id: Uuid::new_v4(),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("enqueue");
        sqlx::query("UPDATE chat_message_queue SET created_at = ?2 WHERE id = ?1")
            .bind(entry.id)
            .bind(format!("2026-06-17T00:00:0{seq}.000"))
            .execute(pool)
            .await
            .expect("set created_at");
        entry
    }

    #[tokio::test]
    async fn claim_next_takes_oldest_and_blocks_second_claim() {
        let pool = setup_pool().await;
        let member = Uuid::new_v4();
        let first = enqueue(&pool, member, 1).await;
        let _second = enqueue(&pool, member, 2).await;

        let claimed = ChatMessageQueue::claim_next(&pool, member)
            .await
            .expect("claim")
            .expect("an entry to claim");
        assert_eq!(claimed.id, first.id);
        assert_eq!(claimed.status, QueuedMessageStatus::Processing);
        assert!(claimed.processing_started_at.is_some());

        // A second claim while one is in-flight returns nothing.
        let none = ChatMessageQueue::claim_next(&pool, member)
            .await
            .expect("claim");
        assert!(none.is_none());
    }

    #[tokio::test]
    async fn bind_run_then_complete_advances_to_next() {
        let pool = setup_pool().await;
        let member = Uuid::new_v4();
        let first = enqueue(&pool, member, 1).await;
        let second = enqueue(&pool, member, 2).await;

        let claimed = ChatMessageQueue::claim_next(&pool, member)
            .await
            .unwrap()
            .unwrap();
        let run_id = Uuid::new_v4();
        let running = ChatMessageQueue::bind_run(&pool, claimed.id, run_id)
            .await
            .unwrap()
            .expect("bind run");
        assert_eq!(running.status, QueuedMessageStatus::Running);
        assert_eq!(running.run_id, Some(run_id));

        let completed = ChatMessageQueue::mark_completed(&pool, claimed.id)
            .await
            .unwrap()
            .expect("complete");
        assert_eq!(completed.status, QueuedMessageStatus::Completed);

        // Member is now idle, so the next entry can be claimed.
        let next = ChatMessageQueue::claim_next(&pool, member)
            .await
            .unwrap()
            .expect("claim next");
        assert_eq!(next.id, second.id);
        assert_eq!(first.session_agent_id, member);
    }

    #[tokio::test]
    async fn complete_run_and_claim_next_is_atomic_for_member_queue() {
        let pool = setup_pool().await;
        let member = Uuid::new_v4();
        let first = enqueue(&pool, member, 1).await;
        let second = enqueue(&pool, member, 2).await;

        let claimed = ChatMessageQueue::claim_next(&pool, member)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed.id, first.id);
        let run_id = Uuid::new_v4();
        ChatMessageQueue::bind_run(&pool, claimed.id, run_id)
            .await
            .unwrap()
            .expect("bind run");

        let (completed, next) =
            ChatMessageQueue::complete_run_and_claim_next(&pool, run_id, member)
                .await
                .expect("complete and claim");

        let completed = completed.expect("completed row");
        assert_eq!(completed.id, first.id);
        assert_eq!(completed.status, QueuedMessageStatus::Completed);
        let next = next.expect("next queued row");
        assert_eq!(next.id, second.id);
        assert_eq!(next.status, QueuedMessageStatus::Processing);
    }

    #[tokio::test]
    async fn failure_blocks_queue_until_skipped() {
        let pool = setup_pool().await;
        let member = Uuid::new_v4();
        let first = enqueue(&pool, member, 1).await;
        let _second = enqueue(&pool, member, 2).await;

        let claimed = ChatMessageQueue::claim_next(&pool, member)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed.id, first.id);

        let failed = ChatMessageQueue::mark_failed(&pool, claimed.id, Some("boom".into()))
            .await
            .unwrap()
            .expect("fail");
        assert_eq!(failed.status, QueuedMessageStatus::Failed);
        assert_eq!(failed.failure_reason.as_deref(), Some("boom"));

        // Remaining queued entry is untouched and the member is blocked.
        assert_eq!(
            ChatMessageQueue::count_queued_for_member(&pool, member)
                .await
                .unwrap(),
            1
        );
        assert!(
            ChatMessageQueue::has_blocking_failure(&pool, member)
                .await
                .unwrap()
        );
        // While blocked by a failed entry, claim_next must NOT advance the queue.
        assert!(
            ChatMessageQueue::claim_next(&pool, member)
                .await
                .unwrap()
                .is_none()
        );

        let skipped = ChatMessageQueue::skip_failed_for_member(&pool, member)
            .await
            .unwrap();
        assert_eq!(skipped, 1);
        assert!(
            !ChatMessageQueue::has_blocking_failure(&pool, member)
                .await
                .unwrap()
        );

        let next = ChatMessageQueue::claim_next(&pool, member)
            .await
            .unwrap()
            .expect("claim after resume");
        assert_eq!(next.status, QueuedMessageStatus::Processing);
    }

    #[tokio::test]
    async fn skip_inflight_transitions_processing_to_skipped() {
        let pool = setup_pool().await;
        let member = Uuid::new_v4();
        let first = enqueue(&pool, member, 1).await;

        let claimed = ChatMessageQueue::claim_next(&pool, member)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed.id, first.id);

        let skipped = ChatMessageQueue::skip_inflight(&pool, claimed.id, Some("auto-skip".into()))
            .await
            .unwrap()
            .expect("skip inflight");
        assert_eq!(skipped.status, QueuedMessageStatus::Skipped);
        assert_eq!(skipped.failure_reason.as_deref(), Some("auto-skip"));

        // No blocking failure remains — the queue is clean for the next message.
        assert!(
            !ChatMessageQueue::has_blocking_failure(&pool, member)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn skip_inflight_leaves_queued_entries_claimable() {
        let pool = setup_pool().await;
        let member = Uuid::new_v4();
        let first = enqueue(&pool, member, 1).await;
        let second = enqueue(&pool, member, 2).await;

        let claimed = ChatMessageQueue::claim_next(&pool, member)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed.id, first.id);

        // Auto-skipping the in-flight entry does not touch queued entries.
        let skipped = ChatMessageQueue::skip_inflight(&pool, claimed.id, Some("auto-skip".into()))
            .await
            .unwrap()
            .expect("skip inflight");
        assert_eq!(skipped.status, QueuedMessageStatus::Skipped);

        // The remaining queued entry is claimable immediately (no failed row blocking it).
        let next = ChatMessageQueue::claim_next(&pool, member)
            .await
            .unwrap()
            .expect("claim remaining");
        assert_eq!(next.id, second.id);
    }

    #[tokio::test]
    async fn skip_inflight_only_affects_in_flight_rows() {
        let pool = setup_pool().await;
        let member = Uuid::new_v4();
        let queued = enqueue(&pool, member, 1).await;

        // A queued (not in-flight) row is not affected by skip_inflight.
        let result = ChatMessageQueue::skip_inflight(&pool, queued.id, Some("nope".into()))
            .await
            .unwrap();
        assert!(result.is_none());
        assert_eq!(
            ChatMessageQueue::find_by_id(&pool, queued.id)
                .await
                .unwrap()
                .unwrap()
                .status,
            QueuedMessageStatus::Queued
        );
    }

    #[tokio::test]
    async fn delete_only_removes_queued_entries() {
        let pool = setup_pool().await;
        let member = Uuid::new_v4();
        let queued = enqueue(&pool, member, 1).await;
        let to_run = enqueue(&pool, member, 2).await;

        // Deleting a queued entry succeeds.
        assert_eq!(
            ChatMessageQueue::delete_queued(&pool, queued.id)
                .await
                .unwrap(),
            1
        );
        assert!(
            ChatMessageQueue::find_by_id(&pool, queued.id)
                .await
                .unwrap()
                .is_none()
        );

        // An in-flight entry cannot be deleted via delete_queued.
        let claimed = ChatMessageQueue::claim_next(&pool, member)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed.id, to_run.id);
        assert_eq!(
            ChatMessageQueue::delete_queued(&pool, to_run.id)
                .await
                .unwrap(),
            0
        );
        assert!(
            ChatMessageQueue::find_by_id(&pool, to_run.id)
                .await
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn count_other_references_for_chat_message_reflects_remaining_rows() {
        let pool = setup_pool().await;
        // Two members share the same source chat_message (e.g. multi-agent mention).
        let shared_message_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        let agent_a = Uuid::new_v4();
        let agent_b = Uuid::new_v4();
        let row_a = ChatMessageQueue::create_queued(
            &pool,
            &CreateChatMessageQueue {
                session_id,
                session_agent_id: agent_a,
                agent_id: Uuid::new_v4(),
                chat_message_id: shared_message_id,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("enqueue a");
        let row_b = ChatMessageQueue::create_queued(
            &pool,
            &CreateChatMessageQueue {
                session_id,
                session_agent_id: agent_b,
                agent_id: Uuid::new_v4(),
                chat_message_id: shared_message_id,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("enqueue b");

        // From row_a's perspective, row_b still references the source message.
        assert_eq!(
            ChatMessageQueue::count_other_references_for_chat_message(
                &pool,
                shared_message_id,
                row_a.id
            )
            .await
            .unwrap(),
            1
        );
        // Once row_b is gone, no other references remain.
        ChatMessageQueue::delete_queued(&pool, row_b.id)
            .await
            .unwrap();
        assert_eq!(
            ChatMessageQueue::count_other_references_for_chat_message(
                &pool,
                shared_message_id,
                row_a.id
            )
            .await
            .unwrap(),
            0
        );
        // An unrelated message has no references at all.
        assert_eq!(
            ChatMessageQueue::count_other_references_for_chat_message(
                &pool,
                Uuid::new_v4(),
                row_a.id
            )
            .await
            .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn start_or_create_running_inserts_then_advances_in_place() {
        let pool = setup_pool().await;
        let member = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        let agent_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();
        let data = CreateChatMessageQueue {
            session_id,
            session_agent_id: member,
            agent_id,
            chat_message_id: message_id,
        };

        // No row yet -> a fresh running row is inserted (direct mention while idle).
        let run_id = Uuid::new_v4();
        let created =
            ChatMessageQueue::start_or_create_running(&pool, &data, Uuid::new_v4(), run_id)
                .await
                .expect("create running");
        assert_eq!(created.status, QueuedMessageStatus::Running);
        assert_eq!(created.run_id, Some(run_id));
        let found = ChatMessageQueue::find_by_run_id(&pool, run_id)
            .await
            .unwrap()
            .expect("find by run id");
        assert_eq!(found.id, created.id);

        // A previously queued message is advanced in place (no duplicate row).
        let queued = enqueue(&pool, member, 5).await;
        // mark the active one complete so the unique in-flight index is free
        ChatMessageQueue::mark_completed(&pool, created.id)
            .await
            .unwrap();
        let run_id2 = Uuid::new_v4();
        let advanced = ChatMessageQueue::start_or_create_running(
            &pool,
            &CreateChatMessageQueue {
                session_id,
                session_agent_id: member,
                agent_id,
                chat_message_id: queued.chat_message_id,
            },
            Uuid::new_v4(),
            run_id2,
        )
        .await
        .expect("advance running");
        assert_eq!(advanced.id, queued.id);
        assert_eq!(advanced.status, QueuedMessageStatus::Running);
        assert_eq!(
            ChatMessageQueue::list_for_member(&pool, member)
                .await
                .unwrap()
                .len(),
            2
        );
    }

    #[tokio::test]
    async fn start_or_create_running_requires_existing_chat_run_fk() {
        let pool = setup_pool_with_foreign_keys().await;
        let data = CreateChatMessageQueue {
            session_id: Uuid::new_v4(),
            session_agent_id: Uuid::new_v4(),
            agent_id: Uuid::new_v4(),
            chat_message_id: Uuid::new_v4(),
        };
        seed_referenced_chat_rows(&pool, &data)
            .await
            .expect("seed parent rows");
        let run_id = Uuid::new_v4();

        let err = ChatMessageQueue::start_or_create_running(&pool, &data, Uuid::new_v4(), run_id)
            .await
            .expect_err("run_id FK should reject binding before chat_runs insert");
        assert!(matches!(err, sqlx::Error::Database(_)));

        insert_chat_run(&pool, run_id, &data)
            .await
            .expect("insert chat run");
        let running =
            ChatMessageQueue::start_or_create_running(&pool, &data, Uuid::new_v4(), run_id)
                .await
                .expect("bind after chat run exists");
        assert_eq!(running.status, QueuedMessageStatus::Running);
        assert_eq!(running.run_id, Some(run_id));
    }

    #[tokio::test]
    async fn requeue_stale_inflight_resets_in_flight_rows() {
        let pool = setup_pool().await;
        let member = Uuid::new_v4();
        let _first = enqueue(&pool, member, 1).await;
        let claimed = ChatMessageQueue::claim_next(&pool, member)
            .await
            .unwrap()
            .unwrap();
        ChatMessageQueue::bind_run(&pool, claimed.id, Uuid::new_v4())
            .await
            .unwrap();

        let requeued = ChatMessageQueue::requeue_stale_inflight(&pool, member)
            .await
            .unwrap();
        assert_eq!(requeued, 1);

        // The reset row is claimable again and has no lingering run binding.
        let reclaimed = ChatMessageQueue::claim_next(&pool, member)
            .await
            .unwrap()
            .expect("reclaim after requeue");
        assert_eq!(reclaimed.id, claimed.id);
        assert!(reclaimed.run_id.is_none());
    }

    #[tokio::test]
    async fn list_unbound_processing_excludes_rows_already_bound_to_runs() {
        let pool = setup_pool().await;
        let unbound_member = Uuid::new_v4();
        let bound_member = Uuid::new_v4();
        let unbound = enqueue(&pool, unbound_member, 1).await;
        let bound = enqueue(&pool, bound_member, 2).await;

        let claimed_unbound = ChatMessageQueue::claim_next(&pool, unbound_member)
            .await
            .unwrap()
            .unwrap();
        let claimed_bound = ChatMessageQueue::claim_next(&pool, bound_member)
            .await
            .unwrap()
            .unwrap();
        ChatMessageQueue::bind_run(&pool, claimed_bound.id, Uuid::new_v4())
            .await
            .unwrap()
            .expect("bind second row");

        let rows = ChatMessageQueue::list_unbound_processing(&pool)
            .await
            .expect("list unbound processing");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, claimed_unbound.id);
        assert_eq!(rows[0].id, unbound.id);
        assert_ne!(rows[0].id, bound.id);
    }

    #[tokio::test]
    async fn members_are_isolated() {
        let pool = setup_pool().await;
        let member_a = Uuid::new_v4();
        let member_b = Uuid::new_v4();
        enqueue(&pool, member_a, 1).await;
        enqueue(&pool, member_b, 1).await;

        // Claiming for A does not affect B's queue.
        ChatMessageQueue::claim_next(&pool, member_a)
            .await
            .unwrap()
            .unwrap();
        let b_entries = ChatMessageQueue::list_for_member(&pool, member_b)
            .await
            .unwrap();
        assert_eq!(b_entries.len(), 1);
        assert_eq!(b_entries[0].status, QueuedMessageStatus::Queued);
        let b_claim = ChatMessageQueue::claim_next(&pool, member_b)
            .await
            .unwrap()
            .expect("B can still claim independently");
        assert_eq!(b_claim.status, QueuedMessageStatus::Processing);
    }
}
