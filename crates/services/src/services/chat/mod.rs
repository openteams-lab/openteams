use std::{
    collections::{HashMap, HashSet, hash_map::DefaultHasher},
    hash::Hasher,
    path::Path,
    str::FromStr,
    sync::Arc,
    time::Duration,
};

use chrono::Utc;
use dashmap::DashMap;
use db::models::{
    chat_agent::ChatAgent,
    chat_message::{ChatMessage, ChatSenderType, CreateChatMessage},
    chat_session::{ChatSession, ChatSessionStatus},
    chat_session_agent::{ChatSessionAgent, ChatSessionAgentState},
};
use executors::{
    approvals::NoopExecutorApprovalService,
    env::{ExecutionEnv, RepoContext},
    executors::{
        BaseCodingAgent, ExecutorError, ExecutorExitResult, SpawnedChild,
        StandardCodingAgentExecutor,
    },
    logs::{NormalizedEntryType, utils::patch::extract_normalized_entry_from_patch},
    profile::{ExecutorConfigs, ExecutorProfileId, canonical_variant_key},
};
use futures::StreamExt;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use thiserror::Error;
use tokio::{fs, io::AsyncWriteExt};
use tokio_util::io::ReaderStream;
use ts_rs::TS;
use utils::{assets::config_path, log_msg::LogMsg, msg_store::MsgStore, utf8::Utf8LossyDecoder};
use uuid::Uuid;

use super::{analytics::AnalyticsService, workflow_analytics};

include!("dependencies.rs");
include!("types.rs");
include!("session_creation.rs");
include!("attachments.rs");
include!("mentions.rs");
include!("member_names.rs");
include!("analytics.rs");
include!("messages.rs");
include!("context.rs");
include!("compression.rs");
include!("archive.rs");
include!("tests.rs");
