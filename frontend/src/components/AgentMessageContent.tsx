import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AgentActivityPanel } from "@/components/AgentActivityPanel";
import { AgentArtifactFileList } from "@/components/AgentArtifactFileList";
import type { ArtifactDiffStat } from "@/components/AgentArtifactFileList";
import { AgentMarkdown } from "@/components/AgentMarkdown";
import { AgentRunStatusPill } from "@/components/AgentRunStatusPill";
import { WorkflowCard } from "@/components/workflow/WorkflowCard";
import { ApiError, chatRunsApi } from "@/lib/api";
import type { ActivityLoadState, ChatRunActivityLine, Message } from "@/types";

const ACTIVITY_LOAD_TIMEOUT_MS = 15000;

interface AgentMessageContentProps {
  message: Message;
  t: (key: string, replacements?: Record<string, string | number>) => string;
  messageFontSize?: number;
  /** Optional per-path diff stats for artifact rows. */
  diffStats?: Map<string, ArtifactDiffStat>;
  /** Open an artifact file (e.g. into a diff tab). */
  onOpenArtifact?: (path: string) => void;
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
  diffStats,
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
      (activityLines ?? []).filter((line) => line.line_type !== "assistant"),
    [activityLines],
  );
  const hasVisibleActivityLines = visibleActivityLines.length > 0;
  const hasActivityPanelState =
    loadState === "loading" || loadState === "pruned" || loadState === "error";

  const panelLabels = {
    loading: t("agentActivity.loading"),
    cleaned: t("agentActivity.cleaned"),
    error: t("agentActivity.error"),
    empty: t("agentActivity.empty"),
  };

  const showActivityPanel =
    (isRunning || expanded) &&
    (hasVisibleActivityLines || hasActivityPanelState);

  // Structured agent replies carry a derived body (send text, or the
  // conclusion when there is no send). Plain replies leave `replyText`
  // undefined and we fall back to the raw `text`.
  const replyText = message.replyText ?? message.text;
  const hasReplyText = replyText.trim().length > 0;
  const hasArtifacts = !isRunning && (message.artifacts?.length ?? 0) > 0;

  return (
    <div className="space-y-2">
      {isRunning && <AgentRunStatusPill label={t("agentActivity.running")} />}

      {message.workflowCard && message.sessionId && (
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

      {hasReplyText && (
        <AgentMarkdown content={replyText} fontSize={messageFontSize} />
      )}

      {hasArtifacts && message.artifacts && (
        <AgentArtifactFileList
          artifacts={message.artifacts}
          diffStats={diffStats}
          onOpen={onOpenArtifact ?? (() => undefined)}
          title={t("agentArtifacts.title")}
          moreLabel={(count) => t("agentArtifacts.more", { count })}
        />
      )}
    </div>
  );
};
