import { useEffect } from 'react';
import { Loader2, Save } from 'lucide-react';
import type {
  BuiltInProviderId,
  CliConfig,
  ProviderCredentials,
} from '@/lib/cliConfigTypes';
import {
  createEmptyOllamaConfig,
  createEmptyProviderCredentials,
  isMaskedSecret,
} from '@/lib/cliConfigTypes';
import {
  Field,
  technicalInputClassName,
} from './providerSettingsUi';

type StatusState = {
  message: string;
  tone: 'error' | 'success';
} | null;

function StatusMessage({ status }: { status: StatusState }) {
  if (!status) return null;
  const className =
    status.tone === 'success'
      ? 'provider-status-message-success'
      : 'provider-status-message-error';
  return (
    <div className={`provider-status-message ${className}`} role="status">
      {status.message}
    </div>
  );
}

function getProviderCredentials(
  config: CliConfig,
  provider: BuiltInProviderId,
): ProviderCredentials {
  if (provider === 'ollama') {
    return {
      api_key: null,
      endpoint: config.provider.ollama?.endpoint ?? '',
    };
  }
  return config.provider[provider] ?? createEmptyProviderCredentials();
}

function setProviderApiKey(
  config: CliConfig,
  provider: BuiltInProviderId,
  value: string,
) {
  if (provider === 'ollama') return;
  config.provider[provider] = {
    ...(config.provider[provider] ?? createEmptyProviderCredentials()),
    api_key: value === '' ? null : value,
  };
}

function setProviderEndpoint(
  config: CliConfig,
  provider: BuiltInProviderId,
  value: string,
) {
  const normalized = value === '' ? null : value;
  if (provider === 'ollama') {
    config.provider.ollama = {
      ...(config.provider.ollama ?? createEmptyOllamaConfig()),
      endpoint: normalized,
    };
    return;
  }
  config.provider[provider] = {
    ...(config.provider[provider] ?? createEmptyProviderCredentials()),
    endpoint: normalized,
  };
}

export function BuiltInProviderEditor({
  busyAction,
  config,
  copy,
  isBusy,
  onSave,
  provider,
  status,
  setConfig,
}: {
  busyAction: string | null;
  config: CliConfig;
  copy: (key: string, fallback: string) => string;
  isBusy: boolean;
  onSave: () => void;
  provider: BuiltInProviderId;
  status: StatusState;
  setConfig: (updater: (draft: CliConfig) => void) => void;
}) {
  const credentials = getProviderCredentials(config, provider);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') {
        return;
      }
      event.preventDefault();
      if (!isBusy) onSave();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBusy, onSave]);

  return (
    <div className="provider-editor-shell">
      <div className="provider-editor-content space-y-6">
        <StatusMessage status={status} />

        <section className="provider-section-card provider-section-card-connection space-y-4">
          <div className="provider-section-heading">
            <h4 className="text-sm font-semibold text-[var(--ink)]">
              {copy('settings.providers.custom.connection', 'Connection')}
            </h4>
            <div className="provider-section-actions">
              <button
                type="button"
                className="provider-header-icon-button provider-header-save-button"
                onClick={onSave}
                disabled={isBusy}
                aria-label={copy('save', 'Save')}
                title={copy('save', 'Save')}
              >
                {busyAction === 'save' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          <div className="provider-property-list">
            {provider !== 'ollama' ? (
              <Field
                label={copy('settings.providers.apiKey', 'API key')}
                description={
                  credentials.api_key && isMaskedSecret(credentials.api_key)
                    ? copy(
                        'settings.providers.maskedKey',
                        'A saved key is masked by the backend.',
                      )
                    : undefined
                }
              >
                <input
                  className={technicalInputClassName}
                  type="password"
                  value={credentials.api_key ?? ''}
                  onChange={(event) =>
                    setConfig((draft) =>
                      setProviderApiKey(draft, provider, event.target.value),
                    )
                  }
                  placeholder="sk-..."
                />
              </Field>
            ) : null}

            <Field
              label={copy('settings.providers.endpoint', 'Endpoint')}
              description={copy(
                'settings.providers.endpointDesc',
                'Leave blank to use the backend default endpoint.',
              )}
            >
              <input
                className={technicalInputClassName}
                value={credentials.endpoint ?? ''}
                onChange={(event) =>
                  setConfig((draft) =>
                    setProviderEndpoint(draft, provider, event.target.value),
                  )
                }
                placeholder={
                  provider === 'ollama'
                    ? 'http://localhost:11434/'
                    : 'https://api.example.com/v1/'
                }
              />
            </Field>
          </div>
        </section>
      </div>
    </div>
  );
}
