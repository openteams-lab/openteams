use std::collections::HashSet;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool, types::Json};
use uuid::Uuid;

const MIGRATION_PROJECT_ID: &str = "11111111-1111-4111-8111-111111111111";
const MIGRATION_PROJECT_NAME: &str = "旧版本会话";
const MIGRATION_PROJECT_MARKER: &str = "__migrate__:legacy_chat_sessions";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ProjectMigrationReport {
    pub project_id: Option<Uuid>,
    pub created_project: bool,
    pub legacy_session_count: i64,
    pub updated_session_count: u64,
    pub inserted_human_members: u64,
    pub inserted_agent_members: u64,
    pub inserted_paths: u64,
    pub default_workspace_path: Option<String>,
}

#[derive(Clone, Default)]
pub struct ProjectMigrationService;

#[derive(Debug, Clone)]
struct LegacySession {
    id: Uuid,
    default_workspace_path: Option<String>,
}

#[derive(Debug, Clone)]
struct LegacySessionAgent {
    agent_id: Uuid,
    workspace_path: Option<String>,
    allowed_skill_ids: Vec<String>,
}

impl ProjectMigrationService {
    pub fn new() -> Self {
        Self
    }

    pub async fn has_legacy_sessions(pool: &SqlitePool) -> Result<bool> {
        let count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM chat_sessions
            WHERE project_id IS NULL
            "#,
        )
        .fetch_one(pool)
        .await?;

        Ok(count > 0)
    }

    pub async fn migrate_legacy_sessions(
        &self,
        pool: &SqlitePool,
        user_id: &str,
    ) -> Result<ProjectMigrationReport> {
        let mut tx = pool.begin().await?;

        let legacy_session_count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM chat_sessions
            WHERE project_id IS NULL
            "#,
        )
        .fetch_one(&mut *tx)
        .await?;

        if legacy_session_count == 0 {
            tx.commit().await?;
            tracing::info!("No legacy chat sessions require project migration");
            return Ok(ProjectMigrationReport::default());
        }

        let first_session = first_legacy_session(&mut tx).await?;
        let Some(first_session) = first_session else {
            tx.commit().await?;
            return Ok(ProjectMigrationReport::default());
        };

        tracing::info!(
            legacy_session_count,
            first_session_id = %first_session.id,
            "Starting legacy chat session project migration"
        );

        let (project_id, created_project) = ensure_migration_project(&mut tx).await?;
        let first_session_agents = legacy_session_agents(&mut tx, first_session.id).await?;
        let mut report = ProjectMigrationReport {
            project_id: Some(project_id),
            created_project,
            legacy_session_count,
            ..ProjectMigrationReport::default()
        };

        report.inserted_human_members = ensure_human_member(&mut tx, project_id, user_id).await?;
        report.inserted_agent_members = ensure_agent_members(
            &mut tx,
            project_id,
            first_session.default_workspace_path.clone(),
            &first_session_agents,
        )
        .await?;

        let paths = collect_project_paths(&mut tx, &first_session, &first_session_agents).await?;
        let default_workspace_path = paths.first().cloned();
        report.inserted_paths = ensure_project_paths(
            &mut tx,
            project_id,
            &paths,
            default_workspace_path.as_deref(),
        )
        .await?;
        let selected_default_path = existing_default_project_path(&mut tx, project_id)
            .await?
            .or(default_workspace_path);
        set_project_default_workspace_path(&mut tx, project_id, selected_default_path.as_deref())
            .await?;
        report.default_workspace_path = selected_default_path;

        let update_result = sqlx::query(
            r#"
            UPDATE chat_sessions
            SET project_id = ?1
            WHERE project_id IS NULL
            "#,
        )
        .bind(project_id)
        .execute(&mut *tx)
        .await?;
        report.updated_session_count = update_result.rows_affected();

        tx.commit().await?;

        tracing::info!(
            project_id = %project_id,
            created_project,
            legacy_session_count,
            updated_session_count = report.updated_session_count,
            inserted_human_members = report.inserted_human_members,
            inserted_agent_members = report.inserted_agent_members,
            inserted_paths = report.inserted_paths,
            default_workspace_path = ?report.default_workspace_path,
            "Completed legacy chat session project migration"
        );

        Ok(report)
    }
}

async fn first_legacy_session(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<Option<LegacySession>> {
    let row = sqlx::query(
        r#"
        SELECT id, default_workspace_path
        FROM chat_sessions
        WHERE project_id IS NULL
        ORDER BY created_at ASC
        LIMIT 1
        "#,
    )
    .fetch_optional(&mut **tx)
    .await?;

    row.map(|row| {
        Ok(LegacySession {
            id: row.try_get("id")?,
            default_workspace_path: row.try_get("default_workspace_path")?,
        })
    })
    .transpose()
}

async fn ensure_migration_project(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<(Uuid, bool)> {
    let migration_project_id = Uuid::parse_str(MIGRATION_PROJECT_ID)?;

    if let Some(row) = sqlx::query(
        r#"
        SELECT id
        FROM projects
        WHERE id = ?1 OR description = ?2
        LIMIT 1
        "#,
    )
    .bind(migration_project_id)
    .bind(MIGRATION_PROJECT_MARKER)
    .fetch_optional(&mut **tx)
    .await?
    {
        let project_id = row.try_get("id")?;
        tracing::debug!(project_id = %project_id, "Migration project already exists");
        return Ok((project_id, false));
    }

    let insert_result = sqlx::query(
        r#"
        INSERT OR IGNORE INTO projects (
            id,
            name,
            description,
            status,
            default_workspace_path
        )
        VALUES (?1, ?2, ?3, 'system', NULL)
        "#,
    )
    .bind(migration_project_id)
    .bind(MIGRATION_PROJECT_NAME)
    .bind(MIGRATION_PROJECT_MARKER)
    .execute(&mut **tx)
    .await?;

    let created = insert_result.rows_affected() == 1;
    if created {
        tracing::info!(project_id = %migration_project_id, "Created migration project");
    } else {
        tracing::debug!(project_id = %migration_project_id, "Migration project was created by another worker");
    }

    Ok((migration_project_id, created))
}

async fn legacy_session_agents(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    session_id: Uuid,
) -> Result<Vec<LegacySessionAgent>> {
    let rows = sqlx::query(
        r#"
        SELECT agent_id,
               workspace_path,
               COALESCE(allowed_skill_ids, '[]') AS allowed_skill_ids
        FROM chat_session_agents
        WHERE session_id = ?1
        ORDER BY created_at ASC
        "#,
    )
    .bind(session_id)
    .fetch_all(&mut **tx)
    .await?;

    rows.into_iter()
        .map(|row| {
            let allowed_skill_ids: Json<Vec<String>> = row.try_get("allowed_skill_ids")?;
            Ok(LegacySessionAgent {
                agent_id: row.try_get("agent_id")?,
                workspace_path: row.try_get("workspace_path")?,
                allowed_skill_ids: allowed_skill_ids.0,
            })
        })
        .collect()
}

async fn ensure_human_member(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    project_id: Uuid,
    user_id: &str,
) -> Result<u64> {
    let existing_id: Option<Uuid> = sqlx::query_scalar(
        r#"
        SELECT id
        FROM project_members
        WHERE project_id = ?1
          AND member_type = 'human'
        LIMIT 1
        "#,
    )
    .bind(project_id)
    .fetch_optional(&mut **tx)
    .await?;

    if existing_id.is_some() {
        tracing::debug!(project_id = %project_id, "Migration project human member already exists");
        return Ok(0);
    }

    sqlx::query(
        r#"
        INSERT INTO project_members (
            id,
            project_id,
            member_type,
            user_id,
            role,
            display_order,
            allowed_skill_ids,
            is_default
        )
        VALUES (?1, ?2, 'human', ?3, 'owner', 0, '[]', 1)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(project_id)
    .bind(user_id)
    .execute(&mut **tx)
    .await?;

    tracing::info!(project_id = %project_id, user_id, "Created migration project human member");
    Ok(1)
}

async fn ensure_agent_members(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    project_id: Uuid,
    session_default_workspace_path: Option<String>,
    agents: &[LegacySessionAgent],
) -> Result<u64> {
    let mut inserted = 0;

    for (index, agent) in agents.iter().enumerate() {
        let existing_id: Option<Uuid> = sqlx::query_scalar(
            r#"
            SELECT id
            FROM project_members
            WHERE project_id = ?1
              AND member_type = 'agent'
              AND agent_id = ?2
            LIMIT 1
            "#,
        )
        .bind(project_id)
        .bind(agent.agent_id)
        .fetch_optional(&mut **tx)
        .await?;

        if existing_id.is_some() {
            continue;
        }

        let default_workspace_path = agent
            .workspace_path
            .clone()
            .or_else(|| session_default_workspace_path.clone());

        sqlx::query(
            r#"
            INSERT INTO project_members (
                id,
                project_id,
                member_type,
                agent_id,
                role,
                display_order,
                default_workspace_path,
                allowed_skill_ids,
                is_default
            )
            VALUES (?1, ?2, 'agent', ?3, 'agent', ?4, ?5, ?6, 1)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(project_id)
        .bind(agent.agent_id)
        .bind((index + 1) as i64)
        .bind(default_workspace_path)
        .bind(Json(agent.allowed_skill_ids.clone()))
        .execute(&mut **tx)
        .await?;

        inserted += 1;
    }

    tracing::info!(
        project_id = %project_id,
        inserted_agent_members = inserted,
        "Initialized migration project agent members"
    );
    Ok(inserted)
}

async fn collect_project_paths(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    first_session: &LegacySession,
    agents: &[LegacySessionAgent],
) -> Result<Vec<String>> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    push_path(
        &mut paths,
        &mut seen,
        first_session.default_workspace_path.as_deref(),
    );

    for agent in agents {
        push_path(&mut paths, &mut seen, agent.workspace_path.as_deref());
    }

    let run_rows = sqlx::query(
        r#"
        SELECT workspace_path
        FROM chat_runs
        WHERE session_id = ?1
          AND workspace_path IS NOT NULL
        ORDER BY created_at ASC
        "#,
    )
    .bind(first_session.id)
    .fetch_all(&mut **tx)
    .await?;

    for row in run_rows {
        let workspace_path: Option<String> = row.try_get("workspace_path")?;
        push_path(&mut paths, &mut seen, workspace_path.as_deref());
    }

    Ok(paths)
}

fn push_path(paths: &mut Vec<String>, seen: &mut HashSet<String>, path: Option<&str>) {
    let Some(path) = path.map(str::trim).filter(|path| !path.is_empty()) else {
        return;
    };

    if seen.insert(path.to_string()) {
        paths.push(path.to_string());
    }
}

async fn ensure_project_paths(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    project_id: Uuid,
    paths: &[String],
    default_path: Option<&str>,
) -> Result<u64> {
    let mut inserted = 0;
    let mut has_default = existing_default_project_path(tx, project_id)
        .await?
        .is_some();

    for path in paths {
        let existing_id: Option<Uuid> = sqlx::query_scalar(
            r#"
            SELECT id
            FROM project_paths
            WHERE project_id = ?1
              AND kind = 'workspace'
              AND path = ?2
            LIMIT 1
            "#,
        )
        .bind(project_id)
        .bind(path)
        .fetch_optional(&mut **tx)
        .await?;

        let is_default = !has_default && default_path == Some(path.as_str());

        if existing_id.is_some() {
            if is_default {
                mark_project_path_default(tx, project_id, path).await?;
                has_default = true;
            }
            continue;
        }

        sqlx::query(
            r#"
            INSERT INTO project_paths (
                id,
                project_id,
                path,
                kind,
                is_default
            )
            VALUES (?1, ?2, ?3, 'workspace', ?4)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(project_id)
        .bind(path)
        .bind(is_default)
        .execute(&mut **tx)
        .await?;

        if is_default {
            has_default = true;
        }
        inserted += 1;
    }

    tracing::info!(
        project_id = %project_id,
        inserted_paths = inserted,
        "Initialized migration project paths"
    );
    Ok(inserted)
}

async fn existing_default_project_path(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    project_id: Uuid,
) -> Result<Option<String>> {
    let path = sqlx::query_scalar(
        r#"
        SELECT path
        FROM project_paths
        WHERE project_id = ?1
          AND kind = 'workspace'
          AND is_default = 1
        ORDER BY created_at ASC
        LIMIT 1
        "#,
    )
    .bind(project_id)
    .fetch_optional(&mut **tx)
    .await?;

    Ok(path)
}

async fn mark_project_path_default(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    project_id: Uuid,
    path: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE project_paths
        SET is_default = CASE WHEN path = ?2 THEN 1 ELSE 0 END,
            updated_at = datetime('now', 'subsec')
        WHERE project_id = ?1
          AND kind = 'workspace'
        "#,
    )
    .bind(project_id)
    .bind(path)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn set_project_default_workspace_path(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    project_id: Uuid,
    default_workspace_path: Option<&str>,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE projects
        SET default_workspace_path = ?2,
            updated_at = datetime('now', 'subsec')
        WHERE id = ?1
        "#,
    )
    .bind(project_id)
    .bind(default_workspace_path)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::{Row, SqlitePool};
    use uuid::Uuid;

    use super::{MIGRATION_PROJECT_MARKER, MIGRATION_PROJECT_NAME, ProjectMigrationService};

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");

        for statement in [
            "PRAGMA foreign_keys = ON",
            r#"
            CREATE TABLE projects (
                id BLOB PRIMARY KEY,
                name TEXT NOT NULL,
                default_agent_working_dir TEXT DEFAULT '',
                remote_project_id BLOB,
                description TEXT,
                status TEXT,
                default_workspace_path TEXT,
                active_repo_id BLOB,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE chat_agents (
                id BLOB PRIMARY KEY,
                name TEXT NOT NULL,
                runner_type TEXT NOT NULL,
                system_prompt TEXT NOT NULL DEFAULT '',
                tools_enabled TEXT NOT NULL DEFAULT '{}',
                model_name TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE chat_sessions (
                id BLOB PRIMARY KEY,
                title TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                lead_agent_id BLOB,
                lead_session_agent_id BLOB,
                summary_text TEXT,
                archive_ref TEXT,
                last_seen_diff_key TEXT,
                default_workspace_path TEXT,
                chat_input_mode TEXT,
                project_id BLOB,
                worktree_mode TEXT NOT NULL DEFAULT 'inherit'
                    CHECK (worktree_mode IN ('inherit', 'disabled', 'isolated')),
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                archived_at TEXT
            )
            "#,
            r#"
            CREATE TABLE chat_session_agents (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                agent_id BLOB NOT NULL,
                state TEXT NOT NULL DEFAULT 'idle',
                workspace_path TEXT,
                pty_session_key TEXT,
                agent_session_id TEXT,
                agent_message_id TEXT,
                project_member_id BLOB,
                member_name TEXT NOT NULL DEFAULT '',
                execution_config TEXT NOT NULL DEFAULT '{}',
                allowed_skill_ids TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE chat_runs (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                session_agent_id BLOB,
                workspace_path TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE project_members (
                id BLOB PRIMARY KEY,
                project_id BLOB,
                member_type TEXT CHECK (member_type IN ('human', 'agent')),
                user_id TEXT,
                agent_id BLOB,
                member_name TEXT,
                role TEXT,
                display_order INTEGER DEFAULT 0,
                default_workspace_path TEXT,
                allowed_skill_ids TEXT,
                execution_config TEXT NOT NULL DEFAULT '{}',
                is_default BOOLEAN DEFAULT false,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE project_paths (
                id BLOB PRIMARY KEY,
                project_id BLOB,
                path TEXT NOT NULL,
                label TEXT,
                kind TEXT CHECK (kind IN ('workspace', 'artifact', 'external')),
                is_default BOOLEAN DEFAULT false,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create migration test schema");
        }

        pool
    }

    async fn insert_legacy_fixture(pool: &SqlitePool) -> (Uuid, Uuid, Uuid) {
        let agent_id = Uuid::new_v4();
        let first_session_id = Uuid::new_v4();
        let second_session_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();

        sqlx::query(
            r#"
            INSERT INTO chat_agents (id, name, runner_type)
            VALUES (?1, 'Codex', 'codex')
            "#,
        )
        .bind(agent_id)
        .execute(pool)
        .await
        .expect("insert chat agent");

        sqlx::query(
            r#"
            INSERT INTO chat_sessions (
                id,
                title,
                default_workspace_path,
                created_at
            )
            VALUES
                (?1, 'older', '/legacy/root', '2026-01-01T00:00:00Z'),
                (?2, 'newer', '/ignored', '2026-01-02T00:00:00Z')
            "#,
        )
        .bind(first_session_id)
        .bind(second_session_id)
        .execute(pool)
        .await
        .expect("insert chat sessions");

        sqlx::query(
            r#"
            INSERT INTO chat_session_agents (
                id,
                session_id,
                agent_id,
                workspace_path,
                allowed_skill_ids,
                created_at
            )
            VALUES (?1, ?2, ?3, '/legacy/agent', '["shell"]', '2026-01-01T00:00:01Z')
            "#,
        )
        .bind(session_agent_id)
        .bind(first_session_id)
        .bind(agent_id)
        .execute(pool)
        .await
        .expect("insert session agent");

        sqlx::query(
            r#"
            INSERT INTO chat_runs (
                id,
                session_id,
                session_agent_id,
                workspace_path,
                created_at
            )
            VALUES (?1, ?2, ?3, '/legacy/run', '2026-01-01T00:00:02Z')
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(first_session_id)
        .bind(session_agent_id)
        .execute(pool)
        .await
        .expect("insert chat run");

        (agent_id, first_session_id, second_session_id)
    }

    #[tokio::test]
    async fn migrates_legacy_sessions_into_idempotent_project() {
        let pool = setup_pool().await;
        let (agent_id, first_session_id, second_session_id) = insert_legacy_fixture(&pool).await;

        let report = ProjectMigrationService::new()
            .migrate_legacy_sessions(&pool, "user-1")
            .await
            .expect("migrate legacy sessions");

        assert!(report.created_project);
        assert_eq!(report.legacy_session_count, 2);
        assert_eq!(report.updated_session_count, 2);
        assert_eq!(report.inserted_human_members, 1);
        assert_eq!(report.inserted_agent_members, 1);
        assert_eq!(report.inserted_paths, 3);
        assert_eq!(
            report.default_workspace_path.as_deref(),
            Some("/legacy/root")
        );

        let project_id = report.project_id.expect("migration project id");
        let project = sqlx::query(
            r#"
            SELECT name, description
            FROM projects
            WHERE id = ?1
            "#,
        )
        .bind(project_id)
        .fetch_one(&pool)
        .await
        .expect("read migration project");
        let project_name: String = project.try_get("name").expect("project name");
        let project_description: String =
            project.try_get("description").expect("project description");
        assert_eq!(project_name, MIGRATION_PROJECT_NAME);
        assert_eq!(project_description, MIGRATION_PROJECT_MARKER);

        for session_id in [first_session_id, second_session_id] {
            let session_project_id: Uuid =
                sqlx::query_scalar("SELECT project_id FROM chat_sessions WHERE id = ?1")
                    .bind(session_id)
                    .fetch_one(&pool)
                    .await
                    .expect("read session project id");
            assert_eq!(session_project_id, project_id);
        }

        let member = sqlx::query(
            r#"
            SELECT default_workspace_path, allowed_skill_ids
            FROM project_members
            WHERE project_id = ?1
              AND member_type = 'agent'
              AND agent_id = ?2
            "#,
        )
        .bind(project_id)
        .bind(agent_id)
        .fetch_one(&pool)
        .await
        .expect("read agent member");
        let member_workspace_path: String = member
            .try_get("default_workspace_path")
            .expect("member workspace path");
        let allowed_skill_ids: String = member.try_get("allowed_skill_ids").expect("skill ids");
        assert_eq!(member_workspace_path, "/legacy/agent");
        assert_eq!(allowed_skill_ids, r#"["shell"]"#);

        let default_path: String = sqlx::query_scalar(
            r#"
            SELECT path
            FROM project_paths
            WHERE project_id = ?1
              AND is_default = 1
            "#,
        )
        .bind(project_id)
        .fetch_one(&pool)
        .await
        .expect("read default path");
        assert_eq!(default_path, "/legacy/root");
    }

    #[tokio::test]
    async fn migration_is_idempotent() {
        let pool = setup_pool().await;
        insert_legacy_fixture(&pool).await;

        let first_report = ProjectMigrationService::new()
            .migrate_legacy_sessions(&pool, "user-1")
            .await
            .expect("first migration");
        let second_report = ProjectMigrationService::new()
            .migrate_legacy_sessions(&pool, "user-1")
            .await
            .expect("second migration");

        assert_eq!(first_report.updated_session_count, 2);
        assert_eq!(second_report.updated_session_count, 0);
        assert_eq!(second_report.project_id, None);

        let project_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects")
            .fetch_one(&pool)
            .await
            .expect("project count");
        let member_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM project_members")
            .fetch_one(&pool)
            .await
            .expect("member count");
        let path_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM project_paths")
            .fetch_one(&pool)
            .await
            .expect("path count");

        assert_eq!(project_count, 1);
        assert_eq!(member_count, 2);
        assert_eq!(path_count, 3);
    }

    #[tokio::test]
    async fn skips_empty_paths_and_uses_agent_workspace_as_default_when_needed() {
        let pool = setup_pool().await;
        let agent_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();

        sqlx::query(
            "INSERT INTO chat_agents (id, name, runner_type) VALUES (?1, 'Codex', 'codex')",
        )
        .bind(agent_id)
        .execute(&pool)
        .await
        .expect("insert chat agent");
        sqlx::query(
            r#"
            INSERT INTO chat_sessions (id, title, default_workspace_path, created_at)
            VALUES (?1, 'legacy', '   ', '2026-01-01T00:00:00Z')
            "#,
        )
        .bind(session_id)
        .execute(&pool)
        .await
        .expect("insert legacy session");
        sqlx::query(
            r#"
            INSERT INTO chat_session_agents (
                id,
                session_id,
                agent_id,
                workspace_path,
                allowed_skill_ids,
                created_at
            )
            VALUES (?1, ?2, ?3, '/agent/workspace', '[]', '2026-01-01T00:00:01Z')
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(session_id)
        .bind(agent_id)
        .execute(&pool)
        .await
        .expect("insert session agent");

        let report = ProjectMigrationService::new()
            .migrate_legacy_sessions(&pool, "user-1")
            .await
            .expect("migrate legacy sessions");

        assert_eq!(
            report.default_workspace_path.as_deref(),
            Some("/agent/workspace")
        );
        assert_eq!(report.inserted_paths, 1);
    }

    #[tokio::test]
    async fn migration_exits_cleanly_when_no_legacy_sessions_exist() {
        let pool = setup_pool().await;

        let report = ProjectMigrationService::new()
            .migrate_legacy_sessions(&pool, "user-1")
            .await
            .expect("run empty migration");

        assert_eq!(report, Default::default());
        let project_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects")
            .fetch_one(&pool)
            .await
            .expect("count projects");
        let member_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM project_members")
            .fetch_one(&pool)
            .await
            .expect("count project members");
        let path_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM project_paths")
            .fetch_one(&pool)
            .await
            .expect("count project paths");

        assert_eq!(project_count, 0);
        assert_eq!(member_count, 0);
        assert_eq!(path_count, 0);
    }
}
