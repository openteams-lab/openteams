use std::sync::Arc;

use async_trait::async_trait;
use executors::approvals::{ExecutorApprovalError, ExecutorApprovalService};
use serde_json::Value;
use tokio_util::sync::CancellationToken;
use utils::approvals::{ApprovalRequest, ApprovalStatus, CreateApprovalRequest};
use uuid::Uuid;

use crate::services::{
    approvals::Approvals, inbox::InboxService, notification::NotificationService,
};

pub struct ExecutorApprovalBridge {
    approvals: Approvals,
    db: db::DBService,
    notification_service: NotificationService,
    execution_process_id: Uuid,
}

impl ExecutorApprovalBridge {
    pub fn new(
        approvals: Approvals,
        db: db::DBService,
        notification_service: NotificationService,
        execution_process_id: Uuid,
    ) -> Arc<Self> {
        Arc::new(Self {
            approvals,
            db,
            notification_service,
            execution_process_id,
        })
    }
}

#[async_trait]
impl ExecutorApprovalService for ExecutorApprovalBridge {
    async fn request_tool_approval(
        &self,
        tool_name: &str,
        tool_input: Value,
        tool_call_id: &str,
        cancel: CancellationToken,
    ) -> Result<ApprovalStatus, ExecutorApprovalError> {
        let request = ApprovalRequest::from_create(
            CreateApprovalRequest {
                tool_name: tool_name.to_string(),
                tool_input,
                tool_call_id: tool_call_id.to_string(),
            },
            self.execution_process_id,
        );

        let (request, waiter) = self
            .approvals
            .create_with_waiter(request)
            .await
            .map_err(ExecutorApprovalError::request_failed)?;

        let approval_id = request.id.clone();

        self.notification_service
            .notify(
                "Approval Needed",
                &format!("Tool '{}' requires approval", tool_name),
            )
            .await;
        InboxService::new()
            .notify_executor_approval_requested(&self.db.pool, &request)
            .await;

        let status = tokio::select! {
            _ = cancel.cancelled() => {
                tracing::info!("Approval request cancelled for tool_call_id={}", tool_call_id);
                self.approvals.cancel(&approval_id).await;
                return Err(ExecutorApprovalError::Cancelled);
            }
            status = waiter.clone() => status,
        };

        if matches!(status, ApprovalStatus::Pending) {
            return Err(ExecutorApprovalError::request_failed(
                "approval finished in pending state",
            ));
        }

        Ok(status)
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, sync::Arc};

    use db::{
        DBService,
        models::{
            chat_agent::{ChatAgent, CreateChatAgent},
            chat_run::{ChatRun, CreateChatRun},
            chat_session::{ChatSession, CreateChatSession},
            chat_session_agent::{ChatSessionAgent, CreateChatSessionAgent},
            inbox_item::{InboxItem, InboxItemListFilter},
            member_execution_config::MemberExecutionConfig,
        },
    };
    use executors::approvals::ExecutorApprovalService;
    use sqlx::SqlitePool;
    use tokio::sync::RwLock;
    use utils::msg_store::MsgStore;

    use super::*;
    use crate::services::{config::Config, notification::NotificationService};

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::migrate!("../db/migrations")
            .run(&pool)
            .await
            .expect("run migrations");
        pool
    }

    async fn create_chat_run(pool: &SqlitePool) -> ChatRun {
        let session = ChatSession::create(
            pool,
            &CreateChatSession {
                title: Some("Approval session".to_string()),
                workspace_path: None,
                project_id: None,
                worktree_mode: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat session");
        let agent = ChatAgent::create(
            pool,
            &CreateChatAgent {
                name: "agent".to_string(),
                runner_type: "codex".to_string(),
                system_prompt: None,
                tools_enabled: None,
                model_name: None,
                owner_project_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat agent");
        let session_agent = ChatSessionAgent::create(
            pool,
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
        ChatRun::create(
            pool,
            &CreateChatRun {
                session_id: session.id,
                session_agent_id: session_agent.id,
                workspace_path: None,
                run_index: 1,
                run_dir: "run-dir".to_string(),
                input_path: None,
                output_path: None,
                raw_log_path: None,
                meta_path: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat run")
    }

    fn notification_service() -> NotificationService {
        let mut config = Config::default();
        config.notifications.sound_enabled = false;
        config.notifications.push_enabled = false;
        NotificationService::new(Arc::new(RwLock::new(config)))
    }

    #[tokio::test]
    async fn executor_tool_approval_request_persists_inbox_item() {
        let pool = setup_pool().await;
        let run = create_chat_run(&pool).await;
        let approvals =
            Approvals::new(Arc::new(RwLock::new(HashMap::<Uuid, Arc<MsgStore>>::new())));
        let bridge = ExecutorApprovalBridge::new(
            approvals,
            DBService { pool: pool.clone() },
            notification_service(),
            run.id,
        );
        let cancel = CancellationToken::new();
        cancel.cancel();

        let result = bridge
            .request_tool_approval(
                "bash",
                serde_json::json!({ "command": "cargo test" }),
                "tool-call-1",
                cancel,
            )
            .await;

        assert!(matches!(
            result,
            Ok(ApprovalStatus::TimedOut) | Err(ExecutorApprovalError::Cancelled)
        ));
        let items = InboxItem::list(
            &pool,
            &InboxItemListFilter {
                session_id: Some(run.session_id),
                ..InboxItemListFilter::default()
            },
        )
        .await
        .expect("list inbox items");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, "executor_approval");
        assert_eq!(items[0].source_type, "executor_approval");
        assert!(items[0].source_id.is_some());
        assert!(items[0].dedupe_key.starts_with("executor_approval:"));
        assert!(items[0].read_at.is_none());
    }
}
