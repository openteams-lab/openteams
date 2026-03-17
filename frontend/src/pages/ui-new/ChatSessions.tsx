import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { UsersThreeIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ChatMessage,
  ChatSenderType,
  ChatSession,
  ChatSessionStatus,
  ChatSessionAgentState,
  ChatWorkItem,
  ChatWorkItemType,
  BaseCodingAgent,
  type AvailabilityInfo,
  type JsonValue,
  type ChatMemberPreset,
  type ChatTeamPreset,
} from 'shared/types';
import { ApiError, chatApi, configApi } from '@/lib/api';
import { resolveAppLanguageCode } from '@/i18n/languages';
import { cn } from '@/lib/utils';
import { useUserSystem } from '@/components/ConfigProvider';
import { useTheme } from '@/components/ThemeProvider';
import { formatDateShortWithTime } from '@/utils/date';
import { getActualTheme } from '@/utils/theme';
import {
  extractExecutorProfileVariant,
  formatExecutorModelLabel,
  getVariantDisplayLabel,
  getVariantModelName,
  getVariantOptions as getExecutorVariantOptions,
  withExecutorProfileVariant,
} from '@/utils/executor';
import { SettingsDialog } from '@/components/ui-new/dialogs/SettingsDialog';

import {
  type SessionMember,
  type RunHistoryItem,
  type MentionStatus,
  type ChatAttachment,
  type ChatWorkItemGroup,
  type RunDiffState,
  type StreamRun,
  useChatData,
  useRunHistory,
  useChatMutations,
  useChatWebSocket,
  useMessageInput,
  useDiffViewer,
  fallbackRunnerTypes,
  memberNameRegex,
  mentionAllKeyword,
  isMentionAllAlias,
  MAX_MEMBER_NAME_LENGTH,
  getMemberNameLength,
  getMessageTone,
  extractDiffMeta,
  extractMentions,
  stripMentionAllAliases,
  extractRunId,
  extractReferenceId,
  extractAttachments,
  extractProtocolErrorMeta,
  truncateText,
  sanitizeHandle,
} from './chat';
import {
  buildMemberPresetImportPlan,
  getLocalizedMemberPresetName,
  getLocalizedTeamPresetName,
  validateWorkspacePath,
  translateWorkspacePathError,
  type MemberPresetImportPlan,
} from './chat/utils';

import { isAllowedAttachment } from './chat/components/MessageInputArea';
import { SessionListSidebar } from './chat/components/SessionListSidebar';
import { ChatHeader } from './chat/components/ChatHeader';
import { CleanupModeBar } from './chat/components/CleanupModeBar';
import { ChatMessageItem } from './chat/components/ChatMessageItem';
import { ChatWorkItemCard } from './chat/components/ChatWorkItemCard';
import { RunningAgentPlaceholder } from './chat/components/RunningAgentPlaceholder';
import { MessageInputArea } from './chat/components/MessageInputArea';
import { ChatEmptyStateIndicator } from './chat/components/ChatEmptyStateIndicator';
import { AiMembersSidebar } from './chat/components/AiMembersSidebar';
import { WorkspaceDrawer } from './chat/components/WorkspaceDrawer';
import { DiffViewerModal } from './chat/components/DiffViewerModal';
import { PromptEditorModal } from './chat/components/PromptEditorModal';
import { ConfirmModal } from './chat/components/ConfirmModal';
import { FilePreviewModal } from './chat/components/FilePreviewModal';
import { SkillsPanel } from './chat/components/SkillsPanel';
import { AiTeamPresetsModal } from './chat/components/AiTeamPresetsModal';
import { ChatSystemMessage } from '@/components/ui-new/primitives/conversation/ChatSystemMessage';
import type { ChatProtocolNotice } from './chat/hooks/useChatWebSocket';

const mentionStatusPriority: Record<MentionStatus, number> = {
  received: 0,
  running: 1,
  completed: 2,
  failed: 2,
};

const coerceMentionStatus = (value: unknown): MentionStatus | null => {
  if (
    value === 'received' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed'
  ) {
    return value;
  }
  return null;
};

const isImageAttachment = (file: File) => file.type.startsWith('image/');

const isTextAttachment = (file: File) =>
  file.type.startsWith('text/') ||
  [
    '.txt',
    '.csv',
    '.md',
    '.json',
    '.xml',
    '.yaml',
    '.yml',
    '.html',
    '.htm',
    '.css',
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.py',
    '.java',
    '.c',
    '.cpp',
    '.h',
    '.hpp',
    '.rb',
    '.php',
    '.go',
    '.rs',
    '.sql',
    '.sh',
    '.bash',
    '.svg',
  ].some((ext) => file.name.toLowerCase().endsWith(ext));

const isProtocolErrorMessage = (message: ChatMessage) =>
  message.sender_type === ChatSenderType.system &&
  extractProtocolErrorMeta(message.meta) !== null;

const MAX_SESSION_TITLE_LENGTH = 20;
const COLLAPSED_LEFT_SIDEBAR_WIDTH = 52;
const MESSAGE_SEARCH_HIGHLIGHT_NAME = 'chat-session-search-highlight';
const MAX_MESSAGE_SEARCH_HIGHLIGHT_RANGES = 4000;
const MESSAGE_SEARCH_DEBOUNCE_MS = 120;
const UNTITLED_SESSION_TITLES = new Set([
  'untitled session',
  'unnamed session',
  'session without title',
  'sesion sin titulo',
  'sesión sin título',
  'session sans titre',
  '無題のセッション',
  '제목 없는 세션',
  '未命名会话',
  '未命名會話',
]);

type CSSHighlightRegistry = {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
};

const escapeSearchRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getSessionTitleLength = (value: string) =>
  Array.from(value.trim()).length;

const areSetsEqual = <T,>(a: Set<T>, b: Set<T>) => {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
};

type ArtifactSpotlight =
  | {
      kind: 'attachment';
      name: string;
      url: string;
      previewType: 'image' | 'html';
      sourceLabel: string;
      createdAt: string;
      pathLabel: string;
    }
  | {
      kind: 'diff';
      runId: string;
      sourceLabel: string;
      createdAt: string;
      hasDiff: boolean;
      untrackedFiles: string[];
      previewText: string | null;
    };

type TimelineEntry =
  | {
      kind: 'message';
      key: string;
      createdAtMs: number;
      message: ChatMessage;
    }
  | {
      kind: 'work_item';
      key: string;
      createdAtMs: number;
      group: ChatWorkItemGroup;
    };

const normalizeSessionTitle = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';
  const normalized = trimmed.toLocaleLowerCase();
  return UNTITLED_SESSION_TITLES.has(normalized) ? '' : trimmed;
};

const summarizeDiffState = (
  runDiff: RunDiffState | undefined,
  untrackedFiles: string[]
) => {
  const files = runDiff?.files ?? [];
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const fileCount = files.length || untrackedFiles.length;
  const primaryPath = files[0]?.path ?? untrackedFiles[0] ?? null;

  return {
    additions,
    deletions,
    fileCount,
    primaryPath,
    files,
  };
};

const getArtifactSpotlightKey = (artifact: ArtifactSpotlight | null) => {
  if (!artifact) return null;
  return artifact.kind === 'attachment'
    ? `attachment:${artifact.url}`
    : `diff:${artifact.runId}`;
};

export function ArtifactSpotlightCard({
  artifact,
  title,
  openLabel,
  viewChangesLabel,
  previewLabel,
  diffState,
  onSelectPreview,
}: {
  artifact: ArtifactSpotlight;
  title: string;
  openLabel: string;
  viewChangesLabel: string;
  previewLabel: string;
  diffState?: RunDiffState;
  onSelectPreview: (artifact: ArtifactSpotlight) => void;
}) {
  const { t } = useTranslation('chat');
  const diffSummary =
    artifact.kind === 'diff'
      ? summarizeDiffState(diffState, artifact.untrackedFiles)
      : null;

  return (
    <div
      className="chat-session-artifact-spotlight"
      role="button"
      tabIndex={0}
      onClick={() => onSelectPreview(artifact)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectPreview(artifact);
        }
      }}
    >
      <div className="chat-session-artifact-main">
        <div className="chat-session-artifact-meta">
          <div className="chat-session-artifact-label">{title}</div>
          <div className="chat-session-artifact-title-row">
            <div className="chat-session-artifact-title">
              {artifact.kind === 'attachment'
                ? artifact.name
                : t('workspacePreview.runLabel', {
                    id: artifact.runId.slice(0, 8),
                  })}
            </div>
            <div className="chat-session-artifact-pills">
              <span className="chat-session-artifact-pill">
                {artifact.kind === 'attachment'
                  ? artifact.previewType === 'html'
                    ? t('workspacePreview.html')
                    : t('workspacePreview.image')
                  : t('workspacePreview.diff')}
              </span>
              {artifact.kind === 'attachment' ? (
                <span
                  className="chat-session-artifact-pill is-muted"
                  title={artifact.pathLabel}
                >
                  {artifact.pathLabel}
                </span>
              ) : diffSummary?.primaryPath ? (
                <span
                  className="chat-session-artifact-pill is-muted"
                  title={diffSummary.primaryPath}
                >
                  {diffSummary.primaryPath}
                </span>
              ) : null}
            </div>
          </div>
          <div className="chat-session-artifact-subtitle">
            {artifact.sourceLabel} ·{' '}
            {formatDateShortWithTime(artifact.createdAt)}
          </div>
        </div>
        {artifact.kind === 'diff' ? (
          <div className="chat-session-artifact-summary">
            <span className="chat-session-artifact-stat">
              {t('workspacePreview.filesChanged', {
                count: diffSummary?.fileCount ?? 0,
              })}
            </span>
            <span className="chat-session-artifact-stat is-positive">
              +{diffSummary?.additions ?? 0}
            </span>
            <span className="chat-session-artifact-stat is-negative">
              -{diffSummary?.deletions ?? 0}
            </span>
          </div>
        ) : (
          <div className="chat-session-artifact-summary">
            <span className="chat-session-artifact-stat">
              {artifact.previewType === 'html'
                ? t('workspacePreview.liveReport')
                : t('workspacePreview.imagePreview')}
            </span>
          </div>
        )}
      </div>
      <div className="chat-session-artifact-actions">
        <button
          type="button"
          className="chat-session-artifact-action"
          onClick={(event) => {
            event.stopPropagation();
            onSelectPreview(artifact);
          }}
        >
          {artifact.kind === 'diff' ? viewChangesLabel : previewLabel}
        </button>
        {artifact.kind === 'attachment' && (
          <a
            href={artifact.url}
            target="_blank"
            rel="noreferrer"
            className="chat-session-artifact-action is-secondary"
            onClick={(event) => event.stopPropagation()}
          >
            {openLabel}
          </a>
        )}
      </div>
    </div>
  );
}

function WorkspacePreviewPane({
  artifact,
  diffState,
  title,
  openLabel,
  viewChangesLabel,
  emptyLabel,
  closeLabel,
  loadingLabel,
  filesLabel,
  addedLabel,
  removedLabel,
  onClose,
  onOpenDiffModal,
}: {
  artifact: ArtifactSpotlight | null;
  diffState?: RunDiffState;
  title: string;
  openLabel: string;
  viewChangesLabel: string;
  emptyLabel: string;
  closeLabel: string;
  loadingLabel: string;
  filesLabel: string;
  addedLabel: string;
  removedLabel: string;
  onClose: () => void;
  onOpenDiffModal: (
    runId: string,
    untrackedFiles: string[],
    hasDiff: boolean
  ) => void;
}) {
  const { t } = useTranslation('chat');

  const diffSummary =
    artifact?.kind === 'diff'
      ? summarizeDiffState(diffState, artifact.untrackedFiles)
      : null;

  return (
    <div className="chat-session-preview-overlay" onClick={onClose}>
      <aside
        className="chat-session-preview-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="chat-session-preview-header">
          <div className="chat-session-preview-meta">
            <div className="chat-session-preview-label">{title}</div>
            <div className="chat-session-preview-title">
              {artifact?.kind === 'attachment'
                ? artifact.name
                : artifact
                  ? t('workspacePreview.runLabel', {
                      id: artifact.runId.slice(0, 8),
                    })
                  : emptyLabel}
            </div>
            {artifact && (
              <div className="chat-session-preview-subtitle">
                {artifact.sourceLabel} ·{' '}
                {formatDateShortWithTime(artifact.createdAt)}
              </div>
            )}
          </div>
          <div className="chat-session-preview-header-actions">
            {artifact?.kind === 'attachment' ? (
              <a
                href={artifact.url}
                target="_blank"
                rel="noreferrer"
                className="chat-session-preview-action"
              >
                {openLabel}
              </a>
            ) : artifact?.kind === 'diff' ? (
              <button
                type="button"
                className="chat-session-preview-action"
                onClick={() =>
                  onOpenDiffModal(
                    artifact.runId,
                    artifact.untrackedFiles,
                    artifact.hasDiff
                  )
                }
              >
                {viewChangesLabel}
              </button>
            ) : null}
            <button
              type="button"
              className="chat-session-preview-close"
              onClick={onClose}
              aria-label={closeLabel}
              title={closeLabel}
            >
              ×
            </button>
          </div>
        </div>

        <div className="chat-session-preview-body">
          {artifact?.kind === 'attachment' ? (
            artifact.previewType === 'image' ? (
              <div className="chat-session-preview-frame-shell">
                <img
                  src={artifact.url}
                  alt={artifact.name}
                  className="chat-session-preview-image"
                />
              </div>
            ) : (
              <div className="chat-session-preview-frame-shell">
                <iframe
                  src={artifact.url}
                  title={artifact.name}
                  sandbox="allow-scripts allow-same-origin"
                  className="chat-session-preview-frame"
                />
              </div>
            )
          ) : artifact?.kind === 'diff' ? (
            <div className="chat-session-preview-diff">
              <div className="chat-session-preview-diff-stats">
                <div className="chat-session-preview-stat-card">
                  <div className="chat-session-preview-stat-value">
                    {diffSummary?.fileCount ?? 0}
                  </div>
                  <div className="chat-session-preview-stat-label">
                    {filesLabel}
                  </div>
                </div>
                <div className="chat-session-preview-stat-card">
                  <div className="chat-session-preview-stat-value is-positive">
                    +{diffSummary?.additions ?? 0}
                  </div>
                  <div className="chat-session-preview-stat-label">
                    {addedLabel}
                  </div>
                </div>
                <div className="chat-session-preview-stat-card">
                  <div className="chat-session-preview-stat-value is-negative">
                    -{diffSummary?.deletions ?? 0}
                  </div>
                  <div className="chat-session-preview-stat-label">
                    {removedLabel}
                  </div>
                </div>
              </div>

              {artifact.previewText && (
                <pre className="chat-session-preview-diff-copy">
                  {artifact.previewText}
                </pre>
              )}

              {artifact.hasDiff && diffState?.loading && (
                <div className="chat-session-preview-diff-note">
                  {loadingLabel}
                </div>
              )}
              {artifact.hasDiff && diffState?.error && (
                <div className="chat-session-preview-diff-note is-error">
                  {diffState.error}
                </div>
              )}

              <div className="chat-session-preview-file-list">
                {(diffSummary?.files.length
                  ? diffSummary.files
                  : artifact.untrackedFiles.map((path) => ({
                      path,
                      additions: 0,
                      deletions: 0,
                    }))
                )
                  .slice(0, 10)
                  .map((file) => (
                    <div
                      key={file.path}
                      className="chat-session-preview-file-row"
                    >
                      <span
                        className="chat-session-preview-file-path"
                        title={file.path}
                      >
                        {file.path}
                      </span>
                      {'additions' in file && (
                        <span className="chat-session-preview-file-delta">
                          <span className="is-positive">+{file.additions}</span>
                          <span className="is-negative">-{file.deletions}</span>
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="chat-session-preview-empty">{emptyLabel}</div>
          )}
        </div>
      </aside>
    </div>
  );
}

export function ChatSessions() {
  const { t, i18n } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptFileInputRef = useRef<HTMLInputElement | null>(null);
  const { config, profiles, loginStatus, homeDirectory } = useUserSystem();
  const appLanguage = resolveAppLanguageCode(
    config?.language,
    i18n.resolvedLanguage || i18n.language,
    i18n.services.languageDetector?.detect()
  );
  const { theme } = useTheme();
  const actualTheme = getActualTheme(theme);

  // Data queries
  const {
    sortedSessions,
    activeSessions,
    archivedSessions,
    agents,
    sessionAgents,
    messagesData,
    workItemsData,
    agentById,
    sessionMembers,
    mentionAgents,
    isSessionsLoading,
    isLoading,
  } = useChatData(sessionId ?? null);

  const activeSessionExists = useMemo(
    () =>
      !!sessionId && sortedSessions.some((session) => session.id === sessionId),
    [sessionId, sortedSessions]
  );
  const activeSessionId = sessionId
    ? isSessionsLoading || activeSessionExists
      ? sessionId
      : null
    : (sortedSessions[0]?.id ?? null);
  const visibleMessagesData = useMemo(() => messagesData, [messagesData]);
  const visibleWorkItemsData = useMemo(() => workItemsData, [workItemsData]);
  const notificationsRef = useRef(config?.notifications ?? null);
  const sessionTitleByIdRef = useRef<Map<string, string>>(new Map());
  const agentByIdRef = useRef(agentById);
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());
  const notificationPermissionRequestedRef = useRef(false);

  useEffect(() => {
    notificationsRef.current = config?.notifications ?? null;
  }, [config?.notifications]);

  useEffect(() => {
    agentByIdRef.current = agentById;
  }, [agentById]);

  useEffect(() => {
    notifiedMessageIdsRef.current.clear();
  }, [activeSessionId]);

  // Messages state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [workItems, setWorkItems] = useState<ChatWorkItem[]>([]);

  const upsertMessage = useCallback(
    (message: ChatMessage) => {
      setMessages((prev) => {
        const existingIndex = prev.findIndex((item) => item.id === message.id);
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = message;
          return next;
        }
        return [...prev, message];
      });

      if (!message.session_id) return;
      queryClient.setQueryData<ChatMessage[]>(
        ['chatMessages', message.session_id],
        (prev) => {
          if (!prev) return [message];
          const existingIndex = prev.findIndex(
            (item) => item.id === message.id
          );
          if (existingIndex >= 0) {
            const next = [...prev];
            next[existingIndex] = message;
            return next;
          }
          return [...prev, message];
        }
      );
    },
    [queryClient]
  );

  const upsertWorkItem = useCallback(
    (workItem: ChatWorkItem) => {
      setWorkItems((prev) => {
        const existingIndex = prev.findIndex((item) => item.id === workItem.id);
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = workItem;
          return next;
        }
        return [...prev, workItem];
      });

      queryClient.setQueryData<ChatWorkItem[]>(
        ['chatWorkItems', workItem.session_id],
        (prev) => {
          if (!prev) return [workItem];
          const existingIndex = prev.findIndex((item) => item.id === workItem.id);
          if (existingIndex >= 0) {
            const next = [...prev];
            next[existingIndex] = workItem;
            return next;
          }
          return [...prev, workItem];
        }
      );
    },
    [queryClient]
  );

  const handleIncomingMessage = useCallback(
    (message: ChatMessage) => {
      upsertMessage(message);
      if (isProtocolErrorMessage(message)) return;

      const notifications = notificationsRef.current;
      if (!notifications || message.sender_type === ChatSenderType.user) return;
      if (!notifications.sound_enabled && !notifications.push_enabled) return;
      if (notifiedMessageIdsRef.current.has(message.id)) return;
      notifiedMessageIdsRef.current.add(message.id);

      if (notifications.sound_enabled) {
        const audio = new Audio(`/api/sounds/${notifications.sound_file}`);
        void audio.play().catch((error) => {
          console.warn(
            'Failed to play incoming chat notification sound',
            error
          );
        });
      }

      const canShowPush =
        notifications.push_enabled &&
        typeof window !== 'undefined' &&
        'Notification' in window &&
        (document.visibilityState === 'hidden' || !document.hasFocus());

      if (!canShowPush) return;

      const senderLabel =
        message.sender_type === ChatSenderType.agent
          ? message.sender_id
            ? (agentByIdRef.current.get(message.sender_id)?.name ?? 'Agent')
            : 'Agent'
          : 'System';

      const attachmentCount = extractAttachments(message.meta).length;
      const content = message.content.trim();
      const preview =
        content.length > 0
          ? truncateText(content, 120)
          : attachmentCount > 0
            ? `Shared ${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}`
            : 'Sent a new message';

      const sessionTitle =
        (message.session_id &&
          sessionTitleByIdRef.current.get(message.session_id)) ||
        t('sidebar.generatedSessionTitle', {
          date: formatDateShortWithTime(message.created_at),
        });

      const showNotification = () => {
        try {
          const notification = new Notification(sessionTitle, {
            body: `${senderLabel}: ${preview}`,
            tag: `chat-session-${message.session_id ?? 'unknown'}`,
          });
          notification.onclick = () => {
            window.focus();
          };
        } catch (error) {
          console.warn('Failed to show chat notification', error);
        }
      };

      if (Notification.permission === 'granted') {
        showNotification();
        return;
      }

      if (
        Notification.permission === 'default' &&
        !notificationPermissionRequestedRef.current
      ) {
        notificationPermissionRequestedRef.current = true;
        void Notification.requestPermission()
          .then((permission) => {
            if (permission === 'granted') {
              showNotification();
            }
          })
          .catch((error) => {
            console.warn('Failed to request notification permission', error);
          });
      }
    },
    [t, upsertMessage]
  );

  const handleIncomingWorkItem = useCallback(
    (workItem: ChatWorkItem) => {
      upsertWorkItem(workItem);
    },
    [upsertWorkItem]
  );

  // WebSocket connection
  const {
    streamingRuns,
    agentStates,
    agentStateInfos,
    mentionStatuses,
    mentionErrors,
    compressionWarning,
    protocolNotices,
    setAgentStates,
    setAgentStateInfos,
    setMentionStatuses,
    pruneStreamingRunsForSession,
    clearCompressionWarning,
    dismissProtocolNotice,
  } = useChatWebSocket(
    activeSessionId,
    handleIncomingMessage,
    handleIncomingWorkItem
  );

  // Mutations
  const {
    createSession,
    updateSession,
    archiveSession,
    restoreSession,
    deleteSession,
    sendMessage,
    deleteMessages,
  } = useChatMutations(
    (session) => navigate(`/chat/${session.id}`),
    (session) => navigate(`/chat/${session.id}`),
    upsertMessage,
    () => {
      if (activeSessionId) {
        queryClient.invalidateQueries({
          queryKey: ['chatMessages', activeSessionId],
        });
      }
    },
    () => {
      navigate('/chat');
    }
  );

  // Message input
  const getMessageMentionHandle = useCallback(
    (message: ChatMessage) => {
      if (message.sender_type !== ChatSenderType.agent) return null;
      if (!message.sender_id) return null;
      const name = agentById.get(message.sender_id)?.name ?? null;
      if (!name || !memberNameRegex.test(name)) return null;
      return name;
    },
    [agentById]
  );

  const {
    draft,
    selectedMentions,
    setSelectedMentions,
    mentionQuery,
    showMentionAllSuggestion,
    replyToMessage,
    setReplyToMessage,
    inputRef,
    handleDraftChange,
    handleMentionSelect,
    handleReplySelect,
    visibleMentionSuggestions,
    agentOptions,
    resetInput,
    highlightedMentionIndex,
    handleMentionKeyDown,
  } = useMessageInput(mentionAgents);

  const agentOptionsWithAll = useMemo(
    () => [
      {
        value: mentionAllKeyword,
        label: t('input.mentionAllOption'),
      },
      ...agentOptions,
    ],
    [agentOptions, t]
  );

  // Diff viewer
  const {
    diffViewerRunId,
    diffViewerUntracked,
    diffViewerHasDiff,
    diffViewerOpen,
    diffViewerFullscreen,
    runDiffs,
    untrackedContent,
    handleOpenDiffViewer,
    handleCloseDiffViewer,
    handleToggleFullscreen,
    handleLoadDiff,
    handleToggleUntracked,
    resetDiffViewer,
  } = useDiffViewer();

  // Local state
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [previewFile, setPreviewFile] = useState<{
    file: File | null;
    content: string | null;
  }>({ file: null, content: null });
  const [agentAvailability, setAgentAvailability] = useState<
    Record<string, AvailabilityInfo | null>
  >({});
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [workspaceDrawerOpen, setWorkspaceDrawerOpen] = useState(false);
  const [workspaceAgentId, setWorkspaceAgentId] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const previousSessionIdRef = useRef<string | null>(null);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<SessionMember | null>(
    null
  );
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRunnerType, setNewMemberRunnerType] = useState('');
  const [newMemberVariant, setNewMemberVariant] = useState('DEFAULT');
  const [newMemberPrompt, setNewMemberPrompt] = useState('');
  const [newMemberWorkspace, setNewMemberWorkspace] = useState('');
  const [newMemberSkillIds, setNewMemberSkillIds] = useState<string[]>([]);
  const [editingMemberInitialSkillIds, setEditingMemberInitialSkillIds] =
    useState<string[]>([]);
  const memberNameLengthError =
    newMemberName.trim().length > 0 &&
    getMemberNameLength(newMemberName) > MAX_MEMBER_NAME_LENGTH
      ? `AI member name cannot exceed ${MAX_MEMBER_NAME_LENGTH} characters.`
      : null;
  const [memberError, setMemberError] = useState<string | null>(null);
  const [isSavingMember, setIsSavingMember] = useState(false);
  const [isPromptEditorOpen, setIsPromptEditorOpen] = useState(false);
  const [promptFileError, setPromptFileError] = useState<string | null>(null);
  const [promptFileLoading, setPromptFileLoading] = useState(false);
  const [logRunId, setLogRunId] = useState<string | null>(null);
  const [logContent, setLogContent] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [stoppingAgents, setStoppingAgents] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [isAiTeamPresetsOpen, setIsAiTeamPresetsOpen] = useState(false);
  const [isSkillsPanelOpen, setIsSkillsPanelOpen] = useState(false);
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(
    new Set()
  );
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [isCleanupMode, setIsCleanupMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(
    new Set()
  );
  const [isMessageSearchOpen, setIsMessageSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [debouncedMessageSearchQuery, setDebouncedMessageSearchQuery] =
    useState('');
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
    mode?: 'confirm' | 'alert';
    confirmText?: string;
    cancelText?: string;
  } | null>(null);
  const [teamImportPlan, setTeamImportPlan] = useState<
    MemberPresetImportPlan[] | null
  >(null);
  const [teamImportName, setTeamImportName] = useState<string | null>(null);
  const [teamImportProtocol, setTeamImportProtocol] = useState<string | null>(
    null
  );
  const [teamProtocolRefreshToken, setTeamProtocolRefreshToken] = useState(0);
  const [isImportingTeam, setIsImportingTeam] = useState(false);
  const [isConfirmLoading, setIsConfirmLoading] = useState(false);
  const [isDeletingMessages, setIsDeletingMessages] = useState(false);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(340);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(280);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [isWorkspacePreviewOpen, setIsWorkspacePreviewOpen] = useState(false);
  const [workspacePreviewArtifact, setWorkspacePreviewArtifact] =
    useState<ArtifactSpotlight | null>(null);
  const [lastSeenArtifactKey, setLastSeenArtifactKey] = useState<string | null>(
    null
  );
  const hasBootstrappedInitialSessionRef = useRef(false);
  const [isResizing, setIsResizing] = useState<'left' | 'right' | null>(null);
  const resizeStartRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const lastExpandedLeftWidthRef = useRef(340);
  const sessionUpdatedAtByIdRef = useRef<Map<string, string>>(new Map());

  const showDuplicateMemberNameWarning = useCallback(
    (name: string) => {
      const duplicateMessage = t(
        'modals.confirm.messages.duplicateMemberName',
        {
          name: `@${name}`,
        }
      );
      setMemberError(duplicateMessage);
      setConfirmModal({
        title: t('modals.confirm.titles.duplicateMemberName'),
        message: duplicateMessage,
        mode: 'alert',
        confirmText: tCommon('ok'),
        onConfirm: () => {},
      });
    },
    [t, tCommon]
  );

  // Sync messages from query
  useEffect(() => {
    if (activeSessionId) {
      setMessages(visibleMessagesData);
      setWorkItems(visibleWorkItemsData);
    } else {
      setMessages([]);
      setWorkItems([]);
    }
  }, [visibleMessagesData, visibleWorkItemsData, activeSessionId]);

  useEffect(() => {
    if (visibleMessagesData.length === 0) return;
    setMentionStatuses((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const message of visibleMessagesData) {
        const meta = message.meta;
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;
        const rawStatuses = (meta as { mention_statuses?: unknown })
          .mention_statuses;
        if (
          !rawStatuses ||
          typeof rawStatuses !== 'object' ||
          Array.isArray(rawStatuses)
        ) {
          continue;
        }
        const perMessage = new Map(next.get(message.id) ?? []);
        let perMessageChanged = false;
        for (const [agentName, statusValue] of Object.entries(
          rawStatuses as Record<string, unknown>
        )) {
          const status = coerceMentionStatus(statusValue);
          if (!status) continue;
          const existing = perMessage.get(agentName);
          const existingPriority = existing
            ? mentionStatusPriority[existing]
            : -1;
          if (mentionStatusPriority[status] > existingPriority) {
            perMessage.set(agentName, status);
            perMessageChanged = true;
          }
        }
        if (perMessageChanged) {
          next.set(message.id, perMessage);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [visibleMessagesData, setMentionStatuses]);

  // Reset state on session change
  useEffect(() => {
    resetInput();
    resetDiffViewer();
    setReplyToMessage(null);
    setIsUploadingAttachments(false);
    setAttachmentError(null);
    setWorkspaceDrawerOpen(false);
    setWorkspaceAgentId(null);
    setIsAddMemberOpen(false);
    setNewMemberName('');
    setNewMemberVariant('DEFAULT');
    setNewMemberPrompt('');
    setNewMemberWorkspace('');
    setNewMemberSkillIds([]);
    setEditingMemberInitialSkillIds([]);
    setMemberError(null);
    setEditingMember(null);
    setLogRunId(null);
    setLogContent('');
    setLogError(null);
    setClock(Date.now());
    setStoppingAgents(new Set());
    setIsEditingTitle(false);
    setTitleError(null);
    setIsMessageSearchOpen(false);
    setMessageSearchQuery('');
    setDebouncedMessageSearchQuery('');
    setIsPromptEditorOpen(false);
    setPromptFileError(null);
    setPromptFileLoading(false);
    setTeamImportPlan(null);
    setTeamImportName(null);
  }, [activeSessionId, resetInput, resetDiffViewer, setReplyToMessage]);

  useEffect(() => {
    if (isSessionsLoading) return;
    if (hasBootstrappedInitialSessionRef.current) return;

    hasBootstrappedInitialSessionRef.current = true;
    if (sortedSessions.length > 0) return;

    createSession.mutate();
  }, [createSession, isSessionsLoading, sortedSessions.length]);

  // Navigate to first session if needed
  useEffect(() => {
    if (isSessionsLoading || isSkillsPanelOpen) return;

    if (!sessionId && sortedSessions.length > 0) {
      navigate(`/chat/${sortedSessions[0].id}`, { replace: true });
      return;
    }

    if (sessionId && sortedSessions.length === 0) {
      navigate('/chat', { replace: true });
      return;
    }

    if (
      sessionId &&
      sortedSessions.length > 0 &&
      !sortedSessions.some((session) => session.id === sessionId)
    ) {
      navigate(`/chat/${sortedSessions[0].id}`, { replace: true });
    }
  }, [
    isSessionsLoading,
    isSkillsPanelOpen,
    navigate,
    sessionId,
    sortedSessions,
  ]);

  useEffect(() => {
    const nextUpdatedAtById = new Map(
      sortedSessions.map((session) => [session.id, session.updated_at])
    );

    if (sessionUpdatedAtByIdRef.current.size === 0) {
      sessionUpdatedAtByIdRef.current = nextUpdatedAtById;
      return;
    }

    const newlyUnreadIds: string[] = [];
    for (const session of sortedSessions) {
      const previousUpdatedAt = sessionUpdatedAtByIdRef.current.get(session.id);
      if (!previousUpdatedAt) continue;
      if (
        previousUpdatedAt !== session.updated_at &&
        session.id !== activeSessionId
      ) {
        newlyUnreadIds.push(session.id);
      }
    }

    sessionUpdatedAtByIdRef.current = nextUpdatedAtById;

    setUnreadSessionIds((prev) => {
      const next = new Set<string>();
      for (const sessionIdValue of prev) {
        if (
          nextUpdatedAtById.has(sessionIdValue) &&
          sessionIdValue !== activeSessionId
        ) {
          next.add(sessionIdValue);
        }
      }
      for (const sessionIdValue of newlyUnreadIds) {
        next.add(sessionIdValue);
      }
      return areSetsEqual(prev, next) ? prev : next;
    });
  }, [activeSessionId, sortedSessions]);

  // Derived state
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
        info?.type === 'LOGIN_DETECTED' || info?.type === 'INSTALLATION_FOUND'
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
      if (!info)
        return isCheckingAvailability ? ' (checking)' : ' (unavailable)';
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

  const getModelName = useCallback(
    (runnerType: string, variant?: string): string | null => {
      return getVariantModelName(
        runnerType as BaseCodingAgent,
        variant ?? null,
        profiles
      );
    },
    [profiles]
  );

  const getModelDisplayName = useCallback(
    (runnerType: string, modelName: string | null): string | null =>
      formatExecutorModelLabel(runnerType as BaseCodingAgent, modelName),
    []
  );

  const getVariantLabel = useCallback(
    (runnerType: string, variant: string): string =>
      getVariantDisplayLabel(runnerType as BaseCodingAgent, variant, profiles),
    [profiles]
  );

  const getVariantOptions = useCallback(
    (runnerType: string): string[] => {
      return getExecutorVariantOptions(runnerType as BaseCodingAgent, profiles);
    },
    [profiles]
  );

  const memberVariantOptions = useMemo(
    () => getVariantOptions(newMemberRunnerType),
    [getVariantOptions, newMemberRunnerType]
  );

  // Preset-derived state
  const enabledMemberPresets = useMemo(
    () => (config?.chat_presets?.members ?? []).filter((m) => m.enabled),
    [config?.chat_presets?.members]
  );
  const enabledTeamPresets = useMemo(
    () => (config?.chat_presets?.teams ?? []).filter((t) => t.enabled),
    [config?.chat_presets?.teams]
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

  const messageList = useMemo(
    () =>
      [...messages].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
    [messages]
  );
  const workItemGroups = useMemo<ChatWorkItemGroup[]>(() => {
    const sorted = [...workItems].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const groups = new Map<string, ChatWorkItemGroup>();

    for (const item of sorted) {
      const existing = groups.get(item.run_id);
      if (existing) {
        if (item.item_type === ChatWorkItemType.artifact) {
          existing.artifacts.push(item);
        } else {
          existing.conclusions.push(item);
        }

        if (
          new Date(item.created_at).getTime() >
          new Date(existing.createdAt).getTime()
        ) {
          existing.createdAt = item.created_at;
        }
        continue;
      }

      groups.set(item.run_id, {
        runId: item.run_id,
        sessionAgentId: item.session_agent_id,
        agentId: item.agent_id,
        createdAt: item.created_at,
        artifacts: item.item_type === ChatWorkItemType.artifact ? [item] : [],
        conclusions:
          item.item_type === ChatWorkItemType.conclusion ? [item] : [],
      });
    }

    return [...groups.values()].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, [workItems]);

  const timelineEntries = useMemo<TimelineEntry[]>(
    () =>
      [...messageList.map((message) => ({
        kind: 'message' as const,
        key: `message:${message.id}`,
        createdAtMs: new Date(message.created_at).getTime(),
        message,
      })),
      ...workItemGroups.map((group) => ({
        kind: 'work_item' as const,
        key: `work-item:${group.runId}`,
        createdAtMs: new Date(group.createdAt).getTime(),
        group,
      }))].sort((a, b) => a.createdAtMs - b.createdAtMs),
    [messageList, workItemGroups]
  );
  const lastTimelineEntryKey =
    timelineEntries.length > 0
      ? timelineEntries[timelineEntries.length - 1].key
      : null;

  const messageById = useMemo(
    () => new Map(messageList.map((message) => [message.id, message])),
    [messageList]
  );

  const totalTokens = useMemo(() => {
    let sum = 0;
    for (const message of messageList) {
      const meta = message.meta;
      if (
        meta &&
        typeof meta === 'object' &&
        !Array.isArray(meta) &&
        'token_usage' in meta
      ) {
        const tokenUsage = (meta as { token_usage?: { total_tokens?: number } })
          .token_usage;
        if (typeof tokenUsage?.total_tokens === 'number') {
          sum += tokenUsage.total_tokens;
        }
      }
    }
    return sum;
  }, [messageList]);
  void totalTokens;
  const runHistory = useRunHistory(messages);

  const activeSession = useMemo(
    () => sortedSessions.find((session) => session.id === activeSessionId),
    [sortedSessions, activeSessionId]
  );

  const memberPresetById = useMemo(() => {
    const map = new Map<string, ChatMemberPreset>();
    for (const preset of config?.chat_presets?.members ?? []) {
      map.set(preset.id, preset);
    }
    return map;
  }, [config?.chat_presets?.members]);

  const agentIdByName = useMemo(() => {
    const map = new Map<string, string>();
    sessionMembers.forEach((member) => {
      map.set(member.agent.name, member.agent.id);
    });
    return map;
  }, [sessionMembers]);

  const isArchived = activeSession?.status === ChatSessionStatus.archived;
  const activeSessionTitle = normalizeSessionTitle(activeSession?.title);
  const activeSessionSummary = activeSession?.summary_text?.trim() ?? '';
  const firstUserPromptTitle = useMemo(() => {
    const firstUserMessage = messageList.find(
      (message) =>
        message.sender_type === ChatSenderType.user &&
        message.content.trim().length > 0
    );
    if (!firstUserMessage) return '';
    return truncateText(
      firstUserMessage.content.replace(/\s+/g, ' ').trim(),
      52
    );
  }, [messageList]);
  const activeSessionFallbackTitle = useMemo(() => {
    if (!activeSession) {
      return t('sidebar.generatedSessionTitle', {
        date: formatDateShortWithTime(new Date().toISOString()),
      });
    }
    if (activeSessionSummary) {
      return truncateText(activeSessionSummary, 52);
    }
    if (firstUserPromptTitle) return firstUserPromptTitle;
    return t('sidebar.generatedSessionTitle', {
      date: formatDateShortWithTime(activeSession.created_at),
    });
  }, [activeSession, activeSessionSummary, firstUserPromptTitle, t]);
  const activeSessionDisplayTitle =
    activeSessionTitle.trim() || activeSessionFallbackTitle;
  const isGeneratedActiveSessionTitle = activeSessionTitle.trim().length === 0;
  const activeSessionEditableSuggestion = useMemo(() => {
    if (!isGeneratedActiveSessionTitle) return activeSessionTitle;
    return truncateText(activeSessionFallbackTitle, MAX_SESSION_TITLE_LENGTH);
  }, [
    activeSessionFallbackTitle,
    activeSessionTitle,
    isGeneratedActiveSessionTitle,
  ]);
  const sessionDisplayTitles = useMemo(() => {
    const next = new Map<string, string>();
    for (const session of sortedSessions) {
      const explicitTitle = normalizeSessionTitle(session.title);
      const summaryTitle = session.summary_text?.trim()
        ? truncateText(session.summary_text.trim(), 52)
        : '';
      if (explicitTitle) {
        next.set(session.id, explicitTitle);
        continue;
      }
      if (summaryTitle) {
        next.set(session.id, summaryTitle);
        continue;
      }
      if (session.id === activeSession?.id && activeSessionDisplayTitle) {
        next.set(session.id, activeSessionDisplayTitle);
        continue;
      }
      next.set(
        session.id,
        t('sidebar.generatedSessionTitle', {
          date: formatDateShortWithTime(session.created_at),
        })
      );
    }
    return next;
  }, [activeSession?.id, activeSessionDisplayTitle, sortedSessions, t]);

  useEffect(() => {
    sessionTitleByIdRef.current = new Map(sessionDisplayTitles);
  }, [sessionDisplayTitles]);

  useEffect(() => {
    if (isAddMemberOpen || editingMember || teamImportPlan) {
      setIsRightSidebarOpen(true);
    }
  }, [editingMember, isAddMemberOpen, teamImportPlan]);

  useEffect(() => {
    if (activeSessionId && sessionMembers.length === 0) {
      setIsRightSidebarOpen(true);
    }
  }, [activeSessionId, sessionMembers.length]);

  const streamingRunCount = useMemo(
    () => Object.keys(streamingRuns).length,
    [streamingRuns]
  );
  const streamingRunAgentIds = useMemo(
    () => new Set(Object.values(streamingRuns).map((run) => run.agentId)),
    [streamingRuns]
  );
  const runByAgentId = useMemo<Map<string, StreamRun>>(() => {
    const next = new Map<string, StreamRun>();
    for (const run of Object.values(streamingRuns)) {
      next.set(run.agentId, run);
    }
    return next;
  }, [streamingRuns]);

  const placeholderAgents = useMemo(
    () =>
      sessionMembers.filter((member) => {
        const state = agentStates[member.agent.id] ?? member.sessionAgent.state;
        return (
          state === ChatSessionAgentState.running ||
          streamingRunAgentIds.has(member.agent.id)
        );
      }),
    [agentStates, sessionMembers, streamingRunAgentIds]
  );

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

  const activeWorkspaceRuns = useMemo<RunHistoryItem[]>(
    () =>
      runHistory
        .filter((run: RunHistoryItem) => run.agentId === workspaceAgentId)
        .sort(
          (a: RunHistoryItem, b: RunHistoryItem) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ),
    [runHistory, workspaceAgentId]
  );
  const formatProtocolNoticeContent = useCallback(
    (notice: ChatProtocolNotice) => {
      const values = {
        agent: notice.agent_name,
        target: notice.target ?? '',
      };
      const summary = (() => {
        switch (notice.code) {
          case 'invalid_json':
            return t('protocolNotice.invalidJson', values);
          case 'not_json_array':
            return t('protocolNotice.notJsonArray', values);
          case 'empty_message':
            return t('protocolNotice.emptyMessage', values);
          case 'missing_send_target':
            return t('protocolNotice.missingSendTarget', values);
          case 'invalid_send_target':
            return t('protocolNotice.invalidSendTarget', values);
          case 'invalid_send_intent':
            return t('protocolNotice.invalidSendIntent', values);
          default:
            return t('protocolNotice.invalidJson', values);
        }
      })();

      const detail =
        'detail' in notice && typeof notice.detail === 'string'
          ? notice.detail.trim()
          : '';

      return detail ? `${summary}\n${detail}` : summary;
    },
    [t]
  );

  const canSend =
    !!activeSessionId &&
    !isArchived &&
    (draft.trim().length > 0 ||
      selectedMentions.length > 0 ||
      attachedFiles.length > 0) &&
    !sendMessage.isPending &&
    !isUploadingAttachments;

  const diffViewerRun = diffViewerRunId ? runDiffs[diffViewerRunId] : null;
  const showEmptyTimelineIndicator =
    !isLoading &&
    !!activeSessionId &&
    timelineEntries.length === 0 &&
    protocolNotices.length === 0 &&
    placeholderAgents.length === 0;
  const emptyTimelineVariant =
    sessionMembers.length === 0 ? 'no-members' : 'empty-messages';

  const handleSelectPromptTemplate = useCallback(
    (templateValue: string) => {
      handleDraftChange(templateValue);
      requestAnimationFrame(() => {
        const textarea = inputRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        const nextHeight = Math.min(textarea.scrollHeight, 200);
        textarea.style.height = `${Math.max(44, nextHeight)}px`;
        textarea.focus();
        textarea.setSelectionRange(templateValue.length, templateValue.length);
      });
    },
    [handleDraftChange, inputRef]
  );

  const handleOpenAddMemberPanel = useCallback(() => {
    setIsRightSidebarOpen(true);
    setIsAddMemberOpen(true);
    setMemberError(null);
    setEditingMember(null);
    setNewMemberName('');
    setNewMemberVariant('DEFAULT');
    setNewMemberPrompt('');
    setNewMemberWorkspace('');
    setNewMemberSkillIds([]);
    setEditingMemberInitialSkillIds([]);
    setIsPromptEditorOpen(false);
    setPromptFileError(null);
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;

    const completedRunIds = new Set<string>();
    for (const message of visibleMessagesData) {
      const runId = extractRunId(message.meta);
      if (runId) {
        completedRunIds.add(runId);
      }
    }
    for (const workItem of visibleWorkItemsData) {
      completedRunIds.add(workItem.run_id);
    }

    const runningAgentIds = new Set<string>();
    for (const member of sessionMembers) {
      const state = agentStates[member.agent.id] ?? member.sessionAgent.state;
      if (state === ChatSessionAgentState.running) {
        runningAgentIds.add(member.agent.id);
      }
    }

    pruneStreamingRunsForSession(
      activeSessionId,
      completedRunIds,
      runningAgentIds
    );
  }, [
    activeSessionId,
    agentStates,
    visibleMessagesData,
    visibleWorkItemsData,
    pruneStreamingRunsForSession,
    sessionMembers,
  ]);

  // Check agent availability
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

  // Set default runner type
  useEffect(() => {
    if (editingMember) return;
    if (enabledRunnerTypes.length === 0) {
      setNewMemberRunnerType('');
      return;
    }
    if (!newMemberRunnerType || !isRunnerAvailable(newMemberRunnerType)) {
      setNewMemberRunnerType(enabledRunnerTypes[0]);
    }
  }, [
    editingMember,
    enabledRunnerTypes,
    isRunnerAvailable,
    newMemberRunnerType,
  ]);

  // Set default variant when runner type changes
  useEffect(() => {
    if (memberVariantOptions.length === 0) {
      if (newMemberVariant !== 'DEFAULT') {
        setNewMemberVariant('DEFAULT');
      }
      return;
    }

    if (memberVariantOptions.includes(newMemberVariant)) return;
    const defaultVariant = memberVariantOptions.includes('DEFAULT')
      ? 'DEFAULT'
      : memberVariantOptions[0];
    if (defaultVariant) {
      setNewMemberVariant(defaultVariant);
    }
  }, [memberVariantOptions, newMemberVariant]);

  // Sync agent states from session agents
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
  }, [agents, setAgentStates]);

  useEffect(() => {
    setAgentStates((prev) => {
      const next = { ...prev };
      for (const sessionAgent of sessionAgents) {
        next[sessionAgent.agent_id] = sessionAgent.state;
      }
      return next;
    });
    setAgentStateInfos((prev) => {
      const next = { ...prev };
      for (const sessionAgent of sessionAgents) {
        const existing = next[sessionAgent.agent_id];
        const shouldSetStartedAt =
          sessionAgent.state === ChatSessionAgentState.running &&
          !existing?.startedAt;
        const shouldUpdateState =
          !existing || existing.state !== sessionAgent.state;
        if (shouldUpdateState || shouldSetStartedAt) {
          next[sessionAgent.agent_id] = {
            state: sessionAgent.state,
            startedAt:
              sessionAgent.state === ChatSessionAgentState.running
                ? (existing?.startedAt ?? sessionAgent.updated_at)
                : null,
          };
        }
      }
      return next;
    });
  }, [sessionAgents, setAgentStates, setAgentStateInfos]);

  // Running timer
  useEffect(() => {
    if (placeholderAgents.length === 0) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [placeholderAgents]);

  // Title editing
  useEffect(() => {
    setTitleDraft(activeSessionTitle);
    setIsEditingTitle(false);
    setTitleError(null);
  }, [activeSession?.id, activeSessionTitle]);

  useEffect(() => {
    if (activeSession?.status === ChatSessionStatus.archived) {
      setShowArchived(true);
    }
  }, [activeSession?.status]);

  // Auto-scroll
  useEffect(() => {
    const isSessionChanged = previousSessionIdRef.current !== activeSessionId;
    previousSessionIdRef.current = activeSessionId;
    const animationFrame = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({
        behavior: isSessionChanged ? 'auto' : 'smooth',
        block: 'end',
      });
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [
    activeSessionId,
    lastTimelineEntryKey,
    streamingRunCount,
    placeholderAgents.length,
    protocolNotices.length,
  ]);

  useEffect(() => {
    setLogRunId(null);
    setLogContent('');
    setLogError(null);
  }, [workspaceAgentId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedMessageSearchQuery(messageSearchQuery);
    }, MESSAGE_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [messageSearchQuery]);

  // Handlers
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

  const getWorkItemSenderLabel = useCallback(
    (group: ChatWorkItemGroup) =>
      agentById.get(group.agentId)?.name ?? 'Agent',
    [agentById]
  );

  const artifactSpotlight = useMemo<ArtifactSpotlight | null>(() => {
    if (!activeSessionId) return null;

    for (let index = messageList.length - 1; index >= 0; index -= 1) {
      const message = messageList[index];
      const senderLabel = getMessageSenderLabel(message);
      const attachments = extractAttachments(message.meta);

      for (const attachment of attachments) {
        const name = attachment.name ?? '';
        const lowerName = name.toLowerCase();
        const mimeType = attachment.mime_type ?? '';
        const isImage =
          attachment.kind === 'image' || mimeType.startsWith('image/');
        const isHtml =
          mimeType.includes('html') ||
          lowerName.endsWith('.html') ||
          lowerName.endsWith('.htm');

        if (!isImage && !isHtml) continue;

        return {
          kind: 'attachment',
          name,
          url: chatApi.getChatAttachmentUrl(
            activeSessionId,
            message.id,
            attachment.id
          ),
          previewType: isImage ? 'image' : 'html',
          sourceLabel: senderLabel,
          createdAt: message.created_at,
          pathLabel: attachment.relative_path ?? name,
        };
      }

      const diffInfo = extractDiffMeta(message.meta);
      if (
        diffInfo.runId &&
        (diffInfo.available || diffInfo.untrackedFiles.length > 0)
      ) {
        return {
          kind: 'diff',
          runId: diffInfo.runId,
          sourceLabel: senderLabel,
          createdAt: message.created_at,
          hasDiff: diffInfo.available,
          untrackedFiles: diffInfo.untrackedFiles,
          previewText: diffInfo.preview,
        };
      }
    }

    return null;
  }, [activeSessionId, getMessageSenderLabel, messageList]);

  const artifactSpotlightKey = useMemo(
    () => getArtifactSpotlightKey(artifactSpotlight),
    [artifactSpotlight]
  );

  useEffect(() => {
    if (!artifactSpotlight) {
      setWorkspacePreviewArtifact(null);
      setIsWorkspacePreviewOpen(false);
      return;
    }

    setWorkspacePreviewArtifact((current) => {
      const currentKey = getArtifactSpotlightKey(current);
      if (currentKey === artifactSpotlightKey) {
        return current;
      }
      return artifactSpotlight;
    });
  }, [artifactSpotlight, artifactSpotlightKey]);

  useEffect(() => {
    if (
      isWorkspacePreviewOpen &&
      workspacePreviewArtifact?.kind === 'diff' &&
      workspacePreviewArtifact.hasDiff
    ) {
      handleLoadDiff(workspacePreviewArtifact.runId);
    }
  }, [handleLoadDiff, isWorkspacePreviewOpen, workspacePreviewArtifact]);

  // Sync lastSeenArtifactKey from session when it changes
  useEffect(() => {
    if (activeSession?.last_seen_diff_key) {
      setLastSeenArtifactKey(activeSession.last_seen_diff_key);
    }
  }, [activeSession?.id, activeSession?.last_seen_diff_key]);

  const handleSelectWorkspacePreview = useCallback(
    (artifact: ArtifactSpotlight) => {
      setWorkspacePreviewArtifact(artifact);
      setIsWorkspacePreviewOpen(true);
      // Mark changes as seen when user views them
      const artifactKey = getArtifactSpotlightKey(artifact);
      setLastSeenArtifactKey(artifactKey);
      // Persist to backend and update cache
      if (activeSessionId && artifactKey) {
        chatApi
          .markDiffSeen(activeSessionId, artifactKey)
          .then((updatedSession) => {
            // Update React Query cache directly
            queryClient.setQueryData<ChatSession[]>(
              ['chatSessions'],
              (oldSessions) =>
                oldSessions?.map((s) =>
                  s.id === updatedSession.id ? updatedSession : s
                )
            );
          })
          .catch((err) => {
            console.error('Failed to mark diff as seen:', err);
          });
      }
      if (artifact.kind === 'diff' && artifact.hasDiff) {
        void handleLoadDiff(artifact.runId);
      }
    },
    [activeSessionId, handleLoadDiff, queryClient]
  );

  // Determine if there are new unseen changes
  const hasNewChanges = useMemo(() => {
    if (!artifactSpotlight || artifactSpotlight.kind !== 'diff') return false;
    if (!artifactSpotlight.hasDiff) return false;
    return artifactSpotlightKey !== lastSeenArtifactKey;
  }, [artifactSpotlight, artifactSpotlightKey, lastSeenArtifactKey]);

  const handlePreviewMessageAttachment = useCallback(
    (message: ChatMessage, attachment: ChatAttachment) => {
      if (!activeSessionId || !attachment.id) return;

      const lowerName = (attachment.name ?? '').toLowerCase();
      const mimeType = attachment.mime_type ?? '';
      const isImage =
        attachment.kind === 'image' || mimeType.startsWith('image/');
      const isHtml =
        mimeType.includes('html') ||
        lowerName.endsWith('.html') ||
        lowerName.endsWith('.htm');

      if (!isImage && !isHtml) return;

      handleSelectWorkspacePreview({
        kind: 'attachment',
        name: attachment.name ?? 'attachment',
        url: chatApi.getChatAttachmentUrl(
          activeSessionId,
          message.id,
          attachment.id
        ),
        previewType: isImage ? 'image' : 'html',
        sourceLabel: getMessageSenderLabel(message),
        createdAt: message.created_at,
        pathLabel: attachment.relative_path ?? attachment.name ?? 'attachment',
      });
    },
    [activeSessionId, getMessageSenderLabel, handleSelectWorkspacePreview]
  );

  const trimmedMessageSearchQuery = isMessageSearchOpen
    ? debouncedMessageSearchQuery.trim()
    : '';

  const escapedMessageSearchQuery = useMemo(
    () =>
      trimmedMessageSearchQuery.length > 0
        ? escapeSearchRegExp(trimmedMessageSearchQuery)
        : '',
    [trimmedMessageSearchQuery]
  );

  const messageSearchRegExp = useMemo(() => {
    if (!escapedMessageSearchQuery) return null;
    return new RegExp(escapedMessageSearchQuery, 'iu');
  }, [escapedMessageSearchQuery]);

  const messageSearchHighlightRegExp = useMemo(() => {
    if (!escapedMessageSearchQuery) return null;
    return new RegExp(escapedMessageSearchQuery, 'giu');
  }, [escapedMessageSearchQuery]);

  const filteredTimelineEntries = useMemo(() => {
    if (!messageSearchRegExp) return timelineEntries;

    return timelineEntries.filter((entry) => {
      if (entry.kind === 'message') {
        const { message } = entry;
        if (messageSearchRegExp.test(message.content)) {
          return true;
        }

        if (messageSearchRegExp.test(getMessageSenderLabel(message))) {
          return true;
        }

        const attachments = extractAttachments(message.meta);
        return attachments.some((attachment) =>
          messageSearchRegExp.test(attachment.name ?? '')
        );
      }

      if (messageSearchRegExp.test(getWorkItemSenderLabel(entry.group))) {
        return true;
      }

      return (
        entry.group.artifacts.some((item) => messageSearchRegExp.test(item.content)) ||
        entry.group.conclusions.some((item) =>
          messageSearchRegExp.test(item.content)
        )
      );
    });
  }, [
    getMessageSenderLabel,
    getWorkItemSenderLabel,
    messageSearchRegExp,
    timelineEntries,
  ]);

  const handleCloseMessageSearch = useCallback(() => {
    setIsMessageSearchOpen(false);
  }, []);

  const handleOpenMessageSearch = useCallback(() => {
    setIsMessageSearchOpen(true);
  }, []);

  useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 'f') return;
      if (!activeSession) return;

      event.preventDefault();
      setIsMessageSearchOpen(true);
    };

    document.addEventListener('keydown', handleGlobalSearchShortcut);
    return () => {
      document.removeEventListener('keydown', handleGlobalSearchShortcut);
    };
  }, [activeSession]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof document === 'undefined' ||
      typeof CSS === 'undefined'
    ) {
      return;
    }

    const cssHighlights = (
      CSS as unknown as { highlights?: CSSHighlightRegistry }
    ).highlights;
    const HighlightCtor = (
      window as unknown as {
        Highlight?: new (...ranges: Range[]) => unknown;
      }
    ).Highlight;

    if (!cssHighlights || typeof HighlightCtor !== 'function') {
      return;
    }

    cssHighlights.delete(MESSAGE_SEARCH_HIGHLIGHT_NAME);

    if (!messageSearchHighlightRegExp) {
      return;
    }

    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const roots = container.querySelectorAll<HTMLElement>(
      '.chat-session-message-body, .chat-session-message-row.is-system, .chat-session-work-item-card'
    );
    const ranges: Range[] = [];

    roots.forEach((root) => {
      if (ranges.length >= MAX_MESSAGE_SEARCH_HIGHLIGHT_RANGES) {
        return;
      }

      const rangeRegExp = new RegExp(
        messageSearchHighlightRegExp.source,
        messageSearchHighlightRegExp.flags
      );
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const text = node.textContent;
          const parent = node.parentElement;
          if (!parent || !text || text.trim().length === 0) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest('button, a')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      let current = walker.nextNode();
      while (current && ranges.length < MAX_MESSAGE_SEARCH_HIGHLIGHT_RANGES) {
        const textNode = current as Text;
        rangeRegExp.lastIndex = 0;
        let match = rangeRegExp.exec(textNode.data);

        while (match && ranges.length < MAX_MESSAGE_SEARCH_HIGHLIGHT_RANGES) {
          const matchedText = match[0];
          if (matchedText.length === 0) {
            rangeRegExp.lastIndex += 1;
            match = rangeRegExp.exec(textNode.data);
            continue;
          }

          const range = document.createRange();
          range.setStart(textNode, match.index);
          range.setEnd(textNode, match.index + matchedText.length);
          ranges.push(range);

          match = rangeRegExp.exec(textNode.data);
        }

        current = walker.nextNode();
      }
    });

    if (ranges.length > 0) {
      cssHighlights.set(
        MESSAGE_SEARCH_HIGHLIGHT_NAME,
        new HighlightCtor(...ranges)
      );
    }

    return () => {
      cssHighlights.delete(MESSAGE_SEARCH_HIGHLIGHT_NAME);
    };
  }, [filteredTimelineEntries, messageSearchHighlightRegExp]);

  const getReferencePreview = useCallback((message: ChatMessage) => {
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
  }, []);

  const handleSend = async () => {
    if (!activeSessionId || isArchived) return;
    const trimmed = draft.trim();
    const sanitizedTrimmed = stripMentionAllAliases(trimmed);
    const contentMentions = extractMentions(draft);
    const directContentMentions = new Set(
      Array.from(contentMentions).filter((name) => !isMentionAllAlias(name))
    );
    const allMentionTokens = [
      ...Array.from(contentMentions),
      ...selectedMentions,
    ];
    const expandedMentions = new Set<string>();

    for (const mention of allMentionTokens) {
      if (isMentionAllAlias(mention)) {
        for (const agent of mentionAgents) {
          expandedMentions.add(agent.name);
        }
        continue;
      }
      expandedMentions.add(mention);
    }

    const mentionsToInject = Array.from(expandedMentions).filter(
      (name) => !directContentMentions.has(name)
    );
    const mentionPrefix =
      mentionsToInject.length > 0
        ? mentionsToInject.map((name) => `@${name}`).join(' ')
        : '';
    const content = [mentionPrefix, sanitizedTrimmed]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (!content && attachedFiles.length === 0) return;

    const allMentions = expandedMentions;
    const runningMentionedAgents: string[] = [];
    allMentions.forEach((name) => {
      const agentId = agentIdByName.get(name);
      if (agentId && agentStates[agentId] === ChatSessionAgentState.running) {
        runningMentionedAgents.push(name);
      }
    });

    if (runningMentionedAgents.length > 0) {
      setConfirmModal({
        title: t('modals.confirm.titles.agentRunning'),
        message: t('modals.confirm.messages.agentRunning', {
          agents: runningMentionedAgents.join(', @'),
        }),
        onConfirm: async () => {
          await doSendMessage(content);
        },
      });
      return;
    }

    await doSendMessage(content);
  };

  const doSendMessage = async (content: string) => {
    if (!activeSessionId) return;
    const meta: JsonValue = {
      app_language: appLanguage,
      sender_handle: senderHandle,
      ...(replyToMessage
        ? { reference: { message_id: replyToMessage.id } }
        : {}),
    };

    try {
      if (attachedFiles.length > 0) {
        await handleAttachmentUpload(attachedFiles, {
          content: content || undefined,
          referenceMessageId: replyToMessage?.id,
        });
      } else {
        await sendMessage.mutateAsync({
          sessionId: activeSessionId,
          content,
          meta,
        });
      }

      resetInput();
      inputRef.current?.focus();
      setAttachedFiles([]);
    } catch (error) {
      console.warn('Failed to send chat message', error);
    }
  };

  const handleAttachmentUpload = async (
    files: FileList | File[],
    options?: { content?: string; referenceMessageId?: string }
  ) => {
    if (!activeSessionId || isArchived) return;
    const list = Array.from(files);
    if (list.length === 0) return;

    const allowedFiles = list.filter((file) => isAllowedAttachment(file));

    if (allowedFiles.length === 0) {
      setAttachmentError('Only text files and images are allowed.');
      return;
    }

    setIsUploadingAttachments(true);
    setAttachmentError(null);
    try {
      const message = await chatApi.uploadChatAttachments(
        activeSessionId,
        allowedFiles,
        {
          appLanguage,
          senderHandle,
          content: options?.content,
          referenceMessageId: options?.referenceMessageId,
        }
      );
      upsertMessage(message);
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
      setAttachedFiles([]);
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
      const files = Array.from(event.target.files);
      const allowedFiles = files.filter((file) => isAllowedAttachment(file));

      if (allowedFiles.length !== files.length) {
        const rejectedCount = files.length - allowedFiles.length;
        setAttachmentError(
          `Some files were rejected (${rejectedCount}). Only text files and images are allowed.`
        );
      }

      setAttachedFiles((prev) => [...prev, ...allowedFiles]);
    }
    event.target.value = '';
  };

  const removeAttachedFile = (fileName: string, fileSize: number) => {
    setAttachedFiles((prev) =>
      prev.filter((file) => !(file.name === fileName && file.size === fileSize))
    );
  };

  const clearAttachedFiles = () => {
    setAttachedFiles([]);
  };

  const previewAttachedFile = async (file: File) => {
    try {
      if (isTextAttachment(file)) {
        const content = await file.text();
        setPreviewFile({ file, content });
      } else if (isImageAttachment(file)) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setPreviewFile({ file, content: e.target?.result as string });
        };
        reader.readAsDataURL(file);
      } else {
        setPreviewFile({ file, content: null });
      }
    } catch (error) {
      console.error('Error previewing file:', error);
      setAttachmentError('Could not preview file.');
    }
  };

  const closePreview = () => {
    setPreviewFile({ file: null, content: null });
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

  const buildTeamImportPlan = useCallback(
    (teamPreset: ChatTeamPreset): MemberPresetImportPlan[] => {
      const importSessionId = activeSessionId ?? 'preview';
      const plans: MemberPresetImportPlan[] = [];

      for (const memberPresetId of teamPreset.member_ids) {
        const preset = memberPresetById.get(memberPresetId);
        if (!preset) {
          plans.push({
            presetId: memberPresetId,
            presetName: memberPresetId,
            runnerType: '',
            finalName: memberPresetId,
            systemPrompt: '',
            toolsEnabled: {},
            action: 'skip',
            reason: 'member-preset-missing',
            agentId: null,
            workspacePath: '',
            selectedSkillIds: [],
          });
          continue;
        }

        if (!preset.enabled) {
          plans.push({
            presetId: preset.id,
            presetName: preset.name,
            runnerType: '',
            finalName: preset.name,
            systemPrompt: '',
            toolsEnabled: {},
            action: 'skip',
            reason: 'member-preset-disabled',
            agentId: null,
            workspacePath: '',
            selectedSkillIds: [],
          });
          continue;
        }

        const plan = buildMemberPresetImportPlan({
          preset,
          sessionId: importSessionId,
          fallbackWorkspacePath: homeDirectory,
          defaultRunnerType: config?.executor_profile?.executor ?? null,
          enabledRunnerTypes,
          availableRunnerTypes,
          profiles,
        });

        if (!plan) {
          plans.push({
            presetId: preset.id,
            presetName: preset.name,
            runnerType: '',
            finalName: preset.name,
            systemPrompt: '',
            toolsEnabled: {},
            action: 'skip',
            reason: 'runner-not-available',
            agentId: null,
            workspacePath: '',
            selectedSkillIds: [],
          });
          continue;
        }

        plans.push(plan);
      }

      return plans;
    },
    [
      activeSessionId,
      availableRunnerTypes,
      config?.executor_profile?.executor,
      enabledRunnerTypes,
      homeDirectory,
      memberPresetById,
      profiles,
    ]
  );

  const resolveTeamImportProtocol = useCallback(
    (protocol: string | null | undefined) => {
      const raw = protocol ?? '';
      return raw.trim().length > 0 ? raw : null;
    },
    []
  );

  const normalizeAllowedSkillIds = useCallback((skillIds: string[]) => {
    return Array.from(
      new Set(skillIds.map((skillId) => skillId.trim()).filter(Boolean))
    );
  }, []);

  const importMembersFromPlan = useCallback(
    async (plan: MemberPresetImportPlan[]) => {
      if (!activeSessionId) return;

      for (const entry of plan) {
        if (entry.action === 'skip') continue;

        let agentId = entry.agentId;
        if (entry.action === 'create') {
          const created = await chatApi.createAgent({
            name: entry.finalName,
            runner_type: entry.runnerType,
            system_prompt: entry.systemPrompt,
            tools_enabled: entry.toolsEnabled as JsonValue,
          });
          agentId = created.id;
        }

        const selectedSkillIds = normalizeAllowedSkillIds(
          entry.selectedSkillIds ?? []
        );

        if (!agentId) {
          continue;
        }

        await chatApi.createSessionAgent(activeSessionId, {
          agent_id: agentId,
          workspace_path: entry.workspacePath,
          allowed_skill_ids: selectedSkillIds,
        });
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['chatAgents'] }),
        queryClient.invalidateQueries({
          queryKey: ['chatSessionAgents', activeSessionId],
        }),
      ]);
    },
    [activeSessionId, normalizeAllowedSkillIds, queryClient]
  );

  const validateAndPrepareImportPlan = useCallback(
    (plan: MemberPresetImportPlan[]): MemberPresetImportPlan[] | null => {
      const existingSessionMemberNamesLower = new Set(
        sessionMembers.map((member) => member.agent.name.toLowerCase())
      );
      const enabledRunnerTypesSet = new Set(enabledRunnerTypes);
      const createNamesLower = new Set<string>();
      const projectNameLower = activeSessionTitle.trim().toLowerCase();
      const preparedPlan: MemberPresetImportPlan[] = [];

      for (const entry of plan) {
        if (entry.action === 'skip') {
          preparedPlan.push(entry);
          continue;
        }

        const finalName = entry.finalName.trim();
        const workspacePath = entry.workspacePath.trim();
        const runnerType = entry.runnerType.trim();

        if (!runnerType) {
          setMemberError(
            t('members.importPreview.errors.baseCodingAgentRequired')
          );
          return null;
        }

        if (!enabledRunnerTypesSet.has(runnerType)) {
          setMemberError(
            t('members.importPreview.errors.selectedCodingAgentUnavailable')
          );
          return null;
        }

        if (!finalName) {
          setMemberError(t('members.importPreview.errors.memberNameRequired'));
          return null;
        }

        if (getMemberNameLength(finalName) > MAX_MEMBER_NAME_LENGTH) {
          setMemberError(
            t('members.importPreview.errors.memberNameTooLong', {
              max: MAX_MEMBER_NAME_LENGTH,
            })
          );
          return null;
        }

        if (!memberNameRegex.test(finalName)) {
          setMemberError(
            t('members.importPreview.errors.memberNameInvalidChars')
          );
          return null;
        }

        const workspacePathError = validateWorkspacePath(workspacePath);
        if (workspacePathError) {
          setMemberError(translateWorkspacePathError(workspacePathError, t));
          return null;
        }

        const selectedSkillIds = Array.from(
          new Set(
            (entry.selectedSkillIds ?? [])
              .map((skillId) => skillId.trim())
              .filter(Boolean)
          )
        );

        const nextEntry: MemberPresetImportPlan = {
          ...entry,
          finalName,
          workspacePath,
          runnerType,
          selectedSkillIds,
        };

        if (nextEntry.action === 'create') {
          const finalNameLower = finalName.toLowerCase();
          if (
            projectNameLower.length > 0 &&
            finalNameLower === projectNameLower
          ) {
            setMemberError(
              t('members.importPreview.errors.memberNameMatchProject')
            );
            return null;
          }
          if (existingSessionMemberNamesLower.has(finalNameLower)) {
            showDuplicateMemberNameWarning(finalName);
            return null;
          }
          if (createNamesLower.has(finalNameLower)) {
            setMemberError(
              t('members.importPreview.errors.duplicateMemberNames')
            );
            return null;
          }
          createNamesLower.add(finalNameLower);
        }

        preparedPlan.push(nextEntry);
      }

      return preparedPlan;
    },
    [
      activeSessionTitle,
      enabledRunnerTypes,
      sessionMembers,
      showDuplicateMemberNameWarning,
      t,
    ]
  );

  const handleAddMemberPreset = useCallback(
    (preset: ChatMemberPreset) => {
      const plan = buildMemberPresetImportPlan({
        preset,
        sessionId: activeSessionId ?? 'preview',
        fallbackWorkspacePath: homeDirectory,
        defaultRunnerType: config?.executor_profile?.executor ?? null,
        enabledRunnerTypes,
        availableRunnerTypes,
        profiles,
      });

      if (!plan) {
        return;
      }

      setTeamImportName(getLocalizedMemberPresetName(preset, t));
      setTeamImportProtocol(null);
      setTeamImportPlan([plan]);
      setMemberError(null);
    },
    [
      activeSessionId,
      availableRunnerTypes,
      config?.executor_profile?.executor,
      enabledRunnerTypes,
      homeDirectory,
      profiles,
      t,
    ]
  );

  const handleImportTeamPreset = useCallback(
    (teamPreset: ChatTeamPreset) => {
      const plan = buildTeamImportPlan(teamPreset);
      if (plan.length === 0) {
        setMemberError(t('members.importPreview.errors.nothingToImport'));
        return;
      }

      setTeamImportName(getLocalizedTeamPresetName(teamPreset, t));
      setTeamImportProtocol(
        resolveTeamImportProtocol(teamPreset.team_protocol)
      );
      setTeamImportPlan(plan);
      setMemberError(null);
    },
    [
      buildTeamImportPlan,
      resolveTeamImportProtocol,
      t,
    ]
  );

  const handleUpdateTeamImportPlanEntry = useCallback(
    (
      index: number,
      updates: {
        finalName?: string;
        workspacePath?: string;
        runnerType?: string;
        systemPrompt?: string;
        toolsEnabled?: JsonValue;
        selectedSkillIds?: string[];
      }
    ) => {
      setTeamImportPlan((prev) => {
        if (!prev || index < 0 || index >= prev.length) return prev;
        const next = [...prev];
        const patch: Partial<MemberPresetImportPlan> = {};
        const normalizePlanSkillIds = (skillIds: string[]) =>
          Array.from(
            new Set(
              skillIds
                .filter(
                  (skillId): skillId is string => typeof skillId === 'string'
                )
                .map((skillId) => skillId.trim())
                .filter(Boolean)
            )
          );
        if (updates.finalName !== undefined)
          patch.finalName = updates.finalName;
        if (updates.workspacePath !== undefined)
          patch.workspacePath = updates.workspacePath;
        if (updates.runnerType !== undefined) {
          patch.runnerType = updates.runnerType;
          if (updates.toolsEnabled === undefined) {
            const currentToolsEnabled = next[index].toolsEnabled;
            const currentVariant =
              extractExecutorProfileVariant(currentToolsEnabled);
            const nextVariantOptions = getVariantOptions(updates.runnerType);
            const nextVariant =
              currentVariant && nextVariantOptions.includes(currentVariant)
                ? currentVariant
                : nextVariantOptions.includes('DEFAULT')
                  ? null
                  : (nextVariantOptions[0] ?? null);
            patch.toolsEnabled = withExecutorProfileVariant(
              currentToolsEnabled,
              nextVariant
            );
          }
        }
        if (updates.systemPrompt !== undefined)
          patch.systemPrompt = updates.systemPrompt;
        if (updates.toolsEnabled !== undefined)
          patch.toolsEnabled = updates.toolsEnabled;
        if (updates.selectedSkillIds !== undefined)
          patch.selectedSkillIds = normalizePlanSkillIds(
            updates.selectedSkillIds
          );
        next[index] = { ...next[index], ...patch };
        return next;
      });
    },
    [getVariantOptions]
  );

  const handleConfirmTeamImport = useCallback(async () => {
    if (!teamImportPlan || teamImportPlan.length === 0) return;
    if (!activeSessionId) {
      setMemberError(t('members.importPreview.errors.selectSessionFirst'));
      return;
    }
    if (isArchived) {
      setMemberError(t('members.importPreview.errors.sessionArchived'));
      return;
    }

    const preparedPlan = validateAndPrepareImportPlan(teamImportPlan);
    if (!preparedPlan) return;

    const actionablePlan = preparedPlan.filter(
      (entry) => entry.action !== 'skip'
    );
    if (actionablePlan.length === 0) {
      setMemberError(t('members.importPreview.errors.nothingToImport'));
      setTeamImportPlan(null);
      setTeamImportName(null);
      setTeamImportProtocol(null);
      return;
    }

    const workspacePathsToValidate = new Set(
      actionablePlan.map((entry) => entry.workspacePath.trim()).filter(Boolean)
    );
    for (const workspacePath of workspacePathsToValidate) {
      const result = await chatApi.validateWorkspacePath(workspacePath);
      if (!result.valid) {
        setMemberError(
          translateWorkspacePathError(
            result.error || 'Invalid workspace path.',
            t
          )
        );
        return;
      }
    }

    setIsImportingTeam(true);
    setMemberError(null);
    setTeamImportPlan(preparedPlan);
    try {
      if (teamImportProtocol && activeSessionId) {
        await chatApi.updateTeamProtocol(activeSessionId, {
          content: teamImportProtocol,
          enabled: true,
        });
        setTeamProtocolRefreshToken((current) => current + 1);
      }
      await importMembersFromPlan(preparedPlan);
      setTeamImportPlan(null);
      setTeamImportName(null);
      setTeamImportProtocol(null);
      setIsAddMemberOpen(false);
    } catch (error) {
      console.error('Failed to import team preset', error);
      if (error instanceof ApiError && error.message) {
        setMemberError(error.message);
      } else if (error instanceof Error && error.message) {
        setMemberError(error.message);
      } else {
        setMemberError(t('members.importPreview.errors.failedToImportTeam'));
      }
    } finally {
      setIsImportingTeam(false);
    }
  }, [
    importMembersFromPlan,
    activeSessionId,
    isArchived,
    setIsAddMemberOpen,
    teamImportPlan,
    teamImportProtocol,
    t,
    validateAndPrepareImportPlan,
  ]);

  const handleCancelTeamImport = useCallback(() => {
    if (isImportingTeam) return;
    setTeamImportPlan(null);
    setTeamImportName(null);
    setTeamImportProtocol(null);
  }, [isImportingTeam]);

  const handleAddMember = async () => {
    if (!activeSessionId) {
      setMemberError(t('members.addMemberErrors.selectSessionFirst'));
      return;
    }
    if (isArchived) {
      setMemberError(t('members.addMemberErrors.sessionArchived'));
      return;
    }

    const name = newMemberName.trim();
    const runnerType = newMemberRunnerType.trim();
    const prompt = newMemberPrompt.trim();
    const workspacePathVal = newMemberWorkspace.trim();
    const selectedVariant = newMemberVariant.trim() || 'DEFAULT';
    const normalizedSelectedSkillIds =
      normalizeAllowedSkillIds(newMemberSkillIds);

    if (!name) {
      setMemberError(t('members.addMemberErrors.memberNameRequired'));
      return;
    }

    if (getMemberNameLength(name) > MAX_MEMBER_NAME_LENGTH) {
      setMemberError(
        t('members.addMemberErrors.memberNameTooLong', {
          max: MAX_MEMBER_NAME_LENGTH,
        })
      );
      return;
    }

    if (!memberNameRegex.test(name)) {
      setMemberError(t('members.addMemberErrors.memberNameInvalidChars'));
      return;
    }

    const projectName = activeSessionTitle.trim();
    const isNameChange =
      !editingMember ||
      editingMember.agent.name.trim().toLowerCase() !== name.toLowerCase();
    if (
      projectName.length > 0 &&
      isNameChange &&
      projectName.toLowerCase() === name.toLowerCase()
    ) {
      setMemberError(t('members.addMemberErrors.memberNameMatchProject'));
      return;
    }

    if (!runnerType) {
      setMemberError(t('members.addMemberErrors.baseCodingAgentRequired'));
      return;
    }

    if (!isRunnerAvailable(runnerType)) {
      setMemberError(
        t('members.addMemberErrors.selectedCodingAgentUnavailable')
      );
      return;
    }

    const workspacePathError = validateWorkspacePath(workspacePathVal);
    if (workspacePathError) {
      setMemberError(
        translateWorkspacePathError(workspacePathError, t, 'addMemberErrors')
      );
      return;
    }

    const workspacePathValidation =
      await chatApi.validateWorkspacePath(workspacePathVal);
    if (!workspacePathValidation.valid) {
      setMemberError(
        translateWorkspacePathError(
          workspacePathValidation.error || 'Invalid workspace path.',
          t,
          'addMemberErrors'
        )
      );
      return;
    }

    if (!prompt) {
      setMemberError(t('members.roleSettingsRequired'));
      return;
    }

    let nameChanged = false;
    let runnerChanged = false;
    let promptChanged = false;
    let variantChanged = false;
    let workspaceChanged = false;
    let skillsChanged = false;
    if (editingMember) {
      nameChanged = editingMember.agent.name !== name;
      runnerChanged = editingMember.agent.runner_type !== runnerType;
      promptChanged = (editingMember.agent.system_prompt ?? '') !== prompt;
      const existingVariant =
        extractExecutorProfileVariant(editingMember.agent.tools_enabled) ??
        'DEFAULT';
      variantChanged = existingVariant !== selectedVariant;
      workspaceChanged =
        (editingMember.sessionAgent.workspace_path ?? '') !== workspacePathVal;
      skillsChanged = !areSetsEqual(
        new Set(normalizedSelectedSkillIds),
        new Set(editingMemberInitialSkillIds)
      );

      if (nameChanged) {
        const conflict = sessionMembers.find(
          (member) =>
            member.sessionAgent.id !== editingMember.sessionAgent.id &&
            member.agent.name.toLowerCase() === name.toLowerCase()
        );
        if (conflict) {
          showDuplicateMemberNameWarning(name);
          return;
        }
      }

      if (
        !nameChanged &&
        !runnerChanged &&
        !promptChanged &&
        !variantChanged &&
        !workspaceChanged &&
        !skillsChanged
      ) {
        setEditingMember(null);
        setIsAddMemberOpen(false);
        setMemberError(null);
        return;
      }
    }

    setIsSavingMember(true);
    setMemberError(null);

    try {
      if (editingMember) {
        const agentId = editingMember.agent.id;
        const toolsEnabledPayload = withExecutorProfileVariant(
          editingMember.agent.tools_enabled,
          selectedVariant
        );
        const updatePayload = {
          name: nameChanged ? name : null,
          runner_type: runnerChanged ? runnerType : null,
          system_prompt: promptChanged ? prompt : null,
          tools_enabled: variantChanged ? toolsEnabledPayload : null,
        };

        if (
          updatePayload.name ||
          updatePayload.runner_type ||
          updatePayload.system_prompt ||
          updatePayload.tools_enabled
        ) {
          await chatApi.updateAgent(agentId, updatePayload);
        }

        if (workspaceChanged || skillsChanged) {
          const sessionIdForUpdate =
            editingMember.sessionAgent.session_id ?? activeSessionId;
          if (!sessionIdForUpdate) {
            throw new ApiError('Missing session context for AI member update.');
          }
          await chatApi.updateSessionAgent(
            sessionIdForUpdate,
            editingMember.sessionAgent.id,
            {
              workspace_path: workspacePathVal,
              allowed_skill_ids: normalizedSelectedSkillIds,
            }
          );
        }
      } else {
        const conflict = sessionMembers.find(
          (member) => member.agent.name.toLowerCase() === name.toLowerCase()
        );
        if (conflict) {
          showDuplicateMemberNameWarning(name);
          return;
        }

        const created = await chatApi.createAgent({
          name,
          runner_type: runnerType,
          system_prompt: prompt,
          tools_enabled: withExecutorProfileVariant({}, selectedVariant),
        });
        const agentId = created.id;

        if (!agentId) {
          setMemberError('Unable to create AI member.');
          return;
        }

        await chatApi.createSessionAgent(activeSessionId, {
          agent_id: agentId,
          workspace_path: workspacePathVal,
          allowed_skill_ids: normalizedSelectedSkillIds,
        });
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['chatAgents'] }),
        queryClient.invalidateQueries({
          queryKey: ['chatSessionAgents', activeSessionId],
        }),
      ]);

      setNewMemberName('');
      setNewMemberVariant('DEFAULT');
      setNewMemberPrompt('');
      setNewMemberWorkspace('');
      setNewMemberSkillIds([]);
      setEditingMemberInitialSkillIds([]);
      setMemberError(null);
      setEditingMember(null);
      setIsAddMemberOpen(false);
    } catch (error) {
      console.warn('Failed to add AI member', error);
      if (error instanceof ApiError && error.message) {
        if (
          error.message.includes('already exists in this session') ||
          error.message.includes('An AI member with this name already exists.')
        ) {
          showDuplicateMemberNameWarning(name);
          return;
        }
        setMemberError(error.message);
      } else if (error instanceof Error && error.message) {
        setMemberError(error.message);
      } else {
        setMemberError(
          editingMember
            ? 'Failed to update AI member. Check server logs.'
            : 'Failed to add AI member. Check server logs.'
        );
      }
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
    setNewMemberVariant(
      extractExecutorProfileVariant(member.agent.tools_enabled) ?? 'DEFAULT'
    );
    setNewMemberPrompt(member.agent.system_prompt ?? '');
    setNewMemberWorkspace(member.sessionAgent.workspace_path ?? '');
    setNewMemberSkillIds([]);
    setEditingMemberInitialSkillIds([]);
    setMemberError(null);
    setIsPromptEditorOpen(false);
    setPromptFileError(null);
    setPromptFileLoading(false);
    setIsAddMemberOpen(true);
    const allowedSkillIds = normalizeAllowedSkillIds(
      member.sessionAgent.allowed_skill_ids ?? []
    );
    setNewMemberSkillIds(allowedSkillIds);
    setEditingMemberInitialSkillIds(allowedSkillIds);
  };

  const handleRemoveMember = async (member: SessionMember) => {
    if (!activeSessionId) return;
    if (isArchived) {
      setMemberError('This session is archived and read-only.');
      return;
    }
    const sessionAgentId = member.sessionAgent.id;
    setConfirmModal({
      title: t('modals.confirm.titles.removeMember'),
      message: t('modals.confirm.messages.removeMember', {
        name: member.agent.name,
      }),
      onConfirm: async () => {
        try {
          await chatApi.deleteSessionAgent(activeSessionId, sessionAgentId);
          await queryClient.invalidateQueries({
            queryKey: ['chatSessionAgents', activeSessionId],
          });
          await queryClient.refetchQueries({
            queryKey: ['chatSessionAgents', activeSessionId],
          });
          if (workspaceAgentId === member.agent.id) {
            setWorkspaceDrawerOpen(false);
            setWorkspaceAgentId(null);
          }
        } catch (error) {
          console.error('Failed to remove AI member:', error);
          setMemberError('Failed to remove AI member.');
        }
      },
    });
  };

  // 鈹€鈹€ Preset import handlers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  const handleSaveTitle = async () => {
    if (!activeSessionId) return;
    const trimmed = titleDraft.trim();
    if (getSessionTitleLength(trimmed) > MAX_SESSION_TITLE_LENGTH) {
      setTitleError(
        `Session name cannot exceed ${MAX_SESSION_TITLE_LENGTH} characters.`
      );
      return;
    }
    try {
      await updateSession.mutateAsync({
        sessionId: activeSessionId,
        title: trimmed.length > 0 ? trimmed : null,
      });
      setIsEditingTitle(false);
      setTitleError(null);
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

  const handleLocalReplySelect = useCallback(
    (message: ChatMessage) => {
      const handle = getMessageMentionHandle(message);
      handleReplySelect(message, handle);
    },
    [getMessageMentionHandle, handleReplySelect]
  );

  const handleStopAgent = useCallback(
    async (sessionAgentId: string, agentId: string) => {
      if (!activeSessionId) return;
      setStoppingAgents((prev) => new Set(prev).add(agentId));
      try {
        await chatApi.stopSessionAgent(activeSessionId, sessionAgentId);
      } catch (error) {
        console.warn('Failed to stop agent', error);
      } finally {
        setStoppingAgents((prev) => {
          const next = new Set(prev);
          next.delete(agentId);
          return next;
        });
      }
    },
    [activeSessionId]
  );

  // Resize handlers
  const handleResizeStart = useCallback(
    (type: 'left' | 'right', e: React.MouseEvent) => {
      e.preventDefault();
      if (type === 'left' && isLeftSidebarCollapsed) {
        return;
      }
      setIsResizing(type);
      resizeStartRef.current = {
        startX: e.clientX,
        startWidth: type === 'left' ? leftSidebarWidth : rightSidebarWidth,
      };
    },
    [isLeftSidebarCollapsed, leftSidebarWidth, rightSidebarWidth]
  );

  const handleToggleLeftSidebar = useCallback(() => {
    setIsLeftSidebarCollapsed((prev) => {
      if (!prev) {
        lastExpandedLeftWidthRef.current = leftSidebarWidth;
        setLeftSidebarWidth(COLLAPSED_LEFT_SIDEBAR_WIDTH);
        return true;
      }
      setLeftSidebarWidth(Math.max(220, lastExpandedLeftWidthRef.current));
      return false;
    });
  }, [leftSidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeStartRef.current) return;
      const { startX, startWidth } = resizeStartRef.current;

      if (isResizing === 'left') {
        const delta = e.clientX - startX;
        const newWidth = Math.max(200, Math.min(500, startWidth + delta));
        setLeftSidebarWidth(newWidth);
      } else if (isResizing === 'right') {
        const delta = startX - e.clientX;
        const newWidth = Math.max(240, Math.min(600, startWidth + delta));
        setRightSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(null);
      resizeStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const skillsPanelLeftOffset = isLeftSidebarCollapsed
    ? COLLAPSED_LEFT_SIDEBAR_WIDTH
    : leftSidebarWidth + 1;
  const sidebarActiveSessionId = isSkillsPanelOpen ? null : activeSessionId;

  return (
    <div className="chat-session-page relative flex h-full min-h-0 overflow-hidden select-none">
      {/* Session List Sidebar */}
      <SessionListSidebar
        activeSessions={activeSessions}
        archivedSessions={archivedSessions}
        activeSessionId={sidebarActiveSessionId}
        unreadSessionIds={unreadSessionIds}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((prev) => !prev)}
        onSelectSession={(id) => {
          setUnreadSessionIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          setIsSkillsPanelOpen(false);
          navigate(`/chat/${id}`);
        }}
        onCreateSession={() => {
          setIsSkillsPanelOpen(false);
          createSession.mutate();
        }}
        isCreating={createSession.isPending}
        onOpenAiTeam={() => {
          setIsSkillsPanelOpen(false);
          setIsAiTeamPresetsOpen(true);
        }}
        onOpenSkills={() => {
          if (isSkillsPanelOpen) {
            setIsSkillsPanelOpen(false);
            return;
          }
          setIsSkillsPanelOpen(true);
          if (sessionId) {
            navigate('/chat');
          }
        }}
        onOpenSettings={() => {
          SettingsDialog.show();
        }}
        isAiTeamActive={isAiTeamPresetsOpen}
        isSkillsActive={isSkillsPanelOpen}
        width={leftSidebarWidth}
        isCollapsed={isLeftSidebarCollapsed}
        onToggleCollapsed={handleToggleLeftSidebar}
        onArchiveSession={(id) => archiveSession.mutate(id)}
        onRestoreSession={(id) => restoreSession.mutate(id)}
        onDeleteSession={(id, title) => {
          setConfirmModal({
            title: t('modals.confirm.titles.deleteSession'),
            message: t('modals.confirm.messages.deleteSession', { title }),
            onConfirm: async () => {
              await deleteSession.mutateAsync(id);
            },
          });
        }}
        onEditSessionTitle={(id) => {
          setIsSkillsPanelOpen(false);
          navigate(`/chat/${id}`);
          setTimeout(() => setIsEditingTitle(true), 100);
        }}
        onToggleCleanupMode={(id) => {
          setIsSkillsPanelOpen(false);
          navigate(`/chat/${id}`);
          setTimeout(() => setIsCleanupMode(true), 100);
        }}
        isArchiving={archiveSession.isPending || restoreSession.isPending}
        isDeletingMessages={isDeletingMessages}
      />

      {/* Left Sidebar Resize Handle */}
      {!isLeftSidebarCollapsed && (
        <div
          className="chat-session-resize-handle w-1 cursor-col-resize transition-colors shrink-0"
          onMouseDown={(e) => handleResizeStart('left', e)}
        />
      )}

      <div className="chat-session-main-shell relative flex flex-1 min-w-0 min-h-0">
        {/* Main Chat Section */}
        <section className="chat-session-main flex-1 min-w-0 min-h-0 flex flex-col">
          <ChatHeader
            activeSession={activeSession ?? null}
            displayTitle={activeSessionDisplayTitle}
            isGeneratedTitle={isGeneratedActiveSessionTitle}
            isSearchOpen={isMessageSearchOpen}
            searchQuery={messageSearchQuery}
            onOpenSearch={handleOpenMessageSearch}
            onCloseSearch={handleCloseMessageSearch}
            onSearchQueryChange={setMessageSearchQuery}
            isArchived={isArchived}
            isEditingTitle={isEditingTitle}
            titleDraft={titleDraft}
            titleError={titleError}
            isSavingTitle={updateSession.isPending}
            onStartEditTitle={() => {
              if (isGeneratedActiveSessionTitle) {
                setTitleDraft(activeSessionEditableSuggestion);
              }
              setIsEditingTitle(true);
              setTitleError(null);
            }}
            onTitleDraftChange={(value) => {
              setTitleDraft(value);
              if (getSessionTitleLength(value) > MAX_SESSION_TITLE_LENGTH) {
                setTitleError(
                  `Session name cannot exceed ${MAX_SESSION_TITLE_LENGTH} characters.`
                );
              } else {
                setTitleError(null);
              }
            }}
            onSaveTitle={handleSaveTitle}
            onCancelTitleEdit={handleCancelTitleEdit}
            onDeleteSession={() => {
              if (!activeSession) return;
              setConfirmModal({
                title: t('modals.confirm.titles.deleteSession'),
                message: t('modals.confirm.messages.deleteSession', {
                  title: activeSessionDisplayTitle,
                }),
                onConfirm: async () => {
                  await deleteSession.mutateAsync(activeSession.id);
                },
              });
            }}
            onArchive={() => {
              if (activeSessionId) archiveSession.mutate(activeSessionId);
            }}
            onRestore={() => {
              if (activeSessionId) restoreSession.mutate(activeSessionId);
            }}
            isArchiving={archiveSession.isPending || restoreSession.isPending}
            isCleanupMode={isCleanupMode}
            onToggleCleanupMode={() => {
              if (isCleanupMode) {
                setIsCleanupMode(false);
                setSelectedMessageIds(new Set());
              } else {
                setIsCleanupMode(true);
              }
            }}
            isDeletingMessages={isDeletingMessages}
            hasChanges={
              artifactSpotlight?.kind === 'diff' && artifactSpotlight.hasDiff
            }
            hasNewChanges={hasNewChanges}
            onViewChanges={
              artifactSpotlight?.kind === 'diff'
                ? () => handleSelectWorkspacePreview(artifactSpotlight)
                : undefined
            }
          />

          {/* Cleanup mode controls */}
          {activeSession && isCleanupMode && (
            <CleanupModeBar
              selectedCount={selectedMessageIds.size}
              totalCount={messageList.length}
              onToggleSelectAll={() => {
                if (selectedMessageIds.size === messageList.length) {
                  setSelectedMessageIds(new Set());
                } else {
                  setSelectedMessageIds(new Set(messageList.map((m) => m.id)));
                }
              }}
              onDeleteSelected={() => {
                if (!activeSessionId) return;
                const count = selectedMessageIds.size;
                setConfirmModal({
                  title: t('modals.confirm.titles.deleteMessages'),
                  message: t('modals.confirm.messages.deleteMessages', {
                    count,
                  }),
                  onConfirm: async () => {
                    setIsDeletingMessages(true);
                    try {
                      await deleteMessages.mutateAsync({
                        sessionId: activeSessionId,
                        messageIds: Array.from(selectedMessageIds),
                      });
                      setSelectedMessageIds(new Set());
                      setIsCleanupMode(false);
                    } finally {
                      setIsDeletingMessages(false);
                    }
                  },
                });
              }}
              isDeletingMessages={isDeletingMessages}
              onCancel={() => {
                setSelectedMessageIds(new Set());
                setIsCleanupMode(false);
              }}
            />
          )}

          <div
            className={cn(
              'chat-session-workspace-shell flex-1 min-h-0',
              isWorkspacePreviewOpen &&
                workspacePreviewArtifact &&
                'is-preview-open',
              !isRightSidebarOpen && 'is-sidebar-closed'
            )}
          >
            <div className="chat-session-workspace-chat min-h-0 flex-1 flex flex-col">
              <div className="chat-session-content-wrapper flex-1 min-h-0 flex flex-col">
                {/* Messages */}
                <div
                  ref={messagesContainerRef}
                  className="chat-session-messages flex-1 min-h-0 overflow-y-auto p-base pb-[40px] space-y-base"
                >
                  <div className="chat-session-message-column space-y-double">
                    {isLoading && (
                      <div className="text-sm text-low">
                        {t('timeline.loading')}
                      </div>
                    )}
                    {isArchived && !isLoading && (
                      <div className="text-xs text-low border border-border rounded-sm bg-secondary/60 px-base py-half">
                        {t('timeline.archivedReadonly')}
                      </div>
                    )}
                    {compressionWarning && (
                      <div className="chat-session-compression-warning text-xs border border-yellow-500/50 rounded-sm bg-yellow-500/10 px-base py-half flex items-center justify-between">
                        <div className="flex items-center gap-half">
                          <span className="text-yellow-600 dark:text-yellow-400">
                            !
                          </span>
                          <span className="text-yellow-700 dark:text-yellow-300">
                            {compressionWarning.message}
                          </span>
                          <span className="text-yellow-600/80 dark:text-yellow-400/80 ml-1">
                            ({compressionWarning.split_file_path})
                          </span>
                        </div>
                        <button
                          type="button"
                          className="text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200 text-xs"
                          onClick={clearCompressionWarning}
                        >
                          x
                        </button>
                      </div>
                    )}
                    {showEmptyTimelineIndicator && (
                      <ChatEmptyStateIndicator
                        variant={emptyTimelineVariant}
                        onAction={handleOpenAddMemberPanel}
                        onTemplateSelect={
                          emptyTimelineVariant === 'empty-messages'
                            ? handleSelectPromptTemplate
                            : undefined
                        }
                        disabled={isArchived}
                      />
                    )}
                    {!isLoading &&
                      timelineEntries.length > 0 &&
                      trimmedMessageSearchQuery &&
                      filteredTimelineEntries.length === 0 && (
                        <div className="text-sm text-low">
                          {t('timeline.noMatches', {
                            query: messageSearchQuery.trim(),
                          })}
                        </div>
                      )}

                    {filteredTimelineEntries.map((entry) => {
                      if (entry.kind === 'work_item') {
                        return (
                          <ChatWorkItemCard
                            key={entry.key}
                            group={entry.group}
                            senderLabel={getWorkItemSenderLabel(entry.group)}
                            senderRunnerType={
                              agentById.get(entry.group.agentId)?.runner_type ??
                              null
                            }
                          />
                        );
                      }

                      const { message } = entry;
                      const isAgent =
                        message.sender_type === ChatSenderType.agent;
                      const agentName =
                        isAgent && message.sender_id
                          ? (agentById.get(message.sender_id)?.name ?? 'Agent')
                          : null;
                      const diffMeta = isAgent
                        ? extractDiffMeta(message.meta)
                        : null;
                      const diffInfo =
                        diffMeta && diffMeta.runId ? diffMeta : null;
                      const attachments = extractAttachments(message.meta);
                      const mentionList = Array.from(
                        new Set(
                          message.mentions.filter(
                            (mention) => mention.length > 0
                          )
                        )
                      );
                      const mentionStatusMap = mentionStatuses.get(message.id);
                      const referenceId = extractReferenceId(message.meta);
                      const referenceMessage = referenceId
                        ? messageById.get(referenceId)
                        : null;
                      const isUser =
                        message.sender_type === ChatSenderType.user;
                      const toneKey = isUser
                        ? 'user'
                        : (message.sender_id ?? agentName ?? 'agent');
                      const tone = getMessageTone(String(toneKey), isUser);
                      const isSelected = selectedMessageIds.has(message.id);

                      return (
                        <ChatMessageItem
                          key={message.id}
                          message={message}
                          senderLabel={getMessageSenderLabel(message)}
                          senderRunnerType={
                            isAgent && message.sender_id
                              ? (agentById.get(message.sender_id)
                                  ?.runner_type ?? null)
                              : null
                          }
                          tone={tone}
                          referenceMessage={referenceMessage ?? null}
                          referenceSenderLabel={
                            referenceMessage
                              ? getMessageSenderLabel(referenceMessage)
                              : null
                          }
                          referencePreview={
                            referenceMessage
                              ? getReferencePreview(referenceMessage)
                              : null
                          }
                          mentionList={mentionList}
                          mentionStatusMap={mentionStatusMap}
                          mentionErrors={mentionErrors.get(message.id)}
                          agentStates={agentStates}
                          agentIdByName={agentIdByName}
                          attachments={attachments}
                          activeSessionId={activeSessionId}
                          onPreviewAttachment={handlePreviewMessageAttachment}
                          diffInfo={diffInfo}
                          runDiffs={runDiffs}
                          onOpenDiffViewer={(runId, untrackedFiles, hasDiff) =>
                            handleSelectWorkspacePreview({
                              kind: 'diff',
                              runId,
                              sourceLabel: getMessageSenderLabel(message),
                              createdAt: message.created_at,
                              hasDiff,
                              untrackedFiles,
                              previewText: diffInfo?.preview ?? null,
                            })
                          }
                          isArchived={isArchived}
                          onReply={handleLocalReplySelect}
                          isCleanupMode={isCleanupMode}
                          isSelected={isSelected}
                          onToggleSelect={() => {
                            setSelectedMessageIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(message.id)) {
                                next.delete(message.id);
                              } else {
                                next.add(message.id);
                              }
                              return next;
                            });
                          }}
                        />
                      );
                    })}
                    {protocolNotices.map((notice) => {
                      const isEmptyMessageNotice =
                        notice.code === 'empty_message';

                      return (
                        <div
                          key={notice.id}
                          className="chat-session-message-row is-system flex justify-start"
                        >
                          <div className="w-[600px] max-w-full rounded-2xl bg-[#F3F4F6] px-base py-half">
                            <div className="flex items-start justify-between gap-base">
                              <div className="min-w-0 flex-1">
                                <ChatSystemMessage
                                  content={formatProtocolNoticeContent(notice)}
                                  expanded
                                  className={
                                    isEmptyMessageNotice
                                      ? 'text-[#6B7280]'
                                      : 'text-[#4B5563]'
                                  }
                                />
                              </div>
                              <button
                                type="button"
                                className="shrink-0 bg-transparent p-0 text-xs text-[#5094FB] hover:text-[#5094FB]/80"
                                onClick={() => dismissProtocolNotice(notice.id)}
                              >
                                {t('protocolNotice.dismiss')}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {placeholderAgents.map((member) => (
                      <RunningAgentPlaceholder
                        key={`placeholder-${member.agent.id}`}
                        member={member}
                        run={runByAgentId.get(member.agent.id)}
                        tone={getMessageTone(member.agent.id, false)}
                        stateInfo={agentStateInfos[member.agent.id]}
                        clock={clock}
                        isStopping={stoppingAgents.has(member.agent.id)}
                        onStop={handleStopAgent}
                      />
                    ))}

                    <div ref={bottomRef} />
                  </div>
                </div>

                {/* Message Input */}
                <MessageInputArea
                  draft={draft}
                  onDraftChange={handleDraftChange}
                  inputRef={inputRef}
                  selectedMentions={selectedMentions}
                  onSelectedMentionsChange={setSelectedMentions}
                  agentOptions={agentOptionsWithAll}
                  mentionAgentsCount={mentionAgents.length}
                  mentionQuery={mentionQuery}
                  showMentionAllSuggestion={showMentionAllSuggestion}
                  visibleMentionSuggestions={visibleMentionSuggestions}
                  highlightedMentionIndex={highlightedMentionIndex}
                  onMentionSelect={handleMentionSelect}
                  onMentionKeyDown={handleMentionKeyDown}
                  replyToMessage={replyToMessage}
                  replyToSenderLabel={
                    replyToMessage
                      ? getMessageSenderLabel(replyToMessage)
                      : null
                  }
                  replyToPreview={
                    replyToMessage ? getReferencePreview(replyToMessage) : null
                  }
                  onCancelReply={() => setReplyToMessage(null)}
                  attachedFiles={attachedFiles}
                  attachmentError={attachmentError}
                  isUploadingAttachments={isUploadingAttachments}
                  onAttachmentInputChange={handleAttachmentInputChange}
                  onRemoveAttachedFile={removeAttachedFile}
                  onClearAttachedFiles={clearAttachedFiles}
                  onPreviewFile={previewAttachedFile}
                  fileInputRef={fileInputRef}
                  canSend={canSend}
                  isSending={sendMessage.isPending}
                  onSend={handleSend}
                  isArchived={isArchived}
                  activeSessionId={activeSessionId}
                />
              </div>
            </div>

            {isWorkspacePreviewOpen && workspacePreviewArtifact && (
              <WorkspacePreviewPane
                artifact={workspacePreviewArtifact}
                diffState={
                  workspacePreviewArtifact.kind === 'diff'
                    ? runDiffs[workspacePreviewArtifact.runId]
                    : undefined
                }
                title={t('workspacePreview.title')}
                openLabel={t('message.open')}
                viewChangesLabel={t('message.viewChanges')}
                emptyLabel={t('workspacePreview.empty')}
                closeLabel={tCommon('buttons.close')}
                loadingLabel={t('message.loadingDiff')}
                filesLabel={t('workspacePreview.files')}
                addedLabel={t('workspacePreview.added')}
                removedLabel={t('workspacePreview.removed')}
                onClose={() => setIsWorkspacePreviewOpen(false)}
                onOpenDiffModal={handleOpenDiffViewer}
              />
            )}
          </div>
        </section>

        {/* Right Sidebar Resize Handle */}
        {isRightSidebarOpen && (
          <div
            className="chat-session-resize-handle w-1 cursor-col-resize transition-colors shrink-0"
            onMouseDown={(e) => handleResizeStart('right', e)}
          />
        )}

        {!isRightSidebarOpen && activeSessionId && (
          <button
            type="button"
            className="chat-session-right-collapsed-toggle"
            onClick={() => setIsRightSidebarOpen(true)}
            aria-label={t('header.openMembersPanel')}
            title={t('header.openMembersPanel')}
          >
            <UsersThreeIcon className="size-icon-xs" />
            <span>
              {sessionMembers.length} {t('header.aiMembers')}
            </span>
          </button>
        )}

        <div
          className={cn(
            'chat-session-right-drawer-shell shrink-0 min-h-0 overflow-hidden',
            isRightSidebarOpen && 'is-open'
          )}
          style={{ width: isRightSidebarOpen ? rightSidebarWidth : 0 }}
        >
          <AiMembersSidebar
            sessionMembers={sessionMembers}
            agentStates={agentStates}
            activeSessionId={activeSessionId}
            isArchived={isArchived}
            width={rightSidebarWidth}
            isPanelOpen={isRightSidebarOpen}
            onTogglePanel={() => setIsRightSidebarOpen((prev) => !prev)}
            isAddMemberOpen={isAddMemberOpen}
            editingMember={editingMember}
            newMemberName={newMemberName}
            newMemberRunnerType={newMemberRunnerType}
            newMemberVariant={newMemberVariant}
            newMemberPrompt={newMemberPrompt}
            newMemberWorkspace={newMemberWorkspace}
            newMemberSkillIds={newMemberSkillIds}
            memberNameLengthError={memberNameLengthError}
            onNameChange={setNewMemberName}
            onRunnerTypeChange={setNewMemberRunnerType}
            onVariantChange={setNewMemberVariant}
            onPromptChange={setNewMemberPrompt}
            onWorkspaceChange={setNewMemberWorkspace}
            onMemberSkillIdsChange={setNewMemberSkillIds}
            memberError={memberError}
            isSavingMember={isSavingMember}
            availableRunnerTypes={availableRunnerTypes}
            enabledRunnerTypes={enabledRunnerTypes}
            isCheckingAvailability={isCheckingAvailability}
            isRunnerAvailable={isRunnerAvailable}
            availabilityLabel={availabilityLabel}
            memberVariantOptions={memberVariantOptions}
            getModelName={getModelName}
            getModelDisplayName={getModelDisplayName}
            getVariantLabel={getVariantLabel}
            getVariantOptions={getVariantOptions}
            onOpenAddMember={handleOpenAddMemberPanel}
            onCancelMember={() => {
              setIsAddMemberOpen(false);
              setMemberError(null);
              setEditingMember(null);
              setNewMemberVariant('DEFAULT');
              setNewMemberSkillIds([]);
              setEditingMemberInitialSkillIds([]);
              setIsPromptEditorOpen(false);
              setPromptFileError(null);
            }}
            onSaveMember={handleAddMember}
            onEditMember={handleEditMember}
            onRemoveMember={handleRemoveMember}
            onOpenWorkspace={(agentId) => {
              setWorkspaceAgentId(agentId);
              setWorkspaceDrawerOpen(true);
            }}
            onExpandPromptEditor={() => {
              setIsPromptEditorOpen(true);
              setPromptFileError(null);
            }}
            enabledMemberPresets={enabledMemberPresets}
            enabledTeamPresets={enabledTeamPresets}
            onAddMemberPreset={handleAddMemberPreset}
            onImportTeamPreset={handleImportTeamPreset}
            teamImportPlan={teamImportPlan}
            teamImportName={teamImportName}
            teamImportProtocol={teamImportProtocol}
            teamProtocolRefreshToken={teamProtocolRefreshToken}
            isImportingTeam={isImportingTeam}
            onUpdateTeamImportPlanEntry={handleUpdateTeamImportPlanEntry}
            onConfirmTeamImport={handleConfirmTeamImport}
            onCancelTeamImport={handleCancelTeamImport}
          />
        </div>
      </div>

      <SkillsPanel
        isOpen={isSkillsPanelOpen}
        leftOffset={skillsPanelLeftOffset}
        availableRunnerTypes={enabledRunnerTypes}
        onClose={() => setIsSkillsPanelOpen(false)}
      />

      <AiTeamPresetsModal
        isOpen={isAiTeamPresetsOpen}
        onClose={() => setIsAiTeamPresetsOpen(false)}
      />

      {/* Workspace Drawer */}
      <WorkspaceDrawer
        isOpen={workspaceDrawerOpen}
        onClose={() => setWorkspaceDrawerOpen(false)}
        agent={activeWorkspaceAgent ?? null}
        workspacePath={workspacePath}
        runs={activeWorkspaceRuns}
        messages={messagesData}
        logRunId={logRunId}
        logContent={logContent}
        logLoading={logLoading}
        logError={logError}
        onLoadLog={handleLoadLog}
      />

      {/* Diff Viewer Modal */}
      <DiffViewerModal
        isOpen={diffViewerOpen}
        runId={diffViewerRunId}
        hasDiff={diffViewerHasDiff}
        isFullscreen={diffViewerFullscreen}
        runDiff={diffViewerRun}
        untrackedFiles={diffViewerUntracked}
        untrackedContent={untrackedContent}
        theme={actualTheme}
        onClose={handleCloseDiffViewer}
        onToggleFullscreen={handleToggleFullscreen}
        onToggleUntracked={handleToggleUntracked}
      />

      {/* Prompt Editor Modal */}
      <PromptEditorModal
        isOpen={isPromptEditorOpen}
        value={newMemberPrompt}
        onChange={setNewMemberPrompt}
        onClose={() => setIsPromptEditorOpen(false)}
        promptFileInputRef={promptFileInputRef}
        onPromptFileChange={handlePromptFileChange}
        promptFileLoading={promptFileLoading}
        promptFileError={promptFileError}
      />

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmModal}
        title={confirmModal?.title ?? t('modals.confirm.defaultTitle')}
        message={confirmModal?.message ?? ''}
        isLoading={isConfirmLoading}
        mode={confirmModal?.mode}
        confirmText={confirmModal?.confirmText}
        cancelText={confirmModal?.cancelText}
        onConfirm={async () => {
          if (!confirmModal) return;
          setIsConfirmLoading(true);
          try {
            await confirmModal.onConfirm();
          } finally {
            setIsConfirmLoading(false);
            setConfirmModal(null);
          }
        }}
        onCancel={() => setConfirmModal(null)}
      />

      {/* File Preview Modal */}
      <FilePreviewModal
        file={previewFile.file}
        content={previewFile.content}
        onClose={closePreview}
      />
    </div>
  );
}
