import {
  ArrowRightIcon,
  CodeIcon,
  FileTextIcon,
  PaintBrushIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const CHAT_EMPTY_STATE_LOGO_PATH: string | null = '/openteams-brand-logo.png';
// Set this to a public asset path such as '/branding/chat-empty-logo.svg'
// to replace the built-in placeholder mark.

export type ChatEmptyStateVariant = 'no-members' | 'empty-messages';

interface ChatEmptyStateIndicatorProps {
  variant: ChatEmptyStateVariant;
  onAction: () => void;
  onTemplateSelect?: (templateValue: string) => void;
  disabled?: boolean;
  className?: string;
}

export function ChatEmptyStateIndicator({
  variant,
  onAction,
  onTemplateSelect,
  disabled = false,
  className,
}: ChatEmptyStateIndicatorProps) {
  const { t } = useTranslation('chat');
  const logoSrc = CHAT_EMPTY_STATE_LOGO_PATH?.trim() || null;
  const isNoMembers = variant === 'no-members';
  const eyebrow = t('emptyState.emptyEyebrow');
  const actionLabel = t('emptyState.noMembersAction');
  const promptTemplates = isNoMembers
    ? []
    : [
        {
          id: 'optimize-architecture',
          label: t('input.templates.optimizeArchitecture.label'),
          value: t('input.templates.optimizeArchitecture.value'),
          icon: CodeIcon,
          tone: 'architecture',
        },
        {
          id: 'generate-docs',
          label: t('input.templates.generateDocs.label'),
          value: t('input.templates.generateDocs.value'),
          icon: FileTextIcon,
          tone: 'docs',
        },
        {
          id: 'review-visual-style',
          label: t('input.templates.reviewVisualStyle.label'),
          value: t('input.templates.reviewVisualStyle.value'),
          icon: PaintBrushIcon,
          tone: 'visual',
        },
      ];

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

      {!isNoMembers && onTemplateSelect ? (
        <div
          className="chat-session-empty-state-templates"
          aria-label={t('input.templates.label')}
        >
          {promptTemplates.map((template) => {
            const Icon = template.icon;

            return (
              <button
                key={template.id}
                type="button"
                className="chat-session-empty-state-template-card"
                onClick={() => onTemplateSelect(template.value)}
                disabled={disabled}
              >
                <span
                  className={cn(
                    'chat-session-empty-state-template-icon',
                    `is-${template.tone}`
                  )}
                  aria-hidden="true"
                >
                  <Icon className="size-icon-sm" weight="fill" />
                </span>
                <span className="chat-session-empty-state-template-copy">
                  <span className="chat-session-empty-state-template-title">
                    {template.label}
                  </span>
                  <span className="chat-session-empty-state-template-description">
                    {template.value}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
