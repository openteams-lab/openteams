use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::workflow_types::{WorkflowStepStatus, WorkflowStepType};

const STEP_SELECT: &str = r#"
    SELECT id, execution_id, round_id, compiled_revision_id, step_key,
           step_type, title, instructions, assigned_workflow_agent_session_id,
           status, retry_count, max_retry, round_index, display_order,
           latest_run_id, summary_text, content, loop_id, lead_review_required,
           user_review_required, revision_context,
           created_at, updated_at, started_at, completed_at
    FROM chat_workflow_steps
"#;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowStep {
    pub id: Uuid,
    pub execution_id: Uuid,
    pub round_id: Uuid,
    pub compiled_revision_id: Option<Uuid>,
    pub step_key: String,
    pub step_type: WorkflowStepType,
    pub title: String,
    pub instructions: String,
    pub assigned_workflow_agent_session_id: Option<Uuid>,
    pub status: WorkflowStepStatus,
    pub retry_count: i32,
    pub max_retry: i32,
    pub round_index: i32,
    pub display_order: i32,
    pub latest_run_id: Option<Uuid>,
    pub summary_text: Option<String>,
    pub content: Option<String>,
    pub loop_id: Option<Uuid>,
    pub lead_review_required: bool,
    pub user_review_required: bool,
    pub revision_context: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowStep {
    pub execution_id: Uuid,
    pub round_id: Uuid,
    pub compiled_revision_id: Option<Uuid>,
    pub step_key: String,
    pub step_type: WorkflowStepType,
    pub title: String,
    pub instructions: String,
    pub assigned_workflow_agent_session_id: Option<Uuid>,
    pub max_retry: i32,
    pub round_index: i32,
    pub display_order: i32,
    pub loop_id: Option<Uuid>,
    pub lead_review_required: Option<bool>,
    pub user_review_required: Option<bool>,
    pub revision_context: Option<String>,
}

impl WorkflowStep {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!("{STEP_SELECT}\nWHERE id = ?1"))
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_round(
        pool: &SqlitePool,
        round_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{STEP_SELECT}\nWHERE round_id = ?1\nORDER BY display_order ASC"
        ))
        .bind(round_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{STEP_SELECT}\nWHERE execution_id = ?1\nORDER BY display_order ASC"
        ))
        .bind(execution_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateWorkflowStep,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO chat_workflow_steps (
                id, execution_id, round_id, compiled_revision_id, step_key,
                step_type, title, instructions, assigned_workflow_agent_session_id,
                max_retry, round_index, display_order, loop_id,
                lead_review_required, user_review_required, revision_context
            )
            VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                COALESCE(?14, 1), COALESCE(?15, 1), ?16
            )
            RETURNING id, execution_id, round_id, compiled_revision_id, step_key,
                      step_type, title, instructions, assigned_workflow_agent_session_id,
                      status, retry_count, max_retry, round_index, display_order,
                      latest_run_id, summary_text, content, loop_id,
                      lead_review_required, user_review_required, revision_context,
                      created_at, updated_at, started_at, completed_at
            "#,
        )
        .bind(id)
        .bind(data.execution_id)
        .bind(data.round_id)
        .bind(data.compiled_revision_id)
        .bind(&data.step_key)
        .bind(&data.step_type)
        .bind(&data.title)
        .bind(&data.instructions)
        .bind(data.assigned_workflow_agent_session_id)
        .bind(data.max_retry)
        .bind(data.round_index)
        .bind(data.display_order)
        .bind(data.loop_id)
        .bind(data.lead_review_required)
        .bind(data.user_review_required)
        .bind(&data.revision_context)
        .fetch_one(pool)
        .await
    }

    pub async fn update_assigned_agent_session(
        pool: &SqlitePool,
        id: Uuid,
        agent_session_id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_steps
            SET assigned_workflow_agent_session_id = ?2, updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, execution_id, round_id, compiled_revision_id, step_key,
                      step_type, title, instructions, assigned_workflow_agent_session_id,
                      status, retry_count, max_retry, round_index, display_order,
                      latest_run_id, summary_text, content, loop_id,
                      lead_review_required, user_review_required, revision_context,
                      created_at, updated_at, started_at, completed_at
            "#,
        )
        .bind(id)
        .bind(agent_session_id)
        .fetch_one(pool)
        .await
    }

    pub async fn update_status(
        pool: &SqlitePool,
        id: Uuid,
        status: WorkflowStepStatus,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_steps
            SET status = ?2, updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, execution_id, round_id, compiled_revision_id, step_key,
                      step_type, title, instructions, assigned_workflow_agent_session_id,
                      status, retry_count, max_retry, round_index, display_order,
                      latest_run_id, summary_text, content, loop_id,
                      lead_review_required, user_review_required, revision_context,
                      created_at, updated_at, started_at, completed_at
            "#,
        )
        .bind(id)
        .bind(status)
        .fetch_one(pool)
        .await
    }

    pub async fn update_status_if_current(
        pool: &SqlitePool,
        id: Uuid,
        expected_status: WorkflowStepStatus,
        status: WorkflowStepStatus,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_steps
            SET status = ?3, updated_at = datetime('now', 'subsec')
            WHERE id = ?1 AND status = ?2
            RETURNING id, execution_id, round_id, compiled_revision_id, step_key,
                      step_type, title, instructions, assigned_workflow_agent_session_id,
                      status, retry_count, max_retry, round_index, display_order,
                      latest_run_id, summary_text, content, loop_id,
                      lead_review_required, user_review_required, revision_context,
                      created_at, updated_at, started_at, completed_at
            "#,
        )
        .bind(id)
        .bind(expected_status)
        .bind(status)
        .fetch_optional(pool)
        .await
    }

    pub async fn mark_completed_if_current(
        pool: &SqlitePool,
        id: Uuid,
        expected_status: WorkflowStepStatus,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_steps
            SET status = 'completed',
                started_at = COALESCE(started_at, datetime('now', 'subsec')),
                completed_at = COALESCE(completed_at, datetime('now', 'subsec')),
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1 AND status = ?2
            RETURNING id, execution_id, round_id, compiled_revision_id, step_key,
                      step_type, title, instructions, assigned_workflow_agent_session_id,
                      status, retry_count, max_retry, round_index, display_order,
                      latest_run_id, summary_text, content, loop_id,
                      lead_review_required, user_review_required, revision_context,
                      created_at, updated_at, started_at, completed_at
            "#,
        )
        .bind(id)
        .bind(expected_status)
        .fetch_optional(pool)
        .await
    }

    pub async fn recover_orphaned_running(
        pool: &SqlitePool,
        id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_steps
            SET status = 'ready',
                latest_run_id = NULL,
                summary_text = NULL,
                content = NULL,
                started_at = NULL,
                completed_at = NULL,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1 AND status = 'running'
            RETURNING id, execution_id, round_id, compiled_revision_id, step_key,
                      step_type, title, instructions, assigned_workflow_agent_session_id,
                      status, retry_count, max_retry, round_index, display_order,
                      latest_run_id, summary_text, content, loop_id,
                      lead_review_required, user_review_required, revision_context,
                      created_at, updated_at, started_at, completed_at
            "#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn record_execution_result(
        pool: &SqlitePool,
        id: Uuid,
        latest_run_id: Uuid,
        summary_text: Option<String>,
        content: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_steps
            SET latest_run_id = ?2,
                summary_text = ?3,
                content = ?4,
                started_at = COALESCE(started_at, datetime('now', 'subsec')),
                completed_at = datetime('now', 'subsec'),
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, execution_id, round_id, compiled_revision_id, step_key,
                      step_type, title, instructions, assigned_workflow_agent_session_id,
                      status, retry_count, max_retry, round_index, display_order,
                      latest_run_id, summary_text, content, loop_id,
                      lead_review_required, user_review_required, revision_context,
                      created_at, updated_at, started_at, completed_at
            "#,
        )
        .bind(id)
        .bind(latest_run_id)
        .bind(summary_text)
        .bind(content)
        .fetch_one(pool)
        .await
    }

    pub async fn update_revision_context(
        pool: &SqlitePool,
        id: Uuid,
        revision_context: Option<String>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_steps
            SET revision_context = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, execution_id, round_id, compiled_revision_id, step_key,
                      step_type, title, instructions, assigned_workflow_agent_session_id,
                      status, retry_count, max_retry, round_index, display_order,
                      latest_run_id, summary_text, content, loop_id,
                      lead_review_required, user_review_required, revision_context,
                      created_at, updated_at, started_at, completed_at
            "#,
        )
        .bind(id)
        .bind(revision_context)
        .fetch_one(pool)
        .await
    }

    pub async fn update_review_requirements(
        pool: &SqlitePool,
        id: Uuid,
        lead_review_required: bool,
        user_review_required: bool,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_steps
            SET lead_review_required = ?2,
                user_review_required = ?3,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, execution_id, round_id, compiled_revision_id, step_key,
                      step_type, title, instructions, assigned_workflow_agent_session_id,
                      status, retry_count, max_retry, round_index, display_order,
                      latest_run_id, summary_text, content, loop_id,
                      lead_review_required, user_review_required, revision_context,
                      created_at, updated_at, started_at, completed_at
            "#,
        )
        .bind(id)
        .bind(lead_review_required)
        .bind(user_review_required)
        .fetch_one(pool)
        .await
    }

    pub async fn update_loop_id(
        pool: &SqlitePool,
        id: Uuid,
        loop_id: Option<Uuid>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_steps
            SET loop_id = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, execution_id, round_id, compiled_revision_id, step_key,
                      step_type, title, instructions, assigned_workflow_agent_session_id,
                      status, retry_count, max_retry, round_index, display_order,
                      latest_run_id, summary_text, content, loop_id,
                      lead_review_required, user_review_required, revision_context,
                      created_at, updated_at, started_at, completed_at
            "#,
        )
        .bind(id)
        .bind(loop_id)
        .fetch_one(pool)
        .await
    }

    pub async fn prepare_retry(pool: &SqlitePool, id: Uuid) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_steps
            SET retry_count = retry_count + 1,
                latest_run_id = NULL,
                summary_text = NULL,
                content = NULL,
                started_at = NULL,
                completed_at = NULL,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, execution_id, round_id, compiled_revision_id, step_key,
                      step_type, title, instructions, assigned_workflow_agent_session_id,
                      status, retry_count, max_retry, round_index, display_order,
                      latest_run_id, summary_text, content, loop_id,
                      lead_review_required, user_review_required, revision_context,
                      created_at, updated_at, started_at, completed_at
            "#,
        )
        .bind(id)
        .fetch_one(pool)
        .await
    }

    /// Like `prepare_retry` but keeps the task outputs (summary_text, content, latest_run_id).
    /// Used when retrying only the review phase, not the task execution.
    pub async fn prepare_retry_review(pool: &SqlitePool, id: Uuid) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_steps
            SET retry_count = retry_count + 1,
                completed_at = NULL,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, execution_id, round_id, compiled_revision_id, step_key,
                      step_type, title, instructions, assigned_workflow_agent_session_id,
                      status, retry_count, max_retry, round_index, display_order,
                      latest_run_id, summary_text, content, loop_id,
                      lead_review_required, user_review_required, revision_context,
                      created_at, updated_at, started_at, completed_at
            "#,
        )
        .bind(id)
        .fetch_one(pool)
        .await
    }

    pub async fn clear_content_for_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE chat_workflow_steps
            SET content = NULL,
                instructions = '',
                revision_context = NULL,
                summary_text = CASE
                    WHEN summary_text IS NULL THEN NULL
                    WHEN json_valid(summary_text)
                    THEN json_remove(
                        json_remove(
                            json_remove(
                                json_remove(summary_text, '$.content'),
                                '$.final_result.content'
                            ),
                            '$.result.content'
                        ),
                        '$.raw_content'
                    )
                    WHEN length(summary_text) > 2048
                    THEN substr(summary_text, 1, 2048)
                    ELSE summary_text
                END,
                updated_at = datetime('now', 'subsec')
            WHERE execution_id = ?1
              AND (content IS NOT NULL
                   OR (instructions IS NOT NULL AND instructions != '')
                   OR revision_context IS NOT NULL
                   OR (json_valid(summary_text) AND (
                        json_extract(summary_text, '$.content') IS NOT NULL
                        OR json_extract(summary_text, '$.final_result.content') IS NOT NULL
                        OR json_extract(summary_text, '$.result.content') IS NOT NULL
                        OR json_extract(summary_text, '$.raw_content') IS NOT NULL
                   ))
                   OR (summary_text IS NOT NULL AND NOT json_valid(summary_text) AND length(summary_text) > 2048))
            "#,
        )
        .bind(execution_id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn find_summary_by_execution(
        pool: &SqlitePool,
        execution_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            SELECT id, execution_id, round_id, compiled_revision_id, step_key,
                   step_type, title, '' AS instructions, assigned_workflow_agent_session_id,
                   status, retry_count, max_retry, round_index, display_order,
                   latest_run_id, summary_text, NULL AS content, loop_id, lead_review_required,
                   user_review_required, revision_context,
                   created_at, updated_at, started_at, completed_at
            FROM chat_workflow_steps
            WHERE execution_id = ?1
            ORDER BY display_order ASC
            "#,
        )
        .bind(execution_id)
        .fetch_all(pool)
        .await
    }
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::{CreateWorkflowStep, WorkflowStep};
    use crate::{
        models::{
            workflow_execution::{CreateWorkflowExecution, WorkflowExecution},
            workflow_plan::{CreateWorkflowPlan, WorkflowPlan},
            workflow_round::{CreateWorkflowRound, WorkflowRound},
            workflow_types::{WorkflowStepType, WorkflowValidationStatus},
        },
        run_migrations,
    };

    async fn step_test_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");
        pool
    }

    async fn create_execution_and_round(pool: &SqlitePool) -> (Uuid, Uuid) {
        let session_id = Uuid::new_v4();
        let plan_id = Uuid::new_v4();
        WorkflowPlan::create(
            pool,
            &CreateWorkflowPlan {
                session_id,
                source_message_id: None,
                created_by_session_agent_id: None,
                title: format!("Plan {plan_id}"),
                summary_text: None,
                plan_json: "{}".to_string(),
                plan_schema_version: 1,
                plan_hash: plan_id.to_string(),
                validation_status: WorkflowValidationStatus::Valid,
                validation_errors_json: None,
            },
            plan_id,
        )
        .await
        .expect("create plan");

        let execution = WorkflowExecution::create(
            pool,
            &CreateWorkflowExecution {
                session_id,
                plan_id,
                active_revision_id: None,
                lead_session_agent_id: None,
                title: "Test execution".to_string(),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create execution");

        let round = WorkflowRound::create(
            pool,
            &CreateWorkflowRound {
                execution_id: execution.id,
                round_index: 1,
                source_revision_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create round");

        (execution.id, round.id)
    }

    fn sample_step_data(execution_id: Uuid, round_id: Uuid, step_key: &str) -> CreateWorkflowStep {
        CreateWorkflowStep {
            execution_id,
            round_id,
            compiled_revision_id: None,
            step_key: step_key.to_string(),
            step_type: WorkflowStepType::Task,
            title: format!("Step {step_key}"),
            instructions: "Detailed instructions for this step".to_string(),
            assigned_workflow_agent_session_id: None,
            max_retry: 1,
            round_index: 1,
            display_order: 0,
            loop_id: None,
            lead_review_required: None,
            user_review_required: None,
            revision_context: Some("revision context data".to_string()),
        }
    }

    #[tokio::test]
    async fn clear_content_sets_instructions_to_empty_not_null() {
        let pool = step_test_pool().await;
        let (execution_id, round_id) = create_execution_and_round(&pool).await;

        let step = WorkflowStep::create(
            &pool,
            &sample_step_data(execution_id, round_id, "s1"),
            Uuid::new_v4(),
        )
        .await
        .expect("create step");

        assert!(!step.instructions.is_empty());
        assert!(step.revision_context.is_some());

        let cleared = WorkflowStep::clear_content_for_execution(&pool, execution_id)
            .await
            .expect("clear content");
        assert_eq!(cleared, 1);

        let reloaded = WorkflowStep::find_by_id(&pool, step.id)
            .await
            .expect("find step")
            .expect("step exists");
        assert_eq!(reloaded.instructions, "");
        assert!(reloaded.content.is_none());
        assert!(reloaded.revision_context.is_none());
    }

    #[tokio::test]
    async fn clear_content_matches_steps_with_only_instructions_or_revision_context() {
        let pool = step_test_pool().await;
        let (execution_id, round_id) = create_execution_and_round(&pool).await;

        let mut data = sample_step_data(execution_id, round_id, "s1");
        data.revision_context = None;
        let step = WorkflowStep::create(&pool, &data, Uuid::new_v4())
            .await
            .expect("create step with no revision_context");

        let cleared = WorkflowStep::clear_content_for_execution(&pool, execution_id)
            .await
            .expect("clear content");
        assert_eq!(
            cleared, 1,
            "should match step with non-empty instructions even if content is NULL"
        );

        let reloaded = WorkflowStep::find_by_id(&pool, step.id)
            .await
            .expect("find step")
            .expect("step exists");
        assert_eq!(reloaded.instructions, "");
    }

    #[tokio::test]
    async fn find_summary_excludes_instructions_and_content_but_keeps_revision_context() {
        let pool = step_test_pool().await;
        let (execution_id, round_id) = create_execution_and_round(&pool).await;

        let step = WorkflowStep::create(
            &pool,
            &sample_step_data(execution_id, round_id, "s1"),
            Uuid::new_v4(),
        )
        .await
        .expect("create step");

        WorkflowStep::record_execution_result(
            &pool,
            step.id,
            Uuid::new_v4(),
            Some("summary text".to_string()),
            Some("full content".to_string()),
        )
        .await
        .expect("record result");

        let summaries = WorkflowStep::find_summary_by_execution(&pool, execution_id)
            .await
            .expect("find summary");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].instructions, "");
        assert!(summaries[0].content.is_none());
        assert_eq!(
            summaries[0].revision_context.as_deref(),
            Some("revision context data")
        );
        assert_eq!(summaries[0].summary_text.as_deref(), Some("summary text"));
        assert_eq!(summaries[0].step_key, "s1");
    }

    #[tokio::test]
    async fn clear_content_strips_summary_text_content_key_but_preserves_summary_and_outputs() {
        let pool = step_test_pool().await;
        let (execution_id, round_id) = create_execution_and_round(&pool).await;

        let step = WorkflowStep::create(
            &pool,
            &sample_step_data(execution_id, round_id, "s1"),
            Uuid::new_v4(),
        )
        .await
        .expect("create step");

        let payload = serde_json::json!({
            "summary": "step completed successfully",
            "content": "very long execution content that should be cleaned up after retention period",
            "outputs": ["file1.ts", "file2.rs"]
        });
        WorkflowStep::record_execution_result(
            &pool,
            step.id,
            Uuid::new_v4(),
            Some(payload.to_string()),
            Some("full content".to_string()),
        )
        .await
        .expect("record result with summary payload");

        let before = WorkflowStep::find_by_id(&pool, step.id)
            .await
            .expect("find step")
            .expect("step exists");
        let before_payload: serde_json::Value =
            serde_json::from_str(before.summary_text.as_deref().unwrap()).expect("parse before");
        assert!(
            before_payload.get("content").is_some(),
            "content key should exist before cleanup"
        );

        let cleared = WorkflowStep::clear_content_for_execution(&pool, execution_id)
            .await
            .expect("clear content");
        assert_eq!(cleared, 1);

        let after = WorkflowStep::find_by_id(&pool, step.id)
            .await
            .expect("find step")
            .expect("step exists");
        let after_payload: serde_json::Value =
            serde_json::from_str(after.summary_text.as_deref().unwrap()).expect("parse after");
        assert!(
            after_payload.get("content").is_none(),
            "content key should be removed from summary_text"
        );
        assert_eq!(after_payload["summary"], "step completed successfully");
        assert_eq!(after_payload["outputs"][0], "file1.ts");
        assert_eq!(after_payload["outputs"][1], "file2.rs");
    }

    #[tokio::test]
    async fn clear_content_strips_nested_content_keys_and_raw_content_from_summary_text() {
        let pool = step_test_pool().await;
        let (execution_id, round_id) = create_execution_and_round(&pool).await;

        let step = WorkflowStep::create(
            &pool,
            &sample_step_data(execution_id, round_id, "s1"),
            Uuid::new_v4(),
        )
        .await
        .expect("create step");

        let payload = serde_json::json!({
            "summary": "brief summary",
            "outputs": ["artifact-a"],
            "final_result": {
                "content": "huge content from final_result that should be removed"
            },
            "result": {
                "content": "nested content that should be removed"
            },
            "raw_content": "raw full payload"
        });

        WorkflowStep::record_execution_result(
            &pool,
            step.id,
            Uuid::new_v4(),
            Some(payload.to_string()),
            Some("full content".to_string()),
        )
        .await
        .expect("record result with nested payload");

        let cleared = WorkflowStep::clear_content_for_execution(&pool, execution_id)
            .await
            .expect("clear content");
        assert_eq!(cleared, 1);

        let after = WorkflowStep::find_by_id(&pool, step.id)
            .await
            .expect("find step")
            .expect("step exists");
        let after_payload: serde_json::Value =
            serde_json::from_str(after.summary_text.as_deref().unwrap()).expect("parse after");
        assert!(
            after_payload
                .get("final_result")
                .and_then(|v| v.get("content"))
                .is_none(),
            "final_result.content should be removed"
        );
        assert!(
            after_payload
                .get("result")
                .and_then(|v| v.get("content"))
                .is_none(),
            "result.content should be removed"
        );
        assert!(
            after_payload.get("raw_content").is_none(),
            "raw_content should be removed"
        );
        assert_eq!(after_payload["summary"], "brief summary");
        assert_eq!(after_payload["outputs"][0], "artifact-a");
    }

    #[tokio::test]
    async fn clear_content_truncates_large_non_json_summary_text() {
        let pool = step_test_pool().await;
        let (execution_id, round_id) = create_execution_and_round(&pool).await;

        let step = WorkflowStep::create(
            &pool,
            &sample_step_data(execution_id, round_id, "s1"),
            Uuid::new_v4(),
        )
        .await
        .expect("create step");

        let large_summary = "x".repeat(5000);
        WorkflowStep::record_execution_result(
            &pool,
            step.id,
            Uuid::new_v4(),
            Some(large_summary.clone()),
            Some("full content".to_string()),
        )
        .await
        .expect("record result with large plain summary");

        let cleared = WorkflowStep::clear_content_for_execution(&pool, execution_id)
            .await
            .expect("clear content");
        assert_eq!(cleared, 1);

        let after = WorkflowStep::find_by_id(&pool, step.id)
            .await
            .expect("find step")
            .expect("step exists");
        assert_eq!(after.summary_text.as_ref().map(|s| s.len()), Some(2048));
        assert!(after.content.is_none());
        assert_eq!(after.instructions, "");
        assert!(after.revision_context.is_none());
    }
}
