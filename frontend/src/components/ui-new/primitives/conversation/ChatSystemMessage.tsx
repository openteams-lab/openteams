import { InfoIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface ChatSystemMessageProps {
  content: string;
  i18nKey?: string | null;
  i18nParams?: Record<string, unknown> | null;
  className?: string;
  textClassName?: string;
  expanded?: boolean;
  onToggle?: () => void;
}

const normalizeI18nKey = (key: string): string =>
  key.includes(':') ? key : key.replace(/^([^.]+)\./, '$1:');

export function ChatSystemMessage({
  content,
  i18nKey,
  i18nParams,
  className,
  textClassName = 'text-sm',
  expanded,
  onToggle,
}: ChatSystemMessageProps) {
  const { t } = useTranslation(['chat', 'common', 'settings']);
  const displayContent = useMemo(() => {
    if (!i18nKey) {
      return content;
    }

    return t(normalizeI18nKey(i18nKey), {
      ...(i18nParams ?? {}),
      defaultValue: content,
    });
  }, [content, i18nKey, i18nParams, t]);

  return (
    <div
      className={cn(
        'flex items-start gap-base text-low select-text',
        onToggle ? 'cursor-pointer' : 'cursor-text',
        textClassName,
        className
      )}
      onClick={onToggle}
      role={onToggle ? 'button' : undefined}
    >
      <InfoIcon className="shrink-0 size-icon-base mt-0.5" />
      <span
        className={cn(
          'select-text',
          !expanded && 'truncate',
          expanded && 'whitespace-pre-wrap break-all'
        )}
      >
        {displayContent}
      </span>
    </div>
  );
}
