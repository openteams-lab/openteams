import { useCallback, useEffect, useState } from 'react';
import {
  PlusIcon,
  TrashIcon,
  PencilSimpleIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  LightningIcon,
  XIcon,
} from '@phosphor-icons/react';
import type {
  ChatSkill,
  CreateChatSkill,
  UpdateChatSkill,
  ChatAgentSkill,
} from 'shared/types';
import { chatApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PrimaryButton } from '@/components/ui-new/primitives/PrimaryButton';

interface AgentSkillsSectionProps {
  /** The agent ID to manage skills for (null when creating a new agent) */
  agentId: string | null;
  /** Whether the section is in read-only mode (e.g. archived session) */
  readOnly?: boolean;
}

type SkillFormMode = 'hidden' | 'create' | 'edit';

export function AgentSkillsSection({
  agentId,
  readOnly = false,
}: AgentSkillsSectionProps) {
  const [allSkills, setAllSkills] = useState<ChatSkill[]>([]);
  const [agentSkillAssignments, setAgentSkillAssignments] = useState<
    ChatAgentSkill[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Skill form state
  const [formMode, setFormMode] = useState<SkillFormMode>('hidden');
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [skillName, setSkillName] = useState('');
  const [skillDescription, setSkillDescription] = useState('');
  const [skillContent, setSkillContent] = useState('');
  const [skillTriggerType, setSkillTriggerType] = useState<string>('always');
  const [skillKeywords, setSkillKeywords] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Expanded state for skill list
  const [isExpanded, setIsExpanded] = useState(false);

  const loadSkills = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const skills = await chatApi.listSkills();
      setAllSkills(skills);
      if (agentId) {
        const assignments = await chatApi.listAgentSkills(agentId);
        setAgentSkillAssignments(assignments);
      }
    } catch {
      setError('Failed to load skills');
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const assignedSkillIds = new Set(
    agentSkillAssignments.map((a) => a.skill_id)
  );

  const resetForm = () => {
    setFormMode('hidden');
    setEditingSkillId(null);
    setSkillName('');
    setSkillDescription('');
    setSkillContent('');
    setSkillTriggerType('always');
    setSkillKeywords('');
  };

  const handleCreateSkill = async () => {
    if (!skillName.trim() || !skillContent.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const data: CreateChatSkill = {
        name: skillName.trim(),
        description: skillDescription.trim() || null,
        content: skillContent.trim(),
        trigger_type: skillTriggerType as string | null,
        trigger_keywords:
          skillTriggerType === 'keyword'
            ? skillKeywords
                .split(',')
                .map((k) => k.trim())
                .filter(Boolean)
            : null,
        enabled: true,
      };
      const skill = await chatApi.createSkill(data);
      // Auto-assign to current agent if editing
      if (agentId) {
        await chatApi.assignSkillToAgent({
          agent_id: agentId,
          skill_id: skill.id,
          enabled: true,
        });
      }
      resetForm();
      await loadSkills();
    } catch {
      setError('Failed to create skill');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateSkill = async () => {
    if (!editingSkillId || !skillName.trim() || !skillContent.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const data: UpdateChatSkill = {
        name: skillName.trim(),
        description: skillDescription.trim() || null,
        content: skillContent.trim(),
        trigger_type: skillTriggerType as string | null,
        trigger_keywords:
          skillTriggerType === 'keyword'
            ? skillKeywords
                .split(',')
                .map((k) => k.trim())
                .filter(Boolean)
            : null,
        enabled: true,
      };
      await chatApi.updateSkill(editingSkillId, data);
      resetForm();
      await loadSkills();
    } catch {
      setError('Failed to update skill');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSkill = async (skillId: string) => {
    try {
      await chatApi.deleteSkill(skillId);
      await loadSkills();
    } catch {
      setError('Failed to delete skill');
    }
  };

  const handleAssignSkill = async (skillId: string) => {
    if (!agentId) return;
    try {
      await chatApi.assignSkillToAgent({
        agent_id: agentId,
        skill_id: skillId,
        enabled: true,
      });
      await loadSkills();
    } catch {
      setError('Failed to assign skill');
    }
  };

  const handleUnassignSkill = async (skillId: string) => {
    if (!agentId) return;
    const assignment = agentSkillAssignments.find(
      (a) => a.skill_id === skillId
    );
    if (!assignment) return;
    try {
      await chatApi.unassignSkillFromAgent(agentId, assignment.id);
      await loadSkills();
    } catch {
      setError('Failed to unassign skill');
    }
  };

  const handleEditSkill = (skill: ChatSkill) => {
    setFormMode('edit');
    setEditingSkillId(skill.id);
    setSkillName(skill.name);
    setSkillDescription(skill.description);
    setSkillContent(skill.content);
    setSkillTriggerType(skill.trigger_type);
    setSkillKeywords(skill.trigger_keywords.join(', '));
  };

  const triggerLabel = (type: string) => {
    switch (type) {
      case 'always':
        return 'Always';
      case 'keyword':
        return 'Keyword';
      case 'manual':
        return 'Manual (/cmd)';
      default:
        return type;
    }
  };

  if (!agentId && formMode === 'hidden') {
    return (
      <div className="space-y-half">
        <div className="flex items-center justify-between">
          <label className="text-xs text-low flex items-center gap-1">
            <LightningIcon size={12} />
            Skills
          </label>
          <span className="text-xs text-low">Save agent first</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-half">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="text-xs text-low flex items-center gap-1 hover:text-normal"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <LightningIcon size={12} />
          Skills ({allSkills.length})
          <span className="text-[10px]">{isExpanded ? '▾' : '▸'}</span>
        </button>
        {!readOnly && (
          <button
            type="button"
            className="text-xs text-low hover:text-normal flex items-center gap-0.5"
            onClick={() => {
              resetForm();
              setFormMode('create');
              setIsExpanded(true);
            }}
          >
            <PlusIcon size={12} />
            New
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="space-y-1">
          {isLoading && (
            <div className="text-xs text-low py-1">Loading...</div>
          )}

          {/* Skill list */}
          {allSkills.map((skill) => {
            const isAssigned = assignedSkillIds.has(skill.id);
            return (
              <div
                key={skill.id}
                className={cn(
                  'flex items-center gap-1 px-1 py-0.5 rounded text-xs',
                  isAssigned ? 'bg-accent/10' : 'bg-panel'
                )}
              >
                {/* Toggle assign/unassign */}
                {agentId && !readOnly && (
                  <button
                    type="button"
                    onClick={() =>
                      isAssigned
                        ? handleUnassignSkill(skill.id)
                        : handleAssignSkill(skill.id)
                    }
                    className="shrink-0"
                    title={isAssigned ? 'Unassign from agent' : 'Assign to agent'}
                  >
                    {isAssigned ? (
                      <ToggleRightIcon
                        size={16}
                        weight="fill"
                        className="text-accent"
                      />
                    ) : (
                      <ToggleLeftIcon size={16} className="text-low" />
                    )}
                  </button>
                )}
                <div className="flex-1 min-w-0 truncate" title={skill.name}>
                  {skill.name}
                </div>
                <span className="text-[10px] text-low shrink-0">
                  {triggerLabel(skill.trigger_type)}
                </span>
                {!readOnly && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleEditSkill(skill)}
                      className="text-low hover:text-normal shrink-0"
                      title="Edit"
                    >
                      <PencilSimpleIcon size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSkill(skill.id)}
                      className="text-low hover:text-error shrink-0"
                      title="Delete"
                    >
                      <TrashIcon size={12} />
                    </button>
                  </>
                )}
              </div>
            );
          })}

          {allSkills.length === 0 && !isLoading && (
            <div className="text-xs text-low py-1">
              No skills defined. Create one to get started.
            </div>
          )}

          {/* Create/Edit form */}
          {formMode !== 'hidden' && (
            <div className="border border-border rounded p-1.5 space-y-1 mt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-normal">
                  {formMode === 'create' ? 'New Skill' : 'Edit Skill'}
                </span>
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-low hover:text-normal"
                >
                  <XIcon size={12} />
                </button>
              </div>
              <input
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
                placeholder="Skill name"
                className="w-full rounded-sm border bg-panel px-1.5 py-0.5 text-xs text-normal focus:outline-none"
              />
              <input
                value={skillDescription}
                onChange={(e) => setSkillDescription(e.target.value)}
                placeholder="Description (optional)"
                className="w-full rounded-sm border bg-panel px-1.5 py-0.5 text-xs text-normal focus:outline-none"
              />
              <textarea
                value={skillContent}
                onChange={(e) => setSkillContent(e.target.value)}
                placeholder="Skill instructions (injected into agent prompt)"
                rows={4}
                className="w-full resize-none rounded-sm border bg-panel px-1.5 py-0.5 text-xs text-normal focus:outline-none"
              />
              <div className="flex items-center gap-1">
                <label className="text-[10px] text-low shrink-0">
                  Trigger:
                </label>
                <select
                  value={skillTriggerType}
                  onChange={(e) => setSkillTriggerType(e.target.value)}
                  className="flex-1 rounded-sm border bg-panel px-1 py-0.5 text-xs text-normal focus:outline-none"
                >
                  <option value="always">Always</option>
                  <option value="keyword">Keyword</option>
                  <option value="manual">Manual (/command)</option>
                </select>
              </div>
              {skillTriggerType === 'keyword' && (
                <input
                  value={skillKeywords}
                  onChange={(e) => setSkillKeywords(e.target.value)}
                  placeholder="Keywords (comma-separated)"
                  className="w-full rounded-sm border bg-panel px-1.5 py-0.5 text-xs text-normal focus:outline-none"
                />
              )}
              <div className="flex justify-end gap-1 pt-0.5">
                <PrimaryButton
                  variant="tertiary"
                  value="Cancel"
                  onClick={resetForm}
                  disabled={isSaving}
                  className="!text-xs !px-2 !py-0.5"
                />
                <PrimaryButton
                  value={formMode === 'create' ? 'Create' : 'Save'}
                  onClick={
                    formMode === 'create'
                      ? handleCreateSkill
                      : handleUpdateSkill
                  }
                  disabled={
                    isSaving || !skillName.trim() || !skillContent.trim()
                  }
                  className="!text-xs !px-2 !py-0.5"
                />
              </div>
            </div>
          )}

          {error && <div className="text-xs text-error">{error}</div>}
        </div>
      )}
    </div>
  );
}
