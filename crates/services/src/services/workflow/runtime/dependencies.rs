const WORKFLOW_EXECUTION_TIMEOUT: Duration = Duration::from_secs(4800);
const WORKFLOW_DRAIN_TIMEOUT: Duration = Duration::from_millis(1000);
const WORKFLOW_RUNTIME_STREAM_TAIL_DRAIN_TIMEOUT: Duration = Duration::from_millis(350);
const WORKFLOW_SESSION_ID_DRAIN_TIMEOUT: Duration = Duration::from_millis(350);
const WORKFLOW_REAP_TIMEOUT: Duration = Duration::from_secs(3);
const WORKFLOW_KILL_WAIT_TIMEOUT: Duration = Duration::from_secs(2);
const WORKFLOW_EXECUTOR_ERROR_MAX_CHARS: usize = 1600;
const WORKFLOW_EXECUTOR_ERROR_MAX_LINES: usize = 16;
pub const WORKFLOW_PROTOCOL_PARSE_MAX_RETRIES: u32 = 1;

/// Global registry: step_id → (CancellationToken, child_pid).
/// Used to cancel a running agent process when a step is interrupted.
static RUNNING_STEPS: Lazy<DashMap<Uuid, CancellationToken>> = Lazy::new(DashMap::new);
static STEP_CANCEL_REQUESTS: Lazy<DashSet<Uuid>> = Lazy::new(DashSet::new);
