import type {
  DesktopUpdateContext,
  UpdateArchitecture,
  UpdateErrorInfo,
  UpdateErrorStage,
  UpdateOperationState,
  UpdatePlatform,
} from '../../../shared/types';
import {
  getTauriEventListen,
  getTauriInvoke,
  type TauriEvent,
  type TauriUnlisten,
} from './tauriBridge';

type TauriStatusPayload = {
  status: string;
  error: string | null;
};

type TauriProgressPayload = {
  chunkLength: number;
  contentLength: number | null;
};

const UPDATE_STATUS_EVENT = 'tauri://update-status';
const UPDATE_DOWNLOAD_PROGRESS_EVENT = 'tauri://update-download-progress';

const desktopPlatforms = new Set<UpdatePlatform>([
  'macos',
  'linux_appimage',
  'linux_deb',
  'windows',
]);
const desktopArchitectures = new Set<UpdateArchitecture>([
  'aarch64',
  'x86_64',
  'i686',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asOptionalNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const parseDesktopUpdateContext = (
  value: unknown,
): DesktopUpdateContext | null => {
  if (!isRecord(value)) return null;
  const { platform, architecture } = value;
  if (
    !desktopPlatforms.has(platform as UpdatePlatform) ||
    !desktopArchitectures.has(architecture as UpdateArchitecture)
  ) {
    return null;
  }
  return {
    platform: platform as UpdatePlatform,
    architecture: architecture as UpdateArchitecture,
  };
};

const parseUpdateErrorInfo = (value: unknown): UpdateErrorInfo | null => {
  if (!isRecord(value)) return null;
  const { stage, code, message, retryable } = value;
  if (
    (stage !== 'check' &&
      stage !== 'download' &&
      stage !== 'install' &&
      stage !== 'restart') ||
    typeof code !== 'string' ||
    typeof message !== 'string' ||
    typeof retryable !== 'boolean'
  ) {
    return null;
  }

  return {
    stage,
    code,
    message,
    retryable,
  };
};

const parseUpdateOperationState = (value: unknown): UpdateOperationState | null => {
  if (!isRecord(value)) return null;
  const { download_status, install_status, downloaded_bytes, total_bytes, error } =
    value;
  if (
    (download_status !== 'idle' &&
      download_status !== 'downloading' &&
      download_status !== 'downloaded' &&
      download_status !== 'failed' &&
      download_status !== 'not_applicable') ||
    (install_status !== 'idle' &&
      install_status !== 'installing' &&
      install_status !== 'restart_required' &&
      install_status !== 'completed' &&
      install_status !== 'failed' &&
      install_status !== 'not_applicable')
  ) {
    return null;
  }

  const parsedError = error === null || error === undefined ? null : parseUpdateErrorInfo(error);
  if (error !== null && error !== undefined && !parsedError) {
    return null;
  }

  return {
    download_status,
    install_status,
    downloaded_bytes: downloaded_bytes === null || downloaded_bytes === undefined
      ? null
      : asOptionalNumber(downloaded_bytes),
    total_bytes: total_bytes === null || total_bytes === undefined
      ? null
      : asOptionalNumber(total_bytes),
    error: parsedError,
  };
};

const buildErrorInfo = (
  stage: UpdateErrorStage,
  code: string,
  message: string,
  retryable: boolean,
): UpdateErrorInfo => ({
  stage,
  code,
  message,
  retryable,
});

const installFailureDownloadStatus = (
  current: UpdateOperationState,
): UpdateOperationState['download_status'] => {
  switch (current.download_status) {
    case 'downloaded':
    case 'failed':
    case 'not_applicable':
      return current.download_status;
    case 'downloading':
      return 'failed';
    case 'idle':
    default:
      return 'idle';
  }
};

const failedStateFromError = (
  error: UpdateErrorInfo,
  current: UpdateOperationState,
): UpdateOperationState => {
  switch (error.stage) {
    case 'download':
      return {
        download_status: 'failed',
        install_status: 'idle',
        downloaded_bytes: current.downloaded_bytes,
        total_bytes: current.total_bytes,
        error,
      };
    case 'install':
      return {
        download_status: installFailureDownloadStatus(current),
        install_status: 'failed',
        downloaded_bytes: current.downloaded_bytes,
        total_bytes: current.total_bytes,
        error,
      };
    case 'restart':
      return {
        download_status: 'downloaded',
        install_status: 'failed',
        downloaded_bytes: current.downloaded_bytes,
        total_bytes: current.total_bytes,
        error,
      };
    case 'check':
    default:
      return {
        download_status: 'idle',
        install_status: 'idle',
        downloaded_bytes: current.downloaded_bytes,
        total_bytes: current.total_bytes,
        error,
      };
  }
};

const buildFailedState = (
  stage: UpdateErrorStage,
  code: string,
  message: string,
  retryable: boolean,
  current: UpdateOperationState,
): UpdateOperationState =>
  failedStateFromError(
    buildErrorInfo(stage, code, message, retryable),
    current,
  );

const deriveErrorStage = (current: UpdateOperationState): UpdateErrorStage => {
  if (
    current.install_status === 'installing' ||
    current.install_status === 'failed' ||
    current.download_status === 'downloaded'
  ) {
    return 'install';
  }
  if (
    current.download_status === 'downloading' ||
    current.download_status === 'failed' ||
    current.downloaded_bytes !== null
  ) {
    return 'download';
  }
  return 'check';
};

const errorCodeForStage = (stage: UpdateErrorStage): string => {
  switch (stage) {
    case 'download':
      return 'desktop_update_download_failed';
    case 'install':
      return 'desktop_update_install_failed';
    case 'restart':
      return 'desktop_update_restart_failed';
    case 'check':
    default:
      return 'desktop_update_check_failed';
  }
};

const normalizeDesktopUpdateError = (
  error: unknown,
  current: UpdateOperationState,
  fallbackMessage?: string | null,
): UpdateOperationState => {
  const parsedError = parseUpdateErrorInfo(error);
  if (parsedError) {
    return failedStateFromError(parsedError, current);
  }

  const stage = deriveErrorStage(current);
  const message =
    fallbackMessage ||
    (error instanceof Error ? error.message : 'Desktop update failed');

  return failedStateFromError(
    buildErrorInfo(stage, errorCodeForStage(stage), message, true),
    current,
  );
};

const parseStatusPayload = (event: TauriEvent): TauriStatusPayload | null => {
  if (!isRecord(event.payload)) return null;
  const { status, error } = event.payload;
  if (typeof status !== 'string') return null;
  if (error !== undefined && error !== null && typeof error !== 'string') {
    return null;
  }
  return {
    status,
    error: typeof error === 'string' ? error : null,
  };
};

const parseProgressPayload = (event: TauriEvent): TauriProgressPayload | null => {
  if (!isRecord(event.payload)) return null;
  const { chunkLength, contentLength } = event.payload;
  if (typeof chunkLength !== 'number' || !Number.isFinite(chunkLength)) {
    return null;
  }
  if (
    contentLength !== undefined &&
    contentLength !== null &&
    (typeof contentLength !== 'number' || !Number.isFinite(contentLength))
  ) {
    return null;
  }
  return {
    chunkLength,
    contentLength:
      typeof contentLength === 'number' && Number.isFinite(contentLength)
        ? contentLength
        : null,
  };
};

const initialState = (): UpdateOperationState => ({
  download_status: 'idle',
  install_status: 'idle',
  downloaded_bytes: null,
  total_bytes: null,
  error: null,
});

export class DesktopUpdateError extends Error {
  constructor(public state: UpdateOperationState) {
    super(state.error?.message ?? 'Desktop update failed');
    this.name = 'DesktopUpdateError';
  }
}

export const desktopUpdateApi = {
  getContext: async (): Promise<DesktopUpdateContext | null> => {
    const invoke = getTauriInvoke();
    if (!invoke) return null;
    const context = parseDesktopUpdateContext(
      await invoke('get_desktop_update_context'),
    );
    if (!context) {
      throw new Error('Desktop update context payload is invalid');
    }
    return context;
  },
  install: async (
    onStateChange?: (state: UpdateOperationState) => void,
  ): Promise<UpdateOperationState> => {
    const invoke = getTauriInvoke();
    const listen = getTauriEventListen();
    if (!invoke || !listen) {
      const unavailableState = buildFailedState(
        'install',
        'desktop_update_bridge_unavailable',
        'Desktop updater bridge is unavailable in this environment.',
        false,
        initialState(),
      );
      onStateChange?.(unavailableState);
      throw new DesktopUpdateError(unavailableState);
    }

    let currentState = initialState();
    let lastEventError: string | null = null;
    let subscriptionsReady = false;
    const emitState = (state: UpdateOperationState) => {
      currentState = state;
      onStateChange?.(state);
    };

    const unlisteners: TauriUnlisten[] = [];
    try {
      const statusUnlisten = await listen(UPDATE_STATUS_EVENT, (event) => {
        const payload = parseStatusPayload(event);
        if (!payload) return;

        switch (payload.status) {
          case 'PENDING':
            emitState({
              ...currentState,
              download_status: 'downloading',
              install_status: 'idle',
              error: null,
            });
            break;
          case 'DOWNLOADED':
            emitState({
              ...currentState,
              download_status: 'downloaded',
              install_status: 'installing',
              error: null,
            });
            break;
          case 'DONE':
            emitState({
              ...currentState,
              download_status: 'downloaded',
              install_status: 'completed',
              total_bytes: currentState.total_bytes ?? currentState.downloaded_bytes,
              error: null,
            });
            break;
          case 'UPTODATE':
            emitState({
              download_status: 'not_applicable',
              install_status: 'completed',
              downloaded_bytes: null,
              total_bytes: null,
              error: null,
            });
            break;
          case 'ERROR': {
            lastEventError = payload.error ?? 'Desktop update failed';
            emitState(
              normalizeDesktopUpdateError(
                payload.error ? { message: payload.error } : undefined,
                currentState,
                lastEventError,
              ),
            );
            break;
          }
        }
      });
      unlisteners.push(statusUnlisten);

      const progressUnlisten = await listen(
        UPDATE_DOWNLOAD_PROGRESS_EVENT,
        (event) => {
          const payload = parseProgressPayload(event);
          if (!payload) return;

          emitState({
            ...currentState,
            download_status: 'downloading',
            install_status: 'idle',
            downloaded_bytes:
              (currentState.downloaded_bytes ?? 0) + payload.chunkLength,
            total_bytes: payload.contentLength ?? currentState.total_bytes,
            error: null,
          });
        },
      );
      unlisteners.push(progressUnlisten);
      subscriptionsReady = true;

      const result = await invoke('install_desktop_update');
      const parsed = parseUpdateOperationState(result);
      if (!parsed) {
        throw new Error('Desktop updater returned an invalid payload');
      }
      emitState(parsed);
      return parsed;
    } catch (error) {
      const normalized = subscriptionsReady
        ? normalizeDesktopUpdateError(error, currentState, lastEventError)
        : buildFailedState(
            'install',
            'desktop_update_event_subscribe_failed',
            error instanceof Error
              ? error.message
              : 'Failed to subscribe to desktop update events.',
            true,
            currentState,
          );
      emitState(normalized);
      throw new DesktopUpdateError(normalized);
    } finally {
      await Promise.allSettled(unlisteners.map((unlisten) => Promise.resolve(unlisten())));
    }
  },
};
