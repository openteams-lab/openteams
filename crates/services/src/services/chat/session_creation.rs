pub async fn create_session_with_project_members(
    pool: &SqlitePool,
    payload: &db::models::chat_session::CreateChatSession,
    id: Uuid,
) -> Result<ChatSession, sqlx::Error> {
    let Some(project_id) = payload.project_id else {
        return ChatSession::create(pool, payload, id).await;
    };

    let mut tx = pool.begin().await?;

    let session = sqlx::query_as::<_, ChatSession>(
        r#"
        INSERT INTO chat_sessions (id, title, status, default_workspace_path, project_id)
        VALUES (?1, ?2, ?3, ?4, ?5)
        RETURNING id,
                  title,
                  status,
                  lead_agent_id,
                  summary_text,
                  archive_ref,
                  last_seen_diff_key,
                  team_protocol,
                  team_protocol_enabled,
                  default_workspace_path,
                  chat_input_mode,
                  project_id,
                  created_at,
                  updated_at,
                  archived_at
        "#,
    )
    .bind(id)
    .bind(payload.title.clone())
    .bind(ChatSessionStatus::Active)
    .bind(payload.workspace_path.clone())
    .bind(project_id)
    .fetch_one(&mut *tx)
    .await?;

    let default_members = sqlx::query(
        r#"
        SELECT id AS project_member_id,
               agent_id,
               default_workspace_path,
               COALESCE(allowed_skill_ids, '[]') AS allowed_skill_ids,
               COALESCE(execution_config, '{}') AS execution_config
        FROM project_members
        WHERE project_id = ?1
          AND member_type = 'agent'
          AND is_default = 1
          AND agent_id IS NOT NULL
        ORDER BY display_order ASC, created_at ASC
        "#,
    )
    .bind(project_id)
    .fetch_all(&mut *tx)
    .await?;

    for member in default_members {
        let project_member_id: Uuid = member.try_get("project_member_id")?;
        let agent_id: Uuid = member.try_get("agent_id")?;
        let workspace_path: Option<String> = member.try_get("default_workspace_path")?;
        let allowed_skill_ids: sqlx::types::Json<Vec<String>> =
            member.try_get("allowed_skill_ids")?;
        let execution_config: sqlx::types::Json<db::models::member_execution_config::MemberExecutionConfig> =
            member.try_get("execution_config")?;

        sqlx::query(
            r#"
            INSERT INTO chat_session_agents (
                id,
                session_id,
                agent_id,
                workspace_path,
                allowed_skill_ids,
                project_member_id,
                execution_config,
                state
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'idle')
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(session.id)
        .bind(agent_id)
        .bind(workspace_path)
        .bind(allowed_skill_ids)
        .bind(project_member_id)
        .bind(execution_config)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(session)
}

#[cfg(test)]
mod session_creation_tests {
    use db::models::{
        chat_session::CreateChatSession,
        chat_session_agent::ChatSessionAgent,
    };
    use sqlx::{Row, SqlitePool};
    use uuid::Uuid;

    use super::create_session_with_project_members;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");

        for statement in [
            r#"
            CREATE TABLE chat_sessions (
                id BLOB PRIMARY KEY,
                title TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                lead_agent_id BLOB,
                summary_text TEXT,
                archive_ref TEXT,
                last_seen_diff_key TEXT,
                team_protocol TEXT,
                team_protocol_enabled BOOLEAN NOT NULL DEFAULT 0,
                default_workspace_path TEXT,
                chat_input_mode TEXT,
                project_id BLOB,
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
                execution_config TEXT NOT NULL DEFAULT '{}',
                allowed_skill_ids TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
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
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create session creation test schema");
        }

        pool
    }

    async fn insert_project_member(
        pool: &SqlitePool,
        project_id: Uuid,
        agent_id: Uuid,
        is_default: bool,
        workspace_path: Option<&str>,
        allowed_skill_ids: &str,
        execution_config: &str,
    ) {
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
                execution_config,
                is_default
            )
            VALUES (?1, ?2, 'agent', ?3, 'agent', 0, ?4, ?5, ?6, ?7)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(project_id)
        .bind(agent_id)
        .bind(workspace_path)
        .bind(allowed_skill_ids)
        .bind(execution_config)
        .bind(is_default)
        .execute(pool)
        .await
        .expect("insert project member");
    }

    #[tokio::test]
    async fn project_session_snapshots_default_members_in_same_transaction() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let included_agent_id = Uuid::new_v4();
        insert_project_member(
            &pool,
            project_id,
            included_agent_id,
            true,
            Some("/agent/workspace"),
            r#"["shell"]"#,
            r#"{"runner_type":"CODEX","model_name":"gpt-5.2-codex","thinking_effort":"high"}"#,
        )
        .await;
        insert_project_member(
            &pool,
            project_id,
            Uuid::new_v4(),
            false,
            Some("/ignored"),
            r#"["ignored"]"#,
            r#"{}"#,
        )
        .await;
        insert_project_member(
            &pool,
            Uuid::new_v4(),
            Uuid::new_v4(),
            true,
            Some("/other"),
            r#"["other"]"#,
            r#"{}"#,
        )
        .await;

        let session = create_session_with_project_members(
            &pool,
            &CreateChatSession {
                title: Some("Project session".to_string()),
                workspace_path: Some("/session/workspace".to_string()),
                project_id: Some(project_id),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create project session");

        assert_eq!(session.project_id, Some(project_id));
        let session_agents = ChatSessionAgent::find_all_for_session(&pool, session.id)
            .await
            .expect("list session agents");
        assert_eq!(session_agents.len(), 1);
        assert_eq!(session_agents[0].agent_id, included_agent_id);
        assert_eq!(
            session_agents[0].workspace_path.as_deref(),
            Some("/agent/workspace")
        );
        assert_eq!(session_agents[0].allowed_skill_ids.0, vec!["shell"]);
        assert_eq!(session_agents[0].project_member_id.is_some(), true);
        assert_eq!(
            session_agents[0].execution_config.0.model_name.as_deref(),
            Some("gpt-5.2-codex")
        );
        assert_eq!(
            session_agents[0].execution_config.0.thinking_effort.as_deref(),
            Some("high")
        );

        let project_member_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM project_members WHERE project_id = ?1")
                .bind(project_id)
                .fetch_one(&pool)
                .await
                .expect("count project members");
        assert_eq!(project_member_count, 2);
    }

    #[tokio::test]
    async fn project_session_rolls_back_when_member_snapshot_fails() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        insert_project_member(
            &pool,
            project_id,
            Uuid::new_v4(),
            true,
            Some("/agent/workspace"),
            "not-json",
            r#"{}"#,
        )
        .await;

        let result = create_session_with_project_members(
            &pool,
            &CreateChatSession {
                title: Some("Broken project session".to_string()),
                workspace_path: None,
                project_id: Some(project_id),
            },
            session_id,
        )
        .await;
        assert!(result.is_err());

        let session_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM chat_sessions")
            .fetch_one(&pool)
            .await
            .expect("count sessions");
        let session_agent_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM chat_session_agents")
                .fetch_one(&pool)
                .await
                .expect("count session agents");
        assert_eq!(session_count, 0);
        assert_eq!(session_agent_count, 0);
    }

    #[tokio::test]
    async fn temporary_session_creation_does_not_write_project_members() {
        let pool = setup_pool().await;

        let session = create_session_with_project_members(
            &pool,
            &CreateChatSession {
                title: Some("Temporary session".to_string()),
                workspace_path: Some("/tmp/workspace".to_string()),
                project_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create temporary session");

        assert_eq!(session.project_id, None);
        let project_member_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM project_members")
            .fetch_one(&pool)
            .await
            .expect("count project members");
        assert_eq!(project_member_count, 0);

        let row = sqlx::query("SELECT default_workspace_path FROM chat_sessions WHERE id = ?1")
            .bind(session.id)
            .fetch_one(&pool)
            .await
            .expect("read temporary session");
        let default_workspace_path: String = row
            .try_get("default_workspace_path")
            .expect("default workspace path");
        assert_eq!(default_workspace_path, "/tmp/workspace");
    }
}
