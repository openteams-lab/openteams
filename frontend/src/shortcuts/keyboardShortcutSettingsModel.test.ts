import assert from 'node:assert/strict';
import { commandRegistry } from './commandRegistry';
import {
  buildShortcutSettingsRows,
  filterShortcutSettingsRows,
} from './keyboardShortcutSettingsModel';

const rows = buildShortcutSettingsRows({
  definitions: commandRegistry,
  titleFor: (definition) => `title:${definition.id}`,
  currentLabelFor: (definition) =>
    definition.id === 'worktree.merge' ? 'Not assigned' : 'Ctrl+K',
  defaultLabelFor: () => 'Ctrl+K',
  modifiedCommandIds: new Set(['search.open']),
  conflictingCommandIds: new Set(['session.create']),
  unboundCommandIds: new Set(['worktree.merge']),
});

assert.equal(rows.length, 49);
assert.equal(new Set(rows.map((row) => row.categoryKey)).size, 9);
assert.deepEqual(
  filterShortcutSettingsRows(rows, {
    query: 'title:search.open',
    filter: 'all',
  }).map((row) => row.id),
  ['search.open'],
);
assert.deepEqual(
  filterShortcutSettingsRows(rows, {
    query: 'ctrl+k',
    filter: 'modified',
  }).map((row) => row.id),
  ['search.open'],
);
assert.deepEqual(
  filterShortcutSettingsRows(rows, { query: '', filter: 'conflict' }).map(
    (row) => row.id,
  ),
  ['session.create'],
);
assert.deepEqual(
  filterShortcutSettingsRows(rows, { query: '', filter: 'unbound' }).map(
    (row) => row.id,
  ),
  ['worktree.merge'],
);
console.log('keyboardShortcutSettingsModel: PASS');
