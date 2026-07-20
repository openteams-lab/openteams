import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('./ConfirmationDialog.tsx', import.meta.url),
  'utf8',
);
const hookSource = readFileSync(
  new URL('./useConfirmationDialogKeyboard.ts', import.meta.url),
  'utf8',
);
const customDialogSources: Array<[string, number]> = [
  [readFileSync(new URL('../pages/TeamPage.tsx', import.meta.url), 'utf8'), 1],
  [
    readFileSync(
      new URL('../pages/TeamTemplatesPage.tsx', import.meta.url),
      'utf8',
    ),
    2,
  ],
  [readFileSync(new URL('./ProjectSidebar.tsx', import.meta.url), 'utf8'), 2],
  [readFileSync(new URL('./SettingsWorkspace.tsx', import.meta.url), 'utf8'), 1],
];

assert.ok(source.includes('useConfirmationDialogKeyboard'));
assert.ok(hookSource.includes("event.key === 'Enter'"));
assert.ok(hookSource.includes('!event.repeat'));
assert.ok(hookSource.includes('!event.isComposing'));
assert.ok(hookSource.includes('event.preventDefault()'));
assert.ok(hookSource.includes('event.stopPropagation()'));
assert.ok(hookSource.includes('onConfirm();'));
assert.ok(hookSource.includes('[confirming, enabled, onCancel, onConfirm]'));
for (const [customDialogSource, expectedCalls] of customDialogSources) {
  assert.equal(
    customDialogSource.match(/useConfirmationDialogKeyboard\(\{/g)?.length,
    expectedCalls,
  );
}

console.log('Confirmation dialog Enter shortcut: PASS');
