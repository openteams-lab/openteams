import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/components/ThemeProvider';

const promptFieldBackground = '#EEF3F9';

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
  const { resolvedTheme } = useTheme();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState(value);
  const isDark = resolvedTheme === 'dark';

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
  const palette = isDark
    ? {
        overlay: 'rgba(5, 10, 17, 0.72)',
        shell: '#192233',
        shellBorder: '#2A3445',
        shellShadow: '0 24px 56px rgba(0, 0, 0, 0.42)',
        title: '#F3F6FB',
        copy: '#7F8AA3',
        close: '#7F8AA3',
        fieldBg: '#111926',
        fieldBorder: '#2B3648',
        fieldText: '#F3F6FB',
        fieldFocus: '#5EA2FF',
        fieldFocusRing: '0 0 0 3px rgba(94, 162, 255, 0.15)',
        footerBorder: '#202938',
        cancelBg: '#1A2433',
        cancelBgHover: '#222C3D',
        cancelText: '#BAC4D6',
        primaryBg: '#5EA2FF',
        primaryBgHover: '#7DB6FF',
        primaryShadow: '0 4px 10px rgba(94, 162, 255, 0.24)',
        status: '#7F8AA3',
      }
    : {
        overlay: 'rgba(0, 0, 0, 0.05)',
        shell: '#FFFFFF',
        shellBorder: '#E8EEF5',
        shellShadow: '0 20px 40px rgba(0, 0, 0, 0.08)',
        title: '#333333',
        copy: '#8C8C8C',
        close: '#cccccc',
        fieldBg: promptFieldBackground,
        fieldBorder: '#E8EEF5',
        fieldText: '#444444',
        fieldFocus: '#4A90E2',
        fieldFocusRing: '0 0 0 3px rgba(74, 144, 226, 0.1)',
        footerBorder: '#f5f5f5',
        cancelBg: '#f5f5f5',
        cancelBgHover: '#eeeeee',
        cancelText: '#8C8C8C',
        primaryBg: '#4A90E2',
        primaryBgHover: '#357ABD',
        primaryShadow: '0 4px 10px rgba(74, 144, 226, 0.2)',
        status: '#8C8C8C',
      };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: palette.overlay,
        fontFamily: '-apple-system, "PingFang SC", sans-serif',
      }}
    >
      <div
        className="flex max-w-[calc(100vw-32px)] flex-col overflow-hidden"
        style={{
          width: `${modalWidth}px`,
          background: palette.shell,
          borderRadius: '16px',
          boxShadow: palette.shellShadow,
          border: `1px solid ${palette.shellBorder}`,
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
                color: palette.title,
              }}
            >
              {resolvedTitle}
            </h2>
            <p
              className="m-0"
              style={{
                marginTop: '4px',
                fontSize: '13px',
                color: palette.copy,
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
              color: palette.close,
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
              background: palette.fieldBg,
              border: `1px solid ${palette.fieldBorder}`,
              borderRadius: '12px',
              padding: '16px',
              boxSizing: 'border-box',
              fontFamily: '"SF Mono", "Monaco", "Consolas", monospace',
              fontSize: '14px',
              lineHeight: 1.6,
              color: palette.fieldText,
              resize: 'none',
              outline: 'none',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onFocus={(event) => {
              event.currentTarget.style.borderColor = palette.fieldFocus;
              event.currentTarget.style.boxShadow = palette.fieldFocusRing;
              event.currentTarget.style.background = palette.fieldBg;
            }}
            onBlur={(event) => {
              event.currentTarget.style.borderColor = palette.fieldBorder;
              event.currentTarget.style.boxShadow = 'none';
              event.currentTarget.style.background = palette.fieldBg;
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
            borderTop: `1px solid ${palette.footerBorder}`,
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
              background: palette.cancelBg,
              color: palette.cancelText,
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = palette.cancelBgHover;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = palette.cancelBg;
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
              background: palette.primaryBg,
              color: '#FFFFFF',
              boxShadow: palette.primaryShadow,
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = palette.primaryBgHover;
              event.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = palette.primaryBg;
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
              color: promptFileError ? '#d14343' : palette.status,
            }}
          >
            {promptFileLoading ? resolvedLoadingFileText : promptFileError}
          </div>
        )}
      </div>
    </div>
  );
}
