// Smoke tests for the AsyncResourceState helpers used by WorkspaceContext.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/lib/asyncResource.test.ts
// Exits non-zero if any assertion fails.

import {
  initialAsync,
  beginLoad,
  succeed,
  fail,
  type AsyncResourceState,
} from './asyncResource';

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

const eq = <T>(label: string, actual: T, expected: T) =>
  check(label, Object.is(actual, expected), { actual, expected });

// ----- initialAsync ----------------------------------------------------------

const mock = [1, 2, 3];
const init = initialAsync<number[]>(mock);
eq('initial.source is mock', init.source, 'mock');
eq('initial.loading false', init.loading, false);
eq('initial.empty false for non-empty array', init.empty, false);
eq('initial.error null', init.error, null);
eq('initial.data is the mock', init.data, mock);

const emptyInit = initialAsync<number[]>([]);
eq('initial.empty true for empty array', emptyInit.empty, true);
const nullInit = initialAsync<null>(null);
eq('initial.empty true for null', nullInit.empty, true);

// ----- beginLoad -------------------------------------------------------------

const loading = beginLoad(init);
eq('beginLoad sets loading=true', loading.loading, true);
eq('beginLoad clears error', loading.error, null);
eq('beginLoad preserves empty', loading.empty, false);
eq('beginLoad preserves data', loading.data, mock);
eq('beginLoad preserves source', loading.source, 'mock');

// loading from an error state should also clear the error
const errored: AsyncResourceState<number[]> = {
  data: mock,
  loading: false,
  empty: false,
  error: 'boom',
  source: 'mock',
};
const reLoading = beginLoad(errored);
eq('beginLoad clears prior error', reLoading.error, null);
eq('beginLoad still loading=true', reLoading.loading, true);

// ----- succeed ---------------------------------------------------------------

const fresh = [10, 20];
const ok = succeed(fresh);
eq('succeed.data is the new payload', ok.data, fresh);
eq('succeed.source is api', ok.source, 'api');
eq('succeed.loading false', ok.loading, false);
eq('succeed.empty false for payload', ok.empty, false);
eq('succeed.error null', ok.error, null);

const okEmpty = succeed<number[]>([]);
eq('succeed.empty true for empty array', okEmpty.empty, true);

// ----- fail ------------------------------------------------------------------

const f1 = fail(loading, new Error('network down'));
eq('fail keeps prev data (no fallback)', f1.data, mock);
eq('fail.source is mock', f1.source, 'mock');
eq('fail.loading false', f1.loading, false);
eq('fail keeps previous empty without fallback', f1.empty, false);
eq('fail.error has message', f1.error, 'network down');

const f2 = fail<number[]>(loading, new Error('x'), [99]);
check('fail uses fallback when provided', f2.data.length === 1 && f2.data[0] === 99, f2);
eq('fail recomputes empty from non-empty fallback', f2.empty, false);

const f2Empty = fail<number[]>(loading, new Error('x'), []);
eq('fail recomputes empty from empty fallback', f2Empty.empty, true);

const f3 = fail(loading, 'string error');
eq('fail coerces non-Error to string', f3.error, 'string error');

const f4 = fail(loading, null);
eq('fail coerces null to "null"', f4.error, 'null');

// ----- summary ---------------------------------------------------------------

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll assertions passed.');
}
