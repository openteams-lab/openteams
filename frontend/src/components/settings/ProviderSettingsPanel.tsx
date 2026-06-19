import { useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Loader2,
  Plus,
  UserRoundCog,
  X,
} from 'lucide-react';
import { MeteorIcon } from '@phosphor-icons/react';
import {
  siAnthropic,
  siGoogle,
  siOllama,
  siOpenai,
} from 'simple-icons';
import type { SimpleIcon } from 'simple-icons';
import { ResourceStateNotice } from '@/components/ResourceState';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cliConfigApi } from '@/lib/cliConfigApi';
import type {
  BuiltInProviderId,
  CliConfig,
  CustomProviderEntry,
  ProviderCredentials,
  ProviderInfo,
} from '@/lib/cliConfigTypes';
import {
  BUILT_IN_PROVIDER_IDS,
  customProvidersListToRecord,
  isBuiltInProvider,
  trimToNull,
} from '@/lib/cliConfigTypes';
import { BuiltInProviderEditor } from './BuiltInProviderEditor';
import { CustomProviderEditor } from './CustomProviderEditor';
import { ShortcutHint } from './providerSettingsUi';

type SelectionId = string | '__new_custom__';

type StatusState = {
  message: string;
  tone: 'error' | 'success';
} | null;

type ProviderBrandIcon = Pick<SimpleIcon, 'path' | 'title'>;

const openRouterIconPath =
  'M16.804 1.957l7.22 4.105v.087L16.73 10.21l.017-2.117-.821-.03c-1.059-.028-1.611.002-2.268.11-1.064.175-2.038.577-3.147 1.352L8.345 11.03c-.284.195-.495.336-.68.455l-.515.322-.397.234.385.23.53.338c.476.314 1.17.796 2.701 1.866 1.11.775 2.083 1.177 3.147 1.352l.3.045c.694.091 1.375.094 2.825.033l.022-2.159 7.22 4.105v.087L16.589 22l.014-1.862-.635.022c-1.386.042-2.137.002-3.138-.162-1.694-.28-3.26-.926-4.881-2.059l-2.158-1.5a21.997 21.997 0 00-.755-.498l-.467-.28a55.927 55.927 0 00-.76-.43C2.908 14.73.563 14.116 0 14.116V9.888l.14.004c.564-.007 2.91-.622 3.809-1.124l1.016-.58.438-.274c.428-.28 1.072-.726 2.686-1.853 1.621-1.133 3.186-1.78 4.881-2.059 1.152-.19 1.974-.213 3.814-.138l.02-1.907z';

const miniMaxIconPath =
  'M16.278 2c1.156 0 2.093.927 2.093 2.07v12.501a.74.74 0 00.744.709.74.74 0 00.743-.709V9.099a2.06 2.06 0 012.071-2.049A2.06 2.06 0 0124 9.1v6.561a.649.649 0 01-.652.645.649.649 0 01-.653-.645V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v7.472a2.037 2.037 0 01-2.048 2.026 2.037 2.037 0 01-2.048-2.026v-12.5a.785.785 0 00-.788-.753.785.785 0 00-.789.752l-.001 15.904A2.037 2.037 0 0113.441 22a2.037 2.037 0 01-2.048-2.026V18.04c0-.356.292-.645.652-.645.36 0 .652.289.652.645v1.934c0 .263.142.506.372.638.23.131.514.131.744 0a.734.734 0 00.372-.638V4.07c0-1.143.937-2.07 2.093-2.07zm-5.674 0c1.156 0 2.093.927 2.093 2.07v11.523a.648.648 0 01-.652.645.648.648 0 01-.652-.645V4.07a.785.785 0 00-.789-.78.785.785 0 00-.789.78v14.013a2.06 2.06 0 01-2.07 2.048 2.06 2.06 0 01-2.071-2.048V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v3.8a2.06 2.06 0 01-2.071 2.049A2.06 2.06 0 010 12.9v-1.378c0-.357.292-.646.652-.646.36 0 .653.29.653.646V12.9c0 .418.343.757.766.757s.766-.339.766-.757V9.099a2.06 2.06 0 012.07-2.048 2.06 2.06 0 012.071 2.048v8.984c0 .419.343.758.767.758.423 0 .766-.339.766-.758V4.07c0-1.143.937-2.07 2.093-2.07z';

const providerBrandIcons: Partial<Record<BuiltInProviderId, ProviderBrandIcon>> =
  {
    anthropic: siAnthropic,
    google: siGoogle,
    minimax: { path: miniMaxIconPath, title: 'MiniMax' },
    ollama: siOllama,
    openai: siOpenai,
    openrouter: { path: openRouterIconPath, title: 'OpenRouter' },
  };

const DEFAULT_PROVIDER_OPTIONS: ProviderInfo[] = [
  { id: 'anthropic', name: 'Anthropic', configured: false },
  { id: 'openai', name: 'OpenAI', configured: false },
  { id: 'google', name: 'Google', configured: false },
  { id: 'openrouter', name: 'OpenRouter', configured: false },
  { id: 'minimax', name: 'MiniMax', configured: false },
  { id: 'ollama', name: 'Ollama', configured: false },
];

function cloneConfig(config: CliConfig): CliConfig {
  return JSON.parse(JSON.stringify(config)) as CliConfig;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function sanitizeCredentials(value: ProviderCredentials | null) {
  if (!value) return null;
  const next = {
    api_key: trimToNull(value.api_key),
    endpoint: trimToNull(value.endpoint),
  };
  return next.api_key || next.endpoint ? next : null;
}

function sanitizeConfig(config: CliConfig): CliConfig {
  const next = cloneConfig(config);
  next.model.default = next.model.default.trim();
  next.provider.anthropic = sanitizeCredentials(next.provider.anthropic);
  next.provider.openai = sanitizeCredentials(next.provider.openai);
  next.provider.google = sanitizeCredentials(next.provider.google);
  next.provider.openrouter = sanitizeCredentials(next.provider.openrouter);
  next.provider.minimax = sanitizeCredentials(next.provider.minimax);
  if (next.provider.ollama && !trimToNull(next.provider.ollama.endpoint)) {
    next.provider.ollama = null;
  }
  return next;
}

function builtInProviderSnapshot(
  config: CliConfig,
  provider: BuiltInProviderId,
) {
  if (provider === 'ollama') {
    return {
      endpoint: trimToNull(config.provider.ollama?.endpoint),
    };
  }

  return sanitizeCredentials(config.provider[provider]);
}

function isBuiltInProviderConfigDirty(
  config: CliConfig,
  savedConfig: CliConfig | null,
  provider: BuiltInProviderId,
) {
  if (!savedConfig) return false;
  return (
    JSON.stringify(builtInProviderSnapshot(config, provider)) !==
    JSON.stringify(builtInProviderSnapshot(savedConfig, provider))
  );
}

function StatusMessage({ status }: { status: StatusState }) {
  if (!status) return null;
  const className =
    status.tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
      : 'border-red-500/30 bg-red-500/10 text-red-500';
  return (
    <div className={`rounded-[6px] border px-3 py-2 text-[13px] ${className}`}>
      {status.message}
    </div>
  );
}

function BrandIcon({ icon }: { icon: ProviderBrandIcon }) {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="currentColor"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d={icon.path} />
    </svg>
  );
}

function ProviderIcon({ providerId }: { providerId: string }) {
  const brandIcon = isBuiltInProvider(providerId)
    ? providerBrandIcons[providerId]
    : null;

  if (brandIcon) {
    return <BrandIcon icon={brandIcon} />;
  }

  return <UserRoundCog className="h-4 w-4" strokeWidth={1.55} />;
}

export function ProviderSettingsPanel() {
  const { t, providersAsync, refreshProviders, showToast } = useWorkspace();
  const [config, setConfig] = useState<CliConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<CliConfig | null>(null);
  const [providerInfos, setProviderInfos] = useState<ProviderInfo[]>([]);
  const [customProviders, setCustomProviders] = useState<CustomProviderEntry[]>(
    [],
  );
  const [selectedId, setSelectedId] = useState<SelectionId | null>(null);
  const [status, setStatus] = useState<StatusState>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const copy = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const customProviderRecord = useMemo(
    () => customProvidersListToRecord(customProviders),
    [customProviders],
  );

  const providerRows = useMemo(() => {
    const builtIns =
      providerInfos.length > 0 ? providerInfos : DEFAULT_PROVIDER_OPTIONS;
    const normalizedBuiltIns = builtIns.filter((provider) =>
      BUILT_IN_PROVIDER_IDS.includes(provider.id as BuiltInProviderId),
    );
    return [
      ...normalizedBuiltIns.map((provider) => ({
        configured: provider.configured,
        id: provider.id,
        kind: 'built-in' as const,
        name: provider.name,
      })),
      ...customProviders.map((provider) => ({
        configured:
          !!trimToNull(provider.options.baseURL) ||
          Object.keys(provider.models ?? {}).length > 0,
        id: provider.id,
        kind: 'custom' as const,
        name: provider.name || provider.id,
      })),
    ];
  }, [customProviders, providerInfos]);

  const selectedCustomProvider =
    selectedId && selectedId !== '__new_custom__' && !isBuiltInProvider(selectedId)
      ? customProviderRecord?.[selectedId] ?? null
      : null;

  const activeProviderName =
    (selectedId &&
      providerRows.find((provider) => provider.id === selectedId)?.name) ??
    (selectedId === '__new_custom__'
      ? copy('settings.providers.custom.createTitle', 'New custom provider')
      : selectedId ?? '');

  const loadData = async (nextSelectedId?: string) => {
    setLoading(true);
    setStatus(null);
    try {
      const [nextConfig, nextProviders, nextCustomProviders] =
        await Promise.all([
          cliConfigApi.getConfig(),
          cliConfigApi.listProviders(),
          cliConfigApi.listCustomProviders(),
        ]);
      setConfig(nextConfig);
      setSavedConfig(cloneConfig(nextConfig));
      setProviderInfos(nextProviders);
      setCustomProviders(nextCustomProviders);
      setSelectedId(nextSelectedId ?? null);
      await refreshProviders();
    } catch (error) {
      setStatus({
        message: getErrorMessage(
          error,
          copy('resource.providers.error', 'Provider configuration failed to load.'),
        ),
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const updateConfig = (updater: (draft: CliConfig) => void) => {
    setConfig((current) => {
      if (!current) return current;
      const next = cloneConfig(current);
      next.provider.custom_providers = customProviderRecord;
      updater(next);
      return next;
    });
    setStatus(null);
  };

  const discardConfigChanges = () => {
    if (!savedConfig) return;
    setConfig(cloneConfig(savedConfig));
    setStatus(null);
  };

  const saveConfig = async (providerId: string) => {
    if (!config) return;
    setBusyAction('save');
    try {
      const next = sanitizeConfig(config);
      next.provider.custom_providers = customProviderRecord;
      const saved = await cliConfigApi.updateConfig(next);
      const defaultProviderId = next.provider.default;
      await cliConfigApi.syncToCli({
        custom_provider_id: isBuiltInProvider(defaultProviderId)
          ? null
          : defaultProviderId,
      });
      setConfig(saved);
      setSavedConfig(cloneConfig(saved));
      const successMessage = copy(
        'settings.providers.saved',
        'Provider configuration saved.',
      );
      setStatus({
        message: successMessage,
        tone: 'success',
      });
      showToast(successMessage, 'success');
      await loadData(providerId);
    } catch (error) {
      const errorMessage = getErrorMessage(
        error,
        copy(
          'settings.providers.saveFailed',
          'Failed to save provider configuration.',
        ),
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

  const copyProviderId = async (providerId: string) => {
    try {
      await navigator.clipboard.writeText(providerId);
      showToast(copy('settings.providers.idCopied', 'Provider ID copied.'));
    } catch (error) {
      setStatus({
        message: getErrorMessage(
          error,
          copy('settings.providers.copyFailed', 'Failed to copy provider ID.'),
        ),
        tone: 'error',
      });
    }
  };

  useEffect(() => {
    if (!selectedId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId]);

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--ink-subtle)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        {copy('resource.providers.loading', 'Loading providers...')}
      </div>
    );
  }

  const isBusy = busyAction != null;
  const configuredProviderCount = providerRows.filter(
    (provider) => provider.configured,
  ).length;
  const hasConfiguredProvider = configuredProviderCount > 0;
  const selectedBuiltInDirty =
    !!config &&
    selectedId != null &&
    isBuiltInProvider(selectedId) &&
    isBuiltInProviderConfigDirty(config, savedConfig, selectedId);

  return (
    <div className="provider-settings-panel h-full min-h-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-[var(--provider-heading)]">
            {copy('Providers', '大模型服务供应商')}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-[var(--provider-copy-dim)]">
            {copy(
              'keyStorageTip',
              '配置openteams内置Agent(openteams-cli)的大模型服务供应商，所有配置信息均保存在本地。',
            )}
          </p>
        </div>
      </div>

      <ResourceStateNotice
        resource={providersAsync}
        className="!text-sm [&_button]:!text-sm [&_p]:!text-sm"
        labels={{
          loading: copy('resource.providers.loading', 'Loading providers...'),
          empty: copy('resource.providers.empty', 'No providers configured.'),
          error: copy('resource.providers.error', 'Provider configuration failed.'),
          fallback: copy('resource.providers.fallback', 'Showing fallback providers.'),
        }}
        onRetry={() => void refreshProviders()}
      />
      {selectedId && isBuiltInProvider(selectedId) ? null : (
        <StatusMessage status={status} />
      )}

      <div
        className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_693px] xl:grid-cols-[minmax(0,1fr)_747px]"
      >
        <section className="provider-list-column min-w-0">
          <div className="provider-list-panel overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline)] px-4 py-3">
              <div>
                <h4 className="text-[15px] font-semibold text-[var(--provider-heading)]">
                  {copy(
                    'settings.providers.supportedModelProviders',
                    '支持的模型供应商',
                  )}
                </h4>
              </div>
              <span className="provider-status-inline provider-status-inline-active font-mono text-[12px]">
                <span className="provider-status-dot" />
                <span className="text-[var(--ink)]">
                  {configuredProviderCount}
                </span>
              </span>
            </div>

            <div className="provider-nav-list">
              {providerRows.length === 0 ? (
                <div className="p-4 text-sm text-[var(--ink-tertiary)]">
                  {copy(
                    'settings.providers.noConnected',
                    'No providers are connected.',
                  )}
                </div>
              ) : null}
              {providerRows.map((provider) => {
                return (
                  <div
                    key={provider.id}
                    className={`provider-nav-row group ${
                      selectedId === provider.id
                        ? 'provider-nav-row-selected'
                        : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="flex h-9 min-w-0 flex-1 items-center gap-2.5 px-3 text-left"
                      onClick={() => setSelectedId(provider.id)}
                    >
                      <span className="provider-logo-mark flex h-5 w-5 shrink-0 items-center justify-center text-[var(--ink-tertiary)] transition-colors group-hover:text-[var(--ink)] group-focus-within:text-[var(--ink)]">
                        <ProviderIcon providerId={provider.id} />
                      </span>

                      <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--ink-subtle)] transition-colors group-hover:text-[var(--ink-muted)] group-focus-within:text-[var(--ink-muted)]">
                        {provider.name}
                      </p>
                    </button>

                    <div className="flex shrink-0 items-center gap-2 pr-2">
                      <div className="provider-row-actions flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          className="provider-row-action"
                          onClick={() => void copyProviderId(provider.id)}
                          aria-label={copy(
                            'settings.providers.copyId',
                            'Copy provider ID',
                          )}
                          title={copy('settings.providers.copyId', 'Copy provider ID')}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <span
                        className={`provider-status-inline ${
                          provider.configured
                            ? 'provider-status-inline-active'
                            : 'provider-status-inline-muted'
                        }`}
                      >
                        <span className="provider-status-dot" />
                        <span>
                          {provider.configured
                            ? copy('connected', 'Connected')
                            : copy('disconnected', 'Unconfigured')}
                        </span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            className="provider-add-button"
            onClick={() => setSelectedId('__new_custom__')}
          >
            <Plus className="h-3.5 w-3.5" />
            {copy('addAnotherProvider', 'Add custom provider')}
          </button>
        </section>

        {selectedId ? (
          <aside className="provider-side-sheet min-w-0 p-4 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-96px)] lg:overflow-y-auto">
            <div className="mb-4 flex items-start justify-between gap-4 border-b border-[var(--hairline)] pb-3">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-[var(--provider-heading)]">
                  {activeProviderName}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <ShortcutHint>Esc</ShortcutHint>
                <button
                  type="button"
                  className="rounded-[6px] p-1.5 text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--provider-control-hover)] hover:text-[var(--ink)]"
                  onClick={() => setSelectedId(null)}
                  aria-label={copy('close', 'Close')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {selectedId === '__new_custom__' ? (
              <CustomProviderEditor
                initialProvider={null}
                mode="create"
                onSaved={(providerId) => loadData(providerId)}
              />
            ) : selectedCustomProvider ? (
              <CustomProviderEditor
                initialProvider={selectedCustomProvider}
                mode="edit"
                onSaved={(providerId) => loadData(providerId)}
              />
            ) : isBuiltInProvider(selectedId) ? (
              <BuiltInProviderEditor
                busyAction={busyAction}
                config={config}
                isBusy={isBusy}
                isDirty={selectedBuiltInDirty}
                provider={selectedId}
                status={status}
                setConfig={updateConfig}
                onDiscard={discardConfigChanges}
                onSave={() => saveConfig(selectedId)}
                copy={copy}
              />
            ) : (
              <div className="rounded-[6px] border border-dashed border-[var(--provider-border-subtle)] p-6 text-sm text-[var(--ink-tertiary)]">
                {copy('settings.providers.notFound', 'Provider not found.')}
              </div>
            )}
          </aside>
        ) : (
          <aside className="provider-empty-state min-w-0 p-6 lg:sticky lg:top-0">
            <div className="provider-empty-illustration" aria-hidden="true">
              <span className="provider-empty-node provider-empty-node-main">
                <MeteorIcon className="h-4 w-4" />
              </span>
              <span className="provider-empty-node provider-empty-node-top" />
              <span className="provider-empty-node provider-empty-node-bottom" />
            </div>
            <div className="mt-5 max-w-[28rem]">
              <p className="text-sm font-semibold text-[var(--ink)]">
                {hasConfiguredProvider
                  ? copy(
                      'settings.providers.emptySelectionTitle',
                      'No provider selected',
                    )
                  : copy(
                      'settings.providers.emptyStateTitle',
                      'No provider configured',
                    )}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-tertiary)]">
                {hasConfiguredProvider
                  ? copy(
                      'settings.providers.emptySelectionDesc',
                      'Choose a provider from the list to edit credentials, models, and defaults.',
                    )
                  : copy(
                      'settings.providers.emptyStateDesc',
                      'Start with a built-in provider or add a custom OpenAI-compatible endpoint.',
                    )}
              </p>
              <button
                type="button"
                className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--provider-border-subtle)] px-2.5 text-[13px] font-medium text-[var(--ink-subtle)] transition-colors hover:border-[var(--provider-border-strong)] hover:bg-[var(--provider-control-hover)] hover:text-[var(--ink)]"
                onClick={() => setSelectedId('__new_custom__')}
              >
                <Plus className="h-3.5 w-3.5" />
                {copy('addAnotherProvider', 'Add custom provider')}
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
