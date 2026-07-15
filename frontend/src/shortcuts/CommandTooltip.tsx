import React, {
  Children,
  cloneElement,
  type ReactElement,
  useId,
  useState,
} from 'react';
import { useCommandPresentation } from './ShortcutProvider';

type Props = {
  commandId: string;
  children: ReactElement<Record<string, unknown>>;
};

export function CommandTooltip({ commandId, children }: Props) {
  const presentation = useCommandPresentation(commandId);
  const [open, setOpen] = useState(false);
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
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      {cloneElement(child, disabledButton ? {} : triggerProps)}
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="app-tooltip command-tooltip absolute bottom-full left-1/2 z-[80] mb-2 -translate-x-1/2 whitespace-nowrap px-2 py-1"
        >
          {presentation.tooltip}
        </span>
      )}
    </span>
  );
}
