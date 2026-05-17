export const WORKFLOW_CARD_REFETCH_INTERVAL_MS = 5_000;
export const WORKFLOW_TRANSCRIPT_REFETCH_INTERVAL_MS = 5_000;

const TERMINAL_WORKFLOW_STATES = new Set([
  'completed',
  'failed',
  'cancelled',
  'canceled',
]);

const ACTIVE_WORKFLOW_STATES = new Set([
  'pending',
  'running',
  'waiting',
  'paused',
  'recompiling',
]);

type WorkflowProjectionLike = Pick<
  {
    state: string;
    execution_status: string;
    is_terminal?: boolean;
  },
  'state' | 'execution_status' | 'is_terminal'
>;

export type WorkflowCardDetailLevel = 'summary';

export function buildWorkflowCardUrl(
  messageId: string,
  detail: WorkflowCardDetailLevel = 'summary'
): string {
  return `/api/chat/messages/${encodeURIComponent(messageId)}/workflow-card?detail=${detail}`;
}

export function isTerminalWorkflowProjection(
  projection: WorkflowProjectionLike | null | undefined
): boolean {
  if (!projection) return false;
  if (projection.is_terminal === true) return true;
  const state = projection.state?.toLowerCase();
  const executionStatus = projection.execution_status?.toLowerCase();
  return (
    TERMINAL_WORKFLOW_STATES.has(state) ||
    TERMINAL_WORKFLOW_STATES.has(executionStatus)
  );
}

export function shouldPollWorkflowProjection(
  projection: WorkflowProjectionLike | null | undefined
): boolean {
  if (!projection || isTerminalWorkflowProjection(projection)) {
    return false;
  }

  const state = projection.state?.toLowerCase();
  const executionStatus = projection.execution_status?.toLowerCase();
  return (
    ACTIVE_WORKFLOW_STATES.has(state) ||
    ACTIVE_WORKFLOW_STATES.has(executionStatus)
  );
}

export function getWorkflowCardRefetchInterval(
  projections: Array<WorkflowProjectionLike | null | undefined>
): number | false {
  return projections.some(
    (projection) => !projection || shouldPollWorkflowProjection(projection)
  )
    ? WORKFLOW_CARD_REFETCH_INTERVAL_MS
    : false;
}

export function getWorkflowTranscriptRefetchInterval({
  isOpen,
  projection,
}: {
  isOpen: boolean;
  projection: WorkflowProjectionLike | null | undefined;
}): number | false {
  if (!isOpen || !projection || isTerminalWorkflowProjection(projection)) {
    return false;
  }
  return WORKFLOW_TRANSCRIPT_REFETCH_INTERVAL_MS;
}

export function getWorkflowCardMessageIdsNeedingRefresh({
  messageIds,
  cachedProjectionByMessageId,
  force = false,
}: {
  messageIds: string[];
  cachedProjectionByMessageId: Record<
    string,
    WorkflowProjectionLike | null | undefined
  >;
  force?: boolean;
}): string[] {
  if (force) return messageIds;

  return messageIds.filter((messageId) => {
    const cachedProjection = cachedProjectionByMessageId[messageId];
    return !cachedProjection || shouldPollWorkflowProjection(cachedProjection);
  });
}
