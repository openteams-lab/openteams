// Smoke tests for the team templates page wiring.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/pages/TeamTemplatesPage.test.ts
// Exits non-zero if any assertion fails.

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  WorkspaceContext,
  type WorkspaceContextProps,
} from '../context/WorkspaceContext';
import type { Locale } from '../types';
import {
  addCustomMemberDraft,
  commitMemberSystemPromptDraft,
  commitTeamProtocolDraft,
  createTeamPresetDraft,
  groupTeamTemplatesByTier,
  teamPresetDetailToDraft,
  teamPresetDraftToPayload,
  teamPresetDraftToPreviewDetail,
  TeamTemplatesPage,
  validateMemberMcpConfigDraft,
  validateMemberToolsEnabledDraft,
  validateTeamPresetDraft,
} from './TeamTemplatesPage';
import {
  AcpAccessMode,
  AcpApprovalMode,
  BaseCodingAgent,
  type ChatMemberPreset,
  type ChatTeamPreset,
  type MemberExecutionConfig,
  type TeamPresetSummary,
} from '../../../shared/types';

let failures = 0;
// Fake secrets used by the fixtures. Failure diagnostics must redact them so
// test logs never print config secrets.
const FAKE_CONFIG_SECRETS = [
  'fake-template-token',
  'fake-template-header',
  'mutated-after-submit',
];
const redactFakeConfigSecrets = (detail: unknown): string => {
  let text =
    typeof detail === 'string' ? detail : (JSON.stringify(detail) ?? '');
  for (const secret of FAKE_CONFIG_SECRETS) {
    text = text.split(secret).join('[REDACTED]');
  }
  return text;
};
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(
      `  FAIL ${label}`,
      detail === undefined ? '' : redactFakeConfigSecrets(detail),
    );
  }
};

// Spy on console output so the suite can prove no fake secret is ever printed.
const consoleOutputLines: string[] = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
// eslint-disable-next-line no-console
console.log = (...args: unknown[]) => {
  consoleOutputLines.push(args.map((arg) => String(arg)).join(' '));
  originalConsoleLog(...args);
};
// eslint-disable-next-line no-console
console.error = (...args: unknown[]) => {
  consoleOutputLines.push(args.map((arg) => String(arg)).join(' '));
  originalConsoleError(...args);
};

const source = readFileSync(new URL('./TeamTemplatesPage.tsx', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

console.log('TeamTemplatesPage');

const jsonResponse = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const completeExecutionConfig: MemberExecutionConfig = {
  runner_type: BaseCodingAgent.CODEX,
  model_name: 'template-model',
  thinking_effort: 'high',
  model_variant: 'fake-variant',
  acp: {
    access_mode: AcpAccessMode.workspace_only,
    approval_mode: AcpApprovalMode.auto_reject,
    additional_directories: ['/fake/template/context'],
  },
  mcp: {
    mcpServers: {
      fake_local: {
        command: 'fake-mcp-server',
        env: { API_TOKEN: 'fake-template-token' },
        headers: { Authorization: 'Bearer fake-template-header' },
      },
    },
  },
};

const draft = createTeamPresetDraft();
check(
  'new entry creates an aggregate draft',
  draft.leadMemberId === 'lead' &&
    draft.id.startsWith('custom_') &&
    draft.members.length === 1 &&
    Array.isArray(draft.workflowSteps),
  draft,
);

const added = addCustomMemberDraft({
  ...draft,
  name: 'Custom team',
  workflowSteps: [
    { title: 'Plan', description: '' },
    { title: '  ', description: '  ' },
  ],
});
check(
  'add member updates draft and selects the new member',
  added.form.members.length === 2 &&
    added.selectedMemberId === added.form.members[1]?.id,
  added,
);

const markdownDraft = commitMemberSystemPromptDraft(
  commitTeamProtocolDraft(added.form, '## Review rules'),
  added.selectedMemberId,
  '### Role\nReview the delivery plan.',
);
check(
  'markdown edits write into the aggregate draft',
  markdownDraft.teamProtocol.includes('Review rules') &&
    markdownDraft.members[1]?.systemPrompt.includes('delivery plan'),
  markdownDraft,
);

const invalidMcpDraft = {
  ...markdownDraft,
  members: markdownDraft.members.map((member) =>
    member.id === added.selectedMemberId
      ? { ...member, toolsEnabledText: '{ invalid json' }
      : member,
  ),
};
const invalidMcpResult = validateTeamPresetDraft(invalidMcpDraft);
check(
  'invalid MCP JSON is reported against the edited member',
  invalidMcpResult.issue?.memberId === added.selectedMemberId &&
    invalidMcpResult.issue.message ===
      'Invalid JSON format. Please check your syntax.',
  invalidMcpResult,
);

const blankNameInvalidMcp = {
  ...draft,
  members: [{ ...draft.members[0]!, toolsEnabledText: '{ invalid json' }],
};
const memberOnlyMcpResult = validateMemberToolsEnabledDraft(
  blankNameInvalidMcp,
  'lead',
);
check(
  'MCP blur validation targets tools JSON before whole-form required fields',
  memberOnlyMcpResult?.memberId === 'lead' &&
    memberOnlyMcpResult.message ===
      'Invalid JSON format. Please check your syntax.',
  memberOnlyMcpResult,
);

const fixedMcpDraft = {
  ...markdownDraft,
  members: markdownDraft.members.map((member) =>
    member.id === added.selectedMemberId
      ? {
          ...member,
          toolsEnabledText: '{"mcpServers":{"filesystem":true}}',
          selectedSkillIdsText: 'review, planning',
        }
      : member,
  ),
};
const payload = teamPresetDraftToPayload(fixedMcpDraft);
check(
  'payload mapping filters blank workflow steps and parses MCP JSON',
    payload.workflow_steps.length === 1 &&
    payload.workflow_steps[0]?.title === 'Plan' &&
    Boolean(payload.members[1]?.tools_enabled) &&
    typeof payload.members[1].tools_enabled === 'object' &&
    !Array.isArray(payload.members[1].tools_enabled),
  payload,
);

const tierGroups = groupTeamTemplatesByTier([
  { id: 'advanced-one', tier: 'advanced' },
  { id: 'standard-one', tier: 'standard' },
  { id: 'advanced-two', tier: 'advanced' },
] as TeamPresetSummary[]);
check(
  'tier grouping keeps API order within standard and advanced groups',
  tierGroups.standard.map((template) => template.id).join(',') === 'standard-one' &&
    tierGroups.advanced.map((template) => template.id).join(',') ===
      'advanced-one,advanced-two',
  tierGroups,
);

const advancedDetail: ChatTeamPreset = {
  id: 'custom-advanced',
  name: 'Advanced custom team',
  description: '',
  members: [
    {
      id: 'advanced-lead',
      name: 'Advanced lead',
      description: '',
      runner_type: 'CODEX',
      recommended_model: 'test-model',
      execution_config: completeExecutionConfig,
      system_prompt: '',
      default_workspace_path: null,
      selected_skill_ids: [],
      tools_enabled: { web_search: true },
      is_builtin: false,
      enabled: true,
    },
  ],
  lead_member_id: 'advanced-lead',
  workflow_steps: [],
  team_protocol: '',
  is_builtin: false,
  enabled: true,
  tier: 'advanced',
};
const advancedDraft = teamPresetDetailToDraft(advancedDetail);
const advancedPayload = teamPresetDraftToPayload(advancedDraft);
const advancedPreview = teamPresetDraftToPreviewDetail(advancedDraft);
check(
  'editing preserves an API-provided tier and complete execution config',
  advancedDraft.tier === 'advanced' &&
    advancedPayload.tier === 'advanced' &&
    advancedPreview.tier === 'advanced' &&
    JSON.stringify(advancedPayload.members[0]?.execution_config) ===
      JSON.stringify(completeExecutionConfig) &&
    JSON.stringify(advancedPreview.members[0]?.execution_config) ===
      JSON.stringify(completeExecutionConfig),
  { advancedDraft, advancedPayload, advancedPreview },
);

check(
  'edit form echoes canonical MCP servers as editable JSON',
  advancedDraft.members[0]?.mcpConfigText.includes('"fake_local"') === true &&
    advancedDraft.members[0]?.mcpConfigText.includes('"mcpServers"') === true,
);

const editedMcpDraft = {
  ...advancedDraft,
  members: advancedDraft.members.map((member) => ({
    ...member,
    mcpConfigText: JSON.stringify(
      { mcpServers: { fake_extra: { command: 'fake-extra-server' } } },
      null,
      2,
    ),
  })),
};
const editedMcpPayload = teamPresetDraftToPayload(editedMcpDraft);
const editedMcpConfig = editedMcpPayload.members[0]?.execution_config;
check(
  'edited MCP JSON merges into a deep-copied execution config',
  editedMcpConfig?.mcp?.mcpServers.fake_extra !== undefined &&
    editedMcpConfig?.mcp?.mcpServers.fake_local === undefined &&
    editedMcpConfig?.thinking_effort === 'high' &&
    editedMcpConfig?.acp?.access_mode === 'workspace_only' &&
    advancedDetail.members[0]?.execution_config?.mcp?.mcpServers
      .fake_local !== undefined,
);

editedMcpDraft.members[0]!.mcpConfigText = JSON.stringify({
  mcpServers: { fake_renamed: { command: 'fake-renamed-server' } },
});
check(
  'draft edits after submit never mutate the submitted payload',
  (
    editedMcpPayload.members[0]?.execution_config?.mcp?.mcpServers
      .fake_extra as { command: string } | undefined
  )?.command === 'fake-extra-server' &&
    editedMcpPayload.members[0]?.execution_config?.mcp?.mcpServers
      .fake_renamed === undefined,
);

const renamedPayload = teamPresetDraftToPayload(editedMcpDraft);
const renamedServer = renamedPayload.members[0]?.execution_config?.mcp
  ?.mcpServers.fake_renamed as { command: string } | undefined;
if (renamedServer) renamedServer.command = 'mutated-after-submit';
const reparsedPayload = teamPresetDraftToPayload(editedMcpDraft);
check(
  'mutating a submitted payload never leaks back into the draft',
  (
    reparsedPayload.members[0]?.execution_config?.mcp?.mcpServers
      .fake_renamed as { command: string } | undefined
  )?.command === 'fake-renamed-server',
);

const brokenSecretDraft = {
  ...draft,
  name: 'Secret-bearing team',
  members: [
    {
      ...draft.members[0]!,
      mcpConfigText:
        '{ "mcpServers": { "fake_local": { "env": { "API_TOKEN": "fake-template-token" } }',
    },
  ],
};
const brokenSecretResult = validateTeamPresetDraft(brokenSecretDraft);
check(
  'invalid canonical MCP JSON blocks submit with a member-scoped secret-free error',
  brokenSecretResult.issue?.memberId === 'lead' &&
    brokenSecretResult.issue.fieldKey === 'member:lead:mcp_config' &&
    brokenSecretResult.issue.message ===
      'Invalid JSON format. Please check your syntax.' &&
    !brokenSecretResult.issue.message.includes('fake-template-token'),
);

const wrongShapeDraft = {
  ...draft,
  name: 'Secret-bearing team',
  members: [
    {
      ...draft.members[0]!,
      mcpConfigText: '{ "mcpServers": "fake-template-token" }',
    },
  ],
};
const wrongShapeResult = validateTeamPresetDraft(wrongShapeDraft);
check(
  'non-object MCP servers are rejected without echoing config values',
  Boolean(wrongShapeResult.issue?.message) &&
    !(wrongShapeResult.issue?.message ?? '').includes('fake-template-token'),
);

check(
  'member-scoped MCP validation mirrors the tools blur path',
  validateMemberMcpConfigDraft(createTeamPresetDraft(), 'lead') === null &&
    validateMemberMcpConfigDraft(brokenSecretDraft, 'lead')?.fieldKey ===
      'member:lead:mcp_config',
);

const invalidMemberName = validateTeamPresetDraft({
  ...draft,
  name: 'Needs member name',
  members: [{ ...draft.members[0]!, name: '' }],
});
check(
  'member name validation runs before submit',
  invalidMemberName.issue?.message === 'Member name is required.',
  invalidMemberName,
);

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost',
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
dom.window.matchMedia ??= () =>
  ({
    matches: false,
    media: '',
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;

const uiRequests: Array<{ body?: string; method: string; url: string }> = [];
const uiLead: ChatMemberPreset = {
  id: 'localized-lead',
  name: 'Localized lead',
  description: 'Leads the localized team.',
  runner_type: 'CODEX',
  recommended_model: 'test-model',
  system_prompt: 'Lead the team.',
  default_workspace_path: null,
  selected_skill_ids: [],
  tools_enabled: { web_search: true },
  execution_config: completeExecutionConfig,
  is_builtin: true,
  enabled: true,
};
const detailForLocale = (locale: string): ChatTeamPreset => ({
  id: 'localized-team',
  name: locale === 'zh' ? '中文团队' : 'English team',
  description: '',
  members: [uiLead],
  lead_member_id: uiLead.id,
  workflow_steps: [],
  team_protocol: locale === 'zh' ? '中文协议' : 'English protocol',
  is_builtin: true,
  enabled: true,
  tier: 'advanced',
});
const summaryForLocale = (locale: string): TeamPresetSummary => {
  const detail = detailForLocale(locale);
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    lead_member_id: detail.lead_member_id ?? null,
    team_protocol: detail.team_protocol,
    is_builtin: detail.is_builtin,
    enabled: detail.enabled,
    tier: detail.tier,
    member_count: detail.members.length,
    members: detail.members.map((member) => ({
      id: member.id,
      name: member.name,
      description: member.description ?? null,
      runner_type: member.runner_type,
      recommended_model: member.recommended_model,
      is_builtin: member.is_builtin,
      enabled: member.enabled,
    })),
  };
};
const apiResponse = (data: unknown) => jsonResponse(data);
let deferChineseDetail = false;
let resolveDeferredChineseDetail: ((response: Response) => void) | null = null;

globalThis.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
  const url = String(input);
  const method = options?.method ?? 'GET';
  uiRequests.push({ url, method, body: typeof options?.body === 'string' ? options.body : undefined });
  const parsed = new URL(url, 'http://localhost');
  const locale = parsed.searchParams.get('locale') ?? 'en';

  if (parsed.pathname === '/api/team-presets' && method === 'GET') {
    return apiResponse({ teams: [summaryForLocale(locale)] });
  }
  if (parsed.pathname === '/api/team-presets/localized-team' && method === 'GET') {
    if (locale === 'zh' && deferChineseDetail) {
      return new Promise<Response>((resolve) => {
        resolveDeferredChineseDetail = resolve;
      });
    }
    return apiResponse(detailForLocale(locale));
  }
  if (parsed.pathname === '/api/agents/runtime') {
    return apiResponse({
      runners: [
        {
          runner_type: 'CODEX',
          installed: true,
          executable: true,
          last_error: null,
          discovered_models: ['test-model'],
          executor_options: { model: 'test-model' },
          env_summary: [],
        },
      ],
    });
  }
  if (parsed.pathname === '/api/projects/project-1/members' && method === 'GET') {
    return apiResponse([]);
  }
  if (parsed.pathname === '/api/projects/project-1/members' && method === 'POST') {
    return apiResponse({ id: 'project-member-1', agent_id: 'agent-1', role: 'lead' });
  }
  if (parsed.pathname === '/api/projects/project-1/sessions') {
    return apiResponse([{ id: 'session-1' }]);
  }
  if (
    parsed.pathname === '/api/projects/project-1/team-protocol' &&
    method === 'PUT'
  ) {
    return apiResponse(JSON.parse(String(options?.body)));
  }
  if (parsed.pathname === '/api/chat/agents' && method === 'GET') {
    return apiResponse([]);
  }
  if (parsed.pathname === '/api/chat/agents' && method === 'POST') {
    return apiResponse({ id: 'agent-1', name: 'Localized lead' });
  }
  if (parsed.pathname === '/api/chat/sessions/session-1/agents') {
    return apiResponse([]);
  }
  if (parsed.pathname === '/api/chat/sessions/session-1' && method === 'PUT') {
    return apiResponse({});
  }
  return apiResponse([]);
}) as typeof fetch;

let setHarnessLocale: ((locale: Locale) => void) | null = null;
const toastMessages: string[] = [];
const WorkspaceHarness = () => {
  const [locale, setLocale] = useState<Locale>('en');
  setHarnessLocale = setLocale;
  const workspace = {
    locale,
    setLocale,
    projects: [{ id: 'project-1', default_workspace_path: '/workspace' }],
    selectedProjectId: 'project-1',
    refreshMembers: async () => undefined,
    refreshSessions: async () => undefined,
    showToast: (message: string) => {
      toastMessages.push(String(message));
    },
    skills: [],
    t: (key: string) => key,
  } as unknown as WorkspaceContextProps;

  return createElement(
    WorkspaceContext.Provider,
    { value: workspace },
    createElement(TeamTemplatesPage),
  );
};
const rootElement = dom.window.document.getElementById('root');
if (!rootElement) throw new Error('Missing test root element.');
const root = createRoot(rootElement);
const flushUi = async () => {
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
};

await act(async () => {
  root.render(createElement(WorkspaceHarness));
  await flushUi();
});
const templateCard = rootElement.querySelector<HTMLElement>('.team-template-card');
if (!templateCard) throw new Error('Localized template card did not render.');
await act(async () => {
  templateCard.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flushUi();
});
await act(async () => {
  deferChineseDetail = true;
  setHarnessLocale?.('zh');
  await flushUi();
});
await act(async () => {
  setHarnessLocale?.('en');
  await flushUi();
});
await act(async () => {
  resolveDeferredChineseDetail?.(apiResponse(detailForLocale('zh')));
  await flushUi();
});
check(
  'rendered page ignores an expired localized detail response',
  rootElement.textContent?.includes('English team') === true,
  uiRequests,
);
await act(async () => {
  deferChineseDetail = false;
  setHarnessLocale?.('zh');
  await flushUi();
});
check(
  'rendered page reloads list and current detail after Workspace locale changes',
  uiRequests.some((request) => request.url === '/api/team-presets?locale=zh') &&
    uiRequests.some(
      (request) => request.url === '/api/team-presets/localized-team?locale=zh',
    ) &&
    rootElement.textContent?.includes('中文团队') === true,
  uiRequests,
);
const useTemplateButton = Array.from(rootElement.querySelectorAll('button')).find(
  (button) => button.textContent?.includes('Use template'),
);
if (!useTemplateButton) throw new Error('Use template button did not render.');
await act(async () => {
  useTemplateButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flushUi();
});
const confirmButton = Array.from(rootElement.querySelectorAll('button')).find(
  (button) => button.textContent?.includes('Confirm replacement'),
);
if (!confirmButton) throw new Error('Confirm template application button did not render.');
const detailRequestCountBeforeApply = uiRequests.filter(
  (request) => request.url === '/api/team-presets/localized-team?locale=zh',
).length;
await act(async () => {
  confirmButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flushUi();
});
const sessionUpdate = uiRequests.find(
  (request) =>
    request.url === '/api/chat/sessions/session-1' && request.method === 'PUT',
);
const projectProtocolUpdate = uiRequests.find(
  (request) =>
    request.url === '/api/projects/project-1/team-protocol' &&
    request.method === 'PUT',
);
const projectMemberCreate = uiRequests.find(
  (request) =>
    request.url === '/api/projects/project-1/members' &&
    request.method === 'POST',
);
const agentCreate = uiRequests.find(
  (request) =>
    request.url === '/api/chat/agents' && request.method === 'POST',
);
const sessionUpdatePayload = JSON.parse(sessionUpdate?.body ?? '{}');
const projectProtocolPayload = JSON.parse(projectProtocolUpdate?.body ?? '{}');
const projectMemberPayload = JSON.parse(projectMemberCreate?.body ?? '{}');
const agentPayload = JSON.parse(agentCreate?.body ?? '{}');
check(
  'rendered apply sends the complete execution config and keeps tools separate',
  projectMemberPayload.execution_config?.runner_type === 'CODEX' &&
    projectMemberPayload.execution_config?.model_name === 'test-model' &&
    projectMemberPayload.execution_config?.thinking_effort === 'high' &&
    projectMemberPayload.execution_config?.model_variant === 'fake-variant' &&
    projectMemberPayload.execution_config?.acp?.access_mode ===
      'workspace_only' &&
    projectMemberPayload.execution_config?.mcp?.mcpServers?.fake_local?.env
      ?.API_TOKEN === 'fake-template-token' &&
    agentPayload.tools_enabled?.web_search === true &&
    !('mcpServers' in (agentPayload.tools_enabled ?? {})),
  { agentPayload, projectMemberPayload },
);
check(
  'rendered page applies the freshly fetched localized protocol to the project only',
  projectProtocolPayload.content === '中文协议' &&
    projectProtocolPayload.enabled === true &&
    sessionUpdatePayload.lead_agent_id === 'agent-1' &&
    !('team_protocol' in sessionUpdatePayload) &&
    !('team_protocol_enabled' in sessionUpdatePayload) &&
    uiRequests.filter(
      (request) => request.url === '/api/team-presets/localized-team?locale=zh',
    ).length > detailRequestCountBeforeApply,
  {
    detailRequestCountBeforeApply,
    projectProtocolUpdate,
    sessionUpdate,
    uiRequests,
  },
);
check(
  'rendered secret-bearing template shows no sensitive-value copy hint',
  !/(sensitive|secret|敏感)/i.test(rootElement.textContent ?? ''),
);
check(
  'toasts never print fake config secrets',
  toastMessages.every(
    (message) =>
      !FAKE_CONFIG_SECRETS.some((secret) => message.includes(secret)),
  ),
  toastMessages,
);
await act(async () => {
  root.unmount();
});
dom.window.close();

check('loads templates through the locale-aware API adapter', source.includes('teamPresetsApi.list(locale)'));
check('loads template details with the current locale', source.includes('teamPresetsApi.get(teamId, locale)'));
check('groups API templates by their backend tier', source.includes('groupTeamTemplatesByTier(templates)') && source.includes('standardTemplates') && source.includes('advancedTemplates'));
check('removes local advanced template and detail mock content', !source.includes('const advanced' + 'TeamTemplates') && !source.includes('const mock' + 'TeamTemplateDetails'));
check('keeps the detail page in the Linear-style pipeline layout', source.includes('team-template-workflow-preview') && source.includes('PIPELINE /') && source.includes('MEMBERS /'));
check('shows recoverable loading errors', source.includes('loadError') && source.includes('loadTemplates()'));
check('shows an empty standard-template state', source.includes('standardTemplates.length === 0'));
check('keeps built-in templates read-only', source.includes('selectedDetail.is_builtin') && source.includes('canEditSelected'));
check('supports create, update, and delete flows', source.includes('teamPresetsApi.create') && source.includes('teamPresetsApi.update') && source.includes('teamPresetsApi.delete'));
check('confirms deletion before mutating', source.includes('window.confirm'));
check('preserves form input on save failure', source.includes('setFormError(errorMessage') && source.includes('return;'));
check('confirms unsaved editor exit before leaving edit mode', source.includes('UnsavedEditorExitDialog') && source.includes('hasUnsavedEditorChanges') && source.includes('teamTemplates.unsaved.saveAndExit') && source.includes('teamTemplates.unsaved.discard') && source.includes('teamTemplates.exit') && source.includes('teamTemplates.back'));
check('auto-generates template ids and hides low-value toggles in the editor', source.includes('createUniqueTemplateId') && !source.includes('label="模板 ID"') && !source.includes('Enabled in picker'));
check('uses content-as-ui document header in edit mode', source.includes('team-template-document-head') && source.includes('team-template-document-title') && source.includes('team-template-document-description') && source.includes('absolute right-0 top-0') && !source.includes('label="团队名"') && !source.includes('label="描述"'));
check('uses edit-mode auto-save with a subtle saved status', source.includes('editorSaveStatus') && source.includes('autoSaveTemplate(form)') && source.includes('Draft backed up') && source.includes('window.setTimeout'));
check('folds edit-mode delete into the more menu', source.includes('MoreHorizontal') && source.includes('Delete template') && source.includes('setMoreMenuOpen') && !source.includes('mt-8 flex flex-wrap items-center justify-end gap-3 border-t'));
check('shows member skills and role prompt details', source.includes('selected_skill_ids') && source.includes('system_prompt'));
check(
  'keeps the localized lead label compact and on one line without inferring a fallback lead',
  source.includes(
    'inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[10px] font-semibold uppercase tracking-[0.04em]',
  ) &&
    source.includes('const isLead = member.id === viewDetail.lead_member_id') &&
    !source.includes('viewDetail.lead_member_id ?? viewDetail.members[0]?.id'),
  source,
);
check('uses shared DropdownSelect for member runtime and model picking', source.includes('DropdownSelect') && source.includes('runtimeOptions') && source.includes('modelOptions') && source.includes('setRuntimes(response.runners)'));
check('uses shared DropdownSelect for runtime-specific skill picking', source.includes('selectionMode="multiple"') && source.includes('listNative(effectiveRunnerType)') && source.includes('runtimeSkills') && source.includes('skillPlaceholder') && !source.includes('技能 ID（逗号分隔）'));
check('keeps Linear visual refinement hooks', source.includes('team-template-card') && source.includes('team-template-member-row') && source.includes('team-template-field'));
check('uses the brand theme for create and use-template actions', source.includes('brandPrimaryButtonClassName') && source.includes('bg-[var(--primary)]') && source.includes('hover:bg-[var(--primary-hover)]'));
check('uses aggregate draft workflow steps', source.includes('workflowSteps') && source.includes('normalizeWorkflowSteps'));
check('uses only backend workflow steps and has an explicit empty state', source.includes('const workflowSteps = isEditing && form ? form.workflowSteps : viewDetail.workflow_steps;') && source.includes('No workflow steps defined.') && !source.includes('presentation.workflow'));
check('supports editable markdown fields rendered with AgentMarkdown', source.includes('function MarkdownEditableField') && source.includes('<AgentMarkdown content={value}'));
check('edits member tool JSON through toolsEnabledText', source.includes('toolsEnabledText') && source.includes('parseToolsEnabled'));
check('edits canonical member MCP JSON through mcpConfigText', source.includes('mcpConfigText') && source.includes('parseMemberMcpServers') && source.includes('memberMcpServersJson'));
check('merges MCP edits into a deep-copied execution config', source.includes('memberFormExecutionConfig') && source.includes('structuredClone(member.executionConfig)'));
check('validates canonical MCP on blur through a member-scoped path', source.includes('validateMemberMcpOnBlur') && source.includes('{ validateMcp: true }') && source.includes('onValidateMemberMcp?.(nextForm, selectedFormMember.id)'));
check('keeps tools editing in its own section next to canonical MCP', source.includes('teamTemplates.member.tools') && source.includes('teamTemplates.member.noTools'));
check('template UI never renders sensitive-value copy hints', !/(sensitive value|secret value|敏感)/i.test(source));
check('validates required team and member fields before saving', source.includes('validateTeamPresetForm') && source.includes('Team name is required.') && source.includes('Member name is required.'));
check('blocks invalid MCP JSON before payload submission', source.includes('Invalid JSON format. Please check your syntax.'));
check('MCP blur validation sets visible member tool errors', source.includes('validateMemberToolsOnBlur') && source.includes('setFormError(issue.message)') && source.includes('setEditorSelectedMemberId(issue.memberId)'));
check('MCP blur uses member-scoped validation instead of whole-form validation', source.includes('{ validateTools: true }') && source.includes('onValidateMemberTools?.(nextForm, selectedFormMember.id)'));
check('workflow step edit keys stay stable while title changes', source.includes('key={`workflow-step-${index}`}') && !source.includes('key={`${index}-${step.title}`}'));
check('workflow edit fields use compact text-flow editing', source.includes('team-template-deboxed-workflow') && source.includes('team-template-compact-workflow-step') && source.includes('grid-cols-[24px_minmax(0,1fr)_24px]') && source.includes('team-template-workflow-step-title') && source.includes('team-template-workflow-step-description') && !source.includes('label="步骤标题"') && !source.includes('label="步骤描述"'));
check('edit detail uses compact Linear density and hover-revealed actions', source.includes('team-template-compact-editor') && source.includes('team-template-compact-field') && source.includes('variant="inline"') && source.includes('group-hover:pointer-events-auto') && source.includes('compact'));
check('edit detail removes the large title-to-content spacer but keeps title breathing room', source.includes('editable ? "pt-3"') && source.includes('isEditing ? "pt-3"') && source.includes('isEditing ? "gap-8" : "gap-12"') && !source.includes('mt-8 gap-8') && !source.includes('isEditing ? "pb-8"'));
check('workflow and member headings align on the same row height', source.includes('mb-3 flex min-h-7 items-center justify-between gap-3') && source.includes('mb-2 flex min-h-7 items-center justify-between gap-3'));
check('editable MCP JSON uses code editor visual treatment', source.includes('pl-10 pr-3 font-mono') && styleSource.includes('--team-template-code-surface: #0f1011'));
check('new/edit detail uses sharp field focus tokens', source.includes('focus:border-[var(--team-template-field-focus)]') && styleSource.includes('--team-template-field-surface'));
check('delete actions expose deleting state', source.includes('Deleting...') && source.includes('deleting={deleting}') && source.includes('setEditorMode(null);'));
check('reuses TemplateDetailView for create and edit mode', !source.includes('<TemplateEditor') && source.includes('editorMode={editorMode}'));
check('adds and auto-selects custom member drafts', source.includes('addCustomMember') && source.includes('setSelectedMemberId(nextMember.id)'));
check('keeps readonly detail rendering isolated from editable controls', source.includes('const isEditing = Boolean(editorMode && form)') && source.includes('canEdit && !isEditing'));
check(
  'console output never prints fake config secrets',
  consoleOutputLines.every(
    (line) => !FAKE_CONFIG_SECRETS.some((secret) => line.includes(secret)),
  ),
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll TeamTemplatesPage assertions passed.');
}