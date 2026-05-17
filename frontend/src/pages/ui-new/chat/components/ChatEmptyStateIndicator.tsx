import {
  ArrowRightIcon,
  ChatCircleDotsIcon,
  GitBranchIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const CHAT_EMPTY_STATE_LOGO_PATH: string | null = '/openteams-brand-logo.png';
// Set this to a public asset path such as '/branding/chat-empty-logo.svg'
// to replace the built-in placeholder mark.

export type ChatEmptyStateVariant = 'no-members' | 'empty-messages';
type ChatInputMode = 'free' | 'workflow';

interface ChatEmptyStateIndicatorProps {
  variant: ChatEmptyStateVariant;
  onAction: () => void;
  selectedMode?: ChatInputMode;
  onModeSelect?: (mode: ChatInputMode) => void;
  disabled?: boolean;
  className?: string;
}

export function ChatEmptyStateIndicator({
  variant,
  onAction,
  selectedMode = 'workflow',
  onModeSelect,
  disabled = false,
  className,
}: ChatEmptyStateIndicatorProps) {
  const { t } = useTranslation('chat');
  const logoSrc = CHAT_EMPTY_STATE_LOGO_PATH?.trim() || null;
  const isNoMembers = variant === 'no-members';
  const eyebrow = t('emptyState.emptyEyebrow');
  const actionLabel = t('emptyState.noMembersAction');
  const modeCards = isNoMembers
    ? []
    : [
        {
          id: 'workflow' as const,
          label: t('input.modeCards.workflow.label'),
          description: t('input.modeCards.workflow.description'),
          detail: t('input.modeCards.workflow.detail'),
          icon: GitBranchIcon,
          tone: 'workflow',
        },
        {
          id: 'free' as const,
          label: t('input.modeCards.free.label'),
          description: t('input.modeCards.free.description'),
          detail: t('input.modeCards.free.detail'),
          icon: ChatCircleDotsIcon,
          tone: 'free',
        },
      ];
  const selectedModeCard =
    modeCards.find((modeCard) => modeCard.id === selectedMode) ?? modeCards[0];
  const selectedModeDetailItems =
    selectedModeCard?.detail
      .split(/\r?\n/)
      .map((item) => item.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean) ?? [];

  return (
    <div
      className={cn(
        'chat-session-empty-state',
        disabled && 'is-disabled',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="chat-session-empty-state-logo" aria-hidden="true">
        {logoSrc ? (
          <img
            src={logoSrc}
            alt={t('emptyState.logoAlt')}
            className="chat-session-empty-state-logo-image"
          />
        ) : (
          <span className="chat-session-empty-state-logo-placeholder">
            <span className="chat-session-empty-state-logo-orb" />
          </span>
        )}
      </div>

      <div
        className={cn(
          'chat-session-empty-state-copy',
          isNoMembers && 'is-no-members'
        )}
      >
        {isNoMembers ? (
          <div className="chat-session-empty-state-action-shell">
            <button
              type="button"
              className="chat-session-empty-state-action"
              onClick={onAction}
              disabled={disabled}
              aria-label={actionLabel}
              title={actionLabel}
            >
              <span className="chat-session-empty-state-action-label">
                {actionLabel}
              </span>
              <span
                className="chat-session-empty-state-action-icon"
                aria-hidden="true"
              >
                <ArrowRightIcon className="size-icon-sm" weight="bold" />
              </span>
            </button>
          </div>
        ) : (
          <h2 className="chat-session-empty-state-title">
            {t('emptyState.brand')}
          </h2>
        )}
        <p className="chat-session-empty-state-eyebrow">{eyebrow}</p>
      </div>

      {!isNoMembers && onModeSelect ? (
        <>
          <div
            className="chat-session-empty-state-templates"
            aria-label={t('input.modeCards.label')}
          >
            {modeCards.map((modeCard) => {
              const Icon = modeCard.icon;
              const isSelected = modeCard.id === selectedMode;

              return (
                <button
                  key={modeCard.id}
                  type="button"
                  className={cn(
                    'chat-session-empty-state-template-card',
                    isSelected && 'is-selected'
                  )}
                  onClick={() => onModeSelect(modeCard.id)}
                  disabled={disabled}
                  aria-pressed={isSelected}
                >
                  <span
                    className={cn(
                      'chat-session-empty-state-template-icon',
                      `is-${modeCard.tone}`
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="size-icon-sm" weight="fill" />
                  </span>
                  <span className="chat-session-empty-state-template-copy">
                    <span className="chat-session-empty-state-template-title">
                      {modeCard.label}
                    </span>
                    <span className="chat-session-empty-state-template-description">
                      {modeCard.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {selectedModeCard ? (
            <div className="chat-session-empty-state-mode-detail">
              {selectedModeDetailItems.length > 1 ? (
                <ul>
                  {selectedModeDetailItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>{selectedModeCard.detail}</p>
              )}
              <span>{t('input.modeCards.switchHint')}</span>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
