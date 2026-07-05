// API contract tests for inbox notification endpoints.
//
// Run with:
//     pnpm exec tsx src/lib/inboxApi.test.ts

import { inboxApi } from './api';

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
  const data = url.includes('/summary')
    ? {
        unread_count: 2,
        unread_by_severity: [{ key: 'warning', count: 1 }],
        unread_by_kind: [{ key: 'workflow_review', count: 1 }],
      }
    : url.includes('/items/item-1/mark-read')
      ? {
          item: {
            id: 'item-1',
            project_id: 'project-1',
            session_id: 'session-1',
            kind: 'chat_message',
            severity: 'info',
            title: 'Agent replied',
            body: 'Done',
            source_type: 'chat_message',
            source_id: 'message-1',
            dedupe_key: 'message:message-1',
            read_at: '2026-07-05T00:00:00Z',
            archived_at: null,
            created_at: '2026-07-05T00:00:00Z',
            updated_at: '2026-07-05T00:00:00Z',
          },
        }
      : url.includes('/items/item-2/archive')
        ? { item: { id: 'item-2' } }
        : url.includes('/items/mark-read') ||
            url.includes('/items/mark-all-read')
          ? { marked_count: 1 }
          : {
              items: [
                {
                  id: 'item-1',
                  project_id: 'project-1',
                  session_id: 'session-1',
                  kind: 'workflow_review',
                  severity: 'warning',
                  title: 'Review needed',
                  body: 'Review output',
                  source_type: 'workflow_review',
                  source_id: 'review-1',
                  dedupe_key: 'workflow_review:review-1',
                  read_at: null,
                  archived_at: null,
                  created_at: '2026-07-05T00:00:00Z',
                  updated_at: '2026-07-05T00:00:00Z',
                },
              ],
            };
  return new Response(
    JSON.stringify({
      success: true,
      data,
      error_data: null,
      message: null,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}) as typeof fetch;

console.log('inboxApi behavior');

await inboxApi.getSummary({ project_id: 'project-1', session_id: null });
await inboxApi.listItems({
  project_id: 'project-1',
  session_id: null,
  unread: true,
  archived: false,
  limit: 25,
});
await inboxApi.markRead('item-1');
await inboxApi.markManyRead({ ids: ['item-1', 'item-2'] });
await inboxApi.markAllRead({ project_id: 'project-1', session_id: null });
await inboxApi.archive('item-2');

const markManyBody =
  typeof calls[3]?.init?.body === 'string'
    ? JSON.parse(calls[3].init.body)
    : null;
const markAllBody =
  typeof calls[4]?.init?.body === 'string'
    ? JSON.parse(calls[4].init.body)
    : null;

check(
  'getSummary sends project-scoped query parameters',
  String(calls[0]?.input) === '/api/inbox/summary?project_id=project-1',
  calls[0],
);
check(
  'listItems requests unread unarchived notification items',
  String(calls[1]?.input) ===
    '/api/inbox/items?project_id=project-1&unread=true&archived=false&limit=25',
  calls[1],
);
check(
  'markRead posts to the single item mark-read endpoint',
  String(calls[2]?.input) === '/api/inbox/items/item-1/mark-read' &&
    calls[2]?.init?.method === 'POST',
  calls[2],
);
check(
  'markManyRead sends generated request shape',
  String(calls[3]?.input) === '/api/inbox/items/mark-read' &&
    markManyBody?.ids?.join(',') === 'item-1,item-2',
  { call: calls[3], body: markManyBody },
);
check(
  'markAllRead sends generated scoped request shape',
  String(calls[4]?.input) === '/api/inbox/items/mark-all-read' &&
    markAllBody?.project_id === 'project-1' &&
    markAllBody?.session_id === null,
  { call: calls[4], body: markAllBody },
);
check(
  'archive posts to the single item archive endpoint',
  String(calls[5]?.input) === '/api/inbox/items/item-2/archive' &&
    calls[5]?.init?.method === 'POST',
  calls[5],
);

globalThis.fetch = originalFetch;

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} inboxApi assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll inboxApi behavior assertions passed.');
}
