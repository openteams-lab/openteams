import type { ProjectWorkItemStatus } from '@/types';

const STORAGE_KEY = 'openteams-pending-issue-status-syncs';

export interface PendingIssueStatusSync {
  projectId: string;
  workItemId: string;
  status: ProjectWorkItemStatus;
  updatedAt: string;
}

const syncKey = (projectId: string, workItemId: string) =>
  `${projectId}:${workItemId}`;

function canUseLocalStorage() {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.localStorage);
  } catch {
    return false;
  }
}

function isPendingIssueStatusSync(
  value: unknown,
): value is PendingIssueStatusSync {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PendingIssueStatusSync>;
  return (
    typeof candidate.projectId === 'string' &&
    typeof candidate.workItemId === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

function readPendingIssueStatusSyncs(): Record<string, PendingIssueStatusSync> {
  if (!canUseLocalStorage()) return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [
        string,
        PendingIssueStatusSync,
      ] => isPendingIssueStatusSync(entry[1])),
    );
  } catch {
    return {};
  }
}

function writePendingIssueStatusSyncs(
  syncs: Record<string, PendingIssueStatusSync>,
) {
  if (!canUseLocalStorage()) return;

  const entries = Object.entries(syncs);
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(syncs));
  } catch {
    // Losing this hint is non-fatal; the local work item status is already saved.
  }
}

export function markPendingIssueStatusSync(
  projectId: string,
  workItemId: string,
  status: ProjectWorkItemStatus,
) {
  const syncs = readPendingIssueStatusSyncs();
  syncs[syncKey(projectId, workItemId)] = {
    projectId,
    workItemId,
    status,
    updatedAt: new Date().toISOString(),
  };
  writePendingIssueStatusSyncs(syncs);
}

export function getPendingIssueStatusSync(
  projectId: string,
  workItemId: string,
) {
  return readPendingIssueStatusSyncs()[syncKey(projectId, workItemId)] ?? null;
}

export function clearPendingIssueStatusSync(
  projectId: string,
  workItemId: string,
) {
  const syncs = readPendingIssueStatusSyncs();
  delete syncs[syncKey(projectId, workItemId)];
  writePendingIssueStatusSyncs(syncs);
}
