import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Config } from '@/types';
import {
  ShortcutProvider,
  useShortcuts,
} from '@/shortcuts/ShortcutProvider';
import { CommandPaletteHintCard } from './CommandPaletteHintCard';

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

const config = {
  keyboard_shortcuts: { schema_version: 1, platform_overrides: {} },
} as unknown as Config;

const t = (
  key: string,
  replacements?: Record<string, string | number>,
) => {
  const shortcut = replacements?.shortcut ?? '';
  return shortcut ? `${key} ${shortcut}` : key;
};

function Harness() {
  const [visible, setVisible] = useState(true);
  const { paletteOpen } = useShortcuts();
  return (
    <>
      <span data-testid="palette-state">{String(paletteOpen)}</span>
      {visible && (
        <CommandPaletteHintCard t={t} onDismiss={() => setVisible(false)} />
      )}
    </>
  );
}

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

const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
assert.ok(dialog, 'hint card is rendered as a blocking alert dialog');
const focusedButton = document.activeElement as HTMLElement;
assert.equal(focusedButton.tagName, 'BUTTON');

const shortcutEvent = new window.KeyboardEvent('keydown', {
  key: 'P',
  code: 'KeyP',
  metaKey: true,
  shiftKey: true,
  bubbles: true,
  cancelable: true,
});
await act(async () => {
  focusedButton.dispatchEvent(shortcutEvent);
});

assert.equal(shortcutEvent.defaultPrevented, true);
assert.equal(
  document.querySelector('[data-testid="palette-state"]')?.textContent,
  'true',
  'the command palette shortcut remains active inside the hint modal',
);
assert.equal(
  document.querySelector('[role="alertdialog"]'),
  null,
  'opening the command palette dismisses the hint card',
);

await act(async () => root.unmount());
console.log('CommandPaletteHintCard shortcut: PASS');
