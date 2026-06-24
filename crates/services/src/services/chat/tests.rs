#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::{
        chat_agent::{ChatAgent, CreateChatAgent},
        chat_message::{ChatMessage, ChatSenderType},
        chat_session::{ChatSession, CreateChatSession},
        chat_session_agent::{ChatSessionAgent, ChatSessionAgentState},
        member_execution_config::MemberExecutionConfig,
        project::CreateProject,
        project_member::{ProjectMember, ProjectMemberType},
    };
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use crate::services::{project::ProjectService, repo::RepoService};

    use super::{
        CompressionType, SimplifiedMessage, all_agents_running, build_message_analytics_metrics,
        compress_messages_if_needed, create_message, create_session_with_project_members,
        effective_agent_name, is_protocol_notice_history_message, is_workflow_chat_input_mode,
        limit_summary_input_messages, member_name_overrides_for_session, normalized_member_name,
        parse_agent_send_mentions, parse_mentions, parse_user_message_mentions,
        prioritize_summary_agents,
        select_messages_to_compress_by_token, should_include_message_in_history,
    };

    #[test]
    fn parses_mentions_with_basic_tokens() {
        let mentions = parse_mentions("@coder please check @planner");
        assert_eq!(mentions, vec!["coder", "planner"]);
    }

    #[test]
    fn ignores_email_addresses() {
        let mentions = parse_mentions("email me at test@example.com");
        assert!(mentions.is_empty());
    }

    #[test]
    fn de_dupes_mentions_in_order() {
        let mentions = parse_mentions("@a @a @b");
        assert_eq!(mentions, vec!["a", "b"]);
    }

    #[test]
    fn normalized_member_name_strips_spaces() {
        assert_eq!(
            normalized_member_name(Some(" @Backend & Engineer ")).as_deref(),
            Some("BackendEngineer")
        );
        assert_eq!(normalized_member_name(Some(" \t ")), None);
    }

    #[test]
    fn parse_user_message_mentions_uses_meta_when_content_has_no_at_tokens() {
        let mentions = parse_user_message_mentions(
            "please handle this",
            &serde_json::json!({ "mentions": ["@lead", "lead", "bad name"] }),
        );
        assert_eq!(mentions, vec!["lead"]);
    }

    #[test]
    fn parse_user_message_mentions_prefers_content_at_tokens() {
        let mentions = parse_user_message_mentions(
            "@backend please handle this",
            &serde_json::json!({ "mentions": ["lead"] }),
        );
        assert_eq!(mentions, vec!["backend"]);
    }

    #[test]
    fn parse_agent_send_mentions_reads_protocol_target() {
        let mentions = parse_agent_send_mentions(&serde_json::json!({
            "protocol": {
                "type": "send",
                "to": "@alice",
                "intent": "request"
            }
        }));
        assert_eq!(mentions, vec!["alice"]);
    }

    #[test]
    fn parse_agent_send_mentions_routes_notify_intent() {
        let mentions = parse_agent_send_mentions(&serde_json::json!({
            "protocol": {
                "type": "send",
                "to": "researcher",
                "intent": "notify"
            }
        }));
        assert_eq!(mentions, vec!["researcher"]);

        let mentions = parse_agent_send_mentions(&serde_json::json!({
            "protocol": {
                "type": "send",
                "to": "researcher"
            }
        }));
        assert!(mentions.is_empty());
    }

    #[test]
    fn parse_agent_send_mentions_ignores_non_send_protocol_messages() {
        let mentions = parse_agent_send_mentions(&serde_json::json!({
            "protocol": {
                "type": "record",
                "to": "researcher"
            }
        }));
        assert!(mentions.is_empty());
    }

    #[test]
    fn build_message_analytics_metrics_uses_buckets_counts_and_attachment_sizes() {
        let message = ChatMessage {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            sender_type: ChatSenderType::User,
            sender_id: None,
            content: "hello @planner with file".to_string(),
            mentions: sqlx::types::Json(vec!["planner".to_string()]),
            meta: sqlx::types::Json(serde_json::json!({
                "attachments": [
                    {
                        "id": Uuid::new_v4(),
                        "name": "a.txt",
                        "mime_type": "text/plain",
                        "size_bytes": 12,
                        "kind": "file",
                        "relative_path": "chat/session_x/attachments/y/a.txt"
                    },
                    {
                        "id": Uuid::new_v4(),
                        "name": "b.txt",
                        "mime_type": "text/plain",
                        "size_bytes": 30,
                        "kind": "file",
                        "relative_path": "chat/session_x/attachments/y/b.txt"
                    }
                ]
            })),
            created_at: Utc::now(),
        };

        let metrics = build_message_analytics_metrics(&message);

        assert_eq!(metrics.message_length_bucket, "short");
        assert_eq!(metrics.mention_count, 1);
        assert_eq!(metrics.attachment_count, 2);
        assert_eq!(metrics.attachment_total_size_bytes, 42);
    }

    async fn setup_chat_message_pool() -> SqlitePool {
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
            CREATE TABLE chat_sessions (
                id BLOB PRIMARY KEY,
                title TEXT,
                status TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','archived')),
                summary_text TEXT,
                archive_ref TEXT,
                last_seen_diff_key TEXT,
                team_protocol TEXT DEFAULT '',
                team_protocol_enabled INTEGER DEFAULT 0,
                default_workspace_path TEXT,
                chat_input_mode TEXT,
                project_id BLOB,
                lead_agent_id TEXT,
                worktree_mode TEXT NOT NULL DEFAULT 'inherit'
                    CHECK (worktree_mode IN ('inherit', 'disabled', 'isolated')),
                pinned_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                archived_at TEXT
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
            CREATE TABLE chat_messages (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                sender_type TEXT NOT NULL
                    CHECK (sender_type IN ('user','agent','system')),
                sender_id BLOB,
                content TEXT NOT NULL,
                mentions TEXT NOT NULL DEFAULT '[]',
                meta TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            )
            "#,
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create minimal chat schema");
        }

        pool
    }

    async fn create_active_session(pool: &SqlitePool) -> ChatSession {
        ChatSession::create(
            pool,
            &CreateChatSession {
                title: None,
                workspace_path: None,
                project_id: None,
                worktree_mode: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat session")
    }

    async fn create_agent_member(pool: &SqlitePool, name: &str) -> ChatAgent {
        ChatAgent::create(
            pool,
            &CreateChatAgent {
                name: name.to_string(),
                runner_type: "codex".to_string(),
                system_prompt: None,
                tools_enabled: None,
                model_name: None,
                owner_project_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat agent")
    }

    async fn setup_project_session_pool() -> SqlitePool {
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
            CREATE TABLE chat_sessions (
                id BLOB PRIMARY KEY,
                title TEXT,
                status TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','archived')),
                lead_agent_id BLOB,
                summary_text TEXT,
                archive_ref TEXT,
                last_seen_diff_key TEXT,
                team_protocol TEXT DEFAULT '',
                team_protocol_enabled INTEGER DEFAULT 0,
                default_workspace_path TEXT,
                chat_input_mode TEXT,
                project_id BLOB,
                worktree_mode TEXT NOT NULL DEFAULT 'inherit'
                    CHECK (worktree_mode IN ('inherit', 'disabled', 'isolated')),
                pinned_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                archived_at TEXT
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
            CREATE TABLE chat_session_agents (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                agent_id BLOB NOT NULL,
                state TEXT NOT NULL DEFAULT 'idle'
                    CHECK (state IN ('idle','running','stopping','waitingapproval','dead')),
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
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create minimal project session schema");
        }

        pool
    }

    #[tokio::test]
    async fn create_message_keeps_user_mentions_from_plain_at_tokens() {
        let pool = setup_chat_message_pool().await;
        let session = create_active_session(&pool).await;

        let message = create_message(
            &pool,
            session.id,
            ChatSenderType::User,
            None,
            "@backend please review".to_string(),
            Some(serde_json::json!({})),
        )
        .await
        .expect("create user message");

        assert_eq!(message.mentions.0, vec!["backend"]);
    }

    #[tokio::test]
    async fn create_message_routes_user_mentions_from_meta_when_content_has_none() {
        let pool = setup_chat_message_pool().await;
        let session = create_active_session(&pool).await;

        let message = create_message(
            &pool,
            session.id,
            ChatSenderType::User,
            None,
            "please handle this".to_string(),
            Some(serde_json::json!({ "mentions": ["lead"] })),
        )
        .await
        .expect("create user message");

        assert_eq!(message.mentions.0, vec!["lead"]);
    }

    #[tokio::test]
    async fn create_project_session_snapshots_default_agent_members() {
        let pool = setup_project_session_pool().await;
        let project_id = Uuid::new_v4();
        let agent = create_agent_member(&pool, "coder").await;

        ProjectMember::create(
            &pool,
            project_id,
            ProjectMemberType::Agent,
            None,
            Some(agent.id),
            None,
            Some("developer".to_string()),
            0,
            Some("E:/workspace".to_string()),
            vec!["skill-a".to_string()],
            MemberExecutionConfig::default(),
            true,
        )
        .await
        .expect("create project member");

        let session = create_session_with_project_members(
            &pool,
            &CreateChatSession {
                title: Some("project session".to_string()),
                workspace_path: Some("E:/root".to_string()),
                project_id: Some(project_id),
                worktree_mode: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create project session");

        let session_agents = ChatSessionAgent::find_all_for_session(&pool, session.id)
            .await
            .expect("load session agents");

        assert_eq!(session.project_id, Some(project_id));
        assert_eq!(session_agents.len(), 1);
        assert_eq!(session_agents[0].agent_id, agent.id);
        assert_eq!(
            session_agents[0].workspace_path.as_deref(),
            Some("E:/workspace")
        );
        assert_eq!(session_agents[0].allowed_skill_ids.0, vec!["skill-a"]);
    }

    #[tokio::test]
    async fn create_project_session_snapshots_agents_initialized_from_global_agents() {
        let pool = setup_project_session_pool().await;
        let agent = create_agent_member(&pool, "coder").await;

        let project = ProjectService::new()
            .create_project(
                &pool,
                &RepoService::new(),
                CreateProject {
                    name: "project".to_string(),
                    repositories: Vec::new(),
                    description: None,
                    status: None,
                    default_workspace_path: None,
                    active_repo_id: None,
                },
                "user-1",
            )
            .await
            .expect("create project with default members");

        let default_agents = ProjectMember::find_default_agents(&pool, project.id)
            .await
            .expect("find project default agents");
        assert_eq!(default_agents.len(), 1);
        assert_eq!(default_agents[0].agent_id, Some(agent.id));

        let session = create_session_with_project_members(
            &pool,
            &CreateChatSession {
                title: Some("project session".to_string()),
                workspace_path: None,
                project_id: Some(project.id),
                worktree_mode: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create project session");

        let session_agents = ChatSessionAgent::find_all_for_session(&pool, session.id)
            .await
            .expect("load session agents");

        assert_eq!(session_agents.len(), 1);
        assert_eq!(session_agents[0].agent_id, agent.id);
    }

    #[tokio::test]
    async fn project_member_name_overrides_runtime_agent_name() {
        let pool = setup_project_session_pool().await;
        let project_id = Uuid::new_v4();
        let agent = create_agent_member(&pool, "coder-template").await;

        ProjectMember::create(
            &pool,
            project_id,
            ProjectMemberType::Agent,
            None,
            Some(agent.id),
            Some("backend-lead".to_string()),
            Some("developer".to_string()),
            0,
            None,
            Vec::new(),
            MemberExecutionConfig::default(),
            true,
        )
        .await
        .expect("create project member");

        let session = create_session_with_project_members(
            &pool,
            &CreateChatSession {
                title: Some("project session".to_string()),
                workspace_path: None,
                project_id: Some(project_id),
                worktree_mode: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create project session");

        let overrides = member_name_overrides_for_session(&pool, session.id)
            .await
            .expect("load member name overrides");

        assert_eq!(overrides.get(&agent.id).map(String::as_str), Some("backend-lead"));
        assert_eq!(
            effective_agent_name(&agent, overrides.get(&agent.id).map(String::as_str)),
            "backend-lead"
        );
    }

    #[test]
    fn workflow_chat_input_mode_is_read_from_meta() {
        assert!(is_workflow_chat_input_mode(&serde_json::json!({
            "chat_input_mode": "workflow"
        })));
        assert!(!is_workflow_chat_input_mode(&serde_json::json!({
            "chat_input_mode": "free"
        })));
        assert!(!is_workflow_chat_input_mode(&serde_json::json!({})));
    }

    #[tokio::test]
    async fn create_message_routes_explicit_user_mentions_in_workflow_mode() {
        let pool = setup_chat_message_pool().await;
        let session = create_active_session(&pool).await;

        let message = create_message(
            &pool,
            session.id,
            ChatSenderType::User,
            None,
            "@backend please review".to_string(),
            Some(serde_json::json!({ "chat_input_mode": "workflow" })),
        )
        .await
        .expect("create workflow user message");

        assert_eq!(message.mentions.0, vec!["backend"]);
        assert_eq!(
            message
                .meta
                .0
                .get("chat_input_mode")
                .and_then(serde_json::Value::as_str),
            Some("workflow")
        );
    }

    #[tokio::test]
    async fn create_message_keeps_unmentioned_workflow_user_message_unmentioned() {
        let pool = setup_chat_message_pool().await;
        let session = create_active_session(&pool).await;

        let message = create_message(
            &pool,
            session.id,
            ChatSenderType::User,
            None,
            "please plan this".to_string(),
            Some(serde_json::json!({ "chat_input_mode": "workflow" })),
        )
        .await
        .expect("create workflow user message");

        assert!(message.mentions.0.is_empty());
    }

    #[tokio::test]
    async fn create_message_routes_workflow_user_mentions_from_meta() {
        let pool = setup_chat_message_pool().await;
        let session = create_active_session(&pool).await;

        let message = create_message(
            &pool,
            session.id,
            ChatSenderType::User,
            None,
            "please review this".to_string(),
            Some(serde_json::json!({
                "chat_input_mode": "workflow",
                "mentions": ["backend"]
            })),
        )
        .await
        .expect("create workflow user message");

        assert_eq!(message.mentions.0, vec!["backend"]);
    }

    #[tokio::test]
    async fn create_attachment_message_routes_explicit_user_mentions_in_workflow_mode() {
        let pool = setup_chat_message_pool().await;
        let session = create_active_session(&pool).await;

        let message = create_message(
            &pool,
            session.id,
            ChatSenderType::User,
            None,
            "@backend see attached".to_string(),
            Some(serde_json::json!({
                "chat_input_mode": "workflow",
                "attachments": [{
                    "id": Uuid::new_v4(),
                    "name": "notes.txt",
                    "mime_type": "text/plain",
                    "size_bytes": 12,
                    "kind": "file",
                    "relative_path": "chat/session/demo/attachments/message/notes.txt"
                }]
            })),
        )
        .await
        .expect("create workflow attachment message");

        assert_eq!(message.mentions.0, vec!["backend"]);
    }

    #[tokio::test]
    async fn create_message_does_not_route_agent_plain_at_content() {
        let pool = setup_chat_message_pool().await;
        let session = create_active_session(&pool).await;
        let sender = create_agent_member(&pool, "planner").await;

        let message = create_message(
            &pool,
            session.id,
            ChatSenderType::Agent,
            Some(sender.id),
            "@backend please review".to_string(),
            Some(serde_json::json!({})),
        )
        .await
        .expect("create agent message");

        assert!(message.mentions.0.is_empty());
    }

    #[tokio::test]
    async fn create_message_routes_agent_send_protocol_using_meta_target() {
        let pool = setup_chat_message_pool().await;
        let session = create_active_session(&pool).await;
        let sender = create_agent_member(&pool, "planner").await;

        let message = create_message(
            &pool,
            session.id,
            ChatSenderType::Agent,
            Some(sender.id),
            "@backend please review".to_string(),
            Some(serde_json::json!({
                "protocol": {
                    "type": "send",
                    "to": "backend",
                    "intent": "reply"
                }
            })),
        )
        .await
        .expect("create protocol-routed agent message");

        assert_eq!(message.mentions.0, vec!["backend"]);
    }

    #[tokio::test]
    async fn create_message_routes_agent_send_protocol_with_notify_intent() {
        let pool = setup_chat_message_pool().await;
        let session = create_active_session(&pool).await;
        let sender = create_agent_member(&pool, "planner").await;

        let message = create_message(
            &pool,
            session.id,
            ChatSenderType::Agent,
            Some(sender.id),
            "@backend FYI".to_string(),
            Some(serde_json::json!({
                "protocol": {
                    "type": "send",
                    "to": "backend",
                    "intent": "notify"
                }
            })),
        )
        .await
        .expect("create notify-routed agent message");

        assert_eq!(message.mentions.0, vec!["backend"]);
    }

    fn make_session_agent(state: ChatSessionAgentState) -> ChatSessionAgent {
        ChatSessionAgent {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            agent_id: Uuid::new_v4(),
            state,
            allowed_skill_ids: sqlx::types::Json(Vec::new()),
            workspace_path: None,
            pty_session_key: None,
            agent_session_id: None,
            agent_message_id: None,
            project_member_id: None,
            execution_config: sqlx::types::Json(MemberExecutionConfig::default()),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn prioritize_summary_agents_prefers_idle_then_running_last() {
        let running = make_session_agent(ChatSessionAgentState::Running);
        let waiting = make_session_agent(ChatSessionAgentState::WaitingApproval);
        let idle = make_session_agent(ChatSessionAgentState::Idle);
        let dead = make_session_agent(ChatSessionAgentState::Dead);

        let prioritized = prioritize_summary_agents(&[
            running.clone(),
            waiting.clone(),
            idle.clone(),
            dead.clone(),
        ]);

        assert_eq!(prioritized[0].id, idle.id);
        assert_eq!(prioritized[1].id, waiting.id);
        assert_eq!(prioritized[2].id, dead.id);
        assert_eq!(prioritized[3].id, running.id);
    }

    #[test]
    fn all_agents_running_only_true_when_non_empty_and_all_running() {
        assert!(!all_agents_running(&[]));
        assert!(!all_agents_running(&[
            make_session_agent(ChatSessionAgentState::Running),
            make_session_agent(ChatSessionAgentState::Idle),
        ]));
        assert!(all_agents_running(&[
            make_session_agent(ChatSessionAgentState::Running),
            make_session_agent(ChatSessionAgentState::Running),
        ]));
    }

    #[test]
    fn select_messages_to_compress_uses_token_budget() {
        let messages = vec![
            SimplifiedMessage {
                sender: "user:alice".to_string(),
                content: "heavy ".repeat(500),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "user:bob".to_string(),
                content: "small".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "agent:bot".to_string(),
                content: "small".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "agent:bot".to_string(),
                content: "small".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
        ];

        let total_tokens = super::estimate_token_count(&messages);
        let (count, target_tokens, selected_tokens) =
            select_messages_to_compress_by_token(&messages, total_tokens, 50);

        // 50% by message count would be 2, but token-based should pick only the heavy first message.
        assert_eq!(count, 1);
        assert!(selected_tokens >= target_tokens);
    }

    #[test]
    fn limit_summary_input_messages_keeps_all_when_under_limit() {
        let messages = vec![
            SimplifiedMessage {
                sender: "user:alice".to_string(),
                content: "short".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "agent:bot".to_string(),
                content: "short reply".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
        ];

        let (limited, before, after) = limit_summary_input_messages(&messages, u32::MAX);
        assert_eq!(limited.len(), messages.len());
        assert_eq!(before, after);
    }

    #[test]
    fn limit_summary_input_messages_keeps_recent_slice_when_over_limit() {
        let messages = vec![
            SimplifiedMessage {
                sender: "user:a".to_string(),
                content: "old ".repeat(300),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "agent:b".to_string(),
                content: "middle ".repeat(300),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "user:c".to_string(),
                content: "recent ".repeat(300),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
        ];

        let (limited, before, after) = limit_summary_input_messages(&messages, 200);
        assert!(limited.len() < messages.len());
        assert_eq!(
            limited.last().map(|m| m.content.as_str()),
            Some(messages[2].content.as_str())
        );
        assert!(before > after);
        assert!(after <= 200 || limited.len() == 1);
    }

    #[test]
    fn parses_mentions_with_unicode_names() {
        let mentions = parse_mentions(
            "@\u{5C0F}\u{660E} please check @\u{30C6}\u{30B9}\u{30C8}-agent and @\u{0645}\u{0637}\u{0648}\u{0631}_1",
        );
        assert_eq!(
            mentions,
            vec![
                "\u{5C0F}\u{660E}",
                "\u{30C6}\u{30B9}\u{30C8}-agent",
                "\u{0645}\u{0637}\u{0648}\u{0631}_1",
            ]
        );
    }

    fn make_chat_message(sender_type: ChatSenderType, meta: serde_json::Value) -> ChatMessage {
        ChatMessage {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            sender_type,
            sender_id: None,
            content: "message".to_string(),
            mentions: sqlx::types::Json(Vec::new()),
            meta: sqlx::types::Json(meta),
            created_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn protocol_error_system_messages_are_excluded_from_history() {
        let protocol_error = make_chat_message(
            ChatSenderType::System,
            serde_json::json!({
                "protocol_error": {
                    "reason": "Protocol error: message is empty."
                }
            }),
        );
        let normal_system = make_chat_message(ChatSenderType::System, serde_json::json!({}));
        let agent_message = make_chat_message(ChatSenderType::Agent, serde_json::json!({}));

        assert!(is_protocol_notice_history_message(&protocol_error));
        assert!(!should_include_message_in_history(&protocol_error));
        assert!(!is_protocol_notice_history_message(&normal_system));
        assert!(should_include_message_in_history(&normal_system));
        assert!(should_include_message_in_history(&agent_message));
    }

    #[tokio::test]
    async fn compress_messages_falls_back_to_truncation_without_agents() {
        if dirs::data_dir().is_none() {
            return;
        }

        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        let session_id = Uuid::new_v4();
        let workspace = std::path::Path::new(".");
        let messages = vec![
            SimplifiedMessage {
                sender: "user:alice".to_string(),
                content: "A very long message that should exceed tiny threshold quickly".repeat(8),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "agent:bot".to_string(),
                content: "Second long message for compression coverage".repeat(8),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "user:bob".to_string(),
                content: "Recent message to keep".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "agent:bot".to_string(),
                content: "Another recent message to keep".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
        ];

        let result = compress_messages_if_needed(
            &pool,
            session_id,
            messages.clone(),
            1,   // force compression
            50,  // compress half
            &[], // no agents available
            workspace,
            None, // no context_dir, use legacy split file
        )
        .await
        .expect("compression should succeed with fallback");

        assert_eq!(result.compression_type, CompressionType::Truncated);
        assert!(result.messages.len() <= messages.len());
        assert!(
            super::estimate_token_count(&result.messages) < super::estimate_token_count(&messages),
            "fallback truncation should reduce token count"
        );
        assert_eq!(
            result
                .messages
                .first()
                .map(|message| message.sender.as_str()),
            Some("system:summary"),
            "fallback should keep a compact summary marker at the front"
        );
        assert!(
            result
                .messages
                .first()
                .map(|message| message.content.contains("[History Summary - Fallback]"))
                .unwrap_or(false),
            "fallback summary marker should describe archival"
        );

        let warning = result.warning.expect("fallback should include warning");
        assert_eq!(warning.code, "COMPRESSION_FALLBACK");
        assert!(
            std::path::Path::new(&warning.split_file_path).exists(),
            "split file should be created"
        );

        let _ = tokio::fs::remove_file(&warning.split_file_path).await;
    }

    #[tokio::test]
    async fn compress_messages_reuses_cached_result_for_unchanged_history() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        let session_id = Uuid::new_v4();
        let workspace = std::path::Path::new(".");
        let context_dir = tempfile::tempdir().expect("create temp context dir");
        let messages = vec![
            SimplifiedMessage {
                sender: "user:alice".to_string(),
                content: "A very long message that should exceed tiny threshold quickly".repeat(8),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "agent:bot".to_string(),
                content: "Second long message for compression coverage".repeat(8),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "user:bob".to_string(),
                content: "Recent message to keep".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
        ];

        let first = compress_messages_if_needed(
            &pool,
            session_id,
            messages.clone(),
            1,
            50,
            &[],
            workspace,
            Some(context_dir.path()),
        )
        .await
        .expect("first compression should succeed");
        assert_eq!(first.compression_type, CompressionType::Truncated);
        let first_path = first
            .warning
            .as_ref()
            .expect("warning expected")
            .split_file_path
            .clone();

        let second = compress_messages_if_needed(
            &pool,
            session_id,
            messages.clone(),
            1,
            50,
            &[],
            workspace,
            Some(context_dir.path()),
        )
        .await
        .expect("second compression should succeed");
        assert_eq!(second.compression_type, CompressionType::Truncated);
        let second_path = second
            .warning
            .as_ref()
            .expect("warning expected")
            .split_file_path
            .clone();

        assert_eq!(
            first_path, second_path,
            "unchanged history should reuse cached compression output"
        );

        let cutoff_count = std::fs::read_dir(context_dir.path())
            .expect("read context dir")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("cutoff_message_")
            })
            .count();
        assert_eq!(
            cutoff_count, 1,
            "cached compression should avoid creating extra cutoff files"
        );
    }

    #[tokio::test]
    async fn compress_messages_reuses_persisted_state_after_cache_clear() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        let create_state_table_sql = format!(
            "CREATE TABLE {} (
                session_id BLOB PRIMARY KEY,
                source_fingerprint TEXT NOT NULL,
                source_message_count INTEGER NOT NULL,
                token_threshold INTEGER NOT NULL,
                compression_percentage INTEGER NOT NULL,
                source_token_count INTEGER NOT NULL,
                effective_token_count INTEGER NOT NULL,
                compression_type TEXT NOT NULL,
                warning_json TEXT,
                result_messages_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )",
            super::COMPRESSION_STATE_TABLE
        );
        sqlx::query(&create_state_table_sql)
            .execute(&pool)
            .await
            .expect("create compression state table");

        let session_id = Uuid::new_v4();
        let workspace = std::path::Path::new(".");
        let context_dir = tempfile::tempdir().expect("create temp context dir");
        let messages = vec![
            SimplifiedMessage {
                sender: "user:alice".to_string(),
                content: "A very long message that should exceed tiny threshold quickly".repeat(8),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "agent:bot".to_string(),
                content: "Second long message for compression coverage".repeat(8),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "user:bob".to_string(),
                content: "Recent message to keep".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
        ];

        let first = compress_messages_if_needed(
            &pool,
            session_id,
            messages.clone(),
            1,
            50,
            &[],
            workspace,
            Some(context_dir.path()),
        )
        .await
        .expect("first compression should succeed");
        assert_eq!(first.compression_type, CompressionType::Truncated);
        let first_path = first
            .warning
            .as_ref()
            .expect("warning expected")
            .split_file_path
            .clone();

        let persisted_count = sqlx::query_scalar::<_, i64>(&format!(
            "SELECT COUNT(1) FROM {} WHERE session_id = ?1",
            super::COMPRESSION_STATE_TABLE
        ))
        .bind(session_id)
        .fetch_one(&pool)
        .await
        .expect("query persisted compression rows");
        assert_eq!(persisted_count, 1);

        super::COMPRESSION_RESULT_CACHE.remove(&session_id);

        let second = compress_messages_if_needed(
            &pool,
            session_id,
            messages,
            1,
            50,
            &[],
            workspace,
            Some(context_dir.path()),
        )
        .await
        .expect("second compression should succeed from persisted state");
        assert_eq!(second.compression_type, CompressionType::Truncated);
        let second_path = second
            .warning
            .as_ref()
            .expect("warning expected")
            .split_file_path
            .clone();

        assert_eq!(
            first_path, second_path,
            "persisted cache should avoid re-compressing unchanged history after cache reset"
        );

        let cutoff_count = std::fs::read_dir(context_dir.path())
            .expect("read context dir")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("cutoff_message_")
            })
            .count();
        assert_eq!(
            cutoff_count, 1,
            "persisted cache should avoid creating extra cutoff files after cache reset"
        );
    }

    #[tokio::test]
    async fn compress_messages_uses_compacted_base_for_appended_history() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        let session_id = Uuid::new_v4();
        let workspace = std::path::Path::new(".");
        let context_dir = tempfile::tempdir().expect("create temp context dir");
        let base_messages = vec![
            SimplifiedMessage {
                sender: "user:alice".to_string(),
                content: "A very long message that should exceed threshold".repeat(200),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "agent:bot".to_string(),
                content: "Another very long message for compression".repeat(200),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "user:bob".to_string(),
                content: "small keep".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "agent:bot".to_string(),
                content: "small keep too".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
        ];

        let base_tokens = super::estimate_token_count(&base_messages);
        let threshold = base_tokens.saturating_sub(1).max(1);

        let first = compress_messages_if_needed(
            &pool,
            session_id,
            base_messages.clone(),
            threshold,
            50,
            &[],
            workspace,
            Some(context_dir.path()),
        )
        .await
        .expect("first compression should succeed");
        assert_eq!(first.compression_type, CompressionType::Truncated);

        let mut appended = base_messages.clone();
        appended.push(SimplifiedMessage {
            sender: "user:charlie".to_string(),
            content: "new tail message".to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        });

        let second = compress_messages_if_needed(
            &pool,
            session_id,
            appended,
            threshold,
            50,
            &[],
            workspace,
            Some(context_dir.path()),
        )
        .await
        .expect("second compression should succeed");

        // Should keep using compacted base and just append new tail without re-compressing old long prefix.
        assert!(second.messages.len() >= first.messages.len());

        let cutoff_count = std::fs::read_dir(context_dir.path())
            .expect("read context dir")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("cutoff_message_")
            })
            .count();
        assert_eq!(
            cutoff_count, 1,
            "appended history should not trigger another cutoff for already compressed prefix"
        );
    }

    #[tokio::test]
    async fn compress_messages_keeps_original_when_under_threshold() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        let session_id = Uuid::new_v4();
        let workspace = std::path::Path::new(".");
        let messages = vec![
            SimplifiedMessage {
                sender: "user:alice".to_string(),
                content: "short message".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
            SimplifiedMessage {
                sender: "agent:bot".to_string(),
                content: "another short one".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
        ];

        let result = compress_messages_if_needed(
            &pool,
            session_id,
            messages.clone(),
            u32::MAX, // never trigger compression
            25,
            &[],
            workspace,
            None, // no context_dir
        )
        .await
        .expect("compression should pass");

        assert_eq!(result.compression_type, CompressionType::None);
        assert_eq!(result.messages.len(), messages.len());
        assert!(result.warning.is_none());
    }
}
