import { useState, useEffect } from "react";
import {
  X,
  History,
  Send,
  Clock,
  FileText,
  Code,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { makeRequest } from "@/lib/api";
import type {
  TaskStatus,
  TaskAttempt,
  TaskAttemptActivity,
  TaskAttemptStatus,
  ExecutionProcess,
  ExecutionProcessStatus,
  ExecutionProcessType,
  ApiResponse,
  TaskWithAttemptStatus,
} from "shared/types";

interface TaskDetailsPanelProps {
  task: TaskWithAttemptStatus | null;
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  viewMode: "overlay" | "sideBySide";
  onViewModeChange: (mode: "overlay" | "sideBySide") => void;
}

const statusLabels: Record<TaskStatus, string> = {
  todo: "To Do",
  inprogress: "In Progress",
  inreview: "In Review",
  done: "Done",
  cancelled: "Cancelled",
};

const getAttemptStatusDisplay = (
  status: TaskAttemptStatus
): { label: string; className: string } => {
  switch (status) {
    case "init":
      return {
        label: "Init",
        className: "bg-status-init text-status-init-foreground",
      };
    case "setuprunning":
      return {
        label: "Setup Running",
        className: "bg-status-running text-status-running-foreground",
      };
    case "setupcomplete":
      return {
        label: "Setup Complete",
        className: "bg-status-complete text-status-complete-foreground",
      };
    case "setupfailed":
      return {
        label: "Setup Failed",
        className: "bg-status-failed text-status-failed-foreground",
      };
    case "executorrunning":
      return {
        label: "Executor Running",
        className: "bg-status-running text-status-running-foreground",
      };
    case "executorcomplete":
      return {
        label: "Executor Complete",
        className: "bg-status-complete text-status-complete-foreground",
      };
    case "executorfailed":
      return {
        label: "Executor Failed",
        className: "bg-status-failed text-status-failed-foreground",
      };
    case "paused":
      return {
        label: "Paused",
        className: "bg-status-paused text-status-paused-foreground",
      };
    default:
      return {
        label: "Unknown",
        className: "bg-status-init text-status-init-foreground",
      };
  }
};

const getProcessStatusDisplay = (
  status: ExecutionProcessStatus
): { label: string; className: string } => {
  switch (status) {
    case "running":
      return {
        label: "Running",
        className: "bg-status-running text-status-running-foreground",
      };
    case "completed":
      return {
        label: "Completed",
        className: "bg-status-complete text-status-complete-foreground",
      };
    case "failed":
      return {
        label: "Failed",
        className: "bg-status-failed text-status-failed-foreground",
      };
    case "killed":
      return {
        label: "Killed",
        className: "bg-status-failed text-status-failed-foreground",
      };
    default:
      return {
        label: "Unknown",
        className: "bg-status-init text-status-init-foreground",
      };
  }
};

const getProcessTypeDisplay = (type: ExecutionProcessType): string => {
  switch (type) {
    case "setupscript":
      return "Setup Script";
    case "codingagent":
      return "Coding Agent";
    case "devserver":
      return "Dev Server";
    default:
      return "Unknown";
  }
};

export function TaskDetailsPanel({
  task,
  projectId,
  isOpen,
  onClose,
  viewMode,
  onViewModeChange,
}: TaskDetailsPanelProps) {
  const [taskAttempts, setTaskAttempts] = useState<TaskAttempt[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<TaskAttempt | null>(
    null
  );
  const [attemptActivities, setAttemptActivities] = useState<
    TaskAttemptActivity[]
  >([]);
  const [executionProcesses, setExecutionProcesses] = useState<
    ExecutionProcess[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [showAttemptHistory, setShowAttemptHistory] = useState(false);

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
      if (selectedAttempt) {
        fetchAttemptActivities(selectedAttempt.id, true);
        fetchExecutionProcesses(selectedAttempt.id, true);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isAttemptRunning, task?.id, selectedAttempt?.id]);

  useEffect(() => {
    if (task && isOpen) {
      fetchTaskAttempts();
    }
  }, [task, isOpen]);

  const fetchTaskAttempts = async () => {
    if (!task) return;

    try {
      setLoading(true);
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts`
      );

      if (response.ok) {
        const result: ApiResponse<TaskAttempt[]> = await response.json();
        if (result.success && result.data) {
          setTaskAttempts(result.data);

          // Auto-select latest attempt
          if (result.data.length > 0) {
            const latestAttempt = result.data.reduce((latest, current) =>
              new Date(current.created_at) > new Date(latest.created_at)
                ? current
                : latest
            );
            setSelectedAttempt(latestAttempt);
            fetchAttemptActivities(latestAttempt.id);
            fetchExecutionProcesses(latestAttempt.id);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch task attempts:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAttemptActivities = async (
    attemptId: string,
    _isBackgroundUpdate = false
  ) => {
    if (!task) return;

    try {
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts/${attemptId}/activities`
      );

      if (response.ok) {
        const result: ApiResponse<TaskAttemptActivity[]> =
          await response.json();
        if (result.success && result.data) {
          setAttemptActivities(result.data);
        }
      }
    } catch (err) {
      console.error("Failed to fetch attempt activities:", err);
    }
  };

  const fetchExecutionProcesses = async (
    attemptId: string,
    _isBackgroundUpdate = false
  ) => {
    if (!task) return;

    try {
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts/${attemptId}/execution-processes`
      );

      if (response.ok) {
        const result: ApiResponse<ExecutionProcess[]> = await response.json();
        if (result.success && result.data) {
          setExecutionProcesses(result.data);
        }
      }
    } catch (err) {
      console.error("Failed to fetch execution processes:", err);
    }
  };

  const handleAttemptChange = (attemptId: string) => {
    const attempt = taskAttempts.find((a) => a.id === attemptId);
    if (attempt) {
      setSelectedAttempt(attempt);
      fetchAttemptActivities(attempt.id);
      fetchExecutionProcesses(attempt.id);
      setShowAttemptHistory(false);
    }
  };

  const handleSendFollowUp = () => {
    // TODO: Implement follow-up message API
    console.log("Follow-up message:", followUpMessage);
    setFollowUpMessage("");
  };

  const stopExecutionProcess = async (processId: string) => {
    if (!task || !selectedAttempt) return;

    try {
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts/${selectedAttempt.id}/execution-processes/${processId}/stop`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        // Refresh the execution processes
        fetchExecutionProcesses(selectedAttempt.id);
        fetchAttemptActivities(selectedAttempt.id);
      }
    } catch (err) {
      console.error("Failed to stop execution process:", err);
    }
  };

  const openInEditor = async () => {
    if (!task || !selectedAttempt) return;

    try {
      await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts/${selectedAttempt.id}/open-editor`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    } catch (err) {
      console.error("Failed to open editor:", err);
    }
  };

  if (!task) return null;

  return (
    <>
      {isOpen && (
        <>
          {/* Backdrop - only in overlay mode */}
          {viewMode === "overlay" && (
            <div
              className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
              onClick={onClose}
            />
          )}

          {/* Panel */}
          <div
            className={`
            ${
              viewMode === "overlay"
                ? "fixed inset-y-0 right-0 z-50 w-full sm:w-[800px]"
                : "w-full sm:w-[800px] h-full relative"
            } 
            bg-background border-l shadow-lg overflow-hidden
          `}
          >
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="p-6 border-b space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold mb-2 line-clamp-2">
                      {task.title}
                    </h2>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          task.status === "todo"
                            ? "bg-neutral text-neutral-foreground"
                            : task.status === "inprogress"
                            ? "bg-info text-info-foreground"
                            : task.status === "inreview"
                            ? "bg-warning text-warning-foreground"
                            : task.status === "done"
                            ? "bg-success text-success-foreground"
                            : "bg-destructive text-destructive-foreground"
                        }`}
                      >
                        {statusLabels[task.status]}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        onViewModeChange(
                          viewMode === "overlay" ? "sideBySide" : "overlay"
                        )
                      }
                      title={
                        viewMode === "overlay"
                          ? "Switch to side-by-side view"
                          : "Switch to overlay view"
                      }
                    >
                      {viewMode === "overlay" ? (
                        <Maximize2 className="h-4 w-4" />
                      ) : (
                        <Minimize2 className="h-4 w-4" />
                      )}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Attempt Selection */}
                <div className="flex items-center gap-2">
                  {selectedAttempt && !showAttemptHistory ? (
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-sm text-muted-foreground">
                        Current attempt:
                      </span>
                      <span className="text-sm font-medium">
                        {new Date(
                          selectedAttempt.created_at
                        ).toLocaleDateString()}{" "}
                        {new Date(
                          selectedAttempt.created_at
                        ).toLocaleTimeString()}
                      </span>
                      {taskAttempts.length > 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowAttemptHistory(true)}
                        >
                          <History className="h-4 w-4 mr-1" />
                          History
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-1">
                      <Select
                        value={selectedAttempt?.id || ""}
                        onValueChange={handleAttemptChange}
                      >
                        <SelectTrigger className="flex-1">
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAttemptHistory(false)}
                      >
                        Close
                      </Button>
                    </div>
                  )}

                  {selectedAttempt && (
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={openInEditor}
                      >
                        <Code className="h-4 w-4 mr-1" />
                        Editor
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          window.open(
                            `/projects/${projectId}/tasks/${task.id}/attempts/${selectedAttempt.id}/compare`,
                            "_blank"
                          )
                        }
                      >
                        <FileText className="h-4 w-4 mr-1" />
                        Changes
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {loading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading...</p>
                  </div>
                ) : (
                  <>
                    {/* Description */}
                    <div>
                      <Label className="text-sm font-medium mb-2 block">
                        Description
                      </Label>
                      <div className="p-3 bg-muted rounded-md min-h-[60px]">
                        {task.description ? (
                          <p className="text-sm whitespace-pre-wrap">
                            {task.description}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">
                            No description provided
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Execution Processes */}
                    {selectedAttempt && executionProcesses.length > 0 && (
                      <div>
                        <Label className="text-sm font-medium mb-3 block">
                          Execution Processes
                        </Label>
                        <div className="space-y-3">
                          {executionProcesses.map((process) => (
                            <Card key={process.id} className="border">
                              <CardContent className="p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <span
                                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                                        getProcessStatusDisplay(process.status)
                                          .className
                                      }`}
                                    >
                                      {
                                        getProcessStatusDisplay(process.status)
                                          .label
                                      }
                                    </span>
                                    <span className="font-medium text-sm">
                                      {getProcessTypeDisplay(
                                        process.process_type
                                      )}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(
                                        process.started_at
                                      ).toLocaleTimeString()}
                                    </span>
                                    {process.status === "running" && (
                                      <Button
                                        onClick={() =>
                                          stopExecutionProcess(process.id)
                                        }
                                        size="sm"
                                        variant="destructive"
                                      >
                                        Stop
                                      </Button>
                                    )}
                                  </div>
                                </div>

                                {(process.stdout || process.stderr) && (
                                  <div className="space-y-2">
                                    {process.stdout && (
                                      <div>
                                        <Label className="text-xs text-muted-foreground mb-1 block">
                                          STDOUT
                                        </Label>
                                        <div
                                          className="bg-black text-green-400 border border-green-400 rounded-md p-2 font-mono text-xs max-h-32 overflow-y-auto whitespace-pre-wrap"
                                          style={{
                                            fontFamily:
                                              'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                                          }}
                                        >
                                          {process.stdout}
                                        </div>
                                      </div>
                                    )}
                                    {process.stderr && (
                                      <div>
                                        <Label className="text-xs text-muted-foreground mb-1 block">
                                          STDERR
                                        </Label>
                                        <div
                                          className="bg-black text-red-400 border border-red-400 rounded-md p-2 font-mono text-xs max-h-32 overflow-y-auto whitespace-pre-wrap"
                                          style={{
                                            fontFamily:
                                              'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                                          }}
                                        >
                                          {process.stderr}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Activity History */}
                    {selectedAttempt && (
                      <div>
                        <Label className="text-sm font-medium mb-3 block">
                          Activity History
                        </Label>
                        {attemptActivities.length === 0 ? (
                          <div className="text-center py-4 text-muted-foreground">
                            No activities found
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {attemptActivities.map((activity) => (
                              <Card key={activity.id} className="border">
                                <CardContent className="p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <span
                                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                                        getAttemptStatusDisplay(activity.status)
                                          .className
                                      }`}
                                    >
                                      {
                                        getAttemptStatusDisplay(activity.status)
                                          .label
                                      }
                                    </span>
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                      <Clock className="h-3 w-3" />
                                      {new Date(
                                        activity.created_at
                                      ).toLocaleString()}
                                    </div>
                                  </div>
                                  {activity.note && (
                                    <p className="text-sm text-muted-foreground">
                                      {activity.note}
                                    </p>
                                  )}
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="border-t p-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Follow-up question
                  </Label>
                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Ask a follow-up question about this task..."
                      value={followUpMessage}
                      onChange={(e) => setFollowUpMessage(e.target.value)}
                      className="flex-1 min-h-[60px] resize-none"
                    />
                    <Button
                      onClick={handleSendFollowUp}
                      disabled={!followUpMessage.trim()}
                      className="self-end"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Follow-up functionality coming soon
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
