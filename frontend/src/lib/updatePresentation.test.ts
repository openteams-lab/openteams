import assert from 'node:assert/strict';

import type { UpdateOperationState } from '../../../shared/types';
import { type VersionCheckResponse } from './api';
import { getUpdatePageViewModel } from './updatePresentation';

const info: VersionCheckResponse = {
  current_version: '0.4.0', latest_version: '0.5.0', has_update: true,
  release_url: 'https://github.com/openteams-lab/openteams/releases/tag/v0.5.0',
  release_notes: null, published_at: '2026-07-13T00:00:00Z',
  capability: {
    platform: 'linux_appimage', method: 'tauri_updater', can_download: true,
    can_install: true, requires_restart: true, fallback_url: null,
  },
};

const restartFailure: UpdateOperationState = {
  download_status: 'downloaded', install_status: 'failed', downloaded_bytes: 42,
  total_bytes: 100,
  error: { stage: 'restart', code: 'restart_failed', message: 'Restart OpenTeams to finish the update.', retryable: true },
};

const withCapability = (capability: VersionCheckResponse['capability']): VersionCheckResponse => ({
  ...info,
  capability,
});

async function main() {
  console.log('update presentation');
  const checking = getUpdatePageViewModel({
    info: null, checkStatus: 'checking', checkError: null, operation: null,
    isBusy: false, manualFallbackAvailable: false,
  });
  assert.equal(checking.primaryAction.kind, 'none');
  assert.equal(checking.rows[0]?.valueKey, 'onboarding.upgrade.status.checking');
  assert.equal(checking.rows.some((row) => row.labelKey === 'onboarding.upgrade.downloadStatus' && row.valueKey === 'onboarding.upgrade.status.download.idle'), true);
  assert.equal(checking.rows.some((row) => row.labelKey === 'onboarding.upgrade.installStatus' && row.valueKey === 'onboarding.upgrade.status.install.idle'), true);

  const failedCheck = getUpdatePageViewModel({
    info: null, checkStatus: 'failed',
    checkError: { stage: 'check', code: 'release_check_failed', message: 'Unable to reach GitHub.', retryable: true },
    operation: null, isBusy: false, manualFallbackAvailable: false,
  });
  assert.equal(failedCheck.primaryAction.kind, 'check');
  assert.equal(failedCheck.primaryAction.labelKey, 'onboarding.upgrade.retryCheck');
  assert.equal(failedCheck.error?.message, 'Unable to reach GitHub.');

  const retry = getUpdatePageViewModel({
    info, checkStatus: 'update_available', checkError: null, operation: restartFailure,
    isBusy: false, manualFallbackAvailable: true,
  });
  assert.equal(retry.primaryAction.kind, 'update');
  assert.equal(retry.primaryAction.labelKey, 'onboarding.upgrade.retryUpdate');
  assert.equal(retry.manualFallbackAvailable, true);
  assert.equal(retry.rows.some((row) => row.valueKey === 'onboarding.upgrade.status.restartRequired'), false);
  assert.equal(retry.rows.some((row) => row.valueKey === 'onboarding.upgrade.status.signatureNotReported'), true);

  const waitingRestart = getUpdatePageViewModel({
    info, checkStatus: 'update_available', checkError: null,
    operation: { ...restartFailure, install_status: 'restart_required', error: null },
    isBusy: false, manualFallbackAvailable: false,
  });
  assert.equal(waitingRestart.rows.some((row) => row.valueKey === 'onboarding.upgrade.status.restartRequired'), true);

  const npx = getUpdatePageViewModel({
    info: withCapability({ platform: 'web_npx', method: 'npx_staged_restart', can_download: true, can_install: true, requires_restart: true, fallback_url: null }),
    checkStatus: 'update_available', checkError: null, operation: null, isBusy: false, manualFallbackAvailable: false,
  });
  assert.equal(npx.rows.some((row) => row.valueKey === 'onboarding.upgrade.platform.webNpx'), true);
  assert.equal(npx.rows.some((row) => row.valueKey === 'onboarding.upgrade.method.npxStagedRestart'), true);
  assert.equal(npx.primaryAction.kind, 'update');

  const completedNpx = getUpdatePageViewModel({
    info: withCapability({ platform: 'web_npx', method: 'npx_staged_restart', can_download: true, can_install: true, requires_restart: true, fallback_url: null }),
    checkStatus: 'update_available', checkError: null,
    operation: { ...restartFailure, install_status: 'completed', error: null },
    isBusy: false, manualFallbackAvailable: false,
  });
  assert.equal(completedNpx.primaryAction.kind, 'none', 'a completed npx restart cannot be requested again');
  assert.equal(completedNpx.primaryAction.labelKey, 'onboarding.upgrade.updateCompleted');

  for (const platform of ['macos', 'linux_appimage'] as const) {
    const desktop = getUpdatePageViewModel({
      info: withCapability({ platform, method: 'tauri_updater', can_download: true, can_install: true, requires_restart: true, fallback_url: null }),
      checkStatus: 'update_available', checkError: null,
      operation: { ...restartFailure, install_status: 'completed', error: null },
      isBusy: false, manualFallbackAvailable: false,
    });
    assert.equal(desktop.rows.some((row) => row.valueKey === 'onboarding.upgrade.status.signatureVerified'), true);
    assert.equal(desktop.primaryAction.kind, 'none', 'a completed desktop update cannot be installed again');
    assert.equal(desktop.primaryAction.disabled, true);
  }

  const deb = getUpdatePageViewModel({
    info: withCapability({ platform: 'linux_deb', method: 'manual_download', can_download: true, can_install: false, requires_restart: false, fallback_url: 'https://github.com/openteams-lab/openteams/releases/download/v0.5.0/app.deb' }),
    checkStatus: 'update_available', checkError: null, operation: null, isBusy: false, manualFallbackAvailable: false,
  });
  assert.equal(deb.rows.some((row) => row.valueKey === 'onboarding.upgrade.platform.linuxDeb'), true);
  assert.equal(deb.primaryAction.labelKey, 'onboarding.upgrade.openInstaller');

  const unavailableDeb = getUpdatePageViewModel({
    info: withCapability({ platform: 'linux_deb', method: 'manual_download', can_download: false, can_install: false, requires_restart: false, fallback_url: null }),
    checkStatus: 'update_available', checkError: null, operation: null, isBusy: false, manualFallbackAvailable: false,
  });
  assert.equal(unavailableDeb.primaryAction.kind, 'none', 'a missing matching installer cannot open the release page as a download');
  assert.equal(unavailableDeb.primaryAction.labelKey, 'onboarding.upgrade.manualInstallerUnavailable');
  assert.equal(unavailableDeb.primaryAction.disabled, true);

  const downloadedDeb = getUpdatePageViewModel({
    info: withCapability({ platform: 'linux_deb', method: 'manual_download', can_download: true, can_install: false, requires_restart: false, fallback_url: 'https://github.com/openteams-lab/openteams/releases/download/v0.5.0/app.deb' }),
    checkStatus: 'update_available', checkError: null,
    operation: { ...restartFailure, download_status: 'downloaded', install_status: 'not_applicable', error: null },
    isBusy: false, manualFallbackAvailable: false,
  });
  assert.equal(downloadedDeb.primaryAction.kind, 'none', 'a completed manual download cannot be opened repeatedly');
  assert.equal(downloadedDeb.primaryAction.labelKey, 'onboarding.upgrade.updateCompleted');
  assert.equal(downloadedDeb.primaryAction.disabled, true);

  const unsupported = getUpdatePageViewModel({
    info: withCapability({ platform: 'unknown', method: 'unsupported', can_download: false, can_install: false, requires_restart: false, fallback_url: null }),
    checkStatus: 'update_available', checkError: null, operation: null, isBusy: false, manualFallbackAvailable: false,
  });
  assert.equal(unsupported.primaryAction.kind, 'none');
  assert.equal(unsupported.primaryAction.labelKey, 'onboarding.upgrade.updateUnsupported');
  assert.equal(unsupported.primaryAction.disabled, true);

  const busy = getUpdatePageViewModel({
    info, checkStatus: 'update_available', checkError: null,
    operation: { ...restartFailure, downloaded_bytes: 512, total_bytes: 1024, error: null },
    isBusy: true, manualFallbackAvailable: false,
  });
  assert.equal(busy.primaryAction.disabled, true);
  assert.equal(busy.rows.some((row) => row.labelKey === 'onboarding.upgrade.downloadProgress' && row.value === '512 B / 1 KB'), true);

  const verificationFailure = getUpdatePageViewModel({
    info, checkStatus: 'update_available', checkError: null,
    operation: { ...restartFailure, error: { stage: 'install', code: 'desktop_update_signature_failed', message: 'Failed to verify desktop update signature.', retryable: false } },
    isBusy: false, manualFallbackAvailable: false,
  });
  assert.equal(verificationFailure.rows.some((row) => row.valueKey === 'onboarding.upgrade.status.signatureFailed'), true);

  console.log('All update presentation assertions passed.');
}

await main();
