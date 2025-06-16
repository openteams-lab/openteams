import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { makeAuthenticatedRequest } from '@/lib/auth'
import type { TaskStatus, TaskAttempt, TaskAttemptActivity } from 'shared/types'

interface Task {
  id: string
  project_id: string
  title: string
  description: string | null
  status: TaskStatus
  created_at: string
  updated_at: string
}

interface ApiResponse<T> {
  success: boolean
  data: T | null
  message: string | null
}

interface TaskDetailsDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  task: Task | null
  projectId: string
  onError: (error: string) => void
}

const statusLabels: Record<TaskStatus, string> = {
  todo: 'To Do',
  inprogress: 'In Progress',
  inreview: 'In Review',
  done: 'Done',
  cancelled: 'Cancelled'
}

export function TaskDetailsDialog({ isOpen, onOpenChange, task, projectId, onError }: TaskDetailsDialogProps) {
  const [taskAttempts, setTaskAttempts] = useState<TaskAttempt[]>([])
  const [taskAttemptsLoading, setTaskAttemptsLoading] = useState(false)
  const [selectedAttempt, setSelectedAttempt] = useState<TaskAttempt | null>(null)
  const [attemptActivities, setAttemptActivities] = useState<TaskAttemptActivity[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(false)
  const [creatingAttempt, setCreatingAttempt] = useState(false)

  useEffect(() => {
    if (isOpen && task) {
      fetchTaskAttempts(task.id)
    }
  }, [isOpen, task])

  const fetchTaskAttempts = async (taskId: string) => {
    try {
      setTaskAttemptsLoading(true)
      const response = await makeAuthenticatedRequest(`/api/projects/${projectId}/tasks/${taskId}/attempts`)
      
      if (response.ok) {
        const result: ApiResponse<TaskAttempt[]> = await response.json()
        if (result.success && result.data) {
          setTaskAttempts(result.data)
        }
      } else {
        onError('Failed to load task attempts')
      }
    } catch (err) {
      onError('Failed to load task attempts')
    } finally {
      setTaskAttemptsLoading(false)
    }
  }

  const fetchAttemptActivities = async (attemptId: string) => {
    if (!task) return
    
    try {
      setActivitiesLoading(true)
      const response = await makeAuthenticatedRequest(`/api/projects/${projectId}/tasks/${task.id}/attempts/${attemptId}/activities`)
      
      if (response.ok) {
        const result: ApiResponse<TaskAttemptActivity[]> = await response.json()
        if (result.success && result.data) {
          setAttemptActivities(result.data)
        }
      } else {
        onError('Failed to load attempt activities')
      }
    } catch (err) {
      onError('Failed to load attempt activities')
    } finally {
      setActivitiesLoading(false)
    }
  }

  const handleAttemptClick = (attempt: TaskAttempt) => {
    setSelectedAttempt(attempt)
    fetchAttemptActivities(attempt.id)
  }

  const createNewAttempt = async () => {
    if (!task) return
    
    try {
      setCreatingAttempt(true)
      const worktreePath = `/tmp/task-${task.id}-attempt-${Date.now()}`
      
      const response = await makeAuthenticatedRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            task_id: task.id,
            worktree_path: worktreePath,
            base_commit: null,
            merge_commit: null,
          }),
        }
      )
      
      if (response.ok) {
        // Refresh the attempts list
        await fetchTaskAttempts(task.id)
      } else {
        onError('Failed to create task attempt')
      }
    } catch (err) {
      onError('Failed to create task attempt')
    } finally {
      setCreatingAttempt(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Task Details: {task?.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          {/* Task Info */}
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Task Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Title</Label>
                <p className="text-sm text-muted-foreground">{task?.title}</p>
              </div>
              <div>
                <Label>Status</Label>
                <p className="text-sm text-muted-foreground">
                  {task ? statusLabels[task.status] : ''}
                </p>
              </div>
            </div>
            {task?.description && (
              <div>
                <Label>Description</Label>
                <p className="text-sm text-muted-foreground">{task.description}</p>
              </div>
            )}
          </div>

          {/* Task Attempts */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Task Attempts</h3>
              <Button 
                onClick={createNewAttempt}
                disabled={creatingAttempt}
                size="sm"
              >
                {creatingAttempt ? 'Creating...' : 'Create New Attempt'}
              </Button>
            </div>
            {taskAttemptsLoading ? (
              <div className="text-center py-4">Loading attempts...</div>
            ) : taskAttempts.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                No attempts found for this task
              </div>
            ) : (
              <div className="space-y-2">
                {taskAttempts.map((attempt) => (
                  <Card 
                    key={attempt.id} 
                    className={`cursor-pointer transition-colors ${
                      selectedAttempt?.id === attempt.id ? 'bg-blue-50 border-blue-200' : 'hover:bg-gray-50'
                    }`}
                    onClick={() => handleAttemptClick(attempt)}
                  >
                    <CardContent className="p-4">
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium">Worktree: {attempt.worktree_path}</p>
                            <p className="text-sm text-muted-foreground">
                              Created: {new Date(attempt.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <Label className="text-xs">Base Commit</Label>
                            <p className="text-muted-foreground">
                              {attempt.base_commit || 'None'}
                            </p>
                          </div>
                          <div>
                            <Label className="text-xs">Merge Commit</Label>
                            <p className="text-muted-foreground">
                              {attempt.merge_commit || 'None'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Activity History */}
          {selectedAttempt && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">
                Activity History for Attempt: {selectedAttempt.worktree_path}
              </h3>
              {activitiesLoading ? (
                <div className="text-center py-4">Loading activities...</div>
              ) : attemptActivities.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  No activities found for this attempt
                </div>
              ) : (
                <div className="space-y-2">
                  {attemptActivities.map((activity) => (
                    <Card key={activity.id}>
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                activity.status === 'init' ? 'bg-gray-100 text-gray-800' :
                                activity.status === 'inprogress' ? 'bg-blue-100 text-blue-800' :
                                'bg-yellow-100 text-yellow-800'
                              }`}>
                                {activity.status === 'init' ? 'Init' :
                                 activity.status === 'inprogress' ? 'In Progress' :
                                 'Paused'}
                              </span>
                            </div>
                            {activity.note && (
                              <p className="text-sm text-muted-foreground">{activity.note}</p>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {new Date(activity.created_at).toLocaleString()}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
