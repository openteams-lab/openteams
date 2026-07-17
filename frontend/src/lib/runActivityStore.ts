import type {
  ChatRunActivityLine,
  ChatRunActivityResponse,
} from '@/types';
import { ApiError } from '@/lib/apiCore';

export type RunActivityStatus =
  | 'idle'
  | 'loading'
  | 'live'
  | 'completed'
  | 'pruned'
  | 'error';

export interface RunActivityState {
  lines: ChatRunActivityLine[];
  cursor: string | null;
  status: RunActivityStatus;
  requestInFlight: boolean;
  dirty: boolean;
  error?: string;
}

type ActivityPageFetcher = (
  runId: string,
  cursor: string | undefined,
) => Promise<ChatRunActivityResponse>;

const EMPTY_STATE: RunActivityState = {
  lines: [],
  cursor: null,
  status: 'idle',
  requestInFlight: false,
  dirty: false,
};

const COMPLETION_RETRY_DELAYS_MS = [100, 200, 400, 800, 1000] as const;
const UPDATE_DEBOUNCE_MS = 75;
const COMPLETED_CACHE_LIMIT = 30;

const sortAndDedupeLines = (
  current: ChatRunActivityLine[],
  incoming: ChatRunActivityLine[],
): ChatRunActivityLine[] => {
  const byId = new Map(current.map((line) => [line.line_id, line]));
  for (const line of incoming) byId.set(line.line_id, line);
  return [...byId.values()].sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return a.line_id.localeCompare(b.line_id);
  });
};

export class RunActivityStore {
  private readonly states = new Map<string, RunActivityState>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly updateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly completionTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly completionAttempts = new Map<string, number>();
  private readonly completionRequested = new Set<string>();
  private readonly lastAccessedAt = new Map<string, number>();
  private disposed = false;

  constructor(private readonly fetchPage: ActivityPageFetcher) {}

  subscribe(runId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    this.touch(runId);
    return () => {
      const current = this.listeners.get(runId);
      current?.delete(listener);
      if (current?.size === 0) this.listeners.delete(runId);
      this.pruneCompletedRuns();
    };
  }

  getSnapshot(runId: string | undefined): RunActivityState {
    if (!runId) return EMPTY_STATE;
    this.touch(runId);
    return this.states.get(runId) ?? EMPTY_STATE;
  }

  ensureLoaded(runId: string): void {
    const state = this.states.get(runId) ?? EMPTY_STATE;
    if (state.status === 'idle' || state.status === 'error') {
      void this.sync(runId);
    }
  }

  notifyUpdated(runId: string, _latestSequence: number): void {
    if (this.disposed) return;
    this.patch(runId, { dirty: true });
    const existing = this.updateTimers.get(runId);
    if (existing) clearTimeout(existing);
    this.updateTimers.set(
      runId,
      setTimeout(() => {
        this.updateTimers.delete(runId);
        void this.sync(runId);
      }, UPDATE_DEBOUNCE_MS),
    );
  }

  requestCompletion(runId: string): void {
    if (this.disposed) return;
    this.completionRequested.add(runId);
    this.completionAttempts.set(runId, 0);
    void this.sync(runId);
  }

  syncRuns(runIds: string[]): void {
    for (const runId of runIds) void this.sync(runId);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.updateTimers.values()) clearTimeout(timer);
    for (const timer of this.completionTimers.values()) clearTimeout(timer);
    this.updateTimers.clear();
    this.completionTimers.clear();
    this.listeners.clear();
  }

  private async sync(runId: string): Promise<void> {
    if (this.disposed) return;
    const current = this.states.get(runId) ?? EMPTY_STATE;
    if (current.requestInFlight) {
      this.patch(runId, { dirty: true });
      return;
    }

    this.patch(runId, {
      requestInFlight: true,
      dirty: false,
      status:
        current.status === 'idle' || current.status === 'error'
          ? 'loading'
          : current.status,
      error: undefined,
    });

    let resetCursorOnce = false;
    try {
      while (!this.disposed) {
        const beforeFetch = this.states.get(runId) ?? EMPTY_STATE;
        // Consume the current dirty flag before issuing the request. A
        // notification arriving while the request is in flight will set it
        // again and trigger exactly one more cursor read.
        if (beforeFetch.dirty) this.patch(runId, { dirty: false });
        let response: ChatRunActivityResponse;
        try {
          response = await this.fetchPage(
            runId,
            beforeFetch.cursor ?? undefined,
          );
        } catch (error) {
          if (error instanceof ApiError && error.status === 409 && !resetCursorOnce) {
            resetCursorOnce = true;
            this.setState(runId, {
              ...beforeFetch,
              lines: [],
              cursor: null,
              dirty: false,
            });
            continue;
          }
          if (error instanceof ApiError && error.status === 410) {
            this.setState(runId, {
              ...beforeFetch,
              lines: [],
              status: 'pruned',
              requestInFlight: false,
              dirty: false,
              error: undefined,
            });
            return;
          }
          throw error;
        }

        const latest = this.states.get(runId) ?? beforeFetch;
        this.setState(runId, {
          ...latest,
          lines: sortAndDedupeLines(latest.lines, response.lines),
          cursor: response.next_cursor,
          status: response.log_state === 'tail' ? 'completed' : 'live',
          requestInFlight: true,
          dirty: latest.dirty,
          error: undefined,
        });

        if (response.has_more) continue;
        if ((this.states.get(runId) ?? EMPTY_STATE).dirty) continue;
        break;
      }

      const latest = this.states.get(runId) ?? EMPTY_STATE;
      this.patch(runId, { requestInFlight: false });
      if (latest.status === 'completed') {
        this.completionRequested.delete(runId);
        this.completionAttempts.delete(runId);
        this.pruneCompletedRuns();
      } else if (this.completionRequested.has(runId)) {
        this.scheduleCompletionRetry(runId);
      }
    } catch (error) {
      const latest = this.states.get(runId) ?? EMPTY_STATE;
      this.setState(runId, {
        ...latest,
        status: 'error',
        requestInFlight: false,
        error: error instanceof Error ? error.message : 'Activity load failed',
      });
    }

    if ((this.states.get(runId) ?? EMPTY_STATE).dirty) {
      void this.sync(runId);
    }
  }

  private scheduleCompletionRetry(runId: string): void {
    const attempt = this.completionAttempts.get(runId) ?? 0;
    const delay = COMPLETION_RETRY_DELAYS_MS[attempt];
    if (delay === undefined || this.completionTimers.has(runId)) return;
    this.completionAttempts.set(runId, attempt + 1);
    this.completionTimers.set(
      runId,
      setTimeout(() => {
        this.completionTimers.delete(runId);
        void this.sync(runId);
      }, delay),
    );
  }

  private patch(runId: string, patch: Partial<RunActivityState>): void {
    this.setState(runId, {
      ...(this.states.get(runId) ?? EMPTY_STATE),
      ...patch,
    });
  }

  private setState(runId: string, state: RunActivityState): void {
    this.states.set(runId, state);
    this.touch(runId);
    for (const listener of this.listeners.get(runId) ?? []) listener();
  }

  private touch(runId: string): void {
    this.lastAccessedAt.set(runId, Date.now());
  }

  private pruneCompletedRuns(): void {
    const candidates = [...this.states.entries()]
      .filter(
        ([runId, state]) =>
          state.status === 'completed' && !this.listeners.has(runId),
      )
      .sort(
        ([left], [right]) =>
          (this.lastAccessedAt.get(right) ?? 0) -
          (this.lastAccessedAt.get(left) ?? 0),
      );
    for (const [runId] of candidates.slice(COMPLETED_CACHE_LIMIT)) {
      this.states.delete(runId);
      this.lastAccessedAt.delete(runId);
    }
  }
}
