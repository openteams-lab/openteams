// Smoke tests for the team templates page wiring.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/pages/TeamTemplatesPage.test.ts
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

const source = readFileSync(new URL('./TeamTemplatesPage.tsx', import.meta.url), 'utf8');

console.log('TeamTemplatesPage');

check('loads templates through the real API adapter', source.includes('teamPresetsApi.list()'));
check('loads template details on selection', source.includes('teamPresetsApi.get('));
check('groups backend templates under my team templates', source.includes('myTeamTemplates') && source.includes('我的团队模板'));
check('renders advanced team templates from mock data', source.includes('advancedTeamTemplates') && source.includes('更多推荐模板'));
check('keeps the detail page in the Linear-style pipeline layout', source.includes('team-template-workflow-preview') && source.includes('PIPELINE /') && source.includes('MEMBERS /'));
check('shows recoverable loading errors', source.includes('loadError') && source.includes('loadTemplates()'));
check('shows an empty my-template state', source.includes('myTeamTemplates.length === 0'));
check('keeps built-in templates read-only', source.includes('selectedDetail.team.is_builtin') && source.includes('canEditSelected'));
check('supports create, update, and delete flows', source.includes('teamPresetsApi.create') && source.includes('teamPresetsApi.update') && source.includes('teamPresetsApi.delete'));
check('confirms deletion before mutating', source.includes('window.confirm'));
check('preserves form input on save failure', source.includes('setFormError(errorMessage') && source.includes('return;'));
check('shows member skills and role prompt details', source.includes('selected_skill_ids') && source.includes('system_prompt'));
check('keeps Linear visual refinement hooks', source.includes('team-template-card') && source.includes('team-template-member-row') && source.includes('team-template-field'));

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll TeamTemplatesPage assertions passed.');
}
