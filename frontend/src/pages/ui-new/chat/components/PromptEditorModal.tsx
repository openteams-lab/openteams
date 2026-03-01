import type { ChangeEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { XIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { PrimaryButton } from '@/components/ui-new/primitives/PrimaryButton';

export interface PromptEditorModalProps {
  isOpen: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  promptFileInputRef?: RefObject<HTMLInputElement>;
  onPromptFileChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  promptFileLoading?: boolean;
  promptFileError?: string | null;
  showFileImport?: boolean;
  title?: string;
  description?: string;
  placeholder?: string;
  doneText?: string;
  closeAriaLabel?: string;
  attachTextFileText?: string;
  loadingFileText?: string;
  size?: 'default' | 'compact';
}

export function PromptEditorModal({
  isOpen,
  value,
  onChange,
  onClose,
  promptFileInputRef,
  onPromptFileChange,
  promptFileLoading,
  promptFileError,
  showFileImport = true,
  title,
  description,
  placeholder,
  doneText,
  closeAriaLabel,
  attachTextFileText,
  loadingFileText,
  size = 'default',
}: PromptEditorModalProps) {
  const { t } = useTranslation('chat');
  if (!isOpen) return null;

  const resolvedTitle = title ?? t('modals.promptEditor.title');
  const resolvedDescription =
    description ?? t('modals.promptEditor.description');
  const resolvedPlaceholder =
    placeholder ?? t('modals.promptEditor.placeholder');
  const resolvedDoneText = doneText ?? t('modals.promptEditor.done');
  const resolvedCloseAriaLabel =
    closeAriaLabel ?? t('modals.promptEditor.close');
  const resolvedAttachTextFileText =
    attachTextFileText ?? t('modals.promptEditor.attachTextFile');
  const resolvedLoadingFileText =
    loadingFileText ?? t('modals.promptEditor.loadingFile');

  const canShowFileImport =
    showFileImport && !!promptFileInputRef && !!onPromptFileChange;

  const modalSizeClass =
    size === 'compact'
      ? 'w-[78vw] h-[62vh] max-w-[920px]'
      : 'w-[92vw] h-[80vh] max-w-[1200px]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className={cn(
          'chat-session-modal-surface chat-session-prompt-modal border border-border shadow-xl flex flex-col overflow-hidden rounded-xl',
          modalSizeClass
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-base py-half">
          <div>
            <div className="text-sm text-normal font-medium">
              {resolvedTitle}
            </div>
            <div className="text-xs text-low">{resolvedDescription}</div>
          </div>
          <button
            type="button"
            className="text-low hover:text-normal"
            onClick={onClose}
            aria-label={resolvedCloseAriaLabel}
          >
            <XIcon className="size-icon-sm" />
          </button>
        </div>
        <div className="flex-1 overflow-hidden p-base flex flex-col gap-base">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={resolvedPlaceholder}
            className={cn(
              'chat-session-prompt-modal-input flex-1 w-full resize-none rounded-sm border border-border bg-panel',
              'px-base py-base text-sm text-normal leading-relaxed focus:outline-none focus:ring-1 focus:ring-brand'
            )}
          />
          <div
            className={cn(
              'flex items-center gap-base',
              canShowFileImport ? 'justify-between' : 'justify-end'
            )}
          >
            {canShowFileImport && (
              <div className="flex items-center gap-half text-xs text-low">
                <button
                  type="button"
                  className="chat-session-member-expand-btn"
                  onClick={() => promptFileInputRef?.current?.click()}
                  disabled={promptFileLoading}
                >
                  {resolvedAttachTextFileText}
                </button>
                <input
                  ref={promptFileInputRef}
                  type="file"
                  accept=".txt,.md,.prompt,text/plain"
                  className="hidden"
                  onChange={onPromptFileChange}
                />
                {promptFileLoading && <span>{resolvedLoadingFileText}</span>}
                {promptFileError && (
                  <span className="text-error">{promptFileError}</span>
                )}
              </div>
            )}
            <PrimaryButton value={resolvedDoneText} onClick={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}
