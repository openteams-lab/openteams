import { useTranslation } from 'react-i18next';
import {
  ConfirmationDialogChrome,
  getConfirmationButtonClasses,
} from '@/components/dialogs/shared/ConfirmationDialogChrome';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  isLoading: boolean;
  mode?: 'confirm' | 'alert';
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  isLoading,
  mode = 'confirm',
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useTranslation(['chat', 'common']);
  const isAlert = mode === 'alert';
  const resolvedConfirmText = isLoading
    ? t('modals.confirm.processing')
    : (confirmText ?? (isAlert ? t('common:ok') : t('modals.confirm.confirm')));
  const resolvedCancelText = cancelText ?? t('modals.confirm.cancel');

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
      tone="destructive"
      closeLabel={t('common:buttons.close')}
      footer={
        <>
          {!isAlert && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className={getConfirmationButtonClasses(
                'destructive',
                'cancel'
              )}
            >
              {resolvedCancelText}
            </button>
          )}
          <button
            type="submit"
            onClick={onConfirm}
            disabled={isLoading}
            className={getConfirmationButtonClasses(
              'destructive',
              'confirm'
            )}
          >
            {resolvedConfirmText}
          </button>
        </>
      }
    />
  );
}
