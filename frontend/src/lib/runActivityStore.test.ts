// Executable tests for the run activity cursor store.
// Run with: pnpm exec tsx src/lib/runActivityStore.test.ts

import { ApiError } from './apiCore';
import { RunActivityStore } from './runActivityStore';
import type { ChatRunActivityLine, ChatRunActivityResponse } from '@/types';

let failures = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
  if (condition) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${label}`, detail ?? '');
  }
};

const line = (id: string, sequence: number): ChatRunActivityLine => ({
  line_id: id,
  run_id: 'run-1',
  session_id: 'session-1',
  session_agent_id: 'session-agent-1',
  agent_id: 'agent-1',
  agent_name: 'codex',
  sequence,
  line_type: 'thinking',
  stream_type: 'thinking',
  content: id,
  created_at: new Date(0).toISOString(),
});

const page = (
  lines: ChatRunActivityLine[],
  nextCursor: string,
  hasMore: boolean,
  logState: 'live' | 'tail',
): ChatRunActivityResponse => ({
  run_id: 'run-1',
  lines,
  next_cursor: nextCursor,
  has_more: hasMore,
  log_state: logState,
});

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const run = async () => {
  const cursors: Array<string | undefined> = [];
  const pages = [
    page([line('line-2', 2), line('line-1', 1)], '20', true, 'live'),
    page([line('line-2', 2), line('line-3', 3)], '30', false, 'tail'),
  ];
  const store = new RunActivityStore(async (_runId, cursor) => {
    cursors.push(cursor);
    const next = pages.shift();
    if (!next) throw new Error('unexpected fetch');
    return next;
  });
  const unsubscribe = store.subscribe('run-1', () => undefined);
  store.ensureLoaded('run-1');
  await waitFor(() => store.getSnapshot('run-1').status === 'completed');
  const loaded = store.getSnapshot('run-1');
  check('drains cursor pages serially', cursors.join(',') === ',20', cursors);
  check(
    'sorts and deduplicates activity lines',
    loaded.lines.map((item) => item.line_id).join(',') ===
      'line-1,line-2,line-3',
    loaded.lines,
  );
  check('stores the final cursor', loaded.cursor === '30', loaded);
  unsubscribe();
  store.dispose();

  let invalidCursorCalls = 0;
  const resetStore = new RunActivityStore(async (_runId, cursor) => {
    invalidCursorCalls += 1;
    if (invalidCursorCalls === 1) throw new ApiError('invalid cursor', 409);
    check('restarts invalid cursors from zero', cursor === undefined, cursor);
    return page([line('reset-line', 1)], '10', false, 'tail');
  });
  resetStore.ensureLoaded('run-1');
  await waitFor(() => resetStore.getSnapshot('run-1').status === 'completed');
  check('invalid cursor retries once', invalidCursorCalls === 2);
  resetStore.dispose();

  const prunedStore = new RunActivityStore(async () => {
    throw new ApiError('expired', 410);
  });
  prunedStore.ensureLoaded('run-1');
  await waitFor(() => prunedStore.getSnapshot('run-1').status === 'pruned');
  check('maps 410 to pruned', prunedStore.getSnapshot('run-1').lines.length === 0);
  prunedStore.dispose();

  let resolveLiveRefresh: ((value: ChatRunActivityResponse) => void) | undefined;
  let liveRefreshCalls = 0;
  const liveRefreshStore = new RunActivityStore(async () => {
    liveRefreshCalls += 1;
    if (liveRefreshCalls === 1) return page([], '0', false, 'live');
    return new Promise<ChatRunActivityResponse>((resolve) => {
      resolveLiveRefresh = resolve;
    });
  });
  liveRefreshStore.ensureLoaded('run-1');
  await waitFor(() => liveRefreshStore.getSnapshot('run-1').status === 'live');
  liveRefreshStore.notifyUpdated('run-1', 0);
  await waitFor(() => resolveLiveRefresh !== undefined);
  check(
    'keeps an empty live run live during background refresh',
    liveRefreshStore.getSnapshot('run-1').status === 'live',
    liveRefreshStore.getSnapshot('run-1'),
  );
  resolveLiveRefresh?.(page([], '0', false, 'live'));
  await waitFor(
    () => !liveRefreshStore.getSnapshot('run-1').requestInFlight,
  );
  liveRefreshStore.dispose();

  let resolveFirstPage: ((value: ChatRunActivityResponse) => void) | undefined;
  let concurrentCalls = 0;
  const concurrentStore = new RunActivityStore(async () => {
    concurrentCalls += 1;
    if (concurrentCalls === 1) {
      return new Promise<ChatRunActivityResponse>((resolve) => {
        resolveFirstPage = resolve;
      });
    }
    return page([line('after-notification', 2)], '20', false, 'tail');
  });
  concurrentStore.ensureLoaded('run-1');
  await waitFor(() => resolveFirstPage !== undefined);
  concurrentStore.notifyUpdated('run-1', 2);
  resolveFirstPage?.(page([line('before-notification', 1)], '10', false, 'live'));
  await waitFor(
    () => concurrentStore.getSnapshot('run-1').status === 'completed',
  );
  check(
    'notification during a request triggers one follow-up cursor read',
    concurrentCalls === 2,
    concurrentCalls,
  );
  concurrentStore.dispose();

  if (failures > 0) process.exit(1);
};

void run();
