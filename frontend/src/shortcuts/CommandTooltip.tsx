import React, {
  Children,
  cloneElement,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useCommandPresentation } from './ShortcutProvider';

type Props = {
  commandId: string;
  children: ReactElement<Record<string, unknown>>;
};

const TOOLTIP_HOVER_DELAY_MS = 1_200;

export function CommandTooltip({ commandId, children }: Props) {
  const presentation = useCommandPresentation(commandId);
  const [open, setOpen] = useState(false);
  const hoverTimeoutRef = useRef<number | null>(null);
  const tooltipId = useId();
  const child = Children.only(children) as ReactElement<Record<string, unknown>>;
  const existingDescribedBy =
    typeof child.props['aria-describedby'] === 'string'
      ? child.props['aria-describedby']
      : undefined;
  const describedBy = [existingDescribedBy, tooltipId].filter(Boolean).join(' ');
  const disabledButton = child.type === 'button' && child.props.disabled === true;
  const triggerProps = {
    'aria-describedby': describedBy,
    'aria-keyshortcuts': presentation.ariaKeyShortcuts || undefined,
  };

  const clearHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearHoverTimeout, [clearHoverTimeout]);

  const handlePointerEnter = () => {
    clearHoverTimeout();
    hoverTimeoutRef.current = window.setTimeout(() => {
      hoverTimeoutRef.current = null;
      setOpen(true);
    }, TOOLTIP_HOVER_DELAY_MS);
  };

  const handlePointerLeave = () => {
    clearHoverTimeout();
    setOpen(false);
  };

  const handleFocus = () => {
    clearHoverTimeout();
    setOpen(true);
  };

  const handleBlur = () => {
    clearHoverTimeout();
    setOpen(false);
  };

  return (
    <span
      className="relative inline-flex"
      data-command-id={commandId}
      tabIndex={disabledButton ? 0 : undefined}
      aria-disabled={disabledButton || undefined}
      aria-describedby={disabledButton ? describedBy : undefined}
      aria-keyshortcuts={
        disabledButton ? presentation.ariaKeyShortcuts || undefined : undefined
      }
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocusCapture={handleFocus}
      onBlurCapture={handleBlur}
    >
      {cloneElement(child, disabledButton ? {} : triggerProps)}
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="app-tooltip command-tooltip absolute bottom-full left-1/2 z-[80] mb-2 -translate-x-1/2 whitespace-nowrap px-2 py-1"
        >
          <span>{presentation.title}</span>
          {presentation.sequence.length > 0 && (
            <>
              {' '}
              <span className="ml-3 font-mono text-[10px] text-[var(--ink-tertiary)]">
                {presentation.label}
              </span>
            </>
          )}
        </span>
      )}
    </span>
  );
}
