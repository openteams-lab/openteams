// =============================================================================
// Backend -> UI mappers
// -----------------------------------------------------------------------------
// Pure, side-effect-free functions that translate backend DTOs into the flat
// UI types in `src/types.ts`. Components and the WorkspaceContext should call
// these instead of touching backend shapes directly.
//
// Fields with no backend equivalent (per backend_contract_audit §5.1) are
// either filled with safe defaults or expected to be supplied by the caller.
// They are marked `LOCAL` / `MOCK-FALLBACK` here for traceability.
// =============================================================================

import type {
  BackendChatAgent,
  BackendChatMessage,
  BackendChatSession,
  BackendChatSessionAgent,
  ChatAttachment,
  ChatSessionAgentState,
  JsonValue,
  Member,
  Message,
  Provider,
  ProviderInfo,
  Session,
  CliConfig,
  WorkflowCardMessageType,
  WorkflowPlanGenerationMeta,
  WorkflowSidebarState,
} from '@/types';
import type { ProjectMemberWithRuntime } from '../../../shared/types';
import { parseStructuredAgentReply } from './parseStructuredReply';

const AGENT_EMPTY_OUTPUT_FALLBACK = 'Agent运行失败';

// -----------------------------------------------------------------------------
// Avatar / monogram derivation
// -----------------------------------------------------------------------------

/** Two-letter, uppercase monogram from an arbitrary display string. */
export const monogramFromName = (name: string | null | undefined): string => {
  if (!name) return '??';
  const cleaned = name.replace(/^@/, '').trim();
  if (cleaned.length === 0) return '??';
  const parts = cleaned.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return cleaned.substring(0, 2).toUpperCase();
};

// -----------------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------------

const SESSION_ICON_DEFAULT = 'message-square';

/**
 * `Session.icon` and `Session.active` have no backend counterpart.
 * - `icon` defaults to `'message-square'`; UI can post-process by title keyword.
 * - `active` is derived by the caller using the current `activeSessionId`.
 * - activity indicators are derived by callers that already loaded runtime state.
 */
export const mapSession = (
  backend: BackendChatSession,
  opts?: {
    activeSessionId?: string | null;
    iconOverride?: string;
    hasRunningAgent?: boolean;
    hasRunningWorkflow?: boolean;
    workflowSidebarState?: WorkflowSidebarState;
    hasUnreadAgentCompletion?: boolean;
    hasPendingWorkflowInput?: boolean;
    pendingWorkflowInputId?: string | null;
    hasPendingWorkflowReview?: boolean;
    pendingWorkflowReviewId?: string | null;
    hasWorkflowError?: boolean;
  },
): Session => ({
  id: backend.id,
  title: backend.title ?? 'Untitled session',
  icon: opts?.iconOverride ?? SESSION_ICON_DEFAULT,
  active: opts?.activeSessionId === backend.id,
  hasRunningAgent: opts?.hasRunningAgent,
  hasRunningWorkflow: opts?.hasRunningWorkflow,
  workflowSidebarState: opts?.workflowSidebarState,
  hasUnreadAgentCompletion: opts?.hasUnreadAgentCompletion,
  hasPendingWorkflowInput: opts?.hasPendingWorkflowInput,
  pendingWorkflowInputId: opts?.pendingWorkflowInputId ?? null,
  hasPendingWorkflowReview: opts?.hasPendingWorkflowReview,
  pendingWorkflowReviewId: opts?.pendingWorkflowReviewId ?? null,
  hasWorkflowError: opts?.hasWorkflowError,
  pinnedAt: backend.pinned_at,
  worktreeMode: backend.worktree_mode,
});

export const mapSessions = (
  backends: BackendChatSession[],
  activeSessionId?: string | null,
): Session[] => backends.map((s) => mapSession(s, { activeSessionId }));

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

const formatRelativeTime = (iso: string, now: Date = new Date()): string => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaSec = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (deltaSec < 5) return 'just now';
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
};

const jsonObject = (
  value: JsonValue | undefined,
): Record<string, JsonValue> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value;
};

const runIdFromMeta = (meta: JsonValue | undefined): string | undefined => {
  const obj = jsonObject(meta);
  const runId = obj?.run_id;
  return typeof runId === 'string' ? runId : undefined;
};

const workflowCardTypeFromMeta = (
  meta: JsonValue | undefined,
): WorkflowCardMessageType | undefined => {
  const obj = jsonObject(meta);
  const cardType = obj?.card_type;
  return cardType === 'workflow_execution' ||
    cardType === 'workflow_plan' ||
    cardType === 'workflow_plan_generation'
    ? cardType
    : undefined;
};

const workflowPlanGenerationFromMeta = (
  meta: JsonValue | undefined,
): WorkflowPlanGenerationMeta | undefined => {
  const obj = jsonObject(meta);
  if (obj?.card_type !== 'workflow_plan_generation') return undefined;
  const raw = jsonObject(obj.workflow_plan_generation);
  if (!raw) return undefined;
  return {
    status: typeof raw.status === 'string' ? raw.status : undefined,
    plan_goal:
      typeof raw.plan_goal === 'string' ? raw.plan_goal : undefined,
    retryable:
      typeof raw.retryable === 'boolean' ? raw.retryable : undefined,
    retry_endpoint:
      typeof raw.retry_endpoint === 'string' ? raw.retry_endpoint : undefined,
    error_message:
      typeof raw.error_message === 'string' ? raw.error_message : null,
  };
};

const sessionAgentIdFromMeta = (
  meta: JsonValue | undefined,
): string | undefined => {
  const obj = jsonObject(meta);
  const sessionAgentId = obj?.session_agent_id;
  return typeof sessionAgentId === 'string' ? sessionAgentId : undefined;
};

const sourceMessageIdFromMeta = (
  meta: JsonValue | undefined,
): string | undefined => {
  const obj = jsonObject(meta);
  const sourceMessageId = obj?.source_message_id;
  return typeof sourceMessageId === 'string' ? sourceMessageId : undefined;
};

const referenceMessageIdFromMeta = (
  meta: JsonValue | undefined,
): string | undefined => {
  const obj = jsonObject(meta);
  const reference = jsonObject(obj?.reference);
  const messageId = reference?.message_id ?? obj?.reference_message_id;
  return typeof messageId === 'string' ? messageId : undefined;
};

const clientMessageIdFromMeta = (
  meta: JsonValue | undefined,
): string | undefined => {
  const obj = jsonObject(meta);
  const clientMessageId = obj?.client_message_id;
  return typeof clientMessageId === 'string' ? clientMessageId : undefined;
};

const nonEmptyString = (value: JsonValue | undefined): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const messageModelFromMeta = (meta: JsonValue | undefined): string | undefined => {
  const obj = jsonObject(meta);
  const tokenUsage = jsonObject(obj?.token_usage);
  return (
    nonEmptyString(obj?.model) ??
    nonEmptyString(obj?.model_name) ??
    nonEmptyString(obj?.run_model) ??
    nonEmptyString(tokenUsage?.runtime_model_id) ??
    nonEmptyString(tokenUsage?.model_id) ??
    nonEmptyString(tokenUsage?.model)
  );
};

const i18nFromMeta = (
  meta: JsonValue | undefined,
): { key: string; params?: Record<string, string | number> } | undefined => {
  const obj = jsonObject(meta);
  const rawI18n = jsonObject(obj?.i18n);
  const key = rawI18n?.key;
  if (typeof key !== 'string' || !key.trim()) return undefined;

  const rawParams = jsonObject(rawI18n?.params);
  const params: Record<string, string | number> = {};
  if (rawParams) {
    for (const [paramKey, paramValue] of Object.entries(rawParams)) {
      if (typeof paramValue === 'string' || typeof paramValue === 'number') {
        params[paramKey] = paramValue;
      }
    }
  }

  return {
    key,
    ...(Object.keys(params).length > 0 ? { params } : {}),
  };
};

const errorContentFromMeta = (meta: JsonValue | undefined): string | null => {
  const obj = jsonObject(meta);
  const error = jsonObject(obj?.error);
  const content = error?.content;
  return typeof content === 'string' && content.trim() ? content : null;
};

const attachmentsFromMeta = (
  meta: JsonValue | undefined,
): ChatAttachment[] | undefined => {
  const obj = jsonObject(meta);
  const attachments = obj?.attachments;
  if (!Array.isArray(attachments)) return undefined;

  const normalized: ChatAttachment[] = [];
  for (const attachment of attachments) {
    if (
      !attachment ||
      typeof attachment !== 'object' ||
      Array.isArray(attachment)
    ) {
      continue;
    }

    const raw = attachment as Record<string, JsonValue>;
    const id = raw.id;
    const name = raw.name;
    if (typeof id !== 'string' || typeof name !== 'string') continue;

    normalized.push({
      id,
      name,
      mime_type: typeof raw.mime_type === 'string' ? raw.mime_type : null,
      size_bytes:
        typeof raw.size_bytes === 'number' ? raw.size_bytes : undefined,
      kind: typeof raw.kind === 'string' ? raw.kind : undefined,
      relative_path:
        typeof raw.relative_path === 'string' ? raw.relative_path : undefined,
    });
  }

  return normalized.length > 0 ? normalized : undefined;
};

interface MapMessageOptions {
  /** Lookup table of agent_id -> agent name (for sender label/avatar). */
  agentNamesById?: Record<string, string>;
  /** Lookup table of agent_id -> model name (for `model` display). */
  agentModelsById?: Record<string, string | null>;
  /** Reference time for relative-time formatting. */
  now?: Date;
}

/**
 * Backend messages do not carry per-message cost; `cost` is left undefined.
 * Callers that compute live cost client-side should set it themselves.
 */
export const mapMessage = (
  backend: BackendChatMessage,
  opts: MapMessageOptions = {},
): Message => {
  const isUser = backend.sender_type === 'user';
  let sender: string;
  let avatar: string;
  let model: string | undefined;

  if (isUser) {
    sender = 'You';
    avatar = 'YOU';
  } else if (backend.sender_type === 'system') {
    sender = 'system';
    avatar = 'SY';
  } else {
    const agentName =
      (backend.sender_id && opts.agentNamesById?.[backend.sender_id]) ||
      backend.sender_id ||
      'agent';
    sender = agentName.startsWith('@') ? agentName : `@${agentName}`;
    avatar = monogramFromName(agentName);
    const m = backend.sender_id && opts.agentModelsById?.[backend.sender_id];
    model = messageModelFromMeta(backend.meta) ?? m ?? undefined;
  }

  const workflowCardType = workflowCardTypeFromMeta(backend.meta);
  const i18n = i18nFromMeta(backend.meta);
  const visibleContent =
    !isUser && backend.sender_type === 'agent' && !backend.content.trim()
      ? (errorContentFromMeta(backend.meta) ?? AGENT_EMPTY_OUTPUT_FALLBACK)
      : backend.content;

  // Agent/system replies may use the structured {send|artifact|conclusion|
  // record} wire format. When they do, derive a display body (send text, or
  // the conclusion when there is no send) and the artifact file list. Plain
  // replies (and all user messages) leave these undefined so renderers fall
  // back to the raw `text`.
  const structured =
    !isUser && backend.sender_type !== 'system'
      ? parseStructuredAgentReply(visibleContent)
      : null;
  const replyText =
    structured?.kind === 'structured' ? structured.replyText : undefined;
  const artifacts =
    structured?.kind === 'structured' && structured.artifacts.length > 0
      ? structured.artifacts
      : undefined;
  const conclusion =
    structured?.kind === 'structured' ? structured.conclusion : undefined;

  return {
    id: backend.id,
    sessionId: backend.session_id,
    avatar,
    sender,
    time: formatRelativeTime(backend.created_at, opts.now),
    createdAt: backend.created_at,
    text: visibleContent,
    isUser: isUser || undefined,
    model,
    clientMessageId: clientMessageIdFromMeta(backend.meta),
    mentions: backend.mentions,
    referenceMessageId: referenceMessageIdFromMeta(backend.meta),
    attachments: attachmentsFromMeta(backend.meta),
    runId: runIdFromMeta(backend.meta),
    sessionAgentId: sessionAgentIdFromMeta(backend.meta),
    sourceMessageId: sourceMessageIdFromMeta(backend.meta),
    i18nKey: i18n?.key,
    i18nParams: i18n?.params,
    workflowCard: workflowCardType
      ? {
          messageId: backend.id,
          cardType: workflowCardType,
          planGeneration: workflowPlanGenerationFromMeta(backend.meta),
        }
      : undefined,
    replyText,
    artifacts,
    conclusion,
  };
};

export const mapMessages = (
  backends: BackendChatMessage[],
  opts: MapMessageOptions = {},
): Message[] => backends.map((m) => mapMessage(m, opts));

// -----------------------------------------------------------------------------
// Agents / Session agents -> Member
// -----------------------------------------------------------------------------

const sessionAgentStateToMemberStatus = (
  state: ChatSessionAgentState | undefined,
): Member['status'] => {
  switch (state) {
    case 'running':
    case 'stopping':
      return 'run';
    case 'idle':
      return 'on';
    case 'waitingapproval':
    case 'dead':
    case undefined:
    default:
      return 'i';
  }
};

interface MapMemberOptions {
  /** Backend session-agent record (provides live state). Optional. */
  sessionAgent?: BackendChatSessionAgent;
  projectMemberName?: string | null;
}

const normalizeOptionalString = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const effectiveSessionAgentModelName = (
  agent: BackendChatAgent | undefined,
  sessionAgent?: BackendChatSessionAgent,
): string | null => {
  const config = sessionAgent?.execution_config;
  const hasMemberConfig = Boolean(
    config?.runner_type ||
      normalizeOptionalString(config?.model_name) ||
      normalizeOptionalString(config?.thinking_effort) ||
      normalizeOptionalString(config?.model_variant),
  );
  if (hasMemberConfig) {
    return (
      normalizeOptionalString(config?.model_name) ??
      normalizeOptionalString(config?.runner_type) ??
      normalizeOptionalString(agent?.runner_type)
    );
  }

  return (
    normalizeOptionalString(agent?.model_name) ??
    normalizeOptionalString(agent?.runner_type)
  );
};

export const mapAgentToMember = (
  agent: BackendChatAgent,
  opts: MapMemberOptions = {},
): Member => {
  const displayName =
    normalizeOptionalString(opts.projectMemberName) ?? agent.name;
  const handle = displayName.startsWith('@') ? displayName : `@${displayName}`;
  const status = sessionAgentStateToMemberStatus(opts.sessionAgent?.state);
  const modelName =
    effectiveSessionAgentModelName(agent, opts.sessionAgent) ?? 'agent';
  const stateLabel = opts.sessionAgent?.state ?? 'idle';
  return {
    id: opts.sessionAgent?.id ?? agent.id,
    avatar: monogramFromName(displayName),
    status,
    name: handle,
    roleDetail: `${modelName} · ${stateLabel}`,
    modelName,
  };
};

/**
 * Map session agents joined with their global agent definitions.
 * Session agents whose `agent_id` is missing from `agents` are dropped.
 */
export const mapSessionAgentsToMembers = (
  sessionAgents: BackendChatSessionAgent[],
  agents: BackendChatAgent[],
  projectMembers: ProjectMemberWithRuntime[] = [],
): Member[] => {
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const projectMemberById = new Map(projectMembers.map((m) => [m.id, m]));
  const projectMemberByAgentId = new Map(
    projectMembers
      .filter((m) => m.agent_id)
      .map((m) => [m.agent_id as string, m]),
  );
  const members: Member[] = [];
  for (const sa of sessionAgents) {
    const agent = agentById.get(sa.agent_id);
    if (!agent) continue;
    const projectMember =
      (sa.project_member_id
        ? projectMemberById.get(sa.project_member_id)
        : undefined) ?? projectMemberByAgentId.get(sa.agent_id);
    members.push(
      mapAgentToMember(agent, {
        sessionAgent: sa,
        projectMemberName: projectMember?.member_name,
      }),
    );
  }
  return members;
};

// -----------------------------------------------------------------------------
// Providers
// -----------------------------------------------------------------------------

/**
 * Backend `ProviderInfo` only exposes `id / name / configured`. The UI's
 * `Provider.keyMask` and `Provider.lastUsed` are therefore filled from
 * supplementary sources or fall back to safe placeholders.
 *
 * - `keyMask`: pulled from `CliConfig.provider.<id>.api_key` when the backend
 *   already masked it (contains `***`); otherwise rendered as bullets. The
 *   plaintext key is NEVER produced by this mapper.
 * - `lastUsed`: MOCK-FALLBACK string; no backend protocol exists.
 */
export const mapProvider = (
  info: ProviderInfo,
  cliConfig?: CliConfig | null,
): Provider => {
  const key = providerKeyFromCliConfig(info.id, cliConfig);
  return {
    id: info.id,
    monogram: monogramFromName(info.name),
    name: info.name,
    keyMask: renderKeyMask(key),
    lastUsed: 'Unknown',
    active: info.configured,
  };
};

export const mapProviders = (
  infos: ProviderInfo[],
  cliConfig?: CliConfig | null,
): Provider[] => infos.map((i) => mapProvider(i, cliConfig));

const providerKeyFromCliConfig = (
  providerId: string,
  cliConfig?: CliConfig | null,
): string | null => {
  if (!cliConfig) return null;
  const p = cliConfig.provider;
  // Only built-in providers have well-known credential slots.
  switch (providerId) {
    case 'anthropic':
      return p.anthropic?.api_key ?? null;
    case 'openai':
      return p.openai?.api_key ?? null;
    case 'google':
      return p.google?.api_key ?? null;
    case 'openrouter':
      return p.openrouter?.api_key ?? null;
    case 'minimax':
      return p.minimax?.api_key ?? null;
    default:
      // Custom providers live under `custom_providers[id].options.api_key`.
      return p.custom_providers?.[providerId]?.options?.api_key ?? null;
  }
};

/**
 * Render a key for display.
 * - If the backend already returned a masked key (contains `***`), return as-is.
 * - If a plaintext key sneaks through, mask aggressively in the UI (defense in
 *   depth — the backend should mask on the way out per `mask_key`).
 * - If no key is configured, return a generic bullets placeholder.
 */
export const renderKeyMask = (key: string | null | undefined): string => {
  if (!key) return '••••••••••••';
  if (key.includes('***')) return key;
  if (key.length <= 10) return '••••••••••••';
  return `${key.slice(0, 4)}••••••••••••`;
};
