import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { type Root } from 'react-dom/client';

import type {
  UpdateActionResponse,
  UpdateCapability,
  UpdateOperationState,
} from '../../../shared/types';
import type { VersionCheckResponse } from '@/lib/api';
import {
  useVersionUpdate,
  type VersionUpdateAdapter,
} from './useVersionUpdate';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
});
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event,
})) {
  Object.defineProperty(globalThis, key, { value, configurable: true });
}
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');

const complete: UpdateOperationState = {
  download_status: 'downloaded',
  install_status: 'completed',
  downloaded_bytes: null,
  total_bytes: null,
  error: null,
};

const response = (capability: UpdateCapability): VersionCheckResponse => ({
  current_version: '0.4.0',
  latest_version: '0.5.0',
  has_update: true,
  release_url: 'https://github.com/openteams-lab/openteams/releases/tag/v0.5.0',
  release_notes: null,
  published_at: '2026-07-13T00:00:00Z',
  capability,
});

const action = (state = complete): UpdateActionResponse => ({
  success: state.error === null,
  message: 'ok',
  state,
});

type HookValue = ReturnType<typeof useVersionUpdate>;
let root: Root | null = null;
let value: HookValue | null = null;

const renderHook = async (
  adapter: VersionUpdateAdapter,
  onOpenUpdatePage = () => undefined,
) => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
  }
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  const Harness = () => {
    value = useVersionUpdate({ onOpenUpdatePage, adapter });
    return null;
  };
  await act(async () => {
    root?.render(<Harness />);
  });
};

async function main() {
  console.log('useVersionUpdate React hook');

  let resolveFirstCheck: ((info: VersionCheckResponse) => void) | undefined;
  const timers: Array<() => void> = [];
  const npxCapability: UpdateCapability = {
    platform: 'web_npx', method: 'npx_staged_restart', can_download: true,
    can_install: true, requires_restart: true, fallback_url: null,
  };
  const pendingAdapter: VersionUpdateAdapter = {
    check: () => new Promise((resolve) => { resolveFirstCheck = resolve; }),
    now: () => 0,
    schedule: (callback) => { timers.push(callback); return timers.length; },
    clearSchedule: () => undefined,
    updateNpx: async () => action(),
    restart: async () => action(),
    installDesktop: async () => complete,
    openManual: async () => undefined,
  };
  await renderHook(pendingAdapter);
  assert.equal(timers.length, 1, 'the hourly timer starts on mount before an initial check resolves');
  await act(async () => { resolveFirstCheck?.(response(npxCapability)); });
  assert.equal(value?.reminder?.latest_version, '0.5.0');

  let navigated = 0;
  await act(async () => { value?.openUpdatePage(); });
  assert.equal(navigated, 0, 'the first harness has no navigation callback');

  const npxCalls: string[] = [];
  await renderHook({
    ...pendingAdapter,
    check: async () => response(npxCapability),
    updateNpx: async () => {
      npxCalls.push('stage');
      return action({ ...complete, install_status: 'restart_required' });
    },
    restart: async () => { npxCalls.push('restart'); return action(); },
  });
  await act(async () => { await value?.executeUpdate(); });
  assert.deepEqual(npxCalls, ['stage', 'restart'], 'Web/npx uses the staged restart flow');
  await act(async () => { await value?.executeUpdate(); });
  assert.deepEqual(npxCalls, ['stage', 'restart'], 'a completed npx restart cannot run the staged update again');

  const desktopCalls: string[] = [];
  const desktopCapability: UpdateCapability = {
    platform: 'macos', method: 'tauri_updater', can_download: true,
    can_install: true, requires_restart: true, fallback_url: 'https://github.com/openteams-lab/openteams/releases/download/v0.5.0/app.tar.gz',
  };
  await renderHook({
    ...pendingAdapter,
    check: async () => response(desktopCapability),
    installDesktop: async () => { desktopCalls.push('tauri'); return complete; },
  }, () => { navigated += 1; });
  await act(async () => { value?.openUpdatePage(); });
  assert.equal(navigated, 1, 'toast navigation opens the update page without installing');
  await act(async () => { await value?.executeUpdate(); });
  assert.deepEqual(desktopCalls, ['tauri'], 'macOS/AppImage capability uses the desktop bridge');
  await act(async () => { await value?.executeUpdate(); });
  assert.deepEqual(desktopCalls, ['tauri'], 'a completed desktop install cannot be invoked again');

  let installAttempts = 0;
  await renderHook({
    ...pendingAdapter,
    check: async () => response(desktopCapability),
    installDesktop: async (onStateChange) => {
      installAttempts += 1;
      if (installAttempts === 1) {
        onStateChange({
          download_status: 'failed', install_status: 'failed', downloaded_bytes: null,
          total_bytes: null,
          error: { stage: 'install', code: 'desktop_update_install_failed', message: 'Desktop install failed.', retryable: true },
        });
        throw new Error('Desktop install failed.');
      }
      return complete;
    },
    openManual: async () => { desktopCalls.push('fallback'); },
  });
  await act(async () => { await value?.executeUpdate().catch(() => undefined); });
  assert.equal(value?.manualFallbackAvailable, true, 'a retryable Tauri failure exposes manual fallback');
  await act(async () => { await value?.executeUpdate(); });
  assert.equal(installAttempts, 2, 'Tauri retry invokes the desktop updater again');
  await act(async () => { await value?.openManualFallback(); });
  assert.equal(desktopCalls.includes('fallback'), true, 'manual fallback remains user-triggered');

  let resolveInstall: ((state: UpdateOperationState) => void) | undefined;
  let duplicateAttempts = 0;
  await renderHook({
    ...pendingAdapter,
    check: async () => response({ ...desktopCapability, platform: 'linux_appimage' }),
    installDesktop: async () => {
      duplicateAttempts += 1;
      return new Promise((resolve) => { resolveInstall = resolve; });
    },
  });
  let firstInstall: Promise<void> | undefined;
  let secondInstall: Promise<void> | undefined;
  await act(async () => {
    firstInstall = value?.executeUpdate();
    secondInstall = value?.executeUpdate();
    await Promise.resolve();
  });
  assert.equal(duplicateAttempts, 1, 'a second update click does not start a duplicate AppImage install');
  resolveInstall?.(complete);
  await act(async () => { await Promise.all([firstInstall, secondInstall]); });

  const manualCalls: string[] = [];
  const debCapability: UpdateCapability = {
    platform: 'linux_deb', method: 'manual_download', can_download: true,
    can_install: false, requires_restart: false,
    fallback_url: 'https://github.com/openteams-lab/openteams/releases/download/v0.5.0/openteams.deb',
  };
  await renderHook({
    ...pendingAdapter,
    check: async () => response(debCapability),
    openManual: async () => { manualCalls.push('manual'); },
  });
  await act(async () => { await value?.executeUpdate(); });
  assert.deepEqual(manualCalls, ['manual'], 'deb capability opens the trusted manual download');
  await act(async () => { await value?.executeUpdate(); });
  assert.deepEqual(manualCalls, ['manual'], 'a completed manual download cannot be opened again');

  const unavailableManualCalls: string[] = [];
  await renderHook({
    ...pendingAdapter,
    check: async () => response({
      platform: 'linux_deb', method: 'manual_download', can_download: false,
      can_install: false, requires_restart: false, fallback_url: null,
    }),
    openManual: async () => { unavailableManualCalls.push('manual'); },
  });
  await act(async () => { await value?.executeUpdate(); });
  assert.deepEqual(unavailableManualCalls, [], 'a missing matching installer never opens the generic release URL');
  assert.equal(value?.operation?.error?.code, 'manual_installer_unavailable');
  assert.equal(value?.operation?.error?.stage, 'download');
  assert.equal(value?.operation?.error?.retryable, true);

  const unsupportedCalls: string[] = [];
  await renderHook({
    ...pendingAdapter,
    check: async () => response({
      platform: 'unknown', method: 'unsupported', can_download: false,
      can_install: false, requires_restart: false, fallback_url: null,
    }),
    updateNpx: async () => { unsupportedCalls.push('npx'); return action(); },
    installDesktop: async () => { unsupportedCalls.push('desktop'); return complete; },
    openManual: async () => { unsupportedCalls.push('manual'); },
  });
  await act(async () => { await value?.executeUpdate(); });
  assert.deepEqual(unsupportedCalls, [], 'unsupported platforms do not invoke an update action');

  await act(async () => { root?.unmount(); });
  console.log('All useVersionUpdate React hook assertions passed.');
}

await main();
