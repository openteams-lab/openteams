// Smoke tests for inbox-driven workflow focus routing.
//
// Run with:
//     pnpm exec tsx src/components/workflow/WorkflowCardInboxFocus.test.ts

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

console.log('WorkflowCard inbox focus');

const source = readFileSync(
  new URL('./WorkflowCard.tsx', import.meta.url),
  'utf8',
);
const navigationSource = readFileSync(
  new URL('../../lib/inboxNavigation.ts', import.meta.url),
  'utf8',
);

check(
  'keeps pending inbox focus until the matching workflow card consumes it',
  source.includes('getPendingInboxWorkflowFocus(sessionId)') &&
    source.includes('clearInboxWorkflowFocus(target)') &&
    navigationSource.includes('getPendingInboxWorkflowFocus') &&
    navigationSource.includes('clearInboxWorkflowFocus'),
  { source, navigationSource },
);

check(
  'matches workflow inbox focus by concrete source_id instead of source type',
  source.includes('workflowInboxActionIds') &&
    source.includes('sourceId && workflowInboxActionIds.has(sourceId)') &&
    !source.includes("sourceType.startsWith('workflow_')"),
  source,
);

check(
  'loads unresolved input review final-review and approval action ids',
  source.includes("entry_type === 'input_request'") &&
    source.includes("entry_type === 'continue_confirmation'") &&
    source.includes("entry_type === 'approval_request'") &&
    source.includes("entry_type === 'permission_request'") &&
    source.includes('finalReviewAction?.transcriptId'),
  source,
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} WorkflowCard inbox focus assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll WorkflowCard inbox focus assertions passed.');
}
