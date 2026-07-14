// Smoke tests for the team presets API adapter.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/lib/teamPresetsApi.test.ts
// Exits non-zero if any assertion fails.

import { teamPresetsApi } from './api';

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

type CapturedRequest = {
  url: string;
  options: RequestInit;
};

const captured: CapturedRequest[] = [];
const jsonResponse = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

globalThis.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
  captured.push({ url: String(input), options: options ?? {} });
  const url = String(input);
  if (url === '/api/team-presets') {
    return jsonResponse({ teams: [] });
  }
  if (url === '/api/team-presets/team-one') {
    if (options?.method === 'DELETE') return jsonResponse(null);
    return jsonResponse({
      id: 'team-one',
      name: 'Team one',
      description: 'First team',
      members: [],
      lead_member_id: 'lead',
      workflow_steps: [],
      team_protocol: 'Review before merge',
      is_builtin: false,
      enabled: true,
      tier: 'standard',
    });
  }
  return jsonResponse({});
}) as typeof fetch;

const writePayload = {
  id: 'team-one',
  name: 'Team one',
  description: 'First team',
  lead_member_id: 'lead',
  workflow_steps: [{ title: 'Plan', description: 'Set direction' }],
  team_protocol: 'Review before merge',
  enabled: true,
  tier: null,
  members: [
    {
      id: 'lead',
      name: 'Lead',
      description: 'Coordinates work',
      runner_type: null,
      recommended_model: null,
      system_prompt: 'Lead the team.',
      default_workspace_path: null,
      selected_skill_ids: ['planning'],
      tools_enabled: { mcpServers: { filesystem: true } },
      enabled: true,
    },
  ],
};

console.log('teamPresetsApi');

await teamPresetsApi.list('zh-CN');
await teamPresetsApi.get('team-one', 'fr');
await teamPresetsApi.create(writePayload);
await teamPresetsApi.update('team-one', writePayload);
await teamPresetsApi.delete('team-one');

check(
  'list sends an encoded locale query parameter',
  captured[0]?.url === '/api/team-presets?locale=zh-CN',
  captured[0],
);
check(
  'get encodes the team id and locale query parameter',
  captured[1]?.url === '/api/team-presets/team-one?locale=fr',
  captured[1],
);
check('create posts JSON to the collection', captured[2]?.options.method === 'POST', captured[2]);
check('update puts JSON to the detail endpoint', captured[3]?.options.method === 'PUT', captured[3]);
check('delete calls the detail endpoint', captured[4]?.options.method === 'DELETE', captured[4]);
check(
  'create sends the typed write payload',
  JSON.parse(String(captured[2]?.options.body)).id === 'team-one',
  captured[2],
);
check(
  'create sends aggregate members in the team payload',
  JSON.parse(String(captured[2]?.options.body)).members?.[0]?.tools_enabled?.mcpServers
    ?.filesystem === true,
  captured[2],
);
check(
  'update sends workflow steps in the aggregate payload',
  JSON.parse(String(captured[3]?.options.body)).workflow_steps?.[0]?.title === 'Plan',
  captured[3],
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll teamPresetsApi assertions passed.');
}
