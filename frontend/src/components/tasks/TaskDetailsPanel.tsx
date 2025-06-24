import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  X,
  History,
  Clock,
  FileText,
  Code,
  ChevronDown,
  ChevronUp,
  Settings2,
  Edit,
  Trash2,
  StopCircle,
  Send,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Chip } from "@/components/ui/chip";
import { Textarea } from "@/components/ui/textarea";
import { ExecutionOutputViewer } from "./ExecutionOutputViewer";
import { EditorSelectionDialog } from "./EditorSelectionDialog";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { makeRequest } from "@/lib/api";
import {
  getTaskPanelClasses,
  getBackdropClasses,
} from "@/lib/responsive-config";
import { useConfig } from "@/components/config-provider";
import type {
  TaskStatus,
  TaskAttempt,
  TaskAttemptActivity,
  TaskAttemptStatus,
  ApiResponse,
  TaskWithAttemptStatus,
  ExecutionProcess,
  EditorType,
} from "shared/types";

interface TaskDetailsPanelProps {
  task: TaskWithAttemptStatus | null;
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onEditTask?: (task: TaskWithAttemptStatus) => void;
  onDeleteTask?: (taskId: string) => void;
}

const statusLabels: Record<TaskStatus, string> = {
  todo: "To Do",
  inprogress: "In Progress",
  inreview: "In Review",
  done: "Done",
  cancelled: "Cancelled",
};

const getTaskStatusDotColor = (status: TaskStatus): string => {
  switch (status) {
    case "todo":
      return "bg-gray-400";
    case "inprogress":
      return "bg-blue-500";
    case "inreview":
      return "bg-yellow-500";
    case "done":
      return "bg-green-500";
    case "cancelled":
      return "bg-red-500";
    default:
      return "bg-gray-400";
  }
};

const getAttemptStatusDisplay = (
  status: TaskAttemptStatus
): { label: string; dotColor: string } => {
  switch (status) {
    case "setuprunning":
      return {
        label: "Setup Running",
        dotColor: "bg-blue-500",
      };
    case "setupcomplete":
      return {
        label: "Setup Complete",
        dotColor: "bg-green-500",
      };
    case "setupfailed":
      return {
        label: "Setup Failed",
        dotColor: "bg-red-500",
      };
    case "executorrunning":
      return {
        label: "Executor Running",
        dotColor: "bg-blue-500",
      };
    case "executorcomplete":
      return {
        label: "Executor Complete",
        dotColor: "bg-green-500",
      };
    case "executorfailed":
      return {
        label: "Executor Failed",
        dotColor: "bg-red-500",
      };
    default:
      return {
        label: "Unknown",
        dotColor: "bg-gray-400",
      };
  }
};

export function TaskDetailsPanel({
  task,
  projectId,
  isOpen,
  onClose,
  onEditTask,
  onDeleteTask,
}: TaskDetailsPanelProps) {
  const [taskAttempts, setTaskAttempts] = useState<TaskAttempt[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<TaskAttempt | null>(
    null
  );
  const [attemptActivities, setAttemptActivities] = useState<
    TaskAttemptActivity[]
  >([]);
  const [executionProcesses, setExecutionProcesses] = useState<
    Record<string, ExecutionProcess>
  >({});
  const [loading, setLoading] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [selectedExecutor, setSelectedExecutor] = useState<string>("claude");
  const [isStopping, setIsStopping] = useState(false);
  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(
    new Set()
  );
  const [showEditorDialog, setShowEditorDialog] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [isSendingFollowUp, setIsSendingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  
  // Auto-scroll state
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { config } = useConfig();

  // Handle ESC key locally to prevent global navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true); // Use capture phase
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  // Available executors
  const availableExecutors = [
    { id: "echo", name: "Echo" },
    { id: "claude", name: "Claude" },
    { id: "amp", name: "Amp" },
  ];

  // Check if any execution process is currently running
  // We need to check the latest activity for each execution process
  const isAttemptRunning = useMemo(() => {
    if (!selectedAttempt || attemptActivities.length === 0 || isStopping) {
      return false;
    }

    // Group activities by execution_process_id and get the latest one for each
    const latestActivitiesByProcess = new Map<string, TaskAttemptActivity>();

    attemptActivities.forEach((activity) => {
      const existing = latestActivitiesByProcess.get(
        activity.execution_process_id
      );
      if (
        !existing ||
        new Date(activity.created_at) > new Date(existing.created_at)
      ) {
        latestActivitiesByProcess.set(activity.execution_process_id, activity);
      }
    });

    // Check if any execution process has a running status as its latest activity
    return Array.from(latestActivitiesByProcess.values()).some(
      (activity) =>
        activity.status === "setuprunning" ||
        activity.status === "executorrunning"
    );
  }, [selectedAttempt, attemptActivities, isStopping]);

  // Check if follow-up should be enabled
  const canSendFollowUp = useMemo(() => {
    if (!selectedAttempt || attemptActivities.length === 0 || isAttemptRunning || isSendingFollowUp) {
      return false;
    }

    // Need at least one completed coding agent execution
    const codingAgentActivities = attemptActivities.filter(
      (activity) => activity.status === "executorcomplete"
    );

    return codingAgentActivities.length > 0;
  }, [selectedAttempt, attemptActivities, isAttemptRunning, isSendingFollowUp]);

  // Polling for updates when attempt is running
  useEffect(() => {
    if (!isAttemptRunning || !task) return;

    const interval = setInterval(() => {
      if (selectedAttempt) {
        fetchAttemptActivities(selectedAttempt.id, true);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isAttemptRunning, task?.id, selectedAttempt?.id]);

  // Set default executor from config
  useEffect(() => {
    if (config) {
      setSelectedExecutor(config.executor.type);
    }
  }, [config]);

  useEffect(() => {
    if (task && isOpen) {
      fetchTaskAttempts();
    }
  }, [task, isOpen]);

  // Auto-scroll to bottom when activities or execution processes change
  useEffect(() => {
    if (shouldAutoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [attemptActivities, executionProcesses, shouldAutoScroll]);

  // Handle scroll events to detect manual scrolling
  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5; // 5px tolerance
      
      if (isAtBottom && !shouldAutoScroll) {
        setShouldAutoScroll(true);
      } else if (!isAtBottom && shouldAutoScroll) {
        setShouldAutoScroll(false);
      }
    }
  }, [shouldAutoScroll]);

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
          } else {
            // Clear state when no attempts exist
            setSelectedAttempt(null);
            setAttemptActivities([]);
            setExecutionProcesses({});
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

          // Fetch execution processes for running activities
          const runningActivities = result.data.filter(
            (activity) =>
              activity.status === "setuprunning" ||
              activity.status === "executorrunning"
          );

          for (const activity of runningActivities) {
            fetchExecutionProcess(activity.execution_process_id);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch attempt activities:", err);
    }
  };

  const fetchExecutionProcess = async (processId: string) => {
    if (!task) return;

    try {
      const response = await makeRequest(
        `/api/projects/${projectId}/execution-processes/${processId}`
      );

      if (response.ok) {
        const result: ApiResponse<ExecutionProcess> = await response.json();
        if (result.success && result.data) {
          setExecutionProcesses((prev) => ({
            ...prev,
            [processId]: result.data!,
          }));
        }
      }
    } catch (err) {
      console.error("Failed to fetch execution process:", err);
    }
  };

  const handleAttemptChange = (attemptId: string) => {
    const attempt = taskAttempts.find((a) => a.id === attemptId);
    if (attempt) {
      setSelectedAttempt(attempt);
      fetchAttemptActivities(attempt.id);
    }
  };

  const openInEditor = async (editorType?: EditorType) => {
    if (!task || !selectedAttempt) return;

    try {
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts/${selectedAttempt.id}/open-editor`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(editorType ? { editor_type: editorType } : null),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to open editor");
      }
    } catch (err) {
      console.error("Failed to open editor:", err);
      // Show editor selection dialog if editor failed to open
      if (!editorType) {
        setShowEditorDialog(true);
      }
    }
  };

  const createNewAttempt = async (executor?: string) => {
    if (!task) return;

    try {
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            executor: executor || selectedExecutor,
          }),
        }
      );

      if (response.ok) {
        // Refresh the attempts list
        fetchTaskAttempts();
      }
    } catch (err) {
      console.error("Failed to create new attempt:", err);
    }
  };

  const stopAllExecutions = async () => {
    if (!task || !selectedAttempt) return;

    try {
      setIsStopping(true);
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
        // Clear cached execution processes since they should be stopped
        setExecutionProcesses({});
        // Refresh activities to show updated status
        await fetchAttemptActivities(selectedAttempt.id);
        // Wait a bit for the backend to finish updating
        setTimeout(() => {
          fetchAttemptActivities(selectedAttempt.id);
        }, 1000);
      }
    } catch (err) {
      console.error("Failed to stop executions:", err);
    } finally {
      setIsStopping(false);
    }
  };

  const toggleOutputExpansion = (processId: string) => {
    setExpandedOutputs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(processId)) {
        newSet.delete(processId);
      } else {
        newSet.add(processId);
      }
      return newSet;
    });
  };

  const handleSendFollowUp = async () => {
    if (!task || !selectedAttempt || !followUpMessage.trim()) return;

    try {
      setIsSendingFollowUp(true);
      setFollowUpError(null);
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts/${selectedAttempt.id}/follow-up`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: followUpMessage.trim(),
          }),
        }
      );

      if (response.ok) {
        // Clear the message
        setFollowUpMessage("");
        // Refresh activities to show the new follow-up execution
        fetchAttemptActivities(selectedAttempt.id);
      } else {
        const errorText = await response.text();
        setFollowUpError(`Failed to start follow-up execution: ${errorText || response.statusText}`);
      }
    } catch (err) {
      setFollowUpError(`Failed to send follow-up: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsSendingFollowUp(false);
    }
  };

  if (!task) return null;

  return (
    <>
      {isOpen && (
        <>
          {/* Backdrop - only on smaller screens (overlay mode) */}
          <div className={getBackdropClasses()} onClick={onClose} />

          {/* Panel */}
          <div className={getTaskPanelClasses()}>
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="p-6 border-b space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold mb-2 line-clamp-2">
                      {task.title}
                    </h2>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Chip dotColor={getTaskStatusDotColor(task.status)}>
                        {statusLabels[task.status]}
                      </Chip>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {onEditTask && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onEditTask(task)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {onDeleteTask && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDeleteTask(task.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={onClose}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <div className="p-3 bg-muted/30 rounded-md">
                    {task.description ? (
                      <div>
                        <p
                          className={`text-sm whitespace-pre-wrap ${
                            !isDescriptionExpanded &&
                            task.description.length > 200
                              ? "line-clamp-6"
                              : ""
                          }`}
                        >
                          {task.description}
                        </p>
                        {task.description.length > 200 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setIsDescriptionExpanded(!isDescriptionExpanded)
                            }
                            className="mt-2 p-0 h-auto text-xs text-muted-foreground hover:text-foreground"
                          >
                            {isDescriptionExpanded ? (
                              <>
                                <ChevronUp className="h-3 w-3 mr-1" />
                                Show less
                              </>
                            ) : (
                              <>
                                <ChevronDown className="h-3 w-3 mr-1" />
                                Show more
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">
                        No description provided
                      </p>
                    )}
                  </div>
                </div>

                {/* Attempt Selection */}
                <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-md">
                  <div className="flex items-center gap-2 flex-1">
                    {selectedAttempt && (
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium">
                          <span className="text-sm text-muted-foreground">
                            Current attempt:{" "}
                          </span>
                          {new Date(
                            selectedAttempt.created_at
                          ).toLocaleDateString()}{" "}
                          {new Date(
                            selectedAttempt.created_at
                          ).toLocaleTimeString()}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">
                          Worktree: {selectedAttempt.worktree_path}
                        </span>
                      </div>
                    )}
                    <div className="flex gap-1">
                      {taskAttempts.length > 1 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                              <History className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-64">
                            {taskAttempts.map((attempt) => (
                              <DropdownMenuItem
                                key={attempt.id}
                                onClick={() => handleAttemptChange(attempt.id)}
                                className={
                                  selectedAttempt?.id === attempt.id
                                    ? "bg-accent"
                                    : ""
                                }
                              >
                                <div className="flex flex-col w-full">
                                  <span className="font-medium text-sm">
                                    {new Date(
                                      attempt.created_at
                                    ).toLocaleDateString()}{" "}
                                    {new Date(
                                      attempt.created_at
                                    ).toLocaleTimeString()}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {attempt.executor || "executor"}
                                  </span>
                                </div>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      <div className="flex">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => createNewAttempt()}
                          className="rounded-r-none border-r-0"
                        >
                          {selectedAttempt ? "Retry " : "Attempt "}
                          with{" "}
                          {
                            availableExecutors.find(
                              (e) => e.id === selectedExecutor
                            )?.name
                          }
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-l-none px-2"
                            >
                              <Settings2 className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {availableExecutors.map((executor) => (
                              <DropdownMenuItem
                                key={executor.id}
                                onClick={() => setSelectedExecutor(executor.id)}
                                className={
                                  selectedExecutor === executor.id
                                    ? "bg-accent"
                                    : ""
                                }
                              >
                                {executor.name}
                                {selectedExecutor === executor.id &&
                                  " (Default)"}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>

                  {selectedAttempt && (
                    <div className="flex gap-1">
                      {(isAttemptRunning || isStopping) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={stopAllExecutions}
                          disabled={isStopping}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          <StopCircle className="h-4 w-4 mr-1" />
                          {isStopping ? "Stopping..." : "Stop"}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openInEditor()}
                      >
                        <Code className="h-4 w-4 mr-1" />
                        Editor
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          to={`/projects/${projectId}/tasks/${task.id}/attempts/${selectedAttempt.id}/compare`}
                        >
                          <FileText className="h-4 w-4 mr-1" />
                          Changes
                        </Link>
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Content */}
              <div 
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto p-6 space-y-6"
              >
                {loading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading...</p>
                  </div>
                ) : (
                  <>
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
                          <div className="space-y-2">
                            {/* Fake worktree created activity */}
                            {selectedAttempt && (
                              <div key="worktree-created">
                                <div className="flex items-center gap-3 my-4 rounded-md">
                                  <Chip dotColor="bg-green-500">
                                    New Worktree
                                  </Chip>
                                  <span className="text-sm text-muted-foreground flex-1">
                                    {selectedAttempt.worktree_path}
                                  </span>
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    {new Date(
                                      selectedAttempt.created_at
                                    ).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      second: "2-digit",
                                    })}
                                  </div>
                                </div>
                              </div>
                            )}
                            {attemptActivities.slice().map((activity) => (
                              <div key={activity.id}>
                                {/* Compact activity message */}
                                <div className="flex items-center gap-3 my-4 rounded-md">
                                  <Chip
                                    dotColor={
                                      getAttemptStatusDisplay(activity.status)
                                        .dotColor
                                    }
                                  >
                                    {
                                      getAttemptStatusDisplay(activity.status)
                                        .label
                                    }
                                  </Chip>
                                  {activity.note && (
                                    <span className="text-sm text-muted-foreground flex-1">
                                      {activity.note}
                                    </span>
                                  )}
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    {new Date(
                                      activity.created_at
                                    ).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      second: "2-digit",
                                    })}
                                  </div>
                                </div>

                                {/* Show stdio output for running processes */}
                                {(activity.status === "setuprunning" ||
                                  activity.status === "executorrunning") &&
                                  executionProcesses[
                                    activity.execution_process_id
                                  ] && (
                                    <div className="mt-2">
                                      <div
                                      className={`transition-all duration-200 ${
                                      expandedOutputs.has(
                                      activity.execution_process_id
                                      )
                                      ? ""
                                      : "max-h-64 overflow-hidden flex flex-col justify-end"
                                      }`}
                                      >
                                        <ExecutionOutputViewer
                                          executionProcess={
                                            executionProcesses[
                                              activity.execution_process_id
                                            ]
                                          }
                                          executor={
                                            selectedAttempt?.executor ||
                                            undefined
                                          }
                                        />
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          toggleOutputExpansion(
                                            activity.execution_process_id
                                          )
                                        }
                                        className="mt-2 p-0 h-auto text-xs text-muted-foreground hover:text-foreground"
                                      >
                                        {expandedOutputs.has(
                                          activity.execution_process_id
                                        ) ? (
                                          <>
                                            <ChevronUp className="h-3 w-3 mr-1" />
                                            Show less
                                          </>
                                        ) : (
                                          <>
                                            <ChevronDown className="h-3 w-3 mr-1" />
                                            Show more
                                          </>
                                        )}
                                      </Button>
                                    </div>
                                  )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Footer - Follow-up section */}
              {selectedAttempt && (
                <div className="border-t p-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Follow-up question
                    </Label>
                    {followUpError && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{followUpError}</AlertDescription>
                      </Alert>
                    )}
                    <div className="flex gap-2">
                      <Textarea
                        placeholder="Ask a follow-up question about this task..."
                        value={followUpMessage}
                        onChange={(e) => {
                          setFollowUpMessage(e.target.value);
                          if (followUpError) setFollowUpError(null);
                        }}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                            e.preventDefault();
                            if (canSendFollowUp && followUpMessage.trim() && !isSendingFollowUp) {
                              handleSendFollowUp();
                            }
                          }
                        }}
                        className="flex-1 min-h-[60px] resize-none"
                        disabled={!canSendFollowUp}
                      />
                      <Button
                        onClick={handleSendFollowUp}
                        disabled={!canSendFollowUp || !followUpMessage.trim() || isSendingFollowUp}
                        className="self-end"
                      >
                        {isSendingFollowUp ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {!canSendFollowUp
                        ? isAttemptRunning
                          ? "Wait for current execution to complete before asking follow-up questions"
                          : "Complete at least one coding agent execution to enable follow-up questions"
                        : "Continue the conversation with the most recent executor session"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Editor Selection Dialog */}
          <EditorSelectionDialog
            isOpen={showEditorDialog}
            onClose={() => setShowEditorDialog(false)}
            onSelectEditor={(editorType) => openInEditor(editorType)}
          />
        </>
      )}
    </>
  );
}
