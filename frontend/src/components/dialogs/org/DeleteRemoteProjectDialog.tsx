import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useTranslation } from 'react-i18next';
import { defineModal } from '@/lib/modals';
import {
  ConfirmationDialogChrome,
  getConfirmationButtonClasses,
} from '@/components/dialogs/shared/ConfirmationDialogChrome';

export interface DeleteRemoteProjectDialogProps {
  projectName: string;
}

export type DeleteRemoteProjectResult = 'deleted' | 'canceled';

const DeleteRemoteProjectDialogImpl =
  NiceModal.create<DeleteRemoteProjectDialogProps>(({ projectName }) => {
    const modal = useModal();
    const { t } = useTranslation(['projects', 'common']);
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleDelete = async () => {
      setIsDeleting(true);
      setError(null);

      try {
        // Resolve with 'deleted' to let parent handle the deletion
        modal.resolve('deleted' as DeleteRemoteProjectResult);
        modal.hide();
      } catch {
        setError(
          t(
            'deleteProjectDialog.error',
            'Failed to delete project. Please try again.'
          )
        );
      } finally {
        setIsDeleting(false);
      }
    };

    const handleCancel = () => {
      modal.resolve('canceled' as DeleteRemoteProjectResult);
      modal.hide();
    };

    const handleOpenChange = (open: boolean) => {
      if (!open) {
        handleCancel();
      }
    };

    const message = t(
      'deleteProjectDialog.description',
      'This will permanently delete "{{name}}" and all its issues. This action cannot be undone.',
      { name: projectName }
    );

    return (
      <ConfirmationDialogChrome
        open={modal.visible}
        onOpenChange={handleOpenChange}
        onClose={handleCancel}
        title={t('deleteProjectDialog.title', 'Delete Project?')}
        message={message}
        tone="destructive"
        closeLabel={t('common:buttons.close', 'Close')}
        bodyExtra={
          error ? (
            <div className="rounded-[10px] border border-[#F7D9D9] bg-[#FFF5F5] px-4 py-3 text-sm text-[#F56C6C]">
              {error}
            </div>
          ) : null
        }
        footer={
          <>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isDeleting}
              className={getConfirmationButtonClasses('destructive', 'cancel')}
            >
              {t('common:buttons.cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              onClick={handleDelete}
              disabled={isDeleting}
              className={getConfirmationButtonClasses(
                'destructive',
                'confirm'
              )}
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('common:buttons.delete', 'Delete')}
            </button>
          </>
        }
      />
    );
  });

export const DeleteRemoteProjectDialog = defineModal<
  DeleteRemoteProjectDialogProps,
  DeleteRemoteProjectResult
>(DeleteRemoteProjectDialogImpl);
