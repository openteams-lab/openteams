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

    pub async fn find_unresolved_reviews_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT *
            FROM chat_workflow_transcripts
            WHERE execution_id = ?1
              AND entry_type IN ('step_review', 'loop_review', 'final_review')
              AND (
                meta_json IS NULL
                OR json_valid(meta_json) = 0
                OR json_extract(meta_json, '$.resolved') IS NULL
                OR json_extract(meta_json, '$.resolved') = 0
              )
            ORDER BY created_at ASC
            "#,
        )
        .bind(execution_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_execution_paginated(
        pool: &SqlitePool,
        execution_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT *
            FROM chat_workflow_transcripts
            WHERE execution_id = ?1
            ORDER BY created_at ASC
            LIMIT ?2 OFFSET ?3
            "#,
        )
        .bind(execution_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_execution_with_step_filter(
        pool: &SqlitePool,
        execution_id: Uuid,
        step_id: Option<Uuid>,
        step_key: Option<&str>,
        workflow_agent_session_id: Option<Uuid>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<Self>, sqlx::Error> {
        Self::find_by_execution_filtered(
            pool,
            execution_id,
            step_id,
            step_key,
            workflow_agent_session_id,
            None,
            None,
            limit,
            offset,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn find_by_execution_filtered(
        pool: &SqlitePool,
        execution_id: Uuid,
        step_id: Option<Uuid>,
        step_key: Option<&str>,
        workflow_agent_session_id: Option<Uuid>,
        entry_type: Option<&str>,
        unresolved: Option<bool>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<Self>, sqlx::Error> {
        let mut sql =
            String::from("SELECT t.* FROM chat_workflow_transcripts t WHERE t.execution_id = ?");
        let mut param_idx: u32 = 1;
        if step_id.is_some() {
            param_idx += 1;
            sql.push_str(&format!(" AND t.step_id = ?{param_idx}"));
        }
        if step_key.is_some() {
            param_idx += 1;
            sql.push_str(&format!(
                " AND t.step_id IN (SELECT s.id FROM chat_workflow_steps s WHERE s.step_key = ?{param_idx})"
            ));
        }
        if workflow_agent_session_id.is_some() {
            param_idx += 1;
            sql.push_str(&format!(" AND t.workflow_agent_session_id = ?{param_idx}"));
        }
        if entry_type.is_some() {
            param_idx += 1;
            sql.push_str(&format!(" AND t.entry_type = ?{param_idx}"));
        }
        if let Some(unresolved) = unresolved {
            if unresolved {
                sql.push_str(
                    " AND (t.meta_json IS NULL OR json_valid(t.meta_json) = 0 OR json_extract(t.meta_json, '$.resolved') IS NULL OR json_extract(t.meta_json, '$.resolved') = 0)",
                );
            } else {
                sql.push_str(
                    " AND json_valid(t.meta_json) = 1 AND json_extract(t.meta_json, '$.resolved') = 1",
                );
            }
        }
        sql.push_str(" ORDER BY t.created_at ASC");

        let offset_val = offset.unwrap_or(0);
        if limit.is_some() {
            param_idx += 1;
            sql.push_str(&format!(" LIMIT ?{param_idx}"));
            param_idx += 1;
            sql.push_str(&format!(" OFFSET ?{param_idx}"));
        } else if offset_val > 0 {
            param_idx += 1;
            sql.push_str(&format!(" LIMIT -1 OFFSET ?{param_idx}"));
        }

        let mut query = sqlx::query_as::<_, Self>(&sql).bind(execution_id);
        if let Some(sid) = step_id {
            query = query.bind(sid);
        }
        if let Some(sk) = step_key {
            query = query.bind(sk);
        }
        if let Some(was) = workflow_agent_session_id {
            query = query.bind(was);
        }
        if let Some(kind) = entry_type {
            query = query.bind(kind);
        }
        if let Some(limit_val) = limit {
            query = query.bind(limit_val).bind(offset_val);
        } else if offset_val > 0 {
            query = query.bind(offset_val);
        }
        query.fetch_all(pool).await
    }

    pub async fn count_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<i64, sqlx::Error> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM chat_workflow_transcripts WHERE execution_id = ?1",
        )
        .bind(execution_id)
        .fetch_one(pool)
        .await?;
        Ok(row.0)
    }

    pub async fn delete_non_essential_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            DELETE FROM chat_workflow_transcripts
            WHERE execution_id = ?1
              AND entry_type NOT IN (
                  'step_review', 'loop_review', 'final_review',
                  'error', 'input_request', 'approval_request',
                  'permission_request', 'continue_confirmation'
              )
            "#,
        )
        .bind(execution_id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use sqlx::{Row, SqlitePool};
    use uuid::Uuid;

    use super::{CreateWorkflowTranscript, WorkflowTranscript};

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

    #[tokio::test]
    async fn find_unresolved_reviews_returns_only_unresolved_reviews() {
        let pool = transcript_pool().await;
        let execution_id = Uuid::new_v4();

        WorkflowTranscript::create(
            &pool,
            &CreateWorkflowTranscript {
                execution_id,
                round_id: None,
                workflow_agent_session_id: None,
                step_id: Some(Uuid::new_v4()),
                sender_type: "agent".to_string(),
                entry_type: "thinking".to_string(),
                content: "thinking content".to_string(),
                meta_json: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create thinking transcript");

        WorkflowTranscript::create(
            &pool,
            &CreateWorkflowTranscript {
                execution_id,
                round_id: None,
                workflow_agent_session_id: None,
                step_id: Some(Uuid::new_v4()),
                sender_type: "control".to_string(),
                entry_type: "step_review".to_string(),
                content: "unresolved review".to_string(),
                meta_json: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create unresolved step_review");

        let resolved_id = Uuid::new_v4();
        WorkflowTranscript::create(
            &pool,
            &CreateWorkflowTranscript {
                execution_id,
                round_id: None,
                workflow_agent_session_id: None,
                step_id: Some(Uuid::new_v4()),
                sender_type: "control".to_string(),
                entry_type: "step_review".to_string(),
                content: "resolved review".to_string(),
                meta_json: Some(serde_json::json!({"resolved": true}).to_string()),
            },
            resolved_id,
        )
        .await
        .expect("create resolved step_review");

        let unresolved =
            WorkflowTranscript::find_unresolved_reviews_by_execution(&pool, execution_id)
                .await
                .expect("find unresolved reviews");

        assert_eq!(unresolved.len(), 1);
        assert_eq!(unresolved[0].content, "unresolved review");
        assert_ne!(unresolved[0].id, resolved_id);
    }

    #[tokio::test]
    async fn pagination_and_count_work_correctly() {
        let pool = transcript_pool().await;
        let execution_id = Uuid::new_v4();

        for i in 0..5 {
            WorkflowTranscript::create(
                &pool,
                &CreateWorkflowTranscript {
                    execution_id,
                    round_id: None,
                    workflow_agent_session_id: None,
                    step_id: None,
                    sender_type: "agent".to_string(),
                    entry_type: "thinking".to_string(),
                    content: format!("entry {i}"),
                    meta_json: None,
                },
                Uuid::new_v4(),
            )
            .await
            .expect("create transcript");
        }

        let count = WorkflowTranscript::count_by_execution(&pool, execution_id)
            .await
            .expect("count");
        assert_eq!(count, 5);

        let page = WorkflowTranscript::find_by_execution_paginated(&pool, execution_id, 2, 1)
            .await
            .expect("paginate");
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].content, "entry 1");
        assert_eq!(page[1].content, "entry 2");
    }

    #[tokio::test]
    async fn delete_non_essential_preserves_reviews_and_escalation_transcripts() {
        let pool = transcript_pool().await;
        let execution_id = Uuid::new_v4();
        let step_id = Uuid::new_v4();

        WorkflowTranscript::create(
            &pool,
            &CreateWorkflowTranscript {
                execution_id,
                round_id: None,
                workflow_agent_session_id: None,
                step_id: Some(step_id),
                sender_type: "agent".to_string(),
                entry_type: "thinking".to_string(),
                content: "thinking".to_string(),
                meta_json: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create thinking");

        WorkflowTranscript::create(
            &pool,
            &CreateWorkflowTranscript {
                execution_id,
                round_id: None,
                workflow_agent_session_id: None,
                step_id: Some(step_id),
                sender_type: "control".to_string(),
                entry_type: "step_review".to_string(),
                content: "review".to_string(),
                meta_json: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create step_review");

        WorkflowTranscript::create(
            &pool,
            &CreateWorkflowTranscript {
                execution_id,
                round_id: None,
                workflow_agent_session_id: None,
                step_id: None,
                sender_type: "control".to_string(),
                entry_type: "error".to_string(),
                content: "error detail".to_string(),
                meta_json: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create error");

        WorkflowTranscript::create(
            &pool,
            &CreateWorkflowTranscript {
                execution_id,
                round_id: None,
                workflow_agent_session_id: None,
                step_id: None,
                sender_type: "control".to_string(),
                entry_type: "approval_request".to_string(),
                content: "approval".to_string(),
                meta_json: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create approval_request");

        WorkflowTranscript::create(
            &pool,
            &CreateWorkflowTranscript {
                execution_id,
                round_id: None,
                workflow_agent_session_id: None,
                step_id: None,
                sender_type: "control".to_string(),
                entry_type: "final_review".to_string(),
                content: "final".to_string(),
                meta_json: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create final_review");

        let removed = WorkflowTranscript::delete_non_essential_by_execution(&pool, execution_id)
            .await
            .expect("delete non-essential");
        assert_eq!(removed, 1, "only thinking should be removed");

        let remaining = WorkflowTranscript::find_by_execution(&pool, execution_id)
            .await
            .expect("find remaining");
        assert_eq!(remaining.len(), 4);
        let types: Vec<&str> = remaining.iter().map(|t| t.entry_type.as_str()).collect();
        assert!(types.contains(&"step_review"));
        assert!(types.contains(&"final_review"));
        assert!(types.contains(&"error"));
        assert!(types.contains(&"approval_request"));
        assert!(!types.contains(&"thinking"));
    }

    async fn transcript_pool_with_steps() -> SqlitePool {
        let pool = transcript_pool().await;
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS chat_workflow_steps (
                id BLOB NOT NULL PRIMARY KEY,
                execution_id BLOB NOT NULL,
                step_key TEXT NOT NULL DEFAULT '',
                step_type TEXT NOT NULL DEFAULT 'task',
                title TEXT NOT NULL DEFAULT '',
                summary_text TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                instructions TEXT NOT NULL DEFAULT '',
                content TEXT,
                revision_context TEXT,
                meta_json TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create steps table");
        pool
    }

    #[tokio::test]
    async fn step_filter_with_pagination_works_for_all_filter_combinations() {
        let pool = transcript_pool_with_steps().await;
        let execution_id = Uuid::new_v4();
        let step_a = Uuid::new_v4();
        let step_b = Uuid::new_v4();
        let agent_session = Uuid::new_v4();

        sqlx::query(
            "INSERT INTO chat_workflow_steps (id, execution_id, step_key, step_type, title, status, instructions) VALUES (?1, ?2, 'step_a', 'task', 'A', 'pending', '')",
        )
        .bind(step_a)
        .bind(execution_id)
        .execute(&pool)
        .await
        .expect("insert step_a");

        sqlx::query(
            "INSERT INTO chat_workflow_steps (id, execution_id, step_key, step_type, title, status, instructions) VALUES (?1, ?2, 'step_b', 'task', 'B', 'pending', '')",
        )
        .bind(step_b)
        .bind(execution_id)
        .execute(&pool)
        .await
        .expect("insert step_b");

        for i in 0..6 {
            let step_id = if i < 3 { Some(step_a) } else { Some(step_b) };
            WorkflowTranscript::create(
                &pool,
                &CreateWorkflowTranscript {
                    execution_id,
                    round_id: None,
                    workflow_agent_session_id: if i % 2 == 0 {
                        Some(agent_session)
                    } else {
                        None
                    },
                    step_id,
                    sender_type: "agent".to_string(),
                    entry_type: "thinking".to_string(),
                    content: format!("entry {i}"),
                    meta_json: None,
                },
                Uuid::new_v4(),
            )
            .await
            .expect("create transcript");
        }

        let by_step_id = WorkflowTranscript::find_by_execution_with_step_filter(
            &pool,
            execution_id,
            Some(step_a),
            None,
            None,
            None,
            None,
        )
        .await
        .expect("filter by step_id");
        assert_eq!(by_step_id.len(), 3);

        let by_step_key = WorkflowTranscript::find_by_execution_with_step_filter(
            &pool,
            execution_id,
            None,
            Some("step_b"),
            None,
            None,
            None,
        )
        .await
        .expect("filter by step_key");
        assert_eq!(by_step_key.len(), 3);

        let by_agent = WorkflowTranscript::find_by_execution_with_step_filter(
            &pool,
            execution_id,
            None,
            None,
            Some(agent_session),
            None,
            None,
        )
        .await
        .expect("filter by agent");
        assert_eq!(by_agent.len(), 3);

        let combined = WorkflowTranscript::find_by_execution_with_step_filter(
            &pool,
            execution_id,
            Some(step_a),
            None,
            Some(agent_session),
            None,
            None,
        )
        .await
        .expect("filter by step_id+agent");
        assert_eq!(combined.len(), 2);

        let paginated = WorkflowTranscript::find_by_execution_with_step_filter(
            &pool,
            execution_id,
            Some(step_a),
            None,
            None,
            Some(2),
            Some(1),
        )
        .await
        .expect("filter by step_id with pagination");
        assert_eq!(paginated.len(), 2);
    }

    #[tokio::test]
    async fn step_filter_without_limit_returns_all_entries() {
        let pool = transcript_pool().await;
        let execution_id = Uuid::new_v4();
        let step_id = Uuid::new_v4();

        for i in 0..250 {
            WorkflowTranscript::create(
                &pool,
                &CreateWorkflowTranscript {
                    execution_id,
                    round_id: None,
                    workflow_agent_session_id: None,
                    step_id: Some(step_id),
                    sender_type: "agent".to_string(),
                    entry_type: "thinking".to_string(),
                    content: format!("entry {i}"),
                    meta_json: None,
                },
                Uuid::new_v4(),
            )
            .await
            .expect("create transcript");
        }

        let all_entries = WorkflowTranscript::find_by_execution_with_step_filter(
            &pool,
            execution_id,
            Some(step_id),
            None,
            None,
            None,
            None,
        )
        .await
        .expect("filter by step_id without pagination");
        assert_eq!(all_entries.len(), 250);

        let limited_entries = WorkflowTranscript::find_by_execution_with_step_filter(
            &pool,
            execution_id,
            Some(step_id),
            None,
            None,
            Some(200),
            Some(0),
        )
        .await
        .expect("filter by step_id with explicit pagination");
        assert_eq!(limited_entries.len(), 200);
    }

    #[tokio::test]
    async fn filtered_query_can_return_unresolved_final_review_only() {
        let pool = transcript_pool().await;
        let execution_id = Uuid::new_v4();

        WorkflowTranscript::create(
            &pool,
            &CreateWorkflowTranscript {
                execution_id,
                round_id: None,
                workflow_agent_session_id: None,
                step_id: None,
                sender_type: "agent".to_string(),
                entry_type: "thinking".to_string(),
                content: "regular log".to_string(),
                meta_json: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create regular log");

        WorkflowTranscript::create(
            &pool,
            &CreateWorkflowTranscript {
                execution_id,
                round_id: None,
                workflow_agent_session_id: None,
                step_id: None,
                sender_type: "control".to_string(),
                entry_type: "final_review".to_string(),
                content: "resolved final".to_string(),
                meta_json: Some(serde_json::json!({"resolved": true}).to_string()),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create resolved final review");

        WorkflowTranscript::create(
            &pool,
            &CreateWorkflowTranscript {
                execution_id,
                round_id: None,
                workflow_agent_session_id: None,
                step_id: None,
                sender_type: "control".to_string(),
                entry_type: "final_review".to_string(),
                content: "unresolved final".to_string(),
                meta_json: Some(serde_json::json!({"resolved": false}).to_string()),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create unresolved final review");

        let entries = WorkflowTranscript::find_by_execution_filtered(
            &pool,
            execution_id,
            None,
            None,
            None,
            Some("final_review"),
            Some(true),
            Some(1),
            Some(0),
        )
        .await
        .expect("filter final reviews");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].content, "unresolved final");
    }
}
