use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::workflow_types::WorkflowExecutionStatus;

const EXECUTION_SELECT: &str = r#"
    SELECT id, session_id, plan_id, active_revision_id, active_round_id,
           workflow_card_message_id, lead_session_agent_id, status,
           current_round, title, compiled_graph_hash,
           started_at, completed_at, cleaned_at, cleaned_reason,
           created_at, updated_at
    FROM chat_workflow_executions
"#;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowExecution {
    pub id: Uuid,
    pub session_id: Uuid,
    pub plan_id: Uuid,
    pub active_revision_id: Option<Uuid>,
    pub active_round_id: Option<Uuid>,
    pub workflow_card_message_id: Option<Uuid>,
    pub lead_session_agent_id: Option<Uuid>,
    pub status: WorkflowExecutionStatus,
    pub current_round: i32,
    pub title: String,
    pub compiled_graph_hash: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub cleaned_at: Option<DateTime<Utc>>,
    pub cleaned_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use sqlx::{Row, SqlitePool};
    use uuid::Uuid;

    use super::*;
    use crate::{
        models::{
            workflow_plan::{CreateWorkflowPlan, WorkflowPlan},
            workflow_types::{WorkflowValidationStatus, to_workflow_wire_value},
        },
        run_migrations,
    };

    #[tokio::test]
    async fn add_cancelled_status_migration_preserves_child_foreign_keys() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");

        sqlx::raw_sql(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE chat_workflow_plans (
                id BLOB NOT NULL PRIMARY KEY
            );

            CREATE TABLE chat_workflow_plan_revisions (
                id BLOB NOT NULL PRIMARY KEY
            );

            CREATE TABLE chat_workflow_executions (
                id                       BLOB    NOT NULL PRIMARY KEY,
                session_id               BLOB    NOT NULL,
                plan_id                  BLOB    NOT NULL REFERENCES chat_workflow_plans(id),
                active_revision_id       BLOB    REFERENCES chat_workflow_plan_revisions(id),
                active_round_id          BLOB,
                workflow_card_message_id BLOB,
                lead_session_agent_id    BLOB,
                status                   TEXT    NOT NULL DEFAULT 'pending'
                                                 CHECK (status IN (
                                                     'pending', 'running', 'failed', 'paused',
                                                     'recompiling', 'completed', 'waiting'
                                                 )),
                current_round            INTEGER NOT NULL DEFAULT 0,
                title                    TEXT    NOT NULL DEFAULT '',
                compiled_graph_hash      TEXT,
                started_at               TEXT,
                completed_at             TEXT,
                cleaned_at               TEXT,
                cleaned_reason           TEXT,
                created_at               TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at               TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
            );

            CREATE TABLE chat_workflow_steps (
                id           BLOB NOT NULL PRIMARY KEY,
                execution_id BLOB NOT NULL REFERENCES chat_workflow_executions(id)
            );

            INSERT INTO chat_workflow_plans(id) VALUES (x'01');
            INSERT INTO chat_workflow_executions(id, session_id, plan_id, status, title)
            VALUES (x'02', x'03', x'01', 'failed', 'existing');
            INSERT INTO chat_workflow_steps(id, execution_id) VALUES (x'04', x'02');
            "#,
        )
        .execute(&pool)
        .await
        .expect("seed pre-migration workflow tables");

        let mut tx = pool.begin().await.expect("begin sqlx migration wrapper");
        sqlx::raw_sql(include_str!(
            "../../migrations/20260516123000_add_cancelled_workflow_execution_status.sql"
        ))
        .execute(&mut *tx)
        .await
        .expect("run cancelled status migration");
        tx.commit().await.expect("commit sqlx migration wrapper");

        let fk_violations =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM pragma_foreign_key_check")
                .fetch_one(&pool)
                .await
                .expect("run foreign key check");
        assert_eq!(fk_violations, 0);

        let foreign_keys = sqlx::query("PRAGMA foreign_key_list(chat_workflow_steps)")
            .fetch_all(&pool)
            .await
            .expect("read workflow step foreign keys");
        let execution_fk_table = foreign_keys
            .iter()
            .find(|row| row.get::<String, _>("from") == "execution_id")
            .map(|row| row.get::<String, _>("table"))
            .expect("workflow step execution_id foreign key");
        assert_eq!(execution_fk_table, "chat_workflow_executions");

        sqlx::query("UPDATE chat_workflow_executions SET status = 'cancelled' WHERE id = x'02'")
            .execute(&pool)
            .await
            .expect("cancelled status is allowed");
    }

    async fn create_execution_with_status(
        pool: &SqlitePool,
        session_id: Uuid,
        status: WorkflowExecutionStatus,
    ) -> WorkflowExecution {
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
        .expect("create workflow plan");

        let execution = WorkflowExecution::create(
            pool,
            &CreateWorkflowExecution {
                session_id,
                plan_id,
                active_revision_id: None,
                lead_session_agent_id: None,
                title: format!("Execution {plan_id}"),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create workflow execution");

        let is_terminal = matches!(
            status,
            WorkflowExecutionStatus::Completed
                | WorkflowExecutionStatus::Failed
                | WorkflowExecutionStatus::Cancelled
        );
        let execution = WorkflowExecution::update_status(pool, execution.id, status)
            .await
            .expect("update workflow execution status");

        if is_terminal {
            WorkflowExecution::set_completed(pool, execution.id)
                .await
                .expect("set completed at")
        } else {
            execution
        }
    }

    #[tokio::test]
    async fn generation_blocking_query_excludes_terminal_executions() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");

        let session_id = Uuid::new_v4();
        for status in [
            WorkflowExecutionStatus::Pending,
            WorkflowExecutionStatus::Running,
            WorkflowExecutionStatus::Waiting,
            WorkflowExecutionStatus::Paused,
            WorkflowExecutionStatus::Recompiling,
            WorkflowExecutionStatus::Completed,
            WorkflowExecutionStatus::Failed,
            WorkflowExecutionStatus::Cancelled,
        ] {
            create_execution_with_status(&pool, session_id, status).await;
        }

        let blocking = WorkflowExecution::find_generation_blocking_by_session(&pool, session_id)
            .await
            .expect("query blocking executions");
        let mut blocking_statuses = blocking
            .iter()
            .map(|execution| to_workflow_wire_value(&execution.status))
            .collect::<Vec<_>>();
        blocking_statuses.sort();

        assert_eq!(
            blocking_statuses,
            vec!["paused", "pending", "recompiling", "running", "waiting"]
        );
    }

    #[tokio::test]
    async fn find_completed_before_excludes_running_and_already_cleaned() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");

        let session_id = Uuid::new_v4();

        let completed =
            create_execution_with_status(&pool, session_id, WorkflowExecutionStatus::Completed)
                .await;
        let _running =
            create_execution_with_status(&pool, session_id, WorkflowExecutionStatus::Running).await;
        let failed =
            create_execution_with_status(&pool, session_id, WorkflowExecutionStatus::Failed).await;
        let cancelled =
            create_execution_with_status(&pool, session_id, WorkflowExecutionStatus::Cancelled)
                .await;

        let cutoff = Utc::now() + chrono::Duration::days(1);
        let found = WorkflowExecution::find_completed_before(&pool, &cutoff)
            .await
            .expect("find completed before");
        let found_ids: Vec<Uuid> = found.iter().map(|e| e.id).collect();
        assert!(found_ids.contains(&completed.id));
        assert!(found_ids.contains(&failed.id));
        assert!(found_ids.contains(&cancelled.id));
        assert!(!found_ids.contains(&_running.id));

        WorkflowExecution::mark_cleaned(&pool, completed.id, "test")
            .await
            .expect("mark cleaned");

        let found_after_clean = WorkflowExecution::find_completed_before(&pool, &cutoff)
            .await
            .expect("find completed before after clean");
        let cleaned_ids: Vec<Uuid> = found_after_clean.iter().map(|e| e.id).collect();
        assert!(!cleaned_ids.contains(&completed.id));
        assert!(cleaned_ids.contains(&failed.id));
        assert!(cleaned_ids.contains(&cancelled.id));
    }

    #[tokio::test]
    async fn find_completed_before_uses_datetime_comparison_not_lexical_order() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");

        let session_id = Uuid::new_v4();
        let completed =
            create_execution_with_status(&pool, session_id, WorkflowExecutionStatus::Completed)
                .await;

        sqlx::query(
            "UPDATE chat_workflow_executions SET completed_at = '2026-05-13 23:59:59', updated_at = '2026-05-13 23:59:59' WHERE id = ?1",
        )
        .bind(completed.id)
        .execute(&pool)
        .await
        .expect("seed completed_at");

        let cutoff = DateTime::parse_from_rfc3339("2026-05-13T00:00:00Z")
            .expect("parse cutoff")
            .with_timezone(&Utc);
        let found = WorkflowExecution::find_completed_before(&pool, &cutoff)
            .await
            .expect("find completed before");
        let found_ids: Vec<Uuid> = found.iter().map(|e| e.id).collect();
        assert!(
            !found_ids.contains(&completed.id),
            "same-day later time must not be considered before cutoff"
        );
    }

    #[tokio::test]
    async fn find_completed_before_includes_failed_with_null_completed_at_by_updated_at() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");

        let session_id = Uuid::new_v4();
        let failed =
            create_execution_with_status(&pool, session_id, WorkflowExecutionStatus::Failed).await;

        sqlx::query(
            "UPDATE chat_workflow_executions SET completed_at = NULL, updated_at = '2020-01-01 00:00:00' WHERE id = ?1",
        )
        .bind(failed.id)
        .execute(&pool)
        .await
        .expect("clear completed_at for failed");

        let cutoff = Utc::now();
        let found = WorkflowExecution::find_completed_before(&pool, &cutoff)
            .await
            .expect("find completed before");
        let found_ids: Vec<Uuid> = found.iter().map(|e| e.id).collect();
        assert!(
            found_ids.contains(&failed.id),
            "failed execution with null completed_at should use updated_at as fallback"
        );
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowExecution {
    pub session_id: Uuid,
    pub plan_id: Uuid,
    pub active_revision_id: Option<Uuid>,
    pub lead_session_agent_id: Option<Uuid>,
    pub title: String,
}

impl WorkflowExecution {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!("{EXECUTION_SELECT}\nWHERE id = ?1"))
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_session(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{EXECUTION_SELECT}\nWHERE session_id = ?1\nORDER BY created_at DESC"
        ))
        .bind(session_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_active_by_session(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        Self::find_generation_blocking_by_session(pool, session_id).await
    }

    pub async fn find_generation_blocking_by_session(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(&format!(
            "{EXECUTION_SELECT}\nWHERE session_id = ?1 AND status IN ('pending', 'running', 'waiting', 'paused', 'recompiling')\nORDER BY created_at DESC"
        ))
        .bind(session_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_non_terminal_by_session(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        Self::find_generation_blocking_by_session(pool, session_id).await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateWorkflowExecution,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            INSERT INTO chat_workflow_executions (
                id, session_id, plan_id, active_revision_id,
                lead_session_agent_id, title
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, cleaned_at, cleaned_reason,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(data.session_id)
        .bind(data.plan_id)
        .bind(data.active_revision_id)
        .bind(data.lead_session_agent_id)
        .bind(&data.title)
        .fetch_one(pool)
        .await
    }

    pub async fn update_status(
        pool: &SqlitePool,
        id: Uuid,
        status: WorkflowExecutionStatus,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_executions
            SET status = ?2, updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, cleaned_at, cleaned_reason,
                      created_at, updated_at
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
        expected_status: WorkflowExecutionStatus,
        status: WorkflowExecutionStatus,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_executions
            SET status = ?3, updated_at = datetime('now', 'subsec')
            WHERE id = ?1 AND status = ?2
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, cleaned_at, cleaned_reason,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(expected_status)
        .bind(status)
        .fetch_optional(pool)
        .await
    }

    pub async fn update_active_round(
        pool: &SqlitePool,
        id: Uuid,
        active_round_id: Uuid,
        current_round: i32,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_executions
            SET active_round_id = ?2,
                current_round = ?3,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, cleaned_at, cleaned_reason,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(active_round_id)
        .bind(current_round)
        .fetch_one(pool)
        .await
    }

    pub async fn update_compiled_graph_hash(
        pool: &SqlitePool,
        id: Uuid,
        compiled_graph_hash: &str,
        active_revision_id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_executions
            SET compiled_graph_hash = ?2,
                active_revision_id = ?3,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, cleaned_at, cleaned_reason,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(compiled_graph_hash)
        .bind(active_revision_id)
        .fetch_one(pool)
        .await
    }

    pub async fn set_started(pool: &SqlitePool, id: Uuid) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_executions
            SET started_at = datetime('now', 'subsec'),
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, cleaned_at, cleaned_reason,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .fetch_one(pool)
        .await
    }

    pub async fn update_workflow_card_message_id(
        pool: &SqlitePool,
        id: Uuid,
        workflow_card_message_id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_executions
            SET workflow_card_message_id = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, cleaned_at, cleaned_reason,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(workflow_card_message_id)
        .fetch_one(pool)
        .await
    }

    pub async fn set_completed(pool: &SqlitePool, id: Uuid) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_executions
            SET completed_at = datetime('now', 'subsec'),
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, cleaned_at, cleaned_reason,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .fetch_one(pool)
        .await
    }

    pub async fn find_completed_before(
        pool: &SqlitePool,
        before: &chrono::DateTime<Utc>,
    ) -> Result<Vec<Self>, sqlx::Error> {
        let cutoff = before
            .naive_utc()
            .format("%Y-%m-%d %H:%M:%S%.f")
            .to_string();
        sqlx::query_as::<_, Self>(&format!(
            "{EXECUTION_SELECT}\nWHERE status IN ('completed', 'failed', 'cancelled') AND datetime(COALESCE(completed_at, updated_at)) < datetime(?1) AND cleaned_at IS NULL\nORDER BY datetime(COALESCE(completed_at, updated_at)) ASC"
        ))
        .bind(cutoff)
        .fetch_all(pool)
        .await
    }

    pub async fn mark_cleaned(
        pool: &SqlitePool,
        id: Uuid,
        reason: &str,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            r#"
            UPDATE chat_workflow_executions
            SET cleaned_at = datetime('now', 'subsec'),
                cleaned_reason = ?2,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?1
            RETURNING id, session_id, plan_id, active_revision_id, active_round_id,
                      workflow_card_message_id, lead_session_agent_id, status,
                      current_round, title, compiled_graph_hash,
                      started_at, completed_at, cleaned_at, cleaned_reason,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(reason)
        .fetch_one(pool)
        .await
    }
}
