use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Component, Path, PathBuf},
    str::FromStr,
    sync::{
        Arc, LazyLock,
        atomic::{AtomicBool, AtomicU8, Ordering},
    },
};

use chrono::Utc;
use dashmap::DashMap;
use db::{
    DBService,
    models::{
        chat_agent::ChatAgent,
        chat_message::{ChatMessage, ChatSenderType},
        chat_run::{
            ChatRun, ChatRunArtifactState, ChatRunLogState, ChatRunRetentionSummary, CreateChatRun,
        },
        chat_session::{ChatSession, ChatSessionWorktreeMode},
        chat_session_agent::{ChatSessionAgent, ChatSessionAgentState},
        chat_skill::ChatSkill,
        chat_work_item::{ChatWorkItem, ChatWorkItemType, CreateChatWorkItem},
        workflow_types::{WorkflowPlanEdge, WorkflowPlanNode},
    },
};
use executors::{
    approvals::NoopExecutorApprovalService,
    env::{ExecutionEnv, RepoContext},
    executors::{
        BaseCodingAgent, CancellationToken, ExecutorError, ExecutorExitSignal,
        StandardCodingAgentExecutor,
    },
    logs::{
        NormalizedEntryError, NormalizedEntryType, TokenUsageInfo,
        utils::patch::extract_normalized_entry_from_patch,
    },
};
use futures::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{
    fs,
    io::AsyncWriteExt,
    process::Command,
    sync::{Mutex, broadcast},
};
use tokio_util::io::ReaderStream;
use ts_rs::TS;
use utils::{
    assets::{asset_dir, config_path},
    log_msg::LogMsg,
    msg_store::MsgStore,
    process,
    utf8::Utf8LossyDecoder,
};
use uuid::Uuid;

use crate::services::{
    member_execution::build_effective_member_executor,
    queued_message::{
        CreateQueuedMessage, MemberQueueSnapshot, QueuedMessage, QueuedMessageService,
    },
    session_worktree::{
        EnsureOutcome, EnsureWorktreeInput, SessionWorktreeError, SessionWorktreeService,
    },
};

include!("dependencies.rs");
include!("types.rs");
include!("protocol_messages.rs");
include!("attachments.rs");
include!("lifecycle.rs");
include!("module_declarations.rs");
