import {
  DEVICE_FLOW_POLL_INTERVAL_MS,
  formatRepoGrant,
  getDeviceFlowOpenUrl,
  parseRepoGrant,
  shouldContinueDeviceFlowPolling,
} from './ProjectGitHubSettings';

let failures = 0;

const check = (label: string, condition: boolean, detail?: unknown) => {
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${label}`, detail ?? '');
  } else {
    console.log(`ok ${label}`);
  }
};

const grant = parseRepoGrant(
  '{"permissions":["metadata","contents","issues","pull_requests"],"selection":"selected"}',
) as { permissions?: string[]; selection?: string };

check(
  'repo grant parser preserves permissions',
  Array.isArray(grant.permissions) && grant.permissions.includes('issues'),
  grant,
);
check('repo grant parser preserves selection', grant.selection === 'selected', grant);
check('empty repo grant becomes null', parseRepoGrant('') === null);
check(
  'repo grant formatter exposes repo_grant_json content',
  formatRepoGrant({ permissions: ['metadata'] }).includes('"permissions"'),
);

let invalidJsonFailed = false;
try {
  parseRepoGrant('{invalid');
} catch {
  invalidJsonFailed = true;
}
check('invalid repo grant JSON is rejected before submit', invalidJsonFailed);
check(
  'device flow opens prefilled verification uri when backend provides it',
  getDeviceFlowOpenUrl({
    device_code: 'device',
    user_code: 'ABCD-1234',
    verification_uri: 'https://github.com/login/device',
    verification_uri_complete: 'https://github.com/login/device?user_code=ABCD-1234',
    expires_in: 900,
    interval: 5,
  }) === 'https://github.com/login/device?user_code=ABCD-1234',
);
check(
  'device flow falls back to plain verification uri',
  getDeviceFlowOpenUrl({
    device_code: 'device',
    user_code: 'ABCD-1234',
    verification_uri: 'https://github.com/login/device',
    verification_uri_complete: null,
    expires_in: 900,
    interval: 5,
  }) === 'https://github.com/login/device',
);
check('device flow polling runs every second', DEVICE_FLOW_POLL_INTERVAL_MS === 1000);
check(
  'device flow keeps polling pending and slow_down statuses only',
  shouldContinueDeviceFlowPolling('pending') &&
    shouldContinueDeviceFlowPolling('slow_down') &&
    !shouldContinueDeviceFlowPolling('authorized') &&
    !shouldContinueDeviceFlowPolling('expired') &&
    !shouldContinueDeviceFlowPolling('denied') &&
    !shouldContinueDeviceFlowPolling('error'),
);

if (failures > 0) process.exit(1);
