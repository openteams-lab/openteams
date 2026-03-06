import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckIcon, LightningIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import type { ChatAgentSkill, ChatSkill } from 'shared/types';
import { chatApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { filterSkillsByRunner } from '../skillCompatibility';

interface AgentSkillsSectionProps {
  agentId: string | null;
  runnerType: string | null;
  readOnly?: boolean;
  selectedSkillIds?: string[];
  onSelectedSkillIdsChange?: (skillIds: string[]) => void;
  title?: string;
  maxHeightClass?: string;
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
    ...skill.tags,
  ]
    .join(' ')
    .toLowerCase();
}

export function AgentSkillsSection({
  agentId,
  runnerType,
  readOnly = false,
  selectedSkillIds,
  onSelectedSkillIdsChange,
  title = 'Skills',
  maxHeightClass,
}: AgentSkillsSectionProps) {
  const [allSkills, setAllSkills] = useState<ChatSkill[]>([]);
  const [agentAssignments, setAgentAssignments] = useState<ChatAgentSkill[]>([]);
  const [internalSelectedSkillIds, setInternalSelectedSkillIds] = useState<
    string[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [syncingSkillId, setSyncingSkillId] = useState<string | null>(null);

  const isControlled =
    Array.isArray(selectedSkillIds) &&
    typeof onSelectedSkillIdsChange === 'function';

  const effectiveSelectedSkillIds = useMemo(
    () =>
      normalizeSkillIds(
        isControlled ? (selectedSkillIds ?? []) : internalSelectedSkillIds
      ),
    [isControlled, internalSelectedSkillIds, selectedSkillIds]
  );

  const selectedSkillIdSet = useMemo(
    () => new Set(effectiveSelectedSkillIds),
    [effectiveSelectedSkillIds]
  );

  const assignmentBySkillId = useMemo(
    () =>
      new Map(agentAssignments.map((assignment) => [assignment.skill_id, assignment])),
    [agentAssignments]
  );

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
      setError('Failed to load skills.');
    } finally {
      setIsLoading(false);
    }
  }, []);

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
        setInternalSelectedSkillIds(assignments.map((assignment) => assignment.skill_id));
      }
    } catch (loadError) {
      console.error('Failed to load agent skill assignments', loadError);
      setError('Failed to load assigned skills.');
    }
  }, [agentId, isControlled]);

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

  const handleToggleSkill = useCallback(
    async (skillId: string) => {
      if (readOnly) return;

      const nextSkillIds = selectedSkillIdSet.has(skillId)
        ? effectiveSelectedSkillIds.filter((id) => id !== skillId)
        : [...effectiveSelectedSkillIds, skillId];

      if (isControlled || !agentId) {
        updateSelectedSkillIds(nextSkillIds);
        return;
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
      } catch (toggleError) {
        console.error('Failed to update skill assignment', toggleError);
        setError('Failed to update skill assignment.');
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
      updateSelectedSkillIds,
    ]
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-low flex items-center gap-1">
          <LightningIcon size={12} />
          <span>{title}</span>
        </div>
        <div className="text-[11px] text-low">
          {effectiveSelectedSkillIds.length}/{compatibleSkills.length}
        </div>
      </div>

      <div className="relative">
        <MagnifyingGlassIcon
          size={12}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-low"
        />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search skills"
          className={cn(
            'chat-session-member-field w-full rounded-sm border bg-panel py-1 pl-7 pr-2',
            'text-xs text-normal focus:outline-none'
          )}
        />
      </div>

      <div
        className={cn(
          'rounded-sm border border-border/80 bg-secondary/40 p-1.5 overflow-y-auto space-y-1',
          maxHeightClass ?? 'max-h-44'
        )}
      >
        {isLoading && (
          <div className="text-xs text-low py-2 text-center">Loading skills...</div>
        )}

        {!isLoading && compatibleSkills.length === 0 && (
          <div className="text-xs text-low py-2 text-center">
            {runnerType
              ? `No compatible skills for ${runnerType}.`
              : 'No skills available.'}
          </div>
        )}

        {!isLoading &&
          compatibleSkills.length > 0 &&
          filteredSkills.length === 0 && (
            <div className="text-xs text-low py-2 text-center">
              No matching skills.
            </div>
          )}

        {!isLoading &&
          filteredSkills.map((skill) => {
            const isSelected = selectedSkillIdSet.has(skill.id);
            const isSyncing = syncingSkillId === skill.id;

            return (
              <button
                key={skill.id}
                type="button"
                disabled={readOnly || isSyncing}
                onClick={() => void handleToggleSkill(skill.id)}
                className={cn(
                  'w-full flex items-start gap-2 rounded-sm border px-2 py-1.5 text-left transition-colors',
                  isSelected
                    ? 'border-[var(--chat-session-send-blue,#4f46e5)] bg-[var(--chat-session-brand-soft,#eef2ff)]'
                    : 'border-border/80 bg-panel hover:bg-secondary/70',
                  (readOnly || isSyncing) && 'opacity-60 cursor-not-allowed'
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-xs border',
                    isSelected
                      ? 'border-[var(--chat-session-send-blue,#4f46e5)] bg-[var(--chat-session-send-blue,#4f46e5)] text-white'
                      : 'border-border text-transparent'
                  )}
                >
                  <CheckIcon size={11} weight="bold" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-normal truncate">{skill.name}</div>
                  <div className="text-[11px] text-low truncate">
                    {skill.description || 'No description'}
                  </div>
                </div>
              </button>
            );
          })}
      </div>

      {error && <div className="text-xs text-error">{error}</div>}
    </div>
  );
}
