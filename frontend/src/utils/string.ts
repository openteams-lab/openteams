/**
 * Converts SCREAMING_SNAKE_CASE to "Pretty Case"
 * @param value - The string to convert
 * @returns Formatted string with proper capitalization
 */
export const toPrettyCase = (value: string): string => {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

/**
 * Generates a pretty project name from a file path
 * Converts directory names like "my-awesome-project" to "My Awesome Project"
 * @param path - The file path to extract name from
 * @returns Formatted project name
 */
export const generateProjectNameFromPath = (path: string): string => {
  const dirName = path.split('/').filter(Boolean).pop() || '';
  return dirName.replace(/[-_]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
};

/**
 * Removes a single trailing newline sequence from a string.
 * Handles CRLF/CR/LF endings while leaving other trailing whitespace intact.
 */
export const stripLineEnding = (value: string): string => {
  return value.replace(/(?:\r\n|\r|\n)$/, '');
};

/**
 * Splits a string by newlines and returns an array of lines.
 * Handles CRLF, CR, and LF line endings.
 */
export const splitLines = (value: string): string[] => {
  return value.split(/\r\n|\r|\n/);
};

/**
 * Formats a token count using K/M suffixes for large numbers.
 * Examples: 999 → "999", 1000 → "1K", 1200 → "1.2K", 1500000 → "1.5M"
 */
export function formatTokenCount(tokens: number): string {
  const fmt = (n: number): string => {
    const s = n.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
  };
  if (tokens >= 1_000_000) {
    return `${fmt(tokens / 1_000_000)}M`;
  }
  if (tokens >= 1_000) {
    return `${fmt(tokens / 1_000)}K`;
  }
  return tokens.toString();
}

/** Formats a TokenUsageInfo into a compact human-readable string.
 *  Shows every non-null/non-zero breakdown field available.
 *  Falls back to total_tokens when no breakdown is present.
 *
 *  Example outputs:
 *   Claude Code:  "in:12.4K  out:2.6K  cache_rd:8.1K  cache_wr:512"
 *   Codex:        "in:10K  out:1.2K  cache_rd:4K"
 *   Gemini/QWen:  "14.6K"  (total only, fallback)
 */
export interface TokenUsageDisplayInfo {
  total_tokens: number;
  model_context_window?: number;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  is_estimated?: boolean;
}

export function formatTokenUsage(info: TokenUsageDisplayInfo): string {
  const parts: string[] = [];

  if (typeof info.input_tokens === 'number') {
    parts.push(`in:${formatTokenCount(info.input_tokens)}`);
  }
  if (typeof info.output_tokens === 'number') {
    parts.push(`out:${formatTokenCount(info.output_tokens)}`);
  }
  if (
    typeof info.cache_read_tokens === 'number' &&
    info.cache_read_tokens > 0
  ) {
    parts.push(`cache_rd:${formatTokenCount(info.cache_read_tokens)}`);
  }
  if (
    typeof info.cache_write_tokens === 'number' &&
    info.cache_write_tokens > 0
  ) {
    parts.push(`cache_wr:${formatTokenCount(info.cache_write_tokens)}`);
  }

  // Fallback: no breakdown available
  if (parts.length === 0) {
    return `${info.is_estimated ? '~' : ''}${formatTokenCount(info.total_tokens)}`;
  }

  return `${info.is_estimated ? '~' : ''}${parts.join('  ')}`;
}

/**
 * Splits a message into title (max 100 chars) and description.
 * - First line becomes the title (truncated at word boundary if > 100 chars)
 * - Overflow from first line + remaining lines become description
 */
export function splitMessageToTitleDescription(message: string): {
  title: string;
  description: string | null;
} {
  const trimmed = message.trim();
  const lines = trimmed.split('\n');
  const firstLine = lines[0];
  const restOfLines = lines.slice(1).join('\n').trim();

  if (firstLine.length <= 100) {
    return {
      title: firstLine,
      description: restOfLines || null,
    };
  }

  // Find word boundary in first 100 chars
  const truncated = firstLine.substring(0, 100);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > 50) {
    // Split at word boundary (if at least half the title is preserved)
    const title = truncated.substring(0, lastSpace);
    const overflow = firstLine.substring(lastSpace + 1);
    return {
      title,
      description: restOfLines ? `${overflow}\n\n${restOfLines}` : overflow,
    };
  }

  // Fall back to character split
  const overflow = firstLine.substring(100);
  return {
    title: truncated,
    description: restOfLines ? `${overflow}\n\n${restOfLines}` : overflow,
  };
}
