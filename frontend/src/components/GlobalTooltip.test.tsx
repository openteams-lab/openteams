import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalTooltip } from './GlobalTooltip';
import { ShortcutProvider } from '@/shortcuts/ShortcutProvider';

const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div><button data-command-id="search.open" data-tooltip-nowrap title="Search">S</button><button data-tooltip-break-all data-tooltip-hover-only title="/workspace/a-very-long-file-path.ts">F</button></body></html>',
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
      translate={(key) => key}
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
const originalSetTimeout = window.setTimeout;
let scheduledHandler: TimerHandler | undefined;
let scheduledDelay: number | undefined;
window.setTimeout = ((handler: TimerHandler, timeout?: number) => {
  scheduledHandler = handler;
  scheduledDelay = timeout;
  return 1;
}) as typeof window.setTimeout;
await act(async () => {
  trigger.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true }));
});

assert.equal(trigger.hasAttribute('title'), false);
assert.equal(document.querySelector('[role="tooltip"]'), null);
assert.equal(scheduledDelay, 1_200);
await act(async () => {
  if (typeof scheduledHandler === 'function') scheduledHandler();
});

const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
assert.equal(tooltip?.textContent, 'Search ⌘K');
assert.ok(tooltip?.classList.contains('app-tooltip'));
assert.ok(tooltip?.classList.contains('border-[var(--hairline-strong)]'));
assert.ok(tooltip?.classList.contains('bg-[var(--surface-1)]'));
assert.ok(tooltip?.classList.contains('text-[11px]'));
assert.ok(tooltip?.classList.contains('text-[var(--ink)]'));
assert.ok(tooltip?.classList.contains('whitespace-nowrap'));
const shortcut = tooltip?.querySelector<HTMLElement>('span.font-mono');
assert.equal(shortcut?.textContent, '⌘K');
assert.ok(shortcut?.classList.contains('ml-3'));
assert.ok(shortcut?.classList.contains('text-[10px]'));
assert.ok(shortcut?.classList.contains('text-[var(--ink-tertiary)]'));
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

const filePathTrigger = document.querySelectorAll('button')[1];
await act(async () => {
  filePathTrigger.dispatchEvent(
    new window.FocusEvent('focusin', { bubbles: true }),
  );
});
assert.equal(document.querySelector('[role="tooltip"]'), null);
await act(async () => {
  filePathTrigger.dispatchEvent(
    new window.MouseEvent('pointerover', { bubbles: true }),
  );
});
await act(async () => {
  if (typeof scheduledHandler === 'function') scheduledHandler();
});
window.setTimeout = originalSetTimeout;

const filePathTooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
assert.equal(
  filePathTooltip?.textContent,
  '/workspace/a-very-long-file-path.ts',
);
assert.ok(filePathTooltip?.classList.contains('break-all'));
assert.ok(filePathTooltip?.classList.contains('whitespace-normal'));

await act(async () => root.unmount());
console.log('Global tooltip: PASS');
