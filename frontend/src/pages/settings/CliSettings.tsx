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
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import {
  useCliConfig,
  useCliProviderModels,
  useCliProviders,
  useValidateCliProvider,
} from '@/hooks/useCliConfig';
import type {
  CliConfig,
  CliProviderId,
  CliProviderInfo,
  CustomProviderConfig,
  OllamaConfig,
  ProviderCredentials,
  ProviderModelConfig,
} from '@/types/cliConfig';

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

export function CliSettings() {
  const { t } = useTranslation(['settings', 'common']);
  const {
    data: savedConfig,
    isLoading,
    isError,
    error,
    save,
    isSaving,
  } = useCliConfig();
  const {
    data: providersData,
    error: providersError,
    isLoading: isProvidersLoading,
  } = useCliProviders();
  const validateProvider = useValidateCliProvider();

  const [draft, setDraft] = useState<CliConfig | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationResult, setValidationResult] =
    useState<ProviderValidationState | null>(null);

  const hasUnsavedChanges = useMemo(() => {
    if (!draft || !savedConfig) {
      return false;
    }

    return !isEqual(draft, savedConfig);
  }, [draft, savedConfig]);

  useEffect(() => {
    if (!savedConfig) {
      return;
    }

    if (!draft) {
      setDraft(cloneDeep(savedConfig));
      return;
    }

    if (!hasUnsavedChanges && !isEqual(draft, savedConfig)) {
      setDraft(cloneDeep(savedConfig));
    }
  }, [draft, hasUnsavedChanges, savedConfig]);

  const selectedProvider = draft?.provider.default ?? 'anthropic';
  const providerOptions =
    providersData && providersData.length > 0
      ? providersData
      : DEFAULT_PROVIDER_OPTIONS;
  const selectedProviderInfo = providerOptions.find(
    (provider) => provider.id === selectedProvider
  );

  const {
    data: modelOptions = [],
    error: modelsError,
    isLoading: isModelsLoading,
  } = useCliProviderModels(draft ? selectedProvider : null);

  const providerApiKey = draft
    ? getProviderApiKey(draft, selectedProvider)
    : '';
  const providerEndpoint = draft
    ? getProviderEndpoint(draft, selectedProvider)
    : '';
  const customProviderName = draft ? getCustomProviderName(draft) : '';
  const apiKeyMasked = providerApiKey.includes('***');
  const suggestedModelValue =
    draft && modelOptions.some((model) => model.id === draft.model.default)
      ? draft.model.default
      : undefined;

  const updateDraft = (updater: (config: CliConfig) => void) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const next = cloneDeep(current);
      updater(next);
      return next;
    });
    setSaveSuccess(false);
    setSaveError(null);
    setValidationError(null);
    setValidationResult(null);
  };

  const handleProviderChange = (provider: CliProviderId) => {
    updateDraft((current) => {
      current.provider.default = provider;
      ensureProviderConfig(current, provider);
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
    if (!sanitizedDraft.model.default) {
      setSaveError(t('settings.cli.model.required'));
      return;
    }

    try {
      const saved = await save(sanitizedDraft);
      setDraft(cloneDeep(saved));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (saveErr) {
      console.error('Failed to save CLI config:', saveErr);
      setSaveError(t('settings.cli.save.error'));
    }
  };

  const handleDiscard = () => {
    if (!savedConfig) {
      return;
    }

    setDraft(cloneDeep(savedConfig));
    setSaveError(null);
    setSaveSuccess(false);
    setValidationError(null);
    setValidationResult(null);
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

      {saveSuccess && (
        <Alert variant="success">
          <AlertDescription className="font-medium">
            {t('settings.cli.save.success')}
          </AlertDescription>
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

      {modelsError && selectedProvider !== 'custom' && (
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
              value={selectedProvider}
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
                  aria-label={t('settings.cli.provider.toggleApiKeyVisibility')}
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
                disabled={isModelsLoading || modelOptions.length === 0}
              >
                <SelectTrigger id="cli-model-select">
                  <SelectValue
                    placeholder={t('settings.cli.model.selectPlaceholder')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {isModelsLoading
                  ? t('settings.cli.model.loading')
                  : modelOptions.length > 0
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
              disabled={!hasUnsavedChanges || isSaving}
            >
              {t('settings.cli.save.discard')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasUnsavedChanges || isSaving}
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('settings.cli.save.button')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
