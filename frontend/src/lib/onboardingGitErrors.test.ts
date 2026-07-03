// Focused behavior checks for onboarding workspace Git error presentation.
//
// Run with:
//     pnpm exec tsx src/lib/onboardingGitErrors.test.ts

import {
  normalizeGitignoreTemplateSelection,
  workspaceGitApiErrorI18nKey,
  workspaceGitErrorI18nKey,
  workspaceGitValidationErrorI18nKey,
} from './onboardingGitErrors';
import { WorkspaceGitErrorCode } from '@/types';

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

console.log('onboarding Git error helpers');

check(
  'validation error_code maps to a localized Git error key',
  workspaceGitValidationErrorI18nKey({
    error_code: WorkspaceGitErrorCode.workspace_path_not_found,
  }) === 'onboarding.project.gitError.workspace_path_not_found',
);

check(
  'ApiError errorData code maps to a localized Git error key',
  workspaceGitApiErrorI18nKey({
    errorData: {
      code: 'invalid_gitignore_template',
      message: 'raw backend text',
    },
  }) === 'onboarding.project.gitError.invalid_gitignore_template',
);

check(
  'unknown backend codes fall back to the safe generic key',
  workspaceGitErrorI18nKey('git2_internal_error') ===
    'onboarding.project.gitError.generic',
);

check(
  'missing ApiError data falls back to the safe generic key',
  workspaceGitApiErrorI18nKey(new Error('raw git2 error')) ===
    'onboarding.project.gitError.generic',
);

check(
  'none, empty, and unselected gitignore templates submit null',
  normalizeGitignoreTemplateSelection('none') === null &&
    normalizeGitignoreTemplateSelection('') === null &&
    normalizeGitignoreTemplateSelection(null) === null,
);

check(
  'backend template ids submit unchanged after trimming',
  normalizeGitignoreTemplateSelection('  node  ') === 'node',
);

if (failures > 0) {
  process.exitCode = 1;
}
