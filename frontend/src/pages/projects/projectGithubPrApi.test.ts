import { projectGithubApi } from '../../lib/api';
import { firstBranchName } from './ProjectPrCreateFlow';

let failures = 0;

const check = (label: string, condition: boolean, detail?: unknown) => {
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${label}`, detail ?? '');
  } else {
    console.log(`ok ${label}`);
  }
};

interface CapturedRequest {
  url: string;
  body: unknown;
}

const requests: CapturedRequest[] = [];
const queuedResponses: unknown[] = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const body =
    typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? null;
  requests.push({ url: String(input), body });
  const data = queuedResponses.shift() ?? null;
  return new Response(
    JSON.stringify({
      success: true,
      data,
      message: null,
      error_data: null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}) as typeof fetch;

queuedResponses.push(['main', 'feature/pr']);
const branches = await projectGithubApi.listBranches('project 1', 'repo-int-1');
check(
  'listBranches consumes backend string branch array',
  Array.isArray(branches) &&
    branches[0] === 'main' &&
    firstBranchName(branches) === 'main',
  branches,
);
check(
  'listBranches sends repo_integration_id query field',
  requests.at(-1)?.url.includes(
    '/api/projects/project%201/github/branches?repo_integration_id=repo-int-1',
  ) === true && !requests.at(-1)?.url.includes('repo_id='),
  requests.at(-1),
);

queuedResponses.push({
  repo_id: 'repo-1',
  base_branch: 'main',
  head_branch: 'feature/pr',
  head_pushed: false,
  commits: [],
  diff_summary: { files_changed: 0, additions: 0, deletions: 0 },
  diff_text: '',
  requires_push: true,
});
await projectGithubApi.previewPr('project-1', {
  repo_integration_id: 'repo-int-1',
  base_branch: 'main',
  head_branch: 'feature/pr',
});
check(
  'previewPr body matches GitHubPrPreviewRequest',
  JSON.stringify(requests.at(-1)?.body) ===
    JSON.stringify({
      repo_integration_id: 'repo-int-1',
      base_branch: 'main',
      head_branch: 'feature/pr',
    }),
  requests.at(-1),
);

queuedResponses.push(null);
const pushResult = await projectGithubApi.pushPrHead('project-1', {
  repo_integration_id: 'repo-int-1',
  head_branch: 'feature/pr',
  base_branch: 'main',
});
check('pushPrHead treats empty success body as void', pushResult === undefined);
check(
  'pushPrHead body uses repo_integration_id and default user_ui source',
  JSON.stringify(requests.at(-1)?.body) ===
    JSON.stringify({
      repo_integration_id: 'repo-int-1',
      head_branch: 'feature/pr',
      base_branch: 'main',
      operation_source: 'user_ui',
    }),
  requests.at(-1),
);

const createResponse = {
  pull_request: null,
  delivery_record: null,
  external_link: null,
  audit_id: 'audit-1',
  result: 'failed',
  pending_pr: {
    id: 'pending-1',
    project_id: 'project-1',
    repo_integration_id: 'repo-int-1',
    work_item_id: null,
    audit_id: 'audit-1',
    base_branch: 'main',
    head_branch: 'feature/pr',
    title: 'Open PR',
    body: null,
    status: 'create_failed',
    pull_request_number: null,
    pull_request_url: null,
    last_error: 'GitHub create failed',
    created_at: '2026-06-05T00:00:00Z',
    updated_at: '2026-06-05T00:00:00Z',
  },
};
queuedResponses.push(createResponse);
await projectGithubApi.createPr('project-1', {
  repo_integration_id: 'repo-int-1',
  base_branch: 'main',
  head_branch: 'feature/pr',
  title: 'Open PR',
});
check(
  'createPr body matches GitHubCreatePrRequest defaults',
  JSON.stringify(requests.at(-1)?.body) ===
    JSON.stringify({
      repo_integration_id: 'repo-int-1',
      base_branch: 'main',
      head_branch: 'feature/pr',
      title: 'Open PR',
      body: null,
      work_item_id: null,
      operation_source: 'user_ui',
    }),
  requests.at(-1),
);

queuedResponses.push({ ...createResponse, result: 'success' });
await projectGithubApi.retryPr('project-1', {
  pending_pr_id: 'pending-1',
});
check(
  'retryPr body matches GitHubRetryPrRequest defaults',
  JSON.stringify(requests.at(-1)?.body) ===
    JSON.stringify({
      pending_pr_id: 'pending-1',
      operation_source: 'user_ui',
    }),
  requests.at(-1),
);

globalThis.fetch = originalFetch;

if (failures > 0) process.exit(1);
