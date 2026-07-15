import { AlertTriangle, X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

export type ConfirmationDialogTone = 'warning' | 'danger';

type ConfirmationDialogProps = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  escLabel: string;
  tone?: ConfirmationDialogTone;
  confirming?: boolean;
  idPrefix?: string;
  confirmIcon?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  escLabel,
  tone = 'warning',
  confirming = false,
  idPrefix = 'confirmation-dialog',
  confirmIcon,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  const isDanger = tone === 'danger';
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-desc`;
  const escKey = escLabel.startsWith('Esc') ? 'Esc' : escLabel;
  const escHelp = escLabel.startsWith('Esc') ? escLabel.slice(3).trim() : '';

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirming) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (
        event.key === 'Enter' &&
        !event.repeat &&
        !event.isComposing &&
        !confirming
      ) {
        event.preventDefault();
        event.stopPropagation();
        onConfirm();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirming, onCancel, onConfirm]);

  return (
    <div
      className="fixed inset-0 z-[1002] flex items-center justify-center p-4"
      role="presentation"
    >
      <button
        type="button"
        aria-label={cancelLabel}
        className="absolute inset-0 bg-black/55 backdrop-blur-xs"
        disabled={confirming}
        onClick={onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-[500px] overflow-hidden rounded-[16px] border border-[var(--hairline)] bg-[var(--surface-1)] font-sans text-[var(--ink)] shadow-[0_24px_80px_rgba(0,0,0,0.28)] select-none"
        style={{
          fontFamily: "Inter, sans-serif",
        }}
      >
        <div className="relative px-8 pb-7 pt-8">
          <div
            className={`mb-5 flex h-8 w-8 items-center justify-center rounded-[8px] ${
              isDanger ? 'bg-red-500/10' : 'bg-amber-500/10'
            }`}
          >
            <AlertTriangle
              strokeWidth={1.8}
              className={`h-[18px] w-[18px] ${
                isDanger ? 'text-red-500' : 'text-amber-500'
              }`}
            />
          </div>
          <div className="min-w-0">
            <p
              id={titleId}
              className="text-[18px] font-semibold leading-[1.2] text-[var(--ink)]"
            >
              {title}
            </p>
            <div
              id={descriptionId}
              className="mt-3 text-[13px] leading-[1.55] text-[var(--ink-subtle)]"
            >
              {description}
            </div>
          </div>
          <button
            type="button"
            disabled={confirming}
            onClick={onCancel}
            className="absolute right-6 top-6 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={cancelLabel}
            title={cancelLabel}
          >
            <X className="h-[13px] w-[13px]" strokeWidth={1.6} />
          </button>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--hairline)] bg-[var(--surface-2)] px-8 py-4">
          <span className="flex items-center gap-2 text-[12px] text-[var(--ink-tertiary)]">
            <kbd className="rounded-[5px] border border-[var(--hairline)] bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--ink-subtle)]">
              {escKey}
            </kbd>
            {escHelp && <span>{escHelp}</span>}
          </span>
          <div className="flex gap-2.5">
            <button
              type="button"
              className="h-9 cursor-pointer rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] px-4 text-[13px] font-medium text-[var(--ink-muted)] transition hover:border-[var(--hairline-strong)] hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={confirming}
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`flex h-9 cursor-pointer items-center gap-2 rounded-[8px] border px-4 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4 ${
                isDanger
                  ? 'border-red-500/25 bg-red-600 hover:bg-red-500'
                  : 'border-[var(--primary)] bg-[var(--primary)] hover:bg-[var(--primary-hover)]'
              }`}
              disabled={confirming}
              onClick={onConfirm}
            >
              {confirmIcon}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
