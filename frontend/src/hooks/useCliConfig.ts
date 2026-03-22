import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cliConfigApi } from '@/lib/api';
import type {
  CliConfig,
  CustomProviderEntry,
  CliProviderId,
  ValidateCliProviderRequest,
  SyncToCliRequest,
} from '@/types/cliConfig';

export const cliConfigKeys = {
  all: ['cli-config'] as const,
  config: () => ['cli-config', 'config'] as const,
  providers: () => ['cli-config', 'providers'] as const,
  customProviders: () => ['cli-config', 'custom-providers'] as const,
  models: (provider: CliProviderId) =>
    ['cli-config', 'models', provider] as const,
};

function invalidateExecutorCaches(
  queryClient: ReturnType<typeof useQueryClient>
) {
  queryClient.invalidateQueries({ queryKey: ['profiles'] });
  queryClient.invalidateQueries({ queryKey: ['user-system'] });
}

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
      invalidateExecutorCaches(queryClient);
    },
  });

  const syncMutation = useMutation({
    mutationFn: (data?: SyncToCliRequest) => cliConfigApi.syncToCli(data),
    onSuccess: () => {
      invalidateExecutorCaches(queryClient);
    },
  });

  const restartMutation = useMutation({
    mutationFn: () => cliConfigApi.restartCliService(),
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
    restartCliService: restartMutation.mutateAsync,
    isRestarting: restartMutation.isPending,
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

export function useCustomProviders() {
  return useQuery({
    queryKey: cliConfigKeys.customProviders(),
    queryFn: () => cliConfigApi.listCustomProviders(),
    staleTime: 1000 * 60,
  });
}

function invalidateCliConfigQueries(
  queryClient: ReturnType<typeof useQueryClient>
) {
  queryClient.invalidateQueries({ queryKey: cliConfigKeys.config() });
  queryClient.invalidateQueries({ queryKey: cliConfigKeys.customProviders() });
  invalidateExecutorCaches(queryClient);
}

export function useCreateCustomProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider: CustomProviderEntry) =>
      cliConfigApi.createCustomProvider(provider),
    onSuccess: () => {
      invalidateCliConfigQueries(queryClient);
    },
  });
}

export function useUpdateCustomProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      provider,
    }: {
      id: string;
      provider: CustomProviderEntry;
    }) => cliConfigApi.updateCustomProvider(id, provider),
    onSuccess: () => {
      invalidateCliConfigQueries(queryClient);
    },
  });
}

export function useDeleteCustomProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => cliConfigApi.deleteCustomProvider(id),
    onSuccess: () => {
      invalidateCliConfigQueries(queryClient);
    },
  });
}
