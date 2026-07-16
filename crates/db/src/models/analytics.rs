use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

/// SQL persistence DTO for an analytics event. This is not a second event catalog.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct AnalyticsEventRecord {
    pub id: Uuid,
    pub event_type: String,
    pub session_id: Option<Uuid>,
    pub run_id: Option<Uuid>,
    pub workflow_execution_id: Option<Uuid>,
    pub plan_id: Option<Uuid>,
    pub step_id: Option<Uuid>,
    pub payload_json: sqlx::types::Json<serde_json::Value>,
    pub occurred_at: DateTime<Utc>,
    pub app_version: String,
}

#[derive(Debug)]
pub struct CreateAnalyticsEventRecord {
    pub event_type: String,
    pub session_id: Option<Uuid>,
    pub run_id: Option<Uuid>,
    pub workflow_execution_id: Option<Uuid>,
    pub plan_id: Option<Uuid>,
    pub step_id: Option<Uuid>,
    pub payload_json: serde_json::Value,
    pub occurred_at: DateTime<Utc>,
    pub app_version: String,
}

impl AnalyticsEventRecord {
    pub async fn create(
        pool: &SqlitePool,
        data: &CreateAnalyticsEventRecord,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        let payload_size = serde_json::to_vec(&data.payload_json)
            .map_err(|error| sqlx::Error::Protocol(error.to_string()))?
            .len();
        if payload_size > 512 {
            return Err(sqlx::Error::Protocol(format!(
                "analytics payload exceeds 512 byte limit: {payload_size}"
            )));
        }
        sqlx::query_as::<_, Self>(
            r#"INSERT INTO analytics_events
               (id, event_type, session_id, run_id, workflow_execution_id, plan_id, step_id,
                payload_json, occurred_at, app_version)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id, event_type, session_id, run_id, workflow_execution_id, plan_id,
                         step_id, payload_json, occurred_at, app_version"#,
        )
        .bind(id)
        .bind(&data.event_type)
        .bind(data.session_id)
        .bind(data.run_id)
        .bind(data.workflow_execution_id)
        .bind(data.plan_id)
        .bind(data.step_id)
        .bind(sqlx::types::Json(data.payload_json.clone()))
        .bind(data.occurred_at)
        .bind(&data.app_version)
        .fetch_one(pool)
        .await
    }

    pub async fn delete_expired(
        pool: &SqlitePool,
        delivered_before: DateTime<Utc>,
        dead_letter_before: DateTime<Utc>,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"DELETE FROM analytics_events
               WHERE (posthog_status = 'delivered' AND posthog_delivered_at < ?)
                  OR (posthog_status = 'dead_letter' AND occurred_at < ?)"#,
        )
        .bind(delivered_before)
        .bind(dead_letter_before)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn recover_sending(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE analytics_events SET posthog_status = 'retry', posthog_next_attempt_at = CURRENT_TIMESTAMP WHERE posthog_status = 'sending'",
        )
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn claim_due(pool: &SqlitePool, limit: i64) -> Result<Vec<Self>, sqlx::Error> {
        let candidates = sqlx::query_as::<_, Self>(
            r#"SELECT id, event_type, session_id, run_id, workflow_execution_id, plan_id,
                      step_id, payload_json, occurred_at, app_version
               FROM analytics_events
               WHERE posthog_status IN ('pending', 'retry')
                 AND (posthog_next_attempt_at IS NULL OR posthog_next_attempt_at <= CURRENT_TIMESTAMP)
               ORDER BY occurred_at ASC
               LIMIT ?"#,
        )
        .bind(limit)
        .fetch_all(pool)
        .await?;

        let mut claimed = Vec::with_capacity(candidates.len());
        for event in candidates {
            let result = sqlx::query(
                r#"UPDATE analytics_events SET posthog_status = 'sending'
                   WHERE id = ? AND posthog_status IN ('pending', 'retry')"#,
            )
            .bind(event.id)
            .execute(pool)
            .await?;
            if result.rows_affected() == 1 {
                claimed.push(event);
            }
        }
        Ok(claimed)
    }

    pub async fn mark_delivered(pool: &SqlitePool, id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"UPDATE analytics_events
               SET posthog_status = 'delivered', posthog_delivered_at = CURRENT_TIMESTAMP,
                   posthog_next_attempt_at = NULL, posthog_last_error_code = NULL
               WHERE id = ? AND posthog_status = 'sending'"#,
        )
        .bind(id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn release_sending(pool: &SqlitePool, id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"UPDATE analytics_events
               SET posthog_status = 'pending', posthog_next_attempt_at = NULL
               WHERE id = ? AND posthog_status = 'sending'"#,
        )
        .bind(id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn mark_delivery_failed(
        pool: &SqlitePool,
        id: Uuid,
        error_code: &str,
        retryable: bool,
    ) -> Result<(), sqlx::Error> {
        let attempt_count = sqlx::query_scalar::<_, i64>(
            "SELECT posthog_attempt_count FROM analytics_events WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .unwrap_or_default()
            + 1;
        let should_retry = retryable && attempt_count < 5;
        let next_attempt_at =
            Utc::now() + chrono::Duration::seconds(2_i64.pow(attempt_count.min(6) as u32));
        sqlx::query(
            r#"UPDATE analytics_events
               SET posthog_status = ?, posthog_attempt_count = ?, posthog_next_attempt_at = ?,
                   posthog_last_error_code = ?
               WHERE id = ? AND posthog_status = 'sending'"#,
        )
        .bind(if should_retry { "retry" } else { "dead_letter" })
        .bind(attempt_count)
        .bind(should_retry.then_some(next_attempt_at))
        .bind(error_code.chars().take(64).collect::<String>())
        .bind(id)
        .execute(pool)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            r#"CREATE TABLE analytics_events (
                id BLOB PRIMARY KEY NOT NULL,
                event_type TEXT NOT NULL,
                session_id BLOB,
                run_id BLOB,
                workflow_execution_id BLOB,
                plan_id BLOB,
                step_id BLOB,
                payload_json TEXT NOT NULL,
                occurred_at TEXT NOT NULL,
                app_version TEXT NOT NULL,
                posthog_status TEXT NOT NULL DEFAULT 'pending',
                posthog_attempt_count INTEGER NOT NULL DEFAULT 0,
                posthog_next_attempt_at TEXT,
                posthog_last_error_code TEXT,
                posthog_delivered_at TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn payload_is_limited_to_512_bytes() {
        let pool = test_pool().await;
        let result = AnalyticsEventRecord::create(
            &pool,
            &CreateAnalyticsEventRecord {
                event_type: "test".to_string(),
                session_id: None,
                run_id: None,
                workflow_execution_id: None,
                plan_id: None,
                step_id: None,
                payload_json: json!({"value": "x".repeat(513)}),
                occurred_at: Utc::now(),
                app_version: "test".to_string(),
            },
            Uuid::new_v4(),
        )
        .await;
        assert!(matches!(result, Err(sqlx::Error::Protocol(_))));
    }

    #[tokio::test]
    async fn delivery_state_can_retry_and_complete() {
        let pool = test_pool().await;
        let event = AnalyticsEventRecord::create(
            &pool,
            &CreateAnalyticsEventRecord {
                event_type: "test".to_string(),
                session_id: None,
                run_id: None,
                workflow_execution_id: None,
                plan_id: None,
                step_id: None,
                payload_json: json!({}),
                occurred_at: Utc::now(),
                app_version: "test".to_string(),
            },
            Uuid::new_v4(),
        )
        .await
        .unwrap();

        assert_eq!(
            AnalyticsEventRecord::claim_due(&pool, 10)
                .await
                .unwrap()
                .len(),
            1
        );
        AnalyticsEventRecord::mark_delivery_failed(&pool, event.id, "network_error", true)
            .await
            .unwrap();
        let status: String =
            sqlx::query_scalar("SELECT posthog_status FROM analytics_events WHERE id = ?")
                .bind(event.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "retry");

        sqlx::query(
            "UPDATE analytics_events SET posthog_next_attempt_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(event.id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            AnalyticsEventRecord::claim_due(&pool, 10)
                .await
                .unwrap()
                .len(),
            1
        );
        AnalyticsEventRecord::mark_delivered(&pool, event.id)
            .await
            .unwrap();
        let status: String =
            sqlx::query_scalar("SELECT posthog_status FROM analytics_events WHERE id = ?")
                .bind(event.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "delivered");
    }

    #[tokio::test]
    async fn sending_event_can_be_released_when_capture_is_disabled() {
        let pool = test_pool().await;
        let event = AnalyticsEventRecord::create(
            &pool,
            &CreateAnalyticsEventRecord {
                event_type: "test".to_string(),
                session_id: None,
                run_id: None,
                workflow_execution_id: None,
                plan_id: None,
                step_id: None,
                payload_json: json!({}),
                occurred_at: Utc::now(),
                app_version: "test".to_string(),
            },
            Uuid::new_v4(),
        )
        .await
        .unwrap();

        assert_eq!(
            AnalyticsEventRecord::claim_due(&pool, 10)
                .await
                .unwrap()
                .len(),
            1
        );
        AnalyticsEventRecord::release_sending(&pool, event.id)
            .await
            .unwrap();

        let status: String =
            sqlx::query_scalar("SELECT posthog_status FROM analytics_events WHERE id = ?")
                .bind(event.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "pending");
    }
}
