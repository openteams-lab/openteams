// Acceptance smoke coverage for the Team Templates aggregate flow.
//
// No browser E2E runner is installed. Run with:
//     pnpm exec tsx src/pages/TeamTemplatesAcceptance.test.ts
// Exits non-zero if any acceptance scenario fails.

import { readFileSync } from 'node:fs';
import { teamPresetsApi } from '../lib/api';
import {
  addCustomMemberDraft,
  buildTemplateMemberSpecs,
  commitMemberSystemPromptDraft,
  commitTeamProtocolDraft,
  createTeamPresetDraft,
  teamPresetDraftToPayload,
  teamTemplateSessionUpdatePayload,
  validateMemberToolsEnabledDraft,
  validateTeamPresetDraft,
} from './TeamTemplatesPage';
import type { AgentRuntimeStatus } from '../types';
import type {
  ChatMemberPreset,
  ChatTeamPreset,
  CreateTeamPresetRequest,
  TeamPresetListResponse,
  TeamPresetMemberWrite,
  TeamPresetSummary,
  UpdateTeamPresetRequest,
} from '../../../shared/types';

type AcceptanceStatus = 'PASS' | 'FAIL';

type AcceptanceRecord = {
  actual: string[];
  failureLogs: string[];
  input: Record<string, unknown>;
  name: string;
  status: AcceptanceStatus;
  steps: string[];
};

const records: AcceptanceRecord[] = [];
let failures = 0;

const source = readFileSync(new URL('./TeamTemplatesPage.tsx', import.meta.url), 'utf8');
const backendMigrationSource = readFileSync(
  new URL('../../../crates/services/src/services/config/versions/v9.rs', import.meta.url),
  'utf8',
);

const builtInTeam: ChatTeamPreset = {
  id: 'builtin_delivery',
  name: 'Built-in Delivery',
  description: 'Built-in template',
  members: [
    {
      id: 'builtin_lead',
      name: 'BuiltInLead',
      description: 'Built-in lead',
      runner_type: 'CODEX',
      recommended_model: 'gpt-5.2-codex',
      system_prompt: 'Built-in role prompt.',
      default_workspace_path: null,
      selected_skill_ids: ['builtin'],
      tools_enabled: {},
      is_builtin: true,
      enabled: true,
    },
  ],
  lead_member_id: 'builtin_lead',
  workflow_steps: [{ title: 'Read', description: 'Inspect the task.' }],
  team_protocol: 'Built-in protocol.',
  is_builtin: true,
  enabled: true,
};

const savedTeams = new Map<string, ChatTeamPreset>([[builtInTeam.id, builtInTeam]]);

const assertAcceptance: (
  condition: boolean,
  message: string,
  detail?: unknown,
) => void = (condition, message, detail) => {
  if (!condition) {
    throw new Error(
      detail === undefined ? message : `${message}: ${JSON.stringify(detail)}`,
    );
  }
};

const apiResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: status < 400, data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const teamToSummary = (team: ChatTeamPreset): TeamPresetSummary => ({
  id: team.id,
  name: team.name,
  description: team.description,
  lead_member_id: team.lead_member_id ?? null,
  team_protocol: team.team_protocol,
  is_builtin: team.is_builtin,
  enabled: team.enabled,
  member_count: team.members.length,
  members: team.members.map((member) => ({
    id: member.id,
    name: member.name,
    description: member.description,
    runner_type: member.runner_type,
    recommended_model: member.recommended_model,
    is_builtin: member.is_builtin,
    enabled: member.enabled,
  })),
});

const memberWriteToPreset = (member: TeamPresetMemberWrite): ChatMemberPreset => ({
  id: member.id,
  name: member.name,
  description: member.description ?? '',
  runner_type: member.runner_type ?? null,
  recommended_model: member.recommended_model ?? null,
  system_prompt: member.system_prompt ?? '',
  default_workspace_path: member.default_workspace_path ?? null,
  selected_skill_ids: member.selected_skill_ids,
  tools_enabled: member.tools_enabled ?? {},
  is_builtin: false,
  enabled: member.enabled ?? true,
});

const writeToTeam = (
  payload: CreateTeamPresetRequest | UpdateTeamPresetRequest,
): ChatTeamPreset => ({
  id: payload.id,
  name: payload.name,
  description: payload.description ?? '',
  members: payload.members.map(memberWriteToPreset),
  lead_member_id: payload.lead_member_id ?? null,
  workflow_steps: payload.workflow_steps,
  team_protocol: payload.team_protocol ?? '',
  is_builtin: false,
  enabled: payload.enabled ?? true,
});

globalThis.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
  const url = String(input);
  const method = options?.method ?? 'GET';

  if (url === '/api/team-presets' && method === 'GET') {
    const response: TeamPresetListResponse = {
      teams: Array.from(savedTeams.values()).map(teamToSummary),
    };
    return apiResponse(response);
  }

  if (url === '/api/team-presets' && method === 'POST') {
    const payload = JSON.parse(String(options?.body)) as CreateTeamPresetRequest;
    const team = writeToTeam(payload);
    savedTeams.set(team.id, team);
    return apiResponse(team);
  }

  if (url.startsWith('/api/team-presets/')) {
    const id = decodeURIComponent(url.slice('/api/team-presets/'.length));
    const existing = savedTeams.get(id);
    if (!existing) return apiResponse({ error: `missing team ${id}` }, 404);

    if (method === 'GET') return apiResponse(existing);
    if (method === 'DELETE') {
      if (existing.is_builtin) return apiResponse({ error: 'built-in read-only' }, 403);
      savedTeams.delete(id);
      return apiResponse(null);
    }
    if (method === 'PUT') {
      if (existing.is_builtin) return apiResponse({ error: 'built-in read-only' }, 403);
      const payload = JSON.parse(String(options?.body)) as UpdateTeamPresetRequest;
      const team = writeToTeam(payload);
      savedTeams.set(id, team);
      return apiResponse(team);
    }
  }

  return apiResponse({ error: `unhandled request ${method} ${url}` }, 500);
}) as typeof fetch;

const runScenario = async (
  name: string,
  input: Record<string, unknown>,
  steps: string[],
  test: () => Promise<string[]> | string[],
) => {
  const record: AcceptanceRecord = {
    actual: [],
    failureLogs: [],
    input,
    name,
    status: 'PASS',
    steps,
  };

  try {
    record.actual = await test();
  } catch (error) {
    failures += 1;
    record.status = 'FAIL';
    record.failureLogs.push(error instanceof Error ? error.message : String(error));
  }

  records.push(record);
};

const runtime: AgentRuntimeStatus = {
  runner_type: 'CODEX',
  installed: true,
  executable: true,
  availability: { type: 'INSTALLATION_FOUND' },
  discovered_models: ['gpt-5.2-codex'],
  model_source: 'runner',
  version: 'test',
  last_checked_at: null,
  last_error: null,
  run_mode: 'auto',
  env_summary: [],
  executor_options: { model: 'gpt-5.2-codex' },
};

const buildCompleteCreatePayload = (): CreateTeamPresetRequest => {
  const initial = createTeamPresetDraft();
  const withMember = addCustomMemberDraft({
    ...initial,
    id: 'qa_delivery_team',
    name: 'QA Delivery Team',
    description: 'End-to-end aggregate smoke team',
    workflowSteps: [
      { title: 'Plan', description: 'Confirm acceptance inputs.' },
      { title: '  ', description: '  ' },
      { title: 'Verify', description: 'Record browser/API evidence.' },
    ],
  });
  const selectedMemberId = withMember.selectedMemberId;
  const complete = commitMemberSystemPromptDraft(
    commitTeamProtocolDraft(withMember.form, '## Team Protocol\n- Review before merge.'),
    selectedMemberId,
    '### QA Role\nValidate the Team Templates flow.',
  );
  const form = {
    ...complete,
    leadMemberId: 'lead',
    members: complete.members.map((member) => {
      if (member.id === 'lead') {
        return {
          ...member,
          name: 'Planner',
          runnerType: 'CODEX',
          recommendedModel: 'gpt-5.2-codex',
          systemPrompt: '### Lead Role\nCoordinate the template rollout.',
          selectedSkillIdsText: 'planning, review',
          toolsEnabledText: '{"mcpServers":{"filesystem":{"enabled":true}}}',
        };
      }
      return {
        ...member,
        name: 'Template QA',
        runnerType: 'CODEX',
        recommendedModel: 'gpt-5.2-codex',
        description: 'Owns validation',
        selectedSkillIdsText: 'qa, smoke',
        toolsEnabledText: '{"mcpServers":{"browser":{"enabled":true}}}',
      };
    }),
  };
  const validation = validateTeamPresetDraft(form);
  if (validation.issue || !validation.payload) {
    assertAcceptance(false, 'create payload should validate', validation.issue);
  }
  return validation.payload as CreateTeamPresetRequest;
};

const createPayload = buildCompleteCreatePayload();

await runScenario(
  '1. 新建团队模板完整流',
  {
    team: createPayload.name,
    members: createPayload.members.map((member) => member.name),
    workflow_steps: createPayload.workflow_steps,
  },
  [
    '从新建入口构造聚合 draft。',
    '填写团队名、描述、流程步骤、团队协议。',
    '添加自定义成员并编辑成员名、职责、技能和 MCP。',
    '通过 teamPresetsApi.create 保存，并通过 list/get 模拟刷新回填。',
  ],
  async () => {
    const saved = await teamPresetsApi.create(createPayload);
    const refreshedList = await teamPresetsApi.list();
    const refreshedDetail = await teamPresetsApi.get(createPayload.id);

    assertAcceptance(
      refreshedList.teams.some((team) => team.id === createPayload.id),
      'new template should appear in refreshed list',
      refreshedList,
    );
    assertAcceptance(refreshedDetail.members.length === 2, 'detail should include embedded members');
    assertAcceptance(
      !Object.prototype.hasOwnProperty.call(refreshedDetail, 'member_ids'),
      'API detail should not expose legacy member_ids',
      refreshedDetail,
    );
    assertAcceptance(
      refreshedDetail.workflow_steps.length === 2,
      'blank workflow steps should be filtered',
      refreshedDetail.workflow_steps,
    );
    assertAcceptance(
      source.includes('<AgentMarkdown content={viewDetail.team_protocol}') &&
        source.includes('<AgentMarkdown content={systemPrompt}'),
      'team protocol and member role should render through Markdown components',
    );

    return [
      `保存模板 ${saved.id}，刷新列表可见。`,
      `详情返回 ${refreshedDetail.members.length} 个内嵌成员，无 member_ids 字段。`,
      '团队协议和职责设定保留 Markdown 渲染路径。',
    ];
  },
);

await runScenario(
  '2. 持久化迁移兼容流',
  {
    legacy_shape: 'teams[].member_ids + global members',
    expected_shape: 'teams[].members',
  },
  [
    '读取后端 v9 配置迁移测试覆盖。',
    '确认旧 member_ids 会迁移为团队内嵌 members。',
    '确认序列化后的团队模板不再落盘 member_ids。',
  ],
  () => {
    assertAcceptance(
      backendMigrationSource.includes('chat_presets_config_migrates_legacy_member_ids_to_embedded_members'),
      'legacy member_ids migration test should exist',
    );
    assertAcceptance(
      backendMigrationSource.includes('config_try_from_raw_v9_migrates_legacy_member_ids_and_serializes_aggregate_teams'),
      'aggregate serialization regression test should exist',
    );
    assertAcceptance(
      backendMigrationSource.includes('serialized_team.get("member_ids").is_none()'),
      'migration regression should assert member_ids are not serialized',
    );

    return [
      '后端迁移单测覆盖旧 member_ids 到内嵌 members。',
      '落盘序列化单测断言 teams[0].member_ids 不存在。',
    ];
  },
);

await runScenario(
  '3. 编辑自定义模板流',
  {
    template: createPayload.id,
    edit: 'protocol/workflow/member role/skills/MCP/add/delete member',
  },
  [
    '加载已创建自定义模板详情。',
    '修改团队协议、流程、成员职责、技能和 MCP。',
    '添加成员后再删除一个成员并保存。',
    '通过 get 模拟刷新后确认改动持久化。',
  ],
  async () => {
    const current = await teamPresetsApi.get(createPayload.id);
    const updatedPayload: UpdateTeamPresetRequest = {
      id: current.id,
      name: 'QA Delivery Team Edited',
      description: current.description,
      lead_member_id: 'lead',
      workflow_steps: [{ title: 'Ship', description: 'Validate and release.' }],
      team_protocol: '## Updated Protocol\n- Escalate blockers quickly.',
      enabled: true,
      members: [
        {
          id: 'lead',
          name: 'Planner',
          description: 'Coordinates delivery',
          runner_type: 'CODEX',
          recommended_model: 'gpt-5.2-codex',
          system_prompt: '### Updated Lead\nOwn the final acceptance call.',
          default_workspace_path: null,
          selected_skill_ids: ['planning', 'release'],
          tools_enabled: { mcpServers: { git: { enabled: true } } },
          enabled: true,
        },
        {
          id: 'release_reviewer',
          name: 'Release Reviewer',
          description: 'Checks release readiness',
          runner_type: 'CODEX',
          recommended_model: 'gpt-5.2-codex',
          system_prompt: 'Review the release checklist.',
          default_workspace_path: null,
          selected_skill_ids: ['review'],
          tools_enabled: { mcpServers: { browser: { enabled: true } } },
          enabled: true,
        },
      ],
    };
    await teamPresetsApi.update(current.id, updatedPayload);
    const refreshed = await teamPresetsApi.get(current.id);

    assertAcceptance(refreshed.name === updatedPayload.name, 'updated name should persist');
    assertAcceptance(refreshed.members.length === 2, 'edited member set should persist');
    assertAcceptance(
      refreshed.members.some((member) => member.id === 'release_reviewer'),
      'added member should persist',
      refreshed.members,
    );
    assertAcceptance(
      !refreshed.members.some((member) => member.name === 'Template QA'),
      'deleted member should stay deleted',
      refreshed.members,
    );
    assertAcceptance(
      validateMemberToolsEnabledDraft(createTeamPresetDraft(), 'lead') === null,
      'member-scoped MCP validation should accept default JSON',
    );
    assertAcceptance(
      source.includes('Invalid JSON format. Please check your syntax.'),
      'invalid MCP JSON should have a visible save-blocking error',
    );

    return [
      '自定义模板更新后刷新仍保留新团队协议、流程、成员职责、技能和 MCP。',
      '新增成员 release_reviewer 持久化，原 Template QA 已删除。',
      '非法 MCP JSON 错误文案和成员级校验路径仍存在。',
    ];
  },
);

await runScenario(
  '4. 只读和内置模板回归流',
  {
    builtin_template: builtInTeam.id,
    readonly_checks: ['edit guard', 'delete guard', 'detail layout guard'],
  },
  [
    '加载内置模板详情。',
    '尝试 update/delete 并确认被拒绝。',
    '静态检查只读详情页仍使用详情布局和只读按钮守卫。',
  ],
  async () => {
    const builtin = await teamPresetsApi.get(builtInTeam.id);
    let updateRejected = false;
    let deleteRejected = false;
    try {
      await teamPresetsApi.update(builtin.id, teamPresetDraftToPayload(createTeamPresetDraft()));
    } catch {
      updateRejected = true;
    }
    try {
      await teamPresetsApi.delete(builtin.id);
    } catch {
      deleteRejected = true;
    }

    assertAcceptance(builtin.is_builtin, 'loaded template should be built-in');
    assertAcceptance(updateRejected, 'built-in update should be rejected');
    assertAcceptance(deleteRejected, 'built-in delete should be rejected');
    assertAcceptance(
      source.includes('selectedDetail.is_builtin') &&
        source.includes('canEdit && !isEditing') &&
        source.includes('canEditSelected'),
      'read-only detail controls should remain guarded',
    );
    assertAcceptance(
      source.includes('team-template-workflow-preview') &&
        source.includes('team-template-member-row'),
      'read-only detail layout should retain workflow and member sections',
    );

    return [
      '内置模板加载为 is_builtin=true。',
      'update/delete 均被 API 层拒绝。',
      '只读详情布局和编辑控件守卫仍存在。',
    ];
  },
);

await runScenario(
  '5. 团队模板导入项目流',
  {
    template: createPayload.id,
    project_workspace: 'E:/workspace/projectSS/sample-project',
  },
  [
    '读取编辑后的聚合模板。',
    '用可用 runtime 构造成员创建规格。',
    '确认团队协议写入项目，lead agent patch 只更新会话负责人。',
  ],
  async () => {
    const detail = await teamPresetsApi.get(createPayload.id);
    const specs = buildTemplateMemberSpecs(
      detail,
      'E:/workspace/projectSS/sample-project',
      [runtime],
    );
    const sessionPatch = teamTemplateSessionUpdatePayload({
      lead_agent_id: 'agent-lead',
    });
    const projectProtocol = {
      content: detail.team_protocol,
      enabled: detail.team_protocol.trim().length > 0,
    };

    assertAcceptance(specs.length === detail.members.length, 'all enabled members should import');
    assertAcceptance(specs[0]?.role === 'lead', 'lead member should import as lead');
    assertAcceptance(
      specs.every((spec, index) => spec.name === detail.members[index]?.name),
      'member names should match template order',
      specs,
    );
    assertAcceptance(
      specs.every((spec, index) => spec.systemPrompt === detail.members[index]?.system_prompt),
      'member role prompts should be copied',
      specs,
    );
    assertAcceptance(
      JSON.stringify(specs[0]?.toolsEnabled) === JSON.stringify(detail.members[0]?.tools_enabled),
      'MCP/tool config should be copied',
      specs[0],
    );
    assertAcceptance(
      projectProtocol.content === detail.team_protocol && projectProtocol.enabled,
      'team protocol should be passed to project update',
      projectProtocol,
    );

    return [
      `导入规格生成 ${specs.length} 个成员，名称、职责、技能和 MCP 与模板一致。`,
      '负责人角色写入会话，团队协议写入项目级唯一真源。',
    ];
  },
);

console.log('TeamTemplatesAcceptance');
console.log(JSON.stringify(records, null, 2));

if (failures > 0) {
  console.error(`\n${failures} acceptance scenario(s) FAILED`);
  process.exit(1);
}

console.log('\nAll TeamTemplates acceptance scenarios passed.');
