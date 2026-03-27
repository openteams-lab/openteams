export type ReadOnlyLinkResolution = {
  href: string;
  clickable: boolean;
};

const DANGEROUS_PROTOCOL_RE = /^(javascript|vbscript|data):/i;
const HTTPS_RE = /^https:\/\//i;
const FILE_RE = /^file:\/\//i;
const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/;
const URI_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

export function pathToFileHref(path: string | null | undefined): string | null {
  if (!path) return null;

  const trimmed = path.trim();
  if (!trimmed) return null;

  if (FILE_RE.test(trimmed)) {
    return trimmed;
  }

  const normalizedPath = trimmed.replace(/\\/g, '/');

  if (trimmed.startsWith('\\\\')) {
    return `file:${encodeURI(normalizedPath)}`;
  }

  if (WINDOWS_ABSOLUTE_PATH_RE.test(trimmed)) {
    return `file:///${encodeURI(normalizedPath)}`;
  }

  if (normalizedPath.startsWith('/')) {
    return `file://${encodeURI(normalizedPath)}`;
  }

  return null;
}

function resolveRelativeFileHref(
  href: string,
  basePath: string | null | undefined
): string | null {
  const baseHref = pathToFileHref(basePath);
  if (!baseHref) return null;

  try {
    const resolved = new URL(href, baseHref);
    return resolved.protocol === 'file:' ? resolved.toString() : null;
  } catch {
    return null;
  }
}

export function resolveReadOnlyLink(
  href: string | null | undefined,
  options: {
    allowFileLinks?: boolean;
    basePath?: string | null;
  } = {}
): ReadOnlyLinkResolution | null {
  if (typeof href !== 'string') return null;

  const trimmed = href.trim();
  if (!trimmed) return null;

  if (DANGEROUS_PROTOCOL_RE.test(trimmed)) {
    return null;
  }

  if (HTTPS_RE.test(trimmed)) {
    return { href: trimmed, clickable: true };
  }

  if (options.allowFileLinks) {
    const localFileHref =
      pathToFileHref(trimmed) ??
      (trimmed.startsWith('#')
        ? null
        : resolveRelativeFileHref(trimmed, options.basePath));

    if (localFileHref) {
      return { href: localFileHref, clickable: true };
    }
  }

  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('/') ||
    !URI_SCHEME_RE.test(trimmed)
  ) {
    return { href: trimmed, clickable: false };
  }

  return null;
}
