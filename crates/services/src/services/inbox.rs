use db::models::{
    chat_message::{ChatMessage, ChatSenderType},
    chat_run::ChatRun,
    chat_session::ChatSession,
    chat_session_worktree::SessionWorktree,
    inbox_item::{InboxItem, InboxItemListFilter, InboxItemSeverity, UpsertInboxItem},
    workflow_execution::WorkflowExecution,
    workflow_transcript::WorkflowTranscript,
    workflow_types::WorkflowExecutionStatus,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};
use ts_rs::TS;
use utils::approvals::ApprovalRequest;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Default)]
pub struct InboxScope {
    pub project_id: Option<Uuid>,
    pub session_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct InboxSummaryCount {
    pub key: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct InboxSummary {
    pub unread_count: i64,
    pub unread_by_severity: Vec<InboxSummaryCount>,
    pub unread_by_kind: Vec<InboxSummaryCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct MarkInboxItemsReadRequest {
    pub ids: Vec<Uuid>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
pub struct MarkAllInboxItemsReadRequest {
    pub project_id: Option<Uuid>,
    pub session_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct InboxItemsMarkedReadResponse {
    pub marked_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct InboxItemsArchivedResponse {
    pub item: InboxItem,
}

#[derive(Debug, Clone, Default)]
pub struct InboxService;

#[derive(Debug, FromRow)]
struct InboxSummaryCountRow {
    key: String,
    count: i64,
}

impl InboxService {
    pub fn new() -> Self {
        Self
    }

    /// Best-effort notification write entry.
    ///
    /// Chat, workflow, and worktree callers should use this method directly and
    /// continue their primary flow when it returns `None`; failures are logged
    /// here as warnings so notification persistence cannot block user work.
    pub async fn upsert_item(&self, pool: &SqlitePool, item: UpsertInboxItem) -> Option<InboxItem> {
        let item = match normalize_upsert_item(item) {
            Ok(item) => item,
            Err(message) => {
                tracing::warn!(error = %message, "skipping invalid inbox notification");
                return None;
            }
        };
        let dedupe_key = item.dedupe_key.clone();

        match InboxItem::upsert(pool, &item, Uuid::new_v4()).await {
            Ok(item) => Some(item),
            Err(error) => {
                tracing::warn!(
                    dedupe_key = %dedupe_key,
                    error = %error,
                    "failed to persist inbox notification"
                );
                None
            }
        }
    }

    pub async fn summary(
        &self,
        pool: &SqlitePool,
        scope: InboxScope,
    ) -> Result<InboxSummary, sqlx::Error> {
        let mut count_builder = QueryBuilder::<Sqlite>::new("SELECT COUNT(*) FROM inbox_items");
        append_unread_scope(&mut count_builder, &scope);
        let unread_count: (i64,) = count_builder
            .build_query_as::<(i64,)>()
            .fetch_one(pool)
            .await?;

        let unread_by_severity = fetch_group_count(pool, "severity", &scope).await?;
        let unread_by_kind = fetch_group_count(pool, "kind", &scope).await?;

        Ok(InboxSummary {
            unread_count: unread_count.0,
            unread_by_severity,
            unread_by_kind,
        })
    }

    pub async fn list_items(
        &self,
        pool: &SqlitePool,
        mut filter: InboxItemListFilter,
    ) -> Result<Vec<InboxItem>, sqlx::Error> {
        filter.limit = filter.limit.clamp(1, 100);
        InboxItem::list(pool, &filter).await
    }

    pub async fn mark_read(
        &self,
        pool: &SqlitePool,
        id: Uuid,
    ) -> Result<Option<InboxItem>, sqlx::Error> {
        InboxItem::mark_read(pool, id).await
    }

    pub async fn mark_many_read(
        &self,
        pool: &SqlitePool,
        ids: &[Uuid],
    ) -> Result<u64, sqlx::Error> {
        InboxItem::mark_many_read(pool, ids).await
    }

    pub async fn mark_all_read(
        &self,
        pool: &SqlitePool,
        scope: InboxScope,
    ) -> Result<u64, sqlx::Error> {
        InboxItem::mark_all_read(pool, scope.project_id, scope.session_id).await
    }

    pub async fn archive(
        &self,
        pool: &SqlitePool,
        id: Uuid,
    ) -> Result<Option<InboxItem>, sqlx::Error> {
        InboxItem::archive(pool, id).await
    }

    pub async fn notify_chat_agent_message(
        &self,
        pool: &SqlitePool,
        message: &ChatMessage,
        agent_name: Option<&str>,
    ) -> Option<InboxItem> {
        let project_id = project_id_for_session(pool, message.session_id).await;
        let item = chat_agent_message_item(project_id, message, agent_name)?;
        self.upsert_item(pool, item).await
    }

    pub async fn notify_chat_agent_failed(
        &self,
        pool: &SqlitePool,
        session_id: Uuid,
        run_id: Uuid,
        agent_name: &str,
        body: Option<&str>,
    ) -> Option<InboxItem> {
        let project_id = project_id_for_session(pool, session_id).await;
        self.upsert_item(
            pool,
            chat_agent_failed_item(project_id, session_id, run_id, agent_name, body),
        )
        .await
    }

    pub async fn notify_chat_mention_failed(
        &self,
        pool: &SqlitePool,
        session_id: Uuid,
        message_id: Uuid,
        agent_name: &str,
        agent_id: Option<Uuid>,
        reason: &str,
    ) -> Option<InboxItem> {
        let project_id = project_id_for_session(pool, session_id).await;
        self.upsert_item(
            pool,
            chat_mention_failed_item(
                project_id, session_id, message_id, agent_name, agent_id, reason,
            ),
        )
        .await
    }

    pub async fn notify_workflow_user_action(
        &self,
        pool: &SqlitePool,
        execution: &WorkflowExecution,
        transcript: &WorkflowTranscript,
        title_hint: Option<&str>,
    ) -> Option<InboxItem> {
        let project_id = project_id_for_session(pool, execution.session_id).await;
        let item = workflow_user_action_item(project_id, execution, transcript, title_hint)?;
        self.upsert_item(pool, item).await
    }

    pub async fn notify_workflow_execution_terminal(
        &self,
        pool: &SqlitePool,
        execution: &WorkflowExecution,
        detail: Option<&str>,
        reason: &str,
    ) -> Option<InboxItem> {
        let project_id = project_id_for_session(pool, execution.session_id).await;
        let item = workflow_execution_terminal_item(project_id, execution, detail, reason)?;
        self.upsert_item(pool, item).await
    }

    pub async fn notify_worktree_conflict(
        &self,
        pool: &SqlitePool,
        worktree: &SessionWorktree,
        conflict_files: &[String],
    ) -> Option<InboxItem> {
        self.upsert_item(pool, worktree_conflict_item(worktree, conflict_files))
            .await
    }

    pub async fn notify_worktree_cleanup_failed(
        &self,
        pool: &SqlitePool,
        worktree: &SessionWorktree,
        error: &str,
    ) -> Option<InboxItem> {
        self.upsert_item(pool, worktree_cleanup_failed_item(worktree, error))
            .await
    }

    pub async fn notify_executor_approval_requested(
        &self,
        pool: &SqlitePool,
        request: &ApprovalRequest,
    ) -> Option<InboxItem> {
        let (project_id, session_id) =
            executor_approval_scope(pool, request.execution_process_id).await;
        self.upsert_item(
            pool,
            executor_approval_item(project_id, session_id, request),
        )
        .await
    }
}

async fn project_id_for_session(pool: &SqlitePool, session_id: Uuid) -> Option<Uuid> {
    match ChatSession::find_by_id(pool, session_id).await {
        Ok(Some(session)) => session.project_id,
        Ok(None) => None,
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                error = %error,
                "failed to resolve inbox notification project scope"
            );
            None
        }
    }
}

async fn executor_approval_scope(
    pool: &SqlitePool,
    execution_process_id: Uuid,
) -> (Option<Uuid>, Option<Uuid>) {
    match ChatRun::find_by_id(pool, execution_process_id).await {
        Ok(Some(run)) => (
            project_id_for_session(pool, run.session_id).await,
            Some(run.session_id),
        ),
        Ok(None) => (None, None),
        Err(error) => {
            tracing::warn!(
                execution_process_id = %execution_process_id,
                error = %error,
                "failed to resolve executor approval inbox scope"
            );
            (None, None)
        }
    }
}

fn chat_agent_message_item(
    project_id: Option<Uuid>,
    message: &ChatMessage,
    agent_name: Option<&str>,
) -> Option<UpsertInboxItem> {
    if message.sender_type != ChatSenderType::Agent {
        return None;
    }

    let agent_label = agent_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Agent");
    Some(UpsertInboxItem {
        project_id,
        session_id: Some(message.session_id),
        kind: "chat_message".to_string(),
        severity: InboxItemSeverity::Info,
        title: format!("{agent_label} replied"),
        body: optional_compact_text(&message.content, 240),
        source_type: "chat_message".to_string(),
        source_id: Some(message.id.to_string()),
        dedupe_key: format!("message:{}", message.id),
    })
}

fn chat_agent_failed_item(
    project_id: Option<Uuid>,
    session_id: Uuid,
    run_id: Uuid,
    agent_name: &str,
    body: Option<&str>,
) -> UpsertInboxItem {
    let agent_label = agent_name.trim();
    let agent_label = if agent_label.is_empty() {
        "Agent"
    } else {
        agent_label
    };
    UpsertInboxItem {
        project_id,
        session_id: Some(session_id),
        kind: "chat_agent_failed".to_string(),
        severity: InboxItemSeverity::Error,
        title: format!("{agent_label} failed"),
        body: body.and_then(|value| optional_compact_text(value, 360)),
        source_type: "chat_run".to_string(),
        source_id: Some(run_id.to_string()),
        dedupe_key: format!("agent_run_failed:{run_id}"),
    }
}

fn chat_mention_failed_item(
    project_id: Option<Uuid>,
    session_id: Uuid,
    message_id: Uuid,
    agent_name: &str,
    agent_id: Option<Uuid>,
    reason: &str,
) -> UpsertInboxItem {
    let agent_label = agent_name.trim();
    let agent_label = if agent_label.is_empty() {
        "agent"
    } else {
        agent_label
    };
    let dedupe_target = agent_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| agent_label.to_ascii_lowercase());
    UpsertInboxItem {
        project_id,
        session_id: Some(session_id),
        kind: "chat_mention_failed".to_string(),
        severity: InboxItemSeverity::Error,
        title: format!("Mention failed: {agent_label}"),
        body: optional_compact_text(reason, 360),
        source_type: "chat_mention".to_string(),
        source_id: Some(message_id.to_string()),
        dedupe_key: format!("mention_failed:{message_id}:{dedupe_target}"),
    }
}

fn workflow_user_action_item(
    project_id: Option<Uuid>,
    execution: &WorkflowExecution,
    transcript: &WorkflowTranscript,
    title_hint: Option<&str>,
) -> Option<UpsertInboxItem> {
    let action = workflow_action_notification_kind(transcript.entry_type.as_str())?;
    Some(UpsertInboxItem {
        project_id,
        session_id: Some(execution.session_id),
        kind: action.kind.to_string(),
        severity: action.severity,
        title: title_hint
            .and_then(|value| optional_compact_text(value, 120))
            .unwrap_or_else(|| action.title.to_string()),
        body: workflow_action_body(execution, transcript),
        source_type: action.source_type.to_string(),
        source_id: Some(transcript.id.to_string()),
        dedupe_key: format!("{}:{}", action.dedupe_prefix, transcript.id),
    })
}

fn workflow_execution_terminal_item(
    project_id: Option<Uuid>,
    execution: &WorkflowExecution,
    detail: Option<&str>,
    reason: &str,
) -> Option<UpsertInboxItem> {
    let (kind, severity, title, dedupe_prefix) = match execution.status {
        WorkflowExecutionStatus::Completed => (
            "workflow_execution_completed",
            InboxItemSeverity::Info,
            format!("Workflow completed: {}", execution.title),
            "workflow_execution_completed",
        ),
        WorkflowExecutionStatus::Failed => (
            "workflow_execution_failed",
            InboxItemSeverity::Error,
            format!("Workflow failed: {}", execution.title),
            "workflow_execution_failed",
        ),
        WorkflowExecutionStatus::Paused if workflow_failed_notification_reason(reason) => (
            "workflow_execution_failed",
            InboxItemSeverity::Error,
            format!("Workflow failed: {}", execution.title),
            "workflow_execution_failed",
        ),
        _ => return None,
    };
    let body = detail
        .and_then(|value| optional_compact_text(value, 360))
        .or_else(|| optional_compact_text(reason, 180));
    Some(UpsertInboxItem {
        project_id,
        session_id: Some(execution.session_id),
        kind: kind.to_string(),
        severity,
        title: compact_text(&title, 160),
        body,
        source_type: "workflow_execution".to_string(),
        source_id: Some(execution.id.to_string()),
        dedupe_key: format!("{dedupe_prefix}:{}", execution.id),
    })
}

fn workflow_failed_notification_reason(reason: &str) -> bool {
    reason.contains("failed") || reason == "execution_bootstrap_recovered"
}

fn executor_approval_item(
    project_id: Option<Uuid>,
    session_id: Option<Uuid>,
    request: &ApprovalRequest,
) -> UpsertInboxItem {
    let input = serde_json::to_string(&request.tool_input).ok();
    let body = input
        .as_deref()
        .map(|value| format!("Tool '{}' requires approval: {value}", request.tool_name))
        .or_else(|| Some(format!("Tool '{}' requires approval", request.tool_name)))
        .and_then(|value| optional_compact_text(&value, 360));

    UpsertInboxItem {
        project_id,
        session_id,
        kind: "executor_approval".to_string(),
        severity: InboxItemSeverity::Warning,
        title: compact_text(&format!("Tool approval needed: {}", request.tool_name), 160),
        body,
        source_type: "executor_approval".to_string(),
        source_id: Some(request.id.clone()),
        dedupe_key: format!("executor_approval:{}", request.id),
    }
}

fn worktree_conflict_item(
    worktree: &SessionWorktree,
    conflict_files: &[String],
) -> UpsertInboxItem {
    let files = compact_conflict_files(conflict_files);
    UpsertInboxItem {
        project_id: worktree.project_id,
        session_id: Some(worktree.session_id),
        kind: "worktree_conflict".to_string(),
        severity: InboxItemSeverity::Error,
        title: "Worktree merge has conflicts".to_string(),
        body: optional_compact_text(&files, 360),
        source_type: "worktree_conflict".to_string(),
        source_id: Some(worktree.id.to_string()),
        dedupe_key: format!("worktree_conflict:{}", worktree.id),
    }
}

fn worktree_cleanup_failed_item(worktree: &SessionWorktree, error: &str) -> UpsertInboxItem {
    UpsertInboxItem {
        project_id: worktree.project_id,
        session_id: Some(worktree.session_id),
        kind: "worktree_cleanup_failed".to_string(),
        severity: InboxItemSeverity::Error,
        title: "Worktree cleanup failed".to_string(),
        body: optional_compact_text(error, 360),
        source_type: "worktree_cleanup".to_string(),
        source_id: Some(worktree.id.to_string()),
        dedupe_key: format!("worktree_cleanup_failed:{}", worktree.id),
    }
}

struct WorkflowActionNotificationKind {
    kind: &'static str,
    severity: InboxItemSeverity,
    source_type: &'static str,
    dedupe_prefix: &'static str,
    title: &'static str,
}

fn workflow_action_notification_kind(entry_type: &str) -> Option<WorkflowActionNotificationKind> {
    match entry_type {
        "input_request" => Some(WorkflowActionNotificationKind {
            kind: "workflow_input",
            severity: InboxItemSeverity::Warning,
            source_type: "workflow_input",
            dedupe_prefix: "workflow_input",
            title: "Workflow needs input",
        }),
        "continue_confirmation" => Some(WorkflowActionNotificationKind {
            kind: "workflow_input",
            severity: InboxItemSeverity::Warning,
            source_type: "workflow_continue",
            dedupe_prefix: "workflow_continue",
            title: "Workflow needs confirmation",
        }),
        "step_review" | "loop_review" => Some(WorkflowActionNotificationKind {
            kind: "workflow_review",
            severity: InboxItemSeverity::Warning,
            source_type: "workflow_review",
            dedupe_prefix: "workflow_review",
            title: "Workflow needs review",
        }),
        "final_review" => Some(WorkflowActionNotificationKind {
            kind: "workflow_final_review",
            severity: InboxItemSeverity::Warning,
            source_type: "workflow_final_review",
            dedupe_prefix: "workflow_final_review",
            title: "Workflow needs final review",
        }),
        "approval_request" => Some(WorkflowActionNotificationKind {
            kind: "workflow_approval",
            severity: InboxItemSeverity::Info,
            source_type: "workflow_approval",
            dedupe_prefix: "workflow_approval",
            title: "Workflow needs approval",
        }),
        "permission_request" => Some(WorkflowActionNotificationKind {
            kind: "workflow_approval",
            severity: InboxItemSeverity::Info,
            source_type: "workflow_approval",
            dedupe_prefix: "workflow_permission",
            title: "Workflow needs permission",
        }),
        _ => None,
    }
}

fn workflow_action_body(
    execution: &WorkflowExecution,
    transcript: &WorkflowTranscript,
) -> Option<String> {
    let description = transcript
        .meta_json
        .as_deref()
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .and_then(|value| {
            value
                .get("description")
                .and_then(|description| description.as_str())
                .map(str::to_string)
        });
    let detail = description
        .or_else(|| optional_compact_text(&transcript.content, 240))
        .unwrap_or_else(|| execution.title.clone());
    optional_compact_text(&format!("{}: {detail}", execution.title), 360)
}

fn compact_conflict_files(conflict_files: &[String]) -> String {
    let files = conflict_files
        .iter()
        .map(|file| file.trim())
        .filter(|file| !file.is_empty())
        .take(8)
        .collect::<Vec<_>>();
    if files.is_empty() {
        "Resolve merge conflicts in this worktree.".to_string()
    } else {
        format!("Conflicted files: {}", files.join(", "))
    }
}

fn optional_compact_text(value: &str, max_chars: usize) -> Option<String> {
    let compacted = compact_text(value, max_chars);
    (!compacted.is_empty()).then_some(compacted)
}

fn compact_text(value: &str, max_chars: usize) -> String {
    let mut compact = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if compact.chars().count() > max_chars {
        compact = compact.chars().take(max_chars).collect::<String>();
        compact.push_str("...");
    }
    compact
}

fn normalize_upsert_item(mut item: UpsertInboxItem) -> Result<UpsertInboxItem, &'static str> {
    item.kind = trim_required(item.kind, "kind")?;
    item.title = trim_required(item.title, "title")?;
    item.source_type = trim_required(item.source_type, "source_type")?;
    item.dedupe_key = trim_required(item.dedupe_key, "dedupe_key")?;
    item.body = item
        .body
        .map(|body| body.trim().to_string())
        .filter(|body| !body.is_empty());
    item.source_id = item
        .source_id
        .map(|source_id| source_id.trim().to_string())
        .filter(|source_id| !source_id.is_empty());
    Ok(item)
}

fn trim_required(value: String, field_name: &'static str) -> Result<String, &'static str> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        Err(field_name)
    } else {
        Ok(trimmed)
    }
}

fn append_unread_scope(builder: &mut QueryBuilder<'_, Sqlite>, scope: &InboxScope) {
    builder.push(" WHERE read_at IS NULL AND archived_at IS NULL");
    if let Some(project_id) = scope.project_id {
        builder.push(" AND project_id = ");
        builder.push_bind(project_id);
    }
    if let Some(session_id) = scope.session_id {
        builder.push(" AND session_id = ");
        builder.push_bind(session_id);
    }
}

async fn fetch_group_count(
    pool: &SqlitePool,
    column: &'static str,
    scope: &InboxScope,
) -> Result<Vec<InboxSummaryCount>, sqlx::Error> {
    let mut builder = QueryBuilder::<Sqlite>::new("SELECT ");
    builder.push(column);
    builder.push(" AS key, COUNT(*) AS count FROM inbox_items");
    append_unread_scope(&mut builder, scope);
    builder.push(" GROUP BY ");
    builder.push(column);
    builder.push(" ORDER BY count DESC, key ASC");
    Ok(builder
        .build_query_as::<InboxSummaryCountRow>()
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|row| InboxSummaryCount {
            key: row.key,
            count: row.count,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use db::models::{
        chat_message::{ChatMessage, ChatSenderType},
        chat_session_worktree::{
            SessionWorktree, SessionWorktreeMergeOperation, SessionWorktreeMode,
            SessionWorktreeStatus,
        },
        inbox_item::{InboxItemListFilter, InboxItemSeverity, UpsertInboxItem},
        workflow_execution::WorkflowExecution,
        workflow_transcript::WorkflowTranscript,
        workflow_types::WorkflowExecutionStatus,
    };
    use sqlx::{SqlitePool, types::Json};
    use utils::approvals::{ApprovalRequest, CreateApprovalRequest};
    use uuid::Uuid;

    use super::{InboxScope, InboxService};

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::query(
            r#"
            CREATE TABLE inbox_items (
                id          BLOB NOT NULL PRIMARY KEY,
                project_id  BLOB,
                session_id  BLOB,
                kind        TEXT NOT NULL,
                severity    TEXT NOT NULL DEFAULT 'info'
                            CHECK (severity IN ('info', 'warning', 'error')),
                title       TEXT NOT NULL,
                body        TEXT,
                source_type TEXT NOT NULL,
                source_id   TEXT,
                dedupe_key  TEXT NOT NULL,
                read_at     TEXT,
                archived_at TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create inbox_items table");
        sqlx::query("CREATE UNIQUE INDEX idx_inbox_items_dedupe_key ON inbox_items(dedupe_key)")
            .execute(&pool)
            .await
            .expect("create dedupe index");
        pool
    }

    fn item(
        project_id: Uuid,
        session_id: Uuid,
        key: &str,
        severity: InboxItemSeverity,
    ) -> UpsertInboxItem {
        UpsertInboxItem {
            project_id: Some(project_id),
            session_id: Some(session_id),
            kind: "workflow_review".to_string(),
            severity,
            title: format!("Review {key}"),
            body: Some("Review body".to_string()),
            source_type: "workflow".to_string(),
            source_id: Some(key.to_string()),
            dedupe_key: key.to_string(),
        }
    }

    #[tokio::test]
    async fn upsert_item_dedupes_and_summary_counts_unread_unarchived() {
        let pool = setup_pool().await;
        let service = InboxService::new();
        let project_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();

        let first = service
            .upsert_item(
                &pool,
                item(
                    project_id,
                    session_id,
                    "workflow_review:1",
                    InboxItemSeverity::Warning,
                ),
            )
            .await
            .expect("insert notification");
        let mut updated = item(
            project_id,
            session_id,
            "workflow_review:1",
            InboxItemSeverity::Error,
        );
        updated.title = "Updated review".to_string();
        let second = service
            .upsert_item(&pool, updated)
            .await
            .expect("upsert notification");
        service
            .upsert_item(
                &pool,
                item(
                    project_id,
                    session_id,
                    "workflow_review:2",
                    InboxItemSeverity::Info,
                ),
            )
            .await
            .expect("insert second notification");

        assert_eq!(first.id, second.id);
        assert_eq!(second.title, "Updated review");
        assert_eq!(second.severity, InboxItemSeverity::Error);

        let summary = service
            .summary(
                &pool,
                InboxScope {
                    project_id: Some(project_id),
                    session_id: None,
                },
            )
            .await
            .expect("summary");
        assert_eq!(summary.unread_count, 2);
        assert_eq!(
            summary
                .unread_by_severity
                .iter()
                .map(|entry| (&entry.key, entry.count))
                .collect::<Vec<_>>(),
            vec![(&"error".to_string(), 1), (&"info".to_string(), 1)]
        );
    }

    #[tokio::test]
    async fn list_mark_read_mark_all_and_archive_flow() {
        let pool = setup_pool().await;
        let service = InboxService::new();
        let project_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        let first = service
            .upsert_item(
                &pool,
                item(project_id, session_id, "first", InboxItemSeverity::Warning),
            )
            .await
            .expect("first notification");
        let second = service
            .upsert_item(
                &pool,
                item(project_id, session_id, "second", InboxItemSeverity::Warning),
            )
            .await
            .expect("second notification");
        let third = service
            .upsert_item(
                &pool,
                item(project_id, session_id, "third", InboxItemSeverity::Warning),
            )
            .await
            .expect("third notification");

        let listed = service
            .list_items(
                &pool,
                InboxItemListFilter {
                    project_id: Some(project_id),
                    ..InboxItemListFilter::default()
                },
            )
            .await
            .expect("list unread");
        assert_eq!(listed.len(), 3);

        let read = service
            .mark_read(&pool, first.id)
            .await
            .expect("mark read")
            .expect("read item");
        assert!(read.read_at.is_some());

        assert_eq!(
            service
                .mark_many_read(&pool, &[second.id])
                .await
                .expect("mark many"),
            1
        );

        let archived = service
            .archive(&pool, second.id)
            .await
            .expect("archive")
            .expect("archived item");
        assert!(archived.archived_at.is_some());

        assert_eq!(
            service
                .mark_all_read(
                    &pool,
                    InboxScope {
                        project_id: Some(project_id),
                        session_id: Some(session_id),
                    },
                )
                .await
                .expect("mark all"),
            1
        );
        assert!(
            service
                .mark_read(&pool, third.id)
                .await
                .expect("find third")
                .expect("third item")
                .read_at
                .is_some()
        );
    }

    #[tokio::test]
    async fn upsert_item_warns_and_returns_none_for_invalid_input() {
        let pool = setup_pool().await;
        let service = InboxService::new();

        let result = service
            .upsert_item(
                &pool,
                UpsertInboxItem {
                    project_id: None,
                    session_id: None,
                    kind: "workflow_review".to_string(),
                    severity: InboxItemSeverity::Info,
                    title: "Missing dedupe".to_string(),
                    body: None,
                    source_type: "workflow".to_string(),
                    source_id: None,
                    dedupe_key: " ".to_string(),
                },
            )
            .await;

        assert!(result.is_none());
    }

    #[tokio::test]
    async fn chat_agent_message_notifications_persist_and_skip_non_agent_messages() {
        let pool = setup_pool().await;
        let service = InboxService::new();
        let session_id = Uuid::new_v4();
        let agent_id = Uuid::new_v4();
        let message = ChatMessage {
            id: Uuid::new_v4(),
            session_id,
            sender_type: ChatSenderType::Agent,
            sender_id: Some(agent_id),
            sender_session_agent_id: None,
            content: "Final answer from the agent.".to_string(),
            mentions: Json(Vec::new()),
            meta: Json(serde_json::json!({})),
            created_at: chrono::Utc::now(),
        };

        let item = service
            .notify_chat_agent_message(&pool, &message, Some("Builder"))
            .await
            .expect("agent message notification");
        assert_eq!(item.kind, "chat_message");
        assert_eq!(item.source_type, "chat_message");
        assert_eq!(
            item.source_id.as_deref(),
            Some(message.id.to_string().as_str())
        );
        assert_eq!(item.dedupe_key, format!("message:{}", message.id));

        let user_message = ChatMessage {
            id: Uuid::new_v4(),
            sender_type: ChatSenderType::User,
            sender_id: None,
            content: "User message should not enter the inbox.".to_string(),
            ..message
        };
        assert!(
            service
                .notify_chat_agent_message(&pool, &user_message, Some("Builder"))
                .await
                .is_none()
        );

        let listed = service
            .list_items(&pool, InboxItemListFilter::default())
            .await
            .expect("list notifications");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, item.id);
    }

    #[tokio::test]
    async fn workflow_action_and_terminal_notifications_persist_expected_kinds() {
        let pool = setup_pool().await;
        let service = InboxService::new();
        let session_id = Uuid::new_v4();
        let mut execution = sample_execution(WorkflowExecutionStatus::Waiting);
        execution.session_id = session_id;

        for (entry_type, expected_kind, expected_source_type) in [
            ("input_request", "workflow_input", "workflow_input"),
            ("step_review", "workflow_review", "workflow_review"),
            (
                "final_review",
                "workflow_final_review",
                "workflow_final_review",
            ),
        ] {
            let transcript = sample_transcript(execution.id, entry_type);
            let item = service
                .notify_workflow_user_action(&pool, &execution, &transcript, None)
                .await
                .expect("workflow action notification");
            assert_eq!(item.kind, expected_kind);
            assert_eq!(item.source_type, expected_source_type);
            assert_eq!(
                item.source_id.as_deref(),
                Some(transcript.id.to_string().as_str())
            );
            assert!(item.dedupe_key.ends_with(&transcript.id.to_string()));
            assert!(item.read_at.is_none());
        }

        let thinking = sample_transcript(execution.id, "thinking");
        assert!(
            service
                .notify_workflow_user_action(&pool, &execution, &thinking, None)
                .await
                .is_none()
        );

        let mut failed = sample_execution(WorkflowExecutionStatus::Failed);
        failed.session_id = session_id;
        let failed_item = service
            .notify_workflow_execution_terminal(
                &pool,
                &failed,
                Some("Step failed"),
                "execution_failed",
            )
            .await
            .expect("failed workflow notification");
        assert_eq!(failed_item.kind, "workflow_execution_failed");
        assert_eq!(failed_item.severity, InboxItemSeverity::Error);

        let mut completed = sample_execution(WorkflowExecutionStatus::Completed);
        completed.session_id = session_id;
        let completed_item = service
            .notify_workflow_execution_terminal(&pool, &completed, None, "execution_completed")
            .await
            .expect("completed workflow notification");
        assert_eq!(completed_item.kind, "workflow_execution_completed");
        assert_eq!(completed_item.severity, InboxItemSeverity::Info);

        let mut running = sample_execution(WorkflowExecutionStatus::Running);
        running.session_id = session_id;
        assert!(
            service
                .notify_workflow_execution_terminal(&pool, &running, None, "step_status_updated",)
                .await
                .is_none()
        );

        let items = service
            .list_items(
                &pool,
                InboxItemListFilter {
                    session_id: Some(session_id),
                    ..InboxItemListFilter::default()
                },
            )
            .await
            .expect("list workflow notifications");
        let kinds = items
            .iter()
            .map(|item| item.kind.as_str())
            .collect::<Vec<_>>();
        assert_eq!(items.len(), 5);
        assert!(kinds.contains(&"workflow_input"));
        assert!(kinds.contains(&"workflow_review"));
        assert!(kinds.contains(&"workflow_final_review"));
        assert!(kinds.contains(&"workflow_execution_failed"));
        assert!(kinds.contains(&"workflow_execution_completed"));
    }

    #[test]
    fn chat_agent_message_notification_uses_message_dedupe_and_skips_non_agent_messages() {
        let session_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();
        let agent_id = Uuid::new_v4();
        let message = ChatMessage {
            id: message_id,
            session_id,
            sender_type: ChatSenderType::Agent,
            sender_id: Some(agent_id),
            sender_session_agent_id: None,
            content: "Finished the work and wrote tests.".to_string(),
            mentions: Json(Vec::new()),
            meta: Json(serde_json::json!({})),
            created_at: chrono::Utc::now(),
        };

        let item = super::chat_agent_message_item(None, &message, Some("Builder"))
            .expect("agent message notification");

        assert_eq!(item.session_id, Some(session_id));
        assert_eq!(item.kind, "chat_message");
        assert_eq!(item.severity, InboxItemSeverity::Info);
        assert_eq!(item.source_type, "chat_message");
        assert_eq!(
            item.source_id.as_deref(),
            Some(message_id.to_string().as_str())
        );
        assert_eq!(item.dedupe_key, format!("message:{message_id}"));
        assert!(item.title.contains("Builder"));

        let user_message = ChatMessage {
            sender_type: ChatSenderType::User,
            ..message
        };
        assert!(super::chat_agent_message_item(None, &user_message, Some("Builder")).is_none());
    }

    #[test]
    fn workflow_user_action_notifications_use_action_specific_keys_and_severity() {
        let execution = sample_execution(WorkflowExecutionStatus::Waiting);
        let transcript = sample_transcript(execution.id, "input_request");

        let input_item =
            super::workflow_user_action_item(None, &execution, &transcript, Some("Need input"))
                .expect("input notification");
        assert_eq!(input_item.kind, "workflow_input");
        assert_eq!(input_item.severity, InboxItemSeverity::Warning);
        assert_eq!(input_item.source_type, "workflow_input");
        assert_eq!(
            input_item.dedupe_key,
            format!("workflow_input:{}", transcript.id)
        );

        let approval = sample_transcript(execution.id, "approval_request");
        let approval_item =
            super::workflow_user_action_item(None, &execution, &approval, Some("Need approval"))
                .expect("approval notification");
        assert_eq!(approval_item.kind, "workflow_approval");
        assert_eq!(approval_item.severity, InboxItemSeverity::Info);
        assert_eq!(approval_item.source_type, "workflow_approval");
        assert_eq!(
            approval_item.dedupe_key,
            format!("workflow_approval:{}", approval.id)
        );

        let permission = sample_transcript(execution.id, "permission_request");
        let permission_item = super::workflow_user_action_item(
            None,
            &execution,
            &permission,
            Some("Need permission"),
        )
        .expect("permission notification");
        assert_eq!(permission_item.kind, "workflow_approval");
        assert_eq!(permission_item.severity, InboxItemSeverity::Info);
        assert_eq!(permission_item.source_type, "workflow_approval");
        assert_eq!(
            permission_item.dedupe_key,
            format!("workflow_permission:{}", permission.id)
        );

        let review = sample_transcript(execution.id, "step_review");
        let review_item =
            super::workflow_user_action_item(None, &execution, &review, Some("Review needed"))
                .expect("review notification");
        assert_eq!(review_item.kind, "workflow_review");
        assert_eq!(review_item.source_type, "workflow_review");
        assert_eq!(
            review_item.dedupe_key,
            format!("workflow_review:{}", review.id)
        );

        let final_review = sample_transcript(execution.id, "final_review");
        let final_review_item = super::workflow_user_action_item(
            None,
            &execution,
            &final_review,
            Some("Final review needed"),
        )
        .expect("final review notification");
        assert_eq!(final_review_item.kind, "workflow_final_review");
        assert_eq!(final_review_item.source_type, "workflow_final_review");
        assert_eq!(
            final_review_item.dedupe_key,
            format!("workflow_final_review:{}", final_review.id)
        );

        for excluded in ["thinking", "agent_message", "step_status", "error"] {
            let transcript = sample_transcript(execution.id, excluded);
            assert!(
                super::workflow_user_action_item(None, &execution, &transcript, None).is_none(),
                "{excluded} should not create an inbox item"
            );
        }
    }

    #[test]
    fn workflow_terminal_notifications_skip_running_and_dedupe_by_execution() {
        let completed = sample_execution(WorkflowExecutionStatus::Completed);
        let completed_item = super::workflow_execution_terminal_item(
            None,
            &completed,
            Some("All steps completed"),
            "execution_completed",
        )
        .expect("completed notification");
        assert_eq!(completed_item.kind, "workflow_execution_completed");
        assert_eq!(completed_item.severity, InboxItemSeverity::Info);
        assert_eq!(
            completed_item.dedupe_key,
            format!("workflow_execution_completed:{}", completed.id)
        );

        let failed = sample_execution(WorkflowExecutionStatus::Failed);
        let failed_item = super::workflow_execution_terminal_item(
            None,
            &failed,
            Some("Step failed"),
            "execution_failed",
        )
        .expect("failed notification");
        assert_eq!(failed_item.kind, "workflow_execution_failed");
        assert_eq!(failed_item.severity, InboxItemSeverity::Error);
        assert_eq!(
            failed_item.dedupe_key,
            format!("workflow_execution_failed:{}", failed.id)
        );

        let paused = sample_execution(WorkflowExecutionStatus::Paused);
        let paused_item = super::workflow_execution_terminal_item(
            None,
            &paused,
            Some("Step failed"),
            "execution_failed",
        )
        .expect("paused failed-step notification");
        assert_eq!(paused_item.kind, "workflow_execution_failed");
        assert_eq!(
            paused_item.dedupe_key,
            format!("workflow_execution_failed:{}", paused.id)
        );

        let running = sample_execution(WorkflowExecutionStatus::Running);
        assert!(
            super::workflow_execution_terminal_item(None, &running, None, "execution_running")
                .is_none()
        );
    }

    #[test]
    fn worktree_notifications_use_conflict_and_cleanup_sources() {
        let worktree = sample_worktree(SessionWorktreeStatus::NeedsConflictResolution);
        let conflict = super::worktree_conflict_item(&worktree, &["src/lib.rs".to_string()]);
        assert_eq!(conflict.kind, "worktree_conflict");
        assert_eq!(conflict.severity, InboxItemSeverity::Error);
        assert_eq!(conflict.source_type, "worktree_conflict");
        assert_eq!(
            conflict.dedupe_key,
            format!("worktree_conflict:{}", worktree.id)
        );
        assert!(
            conflict
                .body
                .as_deref()
                .unwrap_or_default()
                .contains("src/lib.rs")
        );

        let cleanup = super::worktree_cleanup_failed_item(&worktree, "remove failed");
        assert_eq!(cleanup.kind, "worktree_cleanup_failed");
        assert_eq!(cleanup.source_type, "worktree_cleanup");
        assert_eq!(
            cleanup.dedupe_key,
            format!("worktree_cleanup_failed:{}", worktree.id)
        );
    }

    #[test]
    fn failure_and_approval_notifications_use_stable_sources_and_dedupe_keys() {
        let session_id = Uuid::new_v4();
        let run_id = Uuid::new_v4();
        let agent_failure =
            super::chat_agent_failed_item(None, session_id, run_id, "Builder", Some("boom"));
        assert_eq!(agent_failure.kind, "chat_agent_failed");
        assert_eq!(agent_failure.severity, InboxItemSeverity::Error);
        assert_eq!(agent_failure.source_type, "chat_run");
        assert_eq!(
            agent_failure.dedupe_key,
            format!("agent_run_failed:{run_id}")
        );

        let message_id = Uuid::new_v4();
        let agent_id = Uuid::new_v4();
        let mention_failure = super::chat_mention_failed_item(
            None,
            session_id,
            message_id,
            "Reviewer",
            Some(agent_id),
            "agent unavailable",
        );
        assert_eq!(mention_failure.kind, "chat_mention_failed");
        assert_eq!(mention_failure.source_type, "chat_mention");
        assert_eq!(
            mention_failure.dedupe_key,
            format!("mention_failed:{message_id}:{agent_id}")
        );

        let request = ApprovalRequest::from_create(
            CreateApprovalRequest {
                tool_name: "shell".to_string(),
                tool_input: serde_json::json!({"command": "cargo test"}),
                tool_call_id: "tool-call-1".to_string(),
            },
            run_id,
        );
        let approval = super::executor_approval_item(None, Some(session_id), &request);
        assert_eq!(approval.kind, "executor_approval");
        assert_eq!(approval.severity, InboxItemSeverity::Warning);
        assert_eq!(approval.source_type, "executor_approval");
        assert_eq!(
            approval.dedupe_key,
            format!("executor_approval:{}", request.id)
        );
    }

    fn sample_execution(status: WorkflowExecutionStatus) -> WorkflowExecution {
        WorkflowExecution {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            plan_id: Uuid::new_v4(),
            active_revision_id: Some(Uuid::new_v4()),
            active_round_id: None,
            workflow_card_message_id: None,
            lead_session_agent_id: None,
            status,
            current_round: 1,
            title: "Implement workflow".to_string(),
            compiled_graph_hash: None,
            started_at: None,
            completed_at: None,
            cleaned_at: None,
            cleaned_reason: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    fn sample_transcript(execution_id: Uuid, entry_type: &str) -> WorkflowTranscript {
        WorkflowTranscript {
            id: Uuid::new_v4(),
            execution_id,
            round_id: Some(Uuid::new_v4()),
            workflow_agent_session_id: Some(Uuid::new_v4()),
            step_id: Some(Uuid::new_v4()),
            sender_type: "control".to_string(),
            entry_type: entry_type.to_string(),
            content: "Please respond".to_string(),
            meta_json: Some(serde_json::json!({"resolved": false}).to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    fn sample_worktree(status: SessionWorktreeStatus) -> SessionWorktree {
        SessionWorktree {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            project_id: Some(Uuid::new_v4()),
            base_workspace_path: "C:/repo".to_string(),
            repo_path: "C:/repo".to_string(),
            base_branch: "main".to_string(),
            base_commit: Some("abc123".to_string()),
            branch_name: "openteams/session".to_string(),
            worktree_path: "C:/repo-session".to_string(),
            mode: SessionWorktreeMode::Session,
            status,
            has_unmerged_commits: false,
            merge_target_branch: Some("main".to_string()),
            merge_operation: Some(SessionWorktreeMergeOperation::Merge),
            conflict_files_json: "[]".to_string(),
            operation_started_at: None,
            cleanup_error: None,
            last_used_at: None,
            merged_at: None,
            archived_at: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }
}
