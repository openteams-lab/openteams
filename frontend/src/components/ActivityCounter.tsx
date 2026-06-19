import React from 'react';
import { formatNumber } from '@/lib/buildStatsUtils';

export interface ActivityCounterProps {
  bugsFixed: number;
  featuresDelivered: number;
  loading: boolean;
  t: (key: string, replacements?: Record<string, string | number>) => string;
}

/**
 * Displays two side-by-side stat cards showing bugs fixed and features delivered.
 * Uses success color for bugs fixed count and primary color for features delivered.
 * Numbers are formatted with thousands separators when > 999.
 * Shows "0" when data is unavailable or loading fails.
 */
export function ActivityCounter({
  bugsFixed,
  featuresDelivered,
  loading,
  t,
}: ActivityCounterProps) {
  if (loading) {
    return (
      <div className="flex gap-4" role="status" aria-label="Loading activity data">
        <div className="animate-pulse h-[72px] flex-1 rounded border border-[var(--hairline)] bg-[var(--surface-1)]" />
        <div className="animate-pulse h-[72px] flex-1 rounded border border-[var(--hairline)] bg-[var(--surface-1)]" />
      </div>
    );
  }

  const displayBugsFixed = Number.isFinite(bugsFixed) && bugsFixed >= 0 ? bugsFixed : 0;
  const displayFeatures = Number.isFinite(featuresDelivered) && featuresDelivered >= 0 ? featuresDelivered : 0;

  return (
    <div className="flex gap-4">
      <div className="flex-1 rounded border border-[var(--hairline)] bg-[var(--surface-1)] p-3">
        <p
          className="text-xs text-[var(--ink-muted)] mb-1"
          style={{ fontFamily: 'Inter, sans-serif' }}
        >
          {t('buildStats.bugsFixed')}
        </p>
        <p
          className="text-lg font-semibold text-[var(--success)]"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {formatNumber(displayBugsFixed)}
        </p>
      </div>
      <div className="flex-1 rounded border border-[var(--hairline)] bg-[var(--surface-1)] p-3">
        <p
          className="text-xs text-[var(--ink-muted)] mb-1"
          style={{ fontFamily: 'Inter, sans-serif' }}
        >
          {t('buildStats.featuresDelivered')}
        </p>
        <p
          className="text-lg font-semibold text-[var(--primary)]"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {formatNumber(displayFeatures)}
        </p>
      </div>
    </div>
  );
}
