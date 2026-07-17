import assert from 'node:assert/strict';
import { commandRegistry } from './commandRegistry';
import { expectedCommandRegistry } from './commandRegistry.test-fixture';

assert.equal(expectedCommandRegistry.length, 57);
assert.equal(new Set(expectedCommandRegistry.map((item) => item.id)).size, 57);
assert.deepEqual(commandRegistry, expectedCommandRegistry);
assert.equal(new Set(commandRegistry.map((item) => item.id)).size, 57);
assert.deepEqual(
  [
    ...new Set(
      commandRegistry
        .map((item) => item.featureGroup)
        .filter((value): value is number => value !== null),
    ),
  ].sort((a, b) => a - b),
  Array.from({ length: 18 }, (_, index) => index + 1),
);
assert.deepEqual(
  commandRegistry
    .filter((item) =>
      Object.values(item.defaults).every((sequences) => sequences.length === 0),
    )
    .map((item) => item.id)
    .sort(),
  [
    'shortcuts.settings.open',
    'source-control.stage-all',
    'workflow.stop',
    'worktree.discard',
    'worktree.merge',
  ],
);
for (const definition of commandRegistry) {
  assert.equal(definition.titleKey, `shortcuts.command.${definition.id}`);
  assert.ok(definition.categoryKey.startsWith('shortcuts.category.'));
  assert.ok(definition.contexts.length > 0);
  assert.ok(definition.focusResult.length > 0);
  assert.equal(definition.customizable, true);
}
assert.deepEqual(commandRegistry.find((item) => item.id === 'search.open')?.defaults, {
  macos: [['meta+k']],
  windows: [['ctrl+k']],
  linux: [['ctrl+k']],
});
assert.deepEqual(
  commandRegistry.find((item) => item.id === 'session.plan-mode.toggle')?.defaults,
  {
    macos: [['shift+tab']],
    windows: [['shift+tab']],
    linux: [['shift+tab']],
  },
);
assert.deepEqual(
  commandRegistry.find((item) => item.id === 'workflow.start')?.defaults,
  {
    macos: [['meta+enter']],
    windows: [['ctrl+enter']],
    linux: [['ctrl+enter']],
  },
);
assert.deepEqual(
  commandRegistry.find((item) => item.id === 'workflow.node.retry')?.defaults,
  {
    macos: [['meta+r']],
    windows: [['ctrl+r']],
    linux: [['ctrl+r']],
  },
);
console.log('commandRegistry: PASS');
