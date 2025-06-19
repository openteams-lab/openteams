import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, FileText } from "lucide-react";
import { makeRequest } from "@/lib/api";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import type {
  TaskStatus,
  TaskAttempt,
  TaskAttemptActivity,
  TaskAttemptStatus,
} from "shared/types";

interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  message: string | null;
}

const statusLabels: Record<TaskStatus, string> = {
  todo: "To Do",
  inprogress: "In Progress",
  inreview: "In Review",
  done: "Done",
  cancelled: "Cancelled",
};

const getAttemptStatusDisplay = (status: TaskAttemptStatus): { label: string; className: string } => {
  switch (status) {
    case "init":
      return { label: "Init", className: "bg-gray-100 text-gray-800" };
    case "setuprunning":
      return { label: "Setup Running", className: "bg-blue-100 text-blue-800" };
    case "setupcomplete":
      return { label: "Setup Complete", className: "bg-green-100 text-green-800" };
    case "setupfailed":
      return { label: "Setup Failed", className: "bg-red-100 text-red-800" };
    case "executorrunning":
      return { label: "Executor Running", className: "bg-blue-100 text-blue-800" };
    case "executorcomplete":
      return { label: "Executor Complete", className: "bg-green-100 text-green-800" };
    case "executorfailed":
      return { label: "Executor Failed", className: "bg-red-100 text-red-800" };
    case "paused":
      return { label: "Paused", className: "bg-yellow-100 text-yellow-800" };
    default:
      return { label: "Unknown", className: "bg-gray-100 text-gray-800" };
  }
};

export function TaskDetailsPage() {
  const { projectId, taskId } = useParams<{
    projectId: string;
    taskId: string;
  }>();
  const navigate = useNavigate();

  const [task, setTask] = useState<Task | null>(null);
  const [taskLoading, setTaskLoading] = useState(true);
  const [taskAttempts, setTaskAttempts] = useState<TaskAttempt[]>([]);
  const [taskAttemptsLoading, setTaskAttemptsLoading] = useState(false);
  const [taskAttemptsInitialLoad, setTaskAttemptsInitialLoad] = useState(true);
  const [selectedAttempt, setSelectedAttempt] = useState<TaskAttempt | null>(
    null
  );
  const [attemptActivities, setAttemptActivities] = useState<
    TaskAttemptActivity[]
  >([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [selectedExecutor, setSelectedExecutor] = useState<string>("claude");
  const [creatingAttempt, setCreatingAttempt] = useState(false);
  const [stoppingAttempt, setStoppingAttempt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);

  // Check if the selected attempt is active (not in a final state)
  const isAttemptRunning =
    selectedAttempt &&
    attemptActivities.length > 0 &&
    (attemptActivities[0].status === "init" ||
      attemptActivities[0].status === "setuprunning" ||
      attemptActivities[0].status === "setupcomplete" ||
      attemptActivities[0].status === "executorrunning");

  // Polling for updates when attempt is running
  useEffect(() => {
    if (!isAttemptRunning || !task) return;

    const interval = setInterval(() => {
      fetchTaskAttempts(task.id, true); // Background update
      if (selectedAttempt) {
        fetchAttemptActivities(selectedAttempt.id, true); // Background update
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isAttemptRunning, task?.id, selectedAttempt?.id]);

  useEffect(() => {
    if (projectId && taskId) {
      fetchTask();
    }
  }, [projectId, taskId]);

  useEffect(() => {
    if (task) {
      fetchTaskAttempts(task.id);
    }
  }, [task]);

  const fetchTask = async () => {
    if (!projectId || !taskId) return;

    try {
      setTaskLoading(true);
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${taskId}`
      );

      if (response.ok) {
        const result: ApiResponse<Task> = await response.json();
        if (result.success && result.data) {
          setTask(result.data);
        } else {
          setError("Failed to load task");
        }
      } else {
        setError("Failed to load task");
      }
    } catch (err) {
      setError("Failed to load task");
    } finally {
      setTaskLoading(false);
    }
  };

  const fetchTaskAttempts = async (
    taskId: string,
    isBackgroundUpdate = false
  ) => {
    if (!projectId) return;

    try {
      // Show loading for user-initiated actions, not background polling
      if (!isBackgroundUpdate) {
        setTaskAttemptsLoading(true);
      }

      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${taskId}/attempts`
      );

      if (response.ok) {
        const result: ApiResponse<TaskAttempt[]> = await response.json();
        if (result.success && result.data) {
          setTaskAttempts(result.data);
          setTaskAttemptsInitialLoad(false);

          // For background updates, preserve the selected attempt
          if (isBackgroundUpdate && selectedAttempt) {
            const updatedAttempt = result.data.find(
              (a) => a.id === selectedAttempt.id
            );
            if (updatedAttempt) {
              setSelectedAttempt(updatedAttempt);
              return;
            }
          }

          // Auto-select latest attempt for initial loads
          if (result.data.length > 0 && !isBackgroundUpdate) {
            const latestAttempt = result.data.reduce((latest, current) =>
              new Date(current.created_at) > new Date(latest.created_at)
                ? current
                : latest
            );
            setSelectedAttempt(latestAttempt);
            fetchAttemptActivities(latestAttempt.id);
          }
        }
      } else {
        setError("Failed to load task attempts");
      }
    } catch (err) {
      setError("Failed to load task attempts");
    } finally {
      if (!isBackgroundUpdate) {
        setTaskAttemptsLoading(false);
      }
    }
  };

  const fetchAttemptActivities = async (
    attemptId: string,
    isBackgroundUpdate = false
  ) => {
    if (!task || !projectId) return;

    try {
      // Only show loading for user-initiated actions, not background polling
      if (!isBackgroundUpdate) {
        setActivitiesLoading(true);
      }

      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts/${attemptId}/activities`
      );

      if (response.ok) {
        const result: ApiResponse<TaskAttemptActivity[]> =
          await response.json();
        if (result.success && result.data) {
          setAttemptActivities(result.data);
        }
      } else {
        setError("Failed to load attempt activities");
      }
    } catch (err) {
      setError("Failed to load attempt activities");
    } finally {
      if (!isBackgroundUpdate) {
        setActivitiesLoading(false);
      }
    }
  };

  const handleAttemptClick = (attempt: TaskAttempt) => {
    setSelectedAttempt(attempt);
    fetchAttemptActivities(attempt.id);
  };

  const handleUpdateTaskFromDialog = async (
    title: string,
    description: string,
    status: TaskStatus
  ) => {
    if (!task || !projectId) return;

    try {
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
            description: description || null,
            status,
          }),
        }
      );

      if (response.ok) {
        // Update the local task state
        setTask({
          ...task,
          title,
          description: description || null,
          status,
        });
      } else {
        setError("Failed to save task changes");
      }
    } catch (err) {
      setError("Failed to save task changes");
    }
  };

  const createNewAttempt = async () => {
    if (!task || !projectId) return;

    try {
      setCreatingAttempt(true);
      const worktreePath = `/tmp/task-${task.id}-attempt-${Date.now()}`;

      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            task_id: task.id,
            worktree_path: worktreePath,
            base_commit: null,
            merge_commit: null,
            executor: selectedExecutor,
          }),
        }
      );

      if (response.ok) {
        // Refresh the attempts list
        await fetchTaskAttempts(task.id);
      } else {
        setError("Failed to create task attempt");
      }
    } catch (err) {
      setError("Failed to create task attempt");
    } finally {
      setCreatingAttempt(false);
    }
  };

  const stopTaskAttempt = async () => {
    if (!task || !selectedAttempt || !projectId) return;

    try {
      setStoppingAttempt(true);
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts/${selectedAttempt.id}/stop`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        // Refresh the activities list to show the stopped status
        fetchAttemptActivities(selectedAttempt.id);
      } else {
        setError("Failed to stop task attempt");
      }
    } catch (err) {
      setError("Failed to stop task attempt");
    } finally {
      setStoppingAttempt(false);
    }
  };

  const handleBackClick = () => {
    navigate(`/projects/${projectId}/tasks`);
  };

  if (taskLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading task...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <Button onClick={handleBackClick} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Tasks
          </Button>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Task not found</p>
          <Button onClick={handleBackClick} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Tasks
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button onClick={handleBackClick} variant="outline" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Tasks
          </Button>
          <h1 className="text-2xl font-bold">Task Details</h1>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setIsTaskDialogOpen(true)}
            variant="outline"
            size="sm"
          >
            Edit Task
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="col-span-2 space-y-6">
          {/* Task Details */}
          <Card>
            <CardContent className="p-6">
              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium">Title</Label>
                  <h2 className="text-lg font-semibold mt-1">{task.title}</h2>
                </div>

                <div>
                  <Label className="text-sm font-medium">Description</Label>
                  <div className="mt-1 p-3 bg-gray-50 rounded-md min-h-[60px]">
                    {task.description ? (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">
                        {task.description}
                      </p>
                    ) : (
                      <p className="text-sm text-gray-500 italic">
                        No description provided
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Task Attempt Output */}
          {selectedAttempt &&
            (selectedAttempt.stdout || selectedAttempt.stderr) && (
              <Card className="bg-black">
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold mb-4 text-green-400">
                    Execution Output
                  </h3>
                  <div className="space-y-4">
                    {selectedAttempt.stdout && (
                      <div>
                        <Label className="text-sm font-medium mb-2 block text-green-400">
                          STDOUT
                        </Label>
                        <div
                          className="bg-black border border-green-400 rounded-md p-4 font-mono text-sm text-green-400 max-h-96 overflow-y-auto whitespace-pre-wrap shadow-inner"
                          style={{
                            fontFamily:
                              'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                          }}
                        >
                          {selectedAttempt.stdout}
                        </div>
                      </div>
                    )}
                    {selectedAttempt.stderr && (
                      <div>
                        <Label className="text-sm font-medium mb-2 block text-red-400">
                          STDERR
                        </Label>
                        <div
                          className="bg-black border border-red-400 rounded-md p-4 font-mono text-sm text-red-400 max-h-96 overflow-y-auto whitespace-pre-wrap shadow-inner"
                          style={{
                            textShadow: "0 0 2px #ff0000",
                            fontFamily:
                              'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                          }}
                        >
                          {selectedAttempt.stderr}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <h4 className="font-semibold mb-3">Details</h4>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Status
                  </Label>
                  <div
                    className={`mt-1 px-2 py-1 rounded-full text-xs font-medium w-fit ${
                      task.status === "todo"
                        ? "bg-gray-100 text-gray-800"
                        : task.status === "inprogress"
                        ? "bg-blue-100 text-blue-800"
                        : task.status === "inreview"
                        ? "bg-yellow-100 text-yellow-800"
                        : task.status === "done"
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {statusLabels[task.status]}
                  </div>
                </div>

                <Separator />

                <div>
                  <Label className="text-xs text-muted-foreground">
                    Created
                  </Label>
                  <p className="text-sm mt-1">
                    {new Date(task.created_at).toLocaleDateString()}
                  </p>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">
                    Updated
                  </Label>
                  <p className="text-sm mt-1">
                    {new Date(task.updated_at).toLocaleDateString()}
                  </p>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">
                    Project ID
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">
                    {projectId}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Task Attempts */}
          <Card>
            <CardContent className="p-4">
              <h4 className="font-semibold mb-3">Task Attempts</h4>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    Select Attempt
                  </Label>
                  {taskAttemptsInitialLoad && taskAttemptsLoading ? (
                    <div className="text-center py-2 text-sm text-muted-foreground">
                      Loading...
                    </div>
                  ) : taskAttempts.length === 0 ? (
                    <div className="text-center py-2 text-sm text-muted-foreground">
                      No attempts found
                    </div>
                  ) : (
                    <Select
                      value={selectedAttempt?.id || ""}
                      onValueChange={(value) => {
                        const attempt = taskAttempts.find(
                          (a) => a.id === value
                        );
                        if (attempt) {
                          handleAttemptClick(attempt);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select an attempt..." />
                      </SelectTrigger>
                      <SelectContent>
                        {taskAttempts.map((attempt) => (
                          <SelectItem key={attempt.id} value={attempt.id}>
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {new Date(
                                  attempt.created_at
                                ).toLocaleDateString()}{" "}
                                {new Date(
                                  attempt.created_at
                                ).toLocaleTimeString()}
                              </span>
                              <span className="text-xs text-muted-foreground text-left">
                                {attempt.executor || "executor"}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Actions
                  </Label>
                  <div className="flex flex-col gap-2">
                    {selectedAttempt && (
                      <Button
                        onClick={() =>
                          navigate(
                            `/projects/${projectId}/tasks/${taskId}/attempts/${selectedAttempt.id}/compare`
                          )
                        }
                        size="sm"
                        variant="outline"
                        className="w-full"
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        View Changes
                      </Button>
                    )}
                    {isAttemptRunning && (
                      <Button
                        onClick={stopTaskAttempt}
                        disabled={stoppingAttempt}
                        size="sm"
                        variant="destructive"
                        className="w-full"
                      >
                        {stoppingAttempt ? "Stopping..." : "Stop Execution"}
                      </Button>
                    )}
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        New Attempt
                      </Label>
                      <Select
                        value={selectedExecutor}
                        onValueChange={(value) =>
                          setSelectedExecutor(
                            value as "echo" | "claude" | "amp"
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="claude">Claude</SelectItem>
                          <SelectItem value="amp">Amp</SelectItem>
                          <SelectItem value="echo">Echo</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={createNewAttempt}
                        disabled={creatingAttempt}
                        size="sm"
                        className="w-full"
                      >
                        {creatingAttempt ? "Creating..." : "Create Attempt"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Activity History */}
          {selectedAttempt && (
            <Card>
              <CardContent className="p-4">
                <h4 className="font-semibold mb-3">Activity History</h4>
                <p className="text-xs text-muted-foreground mb-3">
                  {selectedAttempt.worktree_path}
                </p>
                {activitiesLoading ? (
                  <div className="text-center py-4">Loading activities...</div>
                ) : attemptActivities.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">
                    No activities found
                  </div>
                ) : (
                  <div className="space-y-2">
                    {attemptActivities.map((activity) => (
                      <div
                        key={activity.id}
                        className="border-l-2 border-gray-200 pl-3 pb-2"
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${
                              getAttemptStatusDisplay(activity.status).className
                            }`}
                          >
                            {getAttemptStatusDisplay(activity.status).label}
                          </span>
                          <p className="text-xs text-muted-foreground">
                            {new Date(activity.created_at).toLocaleString()}
                          </p>
                        </div>
                        {activity.note && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {activity.note}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <TaskFormDialog
        isOpen={isTaskDialogOpen}
        onOpenChange={setIsTaskDialogOpen}
        task={task}
        projectId={projectId}
        onUpdateTask={handleUpdateTaskFromDialog}
      />
    </div>
  );
}
