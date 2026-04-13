import { useMemo } from 'react';
import WYSIWYGEditor from '@/components/ui/wysiwyg';
import { cn } from '@/lib/utils';
import {
  fileHrefToPath,
  pathToFileHref,
  resolveLocalPathToAbsolutePath,
} from '@/utils/readOnlyLinks';

const FILE_PATH_RE =
  /(^|[\s([{"'])(?<path>(?:[a-zA-Z]:\\(?:[^\\\r\n<>:"|?*]+\\){2,}[^\\\r\n<>:"|?*\s`"')\]}.,:;!?]+|[a-zA-Z]:\\(?:[^\\\r\n<>:"|?*]+\\)*[^\\\r\n<>:"|?*]+\.[a-zA-Z0-9]{1,16}|\/(?:[^\/\r\n]+\/){2,}[^\/\r\n\s`"')\]}.,:;!?]+|\/(?:[^\/\r\n]+\/)*[^\/\r\n]+\.[a-zA-Z0-9]{1,16}|(?:\.{1,2}[\\/])?(?:[^\\/\r\n\s`"')\]}.,:;!?]+[\\/])*[^\\/\r\n\s`"')\]}.,:;!?]+\.[a-zA-Z0-9]{1,16}))/g;

interface ChatMarkdownProps {
  content: string;
  maxWidth?: string;
  className?: string;
  textClassName?: string;
  workspaceId?: string;
  hideCopyButton?: boolean;
  allowFileLinks?: boolean;
  readOnlyLinkBasePath?: string | null;
  onFilePath?: (absPath: string, workspacePath: string) => void;
}

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/([\\\[\]])/g, '\\$1');
}

function getFileLinkHref(
  path: string,
  workspacePath: string | null
): string | null {
  const absolutePath = resolveLocalPathToAbsolutePath(path, workspacePath);
  if (absolutePath) {
    return pathToFileHref(absolutePath);
  }

  if (workspacePath) {
    return encodeURI(path.replace(/\\/g, '/'));
  }

  return pathToFileHref(path);
}

function isFilePathCandidate(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) {
    return false;
  }

  if (
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) &&
    !/^[a-zA-Z]:[\\/]/.test(trimmed) &&
    !trimmed.startsWith('file://')
  ) {
    return false;
  }

  FILE_PATH_RE.lastIndex = 0;
  return FILE_PATH_RE.test(` ${trimmed}`);
}

function rewriteMarkdownFileLinks(
  segment: string,
  workspacePath: string | null
): string {
  return segment.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (match, label: string, href: string) => {
      if (!isFilePathCandidate(href)) {
        return match;
      }

      const resolvedHref = getFileLinkHref(href, workspacePath);
      if (!resolvedHref) {
        return match;
      }

      return `[${label}](${resolvedHref})`;
    }
  );
}

function isMarkdownLinkTarget(text: string, index: number): boolean {
  return text.slice(Math.max(0, index - 2), index) === '](';
}

function linkifyFilePaths(
  content: string,
  workspacePath: string | null
): string {
  let inFence = false;

  return content
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }

      if (inFence) {
        return line;
      }

      return line
        .split(/(`[^`]*`)/g)
        .map((segment, index) => {
          if (index % 2 === 1) {
            const candidate = segment.slice(1, -1).trim();
            if (!isFilePathCandidate(candidate)) {
              return segment;
            }

            const href = getFileLinkHref(candidate, workspacePath);
            if (!href) {
              return segment;
            }

            return `[${escapeMarkdownLinkText(candidate)}](${href})`;
          }

          const markdownLinkResolved = rewriteMarkdownFileLinks(
            segment,
            workspacePath
          );

          return markdownLinkResolved.replace(
            FILE_PATH_RE,
            (
              match,
              prefix: string,
              _path: string,
              offset: number,
              source: string,
              groups?: { path?: string }
            ) => {
              const candidate = groups?.path;
              if (!candidate) {
                return match;
              }

              const pathIndex = offset + prefix.length;
              if (isMarkdownLinkTarget(source, pathIndex)) {
                return match;
              }

              const href = getFileLinkHref(candidate, workspacePath);
              if (!href) {
                return match;
              }

              return `${prefix}[${escapeMarkdownLinkText(candidate)}](${href})`;
            }
          );
        })
        .join('');
    })
    .join('\n');
}

export function ChatMarkdown({
  content,
  maxWidth = '800px',
  className,
  textClassName = 'text-sm',
  workspaceId,
  hideCopyButton,
  allowFileLinks = false,
  readOnlyLinkBasePath = null,
  onFilePath,
}: ChatMarkdownProps) {
  const workspacePath = readOnlyLinkBasePath;
  const resolvedContent = useMemo(
    () =>
      onFilePath ? linkifyFilePaths(content, workspacePath) : content,
    [content, onFilePath, workspacePath]
  );

  return (
    <div className={className} style={{ maxWidth }}>
      <WYSIWYGEditor
        value={resolvedContent}
        disabled
        className={cn('whitespace-pre-wrap break-words', textClassName)}
        taskAttemptId={workspaceId}
        hideCopyButton={hideCopyButton}
        allowFileLinks={allowFileLinks || !!onFilePath}
        readOnlyLinkBasePath={readOnlyLinkBasePath}
        onReadOnlyLinkClick={(resolvedHref, originalHref) => {
          if (!onFilePath) return;
          const absPath =
            fileHrefToPath(resolvedHref) ??
            resolveLocalPathToAbsolutePath(originalHref, workspacePath);
          if (!absPath) return;
          onFilePath(absPath, workspacePath ?? '');
        }}
      />
    </div>
  );
}
