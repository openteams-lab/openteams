import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cliConfigApi } from '@/lib/cliConfigApi';
import { CustomProviderConnectionSection } from './CustomProviderConnectionSection';
import { CustomProviderModelCard } from './CustomProviderModelCard';
import {
  ProviderSaveBar,
  secondaryButtonClassName,
} from './providerSettingsUi';
import type {
  CustomModelConfig,
  CustomProviderEntry,
  CustomProviderProbeRequest,
  ModelInfo,
} from '@/lib/cliConfigTypes';
import {
  createEmptyCustomProviderEntry,
  DEFAULT_CUSTOM_PROVIDER_NPM,
  isMaskedSecret,
  normalizeCustomProviderEntry,
  trimToNull,
} from '@/lib/cliConfigTypes';

type CustomProviderEditorProps = {
  initialProvider: CustomProviderEntry | null;
  mode: 'create' | 'edit';
  onSaved: (providerId: string) => Promise<void> | void;
};

export type ModelDraft = {
  contextLimit: string;
  id: string;
  inputText: boolean;
  inputImage: boolean;
  key: string;
  name: string;
  options: Record<string, unknown> | null;
  outputLimit: string;
  outputText: boolean;
  outputImage: boolean;
  thinkingBudget: string;
  thinkingEnabled: boolean;
};

type FormState = {
  apiKey: string;
  baseURL: string;
  id: string;
  models: ModelDraft[];
  name: string;
  npm: string;
  timeout: string;
};

type StatusState = {
  message: string;
  tone: 'error' | 'success' | 'warning';
} | null;

type ModelTestStatusState = {
  message: string;
  tone: 'error' | 'success';
} | null;
let modelKeyCounter = 0;

function nextModelKey() {
  modelKeyCounter += 1;
  return `custom-model-${modelKeyCounter}`;
}

function emptyModelDraft(model?: ModelInfo): ModelDraft {
  return {
    contextLimit: '',
    id: model?.id ?? '',
    inputText: true,
    inputImage: false,
    key: nextModelKey(),
    name: model?.name || model?.id || '',
    options: null,
    outputLimit: '',
    outputText: true,
    outputImage: false,
    thinkingBudget: '9216',
    thinkingEnabled: true,
  };
}

function extractThinking(options: Record<string, unknown> | null) {
  const thinking =
    options && typeof options.thinking === 'object' && options.thinking
      ? (options.thinking as Record<string, unknown>)
      : null;
  if (!thinking || thinking.type !== 'enabled') {
    return { thinkingBudget: '', thinkingEnabled: false };
  }
  return {
    thinkingBudget:
      typeof thinking.budgetTokens === 'number'
        ? String(thinking.budgetTokens)
        : '',
    thinkingEnabled: true,
  };
}

function modelToDraft(id: string, model: CustomModelConfig): ModelDraft {
  const thinking = extractThinking(model.options);
  return {
    contextLimit: model.limit?.context == null ? '' : String(model.limit.context),
    id,
    inputText: model.modalities?.input?.includes('text') ?? true,
    inputImage: model.modalities?.input?.includes('image') ?? false,
    key: nextModelKey(),
    name: model.name ?? '',
    options: model.options ?? null,
    outputLimit: model.limit?.output == null ? '' : String(model.limit.output),
    outputText: model.modalities?.output?.includes('text') ?? true,
    outputImage: model.modalities?.output?.includes('image') ?? false,
    thinkingBudget: thinking.thinkingBudget,
    thinkingEnabled: thinking.thinkingEnabled,
  };
}

function createFormState(provider: CustomProviderEntry | null): FormState {
  const entry = provider ?? createEmptyCustomProviderEntry();
  return {
    apiKey: entry.options.api_key ?? '',
    baseURL: entry.options.baseURL ?? '',
    id: entry.id,
    models: Object.entries(entry.models ?? {}).map(([id, model]) =>
      modelToDraft(id, model),
    ),
    name: entry.name ?? '',
    npm: entry.npm ?? DEFAULT_CUSTOM_PROVIDER_NPM,
    timeout: entry.options.timeout == null ? '' : String(entry.options.timeout),
  };
}

function parseInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('invalid-number');
  }
  return parsed;
}

function selectedModalities(text: boolean, image: boolean): string[] | null {
  const values = [text ? 'text' : null, image ? 'image' : null].filter(
    Boolean,
  ) as string[];
  return values.length > 0 ? values : null;
}

function modelOptions(model: ModelDraft): Record<string, unknown> | null {
  const base = Object.fromEntries(
    Object.entries(model.options ?? {}).filter(([key]) => key !== 'thinking'),
  );
  if (!model.thinkingEnabled) {
    return Object.keys(base).length > 0 ? base : null;
  }
  const budget = parseInteger(model.thinkingBudget);
  if (budget == null) throw new Error('thinking-budget-required');
  return {
    ...base,
    thinking: {
      type: 'enabled',
      budgetTokens: budget,
    },
  };
}

function buildProvider(formState: FormState): CustomProviderEntry {
  const models = formState.models.reduce<Record<string, CustomModelConfig>>(
    (acc, model) => {
      const id = model.id.trim();
      if (!id) throw new Error('model-id-required');
      acc[id] = {
        name: trimToNull(model.name),
        modalities: {
          input: selectedModalities(model.inputText, model.inputImage),
          output: selectedModalities(model.outputText, model.outputImage),
        },
        options: modelOptions(model),
        limit: {
          context: parseInteger(model.contextLimit),
          output: parseInteger(model.outputLimit),
        },
      };
      return acc;
    },
    {},
  );

  return normalizeCustomProviderEntry({
    id: formState.id,
    name: formState.name,
    npm: formState.npm,
    options: {
      api_key: isMaskedSecret(formState.apiKey)
        ? formState.apiKey
        : trimToNull(formState.apiKey),
      baseURL: trimToNull(formState.baseURL),
      timeout: parseInteger(formState.timeout),
    },
    models,
  });
}

function StatusMessage({ status }: { status: StatusState }) {
  if (!status) return null;
  const className =
    status.tone === 'success'
      ? 'provider-status-message-success'
      : status.tone === 'warning'
        ? 'provider-status-message-warning'
        : 'provider-status-message-error';
  return (
    <div className={`provider-status-message ${className}`} role="status">
      {status.message}
    </div>
  );
}

function ModelTestStatusMessage({
  status,
}: {
  status: ModelTestStatusState;
}) {
  if (!status) return null;
  const className =
    status.tone === 'success'
      ? 'provider-model-test-status-success'
      : 'provider-model-test-status-error';
  return (
    <div
      className={`provider-model-test-status ${className}`}
      role="status"
    >
      {status.message}
    </div>
  );
}

export function CustomProviderEditor({
  initialProvider,
  mode,
  onSaved,
}: CustomProviderEditorProps) {
  const { t, showToast } = useWorkspace();
  const [formState, setFormState] = useState(() =>
    createFormState(initialProvider),
  );
  const [savedFormState, setSavedFormState] = useState<FormState | null>(null);
  const [status, setStatus] = useState<StatusState>(null);
  const [modelTestStatus, setModelTestStatus] =
    useState<ModelTestStatusState>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(mode === 'create');

  const copy = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  useEffect(() => {
    const nextFormState = createFormState(initialProvider);
    setFormState(nextFormState);
    setSavedFormState(nextFormState);
    setStatus(null);
    setModelTestStatus(null);
    setBusyAction(null);
    setConfirmingDelete(false);
    setDetailsExpanded(mode === 'create');
  }, [initialProvider, mode]);

  const existingModelIds = useMemo(
    () =>
      new Set(
        formState.models.map((model) => model.id.trim()).filter(Boolean),
      ),
    [formState.models],
  );
  const isDirty =
    savedFormState != null &&
    JSON.stringify(formState) !== JSON.stringify(savedFormState);

  const updateForm = (updater: (current: FormState) => FormState) => {
    setFormState((current) => updater(current));
    setStatus(null);
    setModelTestStatus(null);
  };

  const updateModel = (
    key: string,
    updater: (current: ModelDraft) => ModelDraft,
  ) => {
    updateForm((current) => ({
      ...current,
      models: current.models.map((model) =>
        model.key === key ? updater(model) : model,
      ),
    }));
  };

  const buildProbeRequest = (modelId?: string): CustomProviderProbeRequest => ({
    id: formState.id.trim(),
    model_id: trimToNull(modelId),
    npm: trimToNull(formState.npm),
    options: {
      api_key: isMaskedSecret(formState.apiKey)
        ? null
        : trimToNull(formState.apiKey),
      baseURL: trimToNull(formState.baseURL),
      timeout: parseInteger(formState.timeout),
    },
  });

  const handleDiscoverModels = async () => {
    if (!trimToNull(formState.baseURL)) {
      setStatus({
        message: copy(
          'settings.providers.custom.baseUrlRequired',
          'Base URL is required before discovering models.',
        ),
        tone: 'error',
      });
      return;
    }
    setBusyAction('discover');
    try {
      const response = await cliConfigApi.probeCustomProviderModels(
        buildProbeRequest(),
      );
      if (response.status === 'unsupported') {
        setStatus({ message: response.message, tone: 'warning' });
        return;
      }
      if (!response.valid) {
        setStatus({ message: response.message, tone: 'error' });
        return;
      }
      const nextModels = response.models
        .filter((model) => model.id.trim() && !existingModelIds.has(model.id))
        .map(emptyModelDraft);
      updateForm((current) => ({
        ...current,
        models: [...current.models, ...nextModels],
      }));
      setStatus({
        message: copy(
          'settings.providers.custom.discoverSuccess',
          'Models discovered.',
        ),
        tone: 'success',
      });
    } catch (error) {
      setStatus({
        message:
          error instanceof Error
            ? error.message
            : copy(
                'settings.providers.custom.discoverFailed',
                'Model discovery failed.',
              ),
        tone: 'error',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleValidateModel = async (model: ModelDraft) => {
    const modelId = trimToNull(model.id);
    if (!modelId) {
      setModelTestStatus({
        message: copy(
          'settings.providers.custom.modelIdRequired',
          'Model ID is required.',
        ),
        tone: 'error',
      });
      return;
    }
    setModelTestStatus(null);
    setBusyAction(`test-${model.key}`);
    try {
      const response = await cliConfigApi.validateCustomProvider(
        buildProbeRequest(modelId),
      );
      setModelTestStatus({
        message: response.message,
        tone: response.valid ? 'success' : 'error',
      });
    } catch (error) {
      setModelTestStatus({
        message:
          error instanceof Error
            ? error.message
            : copy(
                'settings.providers.custom.modelTestFailed',
                'Model test failed.',
              ),
        tone: 'error',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSave = async () => {
    setBusyAction('save');
    try {
      const provider = buildProvider(formState);
      if (!provider.id) {
        throw new Error(copy('settings.providers.custom.idRequired', 'Provider ID is required.'));
      }
      if (!provider.options.baseURL) {
        throw new Error(
          copy(
            'settings.providers.custom.baseUrlRequired',
            'Base URL is required.',
          ),
        );
      }
      const saved =
        mode === 'create'
          ? await cliConfigApi.createCustomProvider(provider)
          : await cliConfigApi.updateCustomProvider(provider.id, provider);
      setStatus({
        message: copy(
          'settings.providers.custom.saved',
          'Custom provider saved.',
        ),
        tone: 'success',
      });
      showToast(
        copy('settings.providers.custom.saved', 'Custom provider saved.'),
        'success',
      );
      setSavedFormState(formState);
      await onSaved(saved.id);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : copy(
              'settings.providers.custom.saveFailed',
              'Failed to save custom provider.',
            );
      setStatus({
        message: errorMessage,
        tone: 'error',
      });
      showToast(errorMessage, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async () => {
    if (!initialProvider) return;
    setBusyAction('delete');
    try {
      await cliConfigApi.deleteCustomProvider(initialProvider.id);
      setStatus({
        message: copy(
          'settings.providers.custom.deleted',
          'Custom provider deleted.',
        ),
        tone: 'success',
      });
      await onSaved('anthropic');
    } catch (error) {
      setStatus({
        message:
          error instanceof Error
            ? error.message
            : copy(
                'settings.providers.custom.deleteFailed',
                'Failed to delete custom provider.',
              ),
        tone: 'error',
      });
      setConfirmingDelete(false);
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyApiKey = async () => {
    try {
      await navigator.clipboard.writeText(formState.apiKey);
      showToast(copy('settings.providers.apiKeyCopied', 'API key copied.'));
    } catch (error) {
      setStatus({
        message:
          error instanceof Error
            ? error.message
            : copy('settings.providers.copyFailed', 'Failed to copy value.'),
        tone: 'error',
      });
    }
  };

  const isBusy = busyAction != null;
  const canDelete = mode === 'edit' && initialProvider != null;
  const handleDiscard = () => {
    if (!savedFormState) return;
    setFormState(savedFormState);
    setStatus(null);
    setModelTestStatus(null);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') {
        return;
      }
      event.preventDefault();
      if (!isBusy && isDirty) void handleSave();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBusy, isDirty, handleSave]);

  const connectionActions = canDelete ? (
      <button
        type="button"
        className="provider-header-icon-button provider-header-delete-button"
        onClick={() => setConfirmingDelete(true)}
        disabled={isBusy}
        aria-label={copy('delete', 'Delete')}
        title={copy('delete', 'Delete')}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    ) : null;

  return (
    <>
      <div className="provider-editor-shell">
        <div className="provider-editor-content space-y-7">
          <StatusMessage status={status} />

          <CustomProviderConnectionSection
            actions={connectionActions}
            copy={copy}
            detailsExpanded={detailsExpanded}
            mode={mode}
            values={{
              apiKey: formState.apiKey,
              baseURL: formState.baseURL,
              id: formState.id,
              name: formState.name,
              npm: formState.npm,
              timeout: formState.timeout,
            }}
            onChange={(field, value) =>
              updateForm((current) => ({ ...current, [field]: value }))
            }
            onCopyApiKey={handleCopyApiKey}
            onToggleDetails={() => setDetailsExpanded((current) => !current)}
          />

        <section className="provider-section-card provider-section-card-models space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-[var(--ink)]">
                {copy('settings.providers.custom.models', 'Models')}
              </h4>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={secondaryButtonClassName}
                onClick={handleDiscoverModels}
                disabled={isBusy}
              >
                {busyAction === 'discover' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {copy('settings.providers.custom.discover', 'Discover')}
              </button>
              <button
                type="button"
                className={secondaryButtonClassName}
                onClick={() =>
                  updateForm((current) => ({
                    ...current,
                    models: [...current.models, emptyModelDraft()],
                  }))
                }
                disabled={isBusy}
              >
                <Plus className="h-3.5 w-3.5" />
                {copy('settings.providers.custom.addModel', 'Add model')}
              </button>
            </div>
          </div>

          <ModelTestStatusMessage status={modelTestStatus} />

          <div className="provider-model-list">
            {formState.models.length === 0 ? (
              <div className="p-4 text-sm text-[var(--ink-tertiary)]">
                {copy(
                  'settings.providers.custom.noModels',
                  'No models configured yet.',
                )}
              </div>
            ) : (
              <div className="divide-y divide-[var(--hairline)]">
                {formState.models.map((model) => (
                  <CustomProviderModelCard
                    key={model.key}
                    busyAction={busyAction}
                    copy={copy}
                    isBusy={isBusy}
                    model={model}
                    onRemove={() =>
                      updateForm((current) => ({
                        ...current,
                        models: current.models.filter(
                          (entry) => entry.key !== model.key,
                        ),
                      }))
                    }
                    onTest={() => handleValidateModel(model)}
                    onUpdate={(updater) => updateModel(model.key, updater)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
        </div>
        {isDirty ? (
          <ProviderSaveBar
            disabled={isBusy}
            isSaving={busyAction === 'save'}
            onDiscard={handleDiscard}
            onSave={() => void handleSave()}
            discardLabel={copy('settings.providers.discardChanges', '放弃')}
            saveLabel={copy('settings.providers.saveChanges', 'Save changes')}
            savingLabel={copy('settings.providers.saving', 'Saving...')}
          />
        ) : null}
      </div>
      {confirmingDelete && initialProvider ? (
        <ConfirmationDialog
          idPrefix="custom-provider-delete-dialog"
          tone="danger"
          title={copy(
            'settings.providers.custom.deleteConfirmTitle',
            'Delete custom provider?',
          )}
          description={
            <>
              {copy(
                'settings.providers.custom.deleteConfirmDescription',
                'This will remove the provider configuration and its models.',
              )}{' '}
              <span className="font-medium text-[var(--ink)]">
                {initialProvider.name || initialProvider.id}
              </span>
            </>
          }
          confirmLabel={copy('delete', 'Delete')}
          cancelLabel={copy('cancel', 'Cancel')}
          escLabel={copy('escToCancel', 'Esc to cancel')}
          confirming={busyAction === 'delete'}
          confirmIcon={
            busyAction === 'delete' ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Trash2 />
            )
          }
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void handleDelete()}
        />
      ) : null}
    </>
  );
}
