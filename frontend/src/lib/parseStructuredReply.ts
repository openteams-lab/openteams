// =============================================================================
// Structured agent reply parser
// -----------------------------------------------------------------------------
// Agent replies may arrive as a JSON-array string following the OpenTeams
// chat-output protocol, where each item has the shape:
//   { type: "send" | "artifact" | "conclusion" | "record", content: string, ... }
// When the whole `backend.content` string is such an array, we split it into:
//   - replyText : joined `send` contents (falls back to `conclusion`)
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
      /** Visible reply body: joined sends, or the conclusion when no send. */
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
  content: string;
}

const isReplyItem = (value: unknown): value is ReplyItem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.type === 'string' &&
    KNOWN_ITEM_TYPES.has(obj.type) &&
    typeof obj.content === 'string'
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

  for (const item of items) {
    if (item.type === 'send') {
      if (item.content.trim()) sends.push(item.content);
    } else if (item.type === 'artifact') {
      const path = item.content.trim();
      if (path) artifacts.push({ path, raw: item.content });
    } else if (item.type === 'conclusion') {
      conclusion = item.content;
    }
    // "record" items are not user-facing and are ignored for rendering.
  }

  // If nothing renderable was produced, keep the raw text visible.
  if (sends.length === 0 && artifacts.length === 0 && !conclusion) {
    return { kind: 'plain' };
  }

  const replyText =
    sends.length > 0 ? sends.join('\n\n') : conclusion ?? '';

  return { kind: 'structured', replyText, artifacts, conclusion };
};

/**
 * Normalize a file path for matching against source-control / workspace
 * change entries: trim, strip a leading "./" or "/", and lowercase.
 * The original casing is preserved for display.
 */
export const normalizeArtifactPath = (path: string): string =>
  path.trim().replace(/^\.?\//, '').toLowerCase();
