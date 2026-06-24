use std::{
    path::Path,
    sync::{Arc, atomic::AtomicU8},
};

use chrono::Utc;
use command_group::AsyncCommandGroup;
use db::{
    DBService,
    models::{
        chat_agent::{ChatAgent, CreateChatAgent},
        chat_message::{ChatMessage, ChatSenderType},
        chat_session::{ChatSession, ChatSessionStatus, ChatSessionWorktreeMode},
        chat_session_agent::{ChatSessionAgent, ChatSessionAgentState},
    },
};
use executors::executors::CancellationToken;
use git::GitService;
use serde_json::json;
use sqlx::SqlitePool;
use tokio::{process::Command, sync::oneshot};
use utils::{log_msg::LogMsg, msg_store::MsgStore};
use uuid::Uuid;

use super::{
    AgentProtocolError, AgentProtocolMessageType, ChatProtocolNoticeCode, ChatRunner,
    ChatStreamEvent, MARKDOWN_PROTOCOL_OUTPUT_EXAMPLE_JSON, MAX_PROTOCOL_PARSE_RETRIES,
    PROTOCOL_OUTPUT_SCHEMA_JSON, RUNS_MAX_TOTAL_BYTES_PER_WORKSPACE,
    RUNS_PRUNE_TARGET_BYTES_PER_WORKSPACE, ResolvedPromptLanguage, RunCompletionStatus,
    TokenUsageInfo, runtime::RunLogForwarders,
};
use crate::services::{config::UiLanguage, session_worktree::SessionWorktreeService};

fn test_message_with_sender(
    sender_type: ChatSenderType,
    sender_id: Option<Uuid>,
    content: &str,
    meta: serde_json::Value,
) -> ChatMessage {
    ChatMessage {
        id: Uuid::new_v4(),
        session_id: Uuid::new_v4(),
        sender_type,
        sender_id,
        content: content.to_string(),
        mentions: sqlx::types::Json(Vec::new()),
        meta: sqlx::types::Json(meta),
        created_at: Utc::now(),
    }
}

fn test_message(content: &str, meta: serde_json::Value) -> ChatMessage {
    test_message_with_sender(ChatSenderType::User, None, content, meta)
}

fn test_agent(name: &str, system_prompt: &str) -> ChatAgent {
    ChatAgent {
        id: Uuid::new_v4(),
        name: name.to_string(),
        runner_type: "codex".to_string(),
        system_prompt: system_prompt.to_string(),
        model_name: None,
        owner_project_id: None,
        tools_enabled: sqlx::types::Json(json!({})),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn sleep_command(seconds: u64) -> Command {
    #[cfg(windows)]
    {
        let mut command = Command::new("powershell");
        command.args([
            "-NoLogo",
            "-NoProfile",
            "-Command",
            &format!("Start-Sleep -Seconds {seconds}"),
        ]);
        command
    }

    #[cfg(unix)]
    {
        let mut command = Command::new("sh");
        command.args(["-lc", &format!("sleep {seconds}")]);
        command
    }
}

async fn setup_chat_runner_db() -> DBService {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("create sqlite memory pool");

    for statement in [
        "PRAGMA foreign_keys = ON",
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
            CREATE TABLE chat_session_worktrees (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                project_id BLOB,
                base_workspace_path TEXT NOT NULL,
                repo_path TEXT NOT NULL,
                base_branch TEXT NOT NULL,
                base_commit TEXT,
                branch_name TEXT NOT NULL,
                worktree_path TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'session'
                    CHECK (mode IN ('session')),
                status TEXT NOT NULL DEFAULT 'creating'
                    CHECK (status IN (
                        'creating', 'active', 'dirty', 'merging',
                        'needs_conflict_resolution', 'merged',
                        'archived', 'cleanup_pending', 'cleanup_failed'
                    )),
                merge_target_branch TEXT,
                merge_operation TEXT,
                conflict_files_json TEXT NOT NULL DEFAULT '[]',
                operation_started_at TEXT,
                cleanup_error TEXT,
                last_used_at TEXT,
                merged_at TEXT,
                archived_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        r#"
            CREATE TABLE chat_session_agents (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                agent_id BLOB NOT NULL,
                state TEXT NOT NULL
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
        r#"
            CREATE TABLE chat_work_items (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                run_id BLOB NOT NULL,
                session_agent_id BLOB NOT NULL,
                agent_id BLOB NOT NULL,
                item_type TEXT NOT NULL CHECK (item_type IN ('artifact','conclusion')),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            )
            "#,
    ] {
        sqlx::query(statement)
            .execute(&pool)
            .await
            .expect("execute setup statement");
    }

    DBService { pool }
}

async fn insert_test_chat_session(db: &DBService, session_id: Uuid) -> ChatSession {
    sqlx::query(
        r#"
        INSERT INTO chat_sessions (id, title, status)
        VALUES (?, ?, ?)
        "#,
    )
    .bind(session_id)
    .bind("test session")
    .bind(ChatSessionStatus::Active)
    .execute(&db.pool)
    .await
    .expect("insert chat session");

    ChatSession::find_by_id(&db.pool, session_id)
        .await
        .expect("find inserted chat session")
        .expect("inserted chat session exists")
}

async fn insert_test_chat_agent(db: &DBService, name: &str) -> ChatAgent {
    ChatAgent::create(
        &db.pool,
        &CreateChatAgent {
            name: name.to_string(),
            runner_type: "codex".to_string(),
            system_prompt: Some(format!("You are {name}.")),
            tools_enabled: Some(json!({})),
            model_name: None,
            owner_project_id: None,
        },
        Uuid::new_v4(),
    )
    .await
    .expect("insert chat agent")
}

async fn insert_test_session_agent(
    db: &DBService,
    session_id: Uuid,
    agent_id: Uuid,
) -> ChatSessionAgent {
    ChatSessionAgent::create(
        &db.pool,
        &db::models::chat_session_agent::CreateChatSessionAgent {
            session_id,
            agent_id,
            workspace_path: None,
            allowed_skill_ids: Vec::new(),
            project_member_id: None,
            execution_config: db::models::member_execution_config::MemberExecutionConfig::default(),
        },
        Uuid::new_v4(),
    )
    .await
    .expect("insert session agent")
}

fn finished_count(msg_store: &MsgStore) -> usize {
    msg_store
        .get_history()
        .into_iter()
        .filter(|msg| matches!(msg, LogMsg::Finished))
        .count()
}

fn empty_log_forwarders() -> RunLogForwarders {
    RunLogForwarders {
        stdout: tokio::spawn(async {}),
        stderr: tokio::spawn(async {}),
    }
}

#[tokio::test]
async fn default_route_ignores_unmentioned_free_mode_user_messages() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    let session = insert_test_chat_session(&db, session_id).await;
    let first_agent = insert_test_chat_agent(&db, "first").await;
    let second_agent = insert_test_chat_agent(&db, "second").await;
    insert_test_session_agent(&db, session_id, first_agent.id).await;
    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    insert_test_session_agent(&db, session_id, second_agent.id).await;
    let message = test_message("please handle this", json!({}));

    let default_mention = runner
        .resolve_default_mention_for_unmentioned_user_message(&session, &message)
        .await
        .expect("resolve default mention");

    assert_eq!(default_mention, None);
}

#[tokio::test]
async fn default_route_for_unmentioned_workflow_message_uses_lead_agent() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    let session = insert_test_chat_session(&db, session_id).await;
    let first_agent = insert_test_chat_agent(&db, "first").await;
    let second_agent = insert_test_chat_agent(&db, "second").await;
    insert_test_session_agent(&db, session_id, first_agent.id).await;
    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    insert_test_session_agent(&db, session_id, second_agent.id).await;
    let message = test_message("please plan this", json!({ "chat_input_mode": "workflow" }));

    let default_mention = runner
        .resolve_default_mention_for_unmentioned_user_message(&session, &message)
        .await
        .expect("resolve default mention");

    assert_eq!(default_mention.as_deref(), Some("first"));
}

#[tokio::test]
async fn default_route_ignores_messages_with_explicit_mentions() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    let session = insert_test_chat_session(&db, session_id).await;
    let first_agent = insert_test_chat_agent(&db, "first").await;
    insert_test_session_agent(&db, session_id, first_agent.id).await;
    let mut message = test_message("@someone please handle this", json!({}));
    message.mentions = sqlx::types::Json(vec!["someone".to_string()]);

    let default_mention = runner
        .resolve_default_mention_for_unmentioned_user_message(&session, &message)
        .await
        .expect("resolve default mention");

    assert_eq!(default_mention, None);
}

#[tokio::test]
async fn default_route_ignores_unmentioned_agent_messages() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    let session = insert_test_chat_session(&db, session_id).await;
    let first_agent = insert_test_chat_agent(&db, "first").await;
    insert_test_session_agent(&db, session_id, first_agent.id).await;
    let message = test_message_with_sender(
        ChatSenderType::Agent,
        Some(first_agent.id),
        "done",
        json!({}),
    );

    let default_mention = runner
        .resolve_default_mention_for_unmentioned_user_message(&session, &message)
        .await
        .expect("resolve default mention");

    assert_eq!(default_mention, None);
}

#[test]
fn run_budget_thresholds_match_latest_policy() {
    assert_eq!(RUNS_MAX_TOTAL_BYTES_PER_WORKSPACE, 500 * 1024 * 1024);
    assert_eq!(RUNS_PRUNE_TARGET_BYTES_PER_WORKSPACE, 200 * 1024 * 1024);
}

#[test]
fn parse_token_usage_from_codex_token_count_line() {
    let line = r#"{"method":"codex/event/token_count","params":{"msg":{"info":{"last_token_usage":{"total_tokens":53002},"model_context_window":258400}}}}"#;
    let usage = ChatRunner::parse_token_usage_from_stdout_line(line).expect("usage");
    assert_eq!(usage.total_tokens, 53002);
    assert_eq!(usage.model_context_window, 258400);
}

#[test]
fn parse_token_usage_from_codex_token_count_line_keeps_model() {
    let line = r#"{"method":"codex/event/token_count","params":{"msg":{"model":"gpt-5-codex","provider_id":"openai","thread_id":"thread-1","info":{"last_token_usage":{"input_tokens":100,"output_tokens":50},"model_context_window":258400}}}}"#;
    let usage = ChatRunner::parse_token_usage_from_stdout_line(line).expect("usage");
    assert_eq!(usage.total_tokens, 150);
    assert_eq!(usage.runtime_model_id.as_deref(), Some("gpt-5-codex"));
    assert_eq!(usage.provider_id.as_deref(), Some("openai"));
    assert_eq!(usage.runtime_thread_id.as_deref(), Some("thread-1"));
}

#[test]
fn parse_token_usage_from_plain_token_usage_line() {
    let line = r#"{"type":"token_usage","total_tokens":14596,"model_context_window":258400}"#;
    let usage = ChatRunner::parse_token_usage_from_stdout_line(line).expect("usage");
    assert_eq!(usage.total_tokens, 14596);
    assert_eq!(usage.model_context_window, 258400);
}

#[test]
fn parse_token_usage_from_gemini_acp_quota_line() {
    let line = r#"{"type":"token_usage","total_tokens":168,"model_context_window":0,"input_tokens":123,"output_tokens":45,"runtime_agent":"gemini","runtime_model_id":"gemini-3-pro-preview","provider_id":"google","usage_scope":"turn_delta"}"#;
    let usage = ChatRunner::parse_token_usage_from_stdout_line(line).expect("usage");
    assert_eq!(usage.total_tokens, 168);
    assert_eq!(usage.model_context_window, 0);
    assert_eq!(usage.input_tokens, Some(123));
    assert_eq!(usage.output_tokens, Some(45));
    assert_eq!(usage.runtime_agent.as_deref(), Some("gemini"));
    assert_eq!(
        usage.runtime_model_id.as_deref(),
        Some("gemini-3-pro-preview")
    );
    assert_eq!(usage.provider_id.as_deref(), Some("google"));
    assert_eq!(usage.usage_scope.as_deref(), Some("turn_delta"));
    assert!(!usage.is_estimated);
}

#[test]
fn select_workspace_path_prefers_session_agent_override() {
    let resolved = ChatRunner::select_workspace_path(
        Some("/tmp/session-agent"),
        Some("/tmp/session-default"),
        "/tmp/generated".to_string(),
    );

    assert_eq!(resolved, "/tmp/session-agent");
}

#[test]
fn select_workspace_path_falls_back_to_session_default_before_generated_path() {
    let resolved = ChatRunner::select_workspace_path(
        None,
        Some("/tmp/session-default"),
        "/tmp/generated".to_string(),
    );

    assert_eq!(resolved, "/tmp/session-default");
}

#[tokio::test]
async fn resolve_workspace_path_for_merged_isolated_session_returns_worktree_workspace() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    let agent_id = Uuid::new_v4();
    let base_workspace = "E:/workspace/base";
    let worktree_workspace = "E:/workspace/.openteams/worktrees/session";

    sqlx::query(
        r#"
        INSERT INTO chat_sessions (
            id, title, status, default_workspace_path, worktree_mode
        )
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
    )
    .bind(session_id)
    .bind("merged isolated session")
    .bind(ChatSessionStatus::Active)
    .bind(base_workspace)
    .bind(ChatSessionWorktreeMode::Isolated)
    .execute(&db.pool)
    .await
    .expect("insert isolated session");

    sqlx::query(
        r#"
        INSERT INTO chat_session_worktrees (
            id, session_id, base_workspace_path, repo_path, base_branch,
            branch_name, worktree_path, mode, status, merged_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'session', 'merged', datetime('now', 'subsec'))
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(session_id)
    .bind(base_workspace)
    .bind(base_workspace)
    .bind("main")
    .bind("openteams/session/test")
    .bind(worktree_workspace)
    .execute(&db.pool)
    .await
    .expect("insert merged worktree row");

    let resolved = runner
        .resolve_workspace_path_for_agent(session_id, agent_id, None)
        .await
        .expect("resolve workspace");

    assert_eq!(resolved, worktree_workspace);

    let active_rows: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM chat_session_worktrees
        WHERE session_id = ?1
          AND status IN (
              'creating', 'active', 'dirty', 'merging',
              'needs_conflict_resolution', 'merged', 'cleanup_pending'
          )
        "#,
    )
    .bind(session_id)
    .fetch_one(&db.pool)
    .await
    .expect("count active rows");
    assert_eq!(active_rows, 1);
}

#[tokio::test]
async fn resolve_workspace_path_for_active_isolated_session_ignores_stale_agent_workspace() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    let agent_id = Uuid::new_v4();
    let base_workspace = "E:/workspace/base";
    let worktree_workspace = "E:/workspace/.openteams/worktrees/session";

    sqlx::query(
        r#"
        INSERT INTO chat_sessions (
            id, title, status, default_workspace_path, worktree_mode
        )
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
    )
    .bind(session_id)
    .bind("active isolated session")
    .bind(ChatSessionStatus::Active)
    .bind(base_workspace)
    .bind(ChatSessionWorktreeMode::Isolated)
    .execute(&db.pool)
    .await
    .expect("insert isolated session");

    sqlx::query(
        r#"
        INSERT INTO chat_session_worktrees (
            id, session_id, base_workspace_path, repo_path, base_branch,
            branch_name, worktree_path, mode, status
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'session', 'active')
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(session_id)
    .bind(base_workspace)
    .bind(base_workspace)
    .bind("main")
    .bind("openteams/session/test")
    .bind(worktree_workspace)
    .execute(&db.pool)
    .await
    .expect("insert active worktree row");

    let resolved = runner
        .resolve_workspace_path_for_agent(
            session_id,
            agent_id,
            Some(base_workspace.to_string()),
        )
        .await
        .expect("resolve workspace");

    assert_eq!(resolved, worktree_workspace);
}

#[test]
fn parse_agent_protocol_messages_supports_json_list() {
    let content = r#"
```json
[
  {"type":"send","to":"backend","intent":"REQUEST","content":"redo api"},
  {"type":"record","content":"route=/chat"},
  {"type":"artifact","content":"frontend/src/app.tsx"},
  {"type":"conclusion","content":"waiting for backend confirmation"}
]
```
"#;

    let messages = ChatRunner::parse_agent_protocol_messages(content).expect("messages");
    assert_eq!(messages.len(), 4);
    assert!(matches!(
        messages[0].message_type,
        AgentProtocolMessageType::Send
    ));
    assert_eq!(messages[0].to.as_deref(), Some("backend"));
    assert_eq!(messages[0].intent.as_deref(), Some("request"));
    assert!(matches!(
        messages[3].message_type,
        AgentProtocolMessageType::Conclusion
    ));
}

#[test]
fn parse_agent_protocol_messages_supports_json_array_with_tool_call_tail() {
    let content = r#"[{"type":"send","to":"you","content":"done"}]</parameter>
</invoke>
</minimax:tool_call>"#;

    let messages = ChatRunner::parse_agent_protocol_messages(content).expect("messages");
    assert_eq!(messages.len(), 1);
    assert!(matches!(
        messages[0].message_type,
        AgentProtocolMessageType::Send
    ));
    assert_eq!(messages[0].to.as_deref(), Some("you"));
    assert_eq!(messages[0].content, "done");
}

#[test]
fn parse_agent_protocol_messages_json_with_embedded_backticks() {
    let backticks = "\u{0060}\u{0060}\u{0060}";
    let content = format!(
        "[Pasted ~5 lines] {backticks}json\n\
[\n\
  {{\"type\": \"send\", \"to\": \"you\", \"content\": \"## Heading\\n\\n{backticks}\\ncode block inside json\\n{backticks}\\n\\nMore text\"}}\n\
]\n\
{backticks}"
    );

    let messages = ChatRunner::parse_agent_protocol_messages(&content).expect("messages");
    assert_eq!(messages.len(), 1);
    assert!(matches!(
        messages[0].message_type,
        AgentProtocolMessageType::Send
    ));
    assert_eq!(messages[0].to.as_deref(), Some("you"));
    assert!(messages[0].content.contains("code block inside json"));
}

#[test]
fn parse_agent_protocol_messages_supports_relaxed_message_type_shorthand() {
    let content = r#"
```json
[
  {
    "type": "send",
    "to": "you",
    "intent": "reply",
    "content": "done"
  },
  {
    "record",
    "content": "hero grid restored to idle"
  },
  {
    "conclusion",
    "content": "restoration behavior is now configured"
  }
]
```
"#;

    let messages = ChatRunner::parse_agent_protocol_messages(content).expect("messages");
    assert_eq!(messages.len(), 3);
    assert!(matches!(
        messages[0].message_type,
        AgentProtocolMessageType::Send
    ));
    assert_eq!(messages[0].to.as_deref(), Some("you"));
    assert_eq!(messages[0].intent.as_deref(), Some("reply"));
    assert!(matches!(
        messages[1].message_type,
        AgentProtocolMessageType::Record
    ));
    assert_eq!(messages[1].content, "hero grid restored to idle");
    assert!(matches!(
        messages[2].message_type,
        AgentProtocolMessageType::Conclusion
    ));
    assert_eq!(
        messages[2].content,
        "restoration behavior is now configured"
    );
}

#[test]
fn parse_agent_protocol_messages_rejects_legacy_object() {
    let content = r#"{
  "send_to_member": { "target": "@architect", "content": "sync API changes" },
  "send_to_user_important": "frontend done",
  "record": "route=/chat",
  "result": "backend API still pending"
}"#;

    let err = ChatRunner::parse_agent_protocol_messages(content).expect_err("error");
    assert_eq!(err.code, ChatProtocolNoticeCode::NotJsonArray);
}

#[test]
fn parse_agent_protocol_messages_rejects_missing_send_target() {
    let content = r#"[{"type":"send","content":"hello"}]"#;
    let err = ChatRunner::parse_agent_protocol_messages(content).expect_err("error");
    assert_eq!(err.code, ChatProtocolNoticeCode::MissingSendTarget);
}

#[test]
fn parse_agent_protocol_messages_rejects_invalid_send_intent() {
    let content = r#"[{"type":"send","to":"backend","intent":"delegate","content":"hello"}]"#;
    let err = ChatRunner::parse_agent_protocol_messages(content).expect_err("error");
    assert_eq!(err.code, ChatProtocolNoticeCode::InvalidSendIntent);
}

#[test]
fn parse_agent_protocol_messages_rejects_empty_content() {
    let content = r#"[{"type":"conclusion","content":"   "}]"#;
    let err = ChatRunner::parse_agent_protocol_messages(content).expect_err("error");
    assert_eq!(err.code, ChatProtocolNoticeCode::EmptyMessage);
}

#[test]
fn protocol_send_routing_blocks_agent_targets_in_workflow_mode() {
    assert!(!ChatRunner::should_route_protocol_send(
        true,
        "backend-runtime"
    ));
    assert!(!ChatRunner::should_route_protocol_send(
        true,
        "@frontend-dev"
    ));
    assert!(ChatRunner::should_route_protocol_send(true, "you"));
    assert!(ChatRunner::should_route_protocol_send(
        false,
        "backend-runtime"
    ));
}

#[tokio::test]
async fn exit_signal_waits_for_cleanup_before_finished() {
    let child = sleep_command(1).group_spawn().expect("spawn child");
    let stop = CancellationToken::new();
    let msg_store = Arc::new(MsgStore::new());
    let completion_status = Arc::new(AtomicU8::new(RunCompletionStatus::Succeeded.as_u8()));
    let (exit_tx, exit_rx) = oneshot::channel();
    exit_tx
        .send(executors::executors::ExecutorExitResult::Success)
        .expect("send exit signal");

    let watcher = tokio::spawn(ChatRunner::watch_executor_lifecycle_with_timeout(
        child,
        stop,
        None,
        Some(exit_rx),
        msg_store.clone(),
        completion_status.clone(),
        empty_log_forwarders(),
        Uuid::new_v4(),
        std::time::Duration::from_secs(3),
    ));

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    assert_eq!(finished_count(&msg_store), 0);

    watcher.await.expect("watcher complete");

    assert_eq!(finished_count(&msg_store), 1);
    assert_eq!(
        RunCompletionStatus::from_atomic(&completion_status),
        RunCompletionStatus::Succeeded
    );
}

#[tokio::test]
async fn stop_request_uses_same_cleanup_flow() {
    let child = sleep_command(30).group_spawn().expect("spawn child");
    let stop = CancellationToken::new();
    let executor_cancel = CancellationToken::new();
    let msg_store = Arc::new(MsgStore::new());
    let completion_status = Arc::new(AtomicU8::new(RunCompletionStatus::Succeeded.as_u8()));

    let watcher = tokio::spawn(ChatRunner::watch_executor_lifecycle_with_timeout(
        child,
        stop.clone(),
        Some(executor_cancel.clone()),
        None,
        msg_store.clone(),
        completion_status.clone(),
        empty_log_forwarders(),
        Uuid::new_v4(),
        std::time::Duration::from_millis(100),
    ));

    stop.cancel();
    tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    assert_eq!(finished_count(&msg_store), 0);

    watcher.await.expect("watcher complete");

    assert!(executor_cancel.is_cancelled());
    assert_eq!(
        RunCompletionStatus::from_atomic(&completion_status),
        RunCompletionStatus::Stopped
    );
    assert_eq!(finished_count(&msg_store), 1);
}

#[tokio::test]
async fn stop_request_waits_for_executor_exit_signal_before_finished() {
    let child = sleep_command(30).group_spawn().expect("spawn child");
    let stop = CancellationToken::new();
    let executor_cancel = CancellationToken::new();
    let msg_store = Arc::new(MsgStore::new());
    let completion_status = Arc::new(AtomicU8::new(RunCompletionStatus::Succeeded.as_u8()));
    let (exit_tx, exit_rx) = oneshot::channel();

    let watcher = tokio::spawn(ChatRunner::watch_executor_lifecycle_with_timeout(
        child,
        stop.clone(),
        Some(executor_cancel.clone()),
        Some(exit_rx),
        msg_store.clone(),
        completion_status.clone(),
        empty_log_forwarders(),
        Uuid::new_v4(),
        std::time::Duration::from_millis(100),
    ));

    stop.cancel();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert!(executor_cancel.is_cancelled());
    assert_eq!(finished_count(&msg_store), 0);

    exit_tx
        .send(executors::executors::ExecutorExitResult::Success)
        .expect("send exit signal");

    watcher.await.expect("watcher complete");

    assert_eq!(
        RunCompletionStatus::from_atomic(&completion_status),
        RunCompletionStatus::Stopped
    );
    assert_eq!(finished_count(&msg_store), 1);
}

#[tokio::test]
async fn stop_agent_cancels_pre_registered_run_control() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    let session_agent_id = Uuid::new_v4();
    let agent_id = Uuid::new_v4();

    sqlx::query(
        r#"
            INSERT INTO chat_session_agents (
                id,
                session_id,
                agent_id,
                state,
                workspace_path,
                pty_session_key,
                agent_session_id,
                agent_message_id,
                allowed_skill_ids
            )
            VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, NULL, ?5)
            "#,
    )
    .bind(session_agent_id)
    .bind(session_id)
    .bind(agent_id)
    .bind(ChatSessionAgentState::Running)
    .bind("[]")
    .execute(&db.pool)
    .await
    .expect("insert running session agent");

    let stop = runner.register_run_control(session_agent_id, Uuid::new_v4());

    runner
        .stop_agent(session_id, session_agent_id)
        .await
        .expect("stop agent");

    assert!(stop.is_cancelled());

    let session_agent = ChatSessionAgent::find_by_id(&db.pool, session_agent_id)
        .await
        .expect("lookup session agent")
        .expect("session agent exists");
    assert_eq!(session_agent.state, ChatSessionAgentState::Stopping);
}

#[tokio::test]
async fn stop_agent_without_run_control_recovers_agent_to_idle() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    let session_agent_id = Uuid::new_v4();
    let agent_id = Uuid::new_v4();
    let mut rx = runner.subscribe(session_id);

    sqlx::query(
        r#"
            INSERT INTO chat_session_agents (
                id,
                session_id,
                agent_id,
                state,
                workspace_path,
                pty_session_key,
                agent_session_id,
                agent_message_id,
                allowed_skill_ids
            )
            VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8)
            "#,
    )
    .bind(session_agent_id)
    .bind(session_id)
    .bind(agent_id)
    .bind(ChatSessionAgentState::Running)
    .bind("pty-123")
    .bind("agent-session-123")
    .bind("agent-message-123")
    .bind("[]")
    .execute(&db.pool)
    .await
    .expect("insert running session agent");

    runner
        .stop_agent(session_id, session_agent_id)
        .await
        .expect("stop agent");

    let session_agent = ChatSessionAgent::find_by_id(&db.pool, session_agent_id)
        .await
        .expect("lookup session agent")
        .expect("session agent exists");
    assert_eq!(session_agent.state, ChatSessionAgentState::Idle);
    assert_eq!(session_agent.pty_session_key, None);
    assert_eq!(session_agent.agent_session_id, None);
    assert_eq!(session_agent.agent_message_id, None);

    let event = rx.recv().await.expect("agent state event");
    match event {
        ChatStreamEvent::AgentState {
            session_agent_id: emitted_session_agent_id,
            agent_id: emitted_agent_id,
            state,
            run_id,
            started_at,
        } => {
            assert_eq!(emitted_session_agent_id, session_agent_id);
            assert_eq!(emitted_agent_id, agent_id);
            assert_eq!(state, ChatSessionAgentState::Idle);
            // Recovering an agent with no in-memory run control carries no run id.
            assert_eq!(run_id, None);
            assert_eq!(started_at, None);
        }
        other => panic!("unexpected event: {other:?}"),
    }
}

#[tokio::test]
async fn recover_orphaned_session_agents_resets_active_agents() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let running_session_agent_id = Uuid::new_v4();
    let stopping_session_agent_id = Uuid::new_v4();
    let idle_session_agent_id = Uuid::new_v4();

    for (session_agent_id, state) in [
        (running_session_agent_id, ChatSessionAgentState::Running),
        (stopping_session_agent_id, ChatSessionAgentState::Stopping),
        (idle_session_agent_id, ChatSessionAgentState::Idle),
    ] {
        sqlx::query(
            r#"
                INSERT INTO chat_session_agents (
                    id,
                    session_id,
                    agent_id,
                    state,
                    workspace_path,
                    pty_session_key,
                    agent_session_id,
                    agent_message_id,
                    allowed_skill_ids
                )
                VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8)
                "#,
        )
        .bind(session_agent_id)
        .bind(Uuid::new_v4())
        .bind(Uuid::new_v4())
        .bind(state)
        .bind(format!("pty-{session_agent_id}"))
        .bind(format!("agent-session-{session_agent_id}"))
        .bind(format!("agent-message-{session_agent_id}"))
        .bind("[]")
        .execute(&db.pool)
        .await
        .expect("insert session agent");
    }

    let recovered = runner
        .recover_orphaned_session_agents()
        .await
        .expect("recover orphaned session agents");
    assert_eq!(recovered, 2);

    let running = ChatSessionAgent::find_by_id(&db.pool, running_session_agent_id)
        .await
        .expect("lookup running agent")
        .expect("running agent exists");
    assert_eq!(running.state, ChatSessionAgentState::Idle);
    assert_eq!(running.pty_session_key, None);
    assert_eq!(running.agent_session_id, None);
    assert_eq!(running.agent_message_id, None);

    let stopping = ChatSessionAgent::find_by_id(&db.pool, stopping_session_agent_id)
        .await
        .expect("lookup stopping agent")
        .expect("stopping agent exists");
    assert_eq!(stopping.state, ChatSessionAgentState::Idle);
    assert_eq!(stopping.pty_session_key, None);
    assert_eq!(stopping.agent_session_id, None);
    assert_eq!(stopping.agent_message_id, None);

    let idle = ChatSessionAgent::find_by_id(&db.pool, idle_session_agent_id)
        .await
        .expect("lookup idle agent")
        .expect("idle agent exists");
    assert_eq!(idle.state, ChatSessionAgentState::Idle);
    assert!(idle.pty_session_key.is_some());
    assert!(idle.agent_session_id.is_some());
    assert!(idle.agent_message_id.is_some());
}

#[test]
fn parse_agent_protocol_messages_reports_json_error_detail() {
    let content = r#"
```json
[
  {"type":"send","to":"backend","content":"missing value","intent": }
]
```
"#;

    let err = ChatRunner::parse_agent_protocol_messages(content).expect_err("error");
    assert_eq!(err.code, ChatProtocolNoticeCode::InvalidJson);
    let detail = err.detail.expect("detail");
    assert!(detail.contains("line"));
    assert!(detail.contains("column"));
}

#[test]
fn parse_agent_protocol_messages_repairs_unescaped_quotes_from_run_0003() {
    let content = r#"All changes look correct. Now let me write the final implementation notes document and respond to the coordinator.

```json
[
  {"type": "artifact", "content": "T6 实现完成，变更文件：`frontend/src/lib/api.ts`（新增 `getSessionRunsRetention`）、`frontend/src/pages/ui-new/chat/types.ts`（新增 `RunRetentionState` 类型，`RunHistoryItem` 增加 `retention?` 字段）、`frontend/src/pages/ui-new/chat/hooks/useChatData.ts`（新增 `useRunRetention` hook）、`frontend/src/pages/ui-new/chat/index.ts`（导出 `useRunRetention`）、`frontend/src/pages/ui-new/chat/components/WorkspaceDrawer.tsx`（新增 `retentionByRunId` prop，View Log 按钮支持 pruned/tail/截断/降级状态展示）、`frontend/src/pages/ui-new/ChatSessions.tsx`（接入 `useRunRetention`，410 错误单独处理，传递 `retentionByRunId` 给 Drawer）。"},
  {"type": "record", "content": "frontend T6 已落地：run 列表通过 `useRunRetention(sessionId, runIds)` 拉取 `GET /api/chat/sessions/{session_id}/runs/retention`，按 runId map 后传入 WorkspaceDrawer；View Log 按钮在 `log_state=pruned` 时禁用并显示"日志已清理"，在 `log_state=tail` 时附加提示；`log_truncated`/`log_capture_degraded`/`artifact_state` 以 badge 形式展示；`handleLoadLog` 对 HTTP 410 单独提示"日志已按保留策略清理"。"},
  {"type": "send", "to": "coordinator", "intent": "notify", "content": "T6 实现完成。已接入 retention 接口、新增 `useRunRetention` hook、WorkspaceDrawer 支持 pruned/tail/截断/降级/stub/artifactPruned 状态展示，`handleLoadLog` 对 410 单独处理。共变更 6 个文件，均以 T4 API 契约为准，`/log` 的 410 处理位已预留。"},
  {"type": "conclusion", "content": "T6 retention 前端实现已全部落地，5 个目标文件加 index.ts 共 6 处改动。`/log` 的 410 处理位已按 T4 契约预留，后续 T5 落地后无需额外适配。"}
]
```"#;

    let messages = ChatRunner::parse_agent_protocol_messages(content).expect("messages");
    assert_eq!(messages.len(), 4);
    assert!(matches!(
        messages[0].message_type,
        AgentProtocolMessageType::Artifact
    ));
    assert!(matches!(
        messages[1].message_type,
        AgentProtocolMessageType::Record
    ));
    assert!(messages[1].content.contains("\"日志已清理\""));
    assert!(matches!(
        messages[2].message_type,
        AgentProtocolMessageType::Send
    ));
    assert_eq!(messages[2].to.as_deref(), Some("coordinator"));
    assert_eq!(messages[2].intent.as_deref(), Some("notify"));
    assert!(matches!(
        messages[3].message_type,
        AgentProtocolMessageType::Conclusion
    ));
}

#[test]
fn parse_agent_protocol_messages_repairs_unescaped_quotes_from_run_0004() {
    let content = r#"```json
[
  {"type": "conclusion", "content": "T6 实现已在上一轮完成，契约已按 T4 文档落地：`getSessionRunsRetention` 使用逗号分隔 `run_ids`，`handleLoadLog` 对 HTTP 410 单独提示"日志已按保留策略清理"，与 `Chat run log expired` 响应对应。无待处理项。"}
]
```"#;

    let messages = ChatRunner::parse_agent_protocol_messages(content).expect("messages");
    assert_eq!(messages.len(), 1);
    assert!(matches!(
        messages[0].message_type,
        AgentProtocolMessageType::Conclusion
    ));
    assert!(messages[0].content.contains("\"日志已按保留策略清理\""));
}

#[test]
fn parse_agent_protocol_messages_repairs_unescaped_quotes_from_run_0005() {
    let content = r#"```json
[
  {"type": "artifact", "content": "T6 完成报告已写入 `.openteams/context/3058d52b-0264-416f-a787-d2346c012f07/frontend-t6-completion-report.md`，包含 6 个变更文件、核心改动点和契约对接验证表。"},
  {"type": "record", "content": "frontend T6 已完成交付：`useRunRetention` hook 接入 `GET /api/chat/sessions/{session_id}/runs/retention`；WorkspaceDrawer 对 `log_state=pruned/tail`、`log_truncated`、`log_capture_degraded`、`artifact_state=stub/pruned` 实现了独立 UI 渲染；`handleLoadLog` 对 HTTP 410 单独提示"日志已按保留策略清理"，与 `Chat run log expired` 响应对应。"},
  {"type": "send", "to": "coordinator", "intent": "notify", "content": "T6 已完成收口。6 个文件变更：`api.ts`（retention 接口）、`chat/types.ts`（类型）、`useChatData.ts`（hook）、`index.ts`（导出）、`WorkspaceDrawer.tsx`（retention UI）、`ChatSessions.tsx`（410 处理 + retention 注入）。报告见 `frontend-t6-completion-report.md`。唯一未覆盖项：response header 未解析（retention API 已能提前感知状态，无阻塞）。"},
  {"type": "conclusion", "content": "T6 实现已全量落地，与 T4/T5 契约完全对齐。6 个文件改动包含 retention 状态展示、View Log 禁用态和 410 Gone 单独处理。`X-OpenTeams-Log-State` header 解析为非必要项，未实现但不影响功能完整性。"}
]
```"#;

    let messages = ChatRunner::parse_agent_protocol_messages(content).expect("messages");
    assert_eq!(messages.len(), 4);
    assert!(matches!(
        messages[0].message_type,
        AgentProtocolMessageType::Artifact
    ));
    assert!(matches!(
        messages[1].message_type,
        AgentProtocolMessageType::Record
    ));
    assert!(messages[1].content.contains("\"日志已按保留策略清理\""));
    assert!(matches!(
        messages[2].message_type,
        AgentProtocolMessageType::Send
    ));
    assert!(matches!(
        messages[3].message_type,
        AgentProtocolMessageType::Conclusion
    ));
}

#[test]
fn should_handle_protocol_error_as_raw_output_only_for_json_shape_errors() {
    let invalid_json = AgentProtocolError {
        code: ChatProtocolNoticeCode::InvalidJson,
        target: None,
        detail: None,
    };
    let not_json_array = AgentProtocolError {
        code: ChatProtocolNoticeCode::NotJsonArray,
        target: None,
        detail: None,
    };
    let missing_target = AgentProtocolError {
        code: ChatProtocolNoticeCode::MissingSendTarget,
        target: None,
        detail: None,
    };
    let empty_message = AgentProtocolError {
        code: ChatProtocolNoticeCode::EmptyMessage,
        target: None,
        detail: None,
    };

    assert!(ChatRunner::should_handle_protocol_error_as_raw_output(
        &invalid_json
    ));
    assert!(ChatRunner::should_handle_protocol_error_as_raw_output(
        &not_json_array
    ));
    assert!(!ChatRunner::should_handle_protocol_error_as_raw_output(
        &empty_message
    ));
    assert!(!ChatRunner::should_handle_protocol_error_as_raw_output(
        &missing_target
    ));
}

#[tokio::test]
async fn process_agent_protocol_output_requests_retry_for_first_json_shape_failure() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    insert_test_chat_session(&db, session_id).await;

    let result = runner
        .process_agent_protocol_output(
            session_id,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "coder",
            Uuid::new_v4(),
            Uuid::new_v4(),
            None,
            0,
            ResolvedPromptLanguage {
                setting: "english",
                code: "en",
                instruction: "You MUST respond in English.",
            },
            r#"{"type":"send","to":"you","content":"object is not allowed"}"#,
            None,
            None,
            false,
            None,
            0,
        )
        .await
        .expect("process protocol output");

    match result {
        super::ProtocolProcessResult::RetryableParseFailure { code, .. } => {
            assert_eq!(code, ChatProtocolNoticeCode::NotJsonArray);
        }
        other => panic!("expected retryable parse failure, got {other:?}"),
    }

    let messages = ChatMessage::find_by_session_id(&db.pool, session_id, None)
        .await
        .expect("list messages");
    assert!(messages.is_empty());
}

#[tokio::test]
async fn process_agent_protocol_output_uses_raw_output_after_retry_exhaustion() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    insert_test_chat_session(&db, session_id).await;
    let run_id = Uuid::new_v4();

    let result = runner
        .process_agent_protocol_output(
            session_id,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "coder",
            run_id,
            Uuid::new_v4(),
            None,
            0,
            ResolvedPromptLanguage {
                setting: "english",
                code: "en",
                instruction: "You MUST respond in English.",
            },
            "still not json",
            None,
            None,
            false,
            None,
            MAX_PROTOCOL_PARSE_RETRIES,
        )
        .await
        .expect("process protocol output");

    assert!(matches!(result, super::ProtocolProcessResult::Success(1)));

    let messages = ChatMessage::find_by_session_id(&db.pool, session_id, None)
        .await
        .expect("list messages");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].sender_type, ChatSenderType::Agent);
    assert_eq!(messages[0].content, "still not json");
    assert_eq!(messages[0].meta["protocol"]["mode"], json!("raw_fallback"));
    assert_eq!(messages[0].meta["run_id"], json!(run_id));
}

#[tokio::test]
async fn process_agent_protocol_output_uses_conclusion_when_no_send() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    insert_test_chat_session(&db, session_id).await;

    let result = runner
        .process_agent_protocol_output(
            session_id,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "coder",
            Uuid::new_v4(),
            Uuid::new_v4(),
            None,
            0,
            ResolvedPromptLanguage {
                setting: "english",
                code: "en",
                instruction: "You MUST respond in English.",
            },
            r#"[{"type":"record","content":"shared fact"},{"type":"conclusion","content":"done"}]"#,
            None,
            None,
            false,
            None,
            0,
        )
        .await
        .expect("process protocol output");

    assert!(matches!(result, super::ProtocolProcessResult::Success(1)));
    let messages = ChatMessage::find_by_session_id(&db.pool, session_id, None)
        .await
        .expect("list messages");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].sender_type, ChatSenderType::Agent);
    assert_eq!(messages[0].content, "done");
    assert_eq!(messages[0].meta["protocol"]["type"], json!("conclusion"));
    assert_eq!(
        messages[0].meta["protocol"]["mode"],
        json!("display_fallback")
    );
}

#[tokio::test]
async fn process_agent_protocol_output_uses_record_when_no_send_or_conclusion() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    insert_test_chat_session(&db, session_id).await;

    let result = runner
        .process_agent_protocol_output(
            session_id,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "coder",
            Uuid::new_v4(),
            Uuid::new_v4(),
            None,
            0,
            ResolvedPromptLanguage {
                setting: "english",
                code: "en",
                instruction: "You MUST respond in English.",
            },
            r#"[{"type":"record","content":"shared fact"}]"#,
            None,
            None,
            false,
            None,
            0,
        )
        .await
        .expect("process protocol output");

    assert!(matches!(result, super::ProtocolProcessResult::Success(1)));
    let messages = ChatMessage::find_by_session_id(&db.pool, session_id, None)
        .await
        .expect("list messages");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].sender_type, ChatSenderType::Agent);
    assert_eq!(messages[0].content, "shared fact");
    assert_eq!(messages[0].meta["protocol"]["type"], json!("record"));
}

#[tokio::test]
async fn process_agent_protocol_output_persists_error_when_output_empty() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    insert_test_chat_session(&db, session_id).await;

    let result = runner
        .process_agent_protocol_output(
            session_id,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "coder",
            Uuid::new_v4(),
            Uuid::new_v4(),
            None,
            0,
            ResolvedPromptLanguage {
                setting: "english",
                code: "en",
                instruction: "You MUST respond in English.",
            },
            "",
            Some("CLI failed before writing output"),
            None,
            false,
            None,
            0,
        )
        .await
        .expect("process protocol output");

    assert!(matches!(result, super::ProtocolProcessResult::Success(1)));
    let messages = ChatMessage::find_by_session_id(&db.pool, session_id, None)
        .await
        .expect("list messages");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].sender_type, ChatSenderType::Agent);
    assert_eq!(messages[0].content, "CLI failed before writing output");
    assert_eq!(messages[0].meta["protocol"]["output_is_empty"], json!(true));
}

#[tokio::test]
async fn process_agent_protocol_output_persists_failure_hint_when_output_empty() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    insert_test_chat_session(&db, session_id).await;

    let result = runner
        .process_agent_protocol_output(
            session_id,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "coder",
            Uuid::new_v4(),
            Uuid::new_v4(),
            None,
            0,
            ResolvedPromptLanguage {
                setting: "english",
                code: "en",
                instruction: "You MUST respond in English.",
            },
            "",
            None,
            None,
            false,
            None,
            0,
        )
        .await
        .expect("process protocol output");

    assert!(matches!(result, super::ProtocolProcessResult::Success(1)));
    let messages = ChatMessage::find_by_session_id(&db.pool, session_id, None)
        .await
        .expect("list messages");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].sender_type, ChatSenderType::Agent);
    assert_eq!(messages[0].content, "Agent运行失败");
    assert_eq!(messages[0].meta["protocol"]["output_is_empty"], json!(true));
    assert_eq!(messages[0].meta["i18n"]["key"], json!("agent.runFailed"));
}

#[tokio::test]
async fn process_agent_protocol_output_persists_stopped_hint_when_stopped_empty() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    insert_test_chat_session(&db, session_id).await;

    let result = runner
        .process_agent_protocol_output(
            session_id,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "coder",
            Uuid::new_v4(),
            Uuid::new_v4(),
            None,
            0,
            ResolvedPromptLanguage {
                setting: "simplified_chinese",
                code: "zh-Hans",
                instruction: "You MUST respond in Simplified Chinese.",
            },
            "",
            None,
            None,
            true,
            None,
            0,
        )
        .await
        .expect("process protocol output");

    assert!(matches!(result, super::ProtocolProcessResult::Success(1)));
    let messages = ChatMessage::find_by_session_id(&db.pool, session_id, None)
        .await
        .expect("list messages");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].sender_type, ChatSenderType::Agent);
    assert_eq!(messages[0].content, "Agent停止运行");
    assert_eq!(messages[0].meta["protocol"]["output_is_empty"], json!(true));
    assert_eq!(messages[0].meta["i18n"]["key"], json!("agent.stopped"));
}

#[test]
fn markdown_protocol_output_example_json_is_valid() {
    let messages = ChatRunner::parse_agent_protocol_messages(MARKDOWN_PROTOCOL_OUTPUT_EXAMPLE_JSON)
        .expect("json");
    assert_eq!(messages.len(), 3);
    assert!(matches!(
        messages.first().map(|message| &message.message_type),
        Some(AgentProtocolMessageType::Send)
    ));
    assert_eq!(messages[0].intent.as_deref(), Some("request"));
    assert!(matches!(
        messages[1].message_type,
        AgentProtocolMessageType::Record
    ));
}

#[test]
fn resolve_prompt_language_from_value_returns_concrete_language_setting() {
    let language = ChatRunner::resolve_prompt_language_from_value("zh-Hans").expect("language");
    assert_eq!(language.setting, "simplified_chinese");
    assert_eq!(language.code, "zh-Hans");
    assert_eq!(
        language.instruction,
        "You MUST respond in Simplified Chinese."
    );
}

#[test]
fn resolve_prompt_language_from_ui_language_never_returns_browser_setting() {
    let language = ChatRunner::resolve_prompt_language_from_ui_language(&UiLanguage::Browser);
    assert_eq!(language.setting, "english");
    assert_eq!(language.code, "en");
    assert_eq!(language.instruction, "You MUST respond in English.");
}

#[test]
fn resolve_prompt_language_uses_system_locale_when_browser_is_configured() {
    let message = test_message("Please answer this in English.", serde_json::json!({}));
    let language = ChatRunner::resolve_prompt_language_with_system_locale(
        &message,
        &UiLanguage::Browser,
        Some("fr-CA"),
    );
    assert_eq!(language.setting, "french");
    assert_eq!(language.code, "fr");
    assert_eq!(language.instruction, "You MUST respond in French.");
}

#[test]
fn resolve_prompt_language_prefers_message_meta_over_system_locale() {
    let message = test_message(
        "Please answer this in English.",
        serde_json::json!({ "app_language": "zh-Hant" }),
    );
    let language = ChatRunner::resolve_prompt_language_with_system_locale(
        &message,
        &UiLanguage::Browser,
        Some("fr-CA"),
    );
    assert_eq!(language.setting, "traditional_chinese");
    assert_eq!(language.code, "zh-Hant");
    assert_eq!(
        language.instruction,
        "You MUST respond in Traditional Chinese."
    );
}

#[test]
fn infer_prompt_language_prefers_traditional_chinese_hint_chars() {
    let language =
        ChatRunner::infer_prompt_language_from_text("\u{81fa}\u{7063}").expect("language");
    assert_eq!(language.setting, "traditional_chinese");
    assert_eq!(language.code, "zh-Hant");
    assert_eq!(
        language.instruction,
        "You MUST respond in Traditional Chinese."
    );
}

#[test]
fn infer_prompt_language_detects_spanish_accented_punctuation() {
    let language =
        ChatRunner::infer_prompt_language_from_text("\u{00bf}Como estas?").expect("language");
    assert_eq!(language.setting, "spanish");
    assert_eq!(language.code, "es");
    assert_eq!(language.instruction, "You MUST respond in Spanish.");
}

#[test]
fn infer_prompt_language_detects_french_accented_letters() {
    let language =
        ChatRunner::infer_prompt_language_from_text("\u{00e9}l\u{00e8}ve").expect("language");
    assert_eq!(language.setting, "french");
    assert_eq!(language.code, "fr");
    assert_eq!(language.instruction, "You MUST respond in French.");
}

#[test]
fn resolve_message_sender_identity_uses_agent_sender_label() {
    let agent_id = Uuid::new_v4();
    let message = test_message_with_sender(
        ChatSenderType::Agent,
        Some(agent_id),
        "@product hello",
        json!({
            "sender": {
                "label": "architect",
                "name": "architect"
            },
            "structured": {
                "sender_label": "architect"
            }
        }),
    );

    let sender = ChatRunner::resolve_message_sender_identity(&message);
    assert_eq!(sender.label, "architect");
    assert_eq!(sender.address, "agent:architect");
}

#[test]
fn build_protocol_send_message_meta_includes_token_usage() {
    let token_usage = TokenUsageInfo {
        total_tokens: 2048,
        model_context_window: 128000,
        input_tokens: Some(1536),
        output_tokens: Some(512),
        reasoning_output_tokens: None,
        cache_read_tokens: Some(256),
        runtime_agent: Some("codex".to_string()),
        runtime_model_id: Some("gpt-5".to_string()),
        provider_id: Some("openai".to_string()),
        runtime_thread_id: Some("thread-1".to_string()),
        usage_scope: Some("turn_delta".to_string()),
        snapshot_total_tokens: None,
        snapshot_input_tokens: None,
        snapshot_output_tokens: None,
        snapshot_reasoning_output_tokens: None,
        snapshot_cache_read_tokens: None,
        is_estimated: false,
    };

    let meta = ChatRunner::build_protocol_send_message_meta(
        "zh-Hans",
        Uuid::nil(),
        Uuid::nil(),
        Uuid::nil(),
        Some("client-message-1"),
        0,
        "you",
        0,
        Some("reply"),
        Some("The receiver should reply."),
        Some(&token_usage),
    );

    assert_eq!(meta["app_language"], json!("zh-Hans"));
    assert_eq!(meta["protocol"]["type"], json!("send"));
    assert_eq!(meta["protocol"]["to"], json!("you"));
    assert_eq!(meta["protocol"]["intent"], json!("reply"));
    assert_eq!(meta["client_message_id"], json!("client-message-1"));
    assert_eq!(
        meta["token_usage"]["total_tokens"],
        json!(token_usage.total_tokens)
    );
    assert_eq!(
        meta["token_usage"]["model_context_window"],
        json!(token_usage.model_context_window)
    );
    assert_eq!(
        meta["token_usage"]["input_tokens"],
        json!(token_usage.input_tokens)
    );
    assert_eq!(
        meta["token_usage"]["output_tokens"],
        json!(token_usage.output_tokens)
    );
    assert_eq!(
        meta["token_usage"]["is_estimated"],
        json!(token_usage.is_estimated)
    );
}

#[test]
fn build_exact_markdown_prompt_includes_routed_message_intent_meaning() {
    let agent = test_agent("product", "");
    let message = test_message_with_sender(
        ChatSenderType::Agent,
        Some(Uuid::new_v4()),
        "@product Please confirm the delivery scope",
        json!({
            "sender": {
                "label": "architect",
                "name": "architect"
            },
            "protocol": {
                "type": "send",
                "to": "product",
                "intent": "confirm"
            }
        }),
    );

    let prompt = ChatRunner::build_exact_markdown_prompt(
        &agent,
        &message,
        Path::new(r"E:\workspace\projectSS\MainPage2\.openteams\context\demo"),
        Path::new(r"E:\workspace\projectSS\MainPage2"),
        &[],
        None,
        None,
        &[],
        ResolvedPromptLanguage {
            setting: "english",
            code: "en",
            instruction: "You MUST respond in English.",
        },
        Some("Follow the team protocol."),
    );

    assert!(prompt.contains("- intent: confirm"));
    assert!(prompt.contains("- intent_meaning: Explicit confirmation is required."));
    assert!(prompt.contains("## Team Protocol"));
    assert!(prompt.contains("Follow the team protocol."));
}

#[test]
fn build_exact_markdown_prompt_declares_active_workspace_as_project_repo() {
    let agent = test_agent("worker", "");
    let message = test_message("@worker inspect the repo", json!({}));
    let workspace_path = Path::new(r"C:\Users\Admin\AppData\Local\Temp\openteams-dev\worktrees\sessions\34a8ed29");

    let prompt = ChatRunner::build_exact_markdown_prompt(
        &agent,
        &message,
        &workspace_path.join(".openteams").join("context").join("demo"),
        workspace_path,
        &[],
        None,
        None,
        &[],
        ResolvedPromptLanguage {
            setting: "english",
            code: "en",
            instruction: "You MUST respond in English.",
        },
        None,
    );

    assert!(prompt.contains("## Workspace"));
    assert!(prompt.contains("Active workspace path"));
    assert!(prompt.contains("Treat this active workspace path as the project repository"));
    assert!(prompt.contains(r"C:\Users\Admin\AppData\Local\Temp\openteams-dev\worktrees\sessions\34a8ed29"));
}

#[tokio::test]
async fn prompt_after_worktree_discard_declares_base_workspace() {
    let db = setup_chat_runner_db().await;
    let runner = ChatRunner::new(db.clone());
    let session_id = Uuid::new_v4();
    let agent_id = Uuid::new_v4();
    let base_workspace = "E:/workspace/base";
    let worktree_workspace = "E:/workspace/.openteams/worktrees/session";

    sqlx::query(
        r#"
        INSERT INTO chat_sessions (
            id, title, status, default_workspace_path, worktree_mode
        )
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
    )
    .bind(session_id)
    .bind("discarded isolated session")
    .bind(ChatSessionStatus::Active)
    .bind(base_workspace)
    .bind(ChatSessionWorktreeMode::Isolated)
    .execute(&db.pool)
    .await
    .expect("insert isolated session");

    sqlx::query(
        r#"
        INSERT INTO chat_session_agents (
            id, session_id, agent_id, state, workspace_path
        )
        VALUES (?1, ?2, ?3, 'idle', ?4)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(session_id)
    .bind(agent_id)
    .bind(worktree_workspace)
    .execute(&db.pool)
    .await
    .expect("insert session agent");

    sqlx::query(
        r#"
        INSERT INTO chat_session_worktrees (
            id, session_id, base_workspace_path, repo_path, base_branch,
            branch_name, worktree_path, mode, status, merged_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'session', 'merged', datetime('now', 'subsec'))
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(session_id)
    .bind(base_workspace)
    .bind(base_workspace)
    .bind("main")
    .bind("openteams/session/test")
    .bind(worktree_workspace)
    .execute(&db.pool)
    .await
    .expect("insert merged worktree row");

    SessionWorktreeService::new(db.pool.clone())
        .discard_worktree(session_id)
        .await
        .expect("discard worktree");

    let resolved = runner
        .resolve_workspace_path_for_agent(
            session_id,
            agent_id,
            Some(worktree_workspace.to_string()),
        )
        .await
        .expect("resolve workspace");
    assert_eq!(resolved, base_workspace);

    let agent = test_agent("worker", "");
    let message = test_message("@worker inspect the repo", json!({}));
    let workspace_path = Path::new(&resolved);
    let prompt = ChatRunner::build_exact_markdown_prompt(
        &agent,
        &message,
        &workspace_path.join(".openteams").join("context").join("demo"),
        workspace_path,
        &[],
        None,
        None,
        &[],
        ResolvedPromptLanguage {
            setting: "english",
            code: "en",
            instruction: "You MUST respond in English.",
        },
        None,
    );

    assert!(prompt.contains("Active workspace path: `E:/workspace/base`"));
    assert!(!prompt.contains(worktree_workspace));
}

#[test]
fn build_exact_markdown_prompt_tells_notify_receiver_not_to_reply() {
    let agent = test_agent("coordinator", "");
    let message = test_message_with_sender(
        ChatSenderType::Agent,
        Some(Uuid::new_v4()),
        "@coordinator Frontend task is done",
        json!({
            "sender": {
                "label": "frontend",
                "name": "frontend"
            },
            "protocol": {
                "type": "send",
                "to": "coordinator",
                "intent": "notify"
            }
        }),
    );

    let prompt = ChatRunner::build_exact_markdown_prompt(
        &agent,
        &message,
        Path::new(r"E:\workspace\projectSS\MainPage2\.openteams\context\demo"),
        Path::new(r"E:\workspace\projectSS\MainPage2"),
        &[],
        None,
        None,
        &[],
        ResolvedPromptLanguage {
            setting: "english",
            code: "en",
            instruction: "You MUST respond in English.",
        },
        Some("Follow the team protocol."),
    );

    assert!(prompt.contains("- intent: notify"));
    assert!(prompt.contains("- intent_meaning: Informational only. Do not send a reply."));
    assert!(prompt.contains(
        "- response_requirement: Notification only. Do not send a reply or acknowledgment to the sender."
    ));
}

#[test]
fn build_exact_markdown_prompt_includes_team_protocol_section_when_empty() {
    let agent = test_agent("product", "You are the Product Manager.");
    let message = test_message_with_sender(ChatSenderType::User, None, "@product hello", json!({}));

    let prompt = ChatRunner::build_exact_markdown_prompt(
        &agent,
        &message,
        Path::new(r"E:\workspace\projectSS\MainPage2\.openteams\context\demo"),
        Path::new(r"E:\workspace\projectSS\MainPage2"),
        &[],
        None,
        None,
        &[],
        ResolvedPromptLanguage {
            setting: "english",
            code: "en",
            instruction: "You MUST respond in English.",
        },
        Some(" "),
    );

    assert!(prompt.contains("## Team Protocol"));
    assert!(prompt.contains("No team protocol configured."));
}

#[test]
fn artifact_path_extraction_allows_explicit_openteams_runtime_paths() {
    let paths = super::extract_workspace_paths_from_artifact_text(
        "Saved `.openteams/context/demo/messages.jsonl`, `.openteams/context/demo/attachments/message-1/input.txt`, and `src/app.ts`.",
        Path::new(r"E:\workspace\projectSS\MainPage2"),
    );

    assert!(paths.contains(&".openteams/context/demo/messages.jsonl".to_string()));
    assert!(paths.contains(&".openteams/context/demo/attachments/message-1/input.txt".to_string()));
    assert!(paths.contains(&"src/app.ts".to_string()));
    assert_eq!(paths.len(), 3);
}

#[test]
fn file_change_refresh_excludes_openteams_artifact_paths() {
    let changes = ChatRunner::file_change_entries_from_observed(&[
        super::WorkspaceObservedPathEntry {
            path: ".openteams/context/demo/report.md".to_string(),
            source: "artifact_record".to_string(),
            existed_after_run: true,
            modified_at: None,
        },
        super::WorkspaceObservedPathEntry {
            path: "src/app.ts".to_string(),
            source: "git_diff".to_string(),
            existed_after_run: true,
            modified_at: None,
        },
    ]);

    let paths = changes
        .iter()
        .map(|entry| entry.path.as_str())
        .collect::<Vec<_>>();
    assert_eq!(paths, vec!["src/app.ts"]);
}

#[test]
fn build_exact_markdown_prompt_matches_expected_input_template() {
    let session_id = Uuid::parse_str("1475cda0-6f11-464e-a61a-7dc81217810e").expect("uuid");
    let message_id = Uuid::parse_str("88bd7b05-1ba3-407c-8ca3-a52f14c8aced").expect("uuid");
    let created_at = chrono::DateTime::parse_from_rfc3339("2026-03-10T06:22:12.973Z")
        .expect("timestamp")
        .with_timezone(&Utc);
    let agent = ChatAgent {
            id: Uuid::new_v4(),
            name: "fullstack".to_string(),
            runner_type: "codex".to_string(),
            system_prompt: "You are the team \"Full-stack Engineer\". Your goal is to ship complete user-facing capabilities by aligning backend contracts, frontend behavior, and operational reliability.\n\n\n".to_string(),
            model_name: None,
            owner_project_id: None,
            tools_enabled: sqlx::types::Json(json!({})),
            created_at,
            updated_at: created_at,
        };
    let message = ChatMessage {
        id: message_id,
        session_id,
        sender_type: ChatSenderType::User,
        sender_id: None,
        content: "@fullstack ".to_string(),
        mentions: sqlx::types::Json(vec!["fullstack".to_string()]),
        meta: sqlx::types::Json(json!({})),
        created_at,
    };

    let prompt = ChatRunner::build_exact_markdown_prompt(
        &agent,
        &message,
        Path::new(
            r"E:\workspace\projectSS\MainPage2\.openteams\context\1475cda0-6f11-464e-a61a-7dc81217810e",
        ),
        Path::new(r"E:\workspace\projectSS\MainPage2"),
        &[],
        None,
        None,
        &[],
        ResolvedPromptLanguage {
            setting: "simplified_chinese",
            code: "zh-Hans",
            instruction: "You MUST respond in Simplified Chinese.",
        },
        Some("Follow the team protocol."),
    );

    // Verify key sections exist instead of exact string match
    assert!(prompt.contains("# Chat Message"));
    assert!(prompt.contains("## Input Message"));
    assert!(prompt.contains("- sender: you"));
    assert!(prompt.contains("@fullstack"));
    assert!(prompt.contains("## Output Requirements"));
    assert!(prompt.contains("### Rules"));
    assert!(prompt.contains("### Schema"));
    assert!(prompt.contains("send.to"));
    assert!(prompt.contains("record`: long-lived shared facts only."));
    assert!(prompt.contains("artifact`: deliverables or file paths only."));
    assert!(prompt.contains("conclusion`: current-turn summary only"));
    assert!(prompt.contains(PROTOCOL_OUTPUT_SCHEMA_JSON));
    assert!(prompt.contains("### Example"));
    assert!(!prompt.contains("`workflow_generate`"));
    assert!(prompt.contains("## Agent"));
    assert!(prompt.contains("- name: fullstack"));
    assert!(prompt.contains("Full-stack Engineer"));
    assert!(prompt.contains("## Using language:"));
    assert!(prompt.contains("simplified_chinese"));
    assert!(prompt.contains("## Team Protocol"));
    assert!(prompt.contains("Follow the team protocol."));
    assert!(prompt.contains("## Group Members"));
    assert!(prompt.contains("## History"));
    let prompt_normalized = prompt.replace('\\', "/");
    assert!(
        prompt_normalized
            .contains(".openteams/context/1475cda0-6f11-464e-a61a-7dc81217810e/messages.jsonl")
    );
    assert!(prompt_normalized.contains(
        ".openteams/context/1475cda0-6f11-464e-a61a-7dc81217810e/shared_blackboard.jsonl"
    ));
    assert!(
        prompt_normalized
            .contains(".openteams/context/1475cda0-6f11-464e-a61a-7dc81217810e/work_records.jsonl")
    );
    assert!(prompt.contains("## Current Turn"));
    assert!(prompt.contains("## Envelope"));
    assert!(prompt.contains("- session_id: 1475cda0-6f11-464e-a61a-7dc81217810e"));
    assert!(prompt.contains("- from: user:you"));
    assert!(prompt.contains("- to: agent:fullstack"));
    assert!(prompt.contains("- message_id: 88bd7b05-1ba3-407c-8ca3-a52f14c8aced"));
    assert!(prompt.contains("- timestamp: 2026-03-10 06:22:12.973 UTC"));
    assert!(
        prompt
            .find("## Output Requirements")
            .expect("output requirements section")
            < prompt
                .find("## Current Turn")
                .expect("current turn section")
    );
    assert!(
        prompt.find("## History").expect("history section")
            < prompt
                .find("## Current Turn")
                .expect("current turn section")
    );
}

#[test]
fn build_exact_markdown_prompt_restricts_send_targets_in_workflow_mode() {
    let agent = test_agent("planner", "Workflow lead");
    let message = test_message(
        "Generate a workflow plan",
        json!({ "chat_input_mode": "workflow" }),
    );

    let prompt = ChatRunner::build_exact_markdown_prompt(
        &agent,
        &message,
        Path::new(r"E:\workspace\projectSS\MainPage2\.openteams\context\demo"),
        Path::new(r"E:\workspace\projectSS\MainPage2"),
        &[],
        None,
        None,
        &[],
        ResolvedPromptLanguage {
            setting: "simplified_chinese",
            code: "zh-Hans",
            instruction: "You MUST respond in Simplified Chinese.",
        },
        None,
    );

    assert!(prompt.contains("Workflow mode: `send.to` may only be `\"you\"`"));
    assert!(prompt.contains("do not send workflow-mode messages to other agents"));
    assert!(!prompt.contains("`send.to` must match a group member name"));
    assert!(prompt.contains("`workflow_generate`"));
    assert!(prompt.contains("plan_check"));
    assert!(prompt.contains(
        "Emit `workflow_generate` only when the user explicitly asks to start generating an execution plan."
    ));
    assert!(prompt.contains("`生成计划`, `开始执行`, `开始落实`, `进入执行`"));
}

#[test]
fn build_exact_markdown_prompt_keeps_current_turn_after_stable_prefix() {
    let agent = test_agent("planner", "Workflow lead");
    let first_message = test_message(
        "Generate a workflow plan for task A",
        json!({ "chat_input_mode": "workflow" }),
    );
    let second_message = test_message(
        "Generate a workflow plan for task B",
        json!({ "chat_input_mode": "workflow" }),
    );

    let first_prompt = ChatRunner::build_exact_markdown_prompt(
        &agent,
        &first_message,
        Path::new(r"E:\workspace\projectSS\MainPage2\.openteams\context\demo"),
        Path::new(r"E:\workspace\projectSS\MainPage2"),
        &[],
        None,
        None,
        &[],
        ResolvedPromptLanguage {
            setting: "simplified_chinese",
            code: "zh-Hans",
            instruction: "You MUST respond in Simplified Chinese.",
        },
        None,
    );
    let second_prompt = ChatRunner::build_exact_markdown_prompt(
        &agent,
        &second_message,
        Path::new(r"E:\workspace\projectSS\MainPage2\.openteams\context\demo"),
        Path::new(r"E:\workspace\projectSS\MainPage2"),
        &[],
        None,
        None,
        &[],
        ResolvedPromptLanguage {
            setting: "simplified_chinese",
            code: "zh-Hans",
            instruction: "You MUST respond in Simplified Chinese.",
        },
        None,
    );

    let first_prefix = first_prompt
        .split_once("## Current Turn")
        .expect("current turn section")
        .0;
    let second_prefix = second_prompt
        .split_once("## Current Turn")
        .expect("current turn section")
        .0;
    assert_eq!(first_prefix, second_prefix);
    assert!(first_prompt.contains("Generate a workflow plan for task A"));
    assert!(second_prompt.contains("Generate a workflow plan for task B"));
}

#[test]
fn build_exact_markdown_prompt_for_protocol_retry_omits_agent_and_team_protocol_sections() {
    let agent = test_agent("fullstack", "Full-stack Engineer");
    let message = test_message(
        "Your previous response was not a valid JSON array.\nPrevious input message:\n<BEGIN_INPUT_MESSAGE>\n@fullstack fix the API\n<END_INPUT_MESSAGE>",
        json!({
            "protocol_retry": { "attempt": 1, "previous_run_id": Uuid::new_v4() }
        }),
    );

    let prompt = ChatRunner::build_exact_markdown_prompt(
        &agent,
        &message,
        Path::new(r"E:\workspace\projectSS\MainPage2\.openteams\context\demo"),
        Path::new(r"E:\workspace\projectSS\MainPage2"),
        &[],
        None,
        None,
        &[],
        ResolvedPromptLanguage {
            setting: "simplified_chinese",
            code: "zh-Hans",
            instruction: "You MUST respond in Simplified Chinese.",
        },
        Some("Follow the team protocol."),
    );

    assert!(prompt.contains("## Input Message"));
    assert!(prompt.contains("<BEGIN_INPUT_MESSAGE>"));
    assert!(prompt.contains("@fullstack fix the API"));
    assert!(!prompt.contains("## Agent"));
    assert!(!prompt.contains("## Team Protocol"));
}

#[test]
fn strip_embedded_team_protocol_from_system_prompt_removes_legacy_embedded_block() {
    let prompt = ChatRunner::strip_embedded_team_protocol_from_system_prompt(
        "You are the team \"Backend Engineer\".\n\n(Embedded: Team Collaboration Protocol)\nFollow the team protocol.\n\nInputs:\n- input\n\nOutput format:\n- output",
    );

    assert_eq!(
        prompt,
        "You are the team \"Backend Engineer\".\n\nInputs:\n- input\n\nOutput format:\n- output"
    );
}

#[test]
fn resolve_team_protocol_guidelines_falls_back_when_empty() {
    let prompt = ChatRunner::resolve_team_protocol_guidelines(Some(" "));

    assert_eq!(prompt, "no team collaboration protocol");
}

#[tokio::test]
async fn capture_untracked_files_allows_user_openteams_files_but_skips_runtime_artifacts() {
    let tempdir = tempfile::tempdir().expect("create tempdir");
    let repo_path = tempdir.path().join("repo");
    git2::Repository::init(&repo_path).expect("init repo");

    std::fs::create_dir_all(repo_path.join("binaries")).expect("create binaries dir");
    std::fs::write(repo_path.join("binaries").join("test.txt"), "binary\n")
        .expect("write binaries file");
    std::fs::create_dir_all(repo_path.join(".openteams").join("context").join("demo"))
        .expect("create runtime dir");
    std::fs::write(repo_path.join(".openteams").join("test.txt"), "user\n")
        .expect("write user openteams file");
    std::fs::write(
        repo_path
            .join(".openteams")
            .join("context")
            .join("demo")
            .join("messages.jsonl"),
        "runtime\n",
    )
    .expect("write runtime artifact");
    std::fs::write(
        repo_path
            .join(".openteams")
            .join("context")
            .join("demo")
            .join("independent-mode-discussion-proposal.md"),
        "proposal\n",
    )
    .expect("write user proposal artifact");
    std::fs::create_dir_all(
        repo_path
            .join(".openteams")
            .join("context")
            .join("demo")
            .join("attachments")
            .join("message-1"),
    )
    .expect("create attachment dir");
    std::fs::write(
        repo_path
            .join(".openteams")
            .join("context")
            .join("demo")
            .join("attachments")
            .join("message-1")
            .join("input.txt"),
        "attachment\n",
    )
    .expect("write attachment artifact");

    let run_dir = tempdir.path().join("run-record");
    tokio::fs::create_dir_all(&run_dir)
        .await
        .expect("create run dir");

    let session_agent_id = Uuid::new_v4();

    let files =
        ChatRunner::capture_untracked_files(&repo_path, &run_dir, session_agent_id, 1).await;

    assert!(files.iter().any(|path| path == "binaries/test.txt"));
    assert!(files.iter().any(|path| path == ".openteams/test.txt"));
    assert!(
        files
            .iter()
            .any(|path| path == ".openteams/context/demo/independent-mode-discussion-proposal.md")
    );
    assert!(
        !files
            .iter()
            .any(|path| path == ".openteams/context/demo/messages.jsonl")
    );
    assert!(
        !files
            .iter()
            .any(|path| path == ".openteams/context/demo/attachments/message-1/input.txt")
    );
    assert!(
        !run_dir
            .join(format!(
                "{}_untracked",
                ChatRunner::run_records_prefix(session_agent_id, 1)
            ))
            .exists()
    );
}

#[tokio::test]
async fn ensure_openteams_ignored_for_git_workspace_appends_entry_once() {
    let tempdir = tempfile::tempdir().expect("create tempdir");
    let repo_path = tempdir.path().join("repo");
    git2::Repository::init(&repo_path).expect("init repo");

    std::fs::write(repo_path.join(".gitignore"), "target/\n").expect("write gitignore");
    let nested_workspace = repo_path.join("nested").join("workspace");
    std::fs::create_dir_all(&nested_workspace).expect("create nested workspace");

    ChatRunner::ensure_openteams_ignored_for_git_workspace(&nested_workspace)
        .await
        .expect("inject gitignore rule");
    ChatRunner::ensure_openteams_ignored_for_git_workspace(&nested_workspace)
        .await
        .expect("avoid duplicate gitignore rule");

    let gitignore = std::fs::read_to_string(repo_path.join(".gitignore")).expect("read gitignore");
    assert_eq!(gitignore.matches(".openteams/").count(), 1);
    assert!(gitignore.contains("target/\n.openteams/\n"));
}

#[tokio::test]
async fn capture_git_diff_skips_patch_when_diff_matches_run_baseline() {
    let tempdir = tempfile::tempdir().expect("create tempdir");
    let repo_path = tempdir.path().join("repo");
    let git = GitService::new();
    git.initialize_repo_with_main_branch(&repo_path)
        .expect("init repo");

    std::fs::write(repo_path.join("tracked.txt"), "base\n").expect("write tracked");
    git.commit(&repo_path, "baseline").expect("commit baseline");

    std::fs::write(repo_path.join("tracked.txt"), "dirty\n").expect("modify tracked");

    let baseline = ChatRunner::capture_tracked_git_diff_snapshot(&repo_path).await;
    assert!(
        baseline
            .as_deref()
            .is_some_and(|diff| diff.contains("tracked.txt"))
    );

    let run_dir = tempdir.path().join("run-record");
    tokio::fs::create_dir_all(&run_dir)
        .await
        .expect("create run dir");

    let session_agent_id = Uuid::new_v4();
    let diff_info = ChatRunner::capture_git_diff(
        &repo_path,
        &run_dir,
        session_agent_id,
        1,
        baseline.as_deref(),
    )
    .await;

    assert!(diff_info.is_none());
    assert!(
        !run_dir
            .join(format!(
                "{}_diff.patch",
                ChatRunner::run_records_prefix(session_agent_id, 1)
            ))
            .exists()
    );
}

#[tokio::test]
async fn capture_git_diff_records_only_paths_changed_since_run_baseline() {
    let tempdir = tempfile::tempdir().expect("create tempdir");
    let repo_path = tempdir.path().join("repo");
    let git = GitService::new();
    git.initialize_repo_with_main_branch(&repo_path)
        .expect("init repo");

    std::fs::write(repo_path.join("other_session.txt"), "base\n")
        .expect("write other file");
    std::fs::write(repo_path.join("current_session.txt"), "base\n")
        .expect("write current file");
    git.commit(&repo_path, "baseline").expect("commit baseline");

    std::fs::write(repo_path.join("other_session.txt"), "other dirty\n")
        .expect("modify other file");
    let baseline = ChatRunner::capture_tracked_git_diff_snapshot(&repo_path).await;
    assert!(
        baseline
            .as_deref()
            .is_some_and(|diff| diff.contains("other_session.txt"))
    );

    std::fs::write(repo_path.join("current_session.txt"), "current dirty\n")
        .expect("modify current file");

    let run_dir = tempdir.path().join("run-record");
    tokio::fs::create_dir_all(&run_dir)
        .await
        .expect("create run dir");
    let session_agent_id = Uuid::new_v4();

    let diff_info = ChatRunner::capture_git_diff(
        &repo_path,
        &run_dir,
        session_agent_id,
        1,
        baseline.as_deref(),
    )
    .await
    .expect("capture current-session diff");

    assert_eq!(
        diff_info.observed_paths,
        vec!["current_session.txt".to_string()]
    );

    let patch = std::fs::read_to_string(run_dir.join(format!(
        "{}_diff.patch",
        ChatRunner::run_records_prefix(session_agent_id, 1)
    )))
    .expect("read filtered patch");
    assert!(patch.contains("current_session.txt"));
    assert!(!patch.contains("other_session.txt"));
}

#[tokio::test]
async fn capture_untracked_files_can_be_filtered_against_run_baseline() {
    let tempdir = tempfile::tempdir().expect("create tempdir");
    let repo_path = tempdir.path().join("repo");
    let git = GitService::new();
    git.initialize_repo_with_main_branch(&repo_path)
        .expect("init repo");

    std::fs::write(repo_path.join("tracked.txt"), "base\n").expect("write tracked");
    git.commit(&repo_path, "baseline").expect("commit baseline");

    std::fs::write(repo_path.join("other_session_new.txt"), "other\n")
        .expect("write other untracked");
    let baseline = ChatRunner::capture_untracked_file_snapshot(&repo_path).await;
    assert_eq!(baseline, vec!["other_session_new.txt".to_string()]);

    std::fs::write(repo_path.join("current_session_new.txt"), "current\n")
        .expect("write current untracked");
    let after = ChatRunner::capture_untracked_file_snapshot(&repo_path).await;
    let baseline_set = baseline.iter().collect::<std::collections::HashSet<_>>();
    let filtered = after
        .into_iter()
        .filter(|path| !baseline_set.contains(path))
        .collect::<Vec<_>>();

    assert_eq!(filtered, vec!["current_session_new.txt".to_string()]);
}

#[test]
fn resolve_session_team_protocol_returns_enabled_session_content_only() {
    let now = Utc::now();
    let session = ChatSession {
        id: Uuid::new_v4(),
        title: Some("demo".to_string()),
        status: ChatSessionStatus::Active,
        lead_agent_id: None,
        summary_text: None,
        archive_ref: None,
        last_seen_diff_key: None,
        team_protocol: Some("  Follow the team protocol.  ".to_string()),
        team_protocol_enabled: true,
        default_workspace_path: None,
        chat_input_mode: None,
        project_id: None,
        pinned_at: None,
        created_at: now,
        updated_at: now,
        archived_at: None,
        worktree_mode: Default::default(),
    };

    assert_eq!(
        ChatRunner::resolve_session_team_protocol(Some(&session)),
        Some("Follow the team protocol.")
    );
}

#[test]
fn resolve_session_team_protocol_ignores_disabled_or_empty_session_content() {
    let now = Utc::now();
    let disabled_session = ChatSession {
        id: Uuid::new_v4(),
        title: Some("demo".to_string()),
        status: ChatSessionStatus::Active,
        lead_agent_id: None,
        summary_text: None,
        archive_ref: None,
        last_seen_diff_key: None,
        team_protocol: Some("Follow the team protocol.".to_string()),
        team_protocol_enabled: false,
        default_workspace_path: None,
        chat_input_mode: None,
        project_id: None,
        pinned_at: None,
        created_at: now,
        updated_at: now,
        archived_at: None,
        worktree_mode: Default::default(),
    };
    let empty_session = ChatSession {
        id: Uuid::new_v4(),
        title: Some("demo".to_string()),
        status: ChatSessionStatus::Active,
        lead_agent_id: None,
        summary_text: None,
        archive_ref: None,
        last_seen_diff_key: None,
        team_protocol: Some("   ".to_string()),
        team_protocol_enabled: true,
        default_workspace_path: None,
        chat_input_mode: None,
        project_id: None,
        pinned_at: None,
        created_at: now,
        updated_at: now,
        archived_at: None,
        worktree_mode: Default::default(),
    };

    assert_eq!(
        ChatRunner::resolve_session_team_protocol(Some(&disabled_session)),
        None
    );
    assert_eq!(
        ChatRunner::resolve_session_team_protocol(Some(&empty_session)),
        None
    );
    assert_eq!(ChatRunner::resolve_session_team_protocol(None), None);
}
