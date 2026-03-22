import { useCallback, useEffect, useMemo, useState } from 'react';
import { cloneDeep, isEqual } from 'lodash';
import { useTranslation } from 'react-i18next';
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeSlashIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react';
import {
  BaseCodingAgent,
  type ChatMemberPreset,
  type ChatPresetsConfig,
  type ChatTeamPreset,
  type JsonValue,
} from 'shared/types';
import { useUserSystem } from '@/components/ConfigProvider';
import { cn } from '@/lib/utils';
import { PromptEditorModal } from '@/pages/ui-new/chat/components/PromptEditorModal';
import { AgentSkillsSection } from '@/pages/ui-new/chat/components/AgentSkillsSection';
import { Tooltip } from '@/components/ui-new/primitives/Tooltip';
import {
  formatExecutorModelLabel,
  getVariantModelName,
  getVariantOptions as getExecutorVariantOptions,
} from '@/utils/executor';
import { toPrettyCase } from '@/utils/string';
import {
  SettingsField,
  settingsFieldClassName,
  settingsSecondaryButtonClassName,
  SettingsSelect,
} from '../dialogs/settings/SettingsComponents';
import { useSettingsDirty } from '../dialogs/settings/SettingsDirtyContext';

type PresetsTab = 'members' | 'teams';

interface ChatPresetsEditorPanelProps {
  onCancel?: () => void;
}

const emptyPresets = (): ChatPresetsConfig => ({
  members: [],
  teams: [],
  team_protocol: null,
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

const makePresetIdFromName = (
  name: string,
  existingIds: Set<string>,
  fallback: string
): string => makeUniqueId(slugify(name || fallback), existingIds);

const normalizeToolsEnabled = (value: unknown): JsonValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonValue;
};

const normalizeSelectedSkillIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((skillId): skillId is string => typeof skillId === 'string')
        .map((skillId) => skillId.trim())
        .filter(Boolean)
    )
  );
};

const normalizeRecommendedModel = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeTeamPresetProtocol = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const normalizeDraft = (draft: ChatPresetsConfig): ChatPresetsConfig => {
  const members = draft.members.map((member) => ({
    ...member,
    id: member.id.trim(),
    name: member.name.trim(),
    description: member.description.trim(),
    runner_type: member.runner_type?.trim() || null,
    recommended_model: normalizeRecommendedModel(member.recommended_model),
    system_prompt: member.system_prompt,
    default_workspace_path: member.default_workspace_path?.trim() || null,
    selected_skill_ids: normalizeSelectedSkillIds(member.selected_skill_ids),
    tools_enabled: normalizeToolsEnabled(member.tools_enabled),
  }));

  const validMemberIds = new Set(members.map((member) => member.id));
  const teams = draft.teams.map((team) => ({
    ...team,
    id: team.id.trim(),
    name: team.name.trim(),
    description: team.description.trim(),
    member_ids: team.member_ids.filter((id) => validMemberIds.has(id)),
    team_protocol: normalizeTeamPresetProtocol(team.team_protocol),
  }));

  return {
    members,
    teams,
    team_protocol: draft.team_protocol ?? null,
  };
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
        'w-full rounded-[18px] border px-4 py-3 text-left transition-all duration-200',
        selected
          ? 'border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB] shadow-[inset_-3px_0_0_#3B82F6]'
          : 'border-transparent bg-transparent text-[#475569] hover:border-[#E2E8F0] hover:bg-white',
        disabled && 'opacity-70'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{title}</div>
          <div
            className={cn(
              'mt-1 truncate text-[12px]',
              selected ? 'text-[#3B82F6]/75' : 'text-[#94A3B8]'
            )}
          >
            {subtitle || '\u00a0'}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isBuiltin ? (
            <span className="rounded-md bg-[#E2E8F0] px-2 py-[2px] text-[10px] font-medium uppercase tracking-[0.08em] text-[#64748B]">
              {t('settings.presets.builtin')}
            </span>
          ) : null}
          {disabled ? (
            <span className="rounded-md bg-[#FEF2F2] px-2 py-[2px] text-[10px] font-medium uppercase tracking-[0.08em] text-[#DC2626]">
              {t('settings.presets.disabled')}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function EmptyDetailState({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center px-8 py-16">
      <div className="max-w-sm rounded-[24px] border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-8 py-10 text-center text-[14px] leading-6 text-[#94A3B8]">
        {message}
      </div>
    </div>
  );
}

const sidebarTabButtonClassName =
  'flex-1 rounded-[12px] border px-4 py-[10px] text-[14px] font-medium transition-all duration-200';

const panelFieldClassName = cn(
  settingsFieldClassName,
  'rounded-[14px] border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-[14px] text-[#334155] placeholder:text-[#94A3B8] focus:border-[#3B82F6] focus:bg-white focus:shadow-[0_0_0_3px_rgba(59,130,246,0.1)] disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]'
);

const promptEditorClassName =
  'min-h-[280px] w-full resize-y rounded-[20px] border border-[#D8E2F0] bg-[#EEF3F9] px-5 py-4 font-mono text-[13px] leading-6 text-[#334155] outline-none transition-all duration-200 placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.18)]';

const presetToolbarButtonClassName = cn(
  settingsSecondaryButtonClassName,
  'rounded-[12px] border-[#E2E8F0] bg-white px-4 py-[9px] text-[13px] font-medium text-[#475569] hover:bg-[#F8FAFC]'
);

const presetInlineActionButtonClassName = cn(
  settingsSecondaryButtonClassName,
  'rounded-[10px] border-[#E2E8F0] bg-white px-3 py-[5px] text-[11px] font-medium text-[#64748B] hover:bg-[#F8FAFC]'
);

const presetDestructiveButtonClassName = cn(
  presetToolbarButtonClassName,
  'border-[#FECACA] bg-[#FFF5F5] text-[#EF4444] hover:bg-[#FEF2F2]'
);

const presetMemberSelectTriggerClassName =
  'preset-member-select-trigger rounded-[14px] border-[#D1D5DB] bg-[#F8FAFC] px-4 py-3 text-[#334155] focus:border-[#3B82F6] focus:bg-white focus:shadow-[0_0_0_3px_rgba(59,130,246,0.1)]';

const presetMemberSelectContentClassName = 'preset-member-select-content';

const presetMemberSelectItemClassName = 'preset-member-select-item';

const presetMemberSelectItemSelectedClassName =
  'preset-member-select-item-selected';

const modalFooterButtonClassName =
  'inline-flex items-center justify-center rounded-[14px] px-6 py-[10px] text-[14px] font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50';

const modalFooterSecondaryButtonClassName = cn(
  modalFooterButtonClassName,
  'border border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F8FAFC]'
);

const modalFooterPrimaryButtonClassName = cn(
  modalFooterButtonClassName,
  'border border-[#2563EB] bg-[#2563EB] text-white shadow-[0_12px_24px_rgba(59,130,246,0.18)] hover:-translate-y-px hover:bg-[#1D4ED8]'
);

export function ChatPresetsEditorPanel({
  onCancel,
}: ChatPresetsEditorPanelProps) {
  const { t } = useTranslation('settings');
  const { t: tChat } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const { config, profiles, updateAndSaveConfig, homeDirectory } =
    useUserSystem();
  const { setDirty: setContextDirty } = useSettingsDirty();

  const sourcePresets = useMemo(
    () => config?.chat_presets ?? emptyPresets(),
    [config?.chat_presets]
  );

  const [tab, setTab] = useState<PresetsTab>('teams');
  const [draft, setDraft] = useState<ChatPresetsConfig>(() =>
    cloneDeep(sourcePresets)
  );
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [isMemberPromptEditorOpen, setIsMemberPromptEditorOpen] =
    useState(false);
  const [isTeamProtocolEditorOpen, setIsTeamProtocolEditorOpen] =
    useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [teamMemberSearch, setTeamMemberSearch] = useState('');
  const [showMemberSearch, setShowMemberSearch] = useState(false);

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

  useEffect(() => {
    if (!selectedTeam) {
      setIsTeamProtocolEditorOpen(false);
    }
  }, [selectedTeam]);

  const getLocalizedMemberName = useCallback(
    (member: Pick<ChatMemberPreset, 'id' | 'name' | 'is_builtin'>): string => {
      if (!member.is_builtin) return member.name;
      return tChat(`members.presetDisplay.members.${member.id}`, {
        defaultValue: member.name,
      });
    },
    [tChat]
  );

  // Filtered members for sidebar list
  const filteredSidebarMembers = useMemo(() => {
    if (!memberSearch.trim()) return draft.members;
    const searchLower = memberSearch.toLowerCase().trim();
    return draft.members.filter((member) => {
      const localizedName = member.is_builtin
        ? tChat(`members.presetDisplay.members.${member.id}`, {
            defaultValue: member.name,
          })
        : member.name;
      return (
        localizedName.toLowerCase().includes(searchLower) ||
        member.id.toLowerCase().includes(searchLower) ||
        member.description.toLowerCase().includes(searchLower)
      );
    });
  }, [draft.members, memberSearch, tChat]);

  // Filtered members for team member selection
  const filteredTeamMembers = useMemo(() => {
    if (!teamMemberSearch.trim()) return draft.members;
    const searchLower = teamMemberSearch.toLowerCase().trim();
    return draft.members.filter((member) => {
      const localizedName = member.is_builtin
        ? tChat(`members.presetDisplay.members.${member.id}`, {
            defaultValue: member.name,
          })
        : member.name;
      return (
        localizedName.toLowerCase().includes(searchLower) ||
        member.id.toLowerCase().includes(searchLower) ||
        member.description.toLowerCase().includes(searchLower)
      );
    });
  }, [draft.members, teamMemberSearch, tChat]);

  const getLocalizedTeamName = useCallback(
    (team: Pick<ChatTeamPreset, 'id' | 'name' | 'is_builtin'>): string => {
      if (!team.is_builtin) return team.name;
      return tChat(`members.presetDisplay.teams.${team.id}`, {
        defaultValue: team.name,
      });
    },
    [tChat]
  );

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

  const getRecommendedModelOptions = useCallback(
    (runnerType: string | null | undefined) => {
      const normalizedRunnerType = runnerType?.trim();
      if (!normalizedRunnerType) {
        return [] as { value: string; label: string }[];
      }

      const uniqueOptions = new Map<string, { value: string; label: string }>();
      const variants = getExecutorVariantOptions(
        normalizedRunnerType as BaseCodingAgent,
        profiles
      );

      for (const variant of variants) {
        const model = getVariantModelName(
          normalizedRunnerType as BaseCodingAgent,
          variant,
          profiles
        )?.trim();
        if (!model) continue;

        const normalizedModel = model.toLowerCase();
        if (uniqueOptions.has(normalizedModel)) continue;

        uniqueOptions.set(normalizedModel, {
          value: model,
          label:
            formatExecutorModelLabel(
              normalizedRunnerType as BaseCodingAgent,
              model
            ) ?? model,
        });
      }

      return Array.from(uniqueOptions.values()).sort((a, b) =>
        a.label.localeCompare(b.label)
      );
    },
    [profiles]
  );

  const recommendedModelOptions = useMemo(() => {
    if (!selectedMember) {
      return [] as { value: string; label: string }[];
    }

    const options = getRecommendedModelOptions(selectedMember.runner_type);
    const currentModel = selectedMember.recommended_model?.trim();
    if (
      currentModel &&
      !options.some(
        (option) => option.value.toLowerCase() === currentModel.toLowerCase()
      )
    ) {
      options.push({
        value: currentModel,
        label: currentModel,
      });
    }

    return [
      {
        value: '',
        label: t('settings.presets.members.fields.recommendedModelPlaceholder'),
      },
      ...options,
    ];
  }, [getRecommendedModelOptions, selectedMember, t]);

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

  const handleAddMemberPreset = useCallback(() => {
    let nextId = '';
    setDraft((prev) => {
      const existingIds = new Set(prev.members.map((member) => member.id));
      const existingNames = new Set(
        prev.members.map((member) => member.name.toLowerCase())
      );
      const name = makeUniqueName('member', existingNames);
      const id = makePresetIdFromName(name, existingIds, 'member');
      nextId = id;
      const nextMember: ChatMemberPreset = {
        id,
        name,
        description: '',
        runner_type: BaseCodingAgent.OPEN_TEAMS_CLI,
        recommended_model: null,
        system_prompt: '',
        default_workspace_path: homeDirectory,
        selected_skill_ids: [],
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
  }, [homeDirectory]);

  const handleCopyMemberPreset = useCallback((member: ChatMemberPreset) => {
    let nextId = '';
    setDraft((prev) => {
      const existingIds = new Set(prev.members.map((item) => item.id));
      const existingNames = new Set(
        prev.members.map((item) => item.name.toLowerCase())
      );
      const name = makeUniqueName(`${member.name}_copy`, existingNames);
      const id = makePresetIdFromName(name, existingIds, 'member_copy');
      nextId = id;
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
      ...prev,
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
      const name = makeUniqueName('team', existingNames);
      const id = makePresetIdFromName(name, existingIds, 'team');
      nextId = id;
      const nextTeam: ChatTeamPreset = {
        id,
        name,
        description: '',
        member_ids: [],
        team_protocol: '',
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
      const name = makeUniqueName(`${team.name} Copy`, existingNames);
      const id = makePresetIdFromName(name, existingIds, 'team_copy');
      nextId = id;
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

  const handleSave = async () => {
    if (!config) return;

    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const next = normalizeDraft(draft);
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
  };

  if (!config) {
    return (
      <div className="py-8">
        <div className="rounded-[16px] border border-[#FECACA] bg-[#FFF5F5] p-4 text-[13px] text-[#DC2626]">
          {t('settings.presets.loadError')}
        </div>
      </div>
    );
  }

  const memberDetail = selectedMember ? (
    <>
      <div className="border-b border-[#F1F5F9] px-8 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 max-w-[calc(100%-240px)] flex-1">
            <h3 className="truncate text-[22px] font-semibold text-[#0F172A]">
              @{getLocalizedMemberName(selectedMember)}
            </h3>
            {selectedMember.description ? (
              <Tooltip content={selectedMember.description} side="bottom">
                <p className="mt-1 truncate text-[13px] text-[#94A3B8]">
                  {selectedMember.description}
                </p>
              </Tooltip>
            ) : null}
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
            {!selectedMember.is_builtin ? (
              <button
                type="button"
                className={presetDestructiveButtonClassName}
                onClick={() => handleDeleteMemberPreset(selectedMember)}
              >
                <TrashIcon className="h-4 w-4" weight="bold" />
                {t('settings.presets.actions.delete')}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-6 px-8 py-8">
          <div className="grid gap-6 xl:grid-cols-2">
            <SettingsField label={t('settings.presets.members.fields.name')}>
              <input
                type="text"
                value={selectedMember.name}
                onChange={(event) =>
                  updateMember(selectedMember.id, (current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className={panelFieldClassName}
                placeholder={t(
                  'settings.presets.members.fields.namePlaceholder'
                )}
              />
            </SettingsField>

            <SettingsField
              label={t('settings.presets.members.fields.description')}
            >
              <input
                type="text"
                value={selectedMember.description}
                onChange={(event) =>
                  updateMember(selectedMember.id, (current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                className={panelFieldClassName}
                placeholder={t(
                  'settings.presets.members.fields.descriptionPlaceholder'
                )}
              />
            </SettingsField>
          </div>

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
                  recommended_model:
                    value.length > 0 &&
                    getRecommendedModelOptions(value).some(
                      (option) =>
                        option.value.toLowerCase() ===
                        (current.recommended_model ?? '').toLowerCase()
                    )
                      ? current.recommended_model
                      : null,
                }))
              }
              className={presetMemberSelectTriggerClassName}
              contentClassName={presetMemberSelectContentClassName}
              itemClassName={presetMemberSelectItemClassName}
              selectedItemClassName={presetMemberSelectItemSelectedClassName}
            />
          </SettingsField>

          <SettingsField
            label={t('settings.presets.members.fields.recommendedModel')}
          >
            <SettingsSelect
              value={selectedMember.recommended_model ?? ''}
              options={recommendedModelOptions}
              onChange={(value) =>
                updateMember(selectedMember.id, (current) => ({
                  ...current,
                  recommended_model: value.length > 0 ? value : null,
                }))
              }
              disabled={!selectedMember.runner_type}
              className={presetMemberSelectTriggerClassName}
              contentClassName={presetMemberSelectContentClassName}
              itemClassName={presetMemberSelectItemClassName}
              selectedItemClassName={presetMemberSelectItemSelectedClassName}
            />
          </SettingsField>

          <SettingsField
            label={t('settings.presets.members.fields.workspacePath')}
          >
            <input
              type="text"
              value={selectedMember.default_workspace_path ?? ''}
              onChange={(event) =>
                updateMember(selectedMember.id, (current) => ({
                  ...current,
                  default_workspace_path:
                    event.target.value.length > 0 ? event.target.value : null,
                }))
              }
              className={panelFieldClassName}
              placeholder={t(
                'settings.presets.members.fields.workspacePathPlaceholder'
              )}
            />
          </SettingsField>

          <SettingsField label={t('settings.presets.members.fields.skills')}>
            <div className="rounded-[18px] border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <AgentSkillsSection
                agentId={null}
                runnerType={
                  selectedMember.runner_type ?? config.executor_profile.executor
                }
                selectedSkillIds={selectedMember.selected_skill_ids ?? []}
                onSelectedSkillIdsChange={(skillIds) =>
                  updateMember(selectedMember.id, (current) => ({
                    ...current,
                    selected_skill_ids: skillIds,
                  }))
                }
                maxHeightClass="max-h-40"
              />
            </div>
          </SettingsField>

          <SettingsField
            label={
              <div className="flex items-center justify-between gap-3">
                <span>{t('settings.presets.members.fields.systemPrompt')}</span>
                <button
                  type="button"
                  className={presetInlineActionButtonClassName}
                  onClick={() => setIsMemberPromptEditorOpen(true)}
                >
                  {tChat('members.expand')}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              <textarea
                value={selectedMember.system_prompt}
                onChange={(event) =>
                  updateMember(selectedMember.id, (current) => ({
                    ...current,
                    system_prompt: event.target.value,
                  }))
                }
                rows={12}
                className={promptEditorClassName}
                placeholder={t(
                  'settings.presets.members.fields.systemPromptPlaceholder'
                )}
              />
            </div>
          </SettingsField>
        </div>
      </div>
    </>
  ) : (
    <EmptyDetailState message={t('settings.presets.members.empty')} />
  );

  const teamDetail = selectedTeam ? (
    <>
      <div className="border-b border-[#F1F5F9] px-8 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 max-w-[calc(100%-240px)] flex-1">
            <h3 className="truncate text-[22px] font-semibold text-[#0F172A]">
              {getLocalizedTeamName(selectedTeam)}
            </h3>
            {selectedTeam.description ? (
              <Tooltip content={selectedTeam.description} side="bottom">
                <p className="mt-1 truncate text-[13px] text-[#94A3B8]">
                  {selectedTeam.description}
                </p>
              </Tooltip>
            ) : null}
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
            {!selectedTeam.is_builtin ? (
              <button
                type="button"
                className={presetDestructiveButtonClassName}
                onClick={() => handleDeleteTeamPreset(selectedTeam)}
              >
                <TrashIcon className="h-4 w-4" weight="bold" />
                {t('settings.presets.actions.delete')}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[980px] flex-col gap-6 px-8 py-8">
          <div className="grid gap-6 xl:grid-cols-2">
            <SettingsField label={t('settings.presets.teams.fields.name')}>
              <input
                type="text"
                value={selectedTeam.name}
                onChange={(event) =>
                  updateTeam(selectedTeam.id, (current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className={panelFieldClassName}
                placeholder={t('settings.presets.teams.fields.namePlaceholder')}
              />
            </SettingsField>

            <SettingsField
              label={t('settings.presets.teams.fields.description')}
            >
              <input
                type="text"
                value={selectedTeam.description}
                onChange={(event) =>
                  updateTeam(selectedTeam.id, (current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                className={panelFieldClassName}
                placeholder={t(
                  'settings.presets.teams.fields.descriptionPlaceholder'
                )}
              />
            </SettingsField>
          </div>

          <SettingsField
            label={
              <div className="flex items-center justify-between gap-3">
                <span>{tChat('members.teamProtocol.title')}</span>
                <button
                  type="button"
                  className={presetInlineActionButtonClassName}
                  onClick={() => setIsTeamProtocolEditorOpen(true)}
                >
                  {tChat('members.expand')}
                </button>
              </div>
            }
            description={tChat('members.teamProtocol.modal.description')}
          >
            <textarea
              value={selectedTeam.team_protocol ?? ''}
              onChange={(event) =>
                updateTeam(selectedTeam.id, (current) => ({
                  ...current,
                  team_protocol: event.target.value,
                }))
              }
              rows={8}
              className={promptEditorClassName}
              placeholder={tChat('members.teamProtocol.modal.placeholder')}
            />
          </SettingsField>

          <SettingsField
            label={
              <div className="flex items-center justify-between gap-3">
                <span>{t('settings.presets.teams.fields.members')}</span>
                <span className="text-[12px] font-normal text-[#94A3B8]">
                  {selectedTeam.member_ids.length} / {draft.members.length}
                </span>
              </div>
            }
          >
            {draft.members.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-5 py-6 text-[13px] text-[#94A3B8]">
                {t('settings.presets.teams.noMemberPresets')}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Search input for team members */}
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
                  <input
                    type="text"
                    value={teamMemberSearch}
                    onChange={(e) => setTeamMemberSearch(e.target.value)}
                    placeholder={t('settings.presets.searchMembersPlaceholder')}
                    className="w-full rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] py-2.5 pl-10 pr-8 text-[13px] text-[#334155] placeholder:text-[#94A3B8] focus:border-[#3B82F6] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
                  />
                  {teamMemberSearch && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#94A3B8] hover:bg-[#E2E8F0] hover:text-[#64748B]"
                      onClick={() => setTeamMemberSearch('')}
                    >
                      <XIcon className="h-3.5 w-3.5" weight="bold" />
                    </button>
                  )}
                </div>
                {/* Members grid */}
                {filteredTeamMembers.length === 0 ? (
                  <div className="rounded-[18px] border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-5 py-6 text-center text-[13px] text-[#94A3B8]">
                    {t('settings.presets.noSearchResults')}
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {filteredTeamMembers.map((member) => {
                      const checked = selectedTeam.member_ids.includes(
                        member.id
                      );
                      return (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() =>
                            updateTeam(selectedTeam.id, (current) => {
                              const nextIds = checked
                                ? current.member_ids.filter(
                                    (id) => id !== member.id
                                  )
                                : [...current.member_ids, member.id];
                              return {
                                ...current,
                                member_ids: Array.from(new Set(nextIds)),
                              };
                            })
                          }
                          className={cn(
                            'group flex items-start gap-3 rounded-[18px] border px-4 py-3 text-left transition-all duration-200',
                            checked
                              ? 'border-[#3B82F6] bg-[#F0F7FF] shadow-[0_8px_20px_rgba(59,130,246,0.08)]'
                              : 'border-[#E2E8F0] bg-white hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'
                          )}
                        >
                          <span
                            className={cn(
                              'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 transition-all duration-200',
                              checked
                                ? 'border-[#3B82F6] bg-[#3B82F6] text-white'
                                : 'border-[#CBD5E1] bg-white text-transparent group-hover:border-[#94A3B8]'
                            )}
                          >
                            <CheckIcon className="h-3 w-3" weight="bold" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                'block truncate text-[14px] font-medium',
                                checked ? 'text-[#0F172A]' : 'text-[#475569]'
                              )}
                            >
                              @{getLocalizedMemberName(member)}
                            </span>
                            <span className="mt-1 block truncate text-[12px] text-[#94A3B8]">
                              {member.description || member.id}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </SettingsField>
        </div>
      </div>
    </>
  ) : (
    <EmptyDetailState message={t('settings.presets.teams.empty')} />
  );

  const detailActions = hasUnsavedChanges ? (
    <div className="shrink-0 border-t border-[#E2E8F0] bg-[#F8FAFC]/80 px-6 py-4 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-[980px] items-center justify-end gap-3">
        <button
          type="button"
          className={modalFooterSecondaryButtonClassName}
          onClick={onCancel ?? handleDiscard}
        >
          {onCancel ? tCommon('buttons.cancel') : tCommon('buttons.discard')}
        </button>
        <button
          type="button"
          className={modalFooterPrimaryButtonClassName}
          onClick={() => {
            void handleSave();
          }}
          disabled={saving}
        >
          {saving ? tCommon('states.saving') : tCommon('buttons.save')}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        {error ? (
          <div className="mb-4 rounded-[16px] border border-[#FECACA] bg-[#FFF5F5] px-5 py-4 text-[13px] text-[#DC2626]">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="mb-4 rounded-[16px] border border-[#BBF7D0] bg-[#F0FDF4] px-5 py-4 text-[13px] font-medium text-[#15803D]">
            {t('settings.presets.saveSuccess')}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 overflow-hidden rounded-[28px] border border-white/80 bg-[rgba(255,255,255,0.92)] shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <aside className="flex w-[292px] min-w-[292px] flex-col border-r border-[#E2E8F0] bg-[#F8FAFC]/95">
            <div className="border-b border-[#E2E8F0] p-4">
              <div className="flex gap-2 rounded-[14px] bg-[#EEF2F7] p-1">
                <button
                  type="button"
                  className={cn(
                    sidebarTabButtonClassName,
                    'whitespace-nowrap',
                    tab === 'teams'
                      ? 'border-[#E2E8F0] bg-white text-[#2563EB] shadow-sm'
                      : 'border-transparent bg-transparent text-[#64748B] hover:bg-white/70'
                  )}
                  onClick={() => setTab('teams')}
                >
                  {t('settings.presets.tabs.teams')}
                </button>
                <button
                  type="button"
                  className={cn(
                    sidebarTabButtonClassName,
                    'whitespace-nowrap',
                    tab === 'members'
                      ? 'border-[#E2E8F0] bg-white text-[#0F172A] shadow-sm'
                      : 'border-transparent bg-transparent text-[#64748B] hover:bg-white/70'
                  )}
                  onClick={() => setTab('members')}
                >
                  {t('settings.presets.tabs.members')}
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-col gap-2 px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">
                    {tab === 'members'
                      ? t('settings.presets.members.listTitle')
                      : t('settings.presets.teams.listTitle')}
                  </span>
                  <div className="flex items-center gap-2">
                    {tab === 'members' && (
                      <button
                        type="button"
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-200',
                          showMemberSearch
                            ? 'bg-[#2563EB] text-white'
                            : 'text-[#64748B] hover:bg-[#E2E8F0] hover:text-[#475569]'
                        )}
                        onClick={() => {
                          setShowMemberSearch(!showMemberSearch);
                          if (showMemberSearch) {
                            setMemberSearch('');
                          }
                        }}
                        title={t('settings.presets.search')}
                      >
                        <MagnifyingGlassIcon
                          className="h-3.5 w-3.5"
                          weight="bold"
                        />
                      </button>
                    )}
                    <button
                      type="button"
                      className="whitespace-nowrap text-[12px] font-semibold text-[#2563EB] transition-colors duration-200 hover:text-[#1D4ED8]"
                      onClick={
                        tab === 'members'
                          ? handleAddMemberPreset
                          : handleAddTeamPreset
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        <PlusIcon className="h-3.5 w-3.5" weight="bold" />
                        {tab === 'members'
                          ? t('settings.presets.members.add')
                          : t('settings.presets.teams.add')}
                      </span>
                    </button>
                  </div>
                </div>
                {tab === 'members' && showMemberSearch && (
                  <div className="relative">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
                    <input
                      type="text"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder={t('settings.presets.searchPlaceholder')}
                      className="w-full rounded-[10px] border border-[#E2E8F0] bg-white py-2 pl-9 pr-8 text-[13px] text-[#334155] placeholder:text-[#94A3B8] focus:border-[#3B82F6] focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
                      autoFocus
                    />
                    {memberSearch && (
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#94A3B8] hover:bg-[#F1F5F9] hover:text-[#64748B]"
                        onClick={() => setMemberSearch('')}
                      >
                        <XIcon className="h-3.5 w-3.5" weight="bold" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
                <div className="space-y-2">
                  {tab === 'members' ? (
                    draft.members.length === 0 ? (
                      <div className="rounded-[18px] border border-dashed border-[#CBD5E1] bg-white px-4 py-6 text-[13px] text-[#94A3B8]">
                        {t('settings.presets.members.empty')}
                      </div>
                    ) : filteredSidebarMembers.length === 0 ? (
                      <div className="rounded-[18px] border border-dashed border-[#CBD5E1] bg-white px-4 py-6 text-center text-[13px] text-[#94A3B8]">
                        {t('settings.presets.noSearchResults')}
                      </div>
                    ) : (
                      filteredSidebarMembers.map((member) => (
                        <PresetListItem
                          key={member.id}
                          title={`@${getLocalizedMemberName(member)}`}
                          subtitle={member.description}
                          selected={selectedMemberId === member.id}
                          disabled={!member.enabled}
                          isBuiltin={member.is_builtin}
                          onClick={() => setSelectedMemberId(member.id)}
                        />
                      ))
                    )
                  ) : draft.teams.length === 0 ? (
                    <div className="rounded-[18px] border border-dashed border-[#CBD5E1] bg-white px-4 py-6 text-[13px] text-[#94A3B8]">
                      {t('settings.presets.teams.empty')}
                    </div>
                  ) : (
                    draft.teams.map((team) => (
                      <PresetListItem
                        key={team.id}
                        title={getLocalizedTeamName(team)}
                        subtitle={team.description}
                        selected={selectedTeamId === team.id}
                        disabled={!team.enabled}
                        isBuiltin={team.is_builtin}
                        onClick={() => setSelectedTeamId(team.id)}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col bg-white">
            {tab === 'members' ? memberDetail : teamDetail}
            {detailActions}
          </section>
        </div>
      </div>

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
      <PromptEditorModal
        isOpen={isTeamProtocolEditorOpen && !!selectedTeam}
        value={selectedTeam?.team_protocol ?? ''}
        onChange={(value) => {
          if (!selectedTeam) return;
          updateTeam(selectedTeam.id, (current) => ({
            ...current,
            team_protocol: value,
          }));
        }}
        onClose={() => setIsTeamProtocolEditorOpen(false)}
        showFileImport={false}
        title={tChat('members.teamProtocol.modal.title')}
        description={tChat('members.teamProtocol.modal.description')}
        placeholder={tChat('members.teamProtocol.modal.placeholder')}
        doneText={tCommon('buttons.done')}
        closeAriaLabel={tChat('members.teamProtocol.modal.close')}
        size="compact"
      />
    </>
  );
}
