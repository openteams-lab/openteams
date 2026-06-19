//! Skill Registry Service
//!
//! Provides functionality to fetch and install skills from a remote registry.
//! Also provides built-in skills from the awesome-claude-skills repository.
//! Supports fallback to embedded local skill files when remote server is unavailable.

#![allow(clippy::items_after_test_module)]

use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
};

use db::models::{
    chat_session_agent::ChatSessionAgent,
    chat_skill::{ChatSkill, CreateChatSkill, UpdateChatSkill},
};
use once_cell::sync::Lazy;
use reqwest::Client;
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

include!("dependencies.rs");
include!("types.rs");
include!("agent_adapters.rs");
include!("remote_registry.rs");
include!("frontmatter.rs");
include!("discovery.rs");
include!("install.rs");
include!("builtin.rs");
include!("tests.rs");
