import { useEffect, useMemo, useState } from 'react';
import { cloneDeep, isEqual } from 'lodash';
import { useTranslation } from 'react-i18next';
import { Loader2, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/dialogs/shared/ConfirmDialog';
import { cn } from '@/lib/utils';
import {
  useCliConfig,
  useCreateCustomProvider,
  useCustomProviders,
  useDeleteCustomProvider,
  useCliProviderModels,
  useCliProviders,
  useUpdateCustomProvider,
  useValidateCliProvider,
} from '@/hooks/useCliConfig';
import {
  customProvidersListToRecord,
  customProvidersRecordToList,
} from '@/types/cliConfig';
import type {
  CliConfig,
  CliProviderId,
  CliProviderInfo,
  CustomProviderEntry,
  CustomProviderConfig,
  OllamaConfig,
  ProviderCredentials,
  ProviderModelConfig,
} from '@/types/cliConfig';
import { CustomProviderForm } from './components/CustomProviderForm';
import {
  SettingsCard,
  SettingsCheckbox,
  SettingsField,
  SettingsInput,
  SettingsSaveBar,
  SettingsSelect,
  settingsFieldClassName,
  settingsIconButtonClassName,
  settingsMutedPanelClassName,
  settingsSecondaryButtonClassName,
} from '@/components/ui-new/dialogs/settings/SettingsComponents';
import { useOptionalSettingsDirty } from '@/components/ui-new/dialogs/settings/SettingsDirtyContext';

const DEFAULT_PROVIDER_OPTIONS: CliProviderInfo[] = [
  { id: 'anthropic', name: 'Anthropic', configured: false },
  { id: 'openai', name: 'OpenAI', configured: false },
  { id: 'google', name: 'Google', configured: false },
  { id: 'openrouter', name: 'OpenRouter', configured: false },
  { id: 'ollama', name: 'Ollama', configured: false },
  { id: 'custom', name: 'Custom Provider', configured: false },
];

const VALIDATABLE_PROVIDERS = new Set<CliProviderId>([
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ollama',
  'custom',
]);

const API_KEY_VALIDATION_REQUIRED_PROVIDERS = new Set<CliProviderId>([
  'anthropic',
  'openai',
  'google',
  'openrouter',
]);

const SETTINGS_INLINE_PANEL_CLASS = cn(settingsMutedPanelClassName, 'p-4');
const SETTINGS_STATUS_ROW_CLASS = cn(
  settingsMutedPanelClassName,
  'flex items-center justify-between gap-4 px-4 py-3 text-[12px] text-[#8C8C8C]'
);

function renderSettingsStatusMessage(
  message: string,
  tone: 'error' | 'success' = 'error',
  title?: string
) {
  const toneClassName =
    tone === 'success'
      ? 'border-[#d8ead8] bg-[#f7fcf7] text-[#2f7d32]'
      : 'border-[#f3d7d7] bg-[#fff7f7] text-[#d14343]';

  return (
    <div
      className={cn(
        'mb-5 rounded-[10px] border p-4 text-[13px]',
        toneClassName
      )}
    >
      {title ? <p className="mb-1 font-medium">{title}</p> : null}
      <p>{message}</p>
    </div>
  );
}

const REMOTE_MODEL_PROVIDERS = new Set<CliProviderId>([
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ollama',
]);

type ProviderValidationState = {
  provider: CliProviderId;
  valid: boolean;
  message: string;
};

function emptyProviderCredentials(): ProviderCredentials {
  return {
    api_key: null,
    endpoint: null,
  };
}

function emptyOllamaConfig(): OllamaConfig {
  return {
    endpoint: null,
  };
}

function emptyCustomProviderConfig(): CustomProviderConfig {
  return {
    name: null,
    endpoint: null,
    api_key: null,
  };
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isRemoteModelProvider(provider: CliProviderId): boolean {
  return REMOTE_MODEL_PROVIDERS.has(provider);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function getProviderApiKey(config: CliConfig, provider: CliProviderId): string {
  switch (provider) {
    case 'anthropic':
      return config.provider.anthropic?.api_key ?? '';
    case 'openai':
      return config.provider.openai?.api_key ?? '';
    case 'google':
      return config.provider.google?.api_key ?? '';
    case 'openrouter':
      return config.provider.openrouter?.api_key ?? '';
    case 'custom':
      return config.provider.custom?.api_key ?? '';
    case 'ollama':
      return '';
    default:
      return '';
  }
}

function getProviderEndpoint(
  config: CliConfig,
  provider: CliProviderId
): string {
  switch (provider) {
    case 'anthropic':
      return config.provider.anthropic?.endpoint ?? '';
    case 'openai':
      return config.provider.openai?.endpoint ?? '';
    case 'google':
      return config.provider.google?.endpoint ?? '';
    case 'openrouter':
      return config.provider.openrouter?.endpoint ?? '';
    case 'ollama':
      return config.provider.ollama?.endpoint ?? '';
    case 'custom':
      return config.provider.custom?.endpoint ?? '';
    default:
      return '';
  }
}

function getCustomProviderName(config: CliConfig): string {
  return config.provider.custom?.name ?? '';
}

function getScopedModelDefault(
  config: CliConfig,
  provider: CliProviderId
): string | null {
  switch (provider) {
    case 'anthropic':
      return config.model.anthropic?.default ?? null;
    case 'openai':
      return config.model.openai?.default ?? null;
    case 'google':
      return config.model.google?.default ?? null;
    case 'openrouter':
    case 'ollama':
    case 'custom':
      return null;
    default:
      return null;
  }
}

function ensureProviderConfig(config: CliConfig, provider: CliProviderId) {
  switch (provider) {
    case 'anthropic':
      config.provider.anthropic ??= emptyProviderCredentials();
      break;
    case 'openai':
      config.provider.openai ??= emptyProviderCredentials();
      break;
    case 'google':
      config.provider.google ??= emptyProviderCredentials();
      break;
    case 'openrouter':
      config.provider.openrouter ??= emptyProviderCredentials();
      break;
    case 'ollama':
      config.provider.ollama ??= emptyOllamaConfig();
      break;
    case 'custom':
      config.provider.custom ??= emptyCustomProviderConfig();
      break;
    default:
      break;
  }
}

function setProviderApiKey(
  config: CliConfig,
  provider: CliProviderId,
  value: string
) {
  const normalized = value === '' ? null : value;
  switch (provider) {
    case 'anthropic':
      config.provider.anthropic = {
        ...(config.provider.anthropic ?? emptyProviderCredentials()),
        api_key: normalized,
      };
      break;
    case 'openai':
      config.provider.openai = {
        ...(config.provider.openai ?? emptyProviderCredentials()),
        api_key: normalized,
      };
      break;
    case 'google':
      config.provider.google = {
        ...(config.provider.google ?? emptyProviderCredentials()),
        api_key: normalized,
      };
      break;
    case 'openrouter':
      config.provider.openrouter = {
        ...(config.provider.openrouter ?? emptyProviderCredentials()),
        api_key: normalized,
      };
      break;
    case 'custom':
      config.provider.custom = {
        ...(config.provider.custom ?? emptyCustomProviderConfig()),
        api_key: normalized,
      };
      break;
    case 'ollama':
    default:
      break;
  }
}

function setProviderEndpoint(
  config: CliConfig,
  provider: CliProviderId,
  value: string
) {
  const normalized = value === '' ? null : value;
  switch (provider) {
    case 'anthropic':
      config.provider.anthropic = {
        ...(config.provider.anthropic ?? emptyProviderCredentials()),
        endpoint: normalized,
      };
      break;
    case 'openai':
      config.provider.openai = {
        ...(config.provider.openai ?? emptyProviderCredentials()),
        endpoint: normalized,
      };
      break;
    case 'google':
      config.provider.google = {
        ...(config.provider.google ?? emptyProviderCredentials()),
        endpoint: normalized,
      };
      break;
    case 'openrouter':
      config.provider.openrouter = {
        ...(config.provider.openrouter ?? emptyProviderCredentials()),
        endpoint: normalized,
      };
      break;
    case 'ollama':
      config.provider.ollama = {
        ...(config.provider.ollama ?? emptyOllamaConfig()),
        endpoint: normalized,
      };
      break;
    case 'custom':
      config.provider.custom = {
        ...(config.provider.custom ?? emptyCustomProviderConfig()),
        endpoint: normalized,
      };
      break;
    default:
      break;
  }
}

function setCustomProviderName(config: CliConfig, value: string) {
  config.provider.custom = {
    ...(config.provider.custom ?? emptyCustomProviderConfig()),
    name: value === '' ? null : value,
  };
}

function setModelValue(
  config: CliConfig,
  provider: CliProviderId,
  value: string
) {
  config.model.default = value;

  const scopedValue: ProviderModelConfig | null =
    value.trim() === ''
      ? null
      : {
          default: value,
        };

  if (provider === 'anthropic') {
    config.model.anthropic = scopedValue;
  }
  if (provider === 'openai') {
    config.model.openai = scopedValue;
  }
  if (provider === 'google') {
    config.model.google = scopedValue;
  }
}

function sanitizeProviderCredentials(
  value: ProviderCredentials | null
): ProviderCredentials | null {
  if (!value) {
    return null;
  }

  const next = {
    api_key: trimToNull(value.api_key),
    endpoint: trimToNull(value.endpoint),
  };

  return next.api_key || next.endpoint ? next : null;
}

function sanitizeOllamaConfig(value: OllamaConfig | null): OllamaConfig | null {
  if (!value) {
    return null;
  }

  const next = {
    endpoint: trimToNull(value.endpoint),
  };

  return next.endpoint ? next : null;
}

function sanitizeCustomProviderConfig(
  value: CustomProviderConfig | null
): CustomProviderConfig | null {
  if (!value) {
    return null;
  }

  const next = {
    name: trimToNull(value.name),
    endpoint: trimToNull(value.endpoint),
    api_key: trimToNull(value.api_key),
  };

  return next.name || next.endpoint || next.api_key ? next : null;
}

function sanitizeProviderModelConfig(
  value: ProviderModelConfig | null
): ProviderModelConfig | null {
  if (!value) {
    return null;
  }

  const next = {
    default: trimToNull(value.default),
  };

  return next.default ? next : null;
}

function sanitizeCliConfig(config: CliConfig): CliConfig {
  const next = cloneDeep(config);

  next.model.default = next.model.default.trim();
  next.provider.anthropic = sanitizeProviderCredentials(
    next.provider.anthropic
  );
  next.provider.openai = sanitizeProviderCredentials(next.provider.openai);
  next.provider.google = sanitizeProviderCredentials(next.provider.google);
  next.provider.openrouter = sanitizeProviderCredentials(
    next.provider.openrouter
  );
  next.provider.ollama = sanitizeOllamaConfig(next.provider.ollama);
  next.provider.custom = sanitizeCustomProviderConfig(next.provider.custom);
  next.model.anthropic = sanitizeProviderModelConfig(next.model.anthropic);
  next.model.openai = sanitizeProviderModelConfig(next.model.openai);
  next.model.google = sanitizeProviderModelConfig(next.model.google);

  return next;
}

function withCustomProviders(
  config: CliConfig | null | undefined,
  customProviders: Record<string, CustomProviderEntry> | null | undefined
): CliConfig | null {
  if (!config) {
    return null;
  }

  const next = cloneDeep(config);
  next.provider.custom_providers = customProviders ?? null;
  return next;
}

export function CliSettings() {
  const { t } = useTranslation(['settings', 'common']);
  const optionalDirtyContext = useOptionalSettingsDirty();
  const {
    data: savedConfig,
    isLoading,
    isError,
    error,
    refetch,
    save,
    isSaving,
    syncToCli,
    isSyncing,
    restartCliService,
    isRestarting,
  } = useCliConfig();
  const {
    data: providersData,
    error: providersError,
    isLoading: isProvidersLoading,
  } = useCliProviders();
  const { data: customProvidersData, error: customProvidersError } =
    useCustomProviders();
  const createCustomProvider = useCreateCustomProvider();
  const updateCustomProvider = useUpdateCustomProvider();
  const deleteCustomProvider = useDeleteCustomProvider();
  const validateProvider = useValidateCliProvider();

  const [draft, setDraft] = useState<CliConfig | null>(null);
  const [customProviderMessage, setCustomProviderMessage] = useState<
    string | null
  >(null);
  const [customProviderStatusError, setCustomProviderStatusError] = useState<
    string | null
  >(null);
  const [editingCustomProvider, setEditingCustomProvider] =
    useState<CustomProviderEntry | null>(null);
  const [isCustomProviderDialogOpen, setIsCustomProviderDialogOpen] =
    useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(
    null
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationResult, setValidationResult] =
    useState<ProviderValidationState | null>(null);

  const customProviders = useMemo(
    () =>
      customProvidersData ??
      customProvidersRecordToList(savedConfig?.provider.custom_providers),
    [customProvidersData, savedConfig?.provider.custom_providers]
  );
  const customProvidersRecord = useMemo(
    () =>
      customProvidersData
        ? customProvidersListToRecord(customProvidersData)
        : (savedConfig?.provider.custom_providers ?? null),
    [customProvidersData, savedConfig?.provider.custom_providers]
  );
  const comparableDraft = useMemo(
    () => withCustomProviders(draft, customProvidersRecord),
    [customProvidersRecord, draft]
  );
  const comparableSavedConfig = useMemo(
    () => withCustomProviders(savedConfig, customProvidersRecord),
    [customProvidersRecord, savedConfig]
  );
  const customProviderOptions = useMemo<CliProviderInfo[]>(
    () =>
      customProviders.map((provider) => ({
        id: provider.id,
        name: trimToNull(provider.name) ?? provider.id,
        configured:
          trimToNull(provider.options.baseURL) != null ||
          trimToNull(provider.options.api_key) != null ||
          Object.keys(provider.models ?? {}).length > 0,
      })),
    [customProviders]
  );
  const providerOptions = useMemo(() => {
    const baseProviders =
      providersData && providersData.length > 0
        ? providersData
        : DEFAULT_PROVIDER_OPTIONS;
    const seen = new Set(baseProviders.map((provider) => provider.id));
    return [
      ...baseProviders,
      ...customProviderOptions.filter((provider) => !seen.has(provider.id)),
    ];
  }, [customProviderOptions, providersData]);
  const selectedProvider = draft?.provider.default ?? 'anthropic';
  const selectedManagedCustomProvider =
    selectedProvider === 'custom'
      ? null
      : (customProvidersRecord?.[selectedProvider] ?? null);
  const selectedManagedCustomProviderModels = useMemo(
    () =>
      selectedManagedCustomProvider
        ? Object.entries(selectedManagedCustomProvider.models ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([id, model]) => ({
              id,
              name:
                trimToNull(model.name) ??
                t('settings.cli.customProviders.form.newModel'),
            }))
        : [],
    [selectedManagedCustomProvider, t]
  );

  const hasUnsavedChanges = useMemo(() => {
    if (!comparableDraft || !comparableSavedConfig) {
      return false;
    }

    return !isEqual(comparableDraft, comparableSavedConfig);
  }, [comparableDraft, comparableSavedConfig]);

  useEffect(() => {
    optionalDirtyContext?.setDirty('cli', hasUnsavedChanges);
    return () => optionalDirtyContext?.setDirty('cli', false);
  }, [hasUnsavedChanges, optionalDirtyContext]);

  useEffect(() => {
    if (!savedConfig) {
      return;
    }

    const nextSavedConfig = withCustomProviders(
      savedConfig,
      customProvidersRecord
    );
    if (!nextSavedConfig) {
      return;
    }

    if (!draft) {
      setDraft(cloneDeep(nextSavedConfig));
      return;
    }

    if (
      !hasUnsavedChanges &&
      !isEqual(comparableDraft, comparableSavedConfig)
    ) {
      setDraft(cloneDeep(nextSavedConfig));
    }
  }, [
    comparableDraft,
    comparableSavedConfig,
    customProvidersRecord,
    draft,
    hasUnsavedChanges,
    savedConfig,
  ]);

  const selectedProviderInfo = providerOptions.find(
    (provider) => provider.id === selectedProvider
  );
  const shouldLoadRemoteModels =
    draft != null && isRemoteModelProvider(selectedProvider);

  const {
    data: remoteModelOptions = [],
    error: modelsError,
    isLoading: isModelsLoading,
  } = useCliProviderModels(shouldLoadRemoteModels ? selectedProvider : null);
  const availableModelOptions = selectedManagedCustomProvider
    ? selectedManagedCustomProviderModels
    : remoteModelOptions;

  const providerApiKey = draft
    ? getProviderApiKey(draft, selectedProvider)
    : '';
  const providerEndpoint = draft
    ? getProviderEndpoint(draft, selectedProvider)
    : '';
  const customProviderName = draft ? getCustomProviderName(draft) : '';
  const apiKeyMasked = providerApiKey.includes('***');
  const suggestedModelValue =
    draft &&
    availableModelOptions.some((model) => model.id === draft.model.default)
      ? draft.model.default
      : undefined;
  const isSaveBusy = isSaving || isSyncing || isRestarting;
  const deletingProviderId = deleteCustomProvider.isPending
    ? (deleteCustomProvider.variables ?? null)
    : null;

  const updateDraft = (updater: (config: CliConfig) => void) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const next = cloneDeep(current);
      next.provider.custom_providers = cloneDeep(customProvidersRecord);
      updater(next);
      return next;
    });
    setCustomProviderMessage(null);
    setCustomProviderStatusError(null);
    setSaveSuccessMessage(null);
    setSaveError(null);
    setValidationError(null);
    setValidationResult(null);
  };

  const handleProviderChange = (provider: CliProviderId) => {
    updateDraft((current) => {
      current.provider.default = provider;
      if (provider === 'custom' || isRemoteModelProvider(provider)) {
        ensureProviderConfig(current, provider);
      }

      const customProvider = customProvidersRecord?.[provider] ?? null;
      if (customProvider) {
        const nextModelIds = Object.keys(customProvider.models ?? {});
        if (nextModelIds.length === 0) {
          current.model.default = '';
        } else if (!nextModelIds.includes(current.model.default)) {
          current.model.default = nextModelIds[0];
        }
        return;
      }

      const scopedDefault = getScopedModelDefault(current, provider);
      if (scopedDefault) {
        current.model.default = scopedDefault;
      }
    });
    setShowApiKey(false);
  };

  const handleSave = async () => {
    if (!draft) {
      return;
    }

    const sanitizedDraft = sanitizeCliConfig(draft);
    sanitizedDraft.provider.custom_providers = cloneDeep(customProvidersRecord);
    if (!sanitizedDraft.model.default) {
      setSaveError(t('settings.cli.model.required'));
      return;
    }

    try {
      const saved = await save(sanitizedDraft);
      setDraft(cloneDeep(withCustomProviders(saved, customProvidersRecord)));
      setSaveSuccessMessage(t('settings.cli.save.success'));
      setTimeout(() => setSaveSuccessMessage(null), 3000);

      try {
        await syncToCli(
          selectedManagedCustomProvider
            ? { custom_provider_id: selectedManagedCustomProvider.id }
            : undefined
        );
        await restartCliService();
      } catch (syncOrRestartErr) {
        console.error(
          'Failed to sync or restart openteams-cli after saving CLI config:',
          syncOrRestartErr
        );
        setSaveError(
          getErrorMessage(syncOrRestartErr, t('settings.cli.save.error'))
        );
      }
    } catch (saveErr) {
      console.error('Failed to save CLI config:', saveErr);
      setSaveError(t('settings.cli.save.error'));
    }
  };

  const handleDiscard = () => {
    if (!comparableSavedConfig) {
      return;
    }

    setDraft(cloneDeep(comparableSavedConfig));
    setSaveError(null);
    setSaveSuccessMessage(null);
    setValidationError(null);
    setValidationResult(null);
  };

  const handleCreateCustomProvider = () => {
    setEditingCustomProvider(null);
    setCustomProviderMessage(null);
    setCustomProviderStatusError(null);
    setIsCustomProviderDialogOpen(true);
  };

  const handleEditCustomProvider = (provider: CustomProviderEntry) => {
    setEditingCustomProvider(provider);
    setCustomProviderMessage(null);
    setCustomProviderStatusError(null);
    setIsCustomProviderDialogOpen(true);
  };

  const handleSubmitCustomProvider = async (provider: CustomProviderEntry) => {
    setCustomProviderMessage(null);
    setCustomProviderStatusError(null);
    const successMessage = editingCustomProvider
      ? t('settings.cli.customProviders.feedback.updated')
      : t('settings.cli.customProviders.feedback.created');

    if (editingCustomProvider) {
      await updateCustomProvider.mutateAsync({
        id: editingCustomProvider.id,
        provider,
      });
    } else {
      await createCustomProvider.mutateAsync(provider);
    }

    setCustomProviderMessage(successMessage);
    try {
      await restartCliService();
    } catch (restartErr) {
      setCustomProviderStatusError(
        getErrorMessage(restartErr, t('settings.cli.save.error'))
      );
    }

    setEditingCustomProvider(null);
  };

  const handleDeleteCustomProvider = async (provider: CustomProviderEntry) => {
    const result = await ConfirmDialog.show({
      title: t('settings.cli.customProviders.deleteDialog.title'),
      message: t('settings.cli.customProviders.deleteDialog.description', {
        id: provider.id,
      }),
      confirmText: t('settings.cli.customProviders.deleteDialog.confirm'),
      cancelText: t('settings.cli.customProviders.deleteDialog.cancel'),
      variant: 'destructive',
    });

    if (result !== 'confirmed') {
      return;
    }

    try {
      setCustomProviderMessage(null);
      setCustomProviderStatusError(null);
      await deleteCustomProvider.mutateAsync(provider.id);
      const nextCustomProvidersRecord = customProvidersListToRecord(
        customProviders.filter((entry) => entry.id !== provider.id)
      );
      const refreshedConfig = (await refetch()).data;
      if (refreshedConfig) {
        setDraft(
          cloneDeep(
            withCustomProviders(refreshedConfig, nextCustomProvidersRecord)
          )
        );
      } else {
        setDraft((current) => {
          if (!current) {
            return current;
          }

          const next = cloneDeep(current);
          next.provider.custom_providers = nextCustomProvidersRecord;
          return next;
        });
      }
      setSaveError(null);
      setSaveSuccessMessage(null);
      setValidationError(null);
      setValidationResult(null);
      setCustomProviderMessage(
        t('settings.cli.customProviders.feedback.deleted')
      );
      try {
        await restartCliService();
      } catch (restartErr) {
        setCustomProviderStatusError(
          getErrorMessage(restartErr, t('settings.cli.save.error'))
        );
      }
    } catch (deleteErr) {
      setCustomProviderStatusError(
        getErrorMessage(
          deleteErr,
          t('settings.cli.customProviders.feedback.deleteFailed')
        )
      );
    }
  };

  const handleValidateConnection = async () => {
    if (!draft || !VALIDATABLE_PROVIDERS.has(selectedProvider)) {
      return;
    }

    const validationApiKey = apiKeyMasked ? null : trimToNull(providerApiKey);

    if (
      API_KEY_VALIDATION_REQUIRED_PROVIDERS.has(selectedProvider) &&
      !validationApiKey &&
      !apiKeyMasked
    ) {
      setValidationError(t('settings.cli.validation.missingApiKey'));
      return;
    }

    try {
      const response = await validateProvider.mutateAsync({
        provider: selectedProvider,
        data: {
          api_key: validationApiKey,
          endpoint: trimToNull(providerEndpoint),
        },
      });

      setValidationError(null);
      setValidationResult({
        provider: selectedProvider,
        valid: response.valid,
        message: response.message,
      });
    } catch (validateErr) {
      console.error('Failed to validate CLI provider:', validateErr);
      setValidationResult(null);
      setValidationError(
        getErrorMessage(validateErr, t('settings.cli.validation.error'))
      );
    }
  };

  if (isLoading || !draft) {
    return (
      <div className="flex items-center justify-center gap-2 py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="text-[14px] text-[#333333]">
          {t('settings.cli.loading')}
        </span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-8">
        {renderSettingsStatusMessage(
          getErrorMessage(error, t('settings.cli.loadError')),
          'error',
          t('settings.cli.loadError')
        )}
      </div>
    );
  }

  const providerSelectOptions = providerOptions.map((provider) => ({
    value: provider.id,
    label: provider.configured
      ? `${provider.name} (${t('settings.cli.provider.configured')})`
      : provider.name,
  }));
  const modelSelectOptions = availableModelOptions.map((model) => ({
    value: model.id,
    label: model.name,
  }));
  const saveBarLayout = optionalDirtyContext ? 'section' : 'floating-panel';

  return (
    <div className={cn(optionalDirtyContext ? '' : 'pb-8')}>
      {saveError && renderSettingsStatusMessage(saveError)}
      {saveSuccessMessage &&
        renderSettingsStatusMessage(saveSuccessMessage, 'success')}
      {customProviderMessage &&
        renderSettingsStatusMessage(customProviderMessage, 'success')}
      {customProviderStatusError &&
        renderSettingsStatusMessage(customProviderStatusError)}
      {validationError && renderSettingsStatusMessage(validationError)}
      {validationResult &&
        validationResult.provider === selectedProvider &&
        renderSettingsStatusMessage(
          validationResult.message,
          validationResult.valid ? 'success' : 'error',
          validationResult.valid
            ? t('settings.cli.validation.successTitle')
            : t('settings.cli.validation.failureTitle')
        )}
      {providersError &&
        renderSettingsStatusMessage(
          getErrorMessage(providersError, t('settings.cli.provider.loadError'))
        )}
      {customProvidersError &&
        renderSettingsStatusMessage(
          getErrorMessage(
            customProvidersError,
            t('settings.cli.customProviders.loadError')
          )
        )}
      {modelsError &&
        selectedManagedCustomProvider == null &&
        selectedProvider !== 'custom' &&
        renderSettingsStatusMessage(
          getErrorMessage(modelsError, t('settings.cli.model.loadError'))
        )}

      <SettingsCard
        title={t('settings.cli.provider.title')}
        description={t('settings.cli.provider.description')}
        headerAction={
          <button
            type="button"
            className={settingsSecondaryButtonClassName}
            onClick={handleCreateCustomProvider}
          >
            <Plus className="h-4 w-4" />
            {t('settings.cli.customProviders.actions.add')}
          </button>
        }
      >
        <SettingsField label={t('settings.cli.provider.label')}>
          <SettingsSelect
            value={selectedProvider}
            options={providerSelectOptions}
            onChange={(value) => handleProviderChange(value as CliProviderId)}
            placeholder={t('settings.cli.provider.placeholder')}
          />
          <div className={cn(SETTINGS_STATUS_ROW_CLASS, 'mt-3')}>
            <span>{t('settings.cli.provider.helper')}</span>
            <span className="shrink-0">
              {selectedProviderInfo?.configured
                ? t('settings.cli.provider.configured')
                : t('settings.cli.provider.notConfigured')}
            </span>
          </div>
        </SettingsField>

        {selectedManagedCustomProvider ? (
          <div className={SETTINGS_INLINE_PANEL_CLASS}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="space-y-1">
                  <p className="text-[14px] font-medium text-[#333333]">
                    {selectedManagedCustomProvider.name ||
                      selectedManagedCustomProvider.id}
                  </p>
                  <p className="text-[12px] text-[#8C8C8C]">
                    {selectedManagedCustomProvider.options.baseURL ||
                      t('settings.cli.customProviders.list.noBaseUrl')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 text-[12px] text-[#8C8C8C]">
                  <span>
                    {t('settings.cli.customProviders.list.modelsCount', {
                      count: selectedManagedCustomProviderModels.length,
                    })}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={settingsSecondaryButtonClassName}
                  onClick={() =>
                    handleEditCustomProvider(selectedManagedCustomProvider)
                  }
                >
                  {t('settings.cli.customProviders.actions.edit')}
                </button>
                <button
                  type="button"
                  disabled={
                    deletingProviderId === selectedManagedCustomProvider.id
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-[#f3d7d7] bg-[#fff7f7] px-4 py-[10px] text-[14px] text-[#d14343] transition-colors duration-200 hover:bg-[#fdeeee] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() =>
                    handleDeleteCustomProvider(selectedManagedCustomProvider)
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  {deletingProviderId === selectedManagedCustomProvider.id
                    ? t('settings.cli.customProviders.actions.deleting')
                    : t('settings.cli.customProviders.actions.delete')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {selectedProvider === 'custom' ? (
              <SettingsField label={t('settings.cli.provider.customNameLabel')}>
                <SettingsInput
                  value={customProviderName}
                  onChange={(value) =>
                    updateDraft((current) =>
                      setCustomProviderName(current, value)
                    )
                  }
                  placeholder={t('settings.cli.provider.customNamePlaceholder')}
                />
              </SettingsField>
            ) : null}

            {selectedProvider !== 'ollama' ? (
              <SettingsField
                label={t('settings.cli.provider.apiKeyLabel')}
                description={
                  apiKeyMasked
                    ? t('settings.cli.provider.apiKeyMasked')
                    : undefined
                }
              >
                <div className="flex gap-2">
                  <input
                    id="cli-provider-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    className={cn(settingsFieldClassName, 'flex-1')}
                    placeholder={t('settings.cli.provider.apiKeyPlaceholder')}
                    value={providerApiKey}
                    onChange={(event) =>
                      updateDraft((current) =>
                        setProviderApiKey(
                          current,
                          selectedProvider,
                          event.target.value
                        )
                      )
                    }
                  />
                  <button
                    type="button"
                    className={settingsIconButtonClassName}
                    onClick={() => setShowApiKey((visible) => !visible)}
                    aria-label={t(
                      'settings.cli.provider.toggleApiKeyVisibility'
                    )}
                  >
                    {showApiKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </SettingsField>
            ) : null}

            <SettingsField
              label={t('settings.cli.provider.endpointLabel')}
              description={t('settings.cli.provider.endpointHelper')}
            >
              <SettingsInput
                value={providerEndpoint}
                onChange={(value) =>
                  updateDraft((current) =>
                    setProviderEndpoint(current, selectedProvider, value)
                  )
                }
                placeholder={t('settings.cli.provider.endpointPlaceholder')}
              />
            </SettingsField>

            <div className={SETTINGS_INLINE_PANEL_CLASS}>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <p className="text-[14px] font-medium text-[#333333]">
                    {t('settings.cli.validation.title')}
                  </p>
                  <p className="text-[12px] text-[#8C8C8C]">
                    {t('settings.cli.validation.description')}
                  </p>
                </div>
                <button
                  type="button"
                  className={settingsSecondaryButtonClassName}
                  onClick={handleValidateConnection}
                  disabled={validateProvider.isPending}
                >
                  {validateProvider.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {validateProvider.isPending
                    ? t('settings.cli.validation.testing')
                    : t('settings.cli.validation.button')}
                </button>
              </div>
            </div>
          </>
        )}

        {isProvidersLoading ? (
          <p className="mt-4 text-[12px] text-[#8C8C8C]">
            {t('settings.cli.provider.loading')}
          </p>
        ) : null}
      </SettingsCard>

      <SettingsCard
        title={t('settings.cli.model.title')}
        description={t('settings.cli.model.description')}
      >
        {selectedManagedCustomProvider ? (
          <div className={cn(SETTINGS_INLINE_PANEL_CLASS, 'mb-5')}>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-[14px] font-medium text-[#333333]">
                  {selectedManagedCustomProvider.name ||
                    selectedManagedCustomProvider.id}
                </p>
                <p className="text-[12px] text-[#8C8C8C]">
                  {selectedManagedCustomProviderModels.length > 0
                    ? t('settings.cli.customProviders.list.modelsCount', {
                        count: selectedManagedCustomProviderModels.length,
                      })
                    : t('settings.cli.customProviders.list.noModels')}
                </p>
              </div>
              <button
                type="button"
                className={settingsSecondaryButtonClassName}
                onClick={() =>
                  handleEditCustomProvider(selectedManagedCustomProvider)
                }
              >
                {t('settings.cli.customProviders.actions.edit')}
              </button>
            </div>
          </div>
        ) : null}

        {selectedProvider !== 'custom' ? (
          <SettingsField
            label={t('settings.cli.model.selectLabel')}
            description={
              selectedManagedCustomProvider
                ? availableModelOptions.length > 0
                  ? t('settings.cli.model.selectHelper')
                  : t('settings.cli.customProviders.list.noModels')
                : isModelsLoading
                  ? t('settings.cli.model.loading')
                  : availableModelOptions.length > 0
                    ? t('settings.cli.model.selectHelper')
                    : t('settings.cli.model.empty')
            }
          >
            <SettingsSelect
              value={suggestedModelValue}
              options={modelSelectOptions}
              onChange={(value) =>
                updateDraft((current) =>
                  setModelValue(current, selectedProvider, value)
                )
              }
              disabled={
                (selectedManagedCustomProvider == null && isModelsLoading) ||
                modelSelectOptions.length === 0
              }
              placeholder={t('settings.cli.model.selectPlaceholder')}
            />
          </SettingsField>
        ) : null}
      </SettingsCard>

      <SettingsCard
        title={t('settings.cli.behavior.title')}
        description={t('settings.cli.behavior.description')}
      >
        <SettingsCheckbox
          id="cli-auto-approve"
          label={t('settings.cli.behavior.autoApproveLabel')}
          description={t('settings.cli.behavior.autoApproveHelper')}
          checked={draft.behavior.auto_approve}
          onChange={(checked) =>
            updateDraft((current) => {
              current.behavior.auto_approve = checked;
            })
          }
        />
        <SettingsCheckbox
          id="cli-auto-compact"
          label={t('settings.cli.behavior.autoCompactLabel')}
          description={t('settings.cli.behavior.autoCompactHelper')}
          checked={draft.behavior.auto_compact}
          onChange={(checked) =>
            updateDraft((current) => {
              current.behavior.auto_compact = checked;
            })
          }
        />
      </SettingsCard>

      <SettingsSaveBar
        show={hasUnsavedChanges}
        saving={isSaveBusy}
        saveDisabled={!hasUnsavedChanges || isSaveBusy}
        unsavedMessage={t('settings.cli.save.unsavedChanges')}
        onSave={handleSave}
        onDiscard={handleDiscard}
        layout={saveBarLayout}
      />
      <CustomProviderForm
        initialProvider={editingCustomProvider}
        isSubmitting={
          createCustomProvider.isPending ||
          updateCustomProvider.isPending ||
          isRestarting
        }
        onOpenChange={(open) => {
          setIsCustomProviderDialogOpen(open);
          if (!open) {
            setEditingCustomProvider(null);
          }
        }}
        onSubmit={handleSubmitCustomProvider}
        open={isCustomProviderDialogOpen}
      />
    </div>
  );
}
