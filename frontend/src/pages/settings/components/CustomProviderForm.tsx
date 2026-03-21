import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Plus, Trash2, X } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  SettingsField,
  SettingsInput,
  SettingsSelect,
  settingsFieldClassName,
  settingsIconButtonClassName,
  settingsMutedPanelClassName,
  settingsPrimaryButtonClassName,
  settingsSecondaryButtonClassName,
} from '@/components/ui-new/dialogs/settings/SettingsComponents';
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
  const { t } = useTranslation(['settings', 'common']);
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
  const npmOptions = useMemo(
    () => [
      ...AI_SDK_NPM_PACKAGES.map((entry) => ({
        value: entry.value,
        label: entry.label,
      })),
      { value: CUSTOM_NPM_OPTION_VALUE, label: 'Custom' },
    ],
    []
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
    <Dialog
      onOpenChange={onOpenChange}
      open={open}
      hideCloseButton
      overlayClassName="bg-black/5"
      containerClassName="items-center p-4 md:p-6"
      className="my-0 w-full max-w-[640px] max-h-[min(560px,calc(100vh-48px))] gap-0 overflow-hidden rounded-[16px] border border-[#E8EEF5] bg-white p-0 shadow-[0_20px_60px_rgba(0,0,0,0.1)]"
    >
      <DialogContent className="min-h-0 gap-0">
        <DialogHeader className="border-b border-[#E8EEF5] px-6 py-5 text-left">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <DialogTitle className="text-[18px] font-semibold text-[#333333]">
                {dialogCopy.title}
              </DialogTitle>
              <DialogDescription className="mt-2 text-[13px] leading-6 text-[#8C8C8C]">
                {dialogCopy.description}
              </DialogDescription>
            </div>
            <button
              type="button"
              className={settingsIconButtonClassName}
              onClick={() => onOpenChange(false)}
              aria-label={t('close', { ns: 'common', defaultValue: 'Close' })}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {error ? (
              <div className="mb-5 rounded-[10px] border border-[#f3d7d7] bg-[#fff7f7] p-4 text-[13px] text-[#d14343]">
                <p className="mb-1 font-medium">
                  {t('settings.cli.customProviders.form.errorTitle')}
                </p>
                <p>{error}</p>
              </div>
            ) : null}

            <div className="space-y-8">
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <SettingsField
                    label={t('settings.cli.customProviders.form.idLabel')}
                    description={t('settings.cli.customProviders.form.idHelper')}
                  >
                    <SettingsInput
                      disabled={isEditing}
                      value={formState.id}
                      onChange={(value) =>
                        setFormState((current) => ({
                          ...current,
                          id: value,
                        }))
                      }
                      placeholder={t(
                        'settings.cli.customProviders.form.idPlaceholder'
                      )}
                    />
                  </SettingsField>

                  <SettingsField
                    label={t('settings.cli.customProviders.form.nameLabel')}
                  >
                    <SettingsInput
                      value={formState.name}
                      onChange={(value) =>
                        setFormState((current) => ({
                          ...current,
                          name: value,
                        }))
                      }
                      placeholder={t(
                        'settings.cli.customProviders.form.namePlaceholder'
                      )}
                    />
                  </SettingsField>
                </div>

                <SettingsField
                  label={t('settings.cli.customProviders.form.baseUrlLabel')}
                >
                  <SettingsInput
                    value={formState.baseURL}
                    onChange={(value) =>
                      setFormState((current) => ({
                        ...current,
                        baseURL: value,
                      }))
                    }
                    placeholder={t(
                      'settings.cli.customProviders.form.baseUrlPlaceholder'
                    )}
                  />
                </SettingsField>

                <SettingsField
                  label={t('settings.cli.customProviders.form.apiKeyLabel')}
                  description={
                    apiKeyMasked
                      ? t('settings.cli.customProviders.form.apiKeyMasked')
                      : undefined
                  }
                >
                  <div className="flex gap-2">
                    <input
                      id="custom-provider-api-key"
                      type={showApiKey ? 'text' : 'password'}
                      className={cn(settingsFieldClassName, 'flex-1')}
                      placeholder={t(
                        'settings.cli.customProviders.form.apiKeyPlaceholder'
                      )}
                      value={formState.apiKey}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          apiKey: event.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      className={settingsIconButtonClassName}
                      onClick={() => setShowApiKey((visible) => !visible)}
                      aria-label={t(
                        'settings.cli.customProviders.form.apiKeyLabel'
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

                <div className="grid gap-4 md:grid-cols-2">
                  <SettingsField
                    label={t('settings.cli.customProviders.form.npmLabel')}
                    description={t('settings.cli.customProviders.form.npmHelper')}
                  >
                    <SettingsSelect
                      value={npmSelection}
                      options={npmOptions}
                      onChange={(value) => {
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
                      placeholder={t(
                        'settings.cli.customProviders.form.npmPlaceholder'
                      )}
                    />
                    {npmSelection === CUSTOM_NPM_OPTION_VALUE ? (
                      <input
                        type="text"
                        className={cn(settingsFieldClassName, 'mt-3')}
                        placeholder={t(
                          'settings.cli.customProviders.form.npmPlaceholder'
                        )}
                        value={formState.npm}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            npm: event.target.value,
                          }))
                        }
                      />
                    ) : null}
                  </SettingsField>

                  <SettingsField
                    label={t('settings.cli.customProviders.form.timeoutLabel')}
                  >
                    <input
                      id="custom-provider-timeout"
                      type="number"
                      min="0"
                      className={settingsFieldClassName}
                      placeholder={t(
                        'settings.cli.customProviders.form.timeoutPlaceholder'
                      )}
                      value={formState.timeout}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          timeout: event.target.value,
                        }))
                      }
                    />
                  </SettingsField>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-[14px] font-semibold text-[#333333]">
                      {t('settings.cli.customProviders.form.modelsTitle')}
                    </h4>
                    <p className="mt-2 text-[12px] leading-5 text-[#8C8C8C]">
                      {t('settings.cli.customProviders.form.modelsDescription')}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={settingsSecondaryButtonClassName}
                    onClick={() =>
                      setFormState((current) => ({
                        ...current,
                        models: [...current.models, createEmptyModelDraft()],
                      }))
                    }
                  >
                    <Plus className="h-4 w-4" />
                    {t('settings.cli.customProviders.form.addModel')}
                  </button>
                </div>

                {!hasModels ? (
                  <div
                    className={cn(
                      settingsMutedPanelClassName,
                      'border-dashed p-4 text-[13px] text-[#8C8C8C]'
                    )}
                  >
                    {t('settings.cli.customProviders.form.noModels')}
                  </div>
                ) : null}

                <div className="space-y-4">
                  {formState.models.map((model) => (
                    <div
                      key={model.key}
                      className={cn(settingsMutedPanelClassName, 'p-4')}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-[14px] font-medium text-[#333333]">
                          {model.name ||
                            model.id ||
                            t('settings.cli.customProviders.form.newModel')}
                        </p>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-[#f3d7d7] bg-[#fff7f7] px-3 py-[9px] text-[13px] text-[#d14343] transition-colors duration-200 hover:bg-[#fdeeee]"
                          onClick={() =>
                            setFormState((current) => ({
                              ...current,
                              models: current.models.filter(
                                (entry) => entry.key !== model.key
                              ),
                            }))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                          {t('settings.cli.customProviders.actions.removeModel')}
                        </button>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <SettingsField
                          label={t('settings.cli.customProviders.form.modelIdLabel')}
                        >
                          <SettingsInput
                            value={model.id}
                            onChange={(value) =>
                              updateModelDraft(model.key, (draft) => ({
                                ...draft,
                                id: value,
                              }))
                            }
                            placeholder={t(
                              'settings.cli.customProviders.form.modelIdPlaceholder'
                            )}
                          />
                        </SettingsField>

                        <SettingsField
                          label={t('settings.cli.customProviders.form.modelNameLabel')}
                        >
                          <SettingsInput
                            value={model.name}
                            onChange={(value) =>
                              updateModelDraft(model.key, (draft) => ({
                                ...draft,
                                name: value,
                              }))
                            }
                            placeholder={t(
                              'settings.cli.customProviders.form.modelNamePlaceholder'
                            )}
                          />
                        </SettingsField>

                        <SettingsField
                          label={t(
                            'settings.cli.customProviders.form.inputModalitiesLabel'
                          )}
                        >
                          <SettingsInput
                            value={model.inputModalities}
                            onChange={(value) =>
                              updateModelDraft(model.key, (draft) => ({
                                ...draft,
                                inputModalities: value,
                              }))
                            }
                            placeholder={t(
                              'settings.cli.customProviders.form.modalitiesPlaceholder'
                            )}
                          />
                        </SettingsField>

                        <SettingsField
                          label={t(
                            'settings.cli.customProviders.form.outputModalitiesLabel'
                          )}
                        >
                          <SettingsInput
                            value={model.outputModalities}
                            onChange={(value) =>
                              updateModelDraft(model.key, (draft) => ({
                                ...draft,
                                outputModalities: value,
                              }))
                            }
                            placeholder={t(
                              'settings.cli.customProviders.form.modalitiesPlaceholder'
                            )}
                          />
                        </SettingsField>

                        <SettingsField
                          label={t(
                            'settings.cli.customProviders.form.contextLimitLabel'
                          )}
                        >
                          <input
                            type="number"
                            min="0"
                            className={settingsFieldClassName}
                            placeholder={t(
                              'settings.cli.customProviders.form.limitPlaceholder'
                            )}
                            value={model.contextLimit}
                            onChange={(event) =>
                              updateModelDraft(model.key, (draft) => ({
                                ...draft,
                                contextLimit: event.target.value,
                              }))
                            }
                          />
                        </SettingsField>

                        <SettingsField
                          label={t(
                            'settings.cli.customProviders.form.outputLimitLabel'
                          )}
                        >
                          <input
                            type="number"
                            min="0"
                            className={settingsFieldClassName}
                            placeholder={t(
                              'settings.cli.customProviders.form.limitPlaceholder'
                            )}
                            value={model.outputLimit}
                            onChange={(event) =>
                              updateModelDraft(model.key, (draft) => ({
                                ...draft,
                                outputLimit: event.target.value,
                              }))
                            }
                          />
                        </SettingsField>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-[#E8EEF5] px-6 py-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              className={settingsSecondaryButtonClassName}
              onClick={() => onOpenChange(false)}
            >
              {t('settings.cli.customProviders.form.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={settingsPrimaryButtonClassName}
            >
              {dialogCopy.submitLabel}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
