import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Config } from '@/types';
import { normalizeSequence } from './bindingResolver';
import { KeybindingRecorder } from './KeybindingRecorder';
import { ShortcutProvider, useCommandHandler } from './ShortcutProvider';

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

assert.deepEqual(
  normalizeSequence([
    {
      key: 'с',
      code: 'KeyC',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      altGraph: false,
    },
    {
      key: 'P',
      code: 'KeyP',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: true,
      altGraph: false,
    },
  ]),
  ['c', 'shift+p'],
  'recorded sequences use the shared physical-layout normalizer',
);
assert.deepEqual(
  normalizeSequence([
    {
      key: 'Dead',
      code: 'KeyE',
      ctrlKey: false,
      metaKey: false,
      altKey: true,
      shiftKey: false,
      altGraph: false,
    },
  ]),
  ['alt+e'],
  'physical key codes keep Option shortcuts recordable when macOS reports Dead',
);

const press = (target: EventTarget, init: KeyboardEventInit) => {
  const event = new window.KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

const completed: string[][] = [];
let cancelled = 0;
let searchCalls = 0;
let pageKeyDownCalls = 0;
function Harness() {
  useCommandHandler('search.open', {
    scope: 'global',
    enabled: true,
    execute: () => {
      searchCalls += 1;
    },
  });
  return (
    <div
      onKeyDown={(event) => {
        pageKeyDownCalls += 1;
        event.stopPropagation();
      }}
    >
      <KeybindingRecorder
        active
        translate={(key) => key}
        onComplete={(sequence) => completed.push([...sequence])}
        onCancel={() => {
          cancelled += 1;
        }}
      />
    </div>
  );
}

const config = {
  keyboard_shortcuts: { schema_version: 1, platform_overrides: {} },
} as unknown as Config;
const root = createRoot(document.getElementById('root')!);
await act(async () => {
  root.render(
    <ShortcutProvider
      runtime={{ platform: 'macos', isDesktopShell: true, source: 'server' }}
      translate={(key) => key}
      config={config}
      saveConfigPatch={async (patch) => ({ ...config, ...patch })}
      showToast={() => undefined}
    >
      <Harness />
    </ShortcutProvider>,
  );
});

const recorder = document.querySelector<HTMLElement>(
  '[data-shortcut-recorder]',
)!;
let leakedWindowEvents = 0;
const leakedListener = () => {
  leakedWindowEvents += 1;
};
window.addEventListener('keydown', leakedListener);
const metaK = press(recorder, { key: 'k', code: 'KeyK', metaKey: true });
await act(async () => undefined);
assert.equal(metaK.defaultPrevented, true);
assert.deepEqual(completed.shift(), ['meta+k']);
assert.equal(searchCalls, 0);
assert.equal(leakedWindowEvents, 0);
assert.equal(pageKeyDownCalls, 0);

press(recorder, { key: 'Dead', code: 'KeyE', altKey: true });
await act(async () => undefined);
assert.deepEqual(completed.shift(), ['alt+e']);

press(recorder, { key: 'x', code: 'KeyX' });
press(recorder, { key: 'p', code: 'KeyP' });
await act(async () => undefined);
assert.deepEqual(completed.shift(), ['x', 'p']);

press(recorder, { key: 'q', code: 'KeyQ' });
press(recorder, { key: 'Enter', code: 'Enter' });
await act(async () => undefined);
assert.deepEqual(completed.shift(), ['q']);

press(recorder, { key: 'Escape', code: 'Escape' });
assert.equal(cancelled, 1);
press(recorder, { key: 'm', code: 'KeyM' });
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1250));
});
assert.deepEqual(completed.shift(), ['m']);

window.removeEventListener('keydown', leakedListener);
await act(async () => root.unmount());
console.log('KeybindingRecorder: PASS');
