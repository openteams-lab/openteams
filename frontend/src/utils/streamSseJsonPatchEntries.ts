// sseJsonPatchEntries.ts
import { applyPatch, type Operation } from 'rfc6902';

type PatchContainer<E = unknown> = { entries: E[] };

export interface StreamOptions<E = unknown> {
  initial?: PatchContainer<E>;
  eventSourceInit?: EventSourceInit;
  /** called after each successful patch application */
  onEntries?: (entries: E[]) => void;
  onConnect?: () => void;
  onError?: (err: unknown) => void;
  /** called once when a "finished" event is received */
  onFinished?: (entries: E[]) => void;
}

/**
 * Connect to an SSE endpoint that emits:
 *   event: json_patch
 *   data: [ { op, path, value? }, ... ]
 *
 * Maintains an in-memory { entries: [] } snapshot and returns a controller.
 */
export function streamSseJsonPatchEntries<E = unknown>(
  url: string,
  opts: StreamOptions<E> = {}
) {
  let connected = false;
  let snapshot: PatchContainer<E> = structuredClone(
    opts.initial ?? ({ entries: [] } as PatchContainer<E>)
  );

  const subscribers = new Set<(entries: E[]) => void>();
  if (opts.onEntries) subscribers.add(opts.onEntries);

  const es = new EventSource(url, opts.eventSourceInit);

  const notify = () => {
    for (const cb of subscribers) {
      try {
        cb(snapshot.entries);
      } catch {
        /* swallow subscriber errors */
      }
    }
  };

  const handlePatchEvent = (e: MessageEvent<string>) => {
    try {
      const raw = JSON.parse(e.data) as Operation[];
      const ops = dedupeOps(raw);

      // Apply to a working copy (applyPatch mutates)
      const next = structuredClone(snapshot);
      applyPatch(next as unknown as object, ops);

      snapshot = next;
      notify();
    } catch (err) {
      opts.onError?.(err);
    }
  };

  es.addEventListener('open', () => {
    connected = true;
    opts.onConnect?.();
  });

  // The server uses a named event: "json_patch"
  es.addEventListener('json_patch', handlePatchEvent);

  es.addEventListener('finished', () => {
    opts.onFinished?.(snapshot.entries);
    es.close();
  });

  es.addEventListener('error', (err) => {
    connected = false; // EventSource will auto-retry; this just reflects current state
    opts.onError?.(err);
  });

  return {
    /** Current entries array (immutable snapshot) */
    getEntries(): E[] {
      return snapshot.entries;
    },
    /** Full { entries } snapshot */
    getSnapshot(): PatchContainer<E> {
      return snapshot;
    },
    /** Best-effort connection state (EventSource will auto-reconnect) */
    isConnected(): boolean {
      return connected;
    },
    /** Subscribe to updates; returns an unsubscribe function */
    onChange(cb: (entries: E[]) => void): () => void {
      subscribers.add(cb);
      // push current state immediately
      cb(snapshot.entries);
      return () => subscribers.delete(cb);
    },
    /** Close the stream */
    close(): void {
      es.close();
      subscribers.clear();
      connected = false;
    },
  };
}

/**
 * Dedupe multiple ops that touch the same path within a single event.
 * Last write for a path wins, while preserving the overall left-to-right
 * order of the *kept* final operations.
 *
 * Example:
 *   add /entries/4, replace /entries/4  -> keep only the final replace
 */
function dedupeOps(ops: Operation[]): Operation[] {
  const lastIndexByPath = new Map<string, number>();
  ops.forEach((op, i) => lastIndexByPath.set(op.path, i));

  // Keep only the last op for each path, in ascending order of their final index
  const keptIndices = [...lastIndexByPath.values()].sort((a, b) => a - b);
  return keptIndices.map((i) => ops[i]!);
}
