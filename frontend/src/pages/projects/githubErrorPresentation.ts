import type { GitHubErrorData } from '@/types';

export type GitHubErrorAction =
  | 'connect'
  | 'reconnect_repo'
  | 'retry_after'
  | 'retry'
  | 'use_cache'
  | 'fix_git_push';

export interface GitHubErrorPresentation {
  title: string;
  message: string;
  action: GitHubErrorAction;
  retryDisabled: boolean;
  stale: boolean;
  meta?: string;
}

const fallback: GitHubErrorPresentation = {
  title: 'GitHub request failed',
  message: 'The local backend could not complete this GitHub request.',
  action: 'retry',
  retryDisabled: false,
  stale: false,
};

export const presentGitHubError = (
  error?: GitHubErrorData | null,
): GitHubErrorPresentation => {
  if (!error) return fallback;

  const lastSynced = error.last_synced_at
    ? `Last synced ${formatDateTime(error.last_synced_at)}`
    : undefined;

  switch (error.code) {
    case 'github_auth_required':
      return {
        title: 'GitHub account required',
        message: error.message || 'Connect GitHub before using this action.',
        action: 'connect',
        retryDisabled: false,
        stale: Boolean(error.stale),
        meta: lastSynced,
      };
    case 'github_rate_limited':
      return {
        title: 'GitHub rate limit',
        message:
          error.message ||
          'GitHub temporarily limited this account. Retry after the reset time.',
        action: 'retry_after',
        retryDisabled: Boolean(error.retry_after),
        stale: Boolean(error.stale),
        meta: error.retry_after
          ? `Retry after ${formatDateTime(error.retry_after)}`
          : lastSynced,
      };
    case 'github_repo_disconnected':
      return {
        title: 'Repository disconnected',
        message:
          error.message ||
          'Reconnect this repository before running GitHub write actions.',
        action: 'reconnect_repo',
        retryDisabled: true,
        stale: Boolean(error.stale),
        meta: lastSynced,
      };
    case 'local_git_push_failed':
      return {
        title: 'Local git push failed',
        message:
          error.message ||
          'Fix local SSH or HTTPS git credentials, then retry the push.',
        action: 'fix_git_push',
        retryDisabled: false,
        stale: false,
        meta: lastSynced,
      };
    case 'github_stale_cache':
      return {
        title: 'Showing cached GitHub data',
        message:
          error.message ||
          'GitHub could not be refreshed, so the panel is using cached data.',
        action: 'use_cache',
        retryDisabled: false,
        stale: true,
        meta: lastSynced,
      };
    case 'github_write_failed':
      return {
        title: 'GitHub write failed',
        message: error.message || 'Review the audit entry and retry manually.',
        action: 'retry',
        retryDisabled: false,
        stale: Boolean(error.stale),
        meta: lastSynced,
      };
    default:
      return {
        ...fallback,
        message: error.message || fallback.message,
        stale: Boolean(error.stale),
        meta: lastSynced,
      };
  }
};

export const extractGitHubError = (error: unknown): GitHubErrorData | null => {
  if (
    error &&
    typeof error === 'object' &&
    'errorData' in error &&
    isGitHubErrorData((error as { errorData?: unknown }).errorData)
  ) {
    return (error as { errorData: GitHubErrorData }).errorData;
  }
  if (isGitHubErrorData(error)) return error;
  return null;
};

const isGitHubErrorData = (value: unknown): value is GitHubErrorData =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'code' in value &&
      'message' in value,
  );

export const formatDateTime = (value?: string | null): string => {
  if (!value) return 'never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
