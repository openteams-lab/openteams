// API contract tests for chat session endpoints used by worktree creation UI.
//
// Run with:
//     pnpm exec tsx src/lib/chatSessionsApi.test.ts

import { ApiError, chatSessionsApi } from './api';
import type { WorkspaceGitErrorData } from '@/types';

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
  const url = String(input);
  if (url === '/api/chat/gitignore-templates') {
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          templates: [
            {
              id: 'node',
              label: 'Node',
              group: 'Languages and frameworks',
              description: 'Ignore patterns for Node projects.',
              aliases: ['nodejs', 'npm'],
            },
          ],
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
  if (
    url === '/api/chat/initialize-workspace-git' &&
    typeof init?.body === 'string' &&
    JSON.parse(init.body).gitignore_template === 'missing'
  ) {
    return new Response(
      JSON.stringify({
        success: false,
        data: null,
        error_data: {
          code: 'invalid_gitignore_template',
          message: 'Unknown gitignore template.',
        },
        message: 'Unknown gitignore template.',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        valid: true,
        is_git_repo: true,
        error: null,
        error_code: null,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}) as typeof fetch;

console.log('chatSessionsApi behavior');

const templates = await chatSessionsApi.listGitignoreTemplates();
const response = await chatSessionsApi.validateWorkspacePath(
  'E:/workspace/project',
);
await chatSessionsApi.initializeWorkspaceGit({
  workspace_path: 'E:/workspace/project',
  gitignore_template: 'node',
});
let initError: unknown = null;
try {
  await chatSessionsApi.initializeWorkspaceGit({
    workspace_path: 'E:/workspace/project',
    gitignore_template: 'missing',
  });
} catch (err) {
  initError = err;
}
const templatesCall = calls[0];
const validateCall = calls[1];
const initCall = calls[2];
const body =
  typeof validateCall?.init?.body === 'string'
    ? JSON.parse(validateCall.init.body)
    : null;
const initBody =
  typeof initCall?.init?.body === 'string'
    ? JSON.parse(initCall.init.body)
    : null;

check(
  'listGitignoreTemplates reads the chat gitignore template catalog',
  String(templatesCall?.input) === '/api/chat/gitignore-templates' &&
    templates.templates[0]?.id === 'node',
  { input: templatesCall?.input, templates },
);

check(
  'validateWorkspacePath posts to the chat workspace validator',
  String(validateCall?.input) === '/api/chat/validate-workspace-path',
  validateCall?.input,
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

check(
  'initializeWorkspaceGit posts the selected template to the chat initializer',
  String(initCall?.input) === '/api/chat/initialize-workspace-git' &&
    initBody?.workspace_path === 'E:/workspace/project' &&
    initBody?.gitignore_template === 'node',
  { input: initCall?.input, body: initBody },
);

check(
  'initializeWorkspaceGit exposes typed workspace Git error data',
  initError instanceof ApiError &&
    (initError as ApiError<WorkspaceGitErrorData>).errorData?.code ===
      'invalid_gitignore_template',
  initError,
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
