import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LinkNode } from '@lexical/link';
import { resolveReadOnlyLink } from '@/utils/readOnlyLinks';

function applyLinkState(
  dom: HTMLAnchorElement,
  href: string | null,
  options: {
    allowFileLinks?: boolean;
    basePath?: string | null;
  }
) {
  const resolved = resolveReadOnlyLink(href, options);

  if (!resolved) {
    dom.removeAttribute('href');
    dom.removeAttribute('role');
    dom.removeAttribute('target');
    dom.removeAttribute('rel');
    dom.removeAttribute('aria-disabled');
    dom.style.cursor = 'not-allowed';
    dom.style.pointerEvents = 'none';
    dom.title = href ?? '';
    dom.onclick = null;
    return;
  }

  if (resolved.clickable) {
    dom.setAttribute('href', resolved.href);
    dom.removeAttribute('role');
    dom.setAttribute('target', '_blank');
    dom.setAttribute('rel', 'noopener noreferrer');
    dom.removeAttribute('aria-disabled');
    dom.style.cursor = 'pointer';
    dom.style.pointerEvents = 'auto';
    dom.title = href ?? resolved.href;
    dom.onclick = (event) => event.stopPropagation();
    return;
  }

  dom.removeAttribute('href');
  dom.removeAttribute('target');
  dom.removeAttribute('rel');
  dom.setAttribute('role', 'link');
  dom.setAttribute('aria-disabled', 'true');
  dom.style.cursor = 'not-allowed';
  dom.style.pointerEvents = 'none';
  dom.title = href ?? '';
  dom.onclick = null;
}

/**
 * Plugin that handles link sanitization and security attributes in read-only mode.
 * - Blocks dangerous protocols (javascript:, vbscript:, data:)
 * - External HTTPS links: clickable with target="_blank" and rel="noopener noreferrer"
 * - Optional local file links: clickable when explicitly enabled
 * - Internal/relative links: rendered but not clickable unless resolved to a local file
 */
export function ReadOnlyLinkPlugin({
  allowFileLinks = false,
  basePath = null,
}: {
  allowFileLinks?: boolean;
  basePath?: string | null;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Register a mutation listener to modify link DOM elements
    const unregister = editor.registerMutationListener(
      LinkNode,
      (mutations) => {
        for (const [nodeKey, mutation] of mutations) {
          if (mutation === 'destroyed') continue;

          const dom = editor.getElementByKey(nodeKey);
          if (!dom || !(dom instanceof HTMLAnchorElement)) continue;

          applyLinkState(dom, dom.getAttribute('href'), {
            allowFileLinks,
            basePath,
          });
        }
      }
    );

    // Also handle existing links on mount by triggering a read
    editor.getEditorState().read(() => {
      const root = editor.getRootElement();
      if (!root) return;

      const links = root.querySelectorAll('a');
      links.forEach((link) => {
        applyLinkState(link, link.getAttribute('href'), {
          allowFileLinks,
          basePath,
        });
      });
    });

    return unregister;
  }, [allowFileLinks, basePath, editor]);

  return null;
}
