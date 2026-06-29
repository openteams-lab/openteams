import { getRuntimeDisplayState } from '@/pages/agent-runtime/agentRuntimeViewModel';
import type { AgentRuntimeStatus, JsonValue } from '@/types';
import type { ChatMemberPreset, ChatTeamPreset } from '../../../shared/types';

export type TemplateMemberBuild = {
  allowedSkillIds: string[];
  displayOrder: number;
  modelName: string | null;
  name: string;
  role: string;
  runnerType: string;
  systemPrompt: string | null;
  toolsEnabled: JsonValue;
  workspacePath: string | null;
};

const isObjectRecord = (value: unknown): value is Record<string, JsonValue> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const runtimeConfiguredModel = (
  runtime?: AgentRuntimeStatus | null,
): string =>
  isObjectRecord(runtime?.executor_options) &&
  typeof runtime.executor_options.model === 'string'
    ? runtime.executor_options.model.trim()
    : '';

export const firstAvailableRuntime = (
  runtimes: AgentRuntimeStatus[],
): AgentRuntimeStatus | undefined =>
  runtimes.find((runner) => getRuntimeDisplayState(runner) === 'available');

export const resolveTemplateMemberRuntime = (
  member: ChatMemberPreset,
  runtimes: AgentRuntimeStatus[],
): { runnerType: string; modelName: string | null } | null => {
  const availableRuntimes = runtimes.filter(
    (runner) => getRuntimeDisplayState(runner) === 'available',
  );
  const recommended = member.runner_type?.trim() ?? '';
  const availableRecommended = recommended
    ? availableRuntimes.find((runtime) => runtime.runner_type === recommended)
    : undefined;
  const runtime = availableRecommended ?? firstAvailableRuntime(availableRuntimes);
  if (!runtime) return null;

  const modelName =
    availableRecommended && member.recommended_model?.trim()
      ? member.recommended_model.trim()
      : runtimeConfiguredModel(runtime) || runtime.discovered_models[0] || null;

  return {
    runnerType: runtime.runner_type,
    modelName,
  };
};

export const buildTemplateMemberSpecs = (
  detail: ChatTeamPreset,
  workspacePath: string | null,
  runtimes: AgentRuntimeStatus[],
): TemplateMemberBuild[] => {
  const selectedMembers = detail.members.filter(
    (member) => member.enabled !== false,
  );
  const leadMemberId =
    detail.lead_member_id &&
    selectedMembers.some((member) => member.id === detail.lead_member_id)
      ? detail.lead_member_id
      : selectedMembers[0]?.id;

  return selectedMembers.flatMap((member, index) => {
    const runtime = resolveTemplateMemberRuntime(member, runtimes);
    if (!runtime) return [];

    return [
      {
        allowedSkillIds: member.selected_skill_ids,
        displayOrder: index + 1,
        modelName: runtime.modelName,
        name: member.name,
        role: member.id === leadMemberId ? 'lead' : 'agent',
        runnerType: runtime.runnerType,
        systemPrompt: member.system_prompt,
        toolsEnabled: (member.tools_enabled ?? {}) as JsonValue,
        workspacePath: member.default_workspace_path?.trim() || workspacePath,
      },
    ];
  });
};
