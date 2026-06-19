import { presentGitHubError } from './githubErrorPresentation';

let failures = 0;

const check = (label: string, condition: boolean, detail?: unknown) => {
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${label}`, detail ?? '');
  } else {
    console.log(`ok ${label}`);
  }
};

const rateLimited = presentGitHubError({
  code: 'github_rate_limited',
  message: 'Try later',
  retry_after: '2026-06-05T12:00:00Z',
});
check('rate limit disables immediate retry', rateLimited.retryDisabled);
check('rate limit exposes retry-after action', rateLimited.action === 'retry_after');

const stale = presentGitHubError({
  code: 'github_stale_cache',
  message: 'Using cache',
  last_synced_at: '2026-06-04T12:00:00Z',
  stale: true,
});
check('stale cache maps to cached-data action', stale.action === 'use_cache');
check('stale cache keeps stale flag', stale.stale);

const disconnected = presentGitHubError({
  code: 'github_repo_disconnected',
  message: 'Reconnect repo',
});
check(
  'repo disconnected requires reconnect before retry',
  disconnected.action === 'reconnect_repo' && disconnected.retryDisabled,
  disconnected,
);

const push = presentGitHubError({
  code: 'local_git_push_failed',
  message: 'SSH denied',
});
check('local git push failure uses git credential action', push.action === 'fix_git_push');

if (failures > 0) process.exit(1);
