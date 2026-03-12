import { useCallback, useEffect, useRef } from 'react';
import { XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui-new/dialogs/ConfirmDialog';
import { ChatPresetsEditorPanel } from '@/components/ui-new/presets/ChatPresetsEditorPanel';
import {
  SettingsDirtyProvider,
  useSettingsDirty,
} from '@/components/ui-new/dialogs/settings/SettingsDirtyContext';

interface AiTeamPresetsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function AiTeamPresetsModalContent({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t } = useTranslation(['chat', 'settings', 'common']);
  const { isDirty } = useSettingsDirty();
  const isConfirmingRef = useRef(false);

  const handleCloseWithConfirmation = useCallback(async () => {
    if (isConfirmingRef.current) return;

    if (isDirty) {
      isConfirmingRef.current = true;
      try {
        const result = await ConfirmDialog.show({
          title: t('settings.unsavedChanges.title', { ns: 'settings' }),
          message: t('settings.unsavedChanges.message', { ns: 'settings' }),
          confirmText: t('settings.unsavedChanges.discard', {
            ns: 'settings',
          }),
          cancelText: t('settings.unsavedChanges.cancel', { ns: 'settings' }),
          variant: 'destructive',
        });
        if (result === 'confirmed') {
          onClose();
        }
      } finally {
        isConfirmingRef.current = false;
      }
      return;
    }

    onClose();
  }, [isDirty, onClose, t]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void handleCloseWithConfirmation();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCloseWithConfirmation]);

  return (
    <>
      <div
        className="fixed inset-0 z-[9998] animate-in fade-in-0 duration-200"
        style={{ background: 'rgba(15, 23, 42, 0.14)' }}
        onClick={() => {
          void handleCloseWithConfirmation();
        }}
      />
      <div className="fixed inset-0 z-[9999]">
        <div
          className="chat-settings-theme settings-dialog-shell flex h-full w-full flex-col overflow-hidden bg-[rgba(255,255,255,0.96)] animate-in fade-in-0 slide-in-from-bottom-4 duration-200 rounded-none border-0 md:mx-auto md:my-[5vh] md:h-[85vh] md:max-w-[1220px] md:rounded-[28px] md:border md:border-white/70 md:shadow-[0_30px_80px_rgba(15,23,42,0.18)] md:backdrop-blur-xl"
          style={{
            fontFamily:
              '"Inter", "PingFang SC", "Helvetica Neue", sans-serif',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="settings-section-header flex items-center justify-between border-b border-[#F1F5F9] px-8 py-5"
          >
            <div>
              <h2 className="m-0 text-[20px] font-semibold text-[#0F172A]">
                {t('aiTeamPresets.title', {
                  defaultValue: 'AI Team Presets',
                })}
              </h2>
              <p className="mt-1 text-[12px] leading-5 text-[#94A3B8]">
                {t('aiTeamPresets.description', {
                  defaultValue:
                    'Manage member presets and team presets in one place.',
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void handleCloseWithConfirmation();
              }}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-transparent bg-transparent p-0 text-[#94A3B8] transition-colors duration-200 hover:border-[#E2E8F0] hover:bg-white hover:text-[#0F172A]"
              aria-label={t('aiTeamPresets.close', {
                defaultValue: 'Close AI Team presets',
              })}
              title={t('common:buttons.close')}
            >
              <XIcon className="h-[18px] w-[18px]" weight="bold" />
            </button>
          </div>

          <div className="settings-section-body flex-1 min-h-0 overflow-hidden px-5 pb-5 pt-4 md:px-8 md:pb-8 md:pt-6">
            <ChatPresetsEditorPanel
              onCancel={() => {
                void handleCloseWithConfirmation();
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

export function AiTeamPresetsModal({
  isOpen,
  onClose,
}: AiTeamPresetsModalProps) {
  if (!isOpen) return null;

  return (
    <SettingsDirtyProvider>
      <AiTeamPresetsModalContent onClose={onClose} />
    </SettingsDirtyProvider>
  );
}
