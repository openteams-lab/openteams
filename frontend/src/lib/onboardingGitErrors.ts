import type {
  ValidateWorkspacePathResponse,
  WorkspaceGitErrorCode,
  WorkspaceGitErrorData,
} from '@/types';

const gitErrorKeyPrefix = 'onboarding.project.gitError';

const workspaceGitErrorKeys = {
  workspace_path_required: `${gitErrorKeyPrefix}.workspace_path_required`,
  workspace_path_invalid: `${gitErrorKeyPrefix}.workspace_path_invalid`,
  workspace_path_not_found: `${gitErrorKeyPrefix}.workspace_path_not_found`,
  workspace_path_not_directory: `${gitErrorKeyPrefix}.workspace_path_not_directory`,
  workspace_path_not_accessible: `${gitErrorKeyPrefix}.workspace_path_not_accessible`,
  invalid_gitignore_template: `${gitErrorKeyPrefix}.invalid_gitignore_template`,
  git_init_failed: `${gitErrorKeyPrefix}.git_init_failed`,
  gitignore_write_failed: `${gitErrorKeyPrefix}.gitignore_write_failed`,
} satisfies Record<WorkspaceGitErrorCode, string>;

const genericGitErrorKey = `${gitErrorKeyPrefix}.generic`;

const isWorkspaceGitErrorCode = (
  value: unknown,
): value is WorkspaceGitErrorCode =>
  typeof value === 'string' && value in workspaceGitErrorKeys;

const isWorkspaceGitErrorData = (
  value: unknown,
): value is WorkspaceGitErrorData =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'code' in value &&
      isWorkspaceGitErrorCode((value as { code?: unknown }).code),
  );

export const workspaceGitErrorI18nKey = (
  code?: WorkspaceGitErrorCode | string | null,
): string =>
  isWorkspaceGitErrorCode(code) ? workspaceGitErrorKeys[code] : genericGitErrorKey;

export const workspaceGitValidationErrorI18nKey = (
  status?: Pick<ValidateWorkspacePathResponse, 'error_code'> | null,
): string => workspaceGitErrorI18nKey(status?.error_code);

export const workspaceGitApiErrorI18nKey = (error: unknown): string => {
  if (
    error &&
    typeof error === 'object' &&
    'errorData' in error &&
    isWorkspaceGitErrorData((error as { errorData?: unknown }).errorData)
  ) {
    return workspaceGitErrorI18nKey(
      (error as { errorData: WorkspaceGitErrorData }).errorData.code,
    );
  }
  return genericGitErrorKey;
};

export const normalizeGitignoreTemplateSelection = (
  value?: string | null,
): string | null => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'none') return null;
  return trimmed;
};
