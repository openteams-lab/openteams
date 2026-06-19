// Source checks for suppressing first-paint placeholder flashes on page tabs.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/pages/PageInitialPlaceholder.test.ts
// Exits non-zero if any assertion fails.

import { readFileSync } from 'node:fs';

let failures = 0;

const check = (label: string, condition: boolean, detail?: unknown) => {
  if (condition) {
    console.log(`ok ${label}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${label}`, detail ?? '');
};

const readPage = (name: string) =>
  readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

const issueSource = readPage('IssuePage.tsx');
const agentsSource = readPage('AgentsPage.tsx');
const teamSource = readPage('TeamPage.tsx');

check(
  'issue page tracks the loaded project before showing issue placeholders',
  issueSource.includes('const [workItemsProjectId') &&
    issueSource.includes('const workItemsReady = selectedProjectId') &&
    issueSource.includes('const suppressIssuePlaceholder') &&
    issueSource.includes('suppressIssuePlaceholder ?') &&
    issueSource.includes('null') &&
    issueSource.includes(') : workItemsError ?'),
);

check(
  'agents page suppresses initial runtime skeletons until data is loaded',
  agentsSource.includes('const [runtimeLoaded, setRuntimeLoaded]') &&
    agentsSource.includes('const suppressRuntimePlaceholder') &&
    agentsSource.includes('suppressRuntimePlaceholder ?') &&
    agentsSource.includes(') : filteredRunners.length === 0 ?') &&
    agentsSource.includes('!runtimeLoaded ?') &&
    agentsSource.includes(') : selectedRunner ?'),
);

check(
  'team page waits for project members before rendering member placeholders',
  teamSource.includes('const [membersProjectId') &&
    teamSource.includes('const teamDataReady = selectedProjectId') &&
    teamSource.includes('teamDataReady && (error || notice)') &&
    teamSource.includes('teamDataReady && (') &&
    teamSource.includes('loading={false}'),
);

if (failures > 0) process.exit(1);
