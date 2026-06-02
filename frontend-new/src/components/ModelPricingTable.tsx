import React from 'react';
import type { ModelUsageRow } from '@/types';
import { formatCompactNumber, formatPrice } from '@/lib/buildStatsUtils';

export interface ModelPricingTableProps {
  models: ModelUsageRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  t: (key: string, replacements?: Record<string, string | number>) => string;
}

const numVal = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

export function ModelPricingTable({
  models,
  loading,
  error,
  onRetry,
  t,
}: ModelPricingTableProps) {
  const label = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
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
      <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] py-8 text-center">
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
      <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] py-8 text-center text-[12px] text-[var(--ink-subtle)]">
        {label('buildStats.empty.noModels', 'No model usage data')}
      </div>
    );
  }

  const maxTokens = Math.max(...models.map((m) => numVal(m.total_tokens)), 1);

  return (
    <div className="space-y-3">
      {models.map((model, index) => {
        const total = numVal(model.total_tokens);
        const input = numVal(model.input_tokens);
        const output = numVal(model.output_tokens);
        const cost = numVal(model.estimated_cost);
        const pct = (total / maxTokens) * 100;
        const inputPct = total > 0 ? (input / total) * 100 : 50;

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
                  {formatCompactNumber(total)} tokens
                </span>
              </div>
            </div>

            {/* Sub-detail row */}
            <div className="mt-0.5 flex items-center gap-3 text-[12px] font-mono text-[var(--ink-tertiary)]">
              <span>
                in {formatCompactNumber(input)} / out {formatCompactNumber(output)}
              </span>
              <span className="ml-auto">
                {formatPrice(numVal(model.input_price_per_1m))} / {formatPrice(numVal(model.output_price_per_1m))} per 1M
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
