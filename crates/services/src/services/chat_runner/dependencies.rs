use crate::services::{
    agent_activity_stream::{AgentActivityEntryLine, AgentActivityStreamState},
    analytics::AnalyticsService,
    analytics_events::{
        AnalyticsEvent, AnalyticsEventPayload, AnalyticsProjector, duration_bucket,
    },
    chat::{self, ChatServiceError, is_workflow_chat_input_mode},
    config::{self, UiLanguage},
    native_skills::{
        NativeSkillError, auto_allow_builtin_skills, ensure_builtin_skills_installed,
        list_native_skills_for_runner,
    },
    workflow_analytics,
    workflow_runtime::resolve_lead_agent,
    workspace_change_capture::{
        WorkspaceChangeBaseline, capture_workspace_change_baseline, capture_workspace_change_delta,
    },
};

const OPENTEAMS_HOME_DIR: &str = ".openteams";
const OPENTEAMS_WORKSPACE_DIR: &str = ".openteams";
const RUNS_DIR_NAME: &str = "runs";
const CONTEXT_DIR_NAME: &str = "context";
const LEGACY_COMPACTED_CONTEXT_FILE_NAME: &str = "messages_compacted.background.jsonl";
const RUN_RECORDS_DIR_NAME: &str = "run_records";
const SHARED_PROTOCOL_DIR_NAME: &str = "protocol";
const SHARED_BLACKBOARD_FILE_NAME: &str = "shared_blackboard.jsonl";
const WORK_RECORDS_FILE_NAME: &str = "work_records.jsonl";
const RUN_ACTIVITY_FILE_NAME: &str = "activity.jsonl";
const RUN_ACTIVITY_RETENTION_HOURS: i64 = 24;
const RESERVED_USER_HANDLE: &str = "you";
const PROTOCOL_SEND_INTENT_VALUES: &[&str] = &["request", "reply", "notify", "blocker", "confirm"];
const EXECUTOR_GRACEFUL_STOP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const LIVE_LOG_MAX_BYTES_PER_RUN: u64 = 8 * 1024 * 1024;
const LIVE_LOG_BUDGET_BYTES_PER_WORKSPACE: u64 = 64 * 1024 * 1024;
const PERSISTED_LOG_TAIL_BYTES_SUCCESS: u64 = 256 * 1024;
const PERSISTED_LOG_TAIL_BYTES_FAILURE: u64 = 1024 * 1024;
const RUNS_MAX_TOTAL_BYTES_PER_WORKSPACE: u64 = 500 * 1024 * 1024;
const RUNS_PRUNE_TARGET_BYTES_PER_WORKSPACE: u64 = 200 * 1024 * 1024;
const _: () = assert!(RUNS_PRUNE_TARGET_BYTES_PER_WORKSPACE < RUNS_MAX_TOTAL_BYTES_PER_WORKSPACE);
const OPENTEAMS_GITIGNORE_ENTRY: &str = ".openteams/";
/// Maximum number of auto-retries when agent output fails JSON protocol parsing.
/// Only `InvalidJson` and `NotJsonArray` errors trigger a retry; semantic errors
/// (e.g. `EmptyMessage`, `MissingSendTarget`) are not retried.
const MAX_PROTOCOL_PARSE_RETRIES: u32 = 1;
const PROTOCOL_OUTPUT_SCHEMA_JSON_WORKFLOW_PLAN: &str = r#"{
  "type": "array",
  "items": {
    "anyOf": [
      {
        "type": "object",
        "properties": {
          "type": { "const": "send" },
          "to": { "type": "string", "minLength": 1 },
          "content": { "type": "string", "minLength": 1 },
          "intent": {
            "type": "string",
            "enum": ["request", "reply", "notify", "blocker", "confirm"]
          }
        },
        "required": ["type", "to", "content"],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": { "const": "record" },
          "content": { "type": "string", "minLength": 1 }
        },
        "required": ["type", "content"],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": { "const": "artifact" },
          "content": {
            "type": "array",
            "items": { "type": "string", "minLength": 1 },
            "minItems": 1
          }
        },
        "required": ["type", "content"],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": { "const": "conclusion" },
          "content": { "type": "string", "minLength": 1 }
        },
        "required": ["type", "content"],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": { "const": "workflow_generate" },
          "plan_check": { "type": "boolean" },
          "content": { "type": "string" },
          "design_doc_path": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["type", "plan_check", "content"],
        "additionalProperties": false
      }
    ]
  },
  "minItems": 1
}"#;
const PROTOCOL_OUTPUT_SCHEMA_JSON: &str = r#"{
  "type": "array",
  "items": {
    "anyOf": [
      {
        "type": "object",
        "properties": {
          "type": { "const": "send" },
          "to": { "type": "string", "minLength": 1 },
          "content": { "type": "string", "minLength": 1 },
          "intent": {
            "type": "string",
            "enum": ["request", "reply", "notify", "blocker", "confirm"]
          }
        },
        "required": ["type", "to", "content"],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": { "const": "record" },
          "content": { "type": "string", "minLength": 1 }
        },
        "required": ["type", "content"],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": { "const": "artifact" },
          "content": {
            "type": "array",
            "items": { "type": "string", "minLength": 1 },
            "minItems": 1
          }
        },
        "required": ["type", "content"],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": { "const": "conclusion" },
          "content": { "type": "string", "minLength": 1 }
        },
        "required": ["type", "content"],
        "additionalProperties": false
      }
    ]
  },
  "minItems": 1
}"#;
const MARKDOWN_PROTOCOL_OUTPUT_EXAMPLE_JSON: &str = r#"[
  {"type": "send", "to": "you", "intent": "request", "content": "I have finished the implementation"},
  {"type": "artifact", "content": ["frontend/src/lib/api.ts", "crates/server/src/routes/chat/sessions.rs"]},
  {"type": "record", "content": "The metrics are `latency_p95_ms` and `success_rate`."},
  {"type": "conclusion", "content": "Finished metric definition. Next: wire collection into runner."}
]"#;
const MARKDOWN_PROTOCOL_OUTPUT_EXAMPLE_JSON_WORKFLOW_PLAN: &str = r#"[
  {"type": "send", "to": "you", "intent": "request", "content": "I have finished the implementation"},
  {"type": "artifact", "content": ["docs/workflow-plan.md"]},
  {"type": "record", "content": "The metrics are `latency_p95_ms` and `success_rate`."},
  {"type": "workflow_generate", "plan_check": true, "content": "Generate a workflow plan to implement the following task: ...", "design_doc_path": ["path/to/design_doc1.md", "path/to/design_doc2.md"]}
]"#;

static INLINE_CODE_PATH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"`([^`\r\n]+)`").expect("inline code path regex"));

const PATH_LIKE_EXTENSIONS: &[&str] = &[
    "c", "cc", "cpp", "cs", "css", "go", "h", "hpp", "html", "java", "js", "json", "jsx", "md",
    "mjs", "py", "rb", "rs", "scss", "sh", "sql", "svg", "toml", "ts", "tsx", "txt", "vue", "xml",
    "yaml", "yml",
];
