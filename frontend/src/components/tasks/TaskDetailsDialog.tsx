import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { makeRequest } from "@/lib/api";
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

interface TaskDetailsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null;
  projectId: string;
  onError: (error: string) => void;
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
      return { label: "Init", className: "bg-status-init text-status-init-foreground" };
    case "setuprunning":
      return { label: "Setup Running", className: "bg-status-running text-status-running-foreground" };
    case "setupcomplete":
      return { label: "Setup Complete", className: "bg-status-complete text-status-complete-foreground" };
    case "setupfailed":
      return { label: "Setup Failed", className: "bg-status-failed text-status-failed-foreground" };
    case "executorrunning":
      return { label: "Executor Running", className: "bg-status-running text-status-running-foreground" };
    case "executorcomplete":
      return { label: "Executor Complete", className: "bg-status-complete text-status-complete-foreground" };
    case "executorfailed":
      return { label: "Executor Failed", className: "bg-status-failed text-status-failed-foreground" };
    case "paused":
      return { label: "Paused", className: "bg-status-paused text-status-paused-foreground" };
    default:
      return { label: "Unknown", className: "bg-status-init text-status-init-foreground" };
  }
};

export function TaskDetailsDialog({
  isOpen,
  onOpenChange,
  task,
  projectId,
  onError,
}: TaskDetailsDialogProps) {
  const [taskAttempts, setTaskAttempts] = useState<TaskAttempt[]>([]);
  const [taskAttemptsLoading, setTaskAttemptsLoading] = useState(false);
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

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedDescription, setEditedDescription] = useState("");
  const [editedStatus, setEditedStatus] = useState<TaskStatus>("todo");
  const [savingTask, setSavingTask] = useState(false);

  // Check if the selected attempt is active (not in a final state)
  const isAttemptRunning =
    selectedAttempt &&
    attemptActivities.length > 0 &&
    (attemptActivities[0].status === "init" ||
      attemptActivities[0].status === "setuprunning" ||
      attemptActivities[0].status === "setupcomplete" ||
      attemptActivities[0].status === "executorrunning");

  useEffect(() => {
    if (isOpen && task) {
      // Reset attempt-related state when switching tasks
      setSelectedAttempt(null);
      setAttemptActivities([]);
      setActivitiesLoading(false);

      fetchTaskAttempts(task.id);
      // Initialize edit state with current task values
      setEditedTitle(task.title);
      setEditedDescription(task.description || "");
      setEditedStatus(task.status);
      setIsEditMode(false);
    }
  }, [isOpen, task]);

  const fetchTaskAttempts = async (taskId: string) => {
    try {
      setTaskAttemptsLoading(true);
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${taskId}/attempts`
      );

      if (response.ok) {
        const result: ApiResponse<TaskAttempt[]> = await response.json();
        if (result.success && result.data) {
          setTaskAttempts(result.data);
          // Automatically select the latest attempt if available
          if (result.data.length > 0) {
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
        onError("Failed to load task attempts");
      }
    } catch (err) {
      onError("Failed to load task attempts");
    } finally {
      setTaskAttemptsLoading(false);
    }
  };

  const fetchAttemptActivities = async (attemptId: string) => {
    if (!task) return;

    try {
      setActivitiesLoading(true);
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
        onError("Failed to load attempt activities");
      }
    } catch (err) {
      onError("Failed to load attempt activities");
    } finally {
      setActivitiesLoading(false);
    }
  };

  const handleAttemptClick = (attempt: TaskAttempt) => {
    setSelectedAttempt(attempt);
    fetchAttemptActivities(attempt.id);
  };

  const saveTaskChanges = async () => {
    if (!task) return;

    try {
      setSavingTask(true);
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: editedTitle,
            description: editedDescription || null,
            status: editedStatus,
          }),
        }
      );

      if (response.ok) {
        setIsEditMode(false);
        // Update the local task state would require parent component to refresh
        // For now, just exit edit mode
      } else {
        onError("Failed to save task changes");
      }
    } catch (err) {
      onError("Failed to save task changes");
    } finally {
      setSavingTask(false);
    }
  };

  const cancelEdit = () => {
    if (task) {
      setEditedTitle(task.title);
      setEditedDescription(task.description || "");
      setEditedStatus(task.status);
    }
    setIsEditMode(false);
  };

  const createNewAttempt = async () => {
    if (!task) return;

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
        onError("Failed to create task attempt");
      }
    } catch (err) {
      onError("Failed to create task attempt");
    } finally {
      setCreatingAttempt(false);
    }
  };

  const stopTaskAttempt = async () => {
    if (!task || !selectedAttempt) return;

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
        onError("Failed to stop task attempt");
      }
    } catch (err) {
      onError("Failed to stop task attempt");
    } finally {
      setStoppingAttempt(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange} className="max-w-7xl">
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex justify-between items-start">
            <DialogTitle className="text-xl">
              {isEditMode ? "Edit Task" : "Task Details"}
            </DialogTitle>
            <div className="flex gap-2">
              {isEditMode ? (
                <>
                  <Button
                    onClick={saveTaskChanges}
                    disabled={savingTask}
                    size="sm"
                  >
                    {savingTask ? "Saving..." : "Save"}
                  </Button>
                  <Button onClick={cancelEdit} variant="outline" size="sm">
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => setIsEditMode(true)}
                  variant="outline"
                  size="sm"
                >
                  Edit
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="col-span-2 space-y-6">
            {/* Task Details */}
            <Card>
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium">Title</Label>
                    {isEditMode ? (
                      <Input
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        className="mt-1"
                        placeholder="Enter task title..."
                      />
                    ) : (
                      <h2 className="text-lg font-semibold mt-1">
                        {task?.title}
                      </h2>
                    )}
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Description</Label>
                    {isEditMode ? (
                      <Textarea
                        value={editedDescription}
                        onChange={(e) => setEditedDescription(e.target.value)}
                        className="mt-1 min-h-[100px]"
                        placeholder="Enter task description..."
                      />
                    ) : (
                      <div className="mt-1 p-3 bg-muted rounded-md min-h-[60px]">
                        {task?.description ? (
                          <p className="text-sm text-foreground whitespace-pre-wrap">
                            {task.description}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">
                            No description provided
                          </p>
                        )}
                      </div>
                    )}
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
                          <Label className="text-sm font-medium mb-2 block text-console-success">
                          STDOUT
                          </Label>
                          <div
                          className="bg-console text-console-success border border-console-success rounded-md p-4 font-mono text-sm max-h-96 overflow-y-auto whitespace-pre-wrap shadow-inner"
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
                          <Label className="text-sm font-medium mb-2 block text-console-error">
                            STDERR
                          </Label>
                          <div
                            className="bg-console text-console-error border border-console-error rounded-md p-4 font-mono text-sm max-h-96 overflow-y-auto whitespace-pre-wrap shadow-inner"
                            style={{
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
                    {isEditMode ? (
                      <Select
                        value={editedStatus}
                        onValueChange={(value) =>
                          setEditedStatus(value as TaskStatus)
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todo">To Do</SelectItem>
                          <SelectItem value="inprogress">
                            In Progress
                          </SelectItem>
                          <SelectItem value="inreview">In Review</SelectItem>
                          <SelectItem value="done">Done</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <div
                        className={`mt-1 px-2 py-1 rounded-full text-xs font-medium w-fit ${
                          task?.status === "todo"
                            ? "bg-neutral text-neutral-foreground"
                            : task?.status === "inprogress"
                            ? "bg-info text-info-foreground"
                            : task?.status === "inreview"
                            ? "bg-warning text-warning-foreground"
                            : task?.status === "done"
                            ? "bg-success text-success-foreground"
                            : "bg-destructive text-destructive-foreground"
                        }`}
                      >
                        {task ? statusLabels[task.status] : ""}
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Created
                    </Label>
                    <p className="text-sm mt-1">
                      {task
                        ? new Date(task.created_at).toLocaleDateString()
                        : ""}
                    </p>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Updated
                    </Label>
                    <p className="text-sm mt-1">
                      {task
                        ? new Date(task.updated_at).toLocaleDateString()
                        : ""}
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
                    {taskAttemptsLoading ? (
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
                    <div className="text-center py-4">
                      Loading activities...
                    </div>
                  ) : attemptActivities.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">
                      No activities found
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {attemptActivities.map((activity) => (
                        <div
                          key={activity.id}
                          className="border-l-2 border-border pl-3 pb-2"
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
      </DialogContent>
    </Dialog>
  );
}
