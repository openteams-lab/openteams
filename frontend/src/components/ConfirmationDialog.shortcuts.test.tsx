import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('./ConfirmationDialog.tsx', import.meta.url),
  'utf8',
);

assert.ok(source.includes("event.key === 'Enter'"));
assert.ok(source.includes('!event.repeat'));
assert.ok(source.includes('!event.isComposing'));
assert.ok(source.includes('event.preventDefault()'));
assert.ok(source.includes('event.stopPropagation()'));
assert.ok(source.includes('onConfirm();'));
assert.ok(source.includes('[confirming, onCancel, onConfirm]'));

console.log('Confirmation dialog Enter shortcut: PASS');
