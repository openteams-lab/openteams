import { useCallback, useEffect, useRef, useState } from 'react';

import { desktopUpdateApi } from '@/lib/desktopUpdateApi';
import { UpdateApiError, versionApi, type VersionCheckResponse } from '@/lib/api';
import { runNpxStagedRestart } from '@/lib/npxUpdateFlow';
import { ManualDownloadError, openUpdateUrl } from '@/lib/openUpdateUrl';
import type {
  UpdateActionResponse,
  UpdateErrorInfo,
  UpdateOperationState,
} from '../../../shared/types';

export const versionUpdateCheckIntervalMs = 60 * 60 * 1000;
export const versionUpdateSnoozeMs = 6 * 60 * 60 * 1000;

export type VersionUpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'update_available'
  | 'up_to_date'
  | 'failed';

type ControllerSnapshot = {
  info: VersionCheckResponse | null;
  checkStatus: VersionUpdateCheckStatus;
  checkError: UpdateErrorInfo | null;
  operation: UpdateOperationState | null;
  reminder: VersionCheckResponse | null;
  isBusy: boolean;
  manualFallbackAvailable: boolean;
};

type SchedulerToken = unknown;

export type VersionUpdateAdapter = {
  check: () => Promise<VersionCheckResponse>;
  now: () => number;
  schedule: (callback: () => void, delay: number) => SchedulerToken;
  clearSchedule: (timer: SchedulerToken) => void;
  updateNpx: () => Promise<UpdateActionResponse>;
  restart: () => Promise<UpdateActionResponse>;
  waitForService?: () => Promise<void>;
  installDesktop: (onStateChange: (state: UpdateOperationState) => void) => Promise<UpdateOperationState>;
  openManual: (url: string) => Promise<void>;
};

type VersionUpdateControllerDependencies = VersionUpdateAdapter & {
  onReminder: (info: VersionCheckResponse | null) => void;
  onChange?: (snapshot: ControllerSnapshot) => void;
  onInstallStarted?: () => void;
};

const errorInfo = (
  stage: UpdateErrorInfo['stage'],
  code: string,
  message: string,
  retryable: boolean,
): UpdateErrorInfo => ({ stage, code, message, retryable });

const failedOperation = (
  error: UpdateErrorInfo,
  current?: UpdateOperationState | null,
): UpdateOperationState => ({
  download_status:
    error.stage === 'download'
      ? 'failed'
      : current?.download_status === 'downloaded'
        ? 'downloaded'
        : 'not_applicable',
  install_status: error.stage === 'download' ? 'not_applicable' : 'failed',
  downloaded_bytes: current?.downloaded_bytes ?? null,
  total_bytes: current?.total_bytes ?? null,
  error,
});

const manualOpenStarted: UpdateOperationState = {
  download_status: 'downloading',
  install_status: 'not_applicable',
  downloaded_bytes: null,
  total_bytes: null,
  error: null,
};

const isCompletedOperation = (
  operation: UpdateOperationState | null,
  method: VersionCheckResponse['capability']['method'],
): boolean =>
  operation?.install_status === 'completed' ||
  (method === 'manual_download' &&
    operation?.download_status === 'downloaded' &&
    operation.install_status === 'not_applicable');

export const createVersionUpdateController = (
  dependencies: VersionUpdateControllerDependencies,
) => {
  let info: VersionCheckResponse | null = null;
  let checkStatus: VersionUpdateCheckStatus = 'idle';
  let checkError: UpdateErrorInfo | null = null;
  let operation: UpdateOperationState | null = null;
  let reminder: VersionCheckResponse | null = null;
  let remindedVersion: string | null = null;
  let snoozedUntil: number | null = null;
  let checking = false;
  let updating = false;
  let timer: SchedulerToken | null = null;
  let running = false;

  const snapshot = (): ControllerSnapshot => ({
    info,
    checkStatus,
    checkError,
    operation,
    reminder,
    isBusy: checking || updating,
    manualFallbackAvailable:
      info?.capability.method === 'tauri_updater' &&
      operation?.error?.retryable === true,
  });
  const notify = () => {
    if (running) dependencies.onChange?.(snapshot());
  };
  const setReminder = (nextReminder: VersionCheckResponse | null) => {
    reminder = nextReminder;
    dependencies.onReminder(nextReminder);
    notify();
  };
  const setOperation = (nextOperation: UpdateOperationState) => {
    operation = nextOperation;
    notify();
  };

  const checkNow = async (): Promise<VersionCheckResponse | null> => {
    if (checking) return null;
    checking = true;
    checkStatus = 'checking';
    notify();
    try {
      const nextInfo = await dependencies.check();
      if (
        info !== null &&
        info.latest_version !== nextInfo.latest_version
      ) {
        operation = null;
        remindedVersion = null;
      }
      info = nextInfo;
      checkStatus = nextInfo.has_update ? 'update_available' : 'up_to_date';
      checkError = null;
      if (
        nextInfo.has_update &&
        (snoozedUntil === null || dependencies.now() >= snoozedUntil) &&
        remindedVersion !== nextInfo.latest_version
      ) {
        remindedVersion = nextInfo.latest_version;
        setReminder(nextInfo);
      } else if (!nextInfo.has_update) {
        setReminder(null);
        remindedVersion = null;
      }
      return nextInfo;
    } catch (error) {
      checkStatus = 'failed';
      checkError =
        error instanceof UpdateApiError &&
        error.errorData &&
        typeof error.errorData === 'object' &&
        'stage' in error.errorData
          ? error.errorData
          : errorInfo(
              'check',
              'release_check_failed',
              error instanceof Error ? error.message : 'Failed to check for updates.',
              true,
            );
      notify();
      return null;
    } finally {
      checking = false;
      notify();
    }
  };

  const snooze = () => {
    snoozedUntil = dependencies.now() + versionUpdateSnoozeMs;
    remindedVersion = null;
    setReminder(null);
  };

  const dismissReminder = () => setReminder(null);

  const openManualFallback = async () => {
    const url = info?.capability.fallback_url ?? info?.release_url;
    if (!url) {
      const nextOperation = failedOperation(
        errorInfo('download', 'manual_installer_unavailable', 'Manual installer URL is unavailable for this release.', false),
        operation,
      );
      setOperation(nextOperation);
      throw new Error(nextOperation.error?.message);
    }

    setOperation(manualOpenStarted);
    try {
      await dependencies.openManual(url);
      setOperation({ ...manualOpenStarted, download_status: 'downloaded' });
    } catch (error) {
      const updateError =
        error instanceof ManualDownloadError
          ? error.errorData
          : errorInfo(
              'download',
              'manual_installer_open_failed',
              error instanceof Error ? error.message : 'Failed to open the manual installer URL.',
              true,
            );
      setOperation(failedOperation(updateError, manualOpenStarted));
      throw error;
    }
  };

  const executeUpdate = async () => {
    if (updating || !info?.has_update) return;
    const capability = info.capability;
    if (isCompletedOperation(operation, capability.method)) return;
    if (
      capability.method === 'manual_download' &&
      (!capability.can_download || !capability.fallback_url)
    ) {
      setOperation(
        failedOperation(
          errorInfo(
            'download',
            'manual_installer_unavailable',
            'No matching manual installer is available for this release.',
            true,
          ),
          operation,
        ),
      );
      return;
    }
    if (!capability.can_install && capability.method !== 'manual_download') {
      setOperation(
        failedOperation(
          errorInfo('install', 'desktop_update_unsupported_platform', 'This platform does not support automatic updates.', false),
          operation,
        ),
      );
      return;
    }

    updating = true;
    notify();
    try {
      switch (capability.method) {
        case 'npx_staged_restart':
          await runNpxStagedRestart({
            currentState: operation,
            setVersionUpdateState: setOperation,
            notifyInstallStarted: () => dependencies.onInstallStarted?.(),
            updateNpx: dependencies.updateNpx,
            restart: dependencies.restart,
            waitForService: dependencies.waitForService ?? (async () => undefined),
          });
          return;
        case 'tauri_updater':
          setOperation(await dependencies.installDesktop(setOperation));
          return;
        case 'manual_download':
          await openManualFallback();
          return;
        case 'unsupported':
          return;
      }
    } finally {
      updating = false;
      notify();
    }
  };

  return {
    snapshot,
    start: async () => {
      running = true;
      if (running && timer === null) {
        timer = dependencies.schedule(() => void checkNow(), versionUpdateCheckIntervalMs);
      }
      await checkNow();
    },
    stop: () => {
      running = false;
      if (timer !== null) {
        dependencies.clearSchedule(timer);
        timer = null;
      }
    },
    checkNow,
    snooze,
    dismissReminder,
    setOperation,
    executeUpdate,
    openManualFallback,
  };
};

export type UseVersionUpdateOptions = {
  onOpenUpdatePage: (info: VersionCheckResponse) => void;
  onInstallStarted?: () => void;
  adapter?: VersionUpdateAdapter;
};

export const useVersionUpdate = ({
  onOpenUpdatePage,
  onInstallStarted,
  adapter,
}: UseVersionUpdateOptions) => {
  const [snapshot, setSnapshot] = useState<ControllerSnapshot>({
    info: null,
    checkStatus: 'idle',
    checkError: null,
    operation: null,
    reminder: null,
    isBusy: false,
    manualFallbackAvailable: false,
  });
  const callbacksRef = useRef({ onOpenUpdatePage, onInstallStarted });
  callbacksRef.current = { onOpenUpdatePage, onInstallStarted };
  const controllerRef = useRef<ReturnType<typeof createVersionUpdateController> | null>(null);

  if (controllerRef.current === null) {
    const defaultAdapter: VersionUpdateAdapter = {
      check: async () => versionApi.check(await desktopUpdateApi.getContext()),
      now: Date.now,
      schedule: (callback, delay) => window.setInterval(callback, delay),
      clearSchedule: (timer) => window.clearInterval(timer as number),
      updateNpx: versionApi.updateNpx,
      restart: versionApi.restart,
      waitForService: versionApi.waitForService,
      installDesktop: desktopUpdateApi.install,
      openManual: openUpdateUrl,
    };
    controllerRef.current = createVersionUpdateController({
      ...(adapter ?? defaultAdapter),
      onReminder: () => undefined,
      onChange: setSnapshot,
      onInstallStarted: () => callbacksRef.current.onInstallStarted?.(),
    });
  }

  const controller = controllerRef.current;
  useEffect(() => {
    void controller.start();
    return controller.stop;
  }, [controller]);

  const openUpdatePage = useCallback(() => {
    const current = controller.snapshot().info;
    controller.dismissReminder();
    if (current) callbacksRef.current.onOpenUpdatePage(current);
  }, [controller]);

  return {
    ...snapshot,
    checkNow: controller.checkNow,
    snooze: controller.snooze,
    openUpdatePage,
    executeUpdate: controller.executeUpdate,
    openManualFallback: controller.openManualFallback,
  };
};
