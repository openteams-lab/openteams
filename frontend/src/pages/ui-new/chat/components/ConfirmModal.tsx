import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ConfirmationDialogChrome,
  ConfirmationDialogTone,
  getConfirmationButtonClasses,
} from '@/components/dialogs/shared/ConfirmationDialogChrome';
import { writeClipboardViaBridge } from '@/vscode/bridge';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  isLoading: boolean;
  mode?: 'confirm' | 'alert';
  tone?: ConfirmationDialogTone;
  confirmText?: string;
  cancelText?: string;
  copyValue?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  isLoading,
  mode = 'confirm',
  tone = 'destructive',
  confirmText,
  cancelText,
  copyValue,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useTranslation(['chat', 'common']);
  const isAlert = mode === 'alert';
  const [copied, setCopied] = useState(false);
  const resolvedConfirmText = isLoading
    ? t('modals.confirm.processing')
    : (confirmText ?? (isAlert ? t('common:ok') : t('modals.confirm.confirm')));
  const resolvedCancelText = cancelText ?? t('modals.confirm.cancel');

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

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
  }, [isLoading, isOpen, onConfirm]);

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
      tone={tone}
      closeLabel={t('common:buttons.close')}
      footer={
        <>
          {!isAlert && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className={getConfirmationButtonClasses('destructive', 'cancel')}
            >
              {resolvedCancelText}
            </button>
          )}
          {copyValue && (
            <button
              type="button"
              onClick={async () => {
                await writeClipboardViaBridge(copyValue);
                setCopied(true);
              }}
              disabled={isLoading}
              className={getConfirmationButtonClasses('default', 'confirm')}
            >
              {copied ? t('common:actions.copied') : t('common:buttons.copy')}
            </button>
          )}
          <button
            type="submit"
            onClick={onConfirm}
            disabled={isLoading}
            className={getConfirmationButtonClasses('destructive', 'confirm')}
          >
            {resolvedConfirmText}
          </button>
        </>
      }
    />
  );
}
