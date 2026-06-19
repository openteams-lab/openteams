// =============================================================================
// AsyncResourceState helpers
// -----------------------------------------------------------------------------
// Tiny, framework-agnostic state-machine helpers shared by WorkspaceContext for
// every API-backed resource. Each resource has:
//   - data       : current value (mock fallback initially, API value after load)
//   - loading    : true while a fetch is in flight
//   - empty      : true when the current value has no displayable payload
//   - error      : last error message (null when no error)
//   - source     : 'mock' when data is the local fallback, 'api' on success
//
// Consumers read these flags to render loading, empty, and error UI states and
// to know when to surface a "retry" affordance.
// =============================================================================

export type AsyncSource = 'api' | 'mock';

export interface AsyncResourceState<T> {
  data: T;
  loading: boolean;
  empty: boolean;
  error: string | null;
  source: AsyncSource;
}

const isEmptyPayload = <T>(data: T): boolean => {
  if (data === null || data === undefined) return true;
  if (Array.isArray(data)) return data.length === 0;
  return false;
};

/** Construct the initial state with a mock fallback payload. */
export const initialAsync = <T>(mock: T): AsyncResourceState<T> => ({
  data: mock,
  loading: false,
  empty: isEmptyPayload(mock),
  error: null,
  source: 'mock',
});

/** Transition to "loading" while preserving the previous data + source. */
export const beginLoad = <T>(
  prev: AsyncResourceState<T>,
): AsyncResourceState<T> => ({
  ...prev,
  loading: true,
  error: null,
});

/** Transition to success with a fresh API payload. */
export const succeed = <T>(data: T): AsyncResourceState<T> => ({
  data,
  loading: false,
  empty: isEmptyPayload(data),
  error: null,
  source: 'api',
});

/**
 * Transition to error. Keeps the previous data unless an explicit `fallback`
 * is provided, in which case the mock fallback replaces the data so the UI
 * has something to render after a contract gap or backend outage.
 */
export const fail = <T>(
  prev: AsyncResourceState<T>,
  err: unknown,
  fallback?: T,
): AsyncResourceState<T> => {
  const data = fallback !== undefined ? fallback : prev.data;
  return {
    data,
    loading: false,
    empty: fallback !== undefined ? isEmptyPayload(fallback) : prev.empty,
    error:
      err instanceof Error
        ? err.message
        : err === null
          ? 'null'
          : typeof err === 'string'
            ? err
            : String(err),
    source: 'mock',
  };
};
