use std::{collections::HashMap, path::PathBuf};

use axum::{
    Extension,
    extract::{Query, State},
    response::Json as ResponseJson,
};
use chrono::{DateTime, Utc};
use db::models::{
    chat_agent::ChatAgent,
    chat_message::ChatMessage,
    chat_run::ChatRun,
    chat_session::ChatSession,
    chat_session_agent::{ChatSessionAgent, ChatSessionAgentState},
    project_member::ProjectMember,
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::{
    chat::should_include_message_in_history,
    chat_runner::ChatRunActivityLine,
    member_execution::resolve_effective_member_execution_config,
    queued_message::{MemberQueueSnapshot, QueuedMessageService},
};
use tokio::fs;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

const RUN_ACTIVITY_FILE_NAME: &str = "activity.jsonl";
const DEFAULT_ACTIVE_RUN_ACTIVITY_LIMIT: usize = 1_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ChatActiveRunStatus {
    Starting,
    Running,
    Stopping,
    WaitingApproval,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ChatActiveRun {
    pub run_id: Uuid,
    pub session_id: Uuid,
    pub session_agent_id: Uuid,
    pub agent_id: Uuid,
    pub agent_name: String,
    pub display_name: String,
    pub avatar: String,
    pub model: Option<String>,
    pub status: ChatActiveRunStatus,
    pub source_message_id: Option<Uuid>,
    pub client_message_id: Option<String>,
    pub activity_lines: Vec<ChatRunActivityLine>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ChatSessionRuntimeSnapshot {
    pub session_id: Uuid,
    pub messages: Option<Vec<ChatMessage>>,
    pub active_runs: Vec<ChatActiveRun>,
    pub queues: Vec<MemberQueueSnapshot>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct ChatSessionRuntimeQuery {
    pub include_messages: Option<bool>,
}

pub async fn get_session_runtime_snapshot(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ChatSessionRuntimeQuery>,
) -> Result<ResponseJson<ApiResponse<ChatSessionRuntimeSnapshot>>, ApiError> {
    let snapshot = build_session_runtime_snapshot(
        &deployment,
        &session,
        query.include_messages.unwrap_or(false),
        None,
    )
    .await?;
    Ok(ResponseJson(ApiResponse::success(snapshot)))
}

pub async fn build_session_runtime_snapshot(
    deployment: &DeploymentImpl,
    session: &ChatSession,
    include_messages: bool,
    source_message: Option<&ChatMessage>,
) -> Result<ChatSessionRuntimeSnapshot, ApiError> {
    let pool = &deployment.db().pool;
    let session_agents = ChatSessionAgent::find_all_for_session(pool, session.id).await?;
    let agents = ChatAgent::find_visible_for_project(pool, session.project_id).await?;
    let project_members = match session.project_id {
        Some(project_id) => ProjectMember::find_by_project(pool, project_id).await?,
        None => Vec::new(),
    };
    let agent_by_id: HashMap<Uuid, ChatAgent> =
        agents.into_iter().map(|agent| (agent.id, agent)).collect();
    let project_member_by_id: HashMap<Uuid, ProjectMember> = project_members
        .iter()
        .cloned()
        .map(|member| (member.id, member))
        .collect();
    let project_member_name_by_agent_id: HashMap<Uuid, String> = project_members
        .into_iter()
        .filter_map(|member| {
            let agent_id = member.agent_id?;
            let name = member.member_name?.trim().to_string();
            if name.is_empty() {
                None
            } else {
                Some((agent_id, name))
            }
        })
        .collect();

    let queue_service = QueuedMessageService::new();
    let mut queues = Vec::with_capacity(session_agents.len());
    for session_agent in &session_agents {
        queues.push(
            queue_service
                .snapshot_for_member(pool, session.id, session_agent.id, session_agent.agent_id)
                .await?,
        );
    }

    let mut active_runs = Vec::new();
    for session_agent in session_agents
        .iter()
        .filter(|session_agent| active_run_status(&session_agent.state).is_some())
    {
        let status =
            active_run_status(&session_agent.state).unwrap_or(ChatActiveRunStatus::Running);
        let agent = agent_by_id.get(&session_agent.agent_id);
        let display_name = display_name_for_session_agent(
            session_agent,
            agent,
            &project_member_by_id,
            &project_member_name_by_agent_id,
        );
        let agent_name = agent
            .map(|agent| agent.name.clone())
            .unwrap_or_else(|| display_name.trim_start_matches('@').to_string());
        let latest_run = ChatRun::find_latest_for_session_agent(pool, session_agent.id).await?;
        let (run_id, activity_lines, created_at, status) =
            match latest_run.filter(|run| run.session_id == session.id) {
                Some(run) => (
                    run.id,
                    read_activity_lines(&run, DEFAULT_ACTIVE_RUN_ACTIVITY_LIMIT).await,
                    run.created_at,
                    status,
                ),
                None => (
                    session_agent.id,
                    Vec::new(),
                    session_agent.updated_at,
                    ChatActiveRunStatus::Starting,
                ),
            };
        let (source_message_id, client_message_id) =
            source_message_identity(source_message, session.id, created_at);

        active_runs.push(ChatActiveRun {
            run_id,
            session_id: session.id,
            session_agent_id: session_agent.id,
            agent_id: session_agent.agent_id,
            agent_name,
            display_name: ensure_agent_handle(&display_name),
            avatar: monogram_from_name(&display_name),
            model: active_run_model(agent, session_agent),
            status,
            source_message_id,
            client_message_id,
            activity_lines,
            created_at,
        });
    }

    active_runs.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.run_id.cmp(&b.run_id))
    });

    let messages = if include_messages {
        Some(
            ChatMessage::find_by_session_id_lightweight(pool, session.id, None)
                .await?
                .into_iter()
                .filter(should_include_message_in_history)
                .collect(),
        )
    } else {
        None
    };

    Ok(ChatSessionRuntimeSnapshot {
        session_id: session.id,
        messages,
        active_runs,
        queues,
    })
}

fn active_run_status(state: &ChatSessionAgentState) -> Option<ChatActiveRunStatus> {
    match state {
        ChatSessionAgentState::Running => Some(ChatActiveRunStatus::Running),
        ChatSessionAgentState::Stopping => Some(ChatActiveRunStatus::Stopping),
        ChatSessionAgentState::WaitingApproval => Some(ChatActiveRunStatus::WaitingApproval),
        ChatSessionAgentState::Idle | ChatSessionAgentState::Dead => None,
    }
}

fn active_run_model(agent: Option<&ChatAgent>, session_agent: &ChatSessionAgent) -> Option<String> {
    let agent = agent?;
    match resolve_effective_member_execution_config(agent, session_agent) {
        Ok(config) => config.model_name,
        Err(err) => {
            tracing::warn!(
                agent_id = %agent.id,
                session_agent_id = %session_agent.id,
                error = %err,
                "Failed to resolve active run model from member execution config"
            );
            agent.model_name.clone()
        }
    }
}

fn display_name_for_session_agent(
    session_agent: &ChatSessionAgent,
    agent: Option<&ChatAgent>,
    project_member_by_id: &HashMap<Uuid, ProjectMember>,
    project_member_name_by_agent_id: &HashMap<Uuid, String>,
) -> String {
    session_agent
        .project_member_id
        .and_then(|project_member_id| project_member_by_id.get(&project_member_id))
        .and_then(|member| member.member_name.as_deref())
        .filter(|name| !name.trim().is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            project_member_name_by_agent_id
                .get(&session_agent.agent_id)
                .cloned()
        })
        .or_else(|| agent.map(|agent| agent.name.clone()))
        .unwrap_or_else(|| session_agent.agent_id.to_string())
}

fn ensure_agent_handle(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.starts_with('@') {
        trimmed.to_string()
    } else {
        format!("@{trimmed}")
    }
}

fn monogram_from_name(name: &str) -> String {
    let monogram: String = name
        .trim_start_matches('@')
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(2)
        .collect::<String>()
        .to_ascii_uppercase();
    if monogram.is_empty() {
        "AG".to_string()
    } else {
        monogram
    }
}

fn source_message_identity(
    source_message: Option<&ChatMessage>,
    session_id: Uuid,
    run_created_at: DateTime<Utc>,
) -> (Option<Uuid>, Option<String>) {
    let Some(message) = source_message.filter(|message| message.session_id == session_id) else {
        return (None, None);
    };
    if run_created_at < message.created_at {
        return (None, None);
    }
    let client_message_id = message
        .meta
        .get("client_message_id")
        .and_then(|value| value.as_str())
        .map(ToString::to_string);
    (Some(message.id), client_message_id)
}

async fn read_activity_lines(run: &ChatRun, limit: usize) -> Vec<ChatRunActivityLine> {
    let activity_path = PathBuf::from(&run.run_dir).join(RUN_ACTIVITY_FILE_NAME);
    let Ok(contents) = fs::read_to_string(activity_path).await else {
        return Vec::new();
    };

    let mut lines: Vec<ChatRunActivityLine> = contents
        .lines()
        .filter_map(|line| serde_json::from_str::<ChatRunActivityLine>(line).ok())
        .collect();
    lines.sort_by(|a, b| {
        a.sequence
            .cmp(&b.sequence)
            .then_with(|| a.line_id.cmp(&b.line_id))
    });
    if lines.len() > limit {
        lines.split_off(lines.len() - limit)
    } else {
        lines
    }
}
