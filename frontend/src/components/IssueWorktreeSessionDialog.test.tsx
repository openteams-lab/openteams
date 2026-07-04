// Source checks for the issue worktree session dialog.
//
// Run with:
//     pnpm exec tsx src/components/IssueWorktreeSessionDialog.test.tsx

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

const source = readFileSync(
  new URL('./IssueWorktreeSessionDialog.tsx', import.meta.url),
  'utf8',
);

console.log('IssueWorktreeSessionDialog');

check(
  'uses an icon for the checked state instead of corrupted text',
  source.includes("import { Check, FolderGit2, X }") &&
    source.includes('<Check className="h-3 w-3" aria-hidden />') &&
    source.includes('<FolderGit2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />') &&
    !source.includes('鉁'),
  source,
);

check(
  'does not submit isolated while Git availability is false or checking',
  source.includes('isolatedWorktreeModeOrNull(isolate, gitAvailable)') &&
    source.includes('!canUseIsolatedWorktree(gitAvailable)'),
  source,
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} IssueWorktreeSessionDialog assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll IssueWorktreeSessionDialog assertions passed.');
}
