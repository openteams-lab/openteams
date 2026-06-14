use std::{str::FromStr, sync::Arc, time::Instant};

use sqlx::{
    Error, Pool, Row, Sqlite, SqlitePool,
    migrate::MigrateError,
    sqlite::{SqliteConnectOptions, SqliteConnection, SqliteJournalMode, SqlitePoolOptions},
};
use utils::assets::asset_dir;

pub mod models;

const WORKFLOW_EXECUTION_STATUS_MIGRATION_VERSION: i64 = 20260422120000;
const WORKFLOW_AGENT_SESSION_STATE_MIGRATION_VERSION: i64 = 20260423100000;
const PROJECT_CENTRIC_BACKEND_SCHEMA_MIGRATION_VERSION: i64 = 20260531120000;
const MEMBER_EXECUTION_CONFIG_MIGRATION_VERSION: i64 = 20260603120000;

async fn apply_workflow_execution_status_migration_shim(
    pool: &Pool<Sqlite>,
    migrator: &sqlx::migrate::Migrator,
) -> Result<(), Error> {
    let Some(migration) = migrator
        .iter()
        .find(|migration| migration.version == WORKFLOW_EXECUTION_STATUS_MIGRATION_VERSION)
    else {
        return Ok(());
    };

    let migrations_table_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_one(pool)
    .await?;
    if migrations_table_exists == 0 {
        return Ok(());
    }

    let already_applied = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM _sqlx_migrations WHERE version = ?1 AND success = 1",
    )
    .bind(WORKFLOW_EXECUTION_STATUS_MIGRATION_VERSION)
    .fetch_one(pool)
    .await?;
    if already_applied > 0 {
        return Ok(());
    }

    let workflow_table_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'chat_workflow_executions'",
    )
    .fetch_one(pool)
    .await?;
    if workflow_table_exists == 0 {
        return Ok(());
    }

    tracing::info!(
        "Applying compatibility shim for migration {} before sqlx migrator runs",
        WORKFLOW_EXECUTION_STATUS_MIGRATION_VERSION
    );

    let started = Instant::now();
    let mut conn = pool.acquire().await?;
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *conn)
        .await?;

    let result = async {
        let old_table_exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'chat_workflow_executions_old'",
        )
        .fetch_one(&mut *conn)
        .await?;

        if old_table_exists > 0 {
            sqlx::query("DROP TABLE IF EXISTS chat_workflow_executions")
                .execute(&mut *conn)
                .await?;
        } else {
            sqlx::query(
                "ALTER TABLE chat_workflow_executions RENAME TO chat_workflow_executions_old",
            )
            .execute(&mut *conn)
            .await?;
        }

        sqlx::query(
            r#"
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
                created_at               TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at               TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&mut *conn)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO chat_workflow_executions (
                id,
                session_id,
                plan_id,
                active_revision_id,
                active_round_id,
                workflow_card_message_id,
                lead_session_agent_id,
                status,
                current_round,
                title,
                compiled_graph_hash,
                started_at,
                completed_at,
                created_at,
                updated_at
            )
            SELECT
                id,
                session_id,
                plan_id,
                active_revision_id,
                active_round_id,
                workflow_card_message_id,
                lead_session_agent_id,
                CASE status
                    WHEN 'bootstrapping' THEN 'pending'
                    WHEN 'interrupting' THEN 'running'
                    WHEN 'waiting_user' THEN 'waiting'
                    WHEN 'waiting_user_acceptance' THEN 'waiting'
                    WHEN 'resuming' THEN 'running'
                    WHEN 'completing' THEN 'running'
                    WHEN 'cancelled' THEN 'failed'
                    ELSE status
                END,
                current_round,
                title,
                compiled_graph_hash,
                started_at,
                completed_at,
                created_at,
                updated_at
            FROM chat_workflow_executions_old
            "#,
        )
        .execute(&mut *conn)
        .await?;

        sqlx::query("DROP TABLE chat_workflow_executions_old")
            .execute(&mut *conn)
            .await?;

        sqlx::query("ALTER TABLE chat_workflow_rounds RENAME TO chat_workflow_rounds_old")
            .execute(&mut *conn)
            .await?;
        sqlx::query(
            r#"
            CREATE TABLE chat_workflow_rounds (
                id                  BLOB    NOT NULL PRIMARY KEY,
                execution_id        BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
                round_index         INTEGER NOT NULL DEFAULT 1,
                source_revision_id  BLOB    REFERENCES chat_workflow_plan_revisions(id),
                status              TEXT    NOT NULL DEFAULT 'running'
                                            CHECK (status IN (
                                                'running', 'waiting_user_acceptance',
                                                'accepted', 'rejected', 'archived'
                                            )),
                result_step_id      BLOB,
                user_decision_summary TEXT,
                started_at          TEXT,
                completed_at        TEXT,
                archived_at         TEXT,
                created_at          TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at          TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO chat_workflow_rounds (
                id, execution_id, round_index, source_revision_id, status, result_step_id,
                user_decision_summary, started_at, completed_at, archived_at, created_at,
                updated_at
            )
            SELECT
                id, execution_id, round_index, source_revision_id, status, result_step_id,
                user_decision_summary, started_at, completed_at, archived_at, created_at,
                updated_at
            FROM chat_workflow_rounds_old
            "#,
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query("DROP TABLE chat_workflow_rounds_old")
            .execute(&mut *conn)
            .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_rounds_execution_id ON chat_workflow_rounds(execution_id)",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "CREATE UNIQUE INDEX idx_workflow_rounds_exec_index ON chat_workflow_rounds(execution_id, round_index)",
        )
        .execute(&mut *conn)
        .await?;

        sqlx::query("ALTER TABLE chat_workflow_steps RENAME TO chat_workflow_steps_old")
            .execute(&mut *conn)
            .await?;
        sqlx::query(
            r#"
            CREATE TABLE chat_workflow_steps (
                id                              BLOB    NOT NULL PRIMARY KEY,
                execution_id                    BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
                round_id                        BLOB    NOT NULL REFERENCES chat_workflow_rounds(id),
                compiled_revision_id            BLOB    REFERENCES chat_workflow_plan_revisions(id),
                step_key                        TEXT    NOT NULL,
                step_type                       TEXT    NOT NULL
                                                        CHECK (step_type IN ('task', 'review', 'result')),
                title                           TEXT    NOT NULL DEFAULT '',
                instructions                    TEXT    NOT NULL DEFAULT '',
                assigned_workflow_agent_session_id BLOB,
                status                          TEXT    NOT NULL DEFAULT 'pending'
                                                        CHECK (status IN (
                                                            'pending', 'ready', 'running',
                                                            'interrupt_requested', 'interrupted',
                                                            'waiting_input', 'waiting_review',
                                                            'blocked', 'completed', 'failed',
                                                            'skipped'
                                                        )),
                retry_count                     INTEGER NOT NULL DEFAULT 0,
                max_retry                       INTEGER NOT NULL DEFAULT 1,
                round_index                     INTEGER NOT NULL DEFAULT 1,
                display_order                   INTEGER NOT NULL DEFAULT 0,
                latest_run_id                   BLOB,
                summary_text                    TEXT,
                content                         TEXT,
                created_at                      TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at                      TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
                started_at                      TEXT,
                completed_at                    TEXT
            )
            "#,
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO chat_workflow_steps (
                id, execution_id, round_id, compiled_revision_id, step_key, step_type, title,
                instructions, assigned_workflow_agent_session_id, status, retry_count,
                max_retry, round_index, display_order, latest_run_id, summary_text, content,
                created_at, updated_at, started_at, completed_at
            )
            SELECT
                id, execution_id, round_id, compiled_revision_id, step_key, step_type, title,
                instructions, assigned_workflow_agent_session_id, status, retry_count,
                max_retry, round_index, display_order, latest_run_id, summary_text,
                CASE
                    WHEN json_valid(summary_text) THEN json_extract(summary_text, '$.content')
                    ELSE NULL
                END,
                created_at, updated_at, started_at, completed_at
            FROM chat_workflow_steps_old
            "#,
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query("DROP TABLE chat_workflow_steps_old")
            .execute(&mut *conn)
            .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_steps_execution_id ON chat_workflow_steps(execution_id)",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query("CREATE INDEX idx_workflow_steps_round_id ON chat_workflow_steps(round_id)")
            .execute(&mut *conn)
            .await?;
        sqlx::query("CREATE INDEX idx_workflow_steps_status ON chat_workflow_steps(status)")
            .execute(&mut *conn)
            .await?;
        sqlx::query(
            "CREATE UNIQUE INDEX idx_workflow_steps_round_key ON chat_workflow_steps(round_id, step_key)",
        )
        .execute(&mut *conn)
        .await?;

        sqlx::query(
            "ALTER TABLE chat_workflow_step_edges RENAME TO chat_workflow_step_edges_old",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            r#"
            CREATE TABLE chat_workflow_step_edges (
                id                  BLOB    NOT NULL PRIMARY KEY,
                execution_id        BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
                compiled_revision_id BLOB   REFERENCES chat_workflow_plan_revisions(id),
                from_step_id        BLOB    NOT NULL REFERENCES chat_workflow_steps(id),
                to_step_id          BLOB    NOT NULL REFERENCES chat_workflow_steps(id),
                edge_kind           TEXT    NOT NULL DEFAULT 'hard'
                                            CHECK (edge_kind IN ('hard', 'soft')),
                created_at          TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO chat_workflow_step_edges (
                id, execution_id, compiled_revision_id, from_step_id, to_step_id, edge_kind,
                created_at
            )
            SELECT
                id, execution_id, compiled_revision_id, from_step_id, to_step_id, edge_kind,
                created_at
            FROM chat_workflow_step_edges_old
            "#,
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query("DROP TABLE chat_workflow_step_edges_old")
            .execute(&mut *conn)
            .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_step_edges_execution_id ON chat_workflow_step_edges(execution_id)",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_step_edges_from ON chat_workflow_step_edges(from_step_id)",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query("CREATE INDEX idx_workflow_step_edges_to ON chat_workflow_step_edges(to_step_id)")
            .execute(&mut *conn)
            .await?;

        sqlx::query(
            "ALTER TABLE chat_workflow_agent_sessions RENAME TO chat_workflow_agent_sessions_old",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            r#"
            CREATE TABLE chat_workflow_agent_sessions (
                id                      BLOB    NOT NULL PRIMARY KEY,
                workflow_execution_id   BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
                session_agent_id        BLOB    NOT NULL,
                role                    TEXT    NOT NULL DEFAULT 'worker'
                                                CHECK (role IN ('lead', 'worker', 'reviewer')),
                agent_session_id        TEXT,
                agent_message_id        TEXT,
                state                   TEXT    NOT NULL DEFAULT 'idle'
                                                CHECK (state IN (
                                                    'idle', 'running', 'interrupt_requested',
                                                    'interrupted', 'paused', 'completed',
                                                    'failed', 'expired'
                                                )),
                created_at              TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at              TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO chat_workflow_agent_sessions (
                id, workflow_execution_id, session_agent_id, role, agent_session_id,
                agent_message_id, state, created_at, updated_at
            )
            SELECT
                id, workflow_execution_id, session_agent_id, role, agent_session_id,
                agent_message_id,
                CASE
                    WHEN state IN ('waiting_input', 'waiting_approval') THEN 'paused'
                    ELSE state
                END,
                created_at,
                updated_at
            FROM chat_workflow_agent_sessions_old
            "#,
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query("DROP TABLE chat_workflow_agent_sessions_old")
            .execute(&mut *conn)
            .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_agent_sessions_execution_id ON chat_workflow_agent_sessions(workflow_execution_id)",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_agent_sessions_state ON chat_workflow_agent_sessions(state)",
        )
        .execute(&mut *conn)
        .await?;

        sqlx::query("ALTER TABLE chat_workflow_events RENAME TO chat_workflow_events_old")
            .execute(&mut *conn)
            .await?;
        sqlx::query(
            r#"
            CREATE TABLE chat_workflow_events (
                id              BLOB    NOT NULL PRIMARY KEY,
                execution_id    BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
                round_id        BLOB,
                step_id         BLOB,
                agent_session_id BLOB,
                event_type      TEXT    NOT NULL,
                status_before   TEXT,
                status_after    TEXT,
                detail_json     TEXT,
                created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO chat_workflow_events (
                id, execution_id, round_id, step_id, agent_session_id, event_type,
                status_before, status_after, detail_json, created_at
            )
            SELECT
                id, execution_id, round_id, step_id, agent_session_id, event_type,
                status_before, status_after, detail_json, created_at
            FROM chat_workflow_events_old
            "#,
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query("DROP TABLE chat_workflow_events_old")
            .execute(&mut *conn)
            .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_events_execution_id ON chat_workflow_events(execution_id)",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_events_event_type ON chat_workflow_events(event_type)",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_events_created_at ON chat_workflow_events(created_at)",
        )
        .execute(&mut *conn)
        .await?;

        sqlx::query(
            "ALTER TABLE chat_workflow_transcripts RENAME TO chat_workflow_transcripts_old",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            r#"
            CREATE TABLE chat_workflow_transcripts (
                id                        BLOB NOT NULL PRIMARY KEY,
                execution_id              BLOB NOT NULL REFERENCES chat_workflow_executions(id),
                round_id                  BLOB REFERENCES chat_workflow_rounds(id),
                workflow_agent_session_id BLOB REFERENCES chat_workflow_agent_sessions(id),
                step_id                   BLOB REFERENCES chat_workflow_steps(id),
                sender_type               TEXT NOT NULL DEFAULT 'system',
                entry_type                TEXT NOT NULL DEFAULT 'message',
                content                   TEXT NOT NULL DEFAULT '',
                meta_json                 TEXT,
                created_at                TEXT NOT NULL DEFAULT (datetime('now'))
            )
            "#,
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO chat_workflow_transcripts (
                id, execution_id, round_id, workflow_agent_session_id, step_id, sender_type,
                entry_type, content, meta_json, created_at
            )
            SELECT
                id, execution_id, round_id, workflow_agent_session_id, step_id, sender_type,
                entry_type, content, meta_json, created_at
            FROM chat_workflow_transcripts_old
            "#,
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query("DROP TABLE chat_workflow_transcripts_old")
            .execute(&mut *conn)
            .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_transcripts_execution_id ON chat_workflow_transcripts(execution_id)",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_transcripts_step_id ON chat_workflow_transcripts(step_id)",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_transcripts_entry_type ON chat_workflow_transcripts(entry_type)",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_transcripts_created_at ON chat_workflow_transcripts(created_at)",
        )
        .execute(&mut *conn)
        .await?;

        sqlx::query(
            "CREATE INDEX idx_workflow_executions_session_id ON chat_workflow_executions(session_id)",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_executions_plan_id ON chat_workflow_executions(plan_id)",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_executions_status ON chat_workflow_executions(status)",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "CREATE INDEX idx_workflow_executions_active_revision_id ON chat_workflow_executions(active_revision_id)",
        )
        .execute(&mut *conn)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO _sqlx_migrations (
                version,
                description,
                success,
                checksum,
                execution_time
            )
            VALUES (?1, ?2, 1, ?3, ?4)
            "#,
        )
        .bind(migration.version)
        .bind(migration.description.clone())
        .bind(&*migration.checksum)
        .bind(started.elapsed().as_nanos() as i64)
        .execute(&mut *conn)
        .await?;

        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&mut *conn)
            .await?;

        let fk_violations = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM pragma_foreign_key_check")
            .fetch_one(&mut *conn)
            .await?;
        if fk_violations > 0 {
            return Err(Error::Protocol(
                "workflow execution status migration shim left foreign key violations".into(),
            ));
        }

        Ok::<(), Error>(())
    }
    .await;

    let _ = sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut *conn)
        .await;

    result
}

async fn apply_workflow_agent_session_state_migration_shim(
    pool: &Pool<Sqlite>,
    migrator: &sqlx::migrate::Migrator,
) -> Result<(), Error> {
    let Some(migration) = migrator
        .iter()
        .find(|migration| migration.version == WORKFLOW_AGENT_SESSION_STATE_MIGRATION_VERSION)
    else {
        return Ok(());
    };

    let migrations_table_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_one(pool)
    .await?;
    if migrations_table_exists == 0 {
        return Ok(());
    }

    let already_applied = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM _sqlx_migrations WHERE version = ?1 AND success = 1",
    )
    .bind(WORKFLOW_AGENT_SESSION_STATE_MIGRATION_VERSION)
    .fetch_one(pool)
    .await?;
    if already_applied > 0 {
        return Ok(());
    }

    let agent_sessions_table_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'chat_workflow_agent_sessions'",
    )
    .fetch_one(pool)
    .await?;
    if agent_sessions_table_exists == 0 {
        return Ok(());
    }

    let mut conn = pool.acquire().await?;
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *conn)
        .await?;
    sqlx::query("PRAGMA legacy_alter_table = ON")
        .execute(&mut *conn)
        .await?;

    let result = async {
        let old_table_exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'chat_workflow_agent_sessions_old'",
        )
        .fetch_one(&mut *conn)
        .await?;

        if old_table_exists > 0 {
            sqlx::query("DROP TABLE IF EXISTS chat_workflow_agent_sessions")
                .execute(&mut *conn)
                .await?;
        } else {
            sqlx::query(
                "ALTER TABLE chat_workflow_agent_sessions RENAME TO chat_workflow_agent_sessions_old",
            )
            .execute(&mut *conn)
            .await?;
        }

        sqlx::query(
            r#"
            CREATE TABLE chat_workflow_agent_sessions (
                id                      BLOB    NOT NULL PRIMARY KEY,
                workflow_execution_id   BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
                session_agent_id        BLOB    NOT NULL,
                role                    TEXT    NOT NULL DEFAULT 'worker'
                                                CHECK (role IN ('lead', 'worker', 'reviewer')),
                agent_session_id        TEXT,
                agent_message_id        TEXT,
                state                   TEXT    NOT NULL DEFAULT 'idle'
                                                CHECK (state IN (
                                                    'idle', 'running', 'interrupt_requested',
                                                    'interrupted', 'paused', 'completed',
                                                    'failed', 'expired'
                                                )),
                created_at              TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at              TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&mut *conn)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO chat_workflow_agent_sessions (
                id, workflow_execution_id, session_agent_id, role, agent_session_id,
                agent_message_id, state, created_at, updated_at
            )
            SELECT
                id, workflow_execution_id, session_agent_id, role, agent_session_id,
                agent_message_id,
                CASE
                    WHEN state IN ('waiting_input', 'waiting_approval') THEN 'paused'
                    ELSE state
                END,
                created_at,
                updated_at
            FROM chat_workflow_agent_sessions_old old
            WHERE EXISTS (
                SELECT 1
                FROM chat_workflow_executions exec
                WHERE exec.id = old.workflow_execution_id
            )
            "#,
        )
        .execute(&mut *conn)
        .await?;

        let transcripts_table_exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'chat_workflow_transcripts'",
        )
        .fetch_one(&mut *conn)
        .await?;
        if transcripts_table_exists > 0 {
            sqlx::query(
                "ALTER TABLE chat_workflow_transcripts RENAME TO chat_workflow_transcripts_old",
            )
            .execute(&mut *conn)
            .await?;
            sqlx::query(
                r#"
                CREATE TABLE chat_workflow_transcripts (
                    id                        BLOB NOT NULL PRIMARY KEY,
                    execution_id              BLOB NOT NULL REFERENCES chat_workflow_executions(id),
                    round_id                  BLOB REFERENCES chat_workflow_rounds(id),
                    workflow_agent_session_id BLOB REFERENCES chat_workflow_agent_sessions(id),
                    step_id                   BLOB REFERENCES chat_workflow_steps(id),
                    sender_type               TEXT NOT NULL DEFAULT 'system',
                    entry_type                TEXT NOT NULL DEFAULT 'message',
                    content                   TEXT NOT NULL DEFAULT '',
                    meta_json                 TEXT,
                    created_at                TEXT NOT NULL DEFAULT (datetime('now'))
                )
                "#,
            )
            .execute(&mut *conn)
            .await?;
            sqlx::query(
                r#"
                INSERT INTO chat_workflow_transcripts (
                    id, execution_id, round_id, workflow_agent_session_id, step_id, sender_type,
                    entry_type, content, meta_json, created_at
                )
                SELECT
                    old.id, old.execution_id, old.round_id, old.workflow_agent_session_id,
                    old.step_id, old.sender_type, old.entry_type, old.content, old.meta_json,
                    old.created_at
                FROM chat_workflow_transcripts_old old
                WHERE old.workflow_agent_session_id IS NULL
                   OR EXISTS (
                       SELECT 1
                       FROM chat_workflow_agent_sessions s
                       WHERE s.id = old.workflow_agent_session_id
                   )
                "#,
            )
            .execute(&mut *conn)
            .await?;
            sqlx::query("DROP TABLE chat_workflow_transcripts_old")
                .execute(&mut *conn)
                .await?;
            sqlx::query(
                "CREATE INDEX IF NOT EXISTS idx_workflow_transcripts_execution_id ON chat_workflow_transcripts(execution_id)",
            )
            .execute(&mut *conn)
            .await?;
            sqlx::query(
                "CREATE INDEX IF NOT EXISTS idx_workflow_transcripts_step_id ON chat_workflow_transcripts(step_id)",
            )
            .execute(&mut *conn)
            .await?;
            sqlx::query(
                "CREATE INDEX IF NOT EXISTS idx_workflow_transcripts_entry_type ON chat_workflow_transcripts(entry_type)",
            )
            .execute(&mut *conn)
            .await?;
            sqlx::query(
                "CREATE INDEX IF NOT EXISTS idx_workflow_transcripts_created_at ON chat_workflow_transcripts(created_at)",
            )
            .execute(&mut *conn)
            .await?;
        }

        sqlx::query("DROP TABLE chat_workflow_agent_sessions_old")
            .execute(&mut *conn)
            .await?;

        sqlx::query("PRAGMA legacy_alter_table = OFF")
            .execute(&mut *conn)
            .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_workflow_agent_sessions_execution_id ON chat_workflow_agent_sessions(workflow_execution_id)",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_workflow_agent_sessions_state ON chat_workflow_agent_sessions(state)",
        )
        .execute(&mut *conn)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO _sqlx_migrations (
                version,
                description,
                success,
                checksum,
                execution_time
            )
            VALUES (?1, ?2, 1, ?3, 0)
            "#,
        )
        .bind(migration.version)
        .bind(migration.description.clone())
        .bind(&*migration.checksum)
        .execute(&mut *conn)
        .await?;

        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&mut *conn)
            .await?;

        let fk_violations = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM pragma_foreign_key_check")
            .fetch_one(&mut *conn)
            .await?;
        if fk_violations > 0 {
            return Err(Error::Protocol(
                "workflow agent session state migration shim left foreign key violations".into(),
            ));
        }

        Ok::<(), Error>(())
    }
    .await;

    let _ = sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut *conn)
        .await;

    result
}

async fn table_exists(pool: &Pool<Sqlite>, table: &str) -> Result<bool, Error> {
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
    )
    .bind(table)
    .fetch_one(pool)
    .await?;

    Ok(count > 0)
}

async fn column_exists(pool: &Pool<Sqlite>, table: &str, column: &str) -> Result<bool, Error> {
    let rows = sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(pool)
        .await?;

    Ok(rows
        .iter()
        .any(|row| row.get::<String, _>("name") == column))
}

async fn add_column_if_missing(
    pool: &Pool<Sqlite>,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), Error> {
    if !column_exists(pool, table, column).await? {
        sqlx::query(&format!("ALTER TABLE {table} ADD COLUMN {definition}"))
            .execute(pool)
            .await?;
    }

    Ok(())
}

async fn apply_project_centric_backend_schema_migration_shim(
    pool: &Pool<Sqlite>,
    migrator: &sqlx::migrate::Migrator,
) -> Result<(), Error> {
    let Some(migration) = migrator
        .iter()
        .find(|migration| migration.version == PROJECT_CENTRIC_BACKEND_SCHEMA_MIGRATION_VERSION)
    else {
        return Ok(());
    };

    if !table_exists(pool, "_sqlx_migrations").await?
        || !table_exists(pool, "chat_sessions").await?
        || !table_exists(pool, "projects").await?
    {
        return Ok(());
    }

    let started = Instant::now();
    sqlx::raw_sql(
        r#"
        CREATE TABLE IF NOT EXISTS project_members (
            id                     TEXT PRIMARY KEY,
            project_id             TEXT REFERENCES projects(id) ON DELETE CASCADE,
            member_type            TEXT CHECK (member_type IN ('human', 'agent')),
            user_id                TEXT,
            agent_id               TEXT REFERENCES chat_agents(id),
            role                   TEXT,
            display_order          INTEGER DEFAULT 0,
            default_workspace_path TEXT,
            allowed_skill_ids      JSONB,
            execution_config       JSONB NOT NULL DEFAULT '{}',
            is_default             BOOLEAN DEFAULT false,
            created_at             TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
            updated_at             TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_project_members_one_human_per_project
            ON project_members(project_id)
            WHERE member_type = 'human';

        CREATE TABLE IF NOT EXISTS project_paths (
            id         TEXT PRIMARY KEY,
            project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
            path       TEXT NOT NULL,
            label      TEXT,
            kind       TEXT CHECK (kind IN ('workspace', 'artifact', 'external')),
            is_default BOOLEAN DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
        );

        CREATE TABLE IF NOT EXISTS repo_integrations (
            id              TEXT PRIMARY KEY,
            repo_id         TEXT REFERENCES repos(id) ON DELETE CASCADE,
            provider        TEXT NOT NULL,
            owner           TEXT,
            name            TEXT,
            remote_url      TEXT,
            default_branch  TEXT,
            external_id     TEXT,
            installation_id TEXT,
            sync_status     TEXT,
            last_synced_at  TIMESTAMPTZ,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
        );

        CREATE TABLE IF NOT EXISTS github_installations (
            id                   TEXT PRIMARY KEY,
            account_login        TEXT,
            account_type         TEXT,
            installation_id      TEXT,
            permissions_json     JSONB,
            repository_selection TEXT,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec')),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
        );

        CREATE TABLE IF NOT EXISTS github_pull_requests (
            id                  TEXT PRIMARY KEY,
            repo_integration_id TEXT REFERENCES repo_integrations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS github_issues (
            id                  TEXT PRIMARY KEY,
            repo_integration_id TEXT REFERENCES repo_integrations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS github_workflow_runs (
            id                  TEXT PRIMARY KEY,
            repo_integration_id TEXT REFERENCES repo_integrations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS github_sync_jobs (
            id                  TEXT PRIMARY KEY,
            repo_integration_id TEXT REFERENCES repo_integrations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS project_delivery_events (
            id                    TEXT PRIMARY KEY,
            project_id            TEXT REFERENCES projects(id) ON DELETE CASCADE,
            session_id            TEXT,
            workflow_execution_id TEXT,
            step_id               TEXT,
            event_type            TEXT CHECK (event_type IN ('feature', 'bugfix', 'test')),
            title                 TEXT,
            source                TEXT,
            created_at            TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
        );

        CREATE TABLE IF NOT EXISTS project_stats (
            id             TEXT PRIMARY KEY,
            project_id     TEXT REFERENCES projects(id) ON DELETE CASCADE,
            period_start   DATE,
            period_end     DATE,
            feature_count  INTEGER DEFAULT 0,
            bugfix_count   INTEGER DEFAULT 0,
            test_count     INTEGER DEFAULT 0,
            input_tokens   BIGINT DEFAULT 0,
            output_tokens  BIGINT DEFAULT 0,
            cache_read_tokens BIGINT DEFAULT 0,
            reasoning_output_tokens BIGINT DEFAULT 0,
            total_tokens   BIGINT DEFAULT 0,
            cost_total     DECIMAL,
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT (datetime('now', 'subsec'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_project_stats_project_period
            ON project_stats(project_id, period_start, period_end);
        "#,
    )
    .execute(pool)
    .await?;

    add_column_if_missing(pool, "chat_sessions", "project_id", "project_id TEXT").await?;
    add_column_if_missing(pool, "projects", "description", "description TEXT").await?;
    add_column_if_missing(pool, "projects", "status", "status TEXT").await?;
    add_column_if_missing(
        pool,
        "projects",
        "default_workspace_path",
        "default_workspace_path TEXT",
    )
    .await?;
    add_column_if_missing(pool, "projects", "active_repo_id", "active_repo_id TEXT").await?;
    add_column_if_missing(
        pool,
        "project_members",
        "execution_config",
        "execution_config TEXT NOT NULL DEFAULT '{}'",
    )
    .await?;
    add_column_if_missing(
        pool,
        "chat_session_agents",
        "project_member_id",
        "project_member_id BLOB",
    )
    .await?;
    add_column_if_missing(
        pool,
        "chat_session_agents",
        "execution_config",
        "execution_config TEXT NOT NULL DEFAULT '{}'",
    )
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_chat_sessions_project_updated ON chat_sessions(project_id, updated_at)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_chat_session_agents_project_member_id ON chat_session_agents(project_member_id)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO _sqlx_migrations (
            version,
            description,
            success,
            checksum,
            execution_time
        )
        VALUES (?1, ?2, 1, ?3, ?4)
        ON CONFLICT(version) DO UPDATE SET
            description = excluded.description,
            success = excluded.success,
            checksum = excluded.checksum,
            execution_time = excluded.execution_time
        "#,
    )
    .bind(migration.version)
    .bind(migration.description.clone())
    .bind(&*migration.checksum)
    .bind(started.elapsed().as_nanos() as i64)
    .execute(pool)
    .await?;

    Ok(())
}

async fn apply_member_execution_config_migration_shim(
    pool: &Pool<Sqlite>,
    migrator: &sqlx::migrate::Migrator,
) -> Result<(), Error> {
    let Some(migration) = migrator
        .iter()
        .find(|migration| migration.version == MEMBER_EXECUTION_CONFIG_MIGRATION_VERSION)
    else {
        return Ok(());
    };

    if !table_exists(pool, "_sqlx_migrations").await?
        || !table_exists(pool, "project_members").await?
        || !table_exists(pool, "chat_session_agents").await?
    {
        return Ok(());
    }

    let already_applied = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM _sqlx_migrations WHERE version = ?1 AND success = 1",
    )
    .bind(MEMBER_EXECUTION_CONFIG_MIGRATION_VERSION)
    .fetch_one(pool)
    .await?;
    if already_applied > 0 {
        return Ok(());
    }

    tracing::info!(
        "Applying compatibility shim for migration {} before sqlx migrator runs",
        MEMBER_EXECUTION_CONFIG_MIGRATION_VERSION
    );

    let started = Instant::now();
    add_column_if_missing(
        pool,
        "project_members",
        "execution_config",
        "execution_config TEXT NOT NULL DEFAULT '{}'",
    )
    .await?;
    add_column_if_missing(
        pool,
        "chat_session_agents",
        "project_member_id",
        "project_member_id BLOB",
    )
    .await?;
    add_column_if_missing(
        pool,
        "chat_session_agents",
        "execution_config",
        "execution_config TEXT NOT NULL DEFAULT '{}'",
    )
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_chat_session_agents_project_member_id ON chat_session_agents(project_member_id)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO _sqlx_migrations (
            version,
            description,
            success,
            checksum,
            execution_time
        )
        VALUES (?1, ?2, 1, ?3, ?4)
        ON CONFLICT(version) DO UPDATE SET
            description = excluded.description,
            success = excluded.success,
            checksum = excluded.checksum,
            execution_time = excluded.execution_time
        "#,
    )
    .bind(migration.version)
    .bind(migration.description.clone())
    .bind(&*migration.checksum)
    .bind(started.elapsed().as_nanos() as i64)
    .execute(pool)
    .await?;

    Ok(())
}

async fn run_migrations(pool: &Pool<Sqlite>) -> Result<(), Error> {
    use std::collections::HashSet;

    let migrator = sqlx::migrate!("./migrations");
    apply_workflow_execution_status_migration_shim(pool, &migrator).await?;
    apply_workflow_agent_session_state_migration_shim(pool, &migrator).await?;
    apply_project_centric_backend_schema_migration_shim(pool, &migrator).await?;
    apply_member_execution_config_migration_shim(pool, &migrator).await?;
    let mut processed_versions: HashSet<i64> = HashSet::new();

    loop {
        match migrator.run(pool).await {
            Ok(()) => return Ok(()),
            Err(MigrateError::VersionMismatch(version)) => {
                if !cfg!(windows) {
                    // On non-Windows platforms, we do not attempt to auto-fix checksum mismatches
                    return Err(sqlx::Error::Migrate(Box::new(
                        MigrateError::VersionMismatch(version),
                    )));
                }

                // Guard against infinite loop
                if !processed_versions.insert(version) {
                    return Err(sqlx::Error::Migrate(Box::new(
                        MigrateError::VersionMismatch(version),
                    )));
                }

                // On Windows, local dev databases can see checksum mismatches from line endings
                // or migration compatibility shims. Update the stored checksum and retry.
                tracing::warn!(
                    "Migration version {} has checksum mismatch, updating stored checksum (likely platform-specific difference)",
                    version
                );

                // Find the migration with the mismatched version and get its current checksum
                if let Some(migration) = migrator.iter().find(|m| m.version == version) {
                    // Update the checksum in _sqlx_migrations to match the current file
                    sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?")
                        .bind(&*migration.checksum)
                        .bind(version)
                        .execute(pool)
                        .await?;
                } else {
                    // Migration not found in current set, can't fix
                    return Err(sqlx::Error::Migrate(Box::new(
                        MigrateError::VersionMismatch(version),
                    )));
                }
            }
            Err(e) => return Err(e.into()),
        }
    }
}

#[derive(Clone)]
pub struct DBService {
    pub pool: Pool<Sqlite>,
}

impl DBService {
    pub async fn new() -> Result<DBService, Error> {
        let database_url = format!(
            "sqlite://{}",
            asset_dir().join("db.sqlite").to_string_lossy()
        );
        let options = SqliteConnectOptions::from_str(&database_url)?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Delete);
        let pool = SqlitePool::connect_with(options).await?;
        run_migrations(&pool).await?;
        Ok(DBService { pool })
    }

    pub async fn new_with_after_connect<F>(after_connect: F) -> Result<DBService, Error>
    where
        F: for<'a> Fn(
                &'a mut SqliteConnection,
            ) -> std::pin::Pin<
                Box<dyn std::future::Future<Output = Result<(), Error>> + Send + 'a>,
            > + Send
            + Sync
            + 'static,
    {
        let pool = Self::create_pool(Some(Arc::new(after_connect))).await?;
        Ok(DBService { pool })
    }

    async fn create_pool<F>(after_connect: Option<Arc<F>>) -> Result<Pool<Sqlite>, Error>
    where
        F: for<'a> Fn(
                &'a mut SqliteConnection,
            ) -> std::pin::Pin<
                Box<dyn std::future::Future<Output = Result<(), Error>> + Send + 'a>,
            > + Send
            + Sync
            + 'static,
    {
        let database_url = format!(
            "sqlite://{}",
            asset_dir().join("db.sqlite").to_string_lossy()
        );
        let options = SqliteConnectOptions::from_str(&database_url)?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Delete);

        let pool = if let Some(hook) = after_connect {
            SqlitePoolOptions::new()
                .after_connect(move |conn, _meta| {
                    let hook = hook.clone();
                    Box::pin(async move {
                        hook(conn).await?;
                        Ok(())
                    })
                })
                .connect_with(options)
                .await?
        } else {
            SqlitePool::connect_with(options).await?
        };

        run_migrations(&pool).await?;
        Ok(pool)
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use chrono::{Duration, NaiveDate, Utc};
    use sqlx::{Row, SqlitePool};
    use uuid::Uuid;

    use super::{
        MEMBER_EXECUTION_CONFIG_MIGRATION_VERSION,
        PROJECT_CENTRIC_BACKEND_SCHEMA_MIGRATION_VERSION, run_migrations,
    };
    use crate::models::{
        chat_agent::{ChatAgent, CreateChatAgent},
        chat_session::{ChatSession, CreateChatSession},
        chat_session_agent::{ChatSessionAgent, ChatSessionAgentState, CreateChatSessionAgent},
        member_execution_config::MemberExecutionConfig,
        project::{CreateProject, Project, UpdateProject},
        project_delivery_event::{ProjectDeliveryEvent, ProjectDeliveryEventType},
        project_member::{ProjectMember, ProjectMemberType, UpdateProjectMember},
        project_path::{ProjectPath, ProjectPathKind, UpdateProjectPath},
        project_repo::ProjectRepo,
        project_stats::ProjectStats,
        repo::Repo,
        repo_integration::{RepoIntegration, UpdateRepoIntegration},
    };

    #[tokio::test]
    async fn migrations_allow_stopping_and_waitingapproval_chat_agent_states() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");

        let session = ChatSession::create(
            &pool,
            &CreateChatSession {
                title: Some("test".to_string()),
                workspace_path: None,
                project_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat session");
        let agent = ChatAgent::create(
            &pool,
            &CreateChatAgent {
                name: "tester".to_string(),
                runner_type: "codex".to_string(),
                system_prompt: Some(String::new()),
                tools_enabled: Some(serde_json::json!({})),
                model_name: None,
                owner_project_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat agent");
        let session_agent = ChatSessionAgent::create(
            &pool,
            &CreateChatSessionAgent {
                session_id: session.id,
                agent_id: agent.id,
                workspace_path: None,
                allowed_skill_ids: Vec::new(),
                project_member_id: None,
                execution_config: MemberExecutionConfig::default(),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create session agent");

        let stopping = ChatSessionAgent::update_state(
            &pool,
            session_agent.id,
            ChatSessionAgentState::Stopping,
        )
        .await
        .expect("set stopping");
        assert_eq!(stopping.state, ChatSessionAgentState::Stopping);

        let waiting = ChatSessionAgent::update_state(
            &pool,
            session_agent.id,
            ChatSessionAgentState::WaitingApproval,
        )
        .await
        .expect("set waiting approval");
        assert_eq!(waiting.state, ChatSessionAgentState::WaitingApproval);
    }

    #[tokio::test]
    async fn migrations_do_not_leave_chat_session_bubble_font_size_column() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");

        let rows = sqlx::query("PRAGMA table_info(chat_sessions)")
            .fetch_all(&pool)
            .await
            .expect("read chat_sessions columns");

        let column_names = rows
            .iter()
            .map(|row| row.get::<String, _>("name"))
            .collect::<Vec<_>>();

        assert!(
            !column_names.iter().any(|name| name == "bubble_font_size"),
            "chat_sessions should not keep the legacy bubble_font_size column after migrations"
        );
    }

    #[tokio::test]
    async fn migrations_create_project_centric_backend_schema() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");

        let expected_tables = [
            "project_members",
            "project_paths",
            "repo_integrations",
            "github_installations",
            "github_pull_requests",
            "github_issues",
            "github_workflow_runs",
            "github_sync_jobs",
            "project_delivery_events",
            "project_stats",
        ];
        for table in expected_tables {
            let exists = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            )
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("read sqlite table metadata");
            assert_eq!(exists, 1, "{table} should exist");
        }

        let chat_session_columns = sqlx::query("PRAGMA table_info(chat_sessions)")
            .fetch_all(&pool)
            .await
            .expect("read chat_sessions columns")
            .into_iter()
            .map(|row| row.get::<String, _>("name"))
            .collect::<Vec<_>>();
        assert!(
            chat_session_columns.iter().any(|name| name == "project_id"),
            "chat_sessions.project_id should exist"
        );

        let project_columns = sqlx::query("PRAGMA table_info(projects)")
            .fetch_all(&pool)
            .await
            .expect("read projects columns")
            .into_iter()
            .map(|row| row.get::<String, _>("name"))
            .collect::<Vec<_>>();
        for column in [
            "description",
            "status",
            "default_workspace_path",
            "active_repo_id",
        ] {
            assert!(
                project_columns.iter().any(|name| name == column),
                "projects.{column} should exist"
            );
        }

        let human_member_index_sql = sqlx::query_scalar::<_, String>(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?1",
        )
        .bind("idx_project_members_one_human_per_project")
        .fetch_one(&pool)
        .await
        .expect("read project member index");
        assert!(
            human_member_index_sql.contains("WHERE member_type = 'human'"),
            "project_members should enforce one human member per project"
        );

        let chat_sessions_project_index = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
        )
        .bind("idx_chat_sessions_project_updated")
        .fetch_one(&pool)
        .await
        .expect("read chat session project index");
        assert_eq!(chat_sessions_project_index, 1);

        let project_stats_period_index = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
        )
        .bind("idx_project_stats_project_period")
        .fetch_one(&pool)
        .await
        .expect("read project stats period index");
        assert_eq!(project_stats_period_index, 1);
    }

    #[tokio::test]
    async fn project_centric_migration_reruns_after_ledger_reset() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");

        sqlx::query("DELETE FROM _sqlx_migrations WHERE version = ?1")
            .bind(PROJECT_CENTRIC_BACKEND_SCHEMA_MIGRATION_VERSION)
            .execute(&pool)
            .await
            .expect("delete project-centric migration ledger row");

        run_migrations(&pool)
            .await
            .expect("rerun project-centric migration idempotently");

        let project_id_columns = sqlx::query("PRAGMA table_info(chat_sessions)")
            .fetch_all(&pool)
            .await
            .expect("read chat_sessions columns")
            .into_iter()
            .filter(|row| row.get::<String, _>("name") == "project_id")
            .count();
        assert_eq!(project_id_columns, 1);

        let project_stats_period_index = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
        )
        .bind("idx_project_stats_project_period")
        .fetch_one(&pool)
        .await
        .expect("read project stats period index");
        assert_eq!(project_stats_period_index, 1);
    }

    #[tokio::test]
    async fn member_execution_config_migration_reruns_after_columns_exist() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");

        sqlx::query("DELETE FROM _sqlx_migrations WHERE version = ?1")
            .bind(MEMBER_EXECUTION_CONFIG_MIGRATION_VERSION)
            .execute(&pool)
            .await
            .expect("delete member execution config migration ledger row");

        run_migrations(&pool)
            .await
            .expect("rerun member execution config migration idempotently");

        for (table, column) in [
            ("project_members", "execution_config"),
            ("chat_session_agents", "project_member_id"),
            ("chat_session_agents", "execution_config"),
        ] {
            let count = sqlx::query(&format!("PRAGMA table_info({table})"))
                .fetch_all(&pool)
                .await
                .expect("read table columns")
                .into_iter()
                .filter(|row| row.get::<String, _>("name") == column)
                .count();
            assert_eq!(count, 1, "{table}.{column} should exist once");
        }

        let index_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
        )
        .bind("idx_chat_session_agents_project_member_id")
        .fetch_one(&pool)
        .await
        .expect("read project member session agent index");
        assert_eq!(index_count, 1);
    }

    #[tokio::test]
    async fn project_stats_period_is_unique_per_project() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");

        let project = Project::create(
            &pool,
            &CreateProject {
                name: "stats uniqueness project".to_string(),
                repositories: Vec::new(),
                description: None,
                status: None,
                default_workspace_path: None,
                active_repo_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create project");
        let period_start = NaiveDate::from_ymd_opt(2026, 5, 1).unwrap();
        let period_end = NaiveDate::from_ymd_opt(2026, 5, 31).unwrap();

        ProjectStats::upsert(
            &pool,
            project.id,
            period_start,
            period_end,
            1,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            Some(0.0),
        )
        .await
        .expect("insert first project stats row");

        let duplicate = sqlx::query(
            r#"
            INSERT INTO project_stats (
                id,
                project_id,
                period_start,
                period_end
            ) VALUES (?1, ?2, ?3, ?4)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(project.id)
        .bind(period_start)
        .bind(period_end)
        .execute(&pool)
        .await;

        assert!(
            duplicate.is_err(),
            "project_stats should reject duplicate project/period rows"
        );
    }

    #[tokio::test]
    async fn project_member_path_session_and_details_models_work() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");

        let active_repo_id = Uuid::new_v4();
        let project = Project::create(
            &pool,
            &CreateProject {
                name: "project models".to_string(),
                repositories: Vec::new(),
                description: Some("model test".to_string()),
                status: Some("active".to_string()),
                default_workspace_path: Some("E:/workspace/project".to_string()),
                active_repo_id: Some(active_repo_id),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create project");
        assert_eq!(project.description.as_deref(), Some("model test"));
        assert_eq!(project.active_repo_id, Some(active_repo_id));

        let updated_project = Project::update(
            &pool,
            project.id,
            &UpdateProject {
                name: Some("renamed project".to_string()),
                description: Some("updated".to_string()),
                status: Some("paused".to_string()),
                default_workspace_path: Some("E:/workspace/updated".to_string()),
                active_repo_id: None,
            },
        )
        .await
        .expect("update project");
        assert_eq!(updated_project.name, "renamed project");
        assert_eq!(updated_project.description.as_deref(), Some("updated"));

        let agent = ChatAgent::create(
            &pool,
            &CreateChatAgent {
                name: "project-agent".to_string(),
                runner_type: "codex".to_string(),
                system_prompt: Some(String::new()),
                tools_enabled: Some(serde_json::json!({})),
                model_name: None,
                owner_project_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat agent");

        let human = ProjectMember::create(
            &pool,
            project.id,
            ProjectMemberType::Human,
            Some("user-1".to_string()),
            None,
            None,
            Some("owner".to_string()),
            0,
            None,
            Vec::new(),
            MemberExecutionConfig::default(),
            true,
        )
        .await
        .expect("create human member");
        let agent_member = ProjectMember::create(
            &pool,
            project.id,
            ProjectMemberType::Agent,
            None,
            Some(agent.id),
            Some("Project Developer".to_string()),
            Some("developer".to_string()),
            1,
            Some("E:/workspace/agent".to_string()),
            vec!["skill-a".to_string()],
            MemberExecutionConfig::default(),
            true,
        )
        .await
        .expect("create agent member");

        let default_agents = ProjectMember::find_default_agents(&pool, project.id)
            .await
            .expect("find default agents");
        assert_eq!(default_agents.len(), 1);
        assert_eq!(default_agents[0].agent_id, Some(agent.id));
        let human_member = ProjectMember::find_human_member(&pool, project.id)
            .await
            .expect("find human member")
            .expect("human member exists");
        assert_eq!(human_member.id, human.id);

        let updated_member = ProjectMember::update(
            &pool,
            agent_member.id,
            &UpdateProjectMember {
                member_type: None,
                user_id: None,
                agent_id: None,
                member_name: Some(Some("Project Reviewer".to_string())),
                role: Some("reviewer".to_string()),
                display_order: Some(2),
                default_workspace_path: None,
                allowed_skill_ids: Some(vec!["skill-b".to_string()]),
                execution_config: None,
                is_default: Some(false),
            },
        )
        .await
        .expect("update project member");
        assert_eq!(updated_member.role.as_deref(), Some("reviewer"));
        assert_eq!(
            updated_member.member_name.as_deref(),
            Some("Project Reviewer")
        );
        assert!(!updated_member.is_default);

        let path = ProjectPath::create(
            &pool,
            project.id,
            "E:/workspace/project".to_string(),
            Some("Workspace".to_string()),
            ProjectPathKind::Workspace,
            true,
        )
        .await
        .expect("create project path");
        let default_path = ProjectPath::find_default(&pool, project.id)
            .await
            .expect("find default path")
            .expect("default path exists");
        assert_eq!(default_path.id, path.id);

        let updated_path = ProjectPath::update(
            &pool,
            path.id,
            &UpdateProjectPath {
                path: Some("E:/workspace/project-updated".to_string()),
                label: Some("Updated workspace".to_string()),
                kind: None,
                is_default: Some(true),
            },
        )
        .await
        .expect("update project path");
        assert_eq!(updated_path.label.as_deref(), Some("Updated workspace"));

        let session = ChatSession::create(
            &pool,
            &CreateChatSession {
                title: Some("project session".to_string()),
                workspace_path: Some("E:/workspace/project".to_string()),
                project_id: Some(project.id),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create project chat session");
        let project_sessions = ChatSession::find_by_project(&pool, project.id)
            .await
            .expect("find project sessions");
        assert_eq!(project_sessions.len(), 1);
        assert_eq!(project_sessions[0].id, session.id);

        let details = Project::find_with_details(&pool, project.id)
            .await
            .expect("find project details")
            .expect("project details exist");
        assert_eq!(details.member_count, 2);
        assert_eq!(details.session_count, 1);
        assert_eq!(details.paths.len(), 1);

        assert_eq!(ProjectMember::delete(&pool, human.id).await.unwrap(), 1);
        assert_eq!(ProjectPath::delete(&pool, path.id).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn repo_integration_model_crud_uses_project_repo_join() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");

        let project = Project::create(
            &pool,
            &CreateProject {
                name: "repo integration project".to_string(),
                repositories: Vec::new(),
                description: None,
                status: None,
                default_workspace_path: None,
                active_repo_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create project");
        let repo = Repo::find_or_create(
            &pool,
            Path::new("E:/workspace/project/repo"),
            "Repo Integration",
        )
        .await
        .expect("create repo");
        ProjectRepo::create(&pool, project.id, repo.id)
            .await
            .expect("link project repo");

        let integration = RepoIntegration::create(
            &pool,
            repo.id,
            "github".to_string(),
            Some("octo".to_string()),
            Some("repo".to_string()),
            Some("https://github.com/octo/repo.git".to_string()),
            Some("main".to_string()),
            Some("external-1".to_string()),
            Some("installation-1".to_string()),
            Some("synced".to_string()),
            Some(Utc::now()),
        )
        .await
        .expect("create repo integration");

        let by_repo = RepoIntegration::find_by_repo_id(&pool, repo.id)
            .await
            .expect("find by repo");
        assert_eq!(by_repo.len(), 1);
        assert_eq!(by_repo[0].id, integration.id);

        let by_project = RepoIntegration::find_by_project(&pool, project.id)
            .await
            .expect("find by project");
        assert_eq!(by_project.len(), 1);
        assert_eq!(by_project[0].repo_id, repo.id);

        let updated = RepoIntegration::update(
            &pool,
            integration.id,
            &UpdateRepoIntegration {
                provider: None,
                owner: None,
                name: Some("renamed".to_string()),
                remote_url: None,
                default_branch: Some("trunk".to_string()),
                external_id: None,
                installation_id: None,
                github_account_id: None,
                repo_grant_json: None,
                role: None,
                sync_status: Some(
                    crate::models::repo_integration::RepoIntegrationSyncStatus::Disconnected,
                ),
                last_synced_at: None,
                last_error: Some("user disconnected".to_string()),
            },
        )
        .await
        .expect("update repo integration");
        assert_eq!(updated.name.as_deref(), Some("renamed"));
        assert_eq!(
            updated.sync_status,
            crate::models::repo_integration::RepoIntegrationSyncStatus::Disconnected
        );

        assert_eq!(
            RepoIntegration::delete(&pool, integration.id)
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn project_delivery_events_and_stats_models_work() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");

        let project = Project::create(
            &pool,
            &CreateProject {
                name: "delivery project".to_string(),
                repositories: Vec::new(),
                description: None,
                status: None,
                default_workspace_path: None,
                active_repo_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create project");
        let session = ChatSession::create(
            &pool,
            &CreateChatSession {
                title: Some("delivery session".to_string()),
                workspace_path: None,
                project_id: Some(project.id),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create session");

        let event = ProjectDeliveryEvent::create(
            &pool,
            project.id,
            ProjectDeliveryEventType::Feature,
            Some(session.id),
            None,
            None,
            Some("Feature shipped".to_string()),
            Some("workflow".to_string()),
        )
        .await
        .expect("create delivery event");

        let events = ProjectDeliveryEvent::find_by_project(&pool, project.id)
            .await
            .expect("find delivery events");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, event.id);

        let period_events = ProjectDeliveryEvent::find_by_project_and_period(
            &pool,
            project.id,
            Utc::now() - Duration::days(1),
            Utc::now() + Duration::days(1),
        )
        .await
        .expect("find period delivery events");
        assert_eq!(period_events.len(), 1);

        let period_start = NaiveDate::from_ymd_opt(2026, 5, 1).unwrap();
        let period_end = NaiveDate::from_ymd_opt(2026, 5, 31).unwrap();
        let stats = ProjectStats::upsert(
            &pool,
            project.id,
            period_start,
            period_end,
            1,
            2,
            3,
            100,
            200,
            0,
            0,
            300,
            Some(1.25),
        )
        .await
        .expect("insert project stats");
        assert_eq!(stats.feature_count, 1);

        let updated_stats = ProjectStats::upsert(
            &pool,
            project.id,
            period_start,
            period_end,
            4,
            5,
            6,
            400,
            500,
            0,
            0,
            900,
            Some(2.5),
        )
        .await
        .expect("update project stats");
        assert_eq!(updated_stats.id, stats.id);
        assert_eq!(updated_stats.total_tokens, 900);

        let by_project = ProjectStats::find_by_project(&pool, project.id)
            .await
            .expect("find project stats");
        assert_eq!(by_project.len(), 1);
        let by_period =
            ProjectStats::find_by_project_and_period(&pool, project.id, period_start, period_end)
                .await
                .expect("find project period stats")
                .expect("stats exist");
        assert_eq!(by_period.bugfix_count, 5);
    }

    #[tokio::test]
    async fn migrations_repair_workflow_transcript_agent_session_foreign_key() {
        let repair_migration_version = 20260426014500_i64;
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        run_migrations(&pool).await.expect("run migrations");

        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .expect("disable foreign keys");
        sqlx::query("PRAGMA legacy_alter_table = ON")
            .execute(&pool)
            .await
            .expect("enable legacy_alter_table");
        sqlx::query(
            "ALTER TABLE chat_workflow_agent_sessions RENAME TO chat_workflow_agent_sessions_old",
        )
        .execute(&pool)
        .await
        .expect("rename workflow agent sessions to old");
        sqlx::query(
            r#"
            CREATE TABLE chat_workflow_agent_sessions (
                id                      BLOB    NOT NULL PRIMARY KEY,
                workflow_execution_id   BLOB    NOT NULL REFERENCES chat_workflow_executions(id),
                session_agent_id        BLOB    NOT NULL,
                role                    TEXT    NOT NULL DEFAULT 'worker'
                                                CHECK (role IN ('lead', 'worker', 'reviewer')),
                agent_session_id        TEXT,
                agent_message_id        TEXT,
                state                   TEXT    NOT NULL DEFAULT 'idle'
                                                CHECK (state IN (
                                                    'idle', 'running', 'interrupt_requested',
                                                    'interrupted', 'paused', 'completed',
                                                    'failed', 'expired'
                                                )),
                created_at              TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at              TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("recreate workflow agent sessions");
        sqlx::query(
            r#"
            INSERT INTO chat_workflow_agent_sessions (
                id, workflow_execution_id, session_agent_id, role, agent_session_id,
                agent_message_id, state, created_at, updated_at
            )
            SELECT
                id, workflow_execution_id, session_agent_id, role, agent_session_id,
                agent_message_id, state, created_at, updated_at
            FROM chat_workflow_agent_sessions_old
            "#,
        )
        .execute(&pool)
        .await
        .expect("copy workflow agent sessions");
        sqlx::query("DROP TABLE chat_workflow_agent_sessions_old")
            .execute(&pool)
            .await
            .expect("drop old workflow agent sessions");
        sqlx::query("PRAGMA legacy_alter_table = OFF")
            .execute(&pool)
            .await
            .expect("disable legacy_alter_table");
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .expect("re-enable foreign keys");
        sqlx::query("DELETE FROM _sqlx_migrations WHERE version = ?")
            .bind(repair_migration_version)
            .execute(&pool)
            .await
            .expect("delete repair migration record");

        run_migrations(&pool)
            .await
            .expect("rerun migrations with repair");

        let foreign_keys = sqlx::query("PRAGMA foreign_key_list(chat_workflow_transcripts)")
            .fetch_all(&pool)
            .await
            .expect("read workflow transcript foreign keys");
        let workflow_agent_session_fk_table = foreign_keys
            .iter()
            .find(|row| row.get::<String, _>("from") == "workflow_agent_session_id")
            .map(|row| row.get::<String, _>("table"))
            .expect("workflow_agent_session_id foreign key");
        assert_eq!(
            workflow_agent_session_fk_table,
            "chat_workflow_agent_sessions"
        );

        let session = ChatSession::create(
            &pool,
            &CreateChatSession {
                title: Some("workflow".to_string()),
                workspace_path: None,
                project_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat session");
        let agent = ChatAgent::create(
            &pool,
            &CreateChatAgent {
                name: "tester".to_string(),
                runner_type: "codex".to_string(),
                system_prompt: Some(String::new()),
                tools_enabled: Some(serde_json::json!({})),
                model_name: None,
                owner_project_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat agent");
        let session_agent = ChatSessionAgent::create(
            &pool,
            &CreateChatSessionAgent {
                session_id: session.id,
                agent_id: agent.id,
                workspace_path: None,
                allowed_skill_ids: Vec::new(),
                project_member_id: None,
                execution_config: MemberExecutionConfig::default(),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create session agent");

        let plan_id = Uuid::new_v4();
        let revision_id = Uuid::new_v4();
        let execution_id = Uuid::new_v4();
        let round_id = Uuid::new_v4();
        let step_id = Uuid::new_v4();
        let workflow_agent_session_id = Uuid::new_v4();

        sqlx::query(
            "INSERT INTO chat_workflow_plans (id, session_id, title, plan_json, plan_hash, validation_status) VALUES (?1, ?2, '', '{}', '', 'valid')",
        )
        .bind(plan_id)
        .bind(session.id)
        .execute(&pool)
        .await
        .expect("insert workflow plan");
        sqlx::query(
            "INSERT INTO chat_workflow_plan_revisions (id, plan_id, revision_no, plan_json, plan_hash, validation_status) VALUES (?1, ?2, 1, '{}', '', 'valid')",
        )
        .bind(revision_id)
        .bind(plan_id)
        .execute(&pool)
        .await
        .expect("insert workflow revision");
        sqlx::query(
            "INSERT INTO chat_workflow_executions (id, session_id, plan_id, active_revision_id, status, title) VALUES (?1, ?2, ?3, ?4, 'running', '')",
        )
        .bind(execution_id)
        .bind(session.id)
        .bind(plan_id)
        .bind(revision_id)
        .execute(&pool)
        .await
        .expect("insert workflow execution");
        sqlx::query(
            "INSERT INTO chat_workflow_rounds (id, execution_id, round_index, source_revision_id, status) VALUES (?1, ?2, 1, ?3, 'running')",
        )
        .bind(round_id)
        .bind(execution_id)
        .bind(revision_id)
        .execute(&pool)
        .await
        .expect("insert workflow round");
        sqlx::query(
            "INSERT INTO chat_workflow_agent_sessions (id, workflow_execution_id, session_agent_id, role, state) VALUES (?1, ?2, ?3, 'worker', 'running')",
        )
        .bind(workflow_agent_session_id)
        .bind(execution_id)
        .bind(session_agent.id)
        .execute(&pool)
        .await
        .expect("insert workflow agent session");
        sqlx::query(
            "INSERT INTO chat_workflow_steps (id, execution_id, round_id, compiled_revision_id, step_key, step_type, title, instructions, status) VALUES (?1, ?2, ?3, ?4, 'step-1', 'task', 'Do work', 'Run the task', 'running')",
        )
        .bind(step_id)
        .bind(execution_id)
        .bind(round_id)
        .bind(revision_id)
        .execute(&pool)
        .await
        .expect("insert workflow step");
        sqlx::query(
            "INSERT INTO chat_workflow_transcripts (id, execution_id, round_id, workflow_agent_session_id, step_id, sender_type, entry_type, content) VALUES (?1, ?2, ?3, ?4, ?5, 'agent', 'thinking', 'hello')",
        )
        .bind(Uuid::new_v4())
        .bind(execution_id)
        .bind(round_id)
        .bind(workflow_agent_session_id)
        .bind(step_id)
        .execute(&pool)
        .await
        .expect("insert workflow transcript");
    }
}
