import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Send, Tag, UserRound } from 'lucide-react';
import { projectGithubApi } from '@/lib/api';
import type {
  GitHubErrorData,
  GitHubIssueDetail,
  GitHubIssueSummary,
  GitHubOperationAudit,
  ProjectRepoIntegration,
} from '@/types';
import {
  extractGitHubError,
  formatDateTime,
  presentGitHubError,
} from './githubErrorPresentation';

interface ProjectIssuePanelProps {
  projectId: string;
}

export function ProjectIssuePanel({ projectId }: ProjectIssuePanelProps) {
  const [repos, setRepos] = useState<ProjectRepoIntegration[]>([]);
  const [repoId, setRepoId] = useState('');
  const [state, setState] = useState('open');
  const [query, setQuery] = useState('');
  const [issues, setIssues] = useState<GitHubIssueSummary[]>([]);
  const [selected, setSelected] = useState<GitHubIssueDetail | null>(null);
  const [selectedIssueRepoId, setSelectedIssueRepoId] = useState<string | null>(
    null,
  );
  const [audits, setAudits] = useState<GitHubOperationAudit[]>([]);
  const [auditError, setAuditError] = useState<GitHubErrorData | null>(null);
  const [lastWriteResult, setLastWriteResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<GitHubErrorData | null>(null);
  const [comment, setComment] = useState('');
  const [labels, setLabels] = useState('');
  const [assignees, setAssignees] = useState('');

  const shownError = useMemo(() => presentGitHubError(error), [error]);
  const shownAuditError = useMemo(
    () => presentGitHubError(auditError),
    [auditError],
  );
  const selectedRepo = repos.find((repo) => repo.id === repoId) ?? repos[0];
  const repoDisconnected = selectedRepo?.sync_status === 'disconnected';
  const selectedMatchesCurrentRepo = Boolean(
    selected && selectedIssueRepoId && selectedIssueRepoId === repoId,
  );
  const writeAllowed = isIssueSelectionWritable(
    repoId,
    selectedIssueRepoId,
    Boolean(selected),
    repoDisconnected,
    action,
  );
  const writeRepoId = resolveIssueWriteRepoId(repoId, selectedIssueRepoId);
  const selectedIssueAudits = useMemo(
    () => filterIssueAudits(audits, writeRepoId, selected?.summary.number),
    [audits, selected?.summary.number, writeRepoId],
  );
  const writeDisabled = !writeAllowed;

  const loadRepos = useCallback(async () => {
    try {
      const loaded = await projectGithubApi.listRepos(projectId);
      setRepos(loaded);
      setRepoId((current) => current || loaded[0]?.id || '');
    } catch (err) {
      setError(extractGitHubError(err));
    }
  }, [projectId]);

  const loadAudits = useCallback(
    async (auditRepoId: string) => {
      setAuditError(null);
      try {
        const loaded = await projectGithubApi.listAudits(projectId, {
          repoId: auditRepoId,
        });
        setAudits(loaded);
      } catch (err) {
        setAuditError(extractGitHubError(err));
      }
    },
    [projectId],
  );

  const loadIssues = useCallback(async () => {
    if (!shouldLoadIssuesForRepo(repoId)) {
      setIssues([]);
      setSelected(null);
      setSelectedIssueRepoId(null);
      setAudits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const loaded = await projectGithubApi.listIssues(projectId, {
        repoIntegrationId: repoId || undefined,
        state,
        query: query.trim() || undefined,
      });
      setIssues(loaded);
      if (loaded[0]) {
        const detail = await projectGithubApi.getIssue(
          projectId,
          repoId,
          loaded[0].number,
        );
        setSelected(detail);
        setSelectedIssueRepoId(repoId);
        setLabels(detail.summary.labels.join(', '));
        setAssignees(detail.summary.assignees.join(', '));
        await loadAudits(repoId);
      } else {
        setSelected(null);
        setSelectedIssueRepoId(null);
        setAudits([]);
      }
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setLoading(false);
    }
  }, [loadAudits, projectId, query, repoId, state]);

  useEffect(() => {
    void loadRepos();
  }, [loadRepos]);

  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);

  useEffect(() => {
    setSelected(null);
    setSelectedIssueRepoId(null);
    setAudits([]);
    setAuditError(null);
    setLastWriteResult(null);
    setLabels('');
    setAssignees('');
    setComment('');
  }, [repoId]);

  const openIssue = async (issue: GitHubIssueSummary) => {
    if (!repoId) return;
    setAction(`open-${issue.number}`);
    setError(null);
    try {
      const detail = await projectGithubApi.getIssue(
        projectId,
        repoId,
        issue.number,
      );
      setSelected(detail);
      setSelectedIssueRepoId(repoId);
      setLabels(detail.summary.labels.join(', '));
      setAssignees(detail.summary.assignees.join(', '));
      await loadAudits(repoId);
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  };

  const refreshIssue = async () => {
    if (!writeRepoId || !writeAllowed || !selected) return;
    setAction('refresh-issue');
    setError(null);
    try {
      const detail = await projectGithubApi.refreshIssue(
        projectId,
        writeRepoId,
        selected.summary.number,
      );
      setSelected(detail);
      await loadAudits(writeRepoId);
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  };

  const submitComment = async () => {
    if (!writeRepoId || !writeAllowed || !selected || !comment.trim()) return;
    setAction('comment');
    setError(null);
    try {
      await projectGithubApi.commentIssue(
        projectId,
        writeRepoId,
        selected.summary.number,
        comment.trim(),
      );
      const detail = await projectGithubApi.refreshIssue(
        projectId,
        writeRepoId,
        selected.summary.number,
      );
      setSelected(detail);
      setComment('');
      setLastWriteResult('Comment submitted; audit refreshed.');
      await loadAudits(writeRepoId);
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  };

  const setIssueState = async (nextState: 'open' | 'closed') => {
    if (!writeRepoId || !writeAllowed || !selected) return;
    setAction(`state-${nextState}`);
    setError(null);
    try {
      const summary = await projectGithubApi.updateIssueState(
        projectId,
        writeRepoId,
        selected.summary.number,
        nextState,
      );
      setSelected((current) => (current ? { ...current, summary } : current));
      setLastWriteResult(`Issue state updated to ${nextState}; audit refreshed.`);
      await loadAudits(writeRepoId);
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  };

  const saveLabels = async () => {
    if (!writeRepoId || !writeAllowed || !selected) return;
    setAction('labels');
    setError(null);
    try {
      const nextLabels = await projectGithubApi.updateIssueLabels(
        projectId,
        writeRepoId,
        selected.summary.number,
        splitCsv(labels),
      );
      setSelected((current) =>
        current
          ? {
              ...current,
              summary: { ...current.summary, labels: nextLabels },
            }
          : current,
      );
      setLastWriteResult('Labels updated; audit refreshed.');
      await loadAudits(writeRepoId);
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  };

  const saveAssignees = async () => {
    if (!writeRepoId || !writeAllowed || !selected) return;
    setAction('assignees');
    setError(null);
    try {
      const summary = await projectGithubApi.updateIssueAssignees(
        projectId,
        writeRepoId,
        selected.summary.number,
        splitCsv(assignees),
      );
      setSelected((current) => (current ? { ...current, summary } : current));
      setLastWriteResult('Assignees updated; audit refreshed.');
      await loadAudits(writeRepoId);
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setAction(null);
    }
  };

  return (
    <div className="grid min-h-[520px] gap-4 xl:grid-cols-[360px_1fr]">
      <section className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)]">
        <div className="border-b border-[var(--hairline)] p-3">
          <div className="grid gap-2">
            <select
              value={repoId}
              onChange={(event) => setRepoId(event.target.value)}
              className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--ink)]"
            >
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.owner && repo.name ? `${repo.owner}/${repo.name}` : repo.repo_id}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search issues"
                className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none"
              />
              <select
                value={state}
                onChange={(event) => setState(event.target.value)}
                className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--ink)]"
              >
                <option value="open">open</option>
                <option value="closed">closed</option>
                <option value="all">all</option>
              </select>
            </div>
          </div>
          {error && (
            <div className="mt-3 rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-xs">
              <p className="font-medium text-[var(--ink)]">{shownError.title}</p>
              <p className="text-[var(--ink-subtle)]">{shownError.message}</p>
              <button
                type="button"
                onClick={() => void loadIssues()}
                disabled={shownError.retryDisabled}
                className="mt-2 text-[var(--primary)] disabled:text-[var(--ink-tertiary)]"
              >
                Manual retry
              </button>
            </div>
          )}
        </div>
        <div className="max-h-[620px] overflow-y-auto p-2">
          {loading ? (
            <p className="p-3 text-xs text-[var(--ink-tertiary)]">Loading issues...</p>
          ) : issues.length === 0 ? (
            <p className="p-3 text-xs text-[var(--ink-tertiary)]">No issues found.</p>
          ) : (
            issues.map((issue) => (
              <button
                key={`${repoId}-${issue.number}`}
                type="button"
                onClick={() => void openIssue(issue)}
                className={`mb-2 block w-full rounded-md border p-3 text-left transition ${
                  selectedMatchesCurrentRepo &&
                  selected?.summary.number === issue.number
                    ? 'border-[var(--hairline-strong)] bg-[var(--surface-3)]'
                    : 'border-[var(--hairline)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-xs font-medium text-[var(--ink)]">
                    #{issue.number} {issue.title}
                  </p>
                  {issue.stale && (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  )}
                </div>
                <p className="mt-1 font-mono text-[10px] text-[var(--ink-tertiary)]">
                  {issue.state} · synced {formatDateTime(issue.last_synced_at)}
                </p>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-4">
        {!selected ? (
          <div className="flex h-full min-h-[360px] items-center justify-center text-xs text-[var(--ink-tertiary)]">
            Select an issue.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 border-b border-[var(--hairline)] pb-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-sm border border-[var(--hairline)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink-tertiary)]">
                    #{selected.summary.number}
                  </span>
                  <span className="rounded-sm bg-[var(--surface-3)] px-1.5 py-0.5 text-[11px] text-[var(--ink-subtle)]">
                    {selected.summary.state}
                  </span>
                  {selected.summary.stale && (
                    <span className="rounded-sm bg-amber-400/10 px-1.5 py-0.5 text-[11px] text-amber-300">
                      stale cache
                    </span>
                  )}
                </div>
                <h2 className="text-base font-semibold text-[var(--ink)]">
                  {selected.summary.title}
                </h2>
                <p className="mt-1 font-mono text-[11px] text-[var(--ink-tertiary)]">
                  updated {formatDateTime(selected.summary.updated_at)} · synced{' '}
                  {formatDateTime(selected.summary.last_synced_at)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={refreshIssue}
                  disabled={action === 'refresh-issue'}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--hairline)] px-2.5 py-1.5 text-xs text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
                <button
                  type="button"
                  disabled={writeDisabled}
                  onClick={() =>
                    void setIssueState(
                      selected.summary.state === 'open' ? 'closed' : 'open',
                    )
                  }
                  className="rounded-md bg-[var(--primary)] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {selected.summary.state === 'open' ? 'Close' : 'Open'}
                </button>
              </div>
            </div>

            {repoDisconnected && (
              <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-200">
                Repo disconnected. GitHub write actions are disabled until reconnect.
              </div>
            )}

            {selected && !selectedMatchesCurrentRepo && !repoDisconnected && (
              <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
                Select an issue from the current repository before running write
                actions.
              </div>
            )}

            <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink-subtle)]">
                {selected.body || 'No issue body.'}
              </p>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <EditLine
                icon={<Tag className="h-3.5 w-3.5" />}
                label="Labels"
                value={labels}
                onChange={setLabels}
                onSave={saveLabels}
                disabled={writeDisabled}
              />
              <EditLine
                icon={<UserRound className="h-3.5 w-3.5" />}
                label="Assignees"
                value={assignees}
                onChange={setAssignees}
                onSave={saveAssignees}
                disabled={writeDisabled}
              />
            </div>

            <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-[var(--ink)]">
                  Comments
                </h3>
                <span className="font-mono text-[11px] text-[var(--ink-tertiary)]">
                  {selected.comments.length}
                </span>
              </div>
              <div className="max-h-52 space-y-2 overflow-y-auto">
                {selected.comments.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-2"
                  >
                    <p className="text-[11px] text-[var(--ink-tertiary)]">
                      {item.author ?? 'unknown'} · {formatDateTime(item.created_at)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--ink-subtle)]">
                      {item.body}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Add a comment"
                  className="min-h-20 rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none"
                />
                <button
                  type="button"
                  onClick={submitComment}
                  disabled={writeDisabled || !comment.trim()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  Comment
                </button>
              </div>
            </div>

            <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold text-[var(--ink)]">
                    GitHub operation audit
                  </h3>
                  {lastWriteResult && (
                    <p className="mt-0.5 text-[11px] text-[var(--success)]">
                      {lastWriteResult}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (writeRepoId) void loadAudits(writeRepoId);
                  }}
                  disabled={!writeRepoId}
                  className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:opacity-50"
                >
                  Refresh audit
                </button>
              </div>
              {auditError && (
                <div className="mb-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-xs">
                  <p className="font-medium text-[var(--ink)]">
                    {shownAuditError.title}
                  </p>
                  <p className="text-[var(--ink-subtle)]">
                    {shownAuditError.message}
                  </p>
                </div>
              )}
              <div className="space-y-2">
                {selectedIssueAudits.length === 0 ? (
                  <p className="text-xs text-[var(--ink-tertiary)]">
                    No audit entries for this issue yet.
                  </p>
                ) : (
                  selectedIssueAudits.slice(0, 6).map((audit) => (
                    <div
                      key={audit.id}
                      className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-[var(--ink)]">
                          {audit.action}
                        </span>
                        <span className="rounded-sm bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-subtle)]">
                          {audit.result}
                        </span>
                        <span className="rounded-sm bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-tertiary)]">
                          {audit.operation_source}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-[var(--ink-tertiary)]">
                        {audit.actor ?? 'unknown'} 路 {formatDateTime(audit.created_at)}
                      </p>
                      {audit.operation_source === 'agent' &&
                        audit.result === 'pending_approval' && (
                          <p className="mt-1 text-[11px] text-amber-300">
                            Agent write operation is waiting for user
                            confirmation.
                          </p>
                        )}
                      {audit.error && (
                        <p className="mt-1 text-[11px] text-red-300">
                          {audit.error}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function EditLine({
  icon,
  label,
  value,
  onChange,
  onSave,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3">
      <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
        {icon}
        {label}
      </label>
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="comma separated"
          className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={disabled}
          className="rounded-md border border-[var(--hairline)] px-2.5 py-1.5 text-xs text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}

const splitCsv = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const resolveIssueWriteRepoId = (
  currentRepoId: string,
  selectedIssueRepoId: string | null,
): string | null => {
  if (!currentRepoId || selectedIssueRepoId !== currentRepoId) return null;
  return selectedIssueRepoId;
};

export const isIssueSelectionWritable = (
  currentRepoId: string,
  selectedIssueRepoId: string | null,
  hasSelectedIssue: boolean,
  repoDisconnected: boolean,
  currentAction: string | null,
): boolean =>
  Boolean(
    hasSelectedIssue &&
      currentRepoId &&
      selectedIssueRepoId === currentRepoId &&
      !repoDisconnected &&
      currentAction === null,
  );

export const filterIssueAudits = (
  audits: GitHubOperationAudit[],
  repoId: string | null,
  issueNumber?: number,
): GitHubOperationAudit[] => {
  if (!repoId || issueNumber === undefined) return [];
  const issueTarget = String(issueNumber);
  return audits.filter(
    (audit) =>
      audit.repo_id === repoId &&
      audit.target_type === 'issue' &&
      (audit.target_id === issueTarget ||
        audit.target_id === `#${issueTarget}` ||
        audit.target_id === null),
  );
};

export const shouldLoadIssuesForRepo = (repoId: string): boolean =>
  repoId.trim().length > 0;
