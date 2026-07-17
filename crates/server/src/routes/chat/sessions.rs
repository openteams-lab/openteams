use std::{
    collections::{BTreeMap, HashSet},
    path::{Component, Path, PathBuf},
    sync::LazyLock,
};

use axum::{
    Extension, Json,
    extract::{
        Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    response::{IntoResponse, Json as ResponseJson},
};
use chrono::{DateTime, Utc};
use db::models::{
    chat_agent::ChatAgent,
    chat_run::ChatRun,
    chat_session::{
        ChatSession, ChatSessionStatus, ChatSessionWorktreeMode, CreateChatSession,
        UpdateChatSession,
    },
    chat_session_agent::{ChatSessionAgent, CreateChatSessionAgent},
    chat_session_worktree::SessionWorktree,
    chat_work_item::{ChatWorkItem, ChatWorkItemType},
    member_execution_config::MemberExecutionConfig,
};
use deployment::Deployment;
use git::{Commit, DiffTarget, GitCli, GitService};
use regex::Regex;
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use services::services::{
    analytics_events::{AnalyticsEvent, AnalyticsEventPayload, AnalyticsProjector},
    chat::create_session_with_project_members,
    session_worktree::SessionWorktreeService,
    workflow::workflow_analytics,
};
use sqlx::FromRow;
use ts_rs::TS;
use utils::{
    assets::asset_dir,
    diff::{Diff, DiffChangeKind, create_unified_diff},
    response::ApiResponse,
};
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

include!("sessions/lifecycle.rs");
include!("sessions/agents.rs");
include!("sessions/workspace_changes.rs");
include!("sessions/run_files.rs");
include!("sessions/workspace_resolution.rs");
include!("sessions/workspace_git.rs");

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use chrono::Utc;
    use db::models::{
        chat_run::{ChatRun, ChatRunArtifactState, ChatRunLogState},
        chat_session::ChatSessionStatus,
        chat_session_worktree::{SessionWorktree, SessionWorktreeMode, SessionWorktreeStatus},
    };
    use git::GitService;
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::*;

    include!("sessions/tests/workspace_git.rs");
    include!("sessions/tests/run_files.rs");
    include!("sessions/tests/workspace_changes.rs");
}
