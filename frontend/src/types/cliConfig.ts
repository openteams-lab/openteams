import type {
  CliConfig as SharedCliConfig,
  CustomProviderConfig,
  OllamaConfig,
  ProviderCredentials,
  ProviderModelConfig,
  ModelInfo,
  ValidateProviderRequest,
  ValidateProviderResponse,
} from 'shared/types';

export type {
  CustomProviderConfig,
  OllamaConfig,
  ProviderCredentials,
  ProviderModelConfig,
  ModelInfo,
  ValidateProviderRequest,
  ValidateProviderResponse,
}

export const CLI_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ollama',
  'custom',
] as const;

export type BuiltInCliProviderId = (typeof CLI_PROVIDER_IDS)[number];

export type CliProviderId = BuiltInCliProviderId | string;

export type CliConfig = SharedCliConfig;

export type CliProviderInfo = {
  id: CliProviderId | string;
  name: string;
  configured: boolean;
};

export type CliModelInfo = ModelInfo;

export type ValidateCliProviderRequest = ValidateProviderRequest;
export type ValidateCliProviderResponse = ValidateProviderResponse;

export interface CustomProviderEntry {
  id: string;
  name?: string | null;
  npm?: string | null;
  endpoint?: string | null;
  apiKey?: string | null;
  models?: Record<string, CustomModelEntry>;
}

export interface CustomModelEntry {
  name?: string;
  modalities?: { input?: string[]; output?: string[] };
  options?: Record<string, unknown>;
  limit?: { context?: number; output?: number };
}

export interface SyncToCliRequest {
  customProviderId?: string | null;
}

export interface SyncToCliResponse {
  synced: boolean;
  message: string;
  configPath?: string | null;
}

export function customProviderEntryToConfig(
  entry: CustomProviderEntry | null | undefined
): CustomProviderConfig | null {
  if (!entry) return null;
  return {
    name: entry.name ?? null,
    endpoint: entry.endpoint ?? null,
    api_key: entry.apiKey ?? null,
  };
}

export function customProviderConfigToEntry(
  config: CustomProviderConfig | null | undefined,
  id: string = 'custom'
): CustomProviderEntry | null {
  if (!config) return null;
  return {
    id,
    name: config.name,
    endpoint: config.endpoint,
    apiKey: config.api_key,
  };
}