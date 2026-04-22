use std::{collections::HashMap, path::PathBuf, str::FromStr, sync::Arc, time::Duration};

use dashmap::DashMap;
use once_cell::sync::Lazy;

use db::{
    DBService,
    models::{
        chat_agent::ChatAgent,
        chat_message::{ChatMessage, ChatSenderType},
        chat_session::ChatSession,
        chat_session_agent::ChatSessionAgent,
        workflow_agent_session::WorkflowAgentSession,
        workflow_execution::WorkflowExecution,
        workflow_plan::WorkflowPlan,
        workflow_plan_revision::WorkflowPlanRevision,
        workflow_step::WorkflowStep,
        workflow_step_edge::WorkflowStepEdge,
        workflow_types::{
            WorkflowExecutionStatus, WorkflowPlanJson, WorkflowPlanNode, WorkflowStepStatus,
            WorkflowStepType,
        },
    },
};
use executors::{
    approvals::NoopExecutorApprovalService,
    env::{ExecutionEnv, RepoContext},
    executors::{
        BaseCodingAgent, ExecutorError, ExecutorExitResult, SpawnedChild,
        StandardCodingAgentExecutor,
    },
    logs::{NormalizedEntryType, utils::patch::extract_normalized_entry_from_patch},
    model_sync::with_model,
    profile::{ExecutorConfigs, ExecutorProfileId, canonical_variant_key},
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::{fs, time};
use tokio_util::io::ReaderStream;
use ts_rs::TS;
use utils::{log_msg::LogMsg, msg_store::MsgStore, utf8::Utf8LossyDecoder};
use uuid::Uuid;

const WORKFLOW_EXECUTION_TIMEOUT: Duration = Duration::from_secs(3600);
const WORKFLOW_DRAIN_TIMEOUT: Duration = Duration::from_millis(35);
const WORKFLOW_REAP_TIMEOUT: Duration = Duration::from_secs(3);
const WORKFLOW_KILL_WAIT_TIMEOUT: Duration = Duration::from_secs(2);
const EXECUTOR_PROFILE_VARIANT_KEY: &str = "executor_profile_variant";

/// Global registry: step_id → (CancellationToken, child_pid).
/// Used to cancel a running agent process when a step is interrupted.
static RUNNING_STEPS: Lazy<DashMap<Uuid, executors::executors::CancellationToken>> =
    Lazy::new(DashMap::new);

/// Cancel the running agent process for the given step, if any.
/// Called from the orchestrator's `interrupt_step` to truly stop execution.
pub fn cancel_running_step(step_id: Uuid) {
    if let Some((_, token)) = RUNNING_STEPS.remove(&step_id) {
        token.cancel();
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WorkflowRuntimeError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Executor(#[from] ExecutorError),
    #[error("workflow validation error: {0}")]
    Validation(String),
    #[error("workflow step interrupted: {0}")]
    Interrupted(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowCardAgent {
    pub session_agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_agent_session_id: Option<String>,
    pub agent_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowCardState {
    PreviewReady,
    PreviewInvalid,
    Pending,
    Running,
    Waiting,
    Paused,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowCardStep {
    pub id: String,
    pub step_key: String,
    pub title: String,
    pub step_type: String,
    pub status: String,
    pub agent_name: Option<String>,
    pub summary_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowCardProjection {
    pub execution_id: Option<String>,
    pub plan_id: String,
    pub revision_id: String,
    pub title: String,
    pub goal: String,
    pub state: WorkflowCardState,
    pub execution_status: String,
    pub error_message: Option<String>,
    pub completed_step_count: usize,
    pub total_step_count: usize,
    pub result_summary: Option<String>,
    pub outputs: Vec<String>,
    pub agents: Vec<WorkflowCardAgent>,
    pub steps: Vec<WorkflowCardStep>,
    pub plan: WorkflowPlanJson,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub validation_errors: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkflowStepProtocolMessage {
    FinalResult {
        step_key: String,
        execution_id: String,
        summary: String,
        content: String,
        #[serde(default)]
        outputs: Vec<String>,
    },
    Error {
        step_key: String,
        execution_id: String,
        message: String,
        #[serde(default)]
        content: Option<String>,
    },
    ApprovalRequest {
        step_key: String,
        execution_id: String,
        title: String,
        #[serde(default)]
        description: Option<String>,
    },
    PermissionRequest {
        step_key: String,
        execution_id: String,
        title: String,
        #[serde(default)]
        description: Option<String>,
    },
    ContinueConfirmation {
        step_key: String,
        execution_id: String,
        message: String,
        #[serde(default)]
        description: Option<String>,
    },
    InputRequest {
        step_key: String,
        execution_id: String,
        prompt: String,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        placeholder: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct WorkflowStepRunResult {
    pub run_id: Uuid,
    pub summary: String,
    pub content: String,
    pub outputs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryPayload {
    pub summary: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub outputs: Vec<String>,
}

pub fn extract_json_payload(raw_output: &str) -> Option<String> {
    let trimmed = raw_output.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed.to_string());
    }

    for pattern in ["```json", "```"] {
        if let Some(start) = trimmed.find(pattern) {
            let remainder = &trimmed[start + pattern.len()..];
            if let Some(end) = remainder.find("```") {
                let candidate = remainder[..end].trim();
                if candidate.starts_with('{') && candidate.ends_with('}') {
                    return Some(candidate.to_string());
                }
            }
        }
    }

    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    (start < end).then(|| trimmed[start..=end].to_string())
}

pub fn resolve_workflow_goal(
    explicit_goal: Option<&str>,
    messages: &[ChatMessage],
) -> Option<String> {
    if let Some(goal) = explicit_goal.map(str::trim).filter(|goal| !goal.is_empty()) {
        return Some(goal.to_string());
    }

    messages
        .iter()
        .rev()
        .find(|message| message.sender_type == ChatSenderType::User)
        .map(|message| message.content.trim())
        .filter(|goal| !goal.is_empty())
        .map(ToOwned::to_owned)
}

pub fn build_plan_generation_prompt(
    user_goal: &str,
    lead_agent_id: &str,
    available_agents: &[WorkflowCardAgent],
) -> String {
    let available_agents_json =
        serde_json::to_string_pretty(available_agents).unwrap_or_else(|_| "[]".to_string());
    let plan_schema_definition = r#"{
  "version": "1",
  "title": "string",
  "goal": "string",
  "agents": {
    "lead": "string",
    "available": ["string"]
  },
  "globals": {
    "interrupt_mode": "cooperative",
    "default_retry": 1,
    "global_pause_supported": true
  },
  "viewport": {
    "x": 0,
    "y": 0,
    "zoom": 1
  },
  "nodes": [
    {
      "id": "unique_step_key",
      "type": "workflowStep",
      "position": {
        "x": 0,
        "y": 0
      },
      "data": {
        "stepType": "task | review | result",
        "agentId": "optional string",
        "title": "string",
        "instructions": "string",
        "acceptance": ["optional string"],
        "outputs": ["optional string"],
        "interruptible": true,
        "maxRetry": 1,
        "status": "optional string"
      }
    }
  ],
  "edges": [
    {
      "id": "unique_edge_id",
      "source": "node_id",
      "target": "node_id",
      "type": "optional string",
      "data": {
        "kind": "hard | soft"
      }
    }
  ],
  "policies": {
    "approval_required_on": ["optional string"],
    "permission_required_on": ["optional string"],
    "on_failure": "optional string",
    "allow_plan_revision": true
  }
}"#;

    let prompt = format!(
        r#"你是当前 workflow mode 的 lead agent。你的任务是把方案计划`docs\openteams-integration-plan.md`解成一个可执行的 workflow plan。

你必须输出符合系统 schema 的 workflow JSON，用于后续编译和执行。计划真相源是 React Flow 兼容 JSON，而不是自然语言、YAML 或 Markdown。

硬性要求：
1. 只输出 workflow plan JSON，不要输出解释性文字。
2. 顶层结构必须符合系统定义的 schema，至少包含 `version`、`title`、`goal`、`agents`、`nodes`、`edges`。
3. `nodes[].type` 必须为 `workflowStep`。
4. `nodes[].data.stepType` 只能使用 `task`、`review`、`result`。
5. 必须且只能有一个 `result` 节点，且该节点不能有出边。
6. 所有 node id / edge id / step_key 都必须唯一。
7. 图必须是无环 DAG；依赖关系只通过 `edges` 表达。
8. 只能引用当前 session 中可用的 agent；如果某一步不需要明确指派 agent，可以留空，但不能虚构 agent 标识。
9. `agents.available` 和 `nodes[].data.agentId` 只能复用下方提供的 `agent_id`。
10. 节点 `title` 和 `instructions` 必须具体、可执行，避免空泛描述。
11. 计划应优先追求最小可执行闭环，避免不必要的步骤膨胀。

你的输出会被系统直接校验、编译并启动执行；任何 schema 错误、循环依赖、非法 agent 引用、非法 agents.available 或缺失 result 节点都会导致本次“立即执行”失败。

当前用户目标：
{user_goal}

当前可用团队成员：
{available_agents_json}

lead agent 标识：
{lead_agent_id}

请直接返回 workflow JSON。"#
    );

    let mut prompt = prompt;
    prompt.push_str("\n\nWorkflowPlanJson schema reference:\n");
    prompt.push_str(plan_schema_definition);
    prompt.push_str("\n\nAdditional constraints:\n");
    prompt.push_str("- version must be string \"1\"\n");
    prompt.push_str("- agents.lead must equal ");
    prompt.push_str(lead_agent_id);
    prompt.push_str("\n");
    prompt.push_str(
        "- agents.available and nodes[].data.agentId may only use the provided agent_id values\n",
    );
    prompt.push_str(
        "- globals, viewport, policies, and node/edge optional fields may be omitted when unnecessary",
    );
    prompt
}

#[allow(unreachable_code)]
pub fn build_step_execution_prompt(
    execution: &WorkflowExecution,
    workflow_goal: &str,
    step: &WorkflowStep,
    completed_dependency_summaries: &[String],
    step_transcript_context: Option<&str>,
) -> String {
    let dependency_text = if completed_dependency_summaries.is_empty() {
        "无".to_string()
    } else {
        completed_dependency_summaries.join("\n\n")
    };
    let dependency_text = if completed_dependency_summaries.is_empty() {
        "无".to_string()
    } else {
        dependency_text
    };
    let step_transcript_text = step_transcript_context
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("无");

    return format!(
        r#"你正在执行 OpenTeams workflow mode 中的一个 step。
你必须只返回一个 JSON 对象，不要输出 Markdown、解释或额外文本。
成功时返回：
{{
  "type": "final_result",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "summary": "一句话总结本 step 的完成结果",
  "content": "完整结果内容",
  "outputs": ["如有产出文件，请返回工作区内相对路径"]
}}

失败时返回：
{{
  "type": "error",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "message": "失败原因",
  "content": "可选的详细错误上下文"
}}

需要用户决策时返回以下结构之一：
{{
  "type": "approval_request",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "title": "需要用户审批的事项",
  "description": "可选的审批说明"
}}

{{
  "type": "permission_request",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "title": "需要用户授权的操作",
  "description": "可选的权限说明"
}}

{{
  "type": "continue_confirmation",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "message": "请确认是否继续",
  "description": "可选的补充说明"
}}

{{
  "type": "input_request",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "prompt": "请用户补充需要的输入内容",
  "description": "可选的补充说明",
  "placeholder": "输入你需要用户填写的内容"
}}

约束：
1. `step_key` 必须保持为 `{step_key}`。
2. `execution_id` 必须保持为 `{execution_id}`。
3. 只允许返回 `final_result`、`error`、`approval_request`、`permission_request`、`continue_confirmation` 或 `input_request`。
4. `outputs` 仅填写工作区内相对路径。
5. 只有在确实需要用户审批、授权或继续确认时才返回 request 类消息。

workflow 目标：{workflow_goal}
step 类型：{step_type}
step 标题：{step_title}
step 指令：{step_instructions}

已完成前置步骤摘要：
{dependency_text}

当前 step 已有交互记录：
{step_transcript_text}
"#,
        step_key = step.step_key,
        execution_id = execution.id,
        step_type = format!("{:?}", step.step_type).to_lowercase(),
        step_title = step.title,
        step_instructions = step.instructions,
    );

    format!(
        r#"你正在执行 OpenTeams workflow mode 中的一个 step。

你必须只返回一个 JSON 对象，不要输出 Markdown、解释或额外文本。

成功时返回：
{{
  "type": "final_result",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "summary": "一句话总结本 step 的完成结果",
  "content": "完整结果内容",
  "outputs": ["如有产出文件，请返回相对路径"]
}}

失败时返回：
{{
  "type": "error",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "message": "失败原因",
  "content": "可选的详细错误上下文"
}}

约束：
1. `step_key` 必须保持为 `{step_key}`。
2. `execution_id` 必须保持为 `{execution_id}`。
3. 只允许返回 `final_result` 或 `error`。
4. `outputs` 仅填写工作区内相对路径。

workflow 目标：{workflow_goal}
step 类型：{step_type}
step 标题：{step_title}
step 指令：
{step_instructions}

已完成前置步骤摘要：
{dependency_text}
"#,
        step_key = step.step_key,
        execution_id = execution.id,
        step_type = format!("{:?}", step.step_type).to_lowercase(),
        step_title = step.title,
        step_instructions = step.instructions,
    )
}

pub fn parse_step_protocol_output(
    execution_id: Uuid,
    step_key: &str,
    raw_output: &str,
) -> Result<WorkflowStepProtocolMessage, WorkflowRuntimeError> {
    let payload = extract_json_payload(raw_output).ok_or_else(|| {
        WorkflowRuntimeError::Validation("step 输出中未找到 JSON 对象".to_string())
    })?;

    let message: WorkflowStepProtocolMessage = serde_json::from_str(&payload)?;
    match &message {
        WorkflowStepProtocolMessage::FinalResult {
            step_key: actual_step_key,
            execution_id: actual_execution_id,
            ..
        }
        | WorkflowStepProtocolMessage::Error {
            step_key: actual_step_key,
            execution_id: actual_execution_id,
            ..
        }
        | WorkflowStepProtocolMessage::ApprovalRequest {
            step_key: actual_step_key,
            execution_id: actual_execution_id,
            ..
        }
        | WorkflowStepProtocolMessage::PermissionRequest {
            step_key: actual_step_key,
            execution_id: actual_execution_id,
            ..
        }
        | WorkflowStepProtocolMessage::ContinueConfirmation {
            step_key: actual_step_key,
            execution_id: actual_execution_id,
            ..
        }
        | WorkflowStepProtocolMessage::InputRequest {
            step_key: actual_step_key,
            execution_id: actual_execution_id,
            ..
        } => {
            if actual_step_key != step_key {
                return Err(WorkflowRuntimeError::Validation(format!(
                    "step protocol 的 step_key 非法，期望 '{}'，实际 '{}'",
                    step_key, actual_step_key
                )));
            }
            if actual_execution_id != &execution_id.to_string() {
                return Err(WorkflowRuntimeError::Validation(format!(
                    "step protocol 的 execution_id 非法，期望 '{}'，实际 '{}'",
                    execution_id, actual_execution_id
                )));
            }
        }
    }

    Ok(message)
}

pub fn build_workflow_card_projection(
    execution: &WorkflowExecution,
    plan: &WorkflowPlan,
    revision: &WorkflowPlanRevision,
    steps: &[WorkflowStep],
    _edges: &[WorkflowStepEdge],
    workflow_agent_sessions: &[WorkflowAgentSession],
    session_agents: &[ChatSessionAgent],
    agents: &[ChatAgent],
    error_message: Option<String>,
) -> Result<WorkflowCardProjection, WorkflowRuntimeError> {
    let mut plan_json: WorkflowPlanJson = serde_json::from_str(&revision.plan_json)?;
    plan_json.nodes = overlay_step_statuses(&plan_json, steps);

    let session_agent_name_by_id: HashMap<Uuid, String> = session_agents
        .iter()
        .filter_map(|session_agent| {
            let agent_name = agents
                .iter()
                .find(|agent| agent.id == session_agent.agent_id)
                .map(|agent| agent.name.clone())?;
            Some((session_agent.id, agent_name))
        })
        .collect();

    let workflow_agent_name_by_id: HashMap<Uuid, String> = workflow_agent_sessions
        .iter()
        .filter_map(|workflow_session| {
            let name = session_agent_name_by_id
                .get(&workflow_session.session_agent_id)?
                .clone();
            Some((workflow_session.id, name))
        })
        .collect();

    let completed_step_count = steps
        .iter()
        .filter(|step| step.status == WorkflowStepStatus::Completed)
        .count();
    let total_step_count = steps.len();

    let step_views = steps
        .iter()
        .map(|step| WorkflowCardStep {
            id: step.id.to_string(),
            step_key: step.step_key.clone(),
            title: step.title.clone(),
            step_type: format!("{:?}", step.step_type).to_lowercase(),
            status: format!("{:?}", step.status).to_lowercase(),
            agent_name: step
                .assigned_workflow_agent_session_id
                .and_then(|id| workflow_agent_name_by_id.get(&id))
                .cloned(),
            summary_text: step
                .summary_text
                .clone()
                .and_then(parse_summary_text_preview),
        })
        .collect::<Vec<_>>();

    let agent_views = session_agents
        .iter()
        .filter_map(|session_agent| {
            let agent = agents
                .iter()
                .find(|agent| agent.id == session_agent.agent_id)?;
            Some(WorkflowCardAgent {
                session_agent_id: session_agent.id.to_string(),
                workflow_agent_session_id: workflow_agent_sessions
                    .iter()
                    .find(|workflow_session| workflow_session.session_agent_id == session_agent.id)
                    .map(|workflow_session| workflow_session.id.to_string()),
                agent_id: agent.id.to_string(),
                name: agent.name.clone(),
            })
        })
        .collect::<Vec<_>>();

    let result_step = steps
        .iter()
        .find(|step| step.step_type == WorkflowStepType::Result);
    let (result_summary, outputs) = result_step
        .and_then(|step| parse_summary_payload(step.summary_text.as_deref()))
        .map(|payload| (Some(payload.summary), payload.outputs))
        .unwrap_or_else(|| (None, Vec::new()));

    let state = match execution.status {
        WorkflowExecutionStatus::Pending => WorkflowCardState::Pending,
        WorkflowExecutionStatus::Completed => WorkflowCardState::Completed,
        WorkflowExecutionStatus::Failed => WorkflowCardState::Failed,
        WorkflowExecutionStatus::Paused => WorkflowCardState::Paused,
        WorkflowExecutionStatus::Waiting => WorkflowCardState::Waiting,
        WorkflowExecutionStatus::Recompiling => WorkflowCardState::Paused,
        _ => WorkflowCardState::Running,
    };

    Ok(WorkflowCardProjection {
        execution_id: Some(execution.id.to_string()),
        plan_id: plan.id.to_string(),
        revision_id: revision.id.to_string(),
        title: plan.title.clone(),
        goal: plan
            .summary_text
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| plan.title.clone()),
        state,
        execution_status: format!("{:?}", execution.status).to_lowercase(),
        error_message,
        completed_step_count,
        total_step_count,
        result_summary,
        outputs,
        agents: agent_views,
        steps: step_views,
        plan: plan_json,
        started_at: execution.started_at.map(|value| value.to_rfc3339()),
        completed_at: execution.completed_at.map(|value| value.to_rfc3339()),
        validation_errors: None,
    })
}

pub async fn run_workflow_agent_prompt(
    _db: &DBService,
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    prompt: &str,
    step_id: Uuid,
) -> Result<String, WorkflowRuntimeError> {
    let workspace_path = resolve_workspace_path(session, agent, session_agent);
    fs::create_dir_all(&workspace_path).await?;

    let executor_profile_id = parse_executor_profile_id(agent)?;
    let mut executor =
        ExecutorConfigs::get_cached().get_coding_agent_or_default(&executor_profile_id);
    executor.use_approvals(Arc::new(NoopExecutorApprovalService));

    if let Some(model_name) = &agent.model_name
        && let Some(executor_with_model) = with_model(&executor, model_name)
    {
        executor = executor_with_model;
    }

    let repo_context = RepoContext::new(workspace_path.clone(), Vec::new());
    let mut env = ExecutionEnv::new(repo_context, false, String::new());
    env.insert("VK_WORKFLOW_SESSION_ID", session.id.to_string());
    env.insert("VK_WORKFLOW_AGENT_ID", agent.id.to_string());
    env.insert("VK_WORKFLOW_SESSION_AGENT_ID", session_agent.id.to_string());

    let mut spawned = executor
        .spawn(workspace_path.as_path(), prompt, &env)
        .await?;

    // Register the cancel token so interrupt_step can terminate this process.
    if let Some(cancel) = spawned.cancel.clone() {
        RUNNING_STEPS.insert(step_id, cancel);
    }

    let msg_store = Arc::new(MsgStore::new());
    spawn_log_forwarders(&mut spawned.child, msg_store.clone())?;
    executor.normalize_logs(msg_store.clone(), workspace_path.as_path());

    let mut failed_by_signal = false;
    let mut interrupted = false;
    let mut status = None;

    if let Some(exit_signal) = spawned.exit_signal.take() {
        match time::timeout(WORKFLOW_EXECUTION_TIMEOUT, exit_signal).await {
            Ok(Ok(ExecutorExitResult::Success)) => {}
            Ok(Ok(ExecutorExitResult::Failure)) => {
                // Check if this failure was caused by an interrupt cancellation.
                if !RUNNING_STEPS.contains_key(&step_id) {
                    interrupted = true;
                } else {
                    failed_by_signal = true;
                }
            }
            Ok(Err(_)) => {
                status = Some(wait_for_process_exit(&mut spawned, &agent.name).await?);
            }
            Err(_) => {
                terminate_child(&mut spawned).await;
                RUNNING_STEPS.remove(&step_id);
                return Err(WorkflowRuntimeError::Validation(format!(
                    "workflow 执行超时：{}",
                    agent.name
                )));
            }
        }

        if status.is_none() && !interrupted {
            match time::timeout(WORKFLOW_REAP_TIMEOUT, spawned.child.wait()).await {
                Ok(Ok(exit_status)) => status = Some(exit_status),
                Ok(Err(err)) => {
                    RUNNING_STEPS.remove(&step_id);
                    return Err(WorkflowRuntimeError::Io(err));
                }
                Err(_) => terminate_child(&mut spawned).await,
            }
        }
    } else {
        status = Some(wait_for_process_exit(&mut spawned, &agent.name).await?);
    }

    // Unregister from the running steps map.
    RUNNING_STEPS.remove(&step_id);

    msg_store.push_finished();
    time::sleep(WORKFLOW_DRAIN_TIMEOUT).await;

    if interrupted {
        // Ensure the child is cleaned up.
        terminate_child(&mut spawned).await;
        return Err(WorkflowRuntimeError::Interrupted(format!(
            "workflow step 被中断：{}",
            agent.name
        )));
    }

    if failed_by_signal {
        return Err(WorkflowRuntimeError::Validation(format!(
            "workflow 执行失败：{}",
            agent.name
        )));
    }

    if let Some(exit_status) = status
        && !exit_status.success()
    {
        // Check if the non-zero exit was caused by interrupt.
        if spawned.cancel.as_ref().is_some_and(|c| c.is_cancelled()) {
            return Err(WorkflowRuntimeError::Interrupted(format!(
                "workflow step 被中断：{}",
                agent.name
            )));
        }
        return Err(WorkflowRuntimeError::Validation(format!(
            "workflow 执行失败：{}",
            agent.name
        )));
    }

    extract_latest_assistant_from_history(&msg_store.get_history()).ok_or_else(|| {
        WorkflowRuntimeError::Validation(format!(
            "workflow agent '{}' 没有返回 assistant 输出",
            agent.name
        ))
    })
}

pub fn overlay_step_statuses(
    plan: &WorkflowPlanJson,
    steps: &[WorkflowStep],
) -> Vec<WorkflowPlanNode> {
    let step_by_key: HashMap<&str, &WorkflowStep> = steps
        .iter()
        .map(|step| (step.step_key.as_str(), step))
        .collect();

    plan.nodes
        .iter()
        .cloned()
        .map(|mut node| {
            if let Some(step) = step_by_key.get(node.id.as_str()) {
                node.data.status = Some(format!("{:?}", step.status).to_lowercase());
            }
            node
        })
        .collect()
}

pub fn predecessor_summaries(
    step: &WorkflowStep,
    steps: &[WorkflowStep],
    edges: &[WorkflowStepEdge],
) -> Vec<String> {
    let step_by_id: HashMap<Uuid, &WorkflowStep> = steps
        .iter()
        .map(|candidate| (candidate.id, candidate))
        .collect();

    edges
        .iter()
        .filter(|edge| edge.to_step_id == step.id)
        .filter_map(|edge| step_by_id.get(&edge.from_step_id).copied())
        .filter_map(|source_step| parse_summary_payload(source_step.summary_text.as_deref()))
        .map(|payload| payload.content.unwrap_or(payload.summary))
        .collect()
}

pub fn parse_summary_payload(summary_text: Option<&str>) -> Option<SummaryPayload> {
    let summary_text = summary_text?.trim();
    if summary_text.is_empty() {
        return None;
    }

    serde_json::from_str::<SummaryPayload>(summary_text)
        .ok()
        .or_else(|| {
            Some(SummaryPayload {
                summary: summary_text.to_string(),
                content: None,
                outputs: Vec::new(),
            })
        })
}

fn parse_summary_text_preview(summary_text: String) -> Option<String> {
    if let Ok(payload) = serde_json::from_str::<SummaryPayload>(&summary_text) {
        return Some(payload.summary);
    }

    let trimmed = summary_text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn resolve_workspace_path(
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
) -> PathBuf {
    if let Some(path) = session_agent.workspace_path.as_deref() {
        PathBuf::from(path)
    } else if let Some(path) = session.default_workspace_path.as_deref() {
        PathBuf::from(path)
    } else {
        PathBuf::from("assets")
            .join("chat")
            .join(format!("session_{}", session.id))
            .join("agents")
            .join(agent.id.to_string())
    }
}

fn parse_runner_type(agent: &ChatAgent) -> Result<BaseCodingAgent, WorkflowRuntimeError> {
    let raw = agent.runner_type.trim();
    let normalized = raw.replace(['-', ' '], "_").to_ascii_uppercase();
    BaseCodingAgent::from_str(&normalized)
        .map_err(|_| WorkflowRuntimeError::Validation(format!("unknown runner type: {raw}")))
}

fn parse_executor_profile_id(agent: &ChatAgent) -> Result<ExecutorProfileId, WorkflowRuntimeError> {
    let executor = parse_runner_type(agent)?;
    let variant = agent
        .tools_enabled
        .0
        .as_object()
        .and_then(|value| value.get(EXECUTOR_PROFILE_VARIANT_KEY))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("DEFAULT"))
        .map(canonical_variant_key);

    Ok(match variant {
        Some(variant) => ExecutorProfileId::with_variant(executor, variant),
        None => ExecutorProfileId::new(executor),
    })
}

fn spawn_log_forwarders(
    child: &mut command_group::AsyncGroupChild,
    msg_store: Arc<MsgStore>,
) -> Result<(), WorkflowRuntimeError> {
    let stdout = child.inner().stdout.take().ok_or_else(|| {
        WorkflowRuntimeError::Validation("workflow child 缺少 stdout".to_string())
    })?;
    let stderr = child.inner().stderr.take().ok_or_else(|| {
        WorkflowRuntimeError::Validation("workflow child 缺少 stderr".to_string())
    })?;

    let stdout_store = msg_store.clone();
    tokio::spawn(async move {
        let mut stream = ReaderStream::new(stdout);
        let mut decoder = Utf8LossyDecoder::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    let text = decoder.decode_chunk(&bytes);
                    if !text.is_empty() {
                        stdout_store.push(LogMsg::Stdout(text));
                    }
                }
                Err(err) => stdout_store.push(LogMsg::Stderr(format!("stdout error: {err}"))),
            }
        }

        let tail = decoder.finish();
        if !tail.is_empty() {
            stdout_store.push(LogMsg::Stdout(tail));
        }
    });

    let stderr_store = msg_store;
    tokio::spawn(async move {
        let mut stream = ReaderStream::new(stderr);
        let mut decoder = Utf8LossyDecoder::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    let text = decoder.decode_chunk(&bytes);
                    if !text.is_empty() {
                        stderr_store.push(LogMsg::Stderr(text));
                    }
                }
                Err(err) => stderr_store.push(LogMsg::Stderr(format!("stderr error: {err}"))),
            }
        }

        let tail = decoder.finish();
        if !tail.is_empty() {
            stderr_store.push(LogMsg::Stderr(tail));
        }
    });

    Ok(())
}

async fn wait_for_process_exit(
    spawned: &mut SpawnedChild,
    agent_name: &str,
) -> Result<std::process::ExitStatus, WorkflowRuntimeError> {
    match time::timeout(WORKFLOW_EXECUTION_TIMEOUT, spawned.child.wait()).await {
        Ok(Ok(status)) => Ok(status),
        Ok(Err(err)) => Err(WorkflowRuntimeError::Io(err)),
        Err(_) => {
            terminate_child(spawned).await;
            Err(WorkflowRuntimeError::Validation(format!(
                "workflow agent '{}' 执行超时",
                agent_name
            )))
        }
    }
}

async fn terminate_child(spawned: &mut SpawnedChild) {
    if let Some(cancel) = spawned.cancel.take() {
        cancel.cancel();
    }
    let _ = spawned.child.kill().await;
    let _ = time::timeout(WORKFLOW_KILL_WAIT_TIMEOUT, spawned.child.wait()).await;
}

fn extract_latest_assistant_from_history(history: &[LogMsg]) -> Option<String> {
    let mut assistant_entries: HashMap<usize, String> = HashMap::new();

    for message in history {
        let LogMsg::JsonPatch(patch) = message else {
            continue;
        };

        let Some((index, entry)) = extract_normalized_entry_from_patch(patch) else {
            continue;
        };

        if matches!(entry.entry_type, NormalizedEntryType::AssistantMessage) {
            assistant_entries.insert(index, entry.content);
        }
    }

    assistant_entries
        .into_iter()
        .max_by_key(|(index, _)| *index)
        .map(|(_, content)| content.trim().to_string())
        .filter(|content| !content.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_step_protocol_output_accepts_approval_request() {
        let execution_id = Uuid::new_v4();
        let step_key = "review";
        let raw_output = format!(
            r#"{{
  "type": "approval_request",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "title": "Need approval",
  "description": "Please confirm the patch."
}}"#
        );

        let message =
            parse_step_protocol_output(execution_id, step_key, &raw_output).expect("parse");

        match message {
            WorkflowStepProtocolMessage::ApprovalRequest {
                title, description, ..
            } => {
                assert_eq!(title, "Need approval");
                assert_eq!(description.as_deref(), Some("Please confirm the patch."));
            }
            other => panic!("unexpected message: {other:?}"),
        }
    }

    #[test]
    fn parse_step_protocol_output_accepts_continue_confirmation() {
        let execution_id = Uuid::new_v4();
        let step_key = "review";
        let raw_output = format!(
            r#"{{
  "type": "continue_confirmation",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "message": "Continue with deployment?"
}}"#
        );

        let message =
            parse_step_protocol_output(execution_id, step_key, &raw_output).expect("parse");

        match message {
            WorkflowStepProtocolMessage::ContinueConfirmation { message, .. } => {
                assert_eq!(message, "Continue with deployment?");
            }
            other => panic!("unexpected message: {other:?}"),
        }
    }

    #[test]
    fn parse_step_protocol_output_accepts_input_request() {
        let execution_id = Uuid::new_v4();
        let step_key = "clarify";
        let raw_output = format!(
            r#"{{
  "type": "input_request",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "prompt": "Please provide the release tag",
  "placeholder": "v1.2.3"
}}"#
        );

        let message =
            parse_step_protocol_output(execution_id, step_key, &raw_output).expect("parse");

        match message {
            WorkflowStepProtocolMessage::InputRequest {
                prompt,
                placeholder,
                ..
            } => {
                assert_eq!(prompt, "Please provide the release tag");
                assert_eq!(placeholder.as_deref(), Some("v1.2.3"));
            }
            other => panic!("unexpected message: {other:?}"),
        }
    }

    #[test]
    fn parse_step_protocol_output_rejects_wrong_execution_id() {
        let execution_id = Uuid::new_v4();
        let raw_output = format!(
            r#"{{
  "type": "permission_request",
  "step_key": "review",
  "execution_id": "{}",
  "title": "Need permission"
}}"#,
            Uuid::new_v4()
        );

        let err =
            parse_step_protocol_output(execution_id, "review", &raw_output).expect_err("invalid");

        assert!(matches!(err, WorkflowRuntimeError::Validation(_)));
    }
}
