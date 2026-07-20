import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  useLayoutEffect,
} from "react";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useAppScale } from "@/context/AppScaleContext";
import {
  Plus,
  Check,
  GitBranch,
  PanelRightClose,
  PanelRightOpen,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Quote,
  Square,
  X,
  Image as ImageIcon,
  FileText,
} from "lucide-react";
import { ResourceStateNotice } from "@/components/ResourceState";
import { ScrollArea } from "@/components/ScrollArea";
import { AgentMessageContent } from "@/components/AgentMessageContent";
import { SessionSourceControlPanel } from "@/components/source-control/SessionSourceControlPanel";
import {
  useCommandHandler,
  useShortcutScope,
} from "@/shortcuts/ShortcutProvider";
import {
  chatMessagesApi,
  chatRunsApi,
  sessionAgentsApi,
  projectWorkItemsApi,
} from "@/lib/api";
import {
  flattenRunFileChanges,
  type AgentFileRow,
} from "@/lib/agentFileRows";
import {
  ISSUE_NAVIGATION_EVENT,
  type IssueNavigationTarget,
} from "@/lib/issueNavigation";
import {
  LINKED_WORK_ITEMS_CHANGED_EVENT,
  type LinkedWorkItemsChangedDetail,
} from "@/lib/linkedWorkItemsEvents";
import {
  isLinkedWorkItemStatusMenuTarget,
  toggleLinkedWorkItemStatusMenuTarget,
  type LinkedWorkItemStatusMenuTarget,
} from "@/lib/linkedWorkItemStatusMenu";
import {
  SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
  type SourceControlRefreshRequestedDetail,
} from "@/lib/sourceControlEvents";
import { markPendingIssueStatusSync } from "@/lib/pendingIssueStatusSync";
import { notifyBuildStatsUsageUpdated } from "@/lib/buildStatsEvents";
import { requestTeamMemberInviteNavigation } from "@/lib/teamNavigation";
import { openInSystemFileManager } from "@/lib/systemFileManager";
import {
  flattenWorkspaceChanges,
  hasRelatedFileDiff,
  type RelatedFileChange,
} from "@/lib/sessionWorkspaceChanges";
import { openFileInVSCode } from "@/vscode/bridge";
import { normalizeArtifactPath } from "@/lib/parseStructuredReply";
import {
  ChatComposer,
  type ChatComposerSubmit,
  type ChatComposerSubmitResult,
} from "@/components/chat/ChatComposer";
import {
  formatFileSize,
  isImageChatAttachment,
} from "@/components/chat/chatAttachmentUtils";
import type {
  Message,
  ProjectWorkItem,
  QuotedMessageReference,
  QueuedMessageListItem,
  SourceControlDiffArea,
} from "@/types";
import {
  isOpenteamsPath,
  RELATED_FILES_DEFAULT_WIDTH,
  RELATED_FILES_MIN_WIDTH,
  RELATED_FILES_MAX_WIDTH,
  CHAT_SCROLL_BOTTOM_THRESHOLD_PX,
  RELATED_FILES_MIN_CENTER_WIDTH,
  RELATED_FILES_SEPARATOR_WIDTH,
  getVisibleSidebarMemberCount,
  extractMentionHandles,
  routeMentionsForText,
  normalizeMentionHandle,
  displayChatSenderName,
  SessionMemberAvatar,
  LinkedWorkItemRow,
  InlineQueueGroup,
  RelatedFilesContent,
} from '@/components/free-chat/FreeChatWorkspaceParts';
interface FreeChatWorkspaceProps {
  embedded?: boolean;
  onOpenDiffTab?: (
    sessionId: string,
    filePath: string,
    status: string,
    unifiedDiff: string,
    runId?: string,
  ) => void;
  onOpenSourceControlDiffTab?: (
    projectId: string,
    sessionId: string,
    filePath: string,
    area: SourceControlDiffArea,
  ) => void;
  onOpenWorktreeConflictTab?: (projectId: string, sessionId: string) => void;
}

type AttachmentImagePreview = {
  url: string;
  name: string;
  sizeBytes?: number;
};

export const FreeChatWorkspace: React.FC<FreeChatWorkspaceProps> = ({
  embedded = false,
  onOpenDiffTab,
  onOpenSourceControlDiffTab,
  onOpenWorktreeConflictTab,
}) => {
  const appScale = useAppScale();
  const {
    t,
    activeSessionId,
    messages,
    memberQueuesBySessionAgentId,
    queuedUserMessagesById,
    sendMessage,
    members,
    locale,
    chatInputMode,
    setChatInputMode,
    ensureWorkflowRouteToMainAgent,
    mainAgentName,
    showToast,
    sessionsAsync,
    refreshSessions,
    messagesAsync,
    refreshMessages,
    markSessionAgentStopped,
    membersAsync,
    refreshMembers,
    chatMessageFontSize,
    workspaceChangesAsync,
    refreshWorkspaceChanges,
    resetWorkspaceChanges,
    deleteQueuedMessage,
    continueMemberQueue,
    projects,
    selectedProjectId,
  } = useWorkspace();

  const [isRelatedFilesOpen, setIsRelatedFilesOpen] = useState(true);
  const [wasRelatedFilesAutoCollapsed, setWasRelatedFilesAutoCollapsed] =
    useState(false);
  const [isMemberRailExpanded, setIsMemberRailExpanded] = useState(false);
  const [selectedSidebarMemberId, setSelectedSidebarMemberId] = useState<
    string | null
  >(null);
  const [memberRailWidth, setMemberRailWidth] = useState(0);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [stoppingSessionAgentIds, setStoppingSessionAgentIds] = useState<
    Record<string, string | null>
  >({});
  const [quotedMessage, setQuotedMessage] =
    useState<QuotedMessageReference | null>(null);
  const [composerFocusRequestKey, setComposerFocusRequestKey] = useState(0);
  const [attachmentImagePreview, setAttachmentImagePreview] =
    useState<AttachmentImagePreview | null>(null);
  const [relatedFilesWidth, setRelatedFilesWidth] = useState(
    RELATED_FILES_DEFAULT_WIDTH,
  );
  const [sourceControlFocusRequestKey, setSourceControlFocusRequestKey] =
    useState(0);
  const [commitMessageFocusRequestKey, setCommitMessageFocusRequestKey] =
    useState(0);
  const [linkedWorkItems, setLinkedWorkItems] = useState<ProjectWorkItem[]>([]);
  const [
    linkedWorkItemStatusMenuTarget,
    setLinkedWorkItemStatusMenuTarget,
  ] = useState<LinkedWorkItemStatusMenuTarget>(null);
  const [linkedWorkItemsLoading, setLinkedWorkItemsLoading] = useState(false);
  const [linkedWorkItemsError, setLinkedWorkItemsError] = useState<
    string | null
  >(null);
  const [updatingLinkedWorkItemIds, setUpdatingLinkedWorkItemIds] = useState<
    Set<string>
  >(() => new Set());
  const [queueActionIds, setQueueActionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const workspaceGridRef = useRef<HTMLDivElement>(null);
  const workspaceRootRef = useRef<HTMLDivElement>(null);
  const chatMessagesScrollRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const memberRailRef = useRef<HTMLDivElement>(null);
  const copiedResetTimerRef = useRef<number | null>(null);
  const linkedWorkItemsRequestIdRef = useRef(0);
  const chatAutoFollowRef = useRef(true);
  const previousActiveSessionIdRef = useRef<string | null>(null);
  const relatedFileChanges = useMemo(
    () => flattenWorkspaceChanges(workspaceChangesAsync.data),
    [workspaceChangesAsync.data],
  );
  const currentProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );
  const currentWorkspacePath =
    currentProject?.default_workspace_path ?? undefined;
  const usesProjectSourceControl = Boolean(selectedProjectId && activeSessionId);
  const sidebarMembers = members;
  const visibleSidebarMemberCount = getVisibleSidebarMemberCount(
    sidebarMembers.length,
    memberRailWidth,
  );
  const hasSidebarMemberOverflow =
    visibleSidebarMemberCount < sidebarMembers.length;
  const selectedSidebarMember = selectedSidebarMemberId
    ? sidebarMembers.find((member) => member.id === selectedSidebarMemberId)
    : undefined;
  const displayedSidebarMembers = isMemberRailExpanded
    ? sidebarMembers
    : sidebarMembers.slice(0, visibleSidebarMemberCount);
  const memberMentionHandles = new Set(
    sidebarMembers.map((member) => normalizeMentionHandle(member.name)),
  );
  const mainAgentHandle =
    mainAgentName ?? sidebarMembers[0]?.name ?? "@agent";
  const normalizedMainAgentHandle = normalizeMentionHandle(mainAgentHandle);
  const displayedMessages = selectedSidebarMember
    ? messages.filter((message) => {
        if (!message.isUser) {
          return message.sessionAgentId
            ? message.sessionAgentId === selectedSidebarMember.id
            : message.sender === selectedSidebarMember.name;
        }

        const matchedMemberMentions = extractMentionHandles(
          message.text,
        )
          .concat((message.mentions ?? []).map(normalizeMentionHandle))
          .filter((mention) => memberMentionHandles.has(mention));
        if (matchedMemberMentions.length === 0) {
          return (
            normalizeMentionHandle(selectedSidebarMember.name) ===
            normalizedMainAgentHandle
          );
        }

        return matchedMemberMentions.includes(
          normalizeMentionHandle(selectedSidebarMember.name),
        );
      })
    : messages;
  const workflowCardMessageIds = useMemo(
    () =>
      messages
        .filter((message) => message.workflowCard)
        .map((message) => message.id),
    [messages],
  );
  const [unfinishedWorkflowCardMessageId, setUnfinishedWorkflowCardMessageId] =
    useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const findLatestUnfinishedWorkflowCard = async () => {
      const projections = await Promise.all(
        workflowCardMessageIds.map(async (messageId) => {
          try {
            const projection = await chatMessagesApi.getWorkflowCard(
              messageId,
              "summary",
            );
            return projection.is_terminal ? null : messageId;
          } catch {
            return null;
          }
        }),
      );
      if (!cancelled) {
        setUnfinishedWorkflowCardMessageId(
          projections.slice().reverse().find((messageId) => messageId !== null) ??
            null,
        );
      }
    };

    void findLatestUnfinishedWorkflowCard();
    if (workflowCardMessageIds.length === 0) return () => {
      cancelled = true;
    };

    const intervalId = window.setInterval(
      findLatestUnfinishedWorkflowCard,
      5_000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeSessionId, workflowCardMessageIds]);

  const jumpToUnfinishedWorkflowCard = useCallback(() => {
    if (!unfinishedWorkflowCardMessageId) return;
    chatAutoFollowRef.current = false;
    const scrollToCard = () =>
      document
        .getElementById(`chat-message-${unfinishedWorkflowCardMessageId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });

    if (selectedSidebarMemberId) {
      setSelectedSidebarMemberId(null);
      window.requestAnimationFrame(scrollToCard);
      return;
    }
    scrollToCard();
  }, [selectedSidebarMemberId, unfinishedWorkflowCardMessageId]);

  const messagesById = useMemo(
    () =>
      new Map([
        ...messages.map((message) => [message.id, message] as const),
        ...Object.entries(queuedUserMessagesById),
      ]),
    [queuedUserMessagesById, messages],
  );
  const visibleQueueGroups = useMemo(
    () =>
      Object.values(memberQueuesBySessionAgentId)
        .filter((queue) => queue.session_id === activeSessionId)
        .map((queue) => {
          const queuedQueueItems = queue.items.filter(
            (item) =>
              item.message.session_id === activeSessionId &&
              String(item.message.status) === "queued",
          );
          return {
            queue,
            items: queuedQueueItems,
          };
        })
        .filter((group) => group.items.length > 0),
    [activeSessionId, memberQueuesBySessionAgentId],
  );
  const queueGroupsBySessionAgentId = useMemo(
    () =>
      new Map(
        visibleQueueGroups.map((group) => [
          group.queue.session_agent_id,
          group,
        ]),
      ),
    [visibleQueueGroups],
  );
  const queueAnchorMessageIds = useMemo(() => {
    const anchors = new Map<string, string>();
    const runningAnchors = new Set<string>();
    for (const message of displayedMessages) {
      const sessionAgentId = message.sessionAgentId;
      if (
        message.isUser ||
        !sessionAgentId ||
        !queueGroupsBySessionAgentId.has(sessionAgentId)
      ) {
        continue;
      }
      if (message.isAgentRunning) {
        anchors.set(sessionAgentId, message.id);
        runningAnchors.add(sessionAgentId);
        continue;
      }
      if (!runningAnchors.has(sessionAgentId)) {
        anchors.set(sessionAgentId, message.id);
      }
    }
    return anchors;
  }, [displayedMessages, queueGroupsBySessionAgentId]);
  const canFitRelatedFiles =
    workspaceWidth === 0 ||
    workspaceWidth >=
      RELATED_FILES_MIN_CENTER_WIDTH +
        RELATED_FILES_SEPARATOR_WIDTH +
        RELATED_FILES_MIN_WIDTH;
  const relatedFilesMaxAvailableWidth =
    workspaceWidth > 0
      ? Math.min(
          RELATED_FILES_MAX_WIDTH,
          Math.max(
            RELATED_FILES_MIN_WIDTH,
            workspaceWidth -
              RELATED_FILES_SEPARATOR_WIDTH -
              RELATED_FILES_MIN_CENTER_WIDTH,
          ),
        )
      : RELATED_FILES_DEFAULT_WIDTH;
  const effectiveRelatedFilesWidth = Math.min(
    relatedFilesWidth,
    relatedFilesMaxAvailableWidth,
  );
  const isStopPendingForMessage = (
    sessionAgentId?: string,
    runId?: string,
  ): boolean => {
    if (!sessionAgentId) return false;
    if (
      !Object.prototype.hasOwnProperty.call(
        stoppingSessionAgentIds,
        sessionAgentId,
      )
    ) {
      return false;
    }
    const stoppedRunId = stoppingSessionAgentIds[sessionAgentId];
    return !stoppedRunId || !runId || stoppedRunId === runId;
  };

  useEffect(() => {
    setStoppingSessionAgentIds((current) => {
      const entries = Object.entries(current).filter(
        ([sessionAgentId, stoppedRunId]) =>
          messages.some(
            (message) =>
              message.isAgentRunning &&
              message.sessionAgentId === sessionAgentId &&
              (!stoppedRunId ||
                !message.runId ||
                message.runId === stoppedRunId),
          ),
      );

      if (entries.length === Object.keys(current).length) return current;
      return Object.fromEntries(entries);
    });
  }, [messages]);

  useEffect(() => {
    setAttachmentImagePreview(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (!attachmentImagePreview) return;

    const handlePreviewKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAttachmentImagePreview(null);
      }
    };

    document.addEventListener("keydown", handlePreviewKeyDown);
    return () => document.removeEventListener("keydown", handlePreviewKeyDown);
  }, [attachmentImagePreview]);

  const openRelatedFiles = () => {
    setWasRelatedFilesAutoCollapsed(false);
    setIsRelatedFilesOpen(true);
  };

  const closeRelatedFiles = () => {
    setWasRelatedFilesAutoCollapsed(false);
    setIsRelatedFilesOpen(false);
  };

  useShortcutScope('session-workspace', {
    active: Boolean(activeSessionId),
    rootRef: workspaceRootRef,
  });
  useCommandHandler('sidebar.right.toggle', {
    scope: "page",
    enabled: Boolean(activeSessionId),
    execute: () => {
      if (isRelatedFilesOpen) closeRelatedFiles();
      else openRelatedFiles();
    },
  });
  useCommandHandler('source-control.open', {
    scope: "global",
    enabled: Boolean(activeSessionId && selectedProjectId),
    disabledReason:
      activeSessionId && selectedProjectId
        ? undefined
        : t("shortcuts.reason.selectProject"),
    execute: () => {
      openRelatedFiles();
      setSourceControlFocusRequestKey((value) => value + 1);
    },
  });
  useCommandHandler('source-control.commit-message.focus', {
    scope: "page",
    enabled: Boolean(activeSessionId && selectedProjectId),
    disabledReason:
      activeSessionId && selectedProjectId
        ? undefined
        : t("shortcuts.reason.selectProject"),
    execute: () => {
      openRelatedFiles();
      setCommitMessageFocusRequestKey((value) => value + 1);
    },
  });
  const handleLinkedWorkItemStatusMenuOpenChange = useCallback(
    (itemId: string, open: boolean) => {
      setLinkedWorkItemStatusMenuTarget((current) => {
        if (open && activeSessionId) {
          return { sessionId: activeSessionId, itemId };
        }
        return activeSessionId &&
          isLinkedWorkItemStatusMenuTarget(current, activeSessionId, itemId)
          ? null
          : current;
      });
    },
    [activeSessionId],
  );
  useCommandHandler('session.linked-issue.status.open', {
    scope: "page",
    enabled: Boolean(
      activeSessionId &&
        !linkedWorkItemsLoading &&
        linkedWorkItems.length > 0 &&
        !updatingLinkedWorkItemIds.has(linkedWorkItems[0].id),
    ),
    execute: () => {
      const itemId = linkedWorkItems[0]?.id;
      if (!activeSessionId || !itemId) return;
      setLinkedWorkItemStatusMenuTarget((current) =>
        toggleLinkedWorkItemStatusMenuTarget(
          current,
          activeSessionId,
          itemId,
        ),
      );
    },
  });

  useEffect(() => {
    setLinkedWorkItemStatusMenuTarget(null);
  }, [activeSessionId]);

  useEffect(() => {
    const handleSourceControlRefreshRequested = (event: Event) => {
      const detail = (
        event as CustomEvent<SourceControlRefreshRequestedDetail>
      ).detail;
      if (!detail?.sessionId || detail.sessionId !== activeSessionId) return;
      if (
        detail.projectId &&
        selectedProjectId &&
        detail.projectId !== selectedProjectId
      ) {
        return;
      }
      setWasRelatedFilesAutoCollapsed(false);
      setIsRelatedFilesOpen(true);
    };

    window.addEventListener(
      SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
      handleSourceControlRefreshRequested,
    );
    return () =>
      window.removeEventListener(
        SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
        handleSourceControlRefreshRequested,
      );
  }, [activeSessionId, selectedProjectId]);

  useLayoutEffect(() => {
    const element = workspaceGridRef.current;
    if (!element) return;

    const updateWorkspaceWidth = () => setWorkspaceWidth(element.clientWidth);
    updateWorkspaceWidth();
    const frameId =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(updateWorkspaceWidth)
        : undefined;

    const cancelMeasureFrame = () => {
      if (
        frameId !== undefined &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(frameId);
      }
    };

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWorkspaceWidth);
      return () => {
        cancelMeasureFrame();
        window.removeEventListener("resize", updateWorkspaceWidth);
      };
    }

    const observer = new ResizeObserver(updateWorkspaceWidth);
    observer.observe(element);
    return () => {
      cancelMeasureFrame();
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (workspaceWidth === 0) return;

    if (!canFitRelatedFiles) {
      if (isRelatedFilesOpen) {
        setIsRelatedFilesOpen(false);
      }
      setWasRelatedFilesAutoCollapsed(true);
      return;
    }

    if (wasRelatedFilesAutoCollapsed) {
      if (!isRelatedFilesOpen) {
        setIsRelatedFilesOpen(true);
      }
      setWasRelatedFilesAutoCollapsed(false);
    }
  }, [
    canFitRelatedFiles,
    isRelatedFilesOpen,
    wasRelatedFilesAutoCollapsed,
    workspaceWidth,
  ]);

  useLayoutEffect(() => {
    if (!isRelatedFilesOpen) return;

    const element = memberRailRef.current;
    if (!element) return;

    const updateWidth = () => setMemberRailWidth(element.clientWidth);
    updateWidth();
    const frameId =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(updateWidth)
        : undefined;

    const cancelMeasureFrame = () => {
      if (
        frameId !== undefined &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(frameId);
      }
    };

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => {
        cancelMeasureFrame();
        window.removeEventListener("resize", updateWidth);
      };
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => {
      cancelMeasureFrame();
      observer.disconnect();
    };
  }, [isRelatedFilesOpen]);

  useEffect(() => {
    if (!hasSidebarMemberOverflow && isMemberRailExpanded) {
      setIsMemberRailExpanded(false);
    }
  }, [hasSidebarMemberOverflow, isMemberRailExpanded]);

  useEffect(() => {
    if (
      selectedSidebarMemberId &&
      !sidebarMembers.some((member) => member.id === selectedSidebarMemberId)
    ) {
      setSelectedSidebarMemberId(null);
    }
  }, [selectedSidebarMemberId, sidebarMembers]);

  const isChatScrolledToBottom = useCallback(() => {
    const element = chatMessagesScrollRef.current;
    if (!element) return true;

    return (
      element.scrollHeight - element.scrollTop - element.clientHeight <=
      CHAT_SCROLL_BOTTOM_THRESHOLD_PX
    );
  }, []);

  const scrollChatToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, []);

  const handleChatScroll = useCallback(() => {
    chatAutoFollowRef.current = isChatScrolledToBottom();
  }, [isChatScrolledToBottom]);

  const handleChatWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (event.deltaY < 0) {
        chatAutoFollowRef.current = false;
        return;
      }

      if (isChatScrolledToBottom()) {
        chatAutoFollowRef.current = true;
      }
    },
    [isChatScrolledToBottom],
  );

  // Keep the latest message anchored before paint when the user is already at
  // the bottom. If they scroll up during agent output, preserve that position.
  useLayoutEffect(() => {
    const sessionChanged =
      previousActiveSessionIdRef.current !== activeSessionId;
    previousActiveSessionIdRef.current = activeSessionId;

    if (sessionChanged) {
      chatAutoFollowRef.current = true;
      scrollChatToBottom();
      return;
    }

    if (chatAutoFollowRef.current) {
      scrollChatToBottom();
    }
  }, [activeSessionId, messages, scrollChatToBottom]);

  useEffect(
    () => () => {
      if (copiedResetTimerRef.current !== null) {
        window.clearTimeout(copiedResetTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setCopiedMessageId(null);
    setQuotedMessage(null);
    setSelectedSidebarMemberId(null);
    setStoppingSessionAgentIds({});
  }, [activeSessionId]);

  const reloadRelatedFiles = useCallback(() => {
    if (!activeSessionId) {
      resetWorkspaceChanges();
      return;
    }
    if (selectedProjectId) {
      resetWorkspaceChanges();
      return;
    }
    const workspacePath = currentWorkspacePath;
    if (!workspacePath) {
      resetWorkspaceChanges();
      return;
    }
    void refreshWorkspaceChanges(activeSessionId, workspacePath, true);
  }, [
    activeSessionId,
    currentWorkspacePath,
    refreshWorkspaceChanges,
    resetWorkspaceChanges,
    selectedProjectId,
  ]);

  useEffect(() => {
    reloadRelatedFiles();
  }, [reloadRelatedFiles]);

  useEffect(() => {
    const handleSourceControlRefresh = (event: Event) => {
      const detail = (
        event as CustomEvent<SourceControlRefreshRequestedDetail>
      ).detail;
      if (!detail || detail.sessionId !== activeSessionId) return;
      if (detail.projectId && detail.projectId !== selectedProjectId) return;
      if (usesProjectSourceControl) return;
      reloadRelatedFiles();
    };

    window.addEventListener(
      SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
      handleSourceControlRefresh,
    );
    return () => {
      window.removeEventListener(
        SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
        handleSourceControlRefresh,
      );
    };
  }, [
    activeSessionId,
    reloadRelatedFiles,
    selectedProjectId,
    usesProjectSourceControl,
  ]);

  const reloadLinkedWorkItems = useCallback(() => {
    if (!activeSessionId || !selectedProjectId) {
      linkedWorkItemsRequestIdRef.current += 1;
      setLinkedWorkItems([]);
      setLinkedWorkItemsError(null);
      setLinkedWorkItemsLoading(false);
      return;
    }

    const requestId = linkedWorkItemsRequestIdRef.current + 1;
    linkedWorkItemsRequestIdRef.current = requestId;
    setLinkedWorkItemsLoading(true);
    setLinkedWorkItemsError(null);
    projectWorkItemsApi
      .listBySession(selectedProjectId, activeSessionId)
      .then((items) => {
        if (linkedWorkItemsRequestIdRef.current !== requestId) return;
        setLinkedWorkItems(items);
        setLinkedWorkItemsLoading(false);
      })
      .catch((err) => {
        if (linkedWorkItemsRequestIdRef.current !== requestId) return;
        setLinkedWorkItemsError(
          err instanceof Error ? err.message : String(err),
        );
        setLinkedWorkItemsLoading(false);
      });
  }, [activeSessionId, selectedProjectId]);

  useEffect(() => {
    reloadLinkedWorkItems();
  }, [reloadLinkedWorkItems]);

  useEffect(() => {
    if (!activeSessionId || !selectedProjectId) return;

    const handleLinkedWorkItemsChanged = (event: Event) => {
      const detail = (event as CustomEvent<LinkedWorkItemsChangedDetail>)
        .detail;
      if (
        !detail ||
        detail.projectId !== selectedProjectId ||
        detail.sessionId !== activeSessionId
      ) {
        return;
      }

      reloadLinkedWorkItems();
    };

    window.addEventListener(
      LINKED_WORK_ITEMS_CHANGED_EVENT,
      handleLinkedWorkItemsChanged,
    );
    return () => {
      window.removeEventListener(
        LINKED_WORK_ITEMS_CHANGED_EVENT,
        handleLinkedWorkItemsChanged,
      );
    };
  }, [activeSessionId, reloadLinkedWorkItems, selectedProjectId]);

  const handleOpenLinkedWorkItem = (item: ProjectWorkItem) => {
    if (!selectedProjectId) return;

    const target: IssueNavigationTarget = {
      projectId: selectedProjectId,
      workItemId: item.id,
    };

    window.dispatchEvent(
      new CustomEvent<IssueNavigationTarget>(ISSUE_NAVIGATION_EVENT, {
        detail: target,
      }),
    );
  };

  const handleLinkedWorkItemStatusChange = async (
    item: ProjectWorkItem,
    status: ProjectWorkItem["status"],
  ) => {
    if (!selectedProjectId || item.status === status) return;

    const optimisticItem = { ...item, status };
    setUpdatingLinkedWorkItemIds((current) => {
      const next = new Set(current);
      next.add(item.id);
      return next;
    });
    setLinkedWorkItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id ? optimisticItem : candidate,
      ),
    );

    try {
      const updated = await projectWorkItemsApi.update(
        selectedProjectId,
        item.id,
        { status },
      );
      setLinkedWorkItems((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
      );
      markPendingIssueStatusSync(selectedProjectId, updated.id, updated.status);
      notifyBuildStatsUsageUpdated(selectedProjectId);
      showToast(t("linkedWorkItems.statusUpdated"));
    } catch {
      setLinkedWorkItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? item : candidate,
        ),
      );
      showToast(t("linkedWorkItems.statusUpdateError"));
    } finally {
      setUpdatingLinkedWorkItemIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const summarizeMessage = (text: string) => {
    const normalized = text.trim().replace(/\s+/g, " ");
    if (!normalized) return t("message.quoteEmpty");
    return normalized.length > 140
      ? `${normalized.slice(0, 137)}...`
      : normalized;
  };

  const summarizeQueuedMessage = (item: QueuedMessageListItem) => {
    const source =
      messagesById.get(item.message.chat_message_id) ??
      messagesById.get(item.message.id);
    return summarizeMessage(source?.text ?? "");
  };

  const setQueueActionPending = (id: string, pending: boolean) => {
    setQueueActionIds((current) => {
      const next = new Set(current);
      if (pending) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleDeleteQueuedMessage = async (
    sessionId: string,
    queueId: string,
  ) => {
    if (queueActionIds.has(queueId)) return;
    setQueueActionPending(queueId, true);
    try {
      await deleteQueuedMessage(sessionId, queueId);
    } catch {
      showToast("删除排队消息失败");
    } finally {
      setQueueActionPending(queueId, false);
    }
  };

  const handleContinueMemberQueue = async (
    sessionId: string,
    sessionAgentId: string,
  ) => {
    const actionId = `continue-${sessionAgentId}`;
    if (queueActionIds.has(actionId)) return;
    setQueueActionPending(actionId, true);
    try {
      await continueMemberQueue(sessionId, sessionAgentId);
    } catch {
      showToast("继续执行队列失败");
    } finally {
      setQueueActionPending(actionId, false);
    }
  };

  const handleJumpToMessage = useCallback(
    (messageId: string) => {
      chatAutoFollowRef.current = false;
      const scrollToMessage = () =>
        document
          .getElementById(`chat-message-${messageId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });

      if (selectedSidebarMemberId) {
        setSelectedSidebarMemberId(null);
        window.requestAnimationFrame(scrollToMessage);
        return;
      }
      scrollToMessage();
    },
    [selectedSidebarMemberId],
  );

  const handleCopyAgentMessage = async (messageId: string, text: string) => {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API unavailable");
      }

      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);

      if (copiedResetTimerRef.current !== null) {
        window.clearTimeout(copiedResetTimerRef.current);
      }

      copiedResetTimerRef.current = window.setTimeout(() => {
        setCopiedMessageId((current) =>
          current === messageId ? null : current,
        );
        copiedResetTimerRef.current = null;
      }, 1400);
    } catch {
      showToast(t("message.copyFailed"));
    }
  };

  const handleQuoteAgentMessage = (
    messageId: string,
    sender: string,
    text: string,
  ) => {
    setQuotedMessage({
      id: messageId,
      sender,
      content: text,
      summary: summarizeMessage(text),
    });
    setComposerFocusRequestKey((key) => key + 1);
  };

  const handleStopAgentMessage = async (
    sessionAgentId: string,
    runId?: string,
  ) => {
    if (isStopPendingForMessage(sessionAgentId, runId)) return;

    setStoppingSessionAgentIds((current) => {
      return {
        ...current,
        [sessionAgentId]: runId ?? null,
      };
    });

    try {
      await sessionAgentsApi.stop(activeSessionId, sessionAgentId);
      markSessionAgentStopped(sessionAgentId);
      showToast(t("agent.stopRequested"));
      void refreshMembers();
    } catch {
      setStoppingSessionAgentIds((current) => {
        if (current[sessionAgentId] !== (runId ?? null)) return current;
        const next = { ...current };
        delete next[sessionAgentId];
        return next;
      });
      void refreshMessages();
      void refreshMembers();
      showToast(t("agent.stopFailed"));
    }
  };

  const handleComposerSubmit = useCallback(
    async (
      payload: ChatComposerSubmit,
    ): Promise<ChatComposerSubmitResult> => {
      if (payload.sessionId !== activeSessionId) return "rejected";
      chatAutoFollowRef.current = true;

      if (payload.files.length === 0) {
        if (payload.quotedMessageId !== quotedMessage?.id) return "rejected";
        sendMessage(payload.text, {
          chatInputMode: payload.inputMode,
          ...(quotedMessage ? { quotedMessage } : {}),
        });
        return "accepted";
      }

      if (sessionsAsync.source !== "api") {
        showToast(t("attachment.requiresApi"));
        return "rejected";
      }

      try {
        if (payload.inputMode === "workflow") {
          await ensureWorkflowRouteToMainAgent();
        }
        const explicitMentions = routeMentionsForText(payload.text);
        const mainRoute = mainAgentName
          ? mainAgentName.trim().replace(/^@/, "")
          : null;
        await chatMessagesApi.uploadAttachment(
          activeSessionId,
          payload.files,
          {
            chatInputMode: payload.inputMode,
            content: payload.text.trim() ? payload.text : undefined,
            appLanguage: locale,
            referenceMessageId: payload.quotedMessageId,
            mentions:
              explicitMentions.length > 0
                ? explicitMentions
                : payload.inputMode !== "workflow" && mainRoute
                  ? [mainRoute]
                  : undefined,
          },
        );
        await refreshMessages();
        return "accepted";
      } catch {
        showToast(t("attachment.uploadFailed"));
        return "rejected";
      }
    },
    [
      activeSessionId,
      ensureWorkflowRouteToMainAgent,
      locale,
      mainAgentName,
      quotedMessage,
      refreshMessages,
      sendMessage,
      sessionsAsync.source,
      showToast,
      t,
    ],
  );

  const handleCancelQuote = useCallback(() => setQuotedMessage(null), []);
  const handleRetryComposerMembers = useCallback(
    () => void refreshMembers(),
    [refreshMembers],
  );

  const handleRelatedFileClick = (file: RelatedFileChange) => {
    if (hasRelatedFileDiff(file) && onOpenDiffTab) {
      onOpenDiffTab(
        activeSessionId,
        file.path,
        file.status,
        file.unified_diff ?? "",
      );
      return;
    }

    openFileInVSCode(file.path, { openAsDiff: false });
    showToast(t("relatedFiles.noDiffOpenFile"));
  };

  const openArtifactInExplorer = useCallback(
    (path: string, workspacePath?: string | null) => {
      void openInSystemFileManager(
        path,
        workspacePath ?? currentWorkspacePath,
        activeSessionId,
      )
        .then((response) => {
          if (!response.ok) {
            showToast(response.error ?? "Failed to open in Explorer");
          }
        })
        .catch((error) => {
          showToast(
            error instanceof Error
              ? error.message
              : "Failed to open in Explorer",
          );
        });
    },
    [activeSessionId, currentWorkspacePath, showToast],
  );

  const handleOpenArtifact = useCallback(
    (file: AgentFileRow) => {
      const path = file.path;
      if (
        isOpenteamsPath(path) ||
        file.supplementary ||
        file.hasDiff === false
      ) {
        openArtifactInExplorer(path, file.workspacePath);
        return;
      }

      const openRunDiff = (row: AgentFileRow) => {
        if (!onOpenDiffTab || row.unifiedDiff === undefined) {
          return false;
        }
        onOpenDiffTab(
          activeSessionId,
          row.path,
          row.status ?? file.status ?? "M",
          row.unifiedDiff,
          row.runId ?? file.runId,
        );
        return true;
      };

      if (openRunDiff(file)) {
        return;
      }
      if (file.runId) {
        void chatRunsApi
          .getFiles(file.runId, { includeDiff: true })
          .then((response) => {
            const match = flattenRunFileChanges(response).find(
              (candidate) =>
                normalizeArtifactPath(candidate.path) ===
                normalizeArtifactPath(path),
            );
            if (!match || !openRunDiff(match)) {
              openArtifactInExplorer(path, file.workspacePath);
            }
          })
          .catch(() => {
            openArtifactInExplorer(path, file.workspacePath);
          });
        return;
      }
      openArtifactInExplorer(path, file.workspacePath);
    },
    [
      onOpenDiffTab,
      activeSessionId,
      openArtifactInExplorer,
    ],
  );

  const handleRelatedFilesResizeStart = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = effectiveRelatedFilesWidth;
    const pointerScale = appScale.enabled ? appScale.scale : 1;
    const originalCursor = document.body.style.cursor;
    const originalUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = (startX - moveEvent.clientX) / pointerScale;
      const nextWidth = Math.min(
        relatedFilesMaxAvailableWidth,
        Math.max(RELATED_FILES_MIN_WIDTH, startWidth + delta),
      );
      setRelatedFilesWidth(nextWidth);
    };

    const handleMouseUp = () => {
      document.body.style.cursor = originalCursor;
      document.body.style.userSelect = originalUserSelect;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const formatMessageTime = (time: string) => {
    if (time === "just now") return t("justNow");

    const minuteMatch = time.match(/^(\d+)m ago$/);
    if (minuteMatch) {
      return t("minutesAgo", { minutes: minuteMatch[1] });
    }

    const hourMatch = time.match(/^(\d+)h ago$/);
    if (hourMatch) {
      return t("hoursAgo", { hours: hourMatch[1] });
    }

    return time;
  };

  const renderMentionText = (mention: string, key: React.Key) => (
    <span
      key={key}
      className="text-[var(--primary)] hover:text-[var(--primary-hover)] font-semibold font-mono mx-0.5"
    >
      {mention}
    </span>
  );

  const displayMentionForUserMessage = (message: Message) => {
    if (extractMentionHandles(message.text).length > 0) return null;
    const routedMention = message.mentions?.[0];
    if (routedMention) {
      const normalized = normalizeMentionHandle(routedMention);
      return (
        sidebarMembers.find(
          (member) => normalizeMentionHandle(member.name) === normalized,
        )?.name ?? normalized
      );
    }
    return mainAgentHandle;
  };

  // Highlight @mentions while keeping user-entered markdown characters literal.
  const formatMsgText = (text: string) => {
    if (!text) return "";
    const elements = text.split(/(@[\p{L}\p{N}_-]+)/gu);

    return elements.map((el, idx) => {
      if (el.startsWith("@")) {
        return renderMentionText(el, idx);
      }
      return <span key={idx}>{el}</span>;
    });
  };

  const plainRelatedFilesContent = (
    <RelatedFilesContent
      changes={relatedFileChanges}
      loading={workspaceChangesAsync.loading}
      error={workspaceChangesAsync.error}
      onRefresh={reloadRelatedFiles}
      onFileClick={handleRelatedFileClick}
      t={t}
    />
  );

  return (
    <div
      ref={workspaceRootRef}
      className={
        embedded
          ? "relative h-full w-full flex flex-col font-sans text-xs select-none"
          : "relative rounded-xl border border-[var(--hairline)] bg-[var(--canvas)] overflow-hidden font-sans text-xs select-none"
      }
    >
      {attachmentImagePreview && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          onClick={() => setAttachmentImagePreview(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={attachmentImagePreview.name}
            className="flex max-h-[min(84vh,760px)] w-[min(92vw,960px)] flex-col overflow-hidden rounded-md border border-[var(--hairline-strong)] bg-[var(--surface-1)] text-[var(--ink)] shadow-[0_24px_80px_rgba(0,0,0,0.36)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex min-h-0 items-center gap-3 border-b border-[var(--hairline)] px-3 py-2">
              <ImageIcon className="h-4 w-4 shrink-0 text-[var(--ink-tertiary)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-[var(--ink)]">
                  {attachmentImagePreview.name}
                </div>
                {attachmentImagePreview.sizeBytes ? (
                  <div className="font-mono text-[10px] text-[var(--ink-tertiary)]">
                    {formatFileSize(attachmentImagePreview.sizeBytes)}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                onClick={() => setAttachmentImagePreview(null)}
                title={t("aria.closeTab")}
                aria-label={t("aria.closeTab")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--canvas)] p-3">
              <img
                src={attachmentImagePreview.url}
                alt={attachmentImagePreview.name}
                className="max-w-full rounded-sm object-contain"
                style={{
                  maxHeight: "calc(min(84vh, 760px) - 64px)",
                }}
              />
            </div>
          </div>
        </div>
      )}
      <div
        style={
          isRelatedFilesOpen
            ? ({
                "--related-files-width": `${effectiveRelatedFilesWidth}px`,
              } as React.CSSProperties)
            : undefined
        }
        ref={workspaceGridRef}
        className={
          isRelatedFilesOpen
            ? embedded
              ? "grid h-full w-full min-h-0 grid-cols-[minmax(0,1fr)_6px_var(--related-files-width)] grid-rows-1 gap-0"
              : "grid min-h-[500px] w-full grid-cols-[minmax(0,1fr)_6px_var(--related-files-width)] gap-0"
            : embedded
              ? "grid h-full w-full min-h-0 grid-cols-1"
              : "grid min-h-[500px] w-full grid-cols-1"
        }
      >
        {/* Center Panel (Conversation) */}
        <main
          className={`relative flex h-full min-h-0 w-full min-w-0 flex-col p-4 ${
            embedded ? "bg-transparent" : "bg-[var(--canvas)]"
          }`}
        >
          {unfinishedWorkflowCardMessageId && (
            <button
              type="button"
              onClick={jumpToUnfinishedWorkflowCard}
              className={`absolute top-1.5 z-20 flex h-7 items-center gap-1.5 rounded-full border border-amber-500/35 bg-[var(--surface-1)]/95 px-3 text-[10px] font-medium text-amber-600 shadow-sm backdrop-blur transition-colors hover:bg-amber-500/10 dark:text-amber-400 ${
                isRelatedFilesOpen ? "right-7" : "right-10"
              }`}
              title={t("workflow.activeWorkflow.jumpToUnfinished")}
              aria-label={t("workflow.activeWorkflow.jumpToUnfinished")}
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span>{t("workflow.activeWorkflow.label")}</span>
            </button>
          )}
          {!isRelatedFilesOpen && (
            <button
              type="button"
              data-command-id="sidebar.right.toggle"
              onClick={openRelatedFiles}
              className="absolute top-1 right-1 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-subtle)] shadow-sm transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
              title={t("relatedFiles.show")}
              aria-label={t("relatedFiles.show")}
            >
              <PanelRightOpen className="h-4 w-4" />
            </button>
          )}
          <div
            className={`mb-3 space-y-2 ${!isRelatedFilesOpen ? "pr-10" : ""}`}
          >
            <ResourceStateNotice
              resource={sessionsAsync}
              labels={{
                loading: t("resource.sessions.loading"),
                empty: t("resource.sessions.empty"),
                error: t("resource.sessions.error"),
                fallback: t("resource.sessions.fallback"),
              }}
              onRetry={() => void refreshSessions()}
              compact
            />
          </div>

          <div className="relative mb-4 min-h-0 flex-1">
          <ScrollArea
            ref={chatMessagesScrollRef}
            className="h-full space-y-4 pr-1"
            onScroll={handleChatScroll}
            onWheel={handleChatWheel}
          >
            {(!messagesAsync.loading || displayedMessages.length === 0) && (
              <ResourceStateNotice
                resource={messagesAsync}
                labels={{
                  loading: t("resource.messages.loading"),
                  empty: t("resource.messages.empty"),
                  error: t("resource.messages.error"),
                  fallback: t("resource.messages.fallback"),
                }}
                onRetry={() => void refreshMessages()}
              />
            )}
            {displayedMessages.map((msg) => (
              <div
                key={msg.id}
                id={`chat-message-${msg.id}`}
                className={`group/message relative flex w-full min-w-0 gap-3 items-start rounded-md ${
                  msg.isUser
                    ? "border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2.5"
                    : "px-1 py-2 pb-8"
                }`}
              >
                {msg.isUser ? (
                  <span className="h-7 w-7 rounded-full bg-[var(--primary)] text-white font-bold flex items-center justify-center text-[9px] font-mono border border-[var(--primary)] flex-shrink-0">
                    {t("youShort")}
                  </span>
                ) : (
                  <span className="h-7 w-7 rounded-full bg-[var(--mono-bg)] border border-[var(--mono-border)] flex items-center justify-center text-[9px] font-mono font-bold text-[var(--ink-muted)] flex-shrink-0">
                    {msg.avatar}
                  </span>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span
                      className="font-semibold text-[var(--ink)]"
                      style={{ fontSize: `${chatMessageFontSize}px` }}
                    >
                      {msg.isUser ? "you" : displayChatSenderName(msg.sender)}
                    </span>
                    {msg.model && (
                      <span className="rounded-full bg-[var(--surface-3)] border border-[var(--hairline-strong)] px-2 py-0.5 text-[9px] font-mono text-[var(--ink-muted)] shrink-0 select-text">
                        {msg.model}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-[var(--ink-tertiary)] ml-auto">
                      {formatMessageTime(msg.time)}
                    </span>
                  </div>

                  {msg.quotedMessage && (
                    <button
                      type="button"
                      onClick={() => handleJumpToMessage(msg.quotedMessage!.id)}
                      className="mb-2 flex w-full items-start gap-2 rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-2.5 py-1.5 text-left text-[11px] text-[var(--ink-muted)] transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-focus)]"
                      title={msg.quotedMessage.content}
                    >
                      <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-[var(--ink)]">
                          {t("message.quotePrefix", {
                            sender: msg.quotedMessage.sender,
                          })}
                        </div>
                        <div className="truncate font-mono text-[10px] text-[var(--ink-tertiary)]">
                          {msg.quotedMessage.summary}
                        </div>
                      </div>
                    </button>
                  )}

                  {msg.agentSourceMessage && (
                    <button
                      type="button"
                      onClick={() =>
                        handleJumpToMessage(msg.agentSourceMessage!.id)
                      }
                      className="mb-2 flex w-full min-w-0 items-center gap-1.5 rounded-sm text-left text-[10px] font-mono text-[var(--ink-tertiary)] transition-colors hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-focus)]"
                      title={msg.agentSourceMessage.content}
                    >
                      <Quote className="h-3 w-3 shrink-0" />
                      <span className="shrink-0 font-semibold text-[var(--ink-muted)]">
                        {msg.agentSourceMessage.sender}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">
                        {msg.agentSourceMessage.summary ||
                          t("message.quoteEmpty")}
                      </span>
                    </button>
                  )}

                  {msg.isUser ? (
                    <div
                      className="whitespace-pre-wrap break-words leading-relaxed text-[var(--ink)] select-text"
                      style={{ fontSize: `${chatMessageFontSize}px` }}
                    >
                      {displayMentionForUserMessage(msg) && (
                        <>
                          {renderMentionText(
                            displayMentionForUserMessage(msg) ?? "",
                            "implicit-route-mention",
                          )}
                          {" "}
                        </>
                      )}
                      {formatMsgText(msg.text)}
                    </div>
                  ) : (
                    <AgentMessageContent
                      message={msg}
                      t={t}
                      messageFontSize={chatMessageFontSize}
                      onOpenArtifact={handleOpenArtifact}
                    />
                  )}

                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="mt-2 flex flex-col gap-2">
                      {msg.attachments.map((attachment) => {
                        const url = chatMessagesApi.attachmentUrl(
                          activeSessionId,
                          msg.id,
                          attachment.id,
                        );
                        const isImage = isImageChatAttachment(attachment);
                        if (isImage) {
                          return (
                            <button
                              key={attachment.id}
                              type="button"
                              className="group/attachment max-w-md rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-2 text-left text-[11px] text-[var(--ink-muted)] transition hover:border-[var(--hairline-strong)] hover:bg-[var(--surface-3)]"
                              onClick={(event) => {
                                event.stopPropagation();
                                setAttachmentImagePreview({
                                  url,
                                  name: attachment.name,
                                  sizeBytes: attachment.size_bytes,
                                });
                              }}
                              title={attachment.name}
                              aria-label={attachment.name}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                                <span
                                  className="min-w-0 flex-1 truncate font-medium text-[var(--ink)]"
                                  title={attachment.name}
                                >
                                  {attachment.name}
                                </span>
                                {attachment.size_bytes ? (
                                  <span className="shrink-0 font-mono text-[10px] text-[var(--ink-tertiary)]">
                                    {formatFileSize(attachment.size_bytes)}
                                  </span>
                                ) : null}
                              </div>
                              <img
                                src={url}
                                alt={attachment.name}
                                className="mt-2 max-h-44 max-w-full rounded-sm border border-[var(--hairline)] object-contain"
                                loading="lazy"
                              />
                            </button>
                          );
                        }

                        return (
                          <a
                            key={attachment.id}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="group/attachment max-w-md rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-2 text-[11px] text-[var(--ink-muted)] transition hover:border-[var(--hairline-strong)] hover:bg-[var(--surface-3)]"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                              <span
                                className="min-w-0 flex-1 truncate font-medium text-[var(--ink)]"
                                title={attachment.name}
                              >
                                {attachment.name}
                              </span>
                              {attachment.size_bytes ? (
                                <span className="shrink-0 font-mono text-[10px] text-[var(--ink-tertiary)]">
                                  {formatFileSize(attachment.size_bytes)}
                                </span>
                              ) : null}
                            </div>
                          </a>
                        );
                      })}
                    </div>
                  )}

                  {msg.cost && (
                    <div className="mt-1 text-[10px] font-mono text-[var(--ink-tertiary)]">
                      {msg.cost}
                    </div>
                  )}
                  {!msg.isUser &&
                    msg.sessionAgentId &&
                    queueAnchorMessageIds.get(msg.sessionAgentId) === msg.id && (
                      <InlineQueueGroup
                        group={queueGroupsBySessionAgentId.get(msg.sessionAgentId)}
                        queueActionIds={queueActionIds}
                        summarize={summarizeQueuedMessage}
                        onDelete={(sessionId, queueId) =>
                          void handleDeleteQueuedMessage(sessionId, queueId)
                        }
                        onContinue={(sessionId, sessionAgentId) =>
                          void handleContinueMemberQueue(sessionId, sessionAgentId)
                        }
                        t={t}
                      />
                    )}
                </div>

                {!msg.isUser &&
                  msg.isAgentRunning &&
                  msg.runId &&
                  msg.sessionAgentId &&
                  sessionsAsync.source === "api" && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleStopAgentMessage(
                          msg.sessionAgentId!,
                          msg.runId,
                        );
                      }}
                      disabled={isStopPendingForMessage(
                        msg.sessionAgentId,
                        msg.runId,
                      )}
                      className="absolute bottom-1 right-1 z-10 flex h-6 w-6 items-center justify-center rounded-sm text-rose-500 transition hover:bg-rose-500/10 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                      title={t("agent.stop")}
                      aria-label={t("agent.stop")}
                    >
                      <Square className="h-3 w-3 fill-current" />
                    </button>
                  )}

                {!msg.isUser && (
                  <div
                    className={`pointer-events-none absolute bottom-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 ${
                      msg.isAgentRunning &&
                      msg.runId &&
                      msg.sessionAgentId &&
                      sessionsAsync.source === "api"
                        ? "right-8"
                        : "right-1"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleCopyAgentMessage(msg.id, msg.text);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink-subtle)]"
                      title={t("message.copy")}
                      aria-label={t("message.copy")}
                    >
                      {copiedMessageId === msg.id ? (
                        <Check className="h-3 w-3 text-[var(--success)]" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleQuoteAgentMessage(msg.id, msg.sender, msg.text);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink-subtle)]"
                      title={t("message.quote")}
                      aria-label={t("message.quote")}
                    >
                      <Quote className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </ScrollArea>
          </div>

          <ChatComposer
            key={activeSessionId}
            sessionId={activeSessionId}
            members={members}
            membersAsync={membersAsync}
            quotedMessage={quotedMessage}
            inputMode={chatInputMode}
            mainAgentName={mainAgentHandle}
            apiAvailable={sessionsAsync.source === "api"}
            focusRequestKey={composerFocusRequestKey}
            t={t}
            onRetryMembers={handleRetryComposerMembers}
            onInputModeChange={setChatInputMode}
            onCancelQuote={handleCancelQuote}
            onShowToast={showToast}
            onSubmit={handleComposerSubmit}
          />
        </main>

        {isRelatedFilesOpen && (
          <div
            className="group relative h-full min-h-0 cursor-col-resize self-stretch"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("relatedFiles.resize")}
            title={t("relatedFiles.resize")}
            onMouseDown={handleRelatedFilesResizeStart}
          >
            <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[color-mix(in_srgb,var(--hairline)_55%,transparent)] transition-[width,background-color] group-hover:w-1 group-hover:bg-[var(--hairline-tertiary)] group-active:w-1 group-active:bg-[var(--hairline-tertiary)]" />
          </div>
        )}

        {isRelatedFilesOpen && (
          <aside
            className={`main-right-nav-panel-scrollbars-hidden relative flex min-h-0 flex-col overflow-hidden ${
              embedded ? "bg-transparent" : "bg-[var(--canvas)]"
            }`}
          >
            <button
              type="button"
              data-command-id="sidebar.right.toggle"
              onClick={closeRelatedFiles}
              className="absolute right-1 top-0 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
              title={t("relatedFiles.hide")}
              aria-label={t("relatedFiles.hide")}
            >
              <PanelRightClose className="h-4 w-4" />
            </button>

            <div className="shrink-0 px-3 py-3">
              <div className="mb-2 pr-10 text-[14px] font-semibold text-[var(--ink)]">
                {t("sessionMembers")}
              </div>
              <div className="flex h-10 min-w-0 items-center gap-1.5">
                <ScrollArea
                  ref={memberRailRef}
                  orientation="horizontal"
                  scrollbar={isMemberRailExpanded ? "styled" : "hidden"}
                  className={`flex min-w-0 flex-1 gap-1.5 overflow-hidden px-1 ${
                    isMemberRailExpanded
                      ? "h-12 -mb-2 items-start pb-2 pt-1.5"
                      : "h-10 items-center"
                  }`}
                >
                  {displayedSidebarMembers.map((member) => {
                    const isSelected = selectedSidebarMemberId === member.id;
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() =>
                          setSelectedSidebarMemberId((current) =>
                            current === member.id ? null : member.id,
                          )
                        }
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-left transition-[box-shadow] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] ${
                          isSelected
                            ? "ring-2 ring-[var(--primary-focus)]/55"
                            : ""
                        }`}
                        title={member.name}
                        aria-label={member.name}
                        aria-pressed={isSelected}
                      >
                        <SessionMemberAvatar member={member} />
                      </button>
                    );
                  })}
                </ScrollArea>
                {hasSidebarMemberOverflow && (
                  <button
                    type="button"
                    onClick={() =>
                      setIsMemberRailExpanded((current) => !current)
                    }
                    className="flex h-7 w-5 shrink-0 items-center justify-center text-[var(--ink-tertiary)] transition hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
                    title={
                      isMemberRailExpanded
                        ? t("memberRail.collapse")
                        : t("memberRail.expand")
                    }
                    aria-label={
                      isMemberRailExpanded
                        ? t("memberRail.collapse")
                        : t("memberRail.expand")
                    }
                  >
                    {isMemberRailExpanded ? (
                      <ChevronsLeft className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronsRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    requestTeamMemberInviteNavigation({
                      projectId: selectedProjectId ?? undefined,
                    })
                  }
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-subtle)] transition hover:border-[var(--hairline-strong)] hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                  title={t("inviteMember")}
                  data-tooltip-nowrap
                  aria-label={t("inviteMember")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Linked Work Items Section */}
            <div className="shrink-0 px-3 py-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[14px] font-semibold text-[var(--ink)]">
                  {t("linkedWorkItems.title")}
                </h2>
                {linkedWorkItems.length > 0 && (
                  <span className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 font-mono text-[13px] text-[var(--ink-tertiary)]">
                    {linkedWorkItems.length}
                  </span>
                )}
              </div>
              {linkedWorkItemsLoading && (
                <div className="rounded-md bg-[var(--surface-1)] px-3 py-2 text-[13px] text-[var(--ink-tertiary)]">
                  {t("linkedWorkItems.loading")}
                </div>
              )}
              {linkedWorkItemsError && (
                <div className="rounded-md bg-[var(--surface-1)] px-3 py-2 text-[13px] text-rose-500">
                  {t("linkedWorkItems.error")}
                </div>
              )}
              {!linkedWorkItemsLoading &&
                !linkedWorkItemsError &&
                linkedWorkItems.length === 0 && (
                  <div className="rounded-md bg-[var(--surface-1)] px-3 py-2 text-[13px] text-[var(--ink-tertiary)]">
                    {t("linkedWorkItems.empty")}
                  </div>
                )}
              {!linkedWorkItemsLoading &&
                !linkedWorkItemsError &&
                linkedWorkItems.length > 0 && (
                  <div className="space-y-1">
                    {linkedWorkItems.map((item) => (
                      <LinkedWorkItemRow
                        key={item.id}
                        item={item}
                        statusPending={updatingLinkedWorkItemIds.has(item.id)}
                        statusMenuOpen={Boolean(
                          activeSessionId &&
                            isLinkedWorkItemStatusMenuTarget(
                              linkedWorkItemStatusMenuTarget,
                              activeSessionId,
                              item.id,
                            ),
                        )}
                        onStatusMenuOpenChange={
                          handleLinkedWorkItemStatusMenuOpenChange
                        }
                        onOpen={handleOpenLinkedWorkItem}
                        t={t}
                        onStatusChange={(nextItem, status) => {
                          void handleLinkedWorkItemStatusChange(
                            nextItem,
                            status,
                          );
                        }}
                      />
                    ))}
                  </div>
                )}
            </div>

            <SessionSourceControlPanel
              projectId={selectedProjectId || null}
              sessionId={activeSessionId || null}
              enabled={usesProjectSourceControl}
              worktreeMode={
                sessionsAsync.data?.find(
                  (session) => session.id === activeSessionId,
                )?.worktreeMode
              }
              fallbackRelatedFiles={plainRelatedFilesContent}
              linkedWorkItemIds={linkedWorkItems.map((item) => item.id)}
              focusRequestKey={sourceControlFocusRequestKey}
              commitFocusRequestKey={commitMessageFocusRequestKey}
              onOpenDiff={(projectId, sessionId, filePath, area) => {
                onOpenSourceControlDiffTab?.(
                  projectId,
                  sessionId,
                  filePath,
                  area,
                );
              }}
              onOpenConflictResolver={(projectId, sessionId) => {
                onOpenWorktreeConflictTab?.(projectId, sessionId);
              }}
            />
          </aside>
        )}
      </div>
    </div>
  );
};
