import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UIEvent } from 'react';
import {
  ArrowClockwiseIcon,
  DownloadIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { BaseCodingAgent } from 'shared/types';
import type {
  InstalledNativeSkill,
  RemoteSkillMeta,
  RemoteSkillPackage,
} from 'shared/types';
import { AgentInfo, chatApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { InstallSkillDialog } from './InstallSkillDialog';
import { SkillDetailModal } from './SkillDetailModal';

type MarketSource = 'registry' | 'builtin';

type MarketSkill = RemoteSkillMeta & {
  source: MarketSource;
};

type DetailTarget =
  | { kind: 'installed'; skill: InstalledNativeSkill }
  | { kind: 'market'; skill: MarketSkill };

type DetailData = {
  name: string;
  description: string;
  content: string;
  sourceUrl: string | null;
  installedSkillId: string | null;
  enabled: boolean | null;
  canToggle: boolean | null;
};

type RunnerOption = {
  key: string;
  label: string;
};

interface SkillsPanelProps {
  isOpen: boolean;
  leftOffset: number;
  availableRunnerTypes: string[];
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

function runnerKeyToAgentId(runnerKey: string): string {
  const normalized = runnerKey.toLowerCase().replace(/_/g, '-');
  const mapping: Record<string, string> = {
    'claude-code': 'claude',
    'github-copilot': 'copilot',
    'copilot': 'copilot',
    'qwen-code': 'qwen',
    'kimi-code': 'kimi',
  };
  return mapping[normalized] ?? normalized;
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
  availableRunnerTypes,
  onClose,
}: SkillsPanelProps) {
  const { t } = useTranslation('chat');
  const [installedSkills, setInstalledSkills] = useState<InstalledNativeSkill[]>(
    []
  );
  const [marketSkills, setMarketSkills] = useState<MarketSkill[]>([]);

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
  const [isCreatingSkill, setIsCreatingSkill] = useState(false);
  const [marketVisibleCount, setMarketVisibleCount] = useState(
    marketRenderBatchSize
  );

  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([]);
  const [installDialog, setInstallDialog] = useState<{
    isOpen: boolean;
    skill: MarketSkill | null;
  }>({ isOpen: false, skill: null });

  const runnerOptions = useMemo<RunnerOption[]>(() => {
    return Array.from(
      new Set(
        availableRunnerTypes
          .map((runnerType) => runnerType.trim().toUpperCase())
          .filter(
            (runnerType) =>
              runnerType.length > 0 && supportedRunnerTypeSet.has(runnerType)
          )
      )
    )
      .map((runnerType) => ({
        key: runnerType,
        label: toRunnerLabel(runnerType),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [availableRunnerTypes]);

  const selectedRunnerOption = useMemo(
    () =>
      runnerOptions.find((option) => option.key === selectedRunnerKey) ?? null,
    [runnerOptions, selectedRunnerKey]
  );
  const selectedRunnerLabel = selectedRunnerOption?.label ?? '';

  const loadInstalledSkills = useCallback(async (runnerKey: string) => {
    setIsLoadingInstalled(true);
    setInstalledError(null);
    try {
      if (!runnerKey) {
        setInstalledSkills([]);
        return;
      }
      const skills = await chatApi.listNativeSkills(runnerKey);
      setInstalledSkills(skills);
    } catch (error) {
      console.error('Failed to load installed skills', error);
      setInstalledError(t('skillLibrary.errors.loadInstalled'));
    } finally {
      setIsLoadingInstalled(false);
    }
  }, [t]);

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
        setMarketError(t('skillLibrary.errors.loadMarket'));
      }
    } finally {
      setIsLoadingMarket(false);
    }
  }, [t]);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      loadMarketSkills(),
      selectedRunnerKey ? loadInstalledSkills(selectedRunnerKey) : Promise.resolve(),
    ]);
  }, [loadInstalledSkills, loadMarketSkills, selectedRunnerKey]);

  useEffect(() => {
    if (!isOpen) return;
    void refreshAll();
  }, [isOpen, refreshAll]);

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
    if (!isOpen || !selectedRunnerKey) return;
    void loadInstalledSkills(selectedRunnerKey);
  }, [isOpen, loadInstalledSkills, selectedRunnerKey]);

  useEffect(() => {
    if (!isOpen) return;
    chatApi.listSupportedAgents().then(setAvailableAgents).catch(console.error);
  }, [isOpen]);

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
          .map((item) => normalizeSourceUrl(item.skill.source_url))
          .filter(Boolean)
      ),
    [installedSkills]
  );

  const installedByName = useMemo(
    () =>
      new Set(
        installedSkills.map((item) => item.skill.name.trim().toLowerCase())
      ),
    [installedSkills]
  );

  const findInstalledSkillByMeta = useCallback(
    (meta: MarketSkill): InstalledNativeSkill | null => {
      const normalizedSource = normalizeSourceUrl(meta.source_url);
      return (
        installedSkills.find(
          (item) =>
            normalizeSourceUrl(item.skill.source_url) === normalizedSource &&
            normalizedSource.length > 0
        ) ??
        installedSkills.find(
          (item) =>
            item.skill.name.trim().toLowerCase() ===
            meta.name.trim().toLowerCase()
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

  const displayedInstalledSkills = installedSkills;

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

  const handleToggleInstalledSkill = useCallback(
    async (skillId: string) => {
      setIsSyncingSkillId(skillId);
      setInstalledError(null);
      try {
        const current = installedSkills.find((item) => item.skill.id === skillId);
        if (!current || !selectedRunnerKey) {
          return;
        }
        await chatApi.updateNativeSkill(
          selectedRunnerKey,
          skillId,
          !current.enabled
        );
        await loadInstalledSkills(selectedRunnerKey);
      } catch (error) {
        console.error('Failed to update agent skill', error);
        setInstalledError(t('skillLibrary.errors.updateNative'));
      } finally {
        setIsSyncingSkillId(null);
      }
    },
    [installedSkills, loadInstalledSkills, selectedRunnerKey, t]
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
            .getSkill(detailTarget.skill.skill.id)
            .catch(() => detailTarget.skill.skill);

          setDetailData({
            name: detail.name,
            description: detail.description ?? '',
            content: detail.content,
            sourceUrl: detail.source_url,
            installedSkillId: detail.id,
            enabled: detailTarget.skill.enabled,
            canToggle: detailTarget.skill.can_toggle,
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
          installedSkillId: installed?.skill.id ?? null,
          enabled: installed?.enabled ?? null,
          canToggle: installed?.can_toggle ?? null,
        });
      } catch (error) {
        console.error('Failed to load skill detail', error);
        setDetailError(t('members.skills.errors.detail'));
      } finally {
        setIsLoadingDetail(false);
      }
    };

    void loadDetail();
  }, [detailTarget, findInstalledSkillByMeta, t]);

  const closeDetail = useCallback(() => {
    setDetailTarget(null);
    setDetailData(null);
    setDetailError(null);
  }, []);

  const handleEnableSkill = useCallback(async () => {
    if (!detailData?.installedSkillId || !selectedRunnerKey) return;

    setIsTryingSkill(true);
    setDetailError(null);
    try {
      if (detailData.enabled === false) {
        await chatApi.updateNativeSkill(
          selectedRunnerKey,
          detailData.installedSkillId,
          true
        );
        await loadInstalledSkills(selectedRunnerKey);
      }

      closeDetail();
    } catch (error) {
      console.error('Failed to enable skill', error);
      setDetailError(t('skillLibrary.errors.enable'));
    } finally {
      setIsTryingSkill(false);
    }
  }, [
    closeDetail,
    detailData,
    loadInstalledSkills,
    selectedRunnerKey,
    t,
  ]);
  const handleToggleSkillEnabled = useCallback(async () => {
    if (
      !detailData?.installedSkillId ||
      detailData.enabled === null ||
      !selectedRunnerKey
    ) {
      return;
    }

    setIsTogglingSkill(true);
    setDetailError(null);
    const nextEnabled = !detailData.enabled;

    try {
      await chatApi.updateNativeSkill(
        selectedRunnerKey,
        detailData.installedSkillId,
        nextEnabled
      );
      setDetailData((prev) =>
        prev ? { ...prev, enabled: nextEnabled } : prev
      );
      await loadInstalledSkills(selectedRunnerKey);
      closeDetail();
    } catch (error) {
      console.error('Failed to toggle skill enabled', error);
      setDetailError(t('skillLibrary.errors.updateNative'));
    } finally {
      setIsTogglingSkill(false);
    }
  }, [closeDetail, detailData, loadInstalledSkills, selectedRunnerKey, t]);

  const handleToggleInstalledDetailAssignment = useCallback(async () => {
    if (
      !detailData?.installedSkillId ||
      detailData.enabled === null ||
      !selectedRunnerKey
    ) {
      return;
    }

    const skillId = detailData.installedSkillId;
    const nextEnabled = !detailData.enabled;

    setIsSyncingSkillId(skillId);
    setDetailError(null);

    try {
      await chatApi.updateNativeSkill(selectedRunnerKey, skillId, nextEnabled);
      setDetailData((prev) =>
        prev ? { ...prev, enabled: nextEnabled } : prev
      );
      await loadInstalledSkills(selectedRunnerKey);
      closeDetail();
    } catch (error) {
      console.error('Failed to toggle installed skill assignment', error);
      setDetailError(t('skillLibrary.errors.updateNative'));
    } finally {
      setIsSyncingSkillId(null);
    }
  }, [
    closeDetail,
    detailData,
    loadInstalledSkills,
    selectedRunnerKey,
    t,
  ]);

  const handleDeleteSkill = useCallback(async () => {
    if (!detailData?.installedSkillId) return;

    setIsDeletingSkill(true);
    setDetailError(null);
    try {
      await chatApi.deleteSkill(detailData.installedSkillId);
      await Promise.all([
        loadMarketSkills(),
        selectedRunnerKey ? loadInstalledSkills(selectedRunnerKey) : Promise.resolve(),
      ]);
      closeDetail();
    } catch (error) {
      console.error('Failed to delete skill', error);
      setDetailError(t('skillLibrary.errors.delete'));
    } finally {
      setIsDeletingSkill(false);
    }
  }, [
    closeDetail,
    detailData,
    loadInstalledSkills,
    loadMarketSkills,
    selectedRunnerKey,
    t,
  ]);

  const handleCreateSkillFromPath = useCallback(async () => {
    const path = customSkillPath.trim();
    if (!path) return;

    setIsCreatingSkill(true);
    setInstalledError(null);
    try {
      await chatApi.createSkill({
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
        download_count: null,
      });

      await Promise.all([
        loadMarketSkills(),
        selectedRunnerKey ? loadInstalledSkills(selectedRunnerKey) : Promise.resolve(),
      ]);

      setIsCreateModalOpen(false);
      setCustomSkillPath('');
    } catch (error) {
      console.error('Failed to create skill from path', error);
      setInstalledError(t('skillLibrary.errors.create'));
    } finally {
      setIsCreatingSkill(false);
    }
  }, [
    customSkillPath,
    loadInstalledSkills,
    loadMarketSkills,
    selectedRunnerKey,
    t,
  ]);

  const handleOpenInstallDialog = useCallback((skill: MarketSkill) => {
    setInstallDialog({ isOpen: true, skill });
  }, []);

  const handleConfirmInstall = useCallback(
    async (agents: string[]) => {
      const skill = installDialog.skill;
      if (!skill) return;

      const marketKey = `${skill.source}:${skill.id}`;
      setIsInstallingMarketSkillKey(marketKey);
      setMarketError(null);
      setInstallDialog({ isOpen: false, skill: null });

      try {
        if (!findInstalledSkillByMeta(skill)) {
          if (skill.source === 'builtin') {
            await chatApi.installBuiltinSkill(skill.id, agents);
          } else {
            await chatApi.installRegistrySkill(skill.id, undefined, agents);
          }
        }

        await Promise.all([
          selectedRunnerKey ? loadInstalledSkills(selectedRunnerKey) : Promise.resolve(),
          loadMarketSkills(),
        ]);
      } catch (error) {
        console.error('Failed to install market skill', error);
        setMarketError(t('skillLibrary.errors.install'));
      } finally {
        setIsInstallingMarketSkillKey(null);
      }
    },
    [
      findInstalledSkillByMeta,
      installDialog.skill,
      loadInstalledSkills,
      loadMarketSkills,
      selectedRunnerKey,
      t,
    ]
  );

  const handleCancelInstall = useCallback(() => {
    setInstallDialog({ isOpen: false, skill: null });
  }, []);

  const handleInstallMarketSkill = useCallback(
    async (skill: MarketSkill) => {
      handleOpenInstallDialog(skill);
    },
    [handleOpenInstallDialog]
  );

  const handleInstallFromDetail = useCallback(async () => {
    if (!detailTarget || detailTarget.kind !== 'market') return;
    const marketSkill = detailTarget.skill;
    closeDetail();
    await handleInstallMarketSkill(marketSkill);
  }, [closeDetail, detailTarget, handleInstallMarketSkill]);

  const isInstalledDetail = detailTarget?.kind === 'installed';
  const isDetailInstallAction =
    detailTarget?.kind === 'market' && !detailData?.installedSkillId;
  const detailPrimaryAction =
    !detailTarget || isInstalledDetail
      ? null
      : isDetailInstallAction
        ? {
            label: isInstallingMarketSkillKey
              ? t('skillLibrary.actions.installing')
              : t('skillLibrary.actions.install'),
            onClick: () => {
              void handleInstallFromDetail();
            },
            disabled: isLoadingDetail || Boolean(isInstallingMarketSkillKey),
            icon: <DownloadIcon size={16} weight="bold" />,
          }
        : detailData?.installedSkillId &&
            detailData.enabled === false &&
            detailData.canToggle !== false
          ? {
              label: isTryingSkill
                ? t('skillLibrary.actions.updating')
                : t('skillLibrary.actions.enable'),
              onClick: () => {
                void handleEnableSkill();
              },
              disabled: isLoadingDetail || isTryingSkill,
            }
          : null;
  const installedToggleUnsupported =
    displayedInstalledSkills.length > 0 &&
    displayedInstalledSkills.every((item) => !item.can_toggle);
  const isInstalledDetailSyncing = detailData?.installedSkillId
    ? isSyncingSkillId === detailData.installedSkillId
    : false;
  const resolvedDetailPrimaryAction = isInstalledDetail
    ? detailData?.installedSkillId && detailData.enabled !== null
      ? {
          label: isInstalledDetailSyncing
            ? t('skillLibrary.actions.updating')
            : detailData.enabled
              ? t('skillLibrary.actions.disable')
              : t('skillLibrary.actions.enable'),
          onClick: () => {
            void handleToggleInstalledDetailAssignment();
          },
          disabled:
            isLoadingDetail ||
            isInstalledDetailSyncing ||
            detailData.canToggle === false,
          className: 'min-w-[92px] px-4 text-sm',
        }
      : null
    : detailPrimaryAction;

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
                {t('skillLibrary.title')}
              </h2>
              <p className="mt-3 text-base text-low">
                {t('skillLibrary.description')}
              </p>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => void refreshAll()}
                className="inline-flex h-9 items-center gap-1 rounded-lg px-1 text-sm text-low hover:text-normal"
              >
                <ArrowClockwiseIcon size={15} />
                {isLoadingInstalled || isLoadingMarket
                  ? t('skillLibrary.actions.refreshing')
                  : t('skillLibrary.actions.refresh')}
              </button>

              <button
                type="button"
                onClick={() => {
                  setCustomSkillPath('');
                  setIsCreateModalOpen(true);
                }}
                className="inline-flex h-10 items-center gap-1 rounded-xl bg-black px-4 text-sm font-semibold text-white hover:bg-black/85"
              >
                <PlusIcon size={14} />
                {t('skillLibrary.actions.newSkill')}
              </button>
            </div>
          </div>

          <section className="mt-10">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-2xl font-semibold text-normal">
                {t('skillLibrary.installed.title')}
              </h3>
              <select
                value={selectedRunnerKey}
                onChange={(event) => setSelectedRunnerKey(event.target.value)}
                title={selectedRunnerLabel}
                className={cn(
                  'chat-session-member-field min-w-[260px] rounded-xl border bg-panel px-3 py-1.5',
                  'text-xs text-normal focus:outline-none'
                )}
              >
                {runnerOptions.length === 0 && (
                  <option value="">{t('skillLibrary.installed.noRunner')}</option>
                )}
                {runnerOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {installedToggleUnsupported && (
              <div className="mb-4 rounded-2xl border border-border/70 bg-secondary/40 px-4 py-3 text-sm text-low">
                {t('skillLibrary.installed.toggleUnsupported', {
                  runnerType: selectedRunnerLabel || selectedRunnerKey,
                })}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {isLoadingInstalled && (
                <div className="col-span-full text-sm text-low py-4">
                  {t('members.skills.loading')}
                </div>
              )}

              {!isLoadingInstalled && displayedInstalledSkills.length === 0 && (
                <div className="col-span-full rounded-2xl border border-border bg-secondary/30 px-4 py-6 text-sm text-low">
                  {selectedRunnerLabel
                    ? t('members.skills.noneInstalledForRunner', {
                        runnerType: selectedRunnerLabel,
                      })
                    : t('members.skills.noneInstalled')}
                </div>
              )}

              {!isLoadingInstalled &&
                displayedInstalledSkills.map((item) => {
                  const skill = item.skill;
                  const isSyncing = isSyncingSkillId === skill.id;
                  const disabled = isSyncing || !item.can_toggle;

                  return (
                    <div
                      key={skill.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openDetail({ kind: 'installed', skill: item })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openDetail({ kind: 'installed', skill: item });
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
                            {skill.description ||
                              t('members.skills.detail.emptyDescription')}
                          </p>
                        </div>
                        <div
                          onClick={(event) => event.stopPropagation()}
                          title={
                            item.can_toggle
                              ? item.enabled
                                ? t('skillLibrary.actions.disable')
                                : t('skillLibrary.actions.enable')
                              : t('skillLibrary.installed.toggleUnsupported', {
                                  runnerType:
                                    selectedRunnerLabel || selectedRunnerKey,
                                })
                          }
                        >
                          <ToggleSwitch
                            checked={item.enabled}
                            disabled={disabled}
                            onClick={() => void handleToggleInstalledSkill(skill.id)}
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
              <h3 className="text-2xl font-semibold text-normal">
                {t('skillLibrary.market.title')}
              </h3>
              <div className="relative">
                <MagnifyingGlassIcon
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-low"
                />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t('members.skills.searchPlaceholder')}
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
                    {t('members.skills.loading')}
                  </div>
                )}

                {!isLoadingMarket && displayedMarketSkills.length === 0 && (
                  <div className="col-span-full rounded-2xl border border-border bg-secondary/30 px-4 py-6 text-sm text-low">
                    {t('skillLibrary.market.empty')}
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
                                  {formatDownloadCount(Number(skill.download_count))}
                                </span>
                              )}
                            </div>
                            <p className="truncate text-xs text-low">
                              {skill.description ||
                                t('members.skills.detail.emptyDescription')}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleInstallMarketSkill(skill);
                            }}
                            disabled={isInstalling}
                            className={cn(
                              'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-low transition-colors',
                              isInstalling
                                ? 'opacity-50 cursor-not-allowed'
                                : 'hover:bg-secondary/70 hover:text-normal'
                            )}
                            aria-label={
                              isInstalling
                                ? t('skillLibrary.actions.installing')
                                : t('skillLibrary.market.installAria')
                            }
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
                    {t('skillLibrary.market.scrollForMore')}
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
        name={
          detailData?.name ??
          (detailTarget?.kind === 'installed'
            ? detailTarget.skill.skill.name
            : detailTarget?.skill.name ?? '')
        }
        description={detailData?.description}
        content={detailData?.content}
        sourceUrl={detailData?.sourceUrl}
        isLoading={isLoadingDetail}
        error={detailError}
        onClose={closeDetail}
        footerLeading={
          <>
            {detailData?.canToggle === false && (
              <div className="max-w-[320px] text-sm text-low">
                {t('skillLibrary.installed.toggleUnsupported', {
                  runnerType: selectedRunnerLabel || selectedRunnerKey,
                })}
              </div>
            )}
            {detailTarget?.kind === 'market' && detailData?.installedSkillId && (
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
                {isDeletingSkill
                  ? t('skillLibrary.actions.deleting')
                  : t('skillLibrary.actions.delete')}
              </button>
            )}

            {isInstalledDetail && detailData?.installedSkillId && (
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
                {isDeletingSkill
                  ? t('skillLibrary.actions.deleting')
                  : t('skillLibrary.actions.delete')}
              </button>
            )}

            {detailData?.installedSkillId &&
              detailData.enabled !== null &&
              detailData.enabled === true &&
              detailData.canToggle !== false &&
              !isInstalledDetail && (
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
                  ? t('skillLibrary.actions.updating')
                  : detailData.enabled
                    ? t('skillLibrary.actions.disable')
                    : t('skillLibrary.actions.enable')}
              </button>
              )}
          </>
        }
        primaryAction={resolvedDetailPrimaryAction ?? undefined}
      />

      {isCreateModalOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/30 p-5">
          <div className="chat-session-modal-surface w-full max-w-lg rounded-2xl border border-border bg-panel p-4 space-y-3">
            <div className="text-lg font-medium text-normal">
              {t('skillLibrary.create.title')}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-low">
                {t('skillLibrary.create.pathLabel')}
              </label>
              <input
                value={customSkillPath}
                onChange={(event) => setCustomSkillPath(event.target.value)}
                placeholder={t('skillLibrary.create.pathPlaceholder')}
                className="chat-session-member-field w-full rounded-xl border bg-panel px-3 py-2 text-sm text-normal focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="h-9 rounded-xl border border-border bg-panel px-4 text-sm text-low hover:text-normal"
              >
                {t('skillLibrary.actions.cancel')}
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
                {isCreatingSkill
                  ? t('skillLibrary.actions.creating')
                  : t('skillLibrary.actions.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      <InstallSkillDialog
        isOpen={installDialog.isOpen}
        skillName={installDialog.skill?.name ?? ''}
        skillDescription={installDialog.skill?.description}
        defaultAgent={runnerKeyToAgentId(selectedRunnerKey)}
        availableAgents={availableAgents}
        isLoading={isInstallingMarketSkillKey !== null}
        onConfirm={handleConfirmInstall}
        onCancel={handleCancelInstall}
      />
    </div>
  );
}
