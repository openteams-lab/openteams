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

interface SendMessageOptions {
  quotedMessage?: QuotedMessageReference;
}

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
    };

const chatStreamWebSocketUrl = (path: string): string => {
  const base =
    typeof window === 'undefined' ? 'http://localhost' : window.location.href;
  const url = new URL(path, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

const PENDING_AGENT_MESSAGE_PREFIX = 'pending-agent-';
const CHAT_MESSAGE_FONT_SIZE_STORAGE_KEY = 'openteams-chat-message-font-size';
const LEGACY_AGENT_MARKDOWN_FONT_SIZE_STORAGE_KEY =
  'openteams-agent-markdown-font-size';
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

const extractAgentMentions = (text: string): string[] =>
  Array.from(text.matchAll(/@([a-zA-Z0-9_-]+)/g), (match) =>
    match[1].toLowerCase(),
  );

const asAgentHandle = (name: string): string =>
  name.startsWith('@') ? name : `@${name}`;

const makePendingAgentPlaceholder = (
  text: string,
  userMsgId: string,
  members: Member[],
): Message => {
  const mentions = extractAgentMentions(text);
  const mentionedMember = members.find((member) =>
    mentions.includes(member.name.replace(/^@/, '').toLowerCase()),
  );
  const fallbackMember =
    mentionedMember ??
    members.find((member) => member.status === 'run') ??
    members[0];
  const fallbackName = mentions[0] ? asAgentHandle(mentions[0]) : '@agent';
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
): Message[] => {
  const persistedIds = new Set(persisted.map((message) => message.id));
  const persistedRunIds = new Set(
    persisted
      .map((message) => message.runId)
      .filter((runId): runId is string => Boolean(runId)),
  );
  const placeholdersByKey = new Map<string, Message>();
  for (const message of current) {
    if (!message.isAgentRunning || persistedIds.has(message.id)) continue;
    if (message.runId && persistedRunIds.has(message.runId)) continue;
    const key = message.runId ?? message.id;
    const existing = placeholdersByKey.get(key);
    const existingLineCount = existing?.activityLines?.length ?? 0;
    const nextLineCount = message.activityLines?.length ?? 0;
    if (!existing || nextLineCount > existingLineCount) {
      placeholdersByKey.set(key, message);
    }
  }
  const placeholders = [...placeholdersByKey.values()];

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
      if (!run) return null;

      const agent = agentById.get(sessionAgent.agent_id);
      const projectMember =
        (sessionAgent.project_member_id
          ? projectMemberById.get(sessionAgent.project_member_id)
          : undefined) ?? projectMemberByAgentId.get(sessionAgent.agent_id);
      const agentName =
        projectMember?.member_name?.trim() || agent?.name || sessionAgent.agent_id;
      const activityLines = await chatRunsApi
        .getActivity(run.run_id, { offset: 0, limit: 1000 })
        .then((response) => sortActivityLines(response.lines))
        .catch(() => []);

      return {
        id: `run-${run.run_id}`,
        avatar: monogramFromName(agentName),
        sender: asAgentHandle(agentName),
        model: effectiveSessionAgentModelName(agent, sessionAgent) ?? undefined,
        time: 'just now',
        text: '',
        isThinking: true,
        isAgentRunning: true,
        runId: run.run_id,
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
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
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
  toast: string | null;
  showToast: (msg: string) => void;

  // Settings active section
  activeSettingsTab: string;
  setActiveSettingsTab: (tab: string) => void;

  // Async-status surface appended to the preserved legacy context shape.
  sessionsAsync: AsyncResourceState<Session[]>;
  refreshSessions: () => Promise<void>;
  messagesAsync: AsyncResourceState<Message[]>;
  refreshMessages: () => Promise<void>;
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
  const [activeSessionId, setActiveSessionId] = useState<string>('');
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
  const [selectedProjectId, setSelectedProjectIdState] = useState<string>('');
  const [allMessages, setAllMessages] = useState<Record<string, Message[]>>({});
  const [messagesAsync, setMessagesAsync] = useState<
    AsyncResourceState<Message[]>
  >(() => initialAsync([]));
  const [membersAsync, setMembersAsync] = useState<
    AsyncResourceState<Member[]>
  >(() => initialAsync([]));
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
  const [toast, setToast] = useState<string | null>(null);

  // Cache the latest activeSessionId so async callbacks see the live value.
  const activeSessionIdRef = useRef(activeSessionId);
  const selectedProjectIdRef = useRef(selectedProjectId);
  const agentNamesByIdRef = useRef<Record<string, string>>({});
  const agentModelsByIdRef = useRef<Record<string, string | null>>({});
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const showToast = (msg: string) => {
    setToast(msg);
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
  }, []);

  const setSelectedProjectId = useCallback(
    (id: string) => {
      const previousProjectId = selectedProjectIdRef.current;
      selectedProjectIdRef.current = id;
      setSelectedProjectIdState(id);

      if (previousProjectId !== id) {
        setSessionsAsync(succeed([]));
        clearSessionScopedState();
      }
    },
    [clearSessionScopedState],
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
          chatAgentsApi.list().catch(() => []),
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
      const runningPlaceholders = await hydrateRunningAgentPlaceholders(
        sessionAgents,
        backendAgents,
        retention.runs,
        projectMembers,
      );
      setAllMessages((prev) => {
        const next = resolveQuotedMessageReferences(
          mergePersistedWithRunningPlaceholders(mapped, [
            ...(prev[sid] ?? []),
            ...runningPlaceholders,
          ]),
        );
        setMessagesAsync(succeed(next));
        return { ...prev, [sid]: next };
      });
    } catch (err) {
      const mock = mockBootstrapRef.current?.messagesBySession[sid] ?? [];
      setMessagesAsync((prev) => fail(prev, err, mock));
    }
  }, []);

  const refreshMembers = useCallback(async (): Promise<void> => {
    const sid = activeSessionIdRef.current;
    if (!sid) {
      setMembersAsync(succeed([]));
      return;
    }

    setMembersAsync(beginLoad);
    try {
      const projectId = selectedProjectIdRef.current;
      const [agents, sessionAgents, projectMembers] = await Promise.all([
        chatAgentsApi.list(),
        sessionAgentsApi.list(sid).catch(() => []),
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
      setMembersAsync((prev) =>
        fail(prev, err, mockBootstrapRef.current?.members ?? []),
      );
    }
  }, []);

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

  const refreshWorkspaceChanges = useCallback(
    async (
      sessionId: string,
      path: string,
      includeDiff?: boolean,
    ): Promise<void> => {
      setWorkspaceChangesAsync(beginLoad);
      try {
        const resp = await chatSessionsApi.getWorkspaceChanges(
          sessionId,
          path,
          includeDiff,
        );
        setWorkspaceChangesAsync(succeed(resp));
      } catch (err) {
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
        let removedPendingPlaceholder = false;
        const withoutPlaceholder = current.filter((message) => {
          const isMatchingRun =
            incoming.runId &&
            message.runId === incoming.runId &&
            message.isAgentRunning;
          const isPendingRun =
            !incoming.isUser &&
            !hasMatchingRun &&
            !removedPendingPlaceholder &&
            isPendingAgentPlaceholder(message);
          if (isMatchingRun || isPendingRun) {
            carriedLines = message.activityLines;
            carriedState = message.activityLoadState ?? 'loaded';
            carriedSessionAgentId =
              carriedSessionAgentId ?? message.sessionAgentId;
            removedPendingPlaceholder =
              removedPendingPlaceholder || isPendingRun;
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
        const existingIndex = withoutPlaceholder.findIndex(
          (message) => message.id === nextMessage.id,
        );
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
      const pendingIndex = current.findIndex(isPendingAgentPlaceholder);
      if (pendingIndex >= 0) {
        const next = current.map((message, index) =>
          index === pendingIndex ? placeholder : message,
        );
        return { ...prev, [line.session_id]: next };
      }
      return { ...prev, [line.session_id]: [...current, placeholder] };
    });
  }, []);

  const insertRunningPlaceholder = useCallback(
    (event: Extract<ChatStreamEvent, { type: 'agent_run_started' }>) => {
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
        const pendingIndex = current.findIndex(isPendingAgentPlaceholder);
        if (pendingIndex >= 0) {
          const next = current.map((message, index) =>
            index === pendingIndex ? placeholder : message,
          );
          return { ...prev, [event.session_id]: next };
        }
        return { ...prev, [event.session_id]: [...current, placeholder] };
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
    const socket = new WebSocket(
      chatStreamWebSocketUrl(chatSessionsApi.streamUrl(sid)),
    );

    socket.onmessage = (event) => {
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
        (parsed.type === 'message_new' || parsed.type === 'message_updated') &&
        parsed.message.session_id === sid
      ) {
        if (hasRealCompleteTokenUsage(parsed.message)) {
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
      }
    };

    socket.onerror = () => {
      socket.close();
    };

    return () => {
      socket.close();
    };
  }, [
    activeSessionId,
    appendStreamActivityLine,
    insertRunningPlaceholder,
    mapBackendChatMessage,
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

  const t = (
    key: string,
    replacements?: Record<string, string | number>,
  ): string => {
    const dict = i18nDict[locale] || i18nDict['en'];
    let val = dict[key] || i18nDict['en'][key] || key;
    if (replacements) {
      Object.entries(replacements).forEach(([k, v]) => {
        val = val.replace(`{${k}}`, String(v));
      });
    }
    return val;
  };

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
    const userMsgId = `msg-user-${Date.now()}`;
    const userMsg: Message = {
      id: userMsgId,
      avatar: 'YOU',
      sender: 'You',
      time: 'just now',
      text,
      isUser: true,
      quotedMessage: options.quotedMessage,
      referenceMessageId: options.quotedMessage?.id,
    };
    const pendingAgentMsg =
      sessionsAsync.source === 'api'
        ? makePendingAgentPlaceholder(text, userMsgId, membersAsync.data)
        : null;
    setAllMessages((prev) => {
      const cur = prev[sid] || [];
      return {
        ...prev,
        [sid]: pendingAgentMsg
          ? [...cur, userMsg, pendingAgentMsg]
          : [...cur, userMsg],
      };
    });

    // Mock-only session (e.g., backend offline): use the local cascade.
    if (sessionsAsync.source !== 'api') {
      dispatchMockReply(text);
      return;
    }

    // Real backend: keep the local running placeholder visible while the
    // persisted message list and websocket stream catch up.
    const mentions = text
      .split(/\s+/)
      .filter((w) => w.startsWith('@'))
      .map((m) => m.slice(1).toLowerCase());
    const meta: { [key: string]: JsonValue } = {};
    if (mentions.length > 0) {
      meta.mentions = mentions;
    }
    if (options.quotedMessage) {
      meta.reference = { message_id: options.quotedMessage.id };
    }

    chatMessagesApi
      .send(sid, {
        sender_type: 'user',
        sender_id: null,
        content: text,
        meta: Object.keys(meta).length > 0 ? meta : null,
      })
      .then(() => {
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
        activeSessionId,
        setActiveSessionId,
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
