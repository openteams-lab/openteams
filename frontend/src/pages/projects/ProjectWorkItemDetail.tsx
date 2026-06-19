import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, GitBranch, GitPullRequest, History, Network } from 'lucide-react';
import { projectWorkItemsApi } from '@/lib/api';
import type {
  GitHubErrorData,
  ProjectWorkItem,
  ProjectWorkItemDetailResponse,
} from '@/types';
import {
  extractGitHubError,
  formatDateTime,
  presentGitHubError,
} from './githubErrorPresentation';

interface ProjectWorkItemDetailProps {
  projectId: string;
  workItem: ProjectWorkItem | null;
}

export function ProjectWorkItemDetail({
  projectId,
  workItem,
}: ProjectWorkItemDetailProps) {
  const [detail, setDetail] = useState<ProjectWorkItemDetailResponse | null>(null);
  const [error, setError] = useState<GitHubErrorData | null>(null);
  const [loading, setLoading] = useState(false);
  const shownError = useMemo(() => presentGitHubError(error), [error]);

  useEffect(() => {
    if (!workItem) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void projectWorkItemsApi
      .get(projectId, workItem.id)
      .then((loaded) => {
        if (!cancelled) setDetail(loaded);
      })
      .catch((err) => {
        if (!cancelled) setError(extractGitHubError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, workItem]);

  if (!workItem) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] text-xs text-[var(--ink-tertiary)]">
        Select a project work item.
      </div>
    );
  }

  const current = detail?.work_item ?? workItem;
  const { externalLinks, executionLinks, deliveryRecords, audits } =
    getWorkItemDetailCollections(detail);

  return (
    <section className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-4">
      <div className="mb-4 border-b border-[var(--hairline)] pb-4">
        <div className="mb-2 flex flex-wrap gap-2">
          <Pill>{current.type}</Pill>
          <Pill>{current.status}</Pill>
          <Pill>{current.priority}</Pill>
          <Pill>{current.source}</Pill>
        </div>
        <h2 className="text-base font-semibold text-[var(--ink)]">
          {current.title}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-subtle)]">
          {current.description || 'No description.'}
        </p>
      </div>

      {loading && (
        <p className="mb-3 text-xs text-[var(--ink-tertiary)]">Loading detail...</p>
      )}
      {error && (
        <div className="mb-3 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs">
          <p className="font-medium text-[var(--ink)]">{shownError.title}</p>
          <p className="text-[var(--ink-subtle)]">{shownError.message}</p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          icon={<ExternalLink className="h-4 w-4" />}
          title="Issue and external mapping"
          count={externalLinks.length}
        >
          {externalLinks.map((link) => (
            <Row key={link.id}>
              <div>
                <p className="text-xs font-medium text-[var(--ink)]">
                  {link.external_type}
                  {link.number ? ` #${link.number}` : ''}
                </p>
                <p className="font-mono text-[11px] text-[var(--ink-tertiary)]">
                  {link.state ?? 'unknown'} · synced{' '}
                  {formatDateTime(link.last_synced_at)}
                  {link.stale ? ' · stale' : ''}
                </p>
              </div>
              {link.url && (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--primary)]"
                >
                  Open
                </a>
              )}
            </Row>
          ))}
        </Panel>

        <Panel
          icon={<Network className="h-4 w-4" />}
          title="Session, workflow, run, step links"
          count={executionLinks.length}
        >
          {executionLinks.map((link) => (
            <Row key={link.id}>
              <div>
                <p className="text-xs font-medium text-[var(--ink)]">
                  {link.link_type}
                </p>
                <p className="font-mono text-[11px] text-[var(--ink-tertiary)]">
                  session {link.session_id ?? '-'} · workflow{' '}
                  {link.workflow_execution_id ?? '-'} · run {link.run_id ?? '-'} ·
                  step {link.workflow_step_id ?? '-'}
                </p>
              </div>
            </Row>
          ))}
        </Panel>

        <Panel
          icon={<GitPullRequest className="h-4 w-4" />}
          title="Delivery records"
          count={deliveryRecords.length}
        >
          {deliveryRecords.map((record) => (
            <Row key={record.id}>
              <div>
                <p className="text-xs font-medium text-[var(--ink)]">
                  {record.event_type}
                </p>
                <p className="font-mono text-[11px] text-[var(--ink-tertiary)]">
                  {record.actor ?? 'unknown'} · {formatDateTime(record.occurred_at)}
                </p>
              </div>
              {record.url && (
                <a
                  href={record.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--primary)]"
                >
                  Open
                </a>
              )}
            </Row>
          ))}
        </Panel>

        <Panel
          icon={<History className="h-4 w-4" />}
          title="GitHub operation audit"
          count={audits.length}
        >
          {audits.map((audit) => (
            <Row key={audit.id}>
              <div>
                <p className="text-xs font-medium text-[var(--ink)]">
                  {audit.action} · {audit.result}
                </p>
                <p className="font-mono text-[11px] text-[var(--ink-tertiary)]">
                  {audit.operation_source} · {formatDateTime(audit.created_at)}
                </p>
                {audit.operation_source === 'agent' &&
                  audit.result === 'pending_approval' && (
                    <p className="mt-1 text-[11px] text-amber-300">
                      Agent write operation is waiting for user confirmation.
                    </p>
                  )}
                {audit.error && (
                  <p className="mt-1 text-[11px] text-red-300">{audit.error}</p>
                )}
              </div>
            </Row>
          ))}
        </Panel>
      </div>
    </section>
  );
}

function Panel({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
          <span className="text-[var(--primary)]">{icon}</span>
          {title}
        </h3>
        <span className="font-mono text-[11px] text-[var(--ink-tertiary)]">
          {count}
        </span>
      </div>
      <div className="space-y-2">
        {count === 0 ? (
          <p className="text-xs text-[var(--ink-tertiary)]">No records.</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-2">
      {children}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border border-[var(--hairline)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink-tertiary)]">
      {children}
    </span>
  );
}

export const getWorkItemDetailCollections = (
  detail: ProjectWorkItemDetailResponse | null,
) => ({
  externalLinks: detail?.external_links ?? [],
  executionLinks: detail?.execution_links ?? [],
  deliveryRecords: detail?.delivery_records ?? [],
  audits: detail?.github_audits ?? detail?.audits ?? [],
});
