import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AgentActivityPanel } from "@/components/AgentActivityPanel";
import { AgentArtifactFileList } from "@/components/AgentArtifactFileList";
import { AgentMarkdown } from "@/components/AgentMarkdown";
import { AgentRunStatusPill } from "@/components/AgentRunStatusPill";
import { WorkflowCard } from "@/components/workflow/WorkflowCard";
import { ApiError, chatRunsApi } from "@/lib/api";
import {
  flattenRunFileChanges,
  mergeArtifactPaths,
  type AgentFileRow,
} from "@/lib/agentFileRows";
import { extractArtifactPaths } from "@/lib/parseStructuredReply";
import type { ActivityLoadState, ChatRunActivityLine, Message } from "@/types";

const ACTIVITY_LOAD_TIMEOUT_MS = 15000;
/**
 * Module-level cache of per-run changed-file rows keyed by session id + run id.
 * A run's captured diff is immutable once the run completes, so the rows are
 * safe to reuse across message re-renders and avoid refetching on every scroll.
 */
const runFileRowsCache = new Map<string, AgentFileRow[]>();
const runFileRowsPending = new Map<string, Promise<AgentFileRow[]>>();

const runFileRowsCacheKey = (
  sessionId: string | undefined,
  runId: string | undefined,
): string | null => (runId ? `${sessionId ?? "unknown"}:${runId}` : null);

interface AgentMessageContentProps {
  message: Message;
  t: (key: string, replacements?: Record<string, string | number>) => string;
  messageFontSize?: number;
  /** Open a file row (e.g. into a diff tab). */
  onOpenArtifact?: (file: AgentFileRow) => void;
}

const sortActivityLines = (
  lines: ChatRunActivityLine[] | undefined,
): ChatRunActivityLine[] | undefined =>
  lines
    ? [...lines].sort((a, b) => {
        if (a.sequence !== b.sequence) return a.sequence - b.sequence;
        return a.line_id.localeCompare(b.line_id);
      })
    : undefined;

export const AgentMessageContent: React.FC<AgentMessageContentProps> = ({
  message,
  t,
  messageFontSize,
  onOpenArtifact,
}) => {
  const isRunning = Boolean(message.isAgentRunning || message.isThinking);
  const initialLines = useMemo(
    () => sortActivityLines(message.activityLines),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message.id, message.runId],
  );
  const [expanded, setExpanded] = useState(isRunning);
  const [activityLines, setActivityLines] = useState<
    ChatRunActivityLine[] | undefined
  >(initialLines);
  const [loadState, setLoadState] = useState<ActivityLoadState>(
    message.activityLoadState ?? (initialLines ? "loaded" : "idle"),
  );
  const mountedRef = useRef(true);
  const activityRequestIdRef = useRef(0);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activityRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (isRunning) {
      setExpanded(true);
      wasRunningRef.current = true;
      return;
    }

    if (wasRunningRef.current) {
      setExpanded(false);
      wasRunningRef.current = false;
    }
  }, [isRunning]);

  useEffect(() => {
    const sorted = sortActivityLines(message.activityLines);
    if (sorted) {
      setActivityLines(sorted);
      setLoadState(message.activityLoadState ?? "loaded");
    } else if (message.activityLoadState) {
      setLoadState(message.activityLoadState);
    }
  }, [message.activityLines, message.activityLoadState]);

  useEffect(() => {
    if (!expanded || isRunning || !message.runId) return;
    if (
      loadState === "loaded" ||
      loadState === "loading" ||
      loadState === "pruned"
    ) {
      return;
    }

    const requestId = activityRequestIdRef.current + 1;
    activityRequestIdRef.current = requestId;
    setLoadState("loading");
    let timeoutId: number | undefined;
    const activityRequest = chatRunsApi.getActivity(message.runId, {
      offset: 0,
      limit: 1000,
    });
    const timeoutRequest = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new Error("Agent activity load timed out")),
        ACTIVITY_LOAD_TIMEOUT_MS,
      );
    });

    Promise.race([activityRequest, timeoutRequest])
      .then((response) => {
        if (!mountedRef.current || activityRequestIdRef.current !== requestId) {
          return;
        }
        setActivityLines(sortActivityLines(response.lines) ?? []);
        setLoadState(response.is_pruned ? "pruned" : "loaded");
      })
      .catch((error) => {
        if (!mountedRef.current || activityRequestIdRef.current !== requestId) {
          return;
        }
        setLoadState(
          error instanceof ApiError && error.status === 410
            ? "pruned"
            : "error",
        );
      })
      .finally(() => {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
      });
  }, [expanded, isRunning, message.runId]);

  const visibleActivityLines = useMemo(
    () =>
      isRunning
        ? (activityLines ?? [])
        : (activityLines ?? []).filter((line) => line.line_type !== "assistant"),
    [activityLines, isRunning],
  );
  const hasVisibleActivityLines = visibleActivityLines.length > 0;
  const hasActivityPanelState =
    loadState === "loading" || loadState === "pruned" || loadState === "error";

  // ---- Per-run changed files ------------------------------------------------
  // The file list pinned to the message bottom is sourced from the run's own
  // diff (GET /chat/runs/{run_id}/files). Results are cached per session/run.
  const cacheKey = runFileRowsCacheKey(message.sessionId, message.runId);
  const [runFileRows, setRunFileRows] = useState<AgentFileRow[]>(() =>
    cacheKey ? (runFileRowsCache.get(cacheKey) ?? []) : [],
  );

  useEffect(() => {
    const nextCacheKey = runFileRowsCacheKey(message.sessionId, message.runId);
    if (isRunning || !message.runId || !nextCacheKey) return;
    const runId = message.runId;
    const cached = runFileRowsCache.get(nextCacheKey);
    if (cached) {
      setRunFileRows(cached);
      return;
    }

    let cancelled = false;
    let pending = runFileRowsPending.get(nextCacheKey);
    if (!pending) {
      pending = chatRunsApi
        .getFiles(runId, { includeDiff: false })
        .then((response) => {
          const rows = flattenRunFileChanges(response);
          runFileRowsCache.set(nextCacheKey, rows);
          return rows;
        })
        .finally(() => {
          runFileRowsPending.delete(nextCacheKey);
        });
      runFileRowsPending.set(nextCacheKey, pending);
    }

    pending
      .then((rows) => {
        if (cancelled) return;
        setRunFileRows(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setRunFileRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [message.sessionId, message.runId, isRunning]);

  const artifactPaths = useMemo(
    () =>
      (message.artifacts ?? []).flatMap((artifact) =>
        extractArtifactPaths(artifact.raw ?? artifact.path),
      ),
    [message.artifacts],
  );

  const fileRows = useMemo(
    () => mergeArtifactPaths(runFileRows, artifactPaths),
    [runFileRows, artifactPaths],
  );

  const panelLabels = {
    loading: t("agentActivity.loading"),
    cleaned: t("agentActivity.cleaned"),
    error: t("agentActivity.error"),
    empty: t("agentActivity.empty"),
  };

  const showActivityPanel =
    (isRunning || expanded) &&
    (hasVisibleActivityLines || hasActivityPanelState);

  const hasFileRows = !isRunning && fileRows.length > 0;
  const hasWorkflowCard = Boolean(message.workflowCard && message.sessionId);
  const translatedMessageText = useMemo(() => {
    if (!message.i18nKey) return undefined;
    const translated = t(message.i18nKey, message.i18nParams);
    return translated && translated !== message.i18nKey
      ? translated
      : undefined;
  }, [message.i18nKey, message.i18nParams, t]);
  const visibleMessageText = translatedMessageText ?? message.text;
  // Structured agent replies carry a derived body (send text, or the
  // conclusion when there is no send). Plain replies leave `replyText`
  // undefined and we fall back to the raw/i18n-localized text.
  const replyText = message.replyText ?? visibleMessageText;
  const hasReplyText = replyText.trim().length > 0;
  const displayReplyText =
    hasReplyText || isRunning || hasFileRows || hasWorkflowCard
      ? replyText
      : t("agent.runFailed");

  return (
    <div className="min-w-0 max-w-full space-y-2">
      {isRunning && <AgentRunStatusPill label={t("agentActivity.running")} />}

      {hasWorkflowCard && message.workflowCard && message.sessionId && (
        <WorkflowCard
          sessionId={message.sessionId}
          messageId={message.workflowCard.messageId}
          cardType={message.workflowCard.cardType}
          planGenerationMeta={message.workflowCard.planGeneration}
        />
      )}

      {message.runId && !isRunning && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-[12px] text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-1)] hover:text-[var(--ink-subtle)]"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <span>{t("agentActivity.toggle")}</span>
        </button>
      )}

      {showActivityPanel && (
        <AgentActivityPanel
          lines={visibleActivityLines}
          state={loadState}
          labels={panelLabels}
          translate={t}
        />
      )}

      {displayReplyText.trim().length > 0 && (
        <AgentMarkdown content={displayReplyText} fontSize={messageFontSize} />
      )}

      {hasFileRows && (
        <AgentArtifactFileList
          files={fileRows}
          onOpen={onOpenArtifact ?? (() => undefined)}
          title={t("agentArtifacts.title")}
          moreLabel={(count) => t("agentArtifacts.more", { count })}
        />
      )}
    </div>
  );
};
