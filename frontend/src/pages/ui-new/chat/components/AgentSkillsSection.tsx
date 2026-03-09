import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CaretDownIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { ChatAgentSkill, ChatSkill } from 'shared/types';
import { chatApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { SkillDetailModal } from './SkillDetailModal';
import { filterSkillsByRunner } from '../skillCompatibility';

interface AgentSkillsSectionProps {
  agentId: string | null;
  runnerType: string | null;
  readOnly?: boolean;
  selectedSkillIds?: string[];
  onSelectedSkillIdsChange?: (skillIds: string[]) => void;
  title?: string;
  maxHeightClass?: string;
  allowDetailModal?: boolean;
}

function normalizeSkillIds(skillIds: string[]): string[] {
  return Array.from(
    new Set(skillIds.map((skillId) => skillId.trim()).filter(Boolean))
  );
}

function getSkillSearchText(skill: ChatSkill): string {
  return [
    skill.name,
    skill.description ?? '',
    skill.category ?? '',
    skill.author ?? '',
    skill.version ?? '',
    ...skill.tags,
  ]
    .join(' ')
    .toLowerCase();
}

function isSkillSelectControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('[data-skill-select-control="true"]'))
  );
}

export function AgentSkillsSection({
  agentId,
  runnerType,
  readOnly = false,
  selectedSkillIds,
  onSelectedSkillIdsChange,
  title,
  maxHeightClass,
  allowDetailModal = true,
}: AgentSkillsSectionProps) {
  const { t } = useTranslation('chat');
  const [allSkills, setAllSkills] = useState<ChatSkill[]>([]);
  const [agentAssignments, setAgentAssignments] = useState<ChatAgentSkill[]>(
    []
  );
  const [internalSelectedSkillIds, setInternalSelectedSkillIds] = useState<
    string[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [syncingSkillId, setSyncingSkillId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const [detailSkillData, setDetailSkillData] = useState<ChatSkill | null>(
    null
  );
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const isControlled =
    Array.isArray(selectedSkillIds) &&
    typeof onSelectedSkillIdsChange === 'function';

  const effectiveSelectedSkillIds = useMemo(
    () =>
      normalizeSkillIds(
        isControlled ? (selectedSkillIds ?? []) : internalSelectedSkillIds
      ),
    [internalSelectedSkillIds, isControlled, selectedSkillIds]
  );

  const selectedSkillIdSet = useMemo(
    () => new Set(effectiveSelectedSkillIds),
    [effectiveSelectedSkillIds]
  );

  const assignmentBySkillId = useMemo(
    () =>
      new Map(
        agentAssignments.map((assignment) => [assignment.skill_id, assignment])
      ),
    [agentAssignments]
  );

  const allSkillsById = useMemo(
    () => new Map(allSkills.map((skill) => [skill.id, skill])),
    [allSkills]
  );

  const selectedSkills = useMemo(
    () =>
      effectiveSelectedSkillIds.map((skillId) => {
        const skill = allSkillsById.get(skillId);
        return {
          id: skillId,
          name: skill?.name ?? skillId,
        };
      }),
    [allSkillsById, effectiveSelectedSkillIds]
  );
  const hasSelectedSkills = selectedSkills.length > 0;
  const visibleSelectedSkills = useMemo(
    () => selectedSkills.slice(0, 3),
    [selectedSkills]
  );
  const hiddenSelectedSkillCount = Math.max(selectedSkills.length - 3, 0);
  const resolvedTitle = title ?? t('members.skills.label');

  const updateSelectedSkillIds = useCallback(
    (nextSkillIds: string[]) => {
      const normalized = normalizeSkillIds(nextSkillIds);
      if (isControlled) {
        onSelectedSkillIdsChange?.(normalized);
        return;
      }
      setInternalSelectedSkillIds(normalized);
    },
    [isControlled, onSelectedSkillIdsChange]
  );

  const loadSkills = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const skills = await chatApi.listSkills();
      setAllSkills(skills);
    } catch (loadError) {
      console.error('Failed to load skills', loadError);
      setError(t('members.skills.errors.load'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const loadAgentAssignments = useCallback(async () => {
    if (!agentId) {
      setAgentAssignments([]);
      if (!isControlled) {
        setInternalSelectedSkillIds([]);
      }
      return;
    }

    try {
      const assignments = await chatApi.listAgentSkills(agentId);
      setAgentAssignments(assignments);
      if (!isControlled) {
        setInternalSelectedSkillIds(
          assignments.map((assignment) => assignment.skill_id)
        );
      }
    } catch (loadError) {
      console.error('Failed to load agent skill assignments', loadError);
      setError(t('members.skills.errors.assignedLoad'));
    }
  }, [agentId, isControlled, t]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    void loadAgentAssignments();
  }, [loadAgentAssignments]);

  const compatibleSkills = useMemo(
    () => filterSkillsByRunner(allSkills, runnerType),
    [allSkills, runnerType]
  );

  const filteredSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return compatibleSkills;
    return compatibleSkills.filter((skill) =>
      getSkillSearchText(skill).includes(query)
    );
  }, [compatibleSkills, searchQuery]);

  const detailSkill = useMemo(() => {
    if (detailSkillData) return detailSkillData;
    if (!detailSkillId) return null;
    return allSkillsById.get(detailSkillId) ?? null;
  }, [allSkillsById, detailSkillData, detailSkillId]);

  const dropdownEmptyText = useMemo(() => {
    if (compatibleSkills.length > 0) {
      return null;
    }

    return runnerType
      ? t('members.skills.noneInstalledForRunner', { runnerType })
      : t('members.skills.noneInstalled');
  }, [compatibleSkills.length, runnerType, t]);

  useEffect(() => {
    if (!isExpanded) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (detailSkillId) return;
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsExpanded(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [detailSkillId, isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;

    try {
      searchInputRef.current?.focus({ preventScroll: true });
    } catch {
      searchInputRef.current?.focus();
    }
  }, [isExpanded]);

  useEffect(() => {
    if (!detailSkillId) return;

    const skillStillVisible = compatibleSkills.some(
      (skill) => skill.id === detailSkillId
    );
    if (!skillStillVisible) {
      setDetailSkillId(null);
      setDetailSkillData(null);
      setDetailError(null);
    }
  }, [compatibleSkills, detailSkillId]);

  useEffect(() => {
    if (!detailSkillId) return;

    const fallbackSkill = allSkillsById.get(detailSkillId) ?? null;
    let isCancelled = false;

    setDetailSkillData((currentSkill) =>
      currentSkill?.id === detailSkillId ? currentSkill : fallbackSkill
    );
    setDetailError(null);
    setIsLoadingDetail(true);

    void chatApi
      .getSkill(detailSkillId)
      .then((skill) => {
        if (isCancelled) return;
        setDetailSkillData(skill);
      })
      .catch((loadError) => {
        console.error('Failed to load skill detail', loadError);
        if (isCancelled) return;
        setDetailError(t('members.skills.errors.detail'));
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingDetail(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [allSkillsById, detailSkillId, t]);

  const handleExpandedChange = useCallback((nextExpanded: boolean) => {
    setIsExpanded(nextExpanded);
    if (!nextExpanded) {
      setSearchQuery('');
    }
  }, []);

  const handleOpenSkillDetails = useCallback((skill: ChatSkill) => {
    setDetailSkillId(skill.id);
    setDetailSkillData(skill);
    setDetailError(null);
    setIsLoadingDetail(true);
  }, []);

  const handleCloseSkillDetails = useCallback(() => {
    setDetailSkillId(null);
    setDetailSkillData(null);
    setDetailError(null);
    setIsLoadingDetail(false);
  }, []);

  const handleSetSkillSelected = useCallback(
    async (skillId: string, nextSelected: boolean) => {
      if (readOnly) return false;

      const isSelected = selectedSkillIdSet.has(skillId);
      if (isSelected === nextSelected) {
        return true;
      }

      const nextSkillIds = nextSelected
        ? [...effectiveSelectedSkillIds, skillId]
        : effectiveSelectedSkillIds.filter((id) => id !== skillId);

      if (isControlled || !agentId) {
        updateSelectedSkillIds(nextSkillIds);
        return true;
      }

      setSyncingSkillId(skillId);
      setError(null);
      try {
        const assignment = assignmentBySkillId.get(skillId);
        if (assignment) {
          await chatApi.unassignSkillFromAgent(agentId, assignment.id);
        } else {
          await chatApi.assignSkillToAgent({
            agent_id: agentId,
            skill_id: skillId,
            enabled: true,
          });
        }
        updateSelectedSkillIds(nextSkillIds);
        const refreshedAssignments = await chatApi.listAgentSkills(agentId);
        setAgentAssignments(refreshedAssignments);
        return true;
      } catch (toggleError) {
        console.error('Failed to update skill assignment', toggleError);
        setError(t('members.skills.errors.update'));
        return false;
      } finally {
        setSyncingSkillId(null);
      }
    },
    [
      agentId,
      assignmentBySkillId,
      effectiveSelectedSkillIds,
      isControlled,
      readOnly,
      selectedSkillIdSet,
      t,
      updateSelectedSkillIds,
    ]
  );

  const handleToggleSkill = useCallback(
    async (skillId: string) =>
      handleSetSkillSelected(skillId, !selectedSkillIdSet.has(skillId)),
    [handleSetSkillSelected, selectedSkillIdSet]
  );

  const handleSelectSkillFromDetails = useCallback(async () => {
    if (!detailSkillId) return;

    if (selectedSkillIdSet.has(detailSkillId)) {
      handleCloseSkillDetails();
      return;
    }

    const didSelect = await handleSetSkillSelected(detailSkillId, true);
    if (didSelect) {
      handleCloseSkillDetails();
      return;
    }

    setDetailError(t('members.skills.errors.update'));
  }, [
    detailSkillId,
    handleCloseSkillDetails,
    handleSetSkillSelected,
    selectedSkillIdSet,
    t,
  ]);

  const handleRemoveSelectedSkill = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, skillId: string) => {
      event.preventDefault();
      event.stopPropagation();
      void handleToggleSkill(skillId);
    },
    [handleToggleSkill]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-low">
          <span>{resolvedTitle}</span>
        </div>
        <div className="text-[11px] text-low">
          {effectiveSelectedSkillIds.length}/{compatibleSkills.length}
        </div>
      </div>

      <div ref={containerRef} className="space-y-2">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          onClick={() => handleExpandedChange(!isExpanded)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) {
              return;
            }

            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleExpandedChange(!isExpanded);
            }
          }}
          className={cn(
            'chat-session-member-field w-full rounded-lg border bg-panel text-left',
            'cursor-pointer transition-[border-color,box-shadow] duration-200 ease-out',
            'hover:border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4338CA]/20'
          )}
        >
          <div
            className={cn(
              hasSelectedSkills
                ? 'flex flex-col gap-1.5 px-base py-2'
                : 'flex min-h-[38px] items-center justify-between gap-2 px-base py-half'
            )}
          >
            <div
              className={cn(
                'flex w-full justify-between gap-2',
                hasSelectedSkills ? 'items-start' : 'items-center'
              )}
            >
              <div
                className={cn(
                  'min-w-0 flex-1',
                  hasSelectedSkills
                    ? cn(
                        'grid auto-rows-min items-center justify-items-start gap-1.5',
                        hiddenSelectedSkillCount > 0
                          ? 'grid-cols-[repeat(3,minmax(0,1fr))_auto]'
                          : 'grid-cols-3'
                      )
                    : 'flex items-center gap-3'
                )}
              >
                {hasSelectedSkills ? (
                  visibleSelectedSkills.map((skill) => {
                    const isSyncing = syncingSkillId === skill.id;

                    return (
                      <span
                        key={skill.id}
                        className={cn(
                          'inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-[#C7D2FE]/80',
                          'justify-self-start',
                          'bg-[rgb(238,242,255)] px-2 py-1 text-[13px] font-medium leading-4 text-[#3730A3]',
                          isSyncing && 'opacity-60'
                        )}
                      >
                        <span className="min-w-0 truncate">{skill.name}</span>
                        {!readOnly && (
                          <button
                            type="button"
                            aria-label={t('members.skills.remove', {
                              name: skill.name,
                            })}
                            disabled={isSyncing}
                            onClick={(event) =>
                              handleRemoveSelectedSkill(event, skill.id)
                            }
                            className={cn(
                              'inline-flex size-4 shrink-0 items-center justify-center rounded-full',
                              'text-[#4338CA] transition-colors hover:bg-[#E0E7FF] hover:text-[#312E81]',
                              'focus:outline-none focus-visible:ring-1 focus-visible:ring-[#4338CA]/30',
                              isSyncing && 'cursor-not-allowed'
                            )}
                          >
                            <XIcon size={10} weight="bold" />
                          </button>
                        )}
                      </span>
                    );
                  })
                ) : (
                  <span className="min-w-0 truncate text-sm text-[#94A3B8]">
                    {t('members.skills.selected')}
                  </span>
                )}
                {hasSelectedSkills && hiddenSelectedSkillCount > 0 && (
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full border border-[#C7D2FE]/80',
                      'justify-self-start bg-[rgb(238,242,255)] px-2 py-1 text-[13px] font-medium leading-4 text-[#3730A3]'
                    )}
                    title={selectedSkills
                      .slice(3)
                      .map((skill) => skill.name)
                      .join(', ')}
                  >
                    {t('members.skills.collapsedCount', {
                      count: hiddenSelectedSkillCount,
                    })}
                  </span>
                )}
              </div>
              <CaretDownIcon
                size={14}
                className={cn(
                  hasSelectedSkills ? 'mt-1' : 'mt-0.5',
                  'shrink-0 text-low transition-transform',
                  isExpanded && 'rotate-180'
                )}
              />
            </div>
          </div>
        </div>

        {isExpanded && (
          <div
            className={cn(
              'rounded-xl border border-[#E5E7EB] bg-white p-2.5',
              'shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)]'
            )}
          >
            <div className="relative px-1 pb-2">
              <MagnifyingGlassIcon
                size={11}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF]"
              />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    handleExpandedChange(false);
                  }
                }}
                placeholder={t('members.skills.searchPlaceholder')}
                className={cn(
                  'chat-session-member-field w-full rounded-sm border bg-panel py-half pl-8 pr-base',
                  'text-sm text-normal',
                  'placeholder:text-low focus:outline-none'
                )}
              />
            </div>

            <div
              className={cn(
                'skills-dropdown-scroll space-y-1.5 overflow-y-auto px-1',
                maxHeightClass ?? 'max-h-44'
              )}
            >
              {isLoading && (
                <div className="px-3 py-3 text-center text-sm text-low">
                  {t('members.skills.loading')}
                </div>
              )}

              {!isLoading && compatibleSkills.length === 0 && (
                <div className="px-3 py-3 text-center text-sm text-low">
                  {dropdownEmptyText}
                </div>
              )}

              {!isLoading &&
                compatibleSkills.length > 0 &&
                filteredSkills.length === 0 && (
                  <div className="px-3 py-3 text-center text-sm text-low">
                    {t('members.skills.noMatching')}
                  </div>
                )}

              {!isLoading &&
                filteredSkills.map((skill) => {
                  const isSelected = selectedSkillIdSet.has(skill.id);
                  const isSyncing = syncingSkillId === skill.id;
                  const isDetailOpen = detailSkillId === skill.id;

                  return (
                    <div
                      key={skill.id}
                      role={allowDetailModal ? 'button' : undefined}
                      tabIndex={allowDetailModal ? 0 : undefined}
                      aria-label={
                        allowDetailModal
                          ? t('members.skills.detail.viewDetails', {
                              name: skill.name,
                            })
                          : undefined
                      }
                      onClick={(event) => {
                        if (isSkillSelectControlTarget(event.target)) {
                          return;
                        }
                        if (!allowDetailModal) {
                          return;
                        }
                        handleOpenSkillDetails(skill);
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) {
                          return;
                        }

                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          if (!allowDetailModal) {
                            return;
                          }
                          handleOpenSkillDetails(skill);
                        }
                      }}
                      className={cn(
                        'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                        allowDetailModal &&
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/30 cursor-pointer',
                        isSelected
                          ? 'bg-[rgb(238,242,255)]'
                          : 'hover:bg-[rgb(238,242,255)]',
                        isDetailOpen && !isSelected && 'bg-[rgb(238,242,255)]'
                      )}
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSelected}
                        data-skill-select-control="true"
                        className={cn(
                          'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center',
                          readOnly || isSyncing
                            ? 'cursor-not-allowed'
                            : 'cursor-pointer'
                        )}
                        disabled={readOnly || isSyncing}
                        onPointerDownCapture={(event) => event.stopPropagation()}
                        onClickCapture={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        aria-label={
                          isSelected
                            ? t('members.skills.unselectAction', {
                                name: skill.name,
                              })
                            : t('members.skills.selectAction', {
                                name: skill.name,
                              })
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleToggleSkill(skill.id);
                        }}
                      >
                        <span
                          data-skill-select-control="true"
                          className={cn(
                            'inline-flex size-4 items-center justify-center rounded-[4px] border transition-colors',
                            isSelected
                              ? 'border-[#C7D2FE]/80 bg-[rgb(238,242,255)] text-black'
                              : 'border-[#CBD5E1] bg-white text-transparent',
                            !readOnly &&
                              !isSyncing &&
                              'group-hover:border-[#A78BFA]',
                            (readOnly || isSyncing) && 'opacity-60'
                          )}
                        >
                          <CheckIcon size={11} weight="bold" />
                        </span>
                      </button>

                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            'truncate text-sm transition-colors',
                            isSelected
                              ? 'font-semibold text-black'
                              : 'text-normal group-hover:text-black'
                          )}
                        >
                          {skill.name}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {allowDetailModal && (
        <SkillDetailModal
          isOpen={Boolean(detailSkillId)}
          name={detailSkill?.name ?? ''}
          description={detailSkill?.description}
          content={detailSkill?.content}
          sourceUrl={detailSkill?.source_url}
          isLoading={isLoadingDetail}
          error={detailError}
          onClose={handleCloseSkillDetails}
          primaryAction={{
            label:
              detailSkillId && syncingSkillId === detailSkillId
                ? t('members.skills.detail.selecting')
                : t('members.skills.detail.select'),
            onClick: () => {
              void handleSelectSkillFromDetails();
            },
            disabled:
              readOnly ||
              !detailSkillId ||
              isLoadingDetail ||
              syncingSkillId === detailSkillId,
            icon: <CheckIcon size={16} weight="bold" />,
          }}
        />
      )}

      {error && <div className="text-xs text-error">{error}</div>}
    </div>
  );
}
