import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  useLayoutEffect,
} from "react";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useAppScale } from "@/context/AppScaleContext";
import {
  Plus,
  Check,
  GitBranch,
  PanelRightClose,
  PanelRightOpen,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Quote,
  Square,
  X,
  Image as ImageIcon,
  FileText,
  RefreshCw,
  Play,
  Trash2,
} from "lucide-react";
import { ResourceStateNotice } from "@/components/ResourceState";
import { ScrollArea } from "@/components/ScrollArea";
import { AgentMessageContent } from "@/components/AgentMessageContent";
import { SessionSourceControlPanel } from "@/components/source-control/SessionSourceControlPanel";
import {
  useCommandHandler,
  useShortcutScope,
} from "@/shortcuts/ShortcutProvider";
import {
  chatMessagesApi,
  chatRunsApi,
  sessionAgentsApi,
  projectWorkItemsApi,
} from "@/lib/api";
import {
  flattenRunFileChanges,
  type AgentFileRow,
} from "@/lib/agentFileRows";
import {
  ISSUE_NAVIGATION_EVENT,
  type IssueNavigationTarget,
} from "@/lib/issueNavigation";
import {
  LINKED_WORK_ITEMS_CHANGED_EVENT,
  type LinkedWorkItemsChangedDetail,
} from "@/lib/linkedWorkItemsEvents";
import {
  isLinkedWorkItemStatusMenuTarget,
  toggleLinkedWorkItemStatusMenuTarget,
  type LinkedWorkItemStatusMenuTarget,
} from "@/lib/linkedWorkItemStatusMenu";
import {
  SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
  type SourceControlRefreshRequestedDetail,
} from "@/lib/sourceControlEvents";
import { markPendingIssueStatusSync } from "@/lib/pendingIssueStatusSync";
import { notifyBuildStatsUsageUpdated } from "@/lib/buildStatsEvents";
import { requestTeamMemberInviteNavigation } from "@/lib/teamNavigation";
import { openInSystemFileManager } from "@/lib/systemFileManager";
import {
  flattenWorkspaceChanges,
  hasRelatedFileDiff,
  type RelatedFileChange,
  type RelatedFileStatus,
} from "@/lib/sessionWorkspaceChanges";
import { openFileInVSCode } from "@/vscode/bridge";
import { normalizeArtifactPath } from "@/lib/parseStructuredReply";
import { PriorityMenuIcon } from "@/pages/IssueDetailPage";
import {
  ChatComposer,
  type ChatComposerSubmit,
  type ChatComposerSubmitResult,
} from "@/components/chat/ChatComposer";
import {
  formatFileSize,
  isImageChatAttachment,
} from "@/components/chat/chatAttachmentUtils";
import type {
  Member,
  Message,
  ProjectWorkItem,
  QuotedMessageReference,
  QueuedMessageListItem,
  SourceControlDiffArea,
} from "@/types";


export const statusTextTone: Record<RelatedFileStatus, string> = {
  M: "text-amber-600",
  A: "text-emerald-600",
  D: "text-rose-500",
  U: "text-sky-500",
};

export const hasLineStat = (value?: number) => typeof value === "number" && value > 0;

export const isOpenteamsPath = (path: string): boolean => {
  const normalized = path.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  return normalized.toLowerCase().split("/")[0] === ".openteams";
};

export interface TruncatedFileNameProps {
  path: string;
}

export const TruncatedFileName: React.FC<TruncatedFileNameProps> = ({ path }) => {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;

    const updateTruncation = () => {
      const nextIsTruncated = element.scrollWidth > element.clientWidth;
      setIsTruncated((current) =>
        current === nextIsTruncated ? current : nextIsTruncated,
      );
    };

    updateTruncation();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateTruncation);
      return () => window.removeEventListener("resize", updateTruncation);
    }

    const observer = new ResizeObserver(updateTruncation);
    observer.observe(element);
    return () => observer.disconnect();
  }, [path]);

  return (
    <span
      ref={textRef}
      className="min-w-0 flex-1 truncate font-mono text-[13px] text-[var(--ink)]"
      title={isTruncated ? path : undefined}
    >
      {path}
    </span>
  );
};

export const RELATED_FILES_DEFAULT_WIDTH = 300;
export const RELATED_FILES_MIN_WIDTH = 200;
export const RELATED_FILES_MAX_WIDTH = 360;
export const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 8;
export const RELATED_FILES_MIN_CENTER_WIDTH = 540;
export const RELATED_FILES_SEPARATOR_WIDTH = 6;
export const SIDEBAR_MEMBER_AVATAR_WIDTH = 28;
export const SIDEBAR_MEMBER_GAP = 6;

export const getVisibleSidebarMemberCount = (
  memberCount: number,
  railWidth: number,
) => {
  if (memberCount === 0) return 0;

  const fullWidth =
    memberCount * SIDEBAR_MEMBER_AVATAR_WIDTH +
    Math.max(0, memberCount - 1) * SIDEBAR_MEMBER_GAP;

  if (railWidth <= 0) {
    return 0;
  }
  if (fullWidth <= railWidth) return memberCount;

  const visibleCount = Math.floor(
    (railWidth + SIDEBAR_MEMBER_GAP) /
      (SIDEBAR_MEMBER_AVATAR_WIDTH + SIDEBAR_MEMBER_GAP),
  );

  return Math.max(0, Math.min(memberCount - 1, visibleCount));
};

export const extractMentionHandles = (text: string): string[] =>
  (text.match(/@[\p{L}\p{N}_-]+/gu) ?? []).map((mention) =>
    mention.toLowerCase(),
  );

export const routeMentionsForText = (text: string): string[] =>
  Array.from(
    new Set(
      Array.from(text.matchAll(/@([\p{L}\p{N}_-]+)/gu), (match) =>
        match[1],
      ),
    ),
  );

export const normalizeMentionHandle = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("@")
    ? trimmed.toLowerCase()
    : `@${trimmed.toLowerCase()}`;
};

export const displayChatSenderName = (sender: string): string =>
  sender.trim().replace(/^@+/, "");

export function SessionMemberAvatar({ member }: { member: Member }) {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] font-semibold transition-colors ${
        member.status === "run"
          ? "animate-pulse border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)] ring-2 ring-[var(--success)]/20"
          : member.status === "on"
            ? "border-[var(--mono-border)] bg-[var(--mono-bg)] text-[var(--ink-muted)]"
            : "border-red-500/35 bg-red-500/10 text-red-400"
      }`}
      title={member.name}
      aria-label={`${member.name} ${member.roleDetail}`}
    >
      {member.avatar}
    </span>
  );
}

export type LinkedWorkItemIssueStatus =
  | "todo"
  | "in_progress"
  | "backlog"
  | "ready_to_merge"
  | "merging"
  | "done"
  | "cancelled"
  | "duplicate";

export const linkedWorkItemStatusKeys: Record<LinkedWorkItemIssueStatus, string> = {
  todo: "issue.status.todo",
  in_progress: "issue.status.in_progress",
  backlog: "issue.status.backlog",
  ready_to_merge: "issue.status.ready_to_merge",
  merging: "issue.status.merging",
  done: "issue.status.done",
  cancelled: "issue.status.cancelled",
  duplicate: "issue.status.duplicate",
};

export const linkedWorkItemStatusOptions: Array<{
  value: ProjectWorkItem["status"];
  labelKey: string;
  shortcut: string;
}> = [
  { value: "blocked", labelKey: linkedWorkItemStatusKeys.backlog, shortcut: "1" },
  { value: "open", labelKey: linkedWorkItemStatusKeys.todo, shortcut: "2" },
  {
    value: "in_progress",
    labelKey: linkedWorkItemStatusKeys.in_progress,
    shortcut: "3",
  },
  {
    value: "ready_to_merge",
    labelKey: linkedWorkItemStatusKeys.ready_to_merge,
    shortcut: "4",
  },
  { value: "merging", labelKey: linkedWorkItemStatusKeys.merging, shortcut: "5" },
  { value: "done", labelKey: linkedWorkItemStatusKeys.done, shortcut: "6" },
  {
    value: "cancelled",
    labelKey: linkedWorkItemStatusKeys.cancelled,
    shortcut: "7",
  },
  {
    value: "duplicate",
    labelKey: linkedWorkItemStatusKeys.duplicate,
    shortcut: "8",
  },
];

export const translateWithFallback = (
  t: (key: string, replacements?: Record<string, string | number>) => string,
  key: string,
  fallback: string,
  replacements?: Record<string, string | number>,
) => {
  const translated = t(key, replacements);
  const text = translated && translated !== key ? translated : fallback;
  if (!replacements) return text;
  return Object.entries(replacements).reduce(
    (current, [name, value]) =>
      current.replace(`{${name}}`, String(value)),
    text,
  );
};

export function LinkedWorkItemRow({
  item,
  statusPending,
  statusMenuOpen,
  onStatusMenuOpenChange,
  onOpen,
  onStatusChange,
  t,
}: {
  item: ProjectWorkItem;
  statusPending: boolean;
  statusMenuOpen: boolean;
  onStatusMenuOpenChange: (itemId: string, open: boolean) => void;
  onOpen: (item: ProjectWorkItem) => void;
  onStatusChange: (
    item: ProjectWorkItem,
    status: ProjectWorkItem["status"],
  ) => void;
  t: (key: string, replacements?: Record<string, string | number>) => string;
}) {
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const statusTriggerRef = useRef<HTMLButtonElement | null>(null);
  const issueStatus = linkedWorkItemIssueStatus(item.status);
  const statusLabel =
    translateWithFallback(
      t,
      linkedWorkItemStatusKeys[issueStatus],
      titleCaseStatus(item.status),
    );

  useEffect(() => {
    if (!statusMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!statusMenuRef.current?.contains(event.target as Node)) {
        onStatusMenuOpenChange(item.id, false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [item.id, onStatusMenuOpenChange, statusMenuOpen]);

  useEffect(() => {
    if (!statusMenuOpen || statusPending) return;
    const frame = window.requestAnimationFrame(() =>
      statusTriggerRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [statusMenuOpen, statusPending]);

  const handleStatusSelect = (status: ProjectWorkItem["status"]) => {
    onStatusMenuOpenChange(item.id, false);
    if (status !== item.status) onStatusChange(item, status);
  };

  return (
    <div className="relative flex w-full min-w-0 items-stretch text-[13px]">
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-l-md bg-[var(--surface-1)] px-2 py-1.5 text-left transition hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
        aria-label={translateWithFallback(
          t,
          "linkedWorkItems.openIssue",
          "Open issue {title}",
          { title: item.title },
        )}
      >
        <PriorityMenuIcon
          priority={item.priority}
          selected={item.priority === "urgent"}
        />
        <span className="min-w-0 flex-1 truncate text-[var(--ink)]">
          {item.title}
        </span>
      </button>
      <div
        ref={statusMenuRef}
        className="relative shrink-0"
        onKeyDown={(event) => {
          if (!statusMenuOpen) return;
          if (event.key === "Escape") {
            event.preventDefault();
            onStatusMenuOpenChange(item.id, false);
            return;
          }
          const option = linkedWorkItemStatusOptions.find(
            (candidate) => candidate.shortcut === event.key,
          );
          if (!option) return;
          event.preventDefault();
          handleStatusSelect(option.value);
        }}
      >
        <button
          ref={statusTriggerRef}
          type="button"
          disabled={statusPending}
          aria-haspopup="listbox"
          aria-expanded={statusMenuOpen}
          onClick={(event) => {
            event.stopPropagation();
            onStatusMenuOpenChange(item.id, !statusMenuOpen);
          }}
          className="inline-flex h-full max-w-[128px] items-center gap-1.5 rounded-r-md bg-[var(--surface-1)] px-2 py-1.5 text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 disabled:cursor-not-allowed disabled:opacity-70"
          aria-label={translateWithFallback(
            t,
            "linkedWorkItems.changeStatusFor",
            "Change status for {title}",
            { title: item.title },
          )}
        >
          {statusPending ? (
            <RefreshCw className="h-[13px] w-[13px] shrink-0 animate-spin" />
          ) : (
            <LinkedWorkItemStatusIcon status={issueStatus} />
          )}
          <span className="min-w-0 truncate">{statusLabel}</span>
        </button>
        {statusMenuOpen && (
          <div className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-[10px] border border-[var(--hairline-strong)] bg-[var(--surface-1)] p-1 shadow-[0_12px_30px_rgba(0,0,0,0.18)]">
            <div
              role="listbox"
              className="max-h-[240px] overflow-y-auto ot-scroll-area-styled"
            >
              {linkedWorkItemStatusOptions.map((option) => {
                const selected = option.value === item.status;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[12px] font-semibold text-[var(--ink-muted)] transition hover:bg-[var(--surface-3)]"
                    onClick={() => handleStatusSelect(option.value)}
                  >
                    <LinkedWorkItemStatusIcon
                      status={linkedWorkItemIssueStatus(option.value)}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {t(option.labelKey)}
                    </span>
                    <span className="ml-auto flex w-8 shrink-0 items-center justify-between text-[var(--ink-subtle)]">
                      {selected ? (
                        <Check className="h-3 w-3" strokeWidth={3} />
                      ) : (
                        <span aria-hidden="true" className="h-3 w-3" />
                      )}
                      <span className="font-mono text-[10px]">
                        {option.shortcut}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function linkedWorkItemIssueStatus(
  status: ProjectWorkItem["status"],
): LinkedWorkItemIssueStatus {
  if (status === "open") return "todo";
  if (status === "blocked") return "backlog";
  return status as LinkedWorkItemIssueStatus;
}

export function LinkedWorkItemStatusIcon({
  status,
}: {
  status: LinkedWorkItemIssueStatus;
}) {
  const dimension = 13;
  const borderWidth = 1.7;
  const iconSizeStyle = { height: dimension, width: dimension };

  if (status === "backlog") {
    return (
      <span
        aria-hidden="true"
        className="shrink-0 rounded-full"
        style={{
          ...iconSizeStyle,
          background:
            "repeating-conic-gradient(#a9aab0 0deg 13deg, transparent 13deg 30deg)",
          WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${
            borderWidth * 2
          }px), #000 calc(100% - ${borderWidth}px))`,
          mask: `radial-gradient(farthest-side, transparent calc(100% - ${
            borderWidth * 2
          }px), #000 calc(100% - ${borderWidth}px))`,
        }}
      />
    );
  }

  if (status === "todo") {
    return (
      <span
        aria-hidden="true"
        className="shrink-0 rounded-full border-[#d9d9de]"
        style={{ ...iconSizeStyle, borderWidth }}
      />
    );
  }

  if (status === "in_progress") {
    return (
      <span
        aria-hidden="true"
        className="relative shrink-0 rounded-full border-[#f0c400]"
        style={{ ...iconSizeStyle, borderWidth }}
      >
        <span
          className="absolute left-1/2 top-[2.5px] -translate-x-1/2 rounded-full bg-[#f0c400]"
          style={{ height: dimension * 0.32, width: borderWidth }}
        />
        <span
          className="absolute left-1/2 top-1/2 -translate-y-1/2 rounded-full bg-[#f0c400]"
          style={{ height: borderWidth, width: dimension * 0.32 }}
        />
      </span>
    );
  }

  if (status === "ready_to_merge") {
    return (
      <span
        aria-hidden="true"
        className="relative shrink-0 overflow-hidden rounded-full border-[#4fc38b]"
        style={{ ...iconSizeStyle, borderWidth }}
      >
        <span
          className="absolute rounded-r-full bg-[#4fc38b]"
          style={{
            bottom: borderWidth,
            right: borderWidth,
            top: borderWidth,
            width: dimension * 0.29,
          }}
        />
      </span>
    );
  }

  if (status === "merging") {
    return (
      <span
        aria-hidden="true"
        className="relative shrink-0 rounded-full border-[#4fc38b]"
        style={{ ...iconSizeStyle, borderWidth }}
      >
        <span
          className="absolute rounded-full border-l-[#4fc38b] border-t-[#4fc38b]"
          style={{
            borderLeftWidth: borderWidth * 1.6,
            borderTopWidth: borderWidth * 1.6,
            height: dimension * 0.48,
            left: dimension * 0.19,
            top: dimension * 0.16,
            width: dimension * 0.48,
          }}
        />
      </span>
    );
  }

  if (status === "done") {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full bg-[#6671e8] text-[#141519]"
        style={iconSizeStyle}
      >
        <Check
          aria-hidden="true"
          className="h-[9px] w-[9px]"
          strokeWidth={3.2}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="relative flex shrink-0 items-center justify-center rounded-full bg-[#acbac8]"
      style={iconSizeStyle}
    >
      <span
        className="absolute rotate-45 rounded-full bg-white"
        style={{ height: borderWidth, width: dimension * 0.46 }}
      />
      <span
        className="absolute -rotate-45 rounded-full bg-white"
        style={{ height: borderWidth, width: dimension * 0.46 }}
      />
    </span>
  );
}

export function titleCaseStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const queuedMessageStatusLabel = (status: string) => {
  switch (status) {
    case "processing":
      return "准备执行";
    case "running":
      return "正在执行";
    case "failed":
      return "已阻塞";
    default:
      return "排队中";
  }
};

type InlineQueueGroupProps = {
  group?: {
    queue: import('@/types').MemberQueueSnapshot;
    items: QueuedMessageListItem[];
  };
  queueActionIds: ReadonlySet<string>;
  summarize: (item: QueuedMessageListItem) => string;
  onDelete: (sessionId: string, queueId: string) => void;
  onContinue: (sessionId: string, sessionAgentId: string) => void;
  t: (key: string) => string;
};

export function InlineQueueGroup({
  group,
  queueActionIds,
  summarize,
  onDelete,
  onContinue,
  t,
}: InlineQueueGroupProps) {
  if (!group) return null;
  const { queue, items } = group;
  const continueActionId = `continue-${queue.session_agent_id}`;
  return (
    <div className="mt-2 max-w-md rounded-md border border-[var(--hairline)] bg-[var(--surface-1)]/70 p-1 shadow-none">
      <div className="flex max-h-24 flex-col gap-0.5 overflow-y-auto pr-0.5">
        {items.map((item) => {
          const status = String(item.message.status);
          const canDelete = item.can_delete && status === "queued";
          const summary = summarize(item);
          return (
            <div
              key={item.message.id}
              className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-[10px] text-[var(--ink-tertiary)] hover:bg-[var(--surface-2)]"
            >
              <span className="min-w-0 flex-1 truncate" title={summary}>
                {summary}
              </span>
              <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[8px] text-[var(--ink-tertiary)]">
                {queuedMessageStatusLabel(status)}
              </span>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(queue.session_id, item.message.id)}
                  disabled={queueActionIds.has(item.message.id)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-rose-500 disabled:cursor-wait disabled:opacity-60"
                  title={t("queue.deleteMessage")}
                  aria-label={t("queue.deleteMessage")}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {queue.can_continue && (
        <div className="mt-1 flex justify-end border-t border-[var(--hairline)] pt-1">
          <button
            type="button"
            onClick={() => onContinue(queue.session_id, queue.session_agent_id)}
            disabled={queueActionIds.has(continueActionId)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-2)] hover:text-[var(--primary)] disabled:cursor-wait disabled:opacity-60"
            title={t("queue.continueExecution")}
            aria-label={t("queue.continueExecution")}
          >
            <Play className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

type RelatedFilesContentProps = {
  changes: RelatedFileChange[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onFileClick: (file: RelatedFileChange) => void;
  t: (key: string, replacements?: Record<string, string | number>) => string;
};

export function RelatedFilesContent({
  changes,
  loading,
  error,
  onRefresh,
  onFileClick,
  t,
}: RelatedFilesContentProps) {
  return (
    <>
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <h2 className="text-[14px] font-semibold text-[var(--ink)]">
          {t("relatedFiles.title")}
        </h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
            title={t("relatedFiles.refresh")}
            aria-label={t("relatedFiles.refresh")}
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </button>
          <span className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 font-mono text-[13px] text-[var(--ink-tertiary)]">
            {changes.length}
          </span>
        </div>
      </div>
      <ScrollArea className="flex-1 px-2 pb-2">
        {loading && (
          <div className="rounded-md bg-[var(--surface-1)] px-3 py-3 text-[13px] text-[var(--ink-tertiary)]">
            {t("relatedFiles.loading")}
          </div>
        )}
        {error && (
          <div className="rounded-md bg-[var(--surface-1)] px-3 py-3 text-[13px] text-rose-500">
            {error}
          </div>
        )}
        {!loading && !error && changes.length === 0 && (
          <div className="rounded-md bg-[var(--surface-1)] px-3 py-3 text-[13px] text-[var(--ink-tertiary)]">
            {t("relatedFiles.noChangedFiles")}
          </div>
        )}
        {!loading && !error && changes.length > 0 && (
          <div className="space-y-1">
            {changes.map((file) => (
              <button
                type="button"
                key={`${file.status}-${file.path}`}
                onClick={() => onFileClick(file)}
                className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md bg-[var(--surface-1)] px-2 text-left text-[13px] transition-colors hover:bg-[var(--surface-3)]"
                aria-label={t("relatedFiles.openDiff", { path: file.path })}
              >
                <TruncatedFileName path={file.path} />
                {hasLineStat(file.additions) && (
                  <span className="shrink-0 font-mono text-[13px] text-emerald-500">
                    +{file.additions}
                  </span>
                )}
                {hasLineStat(file.deletions) && (
                  <span className="shrink-0 font-mono text-[13px] text-rose-500">
                    -{file.deletions}
                  </span>
                )}
                <span
                  className={`w-4 shrink-0 text-right font-mono text-[13px] font-semibold ${statusTextTone[file.status]}`}
                >
                  {file.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </>
  );
}
