import { useCallback } from 'react';
import { useJsonPatchStream } from './useJsonPatchStream';
import type { ExecutionProcess } from 'shared/types';

type ExecutionProcessState = {
  execution_processes: Record<string, ExecutionProcess>;
};

interface UseExecutionProcessesResult {
  executionProcesses: ExecutionProcess[];
  executionProcessesById: Record<string, ExecutionProcess>;
  isLoading: boolean;
  isConnected: boolean;
  error: string | null;
}

/**
 * Stream tasks for a project via SSE (JSON Patch) and expose as array + map.
 * Server sends initial snapshot: replace /tasks with an object keyed by id.
 * Live updates arrive at /tasks/<id> via add/replace/remove operations.
 */
export const useExecutionProcesses = (
  taskAttemptId: string
): UseExecutionProcessesResult => {
  const endpoint = `/api/execution-processes/stream?task_attempt_id=${encodeURIComponent(taskAttemptId)}`;

  const initialData = useCallback(
    (): ExecutionProcessState => ({ execution_processes: {} }),
    []
  );

  const { data, isConnected, error } =
    useJsonPatchStream<ExecutionProcessState>(
      endpoint,
      !!taskAttemptId,
      initialData
    );

  const executionProcessesById = data?.execution_processes ?? {};
  const executionProcesses = Object.values(executionProcessesById).sort(
    (a, b) =>
      new Date(a.created_at as unknown as string).getTime() -
      new Date(b.created_at as unknown as string).getTime()
  );
  const isLoading = !data && !error; // until first snapshot

  return {
    executionProcesses,
    executionProcessesById,
    isLoading,
    isConnected,
    error,
  };
};
