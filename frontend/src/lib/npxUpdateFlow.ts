import type { UpdateOperationState } from '../../../shared/types';
import {
  UpdateApiError,
  type UpdateActionResponse,
  versionApi,
} from './api';

type NpxAction = () => Promise<UpdateActionResponse>;

type RunNpxStagedRestartOptions = {
  currentState: UpdateOperationState | null;
  setVersionUpdateState: (state: UpdateOperationState) => void;
  notifyInstallStarted: () => void;
  updateNpx?: NpxAction;
  restart?: NpxAction;
  waitForService?: () => Promise<void>;
};

const shouldRetryRestartOnly = (
  state: UpdateOperationState | null,
): boolean =>
  state?.download_status === 'downloaded' &&
  (state.install_status === 'restart_required' ||
    (state.install_status === 'failed' && state.error?.stage === 'restart'));

const updateStateFromActionError = (
  error: unknown,
  setVersionUpdateState: (state: UpdateOperationState) => void,
) => {
  if (
    error instanceof UpdateApiError &&
    error.errorData &&
    typeof error.errorData === 'object' &&
    'state' in error.errorData
  ) {
    setVersionUpdateState(error.errorData.state);
  }
};

export const runNpxStagedRestart = async ({
  currentState,
  setVersionUpdateState,
  notifyInstallStarted,
  updateNpx = versionApi.updateNpx,
  restart = versionApi.restart,
  waitForService = versionApi.waitForService,
}: RunNpxStagedRestartOptions): Promise<UpdateOperationState> => {
  if (!shouldRetryRestartOnly(currentState)) {
    try {
      const staged = await updateNpx();
      setVersionUpdateState(staged.state);
      notifyInstallStarted();
    } catch (error) {
      updateStateFromActionError(error, setVersionUpdateState);
      throw error;
    }
  }

  try {
    const restarted = await restart();
    setVersionUpdateState(restarted.state);
    await waitForService();
    return restarted.state;
  } catch (error) {
    updateStateFromActionError(error, setVersionUpdateState);
    throw error;
  }
};
