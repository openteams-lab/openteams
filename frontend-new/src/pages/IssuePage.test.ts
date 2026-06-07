import {
  issueDisplayIdFontSizePx,
  issueSourceProviderId,
  projectIssueIdPrefix,
  projectWorkItemDisplayId,
  projectWorkItemIssueStatus,
  projectWorkItemsToIssueGroups,
} from './IssuePage';
import type { ProjectWorkItem } from '@/types';

let failures = 0;

const check = (label: string, condition: boolean, detail?: unknown) => {
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${label}`, detail ?? '');
  } else {
    console.log(`ok ${label}`);
  }
};

const item = (
  id: string,
  status: ProjectWorkItem['status'],
  source: ProjectWorkItem['source'] = 'manual',
): ProjectWorkItem => ({
  id,
  project_id: 'project-1',
  type: status === 'blocked' ? 'bug' : 'task',
  status,
  title: `${status} item`,
  description: null,
  priority: status === 'blocked' ? 'urgent' : 'medium',
  source,
  created_by: null,
  created_at: '2026-06-07T00:00:00Z',
  updated_at: '2026-06-07T00:00:00Z',
});

check('open work items map to todo', projectWorkItemIssueStatus('open') === 'todo');
check(
  'in progress work items map to todo',
  projectWorkItemIssueStatus('in_progress') === 'todo',
);
check(
  'blocked work items map to backlog',
  projectWorkItemIssueStatus('blocked') === 'backlog',
);
check('done work items map to done', projectWorkItemIssueStatus('done') === 'done');
check(
  'cancelled work items map to done',
  projectWorkItemIssueStatus('cancelled') === 'done',
);

const groups = projectWorkItemsToIssueGroups(
  [
    item('22222222-2222-4222-8222-222222222222', 'blocked'),
    item('33333333-3333-4333-8333-333333333333', 'done'),
    item('11111111-1111-4111-8111-111111111111', 'open', 'github_issue'),
  ],
  'all',
  'OpenTeams',
);

check('all filter returns three populated groups', groups.length === 3, groups);
check(
  'active filter excludes done items',
  projectWorkItemsToIssueGroups(
    [
      item('11111111-1111-4111-8111-111111111111', 'open'),
      item('33333333-3333-4333-8333-333333333333', 'done'),
    ],
    'active',
    'OpenTeams',
  ).every((group) => group.id !== 'done'),
);
check(
  'github imported work items do not duplicate source as a label',
  groups[0]?.items[0]?.labels?.some((label) => label.name === 'GitHub') ===
    false,
  groups[0],
);
check(
  'github issue source maps to github icon provider',
  issueSourceProviderId('github_issue') === 'github',
);
check(
  'linear issue source maps to linear icon provider',
  issueSourceProviderId('linear_issue') === 'linear',
);
check(
  'jira issue source maps to jira icon provider',
  issueSourceProviderId('jira_issue') === 'jira',
);
check(
  'manual source maps to local icon provider',
  issueSourceProviderId('manual') === 'local',
);
check(
  'project issue prefix uses the first three project name characters',
  projectIssueIdPrefix('OpenTeams') === 'OPE',
);
check(
  'project issue prefix ignores whitespace before taking three characters',
  projectIssueIdPrefix('AI App') === 'AIA',
);
check(
  'project issue display ids use project prefix and sequence number',
  projectWorkItemDisplayId('OpenTeams', 3) === 'OPE-3',
);
check(
  'work item issue ids increment in page display order',
  groups.flatMap((group) => group.items).map((issue) => issue.id).join(',') ===
    'OPE-1,OPE-2,OPE-3',
  groups,
);
check(
  'short issue ids keep the default font size',
  issueDisplayIdFontSizePx('ISS-1') === 16,
);
check(
  'generated work item ids shrink to fit the issue id column',
  issueDisplayIdFontSizePx('PWI-111111') <= 12,
);
check(
  'long issue ids continue shrinking instead of wrapping',
  issueDisplayIdFontSizePx('PWI-11111122223333') <
    issueDisplayIdFontSizePx('PWI-111111'),
);

if (failures > 0) process.exit(1);
