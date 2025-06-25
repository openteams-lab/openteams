import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  X,
  History,
  Clock,
  ChevronDown,
  ChevronUp,
  Settings2,
  Edit,
  Trash2,
  StopCircle,
  Send,
  AlertCircle,
  Play,
  GitCompare,
  ExternalLink,
  Code,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Chip } from '@/components/ui/chip';
import { FileSearchTextarea } from '@/components/ui/file-search-textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ExecutionOutputViewer } from './ExecutionOutputViewer';
import { EditorSelectionDialog } from './EditorSelectionDialog';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { makeRequest } from '@/lib/api';
import {
  getTaskPanelClasses,
  getBackdropClasses,
} from '@/lib/responsive-config';
import { useConfig } from '@/components/config-provider';
import type {
  TaskStatus,
  TaskAttempt,
  TaskAttemptActivity,
  TaskAttemptActivityWithPrompt,
  TaskAttemptStatus,
  ApiResponse,
  TaskWithAttemptStatus,
  ExecutionProcess,
  ExecutionProcessSummary,
  EditorType,
  Project,
} from 'shared/types';

interface TaskDetailsPanelProps {
  task: TaskWithAttemptStatus | null;
  project: Project | null;
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onEditTask?: (task: TaskWithAttemptStatus) => void;
  onDeleteTask?: (taskId: string) => void;
  isDialogOpen?: boolean; // New prop to indicate if any dialog is open
}

const statusLabels: Record<TaskStatus, string> = {
  todo: 'To Do',
  inprogress: 'In Progress',
  inreview: 'In Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

const getTaskStatusDotColor = (status: TaskStatus): string => {
  switch (status) {
    case 'todo':
      return 'bg-gray-400';
    case 'inprogress':
      return 'bg-blue-500';
    case 'inreview':
      return 'bg-yellow-500';
    case 'done':
      return 'bg-green-500';
    case 'cancelled':
      return 'bg-red-500';
    default:
      return 'bg-gray-400';
  }
};

const getAttemptStatusDisplay = (
  status: TaskAttemptStatus
): { label: string; dotColor: string } => {
  switch (status) {
    case 'setuprunning':
      return {
        label: 'Setup Running',
        dotColor: 'bg-blue-500',
      };
    case 'setupcomplete':
      return {
        label: 'Setup Complete',
        dotColor: 'bg-green-500',
      };
    case 'setupfailed':
      return {
        label: 'Setup Failed',
        dotColor: 'bg-red-500',
      };
    case 'executorrunning':
      return {
        label: 'Executor Running',
        dotColor: 'bg-blue-500',
      };
    case 'executorcomplete':
      return {
        label: 'Executor Complete',
        dotColor: 'bg-green-500',
      };
    case 'executorfailed':
      return {
        label: 'Executor Failed',
        dotColor: 'bg-red-500',
      };
    default:
      return {
        label: 'Unknown',
        dotColor: 'bg-gray-400',
      };
  }
};

export function TaskDetailsPanel({
  task,
  project,
  projectId,
  isOpen,
  onClose,
  onEditTask,
  onDeleteTask,
  isDialogOpen = false,
}: TaskDetailsPanelProps) {
  const [taskAttempts, setTaskAttempts] = useState<TaskAttempt[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<TaskAttempt | null>(
    null
  );
  // Combined attempt data state
  const [attemptData, setAttemptData] = useState<{
    activities: TaskAttemptActivityWithPrompt[];
    processes: ExecutionProcessSummary[];
    runningProcessDetails: Record<string, ExecutionProcess>;
  }>({
    activities: [],
    processes: [],
    runningProcessDetails: {},
  });
  const [loading, setLoading] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [selectedExecutor, setSelectedExecutor] = useState<string>('claude');
  const [isStopping, setIsStopping] = useState(false);
  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(
    new Set()
  );
  const [showEditorDialog, setShowEditorDialog] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState('');
  const [isSendingFollowUp, setIsSendingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [isStartingDevServer, setIsStartingDevServer] = useState(false);
  const [devServerDetails, setDevServerDetails] =
    useState<ExecutionProcess | null>(null);
  const [isHoveringDevServer, setIsHoveringDevServer] = useState(false);

  // Auto-scroll state
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { config } = useConfig();

  // Find running dev server in current project (across all task attempts)
  const runningDevServer = useMemo(() => {
    return attemptData.processes.find(
      (process) =>
        process.process_type === 'devserver' && process.status === 'running'
    );
  }, [attemptData.processes]);

  // Handle ESC key locally to prevent global navigation
  useEffect(() => {
    if (!isOpen || isDialogOpen) return; // Don't handle ESC if dialog is open

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true); // Use capture phase
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose, isDialogOpen]);

  // Available executors
  const availableExecutors = [
    { id: 'echo', name: 'Echo' },
    { id: 'claude', name: 'Claude' },
    { id: 'amp', name: 'Amp' },
  ];

  // Check if any execution process is currently running
  const isAttemptRunning = useMemo(() => {
    if (!selectedAttempt || attemptData.activities.length === 0 || isStopping) {
      return false;
    }

    // Group activities by execution_process_id and get the latest one for each
    const latestActivitiesByProcess = new Map<string, TaskAttemptActivity>();

    attemptData.activities.forEach((activity) => {
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
        activity.status === 'setuprunning' ||
        activity.status === 'executorrunning'
    );
  }, [selectedAttempt, attemptData.activities, isStopping]);

  // Check if follow-up should be enabled
  const canSendFollowUp = useMemo(() => {
    if (
      !selectedAttempt ||
      attemptData.activities.length === 0 ||
      isAttemptRunning ||
      isSendingFollowUp
    ) {
      return false;
    }

    // Need at least one completed coding agent execution
    const codingAgentActivities = attemptData.activities.filter(
      (activity) => activity.status === 'executorcomplete'
    );

    return codingAgentActivities.length > 0;
  }, [
    selectedAttempt,
    attemptData.activities,
    isAttemptRunning,
    isSendingFollowUp,
  ]);

  // Polling for updates when attempt is running
  useEffect(() => {
    if (!isAttemptRunning || !task) return;

    const interval = setInterval(() => {
      if (selectedAttempt) {
        fetchAttemptData(selectedAttempt.id, true);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isAttemptRunning, task?.id, selectedAttempt?.id]);

  // Fetch dev server details when hovering
  const fetchDevServerDetails = async () => {
    if (!runningDevServer || !task || !selectedAttempt) return;

    try {
      const response = await makeRequest(
        `/api/projects/${projectId}/execution-processes/${runningDevServer.id}`
      );
      if (response.ok) {
        const result: ApiResponse<ExecutionProcess> = await response.json();
        if (result.success && result.data) {
          setDevServerDetails(result.data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch dev server details:', err);
    }
  };

  // Poll dev server details while hovering
  useEffect(() => {
    if (!isHoveringDevServer || !runningDevServer) {
      setDevServerDetails(null);
      return;
    }

    // Fetch immediately
    fetchDevServerDetails();

    // Then poll every 2 seconds
    const interval = setInterval(fetchDevServerDetails, 2000);
    return () => clearInterval(interval);
  }, [
    isHoveringDevServer,
    runningDevServer?.id,
    task?.id,
    selectedAttempt?.id,
  ]);

  // Memoize processed dev server logs to prevent stuttering
  const processedDevServerLogs = useMemo(() => {
    if (!devServerDetails) return 'No output yet...';

    const stdout = devServerDetails.stdout || '';
    const stderr = devServerDetails.stderr || '';
    const allOutput = stdout + (stderr ? '\n' + stderr : '');
    const lines = allOutput.split('\n').filter((line) => line.trim());
    const lastLines = lines.slice(-10);
    return lastLines.length > 0 ? lastLines.join('\n') : 'No output yet...';
  }, [devServerDetails?.stdout, devServerDetails?.stderr]);

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
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [attemptData.activities, attemptData.processes, shouldAutoScroll]);

  // Handle scroll events to detect manual scrolling
  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } =
        scrollContainerRef.current;
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
            fetchAttemptData(latestAttempt.id);
          } else {
            // Clear state when no attempts exist
            setSelectedAttempt(null);
            setAttemptData({
              activities: [],
              processes: [],
              runningProcessDetails: {},
            });
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch task attempts:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAttemptData = async (
    attemptId: string,
    _isBackgroundUpdate = false
  ) => {
    if (!task) return;

    try {
      const [activitiesResponse, processesResponse] = await Promise.all([
        makeRequest(
          `/api/projects/${projectId}/tasks/${task.id}/attempts/${attemptId}/activities`
        ),
        makeRequest(
          `/api/projects/${projectId}/tasks/${task.id}/attempts/${attemptId}/execution-processes`
        ),
      ]);

      if (activitiesResponse.ok && processesResponse.ok) {
        const activitiesResult: ApiResponse<TaskAttemptActivityWithPrompt[]> =
          await activitiesResponse.json();
        const processesResult: ApiResponse<ExecutionProcessSummary[]> =
          await processesResponse.json();

        if (
          activitiesResult.success &&
          processesResult.success &&
          activitiesResult.data &&
          processesResult.data
        ) {
          // Find running activities that need detailed execution info
          const runningActivities = activitiesResult.data.filter(
            (activity) =>
              activity.status === 'setuprunning' ||
              activity.status === 'executorrunning'
          );

          // Fetch detailed execution info for running processes
          const runningProcessDetails: Record<string, ExecutionProcess> = {};
          for (const activity of runningActivities) {
            try {
              const detailResponse = await makeRequest(
                `/api/projects/${projectId}/execution-processes/${activity.execution_process_id}`
              );
              if (detailResponse.ok) {
                const detailResult: ApiResponse<ExecutionProcess> =
                  await detailResponse.json();
                if (detailResult.success && detailResult.data) {
                  runningProcessDetails[activity.execution_process_id] =
                    detailResult.data;
                }
              }
            } catch (err) {
              console.error(
                `Failed to fetch execution process ${activity.execution_process_id}:`,
                err
              );
            }
          }

          // Update all attempt data at once
          setAttemptData({
            activities: activitiesResult.data,
            processes: processesResult.data,
            runningProcessDetails,
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch attempt data:', err);
    }
  };

  const handleAttemptChange = (attemptId: string) => {
    const attempt = taskAttempts.find((a) => a.id === attemptId);
    if (attempt) {
      setSelectedAttempt(attempt);
      fetchAttemptData(attempt.id);
    }
  };

  const openInEditor = async (editorType?: EditorType) => {
    if (!task || !selectedAttempt) return;

    try {
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts/${selectedAttempt.id}/open-editor`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(editorType ? { editor_type: editorType } : null),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to open editor');
      }
    } catch (err) {
      console.error('Failed to open editor:', err);
      // Show editor selection dialog if editor failed to open
      if (!editorType) {
        setShowEditorDialog(true);
      }
    }
  };

  const startDevServer = async () => {
    if (!task || !selectedAttempt || !project?.dev_script) return;

    setIsStartingDevServer(true);

    try {
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts/${selectedAttempt.id}/start-dev-server`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to start dev server');
      }

      const data: ApiResponse<null> = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Failed to start dev server');
      }

      // Refresh activities to show the new dev server process
      fetchAttemptData(selectedAttempt.id);
    } catch (err) {
      console.error('Failed to start dev server:', err);
    } finally {
      setIsStartingDevServer(false);
    }
  };

  const stopDevServer = async () => {
    if (!task || !selectedAttempt || !runningDevServer) return;

    setIsStartingDevServer(true);

    try {
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts/${selectedAttempt.id}/execution-processes/${runningDevServer.id}/stop`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to stop dev server');
      }

      // Refresh activities to show the stopped dev server
      fetchAttemptData(selectedAttempt.id);
    } catch (err) {
      console.error('Failed to stop dev server:', err);
    } finally {
      setIsStartingDevServer(false);
    }
  };

  const createNewAttempt = async (executor?: string) => {
    if (!task) return;

    try {
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
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
      console.error('Failed to create new attempt:', err);
    }
  };

  const stopAllExecutions = async () => {
    if (!task || !selectedAttempt) return;

    try {
      setIsStopping(true);
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${task.id}/attempts/${selectedAttempt.id}/stop`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        // Refresh activities to show updated status
        await fetchAttemptData(selectedAttempt.id);
        // Wait a bit for the backend to finish updating
        setTimeout(() => {
          fetchAttemptData(selectedAttempt.id);
        }, 1000);
      }
    } catch (err) {
      console.error('Failed to stop executions:', err);
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
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: followUpMessage.trim(),
          }),
        }
      );

      if (response.ok) {
        // Clear the message
        setFollowUpMessage('');
        // Refresh activities to show the new follow-up execution
        fetchAttemptData(selectedAttempt.id);
      } else {
        const errorText = await response.text();
        setFollowUpError(
          `Failed to start follow-up execution: ${
            errorText || response.statusText
          }`
        );
      }
    } catch (err) {
      setFollowUpError(
        `Failed to send follow-up: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`
      );
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
              <div className="border-b">
                {/* Title and Task Actions */}
                <div className="p-6 pb-4">
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
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onEditTask(task)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Edit task</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {onDeleteTask && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onDeleteTask(task.id)}
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Delete task</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={onClose}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Close panel</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="mt-4">
                    <div className="p-3 bg-muted/30 rounded-md">
                      {task.description ? (
                        <div>
                          <p
                            className={`text-sm whitespace-pre-wrap ${
                              !isDescriptionExpanded &&
                              task.description.length > 200
                                ? 'line-clamp-6'
                                : ''
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
                </div>

                {/* Integrated Toolbar */}
                <div className="px-6 pb-4">
                  <div className="flex items-center justify-between gap-4 p-3 bg-muted/20 rounded-lg border">
                    {/* Current Attempt Info */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {selectedAttempt ? (
                        <>
                          <div className="text-sm">
                            <span className="font-medium">
                              {new Date(
                                selectedAttempt.created_at
                              ).toLocaleDateString()}{' '}
                              {new Date(
                                selectedAttempt.created_at
                              ).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <span className="text-muted-foreground ml-2">
                              ({selectedAttempt.executor || 'executor'})
                            </span>
                          </div>
                          <div className="h-4 w-px bg-border" />
                        </>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No attempts yet
                        </div>
                      )}
                    </div>

                    {/* Action Button Groups */}
                    <div className="flex items-center gap-2">
                      {/* Attempt Management Group */}
                      <div className="flex items-center gap-1">
                        {taskAttempts.length > 1 && (
                          <DropdownMenu>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm">
                                      <History className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>View attempt history</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <DropdownMenuContent align="start" className="w-64">
                              {taskAttempts.map((attempt) => (
                                <DropdownMenuItem
                                  key={attempt.id}
                                  onClick={() =>
                                    handleAttemptChange(attempt.id)
                                  }
                                  className={
                                    selectedAttempt?.id === attempt.id
                                      ? 'bg-accent'
                                      : ''
                                  }
                                >
                                  <div className="flex flex-col w-full">
                                    <span className="font-medium text-sm">
                                      {new Date(
                                        attempt.created_at
                                      ).toLocaleDateString()}{' '}
                                      {new Date(
                                        attempt.created_at
                                      ).toLocaleTimeString()}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {attempt.executor || 'executor'}
                                    </span>
                                  </div>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        {isAttemptRunning || isStopping ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={stopAllExecutions}
                                  disabled={isStopping}
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50 disabled:opacity-50"
                                >
                                  <StopCircle className="h-4 w-4 mr-2" />
                                  {isStopping ? 'Stopping...' : 'Stop Attempt'}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>
                                  {isStopping
                                    ? 'Stopping execution...'
                                    : 'Stop execution'}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <div className="flex">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => createNewAttempt()}
                                    className="rounded-r-none border-r-0"
                                  >
                                    {selectedAttempt
                                      ? 'New Attempt'
                                      : 'Start Attempt'}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>
                                    {selectedAttempt
                                      ? 'Create new attempt with current executor'
                                      : 'Start new attempt with current executor'}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <DropdownMenu>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="rounded-l-none px-2"
                                      >
                                        <Settings2 className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Choose executor</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <DropdownMenuContent align="end">
                                {availableExecutors.map((executor) => (
                                  <DropdownMenuItem
                                    key={executor.id}
                                    onClick={() =>
                                      setSelectedExecutor(executor.id)
                                    }
                                    className={
                                      selectedExecutor === executor.id
                                        ? 'bg-accent'
                                        : ''
                                    }
                                  >
                                    {executor.name}
                                    {config?.executor.type === executor.id &&
                                      ' (Default)'}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                      </div>

                      {selectedAttempt && (
                        <>
                          <div className="h-4 w-px bg-border" />

                          {/* Dev Server Control Group */}
                          <div className="flex items-center gap-1">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className={
                                      !project?.dev_script
                                        ? 'cursor-not-allowed'
                                        : ''
                                    }
                                    onMouseEnter={() =>
                                      setIsHoveringDevServer(true)
                                    }
                                    onMouseLeave={() =>
                                      setIsHoveringDevServer(false)
                                    }
                                  >
                                    <Button
                                      variant={
                                        runningDevServer
                                          ? 'destructive'
                                          : 'outline'
                                      }
                                      size="sm"
                                      onClick={
                                        runningDevServer
                                          ? stopDevServer
                                          : startDevServer
                                      }
                                      disabled={
                                        isStartingDevServer ||
                                        !project?.dev_script
                                      }
                                    >
                                      {runningDevServer ? (
                                        <StopCircle className="h-4 w-4" />
                                      ) : (
                                        <Play className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent
                                  className={
                                    runningDevServer ? 'max-w-2xl p-4' : ''
                                  }
                                  side="top"
                                  align="center"
                                  avoidCollisions={true}
                                >
                                  {!project?.dev_script ? (
                                    <p>
                                      Configure a dev server command in project
                                      settings
                                    </p>
                                  ) : runningDevServer && devServerDetails ? (
                                    <div className="space-y-2">
                                      <p className="text-sm font-medium">
                                        Dev Server Logs (Last 10 lines):
                                      </p>
                                      <pre className="text-xs bg-muted p-2 rounded max-h-64 overflow-y-auto whitespace-pre-wrap">
                                        {processedDevServerLogs}
                                      </pre>
                                    </div>
                                  ) : runningDevServer ? (
                                    <p>Stop the running dev server</p>
                                  ) : (
                                    <p>Start the dev server</p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>

                          <div className="h-4 w-px bg-border" />

                          {/* Code Actions Group */}
                          <div className="flex items-center gap-1">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openInEditor()}
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Open in editor</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="outline" size="sm" asChild>
                                    <Link
                                      to={`/projects/${projectId}/tasks/${task.id}/attempts/${selectedAttempt.id}/compare`}
                                    >
                                      <GitCompare className="h-4 w-4" />
                                    </Link>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>View code changes</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
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
                        {attemptData.activities.length === 0 ? (
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
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      second: '2-digit',
                                    })}
                                  </div>
                                </div>
                              </div>
                            )}
                            {attemptData.activities.slice().map((activity) => (
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
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      second: '2-digit',
                                    })}
                                  </div>
                                </div>

                                {/* Show prompt for coding agent executions */}
                                {activity.prompt &&
                                  activity.status === 'executorrunning' && (
                                    <div className="mt-2 mb-4">
                                      <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-md border border-blue-200 dark:border-blue-800">
                                        <div className="flex items-start gap-2 mb-2">
                                          <Code className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5" />
                                          <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                                            Prompt
                                          </span>
                                        </div>
                                        <pre className="text-sm text-blue-800 dark:text-blue-200 whitespace-pre-wrap break-words">
                                          {activity.prompt}
                                        </pre>
                                      </div>
                                    </div>
                                  )}

                                {/* Show stdio output for running processes */}
                                {(activity.status === 'setuprunning' ||
                                  activity.status === 'executorrunning') &&
                                  attemptData.runningProcessDetails[
                                    activity.execution_process_id
                                  ] && (
                                    <div className="mt-2">
                                      <div
                                        className={`transition-all duration-200 ${
                                          expandedOutputs.has(
                                            activity.execution_process_id
                                          )
                                            ? ''
                                            : 'max-h-64 overflow-hidden flex flex-col justify-end'
                                        }`}
                                      >
                                        <ExecutionOutputViewer
                                          executionProcess={
                                            attemptData.runningProcessDetails[
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
                <div className="border-t p-6">
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">
                      Follow-up question
                    </Label>
                    {followUpError && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{followUpError}</AlertDescription>
                      </Alert>
                    )}
                    <div className="space-y-3">
                      <FileSearchTextarea
                        placeholder="Ask a follow-up question about this task... Type @ to search files."
                        value={followUpMessage}
                        onChange={(value) => {
                          setFollowUpMessage(value);
                          if (followUpError) setFollowUpError(null);
                        }}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                            e.preventDefault();
                            if (
                              canSendFollowUp &&
                              followUpMessage.trim() &&
                              !isSendingFollowUp
                            ) {
                              handleSendFollowUp();
                            }
                          }
                        }}
                        className="w-full min-h-[80px] resize-none"
                        disabled={!canSendFollowUp}
                        projectId={projectId}
                        rows={4}
                      />
                      <div className="flex justify-end">
                        <Button
                          onClick={handleSendFollowUp}
                          disabled={
                            !canSendFollowUp ||
                            !followUpMessage.trim() ||
                            isSendingFollowUp
                          }
                          size="sm"
                        >
                          {isSendingFollowUp ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                          ) : (
                            <>
                              <Send className="h-4 w-4 mr-2" />
                              Send
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {!canSendFollowUp
                        ? isAttemptRunning
                          ? 'Wait for current execution to complete before asking follow-up questions'
                          : 'Complete at least one coding agent execution to enable follow-up questions'
                        : 'Continue the conversation with the most recent executor session'}
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
