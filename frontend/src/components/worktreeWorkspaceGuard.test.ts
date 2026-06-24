// Behavior tests for Git-workspace gating before isolated worktree creation.
//
// Run with:
//     pnpm exec tsx src/components/worktreeWorkspaceGuard.test.ts

import {
  canUseIsolatedWorktree,
  isolatedWorktreeModeOrNull,
  isolatedWorktreeModeOrUndefined,
  nextIsolatedWorktreeSelection,
  resolveCreateSessionWorktreeWorkspacePath,
} from './worktreeWorkspaceGuard';

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

console.log('worktreeWorkspaceGuard behavior');

check('Git true enables isolated worktree', canUseIsolatedWorktree(true));
check('Git false disables isolated worktree', !canUseIsolatedWorktree(false));
check('Git loading disables isolated worktree', !canUseIsolatedWorktree(null));

check(
  'toggle while enabled flips current selection',
  nextIsolatedWorktreeSelection(false, true) === true &&
    nextIsolatedWorktreeSelection(true, true) === false,
);

check(
  'toggle while checking clears selection',
  nextIsolatedWorktreeSelection(true, null) === false,
);

check(
  'toggle when non-Git clears selection',
  nextIsolatedWorktreeSelection(true, false) === false,
);

check(
  'new session submit never sends isolated while checking',
  isolatedWorktreeModeOrUndefined(true, null) === undefined,
);

check(
  'new session submit never sends isolated for non-Git workspace',
  isolatedWorktreeModeOrUndefined(true, false) === undefined,
);

check(
  'new session submit sends isolated only for Git workspace',
  isolatedWorktreeModeOrUndefined(true, true) === 'isolated',
);

check(
  'issue dialog submit downgrades checking state to main workspace',
  isolatedWorktreeModeOrNull(true, null) === null,
);

check(
  'issue dialog submit downgrades non-Git state to main workspace',
  isolatedWorktreeModeOrNull(true, false) === null,
);

check(
  'issue dialog submit sends isolated only for Git workspace',
  isolatedWorktreeModeOrNull(true, true) === 'isolated',
);

check(
  'free chat validates the selected member workspace instead of project default',
  resolveCreateSessionWorktreeWorkspacePath({
    isPlanMode: false,
    selectedMemberName: '@worker',
    projectWorkspacePath: 'E:/git-project',
    memberWorkspacePaths: { worker: 'E:/plain-member' },
  }) === 'E:/plain-member',
);

check(
  'free chat falls back to project workspace when member has no workspace',
  resolveCreateSessionWorktreeWorkspacePath({
    isPlanMode: false,
    selectedMemberName: '@worker',
    projectWorkspacePath: 'E:/git-project',
    memberWorkspacePaths: { worker: null },
  }) === 'E:/git-project',
);

check(
  'workflow validates workflow lead workspace before project default',
  resolveCreateSessionWorktreeWorkspacePath({
    isPlanMode: true,
    selectedMemberName: '@lead',
    projectWorkspacePath: 'E:/git-project',
    workflowWorkspacePath: 'E:/workflow-lead',
    memberWorkspacePaths: { lead: 'E:/free-chat-lead' },
  }) === 'E:/workflow-lead',
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} worktreeWorkspaceGuard assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll worktreeWorkspaceGuard behavior assertions passed.');
}
