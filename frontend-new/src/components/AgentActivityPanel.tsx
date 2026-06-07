import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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

const toolToneClass = (line: AgentActivityDisplayRow): string => {
  switch (line.toolStatus) {
    case "failed":
    case "denied":
    case "timed_out":
      return "text-rose-500/80";
    case "completed":
      return "text-[var(--ink)]";
    default:
      return "text-[var(--ink-subtle)]";
  }
};

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

const LineItem: React.FC<{ line: AgentActivityDisplayRow }> = ({ line }) => {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const updateOverflow = () => {
      setOverflows(
        el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight,
      );
    };
    updateOverflow();
    const frame = window.requestAnimationFrame(updateOverflow);
    return () => window.cancelAnimationFrame(frame);
  }, [line.content]);

  const isTool = line.line_type === "tool";
  const isError = line.line_type === "error";

  const textColor = isError ? "text-rose-500/80" : "text-[var(--ink)]";
  const ToolIcon = line.toolKind ? toolIconByKind[line.toolKind] : Wrench;
  const rowClass =
    "group flex w-full min-w-0 items-start gap-2 rounded-sm px-1 py-1 text-left text-[12px] leading-[1.5] transition hover:bg-[var(--surface-1)]/70";
  const collapsedClass = "line-clamp-1 break-all";
  const expandedClass = "whitespace-pre-wrap break-words";

  if (isTool) {
    return (
      <button
        type="button"
        className={rowClass}
        data-line-type={line.line_type}
        onClick={() => overflows && setExpanded((v) => !v)}
        aria-expanded={overflows ? expanded : undefined}
      >
        <ToolIcon className="mt-[3px] h-3 w-3 shrink-0 text-[var(--ink-tertiary)]" />
        <span
          ref={textRef}
          className={`min-w-0 flex-1 text-[12px] ${toolToneClass(line)} ${
            expanded ? expandedClass : collapsedClass
          }`}
        >
          <span className="font-medium">{line.title}</span>
          {line.detail && (
            <span className="ml-1 font-mono text-[var(--ink-tertiary)]">
              {line.detail}
            </span>
          )}
        </span>
        {overflows && (
          <ChevronRight
            className={`mt-[3px] h-3 w-3 shrink-0 text-[var(--ink-tertiary)] opacity-0 transition group-hover:opacity-100 ${
              expanded ? "rotate-90 opacity-100" : ""
            }`}
          />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={rowClass}
      data-line-type={line.line_type}
      onClick={() => overflows && setExpanded((v) => !v)}
      aria-expanded={overflows ? expanded : undefined}
    >
      <span
        ref={textRef}
        className={`min-w-0 flex-1 font-mono text-[12px] ${textColor} ${
          expanded ? expandedClass : collapsedClass
        }`}
      >
        {renderSimpleBoldMarkdown(line.content)}
      </span>
      {overflows && (
        <ChevronRight
          className={`mt-[3px] h-3 w-3 shrink-0 text-[var(--ink-tertiary)] opacity-0 transition group-hover:opacity-100 ${
            expanded ? "rotate-90 opacity-100" : ""
          }`}
        />
      )}
    </button>
  );
};

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
  const lastDisplayRow = displayRows[displayRows.length - 1];
  const scrollSignal = `${displayRows.length}:${lastDisplayRow?.row_id ?? ""}:${
    lastDisplayRow?.content.length ?? 0
  }`;
  const { scrollRef, scrollHandlers } = useAutoFollowScroll(scrollSignal);
  const showLoading = state === "loading";
  const showPruned = state === "pruned";
  const showError = state === "error";
  const showEmpty =
    !showLoading && !showPruned && !showError && displayRows.length === 0;

  if (showEmpty) return null;

  return (
    <div className="mt-1 max-h-[480px] overflow-hidden text-[12px] leading-[1.5]">
      {showLoading ? (
        <div className="flex items-center gap-2 py-1 text-[12px] text-[var(--ink-tertiary)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="font-mono">{labels.loading}</span>
        </div>
      ) : showPruned ? (
        <div className="py-1 font-mono text-[12px] text-[var(--ink-tertiary)]">
          {labels.cleaned}
        </div>
      ) : showError ? (
        <div className="py-1 font-mono text-[12px] text-rose-500/80">
          {labels.error}
        </div>
      ) : (
        <ScrollArea
          ref={scrollRef}
          className="agent-activity-scrollbar max-h-[480px] pr-1"
          scrollbar="styled"
          {...scrollHandlers}
        >
          <div className="space-y-0.5 py-0.5">
            {displayRows.map((line) => (
              <LineItem key={line.row_id} line={line} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
