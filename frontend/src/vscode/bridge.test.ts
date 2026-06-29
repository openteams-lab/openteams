// Smoke tests for the VS Code iframe clipboard bridge.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/vscode/bridge.test.ts
// Exits non-zero if any assertion fails.

import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${label}`, detail ?? '');
  }
};

console.log('VS Code iframe clipboard bridge');

const source = readFileSync(new URL('./bridge.ts', import.meta.url), 'utf8');

check(
  'reads image blobs from navigator.clipboard.read',
  source.includes('async function readClipboardFiles()') &&
    source.includes('navigator.clipboard.read()') &&
    source.includes("type.startsWith('image/')") &&
    source.includes('new File([blob]'),
  source,
);
check(
  'dispatches pasted files back through the editable paste path',
  source.includes('function dispatchClipboardFiles(files: File[])') &&
    source.includes("new ClipboardEvent('paste'") &&
    source.includes('clipboardData: dataTransfer') &&
    source.includes('openteams:vscode-clipboard-files'),
  source,
);
check(
  'handles clipboard files before falling back to text paste',
  source.indexOf('const files = await readClipboardFiles()') >
    source.indexOf('} else if (isPaste(e))') &&
    source.indexOf('const files = await readClipboardFiles()') <
      source.indexOf('let text = await readClipboardText()'),
  source,
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} VS Code clipboard bridge assertion(s) failed.`);
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('\nAll VS Code clipboard bridge assertions passed.');
