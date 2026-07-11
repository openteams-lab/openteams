import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import {
  Activity,
  ChevronRight,
  ClipboardList,
  FilePenLine,
  FileText,
  Globe,
  ListChecks,
  Loader2,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import { ScrollArea } from "@/components/ScrollArea";
import {
  formatAgentActivityLines,
  type AgentActivityDisplayRow,
  type AgentActivityToolKind,
  type AgentActivityTranslator,
} from "@/lib/agentActivityFormatter";
import type { ActivityLoadState, ChatRunActivityLine } from "@/types";
import "@/components/workflow/WorkflowAgentLogPanel.css";

interface AgentActivityPanelLabels {
  loading: string;
  cleaned: string;
  error: string;
  empty: string;
}

interface AgentActivityPanelProps {
  lines?: ChatRunActivityLine[];
  state?: ActivityLoadState;
  labels: AgentActivityPanelLabels;
  translate?: AgentActivityTranslator;
}

const AGENT_ACTIVITY_AUTO_SCROLL_IDLE_MS = 30000;
const AGENT_ACTIVITY_BOTTOM_THRESHOLD_PX = 8;

const toolIconByKind: Record<
  AgentActivityToolKind,
  React.ComponentType<{ className?: string }>
> = {
  command: Terminal,
  file_read: FileText,
  file_edit: FilePenLine,
  search: Search,
  web_fetch: Globe,
  tool: Wrench,
  mcp_tool: Wrench,
  task: ListChecks,
  plan: ClipboardList,
  activity: Activity,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tool-call types that should be hidden while running */
const TOOL_CALL_KINDS = new Set<AgentActivityToolKind>([
  "command",
  "file_read",
  "file_edit",
  "search",
  "web_fetch",
  "tool",
  "mcp_tool",
]);

function isToolCallLine(line: AgentActivityDisplayRow): boolean {
  return line.line_type === "tool" && !!line.toolKind && TOOL_CALL_KINDS.has(line.toolKind);
}

function isToolRunning(line: AgentActivityDisplayRow): boolean {
  return line.toolStatus === "running" || line.toolStatus === "waiting_approval";
}

const renderSimpleBoldMarkdown = (content: string): React.ReactNode => {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let partIndex = 0;

  while (cursor < content.length) {
    const start = content.indexOf("**", cursor);
    if (start < 0) {
      parts.push(content.slice(cursor));
      break;
    }

    const end = content.indexOf("**", start + 2);
    if (end < 0) {
      parts.push(content.slice(cursor));
      break;
    }

    if (start > cursor) {
      parts.push(content.slice(cursor, start));
    }

    const boldText = content.slice(start + 2, end);
    parts.push(
      boldText ? (
        <strong key={`bold-${partIndex}`} className="font-semibold">
          {boldText}
        </strong>
      ) : (
        "**"
      ),
    );
    partIndex += 1;
    cursor = end + 2;
  }

  return parts.length > 0 ? parts : content;
};

// ---------------------------------------------------------------------------
// Auto-scroll hook
// ---------------------------------------------------------------------------

const isScrolledToBottom = (el: HTMLElement): boolean =>
  el.scrollHeight - el.scrollTop - el.clientHeight <=
  AGENT_ACTIVITY_BOTTOM_THRESHOLD_PX;

const useAutoFollowScroll = (scrollSignal: string) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);
  const userInteractingRef = useRef(false);
  const ignoreScrollRef = useRef(false);
  const resumeTimerRef = useRef<number | undefined>(undefined);

  const clearResumeTimer = useCallback(() => {
    if (resumeTimerRef.current === undefined) return;
    window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = undefined;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    ignoreScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    window.requestAnimationFrame(() => {
      ignoreScrollRef.current = false;
    });
  }, []);

  const resumeAutoFollow = useCallback(() => {
    autoFollowRef.current = true;
    userInteractingRef.current = false;
    scrollToBottom();
  }, [scrollToBottom]);

  const scheduleResume = useCallback(() => {
    clearResumeTimer();
    resumeTimerRef.current = window.setTimeout(
      resumeAutoFollow,
      AGENT_ACTIVITY_AUTO_SCROLL_IDLE_MS,
    );
  }, [clearResumeTimer, resumeAutoFollow]);

  const noteUserInteraction = useCallback(() => {
    userInteractingRef.current = true;
    scheduleResume();
  }, [scheduleResume]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || ignoreScrollRef.current) return;

    if (isScrolledToBottom(el)) {
      autoFollowRef.current = true;
      userInteractingRef.current = false;
      clearResumeTimer();
      return;
    }

    if (userInteractingRef.current) {
      autoFollowRef.current = false;
      scheduleResume();
    }
  }, [clearResumeTimer, scheduleResume]);

  useLayoutEffect(() => {
    if (autoFollowRef.current) {
      scrollToBottom();
    }
  }, [scrollSignal, scrollToBottom]);

  useEffect(() => clearResumeTimer, [clearResumeTimer]);

  return {
    scrollRef,
    scrollHandlers: {
      onKeyDown: noteUserInteraction,
      onPointerDown: noteUserInteraction,
      onScroll: handleScroll,
      onTouchStart: noteUserInteraction,
      onWheel: noteUserInteraction,
    },
  };
};

// ---------------------------------------------------------------------------
// LineItem — Linear-style minimal row
// ---------------------------------------------------------------------------

const ToolLineItem: React.FC<{
  line: AgentActivityDisplayRow;
}> = ({ line }) => {
  const ToolIcon = line.toolKind ? toolIconByKind[line.toolKind] : Wrench;

  const row = (
    <div className="wf-log-task-row">
      <span className="wf-log-task-status">
        {line.resultDetail && <ChevronRight className="wf-log-task-chevron" />}
      </span>
      <span className="wf-log-task-tool-icon">
        <ToolIcon className="w-3 h-3" />
      </span>
      {line.title && <span className="wf-log-task-label">{line.title}</span>}
      {line.detail && (
        <span className="wf-log-task-target" title={line.detail}>
          {line.detail}
        </span>
      )}
    </div>
  );

  if (!line.resultDetail) return row;

  return (
    <details className="wf-log-task-disclosure">
      <summary>{row}</summary>
      <pre className="wf-log-task-result">{line.resultDetail}</pre>
    </details>
  );
};

const ContentLineItem: React.FC<{
  line: AgentActivityDisplayRow;
}> = ({ line }) => {
  return (
    <div className="wf-log-task-row wf-log-task-row--content">
      <span className="wf-log-task-status" />
      <span className="wf-log-task-content-text">
        {renderSimpleBoldMarkdown(line.content)}
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export const AgentActivityPanel: React.FC<AgentActivityPanelProps> = ({
  lines = [],
  state = "idle",
  labels,
  translate,
}) => {
  const displayRows = useMemo(
    () => formatAgentActivityLines(lines, translate),
    [lines, translate],
  );

  // Filter: hide tool calls that are still running
  const visibleRows = useMemo(
    () =>
      displayRows.filter(
        (line) => !(isToolCallLine(line) && isToolRunning(line)),
      ),
    [displayRows],
  );

  const lastDisplayRow = visibleRows[visibleRows.length - 1];
  const scrollSignal = `${visibleRows.length}:${lastDisplayRow?.row_id ?? ""}:${
    lastDisplayRow?.content.length ?? 0
  }`;
  const { scrollRef, scrollHandlers } = useAutoFollowScroll(scrollSignal);
  const showLoading = state === "loading";
  const showPruned = state === "pruned";
  const showError = state === "error";
  const showEmpty =
    !showLoading && !showPruned && !showError && visibleRows.length === 0;

  if (showEmpty) return null;

  return (
    <div className="wf-log-panel-inline">
      {showLoading ? (
        <div className="wf-log-panel wf-log-panel--empty" style={{ height: "auto", padding: "8px 0" }}>
          <span className="wf-log-spinner" />
          <span className="wf-log-panel-message">{labels.loading}</span>
        </div>
      ) : showPruned ? (
        <div className="wf-log-panel-message" style={{ padding: "4px 0" }}>
          {labels.cleaned}
        </div>
      ) : showError ? (
        <div className="wf-log-panel-message" style={{ padding: "4px 0", color: "#e5484d" }}>
          {labels.error}
        </div>
      ) : (
        <ScrollArea
          ref={scrollRef}
          className="agent-activity-scrollbar max-h-[480px] pr-1"
          scrollbar="styled"
          {...scrollHandlers}
        >
          <div className="wf-log-group-tasks">
            {visibleRows.map((line) =>
              isToolCallLine(line) ? (
                <ToolLineItem
                  key={line.row_id}
                  line={line}
                />
              ) : (
                <ContentLineItem
                  key={line.row_id}
                  line={line}
                />
              ),
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
