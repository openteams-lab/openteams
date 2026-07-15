import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardShortcutOverride } from '../../../shared/types';
import {
  findBindingConflicts,
  reservedBindingResult,
  type BindingConflict,
} from './bindingResolver';
import { KeybindingRecorder } from './KeybindingRecorder';
import { formatShortcutSequences } from './Keycap';
import { useShortcuts } from './ShortcutProvider';
import {
  buildShortcutSettingsRows,
  filterShortcutSettingsRows,
  type ShortcutSettingsFilter,
} from './keyboardShortcutSettingsModel';
import type { ShortcutSequence, ShortcutTranslate } from './types';

export function replaceConflictingBinding(
  current: Record<string, KeyboardShortcutOverride>,
  commandId: string,
  sequence: ShortcutSequence,
  conflictingCommandId: string,
) {
  return {
    ...current,
    [commandId]: { sequence: [...sequence] },
    [conflictingCommandId]: { sequence: [] },
  };
}

export async function persistOverrideSet<T>(
  next: Record<string, KeyboardShortcutOverride>,
  save: (overrides: Record<string, KeyboardShortcutOverride>) => Promise<T>,
) {
  return save(next);
}

export function KeyboardShortcutSettings({
  translate,
}: {
  translate: ShortcutTranslate;
}) {
  const {
    definitions,
    effectiveBindings,
    platformOverrides,
    presentationFor,
    runtime,
    savePlatformOverrides,
  } = useShortcuts();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ShortcutSettingsFilter>('all');
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null);
  const [recordedSequence, setRecordedSequence] =
    useState<ShortcutSequence | null>(null);
  const [pendingConflict, setPendingConflict] =
    useState<BindingConflict | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => searchInputRef.current?.focus(), []);

  const conflictingCommandIds = useMemo(() => {
    const result = new Set<string>();
    for (const candidate of effectiveBindings) {
      const conflicts = findBindingConflicts(
        candidate,
        effectiveBindings.filter(
          (binding) => binding.commandId !== candidate.commandId,
        ),
      );
      if (conflicts.length > 0) result.add(candidate.commandId);
    }
    return result;
  }, [effectiveBindings]);

  const rows = useMemo(() => {
    const boundCommandIds = new Set(
      effectiveBindings.map((binding) => binding.commandId),
    );
    return buildShortcutSettingsRows({
      definitions,
      titleFor: (definition) => translate(definition.titleKey),
      currentLabelFor: (definition) => presentationFor(definition.id).label,
      defaultLabelFor: (definition) =>
        formatShortcutSequences(
          definition.defaults[runtime.platform],
          runtime.platform,
          translate,
        ),
      modifiedCommandIds: new Set(Object.keys(platformOverrides)),
      conflictingCommandIds,
      unboundCommandIds: new Set(
        definitions
          .filter((definition) => !boundCommandIds.has(definition.id))
          .map((definition) => definition.id),
      ),
    });
  }, [
    conflictingCommandIds,
    definitions,
    effectiveBindings,
    platformOverrides,
    presentationFor,
    runtime.platform,
    translate,
  ]);
  const visibleRows = filterShortcutSettingsRows(rows, { query, filter });

  const closeRecorder = () => {
    setEditingCommandId(null);
    setRecordedSequence(null);
    setPendingConflict(null);
    setSaveError(null);
  };

  const saveRecordedSequence = async (
    commandId: string,
    sequence: ShortcutSequence,
    conflictingCommandId?: string,
  ) => {
    const next = conflictingCommandId
      ? replaceConflictingBinding(
          platformOverrides,
          commandId,
          sequence,
          conflictingCommandId,
        )
      : {
          ...platformOverrides,
          [commandId]: { sequence: [...sequence] },
        };
    setSaveError(null);
    closeRecorder();
    try {
      await persistOverrideSet(next, savePlatformOverrides);
    } catch {
      setSaveError(translate('shortcuts.error.saveFailed'));
    }
  };

  const handleRecordedSequence = (
    commandId: string,
    sequence: ShortcutSequence,
  ) => {
    const definition = definitions.find((item) => item.id === commandId)!;
    const reserved = reservedBindingResult(sequence, runtime);
    if (reserved.kind === 'blocked') {
      setSaveError(translate('shortcuts.reason.unavailable'));
      return;
    }
    if (reserved.kind === 'warning') {
      setSaveError(translate('shortcuts.warning.browserConflict'));
    }
    const conflicts = findBindingConflicts(
      { commandId, sequence, contexts: definition.contexts },
      effectiveBindings.filter((binding) => binding.commandId !== commandId),
    );
    setRecordedSequence(sequence);
    if (conflicts[0]) {
      setPendingConflict(conflicts[0]);
      return;
    }
    void saveRecordedSequence(commandId, sequence);
  };

  const restoreCommand = async (commandId: string) => {
    const next = { ...platformOverrides };
    delete next[commandId];
    try {
      await persistOverrideSet(next, savePlatformOverrides);
      closeRecorder();
    } catch {
      setSaveError(translate('shortcuts.error.saveFailed'));
    }
  };

  return (
    <section aria-label={translate('shortcuts.settings.title')}>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          ref={searchInputRef}
          data-shortcut-search
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          aria-label={translate('shortcuts.search.placeholder')}
          placeholder={translate('shortcuts.search.placeholder')}
          className="min-w-56 flex-1 rounded-md border border-[var(--hairline)] bg-transparent px-3 py-2 text-sm outline-none"
        />
        <select
          value={filter}
          onChange={(event) =>
            setFilter(event.currentTarget.value as ShortcutSettingsFilter)
          }
          aria-label={translate('shortcuts.filter.all')}
          className="rounded-md border border-[var(--hairline)] bg-transparent px-3 py-2 text-sm"
        >
          {(['all', 'modified', 'conflict', 'unbound'] as const).map(
            (value) => (
              <option key={value} value={value}>
                {translate(`shortcuts.filter.${value}`)}
              </option>
            ),
          )}
        </select>
        <button
          type="button"
          onClick={() => {
            void persistOverrideSet({}, savePlatformOverrides).catch(() =>
              setSaveError(translate('shortcuts.error.saveFailed')),
            );
          }}
          className="rounded-md border border-[var(--hairline)] px-3 py-2 text-sm"
        >
          {translate('shortcuts.action.resetAll')}
        </button>
      </div>

      {saveError && (
        <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
          {saveError}
        </p>
      )}

      <div className="divide-y divide-[var(--hairline)] rounded-lg border border-[var(--hairline)]">
        {visibleRows.map((row) => (
          <div key={row.id} data-command-id={row.id} className="p-3">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)_minmax(0,1fr)] items-center gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{row.title}</div>
              </div>
              <div
                data-shortcut-binding
                className="text-center text-xs font-medium text-[var(--ink-subtle)]"
              >
                {editingCommandId === row.id ? (
                  <KeybindingRecorder
                    active
                    translate={translate}
                    onComplete={(sequence) =>
                      handleRecordedSequence(row.id, sequence)
                    }
                    onCancel={closeRecorder}
                  />
                ) : (
                  row.currentLabel
                )}
              </div>
              <div className="flex min-w-0 items-center justify-end gap-2">
                {editingCommandId === row.id &&
                  pendingConflict &&
                  recordedSequence && (
                  <button
                    type="button"
                    data-shortcut-replace
                    onClick={() =>
                      void saveRecordedSequence(
                        row.id,
                        recordedSequence,
                        pendingConflict.conflictingCommandId,
                      )
                    }
                    className="shrink-0 whitespace-nowrap rounded border border-[var(--hairline)] px-2 py-1 text-xs"
                  >
                    {translate('shortcuts.action.replace')}
                  </button>
                )}
                <button
                  type="button"
                  data-shortcut-edit
                  onClick={() => {
                    setEditingCommandId(row.id);
                    setPendingConflict(null);
                    setSaveError(null);
                  }}
                  className="shrink-0 whitespace-nowrap rounded border border-[var(--hairline)] px-2 py-1 text-xs"
                >
                  {translate('shortcuts.action.record')}
                </button>
                {row.modified && (
                  <button
                    type="button"
                    data-shortcut-reset
                    onClick={() => void restoreCommand(row.id)}
                    className="shrink-0 whitespace-nowrap rounded border border-[var(--hairline)] px-2 py-1 text-xs"
                  >
                    {translate('shortcuts.action.reset')}
                  </button>
                )}
              </div>
            </div>
            {editingCommandId === row.id &&
              pendingConflict &&
              recordedSequence && (
              <p
                data-shortcut-conflict
                role="status"
                className="mt-3 text-xs text-amber-600 dark:text-amber-400"
              >
                {translate('shortcuts.conflict.blocking', {
                  command: presentationFor(
                    pendingConflict.conflictingCommandId,
                  ).title,
                })}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
