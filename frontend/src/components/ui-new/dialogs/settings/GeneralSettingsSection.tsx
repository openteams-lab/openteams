import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cloneDeep, isEqual, merge } from 'lodash';
import { SpeakerHighIcon, SpinnerIcon } from '@phosphor-icons/react';
import {
  type BaseCodingAgent,
  type ExecutorProfileId,
  type SendMessageShortcut,
  SoundFile,
  ThemeMode,
  UiLanguage,
} from 'shared/types';
import { getModifierKey } from '@/utils/platform';
import { getLanguageOptions } from '@/i18n/languages';
import { toPrettyCase } from '@/utils/string';
import { useTheme } from '@/components/ThemeProvider';
import { useUserSystem } from '@/components/ConfigProvider';
import { cn } from '@/lib/utils';
import {
  SettingsCard,
  SettingsCheckbox,
  SettingsField,
  settingsFieldClassName,
  settingsIconButtonClassName,
  SettingsNumberInput,
  settingsSecondaryButtonClassName,
  SettingsSaveBar,
  SettingsSelect,
} from './SettingsComponents';
import { useSettingsDirty } from './SettingsDirtyContext';

export function GeneralSettingsSection() {
  const { t } = useTranslation(['settings', 'common']);
  const { setDirty: setContextDirty } = useSettingsDirty();

  const languageOptions = getLanguageOptions(
    t('language.browserDefault', {
      ns: 'common',
      defaultValue: 'Browser Default',
    })
  );
  const { config, loading, updateAndSaveConfig, profiles } = useUserSystem();

  const [draft, setDraft] = useState(() => (config ? cloneDeep(config) : null));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const { setTheme } = useTheme();

  // Executor options for the default coding agent dropdown
  const executorOptions = profiles
    ? Object.keys(profiles)
        .sort()
        .map((key) => ({
          value: key as BaseCodingAgent,
          label: toPrettyCase(key),
        }))
    : [];

  const selectedAgentProfile =
    profiles?.[draft?.executor_profile?.executor || ''];
  const hasVariants =
    selectedAgentProfile && Object.keys(selectedAgentProfile).length > 0;

  useEffect(() => {
    if (!config) return;
    if (!dirty) {
      setDraft(cloneDeep(config));
    }
  }, [config, dirty]);

  const hasUnsavedChanges = useMemo(() => {
    if (!draft || !config) return false;
    return !isEqual(draft, config);
  }, [draft, config]);

  // Sync dirty state to context for unsaved changes confirmation
  useEffect(() => {
    setContextDirty('general', hasUnsavedChanges);
    return () => setContextDirty('general', false);
  }, [hasUnsavedChanges, setContextDirty]);

  const updateDraft = useCallback(
    (patch: Partial<typeof config>) => {
      setDraft((prev: typeof config) => {
        if (!prev) return prev;
        const next = merge({}, prev, patch);
        if (!isEqual(next, config)) {
          setDirty(true);
        }
        return next;
      });
    },
    [config]
  );

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const playSound = async (soundFile: SoundFile) => {
    const audio = new Audio(`/api/sounds/${soundFile}`);
    try {
      await audio.play();
    } catch (err) {
      console.error('Failed to play sound:', err);
    }
  };

  const requestPushPermission = useCallback(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    void Notification.requestPermission().catch((error) => {
      console.warn('Failed to request notification permission', error);
    });
  }, []);

  const handleSave = async () => {
    if (!draft) return;

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const normalizedTheme =
        draft.theme === ThemeMode.DARK ? ThemeMode.LIGHT : draft.theme;
      const nextConfig =
        normalizedTheme === draft.theme
          ? draft
          : { ...draft, theme: normalizedTheme };
      await updateAndSaveConfig(nextConfig);
      setTheme(normalizedTheme);
      setDirty(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(t('settings.general.save.error'));
      console.error('Error saving config:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!config) return;
    setDraft(cloneDeep(config));
    setDirty(false);
  };

  const resetDisclaimer = async () => {
    if (!config) return;
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('vk_disclaimer_ack');
    }
    updateAndSaveConfig({ disclaimer_acknowledged: false });
  };

  const resetOnboarding = async () => {
    if (!config) return;
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('vk_onboarding_ack');
    }
    updateAndSaveConfig({ onboarding_acknowledged: false });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2">
        <SpinnerIcon
          className="size-icon-lg animate-spin text-brand"
          weight="bold"
        />
        <span className="text-[14px] text-[#333333]">
          {t('settings.general.loading')}
        </span>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="py-8">
        <div className="rounded-[10px] border border-[#f3d7d7] bg-[#fff7f7] p-4 text-[13px] text-[#d14343]">
          {t('settings.general.loadError')}
        </div>
      </div>
    );
  }

  const themeOptions = [{ value: ThemeMode.LIGHT, label: toPrettyCase(ThemeMode.LIGHT) }];

  const soundOptions = Object.values(SoundFile).map((sound) => ({
    value: sound,
    label: toPrettyCase(sound),
  }));

  return (
    <>
      {/* Status messages */}
      {error && (
        <div className="mb-5 rounded-[10px] border border-[#f3d7d7] bg-[#fff7f7] p-4 text-[13px] text-[#d14343]">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-5 rounded-[10px] border border-[#d8ead8] bg-[#f7fcf7] p-4 text-[13px] font-medium text-[#2f7d32]">
          {t('settings.general.save.success')}
        </div>
      )}

      {/* Appearance */}
      <SettingsCard
        title={t('settings.general.appearance.title')}
        description={t('settings.general.appearance.description')}
      >
        <SettingsField
          label={t('settings.general.appearance.theme.label')}
          description={t('settings.general.appearance.theme.helper')}
        >
          <SettingsSelect
            value={ThemeMode.LIGHT}
            options={themeOptions}
            onChange={() => updateDraft({ theme: ThemeMode.LIGHT })}
            placeholder={t('settings.general.appearance.theme.placeholder')}
          />
        </SettingsField>

        <SettingsField
          label={t('settings.general.appearance.language.label')}
          description={t('settings.general.appearance.language.helper')}
        >
          <SettingsSelect
            value={draft?.language}
            options={languageOptions}
            onChange={(value: UiLanguage) => updateDraft({ language: value })}
            placeholder={t('settings.general.appearance.language.placeholder')}
          />
        </SettingsField>
      </SettingsCard>

      {/* Default Coding Agent */}
      <SettingsCard
        title={t('settings.general.taskExecution.title')}
        description={t('settings.general.taskExecution.description')}
      >
        <SettingsField
          label={t('settings.general.taskExecution.executor.label')}
          description={t('settings.general.taskExecution.executor.helper')}
        >
          <div className="grid grid-cols-2 gap-2">
            <SettingsSelect
              value={draft?.executor_profile?.executor}
              options={executorOptions}
              onChange={(value: BaseCodingAgent) => {
                const variants = profiles?.[value];
                const keepCurrentVariant =
                  variants &&
                  draft?.executor_profile?.variant &&
                  variants[draft.executor_profile.variant];

                const newProfile: ExecutorProfileId = {
                  executor: value,
                  variant: keepCurrentVariant
                    ? draft!.executor_profile!.variant
                    : null,
                };
                updateDraft({ executor_profile: newProfile });
              }}
              placeholder={t('settings.agents.selectAgent')}
              disabled={!profiles}
            />

            {hasVariants ? (
              <SettingsSelect
                value={draft?.executor_profile?.variant ?? undefined}
                options={Object.keys(selectedAgentProfile).map(
                  (variantLabel) => ({
                    value: variantLabel,
                    label: toPrettyCase(variantLabel),
                  })
                )}
                onChange={(value: string) => {
                  const newProfile: ExecutorProfileId = {
                    executor: draft!.executor_profile!.executor,
                    variant: value,
                  };
                  updateDraft({ executor_profile: newProfile });
                }}
                placeholder={t('settings.general.taskExecution.defaultLabel')}
              />
            ) : selectedAgentProfile ? (
              <button
                disabled
                className={cn(
                  settingsFieldClassName,
                  'cursor-not-allowed justify-between opacity-50'
                )}
              >
                <span className="truncate">
                  {t('settings.general.taskExecution.defaultLabel')}
                </span>
              </button>
            ) : null}
          </div>
        </SettingsField>
      </SettingsCard>

      {/* Notifications */}
      <SettingsCard
        title={t('settings.general.notifications.title')}
        description={t('settings.general.notifications.description')}
      >
        <SettingsCheckbox
          id="sound-enabled"
          label={t('settings.general.notifications.sound.label')}
          description={t('settings.general.notifications.sound.helper')}
          checked={draft?.notifications.sound_enabled ?? false}
          onChange={(checked) =>
            updateDraft({
              notifications: {
                ...draft!.notifications,
                sound_enabled: checked,
              },
            })
          }
        />

        {draft?.notifications.sound_enabled && (
          <div className="ml-7 space-y-2">
            <label className="text-[12px] text-[#8C8C8C]">
              {t('settings.general.notifications.sound.fileLabel')}
            </label>
            <div className="flex gap-2">
              <div className="flex-1">
                <SettingsSelect
                  value={draft.notifications.sound_file}
                  options={soundOptions}
                  onChange={(value: SoundFile) =>
                    updateDraft({
                      notifications: {
                        ...draft.notifications,
                        sound_file: value,
                      },
                    })
                  }
                  placeholder={t(
                    'settings.general.notifications.sound.filePlaceholder'
                  )}
                />
              </div>
              <button
                type="button"
                onClick={() => playSound(draft.notifications.sound_file)}
                aria-label="Preview sound"
                title="Preview sound"
                className={settingsIconButtonClassName}
              >
                <SpeakerHighIcon className="h-4 w-4" weight="bold" />
              </button>
            </div>
            <p className="text-[12px] leading-5 text-[#8C8C8C]">
              {t('settings.general.notifications.sound.fileHelper')}
            </p>
          </div>
        )}

        <SettingsCheckbox
          id="push-notifications"
          label={t('settings.general.notifications.push.label')}
          description={t('settings.general.notifications.push.helper')}
          checked={draft?.notifications.push_enabled ?? false}
          onChange={(checked) => {
            if (checked) {
              requestPushPermission();
            }
            updateDraft({
              notifications: {
                ...draft!.notifications,
                push_enabled: checked,
              },
            });
          }}
        />
      </SettingsCard>

      {/* Message Input */}
      <SettingsCard
        title={t('settings.general.messageInput.title')}
        description={t('settings.general.messageInput.description')}
      >
        <SettingsField
          label={t('settings.general.messageInput.shortcut.label')}
          description={t('settings.general.messageInput.shortcut.helper')}
        >
          <SettingsSelect
            value={draft?.send_message_shortcut ?? 'ModifierEnter'}
            options={[
              {
                value: 'ModifierEnter' as SendMessageShortcut,
                label: `${getModifierKey()}+Enter`,
              },
              {
                value: 'Enter' as SendMessageShortcut,
                label: t('settings.general.messageInput.shortcut.enterLabel'),
              },
            ]}
            onChange={(value: SendMessageShortcut) =>
              updateDraft({ send_message_shortcut: value })
            }
          />
        </SettingsField>
      </SettingsCard>

      {/* Chat Compression */}
      <SettingsCard
        title={t('settings.general.chatCompression.title')}
        description={t('settings.general.chatCompression.description')}
      >
        <SettingsField
          label={t('settings.general.chatCompression.tokenThreshold.label')}
          description={t(
            'settings.general.chatCompression.tokenThreshold.helper'
          )}
        >
          <SettingsNumberInput
            value={draft?.chat_compression?.token_threshold ?? 50000}
            onChange={(value) =>
              updateDraft({
                chat_compression: {
                  ...draft?.chat_compression,
                  token_threshold: value,
                  compression_percentage:
                    draft?.chat_compression?.compression_percentage ?? 25,
                },
              })
            }
            min={10000}
            max={200000}
            step={1000}
          />
        </SettingsField>
        <SettingsField
          label={t(
            'settings.general.chatCompression.compressionPercentage.label'
          )}
          description={t(
            'settings.general.chatCompression.compressionPercentage.helper'
          )}
        >
          <SettingsNumberInput
            value={draft?.chat_compression?.compression_percentage ?? 25}
            onChange={(value) =>
              updateDraft({
                chat_compression: {
                  ...draft?.chat_compression,
                  token_threshold:
                    draft?.chat_compression?.token_threshold ?? 50000,
                  compression_percentage: value,
                },
              })
            }
            min={10}
            max={50}
            step={5}
          />
        </SettingsField>
      </SettingsCard>

      {/* Safety */}
      <SettingsCard
        title={t('settings.general.safety.title')}
        description={t('settings.general.safety.description')}
      >
        <div className="border-t border-[#f5f5f5]">
          <div className="flex items-center justify-between gap-4 border-b border-[#fafafa] py-3">
            <div>
              <p className="text-[13px] font-medium text-[#333333]">
                {t('settings.general.safety.disclaimer.title')}
              </p>
              <p className="mt-1 text-[12px] leading-5 text-[#8C8C8C]">
                {t('settings.general.safety.disclaimer.description')}
              </p>
            </div>
            <button
              type="button"
              onClick={resetDisclaimer}
              className={cn(
                settingsSecondaryButtonClassName,
                'px-3 py-[9px] text-[13px]'
              )}
            >
              {t('settings.general.safety.disclaimer.button')}
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <div>
              <p className="text-[13px] font-medium text-[#333333]">
                {t('settings.general.safety.onboarding.title')}
              </p>
              <p className="mt-1 text-[12px] leading-5 text-[#8C8C8C]">
                {t('settings.general.safety.onboarding.description')}
              </p>
            </div>
            <button
              type="button"
              onClick={resetOnboarding}
              className={cn(
                settingsSecondaryButtonClassName,
                'px-3 py-[9px] text-[13px]'
              )}
            >
              {t('settings.general.safety.onboarding.button')}
            </button>
          </div>
        </div>
      </SettingsCard>

      <SettingsSaveBar
        show={hasUnsavedChanges}
        saving={saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </>
  );
}

// Alias for backwards compatibility
export { GeneralSettingsSection as GeneralSettingsSectionContent };
