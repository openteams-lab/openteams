import React from 'react';

import {
  WorktreeMergeHistoryPanel,
  type WorktreeMergeHistoryCommit,
} from '@/components/worktree/WorktreeMergeHistoryPanel';
import type { SessionWorktree } from '@/types';

type WorktreeHistoryTranslator = (
  key: string,
  fallback: string,
  replacements?: Record<string, string | number>,
) => string;

interface WorktreeMergeHistorySectionProps {
  worktree: SessionWorktree;
  commits: WorktreeMergeHistoryCommit[];
  tr: WorktreeHistoryTranslator;
  onClose: () => void;
}

export const WorktreeMergeHistorySection: React.FC<
  WorktreeMergeHistorySectionProps
> = (props) => <WorktreeMergeHistoryPanel {...props} />;
