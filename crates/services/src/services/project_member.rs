use anyhow::{Result, bail};
use db::models::{
    chat_agent::ChatAgent,
    chat_session::ChatSession,
    chat_session_agent::{ChatSessionAgent, CreateChatSessionAgent},
    member_execution_config::MemberExecutionConfig,
    project_member::{ProjectMember, ProjectMemberType, UpdateProjectMember},
    workflow_agent_session::WorkflowAgentSession,
};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

#[derive(Clone, Default)]
pub struct ProjectMemberService;

pub struct ProjectMemberUpdateInput {
    pub member_name: Option<Option<String>>,
    pub role: Option<String>,
    pub display_order: Option<i64>,
    pub default_workspace_path: Option<String>,
    pub is_default: Option<bool>,
    pub allowed_skill_ids: Option<Vec<String>>,
    pub execution_config: Option<MemberExecutionConfig>,
}

impl ProjectMemberService {
    pub fn new() -> Self {
        Self
    }

    pub async fn list_members(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<ProjectMember>> {
        Ok(ProjectMember::find_by_project(pool, project_id).await?)
    }

    pub async fn get_human_member(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Option<ProjectMember>> {
        Ok(ProjectMember::find_human_member(pool, project_id).await?)
    }

    pub async fn list_default_agents(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<ProjectMember>> {
        Ok(ProjectMember::find_default_agents(pool, project_id).await?)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn add_member(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        member_type: ProjectMemberType,
        user_id: Option<String>,
        agent_id: Option<Uuid>,
        member_name: Option<String>,
        role: Option<String>,
        display_order: i64,
        default_workspace_path: Option<String>,
        allowed_skill_ids: Vec<String>,
        is_default: bool,
        execution_config: MemberExecutionConfig,
    ) -> Result<ProjectMember> {
        if member_type == ProjectMemberType::Agent {
            let Some(agent_id) = agent_id else {
                bail!("agent_id is required for agent project members");
            };
            if ChatAgent::find_by_id(pool, agent_id).await?.is_none() {
                bail!("chat agent not found");
            }
        }

        let member = ProjectMember::create(
            pool,
            project_id,
            member_type,
            user_id,
            agent_id,
            member_name,
            role,
            display_order,
            default_workspace_path,
            allowed_skill_ids,
            execution_config,
            is_default,
        )
        .await?;

        let created_session_agents = self
            .add_default_member_to_existing_project_sessions(pool, &member)
            .await?;
        if created_session_agents > 0 {
            tracing::info!(
                project_member_id = %member.id,
                created_session_agents,
                "Added project member to existing project sessions"
            );
        }

        Ok(member)
    }

    async fn add_default_member_to_existing_project_sessions(
        &self,
        pool: &SqlitePool,
        member: &ProjectMember,
    ) -> Result<u64> {
        if member.member_type != ProjectMemberType::Agent || !member.is_default {
            return Ok(0);
        }
        let Some(agent_id) = member.agent_id else {
            return Ok(0);
        };

        let mut created = 0;
        for session in ChatSession::find_by_project(pool, member.project_id).await? {
            if ChatSessionAgent::find_by_session_and_agent(pool, session.id, agent_id)
                .await?
                .is_some()
            {
                continue;
            }

            ChatSessionAgent::create(
                pool,
                &CreateChatSessionAgent {
                    session_id: session.id,
                    agent_id,
                    workspace_path: member.default_workspace_path.clone(),
                    allowed_skill_ids: member.allowed_skill_ids.0.clone(),
                    project_member_id: Some(member.id),
                    execution_config: member.execution_config.0.clone(),
                },
                Uuid::new_v4(),
            )
            .await?;
            created += 1;
        }

        Ok(created)
    }

    pub async fn update_member(
        &self,
        pool: &SqlitePool,
        id: Uuid,
        input: ProjectMemberUpdateInput,
    ) -> Result<ProjectMember> {
        let promote_to_lead = input.role.as_deref() == Some("lead");
        let should_sync_execution_config = input.execution_config.is_some();
        let should_sync_allowed_skill_ids = input.allowed_skill_ids.is_some();
        let mut member = ProjectMember::update(
            pool,
            id,
            &UpdateProjectMember {
                member_type: None,
                user_id: None,
                agent_id: None,
                member_name: input.member_name,
                role: input.role,
                display_order: input.display_order,
                default_workspace_path: input.default_workspace_path,
                allowed_skill_ids: input.allowed_skill_ids,
                execution_config: input.execution_config,
                is_default: input.is_default,
            },
        )
        .await?;

        if promote_to_lead && member.member_type == ProjectMemberType::Agent {
            member = ProjectMember::set_only_project_lead(pool, member.id, "member").await?;
        }

        if should_sync_execution_config {
            let synced = ChatSessionAgent::sync_execution_config_for_project_member(
                pool,
                member.id,
                member.execution_config.0.clone(),
            )
            .await?;
            let synced_unlinked = if let Some(agent_id) = member.agent_id {
                ChatSessionAgent::sync_execution_config_for_unlinked_project_agent(
                    pool,
                    member.project_id,
                    agent_id,
                    member.id,
                    member.execution_config.0.clone(),
                )
                .await?
            } else {
                0
            };
            let cleared_workflow_sessions =
                WorkflowAgentSession::clear_runtime_ids_for_project_member(pool, member.id).await?;
            tracing::info!(
                project_member_id = %member.id,
                synced_session_agents = synced,
                synced_unlinked_session_agents = synced_unlinked,
                cleared_workflow_agent_sessions = cleared_workflow_sessions,
                "Synced member execution config to inactive session agents"
            );
        }

        if should_sync_allowed_skill_ids {
            let synced = ChatSessionAgent::sync_allowed_skill_ids_for_project_member(
                pool,
                member.id,
                member.allowed_skill_ids.0.clone(),
            )
            .await?;
            let synced_unlinked = if let Some(agent_id) = member.agent_id {
                ChatSessionAgent::sync_allowed_skill_ids_for_unlinked_project_agent(
                    pool,
                    member.project_id,
                    agent_id,
                    member.id,
                    member.allowed_skill_ids.0.clone(),
                )
                .await?
            } else {
                0
            };
            tracing::info!(
                project_member_id = %member.id,
                synced_session_agents = synced,
                synced_unlinked_session_agents = synced_unlinked,
                "Synced member allowed skills to session agents"
            );
        }

        Ok(member)
    }

    pub async fn remove_member(&self, pool: &SqlitePool, id: Uuid) -> Result<u64> {
        Ok(ProjectMember::delete(pool, id).await?)
    }

    pub async fn initialize_default_members(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        user_id: &str,
    ) -> Result<Vec<ProjectMember>> {
        let mut members = Vec::new();

        if ProjectMember::find_human_member(pool, project_id)
            .await?
            .is_none()
        {
            members.push(
                ProjectMember::create(
                    pool,
                    project_id,
                    ProjectMemberType::Human,
                    Some(user_id.to_string()),
                    None,
                    None,
                    Some("owner".to_string()),
                    0,
                    None,
                    Vec::new(),
                    MemberExecutionConfig::default(),
                    true,
                )
                .await?,
            );
        }

        let existing_agent_ids: Vec<Uuid> = ProjectMember::find_by_project(pool, project_id)
            .await?
            .into_iter()
            .filter_map(|member| {
                if member.member_type == ProjectMemberType::Agent {
                    member.agent_id
                } else {
                    None
                }
            })
            .collect();

        let rows = default_chat_agent_rows(pool).await?;

        for (index, row) in rows.into_iter().enumerate() {
            let agent_id: Uuid = row.try_get("id")?;
            if existing_agent_ids.contains(&agent_id) {
                continue;
            }

            members.push(
                ProjectMember::create(
                    pool,
                    project_id,
                    ProjectMemberType::Agent,
                    None,
                    Some(agent_id),
                    None,
                    Some("agent".to_string()),
                    (index + 1) as i64,
                    None,
                    Vec::new(),
                    MemberExecutionConfig::default(),
                    true,
                )
                .await?,
            );
        }

        Ok(members)
    }
}

async fn default_chat_agent_rows(pool: &SqlitePool) -> Result<Vec<sqlx::sqlite::SqliteRow>> {
    if chat_agents_has_is_default(pool).await? {
        return Ok(sqlx::query(
            r#"
            SELECT id
            FROM chat_agents
            WHERE is_default = 1
            ORDER BY name ASC
            "#,
        )
        .fetch_all(pool)
        .await?);
    }

    Ok(sqlx::query(
        r#"
        SELECT id
        FROM chat_agents
        ORDER BY name ASC
        "#,
    )
    .fetch_all(pool)
    .await?)
}

async fn chat_agents_has_is_default(pool: &SqlitePool) -> Result<bool> {
    let rows = sqlx::query("PRAGMA table_info(chat_agents)")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .any(|name| name == "is_default"))
}

#[cfg(test)]
mod tests {
    use db::models::{
        chat_agent::{ChatAgent, CreateChatAgent},
        chat_session_agent::ChatSessionAgent,
        member_execution_config::MemberExecutionConfig,
        project_member::ProjectMemberType,
    };
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::ProjectMemberService;

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
                default_agent_working_dir TEXT,
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
                allowed_skill_ids TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE chat_workflow_agent_sessions (
                id BLOB PRIMARY KEY,
                workflow_execution_id BLOB NOT NULL,
                session_agent_id BLOB NOT NULL,
                role TEXT NOT NULL DEFAULT 'worker',
                agent_session_id TEXT,
                agent_message_id TEXT,
                state TEXT NOT NULL DEFAULT 'idle',
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create minimal project member schema");
        }

        pool
    }

    async fn create_agent(pool: &SqlitePool) -> ChatAgent {
        create_named_agent(pool, "coder").await
    }

    async fn create_named_agent(pool: &SqlitePool, name: &str) -> ChatAgent {
        ChatAgent::create(
            pool,
            &CreateChatAgent {
                name: name.to_string(),
                runner_type: "codex".to_string(),
                system_prompt: None,
                tools_enabled: None,
                model_name: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat agent")
    }

    #[tokio::test]
    async fn add_member_rejects_agent_member_without_agent_id() {
        let pool = setup_pool().await;
        let service = ProjectMemberService::new();

        let result = service
            .add_member(
                &pool,
                Uuid::new_v4(),
                ProjectMemberType::Agent,
                None,
                None,
                None,
                None,
                0,
                None,
                Vec::new(),
                true,
                MemberExecutionConfig::default(),
            )
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn add_member_rejects_missing_agent() {
        let pool = setup_pool().await;
        let service = ProjectMemberService::new();

        let result = service
            .add_member(
                &pool,
                Uuid::new_v4(),
                ProjectMemberType::Agent,
                None,
                Some(Uuid::new_v4()),
                None,
                None,
                0,
                None,
                Vec::new(),
                true,
                MemberExecutionConfig::default(),
            )
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn add_member_adds_default_agent_to_existing_project_sessions() {
        let pool = setup_pool().await;
        let service = ProjectMemberService::new();
        let project_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        let agent = create_agent(&pool).await;

        sqlx::query(
            r#"
            INSERT INTO chat_sessions (id, title, status, project_id)
            VALUES (?1, 'Existing session', 'active', ?2)
            "#,
        )
        .bind(session_id)
        .bind(project_id)
        .execute(&pool)
        .await
        .expect("insert project session");

        let member = service
            .add_member(
                &pool,
                project_id,
                ProjectMemberType::Agent,
                None,
                Some(agent.id),
                Some("Project Agent".to_string()),
                Some("member".to_string()),
                1,
                Some("/workspace/agent".to_string()),
                vec!["skill-a".to_string()],
                true,
                MemberExecutionConfig::default(),
            )
            .await
            .expect("add project member");

        let session_agent =
            ChatSessionAgent::find_by_session_and_agent(&pool, session_id, agent.id)
                .await
                .expect("find session agent")
                .expect("session agent exists");

        assert_eq!(session_agent.project_member_id, Some(member.id));
        assert_eq!(
            session_agent.workspace_path.as_deref(),
            Some("/workspace/agent")
        );
        assert_eq!(session_agent.allowed_skill_ids.0, vec!["skill-a"]);
    }

    #[tokio::test]
    async fn update_member_promoting_lead_demotes_other_project_agent_leads() {
        let pool = setup_pool().await;
        let service = ProjectMemberService::new();
        let project_id = Uuid::new_v4();
        let first_agent = create_named_agent(&pool, "first").await;
        let second_agent = create_named_agent(&pool, "second").await;
        let first_member = service
            .add_member(
                &pool,
                project_id,
                ProjectMemberType::Agent,
                None,
                Some(first_agent.id),
                None,
                Some("lead".to_string()),
                1,
                None,
                Vec::new(),
                true,
                MemberExecutionConfig::default(),
            )
            .await
            .expect("create first lead member");
        let second_member = service
            .add_member(
                &pool,
                project_id,
                ProjectMemberType::Agent,
                None,
                Some(second_agent.id),
                None,
                Some("member".to_string()),
                2,
                None,
                Vec::new(),
                true,
                MemberExecutionConfig::default(),
            )
            .await
            .expect("create second member");

        let promoted = service
            .update_member(
                &pool,
                second_member.id,
                super::ProjectMemberUpdateInput {
                    member_name: None,
                    role: Some("lead".to_string()),
                    display_order: None,
                    default_workspace_path: None,
                    is_default: None,
                    allowed_skill_ids: None,
                    execution_config: None,
                },
            )
            .await
            .expect("promote second member");

        let members = service
            .list_members(&pool, project_id)
            .await
            .expect("list members");
        let lead_members = members
            .iter()
            .filter(|member| member.role.as_deref() == Some("lead"))
            .collect::<Vec<_>>();
        let demoted_first = members
            .iter()
            .find(|member| member.id == first_member.id)
            .expect("first member still exists");

        assert_eq!(promoted.id, second_member.id);
        assert_eq!(promoted.role.as_deref(), Some("lead"));
        assert_eq!(lead_members.len(), 1);
        assert_eq!(lead_members[0].id, second_member.id);
        assert_eq!(demoted_first.role.as_deref(), Some("member"));
    }

    #[tokio::test]
    async fn update_member_syncs_runtime_fields_to_session_members() {
        let pool = setup_pool().await;
        let service = ProjectMemberService::new();
        let project_id = Uuid::new_v4();
        let agent = create_agent(&pool).await;
        let member = service
            .add_member(
                &pool,
                project_id,
                ProjectMemberType::Agent,
                None,
                Some(agent.id),
                None,
                Some("agent".to_string()),
                1,
                None,
                Vec::new(),
                true,
                MemberExecutionConfig::default(),
            )
            .await
            .expect("create member");

        let synced_session_agent_id = Uuid::new_v4();
        let running_session_agent_id = Uuid::new_v4();
        let resumed_session_agent_id = Uuid::new_v4();
        let dead_session_agent_id = Uuid::new_v4();
        let active_workflow_session_agent_id = Uuid::new_v4();
        let legacy_project_session_id = Uuid::new_v4();
        let other_project_session_id = Uuid::new_v4();
        let unlinked_project_session_agent_id = Uuid::new_v4();
        let unlinked_other_project_session_agent_id = Uuid::new_v4();
        for (id, state, agent_session_id) in [
            (synced_session_agent_id, "idle", None),
            (running_session_agent_id, "running", None),
            (resumed_session_agent_id, "idle", Some("upstream-session")),
            (
                dead_session_agent_id,
                "dead",
                Some("failed-upstream-session"),
            ),
            (
                active_workflow_session_agent_id,
                "idle",
                Some("active-chat-upstream"),
            ),
        ] {
            sqlx::query(
                r#"
                INSERT INTO chat_session_agents (
                    id,
                    session_id,
                    agent_id,
                    state,
                    project_member_id,
                    agent_session_id
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                "#,
            )
            .bind(id)
            .bind(Uuid::new_v4())
            .bind(agent.id)
            .bind(state)
            .bind(member.id)
            .bind(agent_session_id)
            .execute(&pool)
            .await
            .expect("insert session agent");
        }

        for (session_id, linked_project_id) in [
            (legacy_project_session_id, project_id),
            (other_project_session_id, Uuid::new_v4()),
        ] {
            sqlx::query(
                r#"
                INSERT INTO chat_sessions (id, title, status, project_id)
                VALUES (?1, 'session', 'active', ?2)
                "#,
            )
            .bind(session_id)
            .bind(linked_project_id)
            .execute(&pool)
            .await
            .expect("insert chat session");
        }
        for (id, session_id, agent_session_id) in [
            (
                unlinked_project_session_agent_id,
                legacy_project_session_id,
                "legacy-upstream-session",
            ),
            (
                unlinked_other_project_session_agent_id,
                other_project_session_id,
                "other-upstream-session",
            ),
        ] {
            sqlx::query(
                r#"
                INSERT INTO chat_session_agents (
                    id,
                    session_id,
                    agent_id,
                    state,
                    agent_session_id
                )
                VALUES (?1, ?2, ?3, 'idle', ?4)
                "#,
            )
            .bind(id)
            .bind(session_id)
            .bind(agent.id)
            .bind(agent_session_id)
            .execute(&pool)
            .await
            .expect("insert unlinked session agent");
        }

        let idle_workflow_session_id = Uuid::new_v4();
        let running_workflow_session_id = Uuid::new_v4();
        for (id, session_agent_id, state, agent_session_id, agent_message_id) in [
            (
                idle_workflow_session_id,
                resumed_session_agent_id,
                "idle",
                "workflow-upstream",
                "workflow-message",
            ),
            (
                running_workflow_session_id,
                active_workflow_session_agent_id,
                "running",
                "active-workflow-upstream",
                "active-workflow-message",
            ),
        ] {
            sqlx::query(
                r#"
                INSERT INTO chat_workflow_agent_sessions (
                    id,
                    workflow_execution_id,
                    session_agent_id,
                    state,
                    agent_session_id,
                    agent_message_id
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                "#,
            )
            .bind(id)
            .bind(Uuid::new_v4())
            .bind(session_agent_id)
            .bind(state)
            .bind(agent_session_id)
            .bind(agent_message_id)
            .execute(&pool)
            .await
            .expect("insert workflow session");
        }

        service
            .update_member(
                &pool,
                member.id,
                super::ProjectMemberUpdateInput {
                    member_name: None,
                    role: None,
                    display_order: None,
                    default_workspace_path: None,
                    is_default: None,
                    allowed_skill_ids: Some(vec!["skill-a".to_string(), "skill-b".to_string()]),
                    execution_config: Some(MemberExecutionConfig {
                        runner_type: Some(executors::executors::BaseCodingAgent::Codex),
                        model_name: Some("gpt-5.2-codex".to_string()),
                        thinking_effort: Some("high".to_string()),
                        model_variant: None,
                    }),
                },
            )
            .await
            .expect("update member");

        let synced_config: String =
            sqlx::query_scalar("SELECT execution_config FROM chat_session_agents WHERE id = ?1")
                .bind(synced_session_agent_id)
                .fetch_one(&pool)
                .await
                .expect("read synced config");
        let running_config: String =
            sqlx::query_scalar("SELECT execution_config FROM chat_session_agents WHERE id = ?1")
                .bind(running_session_agent_id)
                .fetch_one(&pool)
                .await
                .expect("read running config");
        let resumed_config: String =
            sqlx::query_scalar("SELECT execution_config FROM chat_session_agents WHERE id = ?1")
                .bind(resumed_session_agent_id)
                .fetch_one(&pool)
                .await
                .expect("read resumed config");
        let dead_config: String =
            sqlx::query_scalar("SELECT execution_config FROM chat_session_agents WHERE id = ?1")
                .bind(dead_session_agent_id)
                .fetch_one(&pool)
                .await
                .expect("read dead config");
        let dead_runtime_ids: (Option<String>, Option<String>) = sqlx::query_as(
            r#"
            SELECT agent_session_id, agent_message_id
            FROM chat_session_agents
            WHERE id = ?1
            "#,
        )
        .bind(dead_session_agent_id)
        .fetch_one(&pool)
        .await
        .expect("read dead runtime ids");
        let resumed_runtime_ids: (Option<String>, Option<String>) = sqlx::query_as(
            r#"
            SELECT agent_session_id, agent_message_id
            FROM chat_session_agents
            WHERE id = ?1
            "#,
        )
        .bind(resumed_session_agent_id)
        .fetch_one(&pool)
        .await
        .expect("read resumed runtime ids");
        let active_workflow_config: String =
            sqlx::query_scalar("SELECT execution_config FROM chat_session_agents WHERE id = ?1")
                .bind(active_workflow_session_agent_id)
                .fetch_one(&pool)
                .await
                .expect("read active workflow config");
        let unlinked_project_config: String =
            sqlx::query_scalar("SELECT execution_config FROM chat_session_agents WHERE id = ?1")
                .bind(unlinked_project_session_agent_id)
                .fetch_one(&pool)
                .await
                .expect("read unlinked project config");
        let unlinked_project_row: (Option<Uuid>, Option<String>, Option<String>) = sqlx::query_as(
            r#"
            SELECT project_member_id, agent_session_id, agent_message_id
            FROM chat_session_agents
            WHERE id = ?1
            "#,
        )
        .bind(unlinked_project_session_agent_id)
        .fetch_one(&pool)
        .await
        .expect("read unlinked project runtime ids");
        let unlinked_other_project_config: String =
            sqlx::query_scalar("SELECT execution_config FROM chat_session_agents WHERE id = ?1")
                .bind(unlinked_other_project_session_agent_id)
                .fetch_one(&pool)
                .await
                .expect("read unlinked other project config");
        let unlinked_other_project_row: (Option<Uuid>, Option<String>) = sqlx::query_as(
            r#"
            SELECT project_member_id, agent_session_id
            FROM chat_session_agents
            WHERE id = ?1
            "#,
        )
        .bind(unlinked_other_project_session_agent_id)
        .fetch_one(&pool)
        .await
        .expect("read unlinked other project runtime ids");
        let synced_skills: String =
            sqlx::query_scalar("SELECT allowed_skill_ids FROM chat_session_agents WHERE id = ?1")
                .bind(synced_session_agent_id)
                .fetch_one(&pool)
                .await
                .expect("read synced skills");
        let running_skills: String =
            sqlx::query_scalar("SELECT allowed_skill_ids FROM chat_session_agents WHERE id = ?1")
                .bind(running_session_agent_id)
                .fetch_one(&pool)
                .await
                .expect("read running skills");
        let active_workflow_skills: String =
            sqlx::query_scalar("SELECT allowed_skill_ids FROM chat_session_agents WHERE id = ?1")
                .bind(active_workflow_session_agent_id)
                .fetch_one(&pool)
                .await
                .expect("read active workflow skills");
        let unlinked_project_skills: String =
            sqlx::query_scalar("SELECT allowed_skill_ids FROM chat_session_agents WHERE id = ?1")
                .bind(unlinked_project_session_agent_id)
                .fetch_one(&pool)
                .await
                .expect("read unlinked project skills");
        let unlinked_other_project_skills: String =
            sqlx::query_scalar("SELECT allowed_skill_ids FROM chat_session_agents WHERE id = ?1")
                .bind(unlinked_other_project_session_agent_id)
                .fetch_one(&pool)
                .await
                .expect("read unlinked other project skills");
        let idle_workflow_runtime_ids: (Option<String>, Option<String>) = sqlx::query_as(
            r#"
            SELECT agent_session_id, agent_message_id
            FROM chat_workflow_agent_sessions
            WHERE id = ?1
            "#,
        )
        .bind(idle_workflow_session_id)
        .fetch_one(&pool)
        .await
        .expect("read idle workflow runtime ids");
        let running_workflow_runtime_ids: (Option<String>, Option<String>) = sqlx::query_as(
            r#"
            SELECT agent_session_id, agent_message_id
            FROM chat_workflow_agent_sessions
            WHERE id = ?1
            "#,
        )
        .bind(running_workflow_session_id)
        .fetch_one(&pool)
        .await
        .expect("read running workflow runtime ids");

        assert!(synced_config.contains("gpt-5.2-codex"));
        assert_eq!(running_config, "{}");
        assert!(resumed_config.contains("gpt-5.2-codex"));
        assert_eq!(resumed_runtime_ids, (None, None));
        assert!(dead_config.contains("gpt-5.2-codex"));
        assert_eq!(dead_runtime_ids, (None, None));
        assert_eq!(active_workflow_config, "{}");
        assert!(unlinked_project_config.contains("gpt-5.2-codex"));
        assert_eq!(unlinked_project_row, (Some(member.id), None, None));
        assert_eq!(unlinked_other_project_config, "{}");
        assert_eq!(synced_skills, r#"["skill-a","skill-b"]"#);
        assert_eq!(running_skills, r#"["skill-a","skill-b"]"#);
        assert_eq!(active_workflow_skills, r#"["skill-a","skill-b"]"#);
        assert_eq!(unlinked_project_skills, r#"["skill-a","skill-b"]"#);
        assert_eq!(unlinked_other_project_skills, "[]");
        assert_eq!(
            unlinked_other_project_row,
            (None, Some("other-upstream-session".to_string()))
        );
        assert_eq!(idle_workflow_runtime_ids, (None, None));
        assert_eq!(
            running_workflow_runtime_ids,
            (
                Some("active-workflow-upstream".to_string()),
                Some("active-workflow-message".to_string())
            )
        );
    }

    #[tokio::test]
    async fn initializes_human_and_agent_members_without_global_default_agent_column() {
        let pool = setup_pool().await;
        let service = ProjectMemberService::new();
        let project_id = Uuid::new_v4();
        let agent = create_agent(&pool).await;

        let members = service
            .initialize_default_members(&pool, project_id, "user-1")
            .await
            .expect("initialize project members");

        assert_eq!(members.len(), 2);
        assert!(
            members
                .iter()
                .any(|member| member.member_type == ProjectMemberType::Human
                    && member.user_id.as_deref() == Some("user-1"))
        );
        assert!(
            members
                .iter()
                .any(|member| member.member_type == ProjectMemberType::Agent
                    && member.agent_id == Some(agent.id)
                    && member.is_default)
        );
    }

    #[tokio::test]
    async fn initialize_default_members_is_idempotent() {
        let pool = setup_pool().await;
        let service = ProjectMemberService::new();
        let project_id = Uuid::new_v4();
        create_agent(&pool).await;

        let first = service
            .initialize_default_members(&pool, project_id, "user-1")
            .await
            .expect("first initialization");
        let second = service
            .initialize_default_members(&pool, project_id, "user-1")
            .await
            .expect("second initialization");
        let all_members = service
            .list_members(&pool, project_id)
            .await
            .expect("list project members");

        assert_eq!(first.len(), 2);
        assert!(second.is_empty());
        assert_eq!(all_members.len(), 2);
    }

    #[tokio::test]
    async fn initializes_only_global_default_agents_when_column_exists() {
        let pool = setup_pool().await;
        sqlx::query("ALTER TABLE chat_agents ADD COLUMN is_default BOOLEAN DEFAULT 0")
            .execute(&pool)
            .await
            .expect("add is_default column");
        let default_agent = create_named_agent(&pool, "default-agent").await;
        let non_default_agent = create_named_agent(&pool, "non-default-agent").await;
        sqlx::query("UPDATE chat_agents SET is_default = 1 WHERE id = ?1")
            .bind(default_agent.id)
            .execute(&pool)
            .await
            .expect("mark default agent");

        let members = ProjectMemberService::new()
            .initialize_default_members(&pool, Uuid::new_v4(), "user-1")
            .await
            .expect("initialize project members");
        let agent_members = members
            .iter()
            .filter(|member| member.member_type == ProjectMemberType::Agent)
            .collect::<Vec<_>>();

        assert_eq!(agent_members.len(), 1);
        assert_eq!(agent_members[0].agent_id, Some(default_agent.id));
        assert_ne!(agent_members[0].agent_id, Some(non_default_agent.id));
    }
}
