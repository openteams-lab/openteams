import { Fragment, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export type ConfirmationDialogTone =
  | 'default'
  | 'destructive'
  | 'info'
  | 'success';

const TONE_STYLES: Record<
  ConfirmationDialogTone,
  {
    dot: string;
    confirm:
      | string
      | {
          base: string;
          disabledHover: string;
        };
  }
> = {
  default: {
    dot: 'bg-[#4A90E2]',
    confirm: {
      base: 'border-[#D7E7FB] bg-[#EEF5FF] text-[#4A90E2] hover:border-[#4A90E2] hover:bg-[#4A90E2] hover:text-white hover:shadow-[0_4px_12px_rgba(74,144,226,0.18)] focus-visible:ring-[#4A90E2]/20',
      disabledHover:
        'disabled:hover:border-[#D7E7FB] disabled:hover:bg-[#EEF5FF] disabled:hover:text-[#4A90E2]',
    },
  },
  info: {
    dot: 'bg-[#4A90E2]',
    confirm: {
      base: 'border-[#D7E7FB] bg-[#EEF5FF] text-[#4A90E2] hover:border-[#4A90E2] hover:bg-[#4A90E2] hover:text-white hover:shadow-[0_4px_12px_rgba(74,144,226,0.18)] focus-visible:ring-[#4A90E2]/20',
      disabledHover:
        'disabled:hover:border-[#D7E7FB] disabled:hover:bg-[#EEF5FF] disabled:hover:text-[#4A90E2]',
    },
  },
  success: {
    dot: 'bg-[#67C23A]',
    confirm: {
      base: 'border-[#DDEFD1] bg-[#F2FAEC] text-[#67C23A] hover:border-[#67C23A] hover:bg-[#67C23A] hover:text-white hover:shadow-[0_4px_12px_rgba(103,194,58,0.2)] focus-visible:ring-[#67C23A]/20',
      disabledHover:
        'disabled:hover:border-[#DDEFD1] disabled:hover:bg-[#F2FAEC] disabled:hover:text-[#67C23A]',
    },
  },
  destructive: {
    dot: 'bg-[#F56C6C]',
    confirm: {
      base: 'border-[#F7D9D9] bg-[#FFF5F5] text-[#F56C6C] hover:border-[#F56C6C] hover:bg-[#F56C6C] hover:text-white hover:shadow-[0_4px_12px_rgba(245,108,108,0.2)] focus-visible:ring-[#F56C6C]/20',
      disabledHover:
        'disabled:hover:border-[#F7D9D9] disabled:hover:bg-[#FFF5F5] disabled:hover:text-[#F56C6C]',
    },
  },
};

const BASE_BUTTON_CLASS =
  'inline-flex h-[38px] items-center justify-center gap-2 whitespace-nowrap rounded-[20px] border px-6 text-sm font-medium outline-none transition-all duration-200 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none';

const CANCEL_BUTTON_CLASS = cn(
  BASE_BUTTON_CLASS,
  'border-transparent bg-transparent text-[#8C8C8C] hover:bg-[#F5F7FA] hover:text-[#333333] focus-visible:ring-[#E8EEF5]'
);

const HIGHLIGHTED_TEXT_PATTERN =
  /(".*?"|“.*?”|'[^']*'|‘.*?’|「.*?」|『.*?』)/g;

function renderHighlightedMessage(message: string) {
  return message.split('\n').map((line, lineIndex) => {
    const segments = line.split(HIGHLIGHTED_TEXT_PATTERN);

    return (
      <Fragment key={`${line}-${lineIndex}`}>
        {segments.map((segment, segmentIndex) => {
          const isHighlighted = HIGHLIGHTED_TEXT_PATTERN.test(segment);
          HIGHLIGHTED_TEXT_PATTERN.lastIndex = 0;

          if (!isHighlighted) {
            return (
              <Fragment key={`${segment}-${segmentIndex}`}>{segment}</Fragment>
            );
          }

          return (
            <span
              key={`${segment}-${segmentIndex}`}
              className="rounded px-1 py-[1px] font-medium text-[#333333] bg-[#F8F9FA]"
            >
              {segment}
            </span>
          );
        })}
        {lineIndex < message.split('\n').length - 1 && <br />}
      </Fragment>
    );
  });
}

export function getConfirmationButtonClasses(
  tone: ConfirmationDialogTone,
  kind: 'cancel' | 'confirm'
) {
  if (kind === 'cancel') {
    return CANCEL_BUTTON_CLASS;
  }

  const toneStyle = TONE_STYLES[tone].confirm;

  return cn(
    BASE_BUTTON_CLASS,
    typeof toneStyle === 'string' ? toneStyle : toneStyle.base,
    typeof toneStyle === 'string' ? null : toneStyle.disabledHover
  );
}

interface ConfirmationDialogMessageProps {
  message: string;
  className?: string;
}

export function ConfirmationDialogMessage({
  message,
  className,
}: ConfirmationDialogMessageProps) {
  return (
    <p className={cn('m-0 text-sm leading-6 text-[#8C8C8C]', className)}>
      {renderHighlightedMessage(message)}
    </p>
  );
}

interface ConfirmationDialogChromeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
  title: string;
  message?: string;
  tone?: ConfirmationDialogTone;
  showIndicator?: boolean;
  closeLabel: string;
  bodyExtra?: ReactNode;
  footer: ReactNode;
  className?: string;
}

export function ConfirmationDialogChrome({
  open,
  onOpenChange,
  onClose,
  title,
  message,
  tone = 'destructive',
  showIndicator = true,
  closeLabel,
  bodyExtra,
  footer,
  className,
}: ConfirmationDialogChromeProps) {
  const hasBody = Boolean(message) || Boolean(bodyExtra);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      hideCloseButton
      className={cn(
        '!max-w-[440px] !gap-0 !overflow-hidden !rounded-[16px] !border !border-[#E8EEF5] !bg-white !p-0 !shadow-[0_15px_40px_rgba(0,0,0,0.08)]',
        className
      )}
    >
      <DialogContent className="gap-0">
        <div className="flex items-center justify-between px-7 pb-3 pt-6">
          <div className="flex min-w-0 items-center gap-2">
            {showIndicator && (
              <span
                className={cn(
                  'h-2 w-2 flex-none rounded-full',
                  TONE_STYLES[tone].dot
                )}
              />
            )}
            <DialogTitle className="truncate text-[17px] font-semibold text-[#333333]">
              {title}
            </DialogTitle>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#CCCCCC] transition-colors hover:text-[#333333] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8EEF5]"
            aria-label={closeLabel}
            title={closeLabel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {hasBody && (
          <div className="px-7 pb-6">
            {message && <ConfirmationDialogMessage message={message} />}
            {bodyExtra && <div className={cn(message && 'mt-4')}>{bodyExtra}</div>}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 px-7 pb-6 pt-0">
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  );
}
