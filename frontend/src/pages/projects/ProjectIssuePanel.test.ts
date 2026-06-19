import {
  filterIssueAudits,
  isIssueSelectionWritable,
  resolveIssueWriteRepoId,
  shouldLoadIssuesForRepo,
} from './ProjectIssuePanel';
import type { GitHubOperationAudit } from '@/types';

let failures = 0;

const check = (label: string, condition: boolean, detail?: unknown) => {
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${label}`, detail ?? '');
  } else {
    console.log(`ok ${label}`);
  }
};

check(
  'repo switch blocks writes for stale selected issue',
  !isIssueSelectionWritable('repo-b', 'repo-a', true, false, null),
);
check(
  'repo switch removes write repo id instead of falling back to current repo',
  resolveIssueWriteRepoId('repo-b', 'repo-a') === null,
);
check(
  'current repo selection allows user initiated write',
  isIssueSelectionWritable('repo-a', 'repo-a', true, false, null) &&
    resolveIssueWriteRepoId('repo-a', 'repo-a') === 'repo-a',
);
check(
  'disconnected repo blocks issue writes',
  !isIssueSelectionWritable('repo-a', 'repo-a', true, true, null),
);
check('empty repo id blocks issue detail loading', !shouldLoadIssuesForRepo(''));
check('current repo id allows issue loading', shouldLoadIssuesForRepo('repo-a'));

const audits: GitHubOperationAudit[] = [
  {
    id: 'audit-1',
    actor: 'alice',
    operation_source: 'user_ui',
    session_id: null,
    workflow_execution_id: null,
    repo_id: 'repo-a',
    target_type: 'issue',
    target_id: '42',
    action: 'comment',
    result: 'success',
    error: null,
    created_at: '2026-06-05T12:00:00Z',
  },
  {
    id: 'audit-2',
    actor: 'agent',
    operation_source: 'agent',
    session_id: null,
    workflow_execution_id: null,
    repo_id: 'repo-a',
    target_type: 'issue',
    target_id: '42',
    action: 'labels',
    result: 'pending_approval',
    error: null,
    created_at: '2026-06-05T12:01:00Z',
  },
  {
    id: 'audit-3',
    actor: 'bob',
    operation_source: 'user_ui',
    session_id: null,
    workflow_execution_id: null,
    repo_id: 'repo-b',
    target_type: 'issue',
    target_id: '42',
    action: 'close',
    result: 'success',
    error: null,
    created_at: '2026-06-05T12:02:00Z',
  },
];

const filtered = filterIssueAudits(audits, 'repo-a', 42);
check('issue audit filter keeps current repo only', filtered.length === 2, filtered);
check(
  'issue audit filter keeps agent pending approval status',
  filtered.some(
    (audit) =>
      audit.operation_source === 'agent' &&
      audit.result === 'pending_approval',
  ),
  filtered,
);

if (failures > 0) process.exit(1);
