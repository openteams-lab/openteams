//! Workflow analytics instrumentation module.
//!
//! Covers 5 event categories per `.openteams/plan.md`:
//! 1. Process funnel (workflow.*)
//! 2. Collaboration efficiency (collaboration.*)
//! 3. User engagement (engagement.*)
//! 4. Quality outcomes (quality.*)
//! 5. Risk/anomaly (risk.*)
//!
//! All events carry a unified context (`WorkflowEventContext`) and pass through
//! privacy filtering (forbidden blacklist + allowed whitelist) before being recorded.
#![allow(clippy::too_many_arguments)]

use std::collections::HashSet;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use super::analytics::{AnalyticsService, track_workflow_event};

// ---------------------------------------------------------------------------
// Unified event context (per plan.md)
// ---------------------------------------------------------------------------

include!("dependencies.rs");
include!("types.rs");
include!("validation.rs");
include!("tracking.rs");
include!("buckets.rs");
include!("tests.rs");
