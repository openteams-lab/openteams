import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, projectSourceControlApi } from '@/lib/api';
import {
  SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
  type SourceControlRefreshRequestedDetail,
} from '@/lib/sourceControlEvents';
import type {
  SessionSourceControlStatus,
  SourceControlCommitError,
  SourceControlCommitRequest,
  SourceControlCommitResponse,
  SourceControlDiscardRequest,
  SourceControlOperationResponse,
  SourceControlStageRequest,
  SourceControlUnstageRequest,
} from '@/types';

type StageInput = Omit<SourceControlStageRequest, 'session_id'>;
type UnstageInput = Omit<SourceControlUnstageRequest, 'session_id'>;
type DiscardInput = Omit<SourceControlDiscardRequest, 'session_id'>;
type CommitInput = Omit<SourceControlCommitRequest, 'session_id'>;

const SOURCE_CONTROL_BATCH_WINDOW_MS = 2000;

export interface UseSessionSourceControlParams {
  projectId: string | null;
  sessionId: string | null;
  enabled: boolean;
}

export interface UseSessionSourceControlResult {
  status: SessionSourceControlStatus | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<SessionSourceControlStatus | null>;
  stage: (request: StageInput) => Promise<SourceControlOperationResponse>;
  unstage: (request: UnstageInput) => Promise<SourceControlOperationResponse>;
  discard: (request: DiscardInput) => Promise<SourceControlOperationResponse>;
  commit: (request: CommitInput) => Promise<SourceControlCommitResponse>;
}

const requireSourceControlContext = (
  projectId: string | null,
  sessionId: string | null,
): { projectId: string; sessionId: string } => {
  if (!projectId || !sessionId) {
    throw new Error('Source control requires projectId and sessionId.');
  }
  return { projectId, sessionId };
};

const sourceControlStatusFromError = (
  err: unknown,
): SessionSourceControlStatus | null => {
  if (!(err instanceof ApiError)) return null;
  const errorData = err.errorData as SourceControlCommitError | undefined;
  return errorData?.status ?? null;
};

type SourceControlOptimisticAction = "stage" | "unstage" | "discard";

type SourceControlContext = { projectId: string; sessionId: string };

type BatchedSourceControlAction = "stage" | "unstage";

type BatchedOperationWaiter = {
  resolve: (response: SourceControlOperationResponse) => void;
  reject: (error: unknown) => void;
};

type BatchedOperationState = {
  projectId: string;
  sessionId: string;
  workspaceId: string | null | undefined;
  forceShared: boolean;
  paths: Set<string>;
  waiters: BatchedOperationWaiter[];
  timer: ReturnType<typeof setTimeout> | null;
};

const sortSourceControlFiles = <
  T extends { path: string },
>(
  files: T[],
): T[] => [...files].sort((a, b) => a.path.localeCompare(b.path));

const mergeSourceControlFiles = <
  T extends { path: string },
>(
  base: T[],
  moved: T[],
  replacedPaths: Set<string>,
): T[] => {
  const byPath = new Map<string, T>();
  for (const file of base) {
    if (!replacedPaths.has(file.path)) byPath.set(file.path, file);
  }
  for (const file of moved) byPath.set(file.path, file);
  return sortSourceControlFiles(Array.from(byPath.values()));
};

const sourceControlStatusWithHead = (
  status: SessionSourceControlStatus | null,
  headSha: string | null | undefined,
): SessionSourceControlStatus | null => {
  if (!status || status.mode !== "git" || !headSha) return status;
  return { ...status, head_sha: headSha };
};

const optimisticSourceControlStatus = (
  status: SessionSourceControlStatus | null,
  action: SourceControlOptimisticAction,
  paths: string[],
): SessionSourceControlStatus | null => {
  if (!status || status.mode !== "git" || paths.length === 0) return status;

  const pathSet = new Set(paths);
  const changedMatches = status.changes.filter((file) =>
    pathSet.has(file.path),
  );
  const stagedMatches = status.staged_changes.filter((file) =>
    pathSet.has(file.path),
  );
  const changedPathSet = new Set(changedMatches.map((file) => file.path));
  const stagedPathSet = new Set(stagedMatches.map((file) => file.path));
  const remainingChanges = status.changes.filter(
    (file) => !pathSet.has(file.path),
  );
  const remainingStaged = status.staged_changes.filter(
    (file) => !pathSet.has(file.path),
  );

  if (action === "stage") {
    return {
      ...status,
      changes: sortSourceControlFiles(remainingChanges),
      staged_changes: mergeSourceControlFiles(
        status.staged_changes,
        changedMatches,
        changedPathSet,
      ),
    };
  }

  if (action === "unstage") {
    return {
      ...status,
      changes: mergeSourceControlFiles(
        status.changes,
        stagedMatches,
        stagedPathSet,
      ),
      staged_changes: sortSourceControlFiles(remainingStaged),
    };
  }

  return {
    ...status,
    changes: sortSourceControlFiles(remainingChanges),
    staged_changes: sortSourceControlFiles(remainingStaged),
  };
};

export function useSessionSourceControl({
  projectId,
  sessionId,
  enabled,
}: UseSessionSourceControlParams): UseSessionSourceControlResult {
  const [status, setStatus] = useState<SessionSourceControlStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);
  const statusRef = useRef<SessionSourceControlStatus | null>(null);
  const refreshInFlightRef = useRef<Promise<SessionSourceControlStatus | null> | null>(
    null,
  );
  const refreshQueuedRef = useRef(false);
  const stageBatchRef = useRef<BatchedOperationState | null>(null);
  const unstageBatchRef = useRef<BatchedOperationState | null>(null);

  const applyStatus = useCallback(
    (nextStatus: SessionSourceControlStatus | null) => {
      statusRef.current = nextStatus;
      setStatus(nextStatus);
    },
    [],
  );

  const invalidatePendingRefresh = useCallback(() => {
    requestIdRef.current += 1;
    refreshQueuedRef.current = false;
    refreshInFlightRef.current = null;
    setLoading(false);
  }, []);

  const runRefreshRequest = useCallback(async () => {
    if (!enabled || !projectId || !sessionId) {
      setLoading(false);
      return null;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const nextStatus = await projectSourceControlApi.getSessionStatus(
        projectId,
        sessionId,
      );
      if (requestIdRef.current === requestId) {
        applyStatus(nextStatus);
      }
      return nextStatus;
    } catch (err) {
      if (requestIdRef.current === requestId) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
      throw err;
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [applyStatus, enabled, projectId, sessionId]);

  const refresh = useCallback(async () => {
    if (!enabled || !projectId || !sessionId) {
      refreshQueuedRef.current = false;
      refreshInFlightRef.current = null;
      setLoading(false);
      return null;
    }

    const existingRefresh = refreshInFlightRef.current;
    if (existingRefresh) {
      refreshQueuedRef.current = true;
      return existingRefresh;
    }

    const refreshPromise = (async () => {
      let latestStatus = await runRefreshRequest();
      while (refreshQueuedRef.current && enabled && projectId && sessionId) {
        refreshQueuedRef.current = false;
        latestStatus = await runRefreshRequest();
      }
      return latestStatus;
    })().finally(() => {
      if (refreshInFlightRef.current === refreshPromise) {
        refreshInFlightRef.current = null;
      }
      refreshQueuedRef.current = false;
    });

    refreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, [enabled, projectId, runRefreshRequest, sessionId]);

  const batchRefForAction = (action: BatchedSourceControlAction) =>
    action === "stage" ? stageBatchRef : unstageBatchRef;

  const flushBatchedOperation = useCallback(
    async (action: BatchedSourceControlAction) => {
      const batchRef = batchRefForAction(action);
      const batch = batchRef.current;
      if (!batch) return null;
      batchRef.current = null;
      if (batch.timer) clearTimeout(batch.timer);

      const paths = Array.from(batch.paths).sort();
      const request =
        action === "stage"
          ? projectSourceControlApi.stage(
              batch.projectId,
              {
                session_id: batch.sessionId,
                workspace_id: batch.workspaceId,
                paths,
                force_shared: batch.forceShared || undefined,
              },
              { response: "fast" },
            )
          : projectSourceControlApi.unstage(
              batch.projectId,
              {
                session_id: batch.sessionId,
                workspace_id: batch.workspaceId,
                paths,
              },
              { response: "fast" },
            );

      try {
        const response = await request;
        if (response.status) {
          applyStatus(response.status);
        } else {
          void refresh().catch(() => undefined);
        }
        for (const waiter of batch.waiters) waiter.resolve(response);
        return response;
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        void refresh().catch(() => undefined);
        for (const waiter of batch.waiters) waiter.reject(err);
        return null;
      }
    },
    [applyStatus, refresh],
  );

  useEffect(() => {
    requestIdRef.current += 1;
    refreshQueuedRef.current = false;
    refreshInFlightRef.current = null;

    if (!enabled || !projectId || !sessionId) {
      applyStatus(null);
      setLoading(false);
      setError(null);
      return;
    }
    void refresh();
  }, [applyStatus, enabled, projectId, refresh, sessionId]);

  useEffect(() => {
    if (!enabled || !projectId || !sessionId) return;

    const handleSourceControlRefresh = (event: Event) => {
      const detail = (
        event as CustomEvent<SourceControlRefreshRequestedDetail>
      ).detail;
      if (!detail || detail.sessionId !== sessionId) return;
      if (detail.projectId && detail.projectId !== projectId) return;

      void refresh().catch(() => undefined);
    };

    window.addEventListener(
      SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
      handleSourceControlRefresh,
    );
    return () => {
      window.removeEventListener(
        SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
        handleSourceControlRefresh,
      );
    };
  }, [enabled, projectId, refresh, sessionId]);

  const enqueueBatchedOperation = useCallback(
    (
      action: BatchedSourceControlAction,
      request: StageInput | UnstageInput,
    ): Promise<SourceControlOperationResponse> => {
      const context = requireSourceControlContext(projectId, sessionId);
      const workspaceId = request.workspace_id ?? null;
      const batchRef = batchRefForAction(action);
      const existingBatch = batchRef.current;
      if (
        existingBatch &&
        (existingBatch.projectId !== context.projectId ||
          existingBatch.sessionId !== context.sessionId ||
          existingBatch.workspaceId !== workspaceId)
      ) {
        void flushBatchedOperation(action);
      }

      requestIdRef.current += 1;
      applyStatus(
        optimisticSourceControlStatus(
          statusRef.current,
          action,
          request.paths,
        ),
      );
      setError(null);

      return new Promise((resolve, reject) => {
        let batch = batchRef.current;
        if (!batch) {
          batch = {
            projectId: context.projectId,
            sessionId: context.sessionId,
            workspaceId,
            forceShared: false,
            paths: new Set<string>(),
            waiters: [],
            timer: null,
          };
          batchRef.current = batch;
        }

        for (const path of request.paths) batch.paths.add(path);
        if (action === "stage" && "force_shared" in request) {
          batch.forceShared ||= Boolean(request.force_shared);
        }
        batch.waiters.push({ resolve, reject });

        if (batch.timer) clearTimeout(batch.timer);
        batch.timer = setTimeout(() => {
          void flushBatchedOperation(action);
        }, SOURCE_CONTROL_BATCH_WINDOW_MS);
      });
    },
    [applyStatus, flushBatchedOperation, projectId, sessionId],
  );

  useEffect(
    () => () => {
      void flushBatchedOperation("stage");
      void flushBatchedOperation("unstage");
    },
    [flushBatchedOperation],
  );

  const runOptimisticOperation = useCallback(
    async (
      action: SourceControlOptimisticAction,
      paths: string[],
      operation: (
        context: SourceControlContext,
      ) => Promise<SourceControlOperationResponse>,
    ): Promise<SourceControlOperationResponse> => {
      const context = requireSourceControlContext(projectId, sessionId);
      requestIdRef.current += 1;
      const previousStatus = statusRef.current;
      applyStatus(optimisticSourceControlStatus(previousStatus, action, paths));
      setError(null);

      try {
        const response = await operation(context);
        if (response.status) {
          applyStatus(response.status);
        } else {
          applyStatus(
            sourceControlStatusWithHead(
              optimisticSourceControlStatus(
                previousStatus,
                action,
                response.succeeded,
              ),
              response.head_sha,
            ),
          );
          void refresh().catch(() => undefined);
        }
        return response;
      } catch (err) {
        applyStatus(previousStatus);
        setError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    },
    [applyStatus, projectId, refresh, sessionId],
  );

  const stage = useCallback(
    async (request: StageInput) => {
      return enqueueBatchedOperation("stage", request);
    },
    [enqueueBatchedOperation],
  );

  const unstage = useCallback(
    async (request: UnstageInput) => {
      return enqueueBatchedOperation("unstage", request);
    },
    [enqueueBatchedOperation],
  );

  const discard = useCallback(
    async (request: DiscardInput) => {
      return runOptimisticOperation("discard", request.paths, (context) =>
        projectSourceControlApi.discard(
          context.projectId,
          {
            ...request,
            session_id: context.sessionId,
          },
          { response: "fast" },
        ),
      );
    },
    [runOptimisticOperation],
  );

  const commit = useCallback(
    async (request: CommitInput) => {
      const context = requireSourceControlContext(projectId, sessionId);
      try {
        // Commit must use the current Git index only. Flushing staged writes
        // here can pull newer worktree edits into the commit.
        await flushBatchedOperation("unstage");
        invalidatePendingRefresh();
        const response = await projectSourceControlApi.commit(context.projectId, {
          ...request,
          session_id: context.sessionId,
        });
        invalidatePendingRefresh();
        if (response.status) {
          applyStatus(response.status);
        } else {
          applyStatus(
            sourceControlStatusWithHead(
              optimisticSourceControlStatus(
                statusRef.current,
                "discard",
                response.committed_paths,
              ),
              response.commit_sha,
            ),
          );
          void refresh().catch(() => undefined);
        }
        return response;
      } catch (err) {
        const embeddedStatus = sourceControlStatusFromError(err);
        if (embeddedStatus) {
          applyStatus(embeddedStatus);
        }
        throw err;
      }
    },
    [
      applyStatus,
      flushBatchedOperation,
      invalidatePendingRefresh,
      projectId,
      refresh,
      sessionId,
    ],
  );

  return {
    status,
    loading,
    error,
    refresh,
    stage,
    unstage,
    discard,
    commit,
  };
}
