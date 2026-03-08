import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UIEvent } from 'react';
import {
  ArrowClockwiseIcon,
  DownloadIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { BaseCodingAgent } from 'shared/types';
import type {
  ChatAgent,
  ChatAgentSkill,
  ChatSkill,
  RemoteSkillMeta,
  RemoteSkillPackage,
  UpdateChatSkill,
} from 'shared/types';
import { chatApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { SkillDetailModal } from './SkillDetailModal';
import { filterSkillsByRunner } from '../skillCompatibility';

type MarketSource = 'registry' | 'builtin';

type MarketSkill = RemoteSkillMeta & {
  source: MarketSource;
};

type DetailTarget =
  | { kind: 'installed'; skill: ChatSkill }
  | { kind: 'market'; skill: MarketSkill };

type DetailData = {
  name: string;
  description: string;
  content: string;
  sourceUrl: string | null;
  installedSkillId: string | null;
  enabled: boolean | null;
};

type RunnerOption = {
  key: string;
  label: string;
  representativeAgentId: string;
  count: number;
};

interface SkillsPanelProps {
  isOpen: boolean;
  leftOffset: number;
  allAgents: ChatAgent[];
  onClose: () => void;
}

const iconPalette = [
  'bg-sky-100 text-sky-600',
  'bg-emerald-100 text-emerald-600',
  'bg-amber-100 text-amber-600',
  'bg-violet-100 text-violet-600',
  'bg-rose-100 text-rose-600',
  'bg-cyan-100 text-cyan-600',
];
const supportedRunnerTypeSet = new Set<string>(Object.values(BaseCodingAgent));
const marketRenderBatchSize = 120;
const marketLoadMoreThresholdPx = 240;

function normalizeSourceUrl(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function inferSkillNameFromPath(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/').replace(/\/+$/g, '');
  const segment = normalizedPath.split('/').pop()?.trim();
  if (!segment) return `local-skill-${Date.now()}`;
  return segment;
}

function getSkillSearchText(
  name: string,
  description: string,
  tags: string[]
): string {
  return [name, description, ...tags].join(' ').toLowerCase();
}

function formatDownloadCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

function toRunnerLabel(runnerType: string): string {
  return runnerType
    .toLowerCase()
    .split(/[_\s-]+/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function buildSkillEnabledPayload(enabled: boolean): UpdateChatSkill {
  return {
    name: null,
    description: null,
    content: null,
    trigger_type: null,
    trigger_keywords: null,
    enabled,
    source: null,
    source_url: null,
    version: null,
    author: null,
    tags: null,
    category: null,
    compatible_agents: null,
  };
}

function ToggleSwitch({
  checked,
  disabled,
  onClick,
}: {
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border appearance-none transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4338CA]/40',
        checked
          ? 'bg-[#A8C9FF] border-[#A8C9FF]'
          : 'bg-[#e5e5e8] border-[#e5e5e8]'
      )}
    >
      <span
        className={cn(
          'absolute top-[0.5px] size-4 rounded-full border border-white/70 shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-all duration-200',
          checked
            ? 'left-[18px] bg-white border-white'
            : 'left-0.5 bg-[#f3f3f5]'
        )}
      />
    </button>
  );
}

function SkillTileIcon({
  name,
  bordered = true,
  compact = false,
}: {
  name: string;
  bordered?: boolean;
  compact?: boolean;
}) {
  const code = name.charCodeAt(0) || 0;
  const colorClass = iconPalette[Math.abs(code) % iconPalette.length];
  const letter = name.trim().charAt(0).toUpperCase() || 'S';

  return (
    <div
      className={cn(
        compact
          ? 'size-8 shrink-0 rounded-lg flex items-center justify-center text-xs font-semibold'
          : 'size-9 shrink-0 rounded-lg flex items-center justify-center text-sm font-semibold',
        bordered && 'border border-white/60',
        colorClass
      )}
    >
      {letter}
    </div>
  );
}

export function SkillsPanel({
  isOpen,
  leftOffset,
  allAgents,
  onClose,
}: SkillsPanelProps) {
  const [installedSkills, setInstalledSkills] = useState<ChatSkill[]>([]);
  const [marketSkills, setMarketSkills] = useState<MarketSkill[]>([]);
  const [agentAssignments, setAgentAssignments] = useState<ChatAgentSkill[]>(
    []
  );
  const [availableAgents, setAvailableAgents] = useState<ChatAgent[]>([]);

  const [selectedRunnerKey, setSelectedRunnerKey] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [isLoadingInstalled, setIsLoadingInstalled] = useState(false);
  const [isLoadingMarket, setIsLoadingMarket] = useState(false);
  const [isSyncingSkillId, setIsSyncingSkillId] = useState<string | null>(null);
  const [isInstallingMarketSkillKey, setIsInstallingMarketSkillKey] = useState<
    string | null
  >(null);

  const [installedError, setInstalledError] = useState<string | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);

  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [detailData, setDetailData] = useState<DetailData | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isTryingSkill, setIsTryingSkill] = useState(false);
  const [isTogglingSkill, setIsTogglingSkill] = useState(false);
  const [isDeletingSkill, setIsDeletingSkill] = useState(false);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [customSkillPath, setCustomSkillPath] = useState('');
  const [customSkillAgentId, setCustomSkillAgentId] = useState('');
  const [isCreatingSkill, setIsCreatingSkill] = useState(false);
  const [marketInstallTarget, setMarketInstallTarget] =
    useState<MarketSkill | null>(null);
  const [marketInstallAgentId, setMarketInstallAgentId] = useState('');
  const [marketVisibleCount, setMarketVisibleCount] = useState(
    marketRenderBatchSize
  );

  const runnerOptions = useMemo<RunnerOption[]>(() => {
    const map = new Map<string, RunnerOption>();
    const sourceAgents =
      availableAgents.length > 0 ? availableAgents : allAgents;
    for (const agent of sourceAgents) {
      const key = agent.runner_type.trim().toUpperCase();
      if (!key || !supportedRunnerTypeSet.has(key)) continue;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, {
          key,
          label: toRunnerLabel(key),
          representativeAgentId: agent.id,
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [allAgents, availableAgents]);

  const selectedRunnerOption = useMemo(
    () =>
      runnerOptions.find((option) => option.key === selectedRunnerKey) ?? null,
    [runnerOptions, selectedRunnerKey]
  );

  const selectedAgentId = selectedRunnerOption?.representativeAgentId ?? '';

  const assignedSkillIds = useMemo(
    () => new Set(agentAssignments.map((assignment) => assignment.skill_id)),
    [agentAssignments]
  );

  const assignmentBySkillId = useMemo(
    () =>
      new Map(
        agentAssignments.map((assignment) => [assignment.skill_id, assignment])
      ),
    [agentAssignments]
  );

  const loadInstalledSkills = useCallback(async () => {
    setIsLoadingInstalled(true);
    setInstalledError(null);
    try {
      const skills = await chatApi.listSkills();
      setInstalledSkills(skills);
    } catch (error) {
      console.error('Failed to load installed skills', error);
      setInstalledError('加载已安装技能失败。');
    } finally {
      setIsLoadingInstalled(false);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    try {
      const agents = await chatApi.listAgents();
      setAvailableAgents(agents);
    } catch (error) {
      console.error('Failed to load agents for skills panel', error);
      setAvailableAgents([]);
    }
  }, []);

  const loadMarketSkills = useCallback(async () => {
    setIsLoadingMarket(true);
    setMarketError(null);
    try {
      const skills = await chatApi.listRegistrySkills();
      setMarketSkills(
        skills.map((skill) => ({ ...skill, source: 'registry' }))
      );
    } catch (registryError) {
      try {
        const skills = await chatApi.listBuiltinSkills();
        setMarketSkills(
          skills.map((skill) => ({ ...skill, source: 'builtin' }))
        );
      } catch (builtinError) {
        console.error(
          'Failed to load skill marketplace',
          registryError,
          builtinError
        );
        setMarketError('加载技能市场失败。');
      }
    } finally {
      setIsLoadingMarket(false);
    }
  }, []);

  const loadAgentAssignments = useCallback(async (agentId: string) => {
    try {
      const assignments = await chatApi.listAgentSkills(agentId);
      setAgentAssignments(assignments);
    } catch (error) {
      console.error('Failed to load agent skills', error);
      setInstalledError('加载 agent 技能分配失败。');
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadInstalledSkills(), loadMarketSkills()]);
  }, [loadInstalledSkills, loadMarketSkills]);

  useEffect(() => {
    if (!isOpen) return;
    void Promise.all([refreshAll(), loadAgents()]);
  }, [isOpen, loadAgents, refreshAll]);

  useEffect(() => {
    if (!isOpen) return;
    if (runnerOptions.length === 0) {
      setSelectedRunnerKey('');
      return;
    }
    const hasSelected = runnerOptions.some(
      (option) => option.key === selectedRunnerKey
    );
    if (!selectedRunnerKey || !hasSelected) {
      setSelectedRunnerKey(runnerOptions[0].key);
    }
  }, [isOpen, runnerOptions, selectedRunnerKey]);

  useEffect(() => {
    if (!isOpen) return;
    if (!selectedAgentId) {
      setAgentAssignments([]);
      return;
    }
    void loadAgentAssignments(selectedAgentId);
  }, [isOpen, loadAgentAssignments, selectedAgentId]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (detailTarget) {
        setDetailTarget(null);
        setDetailData(null);
        setDetailError(null);
        return;
      }
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [detailTarget, isOpen, onClose]);

  const installedBySourceUrl = useMemo(
    () =>
      new Set(
        installedSkills
          .map((skill) => normalizeSourceUrl(skill.source_url))
          .filter(Boolean)
      ),
    [installedSkills]
  );

  const installedByName = useMemo(
    () =>
      new Set(installedSkills.map((skill) => skill.name.trim().toLowerCase())),
    [installedSkills]
  );

  const findInstalledSkillByMeta = useCallback(
    (meta: MarketSkill): ChatSkill | null => {
      const normalizedSource = normalizeSourceUrl(meta.source_url);
      return (
        installedSkills.find(
          (skill) =>
            normalizeSourceUrl(skill.source_url) === normalizedSource &&
            normalizedSource.length > 0
        ) ??
        installedSkills.find(
          (skill) =>
            skill.name.trim().toLowerCase() === meta.name.trim().toLowerCase()
        ) ??
        null
      );
    },
    [installedSkills]
  );
  const isMarketSkillInstalled = useCallback(
    (meta: MarketSkill): boolean => {
      const normalizedSource = normalizeSourceUrl(meta.source_url);
      if (normalizedSource && installedBySourceUrl.has(normalizedSource))
        return true;
      return installedByName.has(meta.name.trim().toLowerCase());
    },
    [installedByName, installedBySourceUrl]
  );

  const searchLower = searchQuery.trim().toLowerCase();

  const displayedInstalledSkills = useMemo(() => {
    if (!selectedRunnerKey) return installedSkills;
    return filterSkillsByRunner(installedSkills, selectedRunnerKey);
  }, [installedSkills, selectedRunnerKey]);

  const displayedMarketSkills = useMemo(() => {
    return marketSkills.filter((skill) => {
      if (isMarketSkillInstalled(skill)) return false;
      if (!searchLower) return true;
      return getSkillSearchText(
        skill.name,
        skill.description,
        skill.tags
      ).includes(searchLower);
    });
  }, [isMarketSkillInstalled, marketSkills, searchLower]);

  const visibleMarketSkills = useMemo(
    () => displayedMarketSkills.slice(0, marketVisibleCount),
    [displayedMarketSkills, marketVisibleCount]
  );

  useEffect(() => {
    if (!isOpen) return;
    setMarketVisibleCount(marketRenderBatchSize);
  }, [isOpen, searchLower]);

  const handleMarketListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (isLoadingMarket) return;

      const target = event.currentTarget;
      const distanceToBottom =
        target.scrollHeight - target.scrollTop - target.clientHeight;
      if (distanceToBottom > marketLoadMoreThresholdPx) return;

      setMarketVisibleCount((prev) => {
        if (prev >= displayedMarketSkills.length) return prev;
        return Math.min(
          prev + marketRenderBatchSize,
          displayedMarketSkills.length
        );
      });
    },
    [displayedMarketSkills.length, isLoadingMarket]
  );

  const handleToggleAgentSkill = useCallback(
    async (skillId: string) => {
      if (!selectedAgentId) return;

      setIsSyncingSkillId(skillId);
      setInstalledError(null);
      try {
        const assignment = assignmentBySkillId.get(skillId);
        if (assignment) {
          await chatApi.unassignSkillFromAgent(selectedAgentId, assignment.id);
        } else {
          await chatApi.assignSkillToAgent({
            agent_id: selectedAgentId,
            skill_id: skillId,
            enabled: true,
          });
        }
        await loadAgentAssignments(selectedAgentId);
      } catch (error) {
        console.error('Failed to update agent skill', error);
        setInstalledError('更新 agent 技能失败。');
      } finally {
        setIsSyncingSkillId(null);
      }
    },
    [assignmentBySkillId, loadAgentAssignments, selectedAgentId]
  );

  const openDetail = useCallback((target: DetailTarget) => {
    setDetailTarget(target);
    setDetailData(null);
    setDetailError(null);
  }, []);

  useEffect(() => {
    if (!detailTarget) return;

    const loadDetail = async () => {
      setIsLoadingDetail(true);
      setDetailError(null);
      try {
        if (detailTarget.kind === 'installed') {
          const detail = await chatApi
            .getSkill(detailTarget.skill.id)
            .catch(() => detailTarget.skill);

          setDetailData({
            name: detail.name,
            description: detail.description ?? '',
            content: detail.content,
            sourceUrl: detail.source_url,
            installedSkillId: detail.id,
            enabled: detail.enabled,
          });
          return;
        }

        const meta = detailTarget.skill;
        const pkg: RemoteSkillPackage =
          meta.source === 'builtin'
            ? await chatApi.getBuiltinSkill(meta.id)
            : await chatApi.getRegistrySkill(meta.id);
        const installed = findInstalledSkillByMeta(meta);

        setDetailData({
          name: pkg.name,
          description: pkg.description,
          content: pkg.content,
          sourceUrl: pkg.source_url,
          installedSkillId: installed?.id ?? null,
          enabled: installed?.enabled ?? null,
        });
      } catch (error) {
        console.error('Failed to load skill detail', error);
        setDetailError('加载技能详情失败。');
      } finally {
        setIsLoadingDetail(false);
      }
    };

    void loadDetail();
  }, [detailTarget, findInstalledSkillByMeta]);

  const closeDetail = useCallback(() => {
    setDetailTarget(null);
    setDetailData(null);
    setDetailError(null);
  }, []);

  const handleEnableSkill = useCallback(async () => {
    if (!detailData?.installedSkillId) return;

    setIsTryingSkill(true);
    setDetailError(null);
    try {
      if (selectedAgentId) {
        if (!assignedSkillIds.has(detailData.installedSkillId)) {
          await chatApi.assignSkillToAgent({
            agent_id: selectedAgentId,
            skill_id: detailData.installedSkillId,
            enabled: true,
          });
          await loadAgentAssignments(selectedAgentId);
        }
      }

      closeDetail();
    } catch (error) {
      console.error('Failed to enable skill', error);
      setDetailError('启用技能失败。');
    } finally {
      setIsTryingSkill(false);
    }
  }, [
    assignedSkillIds,
    closeDetail,
    detailData,
    loadAgentAssignments,
    selectedAgentId,
  ]);
  const handleToggleSkillEnabled = useCallback(async () => {
    if (!detailData?.installedSkillId || detailData.enabled === null) return;

    setIsTogglingSkill(true);
    setDetailError(null);
    const nextEnabled = !detailData.enabled;

    try {
      await chatApi.updateSkill(
        detailData.installedSkillId,
        buildSkillEnabledPayload(nextEnabled)
      );
      setDetailData((prev) =>
        prev ? { ...prev, enabled: nextEnabled } : prev
      );
      await loadInstalledSkills();
    } catch (error) {
      console.error('Failed to toggle skill enabled', error);
      setDetailError('更新技能状态失败。');
    } finally {
      setIsTogglingSkill(false);
    }
  }, [detailData, loadInstalledSkills]);

  const handleDeleteSkill = useCallback(async () => {
    if (!detailData?.installedSkillId) return;

    setIsDeletingSkill(true);
    setDetailError(null);
    try {
      await chatApi.deleteSkill(detailData.installedSkillId);
      await Promise.all([
        loadInstalledSkills(),
        selectedAgentId
          ? loadAgentAssignments(selectedAgentId)
          : Promise.resolve(),
      ]);
      closeDetail();
    } catch (error) {
      console.error('Failed to delete skill', error);
      setDetailError('卸载技能失败。');
    } finally {
      setIsDeletingSkill(false);
    }
  }, [
    closeDetail,
    detailData,
    loadAgentAssignments,
    loadInstalledSkills,
    selectedAgentId,
  ]);

  const handleCreateSkillFromPath = useCallback(async () => {
    const path = customSkillPath.trim();
    if (!path) return;

    setIsCreatingSkill(true);
    setInstalledError(null);
    try {
      const createdSkill = await chatApi.createSkill({
        name: inferSkillNameFromPath(path),
        description: `Imported from local path: ${path}`,
        content: `Use skill files from path:\n${path}`,
        trigger_type: 'manual',
        trigger_keywords: null,
        enabled: true,
        source: 'local_path',
        source_url: path,
        version: null,
        author: null,
        tags: ['local'],
        category: null,
        compatible_agents: null,
      });

      if (customSkillAgentId) {
        await chatApi.assignSkillToAgent({
          agent_id: customSkillAgentId,
          skill_id: createdSkill.id,
          enabled: true,
        });
      }

      await Promise.all([
        loadInstalledSkills(),
        customSkillAgentId
          ? loadAgentAssignments(customSkillAgentId)
          : Promise.resolve(),
      ]);

      setIsCreateModalOpen(false);
      setCustomSkillPath('');
      setCustomSkillAgentId('');
    } catch (error) {
      console.error('Failed to create skill from path', error);
      setInstalledError('创建技能失败。');
    } finally {
      setIsCreatingSkill(false);
    }
  }, [
    customSkillAgentId,
    customSkillPath,
    loadAgentAssignments,
    loadInstalledSkills,
  ]);

  const handleInstallMarketSkill = useCallback(
    async (skill: MarketSkill, targetAgentId: string) => {
      const marketKey = `${skill.source}:${skill.id}`;
      setIsInstallingMarketSkillKey(marketKey);
      setMarketError(null);

      try {
        let installed = findInstalledSkillByMeta(skill);
        if (!installed) {
          installed =
            skill.source === 'builtin'
              ? await chatApi.installBuiltinSkill(skill.id)
              : await chatApi.installRegistrySkill(skill.id);
        }

        if (targetAgentId) {
          const existingAssignments =
            await chatApi.listAgentSkills(targetAgentId);
          const assignedIds = new Set(
            existingAssignments.map((item) => item.skill_id)
          );
          if (!assignedIds.has(installed.id)) {
            await chatApi.assignSkillToAgent({
              agent_id: targetAgentId,
              skill_id: installed.id,
              enabled: true,
            });
          }
        }

        await Promise.all([
          loadInstalledSkills(),
          loadMarketSkills(),
          selectedAgentId
            ? loadAgentAssignments(selectedAgentId)
            : Promise.resolve(),
        ]);
      } catch (error) {
        console.error('Failed to install market skill', error);
        setMarketError('安装技能失败。');
      } finally {
        setIsInstallingMarketSkillKey(null);
      }
    },
    [
      findInstalledSkillByMeta,
      loadAgentAssignments,
      loadInstalledSkills,
      loadMarketSkills,
      selectedAgentId,
    ]
  );

  const openInstallAgentDialog = useCallback(
    (skill: MarketSkill) => {
      setMarketInstallTarget(skill);
      setMarketInstallAgentId(
        selectedAgentId || runnerOptions[0]?.representativeAgentId || ''
      );
    },
    [runnerOptions, selectedAgentId]
  );

  const closeInstallAgentDialog = useCallback(() => {
    setMarketInstallTarget(null);
    setMarketInstallAgentId('');
  }, []);

  const handleInstallFromDetail = useCallback(() => {
    if (!detailTarget || detailTarget.kind !== 'market') return;
    const marketSkill = detailTarget.skill;
    closeDetail();
    openInstallAgentDialog(marketSkill);
  }, [closeDetail, detailTarget, openInstallAgentDialog]);

  const handleConfirmInstallWithAgent = useCallback(async () => {
    if (!marketInstallTarget || !marketInstallAgentId) return;
    await handleInstallMarketSkill(marketInstallTarget, marketInstallAgentId);
    closeInstallAgentDialog();
  }, [
    closeInstallAgentDialog,
    handleInstallMarketSkill,
    marketInstallAgentId,
    marketInstallTarget,
  ]);

  const isDetailInstallAction =
    detailTarget?.kind === 'market' && !detailData?.installedSkillId;
  const detailPrimaryAction = detailTarget
    ? {
        label: isDetailInstallAction
          ? '安装'
          : isTryingSkill
            ? '处理中'
            : '启用',
        onClick: () => {
          if (isDetailInstallAction) {
            handleInstallFromDetail();
            return;
          }
          void handleEnableSkill();
        },
        disabled: isLoadingDetail || (!isDetailInstallAction && isTryingSkill),
        icon: isDetailInstallAction ? (
          <DownloadIcon size={16} weight="bold" />
        ) : null,
      }
    : null;

  if (!isOpen) return null;

  return (
    <div
      className="absolute inset-y-0 right-0 z-40 bg-[var(--chat-session-bg-primary,#ffffff)]"
      style={{ left: `${leftOffset}px` }}
    >
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1220px] px-6 py-8 lg:px-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-[52px] leading-[1.05] font-semibold tracking-tight text-normal">
                技能
              </h2>
              <p className="mt-3 text-base text-low">
                赋予 Codex 更强大的能力。
              </p>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => void refreshAll()}
                className="inline-flex h-9 items-center gap-1 rounded-lg px-1 text-sm text-low hover:text-normal"
              >
                <ArrowClockwiseIcon size={15} />
                {isLoadingInstalled || isLoadingMarket ? '刷新中' : '刷新'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setCustomSkillPath('');
                  setCustomSkillAgentId(
                    selectedAgentId ||
                      runnerOptions[0]?.representativeAgentId ||
                      ''
                  );
                  setIsCreateModalOpen(true);
                }}
                className="inline-flex h-10 items-center gap-1 rounded-xl bg-black px-4 text-sm font-semibold text-white hover:bg-black/85"
              >
                <PlusIcon size={14} />
                新技能
              </button>
            </div>
          </div>

          <section className="mt-10">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-2xl font-semibold text-normal">已安装</h3>
              <select
                value={selectedRunnerKey}
                onChange={(event) => setSelectedRunnerKey(event.target.value)}
                className={cn(
                  'chat-session-member-field min-w-[260px] rounded-xl border bg-panel px-3 py-1.5',
                  'text-xs text-normal focus:outline-none'
                )}
              >
                {runnerOptions.length === 0 && (
                  <option value="">暂无 Agent</option>
                )}
                {runnerOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {isLoadingInstalled && (
                <div className="col-span-full text-sm text-low py-4">
                  加载中...
                </div>
              )}

              {!isLoadingInstalled && displayedInstalledSkills.length === 0 && (
                <div className="col-span-full rounded-2xl border border-border bg-secondary/30 px-4 py-6 text-sm text-low">
                  没有已安装技能。
                </div>
              )}

              {!isLoadingInstalled &&
                displayedInstalledSkills.map((skill) => {
                  const assigned = assignedSkillIds.has(skill.id);
                  const isSyncing = isSyncingSkillId === skill.id;
                  const disabled = !selectedAgentId || isSyncing;

                  return (
                    <div
                      key={skill.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openDetail({ kind: 'installed', skill })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openDetail({ kind: 'installed', skill });
                        }
                      }}
                      className="rounded-2xl border border-border/80 bg-[var(--chat-session-bg-primary,#ffffff)] px-3 py-2 cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <SkillTileIcon name={skill.name} compact />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base font-medium text-normal">
                            {skill.name}
                          </div>
                          <p className="truncate text-xs text-low">
                            {skill.description || '暂无描述'}
                          </p>
                        </div>
                        <div onClick={(event) => event.stopPropagation()}>
                          <ToggleSwitch
                            checked={assigned}
                            disabled={disabled}
                            onClick={() =>
                              void handleToggleAgentSkill(skill.id)
                            }
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
          <section className="mt-12 pb-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-2xl font-semibold text-normal">市场</h3>
              <div className="relative">
                <MagnifyingGlassIcon
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-low"
                />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="搜索技能"
                  className="h-10 w-[260px] rounded-xl border border-border bg-secondary/40 pl-9 pr-3 text-sm text-normal focus:outline-none"
                />
              </div>
            </div>

            <div
              className="max-h-[60vh] overflow-y-auto pr-1"
              onScroll={handleMarketListScroll}
            >
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {isLoadingMarket && (
                  <div className="col-span-full text-sm text-low py-4">
                    加载中...
                  </div>
                )}

                {!isLoadingMarket && displayedMarketSkills.length === 0 && (
                  <div className="col-span-full rounded-2xl border border-border bg-secondary/30 px-4 py-6 text-sm text-low">
                    暂无可推荐技能。
                  </div>
                )}

                {!isLoadingMarket &&
                  visibleMarketSkills.map((skill) => {
                    const marketKey = `${skill.source}:${skill.id}`;
                    const isInstalling =
                      isInstallingMarketSkillKey === marketKey;

                    return (
                      <div
                        key={marketKey}
                        role="button"
                        tabIndex={0}
                        onClick={() => openDetail({ kind: 'market', skill })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openDetail({ kind: 'market', skill });
                          }
                        }}
                        className="rounded-2xl border border-border/80 bg-[var(--chat-session-bg-primary,#ffffff)] px-3 py-2 cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5">
                          <SkillTileIcon name={skill.name} compact />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-base font-medium text-normal">
                                {skill.name}
                              </span>
                              {skill.download_count != null && skill.download_count > 0 && (
                                <span className="shrink-0 text-[10px] text-low flex items-center gap-0.5">
                                  <DownloadIcon size={10} />
                                  {formatDownloadCount(skill.download_count)}
                                </span>
                              )}
                            </div>
                            <p className="truncate text-xs text-low">
                              {skill.description || '暂无描述'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openInstallAgentDialog(skill);
                            }}
                            disabled={isInstalling}
                            className={cn(
                              'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-low transition-colors',
                              isInstalling
                                ? 'opacity-50 cursor-not-allowed'
                                : 'hover:bg-secondary/70 hover:text-normal'
                            )}
                            aria-label={isInstalling ? '安装中' : '安装技能'}
                          >
                            <DownloadIcon size={18} weight="bold" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>

              {!isLoadingMarket &&
                displayedMarketSkills.length > visibleMarketSkills.length && (
                  <div className="py-3 text-center text-xs text-low">
                    向下滚动加载更多...
                  </div>
                )}
            </div>
          </section>

          {(installedError || marketError) && (
            <div className="mt-2 text-sm text-error">
              {installedError ?? marketError}
            </div>
          )}
        </div>
      </div>

      <SkillDetailModal
        isOpen={Boolean(detailTarget)}
        name={detailData?.name ?? detailTarget?.skill.name ?? ''}
        description={detailData?.description}
        content={detailData?.content}
        sourceUrl={detailData?.sourceUrl}
        isLoading={isLoadingDetail}
        error={detailError}
        onClose={closeDetail}
        footerLeading={
          <>
            {detailData?.installedSkillId && (
              <button
                type="button"
                onClick={() => void handleDeleteSkill()}
                disabled={isDeletingSkill}
                className={cn(
                  'inline-flex h-10 items-center gap-1 rounded-2xl bg-[#fff1eb] px-4 text-sm !text-[#ff7f50]',
                  isDeletingSkill && 'cursor-not-allowed opacity-60'
                )}
                style={{ color: '#ff7f50' }}
              >
                <TrashIcon size={16} />
                {isDeletingSkill ? '卸载中' : '卸载'}
              </button>
            )}

            {detailData?.installedSkillId && detailData.enabled !== null && (
              <button
                type="button"
                onClick={() => void handleToggleSkillEnabled()}
                disabled={isTogglingSkill}
                className={cn(
                  'inline-flex h-10 items-center rounded-2xl bg-[#ebebef] px-4 text-sm text-normal',
                  isTogglingSkill && 'cursor-not-allowed opacity-60'
                )}
              >
                {isTogglingSkill
                  ? '更新中'
                  : detailData.enabled
                    ? '禁用'
                    : '启用'}
              </button>
            )}
          </>
        }
        primaryAction={detailPrimaryAction ?? undefined}
      />

      {marketInstallTarget && (
        <div className="absolute inset-0 z-[75] flex items-center justify-center bg-black/30 p-5">
          <div className="chat-session-modal-surface w-full max-w-md rounded-2xl border border-border bg-panel p-4 space-y-3">
            <div className="text-lg font-medium text-normal">选择 Agent</div>
            <p className="text-sm text-low">
              选择要安装并分配该技能的 Agent：
              <span className="ml-1 font-medium text-normal">
                {marketInstallTarget.name}
              </span>
            </p>

            <div className="space-y-1">
              <label className="text-xs text-low">目标 Agent</label>
              <select
                value={marketInstallAgentId}
                onChange={(event) =>
                  setMarketInstallAgentId(event.target.value)
                }
                className="chat-session-member-field w-full rounded-xl border bg-panel px-3 py-2 text-sm text-normal focus:outline-none"
              >
                <option value="">请选择 Agent</option>
                {runnerOptions.map((option) => (
                  <option key={option.key} value={option.representativeAgentId}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeInstallAgentDialog}
                disabled={Boolean(isInstallingMarketSkillKey)}
                className="h-9 rounded-xl border border-border bg-white px-4 text-sm text-low hover:bg-white hover:text-normal disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmInstallWithAgent()}
                disabled={
                  !marketInstallAgentId || Boolean(isInstallingMarketSkillKey)
                }
                className={cn(
                  'inline-flex h-9 items-center gap-1 rounded-xl bg-black px-4 text-sm text-white',
                  !marketInstallAgentId || Boolean(isInstallingMarketSkillKey)
                    ? 'opacity-60 cursor-not-allowed'
                    : 'hover:bg-black/85'
                )}
              >
                {isInstallingMarketSkillKey ? '安装中...' : '安装'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isCreateModalOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/30 p-5">
          <div className="chat-session-modal-surface w-full max-w-lg rounded-2xl border border-border bg-panel p-4 space-y-3">
            <div className="text-lg font-medium text-normal">添加技能路径</div>

            <div className="space-y-1">
              <label className="text-xs text-low">技能路径</label>
              <input
                value={customSkillPath}
                onChange={(event) => setCustomSkillPath(event.target.value)}
                placeholder="C:\\skills\\my-skill"
                className="chat-session-member-field w-full rounded-xl border bg-panel px-3 py-2 text-sm text-normal focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-low">绑定 Agent（可选）</label>
              <select
                value={customSkillAgentId}
                onChange={(event) => setCustomSkillAgentId(event.target.value)}
                className="chat-session-member-field w-full rounded-xl border bg-panel px-3 py-2 text-sm text-normal focus:outline-none"
              >
                <option value="">暂不分配</option>
                {runnerOptions.map((option) => (
                  <option key={option.key} value={option.representativeAgentId}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="h-9 rounded-xl border border-border bg-panel px-4 text-sm text-low hover:text-normal"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleCreateSkillFromPath()}
                disabled={
                  isCreatingSkill || customSkillPath.trim().length === 0
                }
                className={cn(
                  'inline-flex h-9 items-center gap-1 rounded-xl bg-[var(--chat-session-send-blue,#5094FB)] px-4 text-sm text-white',
                  isCreatingSkill || customSkillPath.trim().length === 0
                    ? 'opacity-60 cursor-not-allowed'
                    : 'hover:bg-[var(--chat-session-send-blue-hover,#4084EB)]'
                )}
              >
                <PlusIcon size={14} />
                {isCreatingSkill ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
