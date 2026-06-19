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
];

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
}

if (failures > 0) {
  process.exitCode = 1;
}
