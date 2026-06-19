import { getWorkItemDetailCollections } from './ProjectWorkItemDetail';

let failures = 0;

const check = (label: string, condition: boolean, detail?: unknown) => {
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${label}`, detail ?? '');
  } else {
    console.log(`ok ${label}`);
  }
};

const empty = getWorkItemDetailCollections({
  work_item: {
    id: 'work-item-1',
    project_id: 'project-1',
    type: 'feature',
    status: 'open',
    title: 'New work item',
    description: null,
    priority: 'medium',
    source: 'user',
    created_by: null,
    created_at: '2026-06-06T00:00:00Z',
    updated_at: '2026-06-06T00:00:00Z',
  },
} as never);

check('missing detail arrays normalize to empty arrays', [
  empty.externalLinks.length,
  empty.executionLinks.length,
  empty.deliveryRecords.length,
  empty.audits.length,
].every((count) => count === 0), empty);

const githubAudits = getWorkItemDetailCollections({
  github_audits: [
    {
      id: 'audit-1',
      actor: 'agent',
      operation_source: 'agent',
      session_id: null,
      workflow_execution_id: null,
      repo_id: 'repo-1',
      target_type: 'pull_request',
      target_id: '1',
      action: 'create_pr',
      result: 'pending_approval',
      error: null,
      created_at: '2026-06-06T00:00:00Z',
    },
  ],
} as never);

check('github_audits backend field is used for audit panel', githubAudits.audits.length === 1);

if (failures > 0) process.exit(1);
