import { resolveLocalPathToAbsolutePath } from '@/utils/readOnlyLinks';

export type ExtractedArtifactPath = {
  rawPath: string;
  absolutePath: string;
};

const ARTIFACT_FILE_PATH_RE =
  /(^|[\s([{"'])(?<path>(?:[a-zA-Z]:\\(?:[^\\\r\n<>:"|?*]+\\){2,}[^\\\r\n<>:"|?*\s`"')\]}.,:;!?]+|[a-zA-Z]:\\(?:[^\\\r\n<>:"|?*]+\\)*[^\\\r\n<>:"|?*]+\.[a-zA-Z0-9]{1,16}|\/(?:[^/\r\n]+\/){2,}[^/\r\n\s`"')\]}.,:;!?]+|\/(?:[^/\r\n]+\/)*[^/\r\n]+\.[a-zA-Z0-9]{1,16}|(?:\.{1,2}[\\/])?(?:[^\\/\r\n\s`"')\]}.,:;!?]+[\\/])*[^\\/\r\n\s`"')\]}.,:;!?]+\.[a-zA-Z0-9]{1,16}))/g;
const DOT_PREFIXED_ARTIFACT_FILE_PATH_RE =
  /(^|[\s([{"'])(?<path>\.[^\\/\r\n\s`"')\]}:;!?]+(?:[\\/][^\\/\r\n\s`"')\]}:;!?]+)*[\\/][^\\/\r\n\s`"')\]}:;!?]+\.[a-zA-Z0-9]{1,16})/g;
const TRAILING_PATH_PUNCTUATION_RE = /[.,;!?]+$/g;
const TRAILING_PATH_LOCATOR_RE = /:\d+(?::\d+)?(?:-\d+(?::\d+)?)?$/;

function createArtifactFilePathRegex() {
  return new RegExp(ARTIFACT_FILE_PATH_RE.source, ARTIFACT_FILE_PATH_RE.flags);
}

function createDotPrefixedArtifactFilePathRegex() {
  return new RegExp(
    DOT_PREFIXED_ARTIFACT_FILE_PATH_RE.source,
    DOT_PREFIXED_ARTIFACT_FILE_PATH_RE.flags
  );
}

function trimTrailingPathPunctuation(value: string): string {
  return value.trim().replace(TRAILING_PATH_PUNCTUATION_RE, '');
}

export function normalizeArtifactPathCandidate(value: string): string {
  let normalized = trimTrailingPathPunctuation(value);

  while (TRAILING_PATH_LOCATOR_RE.test(normalized)) {
    normalized = normalized.replace(TRAILING_PATH_LOCATOR_RE, '');
  }

  return trimTrailingPathPunctuation(normalized);
}

export function isArtifactPathCandidate(value: string): boolean {
  const trimmed = normalizeArtifactPathCandidate(value);
  if (!trimmed) return false;

  if (
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) &&
    !/^[a-zA-Z]:[\\/]/.test(trimmed) &&
    !trimmed.startsWith('file://')
  ) {
    return false;
  }

  return (
    new RegExp(createArtifactFilePathRegex().source).test(` ${trimmed}`) ||
    new RegExp(createDotPrefixedArtifactFilePathRegex().source).test(
      ` ${trimmed}`
    )
  );
}

export function extractArtifactPaths(
  content: string,
  workspacePath: string | undefined
): ExtractedArtifactPath[] {
  if (!workspacePath) {
    return [];
  }

  const paths = new Map<string, ExtractedArtifactPath>();
  const addPath = (rawPath: string) => {
    const normalizedRawPath = normalizeArtifactPathCandidate(rawPath);
    if (!isArtifactPathCandidate(normalizedRawPath)) {
      return;
    }

    const absolutePath = resolveLocalPathToAbsolutePath(
      normalizedRawPath,
      workspacePath
    );
    if (!absolutePath) {
      return;
    }

    if (!paths.has(absolutePath)) {
      paths.set(absolutePath, {
        rawPath: normalizedRawPath,
        absolutePath,
      });
    }
  };

  for (const match of content.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
    addPath(match[1] ?? '');
  }

  for (const match of content.matchAll(/`([^`]+)`/g)) {
    addPath(match[1] ?? '');
  }

  for (const match of content.matchAll(createArtifactFilePathRegex())) {
    addPath(match.groups?.path ?? '');
  }

  for (const match of content.matchAll(
    createDotPrefixedArtifactFilePathRegex()
  )) {
    addPath(match.groups?.path ?? '');
  }

  return Array.from(paths.values());
}
