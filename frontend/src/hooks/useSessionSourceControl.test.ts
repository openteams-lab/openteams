// Smoke tests for the session source-control hook source.
//
// No hook test runner is installed. Run with:
//     pnpm exec tsx src/hooks/useSessionSourceControl.test.ts

import { readFileSync } from 'node:fs';

let failures = 0;

const check = (label: string, condition: boolean, detail?: unknown) => {
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${label}`, detail ?? '');
  } else {
    console.log(`ok ${label}`);
  }
};

console.log('useSessionSourceControl');

const source = readFileSync(
  new URL('./useSessionSourceControl.ts', import.meta.url),
  'utf8',
);

check(
  'exports the Phase 3 hook contract',
  source.includes('export function useSessionSourceControl') &&
    source.includes('status,') &&
    source.includes('loading,') &&
    source.includes('error,') &&
    source.includes('refresh,') &&
    source.includes('stage,') &&
    source.includes('unstage,') &&
    source.includes('discard,') &&
    source.includes('commit,'),
  source,
);

check(
  'does not fetch when disabled or missing ids',
  source.includes('if (!enabled || !projectId || !sessionId)') &&
    source.includes('return null;') &&
    source.includes('void refresh();'),
  source,
);

check(
  'uses the project source-control API client',
  source.includes('projectSourceControlApi.getSessionStatus') &&
    source.includes('projectSourceControlApi.stage') &&
    source.includes('projectSourceControlApi.unstage') &&
    source.includes('projectSourceControlApi.discard') &&
    source.includes('projectSourceControlApi.commit'),
  source,
);

check(
  'injects session_id into write operations',
  ((source.match(/session_id: context\.sessionId/g) ?? []).length +
    (source.match(/session_id: batch\.sessionId/g) ?? []).length) === 4,
  source,
);

check(
  'uses optimistic fast writes for non-commit operations',
  source.includes('runOptimisticOperation') &&
    (source.match(/response: "fast"/g) ?? []).length === 3 &&
    source.includes('optimisticSourceControlStatus'),
  source,
);

check(
  'batches rapid stage and unstage operations',
  source.includes('SOURCE_CONTROL_BATCH_WINDOW_MS = 3000') &&
    source.includes('enqueueBatchedOperation') &&
    source.includes('flushBatchedOperation') &&
    source.includes('setTimeout(() =>'),
  source,
);

check(
  'updates local status when a response includes status',
  source.includes('if (response.status)') &&
    source.includes('applyStatus(response.status)'),
  source,
);

check(
  'updates local status from embedded commit errors',
  source.includes('sourceControlStatusFromError') &&
    source.includes('errorData?.status ?? null') &&
    source.includes('applyStatus(embeddedStatus)'),
  source,
);

check(
  'guards refresh against stale responses',
  source.includes('requestIdRef') &&
    source.includes('requestIdRef.current === requestId'),
  source,
);

if (failures > 0) process.exit(1);
