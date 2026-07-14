import type {
  UpdateErrorInfo,
  UpdateOperationState,
} from '../../../shared/types';
import type { VersionCheckResponse } from '@/lib/api';
import type { VersionUpdateCheckStatus } from '@/hooks/useVersionUpdate';

export type UpdatePresentationRow = {
  labelKey: string;
  valueKey?: string;
  value?: string;
};

export type UpdatePageViewModel = {
  rows: UpdatePresentationRow[];
  error: UpdateErrorInfo | null;
  primaryAction: {
    kind: 'check' | 'update' | 'none';
    labelKey: string;
    disabled: boolean;
  };
  manualFallbackAvailable: boolean;
};

type UpdatePageViewModelInput = {
  info: VersionCheckResponse | null;
  checkStatus: VersionUpdateCheckStatus;
  checkError: UpdateErrorInfo | null;
  operation: UpdateOperationState | null;
  isBusy: boolean;
  manualFallbackAvailable: boolean;
};

const checkStatusKey: Record<VersionUpdateCheckStatus, string> = {
  idle: 'onboarding.upgrade.status.idle',
  checking: 'onboarding.upgrade.status.checking',
  update_available: 'onboarding.upgrade.status.updateAvailable',
  up_to_date: 'onboarding.upgrade.status.upToDate',
  failed: 'onboarding.upgrade.status.failed',
};

const platformKey: Record<string, string> = {
  web_npx: 'onboarding.upgrade.platform.webNpx',
  macos: 'onboarding.upgrade.platform.macos',
  linux_appimage: 'onboarding.upgrade.platform.linuxAppimage',
  linux_deb: 'onboarding.upgrade.platform.linuxDeb',
  windows: 'onboarding.upgrade.platform.windows',
  unknown: 'onboarding.upgrade.platform.unknown',
};
const methodKey: Record<string, string> = {
  npx_staged_restart: 'onboarding.upgrade.method.npxStagedRestart',
  tauri_updater: 'onboarding.upgrade.method.tauriUpdater',
  manual_download: 'onboarding.upgrade.method.manualDownload',
  unsupported: 'onboarding.upgrade.method.unsupported',
};
const downloadStatusKey: Record<string, string> = {
  idle: 'onboarding.upgrade.status.download.idle',
  downloading: 'onboarding.upgrade.status.download.downloading',
  downloaded: 'onboarding.upgrade.status.download.downloaded',
  failed: 'onboarding.upgrade.status.download.failed',
  not_applicable: 'onboarding.upgrade.status.notApplicable',
};
const installStatusKey: Record<string, string> = {
  idle: 'onboarding.upgrade.status.install.idle',
  installing: 'onboarding.upgrade.status.install.installing',
  restart_required: 'onboarding.upgrade.status.restartRequired',
  completed: 'onboarding.upgrade.status.install.completed',
  failed: 'onboarding.upgrade.status.install.failed',
  not_applicable: 'onboarding.upgrade.status.notApplicable',
};

const formatByteCount = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
};

const signatureStatusKey = (
  method: string | undefined,
  operation: UpdateOperationState | null,
): string => {
  if (method !== 'tauri_updater') {
    return 'onboarding.upgrade.status.notApplicable';
  }
  if (operation?.error?.code.includes('signature') || operation?.error?.code.includes('verification')) {
    return 'onboarding.upgrade.status.signatureFailed';
  }
  if (operation?.install_status === 'completed' && operation.error === null) {
    return 'onboarding.upgrade.status.signatureVerified';
  }
  return 'onboarding.upgrade.status.signatureNotReported';
};

const isCompletedOperation = (
  operation: UpdateOperationState | null,
  method: string | undefined,
): boolean =>
  operation?.install_status === 'completed' ||
  (method === 'manual_download' &&
    operation?.download_status === 'downloaded' &&
    operation.install_status === 'not_applicable');

export const getUpdatePageViewModel = ({
  info,
  checkStatus,
  checkError,
  operation,
  isBusy,
  manualFallbackAvailable,
}: UpdatePageViewModelInput): UpdatePageViewModel => {
  const error = operation?.error ?? checkError;
  const rows: UpdatePresentationRow[] = [
    {
      labelKey: 'onboarding.upgrade.checkStatus',
      valueKey: checkStatusKey[checkStatus],
    },
    {
      labelKey: 'onboarding.upgrade.platform',
      valueKey: platformKey[info?.capability.platform ?? 'unknown'],
    },
    {
      labelKey: 'onboarding.upgrade.method',
      valueKey: methodKey[info?.capability.method ?? 'unsupported'],
    },
    {
      labelKey: 'onboarding.upgrade.publishedAt',
      value: info?.published_at ?? '—',
    },
    {
      labelKey: 'onboarding.upgrade.signatureVerification',
      valueKey: signatureStatusKey(info?.capability.method, operation),
    },
  ];

  const operationState: UpdateOperationState = operation ?? {
    download_status: 'idle',
    install_status: 'idle',
    downloaded_bytes: null,
    total_bytes: null,
    error: null,
  };
  rows.push(
    {
      labelKey: 'onboarding.upgrade.downloadStatus',
      valueKey: downloadStatusKey[operationState.download_status],
    },
    {
      labelKey: 'onboarding.upgrade.installStatus',
      valueKey: installStatusKey[operationState.install_status],
    },
  );
  if (operationState.downloaded_bytes !== undefined && operationState.downloaded_bytes !== null) {
    rows.push({
      labelKey: 'onboarding.upgrade.downloadProgress',
      value:
        operationState.total_bytes === undefined || operationState.total_bytes === null
          ? formatByteCount(operationState.downloaded_bytes)
          : `${formatByteCount(operationState.downloaded_bytes)} / ${formatByteCount(operationState.total_bytes)}`,
    });
  }

  if (checkStatus === 'failed' && checkError?.retryable) {
    return {
      rows,
      error,
      primaryAction: {
        kind: 'check',
        labelKey: 'onboarding.upgrade.retryCheck',
        disabled: isBusy,
      },
      manualFallbackAvailable: false,
    };
  }

  const capability = info?.capability;
  const manualInstallerUnavailable = Boolean(
    capability?.method === 'manual_download' &&
      (!capability.can_download || !capability.fallback_url),
  );
  const updateCompleted = isCompletedOperation(operation, capability?.method);
  const canUpdate = Boolean(
    info?.has_update &&
      capability &&
      capability.method !== 'unsupported' &&
      !updateCompleted &&
      !manualInstallerUnavailable &&
      (capability.can_install || capability.method === 'manual_download'),
  );
  return {
    rows,
    error,
    primaryAction: {
      kind: canUpdate ? 'update' : 'none',
      labelKey: updateCompleted
        ? 'onboarding.upgrade.updateCompleted'
        : manualInstallerUnavailable
          ? 'onboarding.upgrade.manualInstallerUnavailable'
          : error?.retryable
            ? 'onboarding.upgrade.retryUpdate'
            : capability?.method === 'unsupported'
          ? 'onboarding.upgrade.updateUnsupported'
            : capability?.method === 'manual_download'
              ? 'onboarding.upgrade.openInstaller'
              : info?.has_update
                ? 'onboarding.upgrade.updateNow'
                : info
                  ? 'onboarding.upgrade.updateUnavailable'
                  : 'onboarding.upgrade.updateChecking',
      disabled: !canUpdate || isBusy,
    },
    manualFallbackAvailable,
  };
};
