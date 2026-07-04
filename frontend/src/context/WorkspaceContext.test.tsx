// Smoke tests for project-scoped session loading in WorkspaceContext.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/context/WorkspaceContext.test.tsx
// Exits non-zero if any assertion fails.

import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${label}`, detail ?? '');
  }
};

console.log('WorkspaceContext project session isolation');

const source = readFileSync(
  new URL('./WorkspaceContext.tsx', import.meta.url),
  'utf8',
);
const workflowCardSource = readFileSync(
  new URL('../components/workflow/WorkflowCard.tsx', import.meta.url),
  'utf8',
);
const workflowSidebarStateSource = readFileSync(
  new URL('../lib/workflowSidebarState.ts', import.meta.url),
  'utf8',
);

const refreshAllIndex = source.indexOf('const refreshAll = useCallback');
const refreshProjectsIndex = source.indexOf('await refreshProjects();', refreshAllIndex);
const refreshSessionsIndex = source.indexOf('refreshSessions(),', refreshAllIndex);
const pendingPlaceholderIndex = source.indexOf(
  'makePendingAgentPlaceholder(',
);
const sendApiIndex = source.indexOf('.send(sid,');

check(
  'loads active sessions through status-filtered chat session API',
  source.includes("chatSessionsApi.list('active', projectId)") &&
    !source.includes('projectApi.listSessions(projectId)'),
  source,
);
check(
  'exposes project-scoped archived session loading',
  source.includes('archivedSessionsAsync') &&
    source.includes('refreshArchivedSessions') &&
    source.includes("chatSessionsApi.list('archived', projectId)"),
  source,
);
check(
  'exposes project-scoped session management actions',
  source.includes('renameSession') &&
    source.includes('archiveSession') &&
    source.includes('deleteSession') &&
    source.includes('restoreSession') &&
    /chatSessionsApi\.update\(\s*sessionId/.test(source) &&
    source.includes('chatSessionsApi.archive(sessionId)') &&
    source.includes('chatSessionsApi.delete(sessionId)') &&
    source.includes('chatSessionsApi.restore(sessionId)') &&
    source.includes('refreshSessions()') &&
    source.includes('refreshArchivedSessions()'),
  source,
);
check(
  'invalid active session selection falls back to next active or empty state',
  source.includes('syncActiveSessionSelection') &&
    source.includes('activeBackendSessions') &&
    source.includes('clearSessionScopedState();'),
  source,
);
check(
  'does not load sessions without a selected project',
  source.includes('if (!projectId)') &&
    source.includes('setSessionsAsync(succeed([]))') &&
    source.includes('clearSessionScopedState();'),
  source,
);
check(
  'drops stale session responses after project changes',
  source.includes('selectedProjectIdRef.current !== projectId'),
  source,
);
check(
  'clears visible sessions when the selected project changes',
  source.includes('previousProjectId !== id') &&
    source.includes('setSessionsAsync(succeed([]))'),
  source,
);
check(
  'loads projects before session refresh in global refresh',
  refreshProjectsIndex >= 0 &&
    refreshSessionsIndex >= 0 &&
    refreshProjectsIndex < refreshSessionsIndex,
  { refreshProjectsIndex, refreshSessionsIndex },
);
check(
  'subscribes to chat websocket stream for agent activity',
  source.includes('new WebSocket') &&
    source.includes('chatSessionsApi.streamUrl') &&
    source.includes('parsed.type ===') &&
    source.includes('agent_run_started') &&
    source.includes('agent_activity_line') &&
    source.includes('agent_delta'),
  source,
);
check(
  'stream events create placeholders, append lines, and replace final messages',
  source.includes('insertRunningPlaceholder(parsed)') &&
    source.includes('appendStreamActivityLine(parsed.line)') &&
    source.includes('upsertStreamDeltaActivityLine(parsed)') &&
    source.includes('const incomingMessage = mapBackendChatMessage(parsed.message)') &&
    source.includes('upsertStreamedMessage(sid, incomingMessage)'),
  source,
);
check(
  'agent_delta thinking is bridged into live activity lines',
  source.includes("type: 'agent_delta'") &&
    source.includes('LIVE_DELTA_ACTIVITY_LINE_PREFIX') &&
    source.includes("event.stream_type !== 'thinking'") &&
    source.includes('liveDeltaActivityLineId') &&
    source.includes('event.delta && existingLine') &&
    source.includes('activity_lines: activityLines') &&
    source.includes('liveDeltaActivityLineId(line.run_id, line.stream_type)'),
  source,
);
check(
  'workflow runtime stream lines are kept live for workflow logs',
  source.includes("type: 'workflow_runtime_line'") &&
    source.includes('workflowRuntimeLinesByExecution') &&
    source.includes('setWorkflowRuntimeLinesByExecution') &&
    source.includes('handleWorkflowRuntimeLine(parsed)') &&
    workflowCardSource.includes('workflowRuntimeLinesByExecution[projection.execution_id]') &&
    workflowCardSource.includes('runtimeMessages={workflowRuntimeMessages}'),
  { source, workflowCardSource },
);
check(
  'stream token usage messages notify build stats refresh',
  source.includes('notifyBuildStatsUsageUpdated(projectId)') &&
    /tokenUsageNotificationSignature\(\s*parsed\.message/.test(source) &&
    source.includes('notifiedTokenUsageSignaturesRef.current[parsed.message.id]') &&
    source.includes("tokenUsage.is_estimated === true"),
  source,
);
check(
  'real sends skip immediate pending placeholders for queued messages',
  pendingPlaceholderIndex >= 0 &&
    source.includes('PENDING_AGENT_MESSAGE_PREFIX') &&
    source.includes('OPTIMISTIC_USER_MESSAGE_PREFIX') &&
    source.includes('clientMessageId: userMsgId') &&
    source.includes('const shouldQueueForMember = Boolean(') &&
    source.includes('!shouldQueueForMember && pendingAgentMsg') &&
    source.includes('const messagesToAppend =') &&
    /shouldQueueForMember\s*\?\s*\[\]/.test(source) &&
    source.includes('fallbackMention?: string | null') &&
    source.includes('sendMessageToSession') &&
    source.includes('stagePendingAgentPlaceholder') &&
    source.includes('persistToBackend?: boolean') &&
    source.includes("placeholderMember?: Pick<Member, 'avatar' | 'name' | 'modelName'> | null") &&
    source.includes('const shouldPersistToBackend =') &&
    source.includes('const effectiveMentions =') &&
    source.includes('const visibleMentions =') &&
    source.includes('mentions: visibleMentions') &&
    source.includes('options.routeMentions') &&
    source.includes('meta.client_message_id = userMsgId') &&
    source.includes('upsertStreamedMessage(sid, incomingMessage)') &&
    pendingPlaceholderIndex < sendApiIndex,
  { pendingPlaceholderIndex, sendApiIndex },
);
check(
  'pending placeholders can carry display member model without stale session agent id',
  source.includes('const displayMember = fallbackMember ?? placeholderMember ?? null') &&
    source.includes('avatar: displayMember?.avatar ?? monogramFromName(sender)') &&
    source.includes('model: displayMember?.modelName') &&
    source.includes('sessionAgentId: fallbackMember?.id') &&
    source.includes('options.placeholderMember'),
  source,
);
check(
  'pending agent placeholders are matched by correlation ids before fallback',
  source.includes('findPendingAgentPlaceholderIndex') &&
    source.includes('pendingPlaceholderMatches') &&
    source.includes('message.clientMessageId === match.clientMessageId') &&
    source.includes('message.sourceMessageId === match.sourceMessageId') &&
    source.includes('const hasCorrelationId = Boolean(') &&
    /!hasCorrelationId\s*&&\s*match\.sessionAgentId/.test(source) &&
    source.includes('message.sessionAgentId === match.sessionAgentId') &&
    source.includes('clientMessageId: incoming.clientMessageId') &&
    source.includes('clientMessageId: event.client_message_id') &&
    !source.includes('current.findIndex(isPendingAgentPlaceholder)'),
  source,
);
check(
  'new sends prune stale pending placeholders only for immediate execution',
  source.includes('withoutStalePending') &&
    source.includes('!shouldQueueForMember && pendingAgentMsg?.sessionAgentId') &&
    source.includes('message.sessionAgentId === pendingAgentMsg.sessionAgentId') &&
    source.includes('[...withoutStalePending, ...messagesToAppend]'),
  source,
);
check(
  'workflow plan cards do not suppress optimistic agent placeholders',
  !source.includes('const isWorkflowPlanCardMessage =') &&
    !source.includes('const hasWorkflowPlanCard =') &&
    !source.includes('shouldCreatePendingAgentPlaceholder') &&
    /const pendingAgentMsg = shouldPersistToBackend\s*\?\s*makePendingAgentPlaceholder/.test(
      source,
    ),
  source,
);
check(
  'a new run evicts stale running placeholders for the same agent session',
  source.includes('evictStaleRunPlaceholders') &&
    source.includes('message.runId !== runId') &&
    source.includes('Boolean(message.runId)') &&
    source.includes('message.sessionAgentId === sessionAgentId') &&
    /evictStaleRunPlaceholders\(\s*currentWithoutQueuedSource,\s*event\.session_agent_id/.test(source) &&
    /evictStaleRunPlaceholders\(\s*current,\s*line\.session_agent_id/.test(
      source,
    ) &&
    source.includes('orderMessagesForConversation([') &&
    source.includes('...pruned,') &&
    source.includes('placeholder,'),
  source,
);
check(
  'quoted messages are sent through backend reference meta instead of message content',
  source.includes('options: SendMessageOptions = {}') &&
    source.includes('quotedMessage: options.quotedMessage') &&
    source.includes('referenceMessageId: options.quotedMessage?.id') &&
    source.includes('meta.reference = { message_id: options.quotedMessage.id }') &&
    source.includes('resolveQuotedMessageReferences') &&
    source.includes('content: text') &&
    !source.includes('reference_message_id: options.quotedMessage') &&
    !source.includes('meta.quoted_message') &&
    !source.includes('> ${quotedMessage.sender}:'),
  source,
);
check(
  'syncs and sends workflow chat input mode like the legacy frontend',
  source.includes("type ChatInputMode = 'free' | 'workflow'") &&
    source.includes('resolveChatInputMode(session.chat_input_mode)') &&
    source.includes('chatSessionsApi') &&
    source.includes('chat_input_mode: toSessionChatInputMode(nextMode)') &&
    source.includes('setSessionChatInputMode') &&
    source.includes("meta.chat_input_mode = 'workflow'") &&
    source.includes('const routeMentions =') &&
    source.includes('const shouldPersistRouteMentions =') &&
    source.includes("effectiveChatInputMode !== 'workflow' ||") &&
    source.includes('meta.mentions = routeMentions'),
  source,
);
check(
  'derives the plan-mode main agent from the project lead member',
  source.includes('resolveProjectMainAgentName') &&
    source.includes('resolveProjectMainAgentId') &&
    source.includes("member.member_type === 'agent' && member.role === 'lead'") &&
    source.includes('const mainAgentName = resolveProjectMainAgentName(projectMembers, agents)') &&
    source.includes('setMainAgentName(mainAgentName)') &&
    source.includes('mainAgentName,'),
  source,
);
check(
  'routes workflow input mode messages to the project main agent',
  source.includes('sessionLeadAgentIdBySessionIdRef') &&
    source.includes('workflowRouteAgentIdRef') &&
    source.includes('const syncSessionLeadAgent = useCallback') &&
    source.includes("chatSessionUpdatePayload({ lead_agent_id: agentId })") &&
    source.includes('const hasMainAgentInSession') &&
    source.includes('void syncSessionLeadAgent(sid, mainAgentId)') &&
    source.includes('ensureWorkflowRouteToMainAgent') &&
    source.includes('await syncSessionLeadAgent(sid, workflowLeadAgentId)'),
  source,
);
check(
  'message refresh preserves running placeholders until stream replacement',
  source.includes('mergePersistedWithRunningPlaceholders') &&
    source.includes('isPendingAgentPlaceholder') &&
    source.includes('isOptimisticUserMessage') &&
    source.includes('persistedClientMessageIds') &&
    source.includes('pendingIndex') &&
    source.includes('activeSessionAgentIds') &&
    source.includes('isActiveAgentState(sessionAgent.state)') &&
    source.includes('!isActiveAgentState(parsed.state)'),
  source,
);
check(
  'agent run placeholders and final replies stay anchored to their source message',
  source.includes('orderMessagesForConversation') &&
    source.includes('firstMessageSourceKey') &&
    source.includes('message.sourceMessageId && sourceKeys.has(message.sourceMessageId)') &&
    source.includes('message.clientMessageId && sourceKeys.has(message.clientMessageId)') &&
    source.includes('replacementIndex') &&
    source.includes('orderMessagesForConversation(correlatedNext)') &&
    source.includes('insertMessageByCreatedAt') &&
    source.includes('createdAt: event.started_at ?? new Date().toISOString()') &&
    source.includes('createdAt: run?.created_at ?? sessionAgent.updated_at'),
  source,
);
check(
  'hydrated run placeholders keep the optimistic pending placeholder anchor',
  source.includes('correlateRunningPlaceholdersWithPending') &&
    source.includes('pendingBySessionAgentId') &&
    source.includes('pendingBySender') &&
    source.includes('orphanPending') &&
    source.includes('pendingPlaceholderSenderKey') &&
    source.includes('consumedPendingPlaceholderIds') &&
    source.includes('senderMatches.length === 1') &&
    source.includes('runningPlaceholders.length === 1') &&
    source.includes('sourceMessageId: pending.sourceMessageId') &&
    source.includes('clientMessageId: pending.clientMessageId') &&
    source.includes('createdAt: pending.createdAt ?? placeholder.createdAt') &&
    !source.includes('!placeholder.runId ||') &&
    source.includes('...correlated.current') &&
    source.includes('...correlated.runningPlaceholders'),
  source,
);
check(
  'hydrated activity does not drop source-message anchors from live placeholders',
  source.includes('mergeCarriedRunPlaceholder') &&
    source.includes('incomingLineCount > existingLineCount') &&
    source.includes('primary.sourceMessageId ?? secondary.sourceMessageId') &&
    source.includes('primary.clientMessageId ?? secondary.clientMessageId') &&
    source.includes('secondaryHasAnchor') &&
    source.includes('mergeCarriedRunPlaceholder(existing, message)'),
  source,
);
check(
  'visible messages are scoped to the active session cache',
  source.includes('const allMessagesRef = useRef<Record<string, Message[]>>({})') &&
    source.includes('withSessionIdsBySession') &&
    source.includes('filterMessagesForSession') &&
    source.includes('userIndexByClientId') &&
    source.includes('isOptimisticUserMessage(existing)') &&
    source.includes('messagesRequestIdRef') &&
    source.includes('shouldUpdateActiveMessages') &&
    /filterMessagesForSession\(\s*activeSessionId/.test(source) &&
    source.includes('filterMessagesForSession(sid, prev[sid] ?? [])') &&
    source.includes('filterQueuedUserMessagesFromSnapshot(') &&
    source.includes('activeSessionIdRef.current === sid'),
  source,
);
check(
  'optimistic user messages carry their owning session id',
  source.includes('sessionId?: string') &&
    source.includes('sessionId: sid') &&
    source.includes('sessionId,') &&
    source.includes('sessionId: line.session_id') &&
    source.includes('sessionId: event.session_id'),
  source,
);
check(
  'message refresh does not drop the immediate pending placeholder before agent state catches up',
  source.includes('isOptimisticPendingAgentPlaceholder') &&
    source.includes('PENDING_AGENT_MESSAGE_PREFIX}${OPTIMISTIC_USER_MESSAGE_PREFIX}') &&
    source.includes('!isOptimisticPendingAgentPlaceholder(message)'),
  source,
);
check(
  'optimistically stopped agents do not keep session running indicators active',
  source.includes('ignoredSessionAgentIds?: ReadonlySet<string>') &&
    source.includes('!ignoredSessionAgentIds?.has(sessionAgent.id)') &&
    source.includes('optimisticallyStoppedSessionAgentIdsRef.current') &&
    source.includes('hasRemainingRunningAgent') &&
    source.includes('setSessionRunningIndicator(sid, hasRemainingRunningAgent)') &&
    source.includes('message.sessionAgentId !== parsed.session_agent_id') &&
    source.includes('wasStopRequested'),
  source,
);
check(
  'stop-requested agent placeholders remain visible until the stopped message replaces them',
  source.includes('persisted stop') &&
    source.includes('!isActiveAgentState(parsed.state) && !wasStopRequested') &&
    source.includes('optimisticallyStoppedSessionAgentIdsRef.current.delete') &&
    source.includes('nextMessage.sessionAgentId'),
  source,
);
check(
  'agent completion highlights persist until the session is opened',
  source.includes('UNREAD_AGENT_COMPLETION_SESSION_IDS_STORAGE_KEY') &&
    source.includes('RUNNING_AGENT_SESSION_IDS_STORAGE_KEY') &&
    source.includes('runningAgentSessionIdsRef') &&
    source.includes('unreadAgentCompletionSessionIdsRef') &&
    source.includes('syncSessionAgentActivityIndicator') &&
    source.includes('hasUnreadAgentCompletion') &&
    source.includes('clearUnreadAgentCompletion(activeSessionId)'),
  source,
);
check(
  'workflow input highlights persist until the session is opened',
  source.includes('ACKED_WORKFLOW_INPUT_IDS_STORAGE_KEY') &&
    source.includes('acknowledgedWorkflowInputIdsRef') &&
    source.includes('syncSessionWorkflowInputIndicator') &&
    source.includes('hasPendingWorkflowInput') &&
    source.includes('pendingWorkflowInputId') &&
    source.includes('clearPendingWorkflowInput(activeSessionId)'),
  source,
);
check(
  'workflow review status is tracked for the sidebar activity icon',
  source.includes('pending_workflow_review_id') &&
    source.includes('sidebar_workflow_state') &&
    source.includes('workflowSidebarState') &&
    source.includes('pendingWorkflowReviewId') &&
    source.includes('hasPendingWorkflowReview'),
  source,
);
check(
  'workflow card refresh syncs session workflow sidebar status through the shared loader',
  source.includes('refreshSessionWorkflowStatus') &&
    source.includes('loadSessionWorkflowStatus') &&
    source.includes('sessionWorkflowStatusRequestsRef') &&
    /workflowApi\s*\.\s*getSessionStatus\(sessionId\)/.test(source) &&
    workflowCardSource.includes('refreshSessionWorkflowStatus') &&
    workflowCardSource.includes('void refreshSessionWorkflowStatus(sessionId)'),
  { source, workflowCardSource },
);
check(
  'workflow iteration acceptance requests a source-control refresh',
  workflowCardSource.includes('notifySourceControlRefreshRequested') &&
    workflowCardSource.includes("payload.action === 'accept'") &&
    workflowCardSource.includes('notifySourceControlRefreshRequested({ sessionId })'),
  workflowCardSource,
);
check(
  'workflow sidebar running states are centralized',
  source.includes("from '@/lib/workflowSidebarState'") &&
    workflowSidebarStateSource.includes('workflowRunningSidebarStates') &&
    workflowSidebarStateSource.includes('workflowNonRunningSidebarStates') &&
    workflowSidebarStateSource.includes('resolveWorkflowSidebarState') &&
    workflowSidebarStateSource.includes('hasRunningWorkflowActivity') &&
    workflowCardSource.includes('refreshSessionWorkflowStatus'),
  { source, workflowSidebarStateSource, workflowCardSource },
);
check(
  'polls non-active running and waiting workflow sessions so sidebar icons update',
  source.includes('SIDEBAR_RUNNING_INDICATOR_POLL_MS') &&
    source.includes('runningSidebarSessionIds') &&
    source.includes('session.id !== activeSessionId') &&
    source.includes('session.hasRunningAgent') &&
    source.includes('hasRunningWorkflowActivity(session)') &&
    source.includes('session.hasPendingWorkflowInput') &&
    source.includes('session.hasPendingWorkflowReview') &&
    source.includes('refreshRunningSidebarSessions') &&
    source.includes('window.setInterval(') &&
    source.includes('refreshSessionRunningIndicators(sessionId)'),
  source,
);
check(
  'pending placeholders are correlated and protected across refresh and stale agent state',
  source.includes('PendingPlaceholderMatch') &&
    source.includes('pendingPlaceholderMatches') &&
    source.includes('clientMessageId: event.client_message_id') &&
    source.includes('sourceMessageId: event.source_message_id') &&
    source.includes('msg.runId === parsed.run_id') &&
    source.includes("parsed.type === 'mention_error'"),
  source,
);
check(
  'message refresh hydrates active run activity after page reload',
    source.includes('hydrateRunningAgentPlaceholders') &&
    source.includes('chatRunsApi.listSessionRetention') &&
    source.includes('.getActivity(run.run_id') &&
    source.includes('sessionAgentId: sessionAgent.id') &&
    source.includes("activityLoadState: 'idle'"),
  source,
);
check(
  'message refresh keeps a running placeholder even before a run row exists',
  source.includes('const run = latestRunBySessionAgentId.get(sessionAgent.id)') &&
    /id:\s*run\s*\?/.test(source) &&
    source.includes('PENDING_AGENT_MESSAGE_PREFIX}running-${sessionAgent.id}') &&
    source.includes('runId: run?.run_id'),
  source,
);
check(
  'running placeholders carry session agent ids for stop controls',
  source.includes('sessionAgentId: fallbackMember?.id') &&
    source.includes('sessionAgentId: line.session_agent_id') &&
    source.includes('sessionAgentId: event.session_agent_id') &&
    source.includes('carriedSessionAgentId'),
  source,
);
check(
  'persists chat message font size preference',
  source.includes('CHAT_MESSAGE_FONT_SIZE_OPTIONS = [13, 14, 15, 16]') &&
    source.includes('openteams-chat-message-font-size') &&
    source.includes('openteams-agent-markdown-font-size') &&
    source.includes('chatMessageFontSize') &&
    source.includes('setChatMessageFontSize') &&
    source.includes('normalizeChatMessageFontSize'),
  source,
);

check(
  'supports following the operating system theme preference',
  source.includes('ThemePreference') &&
    source.includes('const resolveSystemTheme =') &&
    source.includes("'(prefers-color-scheme: light)'") &&
    source.includes('themePreference ===') &&
    source.includes('setThemePreferenceState(t)') &&
    source.includes("localStorage.setItem('openteams-design-mode', t)") &&
    source.includes("document.body.setAttribute('data-mode', theme)") &&
    source.includes('themePreference,'),
  source,
);

check(
  'syncs member queue snapshots from REST and websocket updates',
  source.includes('memberQueuesBySessionAgentId') &&
    source.includes('chatQueuesApi.listSession(sid)') &&
    source.includes("parsed.type === 'queue_updated'") &&
    source.includes('mergeMemberQueueSnapshot(parsed.queue)') &&
    source.includes('void refreshMemberQueues()') &&
    source.includes('chatQueuesApi.deleteQueued(sessionId, queueId)') &&
    source.includes('chatQueuesApi.continueMember('),
  source,
);

check(
  'stages optimistic queued state for sends that target busy or blocked members',
  source.includes('stageOptimisticQueuedMessage') &&
    source.includes('shouldQueueForMember && pendingAgentMsg?.sessionAgentId') &&
    source.includes('current?.session_id === sessionId') &&
    source.includes('session_id: sessionId') &&
    source.includes("targetMember?.status === 'run'") &&
    source.includes('existingQueue?.blocked') &&
    source.includes('existingQueue?.paused') &&
    source.includes('queued_count: BigInt(') &&
    source.includes('void refreshMemberQueues()'),
  source,
);

check(
  'derives queued user visibility from persisted queue snapshots',
  source.includes('queuedChatMessageKeysForSession') &&
    source.includes('isQueuedUserMessageFromSnapshot') &&
    source.includes('filterQueuedUserMessagesFromSnapshot') &&
    source.includes('queuedUserMessagesByIdFromSnapshot') &&
    source.includes("String(item.message.status) !== 'queued'") &&
    source.includes('item.message.chat_message_id') &&
    source.includes('chatQueuesApi.listSession(sid).catch') &&
    source.includes('queueResponse.members') &&
    source.includes('queuedUserMessagesById,') &&
    source.includes('ensureQueuedRunSourceMessage') &&
    /chatMessagesApi\.get\(\s*event\.source_message_id/.test(source) &&
    source.includes('insertQueuedBackendUserMessage') &&
    !source.includes('deferredQueuedMessageIdsRef') &&
    !source.includes('deferredQueuedClientMessageIdsRef') &&
    !source.includes('deferredQueuedUserMessagesRef') &&
    !source.includes('rememberDeferredQueuedUserMessage') &&
    !source.includes('releaseDeferredQueuedUserMessage'),
  source,
);
check(
  'run source hydration does not evict user messages from non-user source client ids',
  /const sourceClientMessageId = message\.isUser\s*\?\s*userMessageClientId\(message\)\s*:\s*undefined;/.test(
    source,
  ) &&
    /message\.isUser\s*\?\s*!matchesUserMessageIdentity\([\s\S]*sourceClientMessageId[\s\S]*\)\s*:\s*candidate\.id !== message\.id/.test(
      source,
    ),
  source,
);

check(
  'guards workspace change refreshes against stale responses',
  source.includes('workspaceChangesRequestIdRef') &&
    source.includes('workspaceChangesRequestIdRef.current !== requestId'),
  source,
);

check(
  'exposes resetWorkspaceChanges',
  source.includes('resetWorkspaceChanges: () => void') &&
    source.includes('resetWorkspaceChanges,'),
  source,
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll WorkspaceContext isolation assertions passed.');
}
