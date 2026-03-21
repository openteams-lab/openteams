import { useEffect, useMemo, useState } from 'react';
import { cloneDeep, isEqual } from 'lodash';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Loader2, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/dialogs/shared/ConfirmDialog';
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
  const {
    data: customProvidersData,
    error: customProvidersError,
  } = useCustomProviders();
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
  const [isProviderSelectOpen, setIsProviderSelectOpen] = useState(false);
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
              name: trimToNull(model.name) ?? id,
            }))
        : [],
    [selectedManagedCustomProvider]
  );

  const hasUnsavedChanges = useMemo(() => {
    if (!comparableDraft || !comparableSavedConfig) {
      return false;
    }

    return !isEqual(comparableDraft, comparableSavedConfig);
  }, [comparableDraft, comparableSavedConfig]);

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

  const handleCreateCustomProviderFromSelect = () => {
    setIsProviderSelectOpen(false);
    handleCreateCustomProvider();
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
          cloneDeep(withCustomProviders(refreshedConfig, nextCustomProvidersRecord))
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
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">{t('settings.cli.loading')}</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-8">
        <Alert variant="destructive">
          <AlertTitle>{t('settings.cli.loadError')}</AlertTitle>
          <AlertDescription>
            {getErrorMessage(error, t('settings.cli.loadError'))}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {saveError && (
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      {saveSuccessMessage && (
        <Alert variant="success">
          <AlertDescription className="font-medium">
            {saveSuccessMessage}
          </AlertDescription>
        </Alert>
      )}

      {customProviderMessage && (
        <Alert variant="success">
          <AlertDescription>{customProviderMessage}</AlertDescription>
        </Alert>
      )}

      {customProviderStatusError && (
        <Alert variant="destructive">
          <AlertDescription>{customProviderStatusError}</AlertDescription>
        </Alert>
      )}

      {validationError && (
        <Alert variant="destructive">
          <AlertDescription>{validationError}</AlertDescription>
        </Alert>
      )}

      {validationResult && validationResult.provider === selectedProvider && (
        <Alert variant={validationResult.valid ? 'success' : 'destructive'}>
          <AlertTitle>
            {validationResult.valid
              ? t('settings.cli.validation.successTitle')
              : t('settings.cli.validation.failureTitle')}
          </AlertTitle>
          <AlertDescription>{validationResult.message}</AlertDescription>
        </Alert>
      )}

      {providersError && (
        <Alert variant="destructive">
          <AlertDescription>
            {getErrorMessage(
              providersError,
              t('settings.cli.provider.loadError')
            )}
          </AlertDescription>
        </Alert>
      )}

      {customProvidersError && (
        <Alert variant="destructive">
          <AlertDescription>
            {getErrorMessage(
              customProvidersError,
              t('settings.cli.customProviders.loadError')
            )}
          </AlertDescription>
        </Alert>
      )}

      {modelsError &&
        selectedManagedCustomProvider == null &&
        selectedProvider !== 'custom' && (
        <Alert variant="destructive">
          <AlertDescription>
            {getErrorMessage(modelsError, t('settings.cli.model.loadError'))}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.cli.title')}</CardTitle>
          <CardDescription>{t('settings.cli.description')}</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.cli.provider.title')}</CardTitle>
          <CardDescription>
            {t('settings.cli.provider.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cli-provider">
              {t('settings.cli.provider.label')}
            </Label>
            <Select
              open={isProviderSelectOpen}
              value={selectedProvider}
              onOpenChange={setIsProviderSelectOpen}
              onValueChange={(value: CliProviderId) =>
                handleProviderChange(value)
              }
            >
              <SelectTrigger id="cli-provider">
                <SelectValue
                  placeholder={t('settings.cli.provider.placeholder')}
                />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                    {provider.configured
                      ? ` · ${t('settings.cli.provider.configured')}`
                      : ''}
                  </SelectItem>
                ))}
                <SelectSeparator />
                <div className="px-1 pb-1">
                  <Button
                    className="w-full justify-start"
                    onClick={handleCreateCustomProviderFromSelect}
                    onMouseDown={(event) => event.preventDefault()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t('settings.cli.customProviders.actions.add')}
                  </Button>
                </div>
              </SelectContent>
            </Select>
          <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
            <span>{t('settings.cli.provider.helper')}</span>
            <span className="shrink-0">
              {selectedProviderInfo?.configured
                  ? t('settings.cli.provider.configured')
                  : t('settings.cli.provider.notConfigured')}
            </span>
          </div>
          </div>

          {selectedManagedCustomProvider ? (
            <div className="rounded-lg border p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <div className="space-y-1">
                    <p className="font-medium">
                      {selectedManagedCustomProvider.name ||
                        selectedManagedCustomProvider.id}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {selectedManagedCustomProvider.options.baseURL ||
                        t('settings.cli.customProviders.list.noBaseUrl')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>
                      {t('settings.cli.customProviders.list.modelsCount', {
                        count: selectedManagedCustomProviderModels.length,
                      })}
                    </span>
                    <span>
                      {t('settings.cli.customProviders.list.timeout', {
                        timeout:
                          selectedManagedCustomProvider.options.timeout ?? '-',
                      })}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() =>
                      handleEditCustomProvider(selectedManagedCustomProvider)
                    }
                    type="button"
                    variant="outline"
                  >
                    {t('settings.cli.customProviders.actions.edit')}
                  </Button>
                  <Button
                    disabled={deletingProviderId === selectedManagedCustomProvider.id}
                    onClick={() =>
                      handleDeleteCustomProvider(selectedManagedCustomProvider)
                    }
                    type="button"
                    variant="destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {deletingProviderId === selectedManagedCustomProvider.id
                      ? t('settings.cli.customProviders.actions.deleting')
                      : t('settings.cli.customProviders.actions.delete')}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {selectedProvider === 'custom' && (
                <div className="space-y-2">
                  <Label htmlFor="cli-provider-name">
                    {t('settings.cli.provider.customNameLabel')}
                  </Label>
                  <Input
                    id="cli-provider-name"
                    placeholder={t('settings.cli.provider.customNamePlaceholder')}
                    value={customProviderName}
                    onChange={(event) =>
                      updateDraft((current) =>
                        setCustomProviderName(current, event.target.value)
                      )
                    }
                  />
                </div>
              )}

              {selectedProvider !== 'ollama' && (
                <div className="space-y-2">
                  <Label htmlFor="cli-provider-api-key">
                    {t('settings.cli.provider.apiKeyLabel')}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="cli-provider-api-key"
                      type={showApiKey ? 'text' : 'password'}
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
                    <Button
                      type="button"
                      variant="outline"
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
                    </Button>
                  </div>
                  {apiKeyMasked && (
                    <p className="text-sm text-muted-foreground">
                      {t('settings.cli.provider.apiKeyMasked')}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="cli-provider-endpoint">
                  {t('settings.cli.provider.endpointLabel')}
                </Label>
                <Input
                  id="cli-provider-endpoint"
                  placeholder={t('settings.cli.provider.endpointPlaceholder')}
                  value={providerEndpoint}
                  onChange={(event) =>
                    updateDraft((current) =>
                      setProviderEndpoint(
                        current,
                        selectedProvider,
                        event.target.value
                      )
                    )
                  }
                />
                <p className="text-sm text-muted-foreground">
                  {t('settings.cli.provider.endpointHelper')}
                </p>
              </div>

              <div className="rounded-lg border p-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <p className="font-medium">
                      {t('settings.cli.validation.title')}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('settings.cli.validation.description')}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleValidateConnection}
                    disabled={validateProvider.isPending}
                  >
                    {validateProvider.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {validateProvider.isPending
                      ? t('settings.cli.validation.testing')
                      : t('settings.cli.validation.button')}
                  </Button>
                </div>
              </div>
            </>
          )}

          {isProvidersLoading && (
            <p className="text-sm text-muted-foreground">
              {t('settings.cli.provider.loading')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.cli.model.title')}</CardTitle>
          <CardDescription>
            {t('settings.cli.model.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedManagedCustomProvider && (
            <div className="rounded-lg border border-dashed p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <p className="font-medium">
                    {selectedManagedCustomProvider.name ||
                      selectedManagedCustomProvider.id}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedManagedCustomProviderModels.length > 0
                      ? t('settings.cli.customProviders.list.modelsCount', {
                          count: selectedManagedCustomProviderModels.length,
                        })
                      : t('settings.cli.customProviders.list.noModels')}
                  </p>
                </div>
                <Button
                  onClick={() =>
                    handleEditCustomProvider(selectedManagedCustomProvider)
                  }
                  type="button"
                  variant="outline"
                >
                  {t('settings.cli.customProviders.actions.edit')}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="cli-model-input">
              {t('settings.cli.model.inputLabel')}
            </Label>
            <Input
              id="cli-model-input"
              placeholder={t('settings.cli.model.inputPlaceholder')}
              value={draft.model.default}
              onChange={(event) =>
                updateDraft((current) =>
                  setModelValue(current, selectedProvider, event.target.value)
                )
              }
            />
          </div>

          {selectedProvider !== 'custom' && (
            <div className="space-y-2">
              <Label htmlFor="cli-model-select">
                {t('settings.cli.model.selectLabel')}
              </Label>
              <Select
                value={suggestedModelValue}
                onValueChange={(value) =>
                  updateDraft((current) =>
                    setModelValue(current, selectedProvider, value)
                  )
                }
                disabled={
                  (selectedManagedCustomProvider == null && isModelsLoading) ||
                  availableModelOptions.length === 0
                }
              >
                <SelectTrigger id="cli-model-select">
                  <SelectValue
                    placeholder={t('settings.cli.model.selectPlaceholder')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableModelOptions.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {selectedManagedCustomProvider
                  ? availableModelOptions.length > 0
                    ? t('settings.cli.model.selectHelper')
                    : t('settings.cli.customProviders.list.noModels')
                  : isModelsLoading
                  ? t('settings.cli.model.loading')
                  : availableModelOptions.length > 0
                    ? t('settings.cli.model.selectHelper')
                    : t('settings.cli.model.empty')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.cli.behavior.title')}</CardTitle>
          <CardDescription>
            {t('settings.cli.behavior.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="cli-auto-approve">
                {t('settings.cli.behavior.autoApproveLabel')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('settings.cli.behavior.autoApproveHelper')}
              </p>
            </div>
            <Switch
              id="cli-auto-approve"
              checked={draft.behavior.auto_approve}
              onCheckedChange={(checked) =>
                updateDraft((current) => {
                  current.behavior.auto_approve = checked;
                })
              }
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="cli-auto-compact">
                {t('settings.cli.behavior.autoCompactLabel')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('settings.cli.behavior.autoCompactHelper')}
              </p>
            </div>
            <Switch
              id="cli-auto-compact"
              checked={draft.behavior.auto_compact}
              onCheckedChange={(checked) =>
                updateDraft((current) => {
                  current.behavior.auto_compact = checked;
                })
              }
            />
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-10 border-t bg-background/80 py-4 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          {hasUnsavedChanges ? (
            <span className="text-sm text-muted-foreground">
              {t('settings.cli.save.unsavedChanges')}
            </span>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleDiscard}
              disabled={!hasUnsavedChanges || isSaveBusy}
            >
              {t('settings.cli.save.discard')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasUnsavedChanges || isSaveBusy}
            >
              {isSaveBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('settings.cli.save.button')}
            </Button>
          </div>
        </div>
      </div>

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
