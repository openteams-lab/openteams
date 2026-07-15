import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useShortcuts } from '@/shortcuts/ShortcutProvider';

type ActiveTooltip = {
  anchor: HTMLElement;
  text: string;
};

type StoredTitle = ActiveTooltip & {
  describedBy: string | null;
  originalTitle: string;
};

type TooltipPosition = {
  left: number;
  top: number;
  above: boolean;
};

function titleAnchor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest('[title]');
  return anchor instanceof HTMLElement ? anchor : null;
}

export function GlobalTooltip() {
  const { presentationFor } = useShortcuts();
  const tooltipId = useId();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const storedTitleRef = useRef<StoredTitle | null>(null);
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const closeTooltip = useCallback(() => {
    const stored = storedTitleRef.current;
    if (stored) {
      if (!stored.anchor.hasAttribute('title')) {
        stored.anchor.setAttribute('title', stored.originalTitle);
      }
      if (stored.describedBy) {
        stored.anchor.setAttribute('aria-describedby', stored.describedBy);
      } else {
        stored.anchor.removeAttribute('aria-describedby');
      }
    }
    storedTitleRef.current = null;
    setActive(null);
    setPosition(null);
  }, []);

  const openTooltip = useCallback(
    (anchor: HTMLElement) => {
      if (storedTitleRef.current?.anchor === anchor) return;
      closeTooltip();

      const originalTitle = anchor.getAttribute('title')?.trim();
      if (!originalTitle) return;
      const commandElement = anchor.closest<HTMLElement>('[data-command-id]');
      const commandId = commandElement?.dataset.commandId;
      let text = originalTitle;
      if (commandId) {
        try {
          const presentation = presentationFor(commandId);
          if (
            presentation.tooltipShortcut &&
            !text.includes(presentation.label)
          ) {
            text = `${text} (${presentation.tooltipShortcut})`;
          }
        } catch {
          // A stale or extension-owned command id should not break its tooltip.
        }
      }
      const describedBy = anchor.getAttribute('aria-describedby');
      const tooltipDescription = [describedBy, tooltipId]
        .filter(Boolean)
        .join(' ');

      anchor.removeAttribute('title');
      anchor.setAttribute('aria-describedby', tooltipDescription);
      storedTitleRef.current = { anchor, text, describedBy, originalTitle };
      setActive({ anchor, text });
      setPosition(null);
    },
    [closeTooltip, presentationFor, tooltipId],
  );

  useEffect(() => {
    const handlePointerOver = (event: PointerEvent) => {
      const current = storedTitleRef.current?.anchor;
      if (current && event.target instanceof Node && current.contains(event.target)) {
        return;
      }
      const anchor = titleAnchor(event.target);
      if (anchor) openTooltip(anchor);
    };
    const handlePointerOut = (event: PointerEvent) => {
      const current = storedTitleRef.current?.anchor;
      if (!current) return;
      if (
        event.relatedTarget instanceof Node &&
        current.contains(event.relatedTarget)
      ) {
        return;
      }
      if (current.contains(document.activeElement)) return;
      closeTooltip();
    };
    const handleFocusIn = (event: FocusEvent) => {
      const anchor = titleAnchor(event.target);
      if (anchor) openTooltip(anchor);
    };
    const handleFocusOut = (event: FocusEvent) => {
      const current = storedTitleRef.current?.anchor;
      if (!current) return;
      if (
        event.relatedTarget instanceof Node &&
        current.contains(event.relatedTarget)
      ) {
        return;
      }
      closeTooltip();
    };

    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    window.addEventListener('blur', closeTooltip);

    return () => {
      document.removeEventListener('pointerover', handlePointerOver, true);
      document.removeEventListener('pointerout', handlePointerOut, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      window.removeEventListener('blur', closeTooltip);
      closeTooltip();
    };
  }, [closeTooltip, openTooltip]);

  useLayoutEffect(() => {
    if (!active || !tooltipRef.current) return;

    const margin = 8;
    const gap = 8;
    const anchorRect = active.anchor.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const halfWidth = tooltipRect.width / 2;
    const anchorCenter = anchorRect.left + anchorRect.width / 2;
    const left = Math.min(
      window.innerWidth - margin - halfWidth,
      Math.max(margin + halfWidth, anchorCenter),
    );
    const above = anchorRect.top >= tooltipRect.height + gap + margin;

    setPosition({
      left,
      top: above ? anchorRect.top - gap : anchorRect.bottom + gap,
      above,
    });
  }, [active]);

  if (!active) return null;

  return createPortal(
    <div
      ref={tooltipRef}
      id={tooltipId}
      role="tooltip"
      className="app-tooltip fixed z-[10000] max-w-[min(320px,calc(100vw-16px))] px-2.5 py-1.5"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        transform: position?.above
          ? 'translate(-50%, -100%)'
          : 'translateX(-50%)',
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {active.text}
    </div>,
    document.body,
  );
}
