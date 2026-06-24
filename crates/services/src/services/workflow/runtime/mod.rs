#![allow(clippy::too_many_arguments)]

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use chrono::Utc;
use dashmap::{DashMap, DashSet};
use db::{
    DBService,
    models::{
        chat_agent::ChatAgent,
        chat_message::{ChatMessage, ChatSenderType},
        chat_run::{ChatRun, ChatRunLogState, ChatRunRetentionSummary, CreateChatRun},
        chat_session::{ChatSession, ChatSessionWorktreeMode},
        chat_session_agent::ChatSessionAgent,
        workflow_agent_session::WorkflowAgentSession,
        workflow_execution::WorkflowExecution,
        workflow_iteration_feedback::WorkflowIterationFeedback,
        workflow_loop::WorkflowLoop,
        workflow_plan::WorkflowPlan,
        workflow_plan_revision::WorkflowPlanRevision,
        workflow_round::WorkflowRound,
        workflow_step::WorkflowStep,
        workflow_step_edge::WorkflowStepEdge,
        workflow_step_review::WorkflowStepReview,
        workflow_transcript::{CreateWorkflowTranscript, WorkflowTranscript},
        workflow_types::{
            ReviewVerdict, WorkflowExecutionStatus, WorkflowPlanJson, WorkflowPlanNode,
            WorkflowStepStatus, WorkflowStepType, to_workflow_wire_value,
        },
    },
};
use executors::{
    approvals::NoopExecutorApprovalService,
    env::{ExecutionEnv, RepoContext},
    executors::{
        CancellationToken, ExecutorError, ExecutorExitResult, ExecutorExitSignal, SpawnedChild,
        StandardCodingAgentExecutor,
    },
    logs::{
        ActionType, NormalizedEntry, NormalizedEntryType, TokenUsageInfo, ToolStatus,
        utils::patch::extract_normalized_entry_from_patch,
    },
};
use futures::StreamExt;
use json_patch::Patch;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tokio::{fs, time};
use tokio_util::io::ReaderStream;
use ts_rs::TS;
use utils::{log_msg::LogMsg, msg_store::MsgStore, utf8::Utf8LossyDecoder};
use uuid::Uuid;

use super::{
    chat_runner::{ChatRunner, ChatStreamDeltaType},
    config::UiLanguage,
};
use crate::services::{
    member_execution::build_effective_member_executor,
    session_worktree::{EnsureOutcome, EnsureWorktreeInput, SessionWorktreeService},
    workspace_change_capture::{
        WorkspaceChangeBaseline, build_git_observed_path_records,
        capture_workspace_change_baseline, capture_workspace_change_delta, run_records_prefix,
        workspace_run_records_dir,
    },
};

include!("dependencies.rs");
include!("types.rs");
include!("protocol.rs");
include!("prompts.rs");
include!("projection.rs");
include!("runner.rs");
include!("stream.rs");
include!("transcripts.rs");
include!("retention.rs");
include!("tests.rs");
