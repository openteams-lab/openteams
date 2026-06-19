const VALID_EVENT_SOURCES: &[&str] = &[
    "backend",
    "frontend",
    "workflow_runner",
    "chat_runner",
    "reviewer",
];

const VALID_AGENT_ROLES: &[&str] = &["planner", "executor", "reviewer", "assistant", "unknown"];

/// Fields that must NEVER appear in event metadata.
const FORBIDDEN_METADATA_KEYS: &[&str] = &[
    "message_content",
    "file_content",
    "full_path",
    "secret_value",
    "prompt_text",
    "raw_stdout",
    "raw_stderr",
    "stack_trace",
];

/// Allowed metadata keys (beyond the unified context).
/// Any key not in this whitelist AND not in the unified context will be stripped.
const ALLOWED_METADATA_KEYS: &[&str] = &[
    "message_length_bucket",
    "attachment_count",
    "mention_count",
    "diff_file_count",
    "retry_count",
    "runner_type",
    "api_route_key",
    "http_status",
    "attachment_type",
    "size_bucket",
    "step_key",
    "step_type",
    "review_verdict",
    "reviewer_type",
    "interruption_source",
    "request_type",
    "from_status",
    "event_category",
    "resolution",
    "agent_session_state",
    "detail_level",
    "has_workspace",
    "transcript_count",
    "transcript_scope",
];

/// Unified context field names that are set directly on the context struct.
const CONTEXT_FIELD_NAMES: &[&str] = &[
    "session_id",
    "workflow_id",
    "workspace_id",
    "user_id_hash",
    "agent_role",
    "timestamp",
    "event_source",
    "plan_id",
    "task_id",
    "status",
    "duration_ms",
    "error_code",
    "metadata_version",
];
