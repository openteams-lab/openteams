import React from 'react';
import type { SessionCostEntry } from '@/types';
import { truncateTitle, formatNumber } from '@/lib/buildStatsUtils';

export type SessionCostViewMode = 'list' | 'bar';

export interface SessionCostListProps {
  sessions: SessionCostEntry[];
  loading: boolean;
  mode?: SessionCostViewMode;
  t: (key: string, replacements?: Record<string, string | number>) => string;
}

export function SessionCostList({
  sessions,
  loading,
  mode = 'list',
  t,
}: SessionCostListProps) {
  const numberValue = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const label = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-10 animate-pulse rounded bg-[var(--surface-2)]"
          />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded border border-[var(--hairline)] bg-[var(--surface-1)] py-6 text-center text-[12px] text-[var(--ink-subtle)]">
        {t('buildStats.empty.noSessions')}
      </div>
    );
  }

  const sorted = [...sessions].sort(
    (a, b) => numberValue(b.total_tokens) - numberValue(a.total_tokens),
  );
  const maxTokens = Math.max(
    1,
    ...sorted.map((session) => numberValue(session.total_tokens)),
  );
  const inputShortLabel = label('buildStats.inputShort', 'in');
  const cacheShortLabel = label('buildStats.cacheShort', 'cache');

  if (mode === 'bar') {
    return (
      <div
        className="max-h-[360px] space-y-3 overflow-y-auto pr-1"
        aria-label={t('buildStats.sessionTokens')}
      >
        {sorted.map((session) => {
          const totalTokens = numberValue(session.total_tokens);
          const width = Math.max(4, (totalTokens / maxTokens) * 100);
          return (
            <div key={session.session_id} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span
                  className="min-w-0 flex-1 truncate text-[var(--ink-muted)]"
                  title={session.title}
                >
                  {truncateTitle(session.title || session.session_id, 56)}
                </span>
                <span className="font-mono text-[12px] text-[var(--ink)]">
                  {formatNumber(totalTokens)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-sm bg-[var(--surface-2)]">
                <div
                  className="h-full rounded-sm bg-[var(--primary)]"
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="max-h-[360px] overflow-y-auto rounded border border-[var(--hairline)] bg-[var(--surface-1)]"
      role="list"
      aria-label={t('buildStats.sessionTokens')}
    >
      {sorted.map((session) => (
        <div
          key={session.session_id}
          role="listitem"
          className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-[var(--hairline)] px-3 py-2 last:border-b-0 hover:bg-[var(--surface-2)] transition"
        >
          <span
            className="min-w-0 truncate text-[13px] text-[var(--ink)]"
            title={session.title}
          >
            {truncateTitle(session.title || session.session_id, 60)}
          </span>
          <span className="font-mono text-[12px] text-[var(--ink-tertiary)]">
            {inputShortLabel} {formatNumber(numberValue(session.input_tokens))}
            {numberValue(session.cache_read_tokens) > 0
              ? ` / ${cacheShortLabel} ${formatNumber(
                  numberValue(session.cache_read_tokens),
                )}`
              : ''}
          </span>
          <span className="font-mono text-[12px] font-medium text-[var(--ink)]">
            {formatNumber(numberValue(session.total_tokens))}
          </span>
        </div>
      ))}
    </div>
  );
}
