import React from 'react';
import { Loader2 } from 'lucide-react';

export type WorktreeActionButtonTone = 'primary' | 'ghost' | 'danger';

interface WorktreeActionButtonProps {
  label: string;
  title?: string;
  tone: WorktreeActionButtonTone;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}

const toneClassName: Record<WorktreeActionButtonTone, string> = {
  primary:
    'bg-[color-mix(in_srgb,var(--primary)_9%,transparent)] text-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_14%,transparent)]',
  danger:
    'text-[var(--ink-subtle)] hover:bg-rose-500/10 hover:text-rose-600',
  ghost:
    'text-[var(--ink-subtle)] hover:bg-[var(--surface-3)] hover:text-[var(--ink)]',
};

export const WorktreeActionButton: React.FC<WorktreeActionButtonProps> = ({
  label,
  title,
  tone,
  busy,
  disabled = false,
  onClick,
  icon,
}) => (
  <button
    type="button"
    className={`inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-[5px] px-1.5 text-[11px] font-medium leading-none transition disabled:cursor-not-allowed disabled:opacity-40 ${toneClassName[tone]}`}
    disabled={disabled || busy}
    onClick={onClick}
    title={title ?? label}
  >
    {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : icon}
    <span className="min-w-0 truncate">{label}</span>
  </button>
);
