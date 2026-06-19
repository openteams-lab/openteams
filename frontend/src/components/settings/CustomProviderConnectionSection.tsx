import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Bot,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Orbit,
  Network,
  RadioTower,
  Search,
  Sparkles,
  Zap,
} from 'lucide-react';
import { DEFAULT_CUSTOM_PROVIDER_NPM } from '@/lib/cliConfigTypes';
import {
  Field,
  inputClassName,
  technicalInputClassName,
} from './providerSettingsUi';

type ConnectionValues = {
  apiKey: string;
  baseURL: string;
  id: string;
  name: string;
  npm: string;
  timeout: string;
};

type ConnectionField = keyof ConnectionValues;

type PackageOption = {
  description: string;
  icon: ReactNode;
  id: string;
  label: string;
  placeholder: string;
};

const packageOptions: PackageOption[] = [
  {
    description: 'OpenAI-compatible endpoint',
    icon: <Network className="h-3.5 w-3.5" />,
    id: DEFAULT_CUSTOM_PROVIDER_NPM,
    label: 'OpenAI Compatible',
    placeholder: 'https://api.example.com/v1',
  },
  {
    description: 'Official OpenAI provider',
    icon: <Bot className="h-3.5 w-3.5" />,
    id: '@ai-sdk/openai',
    label: 'OpenAI',
    placeholder: 'https://api.openai.com/v1',
  },
  {
    description: 'Official Anthropic provider',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    id: '@ai-sdk/anthropic',
    label: 'Anthropic',
    placeholder: 'https://api.anthropic.com',
  },
  {
    description: 'Official Google provider',
    icon: <Search className="h-3.5 w-3.5" />,
    id: '@ai-sdk/google',
    label: 'Google',
    placeholder: 'https://generativelanguage.googleapis.com/v1beta',
  },
  {
    description: 'DeepInfra OpenAI-compatible models',
    icon: <Network className="h-3.5 w-3.5" />,
    id: '@ai-sdk/deepinfra',
    label: 'DeepInfra',
    placeholder: 'https://api.deepinfra.com/v1/openai',
  },
  {
    description: 'Groq OpenAI-compatible models',
    icon: <Zap className="h-3.5 w-3.5" />,
    id: '@ai-sdk/groq',
    label: 'Groq',
    placeholder: 'https://api.groq.com/openai/v1',
  },
  {
    description: 'Perplexity OpenAI-compatible models',
    icon: <Search className="h-3.5 w-3.5" />,
    id: '@ai-sdk/perplexity',
    label: 'Perplexity',
    placeholder: 'https://api.perplexity.ai',
  },
  {
    description: 'Together.ai OpenAI-compatible models',
    icon: <RadioTower className="h-3.5 w-3.5" />,
    id: '@ai-sdk/togetherai',
    label: 'Together.ai',
    placeholder: 'https://api.together.xyz/v1',
  },
  {
    description: 'xAI OpenAI-compatible models',
    icon: <Orbit className="h-3.5 w-3.5" />,
    id: '@ai-sdk/xai',
    label: 'xAI',
    placeholder: 'https://api.x.ai/v1',
  },
  {
    description: 'OpenRouter community provider',
    icon: <Network className="h-3.5 w-3.5" />,
    id: '@openrouter/ai-sdk-provider',
    label: 'OpenRouter',
    placeholder: 'https://openrouter.ai/api/v1',
  },
];

export function CustomProviderConnectionSection({
  actions,
  copy,
  detailsExpanded,
  mode,
  onChange,
  onCopyApiKey,
  onToggleDetails,
  values,
}: {
  actions?: ReactNode;
  copy: (key: string, fallback: string) => string;
  detailsExpanded: boolean;
  mode: 'create' | 'edit';
  onChange: (field: ConnectionField, value: string) => void;
  onCopyApiKey: () => void;
  onToggleDetails: () => void;
  values: ConnectionValues;
}) {
  const [packageMenuOpen, setPackageMenuOpen] = useState(false);
  const [packageQuery, setPackageQuery] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const selectedPackage = useMemo(
    () =>
      packageOptions.find((option) => option.id === values.npm) ?? {
        description: values.npm || 'Custom package',
        icon: <Network className="h-3.5 w-3.5" />,
        id: values.npm,
        label: values.npm || 'Custom package',
        placeholder: 'https://api.example.com/v1',
      },
    [values.npm],
  );
  const filteredPackageOptions = useMemo(() => {
    const query = packageQuery.trim().toLowerCase();
    if (!query) return packageOptions;
    return packageOptions.filter((option) =>
      [option.description, option.id, option.label]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [packageQuery]);

  return (
    <section className="provider-section-card provider-section-card-connection space-y-4">
      <div className="provider-section-heading">
        <h4 className="text-sm font-semibold text-[var(--ink)]">
          {copy('settings.providers.custom.connection', 'Connection')}
        </h4>
        {actions ? (
          <div className="provider-section-actions">{actions}</div>
        ) : null}
      </div>

      <div className="provider-core-card provider-connection-fields">
        <div className="grid gap-x-8 gap-y-0 lg:gap-x-10 sm:grid-cols-2">
          <div className="provider-property-row">
            <span className="provider-property-label">
              {copy('settings.providers.custom.id', 'Provider ID')}
            </span>
            <input
              className={`${technicalInputClassName} ${
                mode === 'edit' ? 'opacity-55' : ''
              }`}
              disabled={mode === 'edit'}
              value={values.id}
              onChange={(event) => onChange('id', event.target.value)}
              placeholder="deepseek-coder"
            />
          </div>
          <div className="provider-property-row">
            <span className="provider-property-label">
              {copy('settings.providers.custom.name', 'Display name')}
            </span>
            <input
              className={inputClassName}
              value={values.name}
              onChange={(event) => onChange('name', event.target.value)}
              placeholder="DeepSeek"
            />
          </div>
        </div>

        <div className="provider-property-row provider-property-row-spaced">
          <span className="provider-property-label">
            {copy('settings.providers.custom.sdk', 'SDK')}
          </span>
          <div className="relative min-w-0 w-full">
            <button
              type="button"
              className="provider-package-select"
              onClick={() => {
                setPackageQuery('');
                setPackageMenuOpen((current) => !current);
              }}
              aria-expanded={packageMenuOpen}
            >
              <span className="provider-package-icon">{selectedPackage.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="provider-package-select-title block truncate text-[var(--ink)]">
                  {selectedPackage.label}
                </span>
                <span className="provider-package-select-id block truncate font-mono text-[var(--ink-tertiary)]">
                  {selectedPackage.id}
                </span>
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-[var(--ink-tertiary)] transition-transform ${
                  packageMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {packageMenuOpen ? (
              <div className="provider-package-menu">
                <div className="provider-package-search">
                  <Search className="h-3.5 w-3.5 shrink-0" />
                  <input
                    autoFocus
                    value={packageQuery}
                    onChange={(event) => setPackageQuery(event.target.value)}
                    placeholder={copy(
                      'settings.providers.custom.sdkSearch',
                      'Search SDK',
                    )}
                  />
                </div>

                <div className="provider-package-options">
                  {filteredPackageOptions.length === 0 ? (
                    <div className="provider-package-empty">
                      {copy(
                        'settings.providers.custom.noSdkResults',
                        'No SDKs found.',
                      )}
                    </div>
                  ) : null}
                  {filteredPackageOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="provider-package-option"
                      onClick={() => {
                        onChange('npm', option.id);
                        setPackageQuery('');
                        setPackageMenuOpen(false);
                      }}
                    >
                      <span className="provider-package-icon">{option.icon}</span>
                      <span className="min-w-0">
                        <span className="provider-package-option-title block text-[var(--ink)]">
                          {option.label}
                        </span>
                        <span className="provider-package-option-description block text-[var(--ink-tertiary)]">
                          {option.description}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="provider-property-row">
          <span className="provider-property-label">
            {copy('settings.providers.custom.baseUrl', 'Base URL')}
          </span>
          <input
            className={technicalInputClassName}
            value={values.baseURL}
            onChange={(event) => onChange('baseURL', event.target.value)}
            placeholder={selectedPackage.placeholder}
          />
        </div>

        <div className="provider-property-row">
          <span className="provider-property-label">
            {copy('settings.providers.custom.apiKey', 'API key')}
          </span>
          <div className="provider-secret-control min-w-0 w-full">
            <input
              className={`${technicalInputClassName} pr-14`}
              type={showApiKey ? 'text' : 'password'}
              value={values.apiKey}
              onChange={(event) => onChange('apiKey', event.target.value)}
              placeholder="sk-..."
            />
            <div className="provider-secret-actions">
              <button
                type="button"
                onClick={() => setShowApiKey((current) => !current)}
                aria-label={showApiKey ? copy('hide', 'Hide') : copy('show', 'Show')}
                title={showApiKey ? copy('hide', 'Hide') : copy('show', 'Show')}
              >
                {showApiKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={onCopyApiKey}
                aria-label={copy('copy', 'Copy')}
                title={copy('copy', 'Copy')}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="provider-connection-details">
          <button
            type="button"
            className="provider-inline-toggle"
            onClick={onToggleDetails}
            aria-expanded={detailsExpanded}
          >
            <span className="font-medium text-[var(--ink-subtle)]">
              {copy(
                'settings.providers.custom.details',
                'Configuration details',
              )}
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-[var(--ink-tertiary)] transition-transform ${
                detailsExpanded ? '' : '-rotate-90'
              }`}
            />
          </button>

          {detailsExpanded ? (
            <div className="provider-property-list">
              <Field label={copy('settings.providers.custom.timeout', 'Timeout')}>
                <input
                  className={technicalInputClassName}
                  min="0"
                  type="number"
                  value={values.timeout}
                  onChange={(event) => onChange('timeout', event.target.value)}
                  placeholder="60000"
                />
              </Field>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
