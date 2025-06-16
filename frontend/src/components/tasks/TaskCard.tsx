import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { KanbanCard } from '@/components/ui/shadcn-io/kanban'
import { MoreHorizontal, Trash2, Edit } from 'lucide-react'
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

interface TaskCardProps {
  task: Task
  index: number
  status: string
  onEdit: (task: Task) => void
  onDelete: (taskId: string) => void
  onViewDetails: (task: Task) => void
}

export function TaskCard({ task, index, status, onEdit, onDelete, onViewDetails }: TaskCardProps) {
  return (
    <KanbanCard
      key={task.id}
      id={task.id}
      name={task.title}
      index={index}
      parent={status}
      onClick={() => onViewDetails(task)}
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between">
          <div className="flex-1 pr-2">
            <h4 className="font-medium text-sm">
              {task.title}
            </h4>
          </div>
          <div className="flex items-center space-x-1">
            {/* Actions Menu */}
            <div 
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 w-6 p-0 hover:bg-gray-100"
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(task)}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => onDelete(task.id)}
                    className="text-red-600"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        {task.description && (
          <div>
            <p className="text-xs text-muted-foreground">
              {task.description}
            </p>
          </div>
        )}
      </div>
    </KanbanCard>
  )
}
