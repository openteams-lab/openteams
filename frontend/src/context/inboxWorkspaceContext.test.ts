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
const autoReadableEnd = source.indexOf(
  'const isThemePreference',
  autoReadableStart,
);
const autoReadableSource =
  autoReadableStart >= 0 && autoReadableEnd > autoReadableStart
    ? source.slice(autoReadableStart, autoReadableEnd)
    : '';
const refreshInboxStart = source.indexOf(
  'const refreshInbox = useCallback(async (): Promise<void> => {',
);
const refreshInboxEnd = source.indexOf(
  'const scheduleInboxRefresh = useCallback',
  refreshInboxStart,
);
const refreshInboxSource =
  refreshInboxStart >= 0 && refreshInboxEnd > refreshInboxStart
    ? source.slice(refreshInboxStart, refreshInboxEnd)
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
  'auto-marks only non-initial active-session chat message inbox items as read',
  source.includes('isAutoReadableInboxItem') &&
    source.includes('item.session_id === activeSessionId') &&
    source.includes('autoMarkedInboxItemIdsRef') &&
    source.includes('inboxInitialUnreadItemIdsRef') &&
    source.includes('void markInboxItemsRead(ids).catch') &&
    source.includes("item.kind === 'chat_message'") &&
    source.includes("item.source_type === 'chat_message'") &&
    source.includes('!inboxInitialUnreadItemIdsRef.current.has(item.id)'),
  source,
);

check(
  'keeps Bell unread items from initial page hydration until explicit read',
  refreshInboxSource.includes('inboxAutoReadProjectIdRef') &&
    refreshInboxSource.includes('inboxInitialUnreadItemIdsRef.current = new Set') &&
    refreshInboxSource.includes('visibleItems.map((item) => item.id)') &&
    source.includes('inboxAutoReadProjectIdRef.current = null') &&
    source.includes('autoMarkedInboxItemIdsRef.current = new Set()'),
  { refreshInboxSource, source },
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
  'filters Bell reminders by source and emits configured sound/system notifications',
  !source.includes("from '@/lib/inboxNotificationSound'") &&
    refreshInboxSource.includes('filterInboxSummaryForEnabledSources') &&
    refreshInboxSource.includes('filterInboxItemsForEnabledSources') &&
    refreshInboxSource.includes('inboxNotificationSettingsSignature') &&
    source.includes('const playInboxNotificationSound') &&
    source.includes('const showInboxSystemNotification') &&
    source.includes('notificationConfig.push_enabled') &&
    source.includes('new BrowserNotification') &&
    source.includes('BrowserNotification.permission') &&
    source.includes('push_enabled: notificationConfig.push_enabled') &&
    refreshInboxSource.includes(
      'showInboxSystemNotification(configAsync.data, newUnreadItems)',
    ) &&
    refreshInboxSource.includes(
      'playInboxNotificationSound(configAsync.data, newUnreadItems)',
    ) &&
    refreshInboxSource.includes('inboxSoundSettingsSignatureRef') &&
    refreshInboxSource.includes('inboxSoundPrimedRef') &&
    refreshInboxSource.includes('inboxUnreadSoundIdsRef') &&
    !refreshInboxSource.includes('showToast'),
  refreshInboxSource,
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
