import { parseDiffStats } from '@/utils/diffStatsParser';
import { mentionTokenRegex, messagePalette, userMessageTone } from './constants';
import type { ChatAttachment, DiffFileEntry, DiffMeta, MessageTone } from './types';

export function hashKey(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getMessageTone(key: string, isUser: boolean): MessageTone {
  if (isUser) {
    return userMessageTone;
  }
  const index = hashKey(key) % messagePalette.length;
  return messagePalette[index];
}

export function extractMentions(content: string): Set<string> {
  const mentions = new Set<string>();
  for (const match of content.matchAll(mentionTokenRegex)) {
    const name = match[2];
    if (name) mentions.add(name);
  }
  return mentions;
}

export function extractRunId(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const runId = (meta as { run_id?: unknown }).run_id;
  return typeof runId === 'string' ? runId : null;
}

export function sanitizeHandle(value: string | null | undefined): string {
  if (!value) return 'you';
  const sanitized = value
    .split('@')[0]
    .split(' ')[0]
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  return sanitized.length > 0 ? sanitized : 'you';
}

export function extractDiffMeta(meta: unknown): DiffMeta {
  if (!meta || typeof meta !== 'object') {
    return {
      runId: null,
      preview: null,
      truncated: false,
      available: false,
      untrackedFiles: [],
    };
  }
  const raw = meta as {
    run_id?: unknown;
    diff_preview?: unknown;
    diff_truncated?: unknown;
    diff_available?: unknown;
    untracked_files?: unknown;
  };
  const runId = typeof raw.run_id === 'string' ? raw.run_id : null;
  const preview = typeof raw.diff_preview === 'string' ? raw.diff_preview : null;
  const truncated = raw.diff_truncated === true;
  const available = raw.diff_available === true || preview !== null;
  const untrackedFiles = Array.isArray(raw.untracked_files)
    ? raw.untracked_files.filter((item) => typeof item === 'string')
    : [];
  return { runId, preview, truncated, available, untrackedFiles };
}

export function extractReferenceId(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const raw = meta as {
    reference?: { message_id?: unknown };
    reference_message_id?: unknown;
  };
  if (raw.reference && typeof raw.reference === 'object') {
    const value = raw.reference.message_id;
    if (typeof value === 'string') return value;
  }
  return typeof raw.reference_message_id === 'string'
    ? raw.reference_message_id
    : null;
}

export function extractAttachments(meta: unknown): ChatAttachment[] {
  if (!meta || typeof meta !== 'object') return [];
  const raw = meta as { attachments?: unknown };
  if (!Array.isArray(raw.attachments)) return [];
  return raw.attachments
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as ChatAttachment)
    .filter((item) => typeof item.id === 'string');
}

export function formatBytes(value?: number | null): string {
  if (!value || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const decimals = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

export function splitUnifiedDiff(patch: string): DiffFileEntry[] {
  const lines = patch.split('\n');
  const entries: DiffFileEntry[] = [];
  let current: string[] = [];
  let currentPath = '';

  const flush = () => {
    if (current.length === 0) return;
    const content = current.join('\n');
    const path = currentPath || 'unknown';
    const stats = parseDiffStats(content);
    entries.push({
      path,
      patch: content,
      additions: stats.additions,
      deletions: stats.deletions,
    });
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush();
      current = [line];
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      currentPath = match?.[2] || line.replace('diff --git ', '').trim();
      continue;
    }
    if (current.length > 0) {
      current.push(line);
    }
  }

  flush();
  return entries;
}
