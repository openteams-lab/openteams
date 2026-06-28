// =============================================================================
// Structured agent reply parser
// -----------------------------------------------------------------------------
// Agent replies may arrive as a JSON-array string following the OpenTeams
// chat-output protocol, where each item has the shape:
//   { type: "send" | "artifact" | "conclusion" | "record", content: string, ... }
// When the whole `backend.content` string is such an array, we split it into:
//   - replyText : joined `send` contents (falls back to `conclusion`, then `record`)
//   - artifacts : `artifact` entries (file paths)
//   - conclusion: the `conclusion` content (used when there is no `send`)
// Anything that is not a strict match for this shape is treated as plain
// markdown (kind: "plain") so ordinary agent replies render unchanged.
//
// This is a pure, side-effect-free module. It performs NO network access and
// is safe to call during render.
// =============================================================================

import type { ArtifactItem } from '@/types';

export type StructuredReply =
  | {
      kind: 'structured';
      /** Visible reply body: joined sends, or conclusion/record fallback. */
      replyText: string;
      artifacts: ArtifactItem[];
      conclusion: string | null;
    }
  | { kind: 'plain' };

const KNOWN_ITEM_TYPES = new Set<string>([
  'send',
  'artifact',
  'conclusion',
  'record',
]);

interface ReplyItem {
  type: string;
  content: string | string[];
}

const isReplyItem = (value: unknown): value is ReplyItem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type : null;
  const contentIsString = typeof obj.content === 'string';
  const contentIsStringArray =
    Array.isArray(obj.content) &&
    obj.content.every((item) => typeof item === 'string');
  return (
    type !== null &&
    KNOWN_ITEM_TYPES.has(type) &&
    (contentIsString || (type === 'artifact' && contentIsStringArray))
  );
};

/**
 * Parse an agent reply string into a structured shape. Returns
 * `{ kind: "plain" }` for anything that is not a strict JSON-array of protocol
 * items, so callers can fall back to rendering the raw text as markdown.
 */
export const parseStructuredAgentReply = (text: string): StructuredReply => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return { kind: 'plain' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: 'plain' };
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { kind: 'plain' };
  }

  if (!parsed.every(isReplyItem)) {
    return { kind: 'plain' };
  }

  const items = parsed as ReplyItem[];
  const sends: string[] = [];
  const artifacts: ArtifactItem[] = [];
  let conclusion: string | null = null;
  const records: string[] = [];

  for (const item of items) {
    if (item.type === 'send') {
      const content = typeof item.content === 'string' ? item.content : '';
      if (content.trim()) sends.push(content);
    } else if (item.type === 'artifact') {
      const raw = Array.isArray(item.content)
        ? JSON.stringify(item.content)
        : item.content;
      for (const path of extractArtifactPaths(raw)) {
        artifacts.push({ path, raw });
      }
    } else if (item.type === 'conclusion') {
      conclusion = typeof item.content === 'string' ? item.content : '';
    } else if (item.type === 'record') {
      const content = typeof item.content === 'string' ? item.content : '';
      if (content.trim()) records.push(content);
    }
  }

  // If nothing renderable was produced, keep the raw text visible.
  if (
    sends.length === 0 &&
    artifacts.length === 0 &&
    !conclusion &&
    records.length === 0
  ) {
    return { kind: 'plain' };
  }

  const replyText =
    sends.length > 0
      ? sends.join('\n\n')
      : (conclusion ?? records.join('\n\n'));

  return { kind: 'structured', replyText, artifacts, conclusion };
};

/**
 * Normalize a file path for matching against source-control / workspace
 * change entries: trim, strip a leading "./" or "/", and lowercase.
 * The original casing is preserved for display.
 */
export const normalizeArtifactPath = (path: string): string =>
  path.trim().replace(/^\.?\//, '').toLowerCase();

const FILE_EXTENSION_RE = /\.[a-z0-9]{1,8}$/i;

const looksLikePathString = (token: string, allowWhitespace: boolean): boolean => {
  const trimmed = token.trim();
  if (
    !trimmed ||
    trimmed.includes('://') ||
    (!allowWhitespace && /\s/.test(trimmed))
  ) {
    return false;
  }
  return (
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    FILE_EXTENSION_RE.test(trimmed)
  );
};

/**
 * Whether a token looks like a real workspace-relative file path: it must not
 * be a URL, must not contain whitespace, and must either contain a path
 * separator or end with a recognizable file extension.
 */
export const looksLikeFilePath = (token: string): boolean =>
  looksLikePathString(token, false);

const BACKTICK_PATH_RE = /`([^`\r\n]+)`/g;

/**
 * Extract real, valid file paths from an artifact entry's free-text content.
 *
 * Artifact content is not guaranteed to be a clean path — it may be a sentence
 * such as `Saved \`a.ts\`, \`b.rs\`, and \`c.json\`.` or a bare path. This
 * extracts backtick-wrapped tokens first; when there are none, it falls back to
 * splitting the content on commas / whitespace. Only tokens that look like file
 * paths (see {@link looksLikeFilePath}) are kept, so non-path artifact content
 * yields no rows.
 *
 * Returned paths are workspace-relative (leading `./` / `/` stripped) and
 * deduplicated by normalized (lowercased) form; original casing is preserved.
 */
export const extractArtifactPaths = (content: string): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string, trustedListItem = false): void => {
    const trimmed = raw.trim().replace(/^\.?\//, '').trim();
    if (
      !trimmed ||
      !looksLikePathString(trimmed, trustedListItem) ||
      trimmed.includes('://')
    ) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  };

  try {
    const parsed = JSON.parse(content.trim());
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'string')
    ) {
      parsed.forEach((item) => push(item, true));
      return result;
    }
  } catch {
    // Non-JSON artifact content falls through to legacy free-text extraction.
  }

  const backtickMatches: string[] = [];
  let match: RegExpExecArray | null;
  BACKTICK_PATH_RE.lastIndex = 0;
  while ((match = BACKTICK_PATH_RE.exec(content)) !== null) {
    backtickMatches.push(match[1]);
  }

  if (backtickMatches.length > 0) {
    backtickMatches.forEach((path) => push(path));
    return result;
  }

  const trimmedContent = content.trim();
  if (looksLikeFilePath(trimmedContent)) {
    push(trimmedContent);
    return result;
  }

  trimmedContent
    .split(/[,;]|\s+/)
    .forEach((segment) => push(segment));
  return result;
};
