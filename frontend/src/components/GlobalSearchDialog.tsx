import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { GitBranch, MessageSquareText, RefreshCw, Search } from "lucide-react";
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
      ? GitBranch
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

    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    const trimmedQuery = query.trim();
    const delayMs = trimmedQuery.length > 0 ? 180 : 0;
    setLoading(true);
    setError(null);
    setSelectedIndex(-1);

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
  }, [open, projectId, query, retryVersion, search, searchMode]);

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
    if (nextMode === ChatSearchMode.worktree) setQuery("");
    setSearchMode(nextMode);
  };

  if (!open) return null;

  const dialog = (
    <div
      className="fixed inset-0 z-[1200] flex items-start justify-center px-4 pt-[12vh] sm:pt-[14vh]"
      role="presentation"
      onKeyDown={handleKeyDown}
    >
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-xs"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
        className="relative flex max-h-[min(620px,calc(100vh-32px))] w-full max-w-2xl flex-col overflow-hidden rounded-[10px] border border-[var(--hairline-strong)] bg-[var(--surface-1)] text-[var(--ink)] shadow-[0_24px_80px_rgba(0,0,0,0.38)]"
      >
        <div className="flex items-center gap-3 border-b border-[var(--hairline)] bg-[var(--surface-2)] px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-[var(--ink-tertiary)]" />
          <input
            ref={inputRef}
            type="search"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索会话、事项和消息"
            className="min-w-0 flex-1 bg-transparent text-[18px] leading-7 text-[var(--ink)] outline-none placeholder:text-[var(--ink-tertiary)]"
          />
          <button
            type="button"
            data-search-worktree-filter="true"
            aria-pressed={worktreeModeActive}
            aria-label="筛选隔离 worktree"
            title="筛选隔离 worktree"
            onClick={toggleWorktreeMode}
            className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition ${
              worktreeModeActive
                ? "border-[var(--primary)] bg-[var(--primary-tint)] text-[var(--primary)]"
                : "border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-tertiary)] hover:border-[var(--hairline-strong)] hover:text-[var(--ink)]"
            }`}
          >
            <GitBranch className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-48 overflow-y-auto bg-[var(--surface-1)] p-2">
          {loading ? (
            <div className="space-y-1" aria-label="搜索加载中">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                >
                  <div className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-[var(--surface-3)]" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3 w-2/5 animate-pulse rounded bg-[var(--surface-3)]" />
                    <div className="h-2.5 w-3/5 animate-pulse rounded bg-[var(--surface-3)]" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <button
              type="button"
              onClick={() => setRetryVersion((version) => version + 1)}
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-3 text-left text-[13px] text-[var(--ink-subtle)] transition hover:border-[var(--hairline)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              <RefreshCw className="h-4 w-4 shrink-0 text-[var(--ink-tertiary)]" />
              <span className="min-w-0 flex-1 truncate">
                搜索失败，点击重试
              </span>
              <span className="max-w-[40%] shrink-0 truncate text-[12px] text-[var(--ink-tertiary)]">
                {error}
              </span>
            </button>
          ) : results.length === 0 ? (
            <div className="flex h-44 items-center justify-center rounded-lg text-[14px] text-[var(--ink-tertiary)]">
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
                    onClick={() => openResult(result)}
                    className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                      active
                        ? "border-[var(--hairline-strong)] bg-[var(--surface-3)] text-[var(--ink)]"
                        : "border-transparent text-[var(--ink-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${
                        active
                          ? "border-[var(--primary)] bg-[var(--primary-tint)] text-[var(--primary)]"
                          : "border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-tertiary)]"
                      }`}
                    >
                      <ResultIcon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium leading-5">
                        {resultTitle(result)}
                      </span>
                      <span className="block truncate text-[12px] leading-5 text-[var(--ink-tertiary)]">
                        {resultSnippet(result)}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-2 py-1 text-[11px] text-[var(--ink-tertiary)]">
                      {resultMeta(result)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );

  return portalTarget ? createPortal(dialog, portalTarget) : dialog;
}
