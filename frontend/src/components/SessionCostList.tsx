import React, { useEffect, useState } from 'react';
import { ChevronsDown } from 'lucide-react';
import type { SessionCostEntry } from '@/types';
import { truncateTitle, formatNumber } from '@/lib/buildStatsUtils';

export type SessionCostViewMode = 'list' | 'bar';

export interface SessionCostListProps {
  sessions: SessionCostEntry[];
  loading: boolean;
  mode?: SessionCostViewMode;
  visibleLimit?: number;
  selectedSessionId?: string | null;
  onSessionSelect?: (session: SessionCostEntry) => void;
  t: (key: string, replacements?: Record<string, string | number>) => string;
}

export function SessionCostList({
  sessions,
  loading,
  mode = 'list',
  visibleLimit,
  selectedSessionId = null,
  onSessionSelect,
  t,
}: SessionCostListProps) {
  const [showAll, setShowAll] = useState(false);
  const numberValue = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const label = (
    key: string,
    fallback: string,
    replacements?: Record<string, string | number>,
  ) => {
    const value = t(key, replacements);
    const template = value === key ? fallback : value;
    if (!replacements) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(replacements, name)
        ? String(replacements[name])
        : match,
    );
  };

  useEffect(() => {
    setShowAll(false);
  }, [sessions, visibleLimit]);

  if (loading) {
    return (
      <div className="h-full min-h-0 space-y-2 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-8 animate-pulse rounded bg-[var(--surface-2)]"
          />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded border border-[var(--hairline)] bg-[var(--surface-1)] px-3 text-center text-[12px] text-[var(--ink-subtle)]">
        {t('buildStats.empty.noSessions')}
      </div>
    );
  }

  const sorted = [...sessions].sort(
    (a, b) => numberValue(b.total_tokens) - numberValue(a.total_tokens),
  );
  const limit =
    typeof visibleLimit === 'number' && visibleLimit > 0
      ? Math.floor(visibleLimit)
      : null;
  const hasHiddenSessions = limit !== null && sorted.length > limit;
  const visibleSessions =
    limit !== null && sorted.length > limit && !showAll
      ? sorted.slice(0, limit)
      : sorted;
  const hiddenSessionCount =
    hasHiddenSessions && limit !== null ? sorted.length - limit : 0;
  const maxTokens = Math.max(
    1,
    ...sorted.map((session) => numberValue(session.total_tokens)),
  );
  const inputShortLabel = label('buildStats.inputShort', 'in');
  const cacheShortLabel = label('buildStats.cacheShort', 'cache');

  if (mode === 'bar') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div
          className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
          aria-label={t('buildStats.sessionTokens')}
        >
          {visibleSessions.map((session) => {
            const totalTokens = numberValue(session.total_tokens);
            const width = Math.max(4, (totalTokens / maxTokens) * 100);
            const selected = selectedSessionId === session.session_id;
            return (
              <button
                key={session.session_id}
                type="button"
                onClick={() => onSessionSelect?.(session)}
                className={`block w-full rounded-sm px-2 py-1 text-left transition ${
                  selected
                    ? 'bg-[var(--surface-3)]'
                    : onSessionSelect
                      ? 'hover:bg-[var(--surface-1)]'
                      : ''
                }`}
              >
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
              </button>
            );
          })}
        </div>
        {hasHiddenSessions && !showAll && (
          <div className="mt-1.5 flex shrink-0 justify-center">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="inline-flex h-6 items-center rounded border border-[var(--hairline)] px-2 text-[11px] font-medium text-[var(--ink-subtle)] transition hover:border-[var(--primary)] hover:bg-[var(--surface-2)] hover:text-[var(--primary)]"
            >
              <ChevronsDown className="mr-1 h-3 w-3" aria-hidden="true" />
              {label(
                'buildStats.sessionTokens.showMore',
                'Show {count} more',
                {
                  count: hiddenSessionCount,
                },
              )}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="h-full min-h-0 overflow-y-auto rounded border border-[var(--hairline)] bg-[var(--surface-1)]"
      role="list"
      aria-label={t('buildStats.sessionTokens')}
    >
      {visibleSessions.map((session) => (
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
      {hasHiddenSessions && !showAll && (
        <div
          className="flex justify-center border-t border-[var(--hairline)] py-1.5"
          role="listitem"
        >
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="inline-flex h-6 items-center rounded border border-[var(--hairline)] px-2 text-[11px] font-medium text-[var(--ink-subtle)] transition hover:border-[var(--primary)] hover:bg-[var(--surface-2)] hover:text-[var(--primary)]"
          >
            <ChevronsDown className="mr-1 h-3 w-3" aria-hidden="true" />
            {label('buildStats.sessionTokens.showMore', 'Show {count} more', {
              count: hiddenSessionCount,
            })}
          </button>
        </div>
      )}
    </div>
  );
}
