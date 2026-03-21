import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createEmptyCustomProviderEntry,
  DEFAULT_CUSTOM_PROVIDER_NPM,
  normalizeCustomProviderEntry,
} from '@/types/cliConfig';
import type { CustomModelConfig, CustomProviderEntry } from '@/types/cliConfig';

type CustomModelDraft = {
  contextLimit: string;
  id: string;
  inputModalities: string;
  key: string;
  name: string;
  options: CustomModelConfig['options'];
  outputLimit: string;
  outputModalities: string;
};

type CustomProviderFormState = {
  apiKey: string;
  baseURL: string;
  id: string;
  models: CustomModelDraft[];
  name: string;
  npm: string;
  timeout: string;
};

type CustomProviderFormProps = {
  initialProvider: CustomProviderEntry | null;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (provider: CustomProviderEntry) => Promise<void>;
  open: boolean;
};

const CUSTOM_NPM_OPTION_VALUE = '__custom__';

const AI_SDK_NPM_PACKAGES = [
  { value: '@ai-sdk/amazon-bedrock', label: 'Amazon Bedrock' },
  { value: '@ai-sdk/anthropic', label: 'Anthropic' },
  { value: '@ai-sdk/azure', label: 'Azure OpenAI' },
  { value: '@ai-sdk/cerebras', label: 'Cerebras' },
  { value: '@ai-sdk/cohere', label: 'Cohere' },
  { value: '@ai-sdk/deepinfra', label: 'DeepInfra' },
  { value: '@ai-sdk/gateway', label: 'AI Gateway' },
  { value: '@ai-sdk/google', label: 'Google AI' },
  { value: '@ai-sdk/google-vertex', label: 'Google Vertex' },
  { value: '@ai-sdk/groq', label: 'Groq' },
  { value: '@ai-sdk/mistral', label: 'Mistral' },
  { value: '@ai-sdk/openai', label: 'OpenAI' },
  { value: '@ai-sdk/openai-compatible', label: 'OpenAI Compatible' },
  { value: '@ai-sdk/perplexity', label: 'Perplexity' },
  { value: '@ai-sdk/togetherai', label: 'Together AI' },
  { value: '@ai-sdk/vercel', label: 'Vercel AI' },
  { value: '@ai-sdk/xai', label: 'xAI' },
  { value: '@openrouter/ai-sdk-provider', label: 'OpenRouter' },
  { value: '@gitlab/gitlab-ai-provider', label: 'GitLab AI' },
  { value: 'ai-gateway-provider', label: 'AI Gateway Provider' },
] as const;

let modelDraftCounter = 0;

function createModelDraftKey() {
  modelDraftCounter += 1;
  return `custom-model-${modelDraftCounter}`;
}

function createEmptyModelDraft(): CustomModelDraft {
  return {
    contextLimit: '',
    id: '',
    inputModalities: '',
    key: createModelDraftKey(),
    name: '',
    options: null,
    outputLimit: '',
    outputModalities: '',
  };
}

function createModelDraft(
  id: string,
  model: CustomModelConfig
): CustomModelDraft {
  return {
    contextLimit:
      model.limit?.context == null ? '' : String(model.limit.context),
    id,
    inputModalities: model.modalities?.input?.join(', ') ?? '',
    key: createModelDraftKey(),
    name: model.name ?? '',
    options: model.options ?? null,
    outputLimit: model.limit?.output == null ? '' : String(model.limit.output),
    outputModalities: model.modalities?.output?.join(', ') ?? '',
  };
}

function createFormState(
  entry: CustomProviderEntry | null | undefined
): CustomProviderFormState {
  const provider = entry ?? createEmptyCustomProviderEntry();

  return {
    apiKey: provider.options.api_key ?? '',
    baseURL: provider.options.baseURL ?? '',
    id: provider.id,
    models: Object.entries(provider.models ?? {}).map(([modelId, model]) =>
      createModelDraft(modelId, model)
    ),
    name: provider.name ?? '',
    npm: provider.npm ?? DEFAULT_CUSTOM_PROVIDER_NPM,
    timeout:
      provider.options.timeout == null ? '' : String(provider.options.timeout),
  };
}

function parseModalities(value: string): string[] | null {
  const normalized = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length > 0 ? Array.from(new Set(normalized)) : null;
}

function parseOptionalInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('invalid-integer');
  }

  return parsed;
}

function isBuiltInNpmPackage(value: string): boolean {
  return AI_SDK_NPM_PACKAGES.some((entry) => entry.value === value);
}

function getNpmSelectionValue(value: string): string {
  return isBuiltInNpmPackage(value) ? value : CUSTOM_NPM_OPTION_VALUE;
}

export function CustomProviderForm({
  initialProvider,
  isSubmitting,
  onOpenChange,
  onSubmit,
  open,
}: CustomProviderFormProps) {
  const { t } = useTranslation('settings');
  const [error, setError] = useState<string | null>(null);
  const [formState, setFormState] = useState<CustomProviderFormState>(() =>
    createFormState(initialProvider)
  );
  const [npmSelection, setNpmSelection] = useState<string>(() =>
    getNpmSelectionValue(initialProvider?.npm ?? DEFAULT_CUSTOM_PROVIDER_NPM)
  );
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setError(null);
    setShowApiKey(false);
    const nextFormState = createFormState(initialProvider);
    setFormState(nextFormState);
    setNpmSelection(getNpmSelectionValue(nextFormState.npm));
  }, [initialProvider, open]);

  const isEditing = initialProvider != null;
  const apiKeyMasked = formState.apiKey.includes('***');
  const hasModels = formState.models.length > 0;

  const dialogCopy = useMemo(
    () => ({
      description: isEditing
        ? t('settings.cli.customProviders.form.editDescription')
        : t('settings.cli.customProviders.form.createDescription'),
      submitLabel: isEditing
        ? t('settings.cli.customProviders.form.update')
        : t('settings.cli.customProviders.form.create'),
      title: isEditing
        ? t('settings.cli.customProviders.form.editTitle')
        : t('settings.cli.customProviders.form.createTitle'),
    }),
    [isEditing, t]
  );

  const updateModelDraft = (
    key: string,
    updater: (draft: CustomModelDraft) => CustomModelDraft
  ) => {
    setFormState((current) => ({
      ...current,
      models: current.models.map((model) =>
        model.key === key ? updater(model) : model
      ),
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const providerId = formState.id.trim();
    if (!providerId) {
      setError(
        t('settings.cli.customProviders.form.validation.providerIdRequired')
      );
      return;
    }

    if (!formState.baseURL.trim()) {
      setError(
        t('settings.cli.customProviders.form.validation.baseUrlRequired')
      );
      return;
    }

    const modelsRecord: Record<string, CustomModelConfig> = {};
    const seenModelIds = new Set<string>();

    try {
      for (const model of formState.models) {
        const modelId = model.id.trim();
        if (!modelId) {
          setError(
            t('settings.cli.customProviders.form.validation.modelIdRequired')
          );
          return;
        }

        if (seenModelIds.has(modelId)) {
          setError(
            t('settings.cli.customProviders.form.validation.duplicateModelId', {
              id: modelId,
            })
          );
          return;
        }
        seenModelIds.add(modelId);

        modelsRecord[modelId] = {
          limit: {
            context: parseOptionalInteger(model.contextLimit),
            output: parseOptionalInteger(model.outputLimit),
          },
          modalities: {
            input: parseModalities(model.inputModalities),
            output: parseModalities(model.outputModalities),
          },
          name: model.name.trim() || null,
          options: model.options ?? null,
        };
      }

      const provider = normalizeCustomProviderEntry({
        id: providerId,
        models: Object.keys(modelsRecord).length > 0 ? modelsRecord : null,
        name: formState.name.trim() || null,
        npm: formState.npm.trim() || DEFAULT_CUSTOM_PROVIDER_NPM,
        options: {
          api_key: formState.apiKey.trim() || null,
          baseURL: formState.baseURL.trim() || null,
          timeout: parseOptionalInteger(formState.timeout),
        },
      });

      await onSubmit(provider);
      onOpenChange(false);
    } catch (submitError) {
      if (
        submitError instanceof Error &&
        submitError.message === 'invalid-integer'
      ) {
        setError(
          t('settings.cli.customProviders.form.validation.numericLimit')
        );
        return;
      }

      setError(
        submitError instanceof Error
          ? submitError.message
          : t('settings.cli.customProviders.form.submitError')
      );
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{dialogCopy.title}</DialogTitle>
          <DialogDescription>{dialogCopy.description}</DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={handleSubmit}
        >
          {error && (
            <Alert variant="destructive">
              <AlertTitle>
                {t('settings.cli.customProviders.form.errorTitle')}
              </AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="custom-provider-id">
                    {t('settings.cli.customProviders.form.idLabel')}
                  </Label>
                  <Input
                    disabled={isEditing}
                    id="custom-provider-id"
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        id: event.target.value,
                      }))
                    }
                    placeholder={t(
                      'settings.cli.customProviders.form.idPlaceholder'
                    )}
                    value={formState.id}
                  />
                  <p className="text-sm text-muted-foreground">
                    {t('settings.cli.customProviders.form.idHelper')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="custom-provider-name">
                    {t('settings.cli.customProviders.form.nameLabel')}
                  </Label>
                  <Input
                    id="custom-provider-name"
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder={t(
                      'settings.cli.customProviders.form.namePlaceholder'
                    )}
                    value={formState.name}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-provider-base-url">
                  {t('settings.cli.customProviders.form.baseUrlLabel')}
                </Label>
                <Input
                  id="custom-provider-base-url"
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      baseURL: event.target.value,
                    }))
                  }
                  placeholder={t(
                    'settings.cli.customProviders.form.baseUrlPlaceholder'
                  )}
                  value={formState.baseURL}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="space-y-2">
                  <Label htmlFor="custom-provider-api-key">
                    {t('settings.cli.customProviders.form.apiKeyLabel')}
                  </Label>
                  <Input
                    id="custom-provider-api-key"
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        apiKey: event.target.value,
                      }))
                    }
                    placeholder={t(
                      'settings.cli.customProviders.form.apiKeyPlaceholder'
                    )}
                    type={showApiKey ? 'text' : 'password'}
                    value={formState.apiKey}
                  />
                  {apiKeyMasked && (
                    <p className="text-sm text-muted-foreground">
                      {t('settings.cli.customProviders.form.apiKeyMasked')}
                    </p>
                  )}
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={() => setShowApiKey((visible) => !visible)}
                    type="button"
                    variant="outline"
                  >
                    {showApiKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="custom-provider-npm">
                    {t('settings.cli.customProviders.form.npmLabel')}
                  </Label>
                  <Select
                    value={npmSelection}
                    onValueChange={(value) => {
                      setNpmSelection(value);
                      setFormState((current) => ({
                        ...current,
                        npm:
                          value === CUSTOM_NPM_OPTION_VALUE
                            ? isBuiltInNpmPackage(current.npm)
                              ? ''
                              : current.npm
                            : value,
                      }));
                    }}
                  >
                    <SelectTrigger id="custom-provider-npm">
                      <SelectValue
                        placeholder={t(
                          'settings.cli.customProviders.form.npmPlaceholder'
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {AI_SDK_NPM_PACKAGES.map((entry) => (
                        <SelectItem key={entry.value} value={entry.value}>
                          {entry.label}
                        </SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_NPM_OPTION_VALUE}>
                        Custom
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {npmSelection === CUSTOM_NPM_OPTION_VALUE && (
                    <Input
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          npm: event.target.value,
                        }))
                      }
                      placeholder={t(
                        'settings.cli.customProviders.form.npmPlaceholder'
                      )}
                      value={formState.npm}
                    />
                  )}
                  <p className="text-sm text-muted-foreground">
                    {t('settings.cli.customProviders.form.npmHelper')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="custom-provider-timeout">
                    {t('settings.cli.customProviders.form.timeoutLabel')}
                  </Label>
                  <Input
                    id="custom-provider-timeout"
                    min="0"
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        timeout: event.target.value,
                      }))
                    }
                    placeholder={t(
                      'settings.cli.customProviders.form.timeoutPlaceholder'
                    )}
                    type="number"
                    value={formState.timeout}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="font-medium">
                    {t('settings.cli.customProviders.form.modelsTitle')}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.cli.customProviders.form.modelsDescription')}
                  </p>
                </div>
                <Button
                  onClick={() =>
                    setFormState((current) => ({
                      ...current,
                      models: [...current.models, createEmptyModelDraft()],
                    }))
                  }
                  type="button"
                  variant="outline"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('settings.cli.customProviders.form.addModel')}
                </Button>
              </div>

              {!hasModels && (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  {t('settings.cli.customProviders.form.noModels')}
                </div>
              )}

              <div className="space-y-4">
                {formState.models.map((model) => (
                  <div key={model.key} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-medium">
                        {model.name ||
                          model.id ||
                          t('settings.cli.customProviders.form.newModel')}
                      </p>
                      <Button
                        onClick={() =>
                          setFormState((current) => ({
                            ...current,
                            models: current.models.filter(
                              (entry) => entry.key !== model.key
                            ),
                          }))
                        }
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('settings.cli.customProviders.actions.removeModel')}
                      </Button>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>
                          {t('settings.cli.customProviders.form.modelIdLabel')}
                        </Label>
                        <Input
                          onChange={(event) =>
                            updateModelDraft(model.key, (draft) => ({
                              ...draft,
                              id: event.target.value,
                            }))
                          }
                          placeholder={t(
                            'settings.cli.customProviders.form.modelIdPlaceholder'
                          )}
                          value={model.id}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          {t(
                            'settings.cli.customProviders.form.modelNameLabel'
                          )}
                        </Label>
                        <Input
                          onChange={(event) =>
                            updateModelDraft(model.key, (draft) => ({
                              ...draft,
                              name: event.target.value,
                            }))
                          }
                          placeholder={t(
                            'settings.cli.customProviders.form.modelNamePlaceholder'
                          )}
                          value={model.name}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          {t(
                            'settings.cli.customProviders.form.inputModalitiesLabel'
                          )}
                        </Label>
                        <Input
                          onChange={(event) =>
                            updateModelDraft(model.key, (draft) => ({
                              ...draft,
                              inputModalities: event.target.value,
                            }))
                          }
                          placeholder={t(
                            'settings.cli.customProviders.form.modalitiesPlaceholder'
                          )}
                          value={model.inputModalities}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          {t(
                            'settings.cli.customProviders.form.outputModalitiesLabel'
                          )}
                        </Label>
                        <Input
                          onChange={(event) =>
                            updateModelDraft(model.key, (draft) => ({
                              ...draft,
                              outputModalities: event.target.value,
                            }))
                          }
                          placeholder={t(
                            'settings.cli.customProviders.form.modalitiesPlaceholder'
                          )}
                          value={model.outputModalities}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          {t(
                            'settings.cli.customProviders.form.contextLimitLabel'
                          )}
                        </Label>
                        <Input
                          min="0"
                          onChange={(event) =>
                            updateModelDraft(model.key, (draft) => ({
                              ...draft,
                              contextLimit: event.target.value,
                            }))
                          }
                          placeholder={t(
                            'settings.cli.customProviders.form.limitPlaceholder'
                          )}
                          type="number"
                          value={model.contextLimit}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          {t(
                            'settings.cli.customProviders.form.outputLimitLabel'
                          )}
                        </Label>
                        <Input
                          min="0"
                          onChange={(event) =>
                            updateModelDraft(model.key, (draft) => ({
                              ...draft,
                              outputLimit: event.target.value,
                            }))
                          }
                          placeholder={t(
                            'settings.cli.customProviders.form.limitPlaceholder'
                          )}
                          type="number"
                          value={model.outputLimit}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {t('settings.cli.customProviders.form.cancel')}
            </Button>
            <Button disabled={isSubmitting} type="submit">
              {dialogCopy.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
