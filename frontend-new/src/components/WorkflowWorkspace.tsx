import React from 'react';
import { FreeChatWorkspace } from '@/components/FreeChatWorkspace';

interface WorkflowWorkspaceProps {
  onOpenDiffTab?: (
    sessionId: string,
    filePath: string,
    status: string,
    unifiedDiff: string,
  ) => void;
}

export const WorkflowWorkspace: React.FC<WorkflowWorkspaceProps> = ({
  onOpenDiffTab,
}) => {
  return (
    <div className="h-full w-full bg-transparent overflow-hidden font-sans text-xs select-none">
      <FreeChatWorkspace embedded onOpenDiffTab={onOpenDiffTab} />
    </div>
  );
};
