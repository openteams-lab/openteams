import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Github, RefreshCw, Unplug } from 'lucide-react';
import { githubAuthApi, projectGithubApi } from '@/lib/api';
import type {
  GitHubAccount,
  GitHubDeviceFlowStartResponse,
  GitHubErrorData,
  GitHubRepositorySummary,
  JsonValue,
  ProjectRepoIntegration,
} from '@/types';
import {
  extractGitHubError,
  formatDateTime,
  presentGitHubError,
} from './githubErrorPresentation';

interface ProjectGitHubSettingsProps {
  projectId: string;
}

const statusClass: Record<string, string> = {
  connected: 'text-[var(--success)]',
  disconnected: 'text-red-400',
  error: 'text-amber-400',
};

export const DEVICE_FLOW_POLL_INTERVAL_MS = 1000;

export const getDeviceFlowOpenUrl = (
  flow: GitHubDeviceFlowStartResponse,
): string => flow.verification_uri_complete ?? flow.verification_uri;

export const shouldContinueDeviceFlowPolling = (
  status: string,
): boolean => status === 'pending' || status === 'slow_down';

export function ProjectGitHubSettings({ projectId }: ProjectGitHubSettingsProps) {
  const [account, setAccount] = useState<GitHubAccount | null>(null);
  const [repos, setRepos] = useState<ProjectRepoIntegration[]>([]);
  const [githubRepos, setGithubRepos] = useState<GitHubRepositorySummary[]>([]);
  const [deviceFlow, setDeviceFlow] =
    useState<GitHubDeviceFlowStartResponse | null>(null);
  const [deviceFlowStatus, setDeviceFlowStatus] = useState<string | null>(null);
  const [pollingDeviceFlow, setPollingDeviceFlow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<GitHubErrorData | null>(null);
  const devicePollInFlightRef = useRef(false);
  const [githubRepoFullName, setGithubRepoFullName] = useState('');
  const [owner, setOwner] = useState('');
  const [repoName, setRepoName] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [repoGrantText, setRepoGrantText] = useState('{"permissions":["metadata","contents","issues","pull_requests"]}');

  const primaryRepo = repos[0] ?? null;
  const auxiliaryRepos = repos.slice(1);
  const canAddRepo = repos.length < 3;
  const shownError = useMemo(() => presentGitHubError(error), [error]);
  const selectedGitHubRepo =
    githubRepos.find((repo) => repo.full_name === githubRepoFullName) ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accountResult, repoResult] = await Promise.all([
        githubAuthApi.getAccount(),
        projectGithubApi.listRepos(projectId),
      ]);
      setAccount(accountResult);
      setRepos(repoResult);
      if (accountResult) {
        setGithubRepos(await githubAuthApi.listRepos());
      } else {
        setGithubRepos([]);
      }
    } catch (err) {
      setError(toSettingsError(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startDeviceFlow = async () => {
    const authWindow =
      typeof window === 'undefined' ? null : window.open('about:blank', '_blank');
    setAction('connect');
    setError(null);
    try {
      const flow = await githubAuthApi.startDeviceFlow();
      setDeviceFlow(flow);
      setDeviceFlowStatus('pending');
      void copyDeviceCode(flow.user_code);
      openDeviceFlowUrl(flow, authWindow);
    } catch (err) {
      authWindow?.close();
      setError(toSettingsError(err));
    } finally {
      setAction(null);
    }
  };

  const pollDeviceFlow = useCallback(async () => {
    if (!deviceFlow || devicePollInFlightRef.current) return;
    devicePollInFlightRef.current = true;
    setPollingDeviceFlow(true);
    setError(null);
    try {
      const result = await githubAuthApi.pollDeviceFlow(deviceFlow.device_code);
      setDeviceFlowStatus(result.status);
      if (result.account) {
        setAccount(result.account);
        setDeviceFlow(null);
        await load();
      } else if (!shouldContinueDeviceFlowPolling(result.status)) {
        setDeviceFlow(null);
        setError(deviceFlowPollError(result.status, result.error));
      }
    } catch (err) {
      setError(toSettingsError(err));
    } finally {
      devicePollInFlightRef.current = false;
      setPollingDeviceFlow(false);
    }
  }, [deviceFlow, load]);

  useEffect(() => {
    if (!deviceFlow) return;
    void pollDeviceFlow();
    if (typeof window === 'undefined') return;
    const timer = window.setInterval(() => {
      void pollDeviceFlow();
    }, DEVICE_FLOW_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [deviceFlow, pollDeviceFlow]);

  const disconnectAccount = async () => {
    setAction('disconnect-account');
    setError(null);
    try {
      await githubAuthApi.disconnect();
      setAccount(null);
    } catch (err) {
      setError(toSettingsError(err));
    } finally {
      setAction(null);
    }
  };

  const addRepo = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canAddRepo) return;
    setAction('add-repo');
    setError(null);
    try {
      const ownerValue = selectedGitHubRepo?.owner ?? (owner.trim() || null);
      const nameValue = selectedGitHubRepo?.name ?? (repoName.trim() || null);
      const defaultBranchValue =
        selectedGitHubRepo?.default_branch ?? (defaultBranch.trim() || 'main');
      const created = await projectGithubApi.createRepo(projectId, {
        repo_id: null,
        provider: 'github',
        owner: ownerValue,
        name: nameValue,
        full_name: selectedGitHubRepo?.full_name ?? null,
        html_url: selectedGitHubRepo?.html_url ?? null,
        clone_url: selectedGitHubRepo?.clone_url ?? null,
        ssh_url: selectedGitHubRepo?.ssh_url ?? null,
        remote_url: selectedGitHubRepo?.clone_url ?? null,
        default_branch: defaultBranchValue,
        external_id: selectedGitHubRepo?.node_id ?? null,
        sync_status: 'connected',
        repo_grant_json: parseRepoGrant(repoGrantText),
      });
      setRepos((current) => [...current, created].slice(0, 3));
      setGithubRepoFullName('');
      setOwner('');
      setRepoName('');
      setRepoGrantText('{"permissions":["metadata","contents","issues","pull_requests"]}');
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  };

  const selectGitHubRepo = (fullName: string) => {
    setGithubRepoFullName(fullName);
    const repo = githubRepos.find((item) => item.full_name === fullName);
    if (!repo) return;
    setOwner(repo.owner);
    setRepoName(repo.name);
    setDefaultBranch(repo.default_branch || 'main');
  };

  const refreshRepo = async (repo: ProjectRepoIntegration) => {
    setAction(`refresh-${repo.id}`);
    setError(null);
    try {
      const refreshed = await projectGithubApi.refreshRepo(projectId, repo.id);
      setRepos((current) =>
        current.map((item) => (item.id === refreshed.id ? refreshed : item)),
      );
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  };

  const disconnectRepo = async (repo: ProjectRepoIntegration) => {
    setAction(`disconnect-${repo.id}`);
    setError(null);
    try {
      const updated = await projectGithubApi.disconnectRepo(projectId, repo.id);
      setRepos((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  };

  const reconnectRepo = async (repo: ProjectRepoIntegration) => {
    setAction(`reconnect-${repo.id}`);
    setError(null);
    try {
      const updated = await projectGithubApi.updateRepo(projectId, repo.id, {
        repo_grant_json: repo.repo_grant_json,
      });
      setRepos((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  };

  const saveRepoGrant = async (
    repo: ProjectRepoIntegration,
    grantText: string,
  ) => {
    setAction(`grant-${repo.id}`);
    setError(null);
    try {
      const updated = await projectGithubApi.updateRepo(projectId, repo.id, {
        default_branch: repo.default_branch,
        repo_grant_json: parseRepoGrant(grantText),
      });
      setRepos((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-[12px] text-[var(--ink)]">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div>
              <p className="font-semibold">{shownError.title}</p>
              <p className="mt-0.5 text-[var(--ink-subtle)]">
                {shownError.message}
              </p>
              {shownError.meta && (
                <p className="mt-1 font-mono text-[11px] text-[var(--ink-tertiary)]">
                  {shownError.meta}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <section className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--ink)]">
              GitHub account
            </h2>
            {loading ? (
              <p className="mt-1 text-xs text-[var(--ink-tertiary)]">Loading...</p>
            ) : account ? (
              <div className="mt-2 flex items-center gap-3">
                {account.avatar_url ? (
                  <img
                    src={account.avatar_url}
                    alt=""
                    className="h-9 w-9 rounded-full border border-[var(--hairline)]"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--hairline)]">
                    <Github className="h-4 w-4 text-[var(--ink-tertiary)]" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--ink)]">
                    {account.login}
                  </p>
                  <p className="truncate font-mono text-[11px] text-[var(--ink-tertiary)]">
                    {account.scopes.join(', ') || 'minimal scopes'} · connected{' '}
                    {formatDateTime(account.connected_at)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-xs text-[var(--ink-subtle)]">
                No GitHub account is connected in the local backend.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={startDeviceFlow}
              disabled={action === 'connect'}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              <Github className="h-3.5 w-3.5" />
              {account ? 'Reconnect' : 'Connect'}
            </button>
            {account && (
              <button
                type="button"
                onClick={disconnectAccount}
                disabled={action === 'disconnect-account'}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--hairline)] px-3 py-1.5 text-xs font-medium text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:opacity-50"
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </button>
            )}
          </div>
        </div>

        {deviceFlow && (
          <div className="mt-4 rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-medium text-[var(--ink)]">
                  Enter code {deviceFlow.user_code} at GitHub
                </p>
                <p className="mt-1 text-[11px] text-[var(--ink-subtle)]">
                  Waiting for authorization. Status checks run every second.
                  {deviceFlowStatus ? ` Current status: ${deviceFlowStatus}.` : ''}
                </p>
                <p className="mt-1 font-mono text-[11px] text-[var(--ink-tertiary)]">
                  {getDeviceFlowOpenUrl(deviceFlow)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard?.writeText(deviceFlow.user_code)
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--hairline)] px-3 py-1.5 text-xs text-[var(--ink-subtle)]"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </button>
                <a
                  href={getDeviceFlowOpenUrl(deviceFlow)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-md border border-[var(--hairline)] px-3 py-1.5 text-xs text-[var(--ink-subtle)]"
                >
                  Open GitHub
                </a>
                <button
                  type="button"
                  onClick={() => void pollDeviceFlow()}
                  disabled={pollingDeviceFlow}
                  className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {pollingDeviceFlow ? 'Checking...' : 'Check now'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ink)]">
              Project repositories
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ink-tertiary)]">
              Primary plus up to two auxiliary GitHub grants.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--hairline)] px-2.5 py-1.5 text-xs text-[var(--ink-subtle)] hover:text-[var(--ink)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {[primaryRepo, ...auxiliaryRepos].filter(Boolean).map((repo, index) => (
            <RepoCard
              key={repo.id}
              repo={repo}
              role={index === 0 ? 'primary' : 'auxiliary'}
              action={action}
              onRefresh={() => void refreshRepo(repo)}
              onDisconnect={() => void disconnectRepo(repo)}
              onReconnect={() => void reconnectRepo(repo)}
              onSaveGrant={(grantText) => void saveRepoGrant(repo, grantText)}
            />
          ))}
          {repos.length === 0 && (
            <div className="rounded-md border border-dashed border-[var(--hairline)] bg-[var(--surface-2)] p-4 text-xs text-[var(--ink-tertiary)]">
              No project repositories are bound yet.
            </div>
          )}
        </div>

        <form
          onSubmit={(event) => void addRepo(event)}
          className="mt-4 grid gap-2 rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3 md:grid-cols-[1.4fr_1fr_1fr_120px_auto]"
        >
          <select
            value={githubRepoFullName}
            onChange={(event) => selectGitHubRepo(event.target.value)}
            className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none"
          >
            <option value="">
              {account ? 'GitHub repository' : 'Connect GitHub first'}
            </option>
            {githubRepos.map((repo) => (
              <option key={repo.node_id || String(repo.id)} value={repo.full_name}>
                {repo.full_name}
              </option>
            ))}
          </select>
          <input
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            placeholder="owner"
            className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none"
          />
          <input
            value={repoName}
            onChange={(event) => setRepoName(event.target.value)}
            placeholder="repo name"
            className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none"
          />
          <input
            value={defaultBranch}
            onChange={(event) => setDefaultBranch(event.target.value)}
            placeholder="base"
            className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none"
          />
          <button
            type="submit"
            disabled={
              !canAddRepo ||
              action === 'add-repo' ||
              (!githubRepoFullName && (!owner.trim() || !repoName.trim()))
            }
            className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Add repo
          </button>
          {account && githubRepos.length === 0 && (
            <p className="text-[11px] text-[var(--ink-tertiary)] md:col-span-5">
              No GitHub repositories returned for this account.
            </p>
          )}
          <textarea
            value={repoGrantText}
            onChange={(event) => setRepoGrantText(event.target.value)}
            placeholder="repo_grant_json"
            className="min-h-20 rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-2 py-1.5 font-mono text-[11px] text-[var(--ink)] outline-none md:col-span-5"
          />
        </form>
      </section>
    </div>
  );
}

function RepoCard({
  repo,
  role,
  action,
  onRefresh,
  onDisconnect,
  onReconnect,
  onSaveGrant,
}: {
  repo: ProjectRepoIntegration;
  role: 'primary' | 'auxiliary';
  action: string | null;
  onRefresh: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onSaveGrant: (grantText: string) => void;
}) {
  const status = repo.sync_status ?? 'error';
  const busy = action?.endsWith(repo.id) ?? false;
  const [grantText, setGrantText] = useState(formatRepoGrant(repo.repo_grant_json));

  useEffect(() => {
    setGrantText(formatRepoGrant(repo.repo_grant_json));
  }, [repo.repo_grant_json]);

  return (
    <article className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--ink)]">
            {repo.owner && repo.name ? `${repo.owner}/${repo.name}` : repo.repo_id}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--ink-tertiary)]">
            {role} · base {repo.default_branch ?? 'unknown'}
          </p>
        </div>
        {status === 'connected' ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--success)]" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        )}
      </div>
      <div className="space-y-1 text-[12px]">
        <div className="flex justify-between gap-2">
          <span className="text-[var(--ink-tertiary)]">sync_status</span>
          <span className={statusClass[status] ?? 'text-[var(--ink-subtle)]'}>
            {status}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-[var(--ink-tertiary)]">last_synced_at</span>
          <span className="font-mono text-[var(--ink-subtle)]">
            {formatDateTime(repo.last_synced_at)}
          </span>
        </div>
        {repo.last_error && (
          <p className="rounded-sm bg-red-500/10 px-2 py-1 text-red-300">
            {repo.last_error}
          </p>
        )}
      </div>
      <div className="mt-3 rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-medium text-[var(--ink-tertiary)]">
            repo_grant_json
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSaveGrant(grantText)}
            className="rounded-sm px-1.5 py-0.5 text-[10px] text-[var(--primary)] disabled:text-[var(--ink-tertiary)]"
          >
            Save grant
          </button>
        </div>
        <textarea
          value={grantText}
          onChange={(event) => setGrantText(event.target.value)}
          className="min-h-24 w-full resize-y rounded-sm border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[11px] leading-relaxed text-[var(--ink-subtle)] outline-none"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onRefresh}
          className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:opacity-50"
        >
          Refresh grant
        </button>
        {status === 'disconnected' ? (
          <button
            type="button"
            disabled={busy}
            onClick={onReconnect}
            className="rounded-md bg-[var(--primary)] px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
          >
            Reconnect
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onDisconnect}
            className="rounded-md border border-red-400/30 px-2 py-1 text-[11px] text-red-300 disabled:opacity-50"
          >
            Disconnect
          </button>
        )}
      </div>
    </article>
  );
}

export const parseRepoGrant = (value: string): JsonValue | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed) as JsonValue;
};

export const formatRepoGrant = (value: JsonValue | null): string =>
  value === null ? '' : JSON.stringify(value, null, 2);

const copyDeviceCode = async (userCode: string): Promise<void> => {
  try {
    await navigator.clipboard?.writeText(userCode);
  } catch {
    // Browser clipboard permissions are best-effort; the code remains visible.
  }
};

const openDeviceFlowUrl = (
  flow: GitHubDeviceFlowStartResponse,
  authWindow: Window | null,
): void => {
  const url = getDeviceFlowOpenUrl(flow);
  if (authWindow && !authWindow.closed) {
    authWindow.location.href = url;
    return;
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

const deviceFlowPollError = (
  status: string,
  error: GitHubErrorData | string | null,
): GitHubErrorData => {
  if (error && typeof error === 'object') return error;
  return {
    code: `github_device_flow_${status}`,
    message:
      typeof error === 'string' && error
        ? error
        : `GitHub authorization ${status}. Start the connection again if needed.`,
  };
};

const toSettingsError = (error: unknown): GitHubErrorData => {
  const githubError = extractGitHubError(error);
  if (githubError) return githubError;
  return {
    code: 'invalid_repo_grant_json',
    message:
      error instanceof Error
        ? error.message
        : 'repo_grant_json must be valid JSON.',
  };
};
