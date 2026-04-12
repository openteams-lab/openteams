import { InfoIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface ChatSystemMessageProps {
  content: string;
  className?: string;
  textClassName?: string;
  expanded?: boolean;
  onToggle?: () => void;
}

export function ChatSystemMessage({
  content,
  className,
  textClassName = 'text-sm',
  expanded,
  onToggle,
}: ChatSystemMessageProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-base text-low cursor-pointer',
        textClassName,
        className
      )}
      onClick={onToggle}
      role="button"
    >
      <InfoIcon className="shrink-0 size-icon-base mt-0.5" />
      <span
        className={cn(
          !expanded && 'truncate',
          expanded && 'whitespace-pre-wrap break-all'
        )}
      >
        {content}
      </span>
    </div>
  );
}
