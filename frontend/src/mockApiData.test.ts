// Smoke tests for local mock data used by the frontend shell.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/mockApiData.test.ts
// Exits non-zero if any assertion fails.

import { mockSettingsOptions, mockShellOptions, mockWorkspaceBootstrap } from './mockApiData';
import { mockSessionWorkspaceChanges } from './mockSessionWorkspaceChanges';

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

const eq = <T>(label: string, actual: T, expected: T) =>
  check(label, Object.is(actual, expected), { actual, expected });

console.log('mockShellOptions');

const activeProject = mockShellOptions.projects.find((project) => project.active);
eq('active project repository is exposed', activeProject?.repository, 'indiebob/my-saas');
check(
  'projects include display metadata',
  mockShellOptions.projects.every(
    (project) => project.monogram.length > 0 && project.repository.length > 0,
  ),
  mockShellOptions.projects,
);

eq('build stats default expanded', mockShellOptions.buildStats.defaultExpanded, true);
check(
  'build stats include default expanded content',
  mockShellOptions.buildStats.stats.length >= 3,
  mockShellOptions.buildStats.stats,
);

const projectManagementIds = new Set(
  mockShellOptions.projectManagementItems.map((item) => item.id),
);
check('project management omits GitHub repository tab', !projectManagementIds.has('github-repository'));
check('project management includes issues', projectManagementIds.has('project-issue'));
check('project management includes members', projectManagementIds.has('member-configuration'));
eq(
  'project issues opens its own page',
  mockShellOptions.projectManagementItems.find((item) => item.id === 'project-issue')?.targetPage,
  'issue',
);

const systemIds = new Set(mockShellOptions.systemItems.map((item) => item.id));
check('system includes team templates', systemIds.has('team-templates'));
eq(
  'team templates opens its own page',
  mockShellOptions.systemItems.find((item) => item.id === 'team-templates')?.targetPage,
  'team-templates',
);
check('system omits skill library', !systemIds.has('skills-library'));
eq(
  'agent runtime label is explicit',
  mockShellOptions.systemItems.find((item) => item.id === 'agent-runtime')?.label,
  'Agent runtime',
);
check('system includes settings', systemIds.has('settings'));

const personalSettings = mockSettingsOptions.menu.find(
  (group) => group.section === 'Personal',
);
const notificationsItem = personalSettings?.items.find(
  (item) => item.id === 'notifications',
);
check('settings exposes notifications page under Personal', Boolean(notificationsItem) && !notificationsItem?.disabled, notificationsItem);

check(
  'shell data does not duplicate session state',
  !Object.hasOwn(mockShellOptions, 'sessions'),
  mockShellOptions,
);

check(
  'mock workspace has enough sessions to show sidebar more indicator',
  mockWorkspaceBootstrap.sessions.length > 6,
  mockWorkspaceBootstrap.sessions,
);
check(
  'mock workspace has enough members to exercise sidebar overflow',
  mockWorkspaceBootstrap.members.length >= 9,
  mockWorkspaceBootstrap.members,
);

const sess1Changes = mockSessionWorkspaceChanges['sess-1'].changes;
check('session file changes include modified files', Boolean(sess1Changes?.modified.length));
check('session file changes include added files', Boolean(sess1Changes?.added.length));
check(
  'session file changes expose diff-capable rows',
  Boolean(sess1Changes?.modified.some((file) => file.has_diff)),
  sess1Changes,
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll mock shell assertions passed.');
}
