import type { TaskAttempt } from 'shared/types';
import VirtualizedList from '@/components/logs/VirtualizedList';

type Props = {
  selectedAttempt: TaskAttempt;
};

function LogsTab({ selectedAttempt }: Props) {
  return <VirtualizedList attempt={selectedAttempt} />;
}

export default LogsTab;
