import React, { useEffect, useRef } from 'react';
import { useShortcuts } from './ShortcutProvider';

export function ShortcutHelpDialog() {
  const {
    definitions,
    helpOpen,
    presentationFor,
    setHelpOpen,
  } = useShortcuts();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!helpOpen) return;

    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setHelpOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [helpOpen, setHelpOpen]);

  if (!helpOpen) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
      <div
        data-shortcut-help
        role="dialog"
        aria-modal="true"
        className="flex max-h-[min(80vh,720px)] w-full max-w-[760px] flex-col overflow-hidden rounded-[14px] border border-[var(--hairline-strong)] bg-[var(--surface-1)] text-[var(--ink)] shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--hairline)] px-5 py-4">
          <h2 className="text-[16px] font-semibold text-[var(--ink)]">
            {presentationFor('shortcuts.help.open').title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setHelpOpen(false)}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[18px] leading-none text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-focus)]"
          >
            ×
          </button>
        </div>
        <div className="grid min-h-0 gap-0.5 overflow-y-auto p-2 ot-scroll-area-styled">
          {definitions.map((command) => {
            const presentation = presentationFor(command.id);
            return (
              <div
                key={command.id}
                data-command-id={command.id}
                className="flex min-h-10 items-center justify-between gap-4 rounded-[8px] px-3 py-2 text-[13px] transition-colors hover:bg-[var(--surface-2)]"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-[var(--ink-muted)]">
                  {presentation.title}
                </span>
                <span className="shrink-0 rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[10px] leading-none text-[var(--ink-subtle)]">
                  {presentation.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
