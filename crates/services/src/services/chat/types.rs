#[derive(Debug, Error)]
pub enum ChatServiceError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("Chat session not found")]
    SessionNotFound,
    #[error("Chat session is archived")]
    SessionArchived,
    #[error("Validation error: {0}")]
    Validation(String),
}

#[derive(Clone)]
struct CompressionCacheEntry {
    source_fingerprint: u64,
    source_message_count: usize,
    token_threshold: u32,
    compression_percentage: u8,
    source_token_count: u32,
    effective_token_count: u32,
    result: CompressionResult,
}

/// Result of the message compression process
#[derive(Debug, Clone)]
pub struct CompressionResult {
    /// The messages after compression (either with summary or truncated)
    pub messages: Vec<super::chat_history_file::SimplifiedMessage>,
    /// Type of compression that was applied
    pub compression_type: CompressionType,
    /// Warning if compression failed and fallback was used
    pub warning: Option<CompressionWarning>,
}

/// Type of compression that was applied to messages
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompressionType {
    /// No compression needed, messages were under threshold
    None,
    /// AI summarization was successful
    AiSummarized,
    /// All AI agents failed, messages were truncated to split file
    Truncated,
}

/// Warning generated when compression falls back to truncation
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CompressionWarning {
    /// Warning code for programmatic handling
    pub code: String,
    /// Human-readable warning message
    pub message: String,
    /// Path to the split file containing archived messages
    pub split_file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatAttachmentMeta {
    pub id: Uuid,
    pub name: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub kind: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageAnalyticsMetrics {
    pub message_length_bucket: &'static str,
    pub mention_count: usize,
    pub attachment_count: usize,
    pub attachment_total_size_bytes: u64,
}

/// Context with LLM-compressed summary message included
pub struct CompactedContext {
    /// The compacted messages (summary + recent messages)
    pub messages: Vec<Value>,
    /// Raw JSONL string for prompt injection
    pub jsonl: String,
    /// Whether context compression has been applied
    pub context_compacted: bool,
    /// Warning if compression fell back to truncation
    pub compression_warning: Option<CompressionWarning>,
}
