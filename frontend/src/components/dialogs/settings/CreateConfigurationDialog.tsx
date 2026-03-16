import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { XIcon } from '@phosphor-icons/react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import { getCreateConfigurationDialogCopy } from '@/lib/agentConfigLocalization';
import { toPrettyCase } from '@/utils/string';
import {
  settingsFieldClassName,
  settingsPrimaryButtonClassName,
  settingsSecondaryButtonClassName,
  SettingsSelect,
} from '@/components/ui-new/dialogs/settings/SettingsComponents';

export interface CreateConfigurationDialogProps {
  executorType: string;
  existingConfigs: string[];
}

export type CreateConfigurationResult = {
  action: 'created' | 'canceled';
  configName?: string;
  cloneFrom?: string | null;
};

const CreateConfigurationDialogImpl =
  NiceModal.create<CreateConfigurationDialogProps>(
    ({ executorType, existingConfigs }) => {
      const { t, i18n } = useTranslation(['common']);
      const modal = useModal();
      const [configName, setConfigName] = useState('');
      const [cloneFrom, setCloneFrom] = useState<string | null>(null);
      const [error, setError] = useState<string | null>(null);

      const copy = useMemo(
        () => getCreateConfigurationDialogCopy(i18n.language),
        [i18n.language]
      );
      const resolvedExecutorType = toPrettyCase(executorType);

      useEffect(() => {
        if (!modal.visible) return;
        setConfigName('');
        setCloneFrom(null);
        setError(null);
      }, [modal.visible]);

      useEffect(() => {
        if (!modal.visible) return;

        const handleKeyDown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            modal.resolve({ action: 'canceled' } as CreateConfigurationResult);
            modal.hide();
          }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
      }, [modal]);

      const validateConfigName = (name: string): string | null => {
        const trimmedName = name.trim();
        if (!trimmedName) return copy.errors.empty;
        if (trimmedName.length > 40) {
          return copy.errors.tooLong;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
          return copy.errors.invalid;
        }
        if (existingConfigs.includes(trimmedName)) {
          return copy.errors.exists;
        }
        return null;
      };

      const handleCreate = () => {
        const validationError = validateConfigName(configName);
        if (validationError) {
          setError(validationError);
          return;
        }

        modal.resolve({
          action: 'created',
          configName: configName.trim(),
          cloneFrom,
        } as CreateConfigurationResult);
        modal.hide();
      };

      const handleCancel = () => {
        modal.resolve({ action: 'canceled' } as CreateConfigurationResult);
        modal.hide();
      };

      if (!modal.visible) return null;

      return (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.05)',
            fontFamily:
              '-apple-system, "PingFang SC", "Helvetica Neue", sans-serif',
          }}
          onClick={handleCancel}
        >
          <div
            className="w-[560px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[16px] border border-[#E8EEF5] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.1)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between px-6 py-5">
              <div>
                <h2 className="m-0 text-[16px] font-semibold text-[#333333]">
                  {copy.title}
                </h2>
                <p className="mt-1 text-[13px] text-[#8C8C8C]">
                  {copy.description(resolvedExecutorType)}
                </p>
              </div>
              <button
                type="button"
                aria-label={copy.closeAriaLabel}
                className="border-none bg-transparent p-0 text-[#cccccc] transition-colors duration-200 hover:text-[#333333]"
                onClick={handleCancel}
              >
                <XIcon className="h-5 w-5" weight="bold" />
              </button>
            </div>

            <div className="space-y-5 px-6 pb-5">
              <div className="space-y-2">
                <label
                  htmlFor="config-name"
                  className="block text-[12px] text-[#8C8C8C]"
                >
                  {copy.nameLabel}
                </label>
                <input
                  id="config-name"
                  value={configName}
                  onChange={(event) => {
                    setConfigName(event.target.value);
                    setError(null);
                  }}
                  placeholder={copy.namePlaceholder}
                  maxLength={40}
                  autoFocus
                  className={settingsFieldClassName}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[12px] text-[#8C8C8C]">
                  {copy.cloneLabel}
                </label>
                <SettingsSelect
                  value={cloneFrom ?? '__blank__'}
                  options={[
                    {
                      value: '__blank__',
                      label: copy.startBlank,
                    },
                    ...existingConfigs.map((configuration) => ({
                      value: configuration,
                      label: copy.cloneFrom(configuration),
                    })),
                  ]}
                  onChange={(value) =>
                    setCloneFrom(value === '__blank__' ? null : value)
                  }
                  placeholder={copy.clonePlaceholder}
                />
              </div>

              {error ? (
                <div className="rounded-[10px] border border-[#f3d7d7] bg-[#fff7f7] p-4 text-[13px] text-[#d14343]">
                  {error}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-3 border-t border-[#f5f5f5] px-6 py-4">
              <button
                type="button"
                onClick={handleCancel}
                className={settingsSecondaryButtonClassName}
              >
                {t('buttons.cancel')}
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!configName.trim()}
                className={settingsPrimaryButtonClassName}
              >
                {copy.createButton}
              </button>
            </div>
          </div>
        </div>
      );
    }
  );

export const CreateConfigurationDialog = defineModal<
  CreateConfigurationDialogProps,
  CreateConfigurationResult
>(CreateConfigurationDialogImpl);
