import {
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  Circle,
  FileText,
  Pencil,
  Search,
  Sparkles,
  Terminal,
  X as XIcon,
  type LucideIcon,
} from 'lucide-react';
import { ChatMarkdown } from '@/components/ui-new/primitives/conversation/ChatMarkdown';
import { cn } from '@/lib/utils';
import './WorkflowAgentLogPanel.css';

export type TaskStatus = 'running' | 'success' | 'error';

export type TaskToolType =
  | 'skill'
  | 'read'
  | 'write'
  | 'search'
  | 'edit'
  | 'command'
  | 'think'
  | 'unknown';

export type TaskItemData = {
  key: string;
  status: TaskStatus;
  toolType: TaskToolType;
  target: string;
  collapsedTarget: string;
};

type AgentLogGroup = {
  key: string;
  agentName: string;
  lines: Array<{
    key: string;
    timestamp: string;
    content: string;
    isError: boolean;
  }>;
};

const TOOL_ICON_MAP: Record<TaskToolType, LucideIcon> = {
  skill: Sparkles,
  read: FileText,
  write: Pencil,
  search: Search,
  edit: Pencil,
  command: Terminal,
  think: Circle,
  unknown: Circle,
};

const TOOL_LABELS: Record<TaskToolType, string> = {
  skill: 'skill',
  read: 'read',
  write: 'write',
  search: 'search',
  edit: 'edit',
  command: 'cmd',
  think: 'think',
  unknown: '',
};

function detectToolType(content: string): TaskToolType {
  const lower = content.toLowerCase();
  if (/\bskill\b/.test(lower)) return 'skill';
  if (/\bsearch\b|\bgrep\b|\bfind\b|\bripgrep\b/.test(lower)) return 'search';
  if (/\bread\b|\bfile read\b|\breading\b/.test(lower)) return 'read';
  if (/\bwrit(e|ing)\b|\bcreate\b|\bappend\b/.test(lower)) return 'write';
  if (/\bedit\b|\breplace\b|\bmodif(y|ied)\b/.test(lower)) return 'edit';
  if (/\bcommand\b|\bexecut(e|ing)\b|\brun\b|\bshell\b|\bbash\b/.test(lower))
    return 'command';
  if (/\bthink\b|\breason\b/.test(lower)) return 'think';
  return 'unknown';
}

function detectStatus(content: string, isError: boolean): TaskStatus {
  if (isError) return 'error';

  const lower = content.toLowerCase();
  if (/\bcompleted?\b|\bfinished\b|\bdone\b|\bsuccess\b/.test(lower))
    return 'success';
  if (/\bstart(ed|ing)?\b/.test(lower)) return 'running';
  return 'success';
}

function extractTarget(content: string): string {
  const cleaned = content
    .replace(
      /^(Started|Completed|Running|Finished|Done)\s+(file\s+)?(read|write|search|edit|tool|skill|command)\s*:?\s*/i,
      ''
    )
    .replace(/^Tool\s*:\s*/i, '')
    .trim();

  return cleaned || content.trim();
}

function toCollapsedTarget(target: string): string {
  if (target.length <= 60) return target;

  const parts = target.split(/[/\\]/);
  if (parts.length > 3) {
    return `.../${parts.slice(-2).join('/')}`;
  }

  return target;
}

function consolidateLogLines(lines: AgentLogGroup['lines']): TaskItemData[] {
  const tasks = new Map<string, TaskItemData>();
  const orderedKeys: string[] = [];

  for (const line of lines) {
    const toolType = detectToolType(line.content);
    const target = extractTarget(line.content);
    const collapsedTarget = toCollapsedTarget(target);
    const status = detectStatus(line.content, line.isError);
    const consolidationKey = `${toolType}::${target}`;
    const existing = tasks.get(consolidationKey);

    if (existing) {
      if (status === 'success' || status === 'error') {
        existing.status = status;
      }
      continue;
    }

    tasks.set(consolidationKey, {
      key: line.key,
      status,
      toolType,
      target,
      collapsedTarget,
    });
    orderedKeys.push(consolidationKey);
  }

  return orderedKeys.map((key) => tasks.get(key)!);
}

function isToolCallType(toolType: TaskToolType): boolean {
  return (
    toolType === 'read' ||
    toolType === 'write' ||
    toolType === 'search' ||
    toolType === 'edit' ||
    toolType === 'command'
  );
}

function TaskItem({
  status,
  toolType,
  target,
  collapsedTarget,
}: {
  status: TaskStatus;
  toolType: TaskToolType;
  target: string;
  collapsedTarget: string;
}) {
  const ToolIcon = TOOL_ICON_MAP[toolType];
  const label = TOOL_LABELS[toolType];
  const isContentEntry = !isToolCallType(toolType);
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpanded = () => {
    setIsExpanded((expanded) => !expanded);
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const targetElement =
      event.target instanceof HTMLElement ? event.target : null;
    if (targetElement?.closest('a, button, input, select, textarea')) return;
    toggleExpanded();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleExpanded();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-label={
        isExpanded
          ? `Collapse ${isContentEntry ? 'log content' : 'tool call'}`
          : `Expand ${isContentEntry ? 'log content' : 'tool call'}`
      }
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'wf-log-task-row',
        'wf-log-task-row--toggleable',
        isContentEntry && 'wf-log-task-row--content',
        isExpanded && 'wf-log-task-row--expanded'
      )}
    >
      <span className="wf-log-task-status">
        {status === 'running' && !isContentEntry && (
          <span
            className="wf-log-spinner"
            aria-label="running"
          />
        )}
        {status === 'error' && (
          <XIcon
            className="wf-log-error-x-icon"
            aria-label="error"
          />
        )}
      </span>

      {!isContentEntry && (
        <span
          className={cn(
            'wf-log-task-tool-icon',
            status === 'success' && 'wf-log-task-tool-icon--dimmed'
          )}
        >
          <ToolIcon className="w-3 h-3" />
        </span>
      )}

      {!isContentEntry && label && (
        <span className="wf-log-task-label">{label}</span>
      )}

      {isContentEntry ? (
        <div
          className={cn(
            'wf-log-task-content',
            isExpanded
              ? 'wf-log-task-content--expanded'
              : 'wf-log-task-content--collapsed'
          )}
        >
          <ChatMarkdown
            content={target}
            maxWidth="100%"
            textClassName="wf-log-markdown"
            className="w-full select-text"
            hideCopyButton
          />
        </div>
      ) : (
        <span
          className={cn(
            'wf-log-task-target',
            isExpanded && 'wf-log-task-target--expanded'
          )}
          title={target}
        >
          {isExpanded ? target : collapsedTarget}
        </span>
      )}
    </div>
  );
}

export type WorkflowAgentLogPanelProps = {
  agentLogGroups: AgentLogGroup[];
  isLoading: boolean;
  emptyMessage?: string;
  loadingMessage?: string;
  stepStatus?: string;
};

export function WorkflowAgentLogPanel({
  agentLogGroups,
  isLoading,
  emptyMessage = 'No logs for this step yet.',
  loadingMessage = 'Loading logs...',
}: WorkflowAgentLogPanelProps) {
  const consolidatedGroups = useMemo(
    () =>
      agentLogGroups.map((group) => ({
        ...group,
        tasks: consolidateLogLines(group.lines),
      })),
    [agentLogGroups]
  );

  if (isLoading) {
    return (
      <div className="wf-log-panel wf-log-panel--empty">
        <span className="wf-log-spinner" />
        <span className="wf-log-panel-message">{loadingMessage}</span>
      </div>
    );
  }

  if (
    consolidatedGroups.length === 0 ||
    consolidatedGroups.every((group) => group.tasks.length === 0)
  ) {
    return (
      <div className="wf-log-panel wf-log-panel--empty">
        <span className="wf-log-panel-message">{emptyMessage}</span>
      </div>
    );
  }

  return (
    <div className="wf-log-panel">
      {consolidatedGroups.map((group) => (
        <div
          key={group.key}
          className="wf-log-group"
        >
          <div className="wf-log-group-header">
            <span className="wf-log-group-agent">{group.agentName}</span>
          </div>
          <div className="wf-log-group-tasks">
            {group.tasks
              .filter(
                (task) =>
                  !(isToolCallType(task.toolType) && task.status === 'running')
              )
              .map((task) => (
                <TaskItem
                  key={task.key}
                  status={task.status}
                  toolType={task.toolType}
                  target={task.target}
                  collapsedTarget={task.collapsedTarget}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}