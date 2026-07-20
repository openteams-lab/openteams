import { useCallback, useEffect } from 'react';
import type { BackendChatMessage, MemberQueueSnapshot, Message } from '@/types';
import {
  chatMessagesApi,
  chatSessionsApi,
} from '@/lib/api';
import { mapMessage, monogramFromName } from '@/lib/mappers';
import { resolveMessageReferences } from '@/lib/messageReferences';
import { notifyBuildStatsUsageUpdated } from '@/lib/buildStatsEvents';
import { notifySourceControlRefreshRequested } from '@/lib/sourceControlEvents';
import type { WorkspaceContextProps } from './workspaceContextContract';
import type { ChatStreamEvent } from './workspaceChatStreamTypes';
import type { RuntimeActiveRun } from './workspaceContextTypes';
import { useWorkspaceState } from './useWorkspaceState';
import {
  CHAT_STREAM_RECONNECT_BASE_DELAY_MS,
  CHAT_STREAM_RECONNECT_MAX_DELAY_MS,
  chatStreamWebSocketUrl,
  filterMessagesForSession,
  findRunningPlaceholderIndexesForIncoming,
  isOptimisticPendingAgentPlaceholder,
  isPendingAgentPlaceholder,
  isRunningSessionAgentState,
  matchesUserMessageIdentity,
  memberNotFoundToastMessage,
  orderMessagesForConversation,
  pendingPlaceholderMatches,
  tokenUsageNotificationSignature,
  userMessageClientId,
} from './workspaceContextUtils';

type WorkspaceState = ReturnType<typeof useWorkspaceState>;

type ChatRuntimeOptions = WorkspaceState & {
  mergeMemberQueueSnapshot: (queue: MemberQueueSnapshot) => void;
  refreshMemberQueues: WorkspaceContextProps['refreshMemberQueues'];
  refreshMembers: WorkspaceContextProps['refreshMembers'];
  refreshMessages: WorkspaceContextProps['refreshMessages'];
  refreshSessionRunningIndicators: (sessionId: string) => Promise<void>;
  refreshSessionWorkflowStatus: WorkspaceContextProps['refreshSessionWorkflowStatus'];
  refreshSessions: WorkspaceContextProps['refreshSessions'];
  refreshWorkspaceChanges: WorkspaceContextProps['refreshWorkspaceChanges'];
  scheduleInboxRefresh: () => void;
};

export const useWorkspaceChatRuntime = (options: ChatRuntimeOptions) => {
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
    mergeMemberQueueSnapshot,
    refreshMemberQueues,
    refreshMembers,
    refreshMessages,
    refreshSessionRunningIndicators,
    refreshSessionWorkflowStatus,
    refreshSessions,
    refreshWorkspaceChanges,
    scheduleInboxRefresh,
  } = options;
  const mapBackendChatMessage = useCallback(
    (message: BackendChatMessage): Message =>
      mapMessage(message, {
        agentNamesById: agentNamesByIdRef.current,
        agentModelsById: agentModelsByIdRef.current,
      }),
    [],
  );

  const insertQueuedBackendUserMessage = useCallback(
    (sid: string, runId: string, message: Message) => {
      setAllMessages((prev) => {
        const current = filterMessagesForSession(sid, prev[sid] ?? []);
        const sourceClientMessageId = message.isUser
          ? userMessageClientId(message)
          : undefined;
        const withoutExistingSourceMessage = current.filter((candidate) =>
          message.isUser
            ? !matchesUserMessageIdentity(
                candidate,
                message.id,
                sourceClientMessageId,
              )
            : candidate.id !== message.id,
        );

        const runIndex = withoutExistingSourceMessage.findIndex(
          (candidate) => candidate.isAgentRunning && candidate.runId === runId,
        );
        const next = [...withoutExistingSourceMessage];
        next.splice(runIndex >= 0 ? runIndex : next.length, 0, message);
        return { ...prev, [sid]: resolveMessageReferences(next) };
      });
    },
    [],
  );

  const ensureQueuedRunSourceMessage = useCallback(
    async (
      event: Extract<ChatStreamEvent, { type: 'agent_run_started' }>,
    ): Promise<void> => {
      try {
        const backendMessage = await chatMessagesApi.get(
          event.source_message_id,
        );
        insertQueuedBackendUserMessage(
          event.session_id,
          event.run_id,
          mapBackendChatMessage(backendMessage),
        );
      } catch {
        // Source-message hydration is best-effort; the running placeholder still shows.
      }
    },
    [insertQueuedBackendUserMessage, mapBackendChatMessage],
  );

  const upsertStreamedMessage = useCallback(
    (sid: string, incoming: Message) => {
      setAllMessages((prev) => {
        const current = filterMessagesForSession(sid, prev[sid] ?? []);
        let carriedSessionAgentId = incoming.sessionAgentId;
        let carriedSourceMessageId = incoming.sourceMessageId;
        let carriedClientMessageId = incoming.clientMessageId;
        const matchingPlaceholderIndexes = new Set(
          findRunningPlaceholderIndexesForIncoming(current, incoming),
        );
        let replacementIndex: number | null = null;
        const withoutPlaceholder = current.filter((message, index) => {
          if (matchingPlaceholderIndexes.has(index)) {
            replacementIndex =
              replacementIndex === null
                ? index
                : Math.min(replacementIndex, index);
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
          [sid]: resolveMessageReferences(
            orderMessagesForConversation(correlatedNext),
          ),
        };
      });
    },
    [],
  );

  const insertRunningPlaceholder = useCallback(
    (event: Extract<ChatStreamEvent, { type: 'agent_run_started' }>) => {
      // A new run for this agent supersedes any optimistic-stop suppression.
      optimisticallyStoppedSessionAgentIdsRef.current.delete(
        event.session_agent_id,
      );
      setSessionRunningIndicator(event.session_id, true);
      void ensureQueuedRunSourceMessage(event);
      setActiveRunsByRunId((prev) => {
        const displayName = event.agent_name.startsWith('@')
          ? event.agent_name
          : `@${event.agent_name}`;
        const nextRun: RuntimeActiveRun = {
          run_id: event.run_id,
          session_id: event.session_id,
          session_agent_id: event.session_agent_id,
          agent_id: event.agent_id,
          agent_name: event.agent_name,
          display_name: displayName,
          avatar: monogramFromName(event.agent_name),
          model: event.model ?? agentModelsByIdRef.current[event.agent_id] ?? null,
          status: 'running',
          source_message_id: event.source_message_id,
          client_message_id: event.client_message_id ?? null,
          created_at: event.started_at ?? new Date().toISOString(),
        };
        const next = { ...prev };
        for (const [runId, run] of Object.entries(next)) {
          if (
            run.session_agent_id === event.session_agent_id &&
            runId !== event.run_id
          ) {
            delete next[runId];
          }
        }
        next[event.run_id] = nextRun;
        return next;
      });
    },
    [ensureQueuedRunSourceMessage, setSessionRunningIndicator],
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
        parsed.type === 'agent_activity_updated' &&
        parsed.session_id === sid
      ) {
        runActivityStore.notifyUpdated(
          parsed.run_id,
          parsed.latest_sequence,
        );
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
        scheduleInboxRefresh();
        return;
      }

      if (
        parsed.type === 'file_change_refresh' &&
        parsed.session_id === sid
      ) {
        const projectId = selectedProjectIdRef.current;
        notifySourceControlRefreshRequested({
          projectId,
          sessionId: sid,
        });
        const workspacePath = activeWorkspacePathRef.current;
        if (!projectId && workspacePath) {
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
        upsertStreamedMessage(sid, incomingMessage);
        if (incomingMessage.runId) {
          setActiveRunsByRunId((prev) => {
            if (!incomingMessage.runId || !prev[incomingMessage.runId]) {
              return prev;
            }
            const next = { ...prev };
            delete next[incomingMessage.runId];
            return next;
          });
        }
        scheduleInboxRefresh();
        return;
      }

      if (parsed.type === 'agent_state') {
        if (
          parsed.run_id &&
          !isRunningSessionAgentState(parsed.state)
        ) {
          runActivityStore.requestCompletion(parsed.run_id);
        }
        if (isRunningSessionAgentState(parsed.state)) {
          setSessionRunningIndicator(sid, true);
        } else {
          setActiveRunsByRunId((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const [runId, run] of Object.entries(next)) {
              if (
                run.session_agent_id === parsed.session_agent_id &&
                (!parsed.run_id || runId === parsed.run_id)
              ) {
                delete next[runId];
                changed = true;
              }
            }
            const hasRemainingRunningAgent = Object.values(next).some(
              (run) => run.session_id === sid,
            );
            setSessionRunningIndicator(sid, hasRemainingRunningAgent);
            return changed ? next : prev;
          });
          void refreshSessionWorkflowStatus(sid);
        }
        void refreshMembers();
        return;
      }

      if (parsed.type === 'mention_error' && parsed.session_id === sid) {
        if (parsed.reason === 'member_not_found') {
          showToast(
            memberNotFoundToastMessage(locale, parsed.agent_name),
            'error',
          );
        }
        setAllMessages((prev) => {
          const current = filterMessagesForSession(sid, prev[sid] ?? []);
          if (current.length === 0) return prev;
          const updated = current.filter(
            (msg) =>
              !(
                isOptimisticPendingAgentPlaceholder(msg) &&
                pendingPlaceholderMatches(msg, {
                  clientMessageId: parsed.client_message_id,
                  sourceMessageId: parsed.message_id,
                  agentName: parsed.agent_name,
                })
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
          const projectId = selectedProjectIdRef.current;
          if (projectId) {
            notifySourceControlRefreshRequested({
              projectId,
              sessionId: sid,
            });
          }
          const workspacePath = activeWorkspacePathRef.current;
          if (!projectId && workspacePath) {
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
    handleWorkflowRuntimeLine,
    insertRunningPlaceholder,
    locale,
    mapBackendChatMessage,
    mergeMemberQueueSnapshot,
    refreshMessages,
    refreshMemberQueues,
    refreshSessionRunningIndicators,
    refreshSessionWorkflowStatus,
    refreshWorkspaceChanges,
    refreshMembers,
    runActivityStore,
    scheduleInboxRefresh,
    setSessionRunningIndicator,
    setSessionWorkflowRunningIndicator,
    sessionsAsync.source,
    upsertStreamedMessage,
  ]);

  useEffect(() => {
    const syncVisibleRuns = () => {
      if (document.visibilityState !== 'visible' || !activeSessionId) return;
      runActivityStore.syncRuns(
        Object.values(activeRunsByRunId)
          .filter((run) => run.session_id === activeSessionId)
          .map((run) => run.run_id),
      );
    };
    document.addEventListener('visibilitychange', syncVisibleRuns);
    return () => {
      document.removeEventListener('visibilitychange', syncVisibleRuns);
    };
  }, [activeRunsByRunId, activeSessionId, runActivityStore]);

  useEffect(() => {
    if (!initialRefreshCompletedRef.current) return;
    void refreshSessions();
  }, [refreshSessions, selectedProjectId]);

  return {
    mapBackendChatMessage,
    upsertStreamedMessage,
  };
};
