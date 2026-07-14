import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { Root } from 'react-dom/client';

import type {
  UpdateActionResponse,
  UpdateOperationState,
} from '../../../shared/types';
import type { VersionCheckResponse } from '@/lib/api';
import {
  createVersionUpdateController,
  useVersionUpdate,
  type VersionUpdateAdapter,
  versionUpdateCheckIntervalMs,
  versionUpdateSnoozeMs,
} from './useVersionUpdate';

const release = (latest = '0.5.0'): VersionCheckResponse => ({
  current_version: '0.4.0',
  latest_version: latest,
  has_update: true,
  release_url: 'https://github.com/openteams-lab/openteams/releases/tag/v0.5.0',
  release_notes: null,
  published_at: '2026-07-13T00:00:00Z',
  capability: {
    platform: 'web_npx',
    method: 'npx_staged_restart',
    can_download: true,
    can_install: true,
    requires_restart: true,
    fallback_url: null,
  },
});

const noUpdateRelease = (): VersionCheckResponse => ({
  ...release(),
  current_version: '0.5.0',
  latest_version: '0.5.0',
  has_update: false,
});

const completedState: UpdateOperationState = {
  download_status: 'downloaded',
  install_status: 'completed',
  downloaded_bytes: null,
  total_bytes: null,
  error: null,
};

const action = (state = completedState): UpdateActionResponse => ({
  success: state.error === null,
  message: 'ok',
  state,
});

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

async function main() {
  console.log('version update controller');

  let now = 0;
  const scheduled: Array<() => void> = [];
  let clearCalls = 0;
  let checks = 0;
  const reminders: Array<VersionCheckResponse | null> = [];
  const controller = createVersionUpdateController({
    check: async () => {
      checks += 1;
      return release();
    },
    now: () => now,
    schedule: (callback, delay) => {
      assert.equal(delay, versionUpdateCheckIntervalMs);
      scheduled.push(callback);
      return scheduled.length;
    },
    clearSchedule: () => {
      clearCalls += 1;
    },
    onReminder: (info) => reminders.push(info),
    updateNpx: async () => action(),
    restart: async () => action(),
    installDesktop: async () => completedState,
    openManual: async () => undefined,
  });

  await controller.start();
  assert.equal(checks, 1);
  assert.equal(reminders.filter(Boolean).length, 1);
  assert.equal(scheduled.length, 1);

  controller.snooze();
  now += versionUpdateCheckIntervalMs;
  scheduled[0]();
  await settle();
  assert.equal(reminders.filter(Boolean).length, 1, 'the current-process snooze suppresses hourly reminders');

  now += versionUpdateSnoozeMs;
  scheduled[0]();
  await settle();
  assert.equal(reminders.filter(Boolean).length, 2, 'reminders resume after six hours');

  controller.stop();
  assert.equal(clearCalls, 1, 'unmount clears the one hourly timer');

  let resolveUnmountedCheck: ((value: VersionCheckResponse) => void) | undefined;
  let mountedChanges = 0;
  const unmounted = createVersionUpdateController({
    check: () =>
      new Promise((resolve) => {
        resolveUnmountedCheck = resolve;
      }),
    now: () => now,
    schedule: () => 1,
    clearSchedule: () => undefined,
    onReminder: () => undefined,
    onChange: () => {
      mountedChanges += 1;
    },
    updateNpx: async () => action(),
    restart: async () => action(),
    installDesktop: async () => completedState,
    openManual: async () => undefined,
  });
  const unmountedStart = unmounted.start();
  unmounted.stop();
  const changesBeforeResolution = mountedChanges;
  resolveUnmountedCheck?.(release());
  await unmountedStart;
  assert.equal(mountedChanges, changesBeforeResolution, 'unmounted controllers do not publish late check results');

  let resolveCheck: ((value: VersionCheckResponse) => void) | undefined;
  let concurrentChecks = 0;
  const concurrent = createVersionUpdateController({
    check: () => {
      concurrentChecks += 1;
      return new Promise((resolve) => {
        resolveCheck = resolve;
      });
    },
    now: () => now,
    schedule: () => 1,
    clearSchedule: () => undefined,
    onReminder: () => undefined,
    updateNpx: async () => action(),
    restart: async () => action(),
    installDesktop: async () => completedState,
    openManual: async () => undefined,
  });
  const firstCheck = concurrent.checkNow();
  await concurrent.checkNow();
  assert.equal(concurrentChecks, 1, 'overlapping checks are deduplicated');
  resolveCheck?.(release());
  await firstCheck;

  let retryChecks = 0;
  const retry = createVersionUpdateController({
    check: async () => {
      retryChecks += 1;
      if (retryChecks === 1) throw new Error('offline');
      return release('0.6.0');
    },
    now: () => now,
    schedule: () => 1,
    clearSchedule: () => undefined,
    onReminder: () => undefined,
    updateNpx: async () => action(),
    restart: async () => action(),
    installDesktop: async () => completedState,
    openManual: async () => undefined,
  });
  await retry.checkNow();
  assert.equal(retry.snapshot().checkStatus, 'failed');
  await retry.checkNow();
  assert.equal(retry.snapshot().checkStatus, 'update_available');

  let sameVersionChecks = 0;
  const sameVersionReminders: Array<VersionCheckResponse | null> = [];
  const sameVersion = createVersionUpdateController({
    check: async () => {
      sameVersionChecks += 1;
      return release('0.5.0');
    },
    now: () => now,
    schedule: () => 1,
    clearSchedule: () => undefined,
    onReminder: (info) => sameVersionReminders.push(info),
    updateNpx: async () => action(),
    restart: async () => action(),
    installDesktop: async () => completedState,
    openManual: async () => undefined,
  });
  await sameVersion.checkNow();
  sameVersion.setOperation({
    download_status: 'downloaded',
    install_status: 'failed',
    downloaded_bytes: null,
    total_bytes: null,
    error: { stage: 'restart', code: 'restart_failed', message: 'retry', retryable: true },
  });
  await sameVersion.checkNow();
  assert.equal(sameVersionChecks, 2);
  assert.equal(sameVersion.snapshot().operation?.error?.code, 'restart_failed', 'same release keeps retry state');
  assert.equal(sameVersionReminders.filter(Boolean).length, 1, 'same latest version is reminded only once');

  const noUpdate = createVersionUpdateController({
    check: async () => noUpdateRelease(),
    now: () => now,
    schedule: () => 1,
    clearSchedule: () => undefined,
    onReminder: (info) => assert.equal(info, null),
    updateNpx: async () => action(),
    restart: async () => action(),
    installDesktop: async () => completedState,
    openManual: async () => undefined,
  });
  await noUpdate.checkNow();
  assert.equal(noUpdate.snapshot().checkStatus, 'up_to_date');
  assert.equal(noUpdate.snapshot().reminder, null, 'same current/latest version never reminds');

  const calls: string[] = [];
  const actions = createVersionUpdateController({
    check: async () => release(),
    now: () => now,
    schedule: () => 1,
    clearSchedule: () => undefined,
    onReminder: () => undefined,
    updateNpx: async () => {
      calls.push('stage');
      return action({
        download_status: 'downloaded',
        install_status: 'restart_required',
        downloaded_bytes: null,
        total_bytes: null,
        error: null,
      });
    },
    restart: async () => {
      calls.push('restart');
      return action();
    },
    installDesktop: async () => {
      calls.push('desktop');
      return completedState;
    },
    openManual: async () => {
      calls.push('manual');
    },
  });
  await actions.checkNow();
  await actions.executeUpdate();
  assert.deepEqual(calls, ['stage', 'restart']);

  const npxRetry = createVersionUpdateController({
    check: async () => release(),
    now: () => now,
    schedule: () => 1,
    clearSchedule: () => undefined,
    onReminder: () => undefined,
    updateNpx: async () => {
      calls.push('unexpected-stage');
      return action();
    },
    restart: async () => {
      calls.push('restart-only');
      return action();
    },
    installDesktop: async () => completedState,
    openManual: async () => undefined,
  });
  await npxRetry.checkNow();
  npxRetry.setOperation({
    download_status: 'downloaded',
    install_status: 'failed',
    downloaded_bytes: null,
    total_bytes: null,
    error: { stage: 'restart', code: 'restart_failed', message: 'retry', retryable: true },
  });
  await npxRetry.executeUpdate();
  assert.equal(calls.includes('unexpected-stage'), false, 'restart retry does not re-stage');
  assert.equal(calls.includes('restart-only'), true);

  const versionChecks = [release('0.5.0'), release('0.6.0')];
  const versionChangedCalls: string[] = [];
  const versionChanged = createVersionUpdateController({
    check: async () => versionChecks.shift() as VersionCheckResponse,
    now: () => now,
    schedule: () => 1,
    clearSchedule: () => undefined,
    onReminder: () => undefined,
    updateNpx: async () => {
      versionChangedCalls.push('stage-new-version');
      return action({
        download_status: 'downloaded',
        install_status: 'restart_required',
        downloaded_bytes: null,
        total_bytes: null,
        error: null,
      });
    },
    restart: async () => {
      versionChangedCalls.push('restart');
      return action();
    },
    installDesktop: async () => completedState,
    openManual: async () => undefined,
  });
  await versionChanged.checkNow();
  versionChanged.setOperation({
    download_status: 'downloaded',
    install_status: 'failed',
    downloaded_bytes: null,
    total_bytes: null,
    error: { stage: 'restart', code: 'restart_failed', message: 'old release failed', retryable: true },
  });
  await versionChanged.checkNow();
  assert.equal(versionChanged.snapshot().operation, null, 'a newer release resets old operation state');
  await versionChanged.executeUpdate();
  assert.deepEqual(versionChangedCalls, ['stage-new-version', 'restart'], 'a newer npx release stages before restarting');

  console.log('All version update controller assertions passed.');
}

await main();

async function realHookSnoozeLifecycleTest() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
  })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const adapter: VersionUpdateAdapter = {
    check: async () => release(),
    now: () => 0,
    schedule: () => 1,
    clearSchedule: () => undefined,
    updateNpx: async () => action(),
    restart: async () => action(),
    installDesktop: async () => completedState,
    openManual: async () => undefined,
  };
  const current = { hook: null as ReturnType<typeof useVersionUpdate> | null };
  const Harness = () => {
    current.hook = useVersionUpdate({ onOpenUpdatePage: () => undefined, adapter });
    return null;
  };
  let root: Root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => {
    root.render(createElement(Harness));
    await Promise.resolve();
  });
  assert.equal(current.hook?.reminder?.latest_version, '0.5.0');
  await act(async () => {
    current.hook?.snooze();
  });
  assert.equal(current.hook?.reminder, null, 'the mounted hook applies the process-only snooze');
  await act(async () => {
    root.unmount();
  });

  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => {
    root.render(createElement(Harness));
    await Promise.resolve();
  });
  assert.equal(
    (current.hook as ReturnType<typeof useVersionUpdate> | null)?.reminder?.latest_version,
    '0.5.0',
    'a remounted hook immediately reminds again without persisted snooze',
  );
  await act(async () => {
    root.unmount();
  });
}

await realHookSnoozeLifecycleTest();
