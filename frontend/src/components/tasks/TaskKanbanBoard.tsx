import {
  KanbanProvider,
  KanbanBoard,
  KanbanHeader,
  KanbanCards,
  type DragEndEvent
} from '@/components/ui/shadcn-io/kanban'
import { TaskCard } from './TaskCard'
import type { TaskStatus } from 'shared/types'

interface Task {
  id: string
  project_id: string
  title: string
  description: string | null
  status: TaskStatus
  created_at: string
  updated_at: string
}

interface TaskKanbanBoardProps {
  tasks: Task[]
  onDragEnd: (event: DragEndEvent) => void
  onEditTask: (task: Task) => void
  onDeleteTask: (taskId: string) => void
  onViewTaskDetails: (task: Task) => void
}

const allTaskStatuses: TaskStatus[] = ['todo', 'inprogress', 'inreview', 'done', 'cancelled']

const statusLabels: Record<TaskStatus, string> = {
  todo: 'To Do',
  inprogress: 'In Progress',
  inreview: 'In Review',
  done: 'Done',
  cancelled: 'Cancelled'
}

const statusBoardColors: Record<TaskStatus, string> = {
  todo: '#64748b',
  inprogress: '#3b82f6',
  inreview: '#f59e0b',
  done: '#22c55e',
  cancelled: '#ef4444'
}

export function TaskKanbanBoard({ tasks, onDragEnd, onEditTask, onDeleteTask, onViewTaskDetails }: TaskKanbanBoardProps) {
  const groupTasksByStatus = () => {
    const groups: Record<TaskStatus, Task[]> = {} as Record<TaskStatus, Task[]>
    
    // Initialize groups for all possible statuses
    allTaskStatuses.forEach(status => {
      groups[status] = []
    })
    
    tasks.forEach(task => {
      // Convert old capitalized status to lowercase if needed
      const normalizedStatus = task.status.toLowerCase() as TaskStatus
      if (groups[normalizedStatus]) {
        groups[normalizedStatus].push(task)
      } else {
        // Default to todo if status doesn't match any expected value
        groups['todo'].push(task)
      }
    })
    
    return groups
  }

  return (
    <KanbanProvider onDragEnd={onDragEnd}>
      {Object.entries(groupTasksByStatus()).map(([status, statusTasks]) => (
        <KanbanBoard key={status} id={status as TaskStatus}>
          <KanbanHeader
            name={statusLabels[status as TaskStatus]}
            color={statusBoardColors[status as TaskStatus]}
          />
          <KanbanCards>
            {statusTasks.map((task, index) => (
              <TaskCard
                key={task.id}
                task={task}
                index={index}
                status={status}
                onEdit={onEditTask}
                onDelete={onDeleteTask}
                onViewDetails={onViewTaskDetails}
              />
            ))}
          </KanbanCards>
        </KanbanBoard>
      ))}
    </KanbanProvider>
  )
}
