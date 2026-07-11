import { useMemo } from 'react';
import { AgentActivityPanel } from '@/components/AgentActivityPanel';
import { parseToolActivityContent } from '@/lib/agentActivityFormatter';
import type { ChatRunActivityLine, ChatRunActivityLineType } from '@/types';
import './WorkflowAgentLogPanel.css';

type AgentLogLine = {
  key: string;
  timestamp: string;
  content: string;
  entryType?: string;
};

type AgentLogGroup = {
  key: string;
  agentName: string;
  lines: AgentLogLine[];
};

const workflowLineTypeForLogLine = (
  line: AgentLogLine
): ChatRunActivityLineType => {
  if (line.entryType === 'error') return 'error';
  if (parseToolActivityContent(line.content)) return 'tool';
  return 'thinking';
};

const workflowLogGroupsToActivityLines = (
  groups: AgentLogGroup[]
): ChatRunActivityLine[] => {
  let sequence = 0;

  return groups.flatMap((group) =>
    group.lines.map((line) => {
      const lineType = workflowLineTypeForLogLine(line);
      const nextSequence = sequence++;

      return {
        line_id: line.key,
        run_id: `workflow-log-${group.key}`,
        session_id: 'workflow',
        session_agent_id: group.key,
        agent_id: group.key,
        agent_name: group.agentName,
        sequence: nextSequence,
        line_type: lineType,
        stream_type: lineType === 'error' ? 'error' : 'thinking',
        content: line.content,
        created_at: line.timestamp,
      };
    })
  );
};

export type WorkflowAgentLogPanelProps = {
  agentLogGroups: AgentLogGroup[];
  isLoading: boolean;
  emptyMessage?: string;
  loadingMessage?: string;
  stepStatus?: string;
};

export function WorkflowAgentLogPanel({
  agentLogGroups,
  isLoading,
  emptyMessage = 'No logs for this step yet.',
  loadingMessage = 'Loading logs...',
}: WorkflowAgentLogPanelProps) {
  const activityLines = useMemo(
    () => workflowLogGroupsToActivityLines(agentLogGroups),
    [agentLogGroups]
  );

  return (
    <AgentActivityPanel
      lines={activityLines}
      state={isLoading ? 'loading' : 'loaded'}
      labels={{
        loading: loadingMessage,
        cleaned: emptyMessage,
        error: emptyMessage,
        empty: emptyMessage,
      }}
      variant="panel"
      stripEmptyHtmlCommentPrefixes
    />
  );
}
