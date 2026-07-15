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
const { ShortcutProvider } = await import('./ShortcutProvider');

const translate = (key: string) => key;
const config = {
  keyboard_shortcuts: { schema_version: 1, platform_overrides: {} },
} as unknown as Config;
const root = createRoot(document.getElementById('root')!);
await act(async () => {
  root.render(
    <ShortcutProvider
      runtime={{ platform: 'macos', isDesktopShell: true, source: 'server' }}
      translate={translate}
      config={config}
      saveConfigPatch={async (patch) => ({ ...config, ...patch })}
      showToast={() => undefined}
    >
      <KeyboardShortcutSettings translate={translate} />
    </ShortcutProvider>,
  );
});

assert.equal(document.querySelectorAll('[data-command-id]').length, 49);
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

await act(async () => root.unmount());
console.log('KeyboardShortcutSettings readonly: PASS');
