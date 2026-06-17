// Smoke tests for chat queue API wiring.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/lib/chatQueueApi.test.ts

import { chatQueuesApi } from './api';

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
}

const requests: CapturedRequest[] = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  requests.push({
    url: String(input),
    method: init?.method ?? 'GET',
  });
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        session_id: 'session 1',
        members: [],
        queue: {
          session_id: 'session 1',
          session_agent_id: 'member 1',
          agent_id: 'agent 1',
          status: 'empty',
          blocked: false,
          paused: false,
          can_continue: false,
          queued_count: 0,
          items: [],
        },
        deleted_id: 'queue 1',
        skipped_failed_count: 0,
      },
      message: null,
      error_data: null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}) as typeof fetch;

await chatQueuesApi.listSession('session 1');
check(
  'listSession uses session queue endpoint',
  requests.at(-1)?.url === '/api/chat/sessions/session%201/queue' &&
    requests.at(-1)?.method === 'GET',
  requests.at(-1),
);

await chatQueuesApi.listMember('session 1', 'member 1');
check(
  'listMember uses member queue endpoint',
  requests.at(-1)?.url ===
    '/api/chat/sessions/session%201/agents/member%201/queue' &&
    requests.at(-1)?.method === 'GET',
  requests.at(-1),
);

await chatQueuesApi.deleteQueued('session 1', 'queue 1');
check(
  'deleteQueued deletes queued item endpoint',
  requests.at(-1)?.url === '/api/chat/sessions/session%201/queue/queue%201' &&
    requests.at(-1)?.method === 'DELETE',
  requests.at(-1),
);

await chatQueuesApi.continueMember('session 1', 'member 1');
check(
  'continueMember posts continue endpoint',
  requests.at(-1)?.url ===
    '/api/chat/sessions/session%201/agents/member%201/queue/continue' &&
    requests.at(-1)?.method === 'POST',
  requests.at(-1),
);

globalThis.fetch = originalFetch;

if (failures > 0) {
  console.error(`\n${failures} chat queue API assertion(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll chat queue API assertions passed.');
}
