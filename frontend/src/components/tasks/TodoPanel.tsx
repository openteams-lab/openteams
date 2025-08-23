import { useContext, useMemo } from 'react';
import { Circle, CircleCheckBig, CircleDotDashed } from 'lucide-react';
import { useProcessesLogs } from '@/hooks/useProcessesLogs';
import { usePinnedTodos } from '@/hooks/usePinnedTodos';
import { TaskAttemptDataContext } from '@/components/context/taskDetailsContext';
import { shouldShowInLogs } from '@/constants/processes';

function getStatusIcon(status?: string) {
  const s = (status || '').toLowerCase();
  if (s === 'completed')
    return <CircleCheckBig aria-hidden className="h-4 w-4 text-green-600" />;
  if (s === 'in_progress' || s === 'in-progress')
    return <CircleDotDashed aria-hidden className="h-4 w-4 text-blue-500" />;
  return <Circle aria-hidden className="h-4 w-4 text-muted-foreground" />;
}

export function TodoPanel() {
  const { attemptData } = useContext(TaskAttemptDataContext);

  const filteredProcesses = useMemo(
    () =>
      (attemptData.processes || []).filter((p) =>
        shouldShowInLogs(p.run_reason)
      ),
    [attemptData.processes?.map((p) => p.id).join(',')]
  );

  const { entries } = useProcessesLogs(filteredProcesses, true);
  const { todos } = usePinnedTodos(entries);

  // Only show once the agent has created subtasks
  if (!todos || todos.length === 0) return null;

  return (
    <div className="bg-background rounded-lg overflow-hidden border">
      <div className="p-4">
        <h3 className="font-medium mb-3">Task Breakdown</h3>
        <ul className="space-y-2">
          {todos.map((todo, index) => (
            <li
              key={`${todo.content}-${index}`}
              className="flex items-start gap-2"
            >
              <span className="mt-0.5 h-4 w-4 flex items-center justify-center shrink-0">
                {getStatusIcon(todo.status)}
              </span>
              <span className="text-sm leading-5 break-words">
                {todo.content}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default TodoPanel;
