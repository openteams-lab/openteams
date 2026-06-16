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
  TaskNode,
  Member,
  Session,
  Message,
  BackendChatAgent,
  BackendChatMessage,
  BackendChatSessionAgent,
  ChatRunActivityLine,
  ChatRunRetentionInfo,
  QuotedMessageReference,
  Provider,
  Strategy,
  BackendChatSkill,
  Config,
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
      started_at: string | null;
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
      type: 'file_change_refresh';
      session_id: string;
      session_agent_id: string;
      agent_id: string;
      run_id: string;
      message_id: string;
      changed_files: FileChangeEntry[];
      ts: string;
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
// WebSocket auto-reconnect backoff bounds (ms).
const CHAT_STREAM_RECONNECT_BASE_DELAY_MS = 1000;
const CHAT_STREAM_RECONNECT_MAX_DELAY_MS = 30000;
const CHAT_MESSAGE_FONT_SIZE_DEFAULT = 14;
export const CHAT_MESSAGE_FONT_SIZE_OPTIONS = [13, 14, 15, 16] as const;

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

const findPendingAgentPlaceholderIndex = (
  messages: Message[],
  sessionAgentId?: string,
): number => {
  if (sessionAgentId) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (
        isPendingAgentPlaceholder(message) &&
        message.sessionAgentId === sessionAgentId
      ) {
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
// *different* run of the same agent so a stale one — e.g. left over from a
// just-stopped run that refreshMessages re-hydrated — cannot coexist with the
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
    members.find((member) => member.status === 'run') ??
    members[0];
  const fallbackName = effectiveMentions[0]
    ? asAgentHandle(effectiveMentions[0])
    : '@agent';
  const sender = asAgentHandle(fallbackMember?.name ?? fallbackName);

  return {
    id: `${PENDING_AGENT_MESSAGE_PREFIX}${userMsgId}`,
    avatar: fallbackMember?.avatar ?? monogramFromName(sender),
    sender,
    model: fallbackMember?.modelName,
    time: 'just now',
    text: '',
    isThinking: true,
    isAgentRunning: true,
    sessionAgentId: fallbackMember?.id,
    activityLines: [],
    activityLoadState: 'loaded',
  };
};

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

const mergePersistedWithRunningPlaceholders = (
  persisted: Message[],
  current: Message[],
  activeSessionAgentIds?: Set<string>,
): Message[] => {
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
  for (const message of current) {
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
    const key = `agent:${message.runId ?? message.id}`;
    if (message.runId) hasRunIdPlaceholder = true;
    const existing = carriedMessagesByKey.get(key);
    const existingLineCount = existing?.activityLines?.length ?? 0;
    const nextLineCount = message.activityLines?.length ?? 0;
    if (!existing || nextLineCount > existingLineCount) {
      carriedMessagesByKey.set(key, message);
    }
  }

  // If a real run placeholder exists, discard any pending placeholders (no runId)
  // to avoid showing duplicates.
  if (hasRunIdPlaceholder) {
    for (const [key, message] of carriedMessagesByKey) {
      if (!message.runId && isPendingAgentPlaceholder(message)) {
        carriedMessagesByKey.delete(key);
      }
    }
  }

  const placeholders = [...carriedMessagesByKey.values()];

  return placeholders.length > 0 ? [...persisted, ...placeholders] : persisted;
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
        avatar: monogramFromName(agentName),
        sender: asAgentHandle(agentName),
        model: effectiveSessionAgentModelName(agent, sessionAgent) ?? undefined,
        time: 'just now',
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
  tasks: TaskNode[];
  setTasks: (t: ListUpdater<TaskNode>) => void;
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
  workflowRuntimeLinesByExecution: Record<string, WorkflowRuntimeLine[]>;
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
  chatInputMode: ChatInputMode;
  setChatInputMode: (mode?: ChatInputMode) => void;
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
  isNewTaskModalOpen: boolean;
  setIsNewTaskModalOpen: (b: boolean) => void;
  isRetryModalOpen: boolean;
  setIsRetryModalOpen: (b: boolean) => void;
  isAddMemberModalOpen: boolean;
  setIsAddMemberModalOpen: (b: boolean) => void;
  isAddProviderModalOpen: boolean;
  setIsAddProviderModalOpen: (b: boolean) => void;

  // Active Simulation Utilities
  sendMessage: (text: string, options?: SendMessageOptions) => void;
  addNewTask: (title: string, details: string, chosenMembers: string[]) => void;
  retryWorkflowFromStep3: () => void;
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
  messagesAsync: AsyncResourceState<Message[]>;
  refreshMessages: () => Promise<void>;
  /**
   * Optimistically drop the running placeholder of a stopped session agent and
   * suppress its re-hydration until a new run starts or it reaches a terminal
   * state. Call right when the user requests a stop.
   */
  markSessionAgentStopped: (sessionAgentId: string) => void;
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
  const [tasks, setTasks] = useState<TaskNode[]>([]);
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

  // Stats (LOCAL / MOCK-FALLBACK per backend_contract_audit §5.1)
  const [weeklyCost, setWeeklyCost] = useState<number>(0);
  const [weeklySaved, setWeeklySaved] = useState<number>(0);
  const [earlyBirdLeft, setEarlyBirdLeft] = useState<number>(0);

  // Settings view controller
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<string>('providers');

  // Modal Switches
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState<boolean>(false);
  const [isRetryModalOpen, setIsRetryModalOpen] = useState<boolean>(false);
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
  // this set its (stopping) run must not be re-hydrated as a running
  // placeholder, so a freshly sent message cannot end up beside a stale
  // "executing" placeholder. Cleared when a new run starts or a terminal
  // agent_state arrives.
  const optimisticallyStoppedSessionAgentIdsRef = useRef<Set<string>>(
    new Set(),
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
  }, [activeSessionId]);

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

  const clearSessionScopedState = useCallback(() => {
    activeSessionIdRef.current = '';
    setActiveSessionId('');
    setMessagesAsync(succeed([]));
    setMembersAsync(succeed([]));
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
      mockBootstrapRef.current = bootstrap;
      toastDurationMsRef.current = bootstrap.defaults.toastDurationMs;
      setTasks(bootstrap.tasks);
      setSessionsAsync(initialAsync([]));
      setAllMessages(bootstrap.messagesBySession);
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

  const refreshSessions = useCallback(async (): Promise<void> => {
    const projectId = selectedProjectIdRef.current;
    if (!projectId) {
      setSessionsAsync(succeed([]));
      clearSessionScopedState();
      return;
    }

    setSessionsAsync(beginLoad);
    try {
      const backend = await projectApi.listSessions(projectId);
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

      const currentActiveSessionId = activeSessionIdRef.current;
      const nextActiveSessionId = backend.some(
        (session) => session.id === currentActiveSessionId,
      )
        ? currentActiveSessionId
        : (backend[0]?.id ?? '');
      const mapped = mapSessions(backend, nextActiveSessionId);
      setSessionsAsync(succeed(mapped));

      if (nextActiveSessionId !== currentActiveSessionId) {
        activeSessionIdRef.current = nextActiveSessionId;
        setActiveSessionId(nextActiveSessionId);
      }

      if (!nextActiveSessionId) {
        clearSessionScopedState();
      }
    } catch (err) {
      setSessionsAsync((prev) => fail(prev, err));
    }
  }, [clearSessionScopedState]);

  const refreshMessages = useCallback(async (): Promise<void> => {
    const sid = activeSessionIdRef.current;
    if (!sid) {
      setMessagesAsync(succeed([]));
      return;
    }

    setMessagesAsync(beginLoad);
    try {
      const projectId = selectedProjectIdRef.current;
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
      const mapped = mapMessages(backendMsgs, {
        agentNamesById,
        agentModelsById,
      });
      // Drop the optimistic-stop suppression for any agent that has already
      // moved out of the `stopping` state (terminal, or a new run is active).
      const suppressedStoppedIds =
        optimisticallyStoppedSessionAgentIdsRef.current;
      if (suppressedStoppedIds.size > 0) {
        for (const sessionAgent of sessionAgents) {
          if (
            suppressedStoppedIds.has(sessionAgent.id) &&
            sessionAgent.state !== 'stopping'
          ) {
            suppressedStoppedIds.delete(sessionAgent.id);
          }
        }
      }
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
              isActiveAgentState(sessionAgent.state) &&
              !suppressedStoppedIds.has(sessionAgent.id),
          )
          .map((sessionAgent) => sessionAgent.id),
      );
      setAllMessages((prev) => {
        const next = resolveQuotedMessageReferences(
          mergePersistedWithRunningPlaceholders(
            mapped,
            [...(prev[sid] ?? []), ...runningPlaceholders],
            activeSessionAgentIds,
          ),
        );
        setMessagesAsync(succeed(next));
        return { ...prev, [sid]: next };
      });
    } catch (err) {
      const mock = mockBootstrapRef.current?.messagesBySession[sid] ?? [];
      setMessagesAsync((prev) => fail(prev, err, mock));
    }
  }, []);

  // Optimistically clear the running placeholder of a session agent the user
  // just stopped. The stopped run keeps the agent in the `stopping` state for a
  // while, during which both refreshMessages and a freshly sent message would
  // otherwise leave a stale "executing" placeholder on screen alongside the new
  // one. We drop it immediately and suppress re-hydration until the agent
  // either starts a new run or reaches a terminal state.
  const markSessionAgentStopped = useCallback((sessionAgentId: string) => {
    if (!sessionAgentId) return;
    optimisticallyStoppedSessionAgentIdsRef.current.add(sessionAgentId);
    const sid = activeSessionIdRef.current;
    if (!sid) return;
    setAllMessages((prev) => {
      const current = prev[sid];
      if (!current) return prev;
      const updated = current.filter(
        (message) =>
          !(
            message.isAgentRunning &&
            message.sessionAgentId === sessionAgentId
          ),
      );
      if (updated.length === current.length) return prev;
      const next = { ...prev, [sid]: updated };
      setMessagesAsync(succeed(updated));
      return next;
    });
  }, []);

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
      const [agents, sessionAgents, projectMembers] = await Promise.all([
        chatAgentsApi.list(projectId ? { projectId } : undefined),
        sessionAgentsApi.list(sid).catch(() => []),
        projectId ? projectApi.listMembers(projectId).catch(() => []) : [],
      ]);
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
  }, [syncSessionLeadAgent]);

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
      refreshProviders(),
      refreshSkills(),
      refreshConfig(),
      refreshMembers(),
      refreshMessages(),
    ]);
  }, [
    refreshSessions,
    refreshProjects,
    refreshProviders,
    refreshSkills,
    refreshConfig,
    refreshMembers,
    refreshMessages,
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

  const upsertStreamedMessage = useCallback(
    (sid: string, incoming: Message) => {
      setAllMessages((prev) => {
        const current = prev[sid] || [];
        let carriedLines: ChatRunActivityLine[] | undefined;
        let carriedState = incoming.activityLoadState;
        let carriedSessionAgentId = incoming.sessionAgentId;
        const hasMatchingRun = Boolean(
          incoming.runId &&
          current.some(
            (message) =>
              message.runId === incoming.runId && message.isAgentRunning,
          ),
        );
        const hasMatchingSessionAgent = Boolean(
          !incoming.isUser &&
            incoming.sessionAgentId &&
            current.some(
              (message) =>
                message.isAgentRunning &&
                message.sessionAgentId === incoming.sessionAgentId,
            ),
        );
        const fallbackPendingIndex =
          !incoming.isUser && !hasMatchingRun && !hasMatchingSessionAgent
            ? findPendingAgentPlaceholderIndex(current, incoming.sessionAgentId)
            : -1;
        const withoutPlaceholder = current.filter((message) => {
          const isMatchingRun =
            incoming.runId &&
            message.runId === incoming.runId &&
            message.isAgentRunning;
          const isMatchingSessionAgent =
            !incoming.isUser &&
            !isMatchingRun &&
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
          if (isMatchingRun || isMatchingSessionAgent || isPendingRun) {
            carriedLines = message.activityLines;
            carriedState = message.activityLoadState ?? 'loaded';
            carriedSessionAgentId =
              carriedSessionAgentId ?? message.sessionAgentId;
            return false;
          }
          return true;
        });
        const nextMessage: Message = {
          ...incoming,
          activityLines: carriedLines ?? incoming.activityLines,
          activityLoadState: carriedState,
          sessionAgentId: carriedSessionAgentId,
          isAgentRunning: undefined,
          isThinking: undefined,
        };
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
            : [...withoutPlaceholder, nextMessage];
        return { ...prev, [sid]: resolveQuotedMessageReferences(next) };
      });
    },
    [],
  );

  const appendStreamActivityLine = useCallback((line: ChatRunActivityLine) => {
    setAllMessages((prev) => {
      const current = prev[line.session_id] || [];
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
        avatar: monogramFromName(line.agent_name),
        sender: agentName,
        model: agentModelsByIdRef.current[line.agent_id] ?? undefined,
        time: 'just now',
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
        line.session_agent_id,
      );
      if (pendingIndex >= 0) {
        const next = pruned.map((message, index) =>
          index === pendingIndex ? placeholder : message,
        );
        return { ...prev, [line.session_id]: next };
      }
      return { ...prev, [line.session_id]: [...pruned, placeholder] };
    });
  }, []);

  const insertRunningPlaceholder = useCallback(
    (event: Extract<ChatStreamEvent, { type: 'agent_run_started' }>) => {
      // A new run for this agent supersedes any optimistic-stop suppression.
      optimisticallyStoppedSessionAgentIdsRef.current.delete(
        event.session_agent_id,
      );
      setAllMessages((prev) => {
        const current = prev[event.session_id] || [];
        if (current.some((message) => message.runId === event.run_id)) {
          return prev;
        }
        const agentName = event.agent_name.startsWith('@')
          ? event.agent_name
          : `@${event.agent_name}`;
        const placeholder: Message = {
          id: `run-${event.run_id}`,
          avatar: monogramFromName(event.agent_name),
          sender: agentName,
          model: agentModelsByIdRef.current[event.agent_id] ?? undefined,
          time: 'just now',
          text: '',
          isThinking: true,
          isAgentRunning: true,
          runId: event.run_id,
          sessionAgentId: event.session_agent_id,
          activityLines: [],
          activityLoadState: 'idle',
        };
        // Evict any stale running placeholder for a different run of the same
        // agent before placing the new one (see evictStaleRunPlaceholders).
        const pruned = evictStaleRunPlaceholders(
          current,
          event.session_agent_id,
          event.run_id,
        );
        const pendingIndex = findPendingAgentPlaceholderIndex(
          pruned,
          event.session_agent_id,
        );
        if (pendingIndex >= 0) {
          const next = pruned.map((message, index) =>
            index === pendingIndex ? placeholder : message,
          );
          return { ...prev, [event.session_id]: next };
        }
        return { ...prev, [event.session_id]: [...pruned, placeholder] };
      });
    },
    [],
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
        handleWorkflowRuntimeLine(parsed);
        return;
      }

      if (
        parsed.type === 'file_change_refresh' &&
        parsed.session_id === sid
      ) {
        const workspacePath = activeWorkspacePathRef.current;
        if (workspacePath) {
          void refreshWorkspaceChanges(sid, workspacePath, true);
        }
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
        upsertStreamedMessage(sid, mapBackendChatMessage(parsed.message));
        return;
      }

      if (parsed.type === 'agent_state') {
        void refreshMembers();

        // When an agent leaves an active run state,
        // clear any lingering running/thinking placeholder messages for it.
        if (!isActiveAgentState(parsed.state)) {
          optimisticallyStoppedSessionAgentIdsRef.current.delete(
            parsed.session_agent_id,
          );
          setAllMessages((prev) => {
            const current = prev[sid];
            if (!current) return prev;
            const updated = current.filter(
              (msg) =>
                !(
                  msg.isAgentRunning &&
                  msg.sessionAgentId === parsed.session_agent_id
                ),
            );
            if (updated.length === current.length) return prev;
            return { ...prev, [sid]: updated };
          });
        }
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
    mapBackendChatMessage,
    refreshMessages,
    refreshWorkspaceChanges,
    refreshMembers,
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
  const messages = allMessages[activeSessionId] || messagesAsync.data;

  // ---------------------------------------------------------------------------
  // sendMessage: try the real API first; fall back to mock cascade when the
  // backend is unavailable, the session is mock-only, or the request errors.
  // ---------------------------------------------------------------------------

  const dispatchMockReply = (text: string) => {
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
    const thinkingMsg: Message = {
      id: thinMsgId,
      avatar: responderAvatar,
      sender: responderName,
      model: responderLabel,
      time: 'just now',
      text: '',
      isThinking: true,
    };

    const sid = activeSessionIdRef.current;
    setTimeout(() => {
      setAllMessages((prev) => {
        const cur = prev[sid] || [];
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
          avatar: responderAvatar,
          sender: responderName,
          model: responderLabel,
          time: 'just now',
          text: replyText,
          cost: `$${costVal} · ${tokenNum} tokens`,
        };
        setAllMessages((prev) => {
          const cur = prev[sid] || [];
          const base = cur.filter((m) => m.id !== thinMsgId);
          return { ...prev, [sid]: [...base, realReplyMsg] };
        });
        setWeeklyCost((prev) =>
          parseFloat((prev + parseFloat(costVal)).toFixed(2)),
        );
      }, 1500);
    }, 600);
  };

  const sendMessage = (text: string, options: SendMessageOptions = {}) => {
    if (!text.trim()) return;

    const sid = activeSessionIdRef.current;
    const effectiveChatInputMode = options.chatInputMode ?? chatInputMode;
    const explicitMentions = extractAgentMentions(text);
    const mainAgentMention = mainAgentName
      ? mainAgentName.replace(/^@/, '').toLowerCase()
      : null;
    const userMsgId = `msg-user-${Date.now()}`;
    const userMsg: Message = {
      id: userMsgId,
      avatar: 'YOU',
      sender: 'You',
      time: 'just now',
      text,
      isUser: true,
      clientMessageId: userMsgId,
      quotedMessage: options.quotedMessage,
      referenceMessageId: options.quotedMessage?.id,
    };
    const pendingAgentMsg =
      sessionsAsync.source === 'api'
        ? makePendingAgentPlaceholder(
            text,
            userMsgId,
            membersAsync.data,
            explicitMentions.length === 0 ? mainAgentMention : null,
          )
        : null;
    setAllMessages((prev) => {
      const cur = prev[sid] || [];
      const withoutStalePending = pendingAgentMsg?.sessionAgentId
        ? cur.filter(
            (message) =>
              !(
                isPendingAgentPlaceholder(message) &&
                message.sessionAgentId === pendingAgentMsg.sessionAgentId
              ),
          )
        : pendingAgentMsg
          ? cur.filter((message) => !isPendingAgentPlaceholder(message))
          : cur;
      return {
        ...prev,
        [sid]: pendingAgentMsg
          ? [...withoutStalePending, userMsg, pendingAgentMsg]
          : [...withoutStalePending, userMsg],
      };
    });

    // Mock-only session (e.g., backend offline): use the local cascade.
    if (sessionsAsync.source !== 'api') {
      dispatchMockReply(text);
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
    const routeMentions =
      explicitMentions.length > 0
        ? explicitMentions
        : mainAgentMention
          ? [mainAgentMention]
          : [];
    if (effectiveChatInputMode !== 'workflow' && routeMentions.length > 0) {
      meta.mentions = routeMentions;
    }
    meta.client_message_id = userMsgId;
    if (options.quotedMessage) {
      meta.reference = { message_id: options.quotedMessage.id };
    }
    const workflowLeadAgentId =
      effectiveChatInputMode === 'workflow'
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
        upsertStreamedMessage(sid, mapBackendChatMessage(message));
        void refreshMessages();
      })
      .catch((err) => {
        if (pendingAgentMsg) {
          setAllMessages((prev) => {
            const cur = prev[sid] || [];
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
        dispatchMockReply(text);
      });
  };

  // Add new workflow task representing Prototype 4 action into Prototype 1 List
  const addNewTask = (
    title: string,
    _details: string,
    chosenMembers: string[],
  ) => {
    const mainMembersMap: Record<string, string> = {
      Lead: 'CL',
      Backend: 'CO',
      Frontend: 'CU',
      QA: 'GE',
      Security: 'SE',
    };
    const newNodes: TaskNode[] = chosenMembers.map((m, idx) => {
      const isFirst = idx === 0;
      const avatarStr = mainMembersMap[m] || 'CL';
      return {
        id: `node-sub-${Date.now()}-${idx}`,
        name: idx === 0 ? title : `${m}: processing...`,
        subText: `${m.toLowerCase()} -> ${avatarStr === 'CL' ? 'Claude' : avatarStr === 'CO' ? 'Codex' : avatarStr === 'CU' ? 'Cursor' : 'Gemini'}`,
        avatar: avatarStr,
        cost: idx === 0 ? '$0.15' : '—',
        status: isFirst ? 'run' : 'wait',
      };
    });
    setTasks(newNodes);
    showToast(t('toastPlanStarted'));

    // Best-effort: kick off the real backend workflow generator when we have a
    // live session. Failures are non-fatal; the mock task list still drives UI.
    const sid = activeSessionIdRef.current;
    if (sessionsAsync.source === 'api') {
      workflowApi
        .generatePlanAndRun(sid, title)
        .then((res) => {
          void refreshWorkflowCard(res.workflow_card_message.id);
          void refreshMessages();
        })
        .catch(() => {
          // Silent: mock state remains in place.
        });
    }
  };

  const retryWorkflowFromStep3 = () => {
    setTasks((prev) =>
      prev.map((task, idx) => {
        if (idx < 2) return { ...task, status: 'done' as const };
        if (idx === 2)
          return { ...task, status: 'run' as const, cost: '$0.41' };
        return { ...task, status: 'wait' as const, cost: '—' };
      }),
    );
    showToast('Re-running steps from Step 3...');
    setTimeout(() => {
      setTasks((prev) =>
        prev.map((task, idx) => {
          if (idx <= 2) return { ...task, status: 'done' as const };
          if (idx === 3)
            return { ...task, status: 'run' as const, cost: '$0.28' };
          return task;
        }),
      );
      showToast('Step 3 Done. Gemini evaluating integration tests...');
      setTimeout(() => {
        setTasks((prev) =>
          prev.map((task, idx) => {
            if (idx <= 3) return { ...task, status: 'done' as const };
            if (idx === 4)
              return { ...task, status: 'run' as const, cost: '$0.12' };
            return task;
          }),
        );
        showToast('Step 4 done. Initializing deployment pipeline...');
        setTimeout(() => {
          setTasks((prev) =>
            prev.map((task) => ({ ...task, status: 'done' as const })),
          );
          showToast(
            'Deployment completed successfully! Product live on Cloud Run!',
          );
          setWeeklyCost((prev) => parseFloat((prev + 0.42).toFixed(2)));
          setWeeklySaved((prev) => parseFloat((prev + 1.2).toFixed(2)));
        }, 2000);
      }, 2500);
    }, 3000);
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
      roleDetail: `${model} · idle`,
      modelName: model,
    };
    setMembers((prev) => [...prev, newM]);
    showToast(`Added agent ${cleanName} equipped with ${model} engine!`);
  };

  const addProviderToKeychain = (name: string, key: string) => {
    if (!name) return;
    const mono = name.substring(0, 2).toUpperCase();
    const mask = key ? `${key.substring(0, 4)}••••••••••••` : 'sk-••••••••••••';
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
        tasks,
        setTasks,
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
        workflowRuntimeLinesByExecution,
        activeSessionId,
        setActiveSessionId,
        chatInputMode,
        setChatInputMode,
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
        isNewTaskModalOpen,
        setIsNewTaskModalOpen,
        isRetryModalOpen,
        setIsRetryModalOpen,
        isAddMemberModalOpen,
        setIsAddMemberModalOpen,
        isAddProviderModalOpen,
        setIsAddProviderModalOpen,

        sendMessage,
        addNewTask,
        retryWorkflowFromStep3,
        addMemberToOrganization,
        addProviderToKeychain,

        t,
        toast,
        showToast,
        activeSettingsTab,
        setActiveSettingsTab,

        sessionsAsync,
        refreshSessions,
        messagesAsync,
        refreshMessages,
        markSessionAgentStopped,
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
