import {
  AlertCircle,
  CheckCircle2,
  Info,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

export type NotificationToastTone =
  | 'info'
  | 'success'
  | 'warning'
  | 'error';

export interface NotificationToastProps {
  title?: string;
  message: string;
  tone?: NotificationToastTone;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  onClose?: () => void;
  closeAriaLabel?: string;
  className?: string;
}

const toneStyles = {
  info: {
    icon: Info,
    accent: 'text-[var(--primary)]',
    background: 'bg-[var(--primary-tint)]',
    border: 'border-[var(--primary)]/35',
  },
  success: {
    icon: CheckCircle2,
    accent: 'text-[var(--success)]',
    background: 'bg-[var(--success)]/10',
    border: 'border-[var(--success)]/30',
  },
  warning: {
    icon: AlertCircle,
    accent: 'text-amber-400',
    background: 'bg-amber-400/10',
    border: 'border-amber-400/30',
  },
  error: {
    icon: XCircle,
    accent: 'text-red-400',
    background: 'bg-red-400/10',
    border: 'border-red-400/30',
  },
} satisfies Record<
  NotificationToastTone,
  {
    icon: LucideIcon;
    accent: string;
    background: string;
    border: string;
  }
>;

const cn = (...classes: Array<string | false | undefined>) =>
  classes.filter(Boolean).join(' ');

export function NotificationToast({
  title,
  message,
  tone = 'info',
  icon,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  onClose,
  closeAriaLabel = 'Dismiss notification',
  className,
}: NotificationToastProps) {
  const style = toneStyles[tone];
  const Icon = style.icon;
  const liveRole = tone === 'error' || tone === 'warning' ? 'alert' : 'status';

  return (
    <aside
      role={liveRole}
      aria-live={liveRole === 'alert' ? 'assertive' : 'polite'}
      className={cn(
        'fixed bottom-5 right-5 z-[70] inline-flex w-fit max-w-[min(360px,calc(100vw-40px))] items-start gap-3 rounded-lg border bg-[var(--surface-1)] px-4 py-3 text-[var(--ink)] shadow-[0_18px_45px_rgba(0,0,0,0.28)] animate-fade-in-up',
        style.border,
        className,
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border',
          style.background,
          style.border,
          style.accent,
        )}
      >
        {icon ?? <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0 max-w-full">
        {title && (
          <span className="block truncate text-[13px] font-semibold leading-tight">
            {title}
          </span>
        )}
        <span className="mt-1 block break-words text-[12px] leading-relaxed text-[var(--ink-subtle)]">
          {message}
        </span>
        {(actionLabel && onAction) || (secondaryActionLabel && onSecondaryAction) ? (
          <span className="mt-2 flex items-center gap-3">
            {actionLabel && onAction && (
              <button
                type="button"
                className={cn(
                  'text-[12px] font-semibold leading-none transition hover:text-[var(--ink)]',
                  style.accent,
                )}
                onClick={onAction}
              >
                {actionLabel}
              </button>
            )}
            {secondaryActionLabel && onSecondaryAction && (
              <button
                type="button"
                className="text-[12px] font-medium leading-none text-[var(--ink-subtle)] transition hover:text-[var(--ink)]"
                onClick={onSecondaryAction}
              >
                {secondaryActionLabel}
              </button>
            )}
          </span>
        ) : null}
      </span>
      {onClose && (
        <button
          type="button"
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
          aria-label={closeAriaLabel}
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </aside>
  );
}
