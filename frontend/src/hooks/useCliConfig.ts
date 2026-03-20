import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cliConfigApi } from '@/lib/api';
import type {
  CliConfig,
  CliProviderId,
  ValidateCliProviderRequest,
  SyncToCliRequest,
} from '@/types/cliConfig';

export const cliConfigKeys = {
  all: ['cli-config'] as const,
  config: () => ['cli-config', 'config'] as const,
  providers: () => ['cli-config', 'providers'] as const,
  models: (provider: CliProviderId) =>
    ['cli-config', 'models', provider] as const,
};

export function useCliConfig() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: cliConfigKeys.config(),
    queryFn: () => cliConfigApi.getConfig(),
    staleTime: 1000 * 60,
  });

  const saveMutation = useMutation({
    mutationFn: (config: CliConfig) => cliConfigApi.updateConfig(config),
    onSuccess: (savedConfig) => {
      queryClient.setQueryData(cliConfigKeys.config(), savedConfig);
      queryClient.invalidateQueries({ queryKey: cliConfigKeys.providers() });
    },
  });

  const syncMutation = useMutation({
    mutationFn: (data?: SyncToCliRequest) => cliConfigApi.syncToCli(data),
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    save: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    syncToCli: syncMutation.mutateAsync,
    isSyncing: syncMutation.isPending,
  };
}

export function useCliProviders() {
  return useQuery({
    queryKey: cliConfigKeys.providers(),
    queryFn: () => cliConfigApi.listProviders(),
    staleTime: 1000 * 60,
  });
}

export function useCliProviderModels(provider: CliProviderId | null) {
  return useQuery({
    queryKey: provider ? cliConfigKeys.models(provider) : cliConfigKeys.all,
    queryFn: () => {
      if (!provider) {
        return Promise.resolve([]);
      }
      return cliConfigApi.listProviderModels(provider);
    },
    enabled: provider != null && provider !== 'custom',
    staleTime: 1000 * 60,
  });
}

export function useValidateCliProvider() {
  return useMutation({
    mutationFn: ({
      provider,
      data,
    }: {
      provider: CliProviderId;
      data: ValidateCliProviderRequest;
    }) => cliConfigApi.validateProvider(provider, data),
  });
}
