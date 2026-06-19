import { githubAuthApi, projectGithubApi } from '../../lib/api';

let failures = 0;

const check = (label: string, condition: boolean, detail?: unknown) => {
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${label}`, detail ?? '');
  } else {
    console.log(`ok ${label}`);
  }
};

const originalFetch = globalThis.fetch;
let requestedUrl = '';
let requestedBody: unknown = null;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  requestedUrl = String(input);
  requestedBody =
    typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? null;
  return new Response(
    JSON.stringify({
      success: true,
      data:
        requestedUrl === '/api/github/repos'
          ? [
              {
                id: 1,
                node_id: 'node-1',
                full_name: 'open/team',
                owner: 'open',
                name: 'team',
                private: false,
                default_branch: 'main',
                html_url: 'https://github.com/open/team',
                clone_url: 'https://github.com/open/team.git',
                ssh_url: 'git@github.com:open/team.git',
                updated_at: '2026-06-06T00:00:00Z',
              },
            ]
          : {
              id: 'integration-1',
              repo_id: 'repo-1',
              provider: 'github',
              owner: 'open',
              name: 'team',
              remote_url: 'https://github.com/open/team.git',
              default_branch: 'main',
              external_id: 'node-1',
              installation_id: null,
              github_account_id: null,
              repo_grant_json: null,
              role: 'primary',
              sync_status: 'connected',
              last_synced_at: null,
              last_error: null,
              created_at: '2026-06-06T00:00:00Z',
              updated_at: '2026-06-06T00:00:00Z',
            },
      message: null,
      error_data: null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}) as typeof fetch;

const repos = await githubAuthApi.listRepos();

check('github repo list uses local backend endpoint', requestedUrl === '/api/github/repos');
check(
  'github repo list returns repository summary contract',
  repos[0]?.full_name === 'open/team' &&
    repos[0]?.owner === 'open' &&
    repos[0]?.clone_url.endsWith('.git') &&
    repos[0]?.default_branch === 'main',
  repos[0],
);

await projectGithubApi.createRepo('project-1', {
  repo_id: null,
  provider: 'github',
  owner: 'open',
  name: 'team',
  full_name: 'open/team',
  html_url: 'https://github.com/open/team',
  clone_url: 'https://github.com/open/team.git',
  ssh_url: 'git@github.com:open/team.git',
  remote_url: 'https://github.com/open/team.git',
  default_branch: 'main',
  external_id: 'node-1',
  sync_status: 'connected',
  repo_grant_json: null,
});
check(
  'project github binding can omit local repo_id and send selected GitHub fields',
  requestedUrl === '/api/projects/project-1/github/repos' &&
    JSON.stringify(requestedBody) ===
      JSON.stringify({
        repo_id: null,
        provider: 'github',
        owner: 'open',
        name: 'team',
        full_name: 'open/team',
        html_url: 'https://github.com/open/team',
        clone_url: 'https://github.com/open/team.git',
        ssh_url: 'git@github.com:open/team.git',
        remote_url: 'https://github.com/open/team.git',
        default_branch: 'main',
        external_id: 'node-1',
        sync_status: 'connected',
        repo_grant_json: null,
      }),
  { requestedUrl, requestedBody },
);

globalThis.fetch = originalFetch;

if (failures > 0) process.exit(1);
