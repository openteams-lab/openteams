import React from 'react';
import { formatShortcutSequence } from './Keycap';
import { useShortcuts } from './ShortcutProvider';

export function ChordHintOverlay() {
  const { chord, effectiveBindings, presentationFor, runtime } = useShortcuts();
  if (!chord) return null;
  const candidates = effectiveBindings.filter(
    (binding) => binding.sequence.length === 2 && binding.sequence[0] === chord.prefix,
  );
  return (
    <div
      data-chord-hint
      aria-live="polite"
      className="fixed bottom-5 left-1/2 z-[75] -translate-x-1/2 rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-1)] px-4 py-2 text-sm text-[var(--ink)] shadow-xl"
    >
      {candidates.map((binding) => (
        <span key={`${binding.commandId}-${binding.sequence.join(':')}`} className="mr-4 last:mr-0">
          {formatShortcutSequence(binding.sequence, runtime.platform, (key) => key)} —{' '}
          {presentationFor(binding.commandId).title}
        </span>
      ))}
    </div>
  );
}
