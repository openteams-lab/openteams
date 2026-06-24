import type { ChatSessionWorktreeMode } from '@/types';

export const canUseIsolatedWorktree = (
  gitAvailable: boolean | null,
): boolean => gitAvailable === true;

export const nextIsolatedWorktreeSelection = (
  current: boolean,
  gitAvailable: boolean | null,
): boolean => (canUseIsolatedWorktree(gitAvailable) ? !current : false);

export const isolatedWorktreeModeOrUndefined = (
  isolate: boolean,
  gitAvailable: boolean | null,
): ChatSessionWorktreeMode | undefined =>
  isolate && canUseIsolatedWorktree(gitAvailable) ? 'isolated' : undefined;

export const isolatedWorktreeModeOrNull = (
  isolate: boolean,
  gitAvailable: boolean | null,
): ChatSessionWorktreeMode | null =>
  isolate && canUseIsolatedWorktree(gitAvailable) ? 'isolated' : null;

export const normalizeWorktreeMemberLookupName = (
  name?: string | null,
): string => name?.replace(/^@/, '').trim().toLowerCase() ?? '';

export const resolveCreateSessionWorktreeWorkspacePath = ({
  isPlanMode,
  selectedMemberName,
  projectWorkspacePath,
  workflowWorkspacePath,
  memberWorkspacePaths,
}: {
  isPlanMode: boolean;
  selectedMemberName?: string | null;
  projectWorkspacePath?: string | null;
  workflowWorkspacePath?: string | null;
  memberWorkspacePaths?: Record<string, string | null>;
}): string | null => {
  if (isPlanMode) {
    return workflowWorkspacePath ?? projectWorkspacePath ?? null;
  }
  const memberKey = normalizeWorktreeMemberLookupName(selectedMemberName);
  const memberWorkspacePath =
    memberKey && memberWorkspacePaths
      ? memberWorkspacePaths[memberKey]
      : undefined;
  return memberWorkspacePath ?? projectWorkspacePath ?? null;
};
