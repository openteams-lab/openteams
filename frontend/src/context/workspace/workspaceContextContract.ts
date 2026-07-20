import type {
  BackendChatSkill,
  Config,
  Environment,
  Locale,
  Member,
  MemberQueuesBySessionAgentId,
  Message,
  Provider,
  Session,
  Strategy,
  Theme,
  ThemePreference,
  WorkflowCardProjection,
  WorkspaceChangesResponse,
} from '@/types';
import type { AsyncResourceState } from '@/lib/asyncResource';
import type {
  CreateProjectRequest,
  InboxItem,
  InboxSummary,
  Project,
} from '../../../../shared/types';
import type {
  ChatInputMode,
  ListUpdater,
  SendMessageOptions,
  ToastTone,
  WorkflowRuntimeLine,
  WorkspaceToast,
} from './workspaceContextTypes';

export interface WorkspaceContextProps {
  theme: Theme;
  themePreference: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  chatMessageFontSize: number;
  setChatMessageFontSize: (size: number) => void;
  members: Member[];
  setMembers: (members: ListUpdater<Member>) => void;
  sessions: Session[];
  setSessions: (sessions: ListUpdater<Session>) => void;
  projects: Project[];
  projectsAsync: AsyncResourceState<Project[]>;
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
  refreshProjects: () => Promise<void>;
  createProject: (data: CreateProjectRequest) => Promise<Project>;
  messages: Message[];
  memberQueuesBySessionAgentId: MemberQueuesBySessionAgentId;
  queuedUserMessagesById: Record<string, Message>;
  workflowRuntimeLinesByExecution: Record<string, WorkflowRuntimeLine[]>;
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
  chatInputMode: ChatInputMode;
  setChatInputMode: (mode?: ChatInputMode) => void;
  setSessionChatInputMode: (sessionId: string, mode: ChatInputMode) => void;
  ensureWorkflowRouteToMainAgent: () => Promise<void>;
  mainAgentName: string | null;
  providers: Provider[];
  setProviders: (providers: ListUpdater<Provider>) => void;
  strategies: Strategy[];
  selectedStrategyId: string;
  setSelectedStrategyId: (id: string) => void;
  selectedOnboardType: 'saas' | 'cli' | 'game' | 'ai';
  setSelectedOnboardType: (type: 'saas' | 'cli' | 'game' | 'ai') => void;
  smartRouting: boolean;
  setSmartRouting: (enabled: boolean) => void;
  showCost: boolean;
  setShowCost: (enabled: boolean) => void;
  showExplanation: boolean;
  setShowExplanation: (enabled: boolean) => void;
  warnOverDollar: boolean;
  setWarnOverDollar: (enabled: boolean) => void;
  weeklyCost: number;
  weeklySaved: number;
  earlyBirdLeft: number;
  setEarlyBirdLeft: (value: number | ((previous: number) => number)) => void;
  isAddMemberModalOpen: boolean;
  setIsAddMemberModalOpen: (open: boolean) => void;
  isAddProviderModalOpen: boolean;
  setIsAddProviderModalOpen: (open: boolean) => void;
  sendMessage: (text: string, options?: SendMessageOptions) => void;
  sendMessageToSession: (
    sessionId: string,
    text: string,
    options?: SendMessageOptions,
  ) => void;
  addMemberToOrganization: (name: string, model: string) => void;
  addProviderToKeychain: (name: string, key: string) => void;
  t: (key: string, replacements?: Record<string, string | number>) => string;
  toast: WorkspaceToast | null;
  showToast: (message: string, tone?: ToastTone) => void;
  activeSettingsTab: string;
  setActiveSettingsTab: (tab: string) => void;
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
  saveConfigPatch: (patch: Partial<Config>) => Promise<Config>;
  environment: Environment | null;
  inboxSummaryAsync: AsyncResourceState<InboxSummary>;
  inboxItemsAsync: AsyncResourceState<InboxItem[]>;
  refreshInbox: () => Promise<void>;
  markInboxItemRead: (itemId: string) => Promise<void>;
  markInboxItemsRead: (itemIds: string[]) => Promise<void>;
  markAllInboxRead: () => Promise<void>;
  archiveInboxItem: (itemId: string) => Promise<void>;
  workflowCard: WorkflowCardProjection | null;
  workflowCardAsync: AsyncResourceState<WorkflowCardProjection | null>;
  refreshWorkflowCard: (messageId: string) => Promise<void>;
  refreshSessionWorkflowStatus: (sessionId: string) => Promise<void>;
  workspaceChanges: WorkspaceChangesResponse | null;
  workspaceChangesAsync: AsyncResourceState<WorkspaceChangesResponse | null>;
  refreshWorkspaceChanges: (
    sessionId: string,
    path: string,
    includeDiff?: boolean,
  ) => Promise<void>;
  resetWorkspaceChanges: () => void;
  refreshAll: () => Promise<void>;
}
