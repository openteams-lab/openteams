// CLI Provider / Model / Key configuration adapter.
// Split out from `./api` to keep individual files under 800 lines per AGENTS.md.

import type {
  CliConfig,
  CustomProviderEntry,
  CustomProviderProbeRequest,
  CustomProviderProbeResponse,
  ModelInfo,
  ProviderInfo,
  RestartCliResponse,
  SyncToCliRequest,
  SyncToCliResponse,
  ValidateProviderRequest,
  ValidateProviderResponse,
} from './cliConfigTypes';
import { handleApiResponse, makeRequest } from './apiCore';

export const cliConfigApi = {
  getConfig: async (): Promise<CliConfig> => {
    const r = await makeRequest('/api/config/cli');
    return handleApiResponse<CliConfig>(r);
  },
  updateConfig: async (data: CliConfig): Promise<CliConfig> => {
    const r = await makeRequest('/api/config/cli', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleApiResponse<CliConfig>(r);
  },
  syncToCli: async (data?: SyncToCliRequest): Promise<SyncToCliResponse> => {
    const r = await makeRequest('/api/config/cli/sync-to-cli', {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    });
    return handleApiResponse<SyncToCliResponse>(r);
  },
  restartService: async (): Promise<RestartCliResponse> => {
    const r = await makeRequest('/api/config/cli/restart-service', {
      method: 'POST',
    });
    return handleApiResponse<RestartCliResponse>(r);
  },
  listProviders: async (): Promise<ProviderInfo[]> => {
    const r = await makeRequest('/api/config/cli/providers');
    return handleApiResponse<ProviderInfo[]>(r);
  },
  listProviderModels: async (provider: string): Promise<ModelInfo[]> => {
    const r = await makeRequest(
      `/api/config/cli/providers/${encodeURIComponent(provider)}/models`,
    );
    return handleApiResponse<ModelInfo[]>(r);
  },
  validateProvider: async (
    provider: string,
    data: ValidateProviderRequest,
  ): Promise<ValidateProviderResponse> => {
    const r = await makeRequest(
      `/api/config/cli/providers/${encodeURIComponent(provider)}/validate`,
      { method: 'POST', body: JSON.stringify(data) },
    );
    return handleApiResponse<ValidateProviderResponse>(r);
  },
  listCustomProviders: async (): Promise<CustomProviderEntry[]> => {
    const r = await makeRequest('/api/config/cli/custom-providers');
    return handleApiResponse<CustomProviderEntry[]>(r);
  },
  createCustomProvider: async (
    entry: CustomProviderEntry,
  ): Promise<CustomProviderEntry> => {
    const r = await makeRequest('/api/config/cli/custom-providers', {
      method: 'POST',
      body: JSON.stringify(entry),
    });
    return handleApiResponse<CustomProviderEntry>(r);
  },
  updateCustomProvider: async (
    id: string,
    entry: CustomProviderEntry,
  ): Promise<CustomProviderEntry> => {
    const r = await makeRequest(
      `/api/config/cli/custom-providers/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(entry) },
    );
    return handleApiResponse<CustomProviderEntry>(r);
  },
  deleteCustomProvider: async (id: string): Promise<void> => {
    const r = await makeRequest(
      `/api/config/cli/custom-providers/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    await handleApiResponse<void>(r);
  },
  probeCustomProviderModels: async (
    data: CustomProviderProbeRequest,
  ): Promise<CustomProviderProbeResponse> => {
    const r = await makeRequest('/api/config/cli/custom-providers/models', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<CustomProviderProbeResponse>(r);
  },
  validateCustomProvider: async (
    data: CustomProviderProbeRequest,
  ): Promise<CustomProviderProbeResponse> => {
    const r = await makeRequest('/api/config/cli/custom-providers/validate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<CustomProviderProbeResponse>(r);
  },
};
