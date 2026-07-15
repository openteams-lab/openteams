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
  ArrowUp,
  Mic,
  AtSign,
  Check,
  ChevronDown,
  GitBranch,
  Lock,
  PanelRightClose,
  PanelRightOpen,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Quote,
  Square,
  X,
  Paperclip,
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
  CHAT_INPUT_PREFILL_EVENT,
  clearChatInputPrefill,
  readChatInputPrefill,
  type ChatInputPrefillDetail,
} from "@/lib/chatInputPrefill";
import {
  ISSUE_NAVIGATION_EVENT,
  type IssueNavigationTarget,
} from "@/lib/issueNavigation";
import {
  LINKED_WORK_ITEMS_CHANGED_EVENT,
  type LinkedWorkItemsChangedDetail,
} from "@/lib/linkedWorkItemsEvents";
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
import type {
  ChatAttachment,
  Member,
  Message,
  ProjectWorkItem,
  QuotedMessageReference,
  QueuedMessageListItem,
  SourceControlDiffArea,
} from "@/types";

interface FreeChatWorkspaceProps {
  embedded?: boolean;
  onOpenDiffTab?: (
    sessionId: string,
    filePath: string,
    status: string,
    unifiedDiff: string,
    runId?: string,
  ) => void;
  onOpenSourceControlDiffTab?: (
    projectId: string,
    sessionId: string,
    filePath: string,
    area: SourceControlDiffArea,
  ) => void;
  onOpenWorktreeConflictTab?: (projectId: string, sessionId: string) => void;
}

type AttachmentImagePreview = {
  url: string;
  name: string;
  sizeBytes?: number;
};

const statusTextTone: Record<RelatedFileStatus, string> = {
  M: "text-amber-600",
  A: "text-emerald-600",
  D: "text-rose-500",
  U: "text-sky-500",
};

const hasLineStat = (value?: number) => typeof value === "number" && value > 0;

const isOpenteamsPath = (path: string): boolean => {
  const normalized = path.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  return normalized.toLowerCase().split("/")[0] === ".openteams";
};

const allowedTextAttachmentExtensions = [
  ".txt",
  ".csv",
  ".md",
  ".json",
  ".xml",
  ".yaml",
  ".yml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".py",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".rb",
  ".php",
  ".go",
  ".rs",
  ".sql",
  ".sh",
  ".bash",
  ".svg",
];

const allowedImageAttachmentExtensions = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
];

const allowedAttachmentExtensions = [
  ...allowedTextAttachmentExtensions,
  ...allowedImageAttachmentExtensions,
];

const CHAT_ATTACHMENT_ACCEPT = [
  "text/*",
  "image/*",
  ...allowedAttachmentExtensions,
].join(",");

const isImageAttachment = (file: File) =>
  file.type.startsWith("image/") ||
  allowedImageAttachmentExtensions.some((ext) =>
    file.name.toLowerCase().endsWith(ext),
  );

const isTextAttachment = (file: File) =>
  file.type.startsWith("text/") ||
  allowedTextAttachmentExtensions.some((ext) =>
    file.name.toLowerCase().endsWith(ext),
  );

const isAllowedAttachment = (file: File) =>
  isImageAttachment(file) || isTextAttachment(file);

const isImageChatAttachment = (attachment: ChatAttachment) =>
  attachment.kind === "image" ||
  attachment.mime_type?.startsWith("image/") ||
  allowedImageAttachmentExtensions.some((ext) =>
    attachment.name.toLowerCase().endsWith(ext),
  );

const fallbackClipboardFileName = (file: File, index: number) => {
  if (file.name.trim()) return file.name;

  const extension = file.type.startsWith("image/")
    ? (file.type.split("/")[1] ?? "png")
    : file.type === "text/plain"
      ? "txt"
      : "dat";

  return `pasted-attachment-${Date.now()}-${index + 1}.${extension}`;
};

const normalizeClipboardFile = (file: File, index: number) =>
  file.name.trim()
    ? file
    : new File([file], fallbackClipboardFileName(file, index), {
        type: file.type,
        lastModified: file.lastModified || Date.now(),
      });

const getClipboardFiles = (clipboardData: DataTransfer) => {
  const itemFiles = Array.from(clipboardData.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  const files =
    itemFiles.length > 0 ? itemFiles : Array.from(clipboardData.files);

  return files.map(normalizeClipboardFile);
};

const attachmentIdentity = (file: File) =>
  `${file.name}:${file.size}:${file.lastModified}`;

const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

interface TruncatedFileNameProps {
  path: string;
}

const TruncatedFileName: React.FC<TruncatedFileNameProps> = ({ path }) => {
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

const RELATED_FILES_DEFAULT_WIDTH = 300;
const RELATED_FILES_MIN_WIDTH = 200;
const RELATED_FILES_MAX_WIDTH = 360;
const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 8;
const RELATED_FILES_MIN_CENTER_WIDTH = 540;
const RELATED_FILES_SEPARATOR_WIDTH = 6;
const SIDEBAR_MEMBER_AVATAR_WIDTH = 28;
const SIDEBAR_MEMBER_GAP = 6;

const CHAT_INPUT_SHELL_MIN_HEIGHT = 95;
const CHAT_INPUT_MIN_HEIGHT = 30;
const CHAT_INPUT_SHELL_MAX_HEIGHT = Math.round(
  CHAT_INPUT_SHELL_MIN_HEIGHT * 2.5,
);
const CHAT_INPUT_STATIC_CHROME_HEIGHT =
  CHAT_INPUT_SHELL_MIN_HEIGHT - CHAT_INPUT_MIN_HEIGHT;
const CHAT_INPUT_MAX_HEIGHT =
  CHAT_INPUT_SHELL_MAX_HEIGHT - CHAT_INPUT_STATIC_CHROME_HEIGHT;

const resizeChatTextarea = (textarea: HTMLTextAreaElement | null) => {
  if (!textarea) return;
  textarea.style.height = `${CHAT_INPUT_MIN_HEIGHT}px`;
  const target = Math.min(
    Math.max(textarea.scrollHeight, CHAT_INPUT_MIN_HEIGHT),
    CHAT_INPUT_MAX_HEIGHT,
  );
  textarea.style.height = `${target}px`;
};

// Module-level cache that preserves unsent composer text per session,
// surviving FreeChatWorkspace unmount/remount when switching tabs.
const sessionDraftCache = new Map<string, string>();

const getVisibleSidebarMemberCount = (
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

const extractMentionHandles = (text: string): string[] =>
  (text.match(/@[a-zA-Z0-9_-]+/g) ?? []).map((mention) =>
    mention.toLowerCase(),
  );

const routeMentionsForText = (text: string): string[] =>
  Array.from(
    new Set(
      Array.from(text.matchAll(/@([a-zA-Z0-9_-]+)/g), (match) =>
        match[1],
      ),
    ),
  );

const normalizeMentionHandle = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("@")
    ? trimmed.toLowerCase()
    : `@${trimmed.toLowerCase()}`;
};

const displayChatSenderName = (sender: string): string =>
  sender.trim().replace(/^@+/, "");

function SessionMemberAvatar({ member }: { member: Member }) {
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

type LinkedWorkItemIssueStatus =
  | "todo"
  | "in_progress"
  | "backlog"
  | "ready_to_merge"
  | "merging"
  | "done"
  | "cancelled"
  | "duplicate";

const linkedWorkItemStatusKeys: Record<LinkedWorkItemIssueStatus, string> = {
  todo: "issue.status.todo",
  in_progress: "issue.status.in_progress",
  backlog: "issue.status.backlog",
  ready_to_merge: "issue.status.ready_to_merge",
  merging: "issue.status.merging",
  done: "issue.status.done",
  cancelled: "issue.status.cancelled",
  duplicate: "issue.status.duplicate",
};

const linkedWorkItemStatusOptions: Array<{
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

const translateWithFallback = (
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

function LinkedWorkItemRow({
  item,
  statusPending,
  onOpen,
  onStatusChange,
  t,
}: {
  item: ProjectWorkItem;
  statusPending: boolean;
  onOpen: (item: ProjectWorkItem) => void;
  onStatusChange: (
    item: ProjectWorkItem,
    status: ProjectWorkItem["status"],
  ) => void;
  t: (key: string, replacements?: Record<string, string | number>) => string;
}) {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
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
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [statusMenuOpen]);

  const handleStatusSelect = (status: ProjectWorkItem["status"]) => {
    setStatusMenuOpen(false);
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
      <div ref={statusMenuRef} className="relative shrink-0">
        <button
          type="button"
          disabled={statusPending}
          aria-haspopup="listbox"
          aria-expanded={statusMenuOpen}
          onClick={(event) => {
            event.stopPropagation();
            setStatusMenuOpen((current) => !current);
          }}
          className="inline-flex h-full max-w-[128px] items-center gap-1.5 rounded-r-md bg-[var(--surface-1)] px-2 py-1.5 text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 disabled:cursor-not-allowed disabled:opacity-70"
          title={translateWithFallback(
            t,
            "linkedWorkItems.changeStatusTitle",
            "Change status: {status}",
            { status: statusLabel },
          )}
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

function linkedWorkItemIssueStatus(
  status: ProjectWorkItem["status"],
): LinkedWorkItemIssueStatus {
  if (status === "open") return "todo";
  if (status === "blocked") return "backlog";
  return status as LinkedWorkItemIssueStatus;
}

function LinkedWorkItemStatusIcon({
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

function titleCaseStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const queuedMessageStatusLabel = (status: string) => {
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

export const FreeChatWorkspace: React.FC<FreeChatWorkspaceProps> = ({
  embedded = false,
  onOpenDiffTab,
  onOpenSourceControlDiffTab,
  onOpenWorktreeConflictTab,
}) => {
  const appScale = useAppScale();
  const {
    t,
    activeSessionId,
    messages,
    memberQueuesBySessionAgentId,
    queuedUserMessagesById,
    sendMessage,
    members,
    locale,
    chatInputMode,
    setChatInputMode,
    ensureWorkflowRouteToMainAgent,
    mainAgentName,
    showToast,
    sessionsAsync,
    refreshSessions,
    messagesAsync,
    refreshMessages,
    markSessionAgentStopped,
    membersAsync,
    refreshMembers,
    chatMessageFontSize,
    workspaceChangesAsync,
    refreshWorkspaceChanges,
    resetWorkspaceChanges,
    deleteQueuedMessage,
    continueMemberQueue,
    projects,
    selectedProjectId,
  } = useWorkspace();

  const [inputText, setInputText] = useState("");
  const setInputTextDraft = useCallback(
    (nextText: string) => {
      setInputText(nextText);
      if (!activeSessionId) return;
      if (nextText.length > 0) {
        sessionDraftCache.set(activeSessionId, nextText);
      } else {
        sessionDraftCache.delete(activeSessionId);
      }
    },
    [activeSessionId],
  );
  const [isMemberPickerOpen, setIsMemberPickerOpen] = useState(false);
  const [activeMemberPickerIndex, setActiveMemberPickerIndex] = useState(0);
  const memberPickerRef = useRef<HTMLDivElement | null>(null);
  const [isRelatedFilesOpen, setIsRelatedFilesOpen] = useState(true);
  const [wasRelatedFilesAutoCollapsed, setWasRelatedFilesAutoCollapsed] =
    useState(false);
  const [isMemberRailExpanded, setIsMemberRailExpanded] = useState(false);
  const [selectedSidebarMemberId, setSelectedSidebarMemberId] = useState<
    string | null
  >(null);
  const [memberRailWidth, setMemberRailWidth] = useState(0);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [stoppingSessionAgentIds, setStoppingSessionAgentIds] = useState<
    Record<string, string | null>
  >({});
  const [quotedMessage, setQuotedMessage] =
    useState<QuotedMessageReference | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [attachmentImagePreview, setAttachmentImagePreview] =
    useState<AttachmentImagePreview | null>(null);
  const [relatedFilesWidth, setRelatedFilesWidth] = useState(
    RELATED_FILES_DEFAULT_WIDTH,
  );
  const [linkedWorkItems, setLinkedWorkItems] = useState<ProjectWorkItem[]>([]);
  const [linkedWorkItemsLoading, setLinkedWorkItemsLoading] = useState(false);
  const [linkedWorkItemsError, setLinkedWorkItemsError] = useState<
    string | null
  >(null);
  const [updatingLinkedWorkItemIds, setUpdatingLinkedWorkItemIds] = useState<
    Set<string>
  >(() => new Set());
  const [queueActionIds, setQueueActionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const workspaceGridRef = useRef<HTMLDivElement>(null);
  const chatMessagesScrollRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const memberRailRef = useRef<HTMLDivElement>(null);
  const copiedResetTimerRef = useRef<number | null>(null);
  const linkedWorkItemsRequestIdRef = useRef(0);
  const chatAutoFollowRef = useRef(true);
  const previousActiveSessionIdRef = useRef<string | null>(null);
  const relatedFileChanges = useMemo(
    () => flattenWorkspaceChanges(workspaceChangesAsync.data),
    [workspaceChangesAsync.data],
  );
  const currentProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );
  const currentWorkspacePath =
    currentProject?.default_workspace_path ?? undefined;
  const usesProjectSourceControl = Boolean(selectedProjectId && activeSessionId);
  const sidebarMembers = members;
  const visibleSidebarMemberCount = getVisibleSidebarMemberCount(
    sidebarMembers.length,
    memberRailWidth,
  );
  const hasSidebarMemberOverflow =
    visibleSidebarMemberCount < sidebarMembers.length;
  const selectedSidebarMember = selectedSidebarMemberId
    ? sidebarMembers.find((member) => member.id === selectedSidebarMemberId)
    : undefined;
  const displayedSidebarMembers = isMemberRailExpanded
    ? sidebarMembers
    : sidebarMembers.slice(0, visibleSidebarMemberCount);
  const memberMentionHandles = new Set(
    sidebarMembers.map((member) => normalizeMentionHandle(member.name)),
  );
  const mainAgentHandle =
    mainAgentName ?? sidebarMembers[0]?.name ?? "@agent";
  const normalizedMainAgentHandle = normalizeMentionHandle(mainAgentHandle);
  const displayedMessages = selectedSidebarMember
    ? messages.filter((message) => {
        if (!message.isUser) {
          return message.sessionAgentId
            ? message.sessionAgentId === selectedSidebarMember.id
            : message.sender === selectedSidebarMember.name;
        }

        const matchedMemberMentions = extractMentionHandles(
          message.text,
        )
          .concat((message.mentions ?? []).map(normalizeMentionHandle))
          .filter((mention) => memberMentionHandles.has(mention));
        if (matchedMemberMentions.length === 0) {
          return (
            normalizeMentionHandle(selectedSidebarMember.name) ===
            normalizedMainAgentHandle
          );
        }

        return matchedMemberMentions.includes(
          normalizeMentionHandle(selectedSidebarMember.name),
        );
      })
    : messages;
  const workflowCardMessageIds = useMemo(
    () =>
      messages
        .filter((message) => message.workflowCard)
        .map((message) => message.id),
    [messages],
  );
  const [unfinishedWorkflowCardMessageId, setUnfinishedWorkflowCardMessageId] =
    useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const findLatestUnfinishedWorkflowCard = async () => {
      const projections = await Promise.all(
        workflowCardMessageIds.map(async (messageId) => {
          try {
            const projection = await chatMessagesApi.getWorkflowCard(
              messageId,
              "summary",
            );
            return projection.is_terminal ? null : messageId;
          } catch {
            return null;
          }
        }),
      );
      if (!cancelled) {
        setUnfinishedWorkflowCardMessageId(
          projections.slice().reverse().find((messageId) => messageId !== null) ??
            null,
        );
      }
    };

    void findLatestUnfinishedWorkflowCard();
    if (workflowCardMessageIds.length === 0) return () => {
      cancelled = true;
    };

    const intervalId = window.setInterval(
      findLatestUnfinishedWorkflowCard,
      5_000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeSessionId, workflowCardMessageIds]);

  const jumpToUnfinishedWorkflowCard = useCallback(() => {
    if (!unfinishedWorkflowCardMessageId) return;
    chatAutoFollowRef.current = false;
    const scrollToCard = () =>
      document
        .getElementById(`chat-message-${unfinishedWorkflowCardMessageId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });

    if (selectedSidebarMemberId) {
      setSelectedSidebarMemberId(null);
      window.requestAnimationFrame(scrollToCard);
      return;
    }
    scrollToCard();
  }, [selectedSidebarMemberId, unfinishedWorkflowCardMessageId]);

  const messagesById = useMemo(
    () =>
      new Map([
        ...messages.map((message) => [message.id, message] as const),
        ...Object.entries(queuedUserMessagesById),
      ]),
    [queuedUserMessagesById, messages],
  );
  const visibleQueueGroups = useMemo(
    () =>
      Object.values(memberQueuesBySessionAgentId)
        .filter((queue) => queue.session_id === activeSessionId)
        .map((queue) => {
          const queuedQueueItems = queue.items.filter(
            (item) =>
              item.message.session_id === activeSessionId &&
              String(item.message.status) === "queued",
          );
          return {
            queue,
            items: queuedQueueItems,
          };
        })
        .filter((group) => group.items.length > 0),
    [activeSessionId, memberQueuesBySessionAgentId],
  );
  const queueGroupsBySessionAgentId = useMemo(
    () =>
      new Map(
        visibleQueueGroups.map((group) => [
          group.queue.session_agent_id,
          group,
        ]),
      ),
    [visibleQueueGroups],
  );
  const queueAnchorMessageIds = useMemo(() => {
    const anchors = new Map<string, string>();
    const runningAnchors = new Set<string>();
    for (const message of displayedMessages) {
      const sessionAgentId = message.sessionAgentId;
      if (
        message.isUser ||
        !sessionAgentId ||
        !queueGroupsBySessionAgentId.has(sessionAgentId)
      ) {
        continue;
      }
      if (message.isAgentRunning) {
        anchors.set(sessionAgentId, message.id);
        runningAnchors.add(sessionAgentId);
        continue;
      }
      if (!runningAnchors.has(sessionAgentId)) {
        anchors.set(sessionAgentId, message.id);
      }
    }
    return anchors;
  }, [displayedMessages, queueGroupsBySessionAgentId]);
  const canFitRelatedFiles =
    workspaceWidth === 0 ||
    workspaceWidth >=
      RELATED_FILES_MIN_CENTER_WIDTH +
        RELATED_FILES_SEPARATOR_WIDTH +
        RELATED_FILES_MIN_WIDTH;
  const relatedFilesMaxAvailableWidth =
    workspaceWidth > 0
      ? Math.min(
          RELATED_FILES_MAX_WIDTH,
          Math.max(
            RELATED_FILES_MIN_WIDTH,
            workspaceWidth -
              RELATED_FILES_SEPARATOR_WIDTH -
              RELATED_FILES_MIN_CENTER_WIDTH,
          ),
        )
      : RELATED_FILES_DEFAULT_WIDTH;
  const effectiveRelatedFilesWidth = Math.min(
    relatedFilesWidth,
    relatedFilesMaxAvailableWidth,
  );
  const isStopPendingForMessage = (
    sessionAgentId?: string,
    runId?: string,
  ): boolean => {
    if (!sessionAgentId) return false;
    if (
      !Object.prototype.hasOwnProperty.call(
        stoppingSessionAgentIds,
        sessionAgentId,
      )
    ) {
      return false;
    }
    const stoppedRunId = stoppingSessionAgentIds[sessionAgentId];
    return !stoppedRunId || !runId || stoppedRunId === runId;
  };

  useEffect(() => {
    setStoppingSessionAgentIds((current) => {
      const entries = Object.entries(current).filter(
        ([sessionAgentId, stoppedRunId]) =>
          messages.some(
            (message) =>
              message.isAgentRunning &&
              message.sessionAgentId === sessionAgentId &&
              (!stoppedRunId ||
                !message.runId ||
                message.runId === stoppedRunId),
          ),
      );

      if (entries.length === Object.keys(current).length) return current;
      return Object.fromEntries(entries);
    });
  }, [messages]);

  useEffect(() => {
    setAttachmentImagePreview(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (!attachmentImagePreview) return;

    const handlePreviewKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAttachmentImagePreview(null);
      }
    };

    document.addEventListener("keydown", handlePreviewKeyDown);
    return () => document.removeEventListener("keydown", handlePreviewKeyDown);
  }, [attachmentImagePreview]);

  const openRelatedFiles = () => {
    setWasRelatedFilesAutoCollapsed(false);
    setIsRelatedFilesOpen(true);
  };

  const closeRelatedFiles = () => {
    setWasRelatedFilesAutoCollapsed(false);
    setIsRelatedFilesOpen(false);
  };

  useEffect(() => {
    const handleSourceControlRefreshRequested = (event: Event) => {
      const detail = (
        event as CustomEvent<SourceControlRefreshRequestedDetail>
      ).detail;
      if (!detail?.sessionId || detail.sessionId !== activeSessionId) return;
      if (
        detail.projectId &&
        selectedProjectId &&
        detail.projectId !== selectedProjectId
      ) {
        return;
      }
      setWasRelatedFilesAutoCollapsed(false);
      setIsRelatedFilesOpen(true);
    };

    window.addEventListener(
      SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
      handleSourceControlRefreshRequested,
    );
    return () =>
      window.removeEventListener(
        SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
        handleSourceControlRefreshRequested,
      );
  }, [activeSessionId, selectedProjectId]);

  useLayoutEffect(() => {
    const element = workspaceGridRef.current;
    if (!element) return;

    const updateWorkspaceWidth = () => setWorkspaceWidth(element.clientWidth);
    updateWorkspaceWidth();
    const frameId =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(updateWorkspaceWidth)
        : undefined;

    const cancelMeasureFrame = () => {
      if (
        frameId !== undefined &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(frameId);
      }
    };

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWorkspaceWidth);
      return () => {
        cancelMeasureFrame();
        window.removeEventListener("resize", updateWorkspaceWidth);
      };
    }

    const observer = new ResizeObserver(updateWorkspaceWidth);
    observer.observe(element);
    return () => {
      cancelMeasureFrame();
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (workspaceWidth === 0) return;

    if (!canFitRelatedFiles) {
      if (isRelatedFilesOpen) {
        setIsRelatedFilesOpen(false);
      }
      setWasRelatedFilesAutoCollapsed(true);
      return;
    }

    if (wasRelatedFilesAutoCollapsed) {
      if (!isRelatedFilesOpen) {
        setIsRelatedFilesOpen(true);
      }
      setWasRelatedFilesAutoCollapsed(false);
    }
  }, [
    canFitRelatedFiles,
    isRelatedFilesOpen,
    wasRelatedFilesAutoCollapsed,
    workspaceWidth,
  ]);

  useLayoutEffect(() => {
    if (!isRelatedFilesOpen) return;

    const element = memberRailRef.current;
    if (!element) return;

    const updateWidth = () => setMemberRailWidth(element.clientWidth);
    updateWidth();
    const frameId =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(updateWidth)
        : undefined;

    const cancelMeasureFrame = () => {
      if (
        frameId !== undefined &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(frameId);
      }
    };

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => {
        cancelMeasureFrame();
        window.removeEventListener("resize", updateWidth);
      };
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => {
      cancelMeasureFrame();
      observer.disconnect();
    };
  }, [isRelatedFilesOpen]);

  useEffect(() => {
    if (!hasSidebarMemberOverflow && isMemberRailExpanded) {
      setIsMemberRailExpanded(false);
    }
  }, [hasSidebarMemberOverflow, isMemberRailExpanded]);

  useEffect(() => {
    if (
      selectedSidebarMemberId &&
      !sidebarMembers.some((member) => member.id === selectedSidebarMemberId)
    ) {
      setSelectedSidebarMemberId(null);
    }
  }, [selectedSidebarMemberId, sidebarMembers]);

  useEffect(() => {
    if (chatInputMode === "workflow") {
      setIsMemberPickerOpen(false);
    }
  }, [chatInputMode]);

  useEffect(() => {
    if (!isMemberPickerOpen) return;

    const handlePointerDownOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !memberPickerRef.current?.contains(target)
      ) {
        setIsMemberPickerOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDownOutside);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDownOutside);
    };
  }, [isMemberPickerOpen]);

  useEffect(() => {
    if (activeMemberPickerIndex >= members.length) {
      setActiveMemberPickerIndex(Math.max(0, members.length - 1));
    }
  }, [activeMemberPickerIndex, members.length]);

  const isChatScrolledToBottom = useCallback(() => {
    const element = chatMessagesScrollRef.current;
    if (!element) return true;

    return (
      element.scrollHeight - element.scrollTop - element.clientHeight <=
      CHAT_SCROLL_BOTTOM_THRESHOLD_PX
    );
  }, []);

  const scrollChatToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, []);

  const handleChatScroll = useCallback(() => {
    chatAutoFollowRef.current = isChatScrolledToBottom();
  }, [isChatScrolledToBottom]);

  const handleChatWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (event.deltaY < 0) {
        chatAutoFollowRef.current = false;
        return;
      }

      if (isChatScrolledToBottom()) {
        chatAutoFollowRef.current = true;
      }
    },
    [isChatScrolledToBottom],
  );

  // Keep the latest message anchored before paint when the user is already at
  // the bottom. If they scroll up during agent output, preserve that position.
  useLayoutEffect(() => {
    const sessionChanged =
      previousActiveSessionIdRef.current !== activeSessionId;
    previousActiveSessionIdRef.current = activeSessionId;

    if (sessionChanged) {
      chatAutoFollowRef.current = true;
      scrollChatToBottom();
      return;
    }

    if (chatAutoFollowRef.current) {
      scrollChatToBottom();
    }
  }, [activeSessionId, messages, scrollChatToBottom]);

  useEffect(
    () => () => {
      if (copiedResetTimerRef.current !== null) {
        window.clearTimeout(copiedResetTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setCopiedMessageId(null);
    setQuotedMessage(null);
    setAttachedFiles([]);
    setSelectedSidebarMemberId(null);
    setStoppingSessionAgentIds({});
  }, [activeSessionId]);

  // Preserve unsent composer text per session across tab switches and
  // component unmount/remount. The change handlers keep the cache hot, so this
  // effect only restores the cached draft for the newly active session.
  useEffect(() => {
    const cachedDraft = activeSessionId
      ? sessionDraftCache.get(activeSessionId)
      : undefined;
    setInputText(cachedDraft ?? "");
    setIsMemberPickerOpen(false);
    setActiveMemberPickerIndex(0);
  }, [activeSessionId]);

  const reloadRelatedFiles = useCallback(() => {
    if (!activeSessionId) {
      resetWorkspaceChanges();
      return;
    }
    if (selectedProjectId) {
      resetWorkspaceChanges();
      return;
    }
    const workspacePath = currentWorkspacePath;
    if (!workspacePath) {
      resetWorkspaceChanges();
      return;
    }
    void refreshWorkspaceChanges(activeSessionId, workspacePath, true);
  }, [
    activeSessionId,
    currentWorkspacePath,
    refreshWorkspaceChanges,
    resetWorkspaceChanges,
    selectedProjectId,
  ]);

  useEffect(() => {
    reloadRelatedFiles();
  }, [reloadRelatedFiles]);

  useEffect(() => {
    const handleSourceControlRefresh = (event: Event) => {
      const detail = (
        event as CustomEvent<SourceControlRefreshRequestedDetail>
      ).detail;
      if (!detail || detail.sessionId !== activeSessionId) return;
      if (detail.projectId && detail.projectId !== selectedProjectId) return;
      if (usesProjectSourceControl) return;
      reloadRelatedFiles();
    };

    window.addEventListener(
      SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
      handleSourceControlRefresh,
    );
    return () => {
      window.removeEventListener(
        SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
        handleSourceControlRefresh,
      );
    };
  }, [
    activeSessionId,
    reloadRelatedFiles,
    selectedProjectId,
    usesProjectSourceControl,
  ]);

  const reloadLinkedWorkItems = useCallback(() => {
    if (!activeSessionId || !selectedProjectId) {
      linkedWorkItemsRequestIdRef.current += 1;
      setLinkedWorkItems([]);
      setLinkedWorkItemsError(null);
      setLinkedWorkItemsLoading(false);
      return;
    }

    const requestId = linkedWorkItemsRequestIdRef.current + 1;
    linkedWorkItemsRequestIdRef.current = requestId;
    setLinkedWorkItemsLoading(true);
    setLinkedWorkItemsError(null);
    projectWorkItemsApi
      .listBySession(selectedProjectId, activeSessionId)
      .then((items) => {
        if (linkedWorkItemsRequestIdRef.current !== requestId) return;
        setLinkedWorkItems(items);
        setLinkedWorkItemsLoading(false);
      })
      .catch((err) => {
        if (linkedWorkItemsRequestIdRef.current !== requestId) return;
        setLinkedWorkItemsError(
          err instanceof Error ? err.message : String(err),
        );
        setLinkedWorkItemsLoading(false);
      });
  }, [activeSessionId, selectedProjectId]);

  useEffect(() => {
    reloadLinkedWorkItems();
  }, [reloadLinkedWorkItems]);

  const applyChatInputPrefill = useCallback(
    (detail: ChatInputPrefillDetail) => {
      if (!detail || detail.sessionId !== activeSessionId) return false;

      if (detail.text.length > 0) {
        sessionDraftCache.set(detail.sessionId, detail.text);
      } else {
        sessionDraftCache.delete(detail.sessionId);
      }
      setInputText(detail.text);
      setQuotedMessage(null);
      setAttachedFiles([]);
      setIsMemberPickerOpen(false);
      setActiveMemberPickerIndex(0);

      const focusComposer = () => {
        if (detail.mode) {
          setChatInputMode(detail.mode);
        }
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(
          detail.text.length,
          detail.text.length,
        );
        resizeChatTextarea(inputRef.current);
        clearChatInputPrefill(detail.sessionId);
      };

      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(focusComposer);
      } else {
        focusComposer();
      }

      return true;
    },
    [activeSessionId, setChatInputMode],
  );

  useEffect(() => {
    const pending = readChatInputPrefill(activeSessionId);
    if (pending) {
      applyChatInputPrefill(pending);
    }
  }, [activeSessionId, applyChatInputPrefill]);

  useEffect(() => {
    const handleChatInputPrefill = (event: Event) => {
      applyChatInputPrefill(
        (event as CustomEvent<ChatInputPrefillDetail>).detail,
      );
    };

    window.addEventListener(CHAT_INPUT_PREFILL_EVENT, handleChatInputPrefill);
    return () => {
      window.removeEventListener(
        CHAT_INPUT_PREFILL_EVENT,
        handleChatInputPrefill,
      );
    };
  }, [applyChatInputPrefill]);

  useEffect(() => {
    resizeChatTextarea(inputRef.current);
  }, [inputText]);

  useEffect(() => {
    if (!activeSessionId || !selectedProjectId) return;

    const handleLinkedWorkItemsChanged = (event: Event) => {
      const detail = (event as CustomEvent<LinkedWorkItemsChangedDetail>)
        .detail;
      if (
        !detail ||
        detail.projectId !== selectedProjectId ||
        detail.sessionId !== activeSessionId
      ) {
        return;
      }

      reloadLinkedWorkItems();
    };

    window.addEventListener(
      LINKED_WORK_ITEMS_CHANGED_EVENT,
      handleLinkedWorkItemsChanged,
    );
    return () => {
      window.removeEventListener(
        LINKED_WORK_ITEMS_CHANGED_EVENT,
        handleLinkedWorkItemsChanged,
      );
    };
  }, [activeSessionId, reloadLinkedWorkItems, selectedProjectId]);

  const handleOpenLinkedWorkItem = (item: ProjectWorkItem) => {
    if (!selectedProjectId) return;

    const target: IssueNavigationTarget = {
      projectId: selectedProjectId,
      workItemId: item.id,
    };

    window.dispatchEvent(
      new CustomEvent<IssueNavigationTarget>(ISSUE_NAVIGATION_EVENT, {
        detail: target,
      }),
    );
  };

  const handleLinkedWorkItemStatusChange = async (
    item: ProjectWorkItem,
    status: ProjectWorkItem["status"],
  ) => {
    if (!selectedProjectId || item.status === status) return;

    const optimisticItem = { ...item, status };
    setUpdatingLinkedWorkItemIds((current) => {
      const next = new Set(current);
      next.add(item.id);
      return next;
    });
    setLinkedWorkItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id ? optimisticItem : candidate,
      ),
    );

    try {
      const updated = await projectWorkItemsApi.update(
        selectedProjectId,
        item.id,
        { status },
      );
      setLinkedWorkItems((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
      );
      markPendingIssueStatusSync(selectedProjectId, updated.id, updated.status);
      notifyBuildStatsUsageUpdated(selectedProjectId);
      showToast(t("linkedWorkItems.statusUpdated"));
    } catch {
      setLinkedWorkItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? item : candidate,
        ),
      );
      showToast(t("linkedWorkItems.statusUpdateError"));
    } finally {
      setUpdatingLinkedWorkItemIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const summarizeMessage = (text: string) => {
    const normalized = text.trim().replace(/\s+/g, " ");
    if (!normalized) return t("message.quoteEmpty");
    return normalized.length > 140
      ? `${normalized.slice(0, 137)}...`
      : normalized;
  };

  const summarizeQueuedMessage = (item: QueuedMessageListItem) => {
    const source =
      messagesById.get(item.message.chat_message_id) ??
      messagesById.get(item.message.id);
    return summarizeMessage(source?.text ?? "");
  };

  const setQueueActionPending = (id: string, pending: boolean) => {
    setQueueActionIds((current) => {
      const next = new Set(current);
      if (pending) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleDeleteQueuedMessage = async (
    sessionId: string,
    queueId: string,
  ) => {
    if (queueActionIds.has(queueId)) return;
    setQueueActionPending(queueId, true);
    try {
      await deleteQueuedMessage(sessionId, queueId);
    } catch {
      showToast("删除排队消息失败");
    } finally {
      setQueueActionPending(queueId, false);
    }
  };

  const handleContinueMemberQueue = async (
    sessionId: string,
    sessionAgentId: string,
  ) => {
    const actionId = `continue-${sessionAgentId}`;
    if (queueActionIds.has(actionId)) return;
    setQueueActionPending(actionId, true);
    try {
      await continueMemberQueue(sessionId, sessionAgentId);
    } catch {
      showToast("继续执行队列失败");
    } finally {
      setQueueActionPending(actionId, false);
    }
  };

  const renderInlineQueueGroup = (
    group: (typeof visibleQueueGroups)[number] | undefined,
  ) => {
    if (!group) return null;
    const { queue, items } = group;
    const continueActionId = `continue-${queue.session_agent_id}`;
    return (
      <div className="mt-2 max-w-md rounded-md border border-[var(--hairline)] bg-[var(--surface-1)]/70 p-1 shadow-none">
        <div className="flex max-h-24 flex-col gap-0.5 overflow-y-auto pr-0.5">
          {items.map((item) => {
            const status = String(item.message.status);
            const canDelete = item.can_delete && status === "queued";
            return (
              <div
                key={item.message.id}
                className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-[10px] text-[var(--ink-tertiary)] hover:bg-[var(--surface-2)]"
              >
                <span
                  className="min-w-0 flex-1 truncate"
                  title={summarizeQueuedMessage(item)}
                >
                  {summarizeQueuedMessage(item)}
                </span>
                <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[8px] text-[var(--ink-tertiary)]">
                  {queuedMessageStatusLabel(status)}
                </span>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() =>
                      void handleDeleteQueuedMessage(
                        queue.session_id,
                        item.message.id,
                      )
                    }
                    disabled={queueActionIds.has(item.message.id)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-rose-500 disabled:cursor-wait disabled:opacity-60"
                    title="删除排队消息"
                    aria-label="删除排队消息"
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
              onClick={() =>
                void handleContinueMemberQueue(
                  queue.session_id,
                  queue.session_agent_id,
                )
              }
              disabled={queueActionIds.has(continueActionId)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-2)] hover:text-[var(--primary)] disabled:cursor-wait disabled:opacity-60"
              title="继续执行队列"
              aria-label="继续执行队列"
            >
              <Play className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    );
  };

  const handleCopyAgentMessage = async (messageId: string, text: string) => {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API unavailable");
      }

      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);

      if (copiedResetTimerRef.current !== null) {
        window.clearTimeout(copiedResetTimerRef.current);
      }

      copiedResetTimerRef.current = window.setTimeout(() => {
        setCopiedMessageId((current) =>
          current === messageId ? null : current,
        );
        copiedResetTimerRef.current = null;
      }, 1400);
    } catch {
      showToast(t("message.copyFailed"));
    }
  };

  const handleQuoteAgentMessage = (
    messageId: string,
    sender: string,
    text: string,
  ) => {
    setQuotedMessage({
      id: messageId,
      sender,
      content: text,
      summary: summarizeMessage(text),
    });
    inputRef.current?.focus();
  };

  const handleStopAgentMessage = async (
    sessionAgentId: string,
    runId?: string,
  ) => {
    if (isStopPendingForMessage(sessionAgentId, runId)) return;

    setStoppingSessionAgentIds((current) => {
      return {
        ...current,
        [sessionAgentId]: runId ?? null,
      };
    });

    try {
      await sessionAgentsApi.stop(activeSessionId, sessionAgentId);
      markSessionAgentStopped(sessionAgentId);
      showToast(t("agent.stopRequested"));
      void refreshMembers();
    } catch {
      setStoppingSessionAgentIds((current) => {
        if (current[sessionAgentId] !== (runId ?? null)) return current;
        const next = { ...current };
        delete next[sessionAgentId];
        return next;
      });
      void refreshMessages();
      void refreshMembers();
      showToast(t("agent.stopFailed"));
    }
  };

  const addAttachedFiles = (files: FileList | File[]) => {
    if (sessionsAsync.source !== "api") {
      showToast(t("attachment.requiresApi"));
      return;
    }

    const list = Array.from(files);
    if (list.length === 0) return;

    const allowedFiles = list.filter((file) => isAllowedAttachment(file));
    const rejectedCount = list.length - allowedFiles.length;

    if (rejectedCount > 0) {
      showToast(t("attachment.unsupported", { count: rejectedCount }));
    }

    if (allowedFiles.length === 0) return;

    setAttachedFiles((current) => {
      const existing = new Set(current.map(attachmentIdentity));
      const next = [...current];
      for (const file of allowedFiles) {
        const identity = attachmentIdentity(file);
        if (!existing.has(identity)) {
          existing.add(identity);
          next.push(file);
        }
      }
      return next;
    });
  };

  const handleAttachmentInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (event.target.files) {
      addAttachedFiles(event.target.files);
    }
    event.target.value = "";
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = getClipboardFiles(event.clipboardData);
    if (files.length === 0) return;

    event.preventDefault();
    addAttachedFiles(files);
  };

  const removeAttachedFile = (fileIndex: number) => {
    setAttachedFiles((current) =>
      current.filter((_, index) => index !== fileIndex),
    );
  };

  const openAttachmentPicker = () => {
    if (sessionsAsync.source !== "api") {
      showToast(t("attachment.requiresApi"));
      return;
    }
    fileInputRef.current?.click();
  };

  const handleSend = async () => {
    const messageText = inputText;
    const trimmedInput = messageText.trim();
    if (!trimmedInput && attachedFiles.length === 0) return;
    if (isUploadingAttachments) return;

    chatAutoFollowRef.current = true;

    if (attachedFiles.length > 0) {
      if (sessionsAsync.source !== "api") {
        showToast(t("attachment.requiresApi"));
        return;
      }

      setIsUploadingAttachments(true);
      try {
        if (chatInputMode === "workflow") {
          await ensureWorkflowRouteToMainAgent();
        }
        const explicitAttachmentMentions = routeMentionsForText(messageText);
        const mainAgentRouteMention = mainAgentName
          ? mainAgentName.trim().replace(/^@/, "")
          : null;
        const attachmentRouteMentions =
          explicitAttachmentMentions.length > 0
            ? explicitAttachmentMentions
            : chatInputMode !== "workflow" && mainAgentRouteMention
              ? [mainAgentRouteMention]
              : undefined;
        await chatMessagesApi.uploadAttachment(activeSessionId, attachedFiles, {
          chatInputMode,
          content: trimmedInput ? messageText : undefined,
          appLanguage: locale,
          referenceMessageId: quotedMessage?.id,
          mentions: attachmentRouteMentions,
        });
        setInputTextDraft("");
        setQuotedMessage(null);
        setAttachedFiles([]);
        await refreshMessages();
      } catch {
        showToast(t("attachment.uploadFailed"));
      } finally {
        setIsUploadingAttachments(false);
      }
      return;
    }

    sendMessage(messageText, {
      chatInputMode,
      ...(quotedMessage ? { quotedMessage } : {}),
    });
    setInputTextDraft("");
    setQuotedMessage(null);
  };

  const handleInputChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const nextValue = event.target.value;
    const cursor = event.target.selectionStart ?? nextValue.length;
    setInputTextDraft(nextValue);
    resizeChatTextarea(event.target);

    if (cursor > 0 && nextValue[cursor - 1] === "@") {
      setIsMemberPickerOpen(true);
      setActiveMemberPickerIndex(0);
    }
  };

  const insertMemberMention = (member: Member) => {
    const handle = member.name.startsWith("@") ? member.name : `@${member.name}`;
    const input = inputRef.current;
    const currentValue = input?.value ?? inputText;
    const cursorStart = input?.selectionStart ?? currentValue.length;
    const cursorEnd = input?.selectionEnd ?? cursorStart;
    const beforeCursor = currentValue.slice(0, cursorStart);
    const tokenMatch = beforeCursor.match(/@[a-zA-Z0-9_-]*$/);
    const replaceStart = tokenMatch
      ? cursorStart - tokenMatch[0].length
      : cursorStart;
    const prefix = currentValue.slice(0, replaceStart);
    const suffix = currentValue.slice(cursorEnd);
    const leadingSpace =
      replaceStart === 0 || /\s$/.test(prefix) ? "" : " ";
    const trailingSpace =
      suffix.length === 0 || /^\s/.test(suffix) ? " " : " ";
    const inserted = `${leadingSpace}${handle}${trailingSpace}`;
    const nextValue = `${prefix}${inserted}${suffix}`;
    const nextCursor = prefix.length + inserted.length;

    setInputTextDraft(nextValue);
    setIsMemberPickerOpen(false);
    setActiveMemberPickerIndex(0);

    const restoreCursor = () => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(restoreCursor);
    } else {
      restoreCursor();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isMemberPickerOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveMemberPickerIndex((current) =>
          members.length === 0 ? 0 : (current + 1) % members.length,
        );
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveMemberPickerIndex((current) =>
          members.length === 0
            ? 0
            : (current - 1 + members.length) % members.length,
        );
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const member = members[activeMemberPickerIndex] ?? members[0];
        if (member) {
          insertMemberMention(member);
        } else {
          setIsMemberPickerOpen(false);
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setIsMemberPickerOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleTogglePlanMode = () => {
    setChatInputMode(chatInputMode === "workflow" ? "free" : "workflow");
  };

  // Quick summon clicks
  const handleQuickAddClick = (member: Member) => {
    insertMemberMention(member);
  };

  const handleRelatedFileClick = (file: RelatedFileChange) => {
    if (hasRelatedFileDiff(file) && onOpenDiffTab) {
      onOpenDiffTab(
        activeSessionId,
        file.path,
        file.status,
        file.unified_diff ?? "",
      );
      return;
    }

    openFileInVSCode(file.path, { openAsDiff: false });
    showToast(t("relatedFiles.noDiffOpenFile"));
  };

  const openArtifactInExplorer = useCallback(
    (path: string, workspacePath?: string | null) => {
      void openInSystemFileManager(
        path,
        workspacePath ?? currentWorkspacePath,
        activeSessionId,
      )
        .then((response) => {
          if (!response.ok) {
            showToast(response.error ?? "Failed to open in Explorer");
          }
        })
        .catch((error) => {
          showToast(
            error instanceof Error
              ? error.message
              : "Failed to open in Explorer",
          );
        });
    },
    [activeSessionId, currentWorkspacePath, showToast],
  );

  // Open an artifact file from an agent message. Files without run diff data
  // (including ignored `.openteams/` artifacts) open in Explorer directly.
  const handleOpenArtifact = useCallback(
    (file: AgentFileRow) => {
      const path = file.path;
      if (
        isOpenteamsPath(path) ||
        file.supplementary ||
        file.hasDiff === false
      ) {
        openArtifactInExplorer(path, file.workspacePath);
        return;
      }

      const openRunDiff = (row: AgentFileRow) => {
        if (!onOpenDiffTab || row.unifiedDiff === undefined) {
          return false;
        }
        onOpenDiffTab(
          activeSessionId,
          row.path,
          row.status ?? file.status ?? "M",
          row.unifiedDiff,
          row.runId ?? file.runId,
        );
        return true;
      };

      if (openRunDiff(file)) {
        return;
      }
      if (file.runId) {
        void chatRunsApi
          .getFiles(file.runId, { includeDiff: true })
          .then((response) => {
            const match = flattenRunFileChanges(response).find(
              (candidate) =>
                normalizeArtifactPath(candidate.path) ===
                normalizeArtifactPath(path),
            );
            if (!match || !openRunDiff(match)) {
              openArtifactInExplorer(path, file.workspacePath);
            }
          })
          .catch(() => {
            openArtifactInExplorer(path, file.workspacePath);
          });
        return;
      }
      openArtifactInExplorer(path, file.workspacePath);
    },
    [
      onOpenDiffTab,
      activeSessionId,
      openArtifactInExplorer,
    ],
  );

  const handleRelatedFilesResizeStart = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = effectiveRelatedFilesWidth;
    const pointerScale = appScale.enabled ? appScale.scale : 1;
    const originalCursor = document.body.style.cursor;
    const originalUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = (startX - moveEvent.clientX) / pointerScale;
      const nextWidth = Math.min(
        relatedFilesMaxAvailableWidth,
        Math.max(RELATED_FILES_MIN_WIDTH, startWidth + delta),
      );
      setRelatedFilesWidth(nextWidth);
    };

    const handleMouseUp = () => {
      document.body.style.cursor = originalCursor;
      document.body.style.userSelect = originalUserSelect;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const isPlanMode = chatInputMode === "workflow";
  const planModeMainAgentName = mainAgentHandle;
  const freeModePlaceholder = t("discussPlaceholder", {
    agent: mainAgentHandle,
  });
  const canSend =
    (Boolean(inputText.trim()) || attachedFiles.length > 0) &&
    !isUploadingAttachments;

  const formatMessageTime = (time: string) => {
    if (time === "just now") return t("justNow");

    const minuteMatch = time.match(/^(\d+)m ago$/);
    if (minuteMatch) {
      return t("minutesAgo", { minutes: minuteMatch[1] });
    }

    const hourMatch = time.match(/^(\d+)h ago$/);
    if (hourMatch) {
      return t("hoursAgo", { hours: hourMatch[1] });
    }

    return time;
  };

  const renderMentionText = (mention: string, key: React.Key) => (
    <span
      key={key}
      className="text-[var(--primary)] hover:text-[var(--primary-hover)] font-semibold font-mono mx-0.5"
    >
      {mention}
    </span>
  );

  const displayMentionForUserMessage = (message: Message) => {
    if (extractMentionHandles(message.text).length > 0) return null;
    const routedMention = message.mentions?.[0];
    if (routedMention) {
      const normalized = normalizeMentionHandle(routedMention);
      return (
        sidebarMembers.find(
          (member) => normalizeMentionHandle(member.name) === normalized,
        )?.name ?? normalized
      );
    }
    return mainAgentHandle;
  };

  // Highlight @mentions while keeping user-entered markdown characters literal.
  const formatMsgText = (text: string) => {
    if (!text) return "";
    const elements = text.split(/(@[a-zA-Z0-9_-]+)/g);

    return elements.map((el, idx) => {
      if (el.startsWith("@")) {
        return renderMentionText(el, idx);
      }
      return <span key={idx}>{el}</span>;
    });
  };

  const plainRelatedFilesContent = (
    <>
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <h2 className="text-[14px] font-semibold text-[var(--ink)]">
          {t("relatedFiles.title")}
        </h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={reloadRelatedFiles}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
            title={t("relatedFiles.refresh")}
            aria-label={t("relatedFiles.refresh")}
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-3.5 w-3.5 ${
                workspaceChangesAsync.loading ? "animate-spin" : ""
              }`}
            />
          </button>
          <span className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 font-mono text-[13px] text-[var(--ink-tertiary)]">
            {relatedFileChanges.length}
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1 px-2 pb-2">
        {workspaceChangesAsync.loading && (
          <div className="rounded-md bg-[var(--surface-1)] px-3 py-3 text-[13px] text-[var(--ink-tertiary)]">
            {t("relatedFiles.loading")}
          </div>
        )}
        {workspaceChangesAsync.error && (
          <div className="rounded-md bg-[var(--surface-1)] px-3 py-3 text-[13px] text-rose-500">
            {workspaceChangesAsync.error}
          </div>
        )}
        {!workspaceChangesAsync.loading &&
          !workspaceChangesAsync.error &&
          relatedFileChanges.length === 0 && (
            <div className="rounded-md bg-[var(--surface-1)] px-3 py-3 text-[13px] text-[var(--ink-tertiary)]">
              {t("relatedFiles.noChangedFiles")}
            </div>
          )}
        {!workspaceChangesAsync.loading &&
          !workspaceChangesAsync.error &&
          relatedFileChanges.length > 0 && (
            <div className="space-y-1">
              {relatedFileChanges.map((file) => (
                <button
                  type="button"
                  key={`${file.status}-${file.path}`}
                  onClick={() => handleRelatedFileClick(file)}
                  className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md bg-[var(--surface-1)] px-2 text-left text-[13px] transition-colors hover:bg-[var(--surface-3)]"
                  aria-label={t("relatedFiles.openDiff", {
                    path: file.path,
                  })}
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

  return (
    <div
      className={
        embedded
          ? "relative h-full w-full flex flex-col font-sans text-xs select-none"
          : "relative rounded-xl border border-[var(--hairline)] bg-[var(--canvas)] overflow-hidden font-sans text-xs select-none"
      }
    >
      {attachmentImagePreview && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          onClick={() => setAttachmentImagePreview(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={attachmentImagePreview.name}
            className="flex max-h-[min(84vh,760px)] w-[min(92vw,960px)] flex-col overflow-hidden rounded-md border border-[var(--hairline-strong)] bg-[var(--surface-1)] text-[var(--ink)] shadow-[0_24px_80px_rgba(0,0,0,0.36)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex min-h-0 items-center gap-3 border-b border-[var(--hairline)] px-3 py-2">
              <ImageIcon className="h-4 w-4 shrink-0 text-[var(--ink-tertiary)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-[var(--ink)]">
                  {attachmentImagePreview.name}
                </div>
                {attachmentImagePreview.sizeBytes ? (
                  <div className="font-mono text-[10px] text-[var(--ink-tertiary)]">
                    {formatFileSize(attachmentImagePreview.sizeBytes)}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                onClick={() => setAttachmentImagePreview(null)}
                title={t("aria.closeTab")}
                aria-label={t("aria.closeTab")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--canvas)] p-3">
              <img
                src={attachmentImagePreview.url}
                alt={attachmentImagePreview.name}
                className="max-w-full rounded-sm object-contain"
                style={{
                  maxHeight: "calc(min(84vh, 760px) - 64px)",
                }}
              />
            </div>
          </div>
        </div>
      )}
      <div
        style={
          isRelatedFilesOpen
            ? ({
                "--related-files-width": `${effectiveRelatedFilesWidth}px`,
              } as React.CSSProperties)
            : undefined
        }
        ref={workspaceGridRef}
        className={
          isRelatedFilesOpen
            ? embedded
              ? "grid h-full w-full min-h-0 grid-cols-[minmax(0,1fr)_6px_var(--related-files-width)] grid-rows-1 gap-0"
              : "grid min-h-[500px] w-full grid-cols-[minmax(0,1fr)_6px_var(--related-files-width)] gap-0"
            : embedded
              ? "grid h-full w-full min-h-0 grid-cols-1"
              : "grid min-h-[500px] w-full grid-cols-1"
        }
      >
        {/* Center Panel (Conversation) */}
        <main
          className={`relative flex h-full min-h-0 w-full min-w-0 flex-col p-4 ${
            embedded ? "bg-transparent" : "bg-[var(--canvas)]"
          }`}
        >
          {unfinishedWorkflowCardMessageId && (
            <button
              type="button"
              onClick={jumpToUnfinishedWorkflowCard}
              className={`absolute top-1.5 z-20 flex h-7 items-center gap-1.5 rounded-full border border-amber-500/35 bg-[var(--surface-1)]/95 px-3 text-[10px] font-medium text-amber-600 shadow-sm backdrop-blur transition-colors hover:bg-amber-500/10 dark:text-amber-400 ${
                isRelatedFilesOpen ? "right-7" : "right-10"
              }`}
              title="Jump to unfinished workflow"
              aria-label="Jump to unfinished workflow"
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span>Active Workflow</span>
            </button>
          )}
          {!isRelatedFilesOpen && (
            <button
              type="button"
              onClick={openRelatedFiles}
              className="absolute top-1 right-1 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-subtle)] shadow-sm transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
              title={t("relatedFiles.show")}
              aria-label={t("relatedFiles.show")}
            >
              <PanelRightOpen className="h-4 w-4" />
            </button>
          )}
          <div
            className={`mb-3 space-y-2 ${!isRelatedFilesOpen ? "pr-10" : ""}`}
          >
            <ResourceStateNotice
              resource={sessionsAsync}
              labels={{
                loading: t("resource.sessions.loading"),
                empty: t("resource.sessions.empty"),
                error: t("resource.sessions.error"),
                fallback: t("resource.sessions.fallback"),
              }}
              onRetry={() => void refreshSessions()}
              compact
            />
          </div>

          {/* Messages Feed */}
          <div className="relative mb-4 min-h-0 flex-1">
          <ScrollArea
            ref={chatMessagesScrollRef}
            className="h-full space-y-4 pr-1"
            onScroll={handleChatScroll}
            onWheel={handleChatWheel}
          >
            {(!messagesAsync.loading || displayedMessages.length === 0) && (
              <ResourceStateNotice
                resource={messagesAsync}
                labels={{
                  loading: t("resource.messages.loading"),
                  empty: t("resource.messages.empty"),
                  error: t("resource.messages.error"),
                  fallback: t("resource.messages.fallback"),
                }}
                onRetry={() => void refreshMessages()}
              />
            )}
            {displayedMessages.map((msg) => (
              <div
                key={msg.id}
                id={`chat-message-${msg.id}`}
                className={`group/message relative flex w-full min-w-0 gap-3 items-start rounded-md ${
                  msg.isUser
                    ? "border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2.5"
                    : "px-1 py-2 pb-8"
                }`}
              >
                {msg.isUser ? (
                  <span className="h-7 w-7 rounded-full bg-[var(--primary)] text-white font-bold flex items-center justify-center text-[9px] font-mono border border-[var(--primary)] flex-shrink-0">
                    {t("youShort")}
                  </span>
                ) : (
                  <span className="h-7 w-7 rounded-full bg-[var(--mono-bg)] border border-[var(--mono-border)] flex items-center justify-center text-[9px] font-mono font-bold text-[var(--ink-muted)] flex-shrink-0">
                    {msg.avatar}
                  </span>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span
                      className="font-semibold text-[var(--ink)]"
                      style={{ fontSize: `${chatMessageFontSize}px` }}
                    >
                      {msg.isUser ? "you" : displayChatSenderName(msg.sender)}
                    </span>
                    {msg.model && (
                      <span className="rounded-full bg-[var(--surface-3)] border border-[var(--hairline-strong)] px-2 py-0.5 text-[9px] font-mono text-[var(--ink-muted)] shrink-0 select-text">
                        {msg.model}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-[var(--ink-tertiary)] ml-auto">
                      {formatMessageTime(msg.time)}
                    </span>
                  </div>

                  {msg.quotedMessage && (
                    <div className="mb-2 flex items-start gap-2 rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[11px] text-[var(--ink-muted)]">
                      <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-[var(--ink)]">
                          {t("message.quotePrefix", {
                            sender: msg.quotedMessage.sender,
                          })}
                        </div>
                        <div className="truncate font-mono text-[10px] text-[var(--ink-tertiary)]">
                          {msg.quotedMessage.summary}
                        </div>
                      </div>
                    </div>
                  )}

                  {msg.isUser ? (
                    <div
                      className="whitespace-pre-wrap break-words leading-relaxed text-[var(--ink)] select-text"
                      style={{ fontSize: `${chatMessageFontSize}px` }}
                    >
                      {displayMentionForUserMessage(msg) && (
                        <>
                          {renderMentionText(
                            displayMentionForUserMessage(msg) ?? "",
                            "implicit-route-mention",
                          )}
                          {" "}
                        </>
                      )}
                      {formatMsgText(msg.text)}
                    </div>
                  ) : (
                    <AgentMessageContent
                      message={msg}
                      t={t}
                      messageFontSize={chatMessageFontSize}
                      onOpenArtifact={handleOpenArtifact}
                    />
                  )}

                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="mt-2 flex flex-col gap-2">
                      {msg.attachments.map((attachment) => {
                        const url = chatMessagesApi.attachmentUrl(
                          activeSessionId,
                          msg.id,
                          attachment.id,
                        );
                        const isImage = isImageChatAttachment(attachment);
                        if (isImage) {
                          return (
                            <button
                              key={attachment.id}
                              type="button"
                              className="group/attachment max-w-md rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-2 text-left text-[11px] text-[var(--ink-muted)] transition hover:border-[var(--hairline-strong)] hover:bg-[var(--surface-3)]"
                              onClick={(event) => {
                                event.stopPropagation();
                                setAttachmentImagePreview({
                                  url,
                                  name: attachment.name,
                                  sizeBytes: attachment.size_bytes,
                                });
                              }}
                              title={attachment.name}
                              aria-label={attachment.name}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                                <span
                                  className="min-w-0 flex-1 truncate font-medium text-[var(--ink)]"
                                  title={attachment.name}
                                >
                                  {attachment.name}
                                </span>
                                {attachment.size_bytes ? (
                                  <span className="shrink-0 font-mono text-[10px] text-[var(--ink-tertiary)]">
                                    {formatFileSize(attachment.size_bytes)}
                                  </span>
                                ) : null}
                              </div>
                              <img
                                src={url}
                                alt={attachment.name}
                                className="mt-2 max-h-44 max-w-full rounded-sm border border-[var(--hairline)] object-contain"
                                loading="lazy"
                              />
                            </button>
                          );
                        }

                        return (
                          <a
                            key={attachment.id}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="group/attachment max-w-md rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-2 text-[11px] text-[var(--ink-muted)] transition hover:border-[var(--hairline-strong)] hover:bg-[var(--surface-3)]"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                              <span
                                className="min-w-0 flex-1 truncate font-medium text-[var(--ink)]"
                                title={attachment.name}
                              >
                                {attachment.name}
                              </span>
                              {attachment.size_bytes ? (
                                <span className="shrink-0 font-mono text-[10px] text-[var(--ink-tertiary)]">
                                  {formatFileSize(attachment.size_bytes)}
                                </span>
                              ) : null}
                            </div>
                          </a>
                        );
                      })}
                    </div>
                  )}

                  {msg.cost && (
                    <div className="mt-1 text-[10px] font-mono text-[var(--ink-tertiary)]">
                      {msg.cost}
                    </div>
                  )}
                  {!msg.isUser &&
                    msg.sessionAgentId &&
                    queueAnchorMessageIds.get(msg.sessionAgentId) === msg.id &&
                    renderInlineQueueGroup(
                      queueGroupsBySessionAgentId.get(msg.sessionAgentId),
                    )}
                </div>

                {!msg.isUser &&
                  msg.isAgentRunning &&
                  msg.sessionAgentId &&
                  sessionsAsync.source === "api" && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleStopAgentMessage(
                          msg.sessionAgentId!,
                          msg.runId,
                        );
                      }}
                      disabled={isStopPendingForMessage(
                        msg.sessionAgentId,
                        msg.runId,
                      )}
                      className="absolute bottom-1 right-1 z-10 flex h-6 w-6 items-center justify-center rounded-sm text-rose-500 transition hover:bg-rose-500/10 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                      title={t("agent.stop")}
                      aria-label={t("agent.stop")}
                    >
                      <Square className="h-3 w-3 fill-current" />
                    </button>
                  )}

                {!msg.isUser && (
                  <div
                    className={`pointer-events-none absolute bottom-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 ${
                      msg.isAgentRunning &&
                      msg.sessionAgentId &&
                      sessionsAsync.source === "api"
                        ? "right-8"
                        : "right-1"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleCopyAgentMessage(msg.id, msg.text);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink-subtle)]"
                      title={t("message.copy")}
                      aria-label={t("message.copy")}
                    >
                      {copiedMessageId === msg.id ? (
                        <Check className="h-3 w-3 text-[var(--success)]" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleQuoteAgentMessage(msg.id, msg.sender, msg.text);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink-subtle)]"
                      title={t("message.quote")}
                      aria-label={t("message.quote")}
                    >
                      <Quote className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </ScrollArea>
          </div>

          {/* Chat discussion input styled in GPT-4 style with space */}
          <div className="shrink-0 pt-4 pb-0">
            {quotedMessage && (
              <div className="mb-2 flex items-start gap-2 rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2 text-[11px] text-[var(--ink-muted)]">
                <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-[var(--ink)]">
                    {t("message.quotePrefix", {
                      sender: quotedMessage.sender,
                    })}
                  </div>
                  <div className="truncate font-mono text-[10px] text-[var(--ink-tertiary)]">
                    {quotedMessage.summary}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setQuotedMessage(null)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                  title={t("message.dismissQuote")}
                  aria-label={t("message.dismissQuote")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {attachedFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachedFiles.map((file, index) => {
                  const AttachmentIcon = isImageAttachment(file)
                    ? ImageIcon
                    : FileText;
                  return (
                    <div
                      key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                      className="flex max-w-full items-center gap-2 rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2 text-[11px] text-[var(--ink-muted)]"
                    >
                      <AttachmentIcon className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                      <span
                        className="max-w-[180px] truncate font-medium text-[var(--ink)]"
                        title={file.name}
                      >
                        {file.name}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-[var(--ink-tertiary)]">
                        {formatFileSize(file.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAttachedFile(index)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                        title={t("attachment.remove")}
                        aria-label={t("attachment.remove")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div
              onClick={() => inputRef.current?.focus()}
              className={`relative rounded-md border border-[var(--hairline-strong)] bg-[var(--surface-1)] focus-within:border-[var(--primary)] p-3.5 transition-all flex flex-col gap-3 min-h-[95px] ${
                isPlanMode ? "plan-mode-input-active" : ""
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept={CHAT_ATTACHMENT_ACCEPT}
                onChange={handleAttachmentInputChange}
              />
              {/* Text Area */}
              <textarea
                ref={inputRef}
                rows={1}
                className="w-full bg-transparent resize-none border-none text-[16px] leading-6 text-[var(--ink)] outline-none placeholder:text-[var(--ink-tertiary)] select-text overflow-y-auto md:text-[13px] md:leading-normal"
                style={{
                  minHeight: CHAT_INPUT_MIN_HEIGHT,
                  maxHeight: CHAT_INPUT_MAX_HEIGHT,
                }}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onClick={(e) => e.stopPropagation()}
                placeholder={
                  isPlanMode
                    ? t("planModePlaceholder", {
                        agent: planModeMainAgentName,
                      })
                    : freeModePlaceholder
                }
              />

              {/* Bottom control row inside input slot */}
              <div className="flex flex-wrap items-center justify-between pt-1 shrink-0 gap-2 select-none">
                {/* Switch to workflow/Turn into workflow on the left */}
                <div className="flex items-center gap-1.5">
                  {/* Plus symbol */}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openAttachmentPicker();
                    }}
                    disabled={isUploadingAttachments}
                    className="p-1 rounded-full hover:bg-[var(--surface-3)] text-[var(--ink-subtle)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                    title={t("uploadFile")}
                    aria-label={t("uploadFile")}
                  >
                    {attachedFiles.length > 0 ? (
                      <Paperclip className="h-4 w-4" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleTogglePlanMode();
                    }}
                    className={`plan-mode-toggle flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium transition cursor-pointer ${
                      isPlanMode
                        ? "plan-mode-toggle-active border-[var(--primary)] bg-[var(--primary-tint)] text-[var(--primary)]"
                        : "border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-muted)] hover:bg-[var(--surface-3)]"
                    }`}
                    title={
                      isPlanMode
                        ? t("switchToChatMode")
                        : t("switchToPlanMode")
                    }
                    aria-pressed={isPlanMode}
                    aria-label={
                      isPlanMode
                        ? t("switchToChatMode")
                        : t("switchToPlanMode")
                    }
                  >
                    <GitBranch className="h-3 w-3" />
                    <span>{t("planMode")}</span>
                  </button>
                </div>

                {/* Right controls: session members, voice icon, and send action */}
                <div className="flex items-center gap-2">
                  {isPlanMode ? (
                    <div
                      className="flex max-w-[180px] items-center gap-1.5 rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[11px] font-medium text-[var(--ink-muted)]"
                      title={t("fixedMainAgentMention", {
                        agent: planModeMainAgentName,
                      })}
                      aria-label={t("fixedMainAgentMention", {
                        agent: planModeMainAgentName,
                      })}
                    >
                      <span className="truncate">{planModeMainAgentName}</span>
                      <Lock className="h-3 w-3 shrink-0 opacity-70" />
                    </div>
                  ) : (
                    <div ref={memberPickerRef} className="relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsMemberPickerOpen((prev) => !prev);
                      }}
                      className="flex items-center gap-1.5 bg-[var(--surface-2)] border border-[var(--hairline)] px-2 py-1 rounded-md text-[11px] text-[var(--ink-muted)] font-mono hover:bg-[var(--surface-3)] cursor-pointer"
                      title={t("inThisSession")}
                    >
                      <AtSign className="h-3.5 w-3.5 text-[var(--ink-tertiary)]" />
                      <ChevronDown
                        aria-hidden="true"
                        className="h-3 w-3 text-[var(--ink-tertiary)]"
                      />
                    </button>

                    {isMemberPickerOpen && (
                      <div className="absolute bottom-full right-0 mb-2 w-56 rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-3)] p-1 z-20">
                        <div className="px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--ink-tertiary)]">
                          {t("inThisSession")}
                        </div>
                        <ResourceStateNotice
                          resource={membersAsync}
                          labels={{
                            loading: t("resource.members.loading"),
                            empty: t("resource.members.empty"),
                            error: t("resource.members.error"),
                            fallback: t("resource.members.fallback"),
                          }}
                          onRetry={() => void refreshMembers()}
                          compact
                          className="mb-1"
                        />
                        {members.length === 0 ? (
                          <div className="px-2 py-2 text-[10px] text-[var(--ink-tertiary)]">
                            {t("noSessionMembers")}
                          </div>
                        ) : (
                          members.map((member, index) => (
                            <button
                              key={member.id}
                              type="button"
                              aria-selected={index === activeMemberPickerIndex}
                              onMouseEnter={() =>
                                setActiveMemberPickerIndex(index)
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                handleQuickAddClick(member);
                              }}
                              className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left cursor-pointer ${
                                index === activeMemberPickerIndex
                                  ? "bg-[color-mix(in_srgb,var(--primary)_24%,var(--surface-3))] ring-1 ring-inset ring-[color-mix(in_srgb,var(--primary)_48%,transparent)]"
                                  : "hover:bg-[color-mix(in_srgb,var(--primary)_12%,var(--surface-3))]"
                              }`}
                            >
                              <span className="h-5 w-5 rounded-full bg-[var(--mono-bg)] border border-[var(--mono-border)] flex items-center justify-center text-[8px] font-mono font-semibold text-[var(--ink-muted)]">
                                {member.avatar}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11px] font-semibold text-[var(--ink)]">
                                  {member.name}
                                </span>
                                <span className="block truncate text-[9px] font-mono text-[var(--ink-tertiary)]">
                                  {member.roleDetail}
                                </span>
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  )}

                  <button
                    type="button"
                    onClick={() => showToast(t("toast.voiceReady"))}
                    className="p-1 rounded-full hover:bg-[var(--surface-2)] text-[var(--ink-subtle)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                    title={t("voiceInput")}
                  >
                    <Mic className="h-4 w-4" />
                  </button>

                  {/* Send action on the right */}
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={!canSend}
                    className={`p-1.5 rounded-full transition-all flex items-center justify-center shrink-0 ${
                      canSend
                        ? "bg-[var(--primary)] text-white hover:opacity-95 cursor-pointer hover:scale-105"
                        : "bg-[var(--surface-3)] text-[var(--ink-tertiary)] cursor-not-allowed"
                    }`}
                    title={
                      isUploadingAttachments
                        ? t("attachment.uploading")
                        : undefined
                    }
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>

        {isRelatedFilesOpen && (
          <div
            className="group relative h-full min-h-0 cursor-col-resize self-stretch"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("relatedFiles.resize")}
            title={t("relatedFiles.resize")}
            onMouseDown={handleRelatedFilesResizeStart}
          >
            <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[color-mix(in_srgb,var(--hairline)_55%,transparent)] transition-[width,background-color] group-hover:w-1 group-hover:bg-[var(--hairline-tertiary)] group-active:w-1 group-active:bg-[var(--hairline-tertiary)]" />
          </div>
        )}

        {isRelatedFilesOpen && (
          <aside
            className={`main-right-nav-panel-scrollbars-hidden relative flex min-h-0 flex-col overflow-hidden ${
              embedded ? "bg-transparent" : "bg-[var(--canvas)]"
            }`}
          >
            <button
              type="button"
              onClick={closeRelatedFiles}
              className="absolute right-1 top-0 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
              title={t("relatedFiles.hide")}
              aria-label={t("relatedFiles.hide")}
            >
              <PanelRightClose className="h-4 w-4" />
            </button>

            <div className="shrink-0 px-3 py-3">
              <div className="mb-2 pr-10 text-[14px] font-semibold text-[var(--ink)]">
                {t("sessionMembers")}
              </div>
              <div className="flex h-10 min-w-0 items-center gap-1.5">
                <ScrollArea
                  ref={memberRailRef}
                  orientation="horizontal"
                  scrollbar={isMemberRailExpanded ? "styled" : "hidden"}
                  className={`flex min-w-0 flex-1 gap-1.5 overflow-hidden px-1 ${
                    isMemberRailExpanded
                      ? "h-12 -mb-2 items-start pb-2 pt-1.5"
                      : "h-10 items-center"
                  }`}
                >
                  {displayedSidebarMembers.map((member) => {
                    const isSelected = selectedSidebarMemberId === member.id;
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() =>
                          setSelectedSidebarMemberId((current) =>
                            current === member.id ? null : member.id,
                          )
                        }
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-left transition-[box-shadow] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] ${
                          isSelected
                            ? "ring-2 ring-[var(--primary-focus)]/55"
                            : ""
                        }`}
                        title={member.name}
                        aria-label={member.name}
                        aria-pressed={isSelected}
                      >
                        <SessionMemberAvatar member={member} />
                      </button>
                    );
                  })}
                </ScrollArea>
                {hasSidebarMemberOverflow && (
                  <button
                    type="button"
                    onClick={() =>
                      setIsMemberRailExpanded((current) => !current)
                    }
                    className="flex h-7 w-5 shrink-0 items-center justify-center text-[var(--ink-tertiary)] transition hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
                    title={
                      isMemberRailExpanded
                        ? t("memberRail.collapse")
                        : t("memberRail.expand")
                    }
                    aria-label={
                      isMemberRailExpanded
                        ? t("memberRail.collapse")
                        : t("memberRail.expand")
                    }
                  >
                    {isMemberRailExpanded ? (
                      <ChevronsLeft className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronsRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    requestTeamMemberInviteNavigation({
                      projectId: selectedProjectId ?? undefined,
                    })
                  }
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-subtle)] transition hover:border-[var(--hairline-strong)] hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                  title={t("inviteMember")}
                  aria-label={t("inviteMember")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Linked Work Items Section */}
            <div className="shrink-0 px-3 py-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[14px] font-semibold text-[var(--ink)]">
                  {t("linkedWorkItems.title")}
                </h2>
                {linkedWorkItems.length > 0 && (
                  <span className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 font-mono text-[13px] text-[var(--ink-tertiary)]">
                    {linkedWorkItems.length}
                  </span>
                )}
              </div>
              {linkedWorkItemsLoading && (
                <div className="rounded-md bg-[var(--surface-1)] px-3 py-2 text-[13px] text-[var(--ink-tertiary)]">
                  {t("linkedWorkItems.loading")}
                </div>
              )}
              {linkedWorkItemsError && (
                <div className="rounded-md bg-[var(--surface-1)] px-3 py-2 text-[13px] text-rose-500">
                  {t("linkedWorkItems.error")}
                </div>
              )}
              {!linkedWorkItemsLoading &&
                !linkedWorkItemsError &&
                linkedWorkItems.length === 0 && (
                  <div className="rounded-md bg-[var(--surface-1)] px-3 py-2 text-[13px] text-[var(--ink-tertiary)]">
                    {t("linkedWorkItems.empty")}
                  </div>
                )}
              {!linkedWorkItemsLoading &&
                !linkedWorkItemsError &&
                linkedWorkItems.length > 0 && (
                  <div className="space-y-1">
                    {linkedWorkItems.map((item) => (
                      <LinkedWorkItemRow
                        key={item.id}
                        item={item}
                        statusPending={updatingLinkedWorkItemIds.has(item.id)}
                        onOpen={handleOpenLinkedWorkItem}
                        t={t}
                        onStatusChange={(nextItem, status) => {
                          void handleLinkedWorkItemStatusChange(
                            nextItem,
                            status,
                          );
                        }}
                      />
                    ))}
                  </div>
                )}
            </div>

            <SessionSourceControlPanel
              projectId={selectedProjectId || null}
              sessionId={activeSessionId || null}
              enabled={usesProjectSourceControl}
              worktreeMode={
                sessionsAsync.data?.find(
                  (session) => session.id === activeSessionId,
                )?.worktreeMode
              }
              fallbackRelatedFiles={plainRelatedFilesContent}
              linkedWorkItemIds={linkedWorkItems.map((item) => item.id)}
              onOpenDiff={(projectId, sessionId, filePath, area) => {
                onOpenSourceControlDiffTab?.(
                  projectId,
                  sessionId,
                  filePath,
                  area,
                );
              }}
              onOpenConflictResolver={(projectId, sessionId) => {
                onOpenWorktreeConflictTab?.(projectId, sessionId);
              }}
            />
          </aside>
        )}
      </div>
    </div>
  );
};
