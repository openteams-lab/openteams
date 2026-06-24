// Behavior tests for the ui-new worktree merge history panel.
//
// Run with:
//     pnpm exec tsx src/components/ui-new/worktree/WorktreeMergeHistoryPanel.test.ts

import { buildWorktreeMergeHistoryRows } from './WorktreeMergeHistoryPanel';
import type { SessionWorktree } from '@/types';

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

const tr = (_key: string, fallback: string) => fallback;

const worktree: SessionWorktree = {
  id: 'wt-1',
  session_id: 'session-1',
  project_id: 'project-1',
  base_workspace_path: 'E:/repo',
  repo_path: 'E:/repo',
  base_branch: 'main',
  base_commit: 'abc1234567',
  branch_name: 'openteams/session/abc12345',
  worktree_path: 'E:/repo/.openteams/worktrees/session',
  mode: 'session',
  status: 'merged',
  merge_target_branch: 'main',
  merge_operation: 'merge',
  conflict_files_json: '["src/App.tsx"]',
  operation_started_at: null,
  cleanup_error: null,
  last_used_at: null,
  merged_at: '2026-06-23T12:00:00Z',
  archived_at: null,
  created_at: '2026-06-23T11:00:00Z',
  updated_at: '2026-06-23T12:00:00Z',
};

console.log('WorktreeMergeHistoryPanel');

const rows = buildWorktreeMergeHistoryRows(worktree, tr);
check(
  'history includes merge status and merged timestamp',
  rows.some((row) => row.label === 'Status' && row.value === 'merged') &&
    rows.some((row) => row.label === 'Merged at' && row.value === worktree.merged_at),
  rows,
);

check(
  'history includes branch and conflict file metadata',
  rows.some((row) => row.label === 'Session branch' && row.value === worktree.branch_name) &&
    rows.some((row) => row.label === 'Conflict files' && row.value === 'src/App.tsx'),
  rows,
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} WorktreeMergeHistoryPanel assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll WorktreeMergeHistoryPanel assertions passed.');
}
