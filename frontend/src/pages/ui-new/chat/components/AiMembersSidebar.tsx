import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { Icon } from '@phosphor-icons/react';
import {
  PlusIcon,
  CaretDownIcon,
  UsersThreeIcon,
  UserPlusIcon,
  UserIcon,
  CodeIcon,
  BugBeetleIcon,
  CaretRightIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  PencilSimpleLineIcon,
  ChartBarIcon,
  FolderNotchOpenIcon,
  LightbulbIcon,
  GearIcon,
  RocketIcon,
  PaintBrushIcon,
  MegaphoneIcon,
  FilmStripIcon,
  BookOpenIcon,
  TreeStructureIcon,
  TerminalIcon,
  TrendUpIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import {
  ChatSessionAgentState,
  type ChatMemberPreset,
  type ChatTeamPreset,
  type JsonValue,
} from 'shared/types';
import { cn } from '@/lib/utils';
import { getWorkspacePathExample } from '@/utils/platform';
import {
  extractExecutorProfileVariant,
  withExecutorProfileVariant,
} from '@/utils/executor';
import { PrimaryButton } from '@/components/ui-new/primitives/PrimaryButton';
import { Tooltip } from '@/components/ui-new/primitives/Tooltip';
import { toPrettyCase } from '@/utils/string';
import type { SessionMember } from '../types';
import { agentStateLabels, agentStateDotClass } from '../constants';
import { PromptEditorModal } from './PromptEditorModal';
import {
  AgentBrandIcon,
  getAgentAvatarSeed,
  getAgentAvatarStyle,
} from '../AgentAvatar';
import {
  getLocalizedMemberPresetName,
  getLocalizedTeamPresetName,
  type MemberPresetImportPlan,
} from '../utils';
import { AgentSkillsSection } from './AgentSkillsSection';
import { TeamImportPreviewModal } from './TeamImportPreviewModal';

const truncateByChars = (value: string, maxChars: number): string => {
  const chars = Array.from(value);
  if (chars.length <= maxChars) return value;
  return `${chars.slice(0, maxChars).join('')}...`;
};

/* Map preset IDs to role-appropriate icons */
const presetRoleIcons: Record<string, Icon> = {
  coordinator_pmo: GearIcon,
  product_manager: LightbulbIcon,
  system_architect: TreeStructureIcon,
  prompt_engineer: PencilSimpleLineIcon,
  frontend_engineer: CodeIcon,
  backend_engineer: TerminalIcon,
  fullstack_engineer: CodeIcon,
  qa_tester: BugBeetleIcon,
  ux_ui_designer: PaintBrushIcon,
  safety_policy_officer: ShieldCheckIcon,
  solution_manager: RocketIcon,
  code_reviewer: MagnifyingGlassIcon,
  devops_engineer: GearIcon,
  product_analyst: ChartBarIcon,
  data_analyst: ChartBarIcon,
  technical_writer: BookOpenIcon,
  content_researcher: MagnifyingGlassIcon,
  content_editor: PencilSimpleLineIcon,
  frontier_researcher: LightbulbIcon,
  marketing_specialist: MegaphoneIcon,
  video_editor: FilmStripIcon,
  market_analyst: TrendUpIcon,
};

const teamRoleIcons: Record<string, Icon> = {
  fullstack_delivery_team: RocketIcon,
  ai_prompt_quality_team: PencilSimpleLineIcon,
  architecture_governance_team: TreeStructureIcon,
  product_discovery_team: LightbulbIcon,
  content_studio_team: FilmStripIcon,
  growth_marketing_team: MegaphoneIcon,
  research_innovation_team: MagnifyingGlassIcon,
  rapid_bugfix_team: BugBeetleIcon,
};

function getPresetIcon(presetId: string) {
  return presetRoleIcons[presetId] ?? UserIcon;
}

function getTeamIcon(teamId: string) {
  return teamRoleIcons[teamId] ?? UsersThreeIcon;
}

function MemberNameWithTooltip({ name }: { name: string }) {
  const textRef = useRef<HTMLDivElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const updateTruncation = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    setIsTruncated(el.scrollWidth > el.clientWidth + 1);
  }, []);

  useLayoutEffect(() => {
    updateTruncation();
  }, [name, updateTruncation]);

  useEffect(() => {
    const el = textRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      updateTruncation();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateTruncation]);

  const nameNode = (
    <div
      ref={textRef}
      className="chat-session-member-name text-sm text-normal min-w-0 flex-1"
    >
      @{name}
    </div>
  );

  if (!isTruncated) return nameNode;
  return (
    <Tooltip content={`@${name}`} side="bottom">
      {nameNode}
    </Tooltip>
  );
}

function WorkspacePathWithTooltip({ path }: { path: string }) {
  const textRef = useRef<HTMLDivElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const pathSegments = path
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const condensedSegments =
    pathSegments.length > 4 ? ['...', ...pathSegments.slice(-3)] : pathSegments;

  const updateTruncation = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    setIsTruncated(el.scrollWidth > el.clientWidth + 1);
  }, []);

  useLayoutEffect(() => {
    updateTruncation();
  }, [path, updateTruncation]);

  useEffect(() => {
    const el = textRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      updateTruncation();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateTruncation]);

  const pathNode = (
    <div ref={textRef} className="chat-session-member-workspace" title={path}>
      <FolderNotchOpenIcon className="chat-session-member-workspace-icon" />
      <div className="chat-session-member-workspace-trail">
        {condensedSegments.map((segment, index) => (
          <div
            key={`${segment}-${index}`}
            className="chat-session-member-workspace-segment"
          >
            {index > 0 && (
              <CaretRightIcon className="chat-session-member-workspace-separator" />
            )}
            <span className="truncate">{segment}</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (!isTruncated) return pathNode;

  return (
    <Tooltip content={path} side="bottom">
      <div className="cursor-default">{pathNode}</div>
    </Tooltip>
  );
}

function SidebarEmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: Icon;
  title: string;
  description?: string;
}) {
  return (
    <div className="chat-session-members-empty-state">
      <div className="chat-session-members-empty-state-icon">
        <Icon className="size-5" weight="duotone" />
      </div>
      <div className="chat-session-members-empty-state-title">{title}</div>
      {description ? (
        <div className="chat-session-members-empty-state-description">
          {description}
        </div>
      ) : null}
    </div>
  );
}

function PresetOptionCard({
  icon: Icon,
  title,
  subtitle,
  seed,
  type,
  disabled = false,
  onClick,
}: {
  icon: Icon;
  title: string;
  subtitle: string;
  seed: string;
  type: 'member' | 'team';
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'chat-session-member-preset-card',
        type === 'team' && 'team',
        disabled && 'opacity-60 cursor-not-allowed'
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <span
        className={cn(
          'chat-session-member-preset-avatar',
          type === 'team' && 'team'
        )}
        style={getAgentAvatarStyle(seed)}
      >
        <Icon
          className="chat-session-member-preset-avatar-icon"
          weight="fill"
        />
      </span>

      <span className="min-w-0 flex-1 text-left">
        <span className="chat-session-member-preset-title">{title}</span>
        {subtitle && (
          <span className="chat-session-member-preset-subtitle">{subtitle}</span>
        )}
      </span>

      <span className="chat-session-member-preset-add">
        <PlusIcon className="size-3.5" weight="bold" />
      </span>
    </button>
  );
}

type AddMemberTab = 'preset' | 'custom';

export interface AiMembersSidebarProps {
  sessionMembers: SessionMember[];
  agentStates: Record<string, ChatSessionAgentState>;
  activeSessionId: string | null;
  isArchived: boolean;
  width: number;
  isPanelOpen: boolean;
  onTogglePanel: () => void;
  // Member form
  isAddMemberOpen: boolean;
  editingMember: SessionMember | null;
  newMemberName: string;
  newMemberRunnerType: string;
  newMemberVariant: string;
  newMemberPrompt: string;
  newMemberWorkspace: string;
  newMemberSkillIds: string[];
  memberNameLengthError: string | null;
  onNameChange: (value: string) => void;
  onRunnerTypeChange: (value: string) => void;
  onVariantChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onWorkspaceChange: (value: string) => void;
  onMemberSkillIdsChange: (skillIds: string[]) => void;
  memberError: string | null;
  isSavingMember: boolean;
  // Runner availability
  availableRunnerTypes: string[];
  enabledRunnerTypes: string[];
  isCheckingAvailability: boolean;
  isRunnerAvailable: (runner: string) => boolean;
  availabilityLabel: (runner: string) => string;
  memberVariantOptions: string[];
  getModelName: (runnerType: string, variant?: string) => string | null;
  getModelDisplayName: (
    runnerType: string,
    modelName: string | null
  ) => string | null;
  getVariantLabel: (runnerType: string, variant: string) => string;
  getVariantOptions: (runnerType: string) => string[];
  // Actions
  onOpenAddMember: () => void;
  onCancelMember: () => void;
  onSaveMember: () => void;
  onEditMember: (member: SessionMember) => void;
  onRemoveMember: (member: SessionMember) => void;
  onOpenWorkspace: (agentId: string) => void;
  onExpandPromptEditor: () => void;
  // Preset quick-add
  enabledMemberPresets: ChatMemberPreset[];
  enabledTeamPresets: ChatTeamPreset[];
  onAddMemberPreset: (preset: ChatMemberPreset) => void;
  onImportTeamPreset: (team: ChatTeamPreset) => void;
  teamImportPlan: MemberPresetImportPlan[] | null;
  teamImportName: string | null;
  isImportingTeam: boolean;
  onUpdateTeamImportPlanEntry: (
    index: number,
    updates: {
      finalName?: string;
      workspacePath?: string;
      runnerType?: string;
      systemPrompt?: string;
      toolsEnabled?: JsonValue;
      selectedSkillIds?: string[];
    }
  ) => void;
  onConfirmTeamImport: () => void;
  onCancelTeamImport: () => void;
}

export function AiMembersSidebar({
  sessionMembers,
  agentStates,
  activeSessionId,
  isArchived,
  width,
  isPanelOpen,
  onTogglePanel,
  isAddMemberOpen,
  editingMember,
  newMemberName,
  newMemberRunnerType,
  newMemberVariant,
  newMemberPrompt,
  newMemberWorkspace,
  newMemberSkillIds,
  memberNameLengthError,
  onNameChange,
  onRunnerTypeChange,
  onVariantChange,
  onPromptChange,
  onWorkspaceChange,
  onMemberSkillIdsChange,
  memberError,
  isSavingMember,
  availableRunnerTypes,
  enabledRunnerTypes,
  isCheckingAvailability,
  isRunnerAvailable,
  availabilityLabel,
  memberVariantOptions,
  getModelName,
  getModelDisplayName,
  getVariantLabel,
  getVariantOptions,
  onOpenAddMember,
  onCancelMember,
  onSaveMember,
  onEditMember,
  onRemoveMember,
  onOpenWorkspace,
  onExpandPromptEditor,
  enabledMemberPresets,
  enabledTeamPresets,
  onAddMemberPreset,
  onImportTeamPreset,
  teamImportPlan,
  teamImportName,
  isImportingTeam,
  onUpdateTeamImportPlanEntry,
  onConfirmTeamImport,
  onCancelTeamImport,
}: AiMembersSidebarProps) {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const [activeTab, setActiveTab] = useState<AddMemberTab>('preset');
  const [presetSearchQuery, setPresetSearchQuery] = useState('');
  const [isTeamPresetsExpanded, setIsTeamPresetsExpanded] = useState(true);
  const [importPromptEditorIndex, setImportPromptEditorIndex] = useState<
    number | null
  >(null);
  const workspacePathPlaceholder = getWorkspacePathExample();

  const hasPresets =
    enabledMemberPresets.length > 0 || enabledTeamPresets.length > 0;
  const normalizedPresetSearch = presetSearchQuery.trim().toLowerCase();
  const filteredMemberPresets = enabledMemberPresets.filter((preset) =>
    getLocalizedMemberPresetName(preset, t)
      .toLowerCase()
      .includes(normalizedPresetSearch)
  );
  const filteredTeamPresets = enabledTeamPresets.filter((team) =>
    getLocalizedTeamPresetName(team, t)
      .toLowerCase()
      .includes(normalizedPresetSearch)
  );
  const hasPresetSearchResults =
    filteredMemberPresets.length > 0 || filteredTeamPresets.length > 0;
  const shouldShowExpandedTeams =
    isTeamPresetsExpanded || normalizedPresetSearch.length > 0;

  // When entering edit mode, switch to custom tab
  useEffect(() => {
    if (editingMember) {
      setActiveTab('custom');
    }
  }, [editingMember]);

  useEffect(() => {
    if (importPromptEditorIndex === null) return;
    if (
      !teamImportPlan ||
      importPromptEditorIndex < 0 ||
      importPromptEditorIndex >= teamImportPlan.length
    ) {
      setImportPromptEditorIndex(null);
    }
  }, [teamImportPlan, importPromptEditorIndex]);

  const handleImportPlanVariantChange = useCallback(
    (index: number, variant: string, currentToolsEnabled: JsonValue) => {
      const newToolsEnabled = withExecutorProfileVariant(
        currentToolsEnabled,
        variant === 'DEFAULT' ? null : variant
      );
      onUpdateTeamImportPlanEntry(index, { toolsEnabled: newToolsEnabled });
    },
    [onUpdateTeamImportPlanEntry]
  );

  const getImportPlanVariant = useCallback(
    (toolsEnabled: JsonValue) =>
      extractExecutorProfileVariant(toolsEnabled) ?? 'DEFAULT',
    []
  );

const renderPresetTab = () => (
    <div className="flex flex-col min-h-0 flex-1">
      {!editingMember && (
        <div className="chat-session-member-search shrink-0">
          <MagnifyingGlassIcon className="chat-session-member-search-icon" />
          <input
            value={presetSearchQuery}
            onChange={(event) => setPresetSearchQuery(event.target.value)}
            placeholder={t('members.presetSearchPlaceholder')}
            className="chat-session-member-search-input"
          />
        </div>
      )}

      <div className="space-y-3 pt-3">
        {filteredTeamPresets.length > 0 && (
          <div>
            <div className="chat-session-member-preset-group-row">
              <div className="chat-session-member-preset-group-title">
                <UsersThreeIcon className="size-3.5" />
                <span>{t('members.presetTeamSection')}</span>
              </div>
              <button
                type="button"
                className="chat-session-member-preset-group-toggle"
                onClick={() => setIsTeamPresetsExpanded((expanded) => !expanded)}
                aria-label={
                  isTeamPresetsExpanded
                    ? t('sidebar.collapseSidebar')
                    : t('sidebar.expandSidebar')
                }
                title={
                  isTeamPresetsExpanded
                    ? t('sidebar.collapseSidebar')
                    : t('sidebar.expandSidebar')
                }
              >
                <CaretDownIcon
                  className={cn(
                    'size-3 transition-transform',
                    !isTeamPresetsExpanded && '-rotate-90'
                  )}
                  weight="bold"
                />
              </button>
            </div>
            {shouldShowExpandedTeams && (
              <div className="max-h-[280px] overflow-y-auto pr-1 -mr-1">
                <div className="space-y-1.5">
                  {filteredTeamPresets.map((team) => {
                    const TeamIcon = getTeamIcon(team.id);
                    return (
                      <PresetOptionCard
                        key={team.id}
                        icon={TeamIcon}
                        title={getLocalizedTeamPresetName(team, t)}
                        subtitle=""
                        seed={getAgentAvatarSeed(team.id, 'PRESET_TEAM', team.name)}
                        onClick={() => onImportTeamPreset(team)}
                        disabled={!!teamImportPlan}
                        type="team"
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {filteredMemberPresets.length > 0 && (
          <div>
            <div className="chat-session-member-preset-group-title">
              <UserPlusIcon className="size-3.5" />
              <span>{t('members.presetMemberSection')}</span>
            </div>
            <div className="max-h-[280px] overflow-y-auto pr-1 -mr-1">
              <div className="space-y-1.5">
                {filteredMemberPresets.map((preset) => {
                  const RoleIcon = getPresetIcon(preset.id);
                  return (
                    <PresetOptionCard
                      key={preset.id}
                      icon={RoleIcon}
                      title={getLocalizedMemberPresetName(preset, t)}
                      subtitle=""
                      seed={getAgentAvatarSeed(
                        preset.id,
                        'PRESET_MEMBER',
                        preset.name
                      )}
                      onClick={() => onAddMemberPreset(preset)}
                      type="member"
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {!hasPresets && (
          <SidebarEmptyState
            icon={UserPlusIcon}
            title={t('members.noEnabledPresets')}
          />
        )}

        {hasPresets && !hasPresetSearchResults && (
          <SidebarEmptyState
            icon={MagnifyingGlassIcon}
            title={t('members.noPresetSearchResults')}
            description={t('members.noPresetSearchResultsHint')}
          />
        )}

        {memberError && <div className="text-xs text-error">{memberError}</div>}
      </div>

      {/* Close button at bottom-right */}
      <div className="flex justify-end pt-2 shrink-0">
        <PrimaryButton
          variant="tertiary"
          value={t('members.closePanel')}
          onClick={onCancelMember}
          className="chat-session-member-btn cancel"
        />
      </div>
    </div>
  );

  const renderCustomTab = () => (
    <div className="space-y-half">
      <div className="text-xs text-low">{t('members.memberNameHint')}</div>
      <div className="space-y-half">
        <input
          value={newMemberName}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={t('members.memberNamePlaceholder')}
          className={cn(
            'chat-session-member-field w-full rounded-sm border bg-panel px-base py-half',
            'text-sm text-normal focus:outline-none'
          )}
        />
        {memberNameLengthError && (
          <div className="text-xs text-error">{memberNameLengthError}</div>
        )}
      </div>
      <div className="space-y-half">
        <label className="text-xs text-low">
          {t('members.baseCodingAgent')}
        </label>
        <select
          value={newMemberRunnerType}
          onChange={(event) => onRunnerTypeChange(event.target.value)}
          disabled={isCheckingAvailability || enabledRunnerTypes.length === 0}
          className={cn(
            'chat-session-member-field w-full rounded-sm border bg-panel px-base py-half',
            'text-sm text-normal focus:outline-none'
          )}
        >
          {enabledRunnerTypes.length === 0 && (
            <option value="">
              {isCheckingAvailability
                ? t('members.checkingAgents')
                : t('members.noLocalAgentsDetected')}
            </option>
          )}
          {availableRunnerTypes.map((runner) => (
            <option
              key={runner}
              value={runner}
              disabled={!isRunnerAvailable(runner)}
            >
              {toPrettyCase(runner)}
              {availabilityLabel(runner)}
            </option>
          ))}
        </select>
        {enabledRunnerTypes.length === 0 && !isCheckingAvailability && (
          <div className="text-xs text-error">
            {t('members.noInstalledAgents')}
          </div>
        )}
      </div>
      {memberVariantOptions.length > 0 && (
        <div className="space-y-half">
          <label className="text-xs text-low">
            {t('members.modelVariant')}
          </label>
          <select
            value={newMemberVariant}
            onChange={(event) => onVariantChange(event.target.value)}
            className={cn(
              'chat-session-member-field w-full rounded-sm border bg-panel px-base py-half',
              'text-sm text-normal focus:outline-none'
            )}
          >
            {memberVariantOptions.map((variant) => {
              return (
                <option key={variant} value={variant}>
                  {getVariantLabel(newMemberRunnerType, variant)}
                </option>
              );
            })}
          </select>
          {getModelDisplayName(
            newMemberRunnerType,
            getModelName(newMemberRunnerType, newMemberVariant)
          ) && (
            <div className="text-xs text-low">
              {t('members.model')}:{' '}
              {getModelDisplayName(
                newMemberRunnerType,
                getModelName(newMemberRunnerType, newMemberVariant)
              )}
            </div>
          )}
        </div>
      )}
      <div className="space-y-half">
        <div className="flex items-center justify-between gap-base">
          <label className="text-xs text-low">
            {t('members.systemPrompt')}
          </label>
          <button
            type="button"
            className="chat-session-member-expand-btn text-xs"
            onClick={onExpandPromptEditor}
          >
            {t('members.expand')}
          </button>
        </div>
        <textarea
          value={newMemberPrompt}
          onChange={(event) => onPromptChange(event.target.value)}
          rows={3}
          placeholder={t('members.systemPromptPlaceholder')}
          className={cn(
            'chat-session-member-field w-full resize-none rounded-sm border bg-panel',
            'px-base py-half text-sm text-normal focus:outline-none'
          )}
        />
      </div>
      <div className="space-y-half">
        <label className="text-xs text-low">{t('members.workspacePath')}</label>
        <input
          value={newMemberWorkspace}
          onChange={(event) => onWorkspaceChange(event.target.value)}
          placeholder={workspacePathPlaceholder}
          disabled={!!editingMember}
          title={
            editingMember
              ? t('members.workspacePathCannotBeModified')
              : undefined
          }
          className={cn(
            'chat-session-member-field w-full rounded-sm border bg-panel px-base py-half',
            'text-sm text-normal focus:outline-none',
            editingMember && 'opacity-50 cursor-not-allowed'
          )}
        />
      </div>
      {/* Skills section */}
      <AgentSkillsSection
        agentId={editingMember?.agent.id ?? null}
        runnerType={newMemberRunnerType || null}
        selectedSkillIds={newMemberSkillIds}
        onSelectedSkillIdsChange={onMemberSkillIdsChange}
        readOnly={isArchived || isSavingMember}
      />
      {memberError && <div className="text-xs text-error">{memberError}</div>}
      <div className="flex items-center justify-end gap-2 pt-2">
        <PrimaryButton
          variant="tertiary"
          value={tCommon('buttons.cancel')}
          onClick={onCancelMember}
          disabled={isSavingMember}
          className="chat-session-member-btn cancel"
        />
        <PrimaryButton
          value={editingMember ? t('members.save') : t('members.add')}
          actionIcon={isSavingMember ? 'spinner' : PlusIcon}
          onClick={onSaveMember}
          disabled={isSavingMember || isArchived || !!memberNameLengthError}
          className="chat-session-member-btn chat-session-member-btn-primary"
        />
      </div>
    </div>
  );

  const importPromptEditorValue =
    importPromptEditorIndex !== null &&
    teamImportPlan?.[importPromptEditorIndex]
      ? teamImportPlan[importPromptEditorIndex].systemPrompt
      : '';

  return (
    <>
      <aside
        className="chat-session-members-panel flex flex-col min-h-0 shrink-0"
        style={{ width }}
      >
        <div className="chat-session-members-header px-base py-base flex items-center justify-between">
          <div className="chat-session-members-title text-sm text-normal font-medium">
            {t('members.title')}
          </div>
          <button
            type="button"
            className={cn(
              'chat-session-header-member-toggle chat-session-members-header-toggle',
              isPanelOpen && 'active'
            )}
            onClick={onTogglePanel}
            aria-label={
              isPanelOpen
                ? t('header.closeMembersPanel')
                : t('header.openMembersPanel')
            }
            title={
              isPanelOpen
                ? t('header.closeMembersPanel')
                : t('header.openMembersPanel')
            }
          >
            <UsersThreeIcon className="size-icon-xs" />
            <span>
              {sessionMembers.length} {t('header.aiMembers')}
            </span>
          </button>
        </div>
        <div className="chat-session-members-list flex-1 min-h-0 overflow-y-auto px-base pb-base pt-half space-y-base">
          {!activeSessionId && (
            <SidebarEmptyState
              icon={UsersThreeIcon}
              title={t('members.selectSessionToManage')}
            />
          )}
          {activeSessionId && sessionMembers.length === 0 && (
            <SidebarEmptyState
              icon={UserPlusIcon}
              title={t('members.noMembersYet')}
            />
          )}

          {sessionMembers.map(({ agent, sessionAgent }) => {
            const state = agentStates[agent.id] ?? ChatSessionAgentState.idle;
            const memberVariant =
              extractExecutorProfileVariant(agent.tools_enabled) ?? undefined;
            const modelName = getModelName(agent.runner_type, memberVariant);
            const modelDisplayName = getModelDisplayName(
              agent.runner_type,
              modelName
            );
            const fullText = `${toPrettyCase(agent.runner_type)} | ${agentStateLabels[state]}${modelDisplayName ? ` | ${modelDisplayName}` : ''}`;
            const modelStatusPreview = truncateByChars(fullText, 15);
            const avatarSeed = getAgentAvatarSeed(
              agent.id,
              agent.runner_type,
              agent.name
            );
            const workspacePath = sessionAgent.workspace_path ?? '';

            return (
              <div
                key={sessionAgent.id}
                className="chat-session-member-card rounded-sm px-base py-half space-y-half"
              >
                <div className="chat-session-member-header">
                  <div className="chat-session-member-primary flex items-center gap-half min-w-0">
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        agentStateDotClass[state],
                        state === ChatSessionAgentState.running &&
                          'chat-session-status-breathe'
                      )}
                    />
                    <span
                      className="chat-session-member-avatar"
                      style={getAgentAvatarStyle(avatarSeed)}
                    >
                      <AgentBrandIcon
                        runnerType={agent.runner_type}
                        className="chat-session-member-avatar-logo"
                      />
                    </span>
                    <MemberNameWithTooltip name={agent.name} />
                  </div>
                  <div className="chat-session-member-actions flex items-center gap-half text-xs">
                    <button
                      type="button"
                      className="chat-session-member-action workspace"
                      onClick={() => onOpenWorkspace(agent.id)}
                    >
                      {t('members.workspace')}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'chat-session-member-action edit',
                        isArchived && 'pointer-events-none opacity-50'
                      )}
                      onClick={() => onEditMember({ agent, sessionAgent })}
                      disabled={isArchived}
                    >
                      {t('members.edit')}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'chat-session-member-action danger',
                        isArchived && 'pointer-events-none opacity-50'
                      )}
                      onClick={() => onRemoveMember({ agent, sessionAgent })}
                      disabled={isArchived}
                    >
                      {t('members.remove')}
                    </button>
                  </div>
                </div>
                <Tooltip content={fullText} side="bottom">
                  <div className="chat-session-member-model text-xs text-low cursor-default">
                    <div className="chat-session-member-model-full">
                      {fullText}
                    </div>
                    <div className="chat-session-member-model-truncated">
                      {modelStatusPreview}
                    </div>
                  </div>
                </Tooltip>
                {workspacePath && (
                  <div className="chat-session-member-workspace-row">
                    <WorkspacePathWithTooltip path={workspacePath} />
                  </div>
                )}
              </div>
            );
          })}

          {/* Add Member Section */}
          <div className="chat-session-member-form pt-base space-y-half">
            {!isAddMemberOpen ? (
              <button
                type="button"
                className="chat-session-add-member-btn"
                onClick={onOpenAddMember}
                disabled={!activeSessionId || isArchived}
              >
                {t('members.addAiMember')}
                <PlusIcon className="size-icon-xs" weight="light" />
              </button>
            ) : (
              <div className="chat-session-member-form-panel rounded-sm p-base space-y-half">
                {/* Tab bar - only show when not editing */}
                {!editingMember && (
                  <div className="chat-session-member-form-tabs flex gap-1 rounded-xl p-1">
                    <button
                      type="button"
                      className={cn(
                        'chat-session-member-form-tab flex-1 text-xs py-2 text-center rounded-lg transition-all',
                        activeTab === 'preset'
                          ? 'is-active text-white font-semibold'
                          : 'text-low hover:text-normal'
                      )}
                      onClick={() => setActiveTab('preset')}
                    >
                      {t('members.tabPreset')}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'chat-session-member-form-tab flex-1 text-xs py-2 text-center rounded-lg transition-all',
                        activeTab === 'custom'
                          ? 'is-active text-white font-semibold'
                          : 'text-low hover:text-normal'
                      )}
                      onClick={() => setActiveTab('custom')}
                    >
                      {t('members.tabCustom')}
                    </button>
                  </div>
                )}

                {/* Edit mode header */}
                {editingMember && (
                  <div className="text-sm text-normal font-medium">
                    {t('members.editAiMember')}
                  </div>
                )}

                {/* Tab content */}
                <div className="pt-half">
                  {activeTab === 'preset' && !editingMember
                    ? renderPresetTab()
                    : renderCustomTab()}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
      <PromptEditorModal
        isOpen={importPromptEditorIndex !== null}
        value={importPromptEditorValue}
        onChange={(value) => {
          if (importPromptEditorIndex === null) return;
          onUpdateTeamImportPlanEntry(importPromptEditorIndex, {
            systemPrompt: value,
          });
        }}
        onClose={() => setImportPromptEditorIndex(null)}
        showFileImport={false}
      />
      <TeamImportPreviewModal
        isOpen={Boolean(teamImportPlan)}
        importName={teamImportName}
        importPlan={teamImportPlan}
        isArchived={isArchived}
        isImportingTeam={isImportingTeam}
        isCheckingAvailability={isCheckingAvailability}
        enabledRunnerTypes={enabledRunnerTypes}
        availableRunnerTypes={availableRunnerTypes}
        isRunnerAvailable={isRunnerAvailable}
        availabilityLabel={availabilityLabel}
        workspacePathPlaceholder={workspacePathPlaceholder}
        getVariantOptions={getVariantOptions}
        getVariantLabel={getVariantLabel}
        getPlanVariant={getImportPlanVariant}
        onVariantChange={handleImportPlanVariantChange}
        onUpdatePlanEntry={onUpdateTeamImportPlanEntry}
        onExpandPromptEditor={setImportPromptEditorIndex}
        onConfirm={onConfirmTeamImport}
        onCancel={onCancelTeamImport}
      />
    </>
  );
}
