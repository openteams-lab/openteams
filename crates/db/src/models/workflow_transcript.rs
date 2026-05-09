use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, TS)]
pub struct WorkflowTranscript {
    pub id: Uuid,
    pub execution_id: Uuid,
    pub round_id: Option<Uuid>,
    pub workflow_agent_session_id: Option<Uuid>,
    pub step_id: Option<Uuid>,
    pub sender_type: String,
    pub entry_type: String,
    pub content: String,
    pub meta_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowTranscript {
    pub execution_id: Uuid,
    pub round_id: Option<Uuid>,
    pub workflow_agent_session_id: Option<Uuid>,
    pub step_id: Option<Uuid>,
    pub sender_type: String,
    pub entry_type: String,
    pub content: String,
    pub meta_json: Option<String>,
}

impl WorkflowTranscript {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>("SELECT * FROM chat_workflow_transcripts WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            "SELECT * FROM chat_workflow_transcripts WHERE execution_id = ? ORDER BY created_at ASC",
        )
        .bind(execution_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_unresolved_final_review_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT *
            FROM chat_workflow_transcripts
            WHERE execution_id = ?1
              AND entry_type = 'final_review'
              AND (
                meta_json IS NULL
                OR json_valid(meta_json) = 0
                OR json_extract(meta_json, '$.resolved') IS NULL
                OR json_extract(meta_json, '$.resolved') = 0
              )
            ORDER BY created_at ASC
            LIMIT 1
            "#,
        )
        .bind(execution_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_step(pool: &SqlitePool, step_id: Uuid) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            "SELECT * FROM chat_workflow_transcripts WHERE step_id = ? ORDER BY created_at ASC",
        )
        .bind(step_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_execution_and_agent_session(
        pool: &SqlitePool,
        execution_id: Uuid,
        workflow_agent_session_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            "SELECT * FROM chat_workflow_transcripts WHERE execution_id = ? AND workflow_agent_session_id = ? ORDER BY created_at ASC",
        )
        .bind(execution_id)
        .bind(workflow_agent_session_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateWorkflowTranscript,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            "INSERT INTO chat_workflow_transcripts (id, execution_id, round_id, workflow_agent_session_id, step_id, sender_type, entry_type, content, meta_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING *",
        )
        .bind(id)
        .bind(data.execution_id)
        .bind(data.round_id)
        .bind(data.workflow_agent_session_id)
        .bind(data.step_id)
        .bind(&data.sender_type)
        .bind(&data.entry_type)
        .bind(&data.content)
        .bind(&data.meta_json)
        .bind(Utc::now().to_rfc3339())
        .fetch_one(pool)
        .await
    }

    pub async fn create_unresolved_final_review_if_missing(
        pool: &SqlitePool,
        execution_id: Uuid,
        content: &str,
        description: &str,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        let meta_json = serde_json::json!({
            "resolved": false,
            "description": description,
        })
        .to_string();

        let inserted = sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO chat_workflow_transcripts (
                id, execution_id, round_id, workflow_agent_session_id, step_id,
                sender_type, entry_type, content, meta_json, created_at
            )
            SELECT ?1, ?2, NULL, NULL, NULL, 'control', 'final_review', ?3, ?4, ?5
            WHERE NOT EXISTS (
                SELECT 1
                FROM chat_workflow_transcripts
                WHERE execution_id = ?2
                  AND entry_type = 'final_review'
                  AND (
                    meta_json IS NULL
                    OR json_valid(meta_json) = 0
                    OR json_extract(meta_json, '$.resolved') IS NULL
                    OR json_extract(meta_json, '$.resolved') = 0
                  )
            )
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(execution_id)
        .bind(content)
        .bind(&meta_json)
        .bind(Utc::now().to_rfc3339())
        .fetch_optional(pool)
        .await?;

        if let Some(transcript) = inserted {
            return Ok(transcript);
        }

        Self::find_unresolved_final_review_by_execution(pool, execution_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    pub async fn update_meta_json(
        pool: &SqlitePool,
        id: Uuid,
        meta_json: &str,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            "UPDATE chat_workflow_transcripts SET meta_json = ? WHERE id = ? RETURNING *",
        )
        .bind(meta_json)
        .bind(id)
        .fetch_one(pool)
        .await
    }
}

#[cfg(test)]
mod tests {
    use sqlx::{Row, SqlitePool};
    use uuid::Uuid;

    use super::WorkflowTranscript;

    async fn transcript_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::query(
            r#"
            CREATE TABLE chat_workflow_transcripts (
                id                        BLOB NOT NULL PRIMARY KEY,
                execution_id              BLOB NOT NULL,
                round_id                  BLOB,
                workflow_agent_session_id BLOB,
                step_id                   BLOB,
                sender_type               TEXT NOT NULL,
                entry_type                TEXT NOT NULL,
                content                   TEXT NOT NULL,
                meta_json                 TEXT,
                created_at                TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create transcript table");
        pool
    }

    #[tokio::test]
    async fn create_unresolved_final_review_if_missing_is_idempotent() {
        let pool = transcript_pool().await;
        let execution_id = Uuid::new_v4();

        let first = WorkflowTranscript::create_unresolved_final_review_if_missing(
            &pool,
            execution_id,
            "review?",
            "description",
            Uuid::new_v4(),
        )
        .await
        .expect("create final review");
        let second = WorkflowTranscript::create_unresolved_final_review_if_missing(
            &pool,
            execution_id,
            "review?",
            "description",
            Uuid::new_v4(),
        )
        .await
        .expect("reuse final review");

        assert_eq!(first.id, second.id);

        let count = sqlx::query(
            "SELECT COUNT(*) AS count FROM chat_workflow_transcripts WHERE execution_id = ?1 AND entry_type = 'final_review'",
        )
        .bind(execution_id)
        .fetch_one(&pool)
        .await
        .expect("count final reviews")
        .get::<i64, _>("count");
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn resolved_final_review_does_not_block_new_unresolved_action() {
        let pool = transcript_pool().await;
        let execution_id = Uuid::new_v4();

        let first = WorkflowTranscript::create_unresolved_final_review_if_missing(
            &pool,
            execution_id,
            "review?",
            "description",
            Uuid::new_v4(),
        )
        .await
        .expect("create final review");
        WorkflowTranscript::update_meta_json(
            &pool,
            first.id,
            &serde_json::json!({"resolved": true}).to_string(),
        )
        .await
        .expect("resolve first final review");

        let second = WorkflowTranscript::create_unresolved_final_review_if_missing(
            &pool,
            execution_id,
            "review again?",
            "description",
            Uuid::new_v4(),
        )
        .await
        .expect("create replacement final review");

        assert_ne!(first.id, second.id);
        assert_eq!(
            WorkflowTranscript::find_unresolved_final_review_by_execution(&pool, execution_id)
                .await
                .expect("find unresolved final review")
                .map(|transcript| transcript.id),
            Some(second.id)
        );
    }
}
