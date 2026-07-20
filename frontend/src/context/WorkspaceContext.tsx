import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import {
  BackendChatSession,
  JsonValue,
  Member,
  MemberQueueSnapshot,
  Message,
  Provider,
  QueuedMessageStatus,
  WorkflowSessionStatusResponse,
} from '@/types';
import { i18nDict } from '@/i18n';
import { mockFrontendApi } from '@/lib/mockFrontendApi';
import type { WorkspaceBootstrapMock } from '@/mockApiData';
import {
  chatAgentsApi,
  chatMessagesApi,
  chatQueuesApi,
  chatRuntimeApi,
  chatSessionsApi,
  cliConfigApi,
  inboxApi,
  projectApi,
  sessionAgentsApi,
  skillsApi,
  systemApi,
  workflowApi,
} from '@/lib/api';
import {
  type CreateProjectRequest,
  type InboxItem,
  type Project,
} from '../../../shared/types';
import {
  effectiveSessionAgentModelName,
  mapMessages,
  mapProviders,
  mapSessionAgentsToMembers,
  mapSessions,
} from '@/lib/mappers';
import { resolveMessageReferences } from '@/lib/messageReferences';
import { beginLoad, fail, initialAsync, succeed } from '@/lib/asyncResource';
import {
  hasRunningWorkflowActivity,
  isWorkflowSidebarRunning,
} from '@/lib/workflowSidebarState';
import { useWorkspaceState } from './workspace/useWorkspaceState';
import { useWorkspaceChatRuntime } from './workspace/useWorkspaceChatRuntime';
import type { WorkspaceContextProps } from './workspace/workspaceContextContract';
import type { ChatStreamEvent } from './workspace/workspaceChatStreamTypes';
export type { WorkspaceContextProps } from './workspace/workspaceContextContract';
import {
  DEFAULT_CHAT_INPUT_MODE,
  chatSessionUpdatePayload,
  resolveChatInputMode,
  type SendMessageOptions,
} from './workspace/workspaceContextTypes';
export * from './workspace/workspaceContextTypes';
import {
  EMPTY_INBOX_SUMMARY,
  INBOX_LIGHT_REFRESH_DELAY_MS,
  INBOX_LIST_LIMIT,
  INBOX_REFRESH_INTERVAL_MS,
  SIDEBAR_RUNNING_INDICATOR_POLL_MS,
  STARTING_AGENT_RECONCILE_DELAY_MS,
  activeRunMessagesForSession,
  activeRunToMessage,
  chatMessageFontSizeFromConfig,
  countUnreadInboxItems,
  createClientMessageId,
  decrementInboxSummaryEntries,
  extractAgentMentions,
  filterInboxItemsForEnabledSources,
  filterInboxSummaryForEnabledSources,
  filterMessagesForSession,
  filterQueuedUserMessagesFromSnapshot,
  hasRunningSessionAgent,
  inboxCountValue,
  inboxNotificationSettingsSignature,
  isAutoReadableInboxItem,
  isOptimisticPendingAgentPlaceholder,
  isPendingAgentPlaceholder,
  loadSessionRunningIndicators,
  localeFromConfig,
  makePendingAgentPlaceholders,
  mergePersistedWithRunningPlaceholders,
  mergeSessionMessagesWithActiveRuns,
  normalizeActiveRun,
  playInboxNotificationSound,
  queuedUserMessagesByIdFromSnapshot,
  resolveProjectMainAgentId,
  resolveProjectMainAgentName,
  showInboxSystemNotification,
  themePreferenceFromConfig,
  userMessageClientId,
  withSessionIdsBySession,
} from './workspace/workspaceContextUtils';

export type { ChatStreamEvent } from './workspace/workspaceChatStreamTypes';
export * from './workspace/workspaceContextUtils';

export const WorkspaceContext = createContext<WorkspaceContextProps | undefined>(
  undefined,
);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const workspaceState = useWorkspaceState();
  const {
    themePreference,
    setThemePreferenceState,
    systemTheme,
    setSystemTheme,
    locale,
    setLocaleState,
    chatMessageFontSize,
    setChatMessageFontSizeState,
    activeSessionId,
    setActiveSessionId,
    sessionsAsync,
    setSessionsAsync,
    archivedSessionsAsync,
    setArchivedSessionsAsync,
    projectsAsync,
    setProjectsAsync,
    selectedProjectId,
    setSelectedProjectIdState,
    allMessages,
    setAllMessages,
    memberQueuesBySessionAgentId,
    setMemberQueuesBySessionAgentId,
    activeRunsByRunId,
    setActiveRunsByRunId,
    workflowRuntimeLinesByExecution,
    setWorkflowRuntimeLinesByExecution,
    messagesAsync,
    setMessagesAsync,
    membersAsync,
    setMembersAsync,
    mainAgentName,
    setMainAgentName,
    providersAsync,
    setProvidersAsync,
    skillsAsync,
    setSkillsAsync,
    configAsync,
    setConfigAsync,
    environment,
    setEnvironment,
    inboxSummaryAsync,
    setInboxSummaryAsync,
    inboxItemsAsync,
    setInboxItemsAsync,
    workflowCardAsync,
    setWorkflowCardAsync,
    workspaceChangesAsync,
    setWorkspaceChangesAsync,
    chatInputModeBySessionId,
    setChatInputModeBySessionId,
    strategies,
    setStrategies,
    mockAgentRepliesByMention,
    setMockAgentRepliesByMention,
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
    setWeeklyCost,
    weeklySaved,
    setWeeklySaved,
    earlyBirdLeft,
    setEarlyBirdLeft,
    activeSettingsTab,
    setActiveSettingsTab,
    isAddMemberModalOpen,
    setIsAddMemberModalOpen,
    isAddProviderModalOpen,
    setIsAddProviderModalOpen,
    toast,
    setToast,
    runActivityStore,
    theme,
    mockBootstrapRef,
    toastDurationMsRef,
    allMessagesRef,
    latestConfigRef,
    configPatchQueueRef,
    publishVisibleConfig,
    ensureConfigPatchQueue,
    saveConfigPatch,
    messagesRequestIdRef,
    queueRequestIdRef,
    inboxRequestIdRef,
    inboxLightRefreshTimerRef,
    inboxSoundProjectIdRef,
    inboxSoundSettingsSignatureRef,
    inboxSoundPrimedRef,
    inboxUnreadSoundIdsRef,
    inboxAutoReadProjectIdRef,
    inboxInitialUnreadItemIdsRef,
    autoMarkedInboxItemIdsRef,
    workspaceChangesRequestIdRef,
    initialRefreshStartedRef,
    initialRefreshCompletedRef,
    sessionRunningIndicatorRequestsRef,
    sessionWorkflowStatusRequestsRef,
    activeSessionIdRef,
    selectedProjectIdRef,
    activeWorkspacePathRef,
    sessionLeadAgentIdBySessionIdRef,
    workflowRouteAgentIdRef,
    agentNamesByIdRef,
    agentModelsByIdRef,
    notifiedTokenUsageSignaturesRef,
    optimisticallyStoppedSessionAgentIdsRef,
    runningAgentSessionIdsRef,
    unreadAgentCompletionSessionIdsRef,
    acknowledgedWorkflowInputIdsRef,
    acknowledgedWorkflowErrorSessionIdsRef,
    persistAgentSessionActivityStorage,
    persistWorkflowInputAcknowledgementStorage,
    persistWorkflowErrorAcknowledgementStorage,
    syncSessionAgentActivityIndicator,
    acknowledgeWorkflowInput,
    syncSessionWorkflowInputIndicator,
    acknowledgeWorkflowError,
    syncSessionWorkflowErrorIndicator,
    clearUnreadAgentCompletion,
    clearPendingWorkflowInput,
    clearWorkflowErrorAttention,
    chatInputMode,
    showToast,
    persistUiPreference,
    setTheme,
    setLocale,
    setChatMessageFontSize,
    makeListSetter,
    setSessions,
    setMembers,
    setProviders,
    setSessionRunningIndicator,
    syncProcessingQueuePlaceholders,
    applyChatRuntimeSnapshot,
    reconcileStartingPlaceholders,
    setSessionWorkflowRunningIndicator,
    setSessionWorkflowStatusIndicators,
    clearSessionScopedState,
    setSelectedProjectId,
    syncSessionLeadAgent,
    ensureWorkflowRouteToMainAgent,
    setSessionChatInputMode,
    setChatInputMode,
  } = workspaceState;
  const [runtimeHydratedSessionId, setRuntimeHydratedSessionId] =
    useState<string>('');

  // A cached active run can become stale while its session is not selected.
  // Invalidate it before the newly selected session is painted; the runtime
  // snapshot will opt the session back in once its authoritative state arrives.
  useLayoutEffect(() => {
    setRuntimeHydratedSessionId('');
  }, [activeSessionId]);

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
      const currentActiveSessionId = activeSessionIdRef.current;
      const nextActiveSessionId = backend.some(
        (session) => session.id === currentActiveSessionId,
      )
        ? currentActiveSessionId
        : (backend[0]?.id ?? '');
      const skipAgentSessionIds = nextActiveSessionId
        ? new Set([nextActiveSessionId])
        : undefined;
      const runningIndicators = await loadSessionRunningIndicators(
        backend.map((session) => session.id),
        ignoredSessionAgentIds,
        { skipAgentSessionIds },
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
      syncActiveSessionSelection(activeBackendSessions);
      const mapped = mapSessions(backend, nextActiveSessionId).map(
        (session) => {
          const indicators = runningIndicators.get(session.id);
          const hasRunningAgent = indicators?.hasRunningAgent ?? false;
          const workflowSidebarState =
            indicators?.workflowSidebarState ?? 'idle';
          const pendingWorkflowInputId =
            indicators?.pendingWorkflowInputId ?? null;
          const pendingWorkflowReviewId =
            indicators?.pendingWorkflowReviewId ?? null;
          const hasWorkflowError = syncSessionWorkflowErrorIndicator(
            session.id,
            workflowSidebarState,
          );
          return {
            ...session,
            hasRunningAgent,
            hasRunningWorkflow: isWorkflowSidebarRunning(workflowSidebarState),
            workflowSidebarState,
            pendingWorkflowInputId,
            hasPendingWorkflowInput: syncSessionWorkflowInputIndicator(
              session.id,
              pendingWorkflowInputId,
            ),
            pendingWorkflowReviewId,
            hasPendingWorkflowReview: Boolean(pendingWorkflowReviewId),
            hasWorkflowError,
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
    syncSessionWorkflowErrorIndicator,
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

  const refreshInbox = useCallback(async (): Promise<void> => {
    const projectId = selectedProjectIdRef.current;
    const requestId = inboxRequestIdRef.current + 1;
    inboxRequestIdRef.current = requestId;

    if (!projectId) {
      inboxSoundProjectIdRef.current = null;
      inboxSoundSettingsSignatureRef.current =
        inboxNotificationSettingsSignature(configAsync.data);
      inboxSoundPrimedRef.current = false;
      inboxUnreadSoundIdsRef.current = new Set();
      inboxAutoReadProjectIdRef.current = null;
      inboxInitialUnreadItemIdsRef.current = new Set();
      setInboxSummaryAsync(succeed(EMPTY_INBOX_SUMMARY));
      setInboxItemsAsync(succeed([]));
      return;
    }
    const settingsSignature = inboxNotificationSettingsSignature(
      configAsync.data,
    );
    if (inboxSoundProjectIdRef.current !== projectId) {
      inboxSoundProjectIdRef.current = projectId;
      inboxSoundPrimedRef.current = false;
      inboxUnreadSoundIdsRef.current = new Set();
    }
    if (inboxSoundSettingsSignatureRef.current !== settingsSignature) {
      inboxSoundSettingsSignatureRef.current = settingsSignature;
      inboxSoundPrimedRef.current = false;
      inboxUnreadSoundIdsRef.current = new Set();
    }

    setInboxSummaryAsync(beginLoad);
    setInboxItemsAsync(beginLoad);
    try {
      const [summary, itemsResponse] = await Promise.all([
        inboxApi.getSummary({ project_id: projectId, session_id: null }),
        inboxApi.listItems({
          project_id: projectId,
          session_id: null,
          unread: true,
          archived: false,
          limit: INBOX_LIST_LIMIT,
        }),
      ]);
      if (
        inboxRequestIdRef.current !== requestId ||
        selectedProjectIdRef.current !== projectId
      ) {
        return;
      }
      const visibleSummary = filterInboxSummaryForEnabledSources(
        configAsync.data,
        summary,
      );
      const visibleItems = filterInboxItemsForEnabledSources(
        configAsync.data,
        itemsResponse.items,
      );
      if (inboxAutoReadProjectIdRef.current !== projectId) {
        inboxAutoReadProjectIdRef.current = projectId;
        inboxInitialUnreadItemIdsRef.current = new Set(
          visibleItems.map((item) => item.id),
        );
      }
      const unreadItemIds = new Set(visibleItems.map((item) => item.id));
      const newUnreadItems = visibleItems.filter(
        (item) => !inboxUnreadSoundIdsRef.current.has(item.id),
      );
      if (inboxSoundPrimedRef.current) {
        showInboxSystemNotification(configAsync.data, newUnreadItems);
        playInboxNotificationSound(configAsync.data, newUnreadItems);
      }
      inboxUnreadSoundIdsRef.current = unreadItemIds;
      inboxSoundPrimedRef.current = true;
      setInboxSummaryAsync(succeed(visibleSummary));
      setInboxItemsAsync(succeed(visibleItems));
    } catch (err) {
      if (inboxRequestIdRef.current !== requestId) return;
      setInboxSummaryAsync((prev) => fail(prev, err));
      setInboxItemsAsync((prev) => fail(prev, err));
    }
  }, [configAsync.data]);

  const scheduleInboxRefresh = useCallback(() => {
    if (inboxLightRefreshTimerRef.current) return;
    inboxLightRefreshTimerRef.current = setTimeout(() => {
      inboxLightRefreshTimerRef.current = null;
      void refreshInbox();
    }, INBOX_LIGHT_REFRESH_DELAY_MS);
  }, [refreshInbox]);

  const decrementInboxSummaryForItems = useCallback((items: InboxItem[]) => {
    const removed = countUnreadInboxItems(items);
    if (removed.total === 0) return;
    setInboxSummaryAsync((prev) => {
      const nextUnreadCount =
        inboxCountValue(prev.data.unread_count) - BigInt(removed.total);
      return succeed({
        ...prev.data,
        unread_count: nextUnreadCount > 0n ? nextUnreadCount : 0n,
        unread_by_kind: decrementInboxSummaryEntries(
          prev.data.unread_by_kind,
          removed.byKind,
        ),
        unread_by_severity: decrementInboxSummaryEntries(
          prev.data.unread_by_severity,
          removed.bySeverity,
        ),
      });
    });
  }, []);

  const removeInboxItemsFromList = useCallback(
    (itemIds: string[]) => {
      if (itemIds.length === 0) return;
      const ids = new Set(itemIds);
      const removedItems = inboxItemsAsync.data.filter((item) =>
        ids.has(item.id),
      );
      setInboxItemsAsync((prev) => {
        const nextItems = prev.data.filter((item) => !ids.has(item.id));
        return nextItems.length === prev.data.length ? prev : succeed(nextItems);
      });
      decrementInboxSummaryForItems(removedItems);
    },
    [decrementInboxSummaryForItems, inboxItemsAsync.data],
  );

  const markInboxItemRead = useCallback(
    async (itemId: string): Promise<void> => {
      if (!itemId) return;
      await inboxApi.markRead(itemId);
      removeInboxItemsFromList([itemId]);
      scheduleInboxRefresh();
    },
    [removeInboxItemsFromList, scheduleInboxRefresh],
  );

  const markInboxItemsRead = useCallback(
    async (itemIds: string[]): Promise<void> => {
      const ids = Array.from(new Set(itemIds.filter(Boolean)));
      if (ids.length === 0) return;
      await inboxApi.markManyRead({ ids });
      removeInboxItemsFromList(ids);
      scheduleInboxRefresh();
    },
    [removeInboxItemsFromList, scheduleInboxRefresh],
  );

  const markAllInboxRead = useCallback(async (): Promise<void> => {
    const projectId = selectedProjectIdRef.current;
    await inboxApi.markAllRead({
      project_id: projectId || null,
      session_id: null,
    });
    setInboxItemsAsync(succeed([]));
    setInboxSummaryAsync(succeed(EMPTY_INBOX_SUMMARY));
    scheduleInboxRefresh();
  }, [scheduleInboxRefresh]);

  const archiveInboxItem = useCallback(
    async (itemId: string): Promise<void> => {
      if (!itemId) return;
      await inboxApi.archive(itemId);
      removeInboxItemsFromList([itemId]);
      scheduleInboxRefresh();
    },
    [removeInboxItemsFromList, scheduleInboxRefresh],
  );

  useEffect(() => {
    if (!activeSessionId) return;
    const ids = inboxItemsAsync.data
      .filter(
        (item) =>
          item.session_id === activeSessionId &&
          item.read_at === null &&
          item.archived_at === null &&
          isAutoReadableInboxItem(item) &&
          !inboxInitialUnreadItemIdsRef.current.has(item.id) &&
          !autoMarkedInboxItemIdsRef.current.has(item.id),
      )
      .map((item) => item.id);
    if (ids.length === 0) return;

    for (const id of ids) {
      autoMarkedInboxItemIdsRef.current.add(id);
    }
    void markInboxItemsRead(ids).catch(() => {
      for (const id of ids) {
        autoMarkedInboxItemIdsRef.current.delete(id);
      }
    });
  }, [activeSessionId, inboxItemsAsync.data, markInboxItemsRead]);

  useEffect(() => {
    void refreshInbox();
    if (!selectedProjectId) return undefined;
    const intervalId = setInterval(() => {
      void refreshInbox();
    }, INBOX_REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [refreshInbox, selectedProjectId]);

  useEffect(
    () => () => {
      if (inboxLightRefreshTimerRef.current) {
        clearTimeout(inboxLightRefreshTimerRef.current);
      }
    },
    [],
  );

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
      const [
        backendMsgs,
        backendAgents,
        sessionAgents,
        projectMembers,
        runtimeSnapshot,
      ] =
        await Promise.all([
          chatMessagesApi.list(sid),
          chatAgentsApi
            .list(projectId ? { projectId } : undefined)
            .catch(() => []),
          sessionAgentsApi.list(sid).catch(() => []),
          projectId ? projectApi.listMembers(projectId).catch(() => []) : [],
          chatRuntimeApi.getSnapshot(sid).catch(() => ({
            session_id: sid,
            messages: null,
            active_runs: [],
            queues: [],
          })),
        ]);
      applyChatRuntimeSnapshot(runtimeSnapshot);
      if (shouldUpdateActiveMessages()) {
        setRuntimeHydratedSessionId(sid);
      }
      const projectMemberNameByAgentId = new Map(
        projectMembers
          .filter((member) => member.agent_id && member.member_name?.trim())
          .map((member) => [
            member.agent_id as string,
            member.member_name as string,
          ]),
      );
      const sessionAgentByAgentId = new Map(
        sessionAgents.map((sessionAgent) => [
          sessionAgent.agent_id,
          sessionAgent,
        ]),
      );
      const agentNamesById: Record<string, string> = {};
      const agentModelsById: Record<string, string | null> = {};
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
      const activeRuns = runtimeSnapshot.active_runs.map(normalizeActiveRun);
      const activeSessionAgentIds = new Set(
        activeRuns.map((run) => run.session_agent_id),
      );
      const runningPlaceholders = activeRuns.map(activeRunToMessage);
      setAllMessages((prev) => {
        const current = filterMessagesForSession(sid, prev[sid] ?? []);
        const next = resolveMessageReferences(
          mergePersistedWithRunningPlaceholders(
            mapped,
            current,
            activeSessionAgentIds,
            runningPlaceholders,
          ),
        );
        if (shouldUpdateActiveMessages()) {
          setMessagesAsync(
            succeed(
              filterQueuedUserMessagesFromSnapshot(
                next,
                runtimeSnapshot.queues,
                sid,
              ),
            ),
          );
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
  }, [applyChatRuntimeSnapshot]);

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

  const mergeMemberQueueSnapshot = useCallback(
    (queue: MemberQueueSnapshot) => {
      setMemberQueuesBySessionAgentId((prev) => ({
        ...prev,
        [queue.session_agent_id]: queue,
      }));
      syncProcessingQueuePlaceholders(queue.session_id, [queue]);
    },
    [syncProcessingQueuePlaceholders],
  );

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
      syncProcessingQueuePlaceholders(sid, response.members);
    } catch {
      // Queue state is auxiliary UI; message/member refresh remains authoritative.
    }
  }, [syncProcessingQueuePlaceholders]);

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
      setEnvironment(info.environment);
      ensureConfigPatchQueue(info.config);
    } catch (err) {
      setConfigAsync((prev) => fail(prev, err, null));
    }
  }, [ensureConfigPatchQueue]);

  useEffect(() => {
    const config = configAsync.data;
    if (!config) return;
    latestConfigRef.current = config;
    setThemePreferenceState(themePreferenceFromConfig(config.theme));
    setLocaleState(localeFromConfig(config.language));
    setChatMessageFontSizeState(
      chatMessageFontSizeFromConfig(config.chat_bubble_font_size),
    );
  }, [configAsync.data]);

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

  const loadSessionWorkflowStatus = useCallback(
    async (
      sessionId: string,
    ): Promise<WorkflowSessionStatusResponse | null> => {
      if (!sessionId) return null;
      const existing =
        sessionWorkflowStatusRequestsRef.current.get(sessionId);
      if (existing) return existing;

      const request = workflowApi
        .getSessionStatus(sessionId)
        .catch(() => null)
        .finally(() => {
          if (
            sessionWorkflowStatusRequestsRef.current.get(sessionId) === request
          ) {
            sessionWorkflowStatusRequestsRef.current.delete(sessionId);
          }
        });
      sessionWorkflowStatusRequestsRef.current.set(sessionId, request);
      return request;
    },
    [],
  );

  const refreshSessionWorkflowStatus = useCallback(
    async (sessionId: string): Promise<void> => {
      const status = await loadSessionWorkflowStatus(sessionId);
      if (status) {
        setSessionWorkflowStatusIndicators(sessionId, status);
      }
    },
    [loadSessionWorkflowStatus, setSessionWorkflowStatusIndicators],
  );

  const refreshSessionRunningIndicators = useCallback(
    async (sessionId: string): Promise<void> => {
      if (!sessionId) return;
      const existing = sessionRunningIndicatorRequestsRef.current.get(sessionId);
      if (existing) return existing;

      const request = (async () => {
        const ignoredSessionAgentIds = new Set(
          optimisticallyStoppedSessionAgentIdsRef.current,
        );
        const [sessionAgents, workflowStatus] = await Promise.all([
          sessionAgentsApi.list(sessionId).catch(() => null),
          loadSessionWorkflowStatus(sessionId),
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
      })().finally(() => {
        if (
          sessionRunningIndicatorRequestsRef.current.get(sessionId) === request
        ) {
          sessionRunningIndicatorRequestsRef.current.delete(sessionId);
        }
      });
      sessionRunningIndicatorRequestsRef.current.set(sessionId, request);
      return request;
    },
    [
      loadSessionWorkflowStatus,
      setSessionRunningIndicator,
      setSessionWorkflowStatusIndicators,
    ],
  );

  useEffect(() => {
    if (sessionsAsync.source !== 'api') return;

    const runningSidebarSessionIds = sessionsAsync.data
      .filter(
        (session) =>
          session.id !== activeSessionId &&
          Boolean(
            session.hasRunningAgent ||
              hasRunningWorkflowActivity(session) ||
              session.hasPendingWorkflowInput ||
              session.hasPendingWorkflowReview ||
              session.hasWorkflowError,
          ),
      )
      .map((session) => session.id);
    if (runningSidebarSessionIds.length === 0) return;

    const refreshRunningSidebarSessions = () => {
      for (const sessionId of runningSidebarSessionIds) {
        void refreshSessionRunningIndicators(sessionId);
      }
      scheduleInboxRefresh();
    };

    const intervalId = window.setInterval(
      refreshRunningSidebarSessions,
      SIDEBAR_RUNNING_INDICATOR_POLL_MS,
    );
    return () => window.clearInterval(intervalId);
  }, [
    activeSessionId,
    refreshSessionRunningIndicators,
    scheduleInboxRefresh,
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
      refreshInbox(),
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
    refreshInbox,
  ]);

  // Initial load: hydrate local mock API data first, then try backend-backed
  // resources. Backend failures keep the mock API payload visible.
  useEffect(() => {
    if (initialRefreshStartedRef.current) return;
    initialRefreshStartedRef.current = true;
    void (async () => {
      const bootstrap = await mockFrontendApi.getWorkspaceBootstrap();
      applyMockBootstrap(bootstrap);
      try {
        await refreshAll();
      } finally {
        initialRefreshCompletedRef.current = true;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { mapBackendChatMessage, upsertStreamedMessage } =
    useWorkspaceChatRuntime({
      ...workspaceState,
      mergeMemberQueueSnapshot,
      refreshMemberQueues,
      refreshMembers,
      refreshMessages,
      refreshSessionRunningIndicators,
      refreshSessionWorkflowStatus,
      refreshSessions,
      refreshWorkspaceChanges,
      scheduleInboxRefresh,
    });

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
  const activeSessionQueues = activeSessionId
    ? Object.values(memberQueuesBySessionAgentId).filter(
        (queue) => queue.session_id === activeSessionId,
      )
    : [];
  const activeSessionMessages = activeSessionId
    ? filterMessagesForSession(
        activeSessionId,
        allMessages[activeSessionId] ?? [],
      )
    : [];
  const activeRunMessages = activeSessionId
    ? runtimeHydratedSessionId === activeSessionId
      ? activeRunMessagesForSession(activeRunsByRunId, activeSessionId)
      : []
    : [];
  const activeSessionMessageSnapshot = activeSessionId
    ? mergeSessionMessagesWithActiveRuns(
        activeSessionMessages,
        activeRunMessages,
      )
    : [];
  const messages = activeSessionId
    ? filterQueuedUserMessagesFromSnapshot(
        activeSessionMessageSnapshot,
        activeSessionQueues,
        activeSessionId,
      )
    : [];
  const queuedUserMessagesById = activeSessionId
    ? queuedUserMessagesByIdFromSnapshot(
        activeSessionMessageSnapshot,
        activeSessionQueues,
        activeSessionId,
      )
    : {};

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
      ? mainAgentName.replace(/^@/, '')
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
      (routeMentions.length > 0 ? routeMentions[0] : mainAgentMention);
    const placeholderMentions =
      routeMentions.length > 0
        ? routeMentions
        : fallbackMention
          ? [fallbackMention]
          : [];
    const userMsgId = createClientMessageId();
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
    const pendingAgentMessages = shouldPersistToBackend
      ? makePendingAgentPlaceholders(
          placeholderMentions,
          userMsgId,
          sid === activeSessionIdRef.current ? membersAsync.data : [],
          sid,
          options.placeholderMember,
        )
      : [];
    const queuedSessionAgentIds = new Set(
      pendingAgentMessages
        .filter((placeholder) => {
          if (!placeholder.sessionAgentId) return false;
          const targetMember = membersAsync.data.find(
            (member) => member.id === placeholder.sessionAgentId,
          );
          const queue = memberQueuesBySessionAgentId[placeholder.sessionAgentId];
          return Boolean(
            targetMember?.status === 'run' ||
              queue?.blocked ||
              queue?.paused ||
              (queue?.items.length ?? 0) > 0,
          );
        })
        .map((placeholder) => placeholder.sessionAgentId as string),
    );
    const immediatePendingAgentMessages = pendingAgentMessages.filter(
      (placeholder) =>
        !placeholder.sessionAgentId ||
        !queuedSessionAgentIds.has(placeholder.sessionAgentId),
    );
    setAllMessages((prev) => {
      const cur = filterMessagesForSession(sid, prev[sid] ?? []);
      const immediatePendingSessionAgentIds = new Set(
        immediatePendingAgentMessages
          .map((message) => message.sessionAgentId)
          .filter((id): id is string => Boolean(id)),
      );
      const withoutStalePending = cur.filter(
        (message) =>
          !(
            isPendingAgentPlaceholder(message) &&
            !message.clientMessageId &&
            message.sessionAgentId &&
            immediatePendingSessionAgentIds.has(message.sessionAgentId)
          ),
      );
      const allTargetsQueued =
        pendingAgentMessages.length > 0 &&
        immediatePendingAgentMessages.length === 0;
      const messagesToAppend = allTargetsQueued
        ? []
        : [userMsg, ...immediatePendingAgentMessages];
      return {
        ...prev,
        [sid]: [...withoutStalePending, ...messagesToAppend],
      };
    });
    for (const sessionAgentId of queuedSessionAgentIds) {
      stageOptimisticQueuedMessage(sid, sessionAgentId, userMsgId);
    }
    if (immediatePendingAgentMessages.length > 0) {
      setTimeout(() => {
        void reconcileStartingPlaceholders(sid, userMsgId);
      }, STARTING_AGENT_RECONCILE_DELAY_MS);
    }

    // Mock-only session (e.g., backend offline): use the local cascade.
    if (!shouldPersistToBackend) {
      dispatchMockReply(text, sid);
      return;
    }

    // Real backend: runtime state comes from the message response and stream.
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
      .then((response) => {
        const incomingMessage = mapBackendChatMessage(response.message);
        upsertStreamedMessage(sid, incomingMessage);
        applyChatRuntimeSnapshot(response.runtime);
      })
      .catch((err) => {
        setAllMessages((prev) => {
          const current = filterMessagesForSession(sid, prev[sid] ?? []);
          const withoutFailedPlaceholders = current.filter(
            (message) =>
              !(
                isOptimisticPendingAgentPlaceholder(message) &&
                message.clientMessageId === userMsgId
              ),
          );
          const hasUserMessage = withoutFailedPlaceholders.some(
            (message) => userMessageClientId(message) === userMsgId,
          );
          return {
            ...prev,
            [sid]: hasUserMessage
              ? withoutFailedPlaceholders
              : [...withoutFailedPlaceholders, userMsg],
          };
        });
        if (queuedSessionAgentIds.size > 0) {
          setMemberQueuesBySessionAgentId((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const sessionAgentId of queuedSessionAgentIds) {
              const queue = next[sessionAgentId];
              if (!queue || queue.session_id !== sid) continue;
              const items = queue.items.filter(
                (item) => item.message.chat_message_id !== userMsgId,
              );
              if (items.length === queue.items.length) continue;
              next[sessionAgentId] = {
                ...queue,
                status: items.length > 0 ? queue.status : 'empty',
                queued_count: BigInt(
                  items.filter(
                    (item) => String(item.message.status) === 'queued',
                  ).length,
                ),
                items,
              };
              changed = true;
            }
            return changed ? next : prev;
          });
        }
        // Roll forward with mock cascade so the UI is never stuck silent.
        showToast(
          err instanceof Error
            ? `Send failed: ${err.message} (using mock reply)`
            : 'Send failed (using mock reply)',
          'warning',
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
    showToast(
      `Added agent ${cleanName} equipped with ${model} engine!`,
      'success',
    );
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
    showToast(
      `Connected ${name} endpoint securely inside local keychain!`,
      'success',
    );
  };

  return (
    <WorkspaceContext.Provider
      value={{
        theme,
        themePreference,
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
        queuedUserMessagesById,
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
        saveConfigPatch,
        environment,
        inboxSummaryAsync,
        inboxItemsAsync,
        refreshInbox,
        markInboxItemRead,
        markInboxItemsRead,
        markAllInboxRead,
        archiveInboxItem,
        workflowCard: workflowCardAsync.data,
        workflowCardAsync,
        refreshWorkflowCard,
        refreshSessionWorkflowStatus,
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
