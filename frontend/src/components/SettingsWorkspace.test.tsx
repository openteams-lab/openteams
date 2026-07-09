// Smoke tests for archived session management in SettingsWorkspace.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/components/SettingsWorkspace.test.tsx
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

console.log('SettingsWorkspace archived sessions');

const settingsSource = readFileSync(
  new URL('./SettingsWorkspace.tsx', import.meta.url),
  'utf8',
);
const mockSource = readFileSync(
  new URL('../mockApiData.ts', import.meta.url),
  'utf8',
);

const requiredLocaleKeys = [
  'settings.menu.item.archivedSessions',
  'settings.archivedSessions.title',
  'settings.archivedSessions.desc',
  'settings.archivedSessions.empty',
  'settings.archivedSessions.loading',
  'settings.archivedSessions.error',
  'settings.archivedSessions.restore',
  'settings.archivedSessions.restoring',
  'settings.archivedSessions.delete',
  'settings.archivedSessions.deleting',
  'settings.archivedSessions.deleteConfirmTitle',
  'settings.archivedSessions.deleteConfirmDesc',
  'settings.archivedSessions.deleteFailed',
  'settings.archivedSessions.restoreFailed',
  'settings.appearance.systemTheme',
];

const requiredNotificationLocaleKeys = [
  'settings.notifications.inboxSources.title',
  'settings.notifications.inboxSources.desc',
  'settings.notifications.source.chatMessage.title',
  'settings.notifications.source.chatMessage.desc',
  'settings.notifications.source.workflowAction.title',
  'settings.notifications.source.workflowAction.desc',
  'settings.notifications.source.approval.title',
  'settings.notifications.source.approval.desc',
  'settings.notifications.source.worktree.title',
  'settings.notifications.source.worktree.desc',
  'settings.notifications.source.failure.title',
  'settings.notifications.source.failure.desc',
  'settings.notifications.saveFailed',
  'settings.notifications.sound.abstractSound1',
  'settings.notifications.sound.abstractSound2',
  'settings.notifications.sound.abstractSound3',
  'settings.notifications.sound.abstractSound4',
  'settings.notifications.sound.phoneVibration',
  'settings.notifications.sound.rooster',
  'settings.notifications.sound.cowMooing',
  'settings.notifications.systemPermission.denied',
  'settings.notifications.systemPermission.unsupported',
];

const disallowedNotificationLocaleSnippets = [
  'NotificationService',
  'notifications.push_enabled',
  'notifications.sound_enabled',
  'notifications.sound_file',
  'notifications.inbox_sources',
  'Bell inbox',
  'Bell 收件箱',
  'Bell 受信箱',
  'Bell 받은함',
  'boîte Bell',
  'bandeja Bell',
];

check(
  'adds a follow-system theme option to General settings',
  settingsSource.includes("id: 'system'") &&
    settingsSource.includes('setTheme(option.id)') &&
    settingsSource.includes('Icon: Monitor') &&
    settingsSource.includes('themePreference') &&
    settingsSource.includes('settings.appearance.systemTheme'),
  settingsSource,
);

check(
  'appearance theme cards reuse onboarding card styling',
    settingsSource.includes('cursor-pointer rounded-[8px] border p-2 text-left transition') &&
    settingsSource.includes('flex h-8 items-center justify-between rounded-[8px] border px-2.5') &&
    settingsSource.includes('border-[var(--primary)] bg-white/[0.07]') &&
    settingsSource.includes("lightPreview\n                                ? 'border-black/[0.08] bg-[#f5f6f8]'") &&
    !settingsSource.includes('bg-[#e4e4e7]') &&
    settingsSource.includes("lightPreview ? 'text-[#52525b]' : 'text-white'") &&
    settingsSource.includes('settings-row-title mt-1.5 leading-tight') &&
    settingsSource.includes('strokeWidth={1.4}') &&
    !settingsSource.includes('settings-theme-card'),
  settingsSource,
);

check(
  'wires notification settings to persisted backend notification config',
  settingsSource.includes('persistNotificationConfig') &&
    settingsSource.includes('systemApi.saveConfig') &&
    settingsSource.includes('push_enabled') &&
    settingsSource.includes('sound_enabled') &&
    settingsSource.includes('sound_file') &&
    settingsSource.includes('inbox_sources') &&
    settingsSource.includes("key: 'chat_message'") &&
    settingsSource.includes("key: 'workflow_action'") &&
    settingsSource.includes("key: 'approval'") &&
    settingsSource.includes("key: 'worktree'") &&
    settingsSource.includes("key: 'failure'") &&
    settingsSource.includes('SoundFile.ABSTRACT_SOUND3'),
  settingsSource,
);

check(
  'notification source settings control Bell inbox reminders, not per-source sounds',
  settingsSource.includes('settings.notifications.inboxSources.title') &&
    settingsSource.includes('NotificationInboxSourcesConfig') &&
    !settingsSource.includes('sound_sources') &&
    !settingsSource.includes('settings.notifications.soundSources') &&
    !settingsSource.includes('settings.notifications.sources'),
  settingsSource,
);

check(
  'notification settings avoid stale Bell persistence copy',
  !settingsSource.includes('Persistent Bell inbox') &&
    !settingsSource.includes('inboxAlwaysOn') &&
    !settingsSource.includes('always stored in the Bell inbox'),
  settingsSource,
);

check(
  'notification settings do not expose unsupported inbox event toggles',
  !settingsSource.includes("key: 'newMessage'") &&
    !settingsSource.includes("key: 'workflowStatus'") &&
    !settingsSource.includes("key: 'agentActivity'"),
  settingsSource,
);

check(
  'system notification toggle requests browser permission before enabling push notifications',
  settingsSource.includes("field === 'push_enabled'") &&
    settingsSource.includes('nextNotifications.push_enabled') &&
    settingsSource.includes('BrowserNotification.requestPermission()') &&
    settingsSource.includes('settings.notifications.systemPermission.denied') &&
    settingsSource.includes('settings.notifications.systemPermission.unsupported'),
  settingsSource,
);

check(
  'adds archived sessions to the General settings menu',
  mockSource.includes("{ id: 'archived-sessions'") &&
    settingsSource.includes("case 'archived-sessions'"),
  { mockSource, settingsSource },
);

check(
  'renders only the project-scoped archived sessions resource',
  settingsSource.includes('archivedSessionsAsync') &&
    settingsSource.includes('refreshArchivedSessions') &&
    !settingsSource.includes('renameSession'),
  settingsSource,
);

check(
  'offers restore and delete actions without rename on archived rows',
  settingsSource.includes('restoreSession(session.id)') &&
    settingsSource.includes('deleteSession(deletingArchivedSession.id)') &&
    settingsSource.includes('settings.archivedSessions.restore') &&
    settingsSource.includes('settings.archivedSessions.delete'),
  settingsSource,
);

check(
  'uses a permanent-delete confirmation for archived session deletion',
  settingsSource.includes('role="alertdialog"') &&
    settingsSource.includes('settings.archivedSessions.deleteConfirmDesc') &&
    settingsSource.includes('cannot be undone'),
  settingsSource,
);

for (const locale of ['en', 'zh', 'ja', 'ko', 'fr', 'es']) {
  const localeSource = readFileSync(
    new URL(`../locales/${locale}/settings.json`, import.meta.url),
    'utf8',
  );
  check(
    `locale ${locale} contains archived session settings keys`,
    requiredLocaleKeys.every((key) => localeSource.includes(`"${key}"`)),
    localeSource,
  );
  check(
    `locale ${locale} contains persisted notification settings keys`,
    requiredNotificationLocaleKeys.every((key) =>
      localeSource.includes(`"${key}"`),
    ),
    localeSource,
  );
  const localeSettings = JSON.parse(localeSource) as Record<string, string>;
  const notificationLocaleValues = Object.entries(localeSettings)
    .filter(([key]) => key.startsWith('settings.notifications.'))
    .map(([, value]) => value)
    .join('\n');
  check(
    `locale ${locale} notification copy stays user-facing`,
    disallowedNotificationLocaleSnippets.every(
      (snippet) => !notificationLocaleValues.includes(snippet),
    ),
    notificationLocaleValues,
  );
  check(
    `locale ${locale} does not describe per-source sound settings`,
    !localeSource.includes('sound_sources') &&
      !localeSource.includes('settings.notifications.soundSources') &&
      !localeSource.includes('settings.notifications.sources') &&
      !localeSource.includes('按通知来源控制哪些事件允许播放提示音'),
    localeSource,
  );
}

if (failures > 0) {
  process.exitCode = 1;
}
