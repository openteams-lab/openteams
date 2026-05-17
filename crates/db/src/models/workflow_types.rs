use std::fmt::Debug;

use serde::{Deserialize, Deserializer, Serialize};
use sqlx::Type;
use ts_rs::TS;

/// Deserializes version field accepting both integer (e.g. `1`) and string (e.g. `"1.0.0"`)
fn deserialize_version_flexible<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de;

    struct VersionVisitor;

    impl<'de> de::Visitor<'de> for VersionVisitor {
        type Value = String;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("an integer or string version")
        }

        fn visit_u64<E: de::Error>(self, v: u64) -> Result<String, E> {
            Ok(v.to_string())
        }

        fn visit_i64<E: de::Error>(self, v: i64) -> Result<String, E> {
            Ok(v.to_string())
        }

        fn visit_f64<E: de::Error>(self, v: f64) -> Result<String, E> {
            Ok(v.to_string())
        }

        fn visit_str<E: de::Error>(self, v: &str) -> Result<String, E> {
            Ok(v.to_string())
        }

        fn visit_string<E: de::Error>(self, v: String) -> Result<String, E> {
            Ok(v)
        }
    }

    deserializer.deserialize_any(VersionVisitor)
}

pub fn to_workflow_wire_value<T>(value: &T) -> String
where
    T: Serialize + Debug,
{
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| format!("{value:?}").to_lowercase())
}

// ---------------------------------------------------------------------------
// Plan-level enums
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "workflow_plan_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum WorkflowPlanStatus {
    Draft,
    Ready,
    Superseded,
    Cancelled,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "workflow_validation_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum WorkflowValidationStatus {
    Pending,
    Valid,
    Invalid,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "workflow_revision_editor", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum WorkflowRevisionEditor {
    Lead,
    System,
}

// ---------------------------------------------------------------------------
// Execution-level enums
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "workflow_execution_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum WorkflowExecutionStatus {
    Pending,
    Running,
    Failed,
    Cancelled,
    Paused,
    Recompiling,
    Completed,
    Waiting,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "workflow_round_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum WorkflowRoundStatus {
    Running,
    #[sqlx(rename = "waiting_user_acceptance")]
    #[serde(rename = "waiting_user_acceptance")]
    WaitingUserAcceptance,
    Accepted,
    Rejected,
    Archived,
}

// ---------------------------------------------------------------------------
// Step-level enums
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "workflow_step_type", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum WorkflowStepType {
    Task,
    Review,
    Result,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "workflow_step_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum WorkflowStepStatus {
    Pending,
    Ready,
    Running,
    #[sqlx(rename = "pre_completed")]
    #[serde(rename = "pre_completed")]
    PreCompleted,
    #[sqlx(rename = "interrupt_requested")]
    #[serde(rename = "interrupt_requested")]
    InterruptRequested,
    Interrupted,
    #[sqlx(rename = "waiting_input")]
    #[serde(rename = "waiting_input")]
    WaitingInput,
    #[sqlx(rename = "waiting_review")]
    #[serde(rename = "waiting_review")]
    WaitingReview,
    Blocked,
    Revising,
    Completed,
    Failed,
    Skipped,
    Cancelled,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "workflow_loop_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum WorkflowLoopStatus {
    Pending,
    Running,
    WaitingReview,
    Passed,
    Rejected,
    WaitingUser,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "review_verdict", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum ReviewVerdict {
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "reviewer_type", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum ReviewerType {
    Lead,
    User,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "workflow_edge_kind", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum WorkflowEdgeKind {
    Hard,
    Soft,
}

// ---------------------------------------------------------------------------
// Agent session enums
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "workflow_agent_session_role", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum WorkflowAgentSessionRole {
    Lead,
    Worker,
    Reviewer,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "workflow_agent_session_state", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum WorkflowAgentSessionState {
    Idle,
    Running,
    #[sqlx(rename = "interrupt_requested")]
    #[serde(rename = "interrupt_requested")]
    InterruptRequested,
    Interrupted,
    Paused,
    Completed,
    Failed,
    Expired,
}

// ---------------------------------------------------------------------------
// Event enums
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "workflow_event_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum WorkflowEventType {
    ExecutionCreated,
    ExecutionRunning,
    ExecutionFailed,
    ExecutionCompleted,
    ExecutionPaused,
    ExecutionWaiting,
    RoundStarted,
    RoundResultReady,
    UserAccepted,
    UserRejected,
    RoundArchived,
    PlanRevisionCreated,
    PlanRecompiled,
    StepStatusChanged,
    AgentSessionStateChanged,
    StepLeadReviewStarted,
    StepLeadReviewPassed,
    StepLeadReviewRejected,
    StepUserReviewStarted,
    StepUserReviewPassed,
    StepUserReviewRejected,
    LoopStarted,
    LoopRetrying,
    LoopPassed,
    LoopFailed,
    IterationFeedbackReceived,
    IterationNewPlanGenerated,
}

// ---------------------------------------------------------------------------
// Workflow Plan JSON types (React Flow compatible)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct WorkflowPlanJson {
    #[serde(deserialize_with = "deserialize_version_flexible")]
    pub version: String,
    pub title: String,
    pub goal: String,
    pub agents: WorkflowPlanAgents,
    #[serde(default)]
    pub globals: Option<WorkflowPlanGlobals>,
    #[serde(default)]
    pub viewport: Option<WorkflowPlanViewport>,
    pub nodes: Vec<WorkflowPlanNode>,
    pub edges: Vec<WorkflowPlanEdge>,
    #[serde(default)]
    pub loops: Option<Vec<WorkflowLoopDef>>,
    #[serde(default)]
    pub policies: Option<WorkflowPlanPolicies>,
}

impl WorkflowPlanJson {
    pub fn plan_schema_version(&self) -> Result<i32, String> {
        let normalized = self.version.trim().trim_start_matches('v');
        let major = normalized.split('.').next().unwrap_or_default().trim();

        if major.is_empty() {
            return Err("Workflow plan version cannot be empty.".to_string());
        }

        major.parse::<i32>().map_err(|_| {
            format!(
                "Invalid workflow plan version '{}'. Expected an integer-like string such as '1' or '1.0.0'.",
                self.version
            )
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct WorkflowPlanAgents {
    pub lead: String,
    pub available: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct WorkflowPlanGlobals {
    #[serde(default = "default_interrupt_mode")]
    pub interrupt_mode: String,
    #[serde(default = "default_retry")]
    pub default_retry: u32,
    #[serde(default = "default_true")]
    pub global_pause_supported: bool,
}

fn default_interrupt_mode() -> String {
    "cooperative".to_string()
}

fn default_retry() -> u32 {
    1
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct WorkflowPlanViewport {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
}

fn default_zoom() -> f64 {
    1.0
}

impl Default for WorkflowPlanViewport {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct WorkflowPlanNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(default)]
    pub position: WorkflowNodePosition,
    pub data: WorkflowNodeData,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct WorkflowNodePosition {
    pub x: f64,
    pub y: f64,
}

impl Default for WorkflowNodePosition {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowNodeData {
    pub step_type: String,
    #[serde(default)]
    pub agent_id: Option<String>,
    pub title: String,
    pub instructions: String,
    #[serde(default)]
    pub acceptance: Option<Vec<String>>,
    #[serde(default)]
    pub outputs: Option<Vec<String>>,
    #[serde(default = "default_true")]
    pub interruptible: bool,
    #[serde(default)]
    pub max_retry: Option<u32>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub loop_key: Option<String>,
    #[serde(default)]
    pub review_scope: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowLoopDef {
    pub loop_key: String,
    pub member_steps: Vec<String>,
    pub review_step: String,
    #[serde(default)]
    pub max_retry: Option<u32>,
    #[serde(default)]
    pub user_review_required: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct WorkflowPlanEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(rename = "type", default)]
    pub edge_type: Option<String>,
    #[serde(default)]
    pub data: Option<WorkflowEdgeData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct WorkflowEdgeData {
    #[serde(default = "default_edge_kind")]
    pub kind: String,
}

fn default_edge_kind() -> String {
    "hard".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct WorkflowPlanPolicies {
    #[serde(default)]
    pub approval_required_on: Option<Vec<String>>,
    #[serde(default)]
    pub permission_required_on: Option<Vec<String>>,
    #[serde(default)]
    pub on_failure: Option<String>,
    #[serde(default = "default_true")]
    pub allow_plan_revision: bool,
}

// ---------------------------------------------------------------------------
// Compiled graph DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct CompiledGraph {
    pub plan_hash: String,
    pub compiled_graph_hash: String,
    pub steps: Vec<CompiledStep>,
    pub edges: Vec<CompiledEdge>,
    pub ready_step_keys: Vec<String>,
    #[serde(default)]
    pub loops: Option<Vec<CompiledLoopDef>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct CompiledStep {
    pub step_key: String,
    pub step_type: WorkflowStepType,
    pub title: String,
    pub instructions: String,
    pub assigned_agent_id: Option<String>,
    pub acceptance: Option<Vec<String>>,
    pub outputs: Option<Vec<String>>,
    pub interruptible: bool,
    pub max_retry: u32,
    pub display_order: i32,
    #[serde(default)]
    pub loop_key: Option<String>,
    #[serde(default)]
    pub review_scope: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct CompiledEdge {
    pub edge_id: String,
    pub from_step_key: String,
    pub to_step_key: String,
    pub edge_kind: WorkflowEdgeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct CompiledLoopDef {
    pub loop_key: String,
    pub member_step_keys: Vec<String>,
    pub review_step_key: String,
    #[serde(default)]
    pub review_scope_step_keys: Vec<String>,
    pub max_retry: u32,
    pub user_review_required: bool,
}
