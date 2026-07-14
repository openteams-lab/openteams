import type { UpdateErrorInfo } from '../../../shared/types';
import { getTauriShellOpen } from './tauriBridge';

const TRUSTED_RELEASE_PREFIX =
  'https://github.com/openteams-lab/openteams/releases/';

const buildErrorInfo = (
  code: string,
  message: string,
  retryable: boolean,
): UpdateErrorInfo => ({
  stage: 'download',
  code,
  message,
  retryable,
});

const normalizeTrustedReleaseUrl = (value: string): URL | null => {
  try {
    const parsed = new URL(value);
    const trustedPath =
      parsed.pathname.startsWith('/openteams-lab/openteams/releases/download/') ||
      parsed.pathname.startsWith('/openteams-lab/openteams/releases/tag/');
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'github.com' ||
      !trustedPath
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export class ManualDownloadError extends Error {
  constructor(public errorData: UpdateErrorInfo) {
    super(errorData.message);
    this.name = 'ManualDownloadError';
  }
}

export const openUpdateUrl = async (url: string): Promise<void> => {
  const trustedUrl = normalizeTrustedReleaseUrl(url);
  if (!trustedUrl) {
    throw new ManualDownloadError(
      buildErrorInfo(
        'manual_installer_untrusted_url',
        'Manual download is only allowed for trusted OpenTeams GitHub Release URLs.',
        false,
      ),
    );
  }

  const shellOpen = getTauriShellOpen();
  if (shellOpen) {
    try {
      await shellOpen(trustedUrl.toString());
      return;
    } catch (error) {
      throw new ManualDownloadError(
        buildErrorInfo(
          'manual_installer_open_failed',
          error instanceof Error
            ? error.message
            : 'Failed to open the manual installer download URL.',
          true,
        ),
      );
    }
  }

  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    const openedWindow = window.open(
      trustedUrl.toString(),
      '_blank',
      'noopener,noreferrer',
    );
    if (openedWindow) return;
    throw new ManualDownloadError(
      buildErrorInfo(
        'manual_installer_unavailable',
        'The browser blocked the manual installer download window. Allow pop-ups and try again.',
        true,
      ),
    );
  }

  throw new ManualDownloadError(
    buildErrorInfo(
      'manual_installer_unavailable',
      `Manual installer URL can only be opened from a browser or Tauri shell. Expected a trusted release under ${TRUSTED_RELEASE_PREFIX}`,
      false,
    ),
  );
};
