import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type {
  UpdateErrorInfo,
  UpdateOperationState,
} from '../../../shared/types';
import { UpdateApiError, type UpdateActionResponse } from './api';
import { runNpxStagedRestart } from './npxUpdateFlow';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const actionResponse = (
  state: UpdateOperationState,
  message = 'ok',
): UpdateActionResponse => ({
  success: state.error === null,
  message,
  state,
});

const updateError = (
  stage: UpdateErrorInfo['stage'],
  code: string,
  message: string,
): UpdateErrorInfo => ({
  stage,
  code,
  message,
  retryable: true,
});

const actionError = (
  state: UpdateOperationState,
  message: string,
): UpdateApiError<UpdateActionResponse> =>
  new UpdateApiError(message, 502, actionResponse(state, message));

const restartRequiredState: UpdateOperationState = {
  download_status: 'downloaded',
  install_status: 'restart_required',
  downloaded_bytes: null,
  total_bytes: null,
  error: null,
};

const completedState: UpdateOperationState = {
  download_status: 'downloaded',
  install_status: 'completed',
  downloaded_bytes: null,
  total_bytes: null,
  error: null,
};

async function main() {
  console.log('desktop update integration');

  const freshCalls: string[] = [];
  const freshStates: UpdateOperationState[] = [];
  let installStartedCount = 0;
  let readinessChecks = 0;

  const freshResult = await runNpxStagedRestart({
    currentState: null,
    setVersionUpdateState: (state) => freshStates.push(state),
    notifyInstallStarted: () => {
      installStartedCount += 1;
    },
    updateNpx: async () => {
      freshCalls.push('updateNpx');
      return actionResponse(restartRequiredState, 'staged');
    },
    restart: async () => {
      freshCalls.push('restart');
      return actionResponse(completedState, 'restarted');
    },
    waitForService: async () => {
      readinessChecks += 1;
    },
  });

  assert.deepEqual(freshCalls, ['updateNpx', 'restart']);
  assert.equal(installStartedCount, 1);
  assert.deepEqual(freshStates, [restartRequiredState, completedState]);
  assert.deepEqual(freshResult, completedState);
  assert.equal(readinessChecks, 1, 'npx restart waits for the replacement service to become ready');

  const serviceUnavailableState: UpdateOperationState = {
    download_status: 'downloaded',
    install_status: 'failed',
    downloaded_bytes: null,
    total_bytes: null,
    error: updateError('restart', 'restart_service_unavailable', 'Updated service did not become ready',),
  };
  const serviceUnavailable = new UpdateApiError(
    'Updated service did not become ready',
    503,
    actionResponse(serviceUnavailableState, 'Updated service did not become ready'),
  );
  const serviceFailureStates: UpdateOperationState[] = [];
  await assert.rejects(
    () => runNpxStagedRestart({
      currentState: restartRequiredState,
      setVersionUpdateState: (state) => serviceFailureStates.push(state),
      notifyInstallStarted: () => {
        throw new Error('service readiness retry must not re-stage update');
      },
      updateNpx: async () => {
        throw new Error('service readiness retry must not call updateNpx');
      },
      restart: async () => actionResponse(completedState, 'restarted'),
      waitForService: async () => {
        throw serviceUnavailable;
      },
    }),
    (error: unknown) => error === serviceUnavailable,
  );
  assert.deepEqual(serviceFailureStates, [completedState, serviceUnavailableState]);

  const recoveredCalls: string[] = [];
  await runNpxStagedRestart({
    currentState: serviceUnavailableState,
    setVersionUpdateState: () => undefined,
    notifyInstallStarted: () => {
      throw new Error('service recovery retry must not re-stage update');
    },
    updateNpx: async () => {
      throw new Error('service recovery retry must not call updateNpx');
    },
    restart: async () => {
      recoveredCalls.push('restart');
      return actionResponse(completedState, 'restarted');
    },
    waitForService: async () => {
      recoveredCalls.push('ready');
    },
  });
  assert.deepEqual(recoveredCalls, ['restart', 'ready']);

  const retryCalls: string[] = [];
  const retryStates: UpdateOperationState[] = [];

  await runNpxStagedRestart({
    currentState: restartRequiredState,
    setVersionUpdateState: (state) => retryStates.push(state),
    notifyInstallStarted: () => {
      throw new Error('restart retry should not show install started toast');
    },
    updateNpx: async () => {
      retryCalls.push('updateNpx');
      throw new Error('restart retry must not re-stage update');
    },
    restart: async () => {
      retryCalls.push('restart');
      return actionResponse(completedState, 'restarted');
    },
    waitForService: async () => undefined,
  });

  assert.deepEqual(retryCalls, ['restart']);
  assert.deepEqual(retryStates, [completedState]);

  const restartFailureState: UpdateOperationState = {
    download_status: 'downloaded',
    install_status: 'failed',
    downloaded_bytes: null,
    total_bytes: null,
    error: updateError(
      'restart',
      'restart_spawn_failed',
      'Failed to restart service',
    ),
  };
  const restartFailure = actionError(
    restartFailureState,
    'Failed to restart service',
  );
  const restartFailureStates: UpdateOperationState[] = [];

  await assert.rejects(
    () =>
      runNpxStagedRestart({
        currentState: restartFailureState,
        setVersionUpdateState: (state) => restartFailureStates.push(state),
        notifyInstallStarted: () => {
          throw new Error('restart retry should not re-stage update');
        },
        updateNpx: async () => {
          throw new Error('restart failure retry must not call updateNpx');
        },
        restart: async () => {
          throw restartFailure;
        },
        waitForService: async () => undefined,
      }),
    (error: unknown) => {
      assert.equal(error, restartFailure);
      return true;
    },
  );
  assert.deepEqual(restartFailureStates, [restartFailureState]);

  const stageFailureState: UpdateOperationState = {
    download_status: 'failed',
    install_status: 'idle',
    downloaded_bytes: 12,
    total_bytes: 64,
    error: updateError(
      'download',
      'npx_stage_failed',
      'Failed to stage update',
    ),
  };
  const stageFailure = actionError(stageFailureState, 'Failed to stage update');
  const stageFailureStates: UpdateOperationState[] = [];
  const stageFailureCalls: string[] = [];

  await assert.rejects(
    () =>
      runNpxStagedRestart({
        currentState: null,
        setVersionUpdateState: (state) => stageFailureStates.push(state),
        notifyInstallStarted: () => {
          throw new Error('failed stage should not show success toast');
        },
        updateNpx: async () => {
          stageFailureCalls.push('updateNpx');
          throw stageFailure;
        },
        restart: async () => {
          stageFailureCalls.push('restart');
          return actionResponse(completedState);
        },
        waitForService: async () => undefined,
      }),
    (error: unknown) => {
      assert.equal(error, stageFailure);
      return true;
    },
  );
  assert.deepEqual(stageFailureCalls, ['updateNpx']);
  assert.deepEqual(stageFailureStates, [stageFailureState]);

  const appSource = read('../App.tsx');
  const updateHookSource = read('../hooks/useVersionUpdate.ts');
  const guideSource = read('../components/onboarding/OnboardingGuide.tsx');
  const presentationSource = read('./updatePresentation.ts');
  const apiSource = read('./api.ts');
  const desktopApiSource = read('./desktopUpdateApi.ts');

  assert(updateHookSource.includes('runNpxStagedRestart({'));
  assert(updateHookSource.includes('currentState: operation'));
  assert(updateHookSource.includes('notifyInstallStarted: () => dependencies.onInstallStarted?.()'));
  assert(updateHookSource.includes('desktopUpdateApi.getContext()'));
  assert(desktopApiSource.includes("invoke('get_desktop_update_context')"));
  assert.equal(apiSource.includes('get_desktop_update_context'), false);
  assert(appSource.includes('useVersionUpdate({'));
  assert(guideSource.includes('versionUpdateState'));
  assert(guideSource.includes('getUpdatePageViewModel'));
  assert(presentationSource.includes('downloadStatusKey'));
  assert(presentationSource.includes('installStatusKey'));
  assert(guideSource.includes('manualFallbackAvailable'));

  console.log('All desktop update integration assertions passed.');
}

await main();
