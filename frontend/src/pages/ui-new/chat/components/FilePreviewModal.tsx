import { useTranslation } from 'react-i18next';
import { XIcon } from '@phosphor-icons/react';
import { PrimaryButton } from '@/components/ui-new/primitives/PrimaryButton';

export interface FilePreviewModalProps {
  file: File | null;
  content: string | null;
  onClose: () => void;
}

export function FilePreviewModal({
  file,
  content,
  onClose,
}: FilePreviewModalProps) {
  const { t } = useTranslation('chat');
  if (!file) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="chat-session-modal-surface relative w-full max-w-4xl border border-border rounded-sm shadow-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3
            className="font-medium text-normal truncate max-w-[70%]"
            title={file.name}
          >
            {t('modals.filePreview.previewTitle', { filename: file.name })}
          </h3>
          <button
            type="button"
            className="text-low hover:text-normal"
            onClick={onClose}
          >
            <XIcon className="size-icon-sm" />
          </button>
        </div>

        <div className="overflow-auto flex-1 p-4">
          {content ? (
            file.type.startsWith('image/') ? (
              <img
                src={content}
                alt={file.name}
                className="max-w-full max-h-[70vh] object-contain"
              />
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-sm text-normal bg-secondary p-4 rounded-sm overflow-auto max-h-[60vh]">
                {content}
              </pre>
            )
          ) : (
            <div className="flex items-center justify-center h-64 text-low">
              {t('modals.filePreview.previewNotAvailable')}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border flex justify-end">
          <PrimaryButton value={t('modals.filePreview.close')} onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
