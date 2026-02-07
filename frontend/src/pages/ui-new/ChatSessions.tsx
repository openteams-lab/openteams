import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CaretRightIcon,
  ChatsTeardropIcon,
  PencilSimpleIcon,
  PaperclipIcon,
  PaperPlaneRightIcon,
  PlusIcon,
  UsersIcon,
  ArrowsOutSimpleIcon,
  ArrowsInSimpleIcon,
  XIcon,
} from '@phosphor-icons/react';
import {
  ChatAgent,
  ChatMessage,
  ChatSenderType,
  ChatSessionStatus,
  ChatSessionAgent,
  ChatSessionAgentState,
  BaseCodingAgent,
  type AvailabilityInfo,
  type JsonValue,
  type ChatStreamEvent,
} from 'shared/types';
import { chatApi, configApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { PrimaryButton } from '@/components/ui-new/primitives/PrimaryButton';
import { MultiSelectDropdown } from '@/components/ui-new/primitives/MultiSelectDropdown';
import { ChatEntryContainer } from '@/components/ui-new/primitives/conversation/ChatEntryContainer';
import { ChatMarkdown } from '@/components/ui-new/primitives/conversation/ChatMarkdown';
import { ChatSystemMessage } from '@/components/ui-new/primitives/conversation/ChatSystemMessage';
import { DiffViewBody } from '@/components/ui-new/primitives/conversation/PierreConversationDiff';
import { useUserSystem } from '@/components/ConfigProvider';
import { useTheme } from '@/components/ThemeProvider';
import { formatDateShortWithTime } from '@/utils/date';
import { parseDiffStats } from '@/utils/diffStatsParser';
import { toPrettyCase } from '@/utils/string';
import { getActualTheme } from '@/utils/theme';

type StreamRun = {
  agentId: string;
  content: string;
  isFinal: boolean;
};

type RunHistoryItem = {
  runId: string;
  agentId: string;
  createdAt: string;
  content: string;
};

type SessionMember = {
  agent: ChatAgent;
  sessionAgent: ChatSessionAgent;
};

type DiffMeta = {
  runId: string | null;
  preview: string | null;
  truncated: boolean;
  available: boolean;
  untrackedFiles: string[];
};

type ChatAttachment = {
  id: string;
  name: string;
  mime_type?: string | null;
  size_bytes?: number;
  kind?: string;
  relative_path?: string;
};

const mentionRegex = /(^|\s)@([a-zA-Z0-9_-]*)$/;
const mentionTokenRegex = /(^|\s)@([a-zA-Z0-9_-]+)/g;
const memberNameRegex = /^[a-zA-Z0-9_-]+$/;

const fallbackRunnerTypes = [
  'CLAUDE_CODE',
  'CODEX',
  'AMP',
  'GEMINI',
  'OPENCODE',
  'CURSOR_AGENT',
  'QWEN_CODE',
  'COPILOT',
  'DROID',
];

const agentStateLabels: Record<ChatSessionAgentState, string> = {
  idle: 'Idle',
  running: 'Running',
  waitingapproval: 'Waiting approval',
  dead: 'Dead',
};

const agentStateDotClass: Record<ChatSessionAgentState, string> = {
  idle: 'bg-low',
  running: 'bg-brand',
  waitingapproval: 'bg-brand-secondary',
  dead: 'bg-error',
};

const messagePalette = [
  { bg: 'rgba(226, 239, 255, 0.8)', border: 'rgba(176, 205, 242, 0.7)' },
  { bg: 'rgba(231, 249, 239, 0.85)', border: 'rgba(176, 223, 198, 0.7)' },
  { bg: 'rgba(255, 243, 227, 0.85)', border: 'rgba(231, 204, 173, 0.7)' },
  { bg: 'rgba(245, 236, 255, 0.8)', border: 'rgba(209, 187, 234, 0.7)' },
  { bg: 'rgba(255, 236, 242, 0.8)', border: 'rgba(232, 184, 198, 0.7)' },
  { bg: 'rgba(238, 244, 248, 0.85)', border: 'rgba(189, 205, 217, 0.7)' },
];

function hashKey(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getMessageTone(key: string, isUser: boolean) {
  if (isUser) {
    return { bg: 'rgba(219, 238, 255, 0.9)', border: 'rgba(156, 197, 237, 0.8)' };
  }
  const index = hashKey(key) % messagePalette.length;
  return messagePalette[index];
}

function extractMentions(content: string): Set<string> {
  const mentions = new Set<string>();
  for (const match of content.matchAll(mentionTokenRegex)) {
    const name = match[2];
    if (name) mentions.add(name);
  }
  return mentions;
}

function extractRunId(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const runId = (meta as { run_id?: unknown }).run_id;
  return typeof runId === 'string' ? runId : null;
}

function sanitizeHandle(value: string | null | undefined): string {
  if (!value) return 'you';
  const sanitized = value
    .split('@')[0]
    .split(' ')[0]
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  return sanitized.length > 0 ? sanitized : 'you';
}

function extractDiffMeta(meta: unknown): DiffMeta {
  if (!meta || typeof meta !== 'object') {
    return {
      runId: null,
      preview: null,
      truncated: false,
      available: false,
      untrackedFiles: [],
    };
  }
  const raw = meta as {
    run_id?: unknown;
    diff_preview?: unknown;
    diff_truncated?: unknown;
    diff_available?: unknown;
    untracked_files?: unknown;
  };
  const runId = typeof raw.run_id === 'string' ? raw.run_id : null;
  const preview = typeof raw.diff_preview === 'string' ? raw.diff_preview : null;
  const truncated = raw.diff_truncated === true;
  const available = raw.diff_available === true || preview !== null;
  const untrackedFiles = Array.isArray(raw.untracked_files)
    ? raw.untracked_files.filter((item) => typeof item === 'string')
    : [];
  return { runId, preview, truncated, available, untrackedFiles };
}

function extractReferenceId(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const raw = meta as {
    reference?: { message_id?: unknown };
    reference_message_id?: unknown;
  };
  if (raw.reference && typeof raw.reference === 'object') {
    const value = raw.reference.message_id;
    if (typeof value === 'string') return value;
  }
  return typeof raw.reference_message_id === 'string'
    ? raw.reference_message_id
    : null;
}

function extractAttachments(meta: unknown): ChatAttachment[] {
  if (!meta || typeof meta !== 'object') return [];
  const raw = meta as { attachments?: unknown };
  if (!Array.isArray(raw.attachments)) return [];
  return raw.attachments
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as ChatAttachment)
    .filter((item) => typeof item.id === 'string');
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const decimals = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

type DiffFileEntry = {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
};

function splitUnifiedDiff(patch: string): DiffFileEntry[] {
  const lines = patch.split('\n');
  const entries: DiffFileEntry[] = [];
  let current: string[] = [];
  let currentPath = '';

  const flush = () => {
    if (current.length === 0) return;
    const content = current.join('\n');
    const path = currentPath || 'unknown';
    const stats = parseDiffStats(content);
    entries.push({
      path,
      patch: content,
      additions: stats.additions,
      deletions: stats.deletions,
    });
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush();
      current = [line];
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      currentPath = match?.[2] || line.replace('diff --git ', '').trim();
      continue;
    }
    if (current.length > 0) {
      current.push(line);
    }
  }

  flush();
  return entries;
}

export function ChatSessions() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptFileInputRef = useRef<HTMLInputElement | null>(null);
  const { profiles, loginStatus } = useUserSystem();
  const { theme } = useTheme();
  const actualTheme = getActualTheme(theme);

  const { data: sessions = [], isLoading: isSessionsLoading } = useQuery({
    queryKey: ['chatSessions'],
    queryFn: () => chatApi.listSessions(),
  });

  const { data: agents = [], isLoading: isAgentsLoading } = useQuery({
    queryKey: ['chatAgents'],
    queryFn: () => chatApi.listAgents(),
  });

  const sortedSessions = useMemo(
    () =>
      [...sessions].sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      ),
    [sessions]
  );

  const activeSessions = useMemo(
    () =>
      sortedSessions.filter(
        (session) => session.status === ChatSessionStatus.active
      ),
    [sortedSessions]
  );

  const archivedSessions = useMemo(
    () =>
      sortedSessions.filter(
        (session) => session.status === ChatSessionStatus.archived
      ),
    [sortedSessions]
  );

  const activeSessionId = sessionId ?? sortedSessions[0]?.id ?? null;

  useEffect(() => {
    if (!sessionId && sortedSessions.length > 0) {
      navigate(`/chat/${sortedSessions[0].id}`, { replace: true });
    }
    if (
      sessionId &&
      sortedSessions.length > 0 &&
      !sortedSessions.some((session) => session.id === sessionId)
    ) {
      navigate(`/chat/${sortedSessions[0].id}`, { replace: true });
    }
  }, [navigate, sessionId, sortedSessions]);

  const { data: sessionAgents = [], isLoading: isSessionAgentsLoading } =
    useQuery({
      queryKey: ['chatSessionAgents', activeSessionId],
      queryFn: () => chatApi.listSessionAgents(activeSessionId!),
      enabled: !!activeSessionId,
    });

  const {
    data: messagesData = [],
    isLoading: isMessagesLoading,
  } = useQuery({
    queryKey: ['chatMessages', activeSessionId],
    queryFn: () => chatApi.listMessages(activeSessionId!),
    enabled: !!activeSessionId,
  });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [replyToMessage, setReplyToMessage] = useState<ChatMessage | null>(
    null
  );
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [agentAvailability, setAgentAvailability] = useState<
    Record<string, AvailabilityInfo | null>
  >({});
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [streamingRuns, setStreamingRuns] = useState<Record<string, StreamRun>>(
    {}
  );
  const [agentStates, setAgentStates] = useState<
    Record<string, ChatSessionAgentState>
  >({});
  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [workspaceDrawerOpen, setWorkspaceDrawerOpen] = useState(false);
  const [workspaceAgentId, setWorkspaceAgentId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<SessionMember | null>(
    null
  );
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRunnerType, setNewMemberRunnerType] = useState('');
  const [newMemberPrompt, setNewMemberPrompt] = useState('');
  const [newMemberWorkspace, setNewMemberWorkspace] = useState('');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [isSavingMember, setIsSavingMember] = useState(false);
  const [isPromptEditorOpen, setIsPromptEditorOpen] = useState(false);
  const [promptFileError, setPromptFileError] = useState<string | null>(null);
  const [promptFileLoading, setPromptFileLoading] = useState(false);
  const [logRunId, setLogRunId] = useState<string | null>(null);
  const [logContent, setLogContent] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [runningSince, setRunningSince] = useState<Record<string, number>>({});
  const [clock, setClock] = useState(() => Date.now());
  const [showArchived, setShowArchived] = useState(false);
  const [runDiffs, setRunDiffs] = useState<
    Record<
      string,
      { loading: boolean; error: string | null; files: DiffFileEntry[] }
    >
  >({});
  const [untrackedContent, setUntrackedContent] = useState<
    Record<
      string,
      { loading: boolean; error: string | null; content: string | null; open: boolean }
    >
  >({});
  const [diffViewerRunId, setDiffViewerRunId] = useState<string | null>(null);
  const [diffViewerUntracked, setDiffViewerUntracked] = useState<string[]>([]);
  const [diffViewerHasDiff, setDiffViewerHasDiff] = useState(false);
  const [diffViewerOpen, setDiffViewerOpen] = useState(false);
  const [diffViewerFullscreen, setDiffViewerFullscreen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);

  useEffect(() => {
    if (activeSessionId) {
      setMessages(messagesData);
    } else {
    setMessages([]);
  }
}, [messagesData, activeSessionId]);

useEffect(() => {
    setReplyToMessage(null);
    setIsUploadingAttachments(false);
    setAttachmentError(null);
    setStreamingRuns({});
    setAgentStates({});
    setSelectedMentions([]);
    setDraft('');
    setMentionQuery(null);
    setWorkspaceDrawerOpen(false);
    setWorkspaceAgentId(null);
    setIsAddMemberOpen(false);
    setNewMemberName('');
    setNewMemberPrompt('');
    setNewMemberWorkspace('');
    setMemberError(null);
    setEditingMember(null);
    setLogRunId(null);
    setLogContent('');
    setLogError(null);
    setRunningSince({});
    setClock(Date.now());
    setRunDiffs({});
    setUntrackedContent({});
    setDiffViewerRunId(null);
    setDiffViewerUntracked([]);
    setDiffViewerHasDiff(false);
    setDiffViewerOpen(false);
    setDiffViewerFullscreen(false);
    setIsEditingTitle(false);
    setTitleError(null);
    setIsPromptEditorOpen(false);
    setPromptFileError(null);
    setPromptFileLoading(false);
  }, [activeSessionId]);

  const availableRunnerTypes = useMemo(() => {
    const keys = Object.keys(profiles ?? {});
    const baseList = keys.length > 0 ? keys : fallbackRunnerTypes;
    if (editingMember && !baseList.includes(editingMember.agent.runner_type)) {
      return [...baseList, editingMember.agent.runner_type];
    }
    return baseList;
  }, [editingMember, profiles]);

  const isRunnerAvailable = useCallback(
    (runner: string) => {
      const info = agentAvailability[runner];
      return (
        info?.type === 'LOGIN_DETECTED' ||
        info?.type === 'INSTALLATION_FOUND'
      );
    },
    [agentAvailability]
  );

  const enabledRunnerTypes = useMemo(
    () => availableRunnerTypes.filter((runner) => isRunnerAvailable(runner)),
    [availableRunnerTypes, isRunnerAvailable]
  );

  const availabilityLabel = useCallback(
    (runner: string) => {
      const info = agentAvailability[runner];
      if (!info) return isCheckingAvailability ? ' (checking)' : ' (unavailable)';
      if (
        info.type === 'LOGIN_DETECTED' ||
        info.type === 'INSTALLATION_FOUND'
      ) {
        return '';
      }
      return ' (not installed)';
    },
    [agentAvailability, isCheckingAvailability]
  );

  const senderHandle = useMemo(() => {
    if (loginStatus?.status === 'loggedin') {
      return sanitizeHandle(
        loginStatus.profile.username ??
          loginStatus.profile.email ??
          loginStatus.profile.user_id
      );
    }
    return 'you';
  }, [loginStatus]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setIsCheckingAvailability(true);
      const knownAgents = new Set(Object.values(BaseCodingAgent));
      const results = await Promise.all(
        availableRunnerTypes.map(async (runner) => {
          if (!knownAgents.has(runner as BaseCodingAgent)) {
            return [runner, null] as const;
          }
          try {
            const info = await configApi.checkAgentAvailability(
              runner as BaseCodingAgent
            );
            return [runner, info] as const;
          } catch (error) {
            console.warn('Failed to check agent availability', error);
            return [runner, null] as const;
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, AvailabilityInfo | null> = {};
      results.forEach(([runner, info]) => {
        next[runner] = info;
      });
      setAgentAvailability(next);
      setIsCheckingAvailability(false);
    };

    if (availableRunnerTypes.length > 0) {
      run();
    } else {
      setAgentAvailability({});
      setIsCheckingAvailability(false);
    }

    return () => {
      cancelled = true;
    };
  }, [availableRunnerTypes]);

  useEffect(() => {
    if (editingMember) return;
    if (enabledRunnerTypes.length === 0) {
      setNewMemberRunnerType('');
      return;
    }
    if (!newMemberRunnerType || !isRunnerAvailable(newMemberRunnerType)) {
      setNewMemberRunnerType(enabledRunnerTypes[0]);
    }
  }, [editingMember, enabledRunnerTypes, isRunnerAvailable, newMemberRunnerType]);

  useEffect(() => {
    setAgentStates((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const agent of agents) {
        if (!next[agent.id]) {
          next[agent.id] = ChatSessionAgentState.idle;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [agents]);

  useEffect(() => {
    setAgentStates((prev) => {
      const next = { ...prev };
      for (const sessionAgent of sessionAgents) {
        next[sessionAgent.agent_id] = sessionAgent.state;
      }
      return next;
    });
  }, [sessionAgents]);

  const upsertMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === message.id);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = message;
        return next;
      }
      return [...prev, message];
    });
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    let ws: WebSocket | null = null;
    let shouldReconnect = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const streamUrl = chatApi.getStreamUrl(activeSessionId);
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${protocol}://${window.location.host}${streamUrl}`;
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as ChatStreamEvent;
          if (payload.type === 'message_new') {
            const message = payload.message;
            upsertMessage(message);
            const runId = extractRunId(message.meta);
            if (runId) {
              setStreamingRuns((prev) => {
                if (!prev[runId]) return prev;
                const next = { ...prev };
                delete next[runId];
                return next;
              });
            }
            return;
          }

          if (payload.type === 'agent_delta') {
            setStreamingRuns((prev) => {
              const previous = prev[payload.run_id];
              const content =
                payload.delta && previous
                  ? `${previous.content}${payload.content}`
                  : payload.content;
              return {
                ...prev,
                [payload.run_id]: {
                  agentId: payload.agent_id,
                  content,
                  isFinal: payload.is_final,
                },
              };
            });
            if (payload.is_final) {
              setTimeout(() => {
                setStreamingRuns((prev) => {
                  if (!prev[payload.run_id]) return prev;
                  const next = { ...prev };
                  delete next[payload.run_id];
                  return next;
                });
              }, 1500);
            }
            return;
          }

          if (payload.type === 'agent_state') {
            setAgentStates((prev) => ({
              ...prev,
              [payload.agent_id]: payload.state,
            }));
          }
        } catch (error) {
          console.warn('Failed to parse chat stream payload', error);
        }
      };

      ws.onclose = () => {
        if (!shouldReconnect) return;
        reconnectTimer = setTimeout(connect, 1500);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      shouldReconnect = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [activeSessionId, upsertMessage]);

  const messageList = useMemo(
    () =>
      [...messages].sort(
        (a, b) =>
          new Date(a.created_at).getTime() -
          new Date(b.created_at).getTime()
      ),
    [messages]
  );
  const messageById = useMemo(
    () => new Map(messageList.map((message) => [message.id, message])),
    [messageList]
  );

  const createSessionMutation = useMutation({
    mutationFn: () => chatApi.createSession({ title: null }),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
      navigate(`/chat/${session.id}`);
    },
  });

  const updateSessionMutation = useMutation({
    mutationFn: (params: { sessionId: string; title: string | null }) =>
      chatApi.updateSession(params.sessionId, {
        title: params.title,
        status: null,
        summary_text: null,
        archive_ref: null,
      }),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
      setTitleDraft(session.title ?? '');
      setIsEditingTitle(false);
      setTitleError(null);
    },
  });

  const archiveSessionMutation = useMutation({
    mutationFn: (id: string) => chatApi.archiveSession(id),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
      navigate(`/chat/${session.id}`);
    },
  });

  const restoreSessionMutation = useMutation({
    mutationFn: (id: string) => chatApi.restoreSession(id),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
      navigate(`/chat/${session.id}`);
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (params: {
      sessionId: string;
      content: string;
      meta?: JsonValue;
    }) =>
      chatApi.createMessage(
        params.sessionId,
        chatApi.buildCreateMessageRequest(params.content, params.meta ?? null)
      ),
    onSuccess: (message) => {
      upsertMessage(message);
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
    },
  });

  const handleSend = async () => {
    if (!activeSessionId || isArchived) return;
    const trimmed = draft.trim();
    const contentMentions = extractMentions(draft);
    const mentionsToInject = selectedMentions.filter(
      (name) => !contentMentions.has(name)
    );
    const mentionPrefix =
      mentionsToInject.length > 0
        ? mentionsToInject.map((name) => `@${name}`).join(' ')
        : '';
    const content = [mentionPrefix, trimmed].filter(Boolean).join(' ').trim();
    if (!content) return;

    const meta: JsonValue = {
      sender_handle: senderHandle,
      ...(replyToMessage
        ? { reference: { message_id: replyToMessage.id } }
        : {}),
    };

    try {
      await sendMessageMutation.mutateAsync({
        sessionId: activeSessionId,
        content,
        meta,
      });

      setDraft('');
      setSelectedMentions([]);
      setMentionQuery(null);
      setReplyToMessage(null);
      inputRef.current?.focus();
    } catch (error) {
      console.warn('Failed to send chat message', error);
    }
  };

  const handleAttachmentUpload = async (files: FileList | File[]) => {
    if (!activeSessionId || isArchived) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setIsUploadingAttachments(true);
    setAttachmentError(null);
    try {
      const message = await chatApi.uploadChatAttachments(
        activeSessionId,
        list,
        senderHandle
      );
      upsertMessage(message);
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
    } catch (error) {
      console.warn('Failed to upload attachments', error);
      setAttachmentError('Unable to upload attachments.');
    } finally {
      setIsUploadingAttachments(false);
    }
  };

  const handleAttachmentInputChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    if (event.target.files) {
      handleAttachmentUpload(event.target.files);
    }
    event.target.value = '';
  };

  const handlePromptFileChange = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPromptFileLoading(true);
    setPromptFileError(null);
    try {
      const text = await file.text();
      setNewMemberPrompt(text);
    } catch (error) {
      console.warn('Failed to read prompt file', error);
      setPromptFileError('Unable to read the file.');
    } finally {
      setPromptFileLoading(false);
      event.target.value = '';
    }
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    const match = mentionRegex.exec(value);
    if (match) {
      setMentionQuery(match[2] ?? '');
    } else {
      setMentionQuery(null);
    }
  };

  const handleMentionSelect = (name: string) => {
    setDraft((prev) => {
      const match = mentionRegex.exec(prev);
      if (!match) {
        return `${prev}${
          prev.endsWith(' ') || prev.length === 0 ? '' : ' '
        }@${name} `;
      }
      const matchIndex = match.index ?? prev.length;
      const prefix = prev.slice(0, matchIndex);
      const spacer = match[1] ?? '';
      return `${prefix}${spacer}@${name} `;
    });
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  const agentById = useMemo(() => {
    const map = new Map<string, ChatAgent>();
    for (const agent of agents) map.set(agent.id, agent);
    return map;
  }, [agents]);

  const getMessageSenderLabel = useCallback(
    (message: ChatMessage) => {
      if (message.sender_type === ChatSenderType.user) return 'You';
      if (message.sender_type === ChatSenderType.agent) {
        if (message.sender_id) {
          return agentById.get(message.sender_id)?.name ?? 'Agent';
        }
        return 'Agent';
      }
      return 'System';
    },
    [agentById]
  );

  const getReferencePreview = useCallback(
    (message: ChatMessage) => {
      const attachments = extractAttachments(message.meta);
      const trimmed = message.content.trim();
      if (trimmed) return truncateText(trimmed, 140);
      if (attachments.length > 0) {
        const names = attachments
          .map((item) => item.name)
          .filter(Boolean)
          .slice(0, 3);
        const suffix =
          attachments.length > 3 ? ` and ${attachments.length - 3} more` : '';
        return `Attachment: ${names.join(', ')}${suffix}`;
      }
      return 'Referenced message';
    },
    []
  );

  const sessionMembers = useMemo<SessionMember[]>(() => {
    return sessionAgents
      .map((sessionAgent) => {
        const agent = agentById.get(sessionAgent.agent_id);
        if (!agent) return null;
        return { agent, sessionAgent };
      })
      .filter((item): item is SessionMember => item !== null);
  }, [agentById, sessionAgents]);

  const mentionAgents = useMemo(
    () => sessionMembers.map((member) => member.agent),
    [sessionMembers]
  );

  useEffect(() => {
    if (mentionAgents.length === 0) {
      setSelectedMentions([]);
      return;
    }
    setSelectedMentions((prev) =>
      prev.filter((mention) =>
        mentionAgents.some((agent) => agent.name === mention)
      )
    );
  }, [mentionAgents]);

  const visibleMentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLowerCase();
    return mentionAgents.filter((agent) =>
      agent.name.toLowerCase().includes(query)
    );
  }, [mentionAgents, mentionQuery]);

  const agentOptions = useMemo(
    () =>
      mentionAgents.map((agent) => ({
        value: agent.name,
        label: agent.name,
      })),
    [mentionAgents]
  );

  const placeholderAgents = useMemo(
    () =>
      sessionMembers.filter(
        (member) => agentStates[member.agent.id] === ChatSessionAgentState.running
      ),
    [agentStates, sessionMembers]
  );

  useEffect(() => {
    setRunningSince((prev) => {
      const runningIds = new Set(
        sessionMembers
          .filter(
            (member) =>
              agentStates[member.agent.id] === ChatSessionAgentState.running
          )
          .map((member) => member.agent.id)
      );

      let changed = false;
      const next = { ...prev };
      for (const id of runningIds) {
        if (!next[id]) {
          next[id] = Date.now();
          changed = true;
        }
      }
      for (const id of Object.keys(next)) {
        if (!runningIds.has(id)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [agentStates, sessionMembers]);

  useEffect(() => {
    if (Object.keys(runningSince).length === 0) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runningSince]);

  const runHistory = useMemo(() => {
    const runs: RunHistoryItem[] = [];
    for (const message of messages) {
      if (message.sender_type !== ChatSenderType.agent || !message.sender_id) {
        continue;
      }
      const runId = extractRunId(message.meta);
      if (!runId) continue;
      runs.push({
        runId,
        agentId: message.sender_id,
        createdAt: message.created_at,
        content: message.content,
      });
    }
    return runs;
  }, [messages]);

  const activeWorkspaceAgent = workspaceAgentId
    ? agentById.get(workspaceAgentId)
    : null;
  const workspacePath = useMemo(() => {
    if (!workspaceAgentId) return null;
    const sessionAgent = sessionAgents.find(
      (item) => item.agent_id === workspaceAgentId
    );
    if (sessionAgent?.workspace_path) return sessionAgent.workspace_path;
    if (!activeSessionId) return null;
    return `chat/session_${activeSessionId}/agents/${workspaceAgentId}`;
  }, [activeSessionId, sessionAgents, workspaceAgentId]);

  const activeWorkspaceRuns = useMemo(
    () =>
      runHistory
        .filter((run) => run.agentId === workspaceAgentId)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ),
    [runHistory, workspaceAgentId]
  );

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId]
  );

  useEffect(() => {
    setTitleDraft(activeSession?.title ?? '');
    setIsEditingTitle(false);
    setTitleError(null);
  }, [activeSession?.id]);

  const isArchived =
    activeSession?.status === ChatSessionStatus.archived;

  useEffect(() => {
    if (activeSession?.status === ChatSessionStatus.archived) {
      setShowArchived(true);
    }
  }, [activeSession?.status]);

  const handleAddMember = async () => {
    if (!activeSessionId) {
      setMemberError('Select a chat session first.');
      return;
    }
    if (isArchived) {
      setMemberError('This session is archived and read-only.');
      return;
    }

    const name = newMemberName.trim();
    const runnerType = newMemberRunnerType.trim();
    const prompt = newMemberPrompt.trim();
    const workspacePath = newMemberWorkspace.trim();

    if (!name) {
      setMemberError('AI member name is required.');
      return;
    }

    if (!memberNameRegex.test(name)) {
      setMemberError('Name can only include letters, numbers, "_" or "-".');
      return;
    }

    if (!runnerType) {
      setMemberError('Choose a base coding agent.');
      return;
    }

    if (!isRunnerAvailable(runnerType)) {
      setMemberError('Selected coding agent is not available locally.');
      return;
    }

    if (!workspacePath) {
      setMemberError('Workspace path is required.');
      return;
    }

    if (!prompt) {
      setMemberError('System prompt is required.');
      return;
    }

    setIsSavingMember(true);
    setMemberError(null);

    try {
      if (editingMember) {
        const agentId = editingMember.agent.id;
        const updatePayload = {
          name: editingMember.agent.name !== name ? name : null,
          runner_type:
            editingMember.agent.runner_type !== runnerType
              ? runnerType
              : null,
          system_prompt:
            (editingMember.agent.system_prompt ?? '') !== prompt ? prompt : null,
          tools_enabled: null,
        };

        if (
          updatePayload.name ||
          updatePayload.runner_type ||
          updatePayload.system_prompt
        ) {
          await chatApi.updateAgent(agentId, updatePayload);
        }

        await chatApi.updateSessionAgent(
          activeSessionId,
          editingMember.sessionAgent.id,
          { workspace_path: workspacePath }
        );
      } else {
        const existing = agents.find((agent) => agent.name === name);
        let agentId = existing?.id ?? null;
        if (existing) {
          const updatePayload = {
            name: null,
            runner_type:
              existing.runner_type !== runnerType ? runnerType : null,
            system_prompt:
              (existing.system_prompt ?? '') !== prompt ? prompt : null,
            tools_enabled: null,
          };

          if (updatePayload.runner_type || updatePayload.system_prompt) {
            const updated = await chatApi.updateAgent(
              existing.id,
              updatePayload
            );
            agentId = updated.id;
          }
        } else {
          const created = await chatApi.createAgent({
            name,
            runner_type: runnerType,
            system_prompt: prompt,
            tools_enabled: null,
          });
          agentId = created.id;
        }

        if (!agentId) {
          setMemberError('Unable to create AI member.');
          return;
        }

        await chatApi.createSessionAgent(activeSessionId, {
          agent_id: agentId,
          workspace_path: workspacePath,
        });
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['chatAgents'] }),
        queryClient.invalidateQueries({
          queryKey: ['chatSessionAgents', activeSessionId],
        }),
      ]);

      setNewMemberName('');
      setNewMemberPrompt('');
      setNewMemberWorkspace('');
      setMemberError(null);
      setEditingMember(null);
      setIsAddMemberOpen(false);
    } catch (error) {
      console.warn('Failed to add AI member', error);
      setMemberError('Failed to add AI member. Check server logs.');
    } finally {
      setIsSavingMember(false);
    }
  };

  const handleEditMember = (member: SessionMember) => {
    if (isArchived) {
      setMemberError('This session is archived and read-only.');
      return;
    }
    setEditingMember(member);
    setNewMemberName(member.agent.name);
    setNewMemberRunnerType(member.agent.runner_type);
    setNewMemberPrompt(member.agent.system_prompt ?? '');
    setNewMemberWorkspace(member.sessionAgent.workspace_path ?? '');
    setMemberError(null);
    setIsPromptEditorOpen(false);
    setPromptFileError(null);
    setPromptFileLoading(false);
    setIsAddMemberOpen(true);
  };

  const handleRemoveMember = async (member: SessionMember) => {
    if (!activeSessionId) return;
    if (isArchived) {
      setMemberError('This session is archived and read-only.');
      return;
    }
    const confirmed = window.confirm(
      `Remove @${member.agent.name} from this session?`
    );
    if (!confirmed) return;

    try {
      await chatApi.deleteSessionAgent(
        activeSessionId,
        member.sessionAgent.id
      );
      await queryClient.invalidateQueries({
        queryKey: ['chatSessionAgents', activeSessionId],
      });
      if (workspaceAgentId === member.agent.id) {
        setWorkspaceDrawerOpen(false);
        setWorkspaceAgentId(null);
      }
    } catch (error) {
      console.warn('Failed to remove AI member', error);
      setMemberError('Failed to remove AI member.');
    }
  };

  const handleSaveTitle = async () => {
    if (!activeSessionId) return;
    const trimmed = titleDraft.trim();
    try {
      await updateSessionMutation.mutateAsync({
        sessionId: activeSessionId,
        title: trimmed.length > 0 ? trimmed : null,
      });
    } catch (error) {
      console.warn('Failed to update session title', error);
      setTitleError('Unable to update session name.');
    }
  };

  const handleCancelTitleEdit = () => {
    setTitleDraft(activeSession?.title ?? '');
    setIsEditingTitle(false);
    setTitleError(null);
  };

  const handleLoadLog = async (runId: string) => {
    setLogRunId(runId);
    setLogLoading(true);
    setLogError(null);
    try {
      const content = await chatApi.getRunLog(runId);
      setLogContent(content);
    } catch (error) {
      console.warn('Failed to load run log', error);
      setLogError('Unable to load run log.');
      setLogContent('');
    } finally {
      setLogLoading(false);
    }
  };

  const handleOpenDiffViewer = (
    runId: string,
    untracked: string[],
    hasDiff: boolean
  ) => {
    setDiffViewerRunId(runId);
    setDiffViewerUntracked(untracked);
    setDiffViewerHasDiff(hasDiff);
    setDiffViewerOpen(true);
    setDiffViewerFullscreen(false);
    if (runId && hasDiff) {
      handleLoadDiff(runId);
    }
  };

  const handleCloseDiffViewer = () => {
    setDiffViewerOpen(false);
    setDiffViewerFullscreen(false);
  };

  const handleLoadDiff = async (runId: string) => {
    setRunDiffs((prev) => {
      const existing = prev[runId];
      if (existing?.loading || existing?.files.length) return prev;
      return {
        ...prev,
        [runId]: { loading: true, error: null, files: [] },
      };
    });

    try {
      const patch = await chatApi.getRunDiff(runId);
      const files = splitUnifiedDiff(patch);
      setRunDiffs((prev) => ({
        ...prev,
        [runId]: { loading: false, error: null, files },
      }));
    } catch (error) {
      console.warn('Failed to load run diff', error);
      setRunDiffs((prev) => ({
        ...prev,
        [runId]: {
          loading: false,
          error: 'Unable to load diff.',
          files: [],
        },
      }));
    }
  };

  const handleToggleUntracked = async (runId: string, path: string) => {
    const key = `${runId}:${path}`;
    const existing = untrackedContent[key];
    if (existing?.open) {
      setUntrackedContent((prev) => ({
        ...prev,
        [key]: { ...existing, open: false },
      }));
      return;
    }

    setUntrackedContent((prev) => ({
      ...prev,
      [key]: {
        loading: !existing?.content && !existing?.error,
        error: existing?.error ?? null,
        content: existing?.content ?? null,
        open: true,
      },
    }));

    if (existing?.content || existing?.error) {
      return;
    }

    try {
      const content = await chatApi.getRunUntrackedFile(runId, path);
      setUntrackedContent((prev) => ({
        ...prev,
        [key]: { loading: false, error: null, content, open: true },
      }));
    } catch (error) {
      console.warn('Failed to load untracked file content', error);
      setUntrackedContent((prev) => ({
        ...prev,
        [key]: {
          loading: false,
          error: 'Unable to load file.',
          content: null,
          open: true,
        },
      }));
    }
  };

  const isLoading =
    isSessionsLoading ||
    isMessagesLoading ||
    isAgentsLoading ||
    isSessionAgentsLoading;
  const canSend =
    !!activeSessionId &&
    !isArchived &&
    (draft.trim().length > 0 || selectedMentions.length > 0) &&
    !sendMessageMutation.isPending &&
    !isUploadingAttachments;
  const diffViewerRun = diffViewerRunId ? runDiffs[diffViewerRunId] : null;
  const DiffViewerIcon = diffViewerFullscreen
    ? ArrowsInSimpleIcon
    : ArrowsOutSimpleIcon;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [
    messageList.length,
    Object.keys(streamingRuns).length,
    placeholderAgents.length,
  ]);

  useEffect(() => {
    setLogRunId(null);
    setLogContent('');
    setLogError(null);
  }, [workspaceAgentId]);

  return (
    <div className="relative flex h-full min-h-0 bg-primary overflow-hidden pt-16">
      <aside className="w-72 border-r border-border flex flex-col min-h-0">
        <div className="px-base py-base border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-half text-normal font-medium">
            <ChatsTeardropIcon className="size-icon-sm" />
            <span>Group Chat</span>
          </div>
          <PrimaryButton
            variant="secondary"
            value="New"
            onClick={() => createSessionMutation.mutate()}
            disabled={createSessionMutation.isPending}
          >
            <PlusIcon className="size-icon-xs" />
          </PrimaryButton>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-base space-y-half">
          {activeSessions.length === 0 && archivedSessions.length === 0 && (
            <div className="text-sm text-low">
              No sessions yet. Create your first group chat.
            </div>
          )}
          {activeSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => navigate(`/chat/${session.id}`)}
                className={cn(
                  'w-full text-left rounded-sm border px-base py-half',
                  isActive
                    ? 'border-brand bg-brand/10 text-normal'
                    : 'border-transparent hover:border-border hover:bg-secondary text-low'
                )}
              >
                <div className="flex items-center justify-between gap-base">
                  <span className="text-sm font-medium truncate text-normal">
                    {session.title || 'Untitled session'}
                  </span>
                  <span className="text-xs text-low">
                    {formatDateShortWithTime(session.updated_at)}
                  </span>
                </div>
              </button>
            );
          })}
          {archivedSessions.length > 0 && (
            <div className="pt-base mt-base border-t border-border space-y-half">
              <button
                type="button"
                onClick={() => setShowArchived((prev) => !prev)}
                className="text-xs text-low uppercase tracking-wide hover:text-normal"
              >
                {showArchived ? 'Hide Archived' : 'Show Archived'} (
                {archivedSessions.length})
              </button>
              {showArchived &&
                archivedSessions.map((session) => {
                  const isActive = session.id === activeSessionId;
                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => navigate(`/chat/${session.id}`)}
                      className={cn(
                        'w-full text-left rounded-sm border px-base py-half',
                        isActive
                          ? 'border-brand bg-brand/10 text-normal'
                          : 'border-transparent hover:border-border hover:bg-secondary text-low'
                      )}
                    >
                      <div className="flex items-center justify-between gap-base">
                        <span className="text-sm font-medium truncate text-normal">
                          {session.title || 'Untitled session'}
                        </span>
                        <span className="text-xs text-low">
                          {formatDateShortWithTime(session.updated_at)}
                        </span>
                      </div>
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      </aside>

      <section className="flex-1 min-w-0 min-h-0 flex flex-col">
        <header className="px-base py-half border-b border-border flex items-center justify-between">
          <div className="min-w-0">
            {!isEditingTitle && (
              <div className="flex items-center gap-half">
                <div className="text-sm text-normal font-medium truncate">
                  {activeSession?.title || 'Untitled session'}
                </div>
                {activeSession && (
                  <button
                    type="button"
                    className="text-low hover:text-normal"
                    onClick={() => {
                      setIsEditingTitle(true);
                      setTitleError(null);
                    }}
                    aria-label="Edit session name"
                  >
                    <PencilSimpleIcon className="size-icon-xs" />
                  </button>
                )}
              </div>
            )}
            {isEditingTitle && (
              <div className="flex items-center gap-half flex-wrap">
                <input
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleSaveTitle();
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      handleCancelTitleEdit();
                    }
                  }}
                  placeholder="Session name"
                  disabled={updateSessionMutation.isPending}
                  className={cn(
                    'w-[240px] max-w-full rounded-sm border border-border bg-panel px-base py-half',
                    'text-sm text-normal focus:outline-none focus:ring-1 focus:ring-brand'
                  )}
                />
                <PrimaryButton
                  value="Save"
                  onClick={handleSaveTitle}
                  disabled={updateSessionMutation.isPending}
                />
                <PrimaryButton
                  variant="tertiary"
                  value="Cancel"
                  onClick={handleCancelTitleEdit}
                  disabled={updateSessionMutation.isPending}
                />
              </div>
            )}
            {titleError && (
              <div className="text-xs text-error">{titleError}</div>
            )}
            {activeSession && (
              <div className="text-xs text-low">
                Created {formatDateShortWithTime(activeSession.created_at)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-base">
            <div className="flex items-center gap-base text-xs text-low">
              <UsersIcon className="size-icon-xs" />
              <span>{sessionMembers.length} AI members</span>
            </div>
            {activeSession && (
              <div className="flex items-center gap-half">
                {isArchived && (
                  <Badge variant="secondary" className="text-xs">
                    Archived
                  </Badge>
                )}
                <PrimaryButton
                  variant="secondary"
                  value={isArchived ? 'Restore' : 'Archive'}
                  onClick={() => {
                    if (!activeSessionId) return;
                    if (isArchived) {
                      restoreSessionMutation.mutate(activeSessionId);
                    } else {
                      archiveSessionMutation.mutate(activeSessionId);
                    }
                  }}
                  disabled={
                    archiveSessionMutation.isPending ||
                    restoreSessionMutation.isPending
                  }
                />
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-base space-y-base">
          {isLoading && (
            <div className="text-sm text-low">Loading chat...</div>
          )}
          {isArchived && !isLoading && (
            <div className="text-xs text-low border border-border rounded-sm bg-secondary/60 px-base py-half">
              This session is archived. Messages and members are read-only.
            </div>
          )}
          {!isLoading && messageList.length === 0 && (
            <div className="text-sm text-low">
              No messages yet. Start the conversation below.
            </div>
          )}

          {messageList.map((message) => {
            const isUser = message.sender_type === ChatSenderType.user;
            const isAgent = message.sender_type === ChatSenderType.agent;
            const agentName =
              isAgent && message.sender_id
                ? agentById.get(message.sender_id)?.name ?? 'Agent'
                : null;
            const diffMeta = isAgent ? extractDiffMeta(message.meta) : null;
            const attachments = extractAttachments(message.meta);
            const referenceId = extractReferenceId(message.meta);
            const referenceMessage = referenceId
              ? messageById.get(referenceId)
              : null;
            const toneKey = isUser
              ? 'user'
              : message.sender_id ?? agentName ?? 'agent';
            const tone = getMessageTone(String(toneKey), isUser);

            if (message.sender_type === ChatSenderType.system) {
              return (
                <ChatSystemMessage
                  key={message.id}
                  content={message.content}
                  expanded
                />
              );
            }

            return (
              <div
                key={message.id}
                id={`chat-message-${message.id}`}
                className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
              >
                <ChatEntryContainer
                  variant={isUser ? 'user' : 'system'}
                  title={isUser ? 'You' : agentName ?? 'Agent'}
                  expanded
                  headerRight={
                    <div className="flex items-center gap-half text-xs text-low">
                      <button
                        type="button"
                        className={cn(
                          'text-brand hover:text-brand-hover',
                          isArchived && 'pointer-events-none opacity-50'
                        )}
                        onClick={() => setReplyToMessage(message)}
                        disabled={isArchived}
                      >
                        引用
                      </button>
                      <span>{formatDateShortWithTime(message.created_at)}</span>
                    </div>
                  }
                  className={cn(
                    'max-w-[720px] w-full md:w-[80%] shadow-sm rounded-2xl',
                    isUser && 'ml-auto'
                  )}
                  headerClassName="bg-transparent"
                  style={{
                    backgroundColor: tone.bg,
                    borderColor: tone.border,
                  }}
                >
                  {referenceId && (
                    <div className="mb-half border border-border rounded-sm bg-secondary/60 px-base py-half text-xs text-low">
                      <div className="flex items-center justify-between gap-base">
                        <span className="font-medium text-normal">
                          Replying to{' '}
                          {referenceMessage
                            ? getMessageSenderLabel(referenceMessage)
                            : 'message'}
                        </span>
                        <button
                          type="button"
                          className="text-brand hover:text-brand-hover"
                          onClick={() => {
                            if (referenceMessage) {
                              const element = document.getElementById(
                                `chat-message-${referenceMessage.id}`
                              );
                              element?.scrollIntoView({ behavior: 'smooth' });
                            }
                          }}
                        >
                          View
                        </button>
                      </div>
                      <div className="mt-half">
                        {referenceMessage
                          ? getReferencePreview(referenceMessage)
                          : 'Referenced message unavailable.'}
                      </div>
                      {referenceMessage &&
                        extractAttachments(referenceMessage.meta).length > 0 && (
                          <div className="mt-half text-xs text-low">
                            Attachments:{' '}
                            {extractAttachments(referenceMessage.meta)
                              .map((item) => item.name)
                              .filter(Boolean)
                              .slice(0, 3)
                              .join(', ')}
                          </div>
                        )}
                    </div>
                  )}
                  <ChatMarkdown content={message.content} />
                  {attachments.length > 0 && (
                    <div className="mt-half space-y-half">
                      {attachments.map((attachment) => {
                        const attachmentUrl =
                          activeSessionId && attachment.id
                            ? chatApi.getChatAttachmentUrl(
                                activeSessionId,
                                message.id,
                                attachment.id
                              )
                            : '#';
                        const isImage =
                          attachment.kind === 'image' ||
                          (attachment.mime_type ?? '').startsWith('image/');
                        return (
                          <div
                            key={attachment.id}
                            className="border border-border rounded-sm bg-panel px-base py-half text-xs text-normal"
                          >
                            <div className="flex items-center justify-between gap-base">
                              <span className="font-ibm-plex-mono break-all">
                                {attachment.name}
                              </span>
                              <a
                                className="text-brand hover:text-brand-hover"
                                href={attachmentUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open
                              </a>
                            </div>
                            {attachment.size_bytes && (
                              <div className="text-xs text-low">
                                {formatBytes(attachment.size_bytes)}
                              </div>
                            )}
                            {isImage && attachmentUrl !== '#' && (
                              <img
                                src={attachmentUrl}
                                alt={attachment.name}
                                loading="lazy"
                                className="mt-half max-h-56 w-auto rounded-sm border border-border"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {(diffMeta?.available ||
                    (diffMeta?.untrackedFiles ?? []).length > 0) &&
                    diffMeta.runId && (
                      <div className="mt-half border border-border rounded-sm bg-secondary/70 px-base py-half text-xs text-normal">
                        <div className="flex items-center justify-between gap-base">
                          <span>Code changes</span>
                          <button
                            type="button"
                            className="text-brand hover:text-brand-hover"
                            onClick={() =>
                              handleOpenDiffViewer(
                                diffMeta.runId!,
                                diffMeta.untrackedFiles,
                                diffMeta.available
                              )
                            }
                          >
                            View changes
                          </button>
                        </div>
                        {diffMeta.available && runDiffs[diffMeta.runId]?.loading && (
                          <div className="mt-half text-xs text-low">
                            Loading diff...
                          </div>
                        )}
                        {diffMeta.available && runDiffs[diffMeta.runId]?.error && (
                          <div className="mt-half text-xs text-error">
                            {runDiffs[diffMeta.runId]?.error}
                          </div>
                        )}
                        {diffMeta.untrackedFiles.length > 0 && (
                          <div className="mt-half text-xs text-low">
                            {diffMeta.untrackedFiles.length} untracked file
                            {diffMeta.untrackedFiles.length === 1 ? '' : 's'}
                          </div>
                        )}
                      </div>
                    )}
                </ChatEntryContainer>
              </div>
            );
          })}

          {placeholderAgents.map((member) => {
            const startedAt = runningSince[member.agent.id] ?? clock;
            const elapsedSeconds = Math.max(
              0,
              Math.floor((clock - startedAt) / 1000)
            );
            const tone = getMessageTone(member.agent.id, false);
            return (
              <div
                key={`placeholder-${member.agent.id}`}
                className="flex justify-start"
              >
                <ChatEntryContainer
                  variant="system"
                  title={member.agent.name}
                  expanded
                  className="max-w-[720px] w-full md:w-[80%] opacity-80 shadow-sm rounded-2xl"
                  headerClassName="bg-transparent"
                  style={{
                    backgroundColor: tone.bg,
                    borderColor: tone.border,
                  }}
                >
                  <ChatMarkdown
                    content={`回复中。。。已用${elapsedSeconds}秒`}
                  />
                </ChatEntryContainer>
              </div>
            );
          })}

          {Object.entries(streamingRuns).map(([runId, run]) => {
            const agentName =
              agentById.get(run.agentId)?.name ?? 'Agent';
            const tone = getMessageTone(run.agentId, false);
            return (
              <div
                key={`stream-${runId}`}
                className="flex justify-start"
              >
                <ChatEntryContainer
                  variant="system"
                  title={agentName}
                  expanded
                  className="max-w-[720px] w-full md:w-[80%] opacity-90 shadow-sm rounded-2xl"
                  headerClassName="bg-transparent"
                  style={{
                    backgroundColor: tone.bg,
                    borderColor: tone.border,
                  }}
                  headerRight={
                    <div className="flex items-center gap-half text-xs text-low">
                      <span>Streaming</span>
                      <span className="flex items-center gap-[2px]">
                        <span className="size-dot rounded-full bg-brand animate-running-dot-1" />
                        <span className="size-dot rounded-full bg-brand animate-running-dot-2" />
                        <span className="size-dot rounded-full bg-brand animate-running-dot-3" />
                      </span>
                    </div>
                  }
                >
                  <ChatMarkdown content={run.content} />
                </ChatEntryContainer>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-border p-base space-y-base">
          <div className="flex items-center gap-base flex-wrap">
            <MultiSelectDropdown
              icon={ChatsTeardropIcon}
              label="Mention agents"
              menuLabel="Route to agents"
              values={selectedMentions}
              options={agentOptions}
              onChange={setSelectedMentions}
              disabled={
                !activeSessionId || mentionAgents.length === 0 || isArchived
              }
            />
            {selectedMentions.length > 0 && (
              <div className="flex items-center gap-half flex-wrap">
                {selectedMentions.map((mention) => (
                  <Badge
                    key={mention}
                    variant="secondary"
                    className="flex items-center gap-half px-2 py-0.5"
                  >
                    @{mention}
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedMentions((prev) =>
                          prev.filter((item) => item !== mention)
                        )
                      }
                      className="text-xs text-low hover:text-normal"
                    >
                      <XIcon className="size-icon-2xs" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {replyToMessage && (
            <div className="border border-border rounded-sm bg-secondary/60 px-base py-half text-xs text-low">
              <div className="flex items-center justify-between gap-base">
                <span className="font-medium text-normal">
                  Replying to {getMessageSenderLabel(replyToMessage)}
                </span>
                <button
                  type="button"
                  className="text-brand hover:text-brand-hover"
                  onClick={() => setReplyToMessage(null)}
                >
                  Cancel
                </button>
              </div>
              <div className="mt-half">
                {getReferencePreview(replyToMessage)}
              </div>
            </div>
          )}

          {attachmentError && (
            <div className="text-xs text-error">{attachmentError}</div>
          )}

          <div className="relative">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => handleDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                isArchived
                  ? 'This session is archived and read-only.'
                  : 'Type your message and @mention agents...'
              }
              rows={8}
              disabled={isArchived || !activeSessionId}
              className={cn(
                'w-full resize-none rounded-sm border border-border bg-panel min-h-[240px]',
                'px-base py-base text-sm text-normal leading-relaxed focus:outline-none focus:ring-1 focus:ring-brand',
                isArchived && 'opacity-60 cursor-not-allowed'
              )}
            />
            {mentionQuery !== null && visibleMentionSuggestions.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-half bg-panel border border-border rounded-sm shadow">
                {visibleMentionSuggestions.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => handleMentionSelect(agent.name)}
                    className={cn(
                      'w-full px-base py-half text-left text-sm text-normal',
                      'hover:bg-secondary flex items-center justify-between'
                    )}
                  >
                    <span>@{agent.name}</span>
                    <CaretRightIcon className="size-icon-xs text-low" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-base">
            <div className="flex items-center gap-half text-xs text-low">
              <button
                type="button"
                className={cn(
                  'flex items-center justify-center rounded-sm border border-border bg-panel px-2 py-1',
                  'text-low hover:text-normal hover:border-border/80',
                  (isArchived || !activeSessionId || isUploadingAttachments) &&
                    'pointer-events-none opacity-50'
                )}
                onClick={() => fileInputRef.current?.click()}
                disabled={isArchived || !activeSessionId || isUploadingAttachments}
              >
                <PaperclipIcon className="size-icon-xs" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleAttachmentInputChange}
              />
              <span>
                {isUploadingAttachments
                  ? 'Uploading attachments...'
                  : 'Press Enter to send, Shift+Enter for new line.'}
              </span>
            </div>
            <PrimaryButton
              value="Send"
              actionIcon={
                sendMessageMutation.isPending ? 'spinner' : PaperPlaneRightIcon
              }
              onClick={handleSend}
              disabled={!canSend}
            />
          </div>
        </div>
      </section>

      <aside className="w-80 border-l border-border flex flex-col min-h-0">
        <div className="px-base py-base border-b border-border flex items-center justify-between">
          <div className="text-sm text-normal font-medium">AI Members</div>
          <div className="text-xs text-low">
            {sessionMembers.length} in session
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-base space-y-base">
          {!activeSessionId && (
            <div className="text-xs text-low mt-base">
              Select a session to manage AI members.
            </div>
          )}
          {activeSessionId && sessionMembers.length === 0 && (
            <div className="text-xs text-low mt-base">
              No AI members yet. Add one below to enable @mentions.
            </div>
          )}
          {sessionMembers.map(({ agent, sessionAgent }) => {
            const state =
              agentStates[agent.id] ?? ChatSessionAgentState.idle;
            return (
              <div
                key={sessionAgent.id}
                className="border border-border rounded-sm px-base py-half space-y-half"
              >
                <div className="flex items-center justify-between gap-base">
                  <div className="flex items-center gap-half min-w-0">
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        agentStateDotClass[state],
                        state === ChatSessionAgentState.running &&
                          'animate-pulse'
                      )}
                    />
                    <div className="min-w-0">
                      <div className="text-sm text-normal truncate">
                        @{agent.name}
                      </div>
                      <div className="text-xs text-low">
                        {toPrettyCase(agent.runner_type)} ·{' '}
                        {agentStateLabels[state]}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-half text-xs">
                    <button
                      type="button"
                      className="text-brand hover:text-brand-hover"
                      onClick={() => {
                        setWorkspaceAgentId(agent.id);
                        setWorkspaceDrawerOpen(true);
                      }}
                    >
                      Workspace
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'text-low hover:text-normal',
                        isArchived && 'pointer-events-none opacity-50'
                      )}
                      onClick={() => handleEditMember({ agent, sessionAgent })}
                      disabled={isArchived}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'text-error hover:text-error/80',
                        isArchived && 'pointer-events-none opacity-50'
                      )}
                      onClick={() => handleRemoveMember({ agent, sessionAgent })}
                      disabled={isArchived}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {sessionAgent.workspace_path && (
                  <div className="text-xs text-low break-all">
                    {sessionAgent.workspace_path}
                  </div>
                )}
              </div>
            );
          })}

          <div className="border-t border-border pt-base space-y-half">
            {!isAddMemberOpen ? (
              <PrimaryButton
                variant="secondary"
                value="Add AI member"
                onClick={() => {
                  setIsAddMemberOpen(true);
                  setMemberError(null);
                  setEditingMember(null);
                  setNewMemberName('');
                  setNewMemberPrompt('');
                  setNewMemberWorkspace('');
                  setIsPromptEditorOpen(false);
                  setPromptFileError(null);
                }}
                disabled={!activeSessionId || isArchived}
              >
                <PlusIcon className="size-icon-xs" />
              </PrimaryButton>
            ) : (
              <div className="border border-border rounded-sm p-base space-y-half">
                <div className="text-sm text-normal font-medium">
                  {editingMember ? 'Edit AI member' : 'Add AI member'}
                </div>
                <div className="text-xs text-low">
                  AI member name is the @mention handle.
                </div>
                <div className="space-y-half">
                  <label className="text-xs text-low">AI member name</label>
                  <input
                    value={newMemberName}
                    onChange={(event) => setNewMemberName(event.target.value)}
                    placeholder="e.g. coder"
                    className={cn(
                      'w-full rounded-sm border border-border bg-panel px-base py-half',
                      'text-sm text-normal focus:outline-none focus:ring-1 focus:ring-brand'
                    )}
                  />
                </div>
                <div className="space-y-half">
                  <label className="text-xs text-low">
                    Base coding agent
                  </label>
                  <select
                    value={newMemberRunnerType}
                    onChange={(event) =>
                      setNewMemberRunnerType(event.target.value)
                    }
                    disabled={
                      isCheckingAvailability || enabledRunnerTypes.length === 0
                    }
                    className={cn(
                      'w-full rounded-sm border border-border bg-panel px-base py-half',
                      'text-sm text-normal focus:outline-none focus:ring-1 focus:ring-brand'
                    )}
                  >
                    {enabledRunnerTypes.length === 0 && (
                      <option value="">
                        {isCheckingAvailability
                          ? 'Checking agents...'
                          : 'No local agents detected'}
                      </option>
                    )}
                    {availableRunnerTypes.map((runner) => (
                      <option
                        key={runner}
                        value={runner}
                        disabled={!isRunnerAvailable(runner)}
                      >
                        {toPrettyCase(runner)}
                        {availabilityLabel(runner)}
                      </option>
                    ))}
                  </select>
                  {enabledRunnerTypes.length === 0 && !isCheckingAvailability && (
                    <div className="text-xs text-error">
                      No installed code agents detected on this machine.
                    </div>
                  )}
                </div>
                <div className="space-y-half">
                  <div className="flex items-center justify-between gap-base">
                    <label className="text-xs text-low">System prompt</label>
                    <button
                      type="button"
                      className="text-xs text-brand hover:text-brand-hover"
                      onClick={() => {
                        setIsPromptEditorOpen(true);
                        setPromptFileError(null);
                      }}
                    >
                      Expand
                    </button>
                  </div>
                  <textarea
                    value={newMemberPrompt}
                    onChange={(event) =>
                      setNewMemberPrompt(event.target.value)
                    }
                    rows={3}
                    placeholder="Describe how this AI member should behave."
                    className={cn(
                      'w-full resize-none rounded-sm border border-border bg-panel',
                      'px-base py-half text-sm text-normal focus:outline-none focus:ring-1 focus:ring-brand'
                    )}
                  />
                </div>
                <div className="space-y-half">
                  <label className="text-xs text-low">Workspace path</label>
                  <input
                    value={newMemberWorkspace}
                    onChange={(event) =>
                      setNewMemberWorkspace(event.target.value)
                    }
                    placeholder="Absolute path on the server"
                    className={cn(
                      'w-full rounded-sm border border-border bg-panel px-base py-half',
                      'text-sm text-normal focus:outline-none focus:ring-1 focus:ring-brand'
                    )}
                  />
                </div>
                {memberError && (
                  <div className="text-xs text-error">{memberError}</div>
                )}
                <div className="flex items-center justify-end gap-half pt-half">
                  <PrimaryButton
                    variant="tertiary"
                    value="Cancel"
                    onClick={() => {
                      setIsAddMemberOpen(false);
                      setMemberError(null);
                      setEditingMember(null);
                      setIsPromptEditorOpen(false);
                      setPromptFileError(null);
                    }}
                    disabled={isSavingMember}
                  />
                  <PrimaryButton
                    value={editingMember ? 'Save' : 'Add'}
                    actionIcon={isSavingMember ? 'spinner' : PlusIcon}
                    onClick={handleAddMember}
                    disabled={isSavingMember || isArchived}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div
        className={cn(
          'absolute top-0 right-0 h-full w-[360px] bg-primary border-l border-border shadow-lg transition-transform',
          workspaceDrawerOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <div className="px-base py-base border-b border-border flex items-center justify-between">
          <div>
            <div className="text-sm text-normal font-medium">
              {activeWorkspaceAgent?.name ?? 'Agent workspace'}
            </div>
            <div className="text-xs text-low">
              Workspace & run history
            </div>
          </div>
          <button
            type="button"
            onClick={() => setWorkspaceDrawerOpen(false)}
            className="text-low hover:text-normal"
          >
            <XIcon className="size-icon-sm" />
          </button>
        </div>
        <div className="p-base space-y-base overflow-y-auto h-full">
          <div className="space-y-half">
            <div className="text-xs text-low">
              Workspace path is created on first run.
            </div>
            {workspacePath && (
              <div className="border border-border rounded-sm px-base py-half text-xs font-mono text-normal break-all">
                {workspacePath}
              </div>
            )}
          </div>

          <div className="space-y-half">
            <div className="text-sm text-normal font-medium">
              Run history
            </div>
            {activeWorkspaceRuns.length === 0 && (
              <div className="text-xs text-low">
                No runs yet for this agent.
              </div>
            )}
            {activeWorkspaceRuns.map((run) => (
              <div
                key={run.runId}
                className="border border-border rounded-sm p-base space-y-half"
              >
                <div className="flex items-center justify-between text-xs text-low">
                  <span>Run {run.runId.slice(0, 8)}</span>
                  <span>{formatDateShortWithTime(run.createdAt)}</span>
                </div>
                <div className="text-xs text-normal">
                  {run.content}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    className="text-brand hover:text-brand-hover"
                    onClick={() => handleLoadLog(run.runId)}
                  >
                    View log
                  </button>
                  {logRunId === run.runId && (
                    <span className="text-low">Selected</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-half">
            <div className="text-sm text-normal font-medium">Run log</div>
            {!logRunId && (
              <div className="text-xs text-low">
                Select a run to view its log output.
              </div>
            )}
            {logRunId && (
              <div className="border border-border rounded-sm bg-secondary p-base">
                <div className="flex items-center justify-between text-xs text-low pb-half">
                  <span>Run {logRunId.slice(0, 8)}</span>
                  <button
                    type="button"
                    className="text-brand hover:text-brand-hover"
                    onClick={() => handleLoadLog(logRunId)}
                    disabled={logLoading}
                  >
                    Refresh
                  </button>
                </div>
                {logLoading && (
                  <div className="text-xs text-low">Loading log...</div>
                )}
                {logError && (
                  <div className="text-xs text-error">{logError}</div>
                )}
                {!logLoading && !logError && (
                  <pre
                    className={cn(
                      'text-xs text-normal whitespace-pre-wrap break-words',
                      'max-h-64 overflow-y-auto font-ibm-plex-mono'
                    )}
                  >
                    {logContent || 'Log is empty.'}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {diffViewerOpen && diffViewerRunId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={handleCloseDiffViewer}
        >
          <div
            className={cn(
              'bg-primary border border-border shadow-xl flex flex-col overflow-hidden',
              diffViewerFullscreen
                ? 'w-full h-full rounded-none'
                : 'w-[92vw] h-[85vh] max-w-[1200px] rounded-xl'
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-base py-half">
              <div>
                <div className="text-sm text-normal font-medium">
                  Code changes
                </div>
                <div className="text-xs text-low">
                  Run {diffViewerRunId.slice(0, 8)}
                </div>
              </div>
              <div className="flex items-center gap-half">
                <button
                  type="button"
                  className="text-low hover:text-normal"
                  onClick={() =>
                    setDiffViewerFullscreen((prev) => !prev)
                  }
                  aria-label={
                    diffViewerFullscreen ? 'Exit full screen' : 'Full screen'
                  }
                >
                  <DiffViewerIcon className="size-icon-sm" />
                </button>
                <button
                  type="button"
                  className="text-low hover:text-normal"
                  onClick={handleCloseDiffViewer}
                  aria-label="Close diff viewer"
                >
                  <XIcon className="size-icon-sm" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-base space-y-base">
              {diffViewerHasDiff ? (
                <>
                  {diffViewerRun?.loading && (
                    <div className="text-xs text-low">Loading diff...</div>
                  )}
                  {diffViewerRun?.error && (
                    <div className="text-xs text-error">
                      {diffViewerRun.error}
                    </div>
                  )}
                  {!diffViewerRun?.loading &&
                    !diffViewerRun?.error &&
                    diffViewerRun?.files?.length === 0 && (
                      <div className="text-xs text-low">
                        No tracked diff available.
                      </div>
                    )}
                  {diffViewerRun?.files?.map((file) => (
                    <div
                      key={`${diffViewerRunId}-${file.path}`}
                      className="border border-border rounded-sm bg-panel"
                    >
                      <div className="flex items-center justify-between px-base py-half text-xs text-normal border-b border-border">
                        <span className="font-ibm-plex-mono break-all">
                          {file.path}
                        </span>
                        <span className="text-xs text-low">
                          {file.additions > 0 && (
                            <span className="text-success">
                              +{file.additions}
                            </span>
                          )}
                          {file.additions > 0 && file.deletions > 0 && ' '}
                          {file.deletions > 0 && (
                            <span className="text-error">
                              -{file.deletions}
                            </span>
                          )}
                        </span>
                      </div>
                      <DiffViewBody
                        fileDiffMetadata={null}
                        unifiedDiff={file.patch}
                        isValid={file.patch.trim().length > 0}
                        hideLineNumbers={false}
                        theme={actualTheme}
                        wrapText={false}
                        modeOverride="split"
                      />
                    </div>
                  ))}
                  <div>
                    <button
                      type="button"
                      className="text-brand hover:text-brand-hover text-xs"
                      onClick={() =>
                        window.open(
                          chatApi.getRunDiffUrl(diffViewerRunId),
                          '_blank',
                          'noopener,noreferrer'
                        )
                      }
                    >
                      Open raw diff
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-xs text-low">
                  No tracked diff available.
                </div>
              )}
              {diffViewerUntracked.length > 0 && (
                <div className="space-y-half">
                  <div className="text-xs text-low">Untracked files</div>
                  {diffViewerUntracked.map((path) => {
                    const key = `${diffViewerRunId}:${path}`;
                    const entry = untrackedContent[key];
                    return (
                      <div
                        key={key}
                        className="border border-border rounded-sm bg-panel px-base py-half"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-ibm-plex-mono break-all">
                            {path}
                          </span>
                          <button
                            type="button"
                            className="text-brand hover:text-brand-hover"
                            onClick={() =>
                              handleToggleUntracked(diffViewerRunId, path)
                            }
                          >
                            {entry?.open ? 'Hide' : 'View'}
                          </button>
                        </div>
                        {entry?.open && (
                          <div className="mt-half">
                            {entry.loading && (
                              <div className="text-xs text-low">
                                Loading file...
                              </div>
                            )}
                            {entry.error && (
                              <div className="text-xs text-error">
                                {entry.error}
                              </div>
                            )}
                            {!entry.loading &&
                              !entry.error &&
                              entry.content && (
                                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs font-ibm-plex-mono text-normal">
                                  {entry.content}
                                </pre>
                              )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isPromptEditorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setIsPromptEditorOpen(false)}
        >
          <div
            className="bg-primary border border-border shadow-xl flex flex-col overflow-hidden w-[92vw] h-[80vh] max-w-[1200px] rounded-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-base py-half">
              <div>
                <div className="text-sm text-normal font-medium">
                  System Prompt
                </div>
                <div className="text-xs text-low">
                  Edit the AI member system prompt
                </div>
              </div>
              <button
                type="button"
                className="text-low hover:text-normal"
                onClick={() => setIsPromptEditorOpen(false)}
                aria-label="Close prompt editor"
              >
                <XIcon className="size-icon-sm" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-base flex flex-col gap-base">
              <textarea
                value={newMemberPrompt}
                onChange={(event) => setNewMemberPrompt(event.target.value)}
                placeholder="Describe how this AI member should behave."
                className={cn(
                  'flex-1 w-full resize-none rounded-sm border border-border bg-panel',
                  'px-base py-base text-sm text-normal leading-relaxed focus:outline-none focus:ring-1 focus:ring-brand'
                )}
              />
              <div className="flex items-center justify-between gap-base">
                <div className="flex items-center gap-half text-xs text-low">
                  <button
                    type="button"
                    className="text-brand hover:text-brand-hover"
                    onClick={() => promptFileInputRef.current?.click()}
                    disabled={promptFileLoading}
                  >
                    Attach text file
                  </button>
                  <input
                    ref={promptFileInputRef}
                    type="file"
                    accept=".txt,.md,.prompt,text/plain"
                    className="hidden"
                    onChange={handlePromptFileChange}
                  />
                  {promptFileLoading && <span>Loading file...</span>}
                  {promptFileError && (
                    <span className="text-error">{promptFileError}</span>
                  )}
                </div>
                <PrimaryButton
                  value="Done"
                  onClick={() => setIsPromptEditorOpen(false)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
