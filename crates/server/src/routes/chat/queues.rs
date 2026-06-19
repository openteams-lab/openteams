use axum::{
    Extension,
    extract::{Path, State},
    response::Json as ResponseJson,
};
use db::models::{
    chat_message::ChatMessage, chat_message_queue::QueuedMessageStatus, chat_session::ChatSession,
    chat_session_agent::ChatSessionAgent,
};
use deployment::Deployment;
use serde::Serialize;
use services::services::queued_message::{
    MemberQueueSnapshot, MemberQueueStatus, QueuedMessageService,
};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ChatQueueListResponse {
    pub session_id: Uuid,
    pub members: Vec<MemberQueueSnapshot>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ChatMemberQueueResponse {
    pub queue: MemberQueueSnapshot,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct DeleteQueuedMessageResponse {
    pub deleted_id: Uuid,
    pub queue: MemberQueueSnapshot,
    /// Set when the underlying `chat_messages` row was also removed because no other queue entry
    /// (any member, any status) referenced it. The frontend uses this to drop the message from the
    /// visible conversation without a round-trip.
    pub deleted_chat_message_id: Option<Uuid>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ContinueQueuedMessageResponse {
    pub skipped_failed_count: u64,
    pub queue: MemberQueueSnapshot,
}

fn ensure_delete_allowed(status: QueuedMessageStatus) -> Result<(), ApiError> {
    if status == QueuedMessageStatus::Queued {
        Ok(())
    } else {
        Err(ApiError::Conflict(
            "Only queued messages can be deleted.".to_string(),
        ))
    }
}

fn ensure_continue_allowed(snapshot: &MemberQueueSnapshot) -> Result<(), ApiError> {
    if matches!(
        snapshot.status,
        MemberQueueStatus::Blocked | MemberQueueStatus::Paused
    ) && snapshot.can_continue
    {
        Ok(())
    } else {
        Err(ApiError::Conflict(
            "Member queue is not blocked.".to_string(),
        ))
    }
}

async fn session_agent_for_session(
    pool: &sqlx::SqlitePool,
    session_id: Uuid,
    session_agent_id: Uuid,
) -> Result<ChatSessionAgent, ApiError> {
    let session_agent = ChatSessionAgent::find_by_id(pool, session_agent_id)
        .await?
        .ok_or(ApiError::Database(sqlx::Error::RowNotFound))?;
    if session_agent.session_id != session_id {
        return Err(ApiError::Database(sqlx::Error::RowNotFound));
    }
    Ok(session_agent)
}

async fn snapshot_for_agent(
    service: &QueuedMessageService,
    pool: &sqlx::SqlitePool,
    session_agent: &ChatSessionAgent,
) -> Result<MemberQueueSnapshot, ApiError> {
    Ok(service
        .snapshot_for_member(
            pool,
            session_agent.session_id,
            session_agent.id,
            session_agent.agent_id,
        )
        .await?)
}

pub async fn list_session_queue(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ChatQueueListResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let service = QueuedMessageService::new();
    let session_agents = ChatSessionAgent::find_all_for_session(pool, session.id).await?;
    let mut members = Vec::with_capacity(session_agents.len());

    for session_agent in session_agents {
        members.push(snapshot_for_agent(&service, pool, &session_agent).await?);
    }

    Ok(ResponseJson(ApiResponse::success(ChatQueueListResponse {
        session_id: session.id,
        members,
    })))
}

pub async fn list_member_queue(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Path((_session_id, session_agent_id)): Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<ChatMemberQueueResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let service = QueuedMessageService::new();
    let session_agent = session_agent_for_session(pool, session.id, session_agent_id).await?;
    let queue = snapshot_for_agent(&service, pool, &session_agent).await?;

    Ok(ResponseJson(ApiResponse::success(
        ChatMemberQueueResponse { queue },
    )))
}

pub async fn delete_queue_item(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Path((_session_id, queue_id)): Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<DeleteQueuedMessageResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let service = QueuedMessageService::new();
    let queue_item = service
        .find_by_id(pool, queue_id)
        .await?
        .ok_or(ApiError::Database(sqlx::Error::RowNotFound))?;

    if queue_item.session_id != session.id {
        return Err(ApiError::Database(sqlx::Error::RowNotFound));
    }

    ensure_delete_allowed(queue_item.status)?;

    let deleted = service.delete_queued(pool, queue_id).await?;
    if deleted == 0 {
        return Err(ApiError::Conflict(
            "Queue item is no longer queued.".to_string(),
        ));
    }

    // The source user message is shared across the conversation. Only remove it when no other
    // queue entry (any member, any status) still references it — otherwise the message either has
    // already executed for another member or is still pending elsewhere, and must stay visible.
    let other_references = service
        .other_reference_count_for_chat_message(pool, queue_item.chat_message_id, queue_id)
        .await
        .unwrap_or(0);
    let mut deleted_chat_message_id = None;
    if other_references == 0 {
        let rows = ChatMessage::delete(pool, queue_item.chat_message_id).await?;
        if rows > 0 {
            deleted_chat_message_id = Some(queue_item.chat_message_id);
        }
    }

    let session_agent =
        session_agent_for_session(pool, session.id, queue_item.session_agent_id).await?;
    let queue = snapshot_for_agent(&service, pool, &session_agent).await?;
    deployment
        .chat_runner()
        .emit_queue_update(session.id, queue.clone());

    Ok(ResponseJson(ApiResponse::success(
        DeleteQueuedMessageResponse {
            deleted_id: queue_id,
            queue,
            deleted_chat_message_id,
        },
    )))
}

pub async fn continue_member_queue(
    Extension(session): Extension<ChatSession>,
    State(deployment): State<DeploymentImpl>,
    Path((_session_id, session_agent_id)): Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<ContinueQueuedMessageResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let service = QueuedMessageService::new();
    let session_agent = session_agent_for_session(pool, session.id, session_agent_id).await?;
    let before = snapshot_for_agent(&service, pool, &session_agent).await?;
    ensure_continue_allowed(&before)?;

    let skipped_failed_count = service
        .skip_failed_for_member(pool, session_agent_id)
        .await?;
    let unblocked = snapshot_for_agent(&service, pool, &session_agent).await?;
    deployment
        .chat_runner()
        .emit_queue_update(session.id, unblocked);

    deployment
        .chat_runner()
        .dispatch_next_queued_message(session.id, session_agent_id)
        .await;

    let queue = snapshot_for_agent(&service, pool, &session_agent).await?;
    deployment
        .chat_runner()
        .emit_queue_update(session.id, queue.clone());

    Ok(ResponseJson(ApiResponse::success(
        ContinueQueuedMessageResponse {
            skipped_failed_count,
            queue,
        },
    )))
}

#[cfg(test)]
mod tests {
    use services::services::queued_message::QueuedMessageListItem;

    use super::*;

    fn snapshot(status: MemberQueueStatus, can_continue: bool) -> MemberQueueSnapshot {
        MemberQueueSnapshot {
            session_id: Uuid::new_v4(),
            session_agent_id: Uuid::new_v4(),
            agent_id: Uuid::new_v4(),
            status,
            blocked: can_continue,
            paused: status == MemberQueueStatus::Paused,
            can_continue,
            queued_count: 0,
            items: Vec::<QueuedMessageListItem>::new(),
        }
    }

    #[test]
    fn delete_guard_allows_only_queued_items() {
        assert!(ensure_delete_allowed(QueuedMessageStatus::Queued).is_ok());
        assert!(matches!(
            ensure_delete_allowed(QueuedMessageStatus::Processing),
            Err(ApiError::Conflict(_))
        ));
        assert!(matches!(
            ensure_delete_allowed(QueuedMessageStatus::Running),
            Err(ApiError::Conflict(_))
        ));
        assert!(matches!(
            ensure_delete_allowed(QueuedMessageStatus::Failed),
            Err(ApiError::Conflict(_))
        ));
    }

    #[test]
    fn continue_guard_requires_blocked_or_paused_queue() {
        assert!(ensure_continue_allowed(&snapshot(MemberQueueStatus::Blocked, true)).is_ok());
        assert!(ensure_continue_allowed(&snapshot(MemberQueueStatus::Paused, true)).is_ok());
        assert!(matches!(
            ensure_continue_allowed(&snapshot(MemberQueueStatus::Queued, false)),
            Err(ApiError::Conflict(_))
        ));
        assert!(matches!(
            ensure_continue_allowed(&snapshot(MemberQueueStatus::Running, false)),
            Err(ApiError::Conflict(_))
        ));
    }
}
