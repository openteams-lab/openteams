import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SpinnerIcon,
  PlusIcon,
  TrashIcon,
  DotsThreeIcon,
  StarIcon,
} from '@phosphor-icons/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../primitives/Dropdown';
import { ExecutorConfigForm } from './ExecutorConfigForm';
import { useProfiles } from '@/hooks/useProfiles';
import { useUserSystem } from '@/components/ConfigProvider';
import { CreateConfigurationDialog } from '@/components/dialogs/settings/CreateConfigurationDialog';
import { DeleteConfigurationDialog } from '@/components/dialogs/settings/DeleteConfigurationDialog';
import type { BaseCodingAgent, ExecutorConfigs } from 'shared/types';
import { cn } from '@/lib/utils';
import { toPrettyCase } from '@/utils/string';
import { getVariantDisplayLabel, getVariantOptions } from '@/utils/executor';
import {
  settingsPanelClassName,
  SettingsSaveBar,
  TwoColumnPicker,
  TwoColumnPickerColumn,
  TwoColumnPickerItem,
  TwoColumnPickerBadge,
  TwoColumnPickerEmpty,
} from './SettingsComponents';
import { useSettingsDirty } from './SettingsDirtyContext';
import { AgentIcon } from '@/components/agents/AgentIcon';

type ExecutorsMap = Record<string, Record<string, Record<string, unknown>>>;

export function AgentsSettingsSection() {
  const { t } = useTranslation(['settings', 'common']);
  const { setDirty: setContextDirty } = useSettingsDirty();

  // Profiles hook for server state
  const {
    profilesContent: serverProfilesContent,
    isLoading: profilesLoading,
    isSaving: profilesSaving,
    error: profilesError,
    save: saveProfiles,
  } = useProfiles();

  const { config, updateAndSaveConfig, reloadSystem } = useUserSystem();

  // Local editor state
  const [profilesSuccess, setProfilesSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Form-based editor state
  const [selectedExecutorType, setSelectedExecutorType] =
    useState<BaseCodingAgent | null>(null);
  const [selectedConfiguration, setSelectedConfiguration] = useState<
    string | null
  >(null);
  const [localParsedProfiles, setLocalParsedProfiles] =
    useState<ExecutorConfigs | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [hasValidationErrors, setHasValidationErrors] = useState(false);

  // Initialize selection with default executor when config loads
  useEffect(() => {
    if (config?.executor_profile && !selectedExecutorType) {
      setSelectedExecutorType(config.executor_profile.executor);
      setSelectedConfiguration(config.executor_profile.variant || 'DEFAULT');
    }
  }, [config?.executor_profile, selectedExecutorType]);

  useEffect(() => {
    setHasValidationErrors(false);
  }, [selectedExecutorType, selectedConfiguration]);

  // Sync server state to local state when not dirty
  useEffect(() => {
    if (!isDirty && serverProfilesContent) {
      try {
        const parsed = JSON.parse(serverProfilesContent);
        setLocalParsedProfiles(parsed);
      } catch (err) {
        console.error('Failed to parse profiles JSON:', err);
        setLocalParsedProfiles(null);
      }
    }
  }, [serverProfilesContent, isDirty]);

  // Sync dirty state to context for unsaved changes confirmation
  useEffect(() => {
    setContextDirty('agents', isDirty);
    return () => setContextDirty('agents', false);
  }, [isDirty, setContextDirty]);

  const markDirty = (nextProfiles: unknown) => {
    setLocalParsedProfiles(nextProfiles as ExecutorConfigs);
    setIsDirty(true);
  };

  const getSortedConfigurations = (
    executor: BaseCodingAgent | string | null,
    executors = localParsedProfiles?.executors
  ) => getVariantOptions(executor, executors);

  const handleCreateConfig = async (executor: string) => {
    try {
      const result = await CreateConfigurationDialog.show({
        executorType: executor as BaseCodingAgent,
        existingConfigs: Object.keys(
          localParsedProfiles?.executors?.[executor as BaseCodingAgent] || {}
        ),
      });

      if (result.action === 'created' && result.configName) {
        createConfiguration(executor, result.configName, result.cloneFrom);
      }
    } catch {
      // User cancelled
    }
  };

  const createConfiguration = (
    executorType: string,
    configName: string,
    baseConfig?: string | null
  ) => {
    if (!localParsedProfiles || !localParsedProfiles.executors) return;

    const executorsMap =
      localParsedProfiles.executors as unknown as ExecutorsMap;
    const base =
      baseConfig && executorsMap[executorType]?.[baseConfig]?.[executorType]
        ? executorsMap[executorType][baseConfig][executorType]
        : {};

    const updatedProfiles = {
      ...localParsedProfiles,
      executors: {
        ...localParsedProfiles.executors,
        [executorType]: {
          ...executorsMap[executorType],
          [configName]: {
            [executorType]: base,
          },
        },
      },
    };

    markDirty(updatedProfiles);
    setSelectedExecutorType(executorType as BaseCodingAgent);
    setSelectedConfiguration(configName);
  };

  const handleDeleteConfig = async (executor: string, configName: string) => {
    try {
      const result = await DeleteConfigurationDialog.show({
        configName,
        executorType: executor as BaseCodingAgent,
      });

      if (result === 'deleted') {
        await deleteConfiguration(executor, configName);
      }
    } catch {
      // User cancelled
    }
  };

  const deleteConfiguration = async (
    executorType: string,
    configToDelete: string
  ) => {
    if (!localParsedProfiles) return;

    setSaveError(null);

    try {
      const executorConfigs =
        localParsedProfiles.executors[executorType as BaseCodingAgent];
      if (!executorConfigs?.[configToDelete]) {
        return;
      }

      const currentConfigs = Object.keys(executorConfigs);
      if (currentConfigs.length <= 1) {
        return;
      }

      const remainingConfigs = { ...executorConfigs };
      delete remainingConfigs[configToDelete];

      const updatedProfiles = {
        ...localParsedProfiles,
        executors: {
          ...localParsedProfiles.executors,
          [executorType]: remainingConfigs,
        },
      };

      const executorsMap = updatedProfiles.executors as unknown as ExecutorsMap;
      if (Object.keys(remainingConfigs).length === 0) {
        executorsMap[executorType] = {
          DEFAULT: { [executorType]: {} },
        };
      }

      try {
        await saveProfiles(JSON.stringify(updatedProfiles, null, 2));
        setLocalParsedProfiles(updatedProfiles);
        setIsDirty(false);

        // Select another config if we deleted the selected one
        if (
          selectedExecutorType === executorType &&
          selectedConfiguration === configToDelete
        ) {
          const nextConfigs = getSortedConfigurations(
            executorType as BaseCodingAgent,
            updatedProfiles.executors
          );
          setSelectedConfiguration(nextConfigs[0] || 'DEFAULT');
        }

        setProfilesSuccess(true);
        setTimeout(() => setProfilesSuccess(false), 3000);
        reloadSystem();
      } catch (error: unknown) {
        console.error('Failed to save deletion to backend:', error);
        setSaveError(t('settings.agents.errors.deleteFailed'));
      }
    } catch (error) {
      console.error('Error deleting configuration:', error);
    }
  };

  const handleMakeDefault = async (executor: string, config: string) => {
    try {
      await updateAndSaveConfig({
        executor_profile: {
          executor: executor as BaseCodingAgent,
          variant: config,
        },
      });
      reloadSystem();
    } catch (err) {
      console.error('Error setting default:', err);
    }
  };

  const handleExecutorConfigChange = (
    executorType: string,
    configuration: string,
    formData: unknown
  ) => {
    if (!localParsedProfiles || !localParsedProfiles.executors) return;

    const executorsMap =
      localParsedProfiles.executors as unknown as ExecutorsMap;
    const updatedProfiles = {
      ...localParsedProfiles,
      executors: {
        ...localParsedProfiles.executors,
        [executorType]: {
          ...executorsMap[executorType],
          [configuration]: {
            [executorType]: formData,
          },
        },
      },
    };

    markDirty(updatedProfiles);
  };

  const handleExecutorConfigSave = async () => {
    if (
      !localParsedProfiles ||
      !localParsedProfiles.executors ||
      !selectedExecutorType ||
      !selectedConfiguration
    )
      return;

    setSaveError(null);
    try {
      await saveProfiles(JSON.stringify(localParsedProfiles, null, 2));
      setProfilesSuccess(true);
      setIsDirty(false);
      setTimeout(() => setProfilesSuccess(false), 3000);
      reloadSystem();
    } catch (err: unknown) {
      console.error('Failed to save profiles:', err);
      setSaveError(t('settings.agents.errors.saveConfigFailed'));
    }
  };

  // Discard handler for agent configuration
  const handleDiscard = () => {
    if (isDirty && serverProfilesContent) {
      setIsDirty(false);
      setHasValidationErrors(false);
      try {
        const parsed = JSON.parse(serverProfilesContent);
        setLocalParsedProfiles(parsed);
      } catch {
        // Ignore parse errors on discard
      }
    }
  };

  if (profilesLoading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2">
        <SpinnerIcon
          className="size-icon-lg animate-spin text-brand"
          weight="bold"
        />
        <span className="text-[14px] text-[#333333]">
          {t('settings.agents.loading')}
        </span>
      </div>
    );
  }

  const executorsMap =
    localParsedProfiles?.executors as unknown as ExecutorsMap;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-28">
        {/* Status messages */}
        {!!profilesError && (
          <div className="mb-4 shrink-0 rounded-[10px] border border-[#f3d7d7] bg-[#fff7f7] p-4 text-[13px] text-[#d14343]">
            {profilesError instanceof Error
              ? profilesError.message
              : String(profilesError)}
          </div>
        )}

        {profilesSuccess && (
          <div className="mb-4 shrink-0 rounded-[10px] border border-[#d8ead8] bg-[#f7fcf7] p-4 text-[13px] font-medium text-[#2f7d32]">
            {t('settings.agents.save.success')}
          </div>
        )}

        {saveError && (
          <div className="mb-4 shrink-0 rounded-[10px] border border-[#f3d7d7] bg-[#fff7f7] p-4 text-[13px] text-[#d14343]">
            {saveError}
          </div>
        )}

        {localParsedProfiles?.executors ? (
          /* Two-column layout: agents and variants on top, config form below */
          <div className="flex flex-col gap-4 pb-4">
            {/* Two-column selector - Finder-like style, stacked on mobile */}
            <TwoColumnPicker>
              {/* Agents column */}
              <TwoColumnPickerColumn
                label={t('settings.agents.editor.agentLabel')}
                isFirst
              >
                {Object.keys(localParsedProfiles.executors).map((executor) => {
                  const isDefault =
                    config?.executor_profile?.executor === executor;
                  return (
                    <TwoColumnPickerItem
                      key={executor}
                      selected={selectedExecutorType === executor}
                      onClick={() => {
                        setSelectedExecutorType(executor as BaseCodingAgent);
                        const configs = getSortedConfigurations(
                          executor as BaseCodingAgent
                        );
                        if (configs.length > 0) {
                          setSelectedConfiguration(configs[0]);
                        }
                      }}
                      leading={
                        <AgentIcon
                          agent={executor as BaseCodingAgent}
                          className="size-icon-sm shrink-0"
                        />
                      }
                      trailing={
                        isDefault && (
                          <TwoColumnPickerBadge variant="brand">
                            {t('settings.agents.editor.isDefault')}
                          </TwoColumnPickerBadge>
                        )
                      }
                    >
                      {toPrettyCase(executor)}
                    </TwoColumnPickerItem>
                  );
                })}
              </TwoColumnPickerColumn>

              {/* Variants column */}
              <TwoColumnPickerColumn
                label={t('settings.agents.editor.configLabel')}
                headerAction={
                  selectedExecutorType && (
                    <button
                      className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border-none bg-transparent text-[#8C8C8C] transition-colors duration-200 hover:bg-[#F3F6FA] hover:text-[#333333]"
                      onClick={() => handleCreateConfig(selectedExecutorType)}
                      disabled={profilesSaving}
                      title={t('settings.agents.editor.createNew')}
                    >
                      <PlusIcon className="size-icon-2xs" weight="bold" />
                    </button>
                  )
                }
              >
                {selectedExecutorType &&
                localParsedProfiles.executors[selectedExecutorType] ? (
                  getSortedConfigurations(selectedExecutorType).map(
                    (configName) => {
                      const isDefault =
                        config?.executor_profile?.executor ===
                          selectedExecutorType &&
                        config?.executor_profile?.variant === configName;
                      const configCount = Object.keys(
                        localParsedProfiles.executors[selectedExecutorType] || {}
                      ).length;
                      return (
                        <TwoColumnPickerItem
                          key={configName}
                          selected={selectedConfiguration === configName}
                          onClick={() => setSelectedConfiguration(configName)}
                          trailing={
                            <>
                              {isDefault && (
                                <TwoColumnPickerBadge variant="brand">
                                  {t('settings.agents.editor.isDefault')}
                                </TwoColumnPickerBadge>
                              )}
                              <ConfigActionsDropdown
                                executorType={selectedExecutorType}
                                configName={configName}
                                isDefault={isDefault}
                                configCount={configCount}
                                onMakeDefault={handleMakeDefault}
                                onDelete={handleDeleteConfig}
                              />
                            </>
                          }
                        >
                          {getVariantDisplayLabel(
                            selectedExecutorType,
                            configName,
                            localParsedProfiles?.executors
                          )}
                        </TwoColumnPickerItem>
                      );
                    }
                  )
                ) : (
                  <TwoColumnPickerEmpty>
                    {t('settings.agents.selectAgent')}
                  </TwoColumnPickerEmpty>
                )}
              </TwoColumnPickerColumn>
            </TwoColumnPicker>

            {/* Config form */}
            {selectedExecutorType && selectedConfiguration && (
              <div className="mt-2 border-t border-[#f5f5f5] pt-6">
                <div className={cn(settingsPanelClassName, 'p-4')}>
                  <ExecutorConfigForm
                    key={`${selectedExecutorType}-${selectedConfiguration}`}
                    executor={selectedExecutorType}
                    value={
                      (executorsMap?.[selectedExecutorType]?.[
                        selectedConfiguration
                      ]?.[selectedExecutorType] as Record<string, unknown>) ||
                      {}
                    }
                    onChange={(formData) =>
                      handleExecutorConfigChange(
                        selectedExecutorType,
                        selectedConfiguration,
                        formData
                      )
                    }
                    onValidationChange={setHasValidationErrors}
                    disabled={profilesSaving}
                  />
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20">
        <div className="pointer-events-auto px-1">
          <SettingsSaveBar
            show={isDirty}
            saving={profilesSaving}
            saveDisabled={hasValidationErrors}
            unsavedMessage={t('settings.agents.save.unsavedChanges')}
            onSave={handleExecutorConfigSave}
            onDiscard={handleDiscard}
            layout="floating-panel"
          />
        </div>
      </div>
    </div>
  );
}

// Helper component for config actions dropdown
function ConfigActionsDropdown({
  executorType,
  configName,
  isDefault,
  configCount,
  onMakeDefault,
  onDelete,
}: {
  executorType: BaseCodingAgent;
  configName: string;
  isDefault: boolean;
  configCount: number;
  onMakeDefault: (executor: string, config: string) => void;
  onDelete: (executor: string, config: string) => void;
}) {
  const { t } = useTranslation(['settings']);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-[8px] border-none bg-transparent text-[#8C8C8C] transition-all duration-200 hover:bg-[#F3F6FA] hover:text-[#333333]',
            'opacity-0 group-hover:opacity-100 transition-opacity'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <DotsThreeIcon className="size-icon-xs" weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="rounded-[10px] border border-[#E8EEF5] bg-white p-1 shadow-[0_12px_30px_rgba(0,0,0,0.08)]"
      >
        <DropdownMenuItem
          className="mx-0 rounded-[8px] px-3 py-2 text-[14px] text-[#333333] focus:bg-[#F9FBFF]"
          onClick={(e) => {
            e.stopPropagation();
            onMakeDefault(executorType, configName);
          }}
          disabled={isDefault}
        >
          <div className="flex items-center gap-half w-full">
            <StarIcon className="size-icon-xs mr-base" />
            {t('settings.agents.editor.makeDefault')}
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="mx-0 rounded-[8px] px-3 py-2 text-[14px] text-[#d14343] focus:bg-[#fff7f7] focus:text-[#d14343]"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(executorType, configName);
          }}
          disabled={configCount <= 1}
        >
          <div className="flex items-center gap-half w-full">
            <TrashIcon className="size-icon-xs mr-base" />
            {t('settings.agents.editor.deleteText')}
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Alias for backwards compatibility
export { AgentsSettingsSection as AgentsSettingsSectionContent };
