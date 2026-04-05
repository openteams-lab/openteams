import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/components/ThemeProvider';

const promptFieldBackground = '#EEF3F9';

interface SavePayload {
  content: string;
  enabled: boolean;
}

export interface TeamProtocolEditorModalProps {
  isOpen: boolean;
  initialValue: string;
  initialEnabled: boolean;
  isSaving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (value: SavePayload) => Promise<boolean> | boolean;
}

export function TeamProtocolEditorModal({
  isOpen,
  initialValue,
  initialEnabled,
  isSaving = false,
  error,
  onClose,
  onSave,
}: TeamProtocolEditorModalProps) {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const { resolvedTheme } = useTheme();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState(initialValue);
  const [enabled, setEnabled] = useState(initialEnabled);
  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    if (!isOpen) return;
    setDraft(initialValue);
    setEnabled(initialEnabled);
  }, [initialEnabled, initialValue, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isSaving, onClose]);

  const handleSubmit = useCallback(async () => {
    if (isSaving) return;
    const shouldClose = await onSave({
      content: draft,
      enabled,
    });
    if (shouldClose !== false) {
      onClose();
    }
  }, [draft, enabled, isSaving, onClose, onSave]);

  if (!isOpen) return null;

  const palette = isDark
    ? {
        overlay: 'rgba(5, 10, 17, 0.72)',
        shell: '#192233',
        shellBorder: '#2A3445',
        shellShadow: '0 24px 56px rgba(0, 0, 0, 0.42)',
        title: '#F3F6FB',
        copy: '#7F8AA3',
        close: '#7F8AA3',
        toggleBg: '#111926',
        toggleBorder: '#2B3648',
        toggleText: '#F3F6FB',
        accent: '#5EA2FF',
        fieldBg: '#111926',
        fieldBorder: '#2B3648',
        fieldText: '#F3F6FB',
        errorBg: 'rgba(248, 113, 113, 0.12)',
        errorBorder: 'rgba(248, 113, 113, 0.28)',
        errorText: '#FCA5A5',
        footerBorder: '#202938',
        cancelBg: '#1A2433',
        cancelText: '#BAC4D6',
        primaryBg: '#5EA2FF',
        primaryText: '#FFFFFF',
        primaryShadow: '0 4px 10px rgba(94, 162, 255, 0.24)',
      }
    : {
        overlay: 'rgba(0, 0, 0, 0.05)',
        shell: '#FFFFFF',
        shellBorder: '#E8EEF5',
        shellShadow: '0 20px 40px rgba(0, 0, 0, 0.08)',
        title: '#333333',
        copy: '#8C8C8C',
        close: '#cccccc',
        toggleBg: promptFieldBackground,
        toggleBorder: '#E8EEF5',
        toggleText: '#333333',
        accent: '#4A90E2',
        fieldBg: promptFieldBackground,
        fieldBorder: '#E8EEF5',
        fieldText: '#444444',
        errorBg: '#fff7f7',
        errorBorder: '#f3d7d7',
        errorText: '#d14343',
        footerBorder: '#f5f5f5',
        cancelBg: '#f5f5f5',
        cancelText: '#8C8C8C',
        primaryBg: '#4A90E2',
        primaryText: '#FFFFFF',
        primaryShadow: '0 4px 10px rgba(74, 144, 226, 0.2)',
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
        className="flex w-[760px] max-w-[calc(100vw-32px)] flex-col overflow-hidden"
        style={{
          background: palette.shell,
          borderRadius: '16px',
          boxShadow: palette.shellShadow,
          border: `1px solid ${palette.shellBorder}`,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-start justify-between gap-4"
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
              {t('members.teamProtocol.modal.title')}
            </h2>
            <p
              className="m-0"
              style={{
                marginTop: '4px',
                fontSize: '13px',
                color: palette.copy,
              }}
            >
              {t('members.teamProtocol.modal.description')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('members.teamProtocol.modal.close')}
            onClick={onClose}
            disabled={isSaving}
            style={{
              cursor: isSaving ? 'default' : 'pointer',
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

        <div className="space-y-4" style={{ padding: '0 24px 20px 24px' }}>
          <label
            className="flex items-center gap-3 rounded-[12px] border border-[#E8EEF5] px-4 py-3 text-[13px] text-[#333333]"
            style={{
              background: palette.toggleBg,
              borderColor: palette.toggleBorder,
              color: palette.toggleText,
            }}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              disabled={isSaving}
              className="h-4 w-4 rounded-[4px] border border-[#D7E3F4]"
              style={{ accentColor: palette.accent }}
            />
            <span>{t('members.teamProtocol.modal.enable')}</span>
          </label>

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('members.teamProtocol.modal.placeholder')}
            disabled={isSaving}
            style={{
              width: '100%',
              height: '360px',
              maxHeight: 'calc(100vh - 320px)',
              minHeight: '220px',
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
            }}
          />

          {error ? (
            <div
              className="rounded-[10px] px-3 py-2 text-[12px]"
              style={{
                border: `1px solid ${palette.errorBorder}`,
                background: palette.errorBg,
                color: palette.errorText,
              }}
            >
              {error}
            </div>
          ) : null}
        </div>

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
            onClick={onClose}
            disabled={isSaving}
            style={{
              padding: '8px 24px',
              borderRadius: '20px',
              fontSize: '14px',
              cursor: isSaving ? 'default' : 'pointer',
              border: 'none',
              background: palette.cancelBg,
              color: palette.cancelText,
            }}
          >
            {tCommon('buttons.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSaving}
            style={{
              padding: '8px 24px',
              borderRadius: '20px',
              fontSize: '14px',
              cursor: isSaving ? 'default' : 'pointer',
              border: 'none',
              background: palette.primaryBg,
              color: palette.primaryText,
              boxShadow: palette.primaryShadow,
            }}
          >
            {isSaving ? tCommon('states.saving') : tCommon('buttons.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
