import type { WorkspaceChangesResponse } from "../types";

export type RelatedFileKind = "modified" | "added" | "deleted" | "untracked";
export type RelatedFileStatus = "M" | "A" | "D" | "U";

export interface RelatedFileChange {
  path: string;
  kind: RelatedFileKind;
  status: RelatedFileStatus;
  additions?: number;
  deletions?: number;
  unified_diff?: string | null;
  has_diff?: boolean;
}

const withDiffFields = (
  kind: RelatedFileKind,
  status: RelatedFileStatus,
  file: {
    path: string;
    additions?: number;
    deletions?: number;
    unified_diff?: string | null;
    has_diff?: boolean;
  },
): RelatedFileChange => ({
  path: file.path,
  kind,
  status,
  additions: file.additions,
  deletions: file.deletions,
  unified_diff: file.unified_diff,
  has_diff: file.has_diff,
});

export const flattenWorkspaceChanges = (
  response: WorkspaceChangesResponse | null | undefined,
): RelatedFileChange[] => {
  const changes = response?.changes;
  if (!changes) return [];

  return [
    ...changes.modified.map((file) => withDiffFields("modified", "M", file)),
    ...changes.added.map((file) => withDiffFields("added", "A", file)),
    ...changes.deleted.map(
      (file): RelatedFileChange => ({
        path: file.path,
        kind: "deleted",
        status: "D",
        has_diff: false,
      }),
    ),
    ...changes.untracked.map((file) =>
      withDiffFields("untracked", "U", file),
    ),
  ];
};

export const hasRelatedFileDiff = (file: RelatedFileChange): boolean =>
  file.has_diff === true && Boolean(file.unified_diff?.trim());
