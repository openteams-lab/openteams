import { useState } from 'react';
import { tasksApi } from '@/lib/api';
import type { TaskWithAttemptStatus } from 'shared/types';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import { Loader2 } from 'lucide-react';
import {
  ConfirmationDialogChrome,
  getConfirmationButtonClasses,
} from '@/components/dialogs/shared/ConfirmationDialogChrome';

export interface DeleteTaskConfirmationDialogProps {
  task: TaskWithAttemptStatus;
  projectId: string;
}

const DeleteTaskConfirmationDialogImpl =
  NiceModal.create<DeleteTaskConfirmationDialogProps>(({ task }) => {
    const modal = useModal();
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleConfirmDelete = async () => {
      setIsDeleting(true);
      setError(null);

      try {
        await tasksApi.delete(task.id);
        modal.resolve();
        modal.hide();
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to delete task';
        setError(errorMessage);
      } finally {
        setIsDeleting(false);
      }
    };

    const handleCancelDelete = () => {
      modal.reject();
      modal.hide();
    };

    const message = `Are you sure you want to delete "${task.title}"?\nThis action will permanently delete the task and cannot be undone.`;

    return (
      <ConfirmationDialogChrome
        open={modal.visible}
        onOpenChange={(open) => {
          if (!open) {
            handleCancelDelete();
          }
        }}
        onClose={handleCancelDelete}
        title="Delete Task"
        message={message}
        tone="destructive"
        closeLabel="Close"
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
              onClick={handleCancelDelete}
              disabled={isDeleting}
              className={getConfirmationButtonClasses('destructive', 'cancel')}
            >
              Cancel
            </button>
            <button
              type="submit"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className={getConfirmationButtonClasses(
                'destructive',
                'confirm'
              )}
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isDeleting ? 'Deleting...' : 'Delete Task'}
            </button>
          </>
        }
      />
    );
  });

export const DeleteTaskConfirmationDialog = defineModal<
  DeleteTaskConfirmationDialogProps,
  void
>(DeleteTaskConfirmationDialogImpl);
