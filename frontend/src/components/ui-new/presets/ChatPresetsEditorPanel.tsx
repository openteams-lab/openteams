import { useCallback, useEffect, useMemo, useState } from 'react';
import { cloneDeep, isEqual } from 'lodash';
import { useTranslation } from 'react-i18next';
import {
  CheckIcon,
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
import { PromptEditorModal } from '@/pages/ui-new/chat/components/PromptEditorModal';
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

const panelTextareaClassName = cn(
  panelFieldClassName,
  'min-h-[96px] resize-y leading-6'
);

const promptEditorClassName =
  'min-h-[280px] w-full resize-y rounded-[20px] border border-[#0F172A] bg-[#0F172A] px-5 py-4 font-mono text-[13px] leading-6 text-[#E2E8F0] outline-none transition-all duration-200 placeholder:text-[#64748B] focus:border-[#2563EB] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.18)]';

const presetToolbarButtonClassName = cn(
  settingsSecondaryButtonClassName,
  'rounded-[12px] border-[#E2E8F0] bg-white px-4 py-[9px] text-[13px] font-medium text-[#475569] hover:bg-[#F8FAFC]'
);

const presetDestructiveButtonClassName = cn(
  presetToolbarButtonClassName,
  'border-[#FECACA] bg-[#FFF5F5] text-[#EF4444] hover:bg-[#FEF2F2]'
);

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
          <div className="min-w-0">
            <h3 className="truncate text-[22px] font-semibold text-[#0F172A]">
              @{getLocalizedMemberName(selectedMember)}
            </h3>
            <p className="mt-1 truncate text-[13px] text-[#94A3B8]">
              {selectedMember.description || selectedMember.id}
            </p>
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
            <SettingsField label={t('settings.presets.members.fields.id')}>
              <input
                type="text"
                value={selectedMember.id}
                readOnly
                className={panelFieldClassName}
              />
            </SettingsField>

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
          </div>

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
              className="rounded-[14px] border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-[#334155] focus:border-[#3B82F6] focus:bg-white focus:shadow-[0_0_0_3px_rgba(59,130,246,0.1)]"
            />
          </SettingsField>

          <SettingsField
            label={t('settings.presets.members.fields.systemPrompt')}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  className={presetToolbarButtonClassName}
                  onClick={() => setIsMemberPromptEditorOpen(true)}
                >
                  {tChat('members.expand')}
                </button>
              </div>
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
                    event.target.value.length > 0
                      ? event.target.value
                      : null,
                }))
              }
              className={panelFieldClassName}
              placeholder={t(
                'settings.presets.members.fields.workspacePathPlaceholder'
              )}
            />
          </SettingsField>

          <SettingsField
            label={t('settings.presets.members.fields.toolsEnabled')}
            error={toolsError}
          >
            <textarea
              value={toolsDraft}
              onChange={(event) => {
                setToolsDraft(event.target.value);
                if (toolsError) setToolsError(null);
              }}
              onBlur={applyToolsDraft}
              rows={7}
              className={cn(panelTextareaClassName, 'font-mono text-[13px]')}
              placeholder="{ }"
            />
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
          <div className="min-w-0">
            <h3 className="truncate text-[22px] font-semibold text-[#0F172A]">
              {getLocalizedTeamName(selectedTeam)}
            </h3>
            <p className="mt-1 truncate text-[13px] text-[#94A3B8]">
              {selectedTeam.description || selectedTeam.id}
            </p>
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
            <SettingsField label={t('settings.presets.teams.fields.id')}>
              <input
                type="text"
                value={selectedTeam.id}
                readOnly
                className={panelFieldClassName}
              />
            </SettingsField>

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
          </div>

          <SettingsField
            label={t('settings.presets.teams.fields.description')}
          >
            <textarea
              value={selectedTeam.description}
              onChange={(event) =>
                updateTeam(selectedTeam.id, (current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              rows={4}
              className={panelTextareaClassName}
              placeholder={t(
                'settings.presets.teams.fields.descriptionPlaceholder'
              )}
            />
          </SettingsField>

          <SettingsField
            label={t('settings.presets.teams.fields.members')}
            description={`${selectedTeam.member_ids.length} / ${draft.members.length}`}
          >
            {draft.members.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-5 py-6 text-[13px] text-[#94A3B8]">
                {t('settings.presets.teams.noMemberPresets')}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {draft.members.map((member) => {
                  const checked = selectedTeam.member_ids.includes(member.id);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() =>
                        updateTeam(selectedTeam.id, (current) => {
                          const nextIds = checked
                            ? current.member_ids.filter((id) => id !== member.id)
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
          </SettingsField>
        </div>
      </div>
    </>
  ) : (
    <EmptyDetailState message={t('settings.presets.teams.empty')} />
  );

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
                    tab === 'members'
                      ? 'border-[#E2E8F0] bg-white text-[#0F172A] shadow-sm'
                      : 'border-transparent bg-transparent text-[#64748B] hover:bg-white/70'
                  )}
                  onClick={() => setTab('members')}
                >
                  {t('settings.presets.tabs.members')}
                </button>
                <button
                  type="button"
                  className={cn(
                    sidebarTabButtonClassName,
                    tab === 'teams'
                      ? 'border-[#E2E8F0] bg-white text-[#2563EB] shadow-sm'
                      : 'border-transparent bg-transparent text-[#64748B] hover:bg-white/70'
                  )}
                  onClick={() => setTab('teams')}
                >
                  {t('settings.presets.tabs.teams')}
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between px-5 py-4">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">
                  {tab === 'members'
                    ? t('settings.presets.members.listTitle')
                    : t('settings.presets.teams.listTitle')}
                </span>
                <button
                  type="button"
                  className="text-[12px] font-semibold text-[#2563EB] transition-colors duration-200 hover:text-[#1D4ED8]"
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

              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
                <div className="space-y-2">
                  {tab === 'members' ? (
                    draft.members.length === 0 ? (
                      <div className="rounded-[18px] border border-dashed border-[#CBD5E1] bg-white px-4 py-6 text-[13px] text-[#94A3B8]">
                        {t('settings.presets.members.empty')}
                      </div>
                    ) : (
                      draft.members.map((member) => (
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
          </section>
        </div>

        <div className="mt-4 flex items-center justify-end gap-3 rounded-[20px] border border-[#E2E8F0] bg-[#F8FAFC]/80 px-6 py-4">
          <button
            type="button"
            className={modalFooterSecondaryButtonClassName}
            onClick={onCancel ?? handleDiscard}
          >
            {onCancel
              ? tCommon('buttons.cancel')
              : tCommon('buttons.discard')}
          </button>
          <button
            type="button"
            className={modalFooterPrimaryButtonClassName}
            onClick={() => {
              void handleSave();
            }}
            disabled={!hasUnsavedChanges || !!toolsError || saving}
          >
            {saving ? tCommon('states.saving') : tCommon('buttons.save')}
          </button>
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
    </>
  );
}
