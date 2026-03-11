import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t: tCommon } = useTranslation('common');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(value);
  }, [isOpen, value]);

  useEffect(() => {
    if (!isOpen) return;

    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        const nextValue = textareaRef.current?.value ?? draft;
        onChange(nextValue);
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [draft, isOpen, onChange, onClose]);

  const handleSubmit = useCallback(() => {
    const nextValue = textareaRef.current?.value ?? draft;
    onChange(nextValue);
    onClose();
  }, [draft, onChange, onClose]);

  const handleCancel = useCallback(() => {
    setDraft(value);
    onClose();
  }, [onClose, value]);

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
  const resolvedCancelText = tCommon('buttons.cancel');
  const canShowFileImport =
    showFileImport && !!promptFileInputRef && !!onPromptFileChange;
  const modalWidth = size === 'compact' ? 720 : 800;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        fontFamily: '-apple-system, "PingFang SC", sans-serif',
      }}
      onClick={handleSubmit}
    >
      <div
        className="flex max-w-[calc(100vw-32px)] flex-col overflow-hidden"
        style={{
          width: `${modalWidth}px`,
          background: '#FFFFFF',
          borderRadius: '16px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.08)',
          border: '1px solid #E8EEF5',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-start justify-between"
          style={{ padding: '20px 24px' }}
        >
          <div>
            <h2
              className="m-0"
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: '#333333',
              }}
            >
              {resolvedTitle}
            </h2>
            <p
              className="m-0"
              style={{
                marginTop: '4px',
                fontSize: '13px',
                color: '#8C8C8C',
              }}
            >
              {resolvedDescription}
            </p>
          </div>
          <button
            type="button"
            aria-label={resolvedCloseAriaLabel}
            onClick={handleSubmit}
            style={{
              cursor: 'pointer',
              color: '#cccccc',
              fontSize: '20px',
              background: 'transparent',
              border: 'none',
              padding: 0,
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        <div style={{ padding: '0 24px 20px 24px' }}>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={resolvedPlaceholder}
            style={{
              width: '100%',
              height: '400px',
              maxHeight: 'calc(100vh - 260px)',
              minHeight: '240px',
              background: '#F9FBFF',
              border: '1px solid #E8EEF5',
              borderRadius: '12px',
              padding: '16px',
              boxSizing: 'border-box',
              fontFamily: '"SF Mono", "Monaco", "Consolas", monospace',
              fontSize: '14px',
              lineHeight: 1.6,
              color: '#444444',
              resize: 'none',
              outline: 'none',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onFocus={(event) => {
              event.currentTarget.style.borderColor = '#4A90E2';
              event.currentTarget.style.boxShadow =
                '0 0 0 3px rgba(74, 144, 226, 0.1)';
              event.currentTarget.style.background = '#FFFFFF';
            }}
            onBlur={(event) => {
              event.currentTarget.style.borderColor = '#E8EEF5';
              event.currentTarget.style.boxShadow = 'none';
              event.currentTarget.style.background = '#F9FBFF';
            }}
          />
        </div>

        {canShowFileImport && (
          <input
            ref={promptFileInputRef}
            type="file"
            accept=".txt,.md,.prompt,text/plain"
            className="hidden"
            onChange={onPromptFileChange}
            aria-label={resolvedAttachTextFileText}
          />
        )}

        <div
          className="flex justify-end"
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #f5f5f5',
            gap: '12px',
          }}
        >
          <button
            type="button"
            onClick={handleCancel}
            style={{
              padding: '8px 24px',
              borderRadius: '20px',
              fontSize: '14px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              border: 'none',
              background: '#f5f5f5',
              color: '#8C8C8C',
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = '#eeeeee';
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = '#f5f5f5';
            }}
          >
            {resolvedCancelText}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            style={{
              padding: '8px 24px',
              borderRadius: '20px',
              fontSize: '14px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              border: 'none',
              background: '#4A90E2',
              color: '#FFFFFF',
              boxShadow: '0 4px 10px rgba(74, 144, 226, 0.2)',
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = '#357ABD';
              event.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = '#4A90E2';
              event.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {resolvedDoneText}
          </button>
        </div>

        {(promptFileLoading || promptFileError) && (
          <div
            style={{
              padding: '0 24px 16px 24px',
              fontSize: '12px',
              color: promptFileError ? '#d14343' : '#8C8C8C',
            }}
          >
            {promptFileLoading ? resolvedLoadingFileText : promptFileError}
          </div>
        )}
      </div>
    </div>
  );
}
