import assert from 'node:assert/strict';
import {
  buildTemplateMemberSpecs,
  resolveTemplateMemberRuntime,
} from './teamTemplateRuntime';
import type { AgentRuntimeStatus } from '@/types';
import type { ChatMemberPreset, ChatTeamPreset } from '../../../shared/types';

const runtime = (
  runnerType: string,
  models: string[],
  configuredModel?: string,
): AgentRuntimeStatus =>
  ({
    runner_type: runnerType,
    installed: true,
    executable: true,
    availability: { type: 'INSTALLATION_FOUND', path: null, source: null },
    discovered_models: models,
    model_source: 'discovered',
    version: null,
    last_checked_at: null,
    last_error: null,
    run_mode: 'cli',
    env_summary: [],
    executor_options: configuredModel ? { model: configuredModel } : {},
  }) as unknown as AgentRuntimeStatus;

const member = (patch: Partial<ChatMemberPreset>): ChatMemberPreset => ({
  id: patch.id ?? 'lead',
  name: patch.name ?? 'Lead Agent',
  description: patch.description ?? 'Coordinates delivery.',
  runner_type: patch.runner_type ?? 'codex',
  recommended_model: patch.recommended_model ?? 'gpt-5',
  system_prompt: patch.system_prompt ?? 'Lead the work.',
  default_workspace_path: patch.default_workspace_path ?? null,
  selected_skill_ids: patch.selected_skill_ids ?? [],
  tools_enabled: patch.tools_enabled ?? {},
  is_builtin: patch.is_builtin ?? true,
  enabled: patch.enabled ?? true,
});

const team = (members: ChatMemberPreset[]): ChatTeamPreset => ({
  id: 'fullstack_delivery_team',
  name: 'Full-stack delivery team',
  description: 'Ship product work.',
  members,
  lead_member_id: members[0]?.id ?? null,
  workflow_steps: [],
  team_protocol: '',
  is_builtin: true,
  enabled: true,
  tier: 'standard',
});

const runtimes = [
  runtime('claude_code', ['claude-sonnet-4-20250514']),
  runtime('codex', ['gpt-4.1'], 'gpt-5'),
];

const availableSpec = resolveTemplateMemberRuntime(
  member({ runner_type: 'codex', recommended_model: 'gpt-5' }),
  runtimes,
);
assert.equal(availableSpec?.runnerType, 'codex');
assert.equal(availableSpec?.modelName, 'gpt-5');

const fallbackSpec = resolveTemplateMemberRuntime(
  member({ runner_type: 'gemini', recommended_model: 'gemini-2.5-pro' }),
  runtimes,
);
assert.equal(fallbackSpec?.runnerType, 'claude_code');
assert.equal(fallbackSpec?.modelName, 'claude-sonnet-4-20250514');

const specs = buildTemplateMemberSpecs(
  team([
    member({ id: 'lead', name: 'Lead Agent', runner_type: 'codex' }),
    member({ id: 'disabled', name: 'Disabled', enabled: false }),
  ]),
  'E:\\workspace',
  runtimes,
);
assert.equal(specs.length, 1);
assert.equal(specs[0]?.role, 'lead');
assert.equal(specs[0]?.workspacePath, 'E:\\workspace');
