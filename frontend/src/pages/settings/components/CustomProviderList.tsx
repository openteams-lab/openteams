import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DEFAULT_CUSTOM_PROVIDER_NPM } from '@/types/cliConfig';
import type { CustomProviderEntry } from '@/types/cliConfig';

type CustomProviderListProps = {
  deletingProviderId: string | null;
  expandedProviderId: string | null;
  onCreate: () => void;
  onDelete: (provider: CustomProviderEntry) => void;
  onEdit: (provider: CustomProviderEntry) => void;
  onToggleExpanded: (providerId: string) => void;
  providers: CustomProviderEntry[];
};

function formatValue(value: number | string | null | undefined): string {
  if (value == null || value === '') {
    return '-';
  }

  return String(value);
}

function formatModalities(
  values: string[] | null | undefined,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!values || values.length === 0) {
    return t('settings.cli.customProviders.preview.none');
  }

  return values
    .map((value) =>
      t(`settings.cli.customProviders.form.modalities.${value}`, {
        defaultValue: value,
      })
    )
    .join(', ');
}

export function CustomProviderList({
  deletingProviderId,
  expandedProviderId,
  onCreate,
  onDelete,
  onEdit,
  onToggleExpanded,
  providers,
}: CustomProviderListProps) {
  const { t } = useTranslation('settings');

  if (providers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="font-medium">
          {t('settings.cli.customProviders.empty.title')}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('settings.cli.customProviders.empty.description')}
        </p>
        <Button className="mt-4" onClick={onCreate} type="button">
          <Plus className="mr-2 h-4 w-4" />
          {t('settings.cli.customProviders.actions.add')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {providers.map((provider) => {
        const isExpanded = expandedProviderId === provider.id;
        const models = Object.entries(provider.models ?? {}).sort(
          ([left], [right]) => left.localeCompare(right)
        );

        return (
          <div key={provider.id} className="rounded-lg border p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{provider.name || provider.id}</p>
                  <Badge variant="secondary">{provider.id}</Badge>
                  <Badge variant="outline">
                    {t('settings.cli.customProviders.list.modelsCount', {
                      count: models.length,
                    })}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {provider.options.baseURL ||
                    t('settings.cli.customProviders.list.noBaseUrl')}
                </p>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>
                    {t('settings.cli.customProviders.list.npm', {
                      npm: provider.npm || DEFAULT_CUSTOM_PROVIDER_NPM,
                    })}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => onToggleExpanded(provider.id)}
                  type="button"
                  variant="outline"
                >
                  {isExpanded ? (
                    <ChevronUp className="mr-2 h-4 w-4" />
                  ) : (
                    <ChevronDown className="mr-2 h-4 w-4" />
                  )}
                  {isExpanded
                    ? t('settings.cli.customProviders.actions.hideModels')
                    : t('settings.cli.customProviders.actions.showModels')}
                </Button>
                <Button
                  onClick={() => onEdit(provider)}
                  type="button"
                  variant="outline"
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  {t('settings.cli.customProviders.actions.edit')}
                </Button>
                <Button
                  disabled={deletingProviderId === provider.id}
                  onClick={() => onDelete(provider)}
                  type="button"
                  variant="destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {deletingProviderId === provider.id
                    ? t('settings.cli.customProviders.actions.deleting')
                    : t('settings.cli.customProviders.actions.delete')}
                </Button>
              </div>
            </div>

            {isExpanded && (
              <div className="mt-4 space-y-3 border-t pt-4">
                {models.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('settings.cli.customProviders.list.noModels')}
                  </p>
                ) : (
                  models.map(([modelId, model]) => (
                    <div
                      key={modelId}
                      className="rounded-md border bg-muted/20 p-3"
                    >
                      <p className="font-medium">
                        {model.name ||
                          t('settings.cli.customProviders.form.newModel')}
                      </p>
                      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-muted-foreground">
                            {t('settings.cli.customProviders.preview.input')}
                          </dt>
                          <dd>
                            {formatModalities(model.modalities?.input, t)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">
                            {t('settings.cli.customProviders.preview.output')}
                          </dt>
                          <dd>
                            {formatModalities(model.modalities?.output, t)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">
                            {t('settings.cli.customProviders.preview.context')}
                          </dt>
                          <dd>{formatValue(model.limit?.context)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">
                            {t(
                              'settings.cli.customProviders.preview.outputLimit'
                            )}
                          </dt>
                          <dd>{formatValue(model.limit?.output)}</dd>
                        </div>
                      </dl>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
