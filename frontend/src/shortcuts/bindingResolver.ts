import { contextsMayOverlap } from './contextRules';
import type {
  BindingMergeWarning,
  BindingResolution,
  CommandDefinition,
  EffectiveBinding,
  KeyboardEventSnapshot,
  ResolveBindingInput,
  ShortcutPlatform,
  ShortcutRuntime,
  ShortcutSequence,
} from './types';

const CODE_KEY: Record<string, string> = {
  Comma: 'comma',
  Slash: '/',
  Equal: '=',
  Minus: '-',
};

const NAMED_KEY: Record<string, string> = {
  Enter: 'enter',
  Tab: 'tab',
  Escape: 'escape',
  Esc: 'escape',
  ' ': 'space',
  Spacebar: 'space',
  Delete: 'delete',
  Backspace: 'backspace',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
};

const MODIFIER_ORDER = ['ctrl', 'meta', 'alt', 'shift'] as const;

const normalizeNamedKey = (key: string) => NAMED_KEY[key] ?? null;

const normalizeAsciiKey = (key: string) =>
  key.length === 1 && /^[\x20-\x7e]$/.test(key) ? key.toLowerCase() : null;

export function keyFromLayout(event: KeyboardEventSnapshot): string | null {
  if (event.altGraph) return null;
  if (/^Key[A-Z]$/.test(event.code)) {
    return event.code.slice(3).toLowerCase();
  }
  if (/^Digit[0-9]$/.test(event.code)) {
    return event.code.slice(5);
  }
  if (CODE_KEY[event.code]) {
    return CODE_KEY[event.code];
  }
  if (
    event.key === 'Dead' ||
    event.key === 'Unidentified' ||
    event.key === 'Process'
  ) {
    return null;
  }
  return normalizeNamedKey(event.key) ?? normalizeAsciiKey(event.key);
}

export function normalizeKeyboardEvent(
  event: KeyboardEventSnapshot,
): string | null {
  const key = keyFromLayout(event);
  if (!key) return null;
  const modifiers = MODIFIER_ORDER.filter((modifier) => {
    if (modifier === 'ctrl') return event.ctrlKey;
    if (modifier === 'meta') return event.metaKey;
    if (modifier === 'alt') return event.altKey;
    return event.shiftKey;
  });
  return [...modifiers, key].join('+');
}

export function normalizeSequence(
  sequence: readonly KeyboardEventSnapshot[],
): ShortcutSequence | null {
  const normalized = sequence.map(normalizeKeyboardEvent);
  return normalized.every((stroke): stroke is string => stroke !== null)
    ? normalized
    : null;
}

export function snapshotKeyboardEvent(
  event: KeyboardEvent,
): KeyboardEventSnapshot {
  return {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    altGraph: event.getModifierState('AltGraph'),
  };
}

const sameSequence = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((stroke, index) => stroke === right[index]);

const isPrefix = (left: readonly string[], right: readonly string[]) =>
  left.length < right.length &&
  left.every((stroke, index) => stroke === right[index]);

export function resolveBinding(input: ResolveBindingInput): BindingResolution {
  const stroke = normalizeKeyboardEvent(input.event);
  if (!stroke) return { kind: 'none' };
  const sequence = input.chordPrefix ? [input.chordPrefix, stroke] : [stroke];
  const candidates = input.bindings
    .filter(
      (binding) =>
        input.availableCommandIds.has(binding.commandId) &&
        binding.contexts.some((context) => input.activeContextIds.has(context)),
    )
    .sort(
      (left, right) =>
        right.scopeRank - left.scopeRank ||
        right.registrationOrder - left.registrationOrder ||
        left.commandId.localeCompare(right.commandId),
    );
  const exact = candidates.find((binding) =>
    sameSequence(binding.sequence, sequence),
  );
  if (exact) return { kind: 'execute', commandId: exact.commandId };
  const prefix = candidates.some(
    (binding) =>
      binding.sequence.length === 2 && binding.sequence[0] === sequence[0],
  );
  return prefix && sequence.length === 1
    ? { kind: 'waiting', prefix: stroke, expiresAt: input.now + 1200 }
    : { kind: 'none' };
}

const readOverrideSequence = (value: unknown): ShortcutSequence | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sequence = (value as { sequence?: unknown }).sequence;
  if (
    !Array.isArray(sequence) ||
    sequence.length > 2 ||
    !sequence.every((stroke) => typeof stroke === 'string')
  ) {
    return null;
  }
  return sequence;
};

export function mergeEffectiveBindings(
  definitions: readonly CommandDefinition[],
  platform: ShortcutPlatform,
  overrides: Readonly<Record<string, unknown>>,
): { bindings: EffectiveBinding[]; warnings: BindingMergeWarning[] } {
  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const warnings: BindingMergeWarning[] = [];
  const validOverrides = new Map<string, ShortcutSequence>();

  for (const commandId of Object.keys(overrides).sort()) {
    const sequence = readOverrideSequence(overrides[commandId]);
    if (!sequence) {
      warnings.push({ commandId, kind: 'invalid' });
      continue;
    }
    const definition = definitionsById.get(commandId);
    if (!definition) {
      warnings.push({ commandId, kind: 'unknown' });
      continue;
    }
    validOverrides.set(commandId, sequence);
  }

  const bindings = definitions.flatMap((definition) => {
    const sequences = validOverrides.has(definition.id)
      ? [validOverrides.get(definition.id)!]
      : definition.defaults[platform];
    return sequences
      .filter((sequence) => sequence.length > 0)
      .map((sequence) => ({
        commandId: definition.id,
        sequence,
        contexts: definition.contexts,
        scopeRank: 0,
        registrationOrder: 0,
      }));
  });

  return { bindings, warnings };
}

export type BindingConflict = {
  commandId: string;
  conflictingCommandId: string;
  kind: 'exact' | 'prefix';
};

export function findBindingConflicts(
  candidate: Pick<EffectiveBinding, 'commandId' | 'sequence' | 'contexts'>,
  existing: readonly Pick<
    EffectiveBinding,
    'commandId' | 'sequence' | 'contexts'
  >[],
): BindingConflict[] {
  const conflicts: BindingConflict[] = [];
  for (const binding of existing) {
    if (binding.commandId === candidate.commandId) continue;
    const contextsOverlap = candidate.contexts.some((left) =>
      binding.contexts.some((right) => contextsMayOverlap(left, right)),
    );
    if (!contextsOverlap) continue;
    const kind = sameSequence(candidate.sequence, binding.sequence)
      ? 'exact'
      : isPrefix(candidate.sequence, binding.sequence) ||
          isPrefix(binding.sequence, candidate.sequence)
        ? 'prefix'
        : null;
    if (kind) {
      conflicts.push({
        commandId: candidate.commandId,
        conflictingCommandId: binding.commandId,
        kind,
      });
    }
  }
  return conflicts;
}

export type ReservedBindingResult =
  | { kind: 'allowed' }
  | { kind: 'blocked'; reasonKey: string }
  | { kind: 'warning'; reasonKey: string };

const isOneOf = (
  sequence: ShortcutSequence,
  candidates: readonly ShortcutSequence[],
) => candidates.some((candidate) => sameSequence(sequence, candidate));

export function reservedBindingResult(
  sequence: ShortcutSequence,
  runtime: Pick<ShortcutRuntime, 'platform' | 'isDesktopShell'>,
): ReservedBindingResult {
  const blocked =
    runtime.platform === 'macos'
      ? [['meta+space'], ['meta+tab'], ['meta+q']]
      : [['alt+tab'], ['ctrl+alt+delete'], ['meta+l']];
  if (isOneOf(sequence, blocked)) {
    return { kind: 'blocked', reasonKey: 'shortcuts.error.systemReserved' };
  }
  const browserOwned = [
    ['ctrl+tab'],
    ['ctrl+shift+tab'],
    ['ctrl+w'],
    ['meta+w'],
  ];
  if (!runtime.isDesktopShell && isOneOf(sequence, browserOwned)) {
    return { kind: 'warning', reasonKey: 'shortcuts.warning.browserReserved' };
  }
  return { kind: 'allowed' };
}
