import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useShortcuts } from './ShortcutProvider';

export function CommandPalette() {
  const {
    definitions,
    executeCommand,
    paletteOpen,
    presentationFor,
    setPaletteOpen,
  } = useShortcuts();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!paletteOpen) return;
    setQuery('');
    queueMicrotask(() => inputRef.current?.focus());
  }, [paletteOpen]);
  const commands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return definitions.filter((command) => {
      if (!normalized) return true;
      const presentation = presentationFor(command.id);
      return `${presentation.title} ${presentation.label}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [definitions, presentationFor, query]);
  if (!paletteOpen) return null;
  return (
    <div className="fixed inset-0 z-[70] flex justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-[2px]">
      <div
        data-command-palette
        role="dialog"
        aria-modal="true"
        className="flex h-fit max-h-[70vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[14px] border border-[var(--hairline-strong)] bg-[var(--surface-1)] text-[var(--ink)] shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
      >
        <input
          ref={inputRef}
          data-command-search
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setPaletteOpen(false);
          }}
          placeholder={presentationFor('commandPalette.open').title}
          className="h-12 w-full shrink-0 border-b border-[var(--hairline)] bg-[var(--surface-1)] px-4 text-[14px] text-[var(--ink)] caret-[var(--primary)] outline-none placeholder:text-[var(--ink-tertiary)] focus:bg-[var(--surface-2)]"
        />
        <div className="max-h-[min(55vh,480px)] overflow-y-auto p-1.5 ot-scroll-area-styled">
          {commands.map((command) => {
            const presentation = presentationFor(command.id);
            return (
              <button
                key={command.id}
                data-command-id={command.id}
                disabled={Boolean(presentation.disabledReason)}
                onClick={() => {
                  void executeCommand(command.id).then((executed) => {
                    if (executed) setPaletteOpen(false);
                  });
                }}
                className="flex min-h-9 w-full items-center justify-between gap-4 rounded-[8px] px-3 py-2 text-left text-[13px] text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:text-[var(--ink-tertiary)] disabled:opacity-55"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {presentation.title}
                </span>
                <span className="shrink-0 rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[10px] leading-none text-[var(--ink-subtle)]">
                  {presentation.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
