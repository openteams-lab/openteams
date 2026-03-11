import { useCallback, useEffect, useMemo, useState } from 'react';
import { cloneDeep, isEqual } from 'lodash';
import { useTranslation } from 'react-i18next';
import {
  CopyIcon,
  EyeIcon,
  EyeSlashIcon,
  PlusIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import type {
  ChatMemberPreset,
  ChatPresetsConfig,
  ChatTeamPreset,
  JsonValue,
} from 'shared/types';
import { useUserSystem } from '@/components/ConfigProvider';
import { cn } from '@/lib/utils';
import { toPrettyCase } from '@/utils/string';
import { PromptEditorModal } from '@/pages/ui-new/chat/components/PromptEditorModal';
import {
  SettingsCard,
  SettingsField,
  SettingsInput,
  settingsMutedPanelClassName,
  settingsPanelClassName,
  settingsSecondaryButtonClassName,
  SettingsSaveBar,
  SettingsSelect,
  SettingsTextarea,
} from './SettingsComponents';
import { useSettingsDirty } from './SettingsDirtyContext';

type PresetsTab = 'members' | 'teams';

const emptyPresets = (): ChatPresetsConfig => ({
  members: [],
  teams: [],
});

const slugify = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');
  return normalized.length > 0 ? normalized : 'preset';
};

const makeUniqueId = (base: string, existingIds: Set<string>): string => {
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
};

const makeUniqueName = (base: string, existingNames: Set<string>): string => {
  let candidate = base;
  let suffix = 2;
  while (existingNames.has(candidate.toLowerCase())) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
};

const normalizeToolsEnabled = (value: unknown): JsonValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonValue;
};

const normalizeDraft = (draft: ChatPresetsConfig): ChatPresetsConfig => {
  const members = draft.members.map((member) => ({
    ...member,
    id: member.id.trim(),
    name: member.name.trim(),
    description: member.description.trim(),
    runner_type: member.runner_type?.trim() || null,
    system_prompt: member.system_prompt,
    default_workspace_path: member.default_workspace_path?.trim() || null,
    tools_enabled: normalizeToolsEnabled(member.tools_enabled),
  }));

  const validMemberIds = new Set(members.map((member) => member.id));
  const teams = draft.teams.map((team) => ({
    ...team,
    id: team.id.trim(),
    name: team.name.trim(),
    description: team.description.trim(),
    member_ids: team.member_ids.filter((id) => validMemberIds.has(id)),
  }));

  return { members, teams };
};

interface PresetListItemProps {
  title: string;
  subtitle: string;
  selected: boolean;
  disabled?: boolean;
  isBuiltin?: boolean;
  onClick: () => void;
}

function PresetListItem({
  title,
  subtitle,
  selected,
  disabled,
  isBuiltin,
  onClick,
}: PresetListItemProps) {
  const { t } = useTranslation('settings');
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-[10px] border border-[#E8EEF5] px-3 py-3 text-left transition-colors duration-200',
        selected
          ? 'bg-[rgba(74,144,226,0.06)] text-[#4A90E2]'
          : 'bg-white text-[#333333] hover:bg-[#F9FBFF]',
        disabled && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] font-medium">
          {title}
        </span>
        {isBuiltin && (
          <span className="rounded-full bg-[#F3F6FA] px-2 py-[2px] text-[11px] text-[#8C8C8C]">
            {t('settings.presets.builtin')}
          </span>
        )}
        {disabled && (
          <span className="rounded-full bg-[#fff7f7] px-2 py-[2px] text-[11px] text-[#d14343]">
            {t('settings.presets.disabled')}
          </span>
        )}
      </div>
      <div className="mt-1 truncate text-[12px] text-[#8C8C8C]">
        {subtitle || '\u00a0'}
      </div>
    </button>
  );
}

const presetToolbarButtonClassName = cn(
  settingsSecondaryButtonClassName,
  'px-3 py-[9px] text-[13px]'
);

export function ChatPresetsSettingsSectionContent() {
  const { t } = useTranslation('settings');
  const { t: tChat } = useTranslation('chat');
  const { config, profiles, updateAndSaveConfig } = useUserSystem();
  const { setDirty: setContextDirty } = useSettingsDirty();

  const sourcePresets = useMemo(
    () => config?.chat_presets ?? emptyPresets(),
    [config?.chat_presets]
  );

  const [tab, setTab] = useState<PresetsTab>('members');
  const [draft, setDraft] = useState<ChatPresetsConfig>(() =>
    cloneDeep(sourcePresets)
  );
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [toolsDraft, setToolsDraft] = useState('{}');
  const [isMemberPromptEditorOpen, setIsMemberPromptEditorOpen] =
    useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const hasUnsavedChanges = useMemo(
    () => !isEqual(draft, sourcePresets),
    [draft, sourcePresets]
  );

  useEffect(() => {
    setContextDirty('presets', hasUnsavedChanges);
    return () => setContextDirty('presets', false);
  }, [hasUnsavedChanges, setContextDirty]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      setDraft(cloneDeep(sourcePresets));
    }
  }, [sourcePresets, hasUnsavedChanges]);

  useEffect(() => {
    if (draft.members.length === 0) {
      setSelectedMemberId(null);
      return;
    }
    if (!selectedMemberId) {
      setSelectedMemberId(draft.members[0].id);
      return;
    }
    if (!draft.members.some((member) => member.id === selectedMemberId)) {
      setSelectedMemberId(draft.members[0].id);
    }
  }, [draft.members, selectedMemberId]);

  useEffect(() => {
    if (draft.teams.length === 0) {
      setSelectedTeamId(null);
      return;
    }
    if (!selectedTeamId) {
      setSelectedTeamId(draft.teams[0].id);
      return;
    }
    if (!draft.teams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(draft.teams[0].id);
    }
  }, [draft.teams, selectedTeamId]);

  const selectedMember = useMemo(
    () =>
      selectedMemberId
        ? (draft.members.find((member) => member.id === selectedMemberId) ??
          null)
        : null,
    [draft.members, selectedMemberId]
  );

  const selectedTeam = useMemo(
    () =>
      selectedTeamId
        ? (draft.teams.find((team) => team.id === selectedTeamId) ?? null)
        : null,
    [draft.teams, selectedTeamId]
  );

  useEffect(() => {
    if (!selectedMember) {
      setIsMemberPromptEditorOpen(false);
    }
  }, [selectedMember]);

  const getLocalizedMemberName = useCallback(
    (member: Pick<ChatMemberPreset, 'id' | 'name' | 'is_builtin'>): string => {
      if (!member.is_builtin) return member.name;
      return tChat(`members.presetDisplay.members.${member.id}`, {
        defaultValue: member.name,
      });
    },
    [tChat]
  );

  const getLocalizedTeamName = useCallback(
    (team: Pick<ChatTeamPreset, 'id' | 'name' | 'is_builtin'>): string => {
      if (!team.is_builtin) return team.name;
      return tChat(`members.presetDisplay.teams.${team.id}`, {
        defaultValue: team.name,
      });
    },
    [tChat]
  );

  useEffect(() => {
    if (!selectedMember) {
      setToolsDraft('{}');
      setToolsError(null);
      return;
    }
    setToolsDraft(
      JSON.stringify(
        normalizeToolsEnabled(selectedMember.tools_enabled),
        null,
        2
      )
    );
    setToolsError(null);
  }, [selectedMember]);

  const runnerOptions = useMemo(() => {
    const allRunners = Object.keys(profiles ?? {}).sort();
    return [
      {
        value: '',
        label: t('settings.presets.members.fields.runnerTypePlaceholder'),
      },
      ...allRunners.map((runner) => ({
        value: runner,
        label: toPrettyCase(runner),
      })),
    ];
  }, [profiles, t]);

  const updateMember = useCallback(
    (
      memberId: string,
      updater: (current: ChatMemberPreset) => ChatMemberPreset
    ) => {
      setDraft((prev) => ({
        ...prev,
        members: prev.members.map((member) =>
          member.id === memberId ? updater(member) : member
        ),
      }));
    },
    []
  );

  const updateTeam = useCallback(
    (teamId: string, updater: (current: ChatTeamPreset) => ChatTeamPreset) => {
      setDraft((prev) => ({
        ...prev,
        teams: prev.teams.map((team) =>
          team.id === teamId ? updater(team) : team
        ),
      }));
    },
    []
  );

  const parseToolsDraft = useCallback((): JsonValue | null => {
    try {
      const parsed = JSON.parse(toolsDraft);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setToolsError(t('settings.presets.members.errors.toolsJsonObject'));
        return null;
      }
      setToolsError(null);
      return parsed as JsonValue;
    } catch {
      setToolsError(t('settings.presets.members.errors.toolsJsonInvalid'));
      return null;
    }
  }, [t, toolsDraft]);

  const handleAddMemberPreset = useCallback(() => {
    let nextId = '';
    setDraft((prev) => {
      const existingIds = new Set(prev.members.map((member) => member.id));
      const existingNames = new Set(
        prev.members.map((member) => member.name.toLowerCase())
      );
      const id = makeUniqueId('custom_member_preset', existingIds);
      nextId = id;
      const name = makeUniqueName('member', existingNames);
      const nextMember: ChatMemberPreset = {
        id,
        name,
        description: '',
        runner_type: null,
        system_prompt: '',
        default_workspace_path: null,
        tools_enabled: {},
        is_builtin: false,
        enabled: true,
      };
      return {
        ...prev,
        members: [...prev.members, nextMember],
      };
    });
    setSelectedMemberId(nextId);
  }, []);

  const handleCopyMemberPreset = useCallback((member: ChatMemberPreset) => {
    let nextId = '';
    setDraft((prev) => {
      const existingIds = new Set(prev.members.map((item) => item.id));
      const existingNames = new Set(
        prev.members.map((item) => item.name.toLowerCase())
      );
      const id = makeUniqueId(`${slugify(member.id)}_copy`, existingIds);
      nextId = id;
      const name = makeUniqueName(`${member.name}_copy`, existingNames);
      const copy: ChatMemberPreset = {
        ...cloneDeep(member),
        id,
        name,
        is_builtin: false,
      };
      return {
        ...prev,
        members: [...prev.members, copy],
      };
    });
    setSelectedMemberId(nextId);
  }, []);

  const handleDeleteMemberPreset = useCallback((member: ChatMemberPreset) => {
    if (member.is_builtin) return;
    setDraft((prev) => ({
      members: prev.members.filter((item) => item.id !== member.id),
      teams: prev.teams.map((team) => ({
        ...team,
        member_ids: team.member_ids.filter((id) => id !== member.id),
      })),
    }));
  }, []);

  const handleAddTeamPreset = useCallback(() => {
    let nextId = '';
    setDraft((prev) => {
      const existingIds = new Set(prev.teams.map((team) => team.id));
      const existingNames = new Set(
        prev.teams.map((team) => team.name.toLowerCase())
      );
      const id = makeUniqueId('custom_team_preset', existingIds);
      nextId = id;
      const name = makeUniqueName('team', existingNames);
      const nextTeam: ChatTeamPreset = {
        id,
        name,
        description: '',
        member_ids: [],
        is_builtin: false,
        enabled: true,
      };
      return {
        ...prev,
        teams: [...prev.teams, nextTeam],
      };
    });
    setSelectedTeamId(nextId);
  }, []);

  const handleCopyTeamPreset = useCallback((team: ChatTeamPreset) => {
    let nextId = '';
    setDraft((prev) => {
      const existingIds = new Set(prev.teams.map((item) => item.id));
      const existingNames = new Set(
        prev.teams.map((item) => item.name.toLowerCase())
      );
      const id = makeUniqueId(`${slugify(team.id)}_copy`, existingIds);
      nextId = id;
      const name = makeUniqueName(`${team.name} Copy`, existingNames);
      const copy: ChatTeamPreset = {
        ...cloneDeep(team),
        id,
        name,
        is_builtin: false,
      };
      return {
        ...prev,
        teams: [...prev.teams, copy],
      };
    });
    setSelectedTeamId(nextId);
  }, []);

  const handleDeleteTeamPreset = useCallback((team: ChatTeamPreset) => {
    if (team.is_builtin) return;
    setDraft((prev) => ({
      ...prev,
      teams: prev.teams.filter((item) => item.id !== team.id),
    }));
  }, []);

  const applyToolsDraft = useCallback(() => {
    if (!selectedMember) return true;
    const parsed = parseToolsDraft();
    if (!parsed) {
      return false;
    }
    updateMember(selectedMember.id, (current) => ({
      ...current,
      tools_enabled: parsed,
    }));
    return true;
  }, [parseToolsDraft, selectedMember, updateMember]);

  const handleSave = async () => {
    if (!config) return;

    let nextDraft = draft;
    if (selectedMember) {
      const parsed = parseToolsDraft();
      if (!parsed) return;
      nextDraft = {
        ...draft,
        members: draft.members.map((member) =>
          member.id === selectedMember.id
            ? { ...member, tools_enabled: parsed }
            : member
        ),
      };
    }

    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const next = normalizeDraft(nextDraft);
      const ok = await updateAndSaveConfig({ chat_presets: next });
      if (!ok) {
        setError(t('settings.presets.saveError'));
        return;
      }
      setDraft(cloneDeep(next));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setDraft(cloneDeep(sourcePresets));
    setError(null);
    setSuccess(false);
    setToolsError(null);
  };

  if (!config) {
    return (
      <div className="py-8">
        <div className="rounded-[10px] border border-[#f3d7d7] bg-[#fff7f7] p-4 text-[13px] text-[#d14343]">
          {t('settings.presets.loadError')}
        </div>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="mb-5 rounded-[10px] border border-[#f3d7d7] bg-[#fff7f7] p-4 text-[13px] text-[#d14343]">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-5 rounded-[10px] border border-[#d8ead8] bg-[#f7fcf7] p-4 text-[13px] font-medium text-[#2f7d32]">
          {t('settings.presets.saveSuccess')}
        </div>
      )}

      <SettingsCard
        title={t('settings.presets.title')}
        description={t('settings.presets.description')}
      >
        <div className="mb-6 flex gap-2">
          <button
            type="button"
            className={cn(
              'rounded-[10px] border px-4 py-[10px] text-[14px] font-medium transition-colors duration-200',
              tab === 'members'
                ? 'border-[#E8EEF5] bg-[rgba(74,144,226,0.08)] text-[#4A90E2]'
                : 'border-[#E8EEF5] bg-white text-[#8C8C8C] hover:bg-[#F9FBFF] hover:text-[#333333]'
            )}
            onClick={() => setTab('members')}
          >
            {t('settings.presets.tabs.members')}
          </button>
          <button
            type="button"
            className={cn(
              'rounded-[10px] border px-4 py-[10px] text-[14px] font-medium transition-colors duration-200',
              tab === 'teams'
                ? 'border-[#E8EEF5] bg-[rgba(74,144,226,0.08)] text-[#4A90E2]'
                : 'border-[#E8EEF5] bg-white text-[#8C8C8C] hover:bg-[#F9FBFF] hover:text-[#333333]'
            )}
            onClick={() => setTab('teams')}
          >
            {t('settings.presets.tabs.teams')}
          </button>
        </div>

        {tab === 'members' ? (
          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
            <div className={cn(settingsPanelClassName, 'space-y-3 p-4')}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="text-[13px] font-medium text-[#333333]">
                  {t('settings.presets.members.listTitle')}
                </div>
                <button
                  type="button"
                  className={presetToolbarButtonClassName}
                  onClick={handleAddMemberPreset}
                >
                  <PlusIcon className="h-4 w-4" weight="bold" />
                  {t('settings.presets.members.add')}
                </button>
              </div>
              {draft.members.length === 0 && (
                <div className="py-4 text-[12px] text-[#8C8C8C]">
                  {t('settings.presets.members.empty')}
                </div>
              )}
              {draft.members.map((member) => (
                <PresetListItem
                  key={member.id}
                  title={`@${getLocalizedMemberName(member)}`}
                  subtitle={member.description}
                  selected={selectedMemberId === member.id}
                  disabled={!member.enabled}
                  isBuiltin={member.is_builtin}
                  onClick={() => setSelectedMemberId(member.id)}
                />
              ))}
            </div>
            <div className={cn(settingsPanelClassName, 'p-4')}>
              {!selectedMember && (
                <div className="text-[12px] text-[#8C8C8C]">
                  {t('settings.presets.members.empty')}
                </div>
              )}
              {selectedMember && (
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="text-[13px] font-medium text-[#333333]">
                      @{getLocalizedMemberName(selectedMember)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={presetToolbarButtonClassName}
                        onClick={() => handleCopyMemberPreset(selectedMember)}
                      >
                        <CopyIcon className="h-4 w-4" weight="bold" />
                        {t('settings.presets.actions.copy')}
                      </button>
                      <button
                        type="button"
                        className={presetToolbarButtonClassName}
                        onClick={() =>
                          updateMember(selectedMember.id, (current) => ({
                            ...current,
                            enabled: !current.enabled,
                          }))
                        }
                      >
                        {selectedMember.enabled ? (
                          <EyeSlashIcon className="h-4 w-4" weight="bold" />
                        ) : (
                          <EyeIcon className="h-4 w-4" weight="bold" />
                        )}
                        {selectedMember.enabled
                          ? t('settings.presets.actions.disable')
                          : t('settings.presets.actions.enable')}
                      </button>
                      {!selectedMember.is_builtin && (
                        <button
                          type="button"
                          className={cn(
                            presetToolbarButtonClassName,
                            'border-[#f3d7d7] bg-[#fff7f7] text-[#d14343] hover:bg-[#fff1f1]'
                          )}
                          onClick={() =>
                            handleDeleteMemberPreset(selectedMember)
                          }
                        >
                          <TrashIcon className="h-4 w-4" weight="bold" />
                          {t('settings.presets.actions.delete')}
                        </button>
                      )}
                    </div>
                  </div>

                  <SettingsField
                    label={t('settings.presets.members.fields.id')}
                  >
                    <SettingsInput
                      value={selectedMember.id}
                      onChange={() => {}}
                      disabled
                    />
                  </SettingsField>

                  <SettingsField
                    label={t('settings.presets.members.fields.name')}
                  >
                    <SettingsInput
                      value={selectedMember.name}
                      onChange={(value) =>
                        updateMember(selectedMember.id, (current) => ({
                          ...current,
                          name: value,
                        }))
                      }
                      placeholder={t(
                        'settings.presets.members.fields.namePlaceholder'
                      )}
                    />
                  </SettingsField>

                  <SettingsField
                    label={t('settings.presets.members.fields.description')}
                  >
                    <SettingsInput
                      value={selectedMember.description}
                      onChange={(value) =>
                        updateMember(selectedMember.id, (current) => ({
                          ...current,
                          description: value,
                        }))
                      }
                      placeholder={t(
                        'settings.presets.members.fields.descriptionPlaceholder'
                      )}
                    />
                  </SettingsField>

                  <SettingsField
                    label={t('settings.presets.members.fields.runnerType')}
                  >
                    <SettingsSelect
                      value={selectedMember.runner_type ?? ''}
                      options={runnerOptions}
                      onChange={(value) =>
                        updateMember(selectedMember.id, (current) => ({
                          ...current,
                          runner_type: value.length > 0 ? value : null,
                        }))
                      }
                    />
                  </SettingsField>

                  <SettingsField
                    label={t('settings.presets.members.fields.systemPrompt')}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-end">
                        <button
                          type="button"
                          className={cn(
                            settingsSecondaryButtonClassName,
                            'px-3 py-[8px] text-[12px]'
                          )}
                          onClick={() => setIsMemberPromptEditorOpen(true)}
                        >
                          {tChat('members.expand')}
                        </button>
                      </div>
                      <SettingsTextarea
                        value={selectedMember.system_prompt}
                        onChange={(value) =>
                          updateMember(selectedMember.id, (current) => ({
                            ...current,
                            system_prompt: value,
                          }))
                        }
                        rows={6}
                        placeholder={t(
                          'settings.presets.members.fields.systemPromptPlaceholder'
                        )}
                      />
                    </div>
                  </SettingsField>

                  <SettingsField
                    label={t('settings.presets.members.fields.workspacePath')}
                  >
                    <SettingsInput
                      value={selectedMember.default_workspace_path ?? ''}
                      onChange={(value) =>
                        updateMember(selectedMember.id, (current) => ({
                          ...current,
                          default_workspace_path:
                            value.length > 0 ? value : null,
                        }))
                      }
                      placeholder={t(
                        'settings.presets.members.fields.workspacePathPlaceholder'
                      )}
                    />
                  </SettingsField>

                  <SettingsField
                    label={t('settings.presets.members.fields.toolsEnabled')}
                    error={toolsError}
                  >
                    <SettingsTextarea
                      value={toolsDraft}
                      onChange={(value) => {
                        setToolsDraft(value);
                        if (toolsError) setToolsError(null);
                      }}
                      onBlur={applyToolsDraft}
                      rows={6}
                      monospace
                      placeholder="{ }"
                    />
                  </SettingsField>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
            <div className={cn(settingsPanelClassName, 'space-y-3 p-4')}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="text-[13px] font-medium text-[#333333]">
                  {t('settings.presets.teams.listTitle')}
                </div>
                <button
                  type="button"
                  className={presetToolbarButtonClassName}
                  onClick={handleAddTeamPreset}
                >
                  <PlusIcon className="h-4 w-4" weight="bold" />
                  {t('settings.presets.teams.add')}
                </button>
              </div>
              {draft.teams.length === 0 && (
                <div className="py-4 text-[12px] text-[#8C8C8C]">
                  {t('settings.presets.teams.empty')}
                </div>
              )}
              {draft.teams.map((team) => (
                <PresetListItem
                  key={team.id}
                  title={getLocalizedTeamName(team)}
                  subtitle={team.description}
                  selected={selectedTeamId === team.id}
                  disabled={!team.enabled}
                  isBuiltin={team.is_builtin}
                  onClick={() => setSelectedTeamId(team.id)}
                />
              ))}
            </div>
            <div className={cn(settingsPanelClassName, 'p-4')}>
              {!selectedTeam && (
                <div className="text-[12px] text-[#8C8C8C]">
                  {t('settings.presets.teams.empty')}
                </div>
              )}
              {selectedTeam && (
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="text-[13px] font-medium text-[#333333]">
                      {getLocalizedTeamName(selectedTeam)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={presetToolbarButtonClassName}
                        onClick={() => handleCopyTeamPreset(selectedTeam)}
                      >
                        <CopyIcon className="h-4 w-4" weight="bold" />
                        {t('settings.presets.actions.copy')}
                      </button>
                      <button
                        type="button"
                        className={presetToolbarButtonClassName}
                        onClick={() =>
                          updateTeam(selectedTeam.id, (current) => ({
                            ...current,
                            enabled: !current.enabled,
                          }))
                        }
                      >
                        {selectedTeam.enabled ? (
                          <EyeSlashIcon className="h-4 w-4" weight="bold" />
                        ) : (
                          <EyeIcon className="h-4 w-4" weight="bold" />
                        )}
                        {selectedTeam.enabled
                          ? t('settings.presets.actions.disable')
                          : t('settings.presets.actions.enable')}
                      </button>
                      {!selectedTeam.is_builtin && (
                        <button
                          type="button"
                          className={cn(
                            presetToolbarButtonClassName,
                            'border-[#f3d7d7] bg-[#fff7f7] text-[#d14343] hover:bg-[#fff1f1]'
                          )}
                          onClick={() => handleDeleteTeamPreset(selectedTeam)}
                        >
                          <TrashIcon className="h-4 w-4" weight="bold" />
                          {t('settings.presets.actions.delete')}
                        </button>
                      )}
                    </div>
                  </div>

                  <SettingsField label={t('settings.presets.teams.fields.id')}>
                    <SettingsInput
                      value={selectedTeam.id}
                      onChange={() => {}}
                      disabled
                    />
                  </SettingsField>

                  <SettingsField
                    label={t('settings.presets.teams.fields.name')}
                  >
                    <SettingsInput
                      value={selectedTeam.name}
                      onChange={(value) =>
                        updateTeam(selectedTeam.id, (current) => ({
                          ...current,
                          name: value,
                        }))
                      }
                      placeholder={t(
                        'settings.presets.teams.fields.namePlaceholder'
                      )}
                    />
                  </SettingsField>

                  <SettingsField
                    label={t('settings.presets.teams.fields.description')}
                  >
                    <SettingsInput
                      value={selectedTeam.description}
                      onChange={(value) =>
                        updateTeam(selectedTeam.id, (current) => ({
                          ...current,
                          description: value,
                        }))
                      }
                      placeholder={t(
                        'settings.presets.teams.fields.descriptionPlaceholder'
                      )}
                    />
                  </SettingsField>

                  <SettingsField
                    label={t('settings.presets.teams.fields.members')}
                  >
                    <div
                      className={cn(
                        settingsMutedPanelClassName,
                        'max-h-52 space-y-2 overflow-y-auto p-2'
                      )}
                    >
                      {draft.members.length === 0 && (
                        <div className="px-2 py-2 text-[12px] text-[#8C8C8C]">
                          {t('settings.presets.teams.noMemberPresets')}
                        </div>
                      )}
                      {draft.members.map((member) => {
                        const checked = selectedTeam.member_ids.includes(
                          member.id
                        );
                        return (
                          <label
                            key={member.id}
                            className={cn(
                              'flex cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-[13px] transition-colors duration-200',
                              checked
                                ? 'bg-[rgba(74,144,226,0.06)] text-[#4A90E2]'
                                : 'text-[#333333] hover:bg-white'
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const isChecked = event.target.checked;
                                updateTeam(selectedTeam.id, (current) => {
                                  const nextIds = isChecked
                                    ? [...current.member_ids, member.id]
                                    : current.member_ids.filter(
                                        (id) => id !== member.id
                                      );
                                  return {
                                    ...current,
                                    member_ids: Array.from(new Set(nextIds)),
                                  };
                                });
                              }}
                              className="h-[16px] w-[16px] rounded-[4px] border border-[#E8EEF5] accent-[#4A90E2]"
                            />
                            <span>@{getLocalizedMemberName(member)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </SettingsField>
                </div>
              )}
            </div>
          </div>
        )}
      </SettingsCard>

      <SettingsSaveBar
        show={hasUnsavedChanges}
        saving={saving}
        saveDisabled={!!toolsError}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
      <PromptEditorModal
        isOpen={isMemberPromptEditorOpen && !!selectedMember}
        value={selectedMember?.system_prompt ?? ''}
        onChange={(value) => {
          if (!selectedMember) return;
          updateMember(selectedMember.id, (current) => ({
            ...current,
            system_prompt: value,
          }));
        }}
        onClose={() => setIsMemberPromptEditorOpen(false)}
        showFileImport={false}
        size="compact"
      />
    </>
  );
}
