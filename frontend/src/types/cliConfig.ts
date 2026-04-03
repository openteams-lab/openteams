import type {
  CliConfig as SharedCliConfig,
  CustomProviderConfig,
  CustomProviderEntry as SharedCustomProviderEntry,
  CustomProviderOptions as SharedCustomProviderOptions,
  CustomModelConfig as SharedCustomModelConfig,
  OpenTeamsCliConfig as SharedOpenTeamsCliConfig,
  OpenTeamsCliProviderConfig as SharedOpenTeamsCliProviderConfig,
  OpenTeamsCliProviderOptions as SharedOpenTeamsCliProviderOptions,
  OpenTeamsCliModelConfig as SharedOpenTeamsCliModelConfig,
  OllamaConfig,
  ProviderCredentials,
  ProviderModelConfig,
  ModelInfo,
  ModelLimits as SharedModelLimits,
  ModelModalities as SharedModelModalities,
  ModelVariantConfig as SharedModelVariantConfig,
  RestartCliResponse as SharedRestartCliResponse,
  SyncToCliRequest as SharedSyncToCliRequest,
  SyncToCliResponse as SharedSyncToCliResponse,
  ValidateProviderRequest,
  ValidateProviderResponse,
} from 'shared/types';

export type {
  CustomProviderConfig,
  OllamaConfig,
  ProviderCredentials,
  ProviderModelConfig,
  ModelInfo,
  SharedCustomProviderEntry,
  SharedCustomProviderOptions,
  SharedCustomModelConfig,
  SharedOpenTeamsCliConfig,
  SharedOpenTeamsCliProviderConfig,
  SharedOpenTeamsCliProviderOptions,
  SharedOpenTeamsCliModelConfig,
  SharedModelLimits,
  SharedModelModalities,
  SharedModelVariantConfig,
  SharedRestartCliResponse,
  ValidateProviderRequest,
  ValidateProviderResponse,
};

export const DEFAULT_CUSTOM_PROVIDER_NPM = '@ai-sdk/openai-compatible';

export const CLI_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'minimax',
  'ollama',
  'custom',
] as const;

export type BuiltInCliProviderId = (typeof CLI_PROVIDER_IDS)[number];

export type CliProviderId = BuiltInCliProviderId | string;

export type ModelModalities = {
  input?: string[] | null;
  output?: string[] | null;
};

export type ModelLimits = {
  context?: number | null;
  output?: number | null;
};

export type CustomModelConfig = Omit<
  SharedCustomModelConfig,
  'modalities' | 'limit'
> & {
  modalities?: ModelModalities | null;
  limit?: ModelLimits | null;
};

export type CustomProviderOptions = Omit<
  SharedCustomProviderOptions,
  'timeout'
> & {
  timeout?: number | null;
};

export type CustomProviderEntry = Omit<
  SharedCustomProviderEntry,
  'options' | 'models'
> & {
  options: CustomProviderOptions;
  models?: Record<string, CustomModelConfig> | null;
};

export type OpenTeamsCliProviderOptions = Omit<
  SharedOpenTeamsCliProviderOptions,
  'timeout' | 'chunk_timeout'
> & {
  timeout?: number | null;
  chunk_timeout?: number | null;
};

export type ModelVariantConfig = SharedModelVariantConfig;

export type OpenTeamsCliModelConfig = Omit<
  SharedOpenTeamsCliModelConfig,
  'modalities' | 'limit' | 'variants'
> & {
  modalities?: ModelModalities | null;
  limit?: ModelLimits | null;
  variants?: Record<string, ModelVariantConfig> | null;
};

export type OpenTeamsCliProviderConfig = Omit<
  SharedOpenTeamsCliProviderConfig,
  'options' | 'models'
> & {
  options?: OpenTeamsCliProviderOptions | null;
  models?: Record<string, OpenTeamsCliModelConfig> | null;
};

export type OpenTeamsCliConfig = Omit<SharedOpenTeamsCliConfig, 'provider'> & {
  provider: Record<string, OpenTeamsCliProviderConfig> | null;
};

export type CliConfig = Omit<SharedCliConfig, 'provider'> & {
  provider: Omit<SharedCliConfig['provider'], 'custom_providers'> & {
    custom_providers?: Record<string, CustomProviderEntry> | null;
  };
};

export type CliProviderInfo = {
  id: CliProviderId | string;
  name: string;
  configured: boolean;
};

export type CliModelInfo = ModelInfo;

export type ValidateCliProviderRequest = ValidateProviderRequest;
export type ValidateCliProviderResponse = ValidateProviderResponse;

export type RestartCliResponse = SharedRestartCliResponse;
export type SyncToCliRequest = SharedSyncToCliRequest;
export type SyncToCliResponse = SharedSyncToCliResponse;

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeNumber(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) {
    return null;
  }

  return value;
}

function normalizeStringList(
  values: string[] | null | undefined
): string[] | null {
  const normalized = (values ?? [])
    .map((value) => value.trim())
    .filter(Boolean);

  return normalized.length > 0 ? Array.from(new Set(normalized)) : null;
}

function normalizeModelLimits(
  limit: ModelLimits | null | undefined
): ModelLimits | null {
  if (!limit) {
    return null;
  }

  const normalized = {
    context: normalizeNumber(limit.context),
    output: normalizeNumber(limit.output),
  };

  return normalized.context != null || normalized.output != null
    ? normalized
    : null;
}

function normalizeModelModalities(
  modalities: ModelModalities | null | undefined
): ModelModalities | null {
  if (!modalities) {
    return null;
  }

  const normalized = {
    input: normalizeStringList(modalities.input),
    output: normalizeStringList(modalities.output),
  };

  return normalized.input || normalized.output ? normalized : null;
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

export function normalizeCustomProviderEntry(
  entry: CustomProviderEntry
): CustomProviderEntry {
  const normalizedModels = Object.entries(entry.models ?? {}).reduce<
    Record<string, CustomModelConfig>
  >((acc, [rawId, model]) => {
    const id = rawId.trim();
    if (!id) {
      return acc;
    }

    const normalizedModel: CustomModelConfig = {
      ...model,
      name: trimToNull(model.name),
      modalities: normalizeModelModalities(model.modalities),
      limit: normalizeModelLimits(model.limit),
      options: model.options ?? null,
    };

    acc[id] = normalizedModel;
    return acc;
  }, {});

  return {
    ...entry,
    id: entry.id.trim(),
    name: trimToNull(entry.name),
    npm: trimToNull(entry.npm) ?? DEFAULT_CUSTOM_PROVIDER_NPM,
    options: {
      baseURL: trimToNull(entry.options.baseURL),
      api_key: trimToNull(entry.options.api_key),
      timeout: normalizeNumber(entry.options.timeout),
    },
    models: Object.keys(normalizedModels).length > 0 ? normalizedModels : null,
  };
}

export function customProvidersRecordToList(
  record: Record<string, CustomProviderEntry> | null | undefined
): CustomProviderEntry[] {
  return Object.values(record ?? {}).sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}

export function customProvidersListToRecord(
  providers: CustomProviderEntry[] | null | undefined
): Record<string, CustomProviderEntry> | null {
  if (!providers || providers.length === 0) {
    return null;
  }

  return providers.reduce<Record<string, CustomProviderEntry>>(
    (acc, provider) => {
      const normalized = normalizeCustomProviderEntry(provider);
      if (normalized.id) {
        acc[normalized.id] = normalized;
      }
      return acc;
    },
    {}
  );
}

export function customProviderEntryToConfig(
  entry: CustomProviderEntry | null | undefined
): CustomProviderConfig | null {
  if (!entry) return null;
  return {
    name: entry.name ?? null,
    endpoint: entry.options.baseURL ?? null,
    api_key: entry.options.api_key ?? null,
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
    npm: DEFAULT_CUSTOM_PROVIDER_NPM,
    options: {
      baseURL: config.endpoint,
      api_key: config.api_key,
      timeout: null,
    },
    models: null,
  };
}
