import DisplayConversationEntry from '@/components/NormalizedConversation/DisplayConversationEntry';
import { useNormalizedLogs } from '@/hooks/useNormalizedLogs';
import { ExecutionProcess } from 'shared/types';

interface ConversationExecutionLogsProps {
  executionProcess: ExecutionProcess;
}

const ConversationExecutionLogs = ({
  executionProcess,
}: ConversationExecutionLogsProps) => {
  const { entries } = useNormalizedLogs(executionProcess.id);

  console.log('DEBUG7', entries);

  return entries.map((entry, i) => {
    return (
      <DisplayConversationEntry
        expansionKey={`expansion-${executionProcess.id}-${i}`}
        entry={entry}
      />
    );
  });
};

export default ConversationExecutionLogs;
