import React, { useMemo, type CSSProperties } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface AgentMarkdownProps {
  content: string;
  fontSize?: number;
}

interface AgentMarkdownParts {
  mentions: string[];
  markdown: string;
}

export const extractAgentMarkdownParts = (
  content: string,
): AgentMarkdownParts => {
  const seenMentions = new Set<string>();
  const mentions: string[] = [];
  const markdown = content
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^(\s*@[a-zA-Z0-9_-]+\b\s*)+/);
      if (!match) return line;

      for (const mention of match[0].match(/@[a-zA-Z0-9_-]+\b/g) ?? []) {
        const key = mention.toLowerCase();
        if (!seenMentions.has(key)) {
          seenMentions.add(key);
          mentions.push(mention);
        }
      }

      return line.slice(match[0].length);
    })
    .join("\n")
    .trim();

  return { mentions, markdown };
};

const isExternalHref = (href: string): boolean =>
  /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href) && !href.startsWith("file://");

const markdownComponents: Components = {
  a({ href, children }) {
    const resolvedHref = typeof href === "string" ? href : "";
    const external = isExternalHref(resolvedHref);

    return (
      <a
        href={resolvedHref}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className="font-medium text-[var(--primary)] underline decoration-[var(--primary)]/40 underline-offset-2 transition hover:text-[var(--primary-hover)]"
      >
        {children}
      </a>
    );
  },
  p({ children }) {
    return <p className="my-2 first:mt-0 last:mb-0">{children}</p>;
  },
  h1({ children }) {
    return (
      <h1 className="mb-2 mt-4 text-[1.35em] font-semibold leading-tight text-[var(--ink)] first:mt-0">
        {children}
      </h1>
    );
  },
  h2({ children }) {
    return (
      <h2 className="mb-1.5 mt-3.5 text-[1.22em] font-semibold leading-tight text-[var(--ink)] first:mt-0">
        {children}
      </h2>
    );
  },
  h3({ children }) {
    return (
      <h3 className="mb-1 mt-3 text-[1.12em] font-semibold leading-snug text-[var(--ink)] first:mt-0">
        {children}
      </h3>
    );
  },
  h4({ children }) {
    return (
      <h4 className="mb-1 mt-2.5 text-[1.04em] font-semibold leading-snug text-[var(--ink)] first:mt-0">
        {children}
      </h4>
    );
  },
  h5({ children }) {
    return (
      <h5 className="mb-1 mt-2 text-[0.96em] font-semibold leading-snug text-[var(--ink)] first:mt-0">
        {children}
      </h5>
    );
  },
  h6({ children }) {
    return (
      <h6 className="mb-1 mt-2 text-[0.9em] font-semibold uppercase leading-snug tracking-normal text-[var(--ink-subtle)] first:mt-0">
        {children}
      </h6>
    );
  },
  ul({ children }) {
    return <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>;
  },
  li({ children }) {
    return (
      <li className="pl-1 marker:text-[var(--ink-tertiary)] [&>p]:my-0">
        {children}
      </li>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l border-[var(--hairline-strong)] pl-3 text-[0.98em] text-[var(--ink-subtle)]">
        {children}
      </blockquote>
    );
  },
  code({ children }) {
    return (
      <code className="break-words rounded border border-[var(--mono-border)] bg-[var(--mono-bg)] px-1 py-0.5 font-mono text-[0.95em] font-medium text-[var(--ink)] [overflow-wrap:anywhere]">
        {children}
      </code>
    );
  },
  pre({ children }) {
    return (
      <pre className="my-2 max-w-full overflow-x-auto rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-3 font-mono text-[0.92em] leading-relaxed text-[var(--ink-muted)] [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
        {children}
      </pre>
    );
  },
  table({ children }) {
    return (
      <div className="my-2 max-w-full overflow-x-auto rounded-md border border-[var(--hairline)]">
        <table className="w-full border-collapse text-left text-[0.95em]">
          {children}
        </table>
      </div>
    );
  },
  th({ children }) {
    return (
      <th className="border-b border-[var(--hairline)] bg-[var(--surface-1)] px-2 py-1 font-semibold text-[var(--ink)]">
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td className="border-t border-[var(--hairline)] px-2 py-1">
        {children}
      </td>
    );
  },
  hr() {
    return <hr className="my-3 border-[var(--hairline)]" />;
  },
};

export const AgentMarkdown: React.FC<AgentMarkdownProps> = ({
  content,
  fontSize = 14,
}) => {
  const parts = useMemo(() => extractAgentMarkdownParts(content), [content]);
  const markdownStyle = useMemo<CSSProperties>(
    () => ({ fontSize: `${fontSize}px` }),
    [fontSize],
  );

  if (!parts.markdown && parts.mentions.length === 0) return null;

  return (
    <div
      className="min-w-0 max-w-full break-words leading-relaxed text-[var(--ink-muted)] select-text"
      style={markdownStyle}
    >
      {parts.mentions.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {parts.mentions.map((mention) => (
            <span
              key={mention.toLowerCase()}
              data-agent-mention={mention}
              className="font-mono font-semibold text-[var(--primary)]"
            >
              {mention}
            </span>
          ))}
        </div>
      )}
      {parts.markdown && (
        <ReactMarkdown
          components={markdownComponents}
          remarkPlugins={[remarkGfm]}
        >
          {parts.markdown}
        </ReactMarkdown>
      )}
    </div>
  );
};
