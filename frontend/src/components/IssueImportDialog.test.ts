import {
  filterIssueImportDialogIssues,
  uniqueIssueImportLabels,
} from './IssueImportDialog';
import type { GitHubIssueSummary } from '@/types';

let failures = 0;

const check = (label: string, condition: boolean, detail?: unknown) => {
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${label}`, detail ?? '');
  } else {
    console.log(`ok ${label}`);
  }
};

const issue = (
  number: number,
  state: GitHubIssueSummary['state'],
  labels: string[],
  imported = false,
): GitHubIssueSummary => ({
  number,
  node_id: `node-${number}`,
  title: `Issue ${number} ${labels.join(' ')}`,
  state,
  url: null,
  author: null,
  labels,
  assignees: [],
  updated_at: '2026-06-07T00:00:00Z',
  last_synced_at: null,
  stale: false,
  work_item_id: imported ? `work-${number}` : null,
});

const issues = [
  issue(1, 'open', ['Bug'], false),
  issue(2, 'closed', ['Feature'], false),
  issue(3, 'open', ['Bug', 'Design'], true),
];

check(
  'unique labels are collected and sorted',
  uniqueIssueImportLabels(issues).join(',') === 'Bug,Design,Feature',
);
check(
  'status filter keeps open issues',
  filterIssueImportDialogIssues(issues, {
    imported: 'all',
    label: null,
    query: '',
    status: 'open',
  })
    .map((item) => item.number)
    .join(',') === '1,3',
);
check(
  'imported filter keeps imported issues',
  filterIssueImportDialogIssues(issues, {
    imported: 'imported',
    label: null,
    query: '',
    status: 'all',
  })
    .map((item) => item.number)
    .join(',') === '3',
);
check(
  'not imported filter excludes imported issues',
  filterIssueImportDialogIssues(issues, {
    imported: 'not_imported',
    label: null,
    query: '',
    status: 'all',
  })
    .map((item) => item.number)
    .join(',') === '1,2',
);
check(
  'label filter matches labels',
  filterIssueImportDialogIssues(issues, {
    imported: 'all',
    label: 'Bug',
    query: '',
    status: 'all',
  })
    .map((item) => item.number)
    .join(',') === '1,3',
);
check(
  'search combines with other filters',
  filterIssueImportDialogIssues(issues, {
    imported: 'all',
    label: 'Feature',
    query: '2',
    status: 'closed',
  })
    .map((item) => item.number)
    .join(',') === '2',
);

if (failures > 0) process.exit(1);
