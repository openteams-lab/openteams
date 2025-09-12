// useNormalizedLogs.ts
import { useCallback, useMemo } from 'react';
import { useJsonPatchStream } from './useJsonPatchStream';
import { NormalizedEntry } from 'shared/types';

type EntryType = { type: string };

export interface NormalizedEntryContent {
  timestamp: string | null;
  entry_type: EntryType;
  content: string;
  metadata: Record<string, unknown> | null;
}

export interface NormalizedLogsState {
  entries: NormalizedEntry[];
  session_id: string | null;
  executor_type: string;
  prompt: string | null;
  summary: string | null;
}

interface UseNormalizedLogsResult {
  entries: NormalizedEntry[];
  state: NormalizedLogsState | undefined;
  isLoading: boolean;
  isConnected: boolean;
  error: string | null;
}

export const useNormalizedLogs = (
  processId: string,
  enabled: boolean = true
): UseNormalizedLogsResult => {
  const endpoint = `/api/execution-processes/${encodeURIComponent(processId)}/normalized-logs`;

  const initialData = useCallback<() => NormalizedLogsState>(
    () => ({
      entries: [],
      session_id: null,
      executor_type: '',
      prompt: null,
      summary: null,
    }),
    []
  );

  const { data, isConnected, error } = useJsonPatchStream<NormalizedLogsState>(
    endpoint,
    Boolean(processId) && enabled,
    initialData
  );

  const entries = useMemo(() => data?.entries ?? [], [data?.entries]);
  const isLoading = !data && !error;

  return { entries, state: data, isLoading, isConnected, error };
};
