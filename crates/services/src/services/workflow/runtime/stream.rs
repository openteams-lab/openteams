use crate::services::agent_activity_stream::{
    tool_activity_content, truncate_activity_line, AgentActivityStreamState,
};
#[cfg(test)]
use crate::services::agent_activity_stream::{activity_line_for_entry, AgentActivityEntryLine};

#[derive(Default)]
struct WorkflowRuntimeStreamState {
    inner: AgentActivityStreamState,
}

impl WorkflowRuntimeStreamState {
    fn drain_patch_lines(&mut self, patch: &Patch) -> Vec<(ChatStreamDeltaType, String)> {
        self.inner
            .drain_patch_lines(patch, false)
            .into_iter()
            .map(|line| (line.stream_type, line.content))
            .collect()
    }

    fn flush_pending_lines(&mut self) -> Vec<(ChatStreamDeltaType, String)> {
        self.inner
            .flush_pending_lines()
            .into_iter()
            .map(|line| (line.stream_type, line.content))
            .collect()
    }
}

// AssistantMessage remains reserved for the final workflow protocol payload, so
// workflow runtime streaming uses the shared activity mapper with assistant
// lines disabled.
#[cfg(test)]
fn workflow_runtime_line_for_entry(entry: &NormalizedEntry) -> Option<AgentActivityEntryLine> {
    activity_line_for_entry(entry, false)
}

fn workflow_tool_activity_content(
    tool_name: &str,
    action_type: &ActionType,
    status: &ToolStatus,
    fallback_content: &str,
) -> Option<String> {
    tool_activity_content(tool_name, action_type, status, fallback_content)
}

fn truncate_workflow_runtime_line(value: &str) -> String {
    truncate_activity_line(value)
}

async fn finish_workflow_runtime_stream(
    msg_store: &Arc<MsgStore>,
    stream_task: &mut Option<tokio::task::JoinHandle<()>>,
) {
    msg_store.push_finished();
    if let Some(task) = stream_task.take() {
        let _ = time::timeout(WORKFLOW_DRAIN_TIMEOUT, task).await;
    }
}

async fn finish_workflow_runtime_session_id_persistor(
    session_id_task: &mut Option<tokio::task::JoinHandle<()>>,
) {
    if let Some(task) = session_id_task.take() {
        time::sleep(WORKFLOW_SESSION_ID_DRAIN_TIMEOUT).await;
        task.abort();
        let _ = task.await;
    }
}

fn spawn_workflow_runtime_session_id_persistor(
    pool: SqlitePool,
    session_agent_id: Uuid,
    workflow_agent_session_id: Option<Uuid>,
    msg_store: Arc<MsgStore>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut stream = msg_store.history_plus_stream();
        let mut last_agent_session_id: Option<String> = None;
        let mut last_agent_message_id: Option<String> = None;

        while let Some(item) = stream.next().await {
            match item {
                Ok(LogMsg::SessionId(agent_session_id)) => {
                    if last_agent_session_id.as_deref() == Some(agent_session_id.as_str()) {
                        continue;
                    }
                    last_agent_session_id = Some(agent_session_id.clone());

                    if let Err(error) = ChatSessionAgent::update_agent_session_id(
                        &pool,
                        session_agent_id,
                        Some(agent_session_id.clone()),
                    )
                    .await
                    {
                        tracing::warn!(
                            session_agent_id = %session_agent_id,
                            %error,
                            "failed to persist workflow runtime agent_session_id on session agent"
                        );
                    }

                    if let Some(workflow_agent_session_id) = workflow_agent_session_id
                        && let Err(error) = WorkflowAgentSession::update_agent_session_id(
                            &pool,
                            workflow_agent_session_id,
                            Some(agent_session_id),
                        )
                        .await
                    {
                        tracing::warn!(
                            workflow_agent_session_id = %workflow_agent_session_id,
                            %error,
                            "failed to persist workflow runtime agent_session_id on workflow agent session"
                        );
                    }
                }
                Ok(LogMsg::MessageId(agent_message_id)) => {
                    if last_agent_message_id.as_deref() == Some(agent_message_id.as_str()) {
                        continue;
                    }
                    last_agent_message_id = Some(agent_message_id.clone());

                    if let Err(error) = ChatSessionAgent::update_agent_message_id(
                        &pool,
                        session_agent_id,
                        Some(agent_message_id.clone()),
                    )
                    .await
                    {
                        tracing::warn!(
                            session_agent_id = %session_agent_id,
                            %error,
                            "failed to persist workflow runtime agent_message_id on session agent"
                        );
                    }

                    if let Some(workflow_agent_session_id) = workflow_agent_session_id
                        && let Err(error) = WorkflowAgentSession::update_agent_message_id(
                            &pool,
                            workflow_agent_session_id,
                            Some(agent_message_id),
                        )
                        .await
                    {
                        tracing::warn!(
                            workflow_agent_session_id = %workflow_agent_session_id,
                            %error,
                            "failed to persist workflow runtime agent_message_id on workflow agent session"
                        );
                    }
                }
                _ => {}
            }
        }
    })
}

#[allow(clippy::too_many_arguments)]
async fn persist_and_emit_workflow_runtime_line(
    pool: &SqlitePool,
    chat_runner: &ChatRunner,
    session_id: Uuid,
    execution_id: Uuid,
    workflow_agent_session_id: Option<Uuid>,
    step_id: Uuid,
    step_key: &str,
    agent_id: Uuid,
    agent_name: &str,
    stream_type: ChatStreamDeltaType,
    content: String,
    persist_error_message: &'static str,
) {
    let created_at = Utc::now().to_rfc3339();
    match persist_workflow_runtime_transcript_line(
        pool,
        execution_id,
        workflow_agent_session_id,
        step_id,
        &content,
    )
    .await
    {
        Ok(_) => chat_runner.emit_workflow_runtime_line(
            session_id,
            execution_id,
            workflow_agent_session_id,
            step_id,
            step_key.to_string(),
            agent_id,
            agent_name.to_string(),
            stream_type,
            content,
            created_at,
        ),
        Err(error) => tracing::warn!(
            execution_id = %execution_id,
            step_id = %step_id,
            workflow_agent_session_id = ?workflow_agent_session_id,
            %error,
            "{}", persist_error_message
        ),
    }
}

#[allow(clippy::too_many_arguments)]
async fn drain_workflow_runtime_patch_lines(
    state: &mut AgentActivityStreamState,
    patch: &Patch,
    pool: &SqlitePool,
    chat_runner: &ChatRunner,
    session_id: Uuid,
    execution_id: Uuid,
    workflow_agent_session_id: Option<Uuid>,
    step_id: Uuid,
    step_key: &str,
    agent_id: Uuid,
    agent_name: &str,
) {
    let activity_lines = state.drain_patch_lines(patch, false);
    for activity_line in activity_lines {
        persist_and_emit_workflow_runtime_line(
            pool,
            chat_runner,
            session_id,
            execution_id,
            workflow_agent_session_id,
            step_id,
            step_key,
            agent_id,
            agent_name,
            activity_line.stream_type,
            activity_line.content,
            "failed to persist workflow runtime thinking line",
        )
        .await;
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_workflow_runtime_stream(
    pool: SqlitePool,
    chat_runner: ChatRunner,
    session_id: Uuid,
    execution_id: Uuid,
    workflow_agent_session_id: Option<Uuid>,
    step_id: Uuid,
    step_key: String,
    agent_id: Uuid,
    agent_name: String,
    msg_store: Arc<MsgStore>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut state = AgentActivityStreamState::default();
        let mut stream = msg_store.history_plus_stream();

        while let Some(item) = stream.next().await {
            match item {
                Ok(LogMsg::JsonPatch(patch)) => {
                    drain_workflow_runtime_patch_lines(
                        &mut state,
                        &patch,
                        &pool,
                        &chat_runner,
                        session_id,
                        execution_id,
                        workflow_agent_session_id,
                        step_id,
                        &step_key,
                        agent_id,
                        &agent_name,
                    )
                    .await;
                }
                Ok(LogMsg::Finished) => {
                    let drain_deadline =
                        time::Instant::now() + WORKFLOW_RUNTIME_STREAM_TAIL_DRAIN_TIMEOUT;
                    loop {
                        let remaining =
                            drain_deadline.saturating_duration_since(time::Instant::now());
                        if remaining.is_zero() {
                            break;
                        }

                        match time::timeout(remaining, stream.next()).await {
                            Ok(Some(Ok(LogMsg::JsonPatch(patch)))) => {
                                drain_workflow_runtime_patch_lines(
                                    &mut state,
                                    &patch,
                                    &pool,
                                    &chat_runner,
                                    session_id,
                                    execution_id,
                                    workflow_agent_session_id,
                                    step_id,
                                    &step_key,
                                    agent_id,
                                    &agent_name,
                                )
                                .await;
                            }
                            Ok(Some(Ok(_))) => {}
                            Ok(Some(Err(error))) => {
                                tracing::warn!(
                                    execution_id = %execution_id,
                                    step_id = %step_id,
                                    %error,
                                    "workflow runtime stream read failed during tail drain"
                                );
                                break;
                            }
                            Ok(None) | Err(_) => break,
                        }
                    }
                    break;
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::warn!(
                        execution_id = %execution_id,
                        step_id = %step_id,
                        %error,
                        "workflow runtime stream read failed"
                    );
                    break;
                }
            }
        }

        for activity_line in state.flush_pending_lines() {
            persist_and_emit_workflow_runtime_line(
                &pool,
                &chat_runner,
                session_id,
                execution_id,
                workflow_agent_session_id,
                step_id,
                &step_key,
                agent_id,
                &agent_name,
                activity_line.stream_type,
                activity_line.content,
                "failed to persist buffered workflow runtime thinking line",
            )
            .await;
        }
    })
}

#[derive(Clone)]
struct WorkflowRuntimeStreamContext {
    pool: SqlitePool,
    chat_runner: ChatRunner,
    session_id: Uuid,
    execution_id: Uuid,
    workflow_agent_session_id: Option<Uuid>,
    step_id: Uuid,
    step_key: String,
    agent_id: Uuid,
    agent_name: String,
}
