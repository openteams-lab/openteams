import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import {
  ConfirmationDialogChrome,
  getConfirmationButtonClasses,
} from '@/components/dialogs/shared/ConfirmationDialogChrome';

export interface DeleteConfigurationDialogProps {
  configName: string;
  executorType: string;
}

export type DeleteConfigurationResult = 'deleted' | 'canceled';

const DeleteConfigurationDialogImpl =
  NiceModal.create<DeleteConfigurationDialogProps>(
    ({ configName, executorType }) => {
      const { t } = useTranslation(['settings', 'common']);
      const modal = useModal();
      const [isDeleting, setIsDeleting] = useState(false);
      const [error, setError] = useState<string | null>(null);

      const handleDelete = async () => {
        setIsDeleting(true);
        setError(null);

        try {
          // Resolve with 'deleted' to let parent handle the deletion
          modal.resolve('deleted' as DeleteConfigurationResult);
          modal.hide();
        } catch {
          setError('Failed to delete configuration. Please try again.');
        } finally {
          setIsDeleting(false);
        }
      };

      const handleCancel = () => {
        modal.resolve('canceled' as DeleteConfigurationResult);
        modal.hide();
      };

      const handleOpenChange = (open: boolean) => {
        if (!open) {
          handleCancel();
        }
      };

      const message = t(
        'settings:settings.agents.deleteConfigDialog.description',
        {
          configName,
          executorType,
        }
      );

      return (
        <ConfirmationDialogChrome
          open={modal.visible}
          onOpenChange={handleOpenChange}
          onClose={handleCancel}
          title={t('settings:settings.agents.deleteConfigDialog.title')}
          message={message}
          tone="destructive"
          closeLabel={t('common:buttons.close')}
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
                className={getConfirmationButtonClasses(
                  'destructive',
                  'cancel'
                )}
              >
                {t('common:buttons.cancel')}
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
                {t('common:buttons.delete')}
              </button>
            </>
          }
        />
      );
    }
  );

export const DeleteConfigurationDialog = defineModal<
  DeleteConfigurationDialogProps,
  DeleteConfigurationResult
>(DeleteConfigurationDialogImpl);
