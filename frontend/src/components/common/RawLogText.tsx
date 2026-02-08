import { memo } from 'react';
import { AnsiHtml } from 'fancy-ansi/react';
import { hasAnsi } from 'fancy-ansi';
import { clsx } from 'clsx';

// Utility function to check if a string is valid JSON
const isValidJSON = (str: string): boolean => {
  if (!str.trim()) return false;
  const trimmed = str.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
};

// Utility function to convert JSON log to readable text format
const formatJSONLog = (jsonStr: string): string => {
  try {
    const parsed = JSON.parse(jsonStr);

    // Check if it's a log object (has common log fields)
    const isLogObject = typeof parsed === 'object' && parsed !== null;
    if (!isLogObject) {
      return JSON.stringify(parsed, null, 2);
    }

    const lines: string[] = [];

    // Extract common log fields
    const timestamp = parsed.timestamp || parsed.time || parsed.ts || parsed.date;
    const level = parsed.level || parsed.severity || parsed.lvl;
    const message = parsed.message || parsed.msg || parsed.text;

    // Build the main log line
    const parts: string[] = [];
    if (timestamp) parts.push(`[${timestamp}]`);
    if (level) parts.push(String(level).toUpperCase());
    if (message) parts.push(String(message));

    if (parts.length > 0) {
      lines.push(parts.join(' '));
    }

    // Add remaining fields as key-value pairs
    const excludeKeys = new Set(['timestamp', 'time', 'ts', 'date', 'level', 'severity', 'lvl', 'message', 'msg', 'text']);
    const remainingEntries = Object.entries(parsed).filter(([key]) => !excludeKeys.has(key));

    if (remainingEntries.length > 0) {
      for (const [key, value] of remainingEntries) {
        if (typeof value === 'object' && value !== null) {
          lines.push(`  ${key}: ${JSON.stringify(value)}`);
        } else {
          lines.push(`  ${key}: ${value}`);
        }
      }
    }

    // If no recognizable log structure, just pretty-print the JSON
    if (lines.length === 0) {
      return JSON.stringify(parsed, null, 2);
    }

    return lines.join('\n');
  } catch {
    return jsonStr;
  }
};

interface RawLogTextProps {
  content: string;
  channel?: 'stdout' | 'stderr';
  as?: 'div' | 'span';
  className?: string;
  linkifyUrls?: boolean;
  searchQuery?: string;
  isCurrentMatch?: boolean;
}

const RawLogText = memo(
  ({
    content,
    channel = 'stdout',
    as: Component = 'div',
    className,
    linkifyUrls = false,
    searchQuery,
    isCurrentMatch = false,
  }: RawLogTextProps) => {
    // Only apply stderr fallback color when no ANSI codes are present
    const hasAnsiCodes = hasAnsi(content);
    const shouldApplyStderrFallback = channel === 'stderr' && !hasAnsiCodes;

    const highlightClass = isCurrentMatch
      ? 'bg-yellow-500/60 ring-1 ring-yellow-500 rounded-sm'
      : 'bg-yellow-500/30 rounded-sm';

    const highlightMatches = (text: string, key: string | number) => {
      if (!searchQuery) {
        return <AnsiHtml key={key} text={text} />;
      }

      const regex = new RegExp(
        `(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
        'gi'
      );
      const parts = text.split(regex);

      return parts.map((part, idx) => {
        if (part.toLowerCase() === searchQuery.toLowerCase()) {
          return (
            <mark key={`${key}-${idx}`} className={highlightClass}>
              <AnsiHtml text={part} />
            </mark>
          );
        }
        return <AnsiHtml key={`${key}-${idx}`} text={part} />;
      });
    };

    const renderContent = () => {
      // Check if the entire content is JSON and format it
      if (isValidJSON(content)) {
        const formatted = formatJSONLog(content);
        return highlightMatches(formatted, 'content');
      }

      if (!linkifyUrls) {
        return highlightMatches(content, 'content');
      }

      const urlRegex = /(https?:\/\/\S+)/g;
      const parts = content.split(urlRegex);

      return parts.map((part, index) => {
        if (/^https?:\/\/\S+$/.test(part)) {
          return (
            <a
              key={index}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-info hover:text-info/80 cursor-pointer"
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </a>
          );
        }
        // For non-URL parts, apply ANSI formatting with highlighting
        return highlightMatches(part, index);
      });
    };

    return (
      <Component
        className={clsx(
          'font-mono text-xs break-all whitespace-pre-wrap',
          shouldApplyStderrFallback && 'text-error',
          className
        )}
      >
        {renderContent()}
      </Component>
    );
  }
);

RawLogText.displayName = 'RawLogText';

export default RawLogText;
