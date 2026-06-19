import React, { useState } from 'react';
import type { ModelUsageRow } from '@/types';
import { buildStatsApi } from '@/lib/buildStatsApi';
import { formatCompactNumber, formatPrice } from '@/lib/buildStatsUtils';

export interface ModelPricingTableProps {
  models: ModelUsageRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  projectId?: string | null;
  onPricingUpdated?: () => void | Promise<void>;
  t: (key: string, replacements?: Record<string, string | number>) => string;
}

const numVal = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

export function ModelPricingTable({
  models,
  loading,
  error,
  onRetry,
  projectId,
  onPricingUpdated,
  t,
}: ModelPricingTableProps) {
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [savingModelId, setSavingModelId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    input: '',
    output: '',
    cacheRead: '',
  });

  const label = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const startEdit = (model: ModelUsageRow) => {
    setEditingModelId(model.model_id);
    setEditError(null);
    setDraft({
      input: String(numVal(model.input_price_per_1m)),
      output: String(numVal(model.output_price_per_1m)),
      cacheRead: String(numVal(model.cache_read_price_per_1m)),
    });
  };

  const draftPrice = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
  };

  const saveEdit = async (modelId: string) => {
    if (!projectId) return;
    const input = draftPrice(draft.input);
    const output = draftPrice(draft.output);
    const cacheRead = draftPrice(draft.cacheRead);
    if ([input, output, cacheRead].some((price) => Number.isNaN(price))) {
      setEditError(label('buildStats.pricing.invalidPrice', 'Invalid price value'));
      return;
    }

    setSavingModelId(modelId);
    setEditError(null);
    try {
      await buildStatsApi.updateModelPricing(projectId, modelId, {
        custom_input_price: input,
        custom_output_price: output,
        custom_cache_read_price: cacheRead,
      });
      setEditingModelId(null);
      await onPricingUpdated?.();
    } catch {
      setEditError(label('buildStats.error.fetchFailed', 'Request failed'));
    } finally {
      setSavingModelId(null);
    }
  };

  const resetPrice = async (modelId: string) => {
    if (!projectId) return;
    setSavingModelId(modelId);
    setEditError(null);
    try {
      await buildStatsApi.resetModelPricing(projectId, modelId);
      setEditingModelId(null);
      await onPricingUpdated?.();
    } catch {
      setEditError(label('buildStats.error.fetchFailed', 'Request failed'));
    } finally {
      setSavingModelId(null);
    }
  };

  if (loading) {
    return (
      <div className="h-full min-h-0 space-y-2 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 w-24 animate-pulse rounded bg-[var(--surface-2)]" />
            <div className="h-4 animate-pulse rounded bg-[var(--surface-2)]" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 text-center">
        <p className="mb-2 text-[12px] text-[var(--ink-subtle)]">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="cursor-pointer text-[12px] font-medium text-[var(--primary)] hover:underline"
        >
          {t('buildStats.error.retry')}
        </button>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 text-center text-[12px] text-[var(--ink-subtle)]">
        {label('buildStats.empty.noModels', 'No model usage data')}
      </div>
    );
  }

  const maxTokens = Math.max(...models.map((m) => numVal(m.total_tokens)), 1);
  const tokensLabel = label('buildStats.tokens', 'tokens');
  const inputShortLabel = label('buildStats.inputShort', 'in');
  const outputShortLabel = label('buildStats.outputShort', 'out');
  const cacheShortLabel = label('buildStats.cacheShort', 'cache');
  const perMillionLabel = label('buildStats.perMillion', 'per 1M');

  return (
    <div className="h-full min-h-0 space-y-2 overflow-y-auto pr-1 ot-scroll-area-styled">
      {models.map((model, index) => {
        const total = numVal(model.total_tokens);
        const input = numVal(model.input_tokens);
        const output = numVal(model.output_tokens);
        const cache = numVal(model.cache_read_tokens);
        const cost = numVal(model.estimated_cost);
        const pct = (total / maxTokens) * 100;
        const inputPct = total > 0 ? (input / total) * 100 : 50;
        const isEditing = editingModelId === model.model_id;
        const isSaving = savingModelId === model.model_id;

        return (
          <div key={model.model_id} className="group">
            {/* Header row: rank + name + cost */}
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="font-mono text-[12px] font-medium text-[var(--ink-tertiary)]">
                  {index + 1}
                </span>
                <span className="truncate text-[13px] font-medium text-[var(--ink)]">
                  {model.model_name}
                </span>
              </div>
              <span className="shrink-0 font-mono text-[13px] font-medium text-[var(--primary)]">
                {formatPrice(cost)}
              </span>
            </div>

            {/* Usage bar */}
            <div className="relative h-4 w-full overflow-hidden rounded-sm bg-[var(--surface-2)]">
              {/* Input portion */}
              <div
                className="absolute inset-y-0 left-0 rounded-l-sm bg-[var(--primary)] opacity-25 transition-all duration-300"
                style={{ width: `${(pct * inputPct) / 100}%` }}
              />
              {/* Output portion */}
              <div
                className="absolute inset-y-0 rounded-r-sm bg-[var(--primary)] opacity-15 transition-all duration-300"
                style={{
                  left: `${(pct * inputPct) / 100}%`,
                  width: `${(pct * (100 - inputPct)) / 100}%`,
                }}
              />
              {/* Token label inside bar */}
              <div className="absolute inset-0 flex items-center px-2">
                <span className="font-mono text-[12px] text-[var(--ink)]">
                  {formatCompactNumber(total)} {tokensLabel}
                </span>
              </div>
            </div>

            {/* Sub-detail row */}
            <div className="mt-0.5 flex items-center gap-3 text-[11px] font-mono text-[var(--ink-tertiary)]">
              <span>
                {inputShortLabel} {formatCompactNumber(input)} /{' '}
                {outputShortLabel} {formatCompactNumber(output)}
                {cache > 0
                  ? ` / ${cacheShortLabel} ${formatCompactNumber(cache)}`
                  : ''}
              </span>
              <span className="ml-auto">
                {formatPrice(numVal(model.input_price_per_1m))} /{' '}
                {formatPrice(numVal(model.output_price_per_1m))} /{' '}
                {formatPrice(numVal(model.cache_read_price_per_1m))}{' '}
                {perMillionLabel}
              </span>
            </div>
            {projectId && (
              <div className="mt-1">
                {isEditing ? (
                  <div className="space-y-1.5 rounded-sm border border-[var(--hairline)] bg-[var(--surface-2)] p-2">
                    <div className="grid grid-cols-3 gap-2">
                      <label className="space-y-1 text-[11px] text-[var(--ink-tertiary)]">
                        <span>
                          {label('buildStats.inputTokens', 'Input tokens')}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.000001"
                          value={draft.input}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              input: event.target.value,
                            }))
                          }
                          className="build-stats-price-input w-full rounded-sm border border-[var(--hairline)] bg-[var(--surface-1)] px-2 py-1 font-mono text-[12px] text-[var(--ink)] outline-none focus:border-[var(--primary)]"
                        />
                      </label>
                      <label className="space-y-1 text-[11px] text-[var(--ink-tertiary)]">
                        <span>
                          {label('buildStats.outputTokens', 'Output tokens')}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.000001"
                          value={draft.output}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              output: event.target.value,
                            }))
                          }
                          className="build-stats-price-input w-full rounded-sm border border-[var(--hairline)] bg-[var(--surface-1)] px-2 py-1 font-mono text-[12px] text-[var(--ink)] outline-none focus:border-[var(--primary)]"
                        />
                      </label>
                      <label className="space-y-1 text-[11px] text-[var(--ink-tertiary)]">
                        <span>
                          {label(
                            'buildStats.cacheInputTokens',
                            'Cache input tokens',
                          )}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.000001"
                          value={draft.cacheRead}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              cacheRead: event.target.value,
                            }))
                          }
                          className="build-stats-price-input w-full rounded-sm border border-[var(--hairline)] bg-[var(--surface-1)] px-2 py-1 font-mono text-[12px] text-[var(--ink)] outline-none focus:border-[var(--primary)]"
                        />
                      </label>
                    </div>
                    {editError && (
                      <p className="text-[11px] text-red-400">{editError}</p>
                    )}
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => setEditingModelId(null)}
                        className="cursor-pointer rounded-sm border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {label('cancel', 'Cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => void resetPrice(model.model_id)}
                        className="cursor-pointer rounded-sm border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {label('buildStats.pricing.reset', 'Reset to default')}
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => void saveEdit(model.model_id)}
                        className="cursor-pointer rounded-sm bg-[var(--primary)] px-2 py-1 text-[11px] font-medium text-white hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isSaving
                          ? label('buildStats.pricing.saving', 'Saving...')
                          : label('buildStats.pricing.save', 'Save')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => startEdit(model)}
                      className="cursor-pointer text-[11px] font-medium text-[var(--primary)] hover:underline"
                    >
                      {label('buildStats.pricing.edit', 'Edit custom price')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
