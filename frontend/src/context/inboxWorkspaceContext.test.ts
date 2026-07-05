// Smoke tests for centralized inbox notification state in WorkspaceContext.
//
// Run with:
//     pnpm exec tsx src/context/inboxWorkspaceContext.test.ts

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

console.log('WorkspaceContext inbox behavior');

const source = readFileSync(
  new URL('./WorkspaceContext.tsx', import.meta.url),
  'utf8',
);
const autoReadableStart = source.indexOf('const isAutoReadableInboxItem');
const autoReadableEnd = source.indexOf('const isThemePreference', autoReadableStart);
const autoReadableSource =
  autoReadableStart >= 0 && autoReadableEnd > autoReadableStart
    ? source.slice(autoReadableStart, autoReadableEnd)
    : '';
const runningSidebarRefreshStart = source.indexOf(
  'const refreshRunningSidebarSessions = () => {',
);
const runningSidebarRefreshEnd = source.indexOf(
  'const intervalId = window.setInterval',
  runningSidebarRefreshStart,
);
const runningSidebarRefreshSource =
  runningSidebarRefreshStart >= 0 &&
  runningSidebarRefreshEnd > runningSidebarRefreshStart
    ? source.slice(runningSidebarRefreshStart, runningSidebarRefreshEnd)
    : '';

check(
  'centralizes inbox summary and unread list state in WorkspaceContext',
  source.includes('inboxSummaryAsync') &&
    source.includes('inboxItemsAsync') &&
    source.includes('const refreshInbox = useCallback') &&
    source.includes('inboxApi.getSummary') &&
    source.includes('inboxApi.listItems') &&
    source.includes('unread: true') &&
    source.includes('archived: false'),
  source,
);

check(
  'preserves inbox data on API failures and refreshes lightly',
  source.includes('setInboxSummaryAsync((prev) => fail(prev, err))') &&
    source.includes('setInboxItemsAsync((prev) => fail(prev, err))') &&
    source.includes('INBOX_LIGHT_REFRESH_DELAY_MS') &&
    source.includes('scheduleInboxRefresh()') &&
    source.includes('INBOX_REFRESH_INTERVAL_MS'),
  source,
);

check(
  'auto-marks only active-session chat message inbox items as read',
  source.includes('isAutoReadableInboxItem') &&
    source.includes('item.session_id === activeSessionId') &&
    source.includes('autoMarkedInboxItemIdsRef') &&
    source.includes('void markInboxItemsRead(ids).catch') &&
    source.includes("item.kind === 'chat_message'") &&
    source.includes("item.source_type === 'chat_message'"),
  source,
);

check(
  'keeps workflow pending inbox items out of the active-session auto-read rule',
  autoReadableSource.includes("item.kind === 'chat_message'") &&
    autoReadableSource.includes("item.source_type === 'chat_message'") &&
    !autoReadableSource.includes('workflow_'),
  autoReadableSource,
);

check(
  'refreshes inbox while polling non-active attention sessions before Bell opens',
  runningSidebarRefreshSource.includes(
    'void refreshSessionRunningIndicators(sessionId);',
  ) && runningSidebarRefreshSource.includes('scheduleInboxRefresh();'),
  runningSidebarRefreshSource,
);

check(
  'exposes inbox mark-read and archive actions through context',
  source.includes('markInboxItemRead') &&
    source.includes('markInboxItemsRead') &&
    source.includes('markAllInboxRead') &&
    source.includes('archiveInboxItem') &&
    source.includes('inboxApi.markRead') &&
    source.includes('inboxApi.markManyRead') &&
    source.includes('inboxApi.markAllRead') &&
    source.includes('inboxApi.archive'),
  source,
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} WorkspaceContext inbox assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll WorkspaceContext inbox assertions passed.');
}
