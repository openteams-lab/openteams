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
} from '@/types';

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
 */
export const mapSession = (
  backend: BackendChatSession,
  opts?: { activeSessionId?: string | null; iconOverride?: string },
): Session => ({
  id: backend.id,
  title: backend.title ?? 'Untitled session',
  icon: opts?.iconOverride ?? SESSION_ICON_DEFAULT,
  active: opts?.activeSessionId === backend.id,
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

const sessionAgentIdFromMeta = (
  meta: JsonValue | undefined,
): string | undefined => {
  const obj = jsonObject(meta);
  const sessionAgentId = obj?.session_agent_id;
  return typeof sessionAgentId === 'string' ? sessionAgentId : undefined;
};

const referenceMessageIdFromMeta = (
  meta: JsonValue | undefined,
): string | undefined => {
  const obj = jsonObject(meta);
  const reference = jsonObject(obj?.reference);
  const messageId = reference?.message_id ?? obj?.reference_message_id;
  return typeof messageId === 'string' ? messageId : undefined;
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
    model = m ?? undefined;
  }

  return {
    id: backend.id,
    avatar,
    sender,
    time: formatRelativeTime(backend.created_at, opts.now),
    text: backend.content,
    isUser: isUser || undefined,
    model,
    referenceMessageId: referenceMessageIdFromMeta(backend.meta),
    attachments: attachmentsFromMeta(backend.meta),
    runId: runIdFromMeta(backend.meta),
    sessionAgentId: sessionAgentIdFromMeta(backend.meta),
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
      return 'run';
    case 'idle':
      return 'on';
    case 'stopping':
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
}

export const mapAgentToMember = (
  agent: BackendChatAgent,
  opts: MapMemberOptions = {},
): Member => {
  const handle = agent.name.startsWith('@') ? agent.name : `@${agent.name}`;
  const status = sessionAgentStateToMemberStatus(opts.sessionAgent?.state);
  const modelName = agent.model_name ?? agent.runner_type;
  const stateLabel = opts.sessionAgent?.state ?? 'idle';
  return {
    id: opts.sessionAgent?.id ?? agent.id,
    avatar: monogramFromName(agent.name),
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
): Member[] => {
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const members: Member[] = [];
  for (const sa of sessionAgents) {
    const agent = agentById.get(sa.agent_id);
    if (!agent) continue;
    members.push(mapAgentToMember(agent, { sessionAgent: sa }));
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
