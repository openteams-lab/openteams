import React from 'react';
import { X } from 'lucide-react';

import type { SessionWorktree } from '@/types';

export interface WorktreeMergeHistoryCommit {
  id: string;
  sha: string;
  message: string;
}

export interface WorktreeMergeHistoryRow {
  label: string;
  value: string;
}

type WorktreeHistoryTranslator = (
  key: string,
  fallback: string,
  replacements?: Record<string, string | number>,
) => string;

const parseConflictFiles = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
};

export const buildWorktreeMergeHistoryRows = (
  worktree: SessionWorktree,
  tr: WorktreeHistoryTranslator,
): WorktreeMergeHistoryRow[] => {
  const conflicts = parseConflictFiles(worktree.conflict_files_json);
  return [
    {
      label: tr('worktree.history.status', 'Status'),
      value: worktree.status,
    },
    {
      label: tr('worktree.history.mergedAt', 'Merged at'),
      value: worktree.merged_at ?? tr('worktree.history.notMerged', 'Not merged'),
    },
    {
      label: tr('worktree.history.sessionBranch', 'Session branch'),
      value: worktree.branch_name,
    },
    {
      label: tr('worktree.history.baseBranch', 'Base branch'),
      value: worktree.base_branch,
    },
    {
      label: tr('worktree.history.targetBranch', 'Target branch'),
      value: worktree.merge_target_branch ?? worktree.base_branch,
    },
    {
      label: tr('worktree.history.operation', 'Merge operation'),
      value: worktree.merge_operation ?? 'merge',
    },
    {
      label: tr('worktree.history.baseCommit', 'Base commit'),
      value: worktree.base_commit ?? tr('worktree.history.none', 'None'),
    },
    {
      label: tr('worktree.history.conflictFiles', 'Conflict files'),
      value:
        conflicts.length > 0
          ? conflicts.join(', ')
          : tr('worktree.history.noConflictFiles', 'None recorded'),
    },
  ];
};

interface WorktreeMergeHistoryPanelProps {
  worktree: SessionWorktree;
  commits: WorktreeMergeHistoryCommit[];
  tr: WorktreeHistoryTranslator;
  onClose: () => void;
}

export const WorktreeMergeHistoryPanel: React.FC<
  WorktreeMergeHistoryPanelProps
> = ({ worktree, commits, tr, onClose }) => {
  const rows = buildWorktreeMergeHistoryRows(worktree, tr);
  return (
    <section className="mx-2 mb-2 rounded-md border border-[var(--hairline)] bg-[var(--surface-1)]">
      <div className="flex h-9 items-center justify-between gap-2 border-b border-[var(--hairline)] px-3">
        <h3 className="truncate text-[12px] font-semibold text-[var(--ink)]">
          {tr('worktree.history.title', 'Merge history')}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
          aria-label={tr('worktree.history.close', 'Close merge history')}
          title={tr('worktree.history.close', 'Close merge history')}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <dl className="grid grid-cols-1 gap-x-3 gap-y-1 px-3 py-2 text-[11px] sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0">
            <dt className="text-[var(--ink-tertiary)]">{row.label}</dt>
            <dd className="truncate font-mono text-[var(--ink-subtle)]" title={row.value}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-[var(--hairline)] px-3 py-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-tertiary)]">
          {tr('worktree.history.commits', 'Session commits')}
        </div>
        {commits.length === 0 ? (
          <p className="text-[11px] text-[var(--ink-tertiary)]">
            {tr('worktree.history.noCommits', 'No commit records found')}
          </p>
        ) : (
          <div className="space-y-0.5">
            {commits.map((commit) => (
              <div
                key={commit.id}
                className="flex min-w-0 items-center gap-2 text-[11px]"
                title={`${commit.sha} ${commit.message}`}
              >
                <span className="shrink-0 font-mono text-[10px] text-[var(--ink-tertiary)]">
                  {commit.sha.slice(0, 7)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--ink-subtle)]">
                  {commit.message || tr('worktree.history.commitFallback', 'Commit')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
