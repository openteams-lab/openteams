import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState(initialValue);
  const [enabled, setEnabled] = useState(initialEnabled);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        fontFamily: '-apple-system, "PingFang SC", sans-serif',
      }}
      onClick={() => {
        if (!isSaving) onClose();
      }}
    >
      <div
        className="flex w-[760px] max-w-[calc(100vw-32px)] flex-col overflow-hidden"
        style={{
          background: '#FFFFFF',
          borderRadius: '16px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.08)',
          border: '1px solid #E8EEF5',
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
                color: '#333333',
              }}
            >
              {t('members.teamProtocol.modal.title')}
            </h2>
            <p
              className="m-0"
              style={{
                marginTop: '4px',
                fontSize: '13px',
                color: '#8C8C8C',
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

        <div className="space-y-4" style={{ padding: '0 24px 20px 24px' }}>
          <label className="flex items-center gap-3 rounded-[12px] border border-[#E8EEF5] bg-[#F9FBFF] px-4 py-3 text-[13px] text-[#333333]">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              disabled={isSaving}
              className="h-4 w-4 rounded-[4px] border border-[#D7E3F4] accent-[#4A90E2]"
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
            }}
          />

          {error ? (
            <div className="rounded-[10px] border border-[#f3d7d7] bg-[#fff7f7] px-3 py-2 text-[12px] text-[#d14343]">
              {error}
            </div>
          ) : null}
        </div>

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
            onClick={onClose}
            disabled={isSaving}
            style={{
              padding: '8px 24px',
              borderRadius: '20px',
              fontSize: '14px',
              cursor: isSaving ? 'default' : 'pointer',
              border: 'none',
              background: '#f5f5f5',
              color: '#8C8C8C',
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
              background: '#4A90E2',
              color: '#FFFFFF',
              boxShadow: '0 4px 10px rgba(74, 144, 226, 0.2)',
            }}
          >
            {isSaving ? tCommon('states.saving') : tCommon('buttons.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
