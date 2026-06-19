export type CliProviderId = string;

export const DEFAULT_CUSTOM_PROVIDER_NPM = '@ai-sdk/openai-compatible';

export const BUILT_IN_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'minimax',
  'ollama',
] as const;

export type BuiltInProviderId = (typeof BUILT_IN_PROVIDER_IDS)[number];

export interface ProviderCredentials {
  api_key: string | null;
  endpoint: string | null;
}

export interface OllamaConfig {
  endpoint: string | null;
}

export interface CustomProviderConfig {
  name: string | null;
  endpoint: string | null;
  api_key: string | null;
}

export interface CustomProviderOptions {
  baseURL: string | null;
  api_key: string | null;
  timeout: number | null;
}

export interface ModelModalities {
  input: string[] | null;
  output: string[] | null;
}

export interface ModelLimits {
  context: number | null;
  output: number | null;
}

export interface CustomModelConfig {
  name: string | null;
  modalities: ModelModalities | null;
  options: Record<string, unknown> | null;
  limit: ModelLimits | null;
}

export interface CustomProviderEntry {
  id: string;
  name: string | null;
  npm: string | null;
  options: CustomProviderOptions;
  models: Record<string, CustomModelConfig> | null;
}

export interface ProviderConfig {
  default: string;
  anthropic: ProviderCredentials | null;
  openai: ProviderCredentials | null;
  google: ProviderCredentials | null;
  openrouter: ProviderCredentials | null;
  minimax: ProviderCredentials | null;
  ollama: OllamaConfig | null;
  custom: CustomProviderConfig | null;
  custom_providers?: Record<string, CustomProviderEntry> | null;
}

export interface ProviderModelConfig {
  default: string | null;
}

export interface ModelConfig {
  default: string;
  anthropic: ProviderModelConfig | null;
  openai: ProviderModelConfig | null;
  google: ProviderModelConfig | null;
}

export interface BehaviorConfig {
  auto_approve: boolean;
  auto_compact: boolean;
}

export interface CliConfig {
  provider: ProviderConfig;
  model: ModelConfig;
  behavior: BehaviorConfig;
}

export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface ValidateProviderRequest {
  api_key: string | null;
  endpoint: string | null;
}

export interface ValidateProviderResponse {
  valid: boolean;
  message: string;
}

export type CustomProviderProbeStatus = 'success' | 'failed' | 'unsupported';

export interface CustomProviderProbeRequest {
  id: string;
  npm: string | null;
  options: CustomProviderOptions;
  model_id?: string | null;
}

export interface CustomProviderProbeResponse {
  status: CustomProviderProbeStatus;
  valid: boolean;
  message: string;
  models: ModelInfo[];
}

export interface SyncToCliRequest {
  custom_provider_id: string | null;
}

export interface SyncToCliResponse {
  synced: boolean;
  message: string;
  config_path: string | null;
}

export interface RestartCliResponse {
  restarted: boolean;
  message: string;
  base_url: string | null;
  port: number | null;
}

export function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function createEmptyProviderCredentials(): ProviderCredentials {
  return { api_key: null, endpoint: null };
}

export function createEmptyOllamaConfig(): OllamaConfig {
  return { endpoint: null };
}

export function createEmptyCustomProviderEntry(): CustomProviderEntry {
  return {
    id: '',
    name: null,
    npm: DEFAULT_CUSTOM_PROVIDER_NPM,
    options: {
      baseURL: null,
      api_key: null,
      timeout: null,
    },
    models: {},
  };
}

export function isBuiltInProvider(id: string): id is BuiltInProviderId {
  return BUILT_IN_PROVIDER_IDS.includes(id as BuiltInProviderId);
}

export function isMaskedSecret(value: string): boolean {
  return value.includes('***');
}

function normalizeNumber(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return value;
}

function normalizeList(values: string[] | null | undefined): string[] | null {
  const cleaned = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : null;
}

function normalizeModel(model: CustomModelConfig): CustomModelConfig {
  const modalities = model.modalities
    ? {
        input: normalizeList(model.modalities.input),
        output: normalizeList(model.modalities.output),
      }
    : null;
  const limit = model.limit
    ? {
        context: normalizeNumber(model.limit.context),
        output: normalizeNumber(model.limit.output),
      }
    : null;

  return {
    name: trimToNull(model.name),
    modalities:
      modalities && (modalities.input || modalities.output)
        ? modalities
        : null,
    options: model.options ?? null,
    limit: limit && (limit.context != null || limit.output != null)
      ? limit
      : null,
  };
}

export function normalizeCustomProviderEntry(
  entry: CustomProviderEntry,
): CustomProviderEntry {
  const models = Object.entries(entry.models ?? {}).reduce<
    Record<string, CustomModelConfig>
  >((acc, [rawId, model]) => {
    const id = rawId.trim();
    if (id) acc[id] = normalizeModel(model);
    return acc;
  }, {});

  return {
    id: entry.id.trim(),
    name: trimToNull(entry.name),
    npm: trimToNull(entry.npm) ?? DEFAULT_CUSTOM_PROVIDER_NPM,
    options: {
      baseURL: trimToNull(entry.options.baseURL),
      api_key: trimToNull(entry.options.api_key),
      timeout: normalizeNumber(entry.options.timeout),
    },
    models: Object.keys(models).length > 0 ? models : null,
  };
}

export function customProvidersRecordToList(
  record: Record<string, CustomProviderEntry> | null | undefined,
): CustomProviderEntry[] {
  return Object.values(record ?? {}).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

export function customProvidersListToRecord(
  providers: CustomProviderEntry[] | null | undefined,
): Record<string, CustomProviderEntry> | null {
  if (!providers?.length) return null;
  return providers.reduce<Record<string, CustomProviderEntry>>(
    (acc, provider) => {
      const normalized = normalizeCustomProviderEntry(provider);
      if (normalized.id) acc[normalized.id] = normalized;
      return acc;
    },
    {},
  );
}
