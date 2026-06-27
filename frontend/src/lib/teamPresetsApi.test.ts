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
      team: {
        id: 'team-one',
        name: 'Team one',
        description: 'First team',
        member_ids: ['lead'],
        lead_member_id: 'lead',
        team_protocol: 'Review before merge',
        is_builtin: false,
        enabled: true,
      },
      members: [],
    });
  }
  return jsonResponse({});
}) as typeof fetch;

const writePayload = {
  team: {
    id: 'team-one',
    name: 'Team one',
    description: 'First team',
    member_ids: ['lead'],
    lead_member_id: 'lead',
    team_protocol: 'Review before merge',
    enabled: true,
  },
  members: [],
};

console.log('teamPresetsApi');

await teamPresetsApi.list();
await teamPresetsApi.get('team-one');
await teamPresetsApi.create(writePayload);
await teamPresetsApi.update('team-one', writePayload);
await teamPresetsApi.delete('team-one');

check('list uses team-presets collection endpoint', captured[0]?.url === '/api/team-presets', captured[0]);
check('get encodes the team id', captured[1]?.url === '/api/team-presets/team-one', captured[1]);
check('create posts JSON to the collection', captured[2]?.options.method === 'POST', captured[2]);
check('update puts JSON to the detail endpoint', captured[3]?.options.method === 'PUT', captured[3]);
check('delete calls the detail endpoint', captured[4]?.options.method === 'DELETE', captured[4]);
check(
  'create sends the typed write payload',
  JSON.parse(String(captured[2]?.options.body)).team.id === 'team-one',
  captured[2],
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll teamPresetsApi assertions passed.');
}
