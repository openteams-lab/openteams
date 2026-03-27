import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowSquareOutIcon, XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { ChatMarkdown } from '@/components/ui-new/primitives/conversation/ChatMarkdown';
import { usePortalContainer } from '@/contexts/PortalContainerContext';
import { cn } from '@/lib/utils';
import { pathToFileHref } from '@/utils/readOnlyLinks';

const iconPalette = [
  'bg-sky-100 text-sky-600',
  'bg-emerald-100 text-emerald-600',
  'bg-amber-100 text-amber-600',
  'bg-violet-100 text-violet-600',
  'bg-rose-100 text-rose-600',
  'bg-cyan-100 text-cyan-600',
];

function getSourceHref(
  sourceUrl: string | null | undefined,
  nativePath: string | null | undefined
): string | null {
  const trimmed = sourceUrl?.trim();

  if (trimmed) {
    if (/^https?:\/\//i.test(trimmed) || /^file:\/\//i.test(trimmed)) {
      return trimmed;
    }

    const localHref = pathToFileHref(trimmed);
    if (localHref) {
      return localHref;
    }
  }

  return pathToFileHref(nativePath);
}

function SkillDetailIcon({ name }: { name: string }) {
  const code = name.charCodeAt(0) || 0;
  const colorClass = iconPalette[Math.abs(code) % iconPalette.length];
  const letter = name.trim().charAt(0).toUpperCase() || 'S';

  return (
    <div
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold',
        colorClass
      )}
    >
      {letter}
    </div>
  );
}

interface SkillDetailModalProps {
  isOpen: boolean;
  name: string;
  description?: string | null;
  content?: string | null;
  sourceUrl?: string | null;
  nativePath?: string | null;
  isLoading?: boolean;
  error?: string | null;
  onClose: () => void;
  footerLeading?: ReactNode;
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    icon?: ReactNode;
    className?: string;
  };
}

export function SkillDetailModal({
  isOpen,
  name,
  description,
  content,
  sourceUrl,
  nativePath,
  isLoading = false,
  error,
  onClose,
  footerLeading,
  primaryAction,
}: SkillDetailModalProps) {
  const { t } = useTranslation('chat');
  const portalContainer = usePortalContainer();

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sourceHref = getSourceHref(sourceUrl, nativePath);
  const modal = (
    <>
      <div
        className="fixed inset-0 z-[9998] bg-black/50 animate-in fade-in-0 duration-200"
        onClick={onClose}
      />
      <div className="fixed left-1/2 top-1/2 z-[9999] -translate-x-1/2 -translate-y-1/2">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={name}
          className={cn(
            'skill-detail-modal-surface flex flex-col overflow-hidden rounded-2xl p-4',
            'shadow-xl animate-in fade-in-0 slide-in-from-bottom-4 duration-200'
          )}
          style={{
            height: 'min(70vh, 710px)',
            width: 'min(86vw, 760px)',
            minHeight: '320px',
            maxHeight: '82vh',
            maxWidth: '92vw',
            backgroundColor: '#f7f8fc',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex min-w-0 items-center justify-between">
            <SkillDetailIcon name={name} />
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-10 items-center justify-center rounded-xl text-low hover:bg-secondary/70 hover:text-normal"
              aria-label={t('members.skills.closeDetails', { name })}
            >
              <XIcon size={22} />
            </button>
          </div>

          <div className="mt-5 flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0 text-2xl leading-tight font-semibold text-normal">
              {name}
            </div>
            {sourceHref ? (
              <a
                href={sourceHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-low hover:text-normal"
              >
                {t('members.skills.detail.openSource')}
                <ArrowSquareOutIcon size={16} />
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm text-low/60">
                {t('members.skills.detail.openSource')}
                <ArrowSquareOutIcon size={16} />
              </span>
            )}
          </div>

          <div className="mt-3 text-sm leading-6 text-normal/80">
            {isLoading
              ? t('members.skills.detail.loadingDescription')
              : description || t('members.skills.detail.emptyDescription')}
          </div>

          <div
            className="mt-4 min-h-0 min-w-0 flex-1 overflow-auto rounded-[14px] p-3"
            style={{
              backgroundColor: '#e7ebf5',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55)',
            }}
          >
            {isLoading ? (
              <div className="text-sm text-low">
                {t('members.skills.detail.loadingContent')}
              </div>
            ) : (
              <ChatMarkdown
                content={content || t('members.skills.detail.emptyContent')}
                maxWidth="100%"
                textClassName="text-[13px] leading-5 text-normal/85"
                allowFileLinks={Boolean(nativePath)}
                readOnlyLinkBasePath={nativePath}
              />
            )}
          </div>

          <div className="mt-3">
            {error && <div className="text-sm text-error">{error}</div>}
          </div>

          {(footerLeading || primaryAction) && (
            <div
              className={cn(
                'mt-4 flex flex-wrap items-center gap-3',
                footerLeading ? 'justify-between' : 'justify-end'
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                {footerLeading}
              </div>

              {primaryAction && (
                <button
                  type="button"
                  onClick={primaryAction.onClick}
                  disabled={primaryAction.disabled}
                  className={cn(
                    'inline-flex h-10 min-w-[136px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-black px-6 text-base font-medium text-white',
                    primaryAction.disabled
                      ? 'cursor-not-allowed opacity-60'
                      : 'hover:bg-black/85',
                    primaryAction.className
                  )}
                >
                  {primaryAction.icon}
                  {primaryAction.label}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );

  return portalContainer ? createPortal(modal, portalContainer) : modal;
}
