import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  GearIcon,
  CpuIcon,
  PlugIcon,
  CaretLeftIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import { usePortalContainer } from '@/contexts/PortalContainerContext';
import { cn } from '@/lib/utils';
import { SettingsSection } from './settings/SettingsSection';
import type { SettingsSectionType } from './settings/SettingsSection';
import {
  SettingsDirtyProvider,
  useSettingsDirty,
} from './settings/SettingsDirtyContext';
import { ConfirmDialog } from './ConfirmDialog';

const SETTINGS_SECTIONS: {
  id: SettingsSectionType;
  icon: Icon;
}[] = [
  { id: 'general', icon: GearIcon },
  { id: 'agents', icon: CpuIcon },
  { id: 'mcp', icon: PlugIcon },
];

export interface SettingsDialogProps {
  initialSection?: SettingsSectionType;
}

interface SettingsDialogContentProps {
  initialSection?: SettingsSectionType;
  onClose: () => void;
}

function SettingsDialogContent({
  initialSection,
  onClose,
}: SettingsDialogContentProps) {
  const { t } = useTranslation('settings');
  const { isDirty } = useSettingsDirty();
  const [activeSection, setActiveSection] = useState<SettingsSectionType>(
    initialSection || 'general'
  );
  // On mobile, null means show the nav menu, a section means show that section
  const [mobileShowContent, setMobileShowContent] = useState(
    initialSection ? true : false
  );
  const isConfirmingRef = useRef(false);

  const handleCloseWithConfirmation = useCallback(async () => {
    if (isConfirmingRef.current) return;

    if (isDirty) {
      isConfirmingRef.current = true;
      try {
        const result = await ConfirmDialog.show({
          title: t('settings.unsavedChanges.title'),
          message: t('settings.unsavedChanges.message'),
          confirmText: t('settings.unsavedChanges.discard'),
          cancelText: t('settings.unsavedChanges.cancel'),
          variant: 'destructive',
        });
        if (result === 'confirmed') {
          onClose();
        }
      } finally {
        isConfirmingRef.current = false;
      }
    } else {
      onClose();
    }
  }, [isDirty, onClose, t]);

  const handleSectionSelect = (sectionId: SettingsSectionType) => {
    setActiveSection(sectionId);
    setMobileShowContent(true);
  };

  const handleMobileBack = () => {
    setMobileShowContent(false);
  };

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCloseWithConfirmation();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCloseWithConfirmation]);

  return (
    <>
      <div
        className="fixed inset-0 z-[9998] animate-in fade-in-0 duration-200"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.05)' }}
        onClick={handleCloseWithConfirmation}
      />
      <div
        className={cn(
          'fixed z-[9999]',
          'inset-0',
          'md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2'
        )}
      >
        <div
          className={cn(
            'settings-dialog-shell chat-settings-theme h-full w-full flex overflow-hidden bg-white',
            'animate-in fade-in-0 slide-in-from-bottom-4 duration-200',
            'rounded-none border-0',
            'md:h-[600px] md:w-[860px] md:rounded-[16px] md:border md:border-[#E8EEF5] md:shadow-[0_20px_60px_rgba(0,0,0,0.1)]'
          )}
          style={{
            fontFamily:
              '-apple-system, "PingFang SC", "Helvetica Neue", sans-serif',
          }}
        >
          <div
            className={cn(
              'settings-dialog-nav flex flex-col border-r border-[#E8EEF5] bg-[#F9FBFF]',
              'w-full',
              mobileShowContent && 'hidden',
              'md:block md:w-[200px]'
            )}
            style={{ padding: '24px 12px' }}
          >
            <div className="mb-6 flex items-center justify-between px-3">
              <h2
                className="m-0"
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  color: '#333333',
                }}
              >
                {t('settings.layout.nav.title')}
              </h2>
              <button
                onClick={handleCloseWithConfirmation}
                className="md:hidden"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#cccccc',
                  cursor: 'pointer',
                }}
              >
                <XIcon className="size-icon-sm" weight="bold" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto">
              {SETTINGS_SECTIONS.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => handleSectionSelect(section.id)}
                    className="flex w-full items-center gap-[10px] rounded-[10px] border-none px-4 py-[10px] text-left text-[14px] font-medium transition-all duration-200"
                    style={{
                      background: isActive
                        ? 'rgba(74, 144, 226, 0.08)'
                        : 'transparent',
                      color: isActive ? '#4A90E2' : '#8C8C8C',
                    }}
                    onMouseEnter={(event) => {
                      if (!isActive) {
                        event.currentTarget.style.background =
                          'rgba(0, 0, 0, 0.03)';
                        event.currentTarget.style.color = '#333333';
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (!isActive) {
                        event.currentTarget.style.background = 'transparent';
                        event.currentTarget.style.color = '#8C8C8C';
                      }
                    }}
                  >
                    <Icon className="size-4 shrink-0" weight="fill" />
                    <span className="truncate">
                      {t(`settings.layout.nav.${section.id}`)}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
          <div
            className={cn(
              'settings-dialog-main relative flex flex-1 flex-col overflow-hidden bg-white',
              !mobileShowContent && 'hidden',
              'md:flex'
            )}
          >
            <div className="flex items-center gap-2 border-b border-[#E8EEF5] p-3 md:hidden">
              <button
                onClick={handleMobileBack}
                className="rounded-[10px] border-none bg-transparent p-1 text-[#8C8C8C]"
              >
                <CaretLeftIcon className="size-icon-sm" weight="bold" />
              </button>
              <span className="text-sm font-medium text-[#333333]">
                {t(`settings.layout.nav.${activeSection}`)}
              </span>
              <button
                onClick={handleCloseWithConfirmation}
                className="ml-auto rounded-[10px] border-none bg-transparent p-1 text-[#cccccc]"
              >
                <XIcon className="size-icon-sm" weight="bold" />
              </button>
            </div>
            <div className="settings-dialog-content flex-1 overflow-hidden bg-white">
              <SettingsSection
                type={activeSection}
                onClose={handleCloseWithConfirmation}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const SettingsDialogImpl = NiceModal.create<SettingsDialogProps>(
  ({ initialSection }) => {
    const modal = useModal();
    const container = usePortalContainer();

    const handleClose = useCallback(() => {
      modal.hide();
      modal.resolve();
      modal.remove();
    }, [modal]);

    if (!container) return null;

    return createPortal(
      <SettingsDirtyProvider>
        <SettingsDialogContent
          initialSection={initialSection}
          onClose={handleClose}
        />
      </SettingsDirtyProvider>,
      container
    );
  }
);

export const SettingsDialog = defineModal<SettingsDialogProps | void, void>(
  SettingsDialogImpl
);
