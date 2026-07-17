import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatShortcutSequences } from './Keycap';

const translate = (key: string) =>
  ({
    'shortcuts.unbound': 'Not assigned',
  })[key] ?? key;
assert.equal(
  formatShortcutSequences([['meta+shift+p']], 'macos', translate),
  '⌘⇧P',
);
assert.equal(
  formatShortcutSequences([['ctrl+shift+p']], 'windows', translate),
  'Ctrl+Shift+P',
);
assert.equal(
  formatShortcutSequences([['ctrl+shift+p']], 'linux', translate),
  'Ctrl+Shift+P',
);
const chordLabel = formatShortcutSequences([['c', 'p']], 'windows', translate);
assert.ok(chordLabel.includes('C') && chordLabel.includes('P'));
assert.equal(chordLabel.includes('C+P'), false);
assert.equal(formatShortcutSequences([], 'macos', translate), 'Not assigned');

const tooltip = readFileSync(
  new URL('./CommandTooltip.tsx', import.meta.url),
  'utf8',
);
const palette = readFileSync(
  new URL('./CommandPalette.tsx', import.meta.url),
  'utf8',
);
const help = readFileSync(
  new URL('./ShortcutHelpDialog.tsx', import.meta.url),
  'utf8',
);
const chord = readFileSync(
  new URL('./ChordHintOverlay.tsx', import.meta.url),
  'utf8',
);
assert.ok(tooltip.includes('useCommandPresentation(commandId)'));
assert.ok(tooltip.includes('role="tooltip"'));
assert.ok(tooltip.includes("'aria-describedby': describedBy"));
assert.ok(
  tooltip.includes("'aria-keyshortcuts': presentation.ariaKeyShortcuts"),
);
assert.ok(tooltip.includes('onPointerEnter'));
assert.ok(tooltip.includes('onFocusCapture'));
assert.equal(tooltip.includes('title={presentation.tooltip}'), false);
assert.ok(tooltip.includes('{presentation.title}'));
assert.ok(tooltip.includes('{presentation.label}'));
assert.ok(tooltip.includes('presentation.sequence.length > 0'));
assert.ok(tooltip.includes('ml-3 font-mono text-[10px]'));
assert.ok(tooltip.includes('text-[var(--ink-tertiary)]'));
assert.ok(tooltip.includes('className="app-tooltip command-tooltip'));
assert.equal(tooltip.includes('bg-zinc-900'), false);
assert.ok(palette.includes('data-command-palette'));
assert.ok(palette.includes('data-command-search'));
assert.ok(palette.includes('data-command-id={command.id}'));
assert.ok(palette.includes('executeCommand(command.id'));
assert.ok(palette.includes('flex h-fit max-h-[70vh]'));
assert.ok(palette.includes('bg-[var(--surface-1)]'));
assert.equal(palette.includes('bg-white'), false);
assert.ok(help.includes('data-shortcut-help'));
assert.ok(help.includes('data-command-id={command.id}'));
assert.ok(help.includes("window.addEventListener('keydown', handleKeyDown, true)"));
assert.ok(help.includes("if (event.key !== 'Escape') return"));
assert.ok(help.includes('closeButtonRef.current?.focus({ preventScroll: true })'));
assert.ok(help.includes('ref={closeButtonRef}'));
assert.ok(help.includes('bg-[var(--surface-1)]'));
assert.ok(help.includes('overflow-y-auto p-2 ot-scroll-area-styled'));
assert.equal(help.includes('bg-white'), false);
assert.ok(chord.includes('data-chord-hint'));
assert.ok(chord.includes('aria-live="polite"'));
assert.ok(chord.includes('bg-[var(--surface-1)]'));
assert.ok(chord.includes('text-[var(--ink)]'));
assert.ok(chord.includes('border-[var(--hairline-strong)]'));
assert.equal(chord.includes('bg-zinc-900'), false);
assert.equal(chord.includes('.focus()'), false);
console.log('Shortcut discoverability: PASS');
