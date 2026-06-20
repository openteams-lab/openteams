// =============================================================================
// Agent message file-row helpers
// -----------------------------------------------------------------------------
// The file list pinned to the bottom of an agent message is sourced from the
// per-run changed files (GET /chat/runs/{run_id}/files), with artifact-mentioned
// paths merged in as supplementary rows. These pure helpers turn the per-run
// `WorkspaceChanges` payload into a flat row list and merge artifact paths.
// =============================================================================

import { normalizeArtifactPath } from '@/lib/parseStructuredReply';

export type AgentFileStatus = 'M' | 'A' | 'D' | 'U';

export interface AgentFileRow {
  path: string;
  /** Additions (+) for this file in the run, when known. */
  additions?: number;
  /** Deletions (-) for this file in the run, when known. */
  deletions?: number;
  /** True when the run endpoint has inline diff content for this file. */
  hasDiff?: boolean;
  status?: AgentFileStatus;
  /**
   * True when the path came from an artifact mention rather than the run's git
   * diff (no counts available). Rendered with a dimmer style.
   */
  supplementary?: boolean;
}

/**
 * Structural shape accepted from the per-run files endpoint. Defined locally
 * (rather than importing the generated type) so this module stays decoupled
 * from the shared types bundle and works with structurally-compatible data.
 */
interface RunFileChanges {
  modified: Array<{
    path: string;
    additions?: number;
    deletions?: number;
    has_diff?: boolean;
  }>;
  added: Array<{
    path: string;
    additions?: number;
    deletions?: number;
    has_diff?: boolean;
  }>;
  deleted: Array<{ path: string }>;
  untracked: Array<{
    path: string;
    additions?: number;
    deletions?: number;
    has_diff?: boolean;
  }>;
}

interface RunFileChangesPayload {
  changes?: RunFileChanges | null;
}

/**
 * Flatten a per-run `WorkspaceChanges` payload into a single sorted list of
 * rows, each tagged with its change status. Returns an empty list when the
 * payload is missing or empty.
 */
export const flattenRunFileChanges = (
  payload: RunFileChangesPayload | null | undefined,
): AgentFileRow[] => {
  const changes = payload?.changes;
  if (!changes) return [];

  const rows: AgentFileRow[] = [];
  for (const file of changes.modified) {
    rows.push({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      hasDiff: file.has_diff,
      status: 'M',
    });
  }
  for (const file of changes.added) {
    rows.push({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      hasDiff: file.has_diff,
      status: 'A',
    });
  }
  for (const file of changes.deleted) {
    rows.push({ path: file.path, hasDiff: false, status: 'D' });
  }
  for (const file of changes.untracked) {
    rows.push({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      hasDiff: file.has_diff,
      status: 'U',
    });
  }

  // Deduplicate by normalized path, keeping the first (git-tracked over
  // untracked) occurrence.
  const seen = new Set<string>();
  const deduped = rows.filter((row) => {
    const key = normalizeArtifactPath(row.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.sort((a, b) => a.path.localeCompare(b.path));
};

/**
 * Merge per-run diff rows with artifact-mentioned paths. Paths from the run
 * diff keep their counts/status; artifact paths not present in the diff are
 * appended as supplementary rows (no counts). Primary rows sort before
 * supplementary rows; within each group rows are sorted by path.
 */
export const mergeArtifactPaths = (
  runRows: AgentFileRow[],
  artifactPaths: string[],
): AgentFileRow[] => {
  const covered = new Set(
    runRows.map((row) => normalizeArtifactPath(row.path)),
  );

  const merged: AgentFileRow[] = [...runRows];
  for (const path of artifactPaths) {
    const key = normalizeArtifactPath(path);
    if (covered.has(key)) continue;
    covered.add(key);
    merged.push({ path, hasDiff: false, supplementary: true });
  }

  return merged.sort((a, b) => {
    if (!!a.supplementary !== !!b.supplementary) {
      return a.supplementary ? 1 : -1;
    }
    return a.path.localeCompare(b.path);
  });
};
