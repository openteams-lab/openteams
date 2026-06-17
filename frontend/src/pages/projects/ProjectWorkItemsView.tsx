import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, RefreshCw } from 'lucide-react';
import { projectWorkItemsApi } from '@/lib/api';
import { notifyBuildStatsUsageUpdated } from '@/lib/buildStatsEvents';
import type {
  GitHubErrorData,
  ProjectWorkItem,
  ProjectWorkItemPriority,
  ProjectWorkItemStatus,
  ProjectWorkItemType,
} from '@/types';
import {
  extractGitHubError,
  formatDateTime,
  presentGitHubError,
} from './githubErrorPresentation';
import { ProjectWorkItemDetail } from './ProjectWorkItemDetail';

interface ProjectWorkItemsViewProps {
  projectId: string;
}

const statuses: ProjectWorkItemStatus[] = [
  'open',
  'in_progress',
  'blocked',
  'ready_to_merge',
  'merging',
  'done',
  'cancelled',
  'duplicate',
];
const types: ProjectWorkItemType[] = [
  'feature',
  'bug',
  'task',
  'deploy',
  'test',
  'doc',
  'refactor',
];
const priorities: ProjectWorkItemPriority[] = ['low', 'medium', 'high', 'urgent'];

export function ProjectWorkItemsView({ projectId }: ProjectWorkItemsViewProps) {
  const [items, setItems] = useState<ProjectWorkItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<GitHubErrorData | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ProjectWorkItemType>('task');
  const [priority, setPriority] = useState<ProjectWorkItemPriority>('medium');
  const [status, setStatus] = useState<ProjectWorkItemStatus>('open');

  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const shownError = useMemo(() => presentGitHubError(error), [error]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await projectWorkItemsApi.list(projectId);
      setItems(loaded);
      setSelectedId((current) => current ?? loaded[0]?.id ?? null);
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await projectWorkItemsApi.create(projectId, {
        title: title.trim(),
        type,
        priority,
        status,
        source: 'manual',
      });
      notifyBuildStatsUsageUpdated(projectId);
      setItems((current) => [created, ...current]);
      setSelectedId(created.id);
      setTitle('');
    } catch (err) {
      setError(extractGitHubError(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="grid min-h-[620px] gap-4 xl:grid-cols-[380px_1fr]">
      <section className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)]">
        <div className="border-b border-[var(--hairline)] p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--ink)]">
                ProjectWorkItem
              </h2>
              <p className="mt-0.5 text-xs text-[var(--ink-tertiary)]">
                Product-level work, separate from chat_work_items.
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
          {error && (
            <div className="mb-3 rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-xs">
              <p className="font-medium text-[var(--ink)]">{shownError.title}</p>
              <p className="text-[var(--ink-subtle)]">{shownError.message}</p>
            </div>
          )}
          <form onSubmit={(event) => void createItem(event)} className="space-y-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="New work item title"
              className="w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none"
            />
            <div className="grid grid-cols-3 gap-2">
              <Select value={type} values={types} onChange={setType} />
              <Select value={priority} values={priorities} onChange={setPriority} />
              <Select value={status} values={statuses} onChange={setStatus} />
            </div>
            <button
              type="submit"
              disabled={creating || !title.trim()}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Create
            </button>
          </form>
        </div>

        <div className="max-h-[620px] overflow-y-auto p-2">
          {loading ? (
            <p className="p-3 text-xs text-[var(--ink-tertiary)]">Loading...</p>
          ) : items.length === 0 ? (
            <p className="p-3 text-xs text-[var(--ink-tertiary)]">
              No project work items.
            </p>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`mb-2 block w-full rounded-md border p-3 text-left transition ${
                  selected?.id === item.id
                    ? 'border-[var(--hairline-strong)] bg-[var(--surface-3)]'
                    : 'border-[var(--hairline)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)]'
                }`}
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-xs font-medium text-[var(--ink)]">
                    {item.title}
                  </p>
                  {item.status === 'blocked' && (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  )}
                </div>
                <p className="font-mono text-[10px] text-[var(--ink-tertiary)]">
                  {item.type} · {item.status} · {item.priority}
                </p>
                <p className="mt-1 font-mono text-[10px] text-[var(--ink-tertiary)]">
                  updated {formatDateTime(item.updated_at)}
                </p>
              </button>
            ))
          )}
        </div>
      </section>

      <ProjectWorkItemDetail projectId={projectId} workItem={selected} />
    </div>
  );
}

function Select<T extends string>({
  value,
  values,
  onChange,
}: {
  value: T;
  values: T[];
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="min-w-0 rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--ink)]"
    >
      {values.map((item) => (
        <option key={item} value={item}>
          {item}
        </option>
      ))}
    </select>
  );
}
