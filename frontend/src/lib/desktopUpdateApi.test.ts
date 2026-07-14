import assert from 'node:assert/strict';

import type { UpdateOperationState } from '../../../shared/types';

type TauriListener = (event: {
  event: string;
  payload: unknown;
  id: number;
  windowLabel?: string;
}) => void;

type TauriGlobalWindow = {
  __TAURI__?: {
    invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    event?: {
      listen?: (event: string, handler: TauriListener) => Promise<() => void>;
    };
  };
};

const globalWindowHolder = globalThis as {
  window?: TauriGlobalWindow;
};
const originalWindow = globalWindowHolder.window;

const importDesktopUpdateApi = async () =>
  import(`./desktopUpdateApi.ts?test=${Date.now()}`);

async function main() {
  console.log('desktop update API');

  globalWindowHolder.window = {
    __TAURI__: {
      invoke: async (command) => {
        assert.equal(command, 'get_desktop_update_context');
        return { platform: 'linux_appimage', architecture: 'x86_64' };
      },
    },
  };
  const { desktopUpdateApi: contextApi } = await importDesktopUpdateApi();
  assert.deepEqual(await contextApi.getContext(), {
    platform: 'linux_appimage',
    architecture: 'x86_64',
  });

  const events = new Map<string, TauriListener>();
  let unlistenCalls = 0;
  let commandInvoked = '';
  let resolveInstall: ((value: UpdateOperationState) => void) | null = null;
  const observedStates: UpdateOperationState[] = [];

  globalWindowHolder.window = {
    __TAURI__: {
      invoke: async (command) => {
        commandInvoked = command;
        return await new Promise<UpdateOperationState>((resolve) => {
          resolveInstall = resolve;
        });
      },
      event: {
        listen: async (event, handler) => {
          events.set(event, handler);
          return () => {
            unlistenCalls += 1;
            events.delete(event);
          };
        },
      },
    },
  };

  const { desktopUpdateApi } = await importDesktopUpdateApi();
  const installPromise = desktopUpdateApi.install((state: UpdateOperationState) => {
    observedStates.push(state);
  });

  for (let attempt = 0; attempt < 5 && !resolveInstall; attempt += 1) {
    await Promise.resolve();
  }
  assert.equal(commandInvoked, 'install_desktop_update');
  events.get('tauri://update-status')?.({
    event: 'tauri://update-status',
    id: 1,
    payload: { status: 'PENDING', error: null },
  });
  events.get('tauri://update-download-progress')?.({
    event: 'tauri://update-download-progress',
    id: 2,
    payload: { chunkLength: 50, contentLength: 100 },
  });
  events.get('tauri://update-download-progress')?.({
    event: 'tauri://update-download-progress',
    id: 3,
    payload: { chunkLength: 25, contentLength: 100 },
  });
  events.get('tauri://update-status')?.({
    event: 'tauri://update-status',
    id: 4,
    payload: { status: 'DOWNLOADED', error: null },
  });

  if (!resolveInstall) {
    throw new Error('install resolver was not captured');
  }
  const completeInstall = resolveInstall as (value: UpdateOperationState) => void;
  completeInstall({
    download_status: 'downloaded',
    install_status: 'completed',
    downloaded_bytes: 75,
    total_bytes: 100,
    error: null,
  });

  const completedState = await installPromise;
  assert.equal(completedState.downloaded_bytes, 75);
  assert.equal(completedState.total_bytes, 100);
  assert.equal(observedStates[0]?.download_status, 'downloading');
  assert.equal(observedStates[1]?.downloaded_bytes, 50);
  assert.equal(observedStates[2]?.downloaded_bytes, 75);
  assert.equal(observedStates[3]?.install_status, 'installing');
  assert.equal(unlistenCalls, 2);
  assert.equal(events.size, 0);

  const errorEvents = new Map<string, TauriListener>();
  globalWindowHolder.window = {
    __TAURI__: {
      invoke: async () => {
        throw { stage: 'install', code: 'desktop_update_install_failed', message: 'boom', retryable: true };
      },
      event: {
        listen: async (event, handler) => {
          errorEvents.set(event, handler);
          return () => {
            errorEvents.delete(event);
          };
        },
      },
    },
  };

  const { DesktopUpdateError, desktopUpdateApi: errorApi } =
    await importDesktopUpdateApi();
  const errorStates: UpdateOperationState[] = [];

  await assert.rejects(
    () => errorApi.install((state: UpdateOperationState) => errorStates.push(state)),
    (error: unknown) => {
      assert(error instanceof DesktopUpdateError);
      assert.equal(
        (error as InstanceType<typeof DesktopUpdateError>).state.install_status,
        'failed',
      );
      assert.equal(
        (error as InstanceType<typeof DesktopUpdateError>).state.error?.code,
        'desktop_update_install_failed',
      );
      return true;
    },
  );
  assert.equal(errorStates.at(-1)?.install_status, 'failed');

  const normalizedEvents = new Map<string, TauriListener>();
  let rejectInstall: ((reason?: unknown) => void) | null = null;
  globalWindowHolder.window = {
    __TAURI__: {
      invoke: async () =>
        await new Promise<UpdateOperationState>((_resolve, reject) => {
          rejectInstall = reject;
        }),
      event: {
        listen: async (event, handler) => {
          normalizedEvents.set(event, handler);
          return () => {
            normalizedEvents.delete(event);
          };
        },
      },
    },
  };

  const { desktopUpdateApi: normalizedApi } = await importDesktopUpdateApi();
  const normalizedStates: UpdateOperationState[] = [];
  const normalizedPromise = normalizedApi.install((state: UpdateOperationState) => {
    normalizedStates.push(state);
  });

  for (
    let attempt = 0;
    attempt < 5 && (normalizedEvents.size === 0 || !rejectInstall);
    attempt += 1
  ) {
    await Promise.resolve();
  }
  normalizedEvents.get('tauri://update-status')?.({
    event: 'tauri://update-status',
    id: 5,
    payload: { status: 'PENDING', error: null },
  });
  normalizedEvents.get('tauri://update-download-progress')?.({
    event: 'tauri://update-download-progress',
    id: 6,
    payload: { chunkLength: 20, contentLength: 80 },
  });
  normalizedEvents.get('tauri://update-status')?.({
    event: 'tauri://update-status',
    id: 7,
    payload: { status: 'ERROR', error: 'network failed' },
  });
  if (!rejectInstall) {
    throw new Error('install rejection handler was not captured');
  }
  const failInstall = rejectInstall as (reason?: unknown) => void;
  failInstall(new Error('invoke failed'));

  await assert.rejects(
    () => normalizedPromise,
    (error: unknown) => {
      assert(error instanceof Error);
      return true;
    },
  );
  assert.equal(normalizedStates.at(-1)?.download_status, 'failed');
  assert.equal(
    normalizedStates.at(-1)?.error?.code,
    'desktop_update_download_failed',
  );
  assert.equal(normalizedStates.at(-1)?.downloaded_bytes, 20);

  let partialUnlistenCalls = 0;
  const subscriptionStates: UpdateOperationState[] = [];
  globalWindowHolder.window = {
    __TAURI__: {
      invoke: async () => ({
        download_status: 'downloaded',
        install_status: 'completed',
        downloaded_bytes: null,
        total_bytes: null,
        error: null,
      }),
      event: {
        listen: async (event) => {
          if (event === 'tauri://update-status') {
            return () => {
              partialUnlistenCalls += 1;
            };
          }
          throw new Error('listen failed');
        },
      },
    },
  };

  const {
    DesktopUpdateError: subscriptionDesktopUpdateError,
    desktopUpdateApi: subscriptionApi,
  } = await importDesktopUpdateApi();

  await assert.rejects(
    () =>
      subscriptionApi.install((state: UpdateOperationState) => {
        subscriptionStates.push(state);
      }),
    (error: unknown) => {
      assert(error instanceof subscriptionDesktopUpdateError);
      const updateError = error as InstanceType<typeof subscriptionDesktopUpdateError>;
      assert.equal(updateError.state.download_status, 'idle');
      assert.equal(updateError.state.install_status, 'failed');
      assert.equal(
        updateError.state.error?.code,
        'desktop_update_event_subscribe_failed',
      );
      return true;
    },
  );
  assert.equal(partialUnlistenCalls, 1);
  assert.equal(subscriptionStates.at(-1)?.error?.code, 'desktop_update_event_subscribe_failed');

  globalWindowHolder.window = originalWindow;
  console.log('All desktop update API assertions passed.');
}

await main();
