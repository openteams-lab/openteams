import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, GitMerge, GitPullRequest, RefreshCw, Rocket, TestTube2, XCircle } from 'lucide-react';
import { deliveryApi } from '@/lib/api';
import type {
  GitHubErrorData,
  ProjectDeliveryRecord,
  ProjectDeliveryStatsSummary,
} from '@/types';
import {
  extractGitHubError,
  formatDateTime,
  presentGitHubError,
} from './githubErrorPresentation';

interface ProjectDeliveryStatsProps {
  projectId: string;
}

const today = new Date();
const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

export function ProjectDeliveryStats({ projectId }: ProjectDeliveryStatsProps) {
  const [periodStart, setPeriodStart] = useState(toDateInput(sevenDaysAgo));
  const [periodEnd, setPeriodEnd] = useState(toDateInput(today));
  const [stats, setStats] = useState<ProjectDeliveryStatsSummary | null>(null);
  const [records, setRecords] = useState<ProjectDeliveryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<GitHubErrorData | null>(null);
  const shownError = useMemo(() => presentGitHubError(error), [error]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextStats, nextRecords] = await Promise.all([
        deliveryApi.getStats(projectId, { periodStart, periodEnd }),
        deliveryApi.listRecords(projectId),
      ]);
      setStats(nextStats);
      setRecords(nextRecords);
    } catch (err) {
      setError(extractGitHubError(err));
      setStats(null);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [periodEnd, periodStart, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ink)]">
              GitHub delivery statistics
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ink-tertiary)]">
              Source: project_delivery_records.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--ink)]"
            />
            <input
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
              className="rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--ink)]"
            />
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-3 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs">
            <p className="font-medium text-[var(--ink)]">{shownError.title}</p>
            <p className="text-[var(--ink-subtle)]">{shownError.message}</p>
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Metric
          icon={<GitPullRequest className="h-4 w-4" />}
          label="PR opened"
          value={stats?.pr_opened_count ?? 0}
        />
        <Metric
          icon={<GitMerge className="h-4 w-4" />}
          label="PR merged"
          value={stats?.pr_merged_count ?? 0}
        />
        <Metric
          icon={<Rocket className="h-4 w-4" />}
          label="Deployments"
          value={stats?.deployment_count ?? 0}
        />
        <Metric
          icon={<Rocket className="h-4 w-4" />}
          label="Releases"
          value={stats?.release_count ?? 0}
        />
        <Metric
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Tests passed"
          value={stats?.test_passed_count ?? 0}
        />
        <Metric
          icon={<XCircle className="h-4 w-4" />}
          label="Tests failed"
          value={stats?.test_failed_count ?? 0}
        />
      </div>

      <section className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
            <TestTube2 className="h-4 w-4 text-[var(--primary)]" />
            Delivery records
          </h3>
          <span className="font-mono text-[11px] text-[var(--ink-tertiary)]">
            {records.length}
          </span>
        </div>
        <div className="overflow-hidden rounded-md border border-[var(--hairline)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--surface-2)] text-[var(--ink-tertiary)]">
              <tr>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Occurred</th>
                <th className="px-3 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-[var(--ink-tertiary)]"
                  >
                    No delivery records.
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr
                    key={record.id}
                    className="border-t border-[var(--hairline)] text-[var(--ink-subtle)]"
                  >
                    <td className="px-3 py-2 font-medium text-[var(--ink)]">
                      {record.event_type}
                    </td>
                    <td className="px-3 py-2">{record.actor ?? 'unknown'}</td>
                    <td className="px-3 py-2 font-mono">
                      {formatDateTime(record.occurred_at)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {record.source_session_id ?? record.source_workflow_execution_id ?? '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-3">
      <div className="mb-2 text-[var(--primary)]">{icon}</div>
      <p className="text-[11px] text-[var(--ink-tertiary)]">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-[var(--ink)]">
        {value}
      </p>
    </div>
  );
}

const toDateInput = (date: Date): string => date.toISOString().slice(0, 10);
