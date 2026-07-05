import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Archive, Bell, Check, LoaderCircle } from "lucide-react";
import { useAppScale } from "@/context/AppScaleContext";
import type { Session } from "@/types";
import type { InboxItem, InboxSummary } from "../../../shared/types";

type Translate = (
  key: string,
  fallback: string,
  replacements?: Record<string, string | number>,
) => string;

interface InboxNotificationsPopoverProps {
  triggerClassName: string;
  portalTarget: Element | DocumentFragment | null;
  sessions: Session[];
  summary?: InboxSummary | null;
  items?: InboxItem[];
  loading?: boolean;
  error?: string | null;
  translate: Translate;
  onRefresh?: () => Promise<void>;
  onItemOpen?: (item: InboxItem) => void;
  onMarkItemRead?: (itemId: string) => Promise<void>;
  onMarkAllRead?: () => Promise<void>;
  onArchiveItem?: (itemId: string) => Promise<void>;
}

const inboxCountNumber = (
  value: bigint | number | string | null | undefined,
): number => {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const inboxBadgeLabel = (count: number): string =>
  count > 99 ? "99+" : String(Math.max(0, count));

const inboxItemTimeMs = (value: Date | string | null | undefined): number => {
  if (!value) return 0;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatInboxRelativeTime = (
  value: Date | string | null | undefined,
): string => {
  const timestamp = inboxItemTimeMs(value);
  if (!timestamp) return "";
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return "now";
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  return `${Math.floor(elapsedHours / 24)}d`;
};

const inboxSeverityClass = (severity: InboxItem["severity"]): string => {
  const value = String(severity);
  if (value === "error") return "bg-red-400";
  if (value === "warning") return "bg-amber-400";
  return "bg-[var(--ink-tertiary)]";
};

const inboxSeverityTextClass = (severity: InboxItem["severity"]): string => {
  const value = String(severity);
  if (value === "error") return "text-red-400";
  if (value === "warning") return "text-amber-400";
  return "text-[var(--ink-tertiary)]";
};

const inboxActionLabel = (item: InboxItem): string => {
  if (
    item.kind === "worktree_cleanup_failed" ||
    item.source_type === "worktree_cleanup"
  ) {
    return "Retry";
  }
  if (
    item.kind === "worktree_conflict" ||
    item.source_type === "worktree_conflict"
  ) {
    return "Resolve";
  }
  if (
    item.kind === "workflow_input" ||
    item.source_type === "workflow_input" ||
    item.source_type === "workflow_continue"
  ) {
    return "Respond";
  }
  if (
    item.kind === "workflow_review" ||
    item.kind === "workflow_final_review" ||
    item.source_type === "workflow_review" ||
    item.source_type === "workflow_final_review"
  ) {
    return "Review";
  }
  if (
    item.kind === "workflow_approval" ||
    item.kind === "executor_approval" ||
    item.source_type === "workflow_approval" ||
    item.source_type === "executor_approval"
  ) {
    return "Approve";
  }
  return "Open";
};

export function InboxNotificationsPopover({
  triggerClassName,
  portalTarget,
  sessions,
  summary = null,
  items = [],
  loading = false,
  error = null,
  translate,
  onRefresh,
  onItemOpen,
  onMarkItemRead,
  onMarkAllRead,
  onArchiveItem,
}: InboxNotificationsPopoverProps) {
  const appScale = useAppScale();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [actionItemId, setActionItemId] = useState<string | null>(null);
  const portalScale =
    appScale.enabled && portalTarget === appScale.portalRoot
      ? appScale.scale
      : 1;
  const toOverlayValue = useCallback(
    (value: number) => value / portalScale,
    [portalScale],
  );
  const sessionTitleById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session.title])),
    [sessions],
  );
  const unreadCount = inboxCountNumber(summary?.unread_count);
  const sortedItems = useMemo(
    () =>
      [...items]
        .filter((item) => item.read_at === null && item.archived_at === null)
        .sort(
          (left, right) =>
            inboxItemTimeMs(right.created_at) - inboxItemTimeMs(left.created_at),
        ),
    [items],
  );

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPosition({
      left: toOverlayValue(rect.left),
      top: toOverlayValue(rect.bottom + 6),
    });
  }, [toOverlayValue]);

  const toggleOpen = useCallback(() => {
    updatePosition();
    setOpen((current) => !current);
    if (!open) {
      void onRefresh?.();
    }
  }, [onRefresh, open, updatePosition]);

  const close = useCallback(() => setOpen(false), []);

  const openItem = useCallback(
    (item: InboxItem) => {
      onItemOpen?.(item);
      close();
    },
    [close, onItemOpen],
  );

  const handleItemKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, item: InboxItem) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openItem(item);
    },
    [openItem],
  );

  const markItemRead = useCallback(
    async (event: React.MouseEvent, itemId: string) => {
      event.stopPropagation();
      if (!onMarkItemRead) return;
      setActionItemId(itemId);
      try {
        await onMarkItemRead(itemId);
      } finally {
        setActionItemId(null);
      }
    },
    [onMarkItemRead],
  );

  const archiveItem = useCallback(
    async (event: React.MouseEvent, itemId: string) => {
      event.stopPropagation();
      if (!onArchiveItem) return;
      setActionItemId(itemId);
      try {
        await onArchiveItem(itemId);
      } finally {
        setActionItemId(null);
      }
    },
    [onArchiveItem],
  );

  const markAllRead = useCallback(async () => {
    if (!onMarkAllRead) return;
    setActionItemId("all");
    try {
      await onMarkAllRead();
    } finally {
      setActionItemId(null);
    }
  }, [onMarkAllRead]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const handleResize = () => updatePosition();
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (triggerRef.current?.contains(target) ||
          popoverRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${triggerClassName} relative`}
        onClick={toggleOpen}
        aria-label={translate(
          "sidebar.aria.openNotifications",
          "Open notifications",
        )}
        aria-expanded={open}
      >
        <Bell className="h-3.5 w-3.5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 font-mono text-[9px] font-semibold leading-[16px] text-white">
            {inboxBadgeLabel(unreadCount)}
          </span>
        )}
      </button>

      {open &&
        portalTarget &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[1001] w-[360px] overflow-hidden rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-3)] shadow-2xl"
            style={{ left: position.left, top: position.top }}
          >
            <div className="flex items-center justify-between border-b border-[var(--hairline)] px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-[var(--ink)]">
                  {translate("sidebar.inbox.title", "Notifications")}
                </div>
                {error && (
                  <div className="mt-0.5 truncate text-[10px] text-amber-400">
                    {translate("sidebar.inbox.refreshFailed", "Refresh failed")}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                {error && onRefresh && (
                  <button
                    type="button"
                    className="rounded px-1.5 py-1 text-[10px] font-medium text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-1)] hover:text-[var(--ink)]"
                    onClick={() => void onRefresh()}
                  >
                    {translate("sidebar.inbox.retry", "Retry")}
                  </button>
                )}
                {sortedItems.length > 0 && onMarkAllRead && (
                  <button
                    type="button"
                    className="rounded px-1.5 py-1 text-[10px] font-medium text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-1)] hover:text-[var(--ink)] disabled:opacity-50"
                    onClick={() => void markAllRead()}
                    disabled={actionItemId === "all"}
                  >
                    {translate("sidebar.inbox.markAllRead", "Mark all")}
                  </button>
                )}
              </div>
            </div>
            <div className="max-h-[420px] overflow-y-auto p-1.5 ot-scroll-area-styled">
              {loading && sortedItems.length === 0 ? (
                <div className="flex items-center justify-center gap-2 px-3 py-8 text-[12px] text-[var(--ink-tertiary)]">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  {translate("sidebar.inbox.loading", "Loading")}
                </div>
              ) : sortedItems.length === 0 ? (
                <div className="px-3 py-8 text-center text-[12px] text-[var(--ink-tertiary)]">
                  {translate(
                    "sidebar.inbox.empty",
                    "No unread notifications",
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {sortedItems.map((item) => {
                    const sessionTitle = item.session_id
                      ? sessionTitleById.get(item.session_id)
                      : null;
                    const itemPending = actionItemId === item.id;
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        className="group relative rounded-md border border-transparent px-2.5 py-2 pr-[78px] text-left transition hover:border-[var(--hairline)] hover:bg-[var(--surface-1)] focus-visible:border-[var(--primary)] focus-visible:outline-none"
                        onClick={() => openItem(item)}
                        onKeyDown={(event) => handleItemKeyDown(event, item)}
                      >
                        <div
                          className={`absolute left-0 top-2 bottom-2 w-[2px] rounded-full ${inboxSeverityClass(
                            item.severity,
                          )}`}
                        />
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span
                            className={`text-[10px] font-semibold uppercase ${inboxSeverityTextClass(
                              item.severity,
                            )}`}
                          >
                            {item.severity}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--ink-tertiary)]">
                            {sessionTitle ??
                              translate("sidebar.inbox.session", "Session")}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-[var(--ink-tertiary)]">
                            {formatInboxRelativeTime(item.created_at)}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-[12px] font-semibold text-[var(--ink)]">
                          {item.title}
                        </div>
                        {item.body && (
                          <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--ink-muted)]">
                            {item.body}
                          </div>
                        )}
                        <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                          <button
                            type="button"
                            className="rounded border border-[var(--hairline)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px] font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                            onClick={(event) => {
                              event.stopPropagation();
                              openItem(item);
                            }}
                          >
                            {inboxActionLabel(item)}
                          </button>
                          {onMarkItemRead && (
                            <button
                              type="button"
                              className="rounded border border-[var(--hairline)] bg-[var(--surface-2)] p-1 text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:opacity-50"
                              onClick={(event) =>
                                void markItemRead(event, item.id)
                              }
                              disabled={itemPending}
                              aria-label={translate(
                                "sidebar.inbox.markRead",
                                "Mark as read",
                              )}
                            >
                              <Check className="h-3 w-3" />
                            </button>
                          )}
                          {onArchiveItem && (
                            <button
                              type="button"
                              className="rounded border border-[var(--hairline)] bg-[var(--surface-2)] p-1 text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:opacity-50"
                              onClick={(event) =>
                                void archiveItem(event, item.id)
                              }
                              disabled={itemPending}
                              aria-label={translate(
                                "sidebar.inbox.archive",
                                "Archive",
                              )}
                            >
                              <Archive className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>,
          portalTarget,
        )}
    </>
  );
}
