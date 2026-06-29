// Static checks for the onboarding API client.
//
// Run with:
//     pnpm exec tsx src/lib/onboardingApi.test.ts

import { readFileSync } from 'node:fs';

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

console.log('onboarding API client');

const source = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

check(
  'imports generated onboarding types from shared types',
    source.includes('OnboardingState') &&
    source.includes('UpdateOnboardingStateRequest') &&
    source.includes('MarkUpgradeReadRequest') &&
    (source.includes("from '../../../shared/types'") ||
      source.includes('from "../../../shared/types"')),
  source,
);

check(
  'exposes a focused onboarding API client',
  source.includes('export const onboardingApi =') &&
    source.includes('/api/onboarding/state') &&
    source.includes('/api/onboarding/complete') &&
    source.includes('/api/onboarding/reset') &&
    source.includes('/api/onboarding/upgrade/read') &&
    source.includes('/api/onboarding/upgrade/reset'),
  source,
);

check(
  'uses typed request and response shapes without hand-written persistence types',
  source.includes('getState: async (): Promise<OnboardingState>') &&
    source.includes('data: UpdateOnboardingStateRequest') &&
    source.includes('data?: UpdateOnboardingStateRequest') &&
    source.includes('data: MarkUpgradeReadRequest') &&
    (source.match(/Promise<OnboardingState>/g) ?? []).length >= 6,
  source,
);

check(
  'adds onboarding to the aggregate API export',
  source.includes('onboarding: onboardingApi'),
  source,
);

if (failures > 0) {
  process.exitCode = 1;
}
