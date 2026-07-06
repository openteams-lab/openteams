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

interface GlobalSearchDialogProps {
  open: boolean;
  projectId?: string | null;
  onClose: () => void;
  onOpenResult: (result: ChatSearchResult) => void;
  search?: SearchRequest;
}

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

const resultSnippet = (result: ChatSearchResult): string => {
  switch (result.type) {
    case "session":
      return result.snippet ?? "最近更新的会话";
    case "issue":
      return result.snippet ?? `${result.status} · ${result.priority}`;
    case "message":
      return `${result.sender_label}: ${result.snippet}`;
    case "worktree":
      return `${result.branch_name} · ${result.path_summary}`;
  }
};

const resultMeta = (result: ChatSearchResult): string => {
  switch (result.type) {
    case "session":
      return "会话";
    case "issue":
      return "事项";
    case "message":
      return "消息";
    case "worktree":
      return `Worktree · ${result.status}`;
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
            err instanceof Error ? err.message : "搜索失败，请稍后重试",
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
        aria-label="全局搜索"
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
            placeholder="搜索会话、事项和消息"
            className="global-search-input min-w-0 flex-1 bg-transparent text-[16px] leading-6 outline-none"
          />
          {query.length > 0 && (
            <button
              type="button"
              data-global-search-clear="true"
              aria-label="Clear search"
              title="Clear search"
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
            aria-label="筛选隔离 worktree"
            title="筛选隔离 worktree"
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
            <div className="space-y-1" aria-label="搜索加载中">
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
                搜索失败，点击重试
              </span>
              <span className="global-search-error-detail max-w-[40%] shrink-0 truncate text-[11px]">
                {error}
              </span>
            </button>
          ) : results.length === 0 ? (
            <div className="global-search-empty-state flex h-36 items-center justify-center rounded-[7px] text-[13px]">
              没有匹配结果
            </div>
          ) : (
            <div role="listbox" aria-label="搜索结果" className="space-y-1">
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
                      <ResultIcon strokeWidth={1.75} className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="global-search-result-title block truncate text-[13px] font-medium leading-[17px]">
                        {resultTitle(result)}
                      </span>
                      <span className="global-search-result-snippet block truncate text-[11px] leading-[15px]">
                        {resultSnippet(result)}
                      </span>
                    </span>
                    <span className="global-search-result-meta shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] leading-4">
                      {resultMeta(result)}
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
