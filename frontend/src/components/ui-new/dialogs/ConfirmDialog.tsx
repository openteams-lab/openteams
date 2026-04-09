import { useTranslation } from 'react-i18next';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal, type ConfirmResult } from '@/lib/modals';
import {
  ConfirmationDialogChrome,
  getConfirmationButtonClasses,
  type ConfirmationDialogTone,
} from '@/components/dialogs/shared/ConfirmationDialogChrome';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'destructive' | 'info' | 'success';
  icon?: boolean;
  showCancelButton?: boolean;
}

const ConfirmDialogImpl = NiceModal.create<ConfirmDialogProps>((props) => {
  const { t } = useTranslation('common');
  const modal = useModal();
  const {
    title,
    message,
    confirmText = t('common:confirm.defaultConfirm'),
    cancelText = t('common:confirm.defaultCancel'),
    variant = 'default',
    icon = true,
    showCancelButton = true,
  } = props;

  const closeWithResult = (result: ConfirmResult) => {
    modal.resolve(result);
    modal.hide();
    modal.remove();
  };

  const handleConfirm = () => {
    closeWithResult('confirmed');
  };

  const handleCancel = () => {
    closeWithResult('canceled');
  };

  const tone: ConfirmationDialogTone =
    variant === 'destructive'
      ? 'destructive'
      : variant === 'info'
        ? 'info'
        : variant === 'success'
          ? 'success'
          : 'default';

  return (
    <ConfirmationDialogChrome
      open={modal.visible}
      onOpenChange={(open) => {
        if (!open) {
          handleCancel();
        }
      }}
      onClose={handleCancel}
      title={title}
      message={message}
      tone={tone}
      showIndicator={icon}
      closeLabel={t('common:buttons.close')}
      footer={
        <>
          {showCancelButton && (
            <button
              type="button"
              onClick={handleCancel}
              className={getConfirmationButtonClasses(tone, 'cancel')}
            >
              {cancelText}
            </button>
          )}
          <button
            type="submit"
            onClick={handleConfirm}
            className={getConfirmationButtonClasses(tone, 'confirm')}
          >
            {confirmText}
          </button>
        </>
      }
    />
  );
});

export const ConfirmDialog = defineModal<ConfirmDialogProps, ConfirmResult>(
  ConfirmDialogImpl
);
