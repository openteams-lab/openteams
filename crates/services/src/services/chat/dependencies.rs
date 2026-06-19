/// Default token threshold for compression (50,000 tokens)
pub const DEFAULT_TOKEN_THRESHOLD: u32 = 50000;
/// Default percentage of messages to compress (25%)
pub const DEFAULT_COMPRESSION_PERCENTAGE: u8 = 25;
const SUMMARY_EXECUTION_TIMEOUT: Duration = Duration::from_secs(120);
const SUMMARY_DRAIN_TIMEOUT: Duration = Duration::from_millis(350);
const SUMMARY_REAP_TIMEOUT: Duration = Duration::from_secs(3);
const SUMMARY_KILL_WAIT_TIMEOUT: Duration = Duration::from_secs(2);
const SUMMARY_INPUT_TOKEN_LIMIT: u32 = 60_000;
const EXECUTOR_PROFILE_VARIANT_KEY: &str = "executor_profile_variant";

static COMPRESSION_RESULT_CACHE: Lazy<DashMap<Uuid, CompressionCacheEntry>> =
    Lazy::new(DashMap::new);
const COMPRESSION_STATE_TABLE: &str = "chat_session_compression_states";

/// Maximum token limit for context to ensure it fits within model input limits.
/// Most models support ~200k tokens; we use a conservative limit to leave room for
/// system prompt, skills, and other context overhead.
const MAX_CONTEXT_TOKENS: u32 = 150_000;
