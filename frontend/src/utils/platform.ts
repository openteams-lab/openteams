type ClientPlatform = 'windows' | 'macos' | 'linux' | 'unknown';

function detectClientPlatform(): ClientPlatform {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };

  const platformHint = (
    nav.userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent
  ).toLowerCase();

  if (platformHint.includes('win')) return 'windows';
  if (
    platformHint.includes('mac') ||
    platformHint.includes('iphone') ||
    platformHint.includes('ipad') ||
    platformHint.includes('ipod')
  ) {
    return 'macos';
  }
  if (platformHint.includes('linux')) return 'linux';

  return 'unknown';
}

export function isMac(): boolean {
  return detectClientPlatform() === 'macos';
}

export function getWorkspacePathExample(): string {
  return detectClientPlatform() === 'windows'
    ? 'E:\\workspace\\MyProject'
    : '~/workspace/MyProject';
}

export function getModifierKey(): string {
  return isMac() ? '⌘' : 'Ctrl';
}
