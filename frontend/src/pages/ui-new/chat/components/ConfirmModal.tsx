import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog';
import { PrimaryButton } from '@/components/ui-new/primitives/PrimaryButton';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  isLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  isLoading,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useTranslation('chat');
  return (
    <Dialog
      className="chat-session-modal-surface"
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isLoading) {
          onCancel();
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <p className="text-sm text-normal">{message}</p>
      </DialogContent>
      <DialogFooter>
        <PrimaryButton
          variant="tertiary"
          value={t('modals.confirm.cancel')}
          onClick={onCancel}
          disabled={isLoading}
        />
        <PrimaryButton
          variant="default"
          value={isLoading ? t('modals.confirm.processing') : t('modals.confirm.confirm')}
          onClick={onConfirm}
          disabled={isLoading}
        />
      </DialogFooter>
    </Dialog>
  );
}
