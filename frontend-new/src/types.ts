// =============================================================================
// UI types
// -----------------------------------------------------------------------------
// These types are consumed by existing React components. They are intentionally
// flat / UI-shaped. Backend-derived shapes live in the BACKEND TYPES section
// below; mapping is performed in `src/lib/mappers.ts`.
// =============================================================================

export type Theme = 'dark' | 'light';

export type Locale = 'en' | 'zh' | 'ja' | 'ko' | 'fr' | 'es';

export interface TaskNode {
  id: string;
  name: string;
  subText: string;
  avatar: string;
  cost: string;
  status: 'done' | 'run' | 'wait';
}

export interface Member {
  id: string;
  avatar: string;
  status: 'on' | 'run' | 'i';
  name: string;
  roleDetail: string;
  modelName: string;
}

export interface Session {
  id: string;
  title: string;
  icon: string;
  active: boolean;
}

export interface Message {
  id: string;
  avatar: string;
  sender: string;
  time: string;
  text: string;
  cost?: string;
  model?: string;
  quotedMessage?: QuotedMessageReference;
  referenceMessageId?: string;
  attachments?: ChatAttachment[];
  isUser?: boolean;
  isThinking?: boolean;
  isAgentRunning?: boolean;
  runId?: string;
  sessionAgentId?: string;
  activityLines?: ChatRunActivityLine[];
  activityLoadState?: ActivityLoadState;
}

export interface QuotedMessageReference {
  id: string;
  sender: string;
  content: string;
  summary: string;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mime_type?: string | null;
  size_bytes?: number;
  kind?: string;
  relative_path?: string;
}

export type ActivityLoadState =
  | 'idle'
  | 'loading'
  | 'loaded'
  | 'error'
  | 'pruned';

export type ChatRunActivityLineType =
  | 'thinking'
  | 'tool'
  | 'assistant'
  | 'error';

export type ChatStreamDeltaType = 'assistant' | 'thinking' | 'error';

export interface ChatRunActivityLine {
  line_id: string;
  run_id: string;
  session_id: string;
  session_agent_id: string;
  agent_id: string;
  agent_name: string;
  sequence: number;
  line_type: ChatRunActivityLineType;
  stream_type: ChatStreamDeltaType;
  content: string;
  created_at: string;
}

export interface ChatRunActivityResponse {
  run_id: string;
  lines: ChatRunActivityLine[];
  next_offset: number | null;
  is_pruned: boolean;
}

export interface ChatRunRetentionInfo {
  run_id: string;
  session_agent_id: string;
  created_at: string;
}

export interface ChatRunRetentionListResponse {
  runs: ChatRunRetentionInfo[];
}

export interface Provider {
  id: string;
  monogram: string;
  name: string;
  keyMask: string;
  // LOCAL-DERIVED: backend's ProviderInfo / CliConfig has no last-used timestamp.
  // UI shows whatever the caller passes; mappers default to a static placeholder.
  lastUsed: string;
  active: boolean;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  hint: string;
  recommended?: boolean;
}

export type SidebarPrimaryActionId = 'inbox' | 'new-session';

export type SidebarNavigationTarget =
  | 'workspace'
  | 'team'
  | 'team-templates'
  | 'tasks'
  | 'routing'
  | 'github'
  | 'providers'
  | 'tokens'
  | 'agents'
  | 'build-stats';

export interface SidebarProjectDisplay {
  id: string;
  label: string;
  active: boolean;
  monogram: string;
  repository: string;
  description: string;
}

export interface SidebarPrimaryAction {
  id: SidebarPrimaryActionId;
  label: string;
  icon: string;
  helper: string;
}

export interface SidebarBuildStat {
  id: string;
  label: string;
  value: string;
  helper: string;
  tone?: 'default' | 'accent' | 'success' | 'warning';
}

export interface SidebarBuildStats {
  title: string;
  defaultExpanded: boolean;
  summary: string;
  stats: SidebarBuildStat[];
}

export interface SidebarNavigationItem {
  id: string;
  label: string;
  icon: string;
  helper: string;
  targetPage?: SidebarNavigationTarget;
  badge?: string;
  disabled?: boolean;
}

// =============================================================================
// BACKEND TYPES (subset of shared/types.ts, sufficient for the new frontend)
// -----------------------------------------------------------------------------
// These mirror the Rust-generated `shared/types.ts` from the restored backend
// (see backend_contract_audit). Only the fields and variants consumed by this
// frontend are declared; the full backend type surface is not redeclared.
// =============================================================================

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ApiResponse<T, E = T> {
  success: boolean;
  data: T | null;
  error_data: E | null;
  message: string | null;
}

// ----- Chat sessions ---------------------------------------------------------

export type ChatSessionStatus = 'active' | 'archived';

export interface BackendChatSession {
  id: string;
  title: string | null;
  status: ChatSessionStatus;
  lead_agent_id: string | null;
  summary_text: string | null;
  archive_ref: string | null;
  last_seen_diff_key: string | null;
  team_protocol: string | null;
  team_protocol_enabled: boolean;
  default_workspace_path: string | null;
  chat_input_mode: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CreateChatSession {
  title: string | null;
  workspace_path: string | null;
}

export interface UpdateChatSession {
  title: string | null;
  status: ChatSessionStatus | null;
  lead_agent_id?: string | null;
  summary_text: string | null;
  archive_ref: string | null;
  last_seen_diff_key: string | null;
  team_protocol: string | null;
  team_protocol_enabled: boolean | null;
  default_workspace_path: string | null;
  chat_input_mode?: string | null;
}

// ----- Chat messages ---------------------------------------------------------

export type ChatSenderType = 'user' | 'agent' | 'system';

export interface BackendChatMessage {
  id: string;
  session_id: string;
  sender_type: ChatSenderType;
  sender_id: string | null;
  content: string;
  mentions: string[];
  meta: JsonValue;
  created_at: string;
}

export interface CreateChatMessageRequest {
  sender_type: ChatSenderType;
  sender_id: string | null;
  content: string;
  meta: JsonValue | null;
}

// ----- Chat agents -----------------------------------------------------------

export interface BackendChatAgent {
  id: string;
  name: string;
  runner_type: string;
  system_prompt: string;
  tools_enabled: JsonValue;
  model_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateChatAgent {
  name: string;
  runner_type: string;
  system_prompt: string | null;
  tools_enabled: JsonValue | null;
  model_name: string | null;
}

export interface UpdateChatAgent {
  name: string | null;
  runner_type: string | null;
  system_prompt: string | null;
  tools_enabled: JsonValue | null;
  model_name: string | null;
}

// ----- Session agents --------------------------------------------------------

export type ChatSessionAgentState =
  | 'idle'
  | 'running'
  | 'stopping'
  | 'waitingapproval'
  | 'dead';

export interface MemberExecutionConfig {
  runner_type?: BaseCodingAgent | null;
  model_name?: string | null;
  thinking_effort?: string | null;
  model_variant?: string | null;
}

export interface BackendChatSessionAgent {
  id: string;
  session_id: string;
  agent_id: string;
  state: ChatSessionAgentState;
  workspace_path: string | null;
  pty_session_key: string | null;
  agent_session_id: string | null;
  agent_message_id: string | null;
  project_member_id?: string | null;
  execution_config?: MemberExecutionConfig;
  allowed_skill_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateChatSessionAgentRequest {
  agent_id: string;
  workspace_path: string | null;
  allowed_skill_ids: string[] | null;
}

export interface UpdateChatSessionAgentRequest {
  workspace_path: string | null;
  allowed_skill_ids: string[] | null;
}

// ----- Skills ----------------------------------------------------------------

export interface BackendChatSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  trigger_type: string;
  trigger_keywords: string[];
  enabled: boolean;
  source: string;
  source_url: string | null;
  version: string;
  author: string | null;
  tags: string[];
  category: string | null;
  compatible_agents: string[];
  download_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateChatSkill {
  name: string;
  description: string | null;
  content: string;
  trigger_type: string | null;
  trigger_keywords: string[] | null;
  enabled: boolean | null;
  source: string | null;
  source_url: string | null;
  version: string | null;
  author: string | null;
  tags: string[] | null;
  category: string | null;
  compatible_agents: string[] | null;
  download_count: number | null;
}

export type UpdateChatSkill = Partial<CreateChatSkill>;

export interface ChatAgentSkillAssignment {
  id: string;
  agent_id: string;
  skill_id: string;
  enabled: boolean;
  created_at: string;
}

export interface AssignSkillToAgent {
  agent_id: string;
  skill_id: string;
  enabled: boolean | null;
}

export interface UpdateAgentSkill {
  enabled: boolean | null;
}

export interface InstalledNativeSkill {
  skill: BackendChatSkill;
  enabled: boolean;
  can_toggle: boolean;
  native_path: string;
  config_path: string | null;
}

export interface UpdateNativeSkillRequest {
  enabled: boolean;
}

// ----- Agent runtime ---------------------------------------------------------

export type BaseCodingAgent =
  | 'CLAUDE_CODE'
  | 'AMP'
  | 'GEMINI'
  | 'CODEX'
  | 'OPENCODE'
  | 'OPEN_TEAMS_CLI'
  | 'CURSOR_AGENT'
  | 'QWEN_CODE'
  | 'COPILOT'
  | 'DROID'
  | 'KIMI_CODE';

export type AvailabilityInfo =
  | { type: 'LOGIN_DETECTED'; last_auth_timestamp: bigint }
  | { type: 'INSTALLATION_FOUND' }
  | { type: 'NOT_FOUND' };

export type AgentRunMode = 'auto' | 'local' | 'disabled';

export type AgentRuntimeModelSource = 'runner' | 'profile_fallback' | 'none';

export interface UpdateAgentRuntimeConfig {
  run_mode: AgentRunMode | null;
  env_json: Record<string, string> | null;
  executor_options: JsonValue | null;
}

export interface AgentRuntimeEnvSummary {
  key: string;
  value: string;
}

export interface AgentRuntimeStatus {
  runner_type: BaseCodingAgent;
  installed: boolean;
  executable: boolean;
  availability: AvailabilityInfo;
  discovered_models: string[];
  model_source: AgentRuntimeModelSource;
  version: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  run_mode: AgentRunMode;
  env_summary: AgentRuntimeEnvSummary[];
  executor_options: JsonValue;
}

export interface AgentRuntimeListResponse {
  runners: AgentRuntimeStatus[];
}

export interface AgentRuntimeRefreshError {
  runner_type: BaseCodingAgent;
  message: string;
  preserved_models: string[];
}

export interface AgentRuntimeRefreshResponse {
  runners: AgentRuntimeStatus[];
  errors: AgentRuntimeRefreshError[];
}

export interface AgentRuntimeDiagnostics {
  runner_type: BaseCodingAgent;
  installed: boolean;
  executable: boolean;
  availability: AvailabilityInfo;
  config_path: string;
  install_indicator_path: string | null;
  discovered_models: string[];
  model_source: AgentRuntimeModelSource;
  version: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  run_mode: AgentRunMode;
  env_summary: AgentRuntimeEnvSummary[];
  executor_options: JsonValue;
}

export type ExecutorVariantConfig = Record<
  string,
  Record<string, JsonValue | undefined> | undefined
>;

export type ExecutorConfig = Record<string, ExecutorVariantConfig | undefined>;

export interface ExecutorConfigs {
  executors: Partial<Record<BaseCodingAgent, ExecutorConfig>>;
}

export interface ProfilesContent {
  content: string;
  path: string;
}

// ----- Workflow --------------------------------------------------------------

export type WorkflowCardState =
  | 'preview_ready'
  | 'preview_invalid'
  | 'pending'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'completed'
  | 'failed';

export interface WorkflowCardStep {
  id: string;
  step_key: string;
  title: string;
  step_type: string;
  status: string;
  review_phase: string | null;
  lead_review_required: boolean;
  user_review_required: boolean;
  retry_count: number;
  max_retry: number;
  loop_key: string | null;
  latest_review: unknown | null;
  agent_name: string | null;
  summary_text: string | null;
  content: string | null;
}

export interface WorkflowCardAgent {
  session_agent_id: string;
  workflow_agent_session_id: string | null;
  agent_id: string;
  name: string;
}

export interface WorkflowCardProjection {
  execution_id: string | null;
  plan_id: string;
  revision_id: string;
  title: string;
  goal: string;
  state: WorkflowCardState;
  execution_status: string;
  error_message: string | null;
  completed_step_count: number;
  total_step_count: number;
  result_summary: string | null;
  outputs: string[];
  agents: WorkflowCardAgent[];
  steps: WorkflowCardStep[];
  current_round: number;
  loops: unknown[];
  pending_review: unknown | null;
  pending_reviews: unknown[];
  pending_input: unknown | null;
  iteration_history: unknown[];
  round_graphs: unknown[];
  plan: unknown;
  started_at: string | null;
  completed_at: string | null;
  validation_errors: string | null;
  is_terminal: boolean;
  has_transcripts: boolean | null;
}

export interface WorkflowTranscriptEntry {
  id: string;
  execution_id: string;
  round_id?: string | null;
  workflow_agent_session_id?: string | null;
  step_id?: string | null;
  step_key?: string | null;
  sender_type: string;
  entry_type: string;
  content: string;
  meta_json?: string | null;
  created_at: string;
  agent_name?: string | null;
}

export interface GeneratePlanAndRunResponse {
  execution_id: string;
  workflow_card_message: BackendChatMessage;
}

export interface ExecutePlanReviewOverride {
  stepId: string;
  leadReview: boolean | null;
  userReview: boolean | null;
}

export interface ExecutePlanRequest {
  plan: unknown | null;
  stepReviewOverrides: ExecutePlanReviewOverride[];
}

export interface ExecutePlanResponse {
  execution_id: string;
}

export interface ResumeExecutionResponse {
  status: string;
}

export interface PauseAllResponse {
  status: string;
}

export interface InterruptStepResponse {
  status: string;
}

export interface ResolveActionResponse {
  status: string;
}

export interface UserReviewResponseRequest {
  review_id: string;
  action: string;
  feedback: string | null;
  expected_step_id: string | null;
}

export interface UserReviewResponseResponse {
  execution_id: string;
  transcript_id: string;
  status: string;
}

export interface UserIterationFeedbackDetailRequest {
  what_wrong: string;
  expected: string;
  priority: string;
  additional_notes: string | null;
}

export interface UserIterationFeedbackRequest {
  execution_id: string;
  action: string;
  feedback: UserIterationFeedbackDetailRequest | null;
}

export interface UserIterationFeedbackResponse {
  execution_id: string;
  status: string;
  current_round: number;
}

// ----- CLI Provider / Model / Key Config -------------------------------------

export interface ProviderCredentials {
  api_key: string | null;
  endpoint: string | null;
}

export interface OllamaConfig {
  endpoint: string | null;
}

export interface CustomProviderConfig {
  name: string | null;
  endpoint: string | null;
  api_key: string | null;
}

export interface CustomProviderOptions {
  baseURL: string | null;
  api_key: string | null;
  timeout: number | null;
}

export interface CustomProviderEntry {
  id: string;
  name: string | null;
  npm: string | null;
  options: CustomProviderOptions;
  models: Record<string, unknown> | null;
}

export interface ProviderConfig {
  default: string;
  anthropic: ProviderCredentials | null;
  openai: ProviderCredentials | null;
  google: ProviderCredentials | null;
  openrouter: ProviderCredentials | null;
  minimax: ProviderCredentials | null;
  ollama: OllamaConfig | null;
  custom: CustomProviderConfig | null;
  custom_providers?: Record<string, CustomProviderEntry> | null;
}

export interface ProviderModelConfig {
  default: string | null;
}

export interface ModelConfig {
  default: string;
  anthropic: ProviderModelConfig | null;
  openai: ProviderModelConfig | null;
  google: ProviderModelConfig | null;
}

export interface BehaviorConfig {
  auto_approve: boolean;
  auto_compact: boolean;
}

export interface CliConfig {
  provider: ProviderConfig;
  model: ModelConfig;
  behavior: BehaviorConfig;
}

export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface ValidateProviderRequest {
  api_key: string | null;
  endpoint: string | null;
}

export interface ValidateProviderResponse {
  valid: boolean;
  message: string;
}

export interface CustomProviderProbeRequest {
  id: string;
  npm: string | null;
  options: CustomProviderOptions;
}

export interface CustomProviderProbeResponse {
  ok: boolean;
  models: string[];
  message: string | null;
}

export interface SyncToCliRequest {
  force?: boolean;
}

export interface SyncToCliResponse {
  status: string;
  message: string | null;
}

export interface RestartCliResponse {
  status: string;
  message: string | null;
}

// ----- Filesystem / Workspace ------------------------------------------------

export interface DirectoryEntry {
  name: string;
  path: string;
  is_directory: boolean;
  is_git_repo: boolean;
  last_modified: number | null;
}

export interface DirectoryListResponse {
  entries: DirectoryEntry[];
  current_path: string;
}

export interface SessionWorkspace {
  workspace_path: string;
  agent_ids: string[];
  agent_names: string[];
  is_git_repo: boolean;
}

export interface SessionWorkspacesResponse {
  workspaces: SessionWorkspace[];
}

export interface WorkspaceChangedFile {
  path: string;
  additions: number;
  deletions: number;
  unified_diff: string | null;
  has_diff: boolean;
}

export interface WorkspacePathEntry {
  path: string;
}

export interface WorkspaceChanges {
  modified: WorkspaceChangedFile[];
  added: WorkspaceChangedFile[];
  deleted: WorkspacePathEntry[];
  untracked: WorkspacePathEntry[];
}

export interface WorkspaceChangesResponse {
  workspace_path: string;
  is_git_repo: boolean;
  changes: WorkspaceChanges | null;
  error: string | null;
}

export interface OpenInExplorerResponse {
  ok: boolean;
  error?: string | null;
}

// ----- System info / Config --------------------------------------------------

export type ThemeMode = 'LIGHT' | 'DARK' | 'SYSTEM';
export type UiLanguage =
  | 'BROWSER'
  | 'EN'
  | 'FR'
  | 'JA'
  | 'ES'
  | 'KO'
  | 'ZH_HANS'
  | 'ZH_HANT';

// Backend Config is large and contains many nested presets. The new frontend
// only round-trips it via GET /api/info and PUT /api/config; treat the bulk as
// opaque while exposing the few fields the UI inspects directly.
export interface Config {
  config_version: string;
  theme: ThemeMode;
  language: UiLanguage;
  analytics_enabled: boolean;
  workspace_dir: string | null;
  // The remaining backend fields are preserved verbatim for round-trip safety.
  [key: string]: JsonValue | undefined;
}

export interface Environment {
  os_type: string;
  os_version: string;
  os_architecture: string;
  bitness: string;
}

export type LoginStatus =
  | { status: 'loggedout' }
  | {
      status: 'loggedin';
      profile: {
        user_id: string;
        username: string | null;
        email: string;
        providers: Array<{
          provider: string;
          username: string | null;
          display_name: string | null;
          email: string | null;
          avatar_url: string | null;
        }>;
      };
    };

export interface UserSystemInfo {
  config: Config;
  analytics_user_id: string;
  deploy_mode: string;
  login_status: LoginStatus;
  home_directory: string;
  environment: Environment;
  capabilities: Record<string, string[] | undefined>;
  executors: Record<string, unknown>;
}

// =============================================================================
// LOCAL-ONLY UI augmentation types (NOT backed by backend contract)
// -----------------------------------------------------------------------------
// These are explicitly marked as local. Source: backend_contract_audit
// "5.1 后端不存在的字段". Do NOT add backend round-trip code for these.
// =============================================================================

/** LOCAL: aggregate computed in the UI from per-message cost. */
export interface WeeklyStats {
  weeklyCost: number;
  /** MOCK-FALLBACK: no backend metric, callers should supply 0 or local heuristic. */
  weeklySaved: number;
}

/** MOCK-FALLBACK: subscription / early-bird quota is not in the backend. */
export interface EarlyBirdQuota {
  earlyBirdLeft: number;
}

/** LOCAL: routing strategy enum not present in `Config`. */
export type RoutingStrategyId =
  | 'strat-1'
  | 'strat-2'
  | 'strat-3'
  | 'strat-4'
  | 'strat-5';


// =============================================================================
// BUILD STATISTICS types
// -----------------------------------------------------------------------------
// Data interfaces for the Build Statistics page. These mirror the backend API
// response shapes for daily token consumption, session tokens, activity counts,
// and model pricing management.
// =============================================================================

export interface DailyTokenDataPoint {
  date: string; // YYYY-MM-DD
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
  estimated_cost: number;
}

export interface DailyTokensResponse {
  days: DailyTokenDataPoint[];
}

export interface SessionCostEntry {
  session_id: string;
  title: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_output_tokens: number;
  estimated_cost: number;
}

export interface SessionTokensResponse {
  sessions: SessionCostEntry[];
}

export interface ActivityResponse {
  days: ActivityDataPoint[];
}

export interface ActivityDataPoint {
  date: string;
  bugs_fixed: number;
  features_delivered: number;
}

export interface ModelPriceRow {
  model_id: string;
  model_name: string;
  input_price_per_1m: number;
  output_price_per_1m: number;
  cache_read_price_per_1m?: number | null;
  custom_input_price: number | null;
  custom_output_price: number | null;
  custom_cache_read_price?: number | null;
  price_source: string;
  price_updated_at: string;
}

export interface ModelPricingResponse {
  models: ModelUsageRow[];
}

export interface ModelUsageRow {
  model_id: string;
  model_name: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_output_tokens: number;
  input_price_per_1m: number;
  output_price_per_1m: number;
  cache_read_price_per_1m?: number | null;
  estimated_cost: number;
  price_source: string;
  cache_price_source?: string;
}

export interface UpdateModelPricingRequest {
  custom_input_price?: number | null;
  custom_output_price?: number | null;
  custom_cache_read_price?: number | null;
}
