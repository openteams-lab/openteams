import { useCallback, useEffect, useRef, useState } from 'react';

import { chatSessionWorktreeApi } from '@/lib/api';
import {
  SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
  notifySourceControlRefreshRequested,
} from '@/lib/sourceControlEvents';
import type {
  SessionWorktree,
  SessionWorktreeMergeResult,
  SessionWorktreeStatus,
} from '@/types';

// Lazy state machine mirror for `chat_session_worktrees`. The backend reducer
// is the only legal writer; this hook only re-reads after each action and
// exposes the latest row. `enabled=false` keeps the network quiet for sessions
// that never opted into isolation, preserving the legacy main-workspace UX.
export interface UseSessionWorktreeParams {
  sessionId: string | null;
  enabled: boolean;
}

export interface UseSessionWorktreeResult {
  worktree: SessionWorktree | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<SessionWorktree | null>;
  prepare: () => Promise<SessionWorktree>;
  merge: (
    options?: { commitMessage?: string; targetBranch?: string },
  ) => Promise<SessionWorktreeMergeResult>;
  discard: () => Promise<SessionWorktree>;
  cleanup: () => Promise<SessionWorktree>;
  retryCleanup: () => Promise<SessionWorktree>;
  forceRemove: () => Promise<SessionWorktree>;
  continueMerge: (commitMessage?: string) => Promise<SessionWorktree>;
  abortMerge: () => Promise<SessionWorktree>;
}

const WORKTREE_WORKSPACE_STATUSES = new Set<SessionWorktreeStatus>([
  'creating',
  'active',
  'dirty',
  'merging',
  'needs_conflict_resolution',
  'merged',
]);

const selectedWorktreeWorkspacePath = (
  worktree: SessionWorktree,
): string | null =>
  WORKTREE_WORKSPACE_STATUSES.has(worktree.status)
    ? worktree.worktree_path
    : worktree.base_workspace_path;

export function useSessionWorktree({
  sessionId,
  enabled,
}: UseSessionWorktreeParams): UseSessionWorktreeResult {
  const [worktree, setWorktree] = useState<SessionWorktree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);
  const worktreeRef = useRef<SessionWorktree | null>(null);
  const lastNotifiedWorkspaceRouteRef = useRef<string | null>(null);

  const applyWorktree = useCallback((next: SessionWorktree | null) => {
    worktreeRef.current = next;
    setWorktree(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || !sessionId) {
      setLoading(false);
      return null;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const next = await chatSessionWorktreeApi.getStatus(sessionId);
      if (requestIdRef.current === requestId) applyWorktree(next);
      return next;
    } catch (err) {
      if (requestIdRef.current === requestId) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
      throw err;
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [applyWorktree, enabled, sessionId]);

  useEffect(() => {
    if (!enabled || !sessionId) {
      requestIdRef.current += 1;
      applyWorktree(null);
      setLoading(false);
      setError(null);
      return;
    }
    void refresh().catch(() => undefined);
  }, [applyWorktree, enabled, refresh, sessionId]);

  // Cross-component refresh signal: when source-control is refreshed (e.g.
  // after a stage/discard), re-read the worktree row so the badge stays in
  // sync with the reducer's latest status.
  useEffect(() => {
    if (!enabled || !sessionId) return;
    const handleRefresh = (event: Event) => {
      const detail = (
        event as CustomEvent<{ sessionId?: string; projectId?: string }>
      ).detail;
      if (detail?.sessionId && detail.sessionId !== sessionId) return;
      void refresh().catch(() => undefined);
    };
    window.addEventListener(
      SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
      handleRefresh,
    );
    return () => {
      window.removeEventListener(
        SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
        handleRefresh,
      );
    };
  }, [enabled, refresh, sessionId]);

  const runAction = useCallback(
    async <T>(
      operation: () => Promise<T>,
      options: { applyResult?: (result: T) => void } = {},
    ): Promise<T> => {
      setError(null);
      try {
        const result = await operation();
        options.applyResult?.(result);
        // Always re-read after a mutating action so we reflect the reducer's
        // authoritative status (handles compare-and-swap races and backend
        // cleanup side-effects).
        await refresh().catch(() => undefined);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        // Mutating routes can fail after the backend has already repaired the
        // reducer state (for example, merge transitions `merging` -> `dirty`
        // on Git errors). Re-read so the badge does not stay on the transient
        // state while the error is shown to the user.
        await refresh().catch(() => undefined);
        throw err;
      }
    },
    [refresh],
  );

  const prepare = useCallback(
    () =>
      runAction(
        () =>
          chatSessionWorktreeApi.prepare(sessionId ?? '', {
            base_workspace_path: null,
          }),
        { applyResult: applyWorktree },
      ),
    [applyWorktree, runAction, sessionId],
  );

  const merge = useCallback(
    (options?: { commitMessage?: string; targetBranch?: string }) =>
      runAction(
        () =>
          chatSessionWorktreeApi.merge(sessionId ?? '', {
            commit_message: options?.commitMessage ?? null,
            target_branch: options?.targetBranch ?? null,
          }),
        { applyResult: (result) => applyWorktree(result.worktree) },
      ),
    [applyWorktree, runAction, sessionId],
  );

  const discard = useCallback(
    () =>
      runAction(() => chatSessionWorktreeApi.discard(sessionId ?? ''), {
        applyResult: applyWorktree,
      }),
    [applyWorktree, runAction, sessionId],
  );

  const cleanup = useCallback(
    () =>
      runAction(() => chatSessionWorktreeApi.cleanup(sessionId ?? ''), {
        applyResult: applyWorktree,
      }),
    [applyWorktree, runAction, sessionId],
  );

  const retryCleanup = useCallback(
    () =>
      runAction(() => chatSessionWorktreeApi.retryCleanup(sessionId ?? ''), {
        applyResult: applyWorktree,
      }),
    [applyWorktree, runAction, sessionId],
  );

  const forceRemove = useCallback(
    () =>
      runAction(() => chatSessionWorktreeApi.forceRemove(sessionId ?? ''), {
        applyResult: applyWorktree,
      }),
    [applyWorktree, runAction, sessionId],
  );

  const continueMerge = useCallback(
    (commitMessage?: string) =>
      runAction(() =>
        chatSessionWorktreeApi.continueMerge(sessionId ?? '', {
          commit_message: commitMessage ?? null,
        }),
        { applyResult: applyWorktree },
      ),
    [applyWorktree, runAction, sessionId],
  );

  const abortMerge = useCallback(
    () =>
      runAction(() => chatSessionWorktreeApi.abortMerge(sessionId ?? ''), {
        applyResult: applyWorktree,
      }),
    [applyWorktree, runAction, sessionId],
  );

  // The backend can lazy-create a worktree from the first agent run rather
  // than from this panel. In-flight merges are also polled so another tab or a
  // slow route response cannot leave the badge visually stuck on `merging`.
  // Merged worktrees are polled so the service can promote them back to
  // `dirty` when new commits appear on the session branch.
  useEffect(() => {
    if (!enabled || !sessionId) return;
    if (
      worktree &&
      !['creating', 'merging', 'merged'].includes(worktree.status)
    ) {
      return;
    }
    const interval = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(interval);
  }, [enabled, refresh, sessionId, worktree]);

  // Worktree creation can happen lazily from the first run, outside this
  // panel. Notify source-control whenever the effective workspace route
  // changes so branch/status chips switch from the base workspace to the
  // session worktree without requiring a manual refresh.
  useEffect(() => {
    if (!enabled || !sessionId || !worktree) {
      lastNotifiedWorkspaceRouteRef.current = null;
      return;
    }

    const workspacePath = selectedWorktreeWorkspacePath(worktree);
    if (!workspacePath) return;

    const routeKey = `${worktree.status}:${workspacePath}`;
    if (lastNotifiedWorkspaceRouteRef.current !== routeKey) {
      lastNotifiedWorkspaceRouteRef.current = routeKey;
      notifySourceControlRefreshRequested({ sessionId });
    }
  }, [
    enabled,
    sessionId,
    worktree?.base_workspace_path,
    worktree?.status,
    worktree?.worktree_path,
  ]);

  return {
    worktree,
    loading,
    error,
    refresh,
    prepare,
    merge,
    discard,
    cleanup,
    retryCleanup,
    forceRemove,
    continueMerge,
    abortMerge,
  };
}
