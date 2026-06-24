import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Theme,
  Locale,
  Member,
  Session,
  Message,
  BackendChatAgent,
  BackendChatMessage,
  BackendChatSession,
  BackendChatSessionAgent,
  ChatRunActivityLine,
  ChatRunRetentionInfo,
  QuotedMessageReference,
  Provider,
  Strategy,
  BackendChatSkill,
  Config,
  MemberQueuesBySessionAgentId,
  MemberQueueSnapshot,
  QueuedMessageStatus,
  UpdateChatSession,
  WorkflowCardProjection,
  WorkspaceChangesResponse,
  JsonValue,
} from '@/types';
import { i18nDict } from '@/i18n';
import { mockFrontendApi } from '@/lib/mockFrontendApi';
import type { WorkspaceBootstrapMock } from '@/mockApiData';
import {
  chatAgentsApi,
  chatMessagesApi,
  chatQueuesApi,
  chatRunsApi,
  chatSessionsApi,
  cliConfigApi,
  projectApi,
  sessionAgentsApi,
  skillsApi,
  systemApi,
  workflowApi,
} from '@/lib/api';
import type {
  CreateProjectRequest,
  Project,
  ProjectMemberWithRuntime,
} from '../../../shared/types';
import {
  effectiveSessionAgentModelName,
  mapMessage,
  mapMessages,
  monogramFromName,
  mapProviders,
  mapSessionAgentsToMembers,
  mapSessions,
} from '@/lib/mappers';
import {
  AsyncResourceState,
  beginLoad,
  fail,
  initialAsync,
  succeed,
} from '@/lib/asyncResource';
import { notifyBuildStatsUsageUpdated } from '@/lib/buildStatsEvents';
import { notifySourceControlRefreshRequested } from '@/lib/sourceControlEvents';

type ListUpdater<T> = T[] | ((prev: T[]) => T[]);

type ChatInputMode = 'free' | 'workflow';
const DEFAULT_CHAT_INPUT_MODE: ChatInputMode = 'free';

const resolveChatInputMode = (
  value: string | null | undefined,
): ChatInputMode => (value === 'workflow' ? 'workflow' : 'free');

const toSessionChatInputMode = (mode: ChatInputMode): string | null =>
  mode === 'workflow' ? 'workflow' : null;

const chatSessionUpdatePayload = (
  patch: Partial<UpdateChatSession>,
): UpdateChatSession => ({
  title: null,
  status: null,
  summary_text: null,
  archive_ref: null,
  last_seen_diff_key: null,
  team_protocol: null,
  team_protocol_enabled: null,
  default_workspace_path: null,
  ...patch,
});

interface SendMessageOptions {
  chatInputMode?: ChatInputMode;
  quotedMessage?: QuotedMessageReference;
  routeMentions?: string[];
  fallbackMention?: string | null;
  workflowLeadAgentId?: string | null;
  persistToBackend?: boolean;
  placeholderMember?: Pick<Member, 'avatar' | 'name' | 'modelName'> | null;
}

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export type WorkspaceToast = {
  message: string;
  tone: ToastTone;
};

export type WorkflowRuntimeLine = {
  id: string;
  executionId: string;
  workflowAgentSessionId: string | null;
  stepId: string;
  stepKey: string;
  agentId: string;
  agentName: string;
  streamType: 'assistant' | 'thinking' | 'error';
  content: string;
  createdAt: string;
};

type FileChangeType = 'created' | 'modified' | 'deleted';

type FileChangeEntry = {
  path: string;
  change_type: FileChangeType;
};

type ChatStreamEvent =
  | {
      type: 'agent_run_started';
      session_id: string;
      session_agent_id: string;
      agent_id: string;
      agent_name: string;
      run_id: string;
      source_message_id: string;
      client_message_id: string | null;
      started_at: string | null;
    }
  | {
      type: 'agent_activity_line';
      line: ChatRunActivityLine;
    }
  | {
      type: 'message_new' | 'message_updated';
      message: BackendChatMessage;
    }
  | {
      type: 'agent_state';
      session_agent_id: string;
      agent_id: string;
      state: string;
      run_id: string | null;
      started_at: string | null;
    }
  | {
      type: 'mention_error';
      session_id: string;
      message_id: string;
      agent_name: string;
      agent_id: string | null;
      reason: string;
    }
  | {
      type: 'workflow_runtime_line';
      line_id: string;
      session_id: string;
      execution_id: string;
      workflow_agent_session_id: string | null;
      step_id: string;
      step_key: string;
      agent_id: string;
      agent_name: string;
      stream_type: 'assistant' | 'thinking' | 'error';
      content: string;
      created_at: string;
    }
  | {
      type: 'workflow_execution_updated';
      session_id: string;
      execution_id: string;
    }
  | {
      type: 'file_change_refresh';
      session_id: string;
      session_agent_id: string;
      agent_id: string;
      run_id: string;
      message_id: string;
      changed_files: FileChangeEntry[];
      ts: string;
    }
  | {
      type: 'queue_updated';
      session_id: string;
      session_agent_id: string;
      queue: MemberQueueSnapshot;
    };

const chatStreamWebSocketUrl = (path: string): string => {
  const base =
    typeof window === 'undefined' ? 'http://localhost' : window.location.href;
  const url = new URL(path, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

const PENDING_AGENT_MESSAGE_PREFIX = 'pending-agent-';
const OPTIMISTIC_USER_MESSAGE_PREFIX = 'msg-user-';
const CHAT_MESSAGE_FONT_SIZE_STORAGE_KEY = 'openteams-chat-message-font-size';
const LEGACY_AGENT_MARKDOWN_FONT_SIZE_STORAGE_KEY =
  'openteams-agent-markdown-font-size';
// Persist the user's last-viewed project/session so a page refresh restores the
// same context (and therefore reconnects the WS stream to the same session)
// instead of always falling back to the first session in the list.
const ACTIVE_SESSION_ID_STORAGE_KEY = 'openteams-active-session-id';
const SELECTED_PROJECT_ID_STORAGE_KEY = 'openteams-selected-project-id';
const RUNNING_AGENT_SESSION_IDS_STORAGE_KEY =
  'openteams-running-agent-session-ids';
const UNREAD_AGENT_COMPLETION_SESSION_IDS_STORAGE_KEY =
  'openteams-unread-agent-completion-session-ids';
const ACKED_WORKFLOW_INPUT_IDS_STORAGE_KEY =
  'openteams-acked-workflow-input-ids';
// WebSocket auto-reconnect backoff bounds (ms).
const CHAT_STREAM_RECONNECT_BASE_DELAY_MS = 1000;
const CHAT_STREAM_RECONNECT_MAX_DELAY_MS = 30000;
const SIDEBAR_RUNNING_INDICATOR_POLL_MS = 3000;
const CHAT_MESSAGE_FONT_SIZE_DEFAULT = 14;
export const CHAT_MESSAGE_FONT_SIZE_OPTIONS = [13, 14, 15, 16] as const;

const readSessionIdSet = (storageKey: string): Set<string> => {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0,
      ),
    );
  } catch {
    return new Set();
  }
};

const writeSessionIdSet = (storageKey: string, sessionIds: Set<string>) => {
  if (typeof localStorage === 'undefined') return;
  try {
    if (sessionIds.size === 0) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify([...sessionIds]));
  } catch {}
};

const normalizeChatMessageFontSize = (value: number | string | null): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return CHAT_MESSAGE_FONT_SIZE_DEFAULT;

  const rounded = Math.round(numeric);
  return (
    CHAT_MESSAGE_FONT_SIZE_OPTIONS.find((option) => option === rounded) ??
    CHAT_MESSAGE_FONT_SIZE_DEFAULT
  );
};

const isPendingAgentPlaceholder = (message: Message): boolean =>
  Boolean(
    message.isAgentRunning &&
    !message.runId &&
    message.id.startsWith(PENDING_AGENT_MESSAGE_PREFIX),
  );

const isActiveAgentState = (state: string | undefined): boolean =>
  state === 'running' || state === 'stopping' || state === 'waitingapproval';

const isRunningSessionAgentState = (state: string | undefined): boolean =>
  state === 'running' || state === 'stopping';

const hasRunningSessionAgent = (
  sessionAgents: BackendChatSessionAgent[],
  ignoredSessionAgentIds?: ReadonlySet<string>,
): boolean =>
  sessionAgents.some((sessionAgent) =>
    !ignoredSessionAgentIds?.has(sessionAgent.id) &&
    isRunningSessionAgentState(sessionAgent.state),
  );

type SessionRunningIndicators = {
  hasRunningAgent: boolean;
  hasRunningWorkflow: boolean;
  pendingWorkflowInputId: string | null;
  pendingWorkflowReviewId: string | null;
};

const loadSessionRunningIndicators = async (
  sessionIds: string[],
  ignoredSessionAgentIds?: ReadonlySet<string>,
): Promise<Map<string, SessionRunningIndicators>> => {
  const entries = await Promise.all(
    sessionIds.map(async (sessionId) => {
      const [sessionAgents, workflowStatus] = await Promise.all([
        sessionAgentsApi.list(sessionId).catch(() => []),
        workflowApi
          .getSessionStatus(sessionId)
          .catch(() => ({
            has_running_workflow: false,
            pending_workflow_input_id: null,
            pending_workflow_review_id: null,
          })),
      ]);
      return [
        sessionId,
        {
          hasRunningAgent: hasRunningSessionAgent(
            sessionAgents,
            ignoredSessionAgentIds,
          ),
          hasRunningWorkflow: workflowStatus.has_running_workflow,
          pendingWorkflowInputId:
            workflowStatus.pending_workflow_input_id ?? null,
          pendingWorkflowReviewId:
            workflowStatus.pending_workflow_review_id ?? null,
        },
      ] as const;
    }),
  );

  return new Map(entries);
};

const isOptimisticUserMessage = (message: Message): boolean =>
  Boolean(
    message.isUser &&
    message.id.startsWith(OPTIMISTIC_USER_MESSAGE_PREFIX),
  );

const isOptimisticPendingAgentPlaceholder = (message: Message): boolean =>
  isPendingAgentPlaceholder(message) &&
  message.id.startsWith(
    `${PENDING_AGENT_MESSAGE_PREFIX}${OPTIMISTIC_USER_MESSAGE_PREFIX}`,
  );

const userMessageClientId = (message: Message): string | undefined =>
  message.clientMessageId ??
  (isOptimisticUserMessage(message) ? message.id : undefined);

const messageIdentityKeys = (message: Message): string[] => {
  const keys = new Set<string>();
  if (message.id) keys.add(message.id);
  const clientMessageId = userMessageClientId(message);
  if (clientMessageId) keys.add(clientMessageId);
  return [...keys];
};

const firstMessageSourceKey = (
  message: Message,
  sourceKeys: Set<string>,
): string | null => {
  if (message.isUser) return null;
  if (message.sourceMessageId && sourceKeys.has(message.sourceMessageId)) {
    return message.sourceMessageId;
  }
  if (message.clientMessageId && sourceKeys.has(message.clientMessageId)) {
    return message.clientMessageId;
  }
  return null;
};

const orderMessagesForConversation = (messages: Message[]): Message[] => {
  const sourceKeys = new Set<string>();
  for (const message of messages) {
    if (!message.isUser) continue;
    for (const key of messageIdentityKeys(message)) {
      sourceKeys.add(key);
    }
  }

  if (sourceKeys.size === 0) return messages;

  const anchoredMessages = new Set<Message>();
  const anchoredBySourceKey = new Map<string, Message[]>();
  for (const message of messages) {
    const sourceKey = firstMessageSourceKey(message, sourceKeys);
    if (!sourceKey) continue;
    anchoredMessages.add(message);
    const anchored = anchoredBySourceKey.get(sourceKey) ?? [];
    anchored.push(message);
    anchoredBySourceKey.set(sourceKey, anchored);
  }

  if (anchoredMessages.size === 0) return messages;

  const emittedAnchored = new Set<Message>();
  const ordered: Message[] = [];
  for (const message of messages) {
    if (anchoredMessages.has(message)) continue;

    ordered.push(message);
    if (!message.isUser) continue;

    for (const key of messageIdentityKeys(message)) {
      const anchored = anchoredBySourceKey.get(key);
      if (!anchored) continue;
      for (const anchoredMessage of anchored) {
        if (emittedAnchored.has(anchoredMessage)) continue;
        ordered.push(anchoredMessage);
        emittedAnchored.add(anchoredMessage);
      }
    }
  }

  for (const message of messages) {
    if (anchoredMessages.has(message) && !emittedAnchored.has(message)) {
      ordered.push(message);
    }
  }

  return ordered;
};

const messageCreatedAtMs = (message: Message): number | null => {
  if (!message.createdAt) return null;
  const value = Date.parse(message.createdAt);
  return Number.isNaN(value) ? null : value;
};

const insertMessageByCreatedAt = (
  messages: Message[],
  message: Message,
): Message[] => {
  const messageAt = messageCreatedAtMs(message);
  if (messageAt === null) return [...messages, message];

  const next = [...messages];
  const index = next.findIndex((candidate) => {
    const candidateAt = messageCreatedAtMs(candidate);
    return candidateAt !== null && candidateAt > messageAt;
  });
  next.splice(index >= 0 ? index : next.length, 0, message);
  return next;
};

const matchesUserMessageIdentity = (
  message: Message,
  messageId: string,
  clientMessageId?: string,
): boolean =>
  Boolean(
    message.isUser &&
      (message.id === messageId ||
        (clientMessageId && userMessageClientId(message) === clientMessageId)),
  );

type PendingPlaceholderMatch = {
  sessionAgentId?: string;
  clientMessageId?: string | null;
  sourceMessageId?: string | null;
};

const normalizePendingPlaceholderMatch = (
  match?: string | PendingPlaceholderMatch,
): PendingPlaceholderMatch => {
  if (typeof match === 'string') return { sessionAgentId: match };
  return match ?? {};
};

const pendingPlaceholderMatches = (
  message: Message,
  match: PendingPlaceholderMatch,
): boolean => {
  if (!isPendingAgentPlaceholder(message)) return false;
  const hasCorrelationId = Boolean(
    match.clientMessageId || match.sourceMessageId,
  );
  if (match.clientMessageId && message.clientMessageId === match.clientMessageId) {
    return true;
  }
  if (match.sourceMessageId && message.sourceMessageId === match.sourceMessageId) {
    return true;
  }
  if (
    !hasCorrelationId &&
    match.sessionAgentId &&
    message.sessionAgentId === match.sessionAgentId
  ) {
    return true;
  }
  return false;
};

const findPendingAgentPlaceholderIndex = (
  messages: Message[],
  match?: string | PendingPlaceholderMatch,
): number => {
  const normalized = normalizePendingPlaceholderMatch(match);
  if (
    normalized.clientMessageId ||
    normalized.sourceMessageId ||
    normalized.sessionAgentId
  ) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (pendingPlaceholderMatches(messages[index], normalized)) {
        return index;
      }
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isPendingAgentPlaceholder(messages[index])) {
      return index;
    }
  }

  return -1;
};

// A session agent runs at most one run at a time. When a new run starts (or
// its first activity line arrives), drop any prior running placeholder for a
// *different* run of the same agent so a stale one 鈥?e.g. left over from a
// just-stopped run that refreshMessages re-hydrated 鈥?cannot coexist with the
// new run and produce duplicate "executing" placeholders.
const evictStaleRunPlaceholders = (
  messages: Message[],
  sessionAgentId: string | undefined,
  runId: string,
): Message[] => {
  if (!sessionAgentId) return messages;
  return messages.filter(
    (message) =>
      !(
        message.isAgentRunning &&
        message.sessionAgentId === sessionAgentId &&
        Boolean(message.runId) &&
        message.runId !== runId
      ),
  );
};

const mergeCarriedRunPlaceholder = (
  existing: Message | undefined,
  incoming: Message,
): Message => {
  if (!existing) return incoming;

  const existingLineCount = existing.activityLines?.length ?? 0;
  const incomingLineCount = incoming.activityLines?.length ?? 0;
  const primary =
    incomingLineCount > existingLineCount ? incoming : existing;
  const secondary = primary === incoming ? existing : incoming;
  const sourceMessageId =
    primary.sourceMessageId ?? secondary.sourceMessageId;
  const clientMessageId =
    primary.clientMessageId ?? secondary.clientMessageId;
  const secondaryHasAnchor = Boolean(
    secondary.sourceMessageId || secondary.clientMessageId,
  );

  return {
    ...primary,
    sourceMessageId,
    clientMessageId,
    createdAt:
      secondaryHasAnchor && (sourceMessageId || clientMessageId)
        ? (secondary.createdAt ?? primary.createdAt)
        : (primary.createdAt ?? secondary.createdAt),
    activityLines: primary.activityLines ?? secondary.activityLines,
    activityLoadState:
      primary.activityLoadState ?? secondary.activityLoadState,
  };
};

const pendingPlaceholderSenderKey = (message: Message): string | null => {
  const normalized = message.sender.replace(/^@/, '').trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const correlateRunningPlaceholdersWithPending = (
  current: Message[],
  runningPlaceholders: Message[],
): { current: Message[]; runningPlaceholders: Message[] } => {
  if (runningPlaceholders.length === 0) {
    return { current, runningPlaceholders };
  }

  const pendingBySessionAgentId = new Map<string, Message>();
  const pendingBySender = new Map<string, Message[]>();
  const orphanPending: Message[] = [];
  for (const message of current) {
    if (!isPendingAgentPlaceholder(message) || message.runId) {
      continue;
    }

    if (message.sessionAgentId) {
      pendingBySessionAgentId.set(message.sessionAgentId, message);
    } else {
      orphanPending.push(message);
    }

    const senderKey = pendingPlaceholderSenderKey(message);
    if (senderKey) {
      const pendingForSender = pendingBySender.get(senderKey) ?? [];
      pendingForSender.push(message);
      pendingBySender.set(senderKey, pendingForSender);
    }
  }

  if (
    pendingBySessionAgentId.size === 0 &&
    pendingBySender.size === 0 &&
    orphanPending.length === 0
  ) {
    return { current, runningPlaceholders };
  }

  const consumedPendingPlaceholderIds = new Set<string>();
  const correlatedRunningPlaceholders = runningPlaceholders.map(
    (placeholder) => {
      if (placeholder.sourceMessageId || placeholder.clientMessageId) {
        return placeholder;
      }

      let pending = placeholder.sessionAgentId
        ? pendingBySessionAgentId.get(placeholder.sessionAgentId)
        : undefined;
      if (!pending) {
        const senderKey = pendingPlaceholderSenderKey(placeholder);
        const senderMatches = senderKey
          ? (pendingBySender.get(senderKey) ?? []).filter(
              (candidate) =>
                !consumedPendingPlaceholderIds.has(candidate.id),
            )
          : [];
        if (senderMatches.length === 1) {
          pending = senderMatches[0];
        }
      }
      if (
        !pending &&
        runningPlaceholders.length === 1 &&
        orphanPending.length === 1 &&
        !consumedPendingPlaceholderIds.has(orphanPending[0].id)
      ) {
        pending = orphanPending[0];
      }
      if (!pending) return placeholder;
      consumedPendingPlaceholderIds.add(pending.id);

      return {
        ...placeholder,
        sourceMessageId: pending.sourceMessageId,
        clientMessageId: pending.clientMessageId,
        createdAt: pending.createdAt ?? placeholder.createdAt,
        activityLines:
          placeholder.activityLines && placeholder.activityLines.length > 0
            ? placeholder.activityLines
            : pending.activityLines,
        activityLoadState:
          placeholder.activityLoadState ?? pending.activityLoadState,
      };
    },
  );

  if (consumedPendingPlaceholderIds.size === 0) {
    return { current, runningPlaceholders };
  }

  return {
    current: current.filter(
      (message) => !consumedPendingPlaceholderIds.has(message.id),
    ),
    runningPlaceholders: correlatedRunningPlaceholders,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasNonNegativeNumberField = (
  value: Record<string, unknown>,
  fieldNames: string[],
): boolean =>
  fieldNames.some((fieldName) => {
    const raw = value[fieldName];
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0;
  });

const hasCompleteTokenUsageBreakdown = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  return (
    hasNonNegativeNumberField(value, ['input_tokens', 'snapshot_input_tokens']) &&
    hasNonNegativeNumberField(value, [
      'output_tokens',
      'snapshot_output_tokens',
    ])
  );
};

const hasRealCompleteTokenUsage = (message: BackendChatMessage): boolean => {
  if (message.sender_type !== 'agent' || !isRecord(message.meta)) return false;
  const tokenUsage = message.meta.token_usage;
  if (!isRecord(tokenUsage)) return false;
  if (tokenUsage.is_estimated === true) return false;
  return (
    hasCompleteTokenUsageBreakdown(tokenUsage) ||
    hasCompleteTokenUsageBreakdown(tokenUsage.last_token_usage) ||
    hasCompleteTokenUsageBreakdown(tokenUsage.total_token_usage)
  );
};

const firstNumberField = (
  value: Record<string, unknown>,
  fieldNames: string[],
): number | null => {
  for (const fieldName of fieldNames) {
    const raw = value[fieldName];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  }
  return null;
};

const tokenUsageBreakdownSignature = (value: unknown) => {
  if (!isRecord(value)) return null;
  return {
    input: firstNumberField(value, ['input_tokens', 'snapshot_input_tokens']),
    output: firstNumberField(value, [
      'output_tokens',
      'snapshot_output_tokens',
    ]),
    cacheRead: firstNumberField(value, [
      'cache_read_tokens',
      'snapshot_cache_read_tokens',
    ]),
    reasoningOutput: firstNumberField(value, [
      'reasoning_output_tokens',
      'snapshot_reasoning_output_tokens',
    ]),
    total: firstNumberField(value, ['total_tokens', 'snapshot_total_tokens']),
  };
};

const tokenUsageNotificationSignature = (
  message: BackendChatMessage,
): string | null => {
  if (!hasRealCompleteTokenUsage(message) || !isRecord(message.meta)) {
    return null;
  }
  const tokenUsage = message.meta.token_usage;
  if (!isRecord(tokenUsage)) return null;

  return JSON.stringify({
    direct: tokenUsageBreakdownSignature(tokenUsage),
    last: tokenUsageBreakdownSignature(tokenUsage.last_token_usage),
    total: tokenUsageBreakdownSignature(tokenUsage.total_token_usage),
  });
};

const extractAgentMentions = (text: string): string[] =>
  Array.from(text.matchAll(/@([a-zA-Z0-9_-]+)/g), (match) =>
    match[1].toLowerCase(),
  );

const asAgentHandle = (name: string): string =>
  name.startsWith('@') ? name : `@${name}`;

const resolveProjectMainAgentMember = (
  projectMembers: ProjectMemberWithRuntime[],
): ProjectMemberWithRuntime | null =>
  projectMembers.find(
    (member) => member.member_type === 'agent' && member.role === 'lead',
  ) ??
  projectMembers.find((member) => member.member_type === 'agent') ??
  null;

const resolveProjectMainAgentId = (
  projectMembers: ProjectMemberWithRuntime[],
): string | null =>
  resolveProjectMainAgentMember(projectMembers)?.agent_id ?? null;

const resolveProjectMainAgentName = (
  projectMembers: ProjectMemberWithRuntime[],
  agents: BackendChatAgent[],
): string | null => {
  const mainMember = resolveProjectMainAgentMember(projectMembers);
  if (!mainMember) return null;

  const agent = mainMember.agent_id
    ? agents.find((candidate) => candidate.id === mainMember.agent_id)
    : undefined;
  const displayName = mainMember.member_name?.trim() || agent?.name?.trim();
  return displayName ? asAgentHandle(displayName) : null;
};

const makePendingAgentPlaceholder = (
  text: string,
  userMsgId: string,
  members: Member[],
  fallbackMention?: string | null,
  sessionId?: string,
  placeholderMember?: Pick<Member, 'avatar' | 'name' | 'modelName'> | null,
): Message | null => {
  const mentions = extractAgentMentions(text);
  const effectiveMentions =
    mentions.length > 0
      ? mentions
      : fallbackMention
        ? [fallbackMention.replace(/^@/, '').toLowerCase()]
        : [];
  const mentionedMember = members.find((member) =>
    effectiveMentions.includes(member.name.replace(/^@/, '').toLowerCase()),
  );
  const fallbackMember =
    mentionedMember ??
    (effectiveMentions.length === 0
      ? (members.find((member) => member.status === 'run') ?? members[0])
      : undefined);
  const fallbackName = effectiveMentions[0]
    ? asAgentHandle(effectiveMentions[0])
    : '@agent';
  const displayMember = fallbackMember ?? placeholderMember ?? null;
  const sender = asAgentHandle(displayMember?.name ?? fallbackName);

  return {
    id: `${PENDING_AGENT_MESSAGE_PREFIX}${userMsgId}`,
    sessionId,
    avatar: displayMember?.avatar ?? monogramFromName(sender),
    sender,
    model: displayMember?.modelName,
    time: 'just now',
    createdAt: new Date().toISOString(),
    text: '',
    isThinking: true,
    isAgentRunning: true,
    clientMessageId: userMsgId,
    sessionAgentId: fallbackMember?.id,
    activityLines: [],
    activityLoadState: 'loaded',
  };
};

const isWorkflowPlanCardMessage = (message: Message): boolean =>
  message.workflowCard?.cardType === 'workflow_plan' ||
  message.workflowCard?.cardType === 'workflow_plan_generation';

const summarizeQuotedContent = (content: string): string => {
  const normalized = content.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  return normalized.length > 140
    ? `${normalized.slice(0, 137)}...`
    : normalized;
};

const resolveQuotedMessageReferences = (messages: Message[]): Message[] => {
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  return messages.map((message) => {
    if (message.quotedMessage || !message.referenceMessageId) {
      return message;
    }

    const referenced = messagesById.get(message.referenceMessageId);
    if (!referenced) return message;

    return {
      ...message,
      quotedMessage: {
        id: referenced.id,
        sender: referenced.isUser ? 'You' : referenced.sender,
        content: referenced.text,
        summary: summarizeQuotedContent(referenced.text),
      },
    };
  });
};

const withSessionId = (sessionId: string, message: Message): Message =>
  message.sessionId === sessionId ? message : { ...message, sessionId };

const withSessionIdsBySession = (
  messagesBySession: Record<string, Message[]>,
): Record<string, Message[]> =>
  Object.fromEntries(
    Object.entries(messagesBySession).map(([sessionId, messages]) => [
      sessionId,
      messages.map((message) => withSessionId(sessionId, message)),
    ]),
  );

const filterMessagesForSession = (
  sessionId: string,
  messages: Message[],
): Message[] => {
  const scoped = messages.filter((message) => message.sessionId === sessionId);
  const userIndexByClientId = new Map<string, number>();
  const deduped: Message[] = [];

  for (const message of scoped) {
    if (message.isUser) {
      const clientMessageId = userMessageClientId(message);
      if (clientMessageId) {
        const existingIndex = userIndexByClientId.get(clientMessageId);
        if (existingIndex !== undefined) {
          const existing = deduped[existingIndex];
          deduped[existingIndex] =
            isOptimisticUserMessage(existing) &&
            !isOptimisticUserMessage(message)
              ? message
              : existing;
          continue;
        }
        userIndexByClientId.set(clientMessageId, deduped.length);
      }
    }
    deduped.push(message);
  }

  return orderMessagesForConversation(deduped);
};

const mergePersistedWithRunningPlaceholders = (
  persisted: Message[],
  current: Message[],
  activeSessionAgentIds?: Set<string>,
  runningPlaceholders: Message[] = [],
): Message[] => {
  const correlated = correlateRunningPlaceholdersWithPending(
    current,
    runningPlaceholders,
  );
  const combinedCurrent = [
    ...correlated.current,
    ...correlated.runningPlaceholders,
  ];
  const persistedIds = new Set(persisted.map((message) => message.id));
  const persistedClientMessageIds = new Set(
    persisted
      .map(userMessageClientId)
      .filter((id): id is string => Boolean(id)),
  );
  const persistedRunIds = new Set(
    persisted
      .map((message) => message.runId)
      .filter((runId): runId is string => Boolean(runId)),
  );
  const carriedMessagesByKey = new Map<string, Message>();
  let hasRunIdPlaceholder = false;
  for (const message of combinedCurrent) {
    if (
      message.isAgentRunning &&
      message.sessionAgentId &&
      activeSessionAgentIds &&
      !activeSessionAgentIds.has(message.sessionAgentId) &&
      !isOptimisticPendingAgentPlaceholder(message)
    ) {
      continue;
    }

    if (isOptimisticUserMessage(message)) {
      const clientMessageId = userMessageClientId(message);
      if (
        !persistedIds.has(message.id) &&
        clientMessageId &&
        !persistedClientMessageIds.has(clientMessageId)
      ) {
        carriedMessagesByKey.set(`user:${clientMessageId}`, message);
      }
      continue;
    }

    if (!message.isAgentRunning || persistedIds.has(message.id)) continue;
    if (message.runId && persistedRunIds.has(message.runId)) continue;
    const key = `agent:${message.runId ?? message.clientMessageId ?? message.id}`;
    if (message.runId) hasRunIdPlaceholder = true;
    const existing = carriedMessagesByKey.get(key);
    carriedMessagesByKey.set(
      key,
      mergeCarriedRunPlaceholder(existing, message),
    );
  }

  // If a real run placeholder exists, discard only hydrated pending placeholders
  // (no runId). Keep optimistic pending placeholders because they can represent
  // a newly queued message for the same agent while another run is active.
  if (hasRunIdPlaceholder) {
    for (const [key, message] of carriedMessagesByKey) {
      if (
        !message.runId &&
        isPendingAgentPlaceholder(message) &&
        !isOptimisticPendingAgentPlaceholder(message)
      ) {
        carriedMessagesByKey.delete(key);
      }
    }
  }

  const placeholders = [...carriedMessagesByKey.values()];
  let merged = persisted;
  for (const placeholder of placeholders) {
    merged =
      placeholder.sourceMessageId || placeholder.clientMessageId
        ? [...merged, placeholder]
        : insertMessageByCreatedAt(merged, placeholder);
  }

  return orderMessagesForConversation(merged);
};

const sortActivityLines = (
  lines: ChatRunActivityLine[],
): ChatRunActivityLine[] =>
  [...lines].sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return a.line_id.localeCompare(b.line_id);
  });

const latestRunsBySessionAgent = (
  runs: ChatRunRetentionInfo[],
): Map<string, ChatRunRetentionInfo> => {
  const latest = new Map<string, ChatRunRetentionInfo>();
  for (const run of runs) {
    const existing = latest.get(run.session_agent_id);
    if (
      !existing ||
      Date.parse(run.created_at) > Date.parse(existing.created_at)
    ) {
      latest.set(run.session_agent_id, run);
    }
  }
  return latest;
};

const hydrateRunningAgentPlaceholders = async (
  sessionAgents: BackendChatSessionAgent[],
  agents: BackendChatAgent[],
  runs: ChatRunRetentionInfo[],
  projectMembers: ProjectMemberWithRuntime[] = [],
): Promise<Message[]> => {
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const projectMemberById = new Map(projectMembers.map((m) => [m.id, m]));
  const projectMemberByAgentId = new Map(
    projectMembers
      .filter((m) => m.agent_id)
      .map((m) => [m.agent_id as string, m]),
  );
  const latestRunBySessionAgentId = latestRunsBySessionAgent(runs);
  const runningSessionAgents = sessionAgents.filter((sessionAgent) =>
    ['running', 'stopping'].includes(sessionAgent.state),
  );

  const placeholders: Array<Message | null> = await Promise.all(
    runningSessionAgents.map(async (sessionAgent): Promise<Message | null> => {
      const run = latestRunBySessionAgentId.get(sessionAgent.id);
      const agent = agentById.get(sessionAgent.agent_id);
      const projectMember =
        (sessionAgent.project_member_id
          ? projectMemberById.get(sessionAgent.project_member_id)
          : undefined) ?? projectMemberByAgentId.get(sessionAgent.agent_id);
      const agentName =
        projectMember?.member_name?.trim() || agent?.name || sessionAgent.agent_id;
      const activityLines = run
        ? await chatRunsApi
            .getActivity(run.run_id, { offset: 0, limit: 1000 })
            .then((response) => sortActivityLines(response.lines))
            .catch(() => [])
        : [];

      return {
        id: run
          ? `run-${run.run_id}`
          : `${PENDING_AGENT_MESSAGE_PREFIX}running-${sessionAgent.id}`,
        sessionId: sessionAgent.session_id,
        avatar: monogramFromName(agentName),
        sender: asAgentHandle(agentName),
        model: effectiveSessionAgentModelName(agent, sessionAgent) ?? undefined,
        time: 'just now',
        createdAt: run?.created_at ?? sessionAgent.updated_at,
        text: '',
        isThinking: true,
        isAgentRunning: true,
        runId: run?.run_id,
        sessionAgentId: sessionAgent.id,
        activityLines,
        activityLoadState: 'idle',
      };
    }),
  );

  return placeholders.filter(
    (placeholder): placeholder is Message => placeholder !== null,
  );
};

interface WorkspaceContextProps {
  theme: Theme;
  setTheme: (t: Theme) => void;
  locale: Locale;
  setLocale: (l: Locale) => void;
  chatMessageFontSize: number;
  setChatMessageFontSize: (size: number) => void;
  members: Member[];
  setMembers: (m: ListUpdater<Member>) => void;
  sessions: Session[];
  setSessions: (s: ListUpdater<Session>) => void;
  projects: Project[];
  projectsAsync: AsyncResourceState<Project[]>;
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
  refreshProjects: () => Promise<void>;
  createProject: (data: CreateProjectRequest) => Promise<Project>;
  messages: Message[];
  memberQueuesBySessionAgentId: MemberQueuesBySessionAgentId;
  deferredQueuedMessagesById: Record<string, Message>;
  workflowRuntimeLinesByExecution: Record<string, WorkflowRuntimeLine[]>;
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
  chatInputMode: ChatInputMode;
  setChatInputMode: (mode?: ChatInputMode) => void;
  setSessionChatInputMode: (sessionId: string, mode: ChatInputMode) => void;
  ensureWorkflowRouteToMainAgent: () => Promise<void>;
  mainAgentName: string | null;
  providers: Provider[];
  setProviders: (p: ListUpdater<Provider>) => void;
  strategies: Strategy[];
  selectedStrategyId: string;
  setSelectedStrategyId: (id: string) => void;
  selectedOnboardType: 'saas' | 'cli' | 'game' | 'ai';
  setSelectedOnboardType: (type: 'saas' | 'cli' | 'game' | 'ai') => void;
  smartRouting: boolean;
  setSmartRouting: (b: boolean) => void;
  showCost: boolean;
  setShowCost: (b: boolean) => void;
  showExplanation: boolean;
  setShowExplanation: (b: boolean) => void;
  warnOverDollar: boolean;
  setWarnOverDollar: (b: boolean) => void;
  weeklyCost: number;
  weeklySaved: number;
  earlyBirdLeft: number;
  setEarlyBirdLeft: (n: number | ((prev: number) => number)) => void;

  // Modals state
  isAddMemberModalOpen: boolean;
  setIsAddMemberModalOpen: (b: boolean) => void;
  isAddProviderModalOpen: boolean;
  setIsAddProviderModalOpen: (b: boolean) => void;

  // Active Simulation Utilities
  sendMessage: (text: string, options?: SendMessageOptions) => void;
  sendMessageToSession: (
    sessionId: string,
    text: string,
    options?: SendMessageOptions,
  ) => void;
  stagePendingAgentPlaceholder: (
    sessionId: string,
    text: string,
    options?: SendMessageOptions,
  ) => void;
  addMemberToOrganization: (name: string, model: string) => void;
  addProviderToKeychain: (name: string, key: string) => void;

  // i18n hook helper
  t: (key: string, replacements?: Record<string, string | number>) => string;

  // Toast notifications
  toast: WorkspaceToast | null;
  showToast: (msg: string, tone?: ToastTone) => void;

  // Settings active section
  activeSettingsTab: string;
  setActiveSettingsTab: (tab: string) => void;

  // Async-status surface appended to the preserved legacy context shape.
  sessionsAsync: AsyncResourceState<Session[]>;
  refreshSessions: () => Promise<void>;
  archivedSessionsAsync: AsyncResourceState<Session[]>;
  refreshArchivedSessions: () => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  archiveSession: (sessionId: string) => Promise<void>;
  pinSession: (sessionId: string, pinned: boolean) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  restoreSession: (sessionId: string) => Promise<void>;
  messagesAsync: AsyncResourceState<Message[]>;
  refreshMessages: () => Promise<void>;
  /**
   * Mark a stop request so the run does not keep session-level running
   * indicators active while the visible placeholder stays in place until the
   * persisted stopped message replaces it.
   */
  markSessionAgentStopped: (sessionAgentId: string) => void;
  refreshMemberQueues: () => Promise<void>;
  deleteQueuedMessage: (sessionId: string, queueId: string) => Promise<void>;
  continueMemberQueue: (
    sessionId: string,
    sessionAgentId: string,
  ) => Promise<void>;
  membersAsync: AsyncResourceState<Member[]>;
  refreshMembers: () => Promise<void>;
  providersAsync: AsyncResourceState<Provider[]>;
  refreshProviders: () => Promise<void>;
  skills: BackendChatSkill[];
  skillsAsync: AsyncResourceState<BackendChatSkill[]>;
  refreshSkills: () => Promise<void>;
  config: Config | null;
  configAsync: AsyncResourceState<Config | null>;
  refreshConfig: () => Promise<void>;
  workflowCard: WorkflowCardProjection | null;
  workflowCardAsync: AsyncResourceState<WorkflowCardProjection | null>;
  refreshWorkflowCard: (messageId: string) => Promise<void>;
  workspaceChanges: WorkspaceChangesResponse | null;
  workspaceChangesAsync: AsyncResourceState<WorkspaceChangesResponse | null>;
  refreshWorkspaceChanges: (
    sessionId: string,
    path: string,
    includeDiff?: boolean,
  ) => Promise<void>;
  resetWorkspaceChanges: () => void;
  /** Re-runs every auto-loaded resource. Useful as a global retry. */
  refreshAll: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextProps | undefined>(
  undefined,
);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('openteams-design-mode');
      return saved === 'light' || saved === 'dark' ? (saved as Theme) : 'dark';
    } catch {
      return 'dark';
    }
  });

  const [locale, setLocaleState] = useState<Locale>(() => {
    try {
      const saved = localStorage.getItem('openteams-locale');
      return ['en', 'zh', 'ja', 'ko', 'fr', 'es'].includes(saved ?? '')
        ? (saved as Locale)
        : 'zh';
    } catch {
      return 'zh';
    }
  });
  const [chatMessageFontSize, setChatMessageFontSizeState] =
    useState<number>(() => {
      try {
        return normalizeChatMessageFontSize(
          localStorage.getItem(CHAT_MESSAGE_FONT_SIZE_STORAGE_KEY) ??
            localStorage.getItem(LEGACY_AGENT_MARKDOWN_FONT_SIZE_STORAGE_KEY),
        );
      } catch {
        return CHAT_MESSAGE_FONT_SIZE_DEFAULT;
      }
    });
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    try {
      return localStorage.getItem(ACTIVE_SESSION_ID_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const mockBootstrapRef = useRef<WorkspaceBootstrapMock | null>(null);
  const toastDurationMsRef = useRef(3000);

  // Async-backed primary resources. Each is seeded with the existing mock so
  // the UI renders before the first API response arrives (or if the backend
  // is unreachable / has a contract gap).
  const [sessionsAsync, setSessionsAsync] = useState<
    AsyncResourceState<Session[]>
  >(() => initialAsync([]));
  const [archivedSessionsAsync, setArchivedSessionsAsync] = useState<
    AsyncResourceState<Session[]>
  >(() => initialAsync([]));
  const [projectsAsync, setProjectsAsync] = useState<
    AsyncResourceState<Project[]>
  >(() => initialAsync([]));
  const [selectedProjectId, setSelectedProjectIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(SELECTED_PROJECT_ID_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [allMessages, setAllMessages] = useState<Record<string, Message[]>>({});
  const allMessagesRef = useRef<Record<string, Message[]>>({});
  const [memberQueuesBySessionAgentId, setMemberQueuesBySessionAgentId] =
    useState<MemberQueuesBySessionAgentId>({});
  const [deferredQueuedMessagesById, setDeferredQueuedMessagesById] = useState<
    Record<string, Message>
  >({});
  const [workflowRuntimeLinesByExecution, setWorkflowRuntimeLinesByExecution] =
    useState<Record<string, WorkflowRuntimeLine[]>>({});
  const [messagesAsync, setMessagesAsync] = useState<
    AsyncResourceState<Message[]>
  >(() => initialAsync([]));
  const [membersAsync, setMembersAsync] = useState<
    AsyncResourceState<Member[]>
  >(() => initialAsync([]));
  const [mainAgentName, setMainAgentName] = useState<string | null>(null);
  const [providersAsync, setProvidersAsync] = useState<
    AsyncResourceState<Provider[]>
  >(() => initialAsync([]));
  const [skillsAsync, setSkillsAsync] = useState<
    AsyncResourceState<BackendChatSkill[]>
  >(() => initialAsync([]));
  const [configAsync, setConfigAsync] = useState<
    AsyncResourceState<Config | null>
  >(() => initialAsync(null));
  const [workflowCardAsync, setWorkflowCardAsync] = useState<
    AsyncResourceState<WorkflowCardProjection | null>
  >(() => initialAsync(null));
  const [workspaceChangesAsync, setWorkspaceChangesAsync] = useState<
    AsyncResourceState<WorkspaceChangesResponse | null>
  >(() => initialAsync(null));
  const messagesRequestIdRef = useRef(0);
  const queueRequestIdRef = useRef(0);
  const workspaceChangesRequestIdRef = useRef(0);
  const [chatInputModeBySessionId, setChatInputModeBySessionId] = useState<
    Record<string, ChatInputMode>
  >({});

  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [mockAgentRepliesByMention, setMockAgentRepliesByMention] = useState<
    Record<string, string[]>
  >({ default: ['Working on it.'] });
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>('');
  const [selectedOnboardType, setSelectedOnboardType] = useState<
    'saas' | 'cli' | 'game' | 'ai'
  >('saas');

  // Global Settings Switches
  const [smartRouting, setSmartRouting] = useState<boolean>(true);
  const [showCost, setShowCost] = useState<boolean>(true);
  const [showExplanation, setShowExplanation] = useState<boolean>(true);
  const [warnOverDollar, setWarnOverDollar] = useState<boolean>(false);

  // Stats (LOCAL / MOCK-FALLBACK per backend_contract_audit 搂5.1)
  const [weeklyCost, setWeeklyCost] = useState<number>(0);
  const [weeklySaved, setWeeklySaved] = useState<number>(0);
  const [earlyBirdLeft, setEarlyBirdLeft] = useState<number>(0);

  // Settings view controller
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<string>('providers');

  // Modal Switches
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] =
    useState<boolean>(false);
  const [isAddProviderModalOpen, setIsAddProviderModalOpen] =
    useState<boolean>(false);

  // Toast
  const [toast, setToast] = useState<WorkspaceToast | null>(null);

  // Cache the latest activeSessionId so async callbacks see the live value.
  const activeSessionIdRef = useRef(activeSessionId);
  const selectedProjectIdRef = useRef(selectedProjectId);
  // Cache the active session's workspace path so the WebSocket
  // `file_change_refresh` handler can refresh workspace changes without a stale
  // closure (the socket effect does not re-subscribe on every sessions update).
  const activeWorkspacePathRef = useRef<string | null>(null);
  const sessionLeadAgentIdBySessionIdRef = useRef<Record<
    string,
    string | null
  >>({});
  const workflowRouteAgentIdRef = useRef<string | null>(null);
  const agentNamesByIdRef = useRef<Record<string, string>>({});
  const agentModelsByIdRef = useRef<Record<string, string | null>>({});
  const notifiedTokenUsageSignaturesRef = useRef<Record<string, string>>({});
  // Session agents the user has just requested to stop. While an agent is in
  // this set, keep any existing visible placeholder until the persisted stop
  // notice replaces it, but do not re-hydrate a separate running placeholder.
  // Cleared when a new run starts or after the terminal stop notice replaces
  // the placeholder.
  const optimisticallyStoppedSessionAgentIdsRef = useRef<Set<string>>(
    new Set(),
  );
  const runningAgentSessionIdsRef = useRef<Set<string>>(
    readSessionIdSet(RUNNING_AGENT_SESSION_IDS_STORAGE_KEY),
  );
  const unreadAgentCompletionSessionIdsRef = useRef<Set<string>>(
    readSessionIdSet(UNREAD_AGENT_COMPLETION_SESSION_IDS_STORAGE_KEY),
  );
  const acknowledgedWorkflowInputIdsRef = useRef<Set<string>>(
    readSessionIdSet(ACKED_WORKFLOW_INPUT_IDS_STORAGE_KEY),
  );
  const deferredQueuedMessageIdsRef = useRef<Set<string>>(new Set());
  const deferredQueuedClientMessageIdsRef = useRef<Set<string>>(new Set());
  const deferredQueuedUserMessagesRef = useRef<Map<string, Message>>(new Map());
  useEffect(() => {
    allMessagesRef.current = allMessages;
  }, [allMessages]);

  const persistAgentSessionActivityStorage = useCallback(() => {
    writeSessionIdSet(
      RUNNING_AGENT_SESSION_IDS_STORAGE_KEY,
      runningAgentSessionIdsRef.current,
    );
    writeSessionIdSet(
      UNREAD_AGENT_COMPLETION_SESSION_IDS_STORAGE_KEY,
      unreadAgentCompletionSessionIdsRef.current,
    );
  }, []);
  const persistWorkflowInputAcknowledgementStorage = useCallback(() => {
    writeSessionIdSet(
      ACKED_WORKFLOW_INPUT_IDS_STORAGE_KEY,
      acknowledgedWorkflowInputIdsRef.current,
    );
  }, []);

  const syncSessionAgentActivityIndicator = useCallback(
    (sessionId: string, hasRunningAgent: boolean): boolean => {
      if (!sessionId) return false;

      let changed = false;
      if (hasRunningAgent) {
        if (!runningAgentSessionIdsRef.current.has(sessionId)) {
          runningAgentSessionIdsRef.current.add(sessionId);
          changed = true;
        }
        if (unreadAgentCompletionSessionIdsRef.current.delete(sessionId)) {
          changed = true;
        }
      } else {
        const wasRunning = runningAgentSessionIdsRef.current.delete(sessionId);
        if (wasRunning) {
          changed = true;
        }
        if (activeSessionIdRef.current === sessionId) {
          if (unreadAgentCompletionSessionIdsRef.current.delete(sessionId)) {
            changed = true;
          }
        } else if (wasRunning) {
          unreadAgentCompletionSessionIdsRef.current.add(sessionId);
          changed = true;
        }
      }

      if (changed) {
        persistAgentSessionActivityStorage();
      }
      return unreadAgentCompletionSessionIdsRef.current.has(sessionId);
    },
    [persistAgentSessionActivityStorage],
  );

  const acknowledgeWorkflowInput = useCallback(
    (inputId: string | null | undefined) => {
      if (!inputId || acknowledgedWorkflowInputIdsRef.current.has(inputId)) {
        return;
      }
      acknowledgedWorkflowInputIdsRef.current.add(inputId);
      persistWorkflowInputAcknowledgementStorage();
    },
    [persistWorkflowInputAcknowledgementStorage],
  );

  const syncSessionWorkflowInputIndicator = useCallback(
    (
      sessionId: string,
      pendingWorkflowInputId: string | null | undefined,
    ): boolean => {
      if (!sessionId || !pendingWorkflowInputId) return false;
      if (activeSessionIdRef.current === sessionId) {
        acknowledgeWorkflowInput(pendingWorkflowInputId);
        return false;
      }
      return !acknowledgedWorkflowInputIdsRef.current.has(
        pendingWorkflowInputId,
      );
    },
    [acknowledgeWorkflowInput],
  );

  const clearUnreadAgentCompletion = useCallback(
    (sessionId: string) => {
      if (!sessionId) return;
      if (!unreadAgentCompletionSessionIdsRef.current.delete(sessionId)) {
        return;
      }

      persistAgentSessionActivityStorage();
      setSessionsAsync((prev) => {
        let changed = false;
        const data = prev.data.map((session) => {
          if (
            session.id !== sessionId ||
            !session.hasUnreadAgentCompletion
          ) {
            return session;
          }
          changed = true;
          return { ...session, hasUnreadAgentCompletion: false };
        });
        return changed ? { ...prev, data } : prev;
      });
    },
    [persistAgentSessionActivityStorage],
  );

  const clearPendingWorkflowInput = useCallback(
    (sessionId: string) => {
      if (!sessionId) return;
      setSessionsAsync((prev) => {
        let changed = false;
        const data = prev.data.map((session) => {
          if (session.id !== sessionId) return session;
          acknowledgeWorkflowInput(session.pendingWorkflowInputId);
          if (!session.hasPendingWorkflowInput) return session;
          changed = true;
          return { ...session, hasPendingWorkflowInput: false };
        });
        return changed ? { ...prev, data } : prev;
      });
    },
    [acknowledgeWorkflowInput],
  );

  const rememberDeferredQueuedUserMessage = useCallback((message: Message) => {
    if (!message.isUser) return;
    deferredQueuedMessageIdsRef.current.add(message.id);
    deferredQueuedUserMessagesRef.current.set(message.id, message);
    setDeferredQueuedMessagesById((prev) => ({
      ...prev,
      [message.id]: message,
      ...(message.clientMessageId ? { [message.clientMessageId]: message } : {}),
    }));
    if (message.clientMessageId) {
      deferredQueuedClientMessageIdsRef.current.add(message.clientMessageId);
      deferredQueuedUserMessagesRef.current.set(
        message.clientMessageId,
        message,
      );
    }
  }, []);

  const isDeferredQueuedUserMessage = useCallback((message: Message) => {
    if (!message.isUser) return false;
    return (
      deferredQueuedMessageIdsRef.current.has(message.id) ||
      Boolean(
        message.clientMessageId &&
          deferredQueuedClientMessageIdsRef.current.has(message.clientMessageId),
      )
    );
  }, []);

  const filterDeferredQueuedUserMessages = useCallback(
    (messages: Message[]): Message[] =>
      messages.filter((message) => !isDeferredQueuedUserMessage(message)),
    [isDeferredQueuedUserMessage],
  );

  const hasDeferredQueuedUserMessage = useCallback(
    (messageId: string, clientMessageId?: string | null): boolean =>
      deferredQueuedMessageIdsRef.current.has(messageId) ||
      Boolean(
        clientMessageId &&
          deferredQueuedClientMessageIdsRef.current.has(clientMessageId),
      ),
    [],
  );

  const releaseDeferredQueuedUserMessage = useCallback(
    (messageId: string, clientMessageId?: string | null): Message | null => {
      const message =
        (clientMessageId
          ? deferredQueuedUserMessagesRef.current.get(clientMessageId)
          : undefined) ??
        deferredQueuedUserMessagesRef.current.get(messageId) ??
        null;

      deferredQueuedMessageIdsRef.current.delete(messageId);
      deferredQueuedUserMessagesRef.current.delete(messageId);
      setDeferredQueuedMessagesById((prev) => {
        const next = { ...prev };
        delete next[messageId];
        if (clientMessageId) {
          delete next[clientMessageId];
        }
        return next;
      });
      if (clientMessageId) {
        deferredQueuedClientMessageIdsRef.current.delete(clientMessageId);
        deferredQueuedUserMessagesRef.current.delete(clientMessageId);
      }

      return message;
    },
    [],
  );

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
    try {
      if (activeSessionId) {
        localStorage.setItem(ACTIVE_SESSION_ID_STORAGE_KEY, activeSessionId);
      } else {
        localStorage.removeItem(ACTIVE_SESSION_ID_STORAGE_KEY);
      }
    } catch {}
    clearUnreadAgentCompletion(activeSessionId);
    clearPendingWorkflowInput(activeSessionId);
  }, [activeSessionId, clearPendingWorkflowInput, clearUnreadAgentCompletion]);

  useEffect(() => {
    messagesRequestIdRef.current += 1;
    setMessagesAsync(
      succeed(
        activeSessionId
          ? filterDeferredQueuedUserMessages(
              filterMessagesForSession(
                activeSessionId,
                allMessagesRef.current[activeSessionId] ?? [],
              ),
            )
          : [],
      ),
    );
  }, [activeSessionId, filterDeferredQueuedUserMessages]);

  // Keep the cached workspace path in sync with the active session so the
  // WebSocket `file_change_refresh` handler always refreshes the right path.
  // Mirrors FreeChatWorkspace's `reloadRelatedFiles` (currentProject workspace).
  useEffect(() => {
    activeWorkspacePathRef.current = selectedProjectId
      ? projectsAsync.data?.find(
          (project) => project.id === selectedProjectId,
        )?.default_workspace_path ?? null
      : null;
  }, [selectedProjectId, projectsAsync]);
  useEffect(() => {
    setWorkflowRuntimeLinesByExecution({});
  }, [activeSessionId]);
  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const chatInputMode =
    activeSessionId !== ''
      ? (chatInputModeBySessionId[activeSessionId] ??
        DEFAULT_CHAT_INPUT_MODE)
      : DEFAULT_CHAT_INPUT_MODE;

  const showToast = (msg: string, tone: ToastTone = 'info') => {
    setToast({ message: msg, tone });
    setTimeout(() => {
      setToast(null);
    }, toastDurationMsRef.current);
  };

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem('openteams-design-mode', t);
    } catch {}
  };

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem('openteams-locale', l);
    } catch {}
  };

  const setChatMessageFontSize = (size: number) => {
    const normalized = normalizeChatMessageFontSize(size);
    setChatMessageFontSizeState(normalized);
    try {
      localStorage.setItem(
        CHAT_MESSAGE_FONT_SIZE_STORAGE_KEY,
        String(normalized),
      );
    } catch {}
  };

  useEffect(() => {
    document.body.setAttribute('data-mode', theme);
  }, [theme]);

  const makeListSetter =
    <T,>(
      setAsync: React.Dispatch<React.SetStateAction<AsyncResourceState<T[]>>>,
    ) =>
    (next: ListUpdater<T>) => {
      setAsync((prev) => {
        const newData =
          typeof next === 'function'
            ? (next as (p: T[]) => T[])(prev.data)
            : next;
        return { ...prev, data: newData, empty: newData.length === 0 };
      });
    };

  const setSessions = useCallback(
    makeListSetter<Session>(setSessionsAsync),
    [],
  );
  const setMembers = useCallback(makeListSetter<Member>(setMembersAsync), []);
  const setProviders = useCallback(
    makeListSetter<Provider>(setProvidersAsync),
    [],
  );
  const setSessionRunningIndicator = useCallback(
    (sessionId: string, hasRunningAgent: boolean) => {
      if (!sessionId) return;
      const hasUnreadAgentCompletion = syncSessionAgentActivityIndicator(
        sessionId,
        hasRunningAgent,
      );
      setSessionsAsync((prev) => {
        let changed = false;
        const data = prev.data.map((session) => {
          if (
            session.id !== sessionId ||
            (session.hasRunningAgent === hasRunningAgent &&
              session.hasUnreadAgentCompletion === hasUnreadAgentCompletion)
          ) {
            return session;
          }
          changed = true;
          return {
            ...session,
            hasRunningAgent,
            hasUnreadAgentCompletion,
          };
        });
        return changed ? { ...prev, data } : prev;
      });
    },
    [syncSessionAgentActivityIndicator],
  );
  const setSessionWorkflowRunningIndicator = useCallback(
    (sessionId: string, hasRunningWorkflow: boolean) => {
      if (!sessionId) return;
      setSessionsAsync((prev) => {
        let changed = false;
        const data = prev.data.map((session) => {
          if (
            session.id !== sessionId ||
            session.hasRunningWorkflow === hasRunningWorkflow
          ) {
            return session;
          }
          changed = true;
          return { ...session, hasRunningWorkflow };
        });
        return changed ? { ...prev, data } : prev;
      });
    },
    [],
  );
  const setSessionWorkflowStatusIndicators = useCallback(
    (
      sessionId: string,
      status: {
        has_running_workflow: boolean;
        pending_workflow_input_id?: string | null;
        pending_workflow_review_id?: string | null;
      },
    ) => {
      if (!sessionId) return;
      const pendingWorkflowInputId = status.pending_workflow_input_id ?? null;
      const pendingWorkflowReviewId = status.pending_workflow_review_id ?? null;
      const hasPendingWorkflowInput = syncSessionWorkflowInputIndicator(
        sessionId,
        pendingWorkflowInputId,
      );
      const hasPendingWorkflowReview = Boolean(pendingWorkflowReviewId);
      setSessionsAsync((prev) => {
        let changed = false;
        const data = prev.data.map((session) => {
          if (
            session.id !== sessionId ||
            (session.hasRunningWorkflow === status.has_running_workflow &&
              session.pendingWorkflowInputId === pendingWorkflowInputId &&
              session.hasPendingWorkflowInput === hasPendingWorkflowInput &&
              session.pendingWorkflowReviewId === pendingWorkflowReviewId &&
              session.hasPendingWorkflowReview === hasPendingWorkflowReview)
          ) {
            return session;
          }
          changed = true;
          return {
            ...session,
            hasRunningWorkflow: status.has_running_workflow,
            pendingWorkflowInputId,
            hasPendingWorkflowInput,
            pendingWorkflowReviewId,
            hasPendingWorkflowReview,
          };
        });
        return changed ? { ...prev, data } : prev;
      });
    },
    [syncSessionWorkflowInputIndicator],
  );

  const clearSessionScopedState = useCallback(() => {
    activeSessionIdRef.current = '';
    deferredQueuedMessageIdsRef.current.clear();
    deferredQueuedClientMessageIdsRef.current.clear();
    deferredQueuedUserMessagesRef.current.clear();
    setDeferredQueuedMessagesById({});
    setActiveSessionId('');
    setMessagesAsync(succeed([]));
    setMembersAsync(succeed([]));
    setMemberQueuesBySessionAgentId({});
    setMainAgentName(null);
  }, []);

  const setSelectedProjectId = useCallback(
    (id: string) => {
      const previousProjectId = selectedProjectIdRef.current;
      selectedProjectIdRef.current = id;
      setSelectedProjectIdState(id);
      try {
        if (id) {
          localStorage.setItem(SELECTED_PROJECT_ID_STORAGE_KEY, id);
        } else {
          localStorage.removeItem(SELECTED_PROJECT_ID_STORAGE_KEY);
        }
      } catch {}

      if (previousProjectId !== id) {
        setSessionsAsync(succeed([]));
        setArchivedSessionsAsync(succeed([]));
        clearSessionScopedState();
      }
    },
    [clearSessionScopedState],
  );

  const syncSessionLeadAgent = useCallback(
    async (sessionId: string, agentId: string | null): Promise<void> => {
      if (!sessionId || !agentId) return;

      const currentLeadAgentId =
        sessionLeadAgentIdBySessionIdRef.current[sessionId] ?? null;
      if (currentLeadAgentId === agentId) return;

      sessionLeadAgentIdBySessionIdRef.current = {
        ...sessionLeadAgentIdBySessionIdRef.current,
        [sessionId]: agentId,
      };

      try {
        const updatedSession = await chatSessionsApi.update(
          sessionId,
          chatSessionUpdatePayload({ lead_agent_id: agentId }),
        );
        sessionLeadAgentIdBySessionIdRef.current = {
          ...sessionLeadAgentIdBySessionIdRef.current,
          [updatedSession.id]: updatedSession.lead_agent_id,
        };
      } catch (err) {
        sessionLeadAgentIdBySessionIdRef.current = {
          ...sessionLeadAgentIdBySessionIdRef.current,
          [sessionId]: currentLeadAgentId,
        };
        console.warn('Failed to sync workflow lead agent', err);
      }
    },
    [],
  );

  const ensureWorkflowRouteToMainAgent = useCallback(async (): Promise<void> => {
    const sid = activeSessionIdRef.current;
    const agentId = workflowRouteAgentIdRef.current;
    await syncSessionLeadAgent(sid, agentId);
  }, [syncSessionLeadAgent]);

  const setSessionChatInputMode = useCallback(
    (sessionId: string, mode: ChatInputMode) => {
      if (!sessionId) return;
      setChatInputModeBySessionId((prev) => ({
        ...prev,
        [sessionId]: mode,
      }));
    },
    [],
  );

  const setChatInputMode = useCallback(
    (mode?: ChatInputMode) => {
      const sid = activeSessionIdRef.current;
      if (!sid) return;

      const previousMode =
        chatInputModeBySessionId[sid] ?? DEFAULT_CHAT_INPUT_MODE;
      const nextMode =
        mode ?? (previousMode === 'workflow' ? 'free' : 'workflow');

      setChatInputModeBySessionId((prev) => ({
        ...prev,
        [sid]: nextMode,
      }));
      if (nextMode === 'workflow') {
        void ensureWorkflowRouteToMainAgent();
      }

      if (sessionsAsync.source !== 'api') return;

      chatSessionsApi
        .update(sid, {
          ...chatSessionUpdatePayload({
            chat_input_mode: toSessionChatInputMode(nextMode),
          }),
        })
        .then((updatedSession) => {
          setChatInputModeBySessionId((prev) => ({
            ...prev,
            [updatedSession.id]: resolveChatInputMode(
              updatedSession.chat_input_mode,
            ),
          }));
        })
        .catch((err) => {
          setChatInputModeBySessionId((prev) => ({
            ...prev,
            [sid]: previousMode,
          }));
          showToast(
            err instanceof Error
              ? `Mode switch failed: ${err.message}`
              : 'Mode switch failed.',
          );
        });
    },
    [chatInputModeBySessionId, ensureWorkflowRouteToMainAgent, sessionsAsync.source],
  );

  const applyMockBootstrap = useCallback(
    (bootstrap: WorkspaceBootstrapMock) => {
      const messagesBySession = withSessionIdsBySession(
        bootstrap.messagesBySession,
      );
      mockBootstrapRef.current = { ...bootstrap, messagesBySession };
      toastDurationMsRef.current = bootstrap.defaults.toastDurationMs;
      setSessionsAsync(initialAsync([]));
      setArchivedSessionsAsync(initialAsync([]));
      setAllMessages(messagesBySession);
      clearSessionScopedState();
      setMembersAsync(initialAsync(bootstrap.members));
      setProvidersAsync(initialAsync(bootstrap.providers));
      setStrategies(bootstrap.strategies);
      setMockAgentRepliesByMention(bootstrap.agentRepliesByMention);
      setSelectedStrategyId(bootstrap.defaults.selectedStrategyId);
      setSelectedOnboardType(bootstrap.defaults.selectedOnboardType);
      setSmartRouting(bootstrap.defaults.smartRouting);
      setShowCost(bootstrap.defaults.showCost);
      setShowExplanation(bootstrap.defaults.showExplanation);
      setWarnOverDollar(bootstrap.defaults.warnOverDollar);
      setWeeklyCost(bootstrap.defaults.weeklyCost);
      setWeeklySaved(bootstrap.defaults.weeklySaved);
      setEarlyBirdLeft(bootstrap.defaults.earlyBirdLeft);
      setActiveSettingsTab(bootstrap.defaults.activeSettingsTab);
    },
    [clearSessionScopedState],
  );

  const refreshProjects = useCallback(async (): Promise<void> => {
    setProjectsAsync(beginLoad);
    try {
      const projects = await projectApi.listProjects();
      setProjectsAsync(succeed(projects));
      const currentProjectId = selectedProjectIdRef.current;
      if (
        projects.length > 0 &&
        !projects.some((project) => project.id === currentProjectId)
      ) {
        setSelectedProjectId(projects[0].id);
      } else if (projects.length === 0 && currentProjectId) {
        setSelectedProjectId('');
      }
    } catch (err) {
      setProjectsAsync((prev) => fail(prev, err, []));
    }
  }, [setSelectedProjectId]);

  const createProject = useCallback(
    async (data: CreateProjectRequest): Promise<Project> => {
      const project = await projectApi.createProject(data);
      setProjectsAsync((prev) =>
        succeed([
          project,
          ...prev.data.filter((item) => item.id !== project.id),
        ]),
      );
      setSelectedProjectId(project.id);
      return project;
    },
    [setSelectedProjectId],
  );

  const syncActiveSessionSelection = useCallback(
    (activeBackendSessions: BackendChatSession[]): string => {
      const currentActiveSessionId = activeSessionIdRef.current;
      const nextActiveSessionId = activeBackendSessions.some(
        (session) => session.id === currentActiveSessionId,
      )
        ? currentActiveSessionId
        : (activeBackendSessions[0]?.id ?? '');

      if (nextActiveSessionId !== currentActiveSessionId) {
        activeSessionIdRef.current = nextActiveSessionId;
        setActiveSessionId(nextActiveSessionId);
      }

      if (!nextActiveSessionId) {
        clearSessionScopedState();
      }

      return nextActiveSessionId;
    },
    [clearSessionScopedState],
  );

  const refreshSessions = useCallback(async (): Promise<void> => {
    const projectId = selectedProjectIdRef.current;
    if (!projectId) {
      setSessionsAsync(succeed([]));
      clearSessionScopedState();
      return;
    }

    setSessionsAsync(beginLoad);
    try {
      const backend = await chatSessionsApi.list('active', projectId);
      if (selectedProjectIdRef.current !== projectId) return;
      const ignoredSessionAgentIds = new Set(
        optimisticallyStoppedSessionAgentIdsRef.current,
      );
      const runningIndicators = await loadSessionRunningIndicators(
        backend.map((session) => session.id),
        ignoredSessionAgentIds,
      );
      if (selectedProjectIdRef.current !== projectId) return;

      sessionLeadAgentIdBySessionIdRef.current = {
        ...sessionLeadAgentIdBySessionIdRef.current,
        ...Object.fromEntries(
          backend.map((session) => [session.id, session.lead_agent_id]),
        ),
      };
      setChatInputModeBySessionId((prev) => ({
        ...prev,
        ...Object.fromEntries(
          backend.map((session) => [
            session.id,
            resolveChatInputMode(session.chat_input_mode),
          ]),
        ),
      }));

      const activeBackendSessions = backend;
      const nextActiveSessionId = syncActiveSessionSelection(
        activeBackendSessions,
      );
      const mapped = mapSessions(backend, nextActiveSessionId).map(
        (session) => {
          const indicators = runningIndicators.get(session.id);
          const hasRunningAgent = indicators?.hasRunningAgent ?? false;
          const pendingWorkflowInputId =
            indicators?.pendingWorkflowInputId ?? null;
          const pendingWorkflowReviewId =
            indicators?.pendingWorkflowReviewId ?? null;
          return {
            ...session,
            hasRunningAgent,
            hasRunningWorkflow: indicators?.hasRunningWorkflow ?? false,
            pendingWorkflowInputId,
            hasPendingWorkflowInput: syncSessionWorkflowInputIndicator(
              session.id,
              pendingWorkflowInputId,
            ),
            pendingWorkflowReviewId,
            hasPendingWorkflowReview: Boolean(pendingWorkflowReviewId),
            hasUnreadAgentCompletion: syncSessionAgentActivityIndicator(
              session.id,
              hasRunningAgent,
            ),
          };
        },
      );
      setSessionsAsync(succeed(mapped));
    } catch (err) {
      setSessionsAsync((prev) => fail(prev, err));
    }
  }, [
    clearSessionScopedState,
    syncActiveSessionSelection,
    syncSessionAgentActivityIndicator,
    syncSessionWorkflowInputIndicator,
  ]);

  const refreshArchivedSessions = useCallback(async (): Promise<void> => {
    const projectId = selectedProjectIdRef.current;
    if (!projectId) {
      setArchivedSessionsAsync(succeed([]));
      return;
    }

    setArchivedSessionsAsync(beginLoad);
    try {
      const backend = await chatSessionsApi.list('archived', projectId);
      if (selectedProjectIdRef.current !== projectId) return;
      setArchivedSessionsAsync(succeed(mapSessions(backend, null)));
    } catch (err) {
      setArchivedSessionsAsync((prev) => fail(prev, err));
    }
  }, []);

  const refreshSessionLists = useCallback(async (): Promise<void> => {
    await Promise.all([refreshSessions(), refreshArchivedSessions()]);
  }, [refreshArchivedSessions, refreshSessions]);

  const renameSession = useCallback(
    async (sessionId: string, title: string): Promise<void> => {
      const nextTitle = title.trim();
      if (!nextTitle) return;
      try {
        await chatSessionsApi.update(
          sessionId,
          chatSessionUpdatePayload({ title: nextTitle }),
        );
        await refreshSessionLists();
      } catch (err) {
        showToast(
          err instanceof Error
            ? `Rename failed: ${err.message}`
            : 'Rename failed.',
          'error',
        );
        throw err;
      }
    },
    [refreshSessionLists],
  );

  const archiveSession = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        await chatSessionsApi.archive(sessionId);
        await refreshSessionLists();
      } catch (err) {
        showToast(
          err instanceof Error
            ? `Archive failed: ${err.message}`
            : 'Archive failed.',
          'error',
        );
        throw err;
      }
    },
    [refreshSessionLists],
  );

  const pinSession = useCallback(
    async (sessionId: string, pinned: boolean): Promise<void> => {
      try {
        if (pinned) {
          await chatSessionsApi.pin(sessionId);
        } else {
          await chatSessionsApi.unpin(sessionId);
        }
        await refreshSessionLists();
      } catch (err) {
        showToast(
          err instanceof Error
            ? `Pin update failed: ${err.message}`
            : 'Pin update failed.',
          'error',
        );
        throw err;
      }
    },
    [refreshSessionLists],
  );

  const deleteSession = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        await chatSessionsApi.delete(sessionId);
        await refreshSessionLists();
      } catch (err) {
        showToast(
          err instanceof Error
            ? `Delete failed: ${err.message}`
            : 'Delete failed.',
          'error',
        );
        throw err;
      }
    },
    [refreshSessionLists],
  );

  const restoreSession = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        await chatSessionsApi.restore(sessionId);
        await refreshSessionLists();
      } catch (err) {
        showToast(
          err instanceof Error
            ? `Restore failed: ${err.message}`
            : 'Restore failed.',
          'error',
        );
        throw err;
      }
    },
    [refreshSessionLists],
  );

  const refreshMessages = useCallback(async (): Promise<void> => {
    const sid = activeSessionIdRef.current;
    const requestId = messagesRequestIdRef.current + 1;
    messagesRequestIdRef.current = requestId;
    const shouldUpdateActiveMessages = () =>
      messagesRequestIdRef.current === requestId &&
      activeSessionIdRef.current === sid;

    if (!sid) {
      if (shouldUpdateActiveMessages()) {
        setMessagesAsync(succeed([]));
      }
      return;
    }

    setMessagesAsync(beginLoad);
    try {
      const projectId = selectedProjectIdRef.current;
      const ignoredSessionAgentIds = new Set(
        optimisticallyStoppedSessionAgentIdsRef.current,
      );
      const [
        backendMsgs,
        backendAgents,
        sessionAgents,
        retention,
        projectMembers,
      ] =
        await Promise.all([
          chatMessagesApi.list(sid),
          chatAgentsApi
            .list(projectId ? { projectId } : undefined)
            .catch(() => []),
          sessionAgentsApi.list(sid).catch(() => []),
          chatRunsApi.listSessionRetention(sid, { limit: 100 }).catch(() => ({
            runs: [],
          })),
          projectId ? projectApi.listMembers(projectId).catch(() => []) : [],
        ]);
      const projectMemberNameByAgentId = new Map(
        projectMembers
          .filter((member) => member.agent_id && member.member_name?.trim())
          .map((member) => [
            member.agent_id as string,
            member.member_name as string,
          ]),
      );
      const agentNamesById: Record<string, string> = {};
      const agentModelsById: Record<string, string | null> = {};
      const sessionAgentByAgentId = new Map(
        sessionAgents.map((sessionAgent) => [
          sessionAgent.agent_id,
          sessionAgent,
        ]),
      );
      for (const a of backendAgents) {
        agentNamesById[a.id] = projectMemberNameByAgentId.get(a.id) ?? a.name;
        agentModelsById[a.id] = effectiveSessionAgentModelName(
          a,
          sessionAgentByAgentId.get(a.id),
        );
      }
      agentNamesByIdRef.current = agentNamesById;
      agentModelsByIdRef.current = agentModelsById;
      const mapped = filterDeferredQueuedUserMessages(
        mapMessages(backendMsgs, {
          agentNamesById,
          agentModelsById,
        }),
      );
      // Stop-requested agents keep their current placeholder visible, but REST
      // hydration must not create an additional running placeholder for the
      // same stopping run.
      const suppressedStoppedIds =
        optimisticallyStoppedSessionAgentIdsRef.current;
      setSessionRunningIndicator(
        sid,
        hasRunningSessionAgent(sessionAgents, ignoredSessionAgentIds),
      );
      const runningPlaceholders = (
        await hydrateRunningAgentPlaceholders(
          sessionAgents,
          backendAgents,
          retention.runs,
          projectMembers,
        )
      ).filter(
        (placeholder) =>
          !placeholder.sessionAgentId ||
          !suppressedStoppedIds.has(placeholder.sessionAgentId),
      );
      const activeSessionAgentIds = new Set(
        sessionAgents
          .filter(
            (sessionAgent) =>
              isActiveAgentState(sessionAgent.state) ||
              suppressedStoppedIds.has(sessionAgent.id),
          )
          .map((sessionAgent) => sessionAgent.id),
      );
      setAllMessages((prev) => {
        const current = filterDeferredQueuedUserMessages(
          filterMessagesForSession(sid, prev[sid] ?? []),
        );
        const next = resolveQuotedMessageReferences(
          mergePersistedWithRunningPlaceholders(
            mapped,
            current,
            activeSessionAgentIds,
            runningPlaceholders,
          ),
        );
        if (shouldUpdateActiveMessages()) {
          setMessagesAsync(succeed(next));
        }
        return { ...prev, [sid]: next };
      });
    } catch (err) {
      const mock = mockBootstrapRef.current?.messagesBySession[sid] ?? [];
      setAllMessages((prev) =>
        mock.length > 0 && !prev[sid] ? { ...prev, [sid]: mock } : prev,
      );
      if (shouldUpdateActiveMessages()) {
        setMessagesAsync((prev) => fail(prev, err, mock));
      }
    }
  }, [filterDeferredQueuedUserMessages, setSessionRunningIndicator]);

  // Mark a session agent as stop-requested without removing its visible
  // placeholder. The placeholder should switch directly to the backend's
  // persisted "Agent stopped" message, avoiding an empty gap while the stop
  // request propagates.
  const markSessionAgentStopped = useCallback((sessionAgentId: string) => {
    if (!sessionAgentId) return;
    optimisticallyStoppedSessionAgentIdsRef.current.add(sessionAgentId);
    const sid = activeSessionIdRef.current;
    if (!sid) return;
    const current = allMessagesRef.current[sid] ?? [];
    const hasRemainingRunningAgent = current.some(
      (message) =>
        message.isAgentRunning &&
        !isOptimisticPendingAgentPlaceholder(message) &&
        message.sessionAgentId !== sessionAgentId,
    );
    setSessionRunningIndicator(sid, hasRemainingRunningAgent);
  }, [setSessionRunningIndicator]);

  const mergeMemberQueueSnapshot = useCallback((queue: MemberQueueSnapshot) => {
    setMemberQueuesBySessionAgentId((prev) => ({
      ...prev,
      [queue.session_agent_id]: queue,
    }));
  }, []);

  const refreshMemberQueues = useCallback(async (): Promise<void> => {
    const sid = activeSessionIdRef.current;
    const requestId = queueRequestIdRef.current + 1;
    queueRequestIdRef.current = requestId;

    if (!sid) {
      setMemberQueuesBySessionAgentId({});
      return;
    }

    try {
      const response = await chatQueuesApi.listSession(sid);
      if (
        queueRequestIdRef.current !== requestId ||
        activeSessionIdRef.current !== sid
      ) {
        return;
      }
      setMemberQueuesBySessionAgentId((prev) => {
        const next = { ...prev };
        for (const [sessionAgentId, queue] of Object.entries(next)) {
          if (queue.session_id === sid) {
            delete next[sessionAgentId];
          }
        }
        for (const queue of response.members) {
          next[queue.session_agent_id] = queue;
        }
        return next;
      });
    } catch {
      // Queue state is auxiliary UI; message/member refresh remains authoritative.
    }
  }, []);

  const deleteQueuedMessage = useCallback(
    async (sessionId: string, queueId: string): Promise<void> => {
      const response = await chatQueuesApi.deleteQueued(sessionId, queueId);
      mergeMemberQueueSnapshot(response.queue);
      // When the backend also removed the underlying chat_messages row, drop the matching
      // message from the visible conversation so it disappears without a manual refresh.
      const deletedMessageId = response.deleted_chat_message_id;
      if (deletedMessageId) {
        setAllMessages((prev) => {
          const current = filterMessagesForSession(
            sessionId,
            prev[sessionId] ?? [],
          );
          const updated = current.filter(
            (message) => message.id !== deletedMessageId,
          );
          if (updated.length === current.length) return prev;
          const next = { ...prev, [sessionId]: updated };
          setMessagesAsync(succeed(updated));
          return next;
        });
      }
    },
    [mergeMemberQueueSnapshot],
  );

  const continueMemberQueue = useCallback(
    async (sessionId: string, sessionAgentId: string): Promise<void> => {
      const response = await chatQueuesApi.continueMember(
        sessionId,
        sessionAgentId,
      );
      mergeMemberQueueSnapshot(response.queue);
    },
    [mergeMemberQueueSnapshot],
  );

  const stageOptimisticQueuedMessage = useCallback(
    (sessionId: string, sessionAgentId: string, chatMessageId: string) => {
      const now = new Date().toISOString();
      const optimisticQueueId = `optimistic-queue-${chatMessageId}`;
      setMemberQueuesBySessionAgentId((prev) => {
        const current = prev[sessionAgentId];
        const currentForSession =
          current?.session_id === sessionId ? current : undefined;
        if (
          currentForSession?.items.some(
            (item) => item.message.id === optimisticQueueId,
          )
        ) {
          return prev;
        }
        const items = [
          ...(currentForSession?.items ?? []),
          {
            message: {
              id: optimisticQueueId,
              session_id: sessionId,
              session_agent_id: sessionAgentId,
              agent_id: currentForSession?.agent_id ?? '',
              chat_message_id: chatMessageId,
              status: 'queued' as QueuedMessageStatus,
              created_at: now,
              updated_at: now,
              processing_started_at: null,
              run_id: null,
              failure_reason: null,
            },
            can_delete: false,
          },
        ];
        return {
          ...prev,
          [sessionAgentId]: {
            session_id: sessionId,
            session_agent_id: sessionAgentId,
            agent_id: currentForSession?.agent_id ?? '',
            status:
              currentForSession && currentForSession.status !== 'empty'
                ? currentForSession.status
                : 'queued',
            blocked: currentForSession?.blocked ?? false,
            paused: currentForSession?.paused ?? false,
            can_continue: currentForSession?.can_continue ?? false,
            queued_count: BigInt(
              items.filter((item) => String(item.message.status) === 'queued')
                .length,
            ),
            items,
          },
        };
      });
    },
    [],
  );

  const refreshMembers = useCallback(async (): Promise<void> => {
    const sid = activeSessionIdRef.current;
    if (!sid) {
      setMembersAsync(succeed([]));
      setMainAgentName(null);
      return;
    }

    setMembersAsync(beginLoad);
    try {
      const projectId = selectedProjectIdRef.current;
      const ignoredSessionAgentIds = new Set(
        optimisticallyStoppedSessionAgentIdsRef.current,
      );
      const [agents, sessionAgents, projectMembers] = await Promise.all([
        chatAgentsApi.list(projectId ? { projectId } : undefined),
        sessionAgentsApi.list(sid).catch(() => []),
        projectId ? projectApi.listMembers(projectId).catch(() => []) : [],
      ]);
      setSessionRunningIndicator(
        sid,
        hasRunningSessionAgent(sessionAgents, ignoredSessionAgentIds),
      );
      const mainAgentId = resolveProjectMainAgentId(projectMembers);
      const mainAgentName = resolveProjectMainAgentName(projectMembers, agents);
      const hasMainAgentInSession =
        !!mainAgentId &&
        sessionAgents.some((sessionAgent) => sessionAgent.agent_id === mainAgentId);
      workflowRouteAgentIdRef.current = hasMainAgentInSession
        ? mainAgentId
        : null;
      setMainAgentName(mainAgentName);
      if (mainAgentId && hasMainAgentInSession) {
        void syncSessionLeadAgent(sid, mainAgentId);
      }
      const projectMemberNameByAgentId = new Map(
        projectMembers
          .filter((member) => member.agent_id && member.member_name?.trim())
          .map((member) => [
            member.agent_id as string,
            member.member_name as string,
          ]),
      );
      agentNamesByIdRef.current = Object.fromEntries(
        agents.map((agent) => [
          agent.id,
          projectMemberNameByAgentId.get(agent.id) ?? agent.name,
        ]),
      );
      const sessionAgentByAgentId = new Map(
        sessionAgents.map((sessionAgent) => [
          sessionAgent.agent_id,
          sessionAgent,
        ]),
      );
      agentModelsByIdRef.current = Object.fromEntries(
        agents.map((agent) => [
          agent.id,
          effectiveSessionAgentModelName(
            agent,
            sessionAgentByAgentId.get(agent.id),
          ),
        ]),
      );
      const mapped = mapSessionAgentsToMembers(
        sessionAgents,
        agents,
        projectMembers,
      );
      setMembersAsync(succeed(mapped));
    } catch (err) {
      workflowRouteAgentIdRef.current = null;
      setMainAgentName(mockBootstrapRef.current?.members[0]?.name ?? null);
      setMembersAsync((prev) =>
        fail(prev, err, mockBootstrapRef.current?.members ?? []),
      );
    }
  }, [setSessionRunningIndicator, syncSessionLeadAgent]);

  const refreshProviders = useCallback(async (): Promise<void> => {
    setProvidersAsync(beginLoad);
    try {
      const [infos, cliConfig] = await Promise.all([
        cliConfigApi.listProviders(),
        cliConfigApi.getConfig().catch(() => null),
      ]);
      const mapped = mapProviders(infos, cliConfig);
      setProvidersAsync(succeed(mapped));
    } catch (err) {
      setProvidersAsync((prev) =>
        fail(prev, err, mockBootstrapRef.current?.providers ?? []),
      );
    }
  }, []);

  const refreshSkills = useCallback(async (): Promise<void> => {
    setSkillsAsync(beginLoad);
    try {
      const list = await skillsApi.list();
      setSkillsAsync(succeed(list));
    } catch (err) {
      setSkillsAsync((prev) => fail(prev, err, []));
    }
  }, []);

  const refreshConfig = useCallback(async (): Promise<void> => {
    setConfigAsync(beginLoad);
    try {
      const info = await systemApi.getInfo();
      setConfigAsync(succeed(info.config));
    } catch (err) {
      setConfigAsync((prev) => fail(prev, err, null));
    }
  }, []);

  const refreshWorkflowCard = useCallback(
    async (messageId: string): Promise<void> => {
      setWorkflowCardAsync(beginLoad);
      try {
        const card = await chatMessagesApi.getWorkflowCard(messageId, 'full');
        setWorkflowCardAsync(succeed(card));
      } catch (err) {
        setWorkflowCardAsync((prev) => fail(prev, err, null));
      }
    },
    [],
  );

  const refreshSessionWorkflowRunningIndicator = useCallback(
    async (sessionId: string): Promise<void> => {
      if (!sessionId) return;
      try {
        const status = await workflowApi.getSessionStatus(sessionId);
        setSessionWorkflowStatusIndicators(sessionId, status);
      } catch {
        // Sidebar status is best-effort; card/message refresh remains primary.
      }
    },
    [setSessionWorkflowStatusIndicators],
  );

  const refreshSessionRunningIndicators = useCallback(
    async (sessionId: string): Promise<void> => {
      if (!sessionId) return;
      const ignoredSessionAgentIds = new Set(
        optimisticallyStoppedSessionAgentIdsRef.current,
      );
      const [sessionAgents, workflowStatus] = await Promise.all([
        sessionAgentsApi.list(sessionId).catch(() => null),
        workflowApi.getSessionStatus(sessionId).catch(() => null),
      ]);

      if (sessionAgents) {
        setSessionRunningIndicator(
          sessionId,
          hasRunningSessionAgent(sessionAgents, ignoredSessionAgentIds),
        );
      }
      if (workflowStatus) {
        setSessionWorkflowStatusIndicators(sessionId, workflowStatus);
      }
    },
    [setSessionRunningIndicator, setSessionWorkflowStatusIndicators],
  );

  useEffect(() => {
    if (sessionsAsync.source !== 'api') return;

    const runningSidebarSessionIds = sessionsAsync.data
      .filter(
        (session) =>
          session.id !== activeSessionId &&
          Boolean(
            session.hasRunningAgent ||
              session.hasRunningWorkflow ||
              session.hasPendingWorkflowInput ||
              session.hasPendingWorkflowReview,
          ),
      )
      .map((session) => session.id);
    if (runningSidebarSessionIds.length === 0) return;

    const refreshRunningSidebarSessions = () => {
      for (const sessionId of runningSidebarSessionIds) {
        void refreshSessionRunningIndicators(sessionId);
      }
    };

    refreshRunningSidebarSessions();
    const intervalId = window.setInterval(
      refreshRunningSidebarSessions,
      SIDEBAR_RUNNING_INDICATOR_POLL_MS,
    );
    return () => window.clearInterval(intervalId);
  }, [
    activeSessionId,
    refreshSessionRunningIndicators,
    sessionsAsync.data,
    sessionsAsync.source,
  ]);

  const resetWorkspaceChanges = useCallback(() => {
    workspaceChangesRequestIdRef.current += 1;
    setWorkspaceChangesAsync(initialAsync(null));
  }, []);

  const refreshWorkspaceChanges = useCallback(
    async (
      sessionId: string,
      path: string,
      includeDiff?: boolean,
    ): Promise<void> => {
      const requestId = workspaceChangesRequestIdRef.current + 1;
      workspaceChangesRequestIdRef.current = requestId;
      setWorkspaceChangesAsync(beginLoad);
      try {
        const resp = await chatSessionsApi.getWorkspaceChanges(
          sessionId,
          path,
          includeDiff,
        );
        if (workspaceChangesRequestIdRef.current !== requestId) return;
        setWorkspaceChangesAsync(succeed(resp));
      } catch (err) {
        if (workspaceChangesRequestIdRef.current !== requestId) return;
        setWorkspaceChangesAsync((prev) => fail(prev, err, null));
      }
    },
    [],
  );

  const refreshAll = useCallback(async (): Promise<void> => {
    await refreshProjects();
    await Promise.all([
      refreshSessions(),
      refreshArchivedSessions(),
      refreshProviders(),
      refreshSkills(),
      refreshConfig(),
      refreshMembers(),
      refreshMessages(),
      refreshMemberQueues(),
    ]);
  }, [
    refreshSessions,
    refreshArchivedSessions,
    refreshProjects,
    refreshProviders,
    refreshSkills,
    refreshConfig,
    refreshMembers,
    refreshMessages,
    refreshMemberQueues,
  ]);

  // Initial load: hydrate local mock API data first, then try backend-backed
  // resources. Backend failures keep the mock API payload visible.
  useEffect(() => {
    void (async () => {
      const bootstrap = await mockFrontendApi.getWorkspaceBootstrap();
      applyMockBootstrap(bootstrap);
      await refreshAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mapBackendChatMessage = useCallback(
    (message: BackendChatMessage): Message =>
      mapMessage(message, {
        agentNamesById: agentNamesByIdRef.current,
        agentModelsById: agentModelsByIdRef.current,
      }),
    [],
  );

  const insertDeferredQueuedUserMessage = useCallback(
    (sid: string, runId: string, message: Message) => {
      setAllMessages((prev) => {
        const current = filterMessagesForSession(sid, prev[sid] ?? []);
        const clientMessageId = userMessageClientId(message);
        const withoutExistingUserMessage = current.filter(
          (candidate) =>
            !matchesUserMessageIdentity(
              candidate,
              message.id,
              clientMessageId,
            ),
        );

        const runIndex = withoutExistingUserMessage.findIndex(
          (candidate) => candidate.isAgentRunning && candidate.runId === runId,
        );
        const next = [...withoutExistingUserMessage];
        next.splice(runIndex >= 0 ? runIndex : next.length, 0, message);
        return { ...prev, [sid]: resolveQuotedMessageReferences(next) };
      });
    },
    [],
  );

  const revealDeferredQueuedBackendMessage = useCallback(
    async (
      event: Extract<ChatStreamEvent, { type: 'agent_run_started' }>,
    ): Promise<void> => {
      try {
        const backendMessage = await chatMessagesApi.get(
          event.source_message_id,
        );
        insertDeferredQueuedUserMessage(
          event.session_id,
          event.run_id,
          mapBackendChatMessage(backendMessage),
        );
      } catch {
        // Queue reveal is best-effort; the running agent placeholder still shows.
      }
    },
    [insertDeferredQueuedUserMessage, mapBackendChatMessage],
  );

  const upsertStreamedMessage = useCallback(
    (sid: string, incoming: Message) => {
      setAllMessages((prev) => {
        const current = filterMessagesForSession(sid, prev[sid] ?? []);
        let carriedLines: ChatRunActivityLine[] | undefined;
        let carriedState = incoming.activityLoadState;
        let carriedSessionAgentId = incoming.sessionAgentId;
        let carriedSourceMessageId = incoming.sourceMessageId;
        let carriedClientMessageId = incoming.clientMessageId;
        const hasMatchingRun = Boolean(
          incoming.runId &&
          current.some(
            (message) =>
              message.runId === incoming.runId && message.isAgentRunning,
          ),
        );
        const hasMatchingClientMessage = Boolean(
          !incoming.isUser &&
            incoming.clientMessageId &&
            current.some(
              (message) =>
                message.isAgentRunning &&
                message.clientMessageId === incoming.clientMessageId,
            ),
        );
        const hasMatchingSessionAgent = Boolean(
          !incoming.isUser &&
            !hasMatchingRun &&
            !hasMatchingClientMessage &&
            incoming.sessionAgentId &&
            current.some(
              (message) =>
                message.isAgentRunning &&
                message.sessionAgentId === incoming.sessionAgentId,
            ),
        );
        const fallbackPendingIndex =
          !incoming.isUser &&
          !hasMatchingRun &&
          !hasMatchingClientMessage &&
          !hasMatchingSessionAgent
            ? findPendingAgentPlaceholderIndex(current, {
                sessionAgentId: incoming.sessionAgentId,
                clientMessageId: incoming.clientMessageId,
                sourceMessageId: incoming.sourceMessageId,
              })
            : -1;
        let replacementIndex: number | null = null;
        const withoutPlaceholder = current.filter((message, index) => {
          const isMatchingRun =
            incoming.runId &&
            message.runId === incoming.runId &&
            message.isAgentRunning;
          const isMatchingClientMessage =
            !incoming.isUser &&
            !isMatchingRun &&
            hasMatchingClientMessage &&
            incoming.clientMessageId &&
            message.isAgentRunning &&
            message.clientMessageId === incoming.clientMessageId;
          const isMatchingSessionAgent =
            !incoming.isUser &&
            !isMatchingRun &&
            !isMatchingClientMessage &&
            hasMatchingSessionAgent &&
            incoming.sessionAgentId &&
            message.isAgentRunning &&
            message.sessionAgentId === incoming.sessionAgentId;
          const isPendingRun =
            !incoming.isUser &&
            !hasMatchingRun &&
            !hasMatchingSessionAgent &&
            fallbackPendingIndex >= 0 &&
            current[fallbackPendingIndex]?.id === message.id;
          if (
            isMatchingRun ||
            isMatchingClientMessage ||
            isMatchingSessionAgent ||
            isPendingRun
          ) {
            replacementIndex =
              replacementIndex === null
                ? index
                : Math.min(replacementIndex, index);
            carriedLines = message.activityLines;
            carriedState = message.activityLoadState ?? 'loaded';
            carriedSessionAgentId =
              carriedSessionAgentId ?? message.sessionAgentId;
            carriedSourceMessageId =
              carriedSourceMessageId ?? message.sourceMessageId;
            carriedClientMessageId =
              carriedClientMessageId ?? message.clientMessageId;
            return false;
          }
          return true;
        });
        const nextMessage: Message = {
          ...incoming,
          activityLines: carriedLines ?? incoming.activityLines,
          activityLoadState: carriedState,
          sessionAgentId: carriedSessionAgentId,
          sourceMessageId: carriedSourceMessageId,
          clientMessageId: carriedClientMessageId,
          isAgentRunning: undefined,
          isThinking: undefined,
        };
        if (!nextMessage.isUser && nextMessage.sessionAgentId) {
          optimisticallyStoppedSessionAgentIdsRef.current.delete(
            nextMessage.sessionAgentId,
          );
        }
        const nextClientMessageId = userMessageClientId(nextMessage);
        const existingIndex = withoutPlaceholder.findIndex((message) => {
          if (message.id === nextMessage.id) return true;
          return (
            nextMessage.isUser &&
            nextClientMessageId !== undefined &&
            userMessageClientId(message) === nextClientMessageId
          );
        });
        const next =
          existingIndex >= 0
            ? withoutPlaceholder.map((message, index) =>
                index === existingIndex ? nextMessage : message,
              )
            : (() => {
                const inserted = [...withoutPlaceholder];
                inserted.splice(
                  replacementIndex === null
                    ? inserted.length
                    : Math.min(replacementIndex, inserted.length),
                  0,
                  nextMessage,
                );
                return inserted;
              })();
        const correlatedNext =
          nextMessage.isUser && nextClientMessageId
            ? next.map((message) =>
                isPendingAgentPlaceholder(message) &&
                message.clientMessageId === nextClientMessageId
                  ? { ...message, sourceMessageId: nextMessage.id }
                  : message,
              )
            : next;
        return {
          ...prev,
          [sid]: resolveQuotedMessageReferences(
            orderMessagesForConversation(correlatedNext),
          ),
        };
      });
    },
    [],
  );

  const appendStreamActivityLine = useCallback((line: ChatRunActivityLine) => {
    setAllMessages((prev) => {
      const current = filterMessagesForSession(
        line.session_id,
        prev[line.session_id] ?? [],
      );
      const existingIndex = current.findIndex(
        (message) => message.runId === line.run_id,
      );
      const mergeLine = (message: Message): Message => {
        const lines = message.activityLines ?? [];
        if (lines.some((item) => item.line_id === line.line_id)) {
          return message;
        }
        const nextLines = [...lines, line].sort((a, b) => {
          if (a.sequence !== b.sequence) return a.sequence - b.sequence;
          return a.line_id.localeCompare(b.line_id);
        });
        return {
          ...message,
          activityLines: nextLines,
          activityLoadState: 'idle',
        };
      };

      if (existingIndex >= 0) {
        const next = current.map((message, index) =>
          index === existingIndex ? mergeLine(message) : message,
        );
        return { ...prev, [line.session_id]: next };
      }

      // Ignore trailing activity from a run the user just stopped: do not
      // resurrect a running placeholder for an optimistically-stopped agent.
      // A genuinely new run always emits agent_run_started first, which clears
      // the suppression before its first activity line arrives.
      if (
        optimisticallyStoppedSessionAgentIdsRef.current.has(
          line.session_agent_id,
        )
      ) {
        return prev;
      }

      const agentName = line.agent_name.startsWith('@')
        ? line.agent_name
        : `@${line.agent_name}`;
      const placeholder: Message = {
        id: `run-${line.run_id}`,
        sessionId: line.session_id,
        avatar: monogramFromName(line.agent_name),
        sender: agentName,
        model: agentModelsByIdRef.current[line.agent_id] ?? undefined,
        time: 'just now',
        createdAt: line.created_at,
        text: '',
        isThinking: true,
        isAgentRunning: true,
        runId: line.run_id,
        sessionAgentId: line.session_agent_id,
        activityLines: [line],
        activityLoadState: 'idle',
      };
      // Evict any stale running placeholder for a different run of the same
      // agent before placing the new one (see evictStaleRunPlaceholders).
      const pruned = evictStaleRunPlaceholders(
        current,
        line.session_agent_id,
        line.run_id,
      );
      const pendingIndex = findPendingAgentPlaceholderIndex(
        pruned,
        { sessionAgentId: line.session_agent_id },
      );
      if (pendingIndex >= 0) {
        const next = pruned.map((message, index) =>
          index === pendingIndex ? placeholder : message,
        );
        return { ...prev, [line.session_id]: next };
      }
        return {
          ...prev,
          [line.session_id]: orderMessagesForConversation([
            ...pruned,
            placeholder,
          ]),
        };
    });
  }, []);

  const insertRunningPlaceholder = useCallback(
    (event: Extract<ChatStreamEvent, { type: 'agent_run_started' }>) => {
      // A new run for this agent supersedes any optimistic-stop suppression.
      optimisticallyStoppedSessionAgentIdsRef.current.delete(
        event.session_agent_id,
      );
      setSessionRunningIndicator(event.session_id, true);
      const wasDeferredQueuedUserMessage = hasDeferredQueuedUserMessage(
        event.source_message_id,
        event.client_message_id,
      );
      const deferredUserMessage = wasDeferredQueuedUserMessage
        ? releaseDeferredQueuedUserMessage(
            event.source_message_id,
            event.client_message_id,
          )
        : null;
      const releasedUserMessage = deferredUserMessage
        ? {
            ...deferredUserMessage,
            id: event.source_message_id,
            sessionId: event.session_id,
            clientMessageId:
              event.client_message_id ?? deferredUserMessage.clientMessageId,
          }
        : null;
      if (wasDeferredQueuedUserMessage && !releasedUserMessage) {
        void revealDeferredQueuedBackendMessage(event);
      }
      setAllMessages((prev) => {
        const current = filterMessagesForSession(
          event.session_id,
          prev[event.session_id] ?? [],
        );
        const releasedUserClientMessageId = releasedUserMessage
          ? userMessageClientId(releasedUserMessage)
          : undefined;
        const currentWithoutReleasedUser = releasedUserMessage
          ? current.filter(
              (message) =>
                !matchesUserMessageIdentity(
                  message,
                  releasedUserMessage.id,
                  releasedUserClientMessageId,
                ),
            )
          : current;
        const existingRunIndex = currentWithoutReleasedUser.findIndex(
          (message) => message.runId === event.run_id,
        );
        if (existingRunIndex >= 0) {
          if (!releasedUserMessage) {
            return prev;
          }
          const next = [...currentWithoutReleasedUser];
          next.splice(existingRunIndex, 0, releasedUserMessage);
          return {
            ...prev,
            [event.session_id]: resolveQuotedMessageReferences(next),
          };
        }
        const agentName = event.agent_name.startsWith('@')
          ? event.agent_name
          : `@${event.agent_name}`;
        const placeholder: Message = {
          id: `run-${event.run_id}`,
          sessionId: event.session_id,
          avatar: monogramFromName(event.agent_name),
          sender: agentName,
          model: agentModelsByIdRef.current[event.agent_id] ?? undefined,
          time: 'just now',
          createdAt: event.started_at ?? new Date().toISOString(),
          text: '',
          isThinking: true,
          isAgentRunning: true,
          runId: event.run_id,
          sessionAgentId: event.session_agent_id,
          sourceMessageId: event.source_message_id,
          clientMessageId: event.client_message_id ?? undefined,
          activityLines: [],
          activityLoadState: 'idle',
        };
        // Evict any stale running placeholder for a different run of the same
        // agent before placing the new one (see evictStaleRunPlaceholders).
        const pruned = evictStaleRunPlaceholders(
          currentWithoutReleasedUser,
          event.session_agent_id,
          event.run_id,
        );
        const withReleasedUser =
          releasedUserMessage &&
          !pruned.some(
            (message) =>
              matchesUserMessageIdentity(
                message,
                releasedUserMessage.id,
                releasedUserClientMessageId,
              ),
          )
            ? [...pruned, releasedUserMessage]
            : pruned;
        const pendingIndex = findPendingAgentPlaceholderIndex(withReleasedUser, {
          sessionAgentId: event.session_agent_id,
          sourceMessageId: event.source_message_id,
          clientMessageId: event.client_message_id,
        });
        if (pendingIndex >= 0) {
          const next = withReleasedUser.map((message, index) =>
            index === pendingIndex ? placeholder : message,
          );
          return { ...prev, [event.session_id]: next };
        }
        return {
          ...prev,
          [event.session_id]: orderMessagesForConversation([
            ...withReleasedUser,
            placeholder,
          ]),
        };
      });
    },
    [
      hasDeferredQueuedUserMessage,
      releaseDeferredQueuedUserMessage,
      revealDeferredQueuedBackendMessage,
      setSessionRunningIndicator,
    ],
  );

  const handleWorkflowRuntimeLine = useCallback(
    (event: Extract<ChatStreamEvent, { type: 'workflow_runtime_line' }>) => {
      setWorkflowRuntimeLinesByExecution((prev) => {
        const executionLines = prev[event.execution_id] ?? [];
        if (executionLines.some((line) => line.id === event.line_id)) {
          return prev;
        }

        return {
          ...prev,
          [event.execution_id]: [
            ...executionLines,
            {
              id: event.line_id,
              executionId: event.execution_id,
              workflowAgentSessionId: event.workflow_agent_session_id,
              stepId: event.step_id,
              stepKey: event.step_key,
              agentId: event.agent_id,
              agentName: event.agent_name,
              streamType: event.stream_type,
              content: event.content,
              createdAt: event.created_at,
            },
          ],
        };
      });
    },
    [],
  );

  // When the active session changes, re-fetch its scoped data.
  useEffect(() => {
    if (!activeSessionId) return;
    void refreshMessages();
    void refreshMembers();
    void refreshMemberQueues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId || sessionsAsync.source !== 'api') return;

    const sid = activeSessionId;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let hasConnectedOnce = false;
    let disposed = false;

    const handleMessage = (event: MessageEvent) => {
      let parsed: ChatStreamEvent;
      try {
        parsed = JSON.parse(event.data) as ChatStreamEvent;
      } catch {
        return;
      }

      if (parsed.type === 'agent_run_started' && parsed.session_id === sid) {
        insertRunningPlaceholder(parsed);
        return;
      }

      if (
        parsed.type === 'agent_activity_line' &&
        parsed.line.session_id === sid
      ) {
        appendStreamActivityLine(parsed.line);
        return;
      }

      if (
        parsed.type === 'workflow_runtime_line' &&
        parsed.session_id === sid
      ) {
        setSessionWorkflowRunningIndicator(sid, true);
        handleWorkflowRuntimeLine(parsed);
        return;
      }

      if (
        parsed.type === 'workflow_execution_updated' &&
        parsed.session_id === sid
      ) {
        void refreshSessionRunningIndicators(sid);
        return;
      }

      if (
        parsed.type === 'file_change_refresh' &&
        parsed.session_id === sid
      ) {
        notifySourceControlRefreshRequested({
          projectId: selectedProjectIdRef.current,
          sessionId: sid,
        });
        const workspacePath = activeWorkspacePathRef.current;
        if (workspacePath) {
          void refreshWorkspaceChanges(sid, workspacePath, true);
        }
        return;
      }

      if (parsed.type === 'queue_updated' && parsed.session_id === sid) {
        mergeMemberQueueSnapshot(parsed.queue);
        return;
      }

      if (
        (parsed.type === 'message_new' || parsed.type === 'message_updated') &&
        parsed.message.session_id === sid
      ) {
        const tokenUsageSignature = tokenUsageNotificationSignature(
          parsed.message,
        );
        if (
          tokenUsageSignature &&
          notifiedTokenUsageSignaturesRef.current[parsed.message.id] !==
            tokenUsageSignature
        ) {
          notifiedTokenUsageSignaturesRef.current[parsed.message.id] =
            tokenUsageSignature;
          const projectId = selectedProjectIdRef.current;
          if (projectId) {
            notifyBuildStatsUsageUpdated(projectId);
          }
        }
        const incomingMessage = mapBackendChatMessage(parsed.message);
        if (isDeferredQueuedUserMessage(incomingMessage)) {
          rememberDeferredQueuedUserMessage(incomingMessage);
          return;
        }
        upsertStreamedMessage(sid, incomingMessage);
        return;
      }

      if (parsed.type === 'agent_state') {
        const wasStopRequested =
          optimisticallyStoppedSessionAgentIdsRef.current.has(
            parsed.session_agent_id,
          );
        if (isRunningSessionAgentState(parsed.state)) {
          setSessionRunningIndicator(sid, true);
        } else {
          const hasRemainingRunningAgent = (
            allMessagesRef.current[sid] ?? []
          ).some(
            (message) =>
              message.isAgentRunning &&
              message.sessionAgentId !== parsed.session_agent_id &&
              !isOptimisticPendingAgentPlaceholder(message),
          );
          setSessionRunningIndicator(sid, hasRemainingRunningAgent);
          void refreshSessionRunningIndicators(sid);
        }
        void refreshMembers();

        // When an agent leaves an active run state,
        // clear only placeholders tied to that concrete run. Optimistic
        // pending placeholders represent newly sent/queued messages and must
        // survive stale idle/dead events from an earlier run.
        if (!isActiveAgentState(parsed.state) && !wasStopRequested) {
          setAllMessages((prev) => {
            const current = filterMessagesForSession(sid, prev[sid] ?? []);
            if (current.length === 0) return prev;
            const updated = current.filter(
              (msg) =>
                !(
                  msg.isAgentRunning &&
                  msg.sessionAgentId === parsed.session_agent_id &&
                  !isOptimisticPendingAgentPlaceholder(msg) &&
                  (!parsed.run_id ||
                    !msg.runId ||
                    msg.runId === parsed.run_id)
                ),
            );
            if (updated.length === current.length) return prev;
            return { ...prev, [sid]: updated };
          });
        }
        return;
      }

      if (parsed.type === 'mention_error' && parsed.session_id === sid) {
        setAllMessages((prev) => {
          const current = filterMessagesForSession(sid, prev[sid] ?? []);
          if (current.length === 0) return prev;
          const updated = current.filter(
            (msg) =>
              !(
                isOptimisticPendingAgentPlaceholder(msg) &&
                msg.sourceMessageId === parsed.message_id
              ),
          );
          if (updated.length === current.length) return prev;
          return { ...prev, [sid]: updated };
        });
      }
    };

    // Open the stream and keep it alive across transient drops. The stream has
    // no server-side replay, so on every *re*connect we re-hydrate the session
    // via REST to recover any persisted messages emitted while we were down.
    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(
        chatStreamWebSocketUrl(chatSessionsApi.streamUrl(sid)),
      );
      socket = ws;
      ws.onmessage = handleMessage;
      ws.onopen = () => {
        reconnectAttempt = 0;
        if (hasConnectedOnce) {
          void refreshMessages();
          void refreshMembers();
          void refreshMemberQueues();
          const workspacePath = activeWorkspacePathRef.current;
          if (workspacePath) {
            void refreshWorkspaceChanges(sid, workspacePath, true);
          }
        }
        hasConnectedOnce = true;
      };
      ws.onclose = () => {
        // Ignore the close of a superseded socket or one closed by cleanup.
        if (disposed || socket !== ws) return;
        const delay = Math.min(
          CHAT_STREAM_RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt,
          CHAT_STREAM_RECONNECT_MAX_DELAY_MS,
        );
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
      // Let onclose drive the reconnect; just tear the socket down on error.
      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
    };
  }, [
    activeSessionId,
    appendStreamActivityLine,
    handleWorkflowRuntimeLine,
    insertRunningPlaceholder,
    isDeferredQueuedUserMessage,
    mapBackendChatMessage,
    mergeMemberQueueSnapshot,
    rememberDeferredQueuedUserMessage,
    refreshMessages,
    refreshMemberQueues,
    refreshSessionRunningIndicators,
    refreshSessionWorkflowRunningIndicator,
    refreshWorkspaceChanges,
    refreshMembers,
    setSessionRunningIndicator,
    setSessionWorkflowRunningIndicator,
    sessionsAsync.source,
    upsertStreamedMessage,
  ]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions, selectedProjectId]);

  // ---------------------------------------------------------------------------
  // i18n
  // ---------------------------------------------------------------------------

  const t = useCallback(
    (key: string, replacements?: Record<string, string | number>): string => {
      const dict = i18nDict[locale] || i18nDict['en'];
      let val = dict[key] || i18nDict['en'][key] || key;
      if (replacements) {
        Object.entries(replacements).forEach(([k, v]) => {
          val = val.replace(`{${k}}`, String(v));
        });
      }
      return val;
    },
    [locale],
  );

  const sessions = sessionsAsync.data;
  const projects = projectsAsync.data;
  const members = membersAsync.data;
  const providers = providersAsync.data;
  const messages = activeSessionId
    ? filterDeferredQueuedUserMessages(
        filterMessagesForSession(
          activeSessionId,
          allMessages[activeSessionId] ?? [],
        ),
      )
    : [];

  // ---------------------------------------------------------------------------
  // sendMessage: try the real API first; fall back to mock cascade when the
  // backend is unavailable, the session is mock-only, or the request errors.
  // ---------------------------------------------------------------------------

  const dispatchMockReply = (
    text: string,
    sessionId = activeSessionIdRef.current,
  ) => {
    const words = text.split(/\s+/);
    const mentions = words.filter((w) => w.startsWith('@'));
    let responderMention = '@claude';
    if (mentions.length > 0) {
      responderMention = mentions[0].toLowerCase();
    } else if (
      text.toLowerCase().includes('bug') ||
      text.toLowerCase().includes('fix')
    ) {
      responderMention = '@codex';
    } else if (
      text.toLowerCase().includes('test') ||
      text.toLowerCase().includes('check')
    ) {
      responderMention = '@qa';
    } else if (
      text.toLowerCase().includes('front') ||
      text.toLowerCase().includes('css') ||
      text.toLowerCase().includes('ui')
    ) {
      responderMention = '@frontend';
    }

    let responderName = responderMention;
    let responderAvatar = 'CL';
    let responderLabel = 'Claude';
    if (responderMention === '@codex') {
      responderAvatar = 'CO';
      responderName = '@codex';
      responderLabel = 'Codex';
    } else if (responderMention === '@frontend') {
      responderAvatar = 'FE';
      responderName = '@frontend';
      responderLabel = 'Cursor';
    } else if (responderMention === '@qa') {
      responderAvatar = 'QA';
      responderName = '@qa';
      responderLabel = 'Gemini';
    } else if (responderMention === '@lead' || responderMention === '@claude') {
      responderAvatar = 'LD';
      responderName = '@lead';
      responderLabel = 'Claude';
    }

    const thinMsgId = `msg-thin-${Date.now()}`;
    const sid = sessionId;
    const thinkingMsg: Message = {
      id: thinMsgId,
      sessionId: sid,
      avatar: responderAvatar,
      sender: responderName,
      model: responderLabel,
      time: 'just now',
      text: '',
      isThinking: true,
    };

    setTimeout(() => {
      setAllMessages((prev) => {
        const cur = filterMessagesForSession(sid, prev[sid] ?? []);
        return { ...prev, [sid]: [...cur, thinkingMsg] };
      });
      setTimeout(() => {
        const candidates =
          mockAgentRepliesByMention[responderMention] ||
          mockAgentRepliesByMention['default'];
        const idx = Math.floor(Math.random() * candidates.length);
        const replyText = candidates[idx];
        const costVal = (Math.random() * 0.12 + 0.02).toFixed(3);
        const tokenNum = Math.floor(Math.random() * 1500 + 400);
        const realReplyMsg: Message = {
          id: `msg-agent-${Date.now()}`,
          sessionId: sid,
          avatar: responderAvatar,
          sender: responderName,
          model: responderLabel,
          time: 'just now',
          text: replyText,
          cost: `$${costVal} 路 ${tokenNum} tokens`,
        };
        setAllMessages((prev) => {
          const cur = filterMessagesForSession(sid, prev[sid] ?? []);
          const base = cur.filter((m) => m.id !== thinMsgId);
          return { ...prev, [sid]: [...base, realReplyMsg] };
        });
        setWeeklyCost((prev) =>
          parseFloat((prev + parseFloat(costVal)).toFixed(2)),
        );
      }, 1500);
    }, 600);
  };

  const stagePendingAgentPlaceholder = (
    sessionId: string,
    text: string,
    options: SendMessageOptions = {},
  ) => {
    const shouldUseBackend =
      sessionsAsync.source === 'api' || options.persistToBackend === true;
    if (!sessionId || !shouldUseBackend) return;
    const fallbackMention =
      options.fallbackMention ??
      (options.routeMentions && options.routeMentions.length > 0
        ? options.routeMentions[0]
        : null);
    const pendingAgentMsg = makePendingAgentPlaceholder(
      text,
      `${OPTIMISTIC_USER_MESSAGE_PREFIX}${Date.now()}`,
      sessionId === activeSessionIdRef.current ? membersAsync.data : [],
      fallbackMention,
      sessionId,
      options.placeholderMember,
    );
    if (!pendingAgentMsg) return;

    setAllMessages((prev) => {
      const cur = filterMessagesForSession(
        sessionId,
        prev[sessionId] ?? [],
      );
      if (
        cur.some(
          (message) =>
            message.isAgentRunning && !isPendingAgentPlaceholder(message),
        )
      ) {
        return prev;
      }
      const withoutStalePending = pendingAgentMsg.sessionAgentId
        ? cur.filter(
            (message) =>
              !(
                isPendingAgentPlaceholder(message) &&
                message.sessionAgentId === pendingAgentMsg.sessionAgentId
              ),
          )
        : cur.filter((message) => !isPendingAgentPlaceholder(message));
      return {
        ...prev,
        [sessionId]: [...withoutStalePending, pendingAgentMsg],
      };
    });
  };

  const sendMessageToSession = (
    sessionId: string,
    text: string,
    options: SendMessageOptions = {},
  ) => {
    if (!text.trim()) return;

    const sid = sessionId;
    if (!sid) return;
    const effectiveChatInputMode =
      options.chatInputMode ??
      chatInputModeBySessionId[sid] ??
      (sid === activeSessionIdRef.current
        ? chatInputMode
        : DEFAULT_CHAT_INPUT_MODE);
    const explicitMentions = extractAgentMentions(text);
    const hasExplicitMentions = explicitMentions.length > 0;
    const hasRouteMentionOverride =
      options.routeMentions !== undefined && options.routeMentions.length > 0;
    const mainAgentMention = mainAgentName
      ? mainAgentName.replace(/^@/, '').toLowerCase()
      : null;
    const routeMentions =
      options.routeMentions ??
      (hasExplicitMentions
        ? explicitMentions
        : mainAgentMention
          ? [mainAgentMention]
          : []);
    const visibleMentions =
      effectiveChatInputMode === 'workflow' &&
      !hasExplicitMentions &&
      !hasRouteMentionOverride
        ? []
        : routeMentions;
    const fallbackMention =
      options.fallbackMention ??
      (routeMentions.length > 0
        ? routeMentions[0]
        : !hasExplicitMentions
          ? mainAgentMention
          : null);
    const userMsgId = `msg-user-${Date.now()}`;
    const userMsg: Message = {
      id: userMsgId,
      sessionId: sid,
      avatar: 'YOU',
      sender: 'You',
      time: 'just now',
      createdAt: new Date().toISOString(),
      text,
      isUser: true,
      clientMessageId: userMsgId,
      mentions: visibleMentions,
      quotedMessage: options.quotedMessage,
      referenceMessageId: options.quotedMessage?.id,
    };
    const shouldPersistToBackend =
      sessionsAsync.source === 'api' || options.persistToBackend === true;
    const hasWorkflowPlanCard = (allMessagesRef.current[sid] ?? []).some(
      isWorkflowPlanCardMessage,
    );
    const shouldCreatePendingAgentPlaceholder =
      shouldPersistToBackend &&
      (!hasWorkflowPlanCard || hasExplicitMentions || hasRouteMentionOverride);
    const pendingAgentMsg =
      shouldCreatePendingAgentPlaceholder
        ? makePendingAgentPlaceholder(
            text,
            userMsgId,
            sid === activeSessionIdRef.current ? membersAsync.data : [],
            fallbackMention,
            sid,
            options.placeholderMember,
          )
        : null;
    const existingQueue = pendingAgentMsg?.sessionAgentId
      ? memberQueuesBySessionAgentId[pendingAgentMsg.sessionAgentId]
      : undefined;
    const targetMember = pendingAgentMsg?.sessionAgentId
      ? membersAsync.data.find(
          (member) => member.id === pendingAgentMsg.sessionAgentId,
        )
      : undefined;
    const shouldQueueForMember = Boolean(
      pendingAgentMsg?.sessionAgentId &&
        (targetMember?.status === 'run' ||
          existingQueue?.blocked ||
          existingQueue?.paused ||
          (existingQueue?.items.length ?? 0) > 0),
    );
    if (shouldQueueForMember) {
      rememberDeferredQueuedUserMessage(userMsg);
    }
    setAllMessages((prev) => {
      const cur = filterMessagesForSession(sid, prev[sid] ?? []);
      const visibleCurrent = shouldQueueForMember
        ? filterDeferredQueuedUserMessages(cur)
        : cur;
      const withoutStalePending =
        !shouldQueueForMember && pendingAgentMsg?.sessionAgentId
          ? visibleCurrent.filter(
              (message) =>
                !(
                  isPendingAgentPlaceholder(message) &&
                  message.sessionAgentId === pendingAgentMsg.sessionAgentId
                ),
            )
          : !shouldQueueForMember && pendingAgentMsg
            ? visibleCurrent.filter(
                (message) => !isPendingAgentPlaceholder(message),
              )
            : visibleCurrent;
      const messagesToAppend =
        shouldQueueForMember
          ? []
          : pendingAgentMsg
            ? [userMsg, pendingAgentMsg]
            : [userMsg];
      return {
        ...prev,
        [sid]: [...withoutStalePending, ...messagesToAppend],
      };
    });
    if (shouldQueueForMember && pendingAgentMsg?.sessionAgentId) {
      stageOptimisticQueuedMessage(
        sid,
        pendingAgentMsg.sessionAgentId,
        userMsgId,
      );
    }

    // Mock-only session (e.g., backend offline): use the local cascade.
    if (!shouldPersistToBackend) {
      dispatchMockReply(text, sid);
      return;
    }

    // Real backend: keep the local running placeholder visible while the
    // persisted message list and websocket stream catch up.
    const meta: { [key: string]: JsonValue } = {
      app_language: locale,
    };
    if (effectiveChatInputMode === 'workflow') {
      meta.chat_input_mode = 'workflow';
    }
    const shouldPersistRouteMentions =
      routeMentions.length > 0 &&
      (effectiveChatInputMode !== 'workflow' ||
        hasExplicitMentions ||
        hasRouteMentionOverride);
    if (shouldPersistRouteMentions) {
      meta.mentions = routeMentions;
    }
    meta.client_message_id = userMsgId;
    if (options.quotedMessage) {
      meta.reference = { message_id: options.quotedMessage.id };
    }
    const workflowLeadAgentId =
      options.workflowLeadAgentId !== undefined
        ? options.workflowLeadAgentId
        : effectiveChatInputMode === 'workflow'
          ? workflowRouteAgentIdRef.current
          : null;

    const persistMessage = async () => {
      await syncSessionLeadAgent(sid, workflowLeadAgentId);
      return chatMessagesApi.send(sid, {
        sender_type: 'user',
        sender_id: null,
        content: text,
        meta,
      });
    };

    persistMessage()
      .then((message) => {
        const incomingMessage = mapBackendChatMessage(message);
        if (shouldQueueForMember) {
          rememberDeferredQueuedUserMessage(incomingMessage);
          void refreshMemberQueues();
          return;
        }
        upsertStreamedMessage(sid, incomingMessage);
        void refreshMessages();
        void refreshMemberQueues();
      })
      .catch((err) => {
        if (shouldQueueForMember) {
          releaseDeferredQueuedUserMessage(userMsg.id, userMsg.clientMessageId);
          setAllMessages((prev) => {
            const cur = filterMessagesForSession(sid, prev[sid] ?? []);
            if (
              cur.some(
                (message) =>
                  userMessageClientId(message) === userMsg.clientMessageId,
              )
            ) {
              return prev;
            }
            return { ...prev, [sid]: [...cur, userMsg] };
          });
        }
        if (pendingAgentMsg) {
          setAllMessages((prev) => {
            const cur = filterMessagesForSession(sid, prev[sid] ?? []);
            return {
              ...prev,
              [sid]: cur.filter((message) => message.id !== pendingAgentMsg.id),
            };
          });
        }
        // Roll forward with mock cascade so the UI is never stuck silent.
        showToast(
          err instanceof Error
            ? `Send failed: ${err.message} (using mock reply)`
            : 'Send failed (using mock reply)',
        );
        dispatchMockReply(text, sid);
      });
  };

  const sendMessage = (text: string, options: SendMessageOptions = {}) => {
    sendMessageToSession(activeSessionIdRef.current, text, options);
  };

  const addMemberToOrganization = (name: string, model: string) => {
    if (!name) return;
    const cleanName = name.startsWith('@') ? name : `@${name}`;
    const monogram = name.replaceAll('@', '').substring(0, 2).toUpperCase();
    const newM: Member = {
      id: `mem-${Date.now()}`,
      avatar: monogram,
      status: 'i',
      name: cleanName,
      roleDetail: `${model} 路 idle`,
      modelName: model,
    };
    setMembers((prev) => [...prev, newM]);
    showToast(`Added agent ${cleanName} equipped with ${model} engine!`);
  };

  const addProviderToKeychain = (name: string, key: string) => {
    if (!name) return;
    const mono = name.substring(0, 2).toUpperCase();
    const mask = key ? `${key.substring(0, 4)}************` : 'sk-************';
    const newProv: Provider = {
      id: `prov-${Date.now()}`,
      monogram: mono,
      name,
      keyMask: mask,
      lastUsed: 'Just configured',
      active: true,
    };
    setProviders((prev) => [...prev, newProv]);
    showToast(`Connected ${name} endpoint securely inside local keychain!`);
  };

  return (
    <WorkspaceContext.Provider
      value={{
        theme,
        setTheme,
        locale,
        setLocale,
        chatMessageFontSize,
        setChatMessageFontSize,
        members,
        setMembers,
        sessions,
        setSessions,
        projects,
        projectsAsync,
        selectedProjectId,
        setSelectedProjectId,
        refreshProjects,
        createProject,
        messages,
        memberQueuesBySessionAgentId,
        deferredQueuedMessagesById,
        workflowRuntimeLinesByExecution,
        activeSessionId,
        setActiveSessionId,
        chatInputMode,
        setChatInputMode,
        setSessionChatInputMode,
        ensureWorkflowRouteToMainAgent,
        mainAgentName,
        providers,
        setProviders,
        strategies,
        selectedStrategyId,
        setSelectedStrategyId,
        selectedOnboardType,
        setSelectedOnboardType,
        smartRouting,
        setSmartRouting,
        showCost,
        setShowCost,
        showExplanation,
        setShowExplanation,
        warnOverDollar,
        setWarnOverDollar,
        weeklyCost,
        weeklySaved,
        earlyBirdLeft,
        setEarlyBirdLeft,
        isAddMemberModalOpen,
        setIsAddMemberModalOpen,
        isAddProviderModalOpen,
        setIsAddProviderModalOpen,

        sendMessage,
        sendMessageToSession,
        stagePendingAgentPlaceholder,
        addMemberToOrganization,
        addProviderToKeychain,

        t,
        toast,
        showToast,
        activeSettingsTab,
        setActiveSettingsTab,

        sessionsAsync,
        refreshSessions,
        archivedSessionsAsync,
        refreshArchivedSessions,
        renameSession,
        archiveSession,
        pinSession,
        deleteSession,
        restoreSession,
        messagesAsync,
        refreshMessages,
        markSessionAgentStopped,
        refreshMemberQueues,
        deleteQueuedMessage,
        continueMemberQueue,
        membersAsync,
        refreshMembers,
        providersAsync,
        refreshProviders,
        skills: skillsAsync.data,
        skillsAsync,
        refreshSkills,
        config: configAsync.data,
        configAsync,
        refreshConfig,
        workflowCard: workflowCardAsync.data,
        workflowCardAsync,
        refreshWorkflowCard,
        workspaceChanges: workspaceChangesAsync.data,
        workspaceChangesAsync,
        refreshWorkspaceChanges,
        resetWorkspaceChanges,
        refreshAll,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used inside a WorkspaceProvider');
  }
  return context;
};
