const RELEASE_TIMESTAMP_SUFFIX = /-\d{14}$/;

export const formatVersionForDisplay = (version: string): string =>
  version.replace(RELEASE_TIMESTAMP_SUFFIX, '');
