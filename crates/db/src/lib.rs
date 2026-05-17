use std::{str::FromStr, sync::Arc, time::Instant};

use sqlx::{
    Error, Pool, Sqlite, SqlitePool,
    migrate::MigrateError,
    sqlite::{SqliteConnectOptions, SqliteConnection, SqliteJournalMode, SqlitePoolOptions},
};
use utils::assets::asset_dir;

pub mod models;

const WORKFLOW_EXECUTION_STATUS_MIGRATION_VERSION: i64 = 20260422120000;
const WORKFLOW_AGENT_SESSION_STATE_MIGRATION_VERSION: i64 = 20260423100000;

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
                                                            'skipped', 'cancelled'
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

async fn run_migrations(pool: &Pool<Sqlite>) -> Result<(), Error> {
    use std::collections::HashSet;

    let migrator = sqlx::migrate!("./migrations");
    apply_workflow_execution_status_migration_shim(pool, &migrator).await?;
    apply_workflow_agent_session_state_migration_shim(pool, &migrator).await?;
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
    use sqlx::{Row, SqlitePool};
    use uuid::Uuid;

    use super::run_migrations;
    use crate::models::{
        chat_agent::{ChatAgent, CreateChatAgent},
        chat_session::{ChatSession, CreateChatSession},
        chat_session_agent::{ChatSessionAgent, ChatSessionAgentState, CreateChatSessionAgent},
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
