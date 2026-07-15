import { useMemo, type MouseEvent } from 'react';
import { Check, Clipboard } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { cn } from '@/lib/utils';
import {
  fileHrefToPath,
  pathToFileHref,
  resolveLocalPathToAbsolutePath,
} from '@/utils/readOnlyLinks';
import { writeClipboardViaBridge } from '@/vscode/bridge';

const FILE_PATH_RE =
  /(^|[\s([{"'])(?<path>(?:[a-zA-Z]:\\(?:[^\\\r\n<>:"|?*]+\\){2,}[^\\\r\n<>:"|?*\s`"')\]}.,:;!?]+|[a-zA-Z]:\\(?:[^\\\r\n<>:"|?*]+\\)*[^\\\r\n<>:"|?*]+\.[a-zA-Z0-9]{1,16}|\/(?:[^/\r\n]+\/){2,}[^/\r\n\s`"')\]}.,:;!?]+|\/(?:[^/\r\n]+\/)*[^/\r\n]+\.[a-zA-Z0-9]{1,16}|(?:\.{1,2}[\\/])?(?:[^\\/\r\n\s`"')\]}.,:;!?]+[\\/])*[^\\/\r\n\s`"')\]}.,:;!?]+\.[a-zA-Z0-9]{1,16}))/g;

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
  return value.replace(/([\\[\]])/g, '\\$1');
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

function isExternalHref(href: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href) && !href.startsWith('file://');
}

const markdownElementProps = <
  T extends { key?: unknown; node?: unknown; ref?: unknown },
>(
  props: T
) => {
  const { key: _key, node: _node, ref: _ref, ...rest } = props;
  return rest;
};

export function ChatMarkdown({
  content,
  maxWidth = '800px',
  className,
  textClassName = 'text-sm',
  hideCopyButton = false,
  readOnlyLinkBasePath = null,
  onFilePath,
}: ChatMarkdownProps) {
  const { t } = useAppTranslation();
  const workspacePath = readOnlyLinkBasePath;
  const resolvedContent = useMemo(
    () => (onFilePath ? linkifyFilePaths(content, workspacePath) : content),
    [content, onFilePath, workspacePath]
  );

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    if (!content) return;
    const copiedText = content.replace(/\\_/g, '_');
    await writeClipboardViaBridge(copiedText);
    const button = event.currentTarget;
    button.dataset.copied = 'true';
    button.title = t('chatMarkdown.copied', { defaultValue: 'Copied!' });
    button.setAttribute(
      'aria-label',
      t('chatMarkdown.copied', { defaultValue: 'Copied!' })
    );
    window.setTimeout(() => {
      button.dataset.copied = 'false';
      button.title = t('chatMarkdown.copy', {
        defaultValue: 'Copy as Markdown',
      });
      button.setAttribute(
        'aria-label',
        t('chatMarkdown.copy', { defaultValue: 'Copy as Markdown' })
      );
    }, 1200);
  };

  const components = useMemo<Components>(
    () => ({
      a({ href, children, className: linkClassName, ...props }) {
        const resolvedHref = typeof href === 'string' ? href : '';
        const external = isExternalHref(resolvedHref);

        const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
          if (!onFilePath || !resolvedHref) return;

          const originalHref = decodeURI(resolvedHref);
          const absPath =
            fileHrefToPath(resolvedHref) ??
            resolveLocalPathToAbsolutePath(originalHref, workspacePath);
          if (!absPath) return;

          event.preventDefault();
          onFilePath(absPath, workspacePath ?? '');
        };

        return (
          <a
            {...markdownElementProps(props)}
            href={resolvedHref}
            className={cn(
              'font-medium text-blue-600 underline decoration-blue-300 underline-offset-2 transition-colors hover:text-blue-700 hover:decoration-blue-500',
              linkClassName
            )}
            target={external ? '_blank' : undefined}
            rel={external ? 'noreferrer' : undefined}
            onClick={handleClick}
          >
            {children}
          </a>
        );
      },
      p({ children, className: paragraphClassName, ...props }) {
        return (
          <p
            {...markdownElementProps(props)}
            className={cn('my-2 first:mt-0 last:mb-0', paragraphClassName)}
          >
            {children}
          </p>
        );
      },
      h1({ children, className: headingClassName, ...props }) {
        return (
          <h1
            {...markdownElementProps(props)}
            className={cn(
              'mb-2 mt-3 text-base font-semibold leading-6 text-slate-900 first:mt-0',
              headingClassName
            )}
          >
            {children}
          </h1>
        );
      },
      h2({ children, className: headingClassName, ...props }) {
        return (
          <h2
            {...markdownElementProps(props)}
            className={cn(
              'mb-2 mt-3 text-[0.98em] font-semibold leading-6 text-slate-900 first:mt-0',
              headingClassName
            )}
          >
            {children}
          </h2>
        );
      },
      h3({ children, className: headingClassName, ...props }) {
        return (
          <h3
            {...markdownElementProps(props)}
            className={cn(
              'mb-1.5 mt-3 text-[0.95em] font-semibold leading-5 text-slate-800 first:mt-0',
              headingClassName
            )}
          >
            {children}
          </h3>
        );
      },
      h4({ children, className: headingClassName, ...props }) {
        return (
          <h4
            {...markdownElementProps(props)}
            className={cn(
              'mb-1.5 mt-2 text-[0.92em] font-semibold leading-5 text-slate-800 first:mt-0',
              headingClassName
            )}
          >
            {children}
          </h4>
        );
      },
      h5({ children, className: headingClassName, ...props }) {
        return (
          <h5
            {...markdownElementProps(props)}
            className={cn(
              'mb-1 mt-2 text-[0.9em] font-semibold leading-5 text-slate-700 first:mt-0',
              headingClassName
            )}
          >
            {children}
          </h5>
        );
      },
      h6({ children, className: headingClassName, ...props }) {
        return (
          <h6
            {...markdownElementProps(props)}
            className={cn(
              'mb-1 mt-2 text-[0.85em] font-semibold uppercase leading-5 tracking-normal text-slate-600 first:mt-0',
              headingClassName
            )}
          >
            {children}
          </h6>
        );
      },
      ul({ children, className: listClassName, ...props }) {
        return (
          <ul
            {...markdownElementProps(props)}
            className={cn('my-2 list-disc space-y-1 pl-5', listClassName)}
          >
            {children}
          </ul>
        );
      },
      ol({ children, className: listClassName, ...props }) {
        return (
          <ol
            {...markdownElementProps(props)}
            className={cn('my-2 list-decimal space-y-1 pl-5', listClassName)}
          >
            {children}
          </ol>
        );
      },
      li({ children, className: itemClassName, ...props }) {
        return (
          <li
            {...markdownElementProps(props)}
            className={cn(
              'pl-1 marker:text-slate-500 [&>p]:my-0',
              itemClassName
            )}
          >
            {children}
          </li>
        );
      },
      blockquote({ children, className: quoteClassName, ...props }) {
        return (
          <blockquote
            {...markdownElementProps(props)}
            className={cn(
              'my-3 rounded-r-lg border-l-4 border-slate-300 bg-slate-50 px-4 py-2 text-slate-600',
              quoteClassName
            )}
          >
            {children}
          </blockquote>
        );
      },
      code({ children, className: codeClassName, ...props }) {
        return (
          <code
            {...markdownElementProps(props)}
            className={cn(
              'rounded-md border border-slate-200/80 bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] font-medium text-slate-800',
              codeClassName
            )}
          >
            {children}
          </code>
        );
      },
      pre({ children, className: preClassName, ...props }) {
        return (
          <pre
            {...markdownElementProps(props)}
            className={cn(
              'my-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs leading-5 text-slate-100 shadow-inner',
              '[&_code]:!border-0 [&_code]:!bg-transparent [&_code]:!p-0 [&_code]:!text-inherit',
              preClassName
            )}
          >
            {children}
          </pre>
        );
      },
      table({ children, className: tableClassName, ...props }) {
        return (
          <div className="my-3 overflow-x-auto rounded-lg border border-slate-200">
            <table
              {...markdownElementProps(props)}
              className={cn(
                'w-full border-collapse text-left text-[0.95em]',
                tableClassName
              )}
            >
              {children}
            </table>
          </div>
        );
      },
      th({ children, className: cellClassName, ...props }) {
        return (
          <th
            {...markdownElementProps(props)}
            className={cn(
              'border-b border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700',
              cellClassName
            )}
          >
            {children}
          </th>
        );
      },
      td({ children, className: cellClassName, ...props }) {
        return (
          <td
            {...markdownElementProps(props)}
            className={cn('border-t border-slate-100 px-3 py-2', cellClassName)}
          >
            {children}
          </td>
        );
      },
      hr({ className: hrClassName, ...props }) {
        return (
          <hr
            {...markdownElementProps(props)}
            className={cn('my-4 border-slate-200', hrClassName)}
          />
        );
      },
      img({ className: imageClassName, alt, ...props }) {
        return (
          <img
            {...markdownElementProps(props)}
            alt={alt ?? ''}
            className={cn(
              'my-3 max-w-full rounded-lg border border-slate-200',
              imageClassName
            )}
          />
        );
      },
    }),
    [onFilePath, workspacePath]
  );

  return (
    <div
      className={cn('group relative select-text', className)}
      style={{ maxWidth }}
    >
      {!hideCopyButton && (
        <div className="sticky top-0 right-2 z-10 h-0 pointer-events-none">
          <div className="flex justify-end opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <button
              type="button"
              aria-label={t('chatMarkdown.copy', {
                defaultValue: 'Copy as Markdown',
              })}
              title={t('chatMarkdown.copy', {
                defaultValue: 'Copy as Markdown',
              })}
              onClick={handleCopy}
              data-copied="false"
              className="chat-markdown-copy-button pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
            >
              <Clipboard className="chat-markdown-copy-clipboard h-4 w-4" />
              <Check className="chat-markdown-copy-check h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      <div
        className={cn(
          'wysiwyg min-w-0 whitespace-normal break-words select-text',
          textClassName
        )}
      >
        <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
          {resolvedContent}
        </ReactMarkdown>
      </div>
    </div>
  );
}
