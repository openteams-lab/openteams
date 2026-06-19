import { useState } from 'react';
import {
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Loader2,
  Trash2,
  WifiCog,
} from 'lucide-react';
import type { ModelDraft } from './CustomProviderEditor';
import {
  Field,
  inputClassName,
  technicalInputClassName,
} from './providerSettingsUi';

type CustomProviderModelCardProps = {
  busyAction: string | null;
  copy: (key: string, fallback: string) => string;
  isBusy: boolean;
  model: ModelDraft;
  onRemove: () => void;
  onTest: () => void;
  onUpdate: (updater: (current: ModelDraft) => ModelDraft) => void;
};

export function CustomProviderModelCard({
  busyAction,
  copy,
  isBusy,
  model,
  onRemove,
  onTest,
  onUpdate,
}: CustomProviderModelCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const modelId =
    model.id || model.name || copy('settings.providers.custom.newModel', 'New model');
  const contextLabel = formatLimit(model.contextLimit);
  const hasText = model.inputText || model.outputText;
  const hasImage = model.inputImage || model.outputImage;

  return (
    <div className="provider-model-item group bg-transparent">
      <div className="provider-model-row">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)] transition-transform ${
              expanded ? '' : '-rotate-90'
            }`}
          />
          <span className="provider-active-dot h-1.5 w-1.5 shrink-0 rounded-full" />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold text-[var(--ink)]">
            {modelId}
          </span>
          <span className="provider-model-limit hidden sm:inline-flex">
            {contextLabel}
          </span>
          <span className="hidden shrink-0 items-center gap-1 sm:flex">
            {hasText ? (
              <span className="provider-model-modality" title="Text">
                <FileText className="h-3 w-3" />
              </span>
            ) : null}
            {hasImage ? (
              <span className="provider-model-modality" title="Image">
                <ImageIcon className="h-3 w-3" />
              </span>
            ) : null}
          </span>
        </button>

        <div className="provider-model-row-actions">
          <button
            type="button"
            className="provider-model-test-button"
            onClick={onTest}
            disabled={isBusy}
            aria-label={copy('settings.providers.custom.testModel', 'Test')}
            title={copy('settings.providers.custom.testModel', 'Test')}
          >
            {busyAction === `test-${model.key}` ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <WifiCog className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            className="provider-row-action provider-danger-icon-button"
            onClick={onRemove}
            disabled={isBusy}
            aria-label={copy('remove', 'Remove')}
            title={copy('remove', 'Remove')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-3 border-t border-[var(--hairline)] p-3">
          <div className="provider-property-list">
            <Field label={copy('settings.providers.custom.modelId', 'Model ID')}>
              <input
                className={technicalInputClassName}
                value={model.id}
                onChange={(event) =>
                  onUpdate((current) => ({ ...current, id: event.target.value }))
                }
                placeholder="gpt-4.1"
              />
            </Field>
            <Field
              label={copy('settings.providers.custom.modelName', 'Model name')}
            >
              <input
                className={inputClassName}
                value={model.name}
                onChange={(event) =>
                  onUpdate((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="GPT 4.1"
              />
            </Field>
            <div className="provider-property-row">
              <span className="provider-property-label">
                {copy('settings.providers.custom.modalities', 'Modalities')}
              </span>
              <div className="flex min-w-0 w-full flex-wrap gap-1.5">
                <ModelSwitch
                  checked={model.inputText}
                  disabled={isBusy}
                  label="Input text"
                  onChange={(checked) =>
                    onUpdate((current) => ({ ...current, inputText: checked }))
                  }
                />
                <ModelSwitch
                  checked={model.inputImage}
                  disabled={isBusy}
                  label="Input image"
                  onChange={(checked) =>
                    onUpdate((current) => ({ ...current, inputImage: checked }))
                  }
                />
                <ModelSwitch
                  checked={model.outputText}
                  disabled={isBusy}
                  label="Output text"
                  onChange={(checked) =>
                    onUpdate((current) => ({ ...current, outputText: checked }))
                  }
                />
                <ModelSwitch
                  checked={model.outputImage}
                  disabled={isBusy}
                  label="Output image"
                  onChange={(checked) =>
                    onUpdate((current) => ({ ...current, outputImage: checked }))
                  }
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            className="provider-inline-toggle"
            onClick={() => setAdvancedExpanded((current) => !current)}
            aria-expanded={advancedExpanded}
          >
            <span>
              <span className="block text-[13px] font-medium text-[var(--ink)]">
                {copy('settings.providers.custom.advanced', 'Advanced settings')}
              </span>
              <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[11px] text-[var(--ink-tertiary)]">
                {model.contextLimit ? <span>ctx:{model.contextLimit}</span> : null}
                {model.outputLimit ? <span>out:{model.outputLimit}</span> : null}
              </span>
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)] transition-transform ${
                advancedExpanded ? '' : '-rotate-90'
              }`}
            />
          </button>

          {advancedExpanded ? (
            <div className="provider-property-list">
              <Field
                label={copy(
                  'settings.providers.custom.contextLimit',
                  'Context limit',
                )}
              >
                <input
                  className={technicalInputClassName}
                  min="0"
                  type="number"
                  value={model.contextLimit}
                  onChange={(event) =>
                    onUpdate((current) => ({
                      ...current,
                      contextLimit: event.target.value,
                    }))
                  }
                  placeholder="262144"
                />
              </Field>
              <Field
                label={copy(
                  'settings.providers.custom.outputLimit',
                  'Output limit',
                )}
              >
                <input
                  className={technicalInputClassName}
                  min="0"
                  type="number"
                  value={model.outputLimit}
                  onChange={(event) =>
                    onUpdate((current) => ({
                      ...current,
                      outputLimit: event.target.value,
                    }))
                  }
                  placeholder="32768"
                />
              </Field>
              <div className="provider-property-row">
                <span className="provider-property-label">
                  {copy('settings.providers.custom.thinking', 'Thinking')}
                </span>
                <div className="flex min-w-0 w-full items-start justify-between gap-3">
                  <span className="text-[12px] leading-snug text-[var(--ink-tertiary)]">
                    {copy(
                      'settings.providers.custom.thinkingDesc',
                      'Adds a thinking option for models that support it.',
                    )}
                  </span>
                  <ThinkingToggle
                    checked={model.thinkingEnabled}
                    disabled={isBusy}
                    label={copy(
                      'settings.providers.custom.thinking',
                      'Enable thinking',
                    )}
                    onChange={(checked) =>
                      onUpdate((current) => ({
                        ...current,
                        thinkingEnabled: checked,
                        thinkingBudget: checked
                          ? current.thinkingBudget || '9216'
                          : '',
                      }))
                    }
                  />
                </div>
              </div>
              <Field
                label={copy(
                  'settings.providers.custom.thinkingBudget',
                  'Budget',
                )}
              >
                <input
                  className={technicalInputClassName}
                  disabled={!model.thinkingEnabled}
                  min="0"
                  type="number"
                  value={model.thinkingBudget}
                  onChange={(event) =>
                    onUpdate((current) => ({
                      ...current,
                      thinkingBudget: event.target.value,
                    }))
                  }
                  placeholder="9216"
                />
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatLimit(value: string) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 'ctx -';
  if (numericValue >= 1000) return `${Math.round(numericValue / 1000)}k`;
  return String(numericValue);
}

function ThinkingToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="provider-thinking-toggle"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-state={checked ? 'checked' : 'unchecked'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="provider-thinking-toggle-thumb" />
    </button>
  );
}

function ModelSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`inline-flex h-7 items-center gap-1.5 rounded-[6px] border px-2 font-mono text-[11px] transition-colors ${
        checked
          ? 'border-[var(--provider-border-strong)] bg-[var(--provider-control-hover)] text-[var(--ink)]'
          : 'border-[var(--provider-border-subtle)] text-[var(--ink-tertiary)] hover:border-[var(--provider-border-strong)] hover:text-[var(--ink-subtle)]'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <input
        checked={checked}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          checked ? 'bg-[var(--provider-focus)]' : 'bg-[var(--ink-tertiary)]'
        }`}
      />
      {label}
    </label>
  );
}
