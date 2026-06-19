import { Check, ChevronDown, Circle, CircleCheck, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { GitHubIssueSummary } from '@/types';

type IssueImportTranslator = (
  key: string,
  fallback: string,
  replacements?: Record<string, string | number>,
) => string;

interface IssueImportDialogProps {
  open: boolean;
  issues: GitHubIssueSummary[];
  loading: boolean;
  error: string;
  action: string | null;
  query: string;
  tr: IssueImportTranslator;
  onQueryChange: (value: string) => void;
  onImport: (issue: GitHubIssueSummary) => void | Promise<void>;
  onClose: () => void;
}

export type IssueImportedFilter = 'all' | 'imported' | 'not_imported';
export type IssueStatusFilter = 'all' | 'open' | 'closed';

export interface IssueImportFilters {
  imported: IssueImportedFilter;
  label: string | null;
  query: string;
  status: IssueStatusFilter;
}

const cn = (...classes: Array<string | false | undefined>) =>
  classes.filter(Boolean).join(' ');

const issueKey = (issue: GitHubIssueSummary) => String(issue.number);

export const uniqueIssueImportLabels = (issues: GitHubIssueSummary[]) =>
  Array.from(
    issues.reduce((labels, issue) => {
      issue.labels.forEach((label) => labels.add(label));
      return labels;
    }, new Set<string>()),
  ).sort((a, b) => a.localeCompare(b));

export const filterIssueImportDialogIssues = (
  issues: GitHubIssueSummary[],
  filters: IssueImportFilters,
) => {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return issues.filter((issue) => {
    if (
      filters.imported === 'imported' &&
      !issue.work_item_id
    ) {
      return false;
    }
    if (
      filters.imported === 'not_imported' &&
      issue.work_item_id
    ) {
      return false;
    }
    if (filters.status !== 'all' && issue.state !== filters.status) {
      return false;
    }
    if (filters.label && !issue.labels.includes(filters.label)) {
      return false;
    }
    if (!normalizedQuery) return true;

    return [
      issue.title,
      String(issue.number),
      issue.state,
      issue.author ?? '',
      ...issue.labels,
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery);
  });
};

export function IssueImportDialog({
  open,
  issues,
  loading,
  error,
  action,
  query,
  tr,
  onQueryChange,
  onImport,
  onClose,
}: IssueImportDialogProps) {
  const [selectedIssueKeys, setSelectedIssueKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [batchImporting, setBatchImporting] = useState(false);
  const [importedFilter, setImportedFilter] =
    useState<IssueImportedFilter>('all');
  const [statusFilter, setStatusFilter] = useState<IssueStatusFilter>('open');
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [openFilter, setOpenFilter] = useState<
    'imported' | 'status' | 'label' | null
  >(null);
  const labelOptions = useMemo(() => uniqueIssueImportLabels(issues), [issues]);
  const visibleIssues = useMemo(
    () =>
      filterIssueImportDialogIssues(issues, {
        imported: importedFilter,
        label: labelFilter,
        query,
        status: statusFilter,
      }),
    [importedFilter, issues, labelFilter, query, statusFilter],
  );
  const visibleImportableKeys = useMemo(
    () =>
      new Set(
        visibleIssues
          .filter((issue) => !issue.work_item_id)
          .map((issue) => issueKey(issue)),
      ),
    [visibleIssues],
  );
  const selectedVisibleCount = Array.from(selectedIssueKeys).filter((key) =>
    visibleImportableKeys.has(key),
  ).length;
  const allVisibleSelected =
    visibleImportableKeys.size > 0 &&
    selectedVisibleCount === visibleImportableKeys.size;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const importBusy = batchImporting || Boolean(action);

  useEffect(() => {
    if (!open) return;
    setSelectedIssueKeys(new Set());
  }, [open]);

  useEffect(() => {
    setSelectedIssueKeys((current) => {
      const validKeys = new Set(
        issues
          .filter((issue) => !issue.work_item_id)
          .map((issue) => issueKey(issue)),
      );
      const next = new Set(
        Array.from(current).filter((key) => validKeys.has(key)),
      );
      return next.size === current.size ? current : next;
    });
  }, [issues]);

  if (!open) return null;

  const toggleIssue = (issue: GitHubIssueSummary) => {
    if (issue.work_item_id || importBusy) return;
    const key = issueKey(issue);
    setSelectedIssueKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (visibleImportableKeys.size === 0 || importBusy) return;
    setSelectedIssueKeys((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleImportableKeys.forEach((key) => next.delete(key));
      } else {
        visibleImportableKeys.forEach((key) => next.add(key));
      }
      return next;
    });
  };

  const handleImportSelected = async () => {
    if (selectedVisibleCount === 0 || importBusy) return;
    setBatchImporting(true);
    try {
      for (const issue of visibleIssues) {
        if (!issue.work_item_id && selectedIssueKeys.has(issueKey(issue))) {
          await onImport(issue);
        }
      }
      setSelectedIssueKeys(new Set());
    } finally {
      setBatchImporting(false);
    }
  };
  const importedFilterLabel =
    importedFilter === 'imported'
      ? tr('issue.importDialog.filter.importedYes', 'Imported: Yes')
      : importedFilter === 'not_imported'
        ? tr('issue.importDialog.filter.importedNo', 'Imported: No')
        : tr('issue.importDialog.filter.imported', 'Imported');
  const statusFilterLabel =
    statusFilter === 'all'
      ? tr('issue.importDialog.filter.status', 'Status')
      : tr(
          `issue.importDialog.filter.status.${statusFilter}`,
          `Status: ${titleCase(statusFilter)}`,
        );
  const labelFilterLabel = labelFilter
    ? tr('issue.importDialog.filter.labelSelected', 'Label: {label}', {
        label: labelFilter,
      })
    : tr('issue.importDialog.filter.label', 'Label');

  return (
    <div
      className="issue-import-dialog-overlay fixed inset-0 z-50 flex items-center justify-center px-5 py-6 font-sans text-[var(--ink)]"
    >
      <style>{`
        .issue-import-dialog-overlay {
          background: rgba(0, 0, 0, 0.28);
          backdrop-filter: blur(14px) saturate(118%);
          -webkit-backdrop-filter: blur(14px) saturate(118%);
        }
        body[data-mode="light"] .issue-import-dialog-overlay {
          background: rgba(10, 10, 12, 0.14);
        }
        .issue-import-dialog-shell,
        .issue-import-dialog-menu {
          background: color-mix(in srgb, var(--surface-1) 88%, transparent);
          backdrop-filter: blur(24px) saturate(112%);
          -webkit-backdrop-filter: blur(24px) saturate(112%);
        }
        .issue-import-dialog-menu {
          background: color-mix(in srgb, var(--surface-3) 94%, transparent);
        }
        .issue-import-dialog-subtle-fill {
          background: color-mix(in srgb, var(--surface-2) 70%, transparent);
        }
        .issue-import-dialog-list-fill {
          background: color-mix(in srgb, var(--surface-1) 74%, transparent);
        }
        .issue-import-dialog-row-border {
          border-color: color-mix(in srgb, var(--hairline) 54%, transparent);
        }
        .issue-import-dialog-list::-webkit-scrollbar { width: 8px; }
        .issue-import-dialog-list::-webkit-scrollbar-track { background: transparent; }
        .issue-import-dialog-list::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--ink-tertiary) 32%, transparent); border-radius: 4px; }
        .issue-import-dialog-list::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--ink-tertiary) 48%, transparent); }
        .issue-import-dialog-checkbox.checked::after,
        .issue-import-dialog-row.selected .issue-import-dialog-checkbox::after {
          content: '';
          width: 4px;
          height: 8px;
          border: solid white;
          border-width: 0 2px 2px 0;
          transform: rotate(45deg) translateY(-1px);
        }
        .issue-import-dialog-checkbox.indeterminate::after {
          content: '';
          width: 8px;
          height: 2px;
          background: white;
          border-radius: 1px;
        }
      `}</style>

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-import-dialog-search"
        className="issue-import-dialog-shell flex h-[560px] w-[720px] max-w-[calc(100vw-40px)] flex-col overflow-hidden rounded-[12px] border border-[var(--hairline)] text-[var(--ink)]"
      >
        <header className="flex h-14 shrink-0 items-center border-b border-[var(--hairline)] px-4">
          <Search
            aria-hidden="true"
            className="mr-3 h-4 w-4 text-[var(--ink-subtle)]"
            strokeWidth={2}
          />
          <input
            id="issue-import-dialog-search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={tr(
              'issue.importDialog.searchPlaceholderCompact',
              'Search issues...',
            )}
            autoComplete="off"
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-[15px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-subtle)]"
          />
          <kbd className="rounded-[4px] border border-[var(--hairline)] bg-[var(--surface-3)] px-[6px] py-[2px] text-[12px] font-normal leading-none text-[var(--ink-subtle)]">
            &#8984; K
          </kbd>
        </header>

        <div className="issue-import-dialog-subtle-fill flex h-[37px] shrink-0 items-center gap-3 border-b border-[var(--hairline)] px-4 text-[12px]">
          <button
            type="button"
            className="flex items-center gap-1 rounded-[4px] border border-dashed border-transparent py-1 pl-1 pr-1 text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
            onClick={toggleSelectAll}
          >
            <span
              className={cn(
                'issue-import-dialog-checkbox flex h-[14px] w-[14px] items-center justify-center rounded-[3px] border border-[var(--ink-subtle)] transition',
                allVisibleSelected &&
                  'checked border-[var(--primary)] bg-[var(--primary)]',
                someVisibleSelected &&
                  'indeterminate border-[var(--primary)] bg-[var(--primary)]',
              )}
            />
            <span className="ml-1">
              {tr('issue.importDialog.selectAll', 'Select All')}
            </span>
          </button>
          <span className="mx-1 h-[14px] w-px bg-[var(--hairline)]" />
          <FilterButton
            active={importedFilter !== 'all'}
            label={importedFilterLabel}
            open={openFilter === 'imported'}
            onToggle={() =>
              setOpenFilter((current) =>
                current === 'imported' ? null : 'imported',
              )
            }
          >
            <FilterMenuOption
              selected={importedFilter === 'all'}
              onClick={() => {
                setImportedFilter('all');
                setOpenFilter(null);
              }}
            >
              {tr('issue.importDialog.filter.all', 'All')}
            </FilterMenuOption>
            <FilterMenuOption
              selected={importedFilter === 'imported'}
              onClick={() => {
                setImportedFilter('imported');
                setOpenFilter(null);
              }}
            >
              {tr('issue.importDialog.filter.importedOnly', 'Imported')}
            </FilterMenuOption>
            <FilterMenuOption
              selected={importedFilter === 'not_imported'}
              onClick={() => {
                setImportedFilter('not_imported');
                setOpenFilter(null);
              }}
            >
              {tr('issue.importDialog.filter.notImported', 'Not imported')}
            </FilterMenuOption>
          </FilterButton>
          <FilterButton
            active={statusFilter !== 'open'}
            label={statusFilterLabel}
            open={openFilter === 'status'}
            onToggle={() =>
              setOpenFilter((current) =>
                current === 'status' ? null : 'status',
              )
            }
          >
            {(['all', 'open', 'closed'] as const).map((status) => (
              <FilterMenuOption
                key={status}
                selected={statusFilter === status}
                onClick={() => {
                  setStatusFilter(status);
                  setOpenFilter(null);
                }}
              >
                {status === 'all'
                  ? tr('issue.importDialog.filter.all', 'All')
                  : titleCase(status)}
              </FilterMenuOption>
            ))}
          </FilterButton>
          <FilterButton
            active={Boolean(labelFilter)}
            label={labelFilterLabel}
            open={openFilter === 'label'}
            onToggle={() =>
              setOpenFilter((current) => (current === 'label' ? null : 'label'))
            }
          >
            <FilterMenuOption
              selected={!labelFilter}
              onClick={() => {
                setLabelFilter(null);
                setOpenFilter(null);
              }}
            >
              {tr('issue.importDialog.filter.all', 'All')}
            </FilterMenuOption>
            {labelOptions.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-[var(--ink-tertiary)]">
                {tr('issue.importDialog.filter.noLabels', 'No labels')}
              </div>
            ) : (
              labelOptions.map((label) => (
                <FilterMenuOption
                  key={label}
                  selected={labelFilter === label}
                  onClick={() => {
                    setLabelFilter(label);
                    setOpenFilter(null);
                  }}
                >
                  {label}
                </FilterMenuOption>
              ))
            )}
          </FilterButton>
        </div>

        <div className="issue-import-dialog-list issue-import-dialog-list-fill min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <DialogStateMessage tone="error">{error}</DialogStateMessage>
          ) : loading ? (
            <DialogStateMessage>
              {tr('issue.importDialog.loading', 'Loading GitHub issues...')}
            </DialogStateMessage>
          ) : visibleIssues.length === 0 ? (
            <DialogStateMessage>
              {tr('issue.importDialog.empty', 'No GitHub issues found.')}
            </DialogStateMessage>
          ) : (
            visibleIssues.map((issue) => {
              const key = issueKey(issue);
              const selected = selectedIssueKeys.has(key);
              const imported = Boolean(issue.work_item_id);
              const importing = action === key;
              return (
                <IssueImportRow
                  key={key}
                  issue={issue}
                  selected={selected}
                  imported={imported}
                  importing={importing}
                  onToggle={() => toggleIssue(issue)}
                />
              );
            })
          )}
        </div>

        <footer className="issue-import-dialog-subtle-fill flex h-[52px] shrink-0 items-center justify-between border-t border-[var(--hairline)] px-4">
          <div className="text-[13px] text-[var(--ink-subtle)]">
            {tr('issue.importDialog.selected', 'Selected')}{' '}
            <span className="font-medium text-[var(--ink)]">
              {selectedVisibleCount}
            </span>{' '}
            {tr('issue.importDialog.of', 'of')} {visibleIssues.length}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border-0 bg-transparent px-3 py-[6px] text-[13px] font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
              onClick={onClose}
            >
              {tr('issue.importDialog.action.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              disabled={selectedVisibleCount === 0 || importBusy}
              className="rounded-md border-0 bg-[var(--primary)] px-3 py-[6px] text-[13px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-[color-mix(in_srgb,var(--primary-focus)_50%,transparent)] disabled:cursor-not-allowed disabled:opacity-55"
              onClick={() => void handleImportSelected()}
            >
              {importBusy
                ? tr('issue.importDialog.status.importing', 'Importing...')
                : tr('issue.importDialog.action.importSelected', 'Import Issues')}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function FilterButton({
  active,
  children,
  label,
  open,
  onToggle,
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-1 rounded-[4px] border border-dashed border-transparent px-2 py-1 text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]',
          active && 'bg-[var(--surface-3)] text-[var(--ink)]',
        )}
        onClick={onToggle}
      >
        <span className="max-w-[142px] truncate">{label}</span>
        <ChevronDown aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
      </button>
      {open && (
        <div className="issue-import-dialog-menu absolute left-0 top-[calc(100%+6px)] z-20 min-w-[150px] overflow-hidden rounded-md border border-[var(--hairline-strong)] py-1">
          {children}
        </div>
      )}
    </div>
  );
}

function FilterMenuOption({
  children,
  onClick,
  selected,
}: {
  children: ReactNode;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[var(--ink-subtle)] transition hover:bg-[var(--surface-4)] hover:text-[var(--ink)]"
      onClick={onClick}
    >
      <span className="flex h-3 w-3 items-center justify-center">
        {selected && (
          <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2.2} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

function DialogStateMessage({
  children,
  tone,
}: {
  children: string;
  tone?: 'error';
}) {
  return (
    <div
      className={cn(
        'flex min-h-full items-center justify-center px-6 text-center text-[13px] font-medium',
        tone === 'error' ? 'text-red-400' : 'text-[var(--ink-subtle)]',
      )}
    >
      {children}
    </div>
  );
}

function IssueImportRow({
  issue,
  selected,
  imported,
  importing,
  onToggle,
}: {
  issue: GitHubIssueSummary;
  selected: boolean;
  imported: boolean;
  importing: boolean;
  onToggle: () => void;
}) {
  const label = issue.labels[0] ?? '';
  return (
    <article
      role="button"
      tabIndex={imported ? -1 : 0}
      aria-selected={selected}
      aria-disabled={imported}
      className={cn(
        'issue-import-dialog-row issue-import-dialog-row-border flex h-11 items-center border-b px-4 transition hover:bg-[var(--surface-2)]',
        selected && 'selected',
        imported ? 'cursor-default bg-[var(--surface-2)]' : 'cursor-pointer',
        importing && 'opacity-70',
      )}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (imported) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <span
        className={cn(
          'issue-import-dialog-checkbox mr-3 flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border border-[var(--ink-subtle)] transition',
          imported && 'border-[var(--ink-tertiary)] bg-[var(--surface-3)]',
          selected && 'checked border-[var(--primary)] bg-[var(--primary)]',
        )}
      />
      {issue.state === 'closed' ? (
        <CircleCheck
          aria-hidden="true"
          className={cn(
            'mr-3 h-[14px] w-[14px] shrink-0',
            imported ? 'text-[var(--ink-tertiary)]' : 'text-[var(--success)]',
          )}
          strokeWidth={2.4}
        />
      ) : (
        <Circle
          aria-hidden="true"
          className={cn(
            'mr-3 h-[14px] w-[14px] shrink-0',
            imported ? 'text-[var(--ink-tertiary)]' : 'text-[var(--ink-subtle)]',
          )}
          strokeWidth={2.4}
        />
      )}
      <h3
        className={cn(
          'min-w-0 flex-1 truncate text-[13px] font-medium',
          imported ? 'text-[var(--ink-tertiary)]' : 'text-[var(--ink)]',
        )}
      >
        {issue.title}
      </h3>
      {imported && (
        <span className="ml-2 rounded-[10px] border border-[color-mix(in_srgb,var(--success)_42%,var(--hairline))] bg-[color-mix(in_srgb,var(--success)_14%,var(--surface-2))] px-[6px] py-[2px] text-[11px] font-medium leading-none text-[var(--success)]">
          Imported
        </span>
      )}
      {label && (
        <span className="ml-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface-2)] px-[6px] py-[2px] text-[11px] leading-none text-[var(--ink-subtle)]">
          {label}
        </span>
      )}
      <span
        className={cn(
          'ml-4 w-20 text-right text-[12px] tabular-nums',
          imported ? 'text-[var(--ink-tertiary)]' : 'text-[var(--ink-subtle)]',
        )}
      >
        #{issue.number}
      </span>
      <span
        className={cn(
          'ml-4 w-20 text-right text-[12px] tabular-nums',
          imported ? 'text-[var(--ink-tertiary)]' : 'text-[var(--ink-subtle)]',
        )}
      >
        {formatIssueTime(issue.updated_at ?? issue.last_synced_at)}
      </span>
    </article>
  );
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatIssueTime(value: string | null) {
  if (!value) return '';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  const diffHours = Math.max(1, Math.floor((Date.now() - time) / 3600000));
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
