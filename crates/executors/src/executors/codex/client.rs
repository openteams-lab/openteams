use std::{
    borrow::Cow,
    collections::{HashMap, VecDeque},
    io,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};

use async_trait::async_trait;
use codex_app_server_protocol::{
    ApplyPatchApprovalResponse, ClientInfo, ClientNotification, ClientRequest,
    CommandExecutionApprovalDecision, CommandExecutionRequestApprovalResponse,
    DynamicToolCallOutputContentItem, DynamicToolCallResponse, ExecCommandApprovalResponse,
    FileChangeApprovalDecision, FileChangeRequestApprovalResponse, GetAuthStatusParams,
    GetAuthStatusResponse, GrantedPermissionProfile, InitializeCapabilities, InitializeParams,
    InitializeResponse, JSONRPCError, JSONRPCErrorError, JSONRPCNotification, JSONRPCRequest,
    JSONRPCResponse, ListMcpServerStatusParams, ListMcpServerStatusResponse,
    McpServerElicitationAction, McpServerElicitationRequestResponse, PermissionGrantScope,
    PermissionsRequestApprovalResponse, RequestId, ReviewStartParams, ReviewStartResponse,
    ReviewTarget, ServerNotification, ServerRequest, ThreadCompactStartParams,
    ThreadCompactStartResponse, ThreadItem, ThreadResumeParams, ThreadResumeResponse,
    ThreadStartParams, ThreadStartResponse, ToolRequestUserInputAnswer,
    ToolRequestUserInputResponse, TurnCompletedNotification, TurnStartParams, TurnStartResponse,
    TurnStatus, UserInput,
};
use codex_protocol::protocol::ReviewDecision;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{self, Map, Value};
use tokio::{
    io::{AsyncWrite, AsyncWriteExt, BufWriter},
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;
use workspace_utils::approvals::ApprovalStatus;

use super::jsonrpc::{JsonRpcCallbacks, JsonRpcPeer};
use crate::{
    approvals::{ExecutorApprovalError, ExecutorApprovalService},
    env::RepoContext,
    executors::{ExecutorError, ExecutorExitResult, codex::normalize_logs::Approval},
};

pub struct AppServerClient {
    rpc: OnceLock<JsonRpcPeer>,
    log_writer: LogWriter,
    approvals: Option<Arc<dyn ExecutorApprovalService>>,
    thread_id: Mutex<Option<String>>,
    items_by_id: Mutex<HashMap<String, ThreadItem>>,
    pending_feedback: Mutex<VecDeque<String>>,
    auto_approve: bool,
    repo_context: RepoContext,
    commit_reminder: bool,
    commit_reminder_prompt: String,
    commit_reminder_sent: AtomicBool,
    turn_started: AtomicBool,
    cancel: CancellationToken,
    turn_error: Mutex<Option<String>>,
}

impl AppServerClient {
    pub fn new(
        log_writer: LogWriter,
        approvals: Option<Arc<dyn ExecutorApprovalService>>,
        auto_approve: bool,
        repo_context: RepoContext,
        commit_reminder: bool,
        commit_reminder_prompt: String,
        cancel: CancellationToken,
    ) -> Arc<Self> {
        Arc::new(Self {
            rpc: OnceLock::new(),
            log_writer,
            approvals,
            auto_approve,
            thread_id: Mutex::new(None),
            items_by_id: Mutex::new(HashMap::new()),
            pending_feedback: Mutex::new(VecDeque::new()),
            repo_context,
            commit_reminder,
            commit_reminder_prompt,
            commit_reminder_sent: AtomicBool::new(false),
            turn_started: AtomicBool::new(false),
            cancel,
            turn_error: Mutex::new(None),
        })
    }

    pub fn connect(&self, peer: JsonRpcPeer) {
        let _ = self.rpc.set(peer);
    }

    fn rpc(&self) -> &JsonRpcPeer {
        self.rpc.get().expect("Codex RPC peer not attached")
    }

    pub fn log_writer(&self) -> &LogWriter {
        &self.log_writer
    }

    pub async fn take_turn_error(&self) -> Option<String> {
        self.turn_error.lock().await.take()
    }

    pub async fn initialize(&self) -> Result<(), ExecutorError> {
        let request = ClientRequest::Initialize {
            request_id: self.next_request_id(),
            params: InitializeParams {
                client_info: ClientInfo {
                    name: "vibe-codex-executor".to_string(),
                    title: None,
                    version: env!("CARGO_PKG_VERSION").to_string(),
                },
                capabilities: Some(InitializeCapabilities {
                    experimental_api: true,
                    opt_out_notification_methods: None,
                }),
            },
        };

        self.send_request::<InitializeResponse>(request, "initialize")
            .await?;
        self.send_message(&ClientNotification::Initialized).await
    }

    pub async fn start_thread(
        &self,
        params: ThreadStartParams,
    ) -> Result<ThreadStartResponse, ExecutorError> {
        let request = ClientRequest::ThreadStart {
            request_id: self.next_request_id(),
            params,
        };
        self.send_request(request, "thread/start").await
    }

    pub async fn resume_thread(
        &self,
        params: ThreadResumeParams,
    ) -> Result<ThreadResumeResponse, ExecutorError> {
        let request = ClientRequest::ThreadResume {
            request_id: self.next_request_id(),
            params,
        };
        self.send_request(request, "thread/resume").await
    }

    pub async fn start_turn(
        &self,
        thread_id: String,
        message: String,
    ) -> Result<TurnStartResponse, ExecutorError> {
        let request = ClientRequest::TurnStart {
            request_id: self.next_request_id(),
            params: TurnStartParams {
                thread_id,
                input: vec![UserInput::Text {
                    text: message,
                    text_elements: Vec::new(),
                }],
                ..Default::default()
            },
        };
        self.send_request(request, "turn/start").await
    }

    pub async fn get_auth_status(&self) -> Result<GetAuthStatusResponse, ExecutorError> {
        let request = ClientRequest::GetAuthStatus {
            request_id: self.next_request_id(),
            params: GetAuthStatusParams {
                include_token: Some(true),
                refresh_token: Some(false),
            },
        };
        self.send_request(request, "getAuthStatus").await
    }

    pub async fn start_review(
        &self,
        thread_id: String,
        target: ReviewTarget,
    ) -> Result<ReviewStartResponse, ExecutorError> {
        let request = ClientRequest::ReviewStart {
            request_id: self.next_request_id(),
            params: ReviewStartParams {
                thread_id,
                target,
                delivery: None,
            },
        };
        self.send_request(request, "review/start").await
    }

    pub async fn start_compact(
        &self,
        thread_id: String,
    ) -> Result<ThreadCompactStartResponse, ExecutorError> {
        let request = ClientRequest::ThreadCompactStart {
            request_id: self.next_request_id(),
            params: ThreadCompactStartParams { thread_id },
        };
        self.send_request(request, "thread/compact/start").await
    }

    pub async fn list_mcp_server_status(
        &self,
        cursor: Option<String>,
    ) -> Result<ListMcpServerStatusResponse, ExecutorError> {
        let request = ClientRequest::McpServerStatusList {
            request_id: self.next_request_id(),
            params: ListMcpServerStatusParams {
                cursor,
                limit: None,
                detail: None,
            },
        };
        self.send_request(request, "mcpServerStatus/list").await
    }

    async fn handle_server_request(
        &self,
        peer: &JsonRpcPeer,
        request: ServerRequest,
    ) -> Result<(), ExecutorError> {
        match request {
            ServerRequest::ApplyPatchApproval { request_id, params } => {
                let input = serde_json::to_value(&params)
                    .map_err(|err| ExecutorError::Io(io::Error::other(err.to_string())))?;
                let status = self
                    .request_tool_approval("edit", input, &params.call_id)
                    .await
                    .map_err(|err| {
                        if !matches!(
                            err,
                            ExecutorError::ExecutorApprovalError(ExecutorApprovalError::Cancelled)
                        ) {
                            tracing::error!(
                                "Codex apply_patch approval failed for call_id={}: {err}",
                                params.call_id
                            );
                        }
                        err
                    })?;
                self.log_writer
                    .log_raw(
                        &Approval::approval_response(
                            params.call_id,
                            "codex.apply_patch".to_string(),
                            status.clone(),
                        )
                        .raw(),
                    )
                    .await?;
                let (decision, feedback) = self.legacy_review_decision(&status);
                let response = ApplyPatchApprovalResponse { decision };
                send_server_response(peer, request_id, response).await?;
                if let Some(message) = feedback {
                    tracing::debug!("queueing patch denial feedback: {message}");
                    self.enqueue_feedback(message).await;
                }
                Ok(())
            }
            ServerRequest::ExecCommandApproval { request_id, params } => {
                let input = serde_json::to_value(&params)
                    .map_err(|err| ExecutorError::Io(io::Error::other(err.to_string())))?;
                let status = self
                    .request_tool_approval("bash", input, &params.call_id)
                    .await
                    .map_err(|err| {
                        tracing::error!(
                            "Codex exec_command approval failed for call_id={}: {err}",
                            params.call_id
                        );
                        err
                    })?;
                self.log_writer
                    .log_raw(
                        &Approval::approval_response(
                            params.call_id,
                            "codex.exec_command".to_string(),
                            status.clone(),
                        )
                        .raw(),
                    )
                    .await?;

                let (decision, feedback) = self.legacy_review_decision(&status);
                let response = ExecCommandApprovalResponse { decision };
                send_server_response(peer, request_id, response).await?;
                if let Some(message) = feedback {
                    tracing::debug!("queueing exec denial feedback: {message}");
                    self.enqueue_feedback(message).await;
                }
                Ok(())
            }
            ServerRequest::CommandExecutionRequestApproval { request_id, params } => {
                let input = self
                    .approval_input("commandExecution", &params.item_id, &params)
                    .await?;
                let status = self
                    .request_tool_approval("bash", input, &params.item_id)
                    .await
                    .map_err(|err| {
                        tracing::error!(
                            "Codex command approval failed for item_id={}: {err}",
                            params.item_id
                        );
                        err
                    })?;
                self.log_writer
                    .log_raw(
                        &Approval::approval_response(
                            params.item_id.clone(),
                            "codex.exec_command".to_string(),
                            status.clone(),
                        )
                        .raw(),
                    )
                    .await?;

                let (decision, feedback) = self.command_approval_decision(&status);
                let response = CommandExecutionRequestApprovalResponse { decision };
                send_server_response(peer, request_id, response).await?;
                if let Some(message) = feedback {
                    tracing::debug!("queueing command denial feedback: {message}");
                    self.enqueue_feedback(message).await;
                }
                Ok(())
            }
            ServerRequest::FileChangeRequestApproval { request_id, params } => {
                let input = self
                    .approval_input("fileChange", &params.item_id, &params)
                    .await?;
                let status = self
                    .request_tool_approval("edit", input, &params.item_id)
                    .await
                    .map_err(|err| {
                        tracing::error!(
                            "Codex file change approval failed for item_id={}: {err}",
                            params.item_id
                        );
                        err
                    })?;
                self.log_writer
                    .log_raw(
                        &Approval::approval_response(
                            params.item_id.clone(),
                            "codex.apply_patch".to_string(),
                            status.clone(),
                        )
                        .raw(),
                    )
                    .await?;

                let (decision, feedback) = self.file_change_approval_decision(&status);
                let response = FileChangeRequestApprovalResponse { decision };
                send_server_response(peer, request_id, response).await?;
                if let Some(message) = feedback {
                    tracing::debug!("queueing file change denial feedback: {message}");
                    self.enqueue_feedback(message).await;
                }
                Ok(())
            }
            ServerRequest::ToolRequestUserInput { request_id, params } => {
                let answers = params
                    .questions
                    .into_iter()
                    .map(|question| {
                        (
                            question.id,
                            ToolRequestUserInputAnswer {
                                answers: Vec::new(),
                            },
                        )
                    })
                    .collect();
                let response = ToolRequestUserInputResponse { answers };
                send_server_response(peer, request_id, response).await
            }
            ServerRequest::McpServerElicitationRequest { request_id, .. } => {
                let response = McpServerElicitationRequestResponse {
                    action: McpServerElicitationAction::Decline,
                    content: None,
                    meta: None,
                };
                send_server_response(peer, request_id, response).await
            }
            ServerRequest::PermissionsRequestApproval { request_id, .. } => {
                let response = PermissionsRequestApprovalResponse {
                    permissions: GrantedPermissionProfile::default(),
                    scope: PermissionGrantScope::Turn,
                    strict_auto_review: None,
                };
                send_server_response(peer, request_id, response).await
            }
            ServerRequest::DynamicToolCall { request_id, params } => {
                let response = DynamicToolCallResponse {
                    content_items: vec![DynamicToolCallOutputContentItem::InputText {
                        text: format!(
                            "Dynamic tool `{}` is not supported by this executor.",
                            params.tool
                        ),
                    }],
                    success: false,
                };
                send_server_response(peer, request_id, response).await
            }
            ServerRequest::ChatgptAuthTokensRefresh { request_id, .. } => {
                send_server_error(
                    peer,
                    request_id,
                    -32000,
                    "chatgpt auth token refresh is not supported by this executor",
                )
                .await
            }
        }
    }

    async fn request_tool_approval(
        &self,
        tool_name: &str,
        tool_input: Value,
        tool_call_id: &str,
    ) -> Result<ApprovalStatus, ExecutorError> {
        if self.auto_approve {
            return Ok(ApprovalStatus::Approved);
        }
        let approval_service = self
            .approvals
            .as_ref()
            .ok_or(ExecutorApprovalError::ServiceUnavailable)?;

        Ok(approval_service
            .request_tool_approval(tool_name, tool_input, tool_call_id, self.cancel.clone())
            .await?)
    }

    pub async fn register_session(&self, thread_id: &str) -> Result<(), ExecutorError> {
        {
            let mut guard = self.thread_id.lock().await;
            guard.replace(thread_id.to_string());
        }
        self.flush_pending_feedback().await;
        Ok(())
    }

    async fn send_message<M>(&self, message: &M) -> Result<(), ExecutorError>
    where
        M: Serialize + Sync,
    {
        self.rpc().send(message).await
    }

    async fn send_request<R>(&self, request: ClientRequest, label: &str) -> Result<R, ExecutorError>
    where
        R: DeserializeOwned + std::fmt::Debug,
    {
        let request_id = request_id(&request);
        self.rpc()
            .request(request_id, &request, label, self.cancel.clone())
            .await
    }

    fn next_request_id(&self) -> RequestId {
        self.rpc().next_request_id()
    }

    async fn enqueue_feedback(&self, message: String) {
        if message.trim().is_empty() {
            return;
        }
        let mut guard = self.pending_feedback.lock().await;
        guard.push_back(message);
    }

    async fn flush_pending_feedback(&self) -> bool {
        let messages: Vec<String> = {
            let mut guard = self.pending_feedback.lock().await;
            guard.drain(..).collect()
        };

        if messages.is_empty() {
            return false;
        }

        let Some(thread_id) = self.thread_id.lock().await.clone() else {
            tracing::warn!(
                "pending Codex feedback but thread id unavailable; dropping {} messages",
                messages.len()
            );
            return false;
        };

        let mut sent = false;
        for message in messages {
            let trimmed = message.trim();
            if trimmed.is_empty() {
                continue;
            }
            self.spawn_user_message(thread_id.clone(), format!("User feedback: {trimmed}"));
            sent = true;
        }
        sent
    }

    fn spawn_user_message(&self, thread_id: String, message: String) {
        let peer = self.rpc().clone();
        let cancel = self.cancel.clone();
        let request = ClientRequest::TurnStart {
            request_id: peer.next_request_id(),
            params: TurnStartParams {
                thread_id,
                input: vec![UserInput::Text {
                    text: message,
                    text_elements: Vec::new(),
                }],
                ..Default::default()
            },
        };
        tokio::spawn(async move {
            if let Err(err) = peer
                .request::<TurnStartResponse, _>(
                    request_id(&request),
                    &request,
                    "turn/start",
                    cancel,
                )
                .await
            {
                tracing::error!("failed to send follow-up turn: {err}");
            }
        });
    }

    async fn approval_input<T: Serialize>(
        &self,
        request_type: &str,
        item_id: &str,
        params: &T,
    ) -> Result<Value, ExecutorError> {
        let mut input = Map::new();
        input.insert(
            "requestType".to_string(),
            Value::String(request_type.to_string()),
        );
        input.insert(
            "params".to_string(),
            serde_json::to_value(params)
                .map_err(|err| ExecutorError::Io(io::Error::other(err.to_string())))?,
        );
        if let Some(item) = self.items_by_id.lock().await.get(item_id).cloned() {
            input.insert(
                "item".to_string(),
                serde_json::to_value(item)
                    .map_err(|err| ExecutorError::Io(io::Error::other(err.to_string())))?,
            );
        }
        Ok(Value::Object(input))
    }

    fn command_approval_decision(
        &self,
        status: &ApprovalStatus,
    ) -> (CommandExecutionApprovalDecision, Option<String>) {
        if self.auto_approve {
            return (CommandExecutionApprovalDecision::AcceptForSession, None);
        }

        match status {
            ApprovalStatus::Approved => (CommandExecutionApprovalDecision::Accept, None),
            ApprovalStatus::Denied { reason } => {
                let feedback = reason
                    .as_ref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                if feedback.is_some() {
                    (CommandExecutionApprovalDecision::Cancel, feedback)
                } else {
                    (CommandExecutionApprovalDecision::Decline, None)
                }
            }
            ApprovalStatus::TimedOut | ApprovalStatus::Pending => {
                (CommandExecutionApprovalDecision::Decline, None)
            }
        }
    }

    fn file_change_approval_decision(
        &self,
        status: &ApprovalStatus,
    ) -> (FileChangeApprovalDecision, Option<String>) {
        if self.auto_approve {
            return (FileChangeApprovalDecision::AcceptForSession, None);
        }

        match status {
            ApprovalStatus::Approved => (FileChangeApprovalDecision::Accept, None),
            ApprovalStatus::Denied { reason } => {
                let feedback = reason
                    .as_ref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                if feedback.is_some() {
                    (FileChangeApprovalDecision::Cancel, feedback)
                } else {
                    (FileChangeApprovalDecision::Decline, None)
                }
            }
            ApprovalStatus::TimedOut | ApprovalStatus::Pending => {
                (FileChangeApprovalDecision::Decline, None)
            }
        }
    }

    fn legacy_review_decision(&self, status: &ApprovalStatus) -> (ReviewDecision, Option<String>) {
        if self.auto_approve {
            return (ReviewDecision::ApprovedForSession, None);
        }

        match status {
            ApprovalStatus::Approved => (ReviewDecision::Approved, None),
            ApprovalStatus::Denied { reason } => {
                let feedback = reason
                    .as_ref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                if feedback.is_some() {
                    (ReviewDecision::Abort, feedback)
                } else {
                    (ReviewDecision::Denied, None)
                }
            }
            ApprovalStatus::TimedOut | ApprovalStatus::Pending => (ReviewDecision::Denied, None),
        }
    }

    async fn cache_notification_item(&self, notification: &ServerNotification) {
        let item = match notification {
            ServerNotification::ItemStarted(payload) => Some(payload.item.clone()),
            ServerNotification::ItemCompleted(payload) => Some(payload.item.clone()),
            _ => None,
        };

        let Some(item) = item else {
            return;
        };

        let Some(item_id) = thread_item_id(&item) else {
            return;
        };

        self.items_by_id
            .lock()
            .await
            .insert(item_id.to_string(), item);
    }

    async fn handle_notification(
        &self,
        raw: &str,
        notification: JSONRPCNotification,
    ) -> Result<bool, ExecutorError> {
        let parsed_notification = ServerNotification::try_from(notification.clone())
            .ok()
            .or_else(|| serde_json::from_str::<ServerNotification>(raw).ok());
        if let Some(server_notification) = parsed_notification.as_ref() {
            self.cache_notification_item(server_notification).await;
        }

        let raw = Cow::Borrowed(raw);
        self.log_writer.log_raw(&raw).await?;

        if let Some(server_notification) = parsed_notification {
            if let ServerNotification::TurnStarted(started) = &server_notification {
                self.turn_started.store(true, Ordering::SeqCst);
                tracing::debug!(
                    thread_id = %started.thread_id,
                    turn_id = %started.turn.id,
                    "[codex-client] turn started"
                );
            }

            if let ServerNotification::TurnCompleted(TurnCompletedNotification {
                thread_id,
                turn,
            }) = server_notification
            {
                let has_finished = matches!(
                    turn.status,
                    TurnStatus::Completed | TurnStatus::Interrupted | TurnStatus::Failed
                );

                if has_finished
                    && matches!(turn.status, TurnStatus::Completed)
                    && self.commit_reminder
                    && !self.commit_reminder_sent.swap(true, Ordering::SeqCst)
                    && let status = self.repo_context.check_uncommitted_changes().await
                    && !status.is_empty()
                {
                    let prompt = format!("{}\n{}", self.commit_reminder_prompt, status);
                    self.spawn_user_message(thread_id, prompt);
                    return Ok(false);
                }

                if self.flush_pending_feedback().await {
                    return Ok(false);
                }

                if has_finished {
                    // If the turn failed with an error, store it for the exit signal
                    if matches!(turn.status, TurnStatus::Failed) {
                        if let Some(ref error) = turn.error {
                            if !error.message.is_empty() {
                                tracing::warn!(
                                    thread_id = %thread_id,
                                    turn_id = %turn.id,
                                    error_message = %error.message,
                                    "[codex-client] turn failed with error"
                                );
                                *self.turn_error.lock().await = Some(error.message.clone());
                            }
                        }
                    }
                    tracing::debug!(
                        thread_id = %thread_id,
                        turn_id = %turn.id,
                        status = ?turn.status,
                        "[codex-client] terminal turn/completed notification"
                    );
                    return Ok(true);
                }

                return Ok(false);
            }

            if let ServerNotification::ThreadStatusChanged(status) = server_notification {
                if matches!(status.status, codex_app_server_protocol::ThreadStatus::Idle)
                    && self.turn_started.load(Ordering::SeqCst)
                {
                    tracing::debug!(
                        thread_id = %status.thread_id,
                        status = ?status.status,
                        "[codex-client] terminal thread/status/changed notification"
                    );
                    return Ok(true);
                } else if matches!(status.status, codex_app_server_protocol::ThreadStatus::Idle) {
                    tracing::debug!(
                        thread_id = %status.thread_id,
                        status = ?status.status,
                        "[codex-client] ignoring idle thread status before turn start"
                    );
                }
            }

            return Ok(false);
        }

        if is_terminal_app_server_notification(
            &notification,
            self.turn_started.load(Ordering::SeqCst),
        ) {
            tracing::debug!(
                method = %notification.method,
                "[codex-client] terminal raw app-server notification"
            );
            return Ok(true);
        }

        let method = notification.method.as_str();
        if !method.starts_with("codex/event") {
            return Ok(false);
        }

        if method.ends_with("turn_aborted") {
            tracing::debug!("codex turn aborted; flushing feedback queue");
            self.flush_pending_feedback().await;
            return Ok(false);
        }

        let has_finished = method
            .strip_prefix("codex/event/")
            .is_some_and(|suffix| suffix == "task_complete");

        if has_finished
            && self.commit_reminder
            && !self.commit_reminder_sent.swap(true, Ordering::SeqCst)
            && let status = self.repo_context.check_uncommitted_changes().await
            && !status.is_empty()
            && let Some(thread_id) = self.thread_id.lock().await.clone()
        {
            let prompt = format!("{}\n{}", self.commit_reminder_prompt, status);
            self.spawn_user_message(thread_id, prompt);
            return Ok(false);
        }

        if has_finished {
            tracing::debug!(
                method = %method,
                "[codex-client] terminal legacy codex event notification"
            );
        }

        Ok(has_finished)
    }
}

fn is_terminal_app_server_notification(
    notification: &JSONRPCNotification,
    turn_started: bool,
) -> bool {
    match notification.method.as_str() {
        "turn/completed" => notification
            .params
            .as_ref()
            .and_then(|params| params.get("turn"))
            .and_then(|turn| turn.get("status"))
            .and_then(serde_json::Value::as_str)
            .is_some_and(|status| matches!(status, "completed" | "interrupted" | "failed")),
        "thread/status/changed" => notification
            .params
            .as_ref()
            .and_then(|params| params.get("status"))
            .and_then(|status| status.get("type"))
            .and_then(serde_json::Value::as_str)
            .is_some_and(|status| status == "idle" && turn_started),
        _ => false,
    }
}

#[async_trait]
impl JsonRpcCallbacks for AppServerClient {
    async fn on_request(
        &self,
        peer: &JsonRpcPeer,
        raw: &str,
        request: JSONRPCRequest,
    ) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await?;
        match ServerRequest::try_from(request.clone()) {
            Ok(server_request) => self.handle_server_request(peer, server_request).await,
            Err(err) => {
                tracing::debug!("Unhandled server request `{}`: {err}", request.method);
                let response = JSONRPCResponse {
                    id: request.id,
                    result: Value::Null,
                };
                peer.send(&response).await
            }
        }
    }

    async fn on_response(
        &self,
        _peer: &JsonRpcPeer,
        raw: &str,
        _response: &JSONRPCResponse,
    ) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await
    }

    async fn on_error(
        &self,
        _peer: &JsonRpcPeer,
        raw: &str,
        _error: &JSONRPCError,
    ) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await
    }

    async fn on_notification(
        &self,
        _peer: &JsonRpcPeer,
        raw: &str,
        notification: JSONRPCNotification,
    ) -> Result<bool, ExecutorError> {
        self.handle_notification(raw, notification).await
    }

    async fn on_non_json(&self, raw: &str) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await?;
        Ok(())
    }

    async fn get_exit_result(&self) -> ExecutorExitResult {
        match self.take_turn_error().await {
            Some(error_msg) => ExecutorExitResult::FailureWithError(error_msg),
            None => ExecutorExitResult::Success,
        }
    }
}

async fn send_server_response<T>(
    peer: &JsonRpcPeer,
    request_id: RequestId,
    response: T,
) -> Result<(), ExecutorError>
where
    T: Serialize,
{
    let payload = JSONRPCResponse {
        id: request_id,
        result: serde_json::to_value(response)
            .map_err(|err| ExecutorError::Io(io::Error::other(err.to_string())))?,
    };

    peer.send(&payload).await
}

fn request_id(request: &ClientRequest) -> RequestId {
    match request {
        ClientRequest::Initialize { request_id, .. }
        | ClientRequest::ThreadStart { request_id, .. }
        | ClientRequest::GetAuthStatus { request_id, .. }
        | ClientRequest::ThreadResume { request_id, .. }
        | ClientRequest::TurnStart { request_id, .. }
        | ClientRequest::ReviewStart { request_id, .. }
        | ClientRequest::ThreadCompactStart { request_id, .. }
        | ClientRequest::McpServerStatusList { request_id, .. } => request_id.clone(),
        _ => unreachable!("request_id called for unsupported request variant"),
    }
}

fn thread_item_id(item: &ThreadItem) -> Option<&str> {
    match item {
        ThreadItem::UserMessage { id, .. }
        | ThreadItem::HookPrompt { id, .. }
        | ThreadItem::AgentMessage { id, .. }
        | ThreadItem::Reasoning { id, .. }
        | ThreadItem::CommandExecution { id, .. }
        | ThreadItem::FileChange { id, .. }
        | ThreadItem::McpToolCall { id, .. }
        | ThreadItem::DynamicToolCall { id, .. }
        | ThreadItem::CollabAgentToolCall { id, .. }
        | ThreadItem::WebSearch { id, .. }
        | ThreadItem::ImageView { id, .. }
        | ThreadItem::ImageGeneration { id, .. }
        | ThreadItem::Plan { id, .. }
        | ThreadItem::EnteredReviewMode { id, .. }
        | ThreadItem::ExitedReviewMode { id, .. }
        | ThreadItem::ContextCompaction { id, .. } => Some(id.as_str()),
    }
}

async fn send_server_error(
    peer: &JsonRpcPeer,
    request_id: RequestId,
    code: i64,
    message: impl Into<String>,
) -> Result<(), ExecutorError> {
    let payload = JSONRPCError {
        id: request_id,
        error: JSONRPCErrorError {
            code,
            data: None,
            message: message.into(),
        },
    };

    peer.send(&payload).await
}

#[derive(Clone)]
pub struct LogWriter {
    writer: Arc<Mutex<BufWriter<Box<dyn AsyncWrite + Send + Unpin>>>>,
}

impl LogWriter {
    pub fn new(writer: impl AsyncWrite + Send + Unpin + 'static) -> Self {
        Self {
            writer: Arc::new(Mutex::new(BufWriter::new(Box::new(writer)))),
        }
    }

    pub async fn log_raw(&self, raw: &str) -> Result<(), ExecutorError> {
        let raw = redact_sensitive_raw_log(raw);
        let mut guard = self.writer.lock().await;
        guard
            .write_all(raw.as_bytes())
            .await
            .map_err(ExecutorError::Io)?;
        guard.write_all(b"\n").await.map_err(ExecutorError::Io)?;
        guard.flush().await.map_err(ExecutorError::Io)?;
        Ok(())
    }
}

const REDACTED_LOG_VALUE: &str = "[redacted]";

fn redact_sensitive_raw_log(raw: &str) -> Cow<'_, str> {
    let Ok(mut value) = serde_json::from_str::<Value>(raw) else {
        return Cow::Borrowed(raw);
    };

    redact_sensitive_value(&mut value);

    match serde_json::to_string(&value) {
        Ok(redacted) => Cow::Owned(redacted),
        Err(_) => Cow::Borrowed(raw),
    }
}

fn redact_sensitive_value(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, value) in map.iter_mut() {
                if is_sensitive_log_key(key) {
                    *value = Value::String(REDACTED_LOG_VALUE.to_string());
                } else {
                    redact_sensitive_value(value);
                }
            }
        }
        Value::Array(values) => {
            for value in values {
                redact_sensitive_value(value);
            }
        }
        _ => {}
    }
}

fn is_sensitive_log_key(key: &str) -> bool {
    matches!(
        key,
        "authToken"
            | "accessToken"
            | "refreshToken"
            | "idToken"
            | "apiKey"
            | "api_key"
            | "authorization"
            | "Authorization"
    )
}

#[cfg(test)]
mod tests {
    use codex_app_server_protocol::{
        JSONRPCNotification, Turn, TurnCompletedNotification, TurnStatus,
    };
    use tokio::io::sink;
    use tokio_util::sync::CancellationToken;

    use super::{AppServerClient, LogWriter, redact_sensitive_raw_log};
    use crate::env::RepoContext;

    fn build_client() -> std::sync::Arc<AppServerClient> {
        AppServerClient::new(
            LogWriter::new(sink()),
            None,
            true,
            RepoContext::default(),
            false,
            String::new(),
            CancellationToken::new(),
        )
    }

    #[test]
    fn raw_log_redaction_removes_auth_tokens() {
        let raw = serde_json::json!({
            "id": 2,
            "result": {
                "authMethod": "chatgpt",
                "authToken": "secret-token",
                "nested": {
                    "refreshToken": "refresh-secret",
                    "tokenUsage": {
                        "totalTokens": 123
                    }
                }
            }
        })
        .to_string();

        let redacted = redact_sensitive_raw_log(&raw);
        let value: serde_json::Value = serde_json::from_str(&redacted).unwrap();

        assert_eq!(value["result"]["authToken"], "[redacted]");
        assert_eq!(value["result"]["nested"]["refreshToken"], "[redacted]");
        assert_eq!(value["result"]["nested"]["tokenUsage"]["totalTokens"], 123);
        assert!(!redacted.contains("secret-token"));
        assert!(!redacted.contains("refresh-secret"));
    }

    #[tokio::test]
    async fn turn_completed_finishes_stream() {
        let client = build_client();
        let params = TurnCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn: Turn {
                id: "turn-1".to_string(),
                items: Vec::new(),
                status: TurnStatus::Completed,
                error: None,
                started_at: None,
                completed_at: None,
                duration_ms: None,
            },
        };
        let notification = JSONRPCNotification {
            method: "turn/completed".to_string(),
            params: Some(serde_json::to_value(params).unwrap()),
        };
        let raw = serde_json::to_string(&notification).unwrap();

        let should_finish = client
            .handle_notification(&raw, notification)
            .await
            .unwrap();

        assert!(should_finish);
    }

    #[tokio::test]
    async fn in_progress_turn_completed_does_not_finish_stream() {
        let client = build_client();
        let params = TurnCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn: Turn {
                id: "turn-1".to_string(),
                items: Vec::new(),
                status: TurnStatus::InProgress,
                error: None,
                started_at: None,
                completed_at: None,
                duration_ms: None,
            },
        };
        let notification = JSONRPCNotification {
            method: "turn/completed".to_string(),
            params: Some(serde_json::to_value(params).unwrap()),
        };
        let raw = serde_json::to_string(&notification).unwrap();

        let should_finish = client
            .handle_notification(&raw, notification)
            .await
            .unwrap();

        assert!(!should_finish);
    }

    #[tokio::test]
    async fn idle_thread_status_before_turn_start_does_not_finish_stream() {
        let client = build_client();
        let raw = serde_json::json!({
            "method": "thread/status/changed",
            "params": {
                "threadId": "thread-1",
                "status": { "type": "idle" }
            }
        })
        .to_string();
        let notification: JSONRPCNotification = serde_json::from_str(&raw).unwrap();

        let should_finish = client
            .handle_notification(&raw, notification)
            .await
            .unwrap();

        assert!(!should_finish);
    }

    #[tokio::test]
    async fn idle_thread_status_after_turn_start_finishes_stream() {
        let client = build_client();
        let turn_started_raw = serde_json::json!({
            "method": "turn/started",
            "params": {
                "threadId": "thread-1",
                "turn": {
                    "id": "turn-1",
                    "items": [],
                    "status": "inProgress",
                    "error": null,
                    "startedAt": 1,
                    "completedAt": null,
                    "durationMs": null
                }
            }
        })
        .to_string();
        let turn_started_notification: JSONRPCNotification =
            serde_json::from_str(&turn_started_raw).unwrap();
        let started_should_finish = client
            .handle_notification(&turn_started_raw, turn_started_notification)
            .await
            .unwrap();
        assert!(!started_should_finish);

        let raw = serde_json::json!({
            "method": "thread/status/changed",
            "params": {
                "threadId": "thread-1",
                "status": { "type": "idle" }
            }
        })
        .to_string();
        let notification: JSONRPCNotification = serde_json::from_str(&raw).unwrap();

        let should_finish = client
            .handle_notification(&raw, notification)
            .await
            .unwrap();

        assert!(should_finish);
    }

    #[tokio::test]
    async fn task_complete_finishes_stream() {
        let client = build_client();
        let raw = serde_json::json!({
            "method": "codex/event/task_complete",
            "params": {
                "id": "turn-1",
                "msg": {
                    "type": "task_complete",
                    "turn_id": "turn-1",
                    "last_agent_message": "final output"
                },
                "conversationId": "thread-1"
            }
        })
        .to_string();
        let notification: JSONRPCNotification = serde_json::from_str(&raw).unwrap();

        let should_finish = client
            .handle_notification(&raw, notification)
            .await
            .unwrap();

        assert!(should_finish);
    }
}
