import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { Config } from '@/types';

const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: 'http://localhost',
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLIFrameElement: dom.window.HTMLIFrameElement,
  KeyboardEvent: dom.window.KeyboardEvent,
  FocusEvent: dom.window.FocusEvent,
  Event: dom.window.Event,
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { KeyboardShortcutSettings } = await import(
  './KeyboardShortcutSettings'
);
const { commandRegistry } = await import('./commandRegistry');
const { ShortcutProvider, useCommandHandler } = await import(
  './ShortcutProvider'
);

const translate = (
  key: string,
  replacements?: Record<string, string | number>,
) =>
  replacements?.command ? `${key}:${String(replacements.command)}` : key;
const config = {
  keyboard_shortcuts: {
    schema_version: 1,
    platform_overrides: {
      macos: {
        'shortcuts.settings.open': { sequence: ['alt+h'] },
      },
    },
  },
} as unknown as Config;
let releaseSave!: () => void;
const saveGate = new Promise<void>((resolve) => {
  releaseSave = resolve;
});
let searchCalls = 0;
function Harness() {
  useCommandHandler('search.open', {
    scope: 'global',
    enabled: true,
    execute: () => {
      searchCalls += 1;
    },
  });
  return <KeyboardShortcutSettings translate={translate} />;
}
const root = createRoot(document.getElementById('root')!);
await act(async () => {
  root.render(
    <ShortcutProvider
      runtime={{ platform: 'macos', isDesktopShell: true, source: 'server' }}
      translate={translate}
      config={config}
      saveConfigPatch={async (patch) => {
        await saveGate;
        return { ...config, ...patch };
      }}
      showToast={() => undefined}
    >
      <Harness />
    </ShortcutProvider>,
  );
});

assert.equal(
  document.querySelectorAll('[data-command-id]').length,
  commandRegistry.length,
);
assert.equal(
  document.querySelector(
    '[data-command-id="shortcuts.settings.open"] [data-shortcut-binding]',
  )?.textContent,
  '⌥H',
);
const reset = document.querySelector<HTMLElement>(
  '[data-command-id="shortcuts.settings.open"] [data-shortcut-reset]',
)!;
assert.equal(reset.classList.contains('whitespace-nowrap'), true);
assert.equal(reset.classList.contains('shrink-0'), true);
const search = document.querySelector<HTMLInputElement>(
  '[data-shortcut-search]',
)!;
assert.equal(document.activeElement, search);
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(search, 'search.open');
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
});
const visibleIds = [
  ...document.querySelectorAll<HTMLElement>('[data-command-id]'),
].map((row) => row.dataset.commandId);
assert.deepEqual(visibleIds, ['search.open']);
assert.equal(
  document.querySelector(
    '[data-command-id="search.open"] [data-shortcut-edit]',
  ) !== null,
  true,
);
const binding = document.querySelector<HTMLElement>(
  '[data-command-id="search.open"] [data-shortcut-binding]',
)!;
assert.equal(binding.textContent, '⌘K');
assert.equal(binding.classList.contains('text-center'), true);
assert.equal(binding.classList.contains('text-xs'), true);
assert.equal(binding.classList.contains('text-[var(--ink-subtle)]'), true);

const row = document.querySelector<HTMLElement>(
  '[data-command-id="search.open"]',
)!;
const edit = row.querySelector<HTMLButtonElement>('[data-shortcut-edit]')!;
await act(async () => edit.click());
let recorder = row.querySelector<HTMLElement>('[data-shortcut-recorder]')!;
assert.equal(document.activeElement, recorder);
assert.equal(recorder.parentElement, binding);
assert.equal(recorder.textContent, 'shortcuts.recorder.recording');
assert.equal(recorder.classList.contains('rounded-full'), true);
assert.equal(recorder.classList.contains('text-[var(--ink-subtle)]'), true);
assert.equal(recorder.classList.contains('text-blue-700'), false);
assert.equal(row.querySelectorAll('[data-shortcut-recorder]').length, 1);
await act(async () => {
  recorder.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'n',
      code: 'KeyN',
      metaKey: true,
    }),
  );
});
assert.equal(
  row.querySelector('[data-shortcut-conflict]')?.textContent,
  'shortcuts.conflict.blocking:shortcuts.command.session.create',
);
const replaceConflict = row.querySelector<HTMLElement>(
  '[data-shortcut-replace]',
)!;
assert.equal(replaceConflict.classList.contains('border'), true);
assert.equal(replaceConflict.classList.contains('text-amber-600'), false);
assert.equal(replaceConflict.classList.contains('whitespace-nowrap'), true);
assert.equal(edit.classList.contains('whitespace-nowrap'), true);
assert.equal(replaceConflict.className, edit.className);
assert.equal(replaceConflict.nextElementSibling, edit);
assert.equal(row.textContent?.includes('shortcuts.action.remove'), false);
await act(async () => {
  recorder.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
      code: 'Escape',
    }),
  );
});
assert.equal(row.querySelector('[data-shortcut-recorder]'), null);
await act(async () => edit.click());
recorder = row.querySelector<HTMLElement>('[data-shortcut-recorder]')!;
await act(async () => {
  recorder.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: '7',
      code: 'Digit7',
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
    }),
  );
  await Promise.resolve();
});
assert.equal(binding.textContent, '⌃⌥⇧7');
assert.equal(row.querySelector('[data-shortcut-recorder]'), null);
assert.equal(row.textContent?.includes('shortcuts.filter.modified'), false);
await act(async () => {
  document.body.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: '7',
      code: 'Digit7',
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
    }),
  );
});
assert.equal(searchCalls, 1);
await act(async () => {
  releaseSave();
  await saveGate;
  await Promise.resolve();
});

await act(async () => root.unmount());
console.log('KeyboardShortcutSettings readonly: PASS');
