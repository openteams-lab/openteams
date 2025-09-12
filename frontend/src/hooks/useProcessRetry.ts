// hooks/useProcessRetry.ts
import { useCallback, useMemo, useState } from 'react';
import { useAttemptExecution } from '@/hooks/useAttemptExecution';
import { useBranchStatus } from '@/hooks/useBranchStatus';
import { showModal } from '@/lib/modals';
import {
  shouldShowInLogs,
  isCodingAgent,
  PROCESS_RUN_REASONS,
} from '@/constants/processes';
import type { ExecutionProcess, TaskAttempt } from 'shared/types';
import type {
  ExecutorActionType,
  CodingAgentInitialRequest,
  CodingAgentFollowUpRequest,
} from 'shared/types';

function isCodingAgentActionType(
  t: ExecutorActionType
): t is
  | ({ type: 'CodingAgentInitialRequest' } & CodingAgentInitialRequest)
  | ({ type: 'CodingAgentFollowUpRequest' } & CodingAgentFollowUpRequest) {
  return (
    t.type === 'CodingAgentInitialRequest' ||
    t.type === 'CodingAgentFollowUpRequest'
  );
}

/**
 * Reusable hook to retry a process given its executionProcessId and a new prompt.
 * Handles:
 *  - Preventing retry while anything is running (or that process is already running)
 *  - Optional worktree reset (via modal)
 *  - Variant extraction for coding-agent processes
 *  - Refetching attempt + branch data after replace
 */
export function useProcessRetry(attempt: TaskAttempt | undefined) {
  const attemptId = attempt?.id;

  // Fetch attempt + branch state the same way your component did
  const { attemptData, refetch: refetchAttempt } =
    useAttemptExecution(attemptId);
  const { data: branchStatus, refetch: refetchBranch } =
    useBranchStatus(attemptId);

  const [busy, setBusy] = useState(false);

  // Any process running at all?
  const anyRunning = useMemo(
    () => (attemptData.processes || []).some((p) => p.status === 'running'),
    [attemptData.processes?.map((p) => p.status).join(',')]
  );

  // Convenience lookups
  const getProcessById = useCallback(
    (pid: string): ExecutionProcess | undefined =>
      (attemptData.processes || []).find((p) => p.id === pid),
    [attemptData.processes]
  );

  /**
   * Returns whether a process is currently allowed to retry, and why not.
   * Useful if you want to gray out buttons in any component.
   */
  const getRetryDisabledState = useCallback(
    (pid: string) => {
      const proc = getProcessById(pid);
      const isRunningProc = proc?.status === 'running';
      const disabled = busy || anyRunning || isRunningProc;
      let reason: string | undefined;
      if (isRunningProc) reason = 'Finish or stop this run to retry.';
      else if (anyRunning) reason = 'Cannot retry while a process is running.';
      else if (busy) reason = 'Retry in progress.';
      return { disabled, reason };
    },
    [busy, anyRunning, getProcessById]
  );

  /**
   * Primary entrypoint: retry a process with a new prompt.
   */
  const retryProcess = useCallback(
    async (executionProcessId: string, newPrompt: string) => {
      if (!attemptId) return;

      const proc = getProcessById(executionProcessId);
      if (!proc) return;

      // Respect current disabled state
      const { disabled } = getRetryDisabledState(executionProcessId);
      if (disabled) return;

      type WithBefore = { before_head_commit?: string | null };
      const before =
        (proc as WithBefore | undefined)?.before_head_commit || null;

      // Try to gather comparison info (best-effort)
      let targetSubject: string | null = null;
      let commitsToReset: number | null = null;
      let isLinear: boolean | null = null;

      if (before) {
        try {
          const { commitsApi } = await import('@/lib/api');
          const info = await commitsApi.getInfo(attemptId, before);
          targetSubject = info.subject;
          const cmp = await commitsApi.compareToHead(attemptId, before);
          commitsToReset = cmp.is_linear ? cmp.ahead_from_head : null;
          isLinear = cmp.is_linear;
        } catch {
          // ignore best-effort enrichments
        }
      }

      const head = branchStatus?.head_oid || null;
      const dirty = !!branchStatus?.has_uncommitted_changes;
      const needReset = !!(before && (before !== head || dirty));
      const canGitReset = needReset && !dirty;

      // Compute “later processes” context for the dialog
      const procs = (attemptData.processes || []).filter(
        (p) => !p.dropped && shouldShowInLogs(p.run_reason)
      );
      const idx = procs.findIndex((p) => p.id === executionProcessId);
      const later = idx >= 0 ? procs.slice(idx + 1) : [];
      const laterCount = later.length;
      const laterCoding = later.filter((p) =>
        isCodingAgent(p.run_reason)
      ).length;
      const laterSetup = later.filter(
        (p) => p.run_reason === PROCESS_RUN_REASONS.SETUP_SCRIPT
      ).length;
      const laterCleanup = later.filter(
        (p) => p.run_reason === PROCESS_RUN_REASONS.CLEANUP_SCRIPT
      ).length;

      // Ask user for confirmation / reset options
      let modalResult:
        | {
            action: 'confirmed' | 'canceled';
            performGitReset?: boolean;
            forceWhenDirty?: boolean;
          }
        | undefined;

      try {
        modalResult = await showModal<
          typeof modalResult extends infer T
            ? T extends object
              ? T
              : never
            : never
        >('restore-logs', {
          targetSha: before,
          targetSubject,
          commitsToReset,
          isLinear,
          laterCount,
          laterCoding,
          laterSetup,
          laterCleanup,
          needGitReset: needReset,
          canGitReset,
          hasRisk: dirty,
          uncommittedCount: branchStatus?.uncommitted_count ?? 0,
          untrackedCount: branchStatus?.untracked_count ?? 0,
          // Defaults
          initialWorktreeResetOn: true,
          initialForceReset: false,
        });
      } catch {
        // user closed dialog
        return;
      }

      if (!modalResult || modalResult.action !== 'confirmed') return;

      let variant: string | null = null;

      const typ = proc?.executor_action?.typ; // type: ExecutorActionType

      if (typ && isCodingAgentActionType(typ)) {
        // executor_profile_id is ExecutorProfileId -> has `variant: string | null`
        variant = typ.executor_profile_id.variant;
      }

      // Perform the replacement
      try {
        setBusy(true);
        const { attemptsApi } = await import('@/lib/api');
        await attemptsApi.replaceProcess(attemptId, {
          process_id: executionProcessId,
          prompt: newPrompt,
          variant,
          perform_git_reset: modalResult.performGitReset ?? true,
          force_when_dirty: modalResult.forceWhenDirty ?? false,
        });

        // Refresh local caches
        await refetchAttempt();
        await refetchBranch();
      } finally {
        setBusy(false);
      }
    },
    [
      attemptId,
      attemptData.processes,
      branchStatus?.head_oid,
      branchStatus?.has_uncommitted_changes,
      branchStatus?.uncommitted_count,
      branchStatus?.untracked_count,
      getProcessById,
      getRetryDisabledState,
      refetchAttempt,
      refetchBranch,
    ]
  );

  return {
    retryProcess,
    busy,
    anyRunning,
    /** Helpful for buttons/tooltips */
    getRetryDisabledState,
  };
}

export type UseProcessRetryReturn = ReturnType<typeof useProcessRetry>;
