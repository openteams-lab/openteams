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

const refreshProjectsIndex = source.indexOf('await refreshProjects();');
const refreshSessionsIndex = source.indexOf('refreshSessions(),');
const pendingPlaceholderIndex = source.indexOf(
  'makePendingAgentPlaceholder(text, userMsgId',
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
  'stream token usage messages notify build stats refresh',
  source.includes('notifyBuildStatsUsageUpdated(projectId)') &&
    source.includes('hasRealCompleteTokenUsage(parsed.message)') &&
    source.includes("tokenUsage.is_estimated === true"),
  source,
);
check(
  'real sends insert an immediate pending agent placeholder',
  pendingPlaceholderIndex >= 0 &&
    source.includes('PENDING_AGENT_MESSAGE_PREFIX') &&
    pendingPlaceholderIndex < sendApiIndex,
  { pendingPlaceholderIndex, sendApiIndex },
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
  'message refresh preserves running placeholders until stream replacement',
  source.includes('mergePersistedWithRunningPlaceholders') &&
    source.includes('isPendingAgentPlaceholder') &&
    source.includes('pendingIndex'),
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

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll WorkspaceContext isolation assertions passed.');
}
