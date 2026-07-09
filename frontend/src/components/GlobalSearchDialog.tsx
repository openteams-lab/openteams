import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  FolderGit2,
  MessageSquareText,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { chatSearchApi } from "@/lib/api";
import { useAppScale } from "@/context/AppScaleContext";
import {
  ChatSearchMode,
  type ChatSearchQuery,
  type ChatSearchResponse,
  type ChatSearchResult,
} from "../../../shared/types";

type SearchRequest = (params: ChatSearchQuery) => Promise<ChatSearchResponse>;
type Translate = (
  key: string,
  fallback: string,
  replacements?: Record<string, string | number>,
) => string;

interface GlobalSearchDialogProps {
  open: boolean;
  projectId?: string | null;
  onClose: () => void;
  onOpenResult: (result: ChatSearchResult) => void;
  search?: SearchRequest;
  translate?: Translate;
}

const applyReplacements = (
  text: string,
  replacements?: Record<string, string | number>,
): string => {
  if (!replacements) return text;
  return Object.entries(replacements).reduce(
    (current, [name, value]) => current.replace(`{${name}}`, String(value)),
    text,
  );
};

const defaultTranslate: Translate = (_key, fallback, replacements) =>
  applyReplacements(fallback, replacements);

export const moveGlobalSearchSelection = (
  currentIndex: number,
  resultCount: number,
  direction: 1 | -1,
): number => {
  if (resultCount <= 0) return -1;
  if (currentIndex < 0) return direction > 0 ? 0 : resultCount - 1;
  return (currentIndex + direction + resultCount) % resultCount;
};

const resultKey = (result: ChatSearchResult): string => {
  switch (result.type) {
    case "session":
      return `session:${result.session_id}`;
    case "issue":
      return `issue:${result.issue_id}`;
    case "message":
      return `message:${result.message_id}`;
    case "worktree":
      return `worktree:${result.worktree_id}`;
  }
};

const resultTitle = (result: ChatSearchResult): string => {
  switch (result.type) {
    case "session":
      return result.title;
    case "issue":
      return result.title;
    case "message":
      return result.session_title;
    case "worktree":
      return result.session_title;
  }
};

const humanizeEnumLabel = (value: string): string =>
  value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const issueStatusTranslationKey = (status: string): string =>
  status === "open" ? "todo" : status;

const translatedIssueStatus = (
  status: string,
  translate: Translate,
): string =>
  translate(
    `issue.status.${issueStatusTranslationKey(status)}`,
    humanizeEnumLabel(status),
  );

const translatedIssuePriority = (
  priority: string,
  translate: Translate,
): string =>
  translate(`issue.priority.${priority}`, humanizeEnumLabel(priority));

const translatedWorktreeStatus = (
  status: string,
  translate: Translate,
): string =>
  translate(`globalSearch.worktreeStatus.${status}`, humanizeEnumLabel(status));

const resultSnippet = (
  result: ChatSearchResult,
  translate: Translate,
): string => {
  switch (result.type) {
    case "session":
      return (
        result.snippet ??
        translate("globalSearch.sessionFallback", "Recently updated session")
      );
    case "issue":
      return (
        result.snippet ??
        translate("globalSearch.issueFallback", "{status} · {priority}", {
          status: translatedIssueStatus(result.status, translate),
          priority: translatedIssuePriority(result.priority, translate),
        })
      );
    case "message":
      return translate("globalSearch.messageSnippet", "{sender}: {snippet}", {
        sender: result.sender_label,
        snippet: result.snippet,
      });
    case "worktree":
      return translate("globalSearch.worktreeSnippet", "{branch} · {path}", {
        branch: result.branch_name,
        path: result.path_summary,
      });
  }
};

const resultMeta = (
  result: ChatSearchResult,
  translate: Translate,
): string => {
  switch (result.type) {
    case "session":
      return translate("globalSearch.meta.session", "Session");
    case "issue":
      return translate("globalSearch.meta.issue", "Issue");
    case "message":
      return translate("globalSearch.meta.message", "Message");
    case "worktree":
      return translate(
        "globalSearch.meta.worktreeWithStatus",
        "{label} · {status}",
        {
          label: translate("globalSearch.meta.worktree", "Worktree"),
          status: translatedWorktreeStatus(result.status, translate),
        },
      );
  }
};

const resultIcon = (result: ChatSearchResult) =>
  result.type === "message"
    ? MessageSquareText
    : result.type === "worktree"
      ? FolderGit2
      : Search;

export function GlobalSearchDialog({
  open,
  projectId,
  onClose,
  onOpenResult,
  search = chatSearchApi.search,
  translate = defaultTranslate,
}: GlobalSearchDialogProps) {
  const appScale = useAppScale();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestSeqRef = useRef(0);
  const wasOpenRef = useRef(false);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<ChatSearchMode>(
    ChatSearchMode.all,
  );
  const [results, setResults] = useState<ChatSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [retryVersion, setRetryVersion] = useState(0);
  const portalTarget =
    appScale.portalRoot ??
    (typeof document === "undefined" ? null : document.body);
  const worktreeModeActive = searchMode === ChatSearchMode.worktree;

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setQuery("");
      setSearchMode(ChatSearchMode.all);
      setResults([]);
      setError(null);
      setSelectedIndex(-1);
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const focusFrame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open]);

  useEffect(() => {
    if (!open) {
      requestSeqRef.current += 1;
      return;
    }

    const trimmedQuery = query.trim();
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    setError(null);
    setSelectedIndex(-1);

    const canSearch = trimmedQuery.length > 0 || worktreeModeActive;
    if (!canSearch) {
      setResults([]);
      setLoading(false);
      return;
    }

    const delayMs = trimmedQuery.length > 0 ? 180 : 0;
    setLoading(true);

    const timer = window.setTimeout(() => {
      void search({
        project_id: projectId || null,
        q: trimmedQuery,
        mode: searchMode,
      })
        .then((response) => {
          if (requestSeqRef.current !== requestId) return;
          setResults(response.results);
          setSelectedIndex(response.results.length > 0 ? 0 : -1);
          setError(null);
        })
        .catch((err) => {
          if (requestSeqRef.current !== requestId) return;
          setResults([]);
          setSelectedIndex(-1);
          setError(
            err instanceof Error
              ? err.message
              : translate(
                  "globalSearch.errorFallback",
                  "Search failed. Please try again.",
                ),
          );
        })
        .finally(() => {
          if (requestSeqRef.current === requestId) setLoading(false);
        });
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [
    open,
    projectId,
    query,
    retryVersion,
    search,
    searchMode,
    translate,
    worktreeModeActive,
  ]);

  const selectedResult = useMemo(
    () => (selectedIndex >= 0 ? results[selectedIndex] : undefined),
    [results, selectedIndex],
  );

  const openResult = useCallback(
    (result: ChatSearchResult) => {
      onOpenResult(result);
      onClose();
    },
    [onClose, onOpenResult],
  );

  const openSelectedResult = useCallback(() => {
    if (!selectedResult) return;
    openResult(selectedResult);
  }, [openResult, selectedResult]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) =>
        moveGlobalSearchSelection(current, results.length, 1),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) =>
        moveGlobalSearchSelection(current, results.length, -1),
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      openSelectedResult();
    }
  };

  const toggleWorktreeMode = () => {
    const nextMode = worktreeModeActive
      ? ChatSearchMode.all
      : ChatSearchMode.worktree;
    setSearchMode(nextMode);
  };

  const clearQuery = () => {
    setQuery("");
    setError(null);
    setSelectedIndex(-1);
    if (!worktreeModeActive) {
      setResults([]);
      setLoading(false);
    }
    inputRef.current?.focus();
  };

  if (!open) return null;

  const hasQuery = query.trim().length > 0;
  const showResultsPanel = hasQuery || worktreeModeActive;

  const dialog = (
    <div
      className="fixed inset-0 z-[1200] flex items-start justify-center px-4 pt-[12vh] sm:pt-[14vh]"
      role="presentation"
      onKeyDown={handleKeyDown}
    >
      <div
        className="global-search-backdrop absolute inset-0 backdrop-blur-xs"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={translate("globalSearch.dialogLabel", "Global search")}
        className="global-search-dialog relative flex max-h-[min(640px,calc(100vh-32px))] w-full max-w-xl flex-col overflow-hidden rounded-[10px] border text-[var(--ink)] backdrop-blur-xl"
      >
        <div className="global-search-input-bar flex items-center gap-3 border-b px-4 py-2.5">
          <Search
            strokeWidth={1.75}
            className="global-search-leading-icon h-4.5 w-4.5 shrink-0"
          />
          <input
            ref={inputRef}
            type="search"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate(
              "globalSearch.placeholder",
              "Search sessions, issues, and messages",
            )}
            className="global-search-input min-w-0 flex-1 bg-transparent text-[16px] leading-6 outline-none"
          />
          {query.length > 0 && (
            <button
              type="button"
              data-global-search-clear="true"
              aria-label={translate("globalSearch.clear", "Clear search")}
              title={translate("globalSearch.clear", "Clear search")}
              onClick={clearQuery}
              className="global-search-clear-button flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.4} />
            </button>
          )}
          <button
            type="button"
            data-search-worktree-filter="true"
            aria-pressed={worktreeModeActive}
            aria-label={translate(
              "globalSearch.worktreeFilter",
              "Filter isolated worktree",
            )}
            title={translate(
              "globalSearch.worktreeFilter",
              "Filter isolated worktree",
            )}
            onClick={toggleWorktreeMode}
            className="global-search-worktree-toggle flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition"
          >
            <FolderGit2 strokeWidth={1.6} className="h-3.5 w-3.5" />
          </button>
        </div>

        {showResultsPanel && (
          <div
            data-global-search-results-panel="true"
            className="global-search-results-panel max-h-[min(520px,calc(100vh-128px))] overflow-y-auto p-1.5"
          >
            {loading ? (
              <div
                className="space-y-1"
                aria-label={translate("globalSearch.loading", "Search loading")}
              >
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2.5 rounded-[7px] px-3 py-2"
                  >
                    <div className="global-search-skeleton-mark h-3.5 w-3.5 shrink-0 animate-pulse rounded" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="global-search-skeleton-line h-2.5 w-2/5 animate-pulse rounded" />
                      <div className="global-search-skeleton-line-muted h-2 w-3/5 animate-pulse rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <button
                type="button"
                onClick={() => setRetryVersion((version) => version + 1)}
                className="global-search-error-row flex w-full cursor-pointer items-center gap-2.5 rounded-[7px] border border-transparent px-3 py-2 text-left text-[12px] transition"
              >
                <RefreshCw
                  strokeWidth={1.75}
                  className="global-search-error-icon h-3.5 w-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">
                  {translate(
                    "globalSearch.retry",
                    "Search failed, click to retry",
                  )}
                </span>
                <span className="global-search-error-detail max-w-[40%] shrink-0 truncate text-[11px]">
                  {error}
                </span>
              </button>
            ) : results.length === 0 ? (
              <div className="global-search-empty-state flex h-36 items-center justify-center rounded-[7px] text-[13px]">
                {translate("globalSearch.empty", "No matching results")}
              </div>
            ) : (
              <div
                role="listbox"
                aria-label={translate("globalSearch.results", "Search results")}
                className="space-y-1"
              >
                {results.map((result, index) => {
                  const active = index === selectedIndex;
                  const ResultIcon = resultIcon(result);
                  return (
                    <button
                      key={resultKey(result)}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-active={active ? "true" : undefined}
                      onClick={() => openResult(result)}
                      className="global-search-result-row flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left transition"
                    >
                      <span className="global-search-result-icon flex h-4.5 w-4.5 shrink-0 items-center justify-center">
                        <ResultIcon
                          strokeWidth={1.75}
                          className="h-3.5 w-3.5"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="global-search-result-title block truncate text-[13px] font-medium leading-[17px]">
                          {resultTitle(result)}
                        </span>
                        <span className="global-search-result-snippet block truncate text-[11px] leading-[15px]">
                          {resultSnippet(result, translate)}
                        </span>
                      </span>
                      <span className="global-search-result-meta shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] leading-4">
                        {resultMeta(result, translate)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );

  return portalTarget ? createPortal(dialog, portalTarget) : dialog;
}
