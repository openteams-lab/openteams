import type { ChatSkill, RemoteSkillMeta } from 'shared/types';

const runnerCompatibilityAliases: Record<string, string[]> = {
  CLAUDE_CODE: ['claude-code', 'claude', 'anthropic'],
  AMP: ['amp'],
  GEMINI: ['gemini', 'google', 'google-ai'],
  CODEX: ['codex', 'openai'],
  OPENCODE: ['opencode', 'open-code'],
  CURSOR_AGENT: ['cursor-agent', 'cursor'],
  QWEN_CODE: ['qwen-code', 'qwen', 'tongyi', 'dashscope'],
  COPILOT: ['copilot', 'github-copilot', 'github'],
  DROID: ['droid'],
  KIMI_CODE: ['kimi-code', 'kimi'],
};

function normalizeAgentId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/\s+/g, '-');
}

export function getRunnerCompatibilityKeys(
  runnerType: string | null | undefined
): string[] {
  if (!runnerType) return [];
  const normalizedRunner = normalizeAgentId(runnerType);
  const aliasKeys = runnerCompatibilityAliases[runnerType] ?? [];
  const normalizedAliases = aliasKeys.map(normalizeAgentId);

  return Array.from(new Set([normalizedRunner, ...normalizedAliases]));
}

export function isSkillCompatibleWithRunner(
  compatibleAgents: string[] | null | undefined,
  runnerType: string | null | undefined
): boolean {
  if (!compatibleAgents || compatibleAgents.length === 0) return true;

  const normalizedCompatibleAgents = new Set(
    compatibleAgents.map(normalizeAgentId)
  );
  const runnerKeys = getRunnerCompatibilityKeys(runnerType);

  if (runnerKeys.length === 0) return true;
  return runnerKeys.some((runnerKey) => normalizedCompatibleAgents.has(runnerKey));
}

type SkillWithCompatibility = Pick<ChatSkill, 'compatible_agents'> &
  Partial<Pick<RemoteSkillMeta, 'compatible_agents'>>;

export function filterSkillsByRunner<T extends SkillWithCompatibility>(
  skills: T[],
  runnerType: string | null | undefined
): T[] {
  return skills.filter((skill) =>
    isSkillCompatibleWithRunner(skill.compatible_agents, runnerType)
  );
}
