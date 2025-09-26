import { useCallback } from 'react';
import type { PatchType } from 'shared/types';
import { useJsonPatchWsStream } from './useJsonPatchWsStream';

interface DiffState {
  entries: Record<string, PatchType>;
}

interface UseDiffStreamResult {
  data: DiffState | undefined;
  isConnected: boolean;
  error: string | null;
}

export const useDiffStream = (
  attemptId: string | null,
  enabled: boolean
): UseDiffStreamResult => {
  const endpoint = attemptId
    ? `/api/task-attempts/${attemptId}/diff/ws`
    : undefined;

  const initialData = useCallback(
    (): DiffState => ({
      entries: {},
    }),
    []
  );

  const { data, isConnected, error } = useJsonPatchWsStream(
    endpoint,
    enabled && !!attemptId,
    initialData
    // No need for injectInitialEntry or deduplicatePatches for diffs
  );

  return { data, isConnected, error };
};
