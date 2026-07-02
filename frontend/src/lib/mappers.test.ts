// Smoke tests for backend -> UI mappers.
//
// This project has no test runner installed (no jest/vitest). Run with:
//     pnpm exec tsx src/lib/mappers.test.ts
// Exits non-zero if any assertion fails.

import type {
  BackendChatAgent,
  BackendChatMessage,
  BackendChatSession,
  BackendChatSessionAgent,
  CliConfig,
  ProviderInfo,
} from '@/types';
import {
  mapAgentToMember,
  mapMessage,
  mapMessages,
  mapProvider,
  mapSession,
  mapSessionAgentsToMembers,
  monogramFromName,
  renderKeyMask,
} from './mappers';
import {
  ProjectMemberType,
  type ProjectMemberWithRuntime,
} from '../../../shared/types';

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${label}`, detail ?? '');
  }
};

const eq = <T>(label: string, actual: T, expected: T) =>
  check(label, Object.is(actual, expected), { actual, expected });

// ---- monogramFromName -------------------------------------------------------
console.log('monogramFromName');
eq('handles empty', monogramFromName(''), '??');
eq('handles null', monogramFromName(null), '??');
eq('strips leading @ and uppercases', monogramFromName('@frontend'), 'FR');
eq('uses first two when split', monogramFromName('Bob Smith'), 'BS');
eq('handles underscores', monogramFromName('lead_agent'), 'LA');

// ---- renderKeyMask ----------------------------------------------------------
console.log('renderKeyMask');
eq('null -> bullets', renderKeyMask(null), '••••••••••••');
eq('empty -> bullets', renderKeyMask(''), '••••••••••••');
eq('short plaintext -> bullets', renderKeyMask('abc'), '••••••••••••');
eq(
  'long plaintext -> truncated mask',
  renderKeyMask('sk-1234567890abcd'),
  'sk-1••••••••••••',
);
eq(
  'pre-masked passes through',
  renderKeyMask('sk-ant***xyz9'),
  'sk-ant***xyz9',
);

// ---- mapSession -------------------------------------------------------------
console.log('mapSession');
const sessB: BackendChatSession = {
  id: 'sess-x',
  title: 'Fix login flicker',
  status: 'active',
  lead_agent_id: null,
  summary_text: null,
  archive_ref: null,
  last_seen_diff_key: null,
  team_protocol: null,
  team_protocol_enabled: false,
  default_workspace_path: null,
  chat_input_mode: null,
  project_id: 'project-x',
  worktree_mode: 'inherit',
  pinned_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  archived_at: null,
};
const sess = mapSession(sessB, { activeSessionId: 'sess-x' });
eq('session id', sess.id, 'sess-x');
eq('session title', sess.title, 'Fix login flicker');
eq('session active', sess.active, true);
eq('session default icon', sess.icon, 'message-square');
eq(
  'session unread agent completion indicator',
  mapSession(sessB, { hasUnreadAgentCompletion: true })
    .hasUnreadAgentCompletion,
  true,
);
eq(
  'session falls back when title null',
  mapSession({ ...sessB, title: null }).title,
  'Untitled session',
);

// ---- mapMessage -------------------------------------------------------------
console.log('mapMessage');
const now = new Date('2026-01-01T00:00:00Z');
const userMsg: BackendChatMessage = {
  id: 'm1',
  session_id: 'sess-x',
  sender_type: 'user',
  sender_id: null,
  content: 'hello',
  mentions: [],
  meta: { client_message_id: 'local-message-1' },
  created_at: '2026-01-01T00:00:00Z',
};
const u = mapMessage(userMsg, { now });
eq('user sender label', u.sender, 'You');
eq('user avatar', u.avatar, 'YOU');
eq('user isUser', u.isUser === true, true);
eq('text preserved', u.text, 'hello');
eq('client message id mapped from meta', u.clientMessageId, 'local-message-1');

const agentMsg: BackendChatMessage = {
  ...userMsg,
  id: 'm2',
  sender_type: 'agent',
  sender_id: 'agent-1',
  content: 'reply',
  meta: {
    run_id: 'run-1',
    session_agent_id: 'sa-1',
    reference: {
      message_id: 'm1',
    },
    attachments: [
      {
        id: 'att-1',
        name: 'screenshot.png',
        mime_type: 'image/png',
        size_bytes: 2048,
        kind: 'image',
        relative_path: 'chat/session_x/attachments/m2/screenshot.png',
      },
    ],
  },
  created_at: '2025-12-31T23:59:30Z',
};
const a = mapMessage(agentMsg, {
  agentNamesById: { 'agent-1': 'frontend' },
  agentModelsById: { 'agent-1': 'Claude 3.5 Sonnet' },
  now,
});
eq('agent sender prefixed', a.sender, '@frontend');
eq('agent avatar derived', a.avatar, 'FR');
eq('agent model carried through', a.model, 'Claude 3.5 Sonnet');
eq(
  'agent message model prefers run meta',
  mapMessage(
    {
      ...agentMsg,
      meta: {
        run_id: 'run-1',
        session_agent_id: 'sa-1',
        source_message_id: 'm1',
        model: 'gpt-5.5',
      },
    },
    {
      agentNamesById: { 'agent-1': 'frontend' },
      agentModelsById: { 'agent-1': 'codex-auto-review' },
      now,
    },
  ).model,
  'gpt-5.5',
);
eq('agent not isUser', a.isUser, undefined);
eq('agent run id mapped from meta', a.runId, 'run-1');
eq('agent session agent id mapped from meta', a.sessionAgentId, 'sa-1');
eq('agent reference message id mapped from meta', a.referenceMessageId, 'm1');
eq('agent attachment id mapped from meta', a.attachments?.[0]?.id, 'att-1');
eq(
  'agent attachment name mapped from meta',
  a.attachments?.[0]?.name,
  'screenshot.png',
);
eq('relative time 30s', a.time, '30s ago');

const emptyAgentWithError = mapMessage(
  {
    ...agentMsg,
    id: 'm3',
    content: '',
    meta: {
      error: {
        content: 'CLI exited before producing output',
        summary: 'CLI exited before producing output',
      },
    },
  },
  { now },
);
eq(
  'empty agent content uses error meta',
  emptyAgentWithError.text,
  'CLI exited before producing output',
);

const emptyAgentNoError = mapMessage(
  {
    ...agentMsg,
    id: 'm4',
    content: '',
    meta: {},
  },
  { now },
);
eq('empty agent content uses fallback', emptyAgentNoError.text, 'Agent运行失败');

eq(
  'mapMessages length matches',
  mapMessages([userMsg, agentMsg], { now }).length,
  2,
);

// ---- mapAgentToMember + mapSessionAgentsToMembers ---------------------------
console.log('mapAgentToMember');
const agentB: BackendChatAgent = {
  id: 'agent-1',
  name: 'frontend',
  runner_type: 'claude_code',
  system_prompt: '',
  tools_enabled: null,
  model_name: 'Claude 3.5 Sonnet',
  owner_project_id: null,
  created_at: '',
  updated_at: '',
};
const sessAgentB: BackendChatSessionAgent = {
  id: 'sa-1',
  session_id: 'sess-x',
  agent_id: 'agent-1',
  state: 'running',
  workspace_path: null,
  pty_session_key: null,
  agent_session_id: null,
  agent_message_id: null,
  allowed_skill_ids: [],
  created_at: '',
  updated_at: '',
};
const member = mapAgentToMember(agentB, { sessionAgent: sessAgentB });
eq('member id uses session-agent id', member.id, 'sa-1');
eq('member name handle', member.name, '@frontend');
eq('member status mapped from running', member.status, 'run');
eq('member modelName', member.modelName, 'Claude 3.5 Sonnet');
check(
  'member roleDetail includes state',
  member.roleDetail.includes('running'),
  member.roleDetail,
);
const memberWithExecutionOverride = mapAgentToMember(agentB, {
  sessionAgent: {
    ...sessAgentB,
    execution_config: {
      runner_type: 'CODEX',
      model_name: 'gpt-5.2-codex',
      thinking_effort: null,
      model_variant: null,
    },
  },
});
eq(
  'member modelName prefers session execution config',
  memberWithExecutionOverride.modelName,
  'gpt-5.2-codex',
);
const memberWithRunnerOverride = mapAgentToMember(agentB, {
  sessionAgent: {
    ...sessAgentB,
    execution_config: {
      runner_type: 'CODEX',
      model_name: null,
      thinking_effort: null,
      model_variant: null,
    },
  },
});
eq(
  'member runner override does not fall back to old agent model',
  memberWithRunnerOverride.modelName,
  'CODEX',
);

const membersJoined = mapSessionAgentsToMembers(
  [sessAgentB, { ...sessAgentB, id: 'sa-2', agent_id: 'missing' }],
  [agentB],
);
eq('joins by agent_id and drops orphans', membersJoined.length, 1);
const projectMemberB: ProjectMemberWithRuntime = {
  reasoning_capability: null,
  id: 'pm-1',
  project_id: 'project-1',
  member_type: ProjectMemberType.agent,
  user_id: null,
  agent_id: 'agent-1',
  member_name: 'project frontend',
  role: 'member',
  display_order: BigInt(1),
  default_workspace_path: null,
  allowed_skill_ids: [],
  execution_config: {},
  is_default: true,
  created_at: new Date(),
  updated_at: new Date(),
};
const membersJoinedWithProjectName = mapSessionAgentsToMembers(
  [{ ...sessAgentB, project_member_id: 'pm-1' }],
  [agentB],
  [projectMemberB],
);
eq(
  'session member name prefers project member name',
  membersJoinedWithProjectName[0]?.name,
  '@project frontend',
);

// ---- mapProvider ------------------------------------------------------------
console.log('mapProvider');
const info: ProviderInfo = {
  id: 'anthropic',
  name: 'Anthropic',
  configured: true,
};
const cli: CliConfig = {
  provider: {
    default: 'anthropic',
    anthropic: { api_key: 'sk-ant***wxyz', endpoint: null },
    openai: null,
    google: null,
    openrouter: null,
    minimax: null,
    ollama: null,
    custom: null,
  },
  model: { default: 'claude', anthropic: null, openai: null, google: null },
  behavior: { auto_approve: false, auto_compact: false },
};
const prov = mapProvider(info, cli);
eq('provider id', prov.id, 'anthropic');
eq('provider keyMask passes through pre-masked', prov.keyMask, 'sk-ant***wxyz');
eq('provider active follows configured', prov.active, true);
eq('provider lastUsed mock fallback', prov.lastUsed, 'Unknown');

const provNoCli = mapProvider(info, null);
eq(
  'provider falls back to bullets when no key',
  provNoCli.keyMask,
  '••••••••••••',
);

// ---- Result ----------------------------------------------------------------
if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll mapper assertions passed.');
}
