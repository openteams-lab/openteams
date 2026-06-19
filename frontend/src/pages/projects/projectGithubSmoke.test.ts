import { readFileSync } from 'node:fs';

let failures = 0;

const check = (label: string, condition: boolean, detail?: unknown) => {
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${label}`, detail ?? '');
  } else {
    console.log(`ok ${label}`);
  }
};

const apiSource = readFileSync(
  new URL('../../lib/api.ts', import.meta.url),
  'utf8',
);
const shellSource = readFileSync(
  new URL('./ProjectShell.tsx', import.meta.url),
  'utf8',
);
const deliverySource = readFileSync(
  new URL('./ProjectDeliveryStats.tsx', import.meta.url),
  'utf8',
);
const prSource = readFileSync(
  new URL('./ProjectPrCreateFlow.tsx', import.meta.url),
  'utf8',
);

check(
  'GitHub API wrapper only targets local backend routes',
  apiSource.includes('/api/github/auth/device/start') &&
    apiSource.includes('/api/projects/${encodeURIComponent(projectId)}/github/issues') &&
    !apiSource.includes('api.github.com'),
);
check(
  'project shell exposes required GitHub work areas',
  ['Connection', 'Issues', 'Work items', 'Create PR', 'Delivery'].every((label) =>
    shellSource.includes(label),
  ),
);
check(
  'delivery stats call project delivery records endpoints',
  deliverySource.includes('deliveryApi.getStats') &&
    deliverySource.includes('deliveryApi.listRecords') &&
    deliverySource.includes('project_delivery_records') &&
    !deliverySource.includes('project_delivery_events'),
);
check(
  'PR flow warns about unsupported file-level assembly',
  prSource.includes('no cherry-pick or file-level assembly') &&
    prSource.includes('Confirm local git push') &&
    prSource.includes('Retry pending PR creation'),
);

if (failures > 0) process.exit(1);
