// API contract tests for chat session endpoints used by worktree creation UI.
//
// Run with:
//     pnpm exec tsx src/lib/chatSessionsApi.test.ts

import { chatSessionsApi } from './api';

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

const originalFetch = globalThis.fetch;
const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({ input, init });
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        valid: true,
        is_git_repo: true,
        error: null,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}) as typeof fetch;

console.log('chatSessionsApi behavior');

const response = await chatSessionsApi.validateWorkspacePath(
  'E:/workspace/project',
);
const call = calls[0];
const body =
  typeof call?.init?.body === 'string' ? JSON.parse(call.init.body) : null;

check(
  'validateWorkspacePath posts to the chat workspace validator',
  String(call?.input) === '/api/chat/validate-workspace-path',
  call?.input,
);

check(
  'validateWorkspacePath sends the exact workspace path',
  body?.workspace_path === 'E:/workspace/project',
  body,
);

check(
  'validateWorkspacePath returns Git repo metadata',
  response.valid === true && response.is_git_repo === true,
  response,
);

globalThis.fetch = originalFetch;

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} chatSessionsApi assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll chatSessionsApi behavior assertions passed.');
}
