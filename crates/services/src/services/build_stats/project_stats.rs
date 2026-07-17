use anyhow::Result;
use chrono::NaiveDate;
use db::models::{
    project_delivery_event::{ProjectDeliveryEvent, ProjectDeliveryEventType},
    project_stats::ProjectStats,
};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use super::token_cost_stats::TokenCostStatsService;

#[derive(Clone, Default)]
pub struct ProjectStatsService;

impl ProjectStatsService {
    pub fn new() -> Self {
        Self
    }

    pub async fn get_stats(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<ProjectStats>> {
        Ok(ProjectStats::find_by_project(pool, project_id).await?)
    }

    pub async fn record_delivery_event(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        event_type: ProjectDeliveryEventType,
        title: Option<String>,
        source: Option<String>,
    ) -> Result<ProjectDeliveryEvent> {
        Ok(ProjectDeliveryEvent::create(
            pool, project_id, event_type, None, None, None, title, source,
        )
        .await?)
    }

    pub async fn refresh_stats(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        period_start: NaiveDate,
        period_end: NaiveDate,
    ) -> Result<ProjectStats> {
        let rows = sqlx::query(
            r#"
            SELECT event_type, COUNT(*) AS count
            FROM project_delivery_records dr
            LEFT JOIN project_work_items pwi ON pwi.id = dr.project_work_item_id
            LEFT JOIN project_repos pr ON pr.repo_id = dr.repo_id
            LEFT JOIN chat_sessions cs ON cs.id = dr.source_session_id
            WHERE (pwi.project_id = ?1 OR pr.project_id = ?1 OR cs.project_id = ?1)
              AND date(dr.occurred_at) >= ?2
              AND date(dr.occurred_at) <= ?3
            GROUP BY event_type
            "#,
        )
        .bind(project_id)
        .bind(period_start.to_string())
        .bind(period_end.to_string())
        .fetch_all(pool)
        .await?;

        let mut feature_count = 0;
        let bugfix_count = 0;
        let mut test_count = 0;

        for row in rows {
            let event_type: String = row.try_get("event_type")?;
            let count: i64 = row.try_get("count")?;
            match event_type.as_str() {
                "pr_opened" | "pr_merged" | "deployment" | "release" | "commit_created" => {
                    feature_count += count
                }
                "test_passed" | "test_failed" => test_count += count,
                _ => {}
            }
        }

        let token_totals = TokenCostStatsService::new()
            .project_period_totals(pool, project_id, period_start, period_end)
            .await?;

        Ok(ProjectStats::upsert(
            pool,
            project_id,
            period_start,
            period_end,
            feature_count,
            bugfix_count,
            test_count,
            token_totals.input_tokens,
            token_totals.output_tokens,
            token_totals.cache_read_tokens,
            token_totals.reasoning_output_tokens,
            token_totals.total_tokens,
            Some(token_totals.cost_total),
        )
        .await?)
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::project_delivery_event::ProjectDeliveryEventType;
    use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};
    use uuid::Uuid;

    use super::ProjectStatsService;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");

        for statement in [
            r#"
            CREATE TABLE project_delivery_events (
                id BLOB PRIMARY KEY,
                project_id BLOB,
                session_id BLOB,
                workflow_execution_id BLOB,
                step_id BLOB,
                event_type TEXT CHECK (event_type IN ('feature', 'bugfix', 'test')),
                title TEXT,
                source TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE project_stats (
                id BLOB PRIMARY KEY,
                project_id BLOB,
                period_start DATE,
                period_end DATE,
                feature_count INTEGER DEFAULT 0,
                bugfix_count INTEGER DEFAULT 0,
                test_count INTEGER DEFAULT 0,
                input_tokens BIGINT DEFAULT 0,
                output_tokens BIGINT DEFAULT 0,
                cache_read_tokens BIGINT DEFAULT 0,
                reasoning_output_tokens BIGINT DEFAULT 0,
                total_tokens BIGINT DEFAULT 0,
                cost_total DECIMAL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE project_work_items (
                id BLOB PRIMARY KEY,
                project_id BLOB,
                type TEXT,
                status TEXT,
                title TEXT,
                priority TEXT,
                source TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE project_repos (
                id BLOB PRIMARY KEY,
                project_id BLOB,
                repo_id BLOB
            )
            "#,
            r#"
            CREATE TABLE project_delivery_records (
                id BLOB PRIMARY KEY,
                project_work_item_id BLOB,
                repo_id BLOB,
                external_link_id BLOB,
                event_type TEXT NOT NULL,
                external_id TEXT,
                url TEXT,
                actor TEXT,
                source_session_id BLOB,
                source_workflow_execution_id BLOB,
                metadata_json TEXT,
                occurred_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE UNIQUE INDEX idx_project_stats_project_period
            ON project_stats(project_id, period_start, period_end)
            "#,
            r#"
            CREATE TABLE chat_sessions (
                id BLOB PRIMARY KEY,
                title TEXT,
                project_id BLOB,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE chat_agents (
                id BLOB PRIMARY KEY,
                name TEXT NOT NULL,
                runner_type TEXT NOT NULL,
                model_name TEXT
            )
            "#,
            r#"
            CREATE TABLE chat_messages (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                sender_type TEXT NOT NULL,
                sender_id BLOB,
                content TEXT NOT NULL,
                meta TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE chat_session_agents (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                agent_id BLOB NOT NULL
            )
            "#,
            r#"
            CREATE TABLE chat_workflow_steps (
                id BLOB PRIMARY KEY,
                title TEXT
            )
            "#,
            r#"
            CREATE TABLE chat_runs (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                session_agent_id BLOB NOT NULL,
                retention_summary_json TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE model_price_cache (
                model_id TEXT PRIMARY KEY,
                model_name TEXT NOT NULL,
                input_price_per_1m REAL NOT NULL DEFAULT 0.0,
                output_price_per_1m REAL NOT NULL DEFAULT 0.0,
                cache_read_price_per_1m REAL,
                source TEXT NOT NULL DEFAULT 'external'
            )
            "#,
            r#"
            CREATE TABLE model_pricing (
                id BLOB PRIMARY KEY,
                project_id BLOB NOT NULL,
                model_id TEXT NOT NULL,
                model_name TEXT NOT NULL DEFAULT '',
                input_price_per_1m REAL NOT NULL DEFAULT 0.0,
                output_price_per_1m REAL NOT NULL DEFAULT 0.0,
                cache_read_price_per_1m REAL,
                custom_input_price REAL,
                custom_output_price REAL,
                custom_cache_read_price REAL,
                price_source TEXT NOT NULL DEFAULT 'custom',
                UNIQUE(project_id, model_id)
            )
            "#,
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create minimal project stats schema");
        }

        pool
    }

    #[tokio::test]
    async fn refresh_stats_counts_delivery_records_and_token_cost() {
        let pool = setup_pool().await;
        let service = ProjectStatsService::new();
        let project_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        let agent_id = Uuid::new_v4();
        let work_item_id = Uuid::new_v4();

        service
            .record_delivery_event(
                &pool,
                project_id,
                ProjectDeliveryEventType::Feature,
                Some("feature".to_string()),
                Some("test".to_string()),
            )
            .await
            .expect("record feature");
        service
            .record_delivery_event(
                &pool,
                project_id,
                ProjectDeliveryEventType::Bugfix,
                Some("bug".to_string()),
                Some("test".to_string()),
            )
            .await
            .expect("record bugfix");
        sqlx::query(
            r#"
            INSERT INTO project_work_items (id, project_id, type, status, title, priority, source)
            VALUES (?1, ?2, 'feature', 'open', 'PR work', 'medium', 'manual')
            "#,
        )
        .bind(work_item_id)
        .bind(project_id)
        .execute(&pool)
        .await
        .expect("insert work item");
        sqlx::query(
            r#"
            INSERT INTO project_delivery_records (id, project_work_item_id, event_type)
            VALUES (?1, ?2, 'pr_opened'), (?3, ?2, 'test_passed'), (?4, ?2, 'commit_created')
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(work_item_id)
        .bind(Uuid::new_v4())
        .bind(Uuid::new_v4())
        .execute(&pool)
        .await
        .expect("insert delivery records");

        sqlx::query("INSERT INTO chat_sessions (id, title, project_id) VALUES (?1, ?2, ?3)")
            .bind(session_id)
            .bind("Session")
            .bind(project_id)
            .execute(&pool)
            .await
            .expect("insert session");
        sqlx::query(
            "INSERT INTO chat_agents (id, name, runner_type, model_name) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(agent_id)
        .bind("Agent")
        .bind("codex")
        .bind("gpt-4o")
        .execute(&pool)
        .await
        .expect("insert agent");
        sqlx::query(
            r#"
            INSERT INTO model_price_cache (
                model_id,
                model_name,
                input_price_per_1m,
                output_price_per_1m,
                cache_read_price_per_1m,
                source
            ) VALUES ('gpt-4o', 'GPT-4o', 2.0, 4.0, 0.2, 'openrouter')
            "#,
        )
        .execute(&pool)
        .await
        .expect("insert price");
        sqlx::query(
            r#"
            INSERT INTO chat_messages (id, session_id, sender_type, sender_id, content, meta)
            VALUES (?1, ?2, 'agent', ?3, 'done', ?4)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(session_id)
        .bind(agent_id)
        .bind(
            serde_json::json!({
                "run_id": Uuid::new_v4().to_string(),
                "token_usage": {
                    "input_tokens": 1_000_000,
                    "output_tokens": 500_000,
                    "cache_read_tokens": 1_000_000,
                    "reasoning_output_tokens": 100,
                    "total_tokens": 1_500_000,
                    "is_estimated": false
                }
            })
            .to_string(),
        )
        .execute(&pool)
        .await
        .expect("insert token message");

        let stats = service
            .refresh_stats(
                &pool,
                project_id,
                Utc::now().date_naive(),
                Utc::now().date_naive(),
            )
            .await
            .expect("refresh stats");

        assert_eq!(stats.feature_count, 2);
        assert_eq!(stats.bugfix_count, 0);
        assert_eq!(stats.test_count, 1);
        assert_eq!(stats.input_tokens, 1_000_000);
        assert_eq!(stats.output_tokens, 500_000);
        assert_eq!(stats.cache_read_tokens, 1_000_000);
        assert_eq!(stats.reasoning_output_tokens, 100);
        assert_eq!(stats.total_tokens, 1_500_000);
        assert_eq!(stats.cost_total, Some(4.2));
    }

    #[tokio::test]
    async fn refresh_stats_returns_zero_row_for_empty_project() {
        let pool = setup_pool().await;
        let service = ProjectStatsService::new();
        let project_id = Uuid::new_v4();

        let stats = service
            .refresh_stats(
                &pool,
                project_id,
                Utc::now().date_naive(),
                Utc::now().date_naive(),
            )
            .await
            .expect("refresh stats for empty project");

        assert_eq!(stats.feature_count, 0);
        assert_eq!(stats.bugfix_count, 0);
        assert_eq!(stats.test_count, 0);
        assert_eq!(stats.input_tokens, 0);
        assert_eq!(stats.output_tokens, 0);
        assert_eq!(stats.cache_read_tokens, 0);
        assert_eq!(stats.reasoning_output_tokens, 0);
        assert_eq!(stats.total_tokens, 0);
        assert_eq!(stats.cost_total, Some(0.0));
    }
}
