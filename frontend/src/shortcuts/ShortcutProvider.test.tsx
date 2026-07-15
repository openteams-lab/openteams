import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { useRef } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Config } from '@/types';
import {
  ShortcutProvider,
  useCommandHandler,
  useCommandPresentation,
  useShortcutScope,
} from './ShortcutProvider';

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
const calls: string[] = [];

function RegistrationHarness() {
  const outerRef = useRef<HTMLDivElement>(null);
  useShortcutScope('source-control-list', {
    active: true,
    rootRef: outerRef,
  });
  useCommandHandler('search.open', {
    scope: 'global',
    enabled: true,
    execute: () => {
      calls.push('global');
    },
  });
  useCommandHandler('search.open', {
    scope: 'page',
    enabled: true,
    execute: () => {
      calls.push('page');
    },
  });
  useCommandHandler('source-control.selection.open-diff', {
    scope: 'focused-component',
    contexts: ['source-control-list'],
    enabled: true,
    execute: () => {
      calls.push('diff');
    },
  });
  return (
    <div>
      <div ref={outerRef}>
        <button data-testid="inside">inside</button>
      </div>
      <button data-testid="outside">outside</button>
    </div>
  );
}

function DynamicHarness({
  enabled,
  allowInEditable,
}: {
  enabled: boolean;
  allowInEditable: boolean;
}) {
  const commitRef = useRef<HTMLInputElement>(null);
  useShortcutScope('source-control-commit', {
    active: true,
    rootRef: commitRef,
  });
  useCommandHandler('search.open', {
    scope: 'global',
    enabled,
    disabledReason: enabled ? undefined : 'search-disabled-now',
    execute: () => {
      calls.push('dynamic-search');
    },
  });
  useCommandHandler('source-control.commit', {
    scope: 'focused-component',
    contexts: ['source-control-commit'],
    enabled: true,
    allowInEditable,
    ownsEventTarget: (target) => target === commitRef.current,
    execute: () => {
      calls.push('dynamic-commit');
    },
  });
  const presentation = useCommandPresentation('search.open');
  return (
    <div>
      <input ref={commitRef} data-testid="dynamic-commit" />
      <span data-testid="dynamic-reason">
        {presentation.disabledReason ?? ''}
      </span>
    </div>
  );
}

function PlanModeHarness() {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useShortcutScope('chat-composer', {
    active: true,
    rootRef: composerRef,
  });
  useCommandHandler('session.plan-mode.toggle', {
    scope: 'focused-component',
    enabled: true,
    allowInEditable: true,
    ownsEventTarget: (target) => target === composerRef.current,
    execute: () => {
      calls.push('plan-mode');
    },
  });
  return (
    <div>
      <textarea ref={composerRef} data-testid="plan-mode-composer" />
      <textarea data-testid="other-composer" />
    </div>
  );
}

const press = (target: EventTarget, init: KeyboardEventInit) => {
  const event = new window.KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

const provider = (
  child: React.ReactNode,
  providerConfig: Config | null = config,
) => (
  <ShortcutProvider
    runtime={{ platform: 'macos', isDesktopShell: true, source: 'server' }}
    translate={(key) => key}
    config={providerConfig}
    saveConfigPatch={async (patch) => ({ ...config, ...patch })}
    showToast={() => undefined}
  >
    {child}
  </ShortcutProvider>
);

const root = createRoot(document.getElementById('root')!);
await act(async () => {
  root.render(provider(<RegistrationHarness />, null));
});
assert.ok(
  document.querySelector('[data-testid="inside"]'),
  'null config keeps shortcut hooks inside provider',
);

await act(async () => {
  root.render(provider(<RegistrationHarness />));
});

press(document.body, { key: 'k', code: 'KeyK', metaKey: true });
await act(async () => undefined);
assert.deepEqual(calls, ['page'], 'highest scope wins exactly once');

const inside = document.querySelector<HTMLElement>('[data-testid="inside"]')!;
inside.focus();
press(inside, { key: 'Enter', code: 'Enter' });
await act(async () => undefined);
assert.deepEqual(calls, ['page', 'diff']);

const outside = document.querySelector<HTMLElement>('[data-testid="outside"]')!;
outside.focus();
press(outside, { key: 'Enter', code: 'Enter' });
await act(async () => undefined);
assert.deepEqual(calls, ['page', 'diff'], 'focused scope ignores outside target');

calls.length = 0;
await act(async () => {
  root.render(
    provider(<DynamicHarness enabled={false} allowInEditable={false} />),
  );
});
assert.equal(
  document.querySelector('[data-testid="dynamic-reason"]')?.textContent,
  'search-disabled-now',
);
press(document.body, { key: 'k', code: 'KeyK', metaKey: true });
const dynamicCommit = document.querySelector<HTMLInputElement>(
  '[data-testid="dynamic-commit"]',
)!;
dynamicCommit.focus();
press(dynamicCommit, { key: 'Enter', code: 'Enter', metaKey: true });
await act(async () => undefined);
assert.deepEqual(calls, [], 'disabled and editable guards use current values');

await act(async () => {
  root.render(provider(<DynamicHarness enabled allowInEditable />));
});
press(document.body, { key: 'k', code: 'KeyK', metaKey: true });
dynamicCommit.focus();
press(dynamicCommit, { key: 'Enter', code: 'Enter', metaKey: true });
await act(async () => undefined);
assert.deepEqual(calls, ['dynamic-search', 'dynamic-commit']);

calls.length = 0;
await act(async () => {
  root.render(provider(<PlanModeHarness />));
});
const planModeComposer = document.querySelector<HTMLTextAreaElement>(
  '[data-testid="plan-mode-composer"]',
)!;
const otherComposer = document.querySelector<HTMLTextAreaElement>(
  '[data-testid="other-composer"]',
)!;
let planModeEvent: KeyboardEvent;
await act(async () => {
  press(otherComposer, { key: 'Tab', code: 'Tab', shiftKey: true });
  planModeEvent = press(planModeComposer, {
    key: 'Tab',
    code: 'Tab',
    shiftKey: true,
  });
});
assert.deepEqual(calls, ['plan-mode']);
assert.equal(planModeEvent!.defaultPrevented, true);

await act(async () => root.unmount());
calls.length = 0;
press(document.body, { key: 'k', code: 'KeyK', metaKey: true });
assert.deepEqual(calls, [], 'unmount unregisters handlers');
console.log('ShortcutProvider registrations: PASS');
