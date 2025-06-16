import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowLeft, Plus } from 'lucide-react'
import { makeAuthenticatedRequest } from '@/lib/auth'
import { TaskCreateDialog } from '@/components/tasks/TaskCreateDialog'
import { TaskEditDialog } from '@/components/tasks/TaskEditDialog'
import { TaskDetailsDialog } from '@/components/tasks/TaskDetailsDialog'
import { TaskKanbanBoard } from '@/components/tasks/TaskKanbanBoard'
import type { TaskStatus } from 'shared/types'
import type { DragEndEvent } from '@/components/ui/shadcn-io/kanban'

interface Task {
  id: string
  project_id: string
  title: string
  description: string | null
  status: TaskStatus
  created_at: string
  updated_at: string
}

interface Project {
  id: string
  name: string
  owner_id: string
  created_at: string
  updated_at: string
}

interface ApiResponse<T> {
  success: boolean
  data: T | null
  message: string | null
}





export function ProjectTasks() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<Task[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [isTaskDetailsDialogOpen, setIsTaskDetailsDialogOpen] = useState(false)


  useEffect(() => {
    if (projectId) {
      fetchProject()
      fetchTasks()
    }
  }, [projectId])

  const fetchProject = async () => {
    try {
      const response = await makeAuthenticatedRequest(`/api/projects/${projectId}`)
      
      if (response.ok) {
        const result: ApiResponse<Project> = await response.json()
        if (result.success && result.data) {
          setProject(result.data)
        }
      } else if (response.status === 404) {
        setError('Project not found')
        navigate('/projects')
      }
    } catch (err) {
      setError('Failed to load project')
    }
  }

  const fetchTasks = async () => {
    try {
      setLoading(true)
      const response = await makeAuthenticatedRequest(`/api/projects/${projectId}/tasks`)
      
      if (response.ok) {
        const result: ApiResponse<Task[]> = await response.json()
        if (result.success && result.data) {
          setTasks(result.data)
        }
      } else {
        setError('Failed to load tasks')
      }
    } catch (err) {
      setError('Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateTask = async (title: string, description: string) => {
    try {
      const response = await makeAuthenticatedRequest(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          title,
          description: description || null
        })
      })

      if (response.ok) {
        await fetchTasks()
      } else {
        setError('Failed to create task')
      }
    } catch (err) {
      setError('Failed to create task')
    }
  }

  const handleUpdateTask = async (title: string, description: string, status: TaskStatus) => {
    if (!editingTask) return

    try {
      const response = await makeAuthenticatedRequest(`/api/projects/${projectId}/tasks/${editingTask.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title,
          description: description || null,
          status
        })
      })

      if (response.ok) {
        await fetchTasks()
        setEditingTask(null)
      } else {
        setError('Failed to update task')
      }
    } catch (err) {
      setError('Failed to update task')
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return

    try {
      const response = await makeAuthenticatedRequest(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        await fetchTasks()
      } else {
        setError('Failed to delete task')
      }
    } catch (err) {
      setError('Failed to delete task')
    }
  }

  const handleEditTask = (task: Task) => {
    setEditingTask(task)
    setIsEditDialogOpen(true)
  }

  const handleViewTaskDetails = (task: Task) => {
    setSelectedTask(task)
    setIsTaskDetailsDialogOpen(true)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    
    if (!over || !active.data.current) return
    
    const taskId = active.id as string
    const newStatus = over.id as Task['status']
    const task = tasks.find(t => t.id === taskId)
    
    if (!task || task.status === newStatus) return

    // Optimistically update the UI immediately
    const previousStatus = task.status
    setTasks(prev => prev.map(t => 
      t.id === taskId ? { ...t, status: newStatus } : t
    ))

    try {
      const response = await makeAuthenticatedRequest(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: task.title,
          description: task.description,
          status: newStatus
        })
      })

      if (!response.ok) {
        // Revert the optimistic update if the API call failed
        setTasks(prev => prev.map(t => 
          t.id === taskId ? { ...t, status: previousStatus } : t
        ))
        setError('Failed to update task status')
      }
    } catch (err) {
      // Revert the optimistic update if the API call failed
      setTasks(prev => prev.map(t => 
        t.id === taskId ? { ...t, status: previousStatus } : t
      ))
      setError('Failed to update task status')
    }
  }



  if (loading) {
    return <div className="text-center py-8">Loading tasks...</div>
  }

  if (error) {
    return <div className="text-center py-8 text-red-600">{error}</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/projects')}
            className="flex items-center"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Projects
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {project?.name || 'Project'} Tasks
            </h1>
            <p className="text-muted-foreground">
              Manage tasks for this project
            </p>
          </div>
        </div>
        
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Task
        </Button>
      </div>

      <TaskCreateDialog
        isOpen={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onCreateTask={handleCreateTask}
      />

      {/* Tasks View */}
      {tasks.length === 0 ? (
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-muted-foreground">No tasks found for this project.</p>
            <Button
              className="mt-4"
              onClick={() => setIsCreateDialogOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create First Task
            </Button>
          </CardContent>
        </Card>
      ) : (
        <TaskKanbanBoard
          tasks={tasks}
          onDragEnd={handleDragEnd}
          onEditTask={handleEditTask}
          onDeleteTask={handleDeleteTask}
          onViewTaskDetails={handleViewTaskDetails}
        />
      )}

      <TaskEditDialog
        isOpen={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        task={editingTask}
        onUpdateTask={handleUpdateTask}
      />

      <TaskDetailsDialog
        isOpen={isTaskDetailsDialogOpen}
        onOpenChange={setIsTaskDetailsDialogOpen}
        task={selectedTask}
        projectId={projectId!}
        onError={setError}
      />
    </div>
  )
}
