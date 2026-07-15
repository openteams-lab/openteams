import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalTooltip } from './GlobalTooltip';
import { ShortcutProvider } from '@/shortcuts/ShortcutProvider';

const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div><button data-command-id="search.open" title="Search">S</button></body></html>',
  { url: 'http://localhost' },
);
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  HTMLIFrameElement: dom.window.HTMLIFrameElement,
  Node: dom.window.Node,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  FocusEvent: dom.window.FocusEvent,
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const root = createRoot(document.getElementById('root')!);
await act(async () =>
  root.render(
    <ShortcutProvider
      runtime={{ platform: 'macos', isDesktopShell: false, source: 'fallback' }}
      translate={(key, replacements) =>
        key === 'shortcuts.tooltip.shortcut'
          ? `Shortcut: ${replacements?.shortcut}`
          : key
      }
      config={null}
      saveConfigPatch={async () => {
        throw new Error('not used');
      }}
      showToast={() => undefined}
    >
      <GlobalTooltip />
    </ShortcutProvider>,
  ),
);

const trigger = document.querySelector('button')!;
await act(async () => {
  trigger.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true }));
});

const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
assert.equal(trigger.hasAttribute('title'), false);
assert.equal(tooltip?.textContent, 'Search (Shortcut: ⌘K)');
assert.ok(tooltip?.classList.contains('app-tooltip'));
assert.ok(trigger.getAttribute('aria-describedby')?.includes(tooltip?.id ?? ''));

await act(async () => {
  trigger.dispatchEvent(
    new window.MouseEvent('pointerout', {
      bubbles: true,
      relatedTarget: document.body,
    }),
  );
});
assert.equal(trigger.getAttribute('title'), 'Search');
assert.equal(document.querySelector('[role="tooltip"]'), null);

await act(async () => root.unmount());
console.log('Global tooltip: PASS');
