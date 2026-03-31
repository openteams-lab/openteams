import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  versionApi,
  type VersionCheckInfo,
  type VersionUpdateResult,
} from '@/lib/api';

const VERSION_QUERY_KEY = ['version', 'check'] as const;
const VERSION_REFETCH_INTERVAL_MS = 1000 * 60 * 30;

export type VersionRuntime = 'tauri' | 'npx' | 'unknown';

const hasTauriBridge = typeof window !== 'undefined' && '__TAURI__' in window;

const getFallbackCurrentVersion = () =>
  __APP_VERSION__.trim().replace(/^v/, '');

export function useVersionCheck() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: VERSION_QUERY_KEY,
    queryFn: () => versionApi.check(),
    refetchInterval: VERSION_REFETCH_INTERVAL_MS,
    retry: 1,
  });
  const { refetch } = query;

  const versionInfo: VersionCheckInfo | null = query.data ?? null;
  const runtime: VersionRuntime = versionInfo?.deploy_mode ?? 'unknown';
  const isTauri = runtime === 'tauri';
  const isNpx = runtime === 'npx';
  const canSelfUpdate = isTauri || isNpx;

  const updateNpxMutation = useMutation({
    mutationFn: () => versionApi.updateNpx(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VERSION_QUERY_KEY });
    },
  });
  const { mutateAsync: updateNpxMutateAsync } = updateNpxMutation;

  const restartMutation = useMutation({
    mutationFn: async (): Promise<VersionUpdateResult> => {
      if (versionInfo?.deploy_mode === 'tauri') {
        if (!hasTauriBridge) {
          throw new Error('Tauri updater API is unavailable.');
        }

        const { relaunch } = await import('@tauri-apps/api/process');
        await relaunch();

        return {
          success: true,
          message: 'Application relaunch requested.',
        };
      }

      if (versionInfo?.deploy_mode !== 'npx') {
        throw new Error('Self-update is unavailable in this deployment mode.');
      }

      const response = await versionApi.restart();
      window.setTimeout(() => {
        window.location.reload();
      }, 1200);
      return response;
    },
  });
  const { mutateAsync: restartMutateAsync } = restartMutation;

  const checkNow = useCallback(() => refetch(), [refetch]);
  const updateNowInNpx = useCallback(() => {
    if (runtime !== 'npx') {
      return Promise.reject(
        new Error('Self-update is unavailable in this deployment mode.')
      );
    }
    return updateNpxMutateAsync();
  }, [runtime, updateNpxMutateAsync]);
  const restartNow = useCallback(
    () => restartMutateAsync(),
    [restartMutateAsync]
  );

  return {
    runtime,
    isTauri,
    isNpx,
    canSelfUpdate,
    versionInfo,
    currentVersion: versionInfo?.current_version ?? getFallbackCurrentVersion(),
    latestVersion: versionInfo?.latest_version ?? null,
    hasUpdate: versionInfo?.has_update ?? false,
    releaseUrl: versionInfo?.release_url ?? null,
    releaseNotes: versionInfo?.release_notes ?? null,
    publishedAt: versionInfo?.published_at ?? null,
    isChecking: query.isLoading || query.isFetching,
    checkError: query.error,
    checkNow,
    updateNpx: updateNowInNpx,
    isUpdating: updateNpxMutation.isPending,
    updateError: updateNpxMutation.error,
    restartApp: restartNow,
    isRestarting: restartMutation.isPending,
    restartError: restartMutation.error,
  };
}
