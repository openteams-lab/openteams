import { ApiError, chatSessionWorktreeApi, projectSourceControlApi } from './api';
import type { SessionSourceControlStatus } from '@/types';

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
  method: string;
  body: unknown;
}

const gitStatus: SessionSourceControlStatus = {
  mode: 'git',
  workspace_id: null,
  workspace_path: 'E:/workspace/demo',
  branch: 'main',
  head_sha: 'abc1234',
  changes: [],
  staged_changes: [],
  external_staged_paths: [],
  operation_in_progress: null,
  detached_head: false,
  blocked_reason: null,
};

const requests: CapturedRequest[] = [];
const queuedBodies: unknown[] = [];
const originalFetch = globalThis.fetch;

const enqueueSuccess = (data: unknown) => {
  queuedBodies.push({
    success: true,
    data,
    message: null,
    error_data: null,
  });
};

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  requests.push({
    url: String(input),
    method: init?.method ?? 'GET',
    body:
      typeof init?.body === 'string'
        ? JSON.parse(init.body)
        : init?.body ?? null,
  });
  const body = queuedBodies.shift() ?? {
    success: true,
    data: null,
    message: null,
    error_data: null,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;

enqueueSuccess(gitStatus);
await projectSourceControlApi.getSessionStatus('project 1', 'session 1');
check(
  'getSessionStatus encodes project and session_id query',
  requests.at(-1)?.url ===
    '/api/projects/project%201/source-control/session-status?session_id=session+1',
  requests.at(-1),
);

enqueueSuccess({
  path: 'src/App.tsx',
  old_path: null,
  area: 'changes',
  base_label: 'index',
  compare_label: 'worktree',
  unified_diff: '@@ diff',
  additions: 1,
  deletions: 0,
  is_binary: false,
  is_too_large: false,
  content_omitted: false,
  message: null,
});
await projectSourceControlApi.getDiff('project 1', {
  session_id: 'session-1',
  path: 'src/App.tsx',
  area: 'changes',
});
check(
  'getDiff uses source-control diff query contract',
  requests.at(-1)?.url ===
    '/api/projects/project%201/source-control/diff?session_id=session-1&path=src%2FApp.tsx&area=changes',
  requests.at(-1),
);

enqueueSuccess({ ok: true, succeeded: ['src/App.tsx'], failed: [], status: gitStatus });
await projectSourceControlApi.stage('project-1', {
  session_id: 'session-1',
  paths: ['src/App.tsx'],
  force_shared: true,
});
check(
  'stage posts expected body',
  requests.at(-1)?.url ===
    '/api/projects/project-1/source-control/stage' &&
    requests.at(-1)?.method === 'POST' &&
    JSON.stringify(requests.at(-1)?.body) ===
      JSON.stringify({
        session_id: 'session-1',
        paths: ['src/App.tsx'],
        force_shared: true,
      }),
  requests.at(-1),
);

enqueueSuccess({
  ok: true,
  succeeded: ['src/App.tsx'],
  failed: [],
  head_sha: 'abc1234',
  operation_id: 'operation-1',
});
await projectSourceControlApi.stage(
  'project-1',
  {
    session_id: 'session-1',
    paths: ['src/App.tsx'],
  },
  { response: 'fast' },
);
check(
  'stage supports fast response mode',
  requests.at(-1)?.url ===
    '/api/projects/project-1/source-control/stage?response=fast',
  requests.at(-1),
);

enqueueSuccess({ ok: true, succeeded: ['src/App.tsx'], failed: [], status: gitStatus });
await projectSourceControlApi.unstage('project-1', {
  session_id: 'session-1',
  paths: ['src/App.tsx'],
});
check(
  'unstage posts expected endpoint',
  requests.at(-1)?.url ===
    '/api/projects/project-1/source-control/unstage' &&
    requests.at(-1)?.method === 'POST',
  requests.at(-1),
);

enqueueSuccess({ ok: true, succeeded: ['src/App.tsx'], failed: [], status: gitStatus });
await projectSourceControlApi.discard('project-1', {
  session_id: 'session-1',
  paths: ['src/App.tsx'],
  expected_head_sha: 'abc1234',
});
check(
  'discard posts expected body',
  JSON.stringify(requests.at(-1)?.body) ===
    JSON.stringify({
      session_id: 'session-1',
      paths: ['src/App.tsx'],
      expected_head_sha: 'abc1234',
    }),
  requests.at(-1),
);

enqueueSuccess({
  commit_sha: 'abcdef123456',
  short_sha: 'abcdef1',
  branch: 'main',
  message: 'commit message',
  committed_paths: ['src/App.tsx'],
  additions: 1,
  deletions: 0,
  status: gitStatus,
});
await projectSourceControlApi.commit('project-1', {
  session_id: 'session-1',
  message: 'commit message',
  expected_staged_paths: ['src/App.tsx'],
});
check(
  'commit posts expected endpoint and request',
  requests.at(-1)?.url ===
    '/api/projects/project-1/source-control/commit' &&
    JSON.stringify(requests.at(-1)?.body) ===
      JSON.stringify({
        session_id: 'session-1',
        message: 'commit message',
        expected_staged_paths: ['src/App.tsx'],
      }),
  requests.at(-1),
);

enqueueSuccess(null);
await chatSessionWorktreeApi.resolveMergeConflict('session-1', {
  path: 'assets/logo.png',
  content: '',
  delete_file: true,
});
check(
  'worktree conflict resolve supports deleting the file result',
  requests.at(-1)?.url ===
    '/api/chat/sessions/session-1/worktree/merge-conflicts/resolve' &&
    requests.at(-1)?.method === 'POST' &&
    JSON.stringify(requests.at(-1)?.body) ===
      JSON.stringify({
        path: 'assets/logo.png',
        content: '',
        delete_file: true,
      }),
  requests.at(-1),
);

queuedBodies.push({
  success: false,
  data: null,
  message: 'Commit rejected',
  error_data: {
    code: 'empty_message',
    message: 'Commit message is required.',
    status: gitStatus,
  },
});
let commitError: unknown = null;
try {
  await projectSourceControlApi.commit('project-1', {
    session_id: 'session-1',
    message: '',
    expected_staged_paths: [],
  });
} catch (err) {
  commitError = err;
}
const structuredCommitError =
  commitError instanceof ApiError
    ? (commitError.errorData as { status?: SessionSourceControlStatus } | undefined)
    : undefined;
check(
  'commit preserves structured source-control error data',
  structuredCommitError?.status?.mode === 'git' &&
    structuredCommitError.status.head_sha === gitStatus.head_sha,
  commitError,
);

globalThis.fetch = originalFetch;

if (failures > 0) process.exit(1);
