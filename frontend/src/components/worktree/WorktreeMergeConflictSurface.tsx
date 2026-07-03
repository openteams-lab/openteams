import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function WorktreeMergeConflictFrame({
  children,
  surface = 'modal',
}: {
  children: ReactNode;
  surface?: 'modal' | 'page';
}) {
  if (surface === 'page') {
    return (
      <section
        className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--surface-1)] text-[var(--ink)]"
        aria-label="Merge conflict resolver"
      >
        {children}
      </section>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-3">
      <section
        role="dialog"
        aria-modal="true"
        className="flex h-[min(820px,calc(100vh-24px))] w-[min(1180px,calc(100vw-24px))] min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink)] shadow-2xl"
      >
        {children}
      </section>
    </div>
  );
}

export function WorktreeConflictActionButton({
  children,
  disabled,
  icon,
  title,
  variant = 'secondary',
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
  title?: string;
  variant?: 'primary' | 'secondary';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 max-w-full min-w-0 items-center gap-1 rounded-md px-2.5 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary'
          ? 'bg-[var(--primary)] px-3 text-white hover:bg-[var(--primary-hover)]'
          : 'border border-[var(--hairline)] text-[var(--ink-subtle)] hover:bg-[var(--surface-3)] hover:text-[var(--ink)]',
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

export function WorktreeQuickActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="max-w-full truncate whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[11px] font-medium text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
      title={label}
    >
      {label}
    </button>
  );
}

export function WorktreeConflictChoiceCard({
  title,
  description,
  disabled,
  selected,
  selectedIcon,
  onSelect,
}: {
  title: string;
  description: string;
  disabled?: boolean;
  selected: boolean;
  selectedIcon?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex min-w-0 flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40',
        selected
          ? 'border-[var(--primary)] bg-[var(--primary-tint)]'
          : 'border-[var(--hairline)] bg-[var(--surface-1)] hover:bg-[var(--surface-3)]',
      )}
    >
      <span className="flex max-w-full min-w-0 items-center gap-1 text-[12px] font-semibold text-[var(--ink)]">
        {selected ? selectedIcon : null}
        <span className="min-w-0 truncate">{title}</span>
      </span>
      <span className="text-[11px] leading-snug text-[var(--ink-tertiary)]">
        {description}
      </span>
    </button>
  );
}
