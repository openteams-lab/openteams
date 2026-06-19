import React from 'react';
import { Loader2, RotateCcw, Save } from 'lucide-react';

export const inputClassName =
  'provider-input h-8 w-full rounded-[5px] border-0 bg-transparent px-2.5 text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-tertiary)] focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60';

export const technicalInputClassName = `${inputClassName} font-mono`;

export const secondaryButtonClassName =
  'provider-ghost-button inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] border border-transparent bg-transparent px-2 text-[12px] font-medium text-[var(--ink-subtle)] transition-colors hover:bg-[var(--provider-control-hover)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50';

export function ShortcutHint({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="provider-shortcut-hint rounded-[5px] border border-[var(--provider-border-subtle)] px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-[var(--ink-tertiary)]">
      {children}
    </kbd>
  );
}

export function Field({
  children,
  description,
  label,
}: {
  children: React.ReactNode;
  description?: string;
  label: string;
}) {
  return (
    <label className="provider-property-row">
      <span className="provider-property-label">{label}</span>
      <span className="min-w-0 w-full">
        {children}
        {description ? (
          <span className="mt-1 block text-[12px] leading-snug text-[var(--ink-tertiary)]">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function ProviderSaveBar({
  disabled,
  isSaving,
  onDiscard,
  onSave,
  discardLabel,
  saveLabel,
  savingLabel,
}: {
  disabled: boolean;
  isSaving: boolean;
  onDiscard: () => void;
  onSave: () => void;
  discardLabel: string;
  saveLabel: string;
  savingLabel: string;
}) {
  return (
    <div className="provider-save-bar">
      <button
        type="button"
        className="provider-save-bar-button provider-save-bar-discard-button"
        onClick={onDiscard}
        disabled={disabled}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {discardLabel}
      </button>
      <button
        type="button"
        className="provider-save-bar-button"
        onClick={onSave}
        disabled={disabled}
      >
        {isSaving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" />
        )}
        {isSaving ? savingLabel : saveLabel}
      </button>
    </div>
  );
}
