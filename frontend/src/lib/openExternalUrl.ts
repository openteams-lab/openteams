import { getTauriShellOpen } from './tauriBridge';

const EXTERNAL_BROWSER_PROTOCOLS = new Set(['http:', 'https:']);

export const openExternalUrlInDesktop = (url: string): boolean => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  if (!EXTERNAL_BROWSER_PROTOCOLS.has(parsedUrl.protocol)) {
    return false;
  }

  const shellOpen = getTauriShellOpen();
  if (!shellOpen) {
    return false;
  }

  void shellOpen(parsedUrl.toString()).catch((error) => {
    console.error('Failed to open external URL in the system browser.', error);
  });
  return true;
};
