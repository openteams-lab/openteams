// =============================================================================
// UI types
// -----------------------------------------------------------------------------
// These types are consumed by existing React components. They are intentionally
// flat / UI-shaped. Backend-derived shapes live in the BACKEND TYPES section
// below; mapping is performed in `src/lib/mappers.ts`.
// =============================================================================

import type { MemberQueueSnapshot } from '../../shared/types';

export type {
  ChatMemberQueueResponse,
  ChatQueueListResponse,
  ContinueQueuedMessageResponse,
  DeleteQueuedMessageResponse,
  MemberQueueSnapshot,
  MemberQueueStatus,
  QueuedMessage,
  QueuedMessageListItem,
  QueuedMessageStatus,
} from '../../shared/types';

export type MemberQueuesBySessionAgentId = Record<string, MemberQueueSnapshot>;

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
  hasRunningAgent?: boolean;
  hasRunningWorkflow?: boolean;
  hasUnreadAgentCompletion?: boolean;
}

export interface ArtifactItem {
  /** Trimmed file path (or artifact content) used for display + matching. */
  path: string;
  /** Original, untrimmed artifact content. */
  raw: string;
}

export interface Message {
  id: string;
  sessionId?: string;
  avatar: string;
  sender: string;
  time: string;
  createdAt?: string;
  text: string;
  cost?: string;
  model?: string;
  clientMessageId?: string;
  mentions?: string[];
  quotedMessage?: QuotedMessageReference;
  referenceMessageId?: string;
  attachments?: ChatAttachment[];
  isUser?: boolean;
  isThinking?: boolean;
  isAgentRunning?: boolean;
  runId?: string;
  sessionAgentId?: string;
  sourceMessageId?: string;
  i18nKey?: string;
  i18nParams?: Record<string, string | number>;
  activityLines?: ChatRunActivityLine[];
  activityLoadState?: ActivityLoadState;
  workflowCard?: WorkflowCardMessageReference;
  /**
   * Derived display text for an agent reply parsed from the structured
   * `{send|artifact|conclusion|record}` wire format. Undefined for user
   * messages and plain (non-structured) agent replies, in which case
   * renderers fall back to `text`.
   */
  replyText?: string;
  /** Artifacts extracted from a structured agent reply. */
  artifacts?: ArtifactItem[];
  /** Conclusion extracted from a structured agent reply. */
  conclusion?: string | null;
}

export type WorkflowCardMessageType =
  | 'workflow_execution'
  | 'workflow_plan'
  | 'workflow_plan_generation';

export interface WorkflowCardMessageReference {
  messageId: string;
  cardType: WorkflowCardMessageType;
  planGeneration?: WorkflowPlanGenerationMeta;
}

export interface WorkflowPlanGenerationMeta {
  status?: string;
  plan_goal?: string;
  retryable?: boolean;
  retry_endpoint?: string;
  error_message?: string | null;
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
  | 'issue'
  | 'team'
  | 'team-templates'
  | 'tasks'
  | 'routing'
  | 'github'
  | 'providers'
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
// PROJECT GITHUB INTEGRATION types
// -----------------------------------------------------------------------------
// Frontend-facing shapes for the local OpenTeams GitHub integration API. These
// mirror the planned Rust-generated contract while backend implementation lands
// in parallel; calls still go only through local `/api/*` endpoints.
// =============================================================================

export type RepoIntegrationSyncStatus =
  | 'connected'
  | 'disconnected'
  | 'error';

export type RepoIntegrationRole = 'primary' | 'auxiliary';

export interface IssueIntegrationProvider {
  id: 'github' | 'linear' | 'jira' | string;
  name: string;
  supported: boolean;
  status: 'auth_required' | 'authorized' | 'linked' | 'unsupported' | string;
}

export type ProjectWorkItemType =
  | 'feature'
  | 'bug'
  | 'task'
  | 'deploy'
  | 'test'
  | 'doc'
  | 'refactor';

export type ProjectWorkItemStatus =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'ready_to_merge'
  | 'merging'
  | 'done'
  | 'cancelled'
  | 'duplicate';

export type ProjectWorkItemPriority = 'low' | 'medium' | 'high' | 'urgent';

export type ProjectWorkItemSource =
  | 'manual'
  | 'github_issue'
  | 'workflow'
  | 'session';

export type ProjectExternalType =
  | 'github_issue'
  | 'github_pr'
  | 'github_commit'
  | 'github_deployment'
  | 'github_release';

export type ProjectExecutionLinkType =
  | 'created_from'
  | 'discussed_in'
  | 'implemented_by'
  | 'reviewed_by'
  | 'delivered_by';

export type ProjectDeliveryEventType =
  | 'pr_opened'
  | 'pr_merged'
  | 'deployment'
  | 'release'
  | 'test_passed'
  | 'test_failed'
  | 'commit_created';

export type GitHubOperationSource = 'user_ui' | 'agent';
export type GitHubOperationResult =
  | 'pending_approval'
  | 'approved'
  | 'denied'
  | 'success'
  | 'failed';
export type GitHubTargetType = 'issue' | 'pull_request' | 'repo';

export interface GitHubErrorData {
  code:
    | 'github_auth_required'
    | 'github_rate_limited'
    | 'github_repo_disconnected'
    | 'github_write_failed'
    | 'local_git_push_failed'
    | 'github_stale_cache'
    | string;
  message: string;
  retry_after?: string | null;
  last_synced_at?: string | null;
  stale?: boolean | null;
}

export interface GitHubAccount {
  login: string;
  id: number | string;
  avatar_url: string | null;
  html_url: string | null;
  scopes: string[];
  connected_at: string;
}

export interface GitHubDeviceFlowStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string | null;
  expires_in: number;
  interval: number;
}

export interface GitHubDeviceFlowPollResponse {
  status: 'pending' | 'slow_down' | 'authorized' | 'expired' | 'denied' | 'error';
  account: GitHubAccount | null;
  error: GitHubErrorData | string | null;
}

export interface GitHubOAuthStartResponse {
  flow_id: string;
  authorization_url: string;
  expires_at: string;
}

export interface GitHubOAuthStatusResponse {
  status: 'pending' | 'authorized' | 'expired' | 'denied' | 'error';
  account: GitHubAccount | null;
  error: string | null;
}

export interface GitHubRepositorySummary {
  id: number | string;
  node_id: string;
  full_name: string;
  owner: string;
  name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  updated_at: string;
}

export interface ProjectRepoIntegration {
  id: string;
  repo_id: string;
  provider: string;
  owner: string | null;
  name: string | null;
  remote_url: string | null;
  default_branch: string | null;
  external_id: string | null;
  installation_id: string | null;
  github_account_id: string | null;
  repo_grant_json: JsonValue | null;
  role?: RepoIntegrationRole | null;
  sync_status: RepoIntegrationSyncStatus | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectIssueIntegrationsResponse {
  providers: IssueIntegrationProvider[];
  github_account: GitHubAccount | null;
  github_repositories: GitHubRepositorySummary[];
  linked_repositories: ProjectRepoIntegration[];
  primary_repository: ProjectRepoIntegration | null;
}

export interface ProjectWorkItem {
  id: string;
  project_id: string;
  type: ProjectWorkItemType;
  status: ProjectWorkItemStatus;
  title: string;
  description: string | null;
  labels_json?: string | null;
  priority: ProjectWorkItemPriority;
  source: ProjectWorkItemSource;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectWorkItemComment {
  id: string;
  project_work_item_id: string;
  body: string;
  author: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectWorkItemExternalLink {
  id: string;
  project_work_item_id: string;
  provider: string;
  repo_id: string | null;
  external_type: ProjectExternalType;
  external_id: string;
  number: number | null;
  url: string | null;
  state: string | null;
  metadata_json: JsonValue | null;
  last_synced_at: string | null;
  stale: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectWorkItemExecutionLink {
  id: string;
  project_work_item_id: string;
  session_id: string | null;
  workflow_execution_id: string | null;
  workflow_step_id: string | null;
  run_id: string | null;
  link_type: ProjectExecutionLinkType;
  created_at: string;
}

export interface ProjectDeliveryRecord {
  id: string;
  project_work_item_id: string | null;
  repo_id: string | null;
  external_link_id: string | null;
  event_type: ProjectDeliveryEventType;
  external_id: string | null;
  url: string | null;
  actor: string | null;
  source_session_id: string | null;
  source_workflow_execution_id: string | null;
  metadata_json: JsonValue | null;
  occurred_at: string;
  created_at: string;
}

export interface GitHubOperationAudit {
  id: string;
  actor: string | null;
  operation_source: GitHubOperationSource;
  session_id: string | null;
  workflow_execution_id: string | null;
  repo_id: string | null;
  target_type: GitHubTargetType;
  target_id: string | null;
  action: string;
  result: GitHubOperationResult;
  error: string | null;
  created_at: string;
}

export interface GitHubIssueSummary {
  number: number;
  node_id: string | null;
  title: string;
  state: 'open' | 'closed' | string;
  url: string | null;
  author: string | null;
  author_avatar_url?: string | null;
  labels: string[];
  assignees: string[];
  created_at?: string | null;
  updated_at: string | null;
  last_synced_at: string | null;
  stale: boolean;
  work_item_id: string | null;
  repo_integration_id?: string | null;
}

export interface GitHubIssueComment {
  id: string | number;
  author: string | null;
  author_avatar_url?: string | null;
  body: string;
  created_at: string;
  url: string | null;
}

export interface GitHubIssueDetail {
  summary: GitHubIssueSummary;
  body: string | null;
  comments: GitHubIssueComment[];
}

export interface GitHubCommitSummary {
  sha: string;
  message: string;
  author: string | null;
  authored_at: string | null;
  url: string | null;
}

export interface GitHubDiffSummary {
  files_changed: number;
  additions: number;
  deletions: number;
}

export interface GitHubPrPreview {
  repo_id: string;
  base_branch: string;
  head_branch: string;
  head_pushed: boolean;
  commits: GitHubCommitSummary[];
  diff_summary: GitHubDiffSummary;
  diff_text: string;
  requires_push: boolean;
}

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  state: string;
  url: string;
  base_branch: string;
  head_branch: string;
}

export type GitHubPendingPrStatus =
  | 'push_failed'
  | 'pushed'
  | 'create_failed'
  | 'local_link_failed'
  | 'completed';

export interface GitHubPendingPrCreation {
  id: string;
  project_id: string;
  repo_integration_id: string;
  work_item_id: string | null;
  audit_id: string | null;
  base_branch: string;
  head_branch: string;
  title: string;
  body: string | null;
  status: GitHubPendingPrStatus;
  pull_request_number: number | string | null;
  pull_request_url: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface GitHubCreatePrResponse {
  pull_request: GitHubPullRequestSummary | null;
  delivery_record: ProjectDeliveryRecord | null;
  external_link: ProjectWorkItemExternalLink | null;
  audit_id: string;
  result: GitHubOperationResult;
  pending_pr: GitHubPendingPrCreation | null;
}

export interface ProjectWorkItemDetailResponse {
  work_item: ProjectWorkItem;
  external_links: ProjectWorkItemExternalLink[];
  comments: ProjectWorkItemComment[];
  execution_links: ProjectWorkItemExecutionLink[];
  delivery_records: ProjectDeliveryRecord[];
  github_audits?: GitHubOperationAudit[];
  audits?: GitHubOperationAudit[];
  github_issue_detail?: GitHubIssueDetail | null;
}

export interface ProjectDeliveryStatsSummary {
  period_start: string;
  period_end: string;
  pr_opened_count: number;
  pr_merged_count: number;
  deployment_count: number;
  release_count: number;
  test_passed_count: number;
  test_failed_count: number;
  commit_created_count: number;
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

// ----- Project source control -----------------------------------------------

export type SourceControlFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'untracked'
  | 'renamed'
  | 'copied'
  | 'type_changed';

export type SourceControlDiffArea = 'changes' | 'staged';

export type SourceControlOperationInProgress =
  | 'merge'
  | 'rebase'
  | 'cherry_pick'
  | 'revert';

export type SourceControlPlainReason = 'not_git_repo';

export type SourceControlOperationFailureCode =
  | 'path_outside_workspace'
  | 'not_session_scoped'
  | 'shared_file'
  | 'external_staged_conflict'
  | 'stale_status'
  | 'git_operation_blocked'
  | 'file_missing'
  | 'unknown';

export type SourceControlCommitErrorCode =
  | 'empty_message'
  | 'empty_staged'
  | 'external_staged_conflict'
  | 'shared_file_requires_confirmation'
  | 'detached_head'
  | 'git_operation_blocked'
  | 'stale_status'
  | 'path_outside_workspace'
  | 'not_session_scoped'
  | 'unknown';

export interface SourceControlFile {
  path: string;
  old_path: string | null;
  status: SourceControlFileStatus;
  additions: number;
  deletions: number;
  has_diff: boolean;
  is_binary: boolean;
  is_too_large: boolean;
  shared: boolean;
  shared_session_ids: string[];
  blocked_reason: string | null;
}

export type SessionSourceControlStatus =
  | {
      mode: 'git';
      workspace_id: string | null;
      workspace_path: string;
      branch: string;
      head_sha: string | null;
      changes: SourceControlFile[];
      staged_changes: SourceControlFile[];
      external_staged_paths: string[];
      operation_in_progress: SourceControlOperationInProgress | null;
      detached_head: boolean;
      blocked_reason: string | null;
    }
  | {
      mode: 'plain';
      workspace_id: string | null;
      workspace_path: string;
      files: SourceControlFile[];
      reason: SourceControlPlainReason;
    };

export interface SourceControlDiffRequest {
  session_id: string;
  workspace_id?: string | null;
  path: string;
  area: SourceControlDiffArea;
}

export interface SourceControlDiffResponse {
  path: string;
  old_path: string | null;
  area: SourceControlDiffArea;
  base_label: string;
  compare_label: string;
  unified_diff: string | null;
  additions: number;
  deletions: number;
  is_binary: boolean;
  is_too_large: boolean;
  content_omitted: boolean;
  message: string | null;
}

export interface SourceControlStageRequest {
  session_id: string;
  workspace_id?: string | null;
  paths: string[];
  force_shared?: boolean | null;
}

export interface SourceControlUnstageRequest {
  session_id: string;
  workspace_id?: string | null;
  paths: string[];
}

export interface SourceControlDiscardRequest {
  session_id: string;
  workspace_id?: string | null;
  paths: string[];
  force_shared?: boolean | null;
  expected_head_sha?: string | null;
}

export interface SourceControlOperationFailure {
  path: string;
  code: SourceControlOperationFailureCode;
  message: string;
}

export interface SourceControlOperationResponse {
  ok: boolean;
  succeeded: string[];
  failed: SourceControlOperationFailure[];
  status?: SessionSourceControlStatus | null;
  head_sha?: string | null;
  operation_id?: string | null;
}

export interface SourceControlCommitRequest {
  session_id: string;
  workspace_id?: string | null;
  message: string;
  expected_staged_paths: string[];
  force_shared?: boolean | null;
  work_item_ids?: string[];
  expected_head_sha?: string | null;
}

export interface SourceControlCommitResponse {
  commit_sha: string;
  short_sha: string;
  branch: string;
  message: string;
  committed_paths: string[];
  additions: number;
  deletions: number;
  status: SessionSourceControlStatus;
}

export interface SourceControlCommitError {
  code: SourceControlCommitErrorCode;
  message: string;
  conflicting_paths?: string[];
  status?: SessionSourceControlStatus;
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

export interface TeamProtocolConfig {
  content: string;
  enabled: boolean;
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
  owner_project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateChatAgent {
  name: string;
  runner_type: string;
  system_prompt: string | null;
  tools_enabled: JsonValue | null;
  model_name: string | null;
  owner_project_id?: string | null;
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

export type AgentRuntimeReasoningCapability =
  | { kind: 'effort'; options: string[] }
  | { kind: 'variant'; options: string[] };

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

export interface McpConfig {
  servers: Record<string, JsonValue | undefined>;
  servers_path: string[];
  template: JsonValue;
  preconfigured: JsonValue;
  is_toml_config: boolean;
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

export interface WorkflowSessionStatusResponse {
  has_running_workflow: boolean;
}

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
  latest_review: WorkflowCardReview | null;
  agent_name: string | null;
  summary_text: string | null;
  content: string | null;
}

export interface WorkflowCardReview {
  reviewer_type: string;
  verdict: string;
  feedback: string;
  review_round: number;
  created_at: string;
}

export interface WorkflowCardAgent {
  session_agent_id: string;
  workflow_agent_session_id: string | null;
  agent_id: string;
  name: string;
}

export interface WorkflowCardLoop {
  id: string;
  loop_key: string;
  status: string;
  retry_count: number;
  max_retry: number;
  user_review_required: boolean;
  rejection_reason: string | null;
  member_step_ids: string[];
  review_step_id: string;
}

export interface WorkflowPendingReviewField {
  key: string;
  label?: string | null;
  field_type?: string | null;
  placeholder?: string | null;
  required?: boolean | null;
}

export interface WorkflowPendingReviewPromptTemplate {
  message?: string | null;
  fields: WorkflowPendingReviewField[];
}

export interface WorkflowPendingReviewData {
  review_id: string;
  review_type: string;
  target_id: string;
  target_title: string;
  prompt_template: WorkflowPendingReviewPromptTemplate;
  context_summary?: string | null;
}

export interface WorkflowPendingInputData {
  input_id: string;
  step_id: string;
  step_key: string;
  target_title: string;
  prompt?: string | null;
  description?: string | null;
  placeholder?: string | null;
}

export interface WorkflowIterationSummaryData {
  round_index: number;
  status: string;
  user_feedback: string | null;
  result_summary: string | null;
  created_at?: string | null;
}

export interface WorkflowCardPlanNode {
  id: string;
  position?: { x: number; y: number };
  data: {
    title?: string | null;
    description?: string | null;
    stepType?: string | null;
    step_type?: string | null;
    agentId?: string | null;
    agent_id?: string | null;
    agentName?: string | null;
    agent_name?: string | null;
    instructions?: string | null;
    status?: string | null;
    reviewScope?: string[] | null;
    loopKey?: string | null;
    loop_key?: string | null;
    [key: string]: JsonValue | undefined;
  };
}

export interface WorkflowCardPlanEdge {
  id: string;
  source: string;
  target: string;
  label?: string | null;
}

export interface WorkflowCardPlanLoop {
  loopKey?: string | null;
  loop_key?: string | null;
  memberSteps?: string[];
  member_step_keys?: string[];
  reviewStep?: string | null;
  review_step_key?: string | null;
  reviewScope?: string[] | null;
  review_scope_step_keys?: string[] | null;
  maxRetry?: number | null;
  max_retry?: number | null;
  userReviewRequired?: boolean | null;
  user_review_required?: boolean | null;
}

export interface WorkflowCardPlanData {
  nodes: WorkflowCardPlanNode[];
  edges: WorkflowCardPlanEdge[];
  viewport?: { x: number; y: number; zoom: number } | null;
  loops?: WorkflowCardPlanLoop[] | null;
}

export interface WorkflowRoundGraphData {
  round_id: string;
  round_index: number;
  revision_id: string;
  status: string;
  plan: WorkflowCardPlanData;
  steps: WorkflowCardStep[];
  loops: WorkflowCardLoop[];
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
  loops: WorkflowCardLoop[];
  pending_review: WorkflowPendingReviewData | null;
  pending_reviews: WorkflowPendingReviewData[];
  pending_input: WorkflowPendingInputData | null;
  iteration_history: WorkflowIterationSummaryData[];
  round_graphs: WorkflowRoundGraphData[];
  plan: WorkflowCardPlanData;
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

export interface RetryWorkflowPlanGenerationResponse {
  status: string;
  message_id: string;
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
  untracked: WorkspaceChangedFile[];
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

export interface WorkflowStepTokenEntry {
  session_id: string;
  session_title: string;
  workflow_execution_id: string;
  workflow_step_id: string;
  workflow_step_key: string;
  workflow_step_title: string;
  agent_name?: string | null;
  latest_run_id?: string | null;
  run_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
  estimated_cost: number;
  model_id?: string | null;
  model_name?: string | null;
}

export interface WorkflowStepTokensResponse {
  steps: WorkflowStepTokenEntry[];
}

export interface WorkflowStepTokenUsageResponse {
  usage: WorkflowStepTokenEntry | null;
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
