import React from 'react';
import { AlertCircle, Inbox, Info, Loader2, RefreshCw } from 'lucide-react';
import { AsyncResourceState } from '@/lib/asyncResource';

type ResourceStateKind = 'loading' | 'error' | 'empty' | 'fallback';

interface ResourceStateLabels {
  loading: string;
  empty: string;
  error: string;
  fallback?: string;
}

export interface ResourceStateSummary {
  kind: ResourceStateKind;
  title: string;
  detail: string | null;
}

export const summarizeResourceState = <T,>(
  resource: AsyncResourceState<T>,
  labels: ResourceStateLabels,
): ResourceStateSummary | null => {
  if (resource.loading) {
    return { kind: 'loading', title: labels.loading, detail: null };
  }

  if (resource.error) {
    if (resource.source === 'mock' && !resource.empty) {
      return null;
    }

    return {
      kind: 'error',
      title: labels.error,
      detail: resource.error,
    };
  }

  if (resource.empty) {
    return { kind: 'empty', title: labels.empty, detail: null };
  }

  return null;
};

interface ResourceStateNoticeProps<T> {
  resource: AsyncResourceState<T>;
  labels: ResourceStateLabels;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}

export const ResourceStateNotice = <T,>({
  resource,
  labels,
  onRetry,
  className = '',
  compact = false,
}: ResourceStateNoticeProps<T>) => {
  const summary = summarizeResourceState(resource, labels);
  if (!summary) return null;

  const Icon =
    summary.kind === 'loading'
      ? Loader2
      : summary.kind === 'error'
        ? AlertCircle
        : summary.kind === 'empty'
          ? Inbox
          : Info;
  const tone =
    summary.kind === 'error'
      ? 'border-red-500/30 bg-red-500/10 text-red-500'
      : 'border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-subtle)]';

  return (
    <div
      className={`flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${tone} ${className}`}
    >
      <Icon
        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${summary.kind === 'loading' ? 'animate-spin' : ''}`}
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[var(--ink)] break-words">{summary.title}</p>
        {!compact && summary.detail && (
          <p className="mt-0.5 break-words font-mono text-[10px] text-[var(--ink-tertiary)]">
            {summary.detail}
          </p>
        )}
      </div>
      {onRetry && summary.kind === 'error' && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--hairline-strong)] px-2 py-0.5 font-mono text-[10px] text-[var(--ink-muted)] hover:bg-[var(--surface-3)]"
        >
          <RefreshCw className="h-3 w-3" />
          retry
        </button>
      )}
    </div>
  );
};
