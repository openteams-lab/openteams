import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function CommandSelectMenu({
  align = 'right',
  children,
  className,
  style,
  widthClassName = 'w-[360px]',
}: {
  align?: 'left' | 'right';
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  widthClassName?: string;
}) {
  return (
    <div
      style={style}
      className={cn(
        'absolute top-full z-50 mt-2 max-w-[calc(100vw-32px)] overflow-hidden rounded-[16px] border border-[var(--hairline-strong)] bg-[var(--surface-1)] text-[var(--ink)] shadow-[0_16px_40px_rgba(0,0,0,0.18)]',
        align === 'right' ? 'right-0' : 'left-0',
        widthClassName,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CommandSelectSearchRow({
  onKeyDown,
  placeholder,
  shortcut,
  value,
  onChange,
}: {
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  shortcut: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex h-12 items-center gap-2.5 border-b border-[var(--hairline)] px-4">
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[13px] font-medium leading-normal text-[var(--ink)] caret-[var(--primary)] outline-none placeholder:text-[var(--ink-tertiary)]"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <kbd className="flex h-6 min-w-6 items-center justify-center rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-2)] px-1.5 text-[12px] font-medium leading-normal text-[var(--ink-subtle)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        {shortcut}
      </kbd>
    </div>
  );
}

export function CommandSelectList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'max-h-[220px] space-y-1 overflow-y-auto px-3 py-3 ot-scroll-area-styled',
        className,
      )}
      role="listbox"
    >
      {children}
    </div>
  );
}

export function CommandSelectNoMatches({
  children = 'No matches',
}: {
  children?: ReactNode;
}) {
  return (
    <div className="px-3 py-2.5 text-[13px] font-semibold text-[var(--ink-tertiary)]">
      {children}
    </div>
  );
}
