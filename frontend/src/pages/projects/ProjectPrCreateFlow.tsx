import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, GitBranch, GitPullRequest, RefreshCw, Upload } from 'lucide-react';
import { projectGithubApi, projectWorkItemsApi } from '@/lib/api';
import type {
  GitHubCreatePrResponse,
  GitHubErrorData,
  GitHubPrPreview,
  ProjectRepoIntegration,
  ProjectWorkItem,
} from '@/types';
import {
  extractGitHubError,
  formatDateTime,
  presentGitHubError,
} from './githubErrorPresentation';

interface ProjectPrCreateFlowProps {
  projectId: string;
}

export const firstBranchName = (branches: string[]): string => branches[0] ?? '';

export function ProjectPrCreateFlow({ projectId }: ProjectPrCreateFlowProps) {
  const [repos, setRepos] = useState<ProjectRepoIntegration[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [workItems, setWorkItems] = useState<ProjectWorkItem[]>([]);
  const [repoId, setRepoId] = useState('');
  const [base, setBase] = useState('main');
  const [head, setHead] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [workItemId, setWorkItemId] = useState('');
  const [preview, setPreview] = useState<GitHubPrPreview | null>(null);
  const [result, setResult] = useState<GitHubCreatePrResponse | null>(null);
  const [pendingPrId, setPendingPrId] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<GitHubErrorData | null>(null);

  const selectedRepo = repos.find((repo) => repo.id === repoId) ?? null;
  const shownError = useMemo(() => presentGitHubError(error), [error]);
  const writeDisabled = selectedRepo?.sync_status === 'disconnected';

  const load = useCallback(async () => {
    setAction('load');
    setError(null);
    try {
      const [repoResult, workItemResult] = await Promise.all([
        projectGithubApi.listRepos(projectId),
        projectWorkItemsApi.list(projectId),
      ]);
      setRepos(repoResult);
      setWorkItems(workItemResult);
      const nextRepo = repoResult[0];
      setRepoId((current) => current || nextRepo?.id || '');
      setBase((current) => current || nextRepo?.default_branch || 'main');
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!repoId) return;
    let cancelled = false;
    void projectGithubApi
      .listBranches(projectId, repoId)
      .then((loaded) => {
        if (cancelled) return;
        setBranches(loaded);
        setHead((current) => current || firstBranchName(loaded));
      })
      .catch((err) => {
        if (!cancelled) setError(extractGitHubError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, repoId]);

  const previewPr = async () => {
    if (!repoId || !base.trim() || !head.trim()) return;
    setAction('preview');
    setError(null);
    setResult(null);
    setPendingPrId(null);
    try {
      const loaded = await projectGithubApi.previewPr(projectId, {
        repo_integration_id: repoId,
        base_branch: base.trim(),
        head_branch: head.trim(),
      });
      setPreview(loaded);
      setTitle((current) => current || `${head.trim()} into ${base.trim()}`);
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  };

  const pushHead = async () => {
    if (!repoId || !head.trim()) return;
    setAction('push');
    setError(null);
    try {
      await projectGithubApi.pushPrHead(projectId, {
        repo_integration_id: repoId,
        head_branch: head.trim(),
        base_branch: base.trim() || null,
        title: title.trim() || null,
        body: body.trim() || null,
        work_item_id: workItemId || null,
        operation_source: 'user_ui',
      });
      setPreview((current) =>
        current
          ? { ...current, head_pushed: true, requires_push: false }
          : current,
      );
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  };

  const createPr = async () => {
    if (!repoId || !base.trim() || !head.trim() || !title.trim()) return;
    setAction('create');
    setError(null);
    try {
      const created = await projectGithubApi.createPr(projectId, {
        repo_integration_id: repoId,
        base_branch: base.trim(),
        head_branch: head.trim(),
        title: title.trim(),
        body: body.trim() || null,
        work_item_id: workItemId || null,
        operation_source: 'user_ui',
      });
      setResult(created);
      const pendingId =
        created.result === 'success' ? null : created.pending_pr?.id ?? null;
      setPendingPrId(pendingId);
      if (pendingId) {
        setError({
          code: 'github_write_failed',
          message:
            created.pending_pr?.last_error ||
            'Pull request creation is pending retry.',
        });
      }
    } catch (err) {
      setError(extractGitHubError(err));
      setPendingPrId(null);
    } finally {
      setAction(null);
    }
  };

  const retryPr = async () => {
    if (!pendingPrId) return;
    setAction('retry');
    setError(null);
    try {
      const created = await projectGithubApi.retryPr(projectId, {
        pending_pr_id: pendingPrId,
        operation_source: 'user_ui',
      });
      setResult(created);
      setPendingPrId(
        created.result === 'success' ? null : created.pending_pr?.id ?? null,
      );
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <section className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ink)]">
              Pull request inputs
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ink-tertiary)]">
              Branch diff only; no cherry-pick or file-level assembly.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--hairline)] px-2 py-1 text-xs text-[var(--ink-subtle)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Repository">
            <select
              value={repoId}
              onChange={(event) => setRepoId(event.target.value)}
              className="w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--ink)]"
            >
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.owner && repo.name ? `${repo.owner}/${repo.name}` : repo.repo_id}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Base">
              <BranchInput value={base} branches={branches} onChange={setBase} />
            </Field>
            <Field label="Head">
              <BranchInput value={head} branches={branches} onChange={setHead} />
            </Field>
          </div>
          <Field label="Work item">
            <select
              value={workItemId}
              onChange={(event) => setWorkItemId(event.target.value)}
              className="w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--ink)]"
            >
              <option value="">No work item</option>
              {workItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none"
            />
          </Field>
          <Field label="Body">
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="min-h-24 w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none"
            />
          </Field>

          {writeDisabled && (
            <div className="rounded-md border border-red-400/30 bg-red-400/10 p-2 text-xs text-red-200">
              Repo disconnected. Reconnect before creating a PR.
            </div>
          )}
          {error && (
            <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-xs">
              <p className="font-medium text-[var(--ink)]">{shownError.title}</p>
              <p className="text-[var(--ink-subtle)]">{shownError.message}</p>
              {pendingPrId && (
                <button
                  type="button"
                  onClick={retryPr}
                  className="mt-2 text-[var(--primary)]"
                >
                  Retry pending PR creation
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={previewPr}
            disabled={action !== null || !repoId || !base || !head}
            className="w-full rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Preview commits and diff
          </button>
        </div>
      </section>

      <section className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-4">
        {!preview ? (
          <div className="flex min-h-[480px] items-center justify-center text-xs text-[var(--ink-tertiary)]">
            Generate a preview to continue.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Metric label="Commits" value={String(preview.commits.length)} />
              <Metric label="Files" value={String(preview.diff_summary.files_changed)} />
              <Metric label="Additions" value={`+${preview.diff_summary.additions}`} />
              <Metric label="Deletions" value={`-${preview.diff_summary.deletions}`} />
            </div>

            {preview.requires_push ? (
              <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <div>
                    <p className="font-medium text-[var(--ink)]">
                      Head branch is not pushed
                    </p>
                    <p className="mt-0.5 text-[var(--ink-subtle)]">
                      Confirm local git push before creating the PR.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={pushHead}
                  disabled={action === 'push' || writeDisabled}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Confirm local git push
                </button>
              </div>
            ) : (
              <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3 text-xs text-[var(--ink-subtle)]">
                <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-[var(--success)]" />
                Head branch is available for PR creation.
              </div>
            )}

            <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                <GitBranch className="h-3.5 w-3.5 text-[var(--primary)]" />
                Commits
              </h3>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {preview.commits.map((commit) => (
                  <div
                    key={commit.sha}
                    className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-2"
                  >
                    <p className="line-clamp-2 text-xs text-[var(--ink)]">
                      {commit.message}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-[var(--ink-tertiary)]">
                      {commit.sha.slice(0, 8)} · {commit.author ?? 'unknown'} ·{' '}
                      {formatDateTime(commit.authored_at)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3">
              <h3 className="mb-2 text-xs font-semibold text-[var(--ink)]">
                Diff preview
              </h3>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--surface-1)] p-3 font-mono text-[11px] leading-relaxed text-[var(--ink-subtle)]">
                {preview.diff_text || 'No diff text returned.'}
              </pre>
            </div>

            <button
              type="button"
              onClick={createPr}
              disabled={
                action !== null ||
                writeDisabled ||
                preview.requires_push ||
                !title.trim()
              }
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              <GitPullRequest className="h-3.5 w-3.5" />
              Create pull request
            </button>

            {result && (
              <div className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/10 p-3 text-xs">
                <p className="font-medium text-[var(--ink)]">
                  {result.pull_request
                    ? `PR #${result.pull_request.number} created`
                    : 'PR creation pending retry'}
                </p>
                {result.pull_request && (
                  <a
                    href={result.pull_request.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-[var(--primary)]"
                  >
                    {result.pull_request.url}
                  </a>
                )}
                <p className="mt-2 text-[var(--ink-subtle)]">
                  Delivery record: {result.delivery_record?.id ?? 'pending local link'}
                  {' · '}Audit: {result.result ?? 'pending audit'}
                </p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[var(--ink-tertiary)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function BranchInput({
  value,
  branches: _branches,
  onChange,
}: {
  value: string;
  branches: string[];
  onChange: (value: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      list="project-github-branches"
      className="w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none"
    />
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3">
      <p className="text-[11px] text-[var(--ink-tertiary)]">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-[var(--ink)]">
        {value}
      </p>
    </div>
  );
}
