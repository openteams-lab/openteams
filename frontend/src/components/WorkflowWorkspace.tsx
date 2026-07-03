import React from 'react';
import { FreeChatWorkspace } from '@/components/FreeChatWorkspace';
import type { SourceControlDiffArea } from '@/types';

interface WorkflowWorkspaceProps {
  onOpenDiffTab?: (
    sessionId: string,
    filePath: string,
    status: string,
    unifiedDiff: string,
    runId?: string,
  ) => void;
  onOpenSourceControlDiffTab?: (
    projectId: string,
    sessionId: string,
    filePath: string,
    area: SourceControlDiffArea,
  ) => void;
  onOpenWorktreeConflictTab?: (projectId: string, sessionId: string) => void;
}

export const WorkflowWorkspace: React.FC<WorkflowWorkspaceProps> = ({
  onOpenDiffTab,
  onOpenSourceControlDiffTab,
  onOpenWorktreeConflictTab,
}) => {
  return (
    <div className="h-full w-full bg-transparent overflow-hidden font-sans text-xs select-none">
      <FreeChatWorkspace
        embedded
        onOpenDiffTab={onOpenDiffTab}
        onOpenSourceControlDiffTab={onOpenSourceControlDiffTab}
        onOpenWorktreeConflictTab={onOpenWorktreeConflictTab}
      />
    </div>
  );
};
