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

const refreshProjectsIndex = source.indexOf('await refreshProjects();');
const refreshSessionsIndex = source.indexOf('refreshSessions(),');
const pendingPlaceholderIndex = source.indexOf(
  'makePendingAgentPlaceholder(',
);
const sendApiIndex = source.indexOf('.send(sid,');

check(
  'loads sessions through project-scoped project API',
  source.includes('projectApi.listSessions(projectId)') &&
    !source.includes('chatSessionsApi.list(undefined, projectId)'),
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
    source.includes('agent_activity_line'),
  source,
);
check(
  'stream events create placeholders, append lines, and replace final messages',
  source.includes('insertRunningPlaceholder(parsed)') &&
    source.includes('appendStreamActivityLine(parsed.line)') &&
    source.includes(
      'upsertStreamedMessage(sid, mapBackendChatMessage(parsed.message))',
    ),
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
  'real sends insert an immediate pending agent placeholder only when routed',
  pendingPlaceholderIndex >= 0 &&
    source.includes('PENDING_AGENT_MESSAGE_PREFIX') &&
    source.includes('OPTIMISTIC_USER_MESSAGE_PREFIX') &&
    source.includes('clientMessageId: userMsgId') &&
    source.includes('fallbackMention?: string | null') &&
    source.includes('const effectiveMentions =') &&
    source.includes('explicitMentions.length === 0 ? mainAgentMention : null') &&
    source.includes('meta.client_message_id = userMsgId') &&
    pendingPlaceholderIndex < sendApiIndex,
  { pendingPlaceholderIndex, sendApiIndex },
);
check(
  'pending agent placeholders are matched by agent session instead of first item',
  source.includes('findPendingAgentPlaceholderIndex') &&
    source.includes('message.sessionAgentId === sessionAgentId') &&
    source.includes('findPendingAgentPlaceholderIndex(current, incoming.sessionAgentId)') &&
    source.includes('findPendingAgentPlaceholderIndex(') &&
    source.includes('line.session_agent_id') &&
    source.includes('event.session_agent_id') &&
    !source.includes('current.findIndex(isPendingAgentPlaceholder)'),
  source,
);
check(
  'new sends prune stale pending placeholders for the same agent session',
  source.includes('withoutStalePending') &&
    source.includes('pendingAgentMsg?.sessionAgentId') &&
    source.includes('message.sessionAgentId === pendingAgentMsg.sessionAgentId') &&
    source.includes('[...withoutStalePending, userMsg, pendingAgentMsg]'),
  source,
);
check(
  'a new run evicts stale running placeholders for the same agent session',
  source.includes('evictStaleRunPlaceholders') &&
    source.includes('message.runId !== runId') &&
    source.includes('Boolean(message.runId)') &&
    source.includes('message.sessionAgentId === sessionAgentId') &&
    /evictStaleRunPlaceholders\(\s*current,\s*event\.session_agent_id/.test(
      source,
    ) &&
    /evictStaleRunPlaceholders\(\s*current,\s*line\.session_agent_id/.test(
      source,
    ) &&
    source.includes('[...pruned, placeholder]'),
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
    source.includes("meta.chat_input_mode = 'workflow'") &&
    source.includes('const routeMentions =') &&
    source.includes("effectiveChatInputMode !== 'workflow' && routeMentions.length > 0") &&
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
  'message refresh does not drop the immediate pending placeholder before agent state catches up',
  source.includes('isOptimisticPendingAgentPlaceholder') &&
    source.includes('PENDING_AGENT_MESSAGE_PREFIX}${OPTIMISTIC_USER_MESSAGE_PREFIX}') &&
    source.includes('!isOptimisticPendingAgentPlaceholder(message)'),
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
