import { useEffect } from 'react';
import { SpinnerIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import {
  ConfirmationDialogChrome,
  ConfirmationDialogTone,
  getConfirmationButtonClasses,
} from '@/components/dialogs/shared/ConfirmationDialogChrome';

export interface LeadAgentConfirmationDialogProps {
  isOpen: boolean;
  currentLeadName: string;
  targetLeadName: string;
  isLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function LeadAgentConfirmationDialog({
  isOpen,
  currentLeadName,
  targetLeadName,
  isLoading,
  onConfirm,
  onCancel,
}: LeadAgentConfirmationDialogProps) {
  const { t } = useTranslation(['chat', 'common']);

  const title = t('chat:leadAgent.switchDialog.title', {
    defaultValue: 'Switch Lead Agent',
  });

  const message = t('chat:leadAgent.switchDialog.message', {
    currentLeadName,
    targetLeadName,
    defaultValue: `Switch Lead Agent from "${currentLeadName}" to "${targetLeadName}"?`,
  });

  const confirmText = isLoading
    ? t('chat:leadAgent.switchDialog.switching', {
        defaultValue: 'Switching…',
      })
    : t('chat:leadAgent.switchDialog.confirm', {
        defaultValue: 'Confirm',
      });

  const cancelText = t('common:buttons.cancel', {
    defaultValue: 'Cancel',
  });

  // Allow Enter key to confirm when not loading
  useEffect(() => {
    if (!isOpen || isLoading) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      onConfirm();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, isLoading, onConfirm]);

  return (
    <ConfirmationDialogChrome
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isLoading) {
          onCancel();
        }
      }}
      onClose={onCancel}
      title={title}
      message={message}
      tone={'default' as ConfirmationDialogTone}
      closeLabel={t('common:buttons.close', { defaultValue: 'Close' })}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className={getConfirmationButtonClasses('default', 'cancel')}
          >
            {cancelText}
          </button>
          <button
            type="submit"
            onClick={onConfirm}
            disabled={isLoading}
            className={getConfirmationButtonClasses('default', 'confirm')}
          >
            {isLoading && (
              <SpinnerIcon className="size-4 animate-spin" weight="bold" />
            )}
            {confirmText}
          </button>
        </>
      }
    />
  );
}
